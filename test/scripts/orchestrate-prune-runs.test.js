'use strict';

/**
 * orchestrate-prune-runs.test.js — functional coverage for the FIFO retention rule that was
 * previously prose-only in `skills/orchestrate/SKILL.md`.
 *
 * The two properties that matter, and why:
 *   1. A run is `<run-id>.json` PLUS `<run-id>/`, counted and deleted as one unit. Pruning only
 *      the `.json` leaves the ~81 KB `plan-context.json` packets accumulating forever, which is
 *      the exact failure the rule exists to prevent.
 *   2. The script deletes recursively, so containment is the safety property: a root that is not
 *      a real `.claude_workflows` directory, and any entry whose name is not a run-id, must be
 *      refused or left alone rather than guessed at.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'skills', 'orchestrate', 'scripts', 'prune-runs.js');

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...opts });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runJson(args) {
  const r = run([...args, '--json']);
  assert.equal(r.code, 0, `expected success, got ${r.code}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/**
 * Builds a REAL git repo with a workflows dir holding `n` runs, ids ordered oldest→newest.
 *
 * A real repo is required, not incidental: the script derives its deletion root from
 * `git rev-parse --show-toplevel` precisely so no argument can name the target. A plain temp
 * directory is correctly refused.
 */
function makeRoot(n, { dirOnly = [], jsonOnly = [] } = {}) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prune-runs-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q'], { encoding: 'utf8' });
  const root = path.join(repo, '.claude_workflows');
  fs.mkdirSync(root);
  const ids = [];
  for (let i = 0; i < n; i++) {
    // Zero-padded minute keeps lexical order == chronological order.
    const id = `20260101-00${String(i).padStart(4, '0')}-intent-${i}`;
    ids.push(id);
    if (!dirOnly.includes(i)) fs.writeFileSync(path.join(root, `${id}.json`), '{"status":"done"}');
    if (!jsonOnly.includes(i)) {
      fs.mkdirSync(path.join(root, id));
      fs.writeFileSync(path.join(root, id, 'plan-context.json'), 'x'.repeat(1024));
    }
  }
  return { base, repo, root, ids };
}

test('keeps the N most recent runs and prunes the rest', () => {
  const { repo, root, ids } = makeRoot(13);
  const out = runJson(['--repo', repo, '--keep', '10']);

  assert.equal(out.total, 13);
  assert.deepEqual(out.pruned, ids.slice(0, 3), 'the three oldest run-ids must be the ones pruned');
  assert.deepEqual(out.kept, ids.slice(3));
  assert.equal(fs.readdirSync(root).length, 20, '10 surviving runs = 10 .json + 10 directories');
});

test('prunes the .json and the same-named directory together', () => {
  const { repo, root, ids } = makeRoot(11);
  runJson(['--repo', repo, '--keep', '10']);

  const gone = ids[0];
  assert.equal(fs.existsSync(path.join(root, `${gone}.json`)), false, 'run-state must be removed');
  assert.equal(
    fs.existsSync(path.join(root, gone)),
    false,
    'the packet directory must go with it — leaving it is the accumulation bug the rule exists to prevent'
  );
});

test('a run present as directory only still counts and is prunable', () => {
  // A crashed run can leave the packet dir with no run-state. If such a run did not COUNT, the
  // directories would outlive the retention window without ever reaching the cut line.
  const { repo, root, ids } = makeRoot(11, { dirOnly: [0] });
  const out = runJson(['--repo', repo, '--keep', '10']);

  assert.equal(out.total, 11, 'a directory with no .json is still a run');
  assert.deepEqual(out.pruned, [ids[0]]);
  assert.equal(fs.existsSync(path.join(root, ids[0])), false);
});

test('a run present as .json only is pruned without erroring on the absent directory', () => {
  const { repo, root, ids } = makeRoot(11, { jsonOnly: [0] });
  const out = runJson(['--repo', repo, '--keep', '10']);

  assert.deepEqual(out.pruned, [ids[0]]);
  assert.equal(fs.existsSync(path.join(root, `${ids[0]}.json`)), false);
});

test('under the retention limit → nothing is removed', () => {
  const { repo, root } = makeRoot(4);
  const out = runJson(['--repo', repo, '--keep', '10']);

  assert.deepEqual(out.pruned, []);
  assert.equal(fs.readdirSync(root).length, 8);
});

