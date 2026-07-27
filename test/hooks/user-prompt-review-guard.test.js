const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, symlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');

const {
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
  writePendingState,
} = require('./helpers/reconciliation-locale');

const hookPath = resolve(__dirname, '../../hooks/user-prompt-review-guard.sh');

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true }); } catch {}
  }
});

function createWorkDir(stateJson, cooldownAge) {
  const dir = mkdtempSync(join(tmpdir(), 'ups-test-'));
  tempDirs.push(dir);

  // Init git repo (required for git status)
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir });

  // Create tracked files so modifications show in `git status -uno`
  writeFileSync(join(dir, 'app.js'), '// placeholder');
  writeFileSync(join(dir, 'README.md'), '# placeholder');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'add tracked files'], { cwd: dir });

  if (stateJson !== null) {
    writeFileSync(join(dir, '.claude_review_state.json'), JSON.stringify(stateJson));
  }

  // Create cooldown file if specified (seconds ago)
  const cooldownFile = join(dir, '.cooldown_test');
  if (cooldownAge !== undefined) {
    const timestamp = Math.floor(Date.now() / 1000) - cooldownAge;
    writeFileSync(cooldownFile, String(timestamp));
  }

  return { dir, cooldownFile };
}

// Reconciliation runs the -uall walk only under a timeout helper (no helper → fail-closed
// skip). This shim provides a passthrough `timeout` so reconciliation tests deterministically
// take the bounded branch regardless of whether the host ships a real `timeout`/`gtimeout`.
function makeTimeoutShimDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ups-timeout-shim-'));
  tempDirs.push(dir);
  const shim = join(dir, 'timeout');
  writeFileSync(shim, '#!/bin/sh\nshift; exec "$@"\n');
  chmodSync(shim, 0o755);
  return dir;
}

function runHook(cwd, env) {
  return spawnSync('bash', [hookPath], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      TMPDIR: tmpdir(),
      ...env,
    },
  });
}

