const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/orchestrate/scripts/run-verify.js');
const tempDirs = [];

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function createRepo() {
  const base = mkdtempSync(join(tmpdir(), 'sd0x-orch-verify-'));
  tempDirs.push(base);
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, ['init']);
  git(repo, ['config', '--local', 'user.name', 'verify-test']);
  git(repo, ['config', '--local', 'user.email', 'verify@test.dev']);
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 30 };\n');
  git(repo, ['add', 'service.js']);
  git(repo, ['commit', '-m', 'init']);
  return { base, repo };
}

function snapshotToFile(base, repo) {
  const stdout = execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  const baselinePath = join(base, 'baseline.json');
  writeFileSync(baselinePath, stdout);
  return { baselinePath, baseline: JSON.parse(stdout) };
}

function compare(repo, baselinePath) {
  try {
    const stdout = execFileSync('node', [scriptPath, 'compare', '--baseline', baselinePath, '--repo', repo], { encoding: 'utf8' });
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    return {
      output: stdout ? JSON.parse(stdout) : null,
      exitCode: err.status,
      stderr: (err.stderr || '').toString(),
    };
  }
}

function driftFields(result) {
  return result.output.drift.map((d) => d.field);
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('run-verify snapshot: emits every compare field (T3 check set)', () => {
  const { base, repo } = createRepo();
  const { baseline } = snapshotToFile(base, repo);
  for (const field of [
    'head',
    'branch',
    'porcelain_sha256',
    'tracked_diff_sha256',
    'untracked_content_sha256',
    'refs_sha256',
    'local_config_sha256',
    'git_internals_sha256',
    'worktrees',
    'stash_count',
  ]) {
    assert.ok(field in baseline, `snapshot should include ${field}`);
  }
});

test('run-verify compare: untouched repo → exit 0 {ok:true}', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { ok: true });
});

test('run-verify compare: dirty baseline with no new drift → exit 0 (no-new-drift semantics)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'draft-notes.md'), '# pre-existing untracked\n');
  const { baselinePath } = snapshotToFile(base, repo);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'pre-existing dirt is part of the baseline, not drift');
});

test('run-verify compare: re-editing an already-dirty tracked file → content drift (porcelain blind spot)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 45 };\n');
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 60 };\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('tracked_diff_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'porcelain stays "M service.js" — content hash must catch it');
});

test('run-verify compare: re-editing a pre-existing untracked file → content drift (porcelain blind spot)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'draft-notes.md'), '# original draft\n');
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'draft-notes.md'), '# tampered draft\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('untracked_content_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'porcelain stays "?? draft-notes.md" — content hash must catch it');
});

test('run-verify compare: new untracked file after baseline → porcelain drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'sneaky-output.md'), 'worker wrote this\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('porcelain_sha256'));
});

test('run-verify compare: sneaky commit after baseline → head drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['commit', '--allow-empty', '-m', 'sneaky']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('head'));
});

test('run-verify compare: branch switch after baseline → branch drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['checkout', '-b', 'escape-branch']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('branch'));
});

test('run-verify compare: tag creation after baseline → refs drift (worktree stays clean)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['tag', 'v9.9.9-sneaky']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('refs_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'tag must be caught by refs hash, not porcelain');
});

test('run-verify compare: local config tampering after baseline → config drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['config', '--local', 'core.hooksPath', '/tmp/evil-hooks']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('local_config_sha256'));
});

test('run-verify compare: stash after baseline → stash_count drift', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 45 };\n');
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['stash', 'push', '-m', 'hide changes']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('stash_count'));
});

test('run-verify compare: new worktree after baseline → worktrees drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['worktree', 'add', '--detach', join(base, 'shadow-worktree')]);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('worktrees'));
});

test('run-verify compare: gitignored write after baseline → no drift (control-plane run-state path)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'workflow-state/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore workflow state dir']);
  const { baselinePath } = snapshotToFile(base, repo);
  mkdirSync(join(repo, 'workflow-state'));
  writeFileSync(join(repo, 'workflow-state', 'run.json'), '{"status":"executing"}\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'gitignored run-state writes are legitimate, must not trip the verifier');
});

test('run-verify compare: baseline missing a check field → drift (cannot prove no-drift)', () => {
  const { base, repo } = createRepo();
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  delete baseline.refs_sha256;
  writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const missing = result.output.drift.find((d) => d.field === 'refs_sha256');
  assert.equal(missing.reason, 'field missing from baseline');
});