test('--dry-run reports the same set but deletes nothing', () => {
  const { repo, root, ids } = makeRoot(12);
  const out = runJson(['--repo', repo, '--keep', '10', '--dry-run']);

  assert.equal(out.dry_run, true);
  assert.deepEqual(out.pruned, ids.slice(0, 2));
  assert.equal(fs.existsSync(path.join(root, `${ids[0]}.json`)), true, 'dry-run must not unlink');
  assert.equal(fs.existsSync(path.join(root, ids[0])), true);
});

test('ordering follows the run-id timestamp, not mtime', () => {
  const { repo, root, ids } = makeRoot(11);
  // Touch the OLDEST run so mtime ordering would spare it. Lexical run-id ordering must not care.
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(root, `${ids[0]}.json`), future, future);

  const out = runJson(['--repo', repo, '--keep', '10']);
  assert.deepEqual(out.pruned, [ids[0]], 'a restore or touch must not reorder retention');
});

test('unrecognized entries are reported and left in place, never removed', () => {
  const { repo, root } = makeRoot(11);
  const stray = path.join(root, 'notes.txt');
  const strayDir = path.join(root, 'scratch');
  fs.writeFileSync(stray, 'keep me');
  fs.mkdirSync(strayDir);

  const out = runJson(['--repo', repo, '--keep', '0']);
  assert.deepEqual(out.unknown.sort(), ['notes.txt', 'scratch']);
  assert.equal(fs.existsSync(stray), true, 'an unexpected name is a reason to stop, not to guess');
  assert.equal(fs.existsSync(strayDir), true);
});

test('a symlink named like a run is not treated as a run', () => {
  const { repo, root, base } = makeRoot(1);
  const victim = path.join(base, 'victim');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'important'), 'data');
  const linkId = '20250101-000000-planted';
  fs.symlinkSync(victim, path.join(root, linkId));

  const out = runJson(['--repo', repo, '--keep', '0']);
  assert.ok(out.unknown.includes(linkId), 'the symlink must be reported as unrecognized');
  assert.deepEqual(out.pruned.includes(linkId), false);
  assert.equal(fs.existsSync(path.join(victim, 'important')), true, 'the link target must be untouched');
});

test('a regular file named like a run directory is not treated as a run', () => {
  // Pins the `key === 'dir' && !e.isDirectory()` branch specifically: a plain file carries no
  // symlink bit, so the symlink guard does not cover this shape.
  const { repo, root } = makeRoot(1);
  const impostor = '20250101-000000-plain-file';
  fs.writeFileSync(path.join(root, impostor), 'not a run');

  const out = runJson(['--repo', repo, '--keep', '0']);
  assert.ok(out.unknown.includes(impostor), 'a non-directory must not be counted as a packet dir');
  assert.equal(out.pruned.includes(impostor), false);
  assert.equal(fs.existsSync(path.join(root, impostor)), true);
});

test('a directory named <run-id>.json is not treated as run-state', () => {
  // Pins the `key === 'json' && !e.isFile()` branch — the mirror of the case above.
  const { repo, root } = makeRoot(1);
  const impostor = '20250101-000000-dir-shaped.json';
  fs.mkdirSync(path.join(root, impostor));
  fs.writeFileSync(path.join(root, impostor, 'inside'), 'data');

  const out = runJson(['--repo', repo, '--keep', '0']);
  assert.ok(out.unknown.includes(impostor), 'a directory must not be counted as run-state');
  assert.equal(fs.existsSync(path.join(root, impostor, 'inside')), true);
});

test('there is no --root flag: the deletion target cannot be named by an argument', () => {
  // The containment property. An earlier revision accepted `--root <any path named
  // .claude_workflows>`, so `--keep 0` recursively removed run-shaped artifacts in a directory
  // belonging to no repository. The root is now derived from `git rev-parse --show-toplevel`.
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prune-runs-'));
  const bogus = path.join(base, '.claude_workflows');
  fs.mkdirSync(bogus);
  fs.mkdirSync(path.join(bogus, '20250101-000000-victim'));
  fs.writeFileSync(path.join(bogus, '20250101-000000-victim', 'data'), 'precious');

  const r = run(['--root', bogus, '--keep', '0']);
  assert.equal(r.code, 1, '--root must be rejected as an unknown flag');
  assert.match(r.stderr, /unknown flag/);
  assert.equal(
    fs.existsSync(path.join(bogus, '20250101-000000-victim', 'data')),
    true,
    'a directory outside any repo must survive untouched'
  );
});