test('pending code review → output contains [AUTO_LOOP_STATE] and /codex-review-fast', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[AUTO_LOOP_STATE]'), 'should contain [AUTO_LOOP_STATE]');
  assert.ok(result.stdout.includes('/codex-review-fast'), 'should suggest /codex-review-fast');
  // Delivery is not enough — the fields have to survive the trip. A marker with `phase= round=/`
  // behind it reads as a signal and carries nothing, which is what an empty jq read produces.
  const line = result.stdout.split('\n').find((l) => l.startsWith('[AUTO_LOOP_STATE]'));
  assert.match(line, /\bphase=\S+/, `phase rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\bround=\d+\/\d+\b/, `round/cap rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\btier=(fast|standard|thorough)\b/, `tier rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\bpending=\S+/, `pending rendered empty: ${JSON.stringify(line)}`);
});

// Aggregate routing was previously tested only through post-skill-auto-loop, leaving two of the
// three hooks that carry the derivation unexercised.
for (const [label, mode] of [['dual', 'dual'], ['an unrecognized mode (fail-closed to dual)', 'duel']]) {
  test(`${label} routes to the aggregate gate, not /codex-review-fast`, () => {
    const { dir, cooldownFile } = createWorkDir({
      has_code_change: true,
      review_mode: mode,
      // Passing on the INDIVIDUAL plane: the state in which reading the code receipt alone looks
      // conclusive and is not.
      code_review: { passed: true },
      precommit: { passed: false },
    });
    writeFileSync(join(dir, 'app.js'), 'console.log("dirty")');

    const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
    assert.equal(result.status, 0);
    const line = result.stdout.split('\n').find((l) => l.startsWith('[AUTO_LOOP_STATE]'));
    assert.ok(line, `no fact block emitted; got: ${JSON.stringify(result.stdout)}`);
    assert.match(line, /pending=aggregate_gate\b/);
    assert.match(line, /suggested=\/codex-review-branch --dual/);
  });
}

test('a zero-byte state file resolves review_mode to single, as stop-guard does', () => {
  // This harness uses REAL jq, which is what the case needs: on a zero-byte file jq exits 0 with no
  // output, so neither the filter default nor the `|| echo` fires and the value arrives empty.
  // Empty must not read as an unrecognized mode — stop-guard replaces a corrupt snapshot with `{}`
  // and reads `single`, and two hooks disagreeing about one state is the divergence R1 closed.
  const { dir, cooldownFile } = createWorkDir({ has_code_change: true, code_review: { passed: false } });
  writeFileSync(join(dir, '.claude_review_state.json'), '');
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")');

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /suggested=\/codex-review-branch --dual/,
    'an unreadable state file must not route to the most expensive gate on its own');
});

test('a clean session that inherited dual mode is not sent to the aggregate gate', () => {
  // SessionStart preserves `review_mode` while resetting the change flags, so the obligation has to
  // be gated on an actual code change or every fresh session inherits the most expensive gate.
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: false,
    review_mode: 'dual',
    code_review: { passed: false },
    precommit: { passed: false },
  });

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /aggregate_gate/,
    'no code change means nothing to aggregate');
});

test('pending precommit → output contains /precommit', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('/precommit'), 'should suggest /precommit');
});

test('pending doc review → output contains /codex-review-doc', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_doc_change: true,
    doc_review: { passed: false },
    has_code_change: false,
  });
  writeFileSync(join(dir, 'README.md'), '# modified'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('/codex-review-doc'), 'should suggest /codex-review-doc');
});

test('all gates pass → silent (no stdout)', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true },
  });

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should be silent when all gates pass');
});

test('no state file → silent', () => {
  const { dir, cooldownFile } = createWorkDir(null);

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should be silent without state file');
});

test('no changes tracked → silent', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: false,
    has_doc_change: false,
  });

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should be silent when no changes tracked');
});

test('cooldown active (recent injection) → silent', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  }, 60); // injected 60 seconds ago
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '300', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should be silent during cooldown');
});

test('cooldown expired → inject', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  }, 400); // injected 400 seconds ago (> 300s cooldown)
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '300', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[AUTO_LOOP_STATE]'), 'should inject after cooldown expires');
});

test('stale state: git clean but state says code changed → reconcile to false → silent', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  // No dirty files — git is clean, state is stale. Provide a passthrough timeout shim so the
  // bounded reconciliation branch runs deterministically (without it, a host lacking
  // timeout/gtimeout would fail-closed and inject a reminder instead).
  const shimDir = makeTimeoutShimDir();
  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'should reconcile stale state and stay silent');
});

test('stale state: untracked new code file surfaced by -uall → inject (pins -uno→-uall)', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  // Tracked files are clean; the ONLY pending code lives in a brand-new untracked dir.
  // `-uno` hides it entirely and plain `--porcelain` collapses it to "?? src/" (no extension),
  // so the old code would downgrade has_code_change true→false and stay silent (fail-OPEN).
  // `-uall` surfaces "?? src/new-feature.ts" so the .ts boundary matches → flag kept → inject.
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'new-feature.ts'), 'export const x = 1;\n');
  const shimDir = makeTimeoutShimDir();
  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_STATE]'),
    'untracked new .ts must keep has_code_change (−uall) → inject, not silently downgrade'
  );
  assert.ok(result.stdout.includes('/codex-review-fast'), 'should suggest /codex-review-fast');
});

test('stale state: partial git stdout on timeout-kill is discarded → inject (no fail-open)', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  // A timeout shim that flushes a partial, non-code porcelain line then dies like a real
  // timeout kill (exit 124). The fixed hook keeps `|| sentinel` OUTSIDE the command
  // substitution, so the non-zero exit overwrites GIT_PORCELAIN with the exact sentinel and
  // reconciliation is skipped → flag kept → reminder injected. The old `$(timeout … || echo
  // sentinel)` form appended the sentinel to the partial line, reconciled against the partial
  // output (no code extension) and downgraded has_code_change true→false → silent (fail-OPEN).
  const shimDir = mkdtempSync(join(tmpdir(), 'ups-partial-shim-'));
  tempDirs.push(shimDir);
  const shim = join(shimDir, 'timeout');
  writeFileSync(shim, "#!/bin/sh\nprintf '%s\\n' ' M notes.txt'\nexit 124\n");
  chmodSync(shim, 0o755);
  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_STATE]'),
    'partial-output-on-kill must not downgrade the stale flag → inject'
  );
});

