const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, chmodSync, realpathSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');

const repoRoot = resolve(__dirname, '../..');
const scriptPath = resolve(repoRoot, 'scripts/run-skill.sh');

/**
 * The previous version of this file asserted `output.length >= 0` on a command
 * ending in `; true`. Both halves are unconditional: the status is discarded and
 * the assertion holds for every string, the empty one included. A wrapper that
 * never launched its target passed. That is why several security regressions in
 * this dispatcher stayed green — see the round notes in
 * docs/features/create-pr-stacked/requests/2026-07-31-stacked-pr-mode-r2.md.
 *
 * Everything below asserts an exact nonce that only the dispatched target can
 * print, plus the exit status, so "the target never ran" fails.
 */

const NONCE = 'run-skill-fixture-8f31c0';

/** Build a self-contained plugin tree: a copy of the real wrapper + one fixture skill. */
function makeTree(t, { wrapperIsSymlink = false } = {}) {
  // realpath, because the wrapper resolves its own location physically and macOS
  // hands out /var/folders/… for a directory whose real path is /private/var/….
  // Comparing against the unresolved name would fail for the wrong reason.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'run-skill-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'skills/fixture/scripts'), { recursive: true });

  if (wrapperIsSymlink) {
    symlinkSync(scriptPath, join(root, 'scripts/run-skill.sh'));
  } else {
    writeFileSync(join(root, 'scripts/run-skill.sh'), readFileSync(scriptPath));
    chmodSync(join(root, 'scripts/run-skill.sh'), 0o755);
  }

  // Prints the nonce, the root it was dispatched from, and its own argv.
  writeFileSync(
    join(root, 'skills/fixture/scripts/echo.sh'),
    `#!/bin/bash\nprintf '%s|%s|%s\\n' '${NONCE}' "$PLUGIN_ROOT" "$*"\nexit 0\n`
  );
  chmodSync(join(root, 'skills/fixture/scripts/echo.sh'), 0o755);
  return root;
}

function run(wrapper, args, { env = {}, cwd = repoRoot } = {}) {
  const r = spawnSync('/bin/bash', ['-p', wrapper, ...args], {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('run-skill.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('dispatching a .sh skill script actually launches it → nonce on stdout, exit 0', (t) => {
  const root = makeTree(t);
  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.sh', 'a', 'b']);

  assert.equal(r.status, 0, `expected clean exit, got ${r.status} (stderr: ${r.stderr})`);
  assert.equal(r.stdout, `${NONCE}|${root}|a b\n`,
    'stdout must be exactly what the dispatched target prints — nonce, resolved root, forwarded argv');
});

test('PLUGIN_ROOT reaches the child as the tree the wrapper actually lives in', (t) => {
  const root = makeTree(t);
  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.sh']);

  const [nonce, pluginRoot] = r.stdout.trim().split('|');
  assert.equal(nonce, NONCE, 'the target must have run');
  assert.equal(pluginRoot, root, 'PLUGIN_ROOT must be the wrapper\'s own tree, not the cwd');
});

test('a symlinked wrapper resolves to its REAL tree, not the tree the link sits in', (t) => {
  // The planted-tree attack: drop a symlink to the genuine wrapper inside a tree
  // you control, and an unresolved BASH_SOURCE makes it dispatch YOUR copy of the
  // policy script. Here the planted skill would exit 0 and print an attacker
  // nonce; the real repo has no `fixture` skill, so resolution is observable.
  const planted = makeTree(t, { wrapperIsSymlink: true });
  writeFileSync(
    join(planted, 'skills/fixture/scripts/echo.sh'),
    "#!/bin/bash\nprintf 'ATTACKER-COPY-RAN\\n'\nexit 0\n"
  );
  chmodSync(join(planted, 'skills/fixture/scripts/echo.sh'), 0o755);

  const r = run(join(planted, 'scripts/run-skill.sh'), ['fixture', 'echo.sh']);

  assert.ok(!r.stdout.includes('ATTACKER-COPY-RAN'),
    'the planted tree\'s script must never be selected through a symlinked wrapper');
  assert.notEqual(r.status, 0,
    'resolving to the real repo, which has no `fixture` skill, must fail rather than succeed');
});

test('the shell interpreter is not taken from the caller\'s PATH', (t) => {
  // A `bash` earlier in PATH that exits 0 without running anything would answer
  // the dispatch for the target. The wrapper names /bin/bash absolutely.
  const root = makeTree(t);
  const evil = join(root, 'evil');
  mkdirSync(evil);
  writeFileSync(join(evil, 'bash'), "#!/bin/sh\nexit 0\n");
  chmodSync(join(evil, 'bash'), 0o755);

  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.sh'], {
    env: { PATH: `${evil}:${process.env.PATH}` },
  });

  assert.equal(r.status, 0, `expected the real target to run, got ${r.status}`);
  assert.ok(r.stdout.includes(NONCE),
    'the fixture\'s nonce proves the genuine interpreter launched the genuine target');
});