test('one repo cannot prune another repo', () => {
  // --repo selects a REPOSITORY whose own workflows dir is derived; it cannot cross over.
  const a = makeRoot(11);
  const b = makeRoot(11);

  runJson(['--repo', a.repo, '--keep', '0']);

  assert.equal(fs.readdirSync(a.root).length, 0, 'the named repo is pruned');
  assert.equal(fs.readdirSync(b.root).length, 22, 'the other repo is untouched');
});

test('refuses a workflows root that is itself a symlink', () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prune-runs-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q'], { encoding: 'utf8' });
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'keep'), 'data');
  fs.symlinkSync(real, path.join(repo, '.claude_workflows'));

  const r = run(['--repo', repo, '--keep', '0']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /symlink/);
  assert.equal(fs.existsSync(path.join(real, 'keep')), true, 'the link target must be untouched');
});

test('a missing workflows root is nothing to prune, not an error', () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prune-runs-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q'], { encoding: 'utf8' });

  const out = runJson(['--repo', repo]);
  assert.equal(out.total, 0);
  assert.deepEqual(out.pruned, []);
});

test('a non-repo --repo is refused rather than falling back to cwd', () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prune-runs-'));
  const r = run(['--repo', base, '--keep', '0']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not inside a git repository/);
});

test('unknown, duplicate, and =-joined flags are refused before anything is deleted', () => {
  // The live hazard a lenient parser creates: `--dryrun` is a plausible typo for the documented
  // `--dry-run`, and under an indexOf-style lookup it is silently not-a-flag — so the command the
  // user believed was a preview prunes for real.
  const cases = [
    { args: ['--keep', '0', '--dryrun'], match: /unknown flag/, why: 'typo for --dry-run' },
    { args: ['--keep', '0', '--dry-run=true'], match: /use "--dry-run <value>"|unknown flag|use "--dry-run"/, why: '=-joined' },
    { args: ['--keep', '0', '--keep', '5'], match: /more than once/, why: 'duplicate value flag' },
    { args: ['--keep', '0', '--dry-run', '--dry-run'], match: /more than once/, why: 'duplicate bool flag' },
    { args: ['--keep', '0', 'extra'], match: /positional/, why: 'stray positional' },
    { args: ['--keep'], match: /requires a value/, why: 'value flag with no value' },
  ];

  for (const { args, match, why } of cases) {
    const { repo, root } = makeRoot(11);
    const r = run(['--repo', repo, ...args]);
    assert.equal(r.code, 1, `expected refusal for ${why}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, match, `refusal must name the reason for ${why}`);
    assert.equal(fs.readdirSync(root).length, 22, `nothing may be deleted for ${why}`);
  }
});

test('rejects a non-integer --keep instead of defaulting', () => {
  const { repo, root } = makeRoot(11);
  const r = run(['--repo', repo, '--keep', 'ten']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--keep/);
  assert.equal(fs.readdirSync(root).length, 22, 'a bad argument must not delete anything');
});

test('SKILL.md documents the executable command, not just the policy', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '..', 'skills', 'orchestrate', 'SKILL.md'),
    'utf8'
  );
  assert.match(
    skill,
    /prune-runs\.js/,
    'the FIFO row must name the script — prose alone is unexecutable under this skill\'s allowed-tools (no Bash(rm:*))'
  );
});

test('every orchestrate script is invoked through CLAUDE_PLUGIN_ROOT, not a repo-relative path', () => {
  // Naming the script is not enough: a skill runs with the TARGET REPO as cwd, so
  // `node skills/orchestrate/scripts/prune-runs.js` resolves only when the target repo happens to
  // be this one. Everywhere else it is MODULE_NOT_FOUND — so retention silently never ran, and
  // `.claude_workflows/` kept growing at ~81 KB/run, which is the exact leak the script exists to
  // stop. The failure is invisible in development, which is why it needs a test rather than review
  // attention.
  //
  // Checked across both surfaces that carry invocations, and for ALL scripts rather than just
  // prune-runs: the two siblings were already correct, and pinning only the one that was broken
  // would let the next script added repeat it.
  const surfaces = [
    path.join('skills', 'orchestrate', 'SKILL.md'),
    path.join('skills', 'orchestrate', 'references', 'planner-prompt.md'),
  ];
  const offenders = [];
  let invocations = 0;
  for (const rel of surfaces) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
    text.split('\n').forEach((line, i) => {
      // Every `node …/scripts/<name>.js` invocation on the line, wherever it appears in the prose.
      for (const m of line.matchAll(/node\s+"?([^"\s`]*skills\/orchestrate\/scripts\/[A-Za-z0-9._-]+\.js)"?/g)) {
        invocations++;
        if (!m[1].includes('${CLAUDE_PLUGIN_ROOT}')) offenders.push(`${rel}:${i + 1} → ${m[1]}`);
      }
    });
  }

  // Non-vacuity: a regex that stops matching would report zero offenders and pass for free.
  assert.ok(invocations >= 3, `expected to find the script invocations, matched ${invocations}`);
  assert.deepEqual(offenders, [], 'these invocations resolve only when cwd happens to be this repo');
});