test('stale state: dirty shell hook (.sh) keeps has_code_change → inject', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  // Untracked .sh surfaced by -uall; before the fix .sh was not a code extension, so the
  // reconciler downgraded the stale flag and stayed silent (fail-OPEN for this .sh-primary repo).
  writeFileSync(join(dir, 'deploy.sh'), '#!/bin/sh\necho hi\n');
  const shimDir = makeTimeoutShimDir();
  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_STATE]'),
    'a dirty .sh is code → reminder injected, not silently downgraded'
  );
});

test('sidecar .blocked marker forces doc review reminder', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_doc_change: true,
    has_code_change: false,
    doc_review: { passed: true },
    code_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'README.md'), '# modified');
  writeFileSync(join(dir, '.claude_review_state.json.blocked'), 'lock_failure');
  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('/codex-review-doc'),
    'sidecar should force doc review reminder despite doc_review.passed=true'
  );
});

test('hook always exits 0 (non-blocking)', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")'); // modify tracked file

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN: '0', REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });
  assert.equal(result.status, 0, 'hook must always exit 0');
});

test('stale-state reconciliation: untracked .ipynb keeps has_code_change → inject', () => {
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
  });
  writeFileSync(join(dir, 'analysis.ipynb'), '{}');
  const shimDir = makeTimeoutShimDir();
  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('[AUTO_LOOP_STATE]'), 'notebook counts as code — must inject');
  assert.ok(result.stdout.includes('/codex-review-fast'));
});

test('reconciliation: a NON-C-locale directory-omission warning does NOT downgrade the code flag → still injects [AUTO_LOOP_STATE] (iter-20 P1, host-independent)', (t) => {
  // Locale-aware stub git + timeout shim so the stale-state reconciliation branch fires
  // deterministically on any host (no installed zh_TW needed). Ambient LC_ALL is a non-C string:
  // a hook that forgot to force LC_ALL=C would let the stub emit its localized (non-ASCII) omission
  // warning, the English-only regex would miss it, and the empty (dir-omitted) listing would
  // downgrade has_code_change→false → NEXT empty → the hook exits silently (fail-open). The fix
  // forces LC_ALL=C → English warning → regex matches → UNAVAILABLE → holds the flag → injects.
  // Non-tautology anchor: reverting either the LC_ALL=C or the omission guard empties stdout.
  const binDir = mkdtempSync(join(tmpdir(), 'ups-recon-bin-'));
  tempDirs.push(binDir);
  if (!setupLocaleAwareGitBin(binDir)) {
    // `t.skip`, not a bare `return`: a silent early return reports as a PASS, so on a host
    // where the shim cannot be built this test looked like coverage it was not providing.
    t.skip('real coreutils unresolvable on this host — cannot build the locale-aware git shim');
    return;
  }
  const workDir = mkdtempSync(join(tmpdir(), 'ups-recon-work-'));
  tempDirs.push(workDir);
  const auxDir = mkdtempSync(join(tmpdir(), 'ups-recon-aux-'));
  tempDirs.push(auxDir);
  writePendingState(workDir);
  // Cooldown disabled + its file kept OUTSIDE the repo. CLAUDE_PROJECT_DIR pinned to workDir so the
  // hook's arbitration/Think-Harder reads stay hermetic.
  const result = runHook(workDir, {
    PATH: binDir,
    CLAUDE_PROJECT_DIR: workDir,
    REVIEW_GUARD_COOLDOWN: '0',
    REVIEW_GUARD_COOLDOWN_FILE: join(auxDir, 'cooldown'),
    ...AMBIENT_NON_C_ENV,
  });
  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('[AUTO_LOOP_STATE]') && result.stdout.includes('/codex-review-fast'),
    'the hook must force LC_ALL=C so git\'s omission warning is the English form its regex matches → hold → inject, regardless of ambient locale'
  );
});