test('the dispatched .sh target runs in privileged mode', (t) => {
  // `-p` must be passed on rather than left to the target's shebang: the target
  // is launched as an ARGUMENT to bash here, which bypasses its shebang, and
  // $BASH_ENV would then run in the target's startup before its first line.
  // `$-` is the direct observation — an imported function cannot forge it.
  const root = makeTree(t);
  writeFileSync(
    join(root, 'skills/fixture/scripts/flags.sh'),
    "#!/bin/bash\nprintf 'FLAGS=%s\\n' \"$-\"\nexit 0\n"
  );
  chmodSync(join(root, 'skills/fixture/scripts/flags.sh'), 0o755);

  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'flags.sh']);

  assert.equal(r.status, 0, `expected clean exit, got ${r.status} (stderr: ${r.stderr})`);
  const flags = /FLAGS=(\S*)/.exec(r.stdout);
  assert.ok(flags, `expected the target to report its shell flags, got: ${r.stdout}`);
  assert.ok(flags[1].includes('p'),
    `the target must run privileged; $- was "${flags[1]}"`);
});

test('caller PATH and the absolute interpreter are BOTH required to keep the interpreter honest', (t) => {
  // These two guards are redundant on purpose, which makes each one individually
  // un-mutatable: reverting `PATH=/usr/bin:…:$PATH` still leaves `exec /bin/bash`,
  // and reverting `/bin/bash` back to bare `bash` still resolves through the
  // prepended system directories. Only removing both reopens the hole, so the
  // control that actually goes red is this combined one, applied to a copy.
  const root = makeTree(t);
  const wrapper = join(root, 'scripts/run-skill.sh');
  const weakened = readFileSync(wrapper, 'utf8')
    .replace('PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"', 'PATH="$PATH"')
    .replace('exec /bin/bash -p "$TARGET"', 'exec bash -p "$TARGET"');
  assert.ok(!weakened.includes('exec /bin/bash -p "$TARGET"'),
    'both mutations must have applied, or this control proves nothing');
  assert.ok(!weakened.includes('/usr/bin:/bin:/usr/sbin:/sbin:$PATH'),
    'both mutations must have applied, or this control proves nothing');
  writeFileSync(wrapper, weakened);

  const evil = join(root, 'evil');
  mkdirSync(evil);
  writeFileSync(join(evil, 'bash'), "#!/bin/sh\nexit 0\n");
  chmodSync(join(evil, 'bash'), 0o755);

  const r = run(wrapper, ['fixture', 'echo.sh'], { env: { PATH: `${evil}:${process.env.PATH}` } });

  assert.ok(!r.stdout.includes(NONCE),
    'with both guards removed the hostile interpreter answers instead of the target — ' +
    'if this now prints the nonce, the redundancy argument above is stale and the ' +
    'single-guard tests should be tightened');
});

test('the dispatch names its interpreter absolutely (source-level)', () => {
  // Redundant with the runtime control above by construction; kept because it is
  // the assertion that goes red the moment someone edits the line back.
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /exec \/bin\/bash -p "\$TARGET"/,
    '.sh targets must be launched via an absolute, privileged interpreter');
  assert.match(src, /^PATH="\/usr\/bin:\/bin:\/usr\/sbin:\/sbin:\$PATH"$/m,
    'trusted directories must precede the caller\'s PATH');
});

test('dispatching a .js skill script runs it under node', (t) => {
  const root = makeTree(t);
  writeFileSync(
    join(root, 'skills/fixture/scripts/echo.js'),
    `process.stdout.write('${NONCE}-js|' + process.env.PLUGIN_ROOT + '\\n');\n`
  );
  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.js']);

  assert.equal(r.status, 0, `expected clean exit, got ${r.status} (stderr: ${r.stderr})`);
  assert.equal(r.stdout, `${NONCE}-js|${root}\n`,
    'a .js target must run under node and receive PLUGIN_ROOT');
});

test('a real repo skill script dispatches and produces its own diagnostics', () => {
  // merge-prep/pre-merge-check.sh requires args; the point is that its OWN usage
  // text appears, which only happens if bash (not node) launched the real file.
  const r = run(scriptPath, ['merge-prep', 'pre-merge-check.sh']);
  const combined = r.stdout + r.stderr;
  assert.notEqual(r.status, 0, 'missing args must exit non-zero');
  assert.ok(/Usage|pre-merge-check/.test(combined),
    `expected the script's own usage message, got: ${combined}`);
});

test('run-skill.sh rejects path traversal in skill name', () => {
  const r = run(scriptPath, ['../etc', 'passwd.sh']);
  assert.notEqual(r.status, 0, 'should exit non-zero for path traversal in skill name');
  assert.match(r.stderr, /path traversal/, 'and say why');
});

test('run-skill.sh rejects path traversal in script name', () => {
  const r = run(scriptPath, ['merge-prep', '../../etc/passwd']);
  assert.notEqual(r.status, 0, 'should exit non-zero for path traversal in script name');
  assert.match(r.stderr, /path traversal/, 'and say why');
});

test('run-skill.sh exits non-zero for a missing skill', () => {
  const r = run(scriptPath, ['nonexistent-skill', 'nonexistent.js']);
  assert.notEqual(r.status, 0, 'should exit non-zero for missing skill');
});

test('run-skill.sh exits non-zero for an unknown extension with no such file', () => {
  const r = run(scriptPath, ['nonexistent-skill', 'unknown-file.py']);
  assert.notEqual(r.status, 0, 'should exit non-zero for unknown extension with missing file');
});

