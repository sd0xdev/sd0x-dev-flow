const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
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