test('a poisoned cooldown file does not execute a command substitution (arithmetic injection)', () => {
  // The cooldown file lives under `${TMPDIR:-/tmp}` — world-writable on a shared host — and its
  // contents flowed straight into `ELAPSED=$((NOW - LAST_INJECT))`. Bash arithmetic expands command
  // substitution inside an array subscript, so any other user could plant a payload and have this
  // hook run it on the next prompt. Falling back to 0 is right here: the hook only decides whether
  // to inject a reminder, so an unparseable cooldown behaves like a fresh one.
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")');
  const sentinel = join(dir, 'ARITH_INJECTION_RAN');
  writeFileSync(cooldownFile, `NOW[$(touch ${sentinel})]`);

  const result = runHook(dir, { REVIEW_GUARD_COOLDOWN_FILE: cooldownFile });

  assert.equal(existsSync(sentinel), false, 'the cooldown file must never be evaluated as arithmetic');
  assert.equal(result.status, 0);
});

test('a poisoned REVIEW_GUARD_COOLDOWN env value does not execute a command substitution', () => {
  // Same arithmetic hazard on the environment-supplied side, which also reaches the `-lt` operands.
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")');
  const sentinel = join(dir, 'ARITH_INJECTION_ENV_RAN');
  writeFileSync(cooldownFile, '0');

  const result = runHook(dir, {
    REVIEW_GUARD_COOLDOWN: `NOW[$(touch ${sentinel})]`,
    REVIEW_GUARD_COOLDOWN_FILE: cooldownFile,
  });

  assert.equal(existsSync(sentinel), false, 'the env value must never be evaluated as arithmetic');
  assert.equal(result.status, 0);
});

test('the cooldown write never follows a pre-planted symlink at the staging name', () => {
  // The staging file used to be `${COOLDOWN_FILE}.$$` under a comment claiming it "rejected
  // symlinks", which nothing implemented. A PID is guessable and recycles, so a symlink planted at
  // that exact name is followed by `>` and its TARGET is truncated. `umask 077` bounds the mode of
  // a newly created file; it says nothing about whether the open traverses a link.
  //
  // The test plants links at every PID the hook could plausibly run under, so it does not depend on
  // guessing the child's PID: under the old code ONE of them is the staging name and the victim is
  // truncated. Under `mktemp` the name is random and the create is O_EXCL, so none of them is ever
  // opened — the victim is intact whichever PID the child gets.
  const { dir, cooldownFile } = createWorkDir({
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
  });
  writeFileSync(join(dir, 'app.js'), 'console.log("dirty")');
  writeFileSync(cooldownFile, '0');

  const victim = join(dir, 'PRECIOUS');
  writeFileSync(victim, 'do not truncate');

  // Deterministic, not a PID guess. `exec` REPLACES the shell's image while keeping its pid, so the
  // wrapper can plant the link at its own `$$` and then hand that exact pid to the hook. A first
  // draft planted links across a guessed pid range instead, and the mutation that restores the old
  // staging name stayed green — the child's pid simply fell outside the range, so the test proved
  // nothing about either version.
  const result = spawnSync(
    'bash',
    ['-c', 'ln -s "$1" "$2.$$" && exec bash "$3"', 'bash', victim, cooldownFile, hookPath],
    {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, TMPDIR: tmpdir(), REVIEW_GUARD_COOLDOWN_FILE: cooldownFile },
    }
  );

  assert.equal(result.status, 0);
  assert.equal(
    readFileSync(victim, 'utf8'), 'do not truncate',
    'the symlink target must be untouched — following it truncates an attacker-chosen file'
  );
  // Non-vacuity: the hook must actually have reached the cooldown write, or nothing was tested.
  assert.notEqual(readFileSync(cooldownFile, 'utf8').trim(), '0', 'the cooldown timestamp must have been updated');
});