test('run-skill.sh exports PLUGIN_ROOT (source-level check)', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /^export PLUGIN_ROOT$/m,
    'PLUGIN_ROOT must be exported; the runtime checks above are the primary evidence');
});

test('the wrapper establishes privileged mode and fails closed without it', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.ok(src.startsWith('#!/bin/bash -p'), 'shebang must carry -p');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/\$\(\/usr\/bin\/env\)/.test(code),
    'the trust decision must not READ the environment — that read was shadowable');
  assert.match(code, /^case "\$\{SD0X_PRIV_REEXEC:-\}" in$/m,
    'the branch must be a `case` — a reserved word an imported function cannot answer');
  assert.ok(!/^\s*if \[ /m.test(code.split('unset SD0X_PRIV_REEXEC')[0]),
    'no `[` may decide anything in the trust block; `[` is a shadowable command');
  assert.match(code, /exec \/usr\/bin\/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV/,
    're-exec must strip all three vectors, present or not');
  assert.match(code, /\$\{BASH_ENV\+x\}/,
    'the second pass must test BASH_ENV by parameter expansion');
  // Pinned on the residual's two CONDITIONS, not on a prose opener: the wording moved when the
  // shared rationale was de-duplicated into the tech spec, and a sentence-shaped pin fails on
  // rewording while saying nothing about whether the residual is still disclosed.
  assert.match(src, /residual[\s\S]{0,120}marker pre-set AND privileged mode already on/i,
    'the preamble must state the residual it cannot close (pre-set marker + privileged mode)');
  assert.match(src, /\/bin\/bash -p -- /, 're-exec must name the interpreter absolutely');
  assert.match(src, /SD0X_PRIV_GUARD:\?/,
    'and abort via parameter expansion if the re-exec did not take');
});

// The assertion above only proves the preamble SAYS something. What follows
// proves the claim: that the residual it names is the reachable one, and that a
// shadowed `[` — the construct this block used to branch on — no longer suppresses
// the re-exec. A comment is not evidence; these two are.

// The observable is PLUGIN_ROOT, not `type -t` inside the fixture: the fixture is
// exec'd as a fresh `/bin/bash -p`, which never inherits functions, so it cannot
// report on the WRAPPER's shell. What a surviving function actually buys an
// attacker here is control of root resolution — `dirname` decides which tree's
// skill script gets dispatched — so that is what these tests measure.
const EVIL_NONCE = 'run-skill-EVIL-TREE-4b19af';

/**
 * A complete plugin tree the hostile `dirname` points at, so capture is proved by the
 * evil tree's own nonce appearing on stdout rather than merely by the real one's absence.
 * Any unrelated failure satisfies "absence"; only actual capture satisfies this.
 */
function makeEvilTree(t) {
  const evil = realpathSync(mkdtempSync(join(tmpdir(), 'run-skill-evil-')));
  t.after(() => rmSync(evil, { recursive: true, force: true }));
  mkdirSync(join(evil, 'scripts'), { recursive: true });
  mkdirSync(join(evil, 'skills/fixture/scripts'), { recursive: true });
  writeFileSync(join(evil, 'skills/fixture/scripts/echo.sh'),
    `#!/bin/bash\nprintf '%s\\n' '${EVIL_NONCE}'\nexit 0\n`);
  chmodSync(join(evil, 'skills/fixture/scripts/echo.sh'), 0o755);
  return evil;
}

// `set -o privileged` is part of the fixture, not decoration: the second-pass `case "$-"`
// was ALREADY a reserved word before this change, so a shadowed `[` alone still gets
// caught there. Reproducing the bypass needs the startup file to turn `-p` on itself —
// measured, and the reason the pre-fix shape is exploitable rather than merely weaker.
const hostileResolution = (evil) => [
  'function [ () { return 1; }',
  `function dirname(){ printf %s\\\\n ${JSON.stringify(`${evil}/scripts`)}; }`,
  'set -o privileged',
  'unset BASH_ENV',
  '',
].join('\n');

test('an imported `[` function cannot suppress the wrapper re-exec', (t) => {
  const root = makeTree(t);
  const evil = makeEvilTree(t);
  const startup = join(root, 'startup.sh');
  writeFileSync(startup, hostileResolution(evil));

  // Started as PLAIN bash — the case the re-exec exists for.
  const r = spawnSync('/bin/bash', [join(root, 'scripts/run-skill.sh'), 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot,
    env: { ...process.env, BASH_ENV: startup },
  });
  assert.equal(r.status, 0, `the wrapper must still dispatch (stderr: ${r.stderr})`);
  assert.match(r.stdout, new RegExp(`^${NONCE}\\|${root}\\|`, 'm'),
    'the re-exec must have stripped the imported functions before root resolution');
  assert.ok(!r.stdout.includes(EVIL_NONCE), 'the planted tree must never be dispatched');
});

