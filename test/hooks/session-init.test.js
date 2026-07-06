const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hookPath = resolve(__dirname, '../../hooks/session-init.sh');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Uses real jq (required: jq >= 1.6)

function runHook({ cwd, input }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env },
  });
}

after(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// ---------------------------------------------------------------------------
// D-2: Session Lifecycle Reset tests
// ---------------------------------------------------------------------------

test('session-init: new session resets review state', () => {
  const workDir = makeTempDir('sd0x-session-init-reset-');

  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'old-session-abc',
      has_code_change: true,
      has_doc_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true },
      iteration_history: {
        current_round: 5,
        total_rounds_session: 8,
        strategic_reset_fired: false,
        findings_by_round: [{ round: 1, total: 3 }],
      },
    })
  );
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-session-xyz' },
  });
  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.session_id, 'new-session-xyz');
  assert.equal(state.has_code_change, false);
  assert.equal(state.code_review.passed, false);
  assert.equal(state.iteration_history.current_round, 0);
  // total_rounds_session should be preserved
  assert.equal(state.iteration_history.total_rounds_session, 8);
});

test('session-init: same session does not reset', () => {
  const workDir = makeTempDir('sd0x-session-init-same-');

  const original = {
    schema_version: 2,
    session_id: 'same-session',
    has_code_change: true,
    code_review: { executed: true, passed: true },
  };
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify(original));
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'same-session' },
  });
  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.has_code_change, true, 'should not reset for same session');
  assert.equal(state.code_review.passed, true, 'should preserve review state');
});

test('session-init: no state file creates minimal', () => {
  const workDir = makeTempDir('sd0x-session-init-new-');

  const result = runHook({
    cwd: workDir,
    input: { session_id: 'first-session' },
  });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(workDir, '.claude_review_state.json')));
  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.schema_version, 2);
  assert.equal(state.session_id, 'first-session');
});

test('session-init: empty session_id is a no-op', () => {
  const workDir = makeTempDir('sd0x-session-init-empty-');

  const result = runHook({
    cwd: workDir,
    input: {},
  });
  assert.equal(result.status, 0);
  assert.ok(!existsSync(join(workDir, '.claude_review_state.json')), 'should not create state file');
});

test('session-init: empty session_id legacy state gets full reset', () => {
  const workDir = makeTempDir('sd0x-session-init-legacy-');

  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: '',
      has_code_change: true,
      code_review: { executed: true, passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-session' },
  });
  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.session_id, 'new-session');
  assert.equal(state.has_code_change, false, 'should reset stale flags');
  assert.equal(state.code_review.passed, false, 'should reset review state');
});

// ---------------------------------------------------------------------------
// D-5: Session Commit Scope — Baseline Capture tests
// ---------------------------------------------------------------------------

function setupGitRepo(dir) {
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), '');
  spawnSync('git', ['add', '.'], { cwd: dir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], { cwd: dir });
}

test('session-init D-5: new session captures baseline_dirty_files', () => {
  const workDir = makeTempDir('sd0x-session-scope-baseline-');
  setupGitRepo(workDir);

  // Create dirty files
  writeFileSync(join(workDir, 'dirty1.ts'), 'console.log(1)');
  writeFileSync(join(workDir, 'dirty2.md'), '# doc');
  spawnSync('git', ['add', 'dirty1.ts'], { cwd: workDir });  // staged

  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ schema_version: 2, session_id: 'old-sess' })
  );

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.ok(state.session_commit_scope, 'should have session_commit_scope');
  assert.equal(state.session_commit_scope.session_id, 'new-sess');
  assert.ok(Array.isArray(state.session_commit_scope.baseline_dirty_files));
  const bl = state.session_commit_scope.baseline_dirty_files;
  assert.ok(bl.includes('dirty1.ts'), `expected dirty1.ts in baseline, got: ${JSON.stringify(bl)}`);
  assert.ok(bl.includes('dirty2.md'), `expected dirty2.md in baseline, got: ${JSON.stringify(bl)}`);
  assert.deepEqual(state.session_commit_scope.touched_files, []);
});