// ── assertCwdIsRoot, unit-level ───────────────────────────────────────────────────────────────
// The end-to-end race this guard covers needs a concurrent renamer, so no deterministic CLI test
// can trigger it — a mutation deleting the call site stays green through the whole suite above.
// Exercising the predicate directly is what makes the logic pinned rather than merely present.

function inChild(fn) {
  // assertCwdIsRoot calls process.exit(1) on refusal, so it must run in its own process.
  const src = `
    const fs = require('node:fs');
    const { assertCwdIsRoot } = require(${JSON.stringify(
      path.join(__dirname, '..', '..', 'skills', 'orchestrate', 'scripts', 'prune-runs.js')
    )});
    ${fn}
    process.stdout.write('SURVIVED\\n');
  `;
  return spawnSync(process.execPath, ['-e', src], { encoding: 'utf8' });
}

/** A bare temp directory — the removeChild tests exercise the function directly, not the CLI. */
function makeBareDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

test('assertCwdIsRoot: cwd inside the pinned directory passes', () => {
  const base = makeBareDir('prune-ident-');
  const dir = path.join(base, 'root');
  fs.mkdirSync(dir);

  const r = inChild(`
    const fd = fs.openSync(${JSON.stringify(dir)}, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    process.chdir(${JSON.stringify(dir)});
    assertCwdIsRoot(fd);
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SURVIVED/);
});

test('assertCwdIsRoot: a cwd that is NOT the pinned directory aborts', () => {
  // The precondition removeChild depends on. Without this check a direct call from a caller that
  // never entered the root would resolve its bare names against some unrelated directory.
  const base = makeBareDir('prune-ident-');
  const pinned = path.join(base, 'pinned');
  const elsewhere = path.join(base, 'elsewhere');
  fs.mkdirSync(pinned);
  fs.mkdirSync(elsewhere);

  const r = inChild(`
    const fd = fs.openSync(${JSON.stringify(pinned)}, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    process.chdir(${JSON.stringify(elsewhere)});
    assertCwdIsRoot(fd);
  `);
  assert.equal(r.status, 1, `expected abort, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /no longer the pinned workflows root/);
  assert.equal(/SURVIVED/.test(r.stdout), false, 'must not continue past an unpinned cwd');
});

test('assertCwdIsRoot: an unusable fd aborts rather than throwing uncaught', () => {
  const base = makeBareDir('prune-ident-');
  const dir = path.join(base, 'root');
  fs.mkdirSync(dir);

  const r = inChild(`
    const fd = fs.openSync(${JSON.stringify(dir)}, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    process.chdir(${JSON.stringify(dir)});
    fs.closeSync(fd);
    assertCwdIsRoot(fd);
  `);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unverifiable mid-run/);
  assert.equal(/at Object\.<anonymous>/.test(r.stderr), false, 'must be a controlled refusal, not a stack trace');
});