test('negative control: branching on `[` lets that startup file win', (t) => {
  // Without this the test above could be passing for an unrelated reason. Restore
  // the pre-fix shape — `if [ -z ... ]` for the marker AND `if [ -n ... ]` for the
  // BASH_ENV second pass, both answerable by the imported `[` — and resolution is
  // captured by the hostile `dirname`.
  const root = makeTree(t);
  const evil = makeEvilTree(t);
  const wrapper = join(root, 'scripts/run-skill.sh');
  const src = readFileSync(wrapper, 'utf8');
  let mutated = src.replace(
    'case "${SD0X_PRIV_REEXEC:-}" in\n  \'\')\n',
    'if [ -z "${SD0X_PRIV_REEXEC:-}" ]; then\n'
  );
  mutated = mutated.replace('    ;;\nesac\n# Second pass.', 'fi\n# Second pass.');
  mutated = mutated.replace(
    'case "${BASH_ENV+x}" in\n  x)',
    'if [ -n "${BASH_ENV+x}" ]; then\n  :'
  );
  mutated = mutated.replace(
    'cannot establish bash privileged mode}" ;;\nesac\n# The marker has done its job.',
    'cannot establish bash privileged mode}"\nfi\n# The marker has done its job.'
  );
  assert.notEqual(mutated, src, 'the mutation must actually apply');
  assert.ok(!mutated.includes('case "${SD0X_PRIV_REEXEC:-}" in'),
    'the marker branch must really have become an `if [`');
  writeFileSync(wrapper, mutated);
  // A mutant that merely fails to parse would satisfy the assertion below for the
  // wrong reason — the control has to be a WORKING wrapper with the old branch.
  const parses = spawnSync('/bin/bash', ['-n', wrapper], { encoding: 'utf8' });
  assert.equal(parses.status, 0, `the mutant must still parse: ${parses.stderr}`);
  const sane = spawnSync('/bin/bash', ['-p', wrapper, 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot, env: { ...process.env },
  });
  assert.match(sane.stdout, new RegExp(`^${NONCE}\\|${root}\\|`, 'm'),
    'and must dispatch correctly when no hostile startup file is present');

  const startup = join(root, 'startup.sh');
  writeFileSync(startup, hostileResolution(evil));
  const r = spawnSync('/bin/bash', [wrapper, 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot,
    env: { ...process.env, BASH_ENV: startup },
  });
  // POSITIVE proof of capture. Asserting only that the real nonce is absent would be
  // satisfied by any unrelated failure of the mutant — the planted tree's own nonce is
  // what shows the hostile `dirname` actually decided resolution.
  assert.match(r.stdout, new RegExp(`^${EVIL_NONCE}$`, 'm'),
    'with `[` deciding the branch the hostile dirname wins — that is the defect being fixed');
  assert.doesNotMatch(r.stdout, new RegExp(`^${NONCE}\\|${root}\\|`, 'm'),
    'and the genuine tree is not dispatched');
});

test('documented residual: a pre-set marker plus SHELLOPTS=privileged skips the re-exec', (t) => {
  // Asserted as the KNOWN limit, in the form the preamble names. No re-exec happens,
  // so the function a plain (non -p) bash imported is still in place for resolution —
  // measured: `SHELLOPTS=privileged` in the environment does NOT stop bash from
  // importing exported functions, which is why the marker alone is not enough and this
  // residual needs both halves.
  //
  // The proof has to be POSITIVE. Asserting only that the genuine nonce is absent would
  // also hold if a future change made the script REJECT every pre-set marker — i.e. if
  // the residual were closed fail-closed — and the test would keep passing while its
  // own comment went stale. The planted tree's nonce is what shows the hostile
  // `dirname` actually decided resolution. Close the residual and this test fails.
  const root = makeTree(t);
  const evil = makeEvilTree(t);
  const r = spawnSync('/bin/bash', [join(root, 'scripts/run-skill.sh'), 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot,
    env: {
      ...process.env,
      SD0X_PRIV_REEXEC: '1',
      SHELLOPTS: 'privileged',
      'BASH_FUNC_dirname%%': `() { printf '%s\\n' ${JSON.stringify(`${evil}/scripts`)}; }`,
    },
  });
  assert.match(r.stdout, new RegExp(`^${EVIL_NONCE}$`, 'm'),
    'if resolution is now correct the residual is closed — update the preamble and this test');
  assert.doesNotMatch(r.stdout, new RegExp(`^${NONCE}\\|${root}\\|`, 'm'),
    'and the genuine tree is not the one that ran');
});

/**
 * Build a tree whose fixture skill script invokes commit-msg-guard.sh as an ordinary
 * `bash <script>` — a REAL ancestor→descendant chain, which is the only arrangement in
 * which the `unset` is observable. The wrapper re-execs (exporting the marker), dispatches
 * the fixture, and the fixture starts the guard without `-p`. If the marker is still
 * exported the guard skips its own re-exec, finds no `p`, and aborts.
 */
function makeNestedTree(t) {
  const root = makeTree(t);
  const guard = resolve(repoRoot, 'scripts/commit-msg-guard.sh');
  const msg = join(root, 'msg.txt');
  writeFileSync(msg, 'feat: ordinary work\n');
  writeFileSync(
    join(root, 'skills/fixture/scripts/echo.sh'),
    `#!/bin/bash\nbash ${JSON.stringify(guard)} ${JSON.stringify(msg)}\n`
    + `printf '%s|%s\\n' '${NONCE}' "$?"\nexit 0\n`
  );
  chmodSync(join(root, 'skills/fixture/scripts/echo.sh'), 0o755);
  return root;
}