test('run-verify compare: planted .git/hooks/pre-commit after baseline → git_internals drift (porcelain blind)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  // A persistence payload that fires on the next commit — git never lists
  // .git/ contents in status/ls-files, so only the internals digest can see it.
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho pwned\n');
  chmodSync(hook, 0o755);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('git_internals_sha256'), 'planted hook must trip the internals digest');
  assert.ok(!fields.includes('porcelain_sha256'), 'a .git/ write is invisible to porcelain — internals digest must catch it');
});

test('run-verify compare: .git/info/exclude append + matching write → git_internals drift (both porcelain AND ls-files blind)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  // Appending a pattern then writing a matching file hides that write from both
  // `status --porcelain` and `ls-files --exclude-standard`; the only signal is
  // the exclude file itself, which the internals digest hashes.
  appendFileSync(join(repo, '.git', 'info', 'exclude'), 'sneaky-output.md\n');
  writeFileSync(join(repo, 'sneaky-output.md'), 'exfiltrated\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('git_internals_sha256'), 'exclude tampering must trip the internals digest');
  assert.ok(!fields.includes('porcelain_sha256'), 'the excluded write is invisible to porcelain');
  assert.ok(!fields.includes('untracked_content_sha256'), 'the excluded write is invisible to ls-files too');
});

test('run-verify compare: chmod +x a pre-existing hook sample → git_internals drift (exec-bit sensitivity)', () => {
  const { base, repo } = createRepo();
  // Pre-plant an inert, non-executable hook file that is part of the baseline.
  const hook = join(repo, '.git', 'hooks', 'pre-push');
  writeFileSync(hook, '#!/bin/sh\ntrue\n');
  chmodSync(hook, 0o644);
  const { baselinePath } = snapshotToFile(base, repo);
  // Arming it (chmod +x) makes git start running it — a state change with no
  // content change; the digest folds the exec bit in to catch exactly this.
  chmodSync(hook, 0o755);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('git_internals_sha256'), 'arming a hook must trip the internals digest');
});

test('run-verify snapshot: 1200 untracked files → snapshot succeeds (hash-object multi-chunk correctness)', () => {
  const { base, repo } = createRepo();
  // 1200 paths cross the CHUNK=500 boundary twice, so the batch loop runs three
  // hash-object calls; this locks down chunk ordering/concatenation. (It does
  // not exercise the byte limit itself — short paths here stay under ARG_MAX;
  // an oversized chunk would throw → fail-closed, which is the safe outcome.)
  for (let i = 0; i < 1200; i += 1) writeFileSync(join(repo, `untracked-${i}.txt`), `content ${i}\n`);
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  assert.ok('untracked_content_sha256' in baseline, 'snapshot must not throw across chunk boundaries');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a re-snapshot of the same tree is drift-free');
});

test('run-verify compare: untracked file whose name contains a newline → tracked with stable alignment', () => {
  const { base, repo } = createRepo();
  // argv-based hash-object (not --stdin-paths) keeps path→hash alignment even
  // when a path contains a newline — a line-delimited reader would desync here.
  const weird = join(repo, 'weird\nname.txt');
  writeFileSync(weird, 'sneaky\n');
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  assert.ok('untracked_content_sha256' in baseline);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'a stable newline-named path must not self-drift');
  writeFileSync(weird, 'tampered\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'edit to a newline-named file must still be caught');
});

test('run-verify snapshot: corrupt .git/config → fail-closed exit 1 (unverifiable repo is drift)', () => {
  const { base, repo } = createRepo();
  // A malformed config makes git reads exit non-zero (in practice the very first
  // call, `rev-parse HEAD`); snapshot must fail-closed on any git failure rather
  // than emit a partial/blank baseline. General corrupt-repo guard — it does not
  // isolate the localConfig line, whose swallow-to-'' catch was removed for the
  // same fail-closed reason.
  writeFileSync(join(repo, '.git', 'config'), '[unterminated section\n');
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 1, 'an unverifiable (corrupt) repo must fail-closed');
});

test('run-verify: unknown command, missing baseline flag, non-repo dir all fail closed', () => {
  const { base, repo } = createRepo();
  const cases = [
    ['rollback', '--repo', repo],
    ['compare', '--repo', repo],
    ['snapshot', '--repo', join(base, 'not-a-repo')],
  ];
  for (const args of cases) {
    let status = 0;
    try {
      execFileSync('node', [scriptPath, ...args], { encoding: 'utf8' });
    } catch (err) {
      status = err.status;
    }
    assert.equal(status, 1, `expected fail-closed exit 1 for: ${args.join(' ')}`);
  }
});