test('requiring prune-runs.js does not prune anything', () => {
  // The module.exports added for the tests above must not turn an import into a destructive act.
  const { repo, root } = makeRoot(11);
  const r = spawnSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(SCRIPT)});`],
    { encoding: 'utf8', cwd: repo }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readdirSync(root).length, 22, 'a require must be inert');
});

// --- The delete resolves from the pinned cwd, never from a path ---

test('a root renamed away and replaced by a symlink does NOT redirect the delete', () => {
  // The P0 this design exists for. The previous implementation joined `rootReal` with the child
  // name and called rmSync on the result: re-stat'ing the root first proved only that the path
  // resolved correctly a moment ago, and the delete then walked the path again — landing wherever
  // the symlink pointed. Deleting the `process.chdir` + assertCwdIsRoot pin from main(), or
  // reverting removeChild to a joined path, makes `precious.txt` below disappear.
  const base = makeBareDir('prune-swapdel-');
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(outside, 'victim.json'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'victim.json', 'precious.txt'), 'MUST SURVIVE');
  fs.writeFileSync(path.join(root, 'victim.json'), '{}');

  const script = [
    "const fs = require('node:fs');",
    `const { removeChild } = require(${JSON.stringify(SCRIPT)});`,
    `const root = ${JSON.stringify(root)};`,
    `const outside = ${JSON.stringify(outside)};`,
    'const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);',
    'process.chdir(root);',
    // The attacker's move, performed after the pin and before the delete.
    "fs.renameSync(root, root + '.moved');",
    'fs.symlinkSync(outside, root);',
    "process.stdout.write(removeChild(fd, 'victim.json', { expectDir: false }) + '\\n');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });

  assert.equal(r.status, 0, `the delete should succeed against the real root: ${r.stderr}`);
  assert.equal(r.stdout.trim(), 'removed');
  assert.equal(
    fs.readFileSync(path.join(outside, 'victim.json', 'precious.txt'), 'utf8'), 'MUST SURVIVE',
    'the symlink target must be untouched — a path-resolving delete would have removed it'
  );
  assert.equal(
    fs.existsSync(path.join(`${root}.moved`, 'victim.json')), false,
    'and the entry inside the genuinely-pinned root must be the one removed'
  );
});

test('removeChild refuses when the caller never entered the pinned root', () => {
  // Enforcing the precondition rather than documenting it: an exported destructive helper must not
  // become a way to delete a bare name out of whatever cwd the caller happened to be in.
  const base = makeBareDir('prune-nocwd-');
  const root = path.join(base, 'root');
  const other = path.join(base, 'other');
  fs.mkdirSync(root);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'victim.json'), 'do-not-delete');

  const script = [
    "const fs = require('node:fs');",
    `const { removeChild } = require(${JSON.stringify(SCRIPT)});`,
    `const fd = fs.openSync(${JSON.stringify(root)}, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);`,
    `process.chdir(${JSON.stringify(other)});`,
    "removeChild(fd, 'victim.json', { expectDir: false });",
    "console.log('REACHED-UNREACHABLE');",
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });

  assert.equal(r.status, 1, 'an unpinned cwd must abort the process, not proceed');
  assert.match(r.stderr || '', /no longer the pinned workflows root/);
  assert.doesNotMatch(r.stdout || '', /REACHED-UNREACHABLE/);
  assert.equal(fs.readFileSync(path.join(other, 'victim.json'), 'utf8'), 'do-not-delete');
});

test('a run directory containing a symlink is emptied without following it', () => {
  // The header claims rimraf semantics (lstat each entry, unlink symlinks, never descend). The
  // whole containment argument for `recursive: true` rests on that, so it is pinned rather than
  // assumed — including a link planted deep inside, not just at the top level.
  const { removeChild } = require(SCRIPT);
  const base = makeBareDir('prune-symdesc-');
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  const runId = '20260101-000000-run';
  fs.mkdirSync(path.join(root, runId, 'nested'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'MUST SURVIVE');
  fs.symlinkSync(outside, path.join(root, runId, 'nested', 'deep'));

  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd = process.cwd();
  try {
    process.chdir(root);
    assert.equal(removeChild(fd, runId, { expectDir: true }), 'removed');
    assert.equal(fs.existsSync(path.join(root, runId)), false, 'the run directory is gone');
    assert.equal(
      fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'MUST SURVIVE',
      'the descent must not have followed the nested symlink'
    );
  } finally {
    process.chdir(cwd);
    fs.closeSync(fd);
  }
});

test('removeChild reports removed / absent / skipped as three distinct outcomes', () => {
  // It returned a bare boolean and mapped EVERY lstat failure to "already gone", so EACCES, ELOOP
  // and ENOTDIR all reported an artifact still on disk as pruned. The caller's `pruned` list is
  // built from these values, so collapsing them is what made the exit status lie.
  const { removeChild } = require(SCRIPT);
  const base = makeBareDir('prune-outcome-');
  const root = path.join(base, 'root');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'real.json'), '{}');
  fs.mkdirSync(path.join(root, 'shape.json')); // a DIRECTORY where a file was expected
  fs.symlinkSync(path.join(base, 'nowhere'), path.join(root, 'link.json'));

  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd = process.cwd();
  try {
    process.chdir(root);
    assert.equal(removeChild(fd, 'real.json', { expectDir: false }), 'removed');
    assert.equal(removeChild(fd, 'real.json', { expectDir: false }), 'absent', 'a second call is idempotent');
    assert.equal(removeChild(fd, 'shape.json', { expectDir: false }), 'skipped', 'wrong type is not "gone"');
    assert.equal(removeChild(fd, 'link.json', { expectDir: false }), 'skipped', 'a symlink is never removed here');
    assert.equal(fs.existsSync(path.join(root, 'shape.json')), true, 'a skipped entry stays on disk');
    assert.equal(fs.lstatSync(path.join(root, 'link.json')).isSymbolicLink(), true);
  } finally {
    process.chdir(cwd);
    fs.closeSync(fd);
  }
});

test('`already_absent` is a reported outcome, distinct from `pruned`', () => {
  // The delete loop maps removeChild's three outcomes onto three buckets. `absent` used to fold
  // into `pruned`, which made the headline count answer "how many runs are gone" instead of "how
  // much did this invocation drain" — and a retention leak that never shrinks while every run
  // prints `pruned=10` is precisely the condition this script exists to make visible.
  //
  // COVERAGE BOUNDARY, stated rather than implied: driving a real `absent` end-to-end needs an
  // entry to vanish BETWEEN enumeration and removal, which no deterministic single-process test can
  // arrange. The three-way mapping itself is pinned by the `removed / absent / skipped` unit test
  // above; what this adds is the contract that the bucket EXISTS in the output and that a normal
  // prune leaves it empty, so a consumer can read it and a regression that drops the field is red.
  const { repo, ids } = makeRoot(12);
  const out = runJson(['--repo', repo, '--keep', '10']);

  assert.ok(Array.isArray(out.already_absent), 'the field must be present for consumers to rely on');
  assert.deepEqual(out.already_absent, [], 'nothing vanished under us, so the bucket is empty');
  assert.deepEqual(out.pruned, ids.slice(0, 2), 'and the entries this run really removed are the pruned ones');
});

test('a run whose artifact could not be removed is NOT reported as pruned', { skip: process.getuid && process.getuid() === 0 ? 'root bypasses directory permissions' : false }, () => {
  // `pruned: doomed` was emitted unconditionally, so an artifact removeChild refused was reported
  // as pruned while still on disk — the one output a caller would trust to decide whether the
  // retention policy actually held.
  //
  // The failure is induced with permissions rather than a wrong-shaped entry: a mis-shaped entry is
  // rejected by `collectRuns` at enumeration and never reaches a removal at all, so it would prove
  // nothing about the delete-loop's accounting. Removing a name needs WRITE on the parent, so a
  // read+execute root lets enumeration and lstat succeed and makes only the unlink fail.
  const { repo, root, ids } = makeRoot(2);
  fs.chmodSync(root, 0o555);
  try {
    // NOT `runJson` — that helper asserts exit 0, which is the very status under test. A refused
    // deletion must be a nonzero exit: a caller polling this to decide whether the retention policy
    // holds was previously told "yes" while the run it asked to delete was still on disk.
    const r = run(['--repo', repo, '--keep', '1', '--json']);
    assert.equal(r.code, 1, `a refused deletion must exit nonzero, got ${r.code}: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.pruned, [], 'nothing was actually removed, so nothing may be reported as pruned');
    assert.deepEqual(out.failed, [ids[0]], 'the run that survived deletion must be reported as failed');
    assert.ok(
      !out.kept.includes(ids[0]),
      'and it must not be laundered into `kept` — `kept` is what the policy retained, not what resisted removal'
    );
    assert.equal(
      out.kept.length + out.pruned.length + out.already_absent.length + out.failed.length,
      out.total,
      'every enumerated run must land in exactly one bucket, or the report describes a tree that does not exist'
    );
    assert.ok(out.unknown.includes(`${ids[0]}.json`), 'and each refused entry must be reported');
    assert.ok(out.unknown.includes(ids[0]));
    assert.equal(
      fs.existsSync(path.join(root, `${ids[0]}.json`)), true,
      'the artifact really is still on disk — that is why claiming it was pruned was wrong'
    );
  } finally {
    fs.chmodSync(root, 0o755);
  }
});