test('the marker is not left exported for a nested plain-bash invocation', (t) => {
  const root = makeNestedTree(t);
  const r = spawnSync('/bin/bash', [join(root, 'scripts/run-skill.sh'), 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot, env: { ...process.env },
  });
  assert.equal(r.status, 0, `the wrapper must dispatch (stderr: ${r.stderr})`);
  assert.match(r.stdout, new RegExp(`^${NONCE}\\|0$`, 'm'),
    'the nested guard must run normally, not abort on an inherited marker');
});

test('negative control: leaving the marker exported breaks that nested call', (t) => {
  // Delete the `unset` from the dispatched wrapper and the same chain fails. Without
  // this, the test above passes even with every `unset SD0X_PRIV_REEXEC` removed — which
  // is exactly how its predecessor was passing.
  const root = makeNestedTree(t);
  const wrapper = join(root, 'scripts/run-skill.sh');
  const src = readFileSync(wrapper, 'utf8');
  const mutated = src.replace(/^unset SD0X_PRIV_REEXEC$/m, '# unset removed by the control');
  assert.notEqual(mutated, src, 'the mutation must actually apply');
  writeFileSync(wrapper, mutated);
  const parses = spawnSync('/bin/bash', ['-n', wrapper], { encoding: 'utf8' });
  assert.equal(parses.status, 0, `the mutant must still parse: ${parses.stderr}`);

  const r = spawnSync('/bin/bash', [wrapper, 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot, env: { ...process.env },
  });
  assert.match(r.stdout, new RegExp(`^${NONCE}\\|`, 'm'),
    'the fixture must still run — only the nested guard should be affected');
  assert.doesNotMatch(r.stdout, new RegExp(`^${NONCE}\\|0$`, 'm'),
    'with the marker still exported the nested guard aborts — the defect being fixed');
  assert.match(r.stderr, /cannot establish bash privileged mode/,
    'and it aborts for the documented reason, not some unrelated failure');
});

test('an exported bash function cannot answer the dispatch in place of the target', (t) => {
  const root = makeTree(t);
  const wrapper = join(root, 'scripts/run-skill.sh');
  // Invoked the documented way — /bin/bash -p — the hostile function is not even
  // imported. This is the control for the entrypoint spelling.
  const r = spawnSync('/bin/bash', ['-c', `/bin/bash -p '${wrapper}' fixture echo.sh`], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, 'BASH_FUNC_bash%%': '() { return 0; }' },
  });

  assert.equal(r.status, 0, `expected the real target to run, got ${r.status}`);
  assert.ok((r.stdout || '').includes(NONCE),
    'the documented /bin/bash -p entrypoint must survive a hostile exported `bash` function');
});

// ============================================================================
// The PATH pin covers RESOLUTION only
//
// `readlink`/`dirname` decide which policy script is launched, so they must not
// be the caller's choice. But leaving the prepend in place through dispatch
// would pick /usr/bin/node over a deliberately selected nvm/asdf/homebrew one
// and silently change the runtime a `.js` skill script runs under — a
// legitimate developer setup broken by a control aimed at something else.
// CALLER_PATH is restored before dispatch for exactly that reason.
// ============================================================================

test('a caller-selected node on PATH is the one that runs a .js skill script', (t) => {
  const root = makeTree(t);
  writeFileSync(
    join(root, 'skills/fixture/scripts/echo.js'),
    `console.log('${NONCE}|js');\n`
  );
  // Stand-in for an nvm/asdf shim: first `node` on the caller's PATH, and it
  // announces itself so "which node ran" is observable rather than inferred.
  const shimDir = join(root, 'shim');
  mkdirSync(shimDir);
  writeFileSync(
    join(shimDir, 'node'),
    `#!/bin/sh\nprintf '%s|selected-node\\n' '${NONCE}'\nexit 0\n`
  );
  chmodSync(join(shimDir, 'node'), 0o755);

  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.js'], {
    env: { PATH: `${shimDir}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${NONCE}|selected-node\n`,
    'the pinned resolution PATH must not survive into dispatch and override the caller\'s node');
});

test('the resolution phase still uses the pinned PATH, not the caller\'s', (t) => {
  const root = makeTree(t);
  // A hostile `readlink`/`dirname` first on PATH must not get to decide which
  // target is dispatched. If the pin were dropped wholesale to fix the node
  // case above, this is what would break.
  const shimDir = join(root, 'shim');
  mkdirSync(shimDir);
  for (const util of ['readlink', 'dirname', 'cd', 'pwd']) {
    writeFileSync(join(shimDir, util), '#!/bin/sh\nprintf %s /nonexistent-attacker-tree\nexit 0\n');
    chmodSync(join(shimDir, util), 0o755);
  }
  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'echo.sh'], {
    env: { PATH: `${shimDir}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${NONCE}|${root}|\n`,
    'resolution must ignore caller-supplied utilities and still find the real tree');
});

test('source-level: CALLER_PATH is captured before the pin and restored before dispatch', () => {
  const source = readFileSync(scriptPath, 'utf8');
  const capture = source.indexOf('CALLER_PATH="$PATH"');
  const pin = source.indexOf('PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"');
  const restore = source.indexOf('PATH="$CALLER_PATH"');
  const dispatch = source.indexOf('case "$SCRIPT_NAME" in');
  assert.ok(capture >= 0 && pin >= 0 && restore >= 0 && dispatch >= 0,
    'all four landmarks must exist');
  assert.ok(capture < pin, 'the caller PATH must be captured before it is overwritten');
  assert.ok(pin < restore, 'the pin must cover the resolution phase');
  assert.ok(restore < dispatch, 'the caller PATH must be back before dispatch');
});