test('session-init D-5: first run creates scope with baseline', () => {
  const workDir = makeTempDir('sd0x-session-scope-firstrun-');
  setupGitRepo(workDir);

  writeFileSync(join(workDir, 'pre-existing.js'), 'var x = 1;');

  const result = runHook({ cwd: workDir, input: { session_id: 'first-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.schema_version, 2);
  assert.ok(state.session_commit_scope, 'should have session_commit_scope');
  assert.equal(state.session_commit_scope.session_id, 'first-sess');
  assert.ok(state.session_commit_scope.baseline_dirty_files.includes('pre-existing.js'));
});

test('session-init D-5: clean repo produces empty baseline', () => {
  const workDir = makeTempDir('sd0x-session-scope-clean-');
  setupGitRepo(workDir);

  const result = runHook({ cwd: workDir, input: { session_id: 'clean-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.deepEqual(state.session_commit_scope.baseline_dirty_files, []);
});

test('session-init D-5: rename captures dest path in baseline', () => {
  const workDir = makeTempDir('sd0x-session-scope-rename-');
  setupGitRepo(workDir);

  // Create a file, commit, then rename it (staged rename)
  writeFileSync(join(workDir, 'old-name.ts'), 'export const x = 1;');
  spawnSync('git', ['add', 'old-name.ts'], { cwd: workDir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'add file'], { cwd: workDir });
  spawnSync('git', ['mv', 'old-name.ts', 'new-name.ts'], { cwd: workDir });

  const result = runHook({ cwd: workDir, input: { session_id: 'rename-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  const bl = state.session_commit_scope.baseline_dirty_files;
  assert.ok(bl.includes('new-name.ts'), `expected new-name.ts (dest) in baseline, got: ${JSON.stringify(bl)}`);
  assert.ok(!bl.includes('old-name.ts'), 'should not include old-name.ts (src) in baseline');
});

test('session-init D-5: same session preserves scope', () => {
  const workDir = makeTempDir('sd0x-session-scope-preserve-');
  setupGitRepo(workDir);

  const original = {
    schema_version: 2,
    session_id: 'keep-sess',
    session_commit_scope: {
      session_id: 'keep-sess',
      baseline_dirty_files: ['old.ts'],
      touched_files: ['new.ts'],
      updated_at: '2026-01-01T00:00:00Z',
    },
  };
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify(original));

  const result = runHook({ cwd: workDir, input: { session_id: 'keep-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.deepEqual(state.session_commit_scope.touched_files, ['new.ts'], 'should preserve touched_files');
  assert.deepEqual(state.session_commit_scope.baseline_dirty_files, ['old.ts'], 'should preserve baseline');
});

test('session-init D-5: non-git dir produces null baseline', () => {
  const workDir = makeTempDir('sd0x-session-scope-nogit-');
  // No git init — not a repo

  const result = runHook({ cwd: workDir, input: { session_id: 'nogit-sess' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.session_commit_scope.baseline_dirty_files, null, 'should be null for non-git');
});

// ---------------------------------------------------------------------------
// deep-explore regression: orphan .blocked sidecar cleanup
// ---------------------------------------------------------------------------

test('session-init: new session removes orphan .blocked sidecar', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });
  assert.equal(result.status, 0);
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'stale escalation marker must not outlive its session (reset is already fail-closed)'
  );
});

test('session-init: same session keeps .blocked sidecar', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-keep-');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'same-sess' })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'same-sess' } });
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'an in-session sidecar is still meaningful — resume must not relax it'
  );
});

test('session-init: sidecar without state file removed on fresh create', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-orphan-');
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'fresh-sess' } });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(workDir, '.claude_review_state.json')), 'state created');
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'orphan sidecar from a deleted session must be cleared'
  );
});