test('a fully successful prune still exits 0 and reports an empty `failed` bucket (control)', () => {
  // Without this, binding the exit status to `failed` could regress into "always exit 1" and the
  // test above would not notice.
  const { repo, ids } = makeRoot(3);
  const out = runJson(['--repo', repo, '--keep', '2']);
  assert.deepEqual(out.failed, [], 'nothing resisted removal');
  assert.deepEqual(out.pruned, ids.slice(0, 1));
  assert.equal(
    out.kept.length + out.pruned.length + out.already_absent.length + out.failed.length,
    out.total,
    'the bucket partition must hold on the happy path too'
  );
});

test('a real directory swapped in under a run id between lstat and removal is NOT deleted', () => {
  // Codex P0, and the gap the symlink test above does NOT cover: `removeChild` lstat'ed the entry
  // and then handed the same NAME to a recursive delete, which re-resolved it and walked whatever
  // it found. Rejecting symlinks buys nothing here — the substitute is a real directory, exactly
  // what a recursive walk expects — and pinning the ROOT proves the parent, not the identity of
  // each child beneath it.
  //
  // Deterministic: `removePinnedChild` is driven directly with the identity captured BEFORE the
  // swap, which is precisely what enumeration hands it in production. No racing, no sleeps.
  const base = makeBareDir('prune-childswap-');
  const root = path.join(base, 'root');
  const doomed = path.join(root, 'run-a');
  fs.mkdirSync(doomed, { recursive: true });
  fs.writeFileSync(path.join(doomed, 'ours.json'), '{}');

  const victim = path.join(base, 'victim');
  fs.mkdirSync(victim, { recursive: true });
  fs.writeFileSync(path.join(victim, 'precious.txt'), 'MUST SURVIVE');

  const { removePinnedChild } = require(SCRIPT);
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd0 = process.cwd();
  let result;
  try {
    process.chdir(root);
    const st = fs.lstatSync('run-a');
    const expect = { dev: st.dev, ino: st.ino, dir: st.isDirectory() };

    // ... the swap lands here, after the identity was observed ...
    fs.renameSync(doomed, path.join(base, 'parked'));
    fs.renameSync(victim, doomed);

    result = removePinnedChild(fd, 'run-a', 'run-a', expect);
  } finally {
    try { process.chdir(cwd0); } catch { /* nothing useful to do */ }
    fs.closeSync(fd);
  }

  assert.equal(result, false, 'the removal must refuse an entry whose identity changed');
  assert.equal(
    fs.readFileSync(path.join(doomed, 'precious.txt'), 'utf8'), 'MUST SURVIVE',
    'the substituted directory must survive — erasing it is the whole point of the swap'
  );
});