test('POSIXLY_CORRECT is removed from what the target inherits', (t) => {
  const root = makeTree(t);
  writeFileSync(
    join(root, 'skills/fixture/scripts/posix.sh'),
    `#!/bin/bash\nprintf '%s|%s\\n' '${NONCE}' "\${POSIXLY_CORRECT:-unset}"\nexit 0\n`
  );
  chmodSync(join(root, 'skills/fixture/scripts/posix.sh'), 0o755);
  const r = run(join(root, 'scripts/run-skill.sh'), ['fixture', 'posix.sh'], {
    env: { POSIXLY_CORRECT: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${NONCE}|unset\n`,
    'POSIX mode is parse-time, so a target cannot undo it itself — the wrapper must');
});

// ============================================================================
// Forged privileged mode, and CDPATH
// ============================================================================

test('a forged privileged mode does not let a hostile function answer the dispatch', (t) => {
  const root = makeTree(t);
  // SHELLOPTS=privileged puts `p` in $- while STILL importing functions, so the
  // old `$-`-only check let a hostile `exec` return success without launching
  // anything. The wrapper must notice and refuse.
  const r = spawnSync('/bin/bash', [join(root, 'scripts/run-skill.sh'), 'fixture', 'echo.sh'], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: {
      ...process.env,
      SHELLOPTS: 'privileged',
      'BASH_FUNC_exec%%': '() { builtin set -o privileged; return 0; }',
    },
  });
  assert.notEqual(r.status, 0, 'a shadowed exec under forged privileged mode must fail closed');
  assert.ok(!(r.stdout || '').includes(NONCE), 'and must not report success for a target never run');
});

test('a forged privileged mode without a hostile function still dispatches correctly', (t) => {
  // Exporting SHELLOPTS is something developers do. The control is a re-exec,
  // not a denial.
  const root = makeTree(t);
  const r = spawnSync('/bin/bash', [join(root, 'scripts/run-skill.sh'), 'fixture', 'echo.sh'], {
    encoding: 'utf8', cwd: repoRoot,
    env: { ...process.env, SHELLOPTS: 'privileged' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${NONCE}|${root}|\n`);
});

test('an inherited CDPATH cannot redirect wrapper resolution', (t) => {
  const root = makeTree(t);
  // `cd` is a BUILTIN, so pinning PATH does nothing for it. CDPATH applies to
  // RELATIVE operands, which is what `dirname` yields for the documented
  // relative invocation — so an entry containing a directory named `scripts`
  // sends `cd -P "$(dirname …)"` elsewhere and contaminates the substitution
  // with the path cd prints. Measured before the fix, with exactly this shape:
  // exit 1, "No such file or directory".
  const decoy = join(root, 'decoy');
  mkdirSync(join(decoy, 'scripts'), { recursive: true });
  const r = run('scripts/run-skill.sh', ['fixture', 'echo.sh'], {
    cwd: root, env: { CDPATH: decoy },
  });
  assert.equal(r.status, 0, `CDPATH must not break resolution (stderr: ${r.stderr})`);
  assert.equal(r.stdout, `${NONCE}|${root}|\n`, 'and must not redirect it either');
});

/**
 * Does privileged mode on THIS bash still honour an inherited CDPATH? Measured
 * rather than derived from a version, because the answer changed and the version
 * boundary is not what one would guess: bash NEWS records CDPATH joining the
 * variables privileged mode ignores in 4.0, and the two builds available here
 * bracket it — 3.2 honours CDPATH under `-p`, 5.3 ignores it (both measured; 4.x
 * is not installed, which is precisely why this probes behaviour instead).
 *
 * The wrapper always re-execs itself under `/bin/bash -p`, so where the
 * interpreter ignores CDPATH it has already neutralized it FOR `cd` before the
 * wrapper's own `CDPATH=''` line is reached — removing that line is then not
 * observable *through resolution* there. It stays observable another way, which
 * an earlier version of this comment wrongly denied: privileged mode keeps the
 * variable and its export attribute, so the value the dispatched target inherits
 * still witnesses the assignment. See `the CDPATH clear executes` below.
 *
 * `/bin/bash` and not `bash`: the re-exec at run-skill.sh:36 names that path, so
 * this probe must ask the same interpreter the wrapper will actually run under.
 */
function privilegedBashHonoursCdpath(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cdpath-probe-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'decoy/scripts'), { recursive: true });
  const r = spawnSync('/bin/bash', ['-p', '-c', 'cd -P scripts >/dev/null 2>&1 && pwd'], {
    encoding: 'utf8', cwd: dir, env: { ...process.env, CDPATH: join(dir, 'decoy') },
  });
  return r.stdout.trim() === join(dir, 'decoy/scripts');
}