// --- The same window on a REGULAR FILE ---
//
// The directory branch above carries `{dev, ino, dir}` into the pinned walk. The FILE branches did
// not: `removeChild` checked only the SHAPE (`isFile`) before unlinking by name, and
// `removePinnedChild` verified the inode and then re-resolved the name at the unlink. A
// substitution landing in that second window was destroyed rather than reported.
//
// Injection is a one-shot patch of `fs.renameSync`. prune-runs.js does `const fs =
// require('node:fs')` and calls `fs.renameSync(...)`, so the property is looked up per call and the
// patch reaches the real production path. The swap runs immediately before the isolation rename
// delegates — exactly after the identity was observed. Deterministic; no sleeps.
function withSwapBeforeFirstRename(doSwap, body) {
  const realRename = fs.renameSync;
  let fired = false;
  fs.renameSync = (from, to) => {
    if (!fired) {
      fired = true;
      doSwap(realRename);
    }
    return realRename(from, to);
  };
  try {
    return body();
  } finally {
    fs.renameSync = realRename;
    assert.equal(fired, true, 'the injection never fired — the test proved nothing about the window');
  }
}

test('a run JSON substituted after its shape was checked is RELOCATED, not destroyed', () => {
  const base = makeBareDir('prune-fileswap-');
  const root = path.join(base, 'root');
  fs.mkdirSync(root, { recursive: true });
  const doomed = path.join(root, 'run-a.json');
  fs.writeFileSync(doomed, '{"ours": true}');

  const victim = path.join(base, 'precious.json');
  fs.writeFileSync(victim, 'MUST SURVIVE');

  const { removeChild } = require(SCRIPT);
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd0 = process.cwd();
  let result;
  try {
    process.chdir(root);
    result = withSwapBeforeFirstRename(
      (realRename) => {
        // ... the shape check and identity lstat happened here in production; the swap lands now ...
        realRename(doomed, path.join(base, 'parked.json'));
        realRename(victim, doomed);
      },
      () => removeChild(fd, 'run-a.json', { expectDir: false })
    );
  } finally {
    try { process.chdir(cwd0); } catch { /* nothing useful to do */ }
    fs.closeSync(fd);
  }

  assert.equal(result, 'skipped', 'a substituted entry must not be reported as pruned');
  const survivors = fs.readdirSync(root)
    .filter((n) => n.startsWith('.quarantine-'))
    .map((n) => fs.readFileSync(path.join(root, n), 'utf8'));
  assert.deepEqual(
    survivors, ['MUST SURVIVE'],
    'the substituted file must survive under quarantine — erasing it is the whole point of the swap'
  );
});

test('an ordinary run JSON is still removed and leaves NO quarantine residue', () => {
  // Non-vacuity control. If `unlinkVerified` renamed but never unlinked, the substitution test
  // would still pass (the victim survives either way) while every ordinary prune silently leaked a
  // `.quarantine-*` file into the run root and reported the artifact as pruned.
  const base = makeBareDir('prune-fileok-');
  const root = path.join(base, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'run-a.json'), '{"ours": true}');

  const { removeChild } = require(SCRIPT);
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd0 = process.cwd();
  let result;
  try {
    process.chdir(root);
    result = removeChild(fd, 'run-a.json', { expectDir: false });
  } finally {
    try { process.chdir(cwd0); } catch { /* nothing useful to do */ }
    fs.closeSync(fd);
  }

  assert.equal(result, 'removed');
  assert.deepEqual(fs.readdirSync(root), [], 'no quarantine residue may be left behind');
});

test('a run directory with nested content is still removed (control for the identity binding)', () => {
  // Without this, refusing everything would satisfy the test above. Nested content matters: the
  // removal no longer has a recursive primitive, so it has to descend correctly on its own.
  const base = makeBareDir('prune-nested-ok-');
  const root = path.join(base, 'root');
  fs.mkdirSync(path.join(root, 'run-a', 'deep', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(root, 'run-a', 'top.json'), '{}');
  fs.writeFileSync(path.join(root, 'run-a', 'deep', 'mid.json'), '{}');
  fs.writeFileSync(path.join(root, 'run-a', 'deep', 'deeper', 'leaf.json'), '{}');

  const { removePinnedChild } = require(SCRIPT);
  const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const cwd0 = process.cwd();
  let result;
  try {
    process.chdir(root);
    const st = fs.lstatSync('run-a');
    result = removePinnedChild(fd, 'run-a', 'run-a', { dev: st.dev, ino: st.ino, dir: true });
  } finally {
    try { process.chdir(cwd0); } catch { /* nothing useful to do */ }
    fs.closeSync(fd);
  }

  assert.equal(result, true, 'an unmolested run directory must still be removable');
  assert.equal(fs.existsSync(path.join(root, 'run-a')), false, 'including its whole subtree');
});