test('negative control: the CDPATH clear is what holds, wherever CDPATH can still reach', (t) => {
  const root = makeTree(t);
  const wrapper = join(root, 'scripts/run-skill.sh');
  const src = readFileSync(wrapper, 'utf8');
  const mutated = src.replace(/^CDPATH=''$/m, 'CDPATH="${CDPATH:-}"');
  assert.notEqual(mutated, src, 'the CDPATH mutation must actually apply');
  writeFileSync(wrapper, mutated);
  const decoy = join(root, 'decoy');
  mkdirSync(join(decoy, 'scripts'), { recursive: true });
  const r = run('scripts/run-skill.sh', ['fixture', 'echo.sh'], {
    cwd: root, env: { CDPATH: decoy },
  });

  if (privilegedBashHonoursCdpath(t)) {
    assert.notEqual(r.stdout, `${NONCE}|${root}|\n`,
      'if this still resolves correctly, the CDPATH test above proves nothing');
    return;
  }
  // The other regime, asserted rather than skipped: a skip would leave the sibling
  // test passing for an unstated reason. Privileged mode was just MEASURED to drop
  // CDPATH, so the mutant must resolve correctly here — and if a future bash
  // reverts that, the probe flips and the branch above applies again.
  assert.equal(r.stdout, `${NONCE}|${root}|\n`,
    'privileged mode was measured to drop CDPATH, so even the mutant must resolve');
});

/**
 * The clear is an ASSIGNMENT, and its effect outlives the `cd` it was written for.
 * Privileged mode on bash >= 4.0 declines to USE CDPATH for `cd`, but it keeps the
 * variable and its export attribute — so what the dispatched target inherits is a
 * witness that the line executed, and a portable one. Measured on 5.3 under `-p`:
 * `declare -x CDPATH="<decoy>"` before the assignment, `declare -x CDPATH=""`
 * after, and a child process sees `CDPATH=<decoy>` versus `CDPATH=`.
 *
 * That is what makes this the code-vs-data oracle a source-text landmark can never
 * be: wrap the exact bytes in a string and this test fails on EVERY platform,
 * Linux CI included. The resolution oracle in `an inherited CDPATH cannot redirect
 * wrapper resolution` above fails only where CDPATH still steers `cd` — bash 3.2.
 * Two different oracles over the same line, neither one a duplicate of the other.
 */
test('the CDPATH clear executes: the dispatched target inherits an emptied CDPATH', (t) => {
  const root = makeTree(t);
  // A decoy with NO `scripts` entry, deliberately. The CDPATH lookup then misses
  // and `cd -P scripts` falls back to the real relative directory on BOTH bash
  // generations, so dispatch happens either way and the only thing left varying
  // is the value the target inherits. Create `decoy/scripts` instead and bash 3.2
  // fails at resolution: the mutant half would pass for that reason, silently
  // becoming a second copy of the resolution oracle rather than an execution one.
  const decoy = join(root, 'decoy');
  mkdirSync(decoy, { recursive: true });
  const probe = join(root, 'skills/fixture/scripts/cdpath.sh');
  writeFileSync(probe, `#!/bin/bash\nprintf '%s|%s\\n' '${NONCE}' "\${CDPATH-UNSET}"\nexit 0\n`);
  chmodSync(probe, 0o755);

  const production = run('scripts/run-skill.sh', ['fixture', 'cdpath.sh'], {
    cwd: root, env: { CDPATH: decoy },
  });
  assert.equal(production.status, 0, `wrapper exited ${production.status}: ${production.stderr}`);
  assert.equal(production.stdout, `${NONCE}|\n`,
    'the target must inherit CDPATH set-but-empty — `UNSET` would mean the wrapper never assigned '
    + 'it, and the decoy value would mean the assignment did not execute');

  // Negative control: the exact bytes survive as DATA inside a multiline string,
  // so every source-text landmark still finds them while nothing executes.
  const wrapper = join(root, 'scripts/run-skill.sh');
  const src = readFileSync(wrapper, 'utf8');
  const asData = src.replace(/^CDPATH=''$/m, 'CDPATH_DOC="\nCDPATH=\'\'\n"');
  assert.notEqual(asData, src, 'the quoted-data mutation must actually apply');
  assert.match(asData, /^CDPATH=''$/m, 'and must leave the exact line present, as data');
  writeFileSync(wrapper, asData);

  const mutant = run('scripts/run-skill.sh', ['fixture', 'cdpath.sh'], {
    cwd: root, env: { CDPATH: decoy },
  });
  assert.equal(mutant.status, 0,
    'the mutant must still reach dispatch, or this control is re-testing resolution rather than '
    + `execution (exit ${mutant.status}: ${mutant.stderr})`);
  assert.equal(mutant.stdout, `${NONCE}|${decoy}\n`,
    'with the assignment turned into data, the target must inherit the caller CDPATH unchanged');
});

/**
 * `CDPATH=''` protects the resolution `cd`s BELOW it, so where it sits is part of
 * the control and not merely that it exists. The sibling mutation above pins the
 * line's text; nothing pins its position, and `/^CDPATH=''$/m` still matches a
 * copy MOVED under a resolution `cd`.
 *
 * Why source order rather than behaviour: on a bash whose privileged mode drops
 * CDPATH — measured for 5.3 by `privilegedBashHonoursCdpath` above, and the only
 * kind `ubuntu-latest` runs (.github/workflows/ci.yml) — the re-exec neutralizes
 * CDPATH before the wrapper's own line is reached, so no behavioural probe
 * through this entrypoint observes the ordering at all. The regression this
 * guards is macOS `/bin/bash` 3.2, which honours CDPATH under `-p`.
 *
 * WHAT IT ESTABLISHES, stated at the strength it actually has: the three named
 * resolution statements' literal lines occur AFTER a literal `CDPATH=''` line,
 * and a fourth `cd -P` line cannot appear without this pin failing. It does not
 * establish that bash EXECUTES that line as an assignment — wrap the exact bytes
 * in a multiline string (`CDPATH_DOC="\nCDPATH=''\n"`) and every assertion here
 * still passes. Nor does it establish "no directory-changing command runs before
 * the clear": deciding either from source needs quote, heredoc and function-body
 * state, and a line-local regex gets it wrong in both directions — `\cd` and
 * `pushd` slip past one (both measured to follow CDPATH on bash 3.2), while
 * `printf '%s\n' "please cd later"` trips it. An earlier version used exactly
 * such a regex FOR BOTH the assertion and its own mutant, so a mis-located
 * landmark produced a mutant built against that same wrong landmark and the pair
 * passed together. Hence literal production text below: the control is derived
 * from the statement, never from a matcher.
 *
 * Code-vs-data is decided BEHAVIOURALLY, and portably, by `the CDPATH clear
 * executes` above: it reads the value the dispatched target inherits, which
 * privileged mode preserves on every version, so the data-mutant fails on Linux
 * CI too. On bash 3.2 the resolution oracle in `an inherited CDPATH cannot
 * redirect wrapper resolution` catches that same mutant a second way. This pin is
 * therefore not the code-vs-data control and does not need to be — it covers the
 * realistic accident (relocation, deletion, rewording) cheaply and everywhere,
 * while execution is covered by tests that actually run the wrapper.
 */
const CDPATH_CLEAR = "CDPATH=''";

const RESOLUTION_CDS = [
  '  SELF_DIR=$(cd -P "$(dirname "$SELF")" && pwd) || exit 1',
  'SCRIPT_DIR=$(cd -P "$(dirname "$SELF")" && pwd) || exit 1',
  'PLUGIN_ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd) || exit 1',
];

/** Every `cd -P` line, the explanatory comment included, so a fourth cannot land unnoticed. */
const CD_P_LINES = [
  '# whose entries contain a directory named `scripts` sends `cd -P "$(dirname …)"`',
  ...RESOLUTION_CDS,
];

/** Named resolution statements sitting at or above the clear — empty when the order holds. */
const resolutionCdsAboveClear = (lines) => {
  const clear = lines.indexOf(CDPATH_CLEAR);
  return clear === -1 ? RESOLUTION_CDS : RESOLUTION_CDS.filter((s) => lines.indexOf(s) < clear);
};

test('the CDPATH clear line sits above every named resolution cd, and a relocation is visible', () => {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');

  assert.deepEqual(lines.filter((l) => l.includes('cd -P')), CD_P_LINES,
    'the set of `cd -P` lines in the wrapper changed — one was added, removed or reworded. '
    + 'Update RESOLUTION_CDS/CD_P_LINES so this guard still covers all of them');
  assert.notEqual(lines.indexOf(CDPATH_CLEAR), -1, `the wrapper has no \`${CDPATH_CLEAR}\` line`);
  assert.deepEqual(resolutionCdsAboveClear(lines), [],
    "these resolution statements sit above the `CDPATH=''` line — on a bash honouring CDPATH under "
    + "`-p` (macOS /bin/bash 3.2) each then follows the caller's CDPATH, not the wrapper's own tree");

  // Negative control: MOVE the clear below the first resolution statement. The
  // insertion point is that statement's literal text, so this control does not
  // inherit any locator the assertion above depends on.
  const reduced = lines.filter((l) => l !== CDPATH_CLEAR);
  const at = reduced.indexOf(RESOLUTION_CDS[0]);
  const moved = [...reduced.slice(0, at + 1), CDPATH_CLEAR, ...reduced.slice(at + 1)];

  assert.equal(moved.filter((l) => l === CDPATH_CLEAR).length, 1,
    'the mutant must MOVE the clear, not drop or duplicate it');
  assert.deepEqual(resolutionCdsAboveClear(moved), [RESOLUTION_CDS[0]],
    'relocating the clear below the first resolution cd must be visible to this predicate');
});

// ============================================================================
// Round 41 — no environment scan, so its false-positive class cannot recur.
// A value may legitimately contain newlines, which is why line-anchoring was not
// enough; see the guard's tests for the full trust-boundary set.
// ============================================================================

for (const [label, env] of [
  ['single-line BASH_ENV mention', { NOTE: 'documentation says BASH_ENV=ignored' }],
  ['multiline BASH_ENV line', { NOTE: 'ordinary CI metadata\nBASH_ENV=whatever' }],
  ['multiline SHELLOPTS line', { NOTE: 'release notes\nSHELLOPTS=privileged' }],
]) {
  test(`a ${label} reaches the wrapper's own validation`, () => {
    // `../evil` is rejected by the input validation far below the trust block, so
    // seeing THAT message proves the block let the run continue.
    const r = run(scriptPath, ['../evil', 'x.sh'], { env });
    assert.match(r.stderr, /path traversal not allowed/,
      `must not abort in the trust block (stderr: ${r.stderr})`);
  });
}
