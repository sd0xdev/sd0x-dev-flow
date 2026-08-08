const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
// Honest skip for the real-git localized-warning test below: on a host without zh_TW.UTF-8 the
// ambient zh-TW env has no effect, so it would pass whether or not the LC_ALL=C fix is present
// (false confidence). Host-independent coverage of the same logic lives in the advisory-sibling
// stub-git tests (see helpers/reconciliation-locale.js).
const {
  SKIP_NO_ZH_TW,
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
} = require('./helpers/reconciliation-locale');

const hookPath = resolve(__dirname, '../../hooks/session-init.sh');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Uses real jq (required: jq >= 1.6)

function runHook({ cwd, input, env = {} }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
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

test('a new session clears strategic_reset_fired, stall_streak and stall_memory along with current_round', () => {
  // The two must move together. The R10 checkpoint fires on `current_round`, which this hook
  // zeroes, and both channels refuse to fire while the flag is true
  // (post-tool-review-state.sh requires fired_before == "false"; post-compact-auto-loop.sh
  // requires RESET_FIRED != "true"). A flag preserved across the reset would therefore make the
  // checkpoint unreachable for every change after the first one that ever fired it — a latch
  // lasting the state file's lifetime. It was correct to preserve under the ORIGINAL cumulative
  // `total_rounds_session` threshold; keying the checkpoint to current_round is what changed it.
  const workDir = makeTempDir('sd0x-session-init-reset-flag-');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 3,
      session_id: 'session-that-hit-the-checkpoint',
      iteration_history: {
        current_round: 14,
        total_rounds_session: 14,
        strategic_reset_fired: true,
        stall_streak: 2,
        stall_memory: [{ class: 'DOC_TOO_LONG', tried: 'split the spec', outcome: 'no change', ts: '2026-08-07T12:00:00Z' }],
        findings_by_round: [{ round: 14, total: 2 }],
      },
    })
  );
  const result = runHook({ cwd: workDir, input: { session_id: 'fresh-session' } });
  assert.equal(result.status, 0);

  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));
  assert.equal(state.iteration_history.current_round, 0);
  assert.equal(
    state.iteration_history.strategic_reset_fired,
    false,
    'a preserved flag would silently disable the checkpoint for the whole next session'
  );
  // The streak counts rounds and the memory is scoped to one change, so both belong to the same
  // lifetime as current_round. A streak carried into a fresh session lets [LOOP_STALL] fire on
  // rounds that never happened there; a carried memory replays adjustments from a change that is
  // no longer under review.
  assert.equal(state.iteration_history.stall_streak, 0, 'a carried streak fires the stall signal on rounds this session never ran');
  assert.deepEqual(state.iteration_history.stall_memory, [], 'a carried memory replays another change\'s adjustments');
  assert.equal(state.iteration_history.total_rounds_session, 14, 'the cumulative counter still survives');
});

test('KNOWN DEFECT — session-init does NOT reset review_mode, so dual survives across sessions', () => {
  // Pins current behaviour, not desired behaviour. The SessionStart transaction
  // (hooks/session-init.sh) rewrites session_id, both change flags, the three review receipts,
  // aggregate_gate, current_round, findings_by_round and session_commit_scope — and nothing else.
  // `review_mode` is outside it, and no `dual → single` downgrade exists anywhere in the repo, so
  // one `/codex-review-branch --dual` pins every later session into strict (stop-guard.sh:577)
  // until the state file is rebuilt or hand-edited.
  //
  // Fixing the reset is deliberately OUT of scope for R1 — it changes the enforcement lifecycle,
  // not the signal layer. See docs/features/auto-loop-autonomy/requests/
  // 2026-07-26-dual-mode-signal-repair-r1.md § Scope. When a later ticket does reset it, this test
  // is expected to fail; flip the assertion then rather than deleting it.
  const workDir = makeTempDir('sd0x-session-init-dual-persist-');

  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'old-session-abc',
      review_mode: 'dual',
      has_code_change: true,
      code_review: { executed: true, passed: true },
      aggregate_gate: { executed: true, gate: 'READY' },
      iteration_history: { current_round: 5, total_rounds_session: 8, findings_by_round: [] },
    })
  );
  const result = runHook({ cwd: workDir, input: { session_id: 'new-session-xyz' } });
  assert.equal(result.status, 0);
  const state = JSON.parse(readFileSync(join(workDir, '.claude_review_state.json'), 'utf8'));

  // The reset itself did happen — this is not a no-op session.
  assert.equal(state.session_id, 'new-session-xyz');
  assert.equal(state.code_review.passed, false, 'the receipts ARE reset');
  assert.equal(state.aggregate_gate.executed, false, 'and so is the aggregate gate');

  // …but the mode that governs how those receipts are judged is not.
  assert.equal(state.review_mode, 'dual',
    'review_mode survives SessionStart — a new session inherits strict blocking it never opted into');
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

// Conditional cleanup: a sidecar is only a true orphan when the tree is clean.
// If reviewable files are still dirty, the marker may flag a real unreviewed
// edit from the crashed session and must survive the reset (fail-closed), since
// the reset sets has_code_change=false and reconciliation never re-raises it.

test('session-init: new session KEEPS sidecar when a dirty code file exists', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-dirty-code-');
  setupGitRepo(workDir);
  writeFileSync(join(workDir, 'unreviewed.ts'), 'export const x = 1;\n');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'dirty code file → sidecar must survive so the gate re-engages (fail-closed)'
  );
});

test('session-init: new session KEEPS sidecar when a wholly-new untracked DIRECTORY holds a code file (-uall regression)', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-newdir-');
  setupGitRepo(workDir);
  // The code file lives in a BRAND-NEW untracked directory. Under plain `-unormal`,
  // git collapses this to a single `?? newdir/` porcelain entry, which matches NEITHER
  // extension grep → the tree reads "clean" → the fail-closed sidecar is wrongly deleted
  // and the crashed session's unreviewed edit loses its only trace. `-uall` expands it to
  // `?? newdir/app.ts`, which matches the code-extension grep → sidecar survives. This
  // test would FAIL on pre-`-uall` code (the top-level `unreviewed.ts` test above matches
  // under both flags, so it cannot pin this fix).
  mkdirSync(join(workDir, 'newdir'));
  writeFileSync(join(workDir, 'newdir', 'app.ts'), 'export const y = 2;\n');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'a new untracked directory containing a code file must keep the sidecar (needs -uall enumeration)'
  );
});

test('session-init: KEEPS sidecar when the sole dirty reviewable file is inside an UNREADABLE dir (git omits it → fail-closed, Codex iter-19 P2)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root can open 0o000 dirs, so git emits no directory-omission warning' : SKIP_NO_ZH_TW }, () => {
  // `git status -uall` exits 0 even when it could not open an unreadable directory — it WARNS on
  // stderr ("could not open directory 'X/'") and OMITS that subtree, so the sole unreviewed file
  // inside it never reaches the porcelain grep. A stderr-DISCARDING scan then reads empty porcelain →
  // "clean" → the crashed session's ONLY fail-closed marker is deleted (fail-OPEN). Capturing stderr
  // and treating the omission as unverifiable → dirty keeps the sidecar.
  // Non-tautology: revert the branches to `2>/dev/null` (drop the _omitted check) → empty porcelain
  // reads clean → the sidecar is deleted → this assertion fails.
  const workDir = makeTempDir('sd0x-session-sidecar-unreadable-');
  setupGitRepo(workDir);
  // Commit everything so the ONLY dirty element is the unreadable dir below (no other dirty signal
  // could keep the sidecar alive for an unrelated reason — keeps the test non-tautological).
  spawnSync('git', ['add', '-A'], { cwd: workDir });
  spawnSync('git', ['commit', '-m', 'clean baseline', '--allow-empty'], { cwd: workDir });
  const hidden = join(workDir, 'locked');
  mkdirSync(hidden);
  writeFileSync(join(hidden, 'unreviewed.ts'), 'export const x = 1;\n'); // sole unreviewed reviewable file
  chmodSync(hidden, 0o000); // git cannot open it → warns + omits the subtree
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  // Ambient zh-TW locale exercises git's LOCALIZED omission warning ("警告: 無法開啟目錄…") on
  // locale-capable hosts; the hook forces LC_ALL=C on its scan so the warning is always the English
  // form its regex matches. Dropping that LC_ALL=C makes the regex miss the translated warning here
  // → sidecar wrongly deleted (locale-dependent fail-open) → this assertion fails.
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-sess' },
    env: { LC_ALL: 'zh_TW.UTF-8', LANG: 'zh_TW.UTF-8', LANGUAGE: 'zh_TW:zh' },
  });
  chmodSync(hidden, 0o755); // restore before assertions so the after() cleanup can recurse in
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'an unreadable dir git could not scan is unverifiable → sidecar must survive (fail-closed)'
  );
});

test('session-init: KEEPS sidecar when mktemp fails so the omission scan cannot be captured (fail-closed, iter-20 P2)', (t) => {
  // The dirty-reviewable scan uses `mktemp` (no-arg) to capture git's stderr. If mktemp fails, the
  // prior `_redir="${_serr:-/dev/null}"` routed stderr to /dev/null → a directory omission went
  // unseen → the scan read "clean" → the caller DELETED the sole .blocked fail-closed marker (silent
  // fail-OPEN). The fix returns "dirty" (preserve the sidecar) when mktemp fails — unverifiable ≠ clean.
  // Shim mktemp to fail ONLY the no-arg form the scan uses, and pass the TEMPLATED form
  // (`mktemp "<state>.XXXXXX"`, used by the atomic state writes) through to the real mktemp so the rest
  // of the hook still functions. Non-tautology: restore the `${_serr:-/dev/null}` fallback and this
  // clean tree reads "clean" → the sidecar is deleted → the assertion fails.
  const realMktemp = spawnSync('sh', ['-c', 'command -v mktemp'], { encoding: 'utf8' }).stdout.trim();
  // Report a real SKIP rather than returning early: a bare `return` produces a test with ZERO
  // assertions that the runner still prints as `ok`, so an environment where this guard can never
  // run looks indistinguishable from one where the fail-closed behaviour was verified.
  if (!realMktemp) {
    t.skip('mktemp is not resolvable on PATH — cannot shim it');
    return;
  }
  const workDir = makeTempDir('sd0x-session-sidecar-mktempfail-');
  const shimDir = makeTempDir('sd0x-mktemp-shim-');
  setupGitRepo(workDir);
  writeFileSync(join(workDir, '.gitignore'), '/.claude_review_state.json\n');
  spawnSync('git', ['add', '.gitignore'], { cwd: workDir });
  spawnSync('git', ['commit', '-m', 'clean baseline', '--allow-empty'], { cwd: workDir });
  writeFileSync(
    join(shimDir, 'mktemp'),
    ['#!/bin/sh', '[ "$#" -eq 0 ] && exit 1', `exec ${realMktemp} "$@"`, ''].join('\n')
  );
  chmodSync(join(shimDir, 'mktemp'), 0o755);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-sess' },
    env: { PATH: `${shimDir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'mktemp failure makes the tree unverifiable → sidecar must survive (fail-closed), not be deleted'
  );
});

test('session-init: new session DELETES sidecar when git tree is clean', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-clean-');
  setupGitRepo(workDir);
  // Commit everything so the tree is clean (setupGitRepo leaves an initial commit)
  spawnSync('git', ['add', '-A'], { cwd: workDir });
  spawnSync('git', ['commit', '-m', 'clean', '--allow-empty'], { cwd: workDir });
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess' })
  );
  spawnSync('git', ['add', '.claude_review_state.json'], { cwd: workDir });
  // A tracked state file with only the sidecar dirty is not a reviewable-code change.
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });
  assert.equal(result.status, 0);
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'clean tree → sidecar is a true orphan, safe to clear'
  );
});

// Tri-state fail-closed: inside a git repo, a FAILED `git status` is "unknown",
// not "clean". The sidecar must survive a transient status failure — deleting on
// uncertainty would erase a real unreviewed edit's only trace. Simulated with a
// git shim that fails the plain `--porcelain` dirty check but lets the NUL-safe
// `--porcelain -z` baseline capture succeed, so the hook still completes.
test('session-init: KEEPS sidecar when git status fails in a git repo (fail-closed)', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-gitfail-');
  const shimDir = makeTempDir('sd0x-git-shim-');
  writeFileSync(
    join(shimDir, 'git'),
    [
      '#!/usr/bin/env bash',
      'case "$1" in',
      '  rev-parse) echo ".git"; exit 0 ;;', // we ARE in a git repo
      '  status)',
      '    for a in "$@"; do [ "$a" = "-z" ] && exit 0; done', // baseline capture succeeds (empty)
      '    exit 1 ;;', // plain porcelain dirty check fails → "unknown"
      'esac',
      'exit 0',
      '',
    ].join('\n')
  );
  chmodSync(join(shimDir, 'git'), 0o755);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess' })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');
  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-sess' },
    env: { PATH: `${shimDir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'git status failure in a git repo → cannot prove clean → sidecar must survive (fail-closed)'
  );
});

test('session-init: a NON-C-locale directory-omission warning KEEPS the sidecar (host-independent)', (t) => {
  // Host-independent complement to the real-git test above, which skips wherever zh_TW.UTF-8 is not
  // installed — including ubuntu-latest CI, whose `locale -a` lists only C/C.utf8/POSIX/en_US.utf8.
  // There the LC_ALL=C fix was never actually exercised, so a revert would still have gone green.
  // The locale-aware stub git reproduces git's warn-and-omit contract with no installed locale:
  // English warning iff LC_ALL is C/POSIX, a non-ASCII form otherwise. With a non-C ambient locale,
  // a hook that failed to force LC_ALL=C reads the localized text, its English-only regex misses it,
  // the empty (dir-omitted) listing scans as "clean", and the crashed session's sole fail-closed
  // marker is deleted.
  const binDir = makeTempDir('sd0x-session-init-recon-bin-');
  // perl is extra here: the hook reaches its exit only via the perl-based `_capture_baseline` that
  // runs after the sidecar decision, so without it the run aborts at 127 before returning.
  if (!setupLocaleAwareGitBin(binDir, ['perl'])) {
    t.skip('real coreutils/perl unresolvable on this host');
    return;
  }
  const workDir = makeTempDir('sd0x-session-init-recon-work-');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess', code_review: { executed: true, passed: false } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'BLOCKED');

  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-sess' },
    env: { PATH: binDir, ...AMBIENT_NON_C_ENV },
  });

  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'an un-enumerable tree is unverifiable → the sidecar must survive at any ambient locale'
  );
});

// ---------------------------------------------------------------------------
// Codex doc-review iter-21 P1: the orphan-sidecar cleanup ran completely unlocked
// ---------------------------------------------------------------------------
// `rules/auto-loop.md` claims every sidecar mutation takes SIDECAR_LOCKDIR. Both cleanup sites
// here were a bare `[[ -f sidecar ]] && ! _tree_has_dirty_reviewable && rm -f` — the scan shells
// out to `git status -uall`, seconds wide on a large tree, and a concurrent post-edit-format.sh /
// post-tool-review-state.sh appending a `verdict_write_failed:*` marker in that window had it
// unlinked. That marker stands for a LOST BLOCKING VERDICT whose gate is still at the previous
// round's passed=true, so erasing it is fail-OPEN in the one direction the whole sidecar exists
// to prevent (losing a PASS is safe; losing a ⛔ is not).

function realGit() {
  const r = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  return (r.stdout || '').trim();
}

// Stub git that delegates to the real binary but records every invocation's argv to a witness
// file. Only `_tree_has_dirty_reviewable` passes `-uall`; `_capture_baseline` uses `-z`. That
// makes "-uall appears in the witness" a precise probe for "the scan actually ran".
function setupWitnessGit(dir) {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const witness = join(dir, 'git-calls.log');
  const shim = join(binDir, 'git');
  writeFileSync(
    shim,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(witness)}\nexec ${JSON.stringify(realGit())} "$@"\n`
  );
  chmodSync(shim, 0o755);
  return { witness, pathPrefix: `${binDir}:${process.env.PATH}` };
}

function makeCleanRepoWithSidecar(prefix) {
  const workDir = makeTempDir(prefix);
  setupGitRepo(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ session_id: 'old-sess' })
  );
  spawnSync('git', ['add', '.claude_review_state.json'], { cwd: workDir });
  writeFileSync(
    join(workDir, '.claude_review_state.json.blocked'),
    'verdict_write_failed:code_review\n'
  );
  return workDir;
}

// A corrupt state file must not be able to make emergency markers immortal.
//
// `OLD_SESSION_ID=$(jq -r '.session_id // empty' "$STATE_FILE")` was a BARE assignment under
// `set -euo pipefail`, and jq exits non-zero on exactly the inputs this reset exists to clean up:
// 2 for malformed JSON, 5 for a type error (indexing a non-object). The hook therefore died at
// that line — and everything that matters here sits BELOW it. `_clear_orphan_sidecar` is the ONLY
// retirement path for per-event `.blocked.event.*` markers, so a single unparseable byte in the
// state file pinned every such marker forever, and stop-guard reads a marker as a lost blocking
// verdict: every subsequent session blocked, with the cause two hooks away from the symptom.
for (const [label, corruptBody] of [
  ['unterminated object', '{"session_id": "old-sess"'],
  ['top-level array — a valid JSON document that cannot be indexed', '[{"session_id": "old-sess"}]'],
]) {
  test(`session-init: a corrupt state file (${label}) still retires orphan per-event markers`, () => {
    const workDir = makeTempDir('sd0x-session-corrupt-state-');
    setupGitRepo(workDir);
    const statePath = join(workDir, '.claude_review_state.json');
    writeFileSync(statePath, corruptBody);
    const marker = join(workDir, '.claude_review_state.json.blocked.event.deadbeef');
    writeFileSync(marker, 'verdict_write_failed:code_review\n');

    // Non-vacuity: the fixture must really make jq exit non-zero. Against a state file jq reads
    // happily, the old bare assignment would have behaved identically and this test would prove
    // nothing. (Both shapes report 5 on jq 1.7 — the point is the failure, not its number.)
    const probe = spawnSync('jq', ['-r', '.session_id // empty', '.claude_review_state.json'], { cwd: workDir });
    assert.notEqual(probe.status, 0, 'fixture must make jq fail, otherwise the test is vacuous');

    const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

    assert.equal(result.status, 0, `hook must survive a corrupt state file; stderr: ${result.stderr}`);
    assert.equal(
      existsSync(marker),
      false,
      'the clean-tree orphan clear runs BELOW this read — a corrupt state file must not make the marker immortal'
    );
    // The reset itself cannot succeed here (its own jq reads the same unparseable bytes), and that
    // is correct: the file is left exactly as found for stop-guard's corrupt-state guard to force
    // strict on. What must NOT happen is a half-written or emptied file, which several readers
    // treat as "absent" rather than "corrupt" — a downgrade from fail-closed to fail-open.
    assert.equal(readFileSync(statePath, 'utf8'), corruptBody, 'a failed rewrite must leave the original bytes intact');
    const strays = readdirSync(workDir).filter((f) => /^\.claude_review_state\.json\.[A-Za-z0-9]{6}$/.test(f));
    assert.deepEqual(strays, [], `a failed rewrite must clean up its staging file, found: ${strays.join(', ')}`);
  });
}

test('session-init: a HELD sidecar lock makes cleanup decline rather than clear', () => {
  const workDir = makeCleanRepoWithSidecar('sd0x-session-sidecar-locked-');
  // A live lock: fresh ts, well inside the 30s TTL, so the steal-on-stale path must not fire.
  const lockDir = join(workDir, '.claude_review_state.json.blocked.lockdir');
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000)));

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

  assert.equal(result.status, 0, 'a contended lock must never block session start');
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'lock unavailable → retain the marker; deleting on an unserialized read is the fail-open'
  );
  assert.match(result.stderr, /sidecar lock unavailable — retaining/);
});

test('session-init: the lock is taken BEFORE the tree scan, not around the unlink alone', () => {
  // The ordering is the entire fix. Locking only the `rm` still leaves the scan window open, and
  // no black-box outcome distinguishes the two orderings — except this: with the lock already
  // held, a lock-first implementation returns without ever paying for `git status -uall`.
  const workDir = makeCleanRepoWithSidecar('sd0x-session-sidecar-order-');
  const { witness, pathPrefix } = setupWitnessGit(workDir);
  const lockDir = join(workDir, '.claude_review_state.json.blocked.lockdir');
  mkdirSync(lockDir);
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000)));

  const result = runHook({
    cwd: workDir,
    input: { session_id: 'new-sess' },
    env: { PATH: pathPrefix },
  });

  assert.equal(result.status, 0);
  const calls = existsSync(witness) ? readFileSync(witness, 'utf8') : '';
  assert.ok(calls.length > 0, 'the shim must actually be on PATH — otherwise this proves nothing');
  assert.ok(
    !/-uall/.test(calls),
    'lock held → the scan must be skipped entirely; a -uall call means the scan ran unserialized first'
  );
});

test('session-init: a STALE sidecar lock is stolen so an orphan still gets cleared', () => {
  const workDir = makeCleanRepoWithSidecar('sd0x-session-sidecar-stale-');
  const lockDir = join(workDir, '.claude_review_state.json.blocked.lockdir');
  mkdirSync(lockDir);
  // Older than SIDECAR_LOCK_TTL (30s) → the holder is presumed dead. Without the steal path a
  // crashed writer would wedge every future session's cleanup permanently.
  writeFileSync(join(lockDir, 'ts'), String(Math.floor(Date.now() / 1000) - 120));

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

  assert.equal(result.status, 0);
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'stale lock → steal → clean tree → the orphan is cleared as before'
  );
});

test('session-init: the sidecar lock is released after a successful clear', () => {
  const workDir = makeCleanRepoWithSidecar('sd0x-session-sidecar-release-');

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

  assert.equal(result.status, 0);
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'uncontended clean tree → orphan cleared (the pre-existing behavior must survive the rework)'
  );
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked.lockdir')),
    'a leaked lockdir would degrade every sidecar mutation for a full TTL'
  );
});

// A marker filename may legally contain a newline, and the orphan sweep is the one place in the
// system that deletes by name. Round-tripping the glob results through a newline-delimited string
// (`_sc_markers=$(_sidecar_marker_files)` + `while IFS= read -r`) split ONE crafted name into TWO
// `rm` targets, the second an arbitrary repository-relative path. The delete was never the flaw —
// the parsing step that decided WHAT to delete was, exactly as with the `.blocked.d/` symlink
// before it. Same precondition as that one: this sweep fires on a NEW session over a clean tree,
// so a fresh clone is enough to arm it (`.claude_review_state.json.*` is gitignored in real repos,
// but a marker is planted by the hooks themselves, not by the clone).
test('session-init: a newline-bearing marker name cannot turn the orphan sweep into a repo-file delete', () => {
  const workDir = makeTempDir('sd0x-session-sidecar-newline-');
  // Victim first, so `git add .` inside setupGitRepo commits it and the tree stays clean.
  writeFileSync(join(workDir, 'package.json'), '{"name":"victim"}\n');
  setupGitRepo(workDir);
  writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify({ session_id: 'old-sess' }));
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'verdict_write_failed:code_review\n');
  // The exploit: one file, whose name's second line is a path relative to the repo root.
  const crafted = join(workDir, '.claude_review_state.json.blocked.event.seed\npackage.json');
  writeFileSync(crafted, 'state_write_failed:code\n');

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

  assert.equal(result.status, 0, `hook must survive a newline-bearing marker; stderr: ${result.stderr}`);
  // Non-vacuity: the sweep must actually have reached its destructive branch. Without this, a
  // hook that declined for any reason (dirty tree, lock, an early return) would "pass" the
  // victim-survives assertion while proving nothing about the parsing.
  assert.equal(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    false,
    'precondition: the clean-tree sweep must have run and cleared the shared sidecar'
  );
  assert.equal(
    existsSync(join(workDir, 'package.json')),
    true,
    'a marker name is data, not a separator — the second line must never become an rm target'
  );
  // And the marker itself is retired BY ITS REAL NAME. Under the split, `rm` was handed two names
  // neither of which was the file, so the crafted marker survived to fire again next session —
  // an unclearable strict-mode block on top of the deletion.
  assert.equal(existsSync(crafted), false, 'the crafted marker must be retired by its exact name');
});

test('session-init: a dirty tree leaves the lock released and the marker intact', () => {
  const workDir = makeCleanRepoWithSidecar('sd0x-session-sidecar-dirty-');
  writeFileSync(join(workDir, 'unreviewed.ts'), 'export const x = 1;');

  const result = runHook({ cwd: workDir, input: { session_id: 'new-sess' } });

  assert.equal(result.status, 0);
  assert.ok(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    'dirty reviewable file → the marker may flag a real unreviewed edit → retain'
  );
  assert.ok(
    !existsSync(join(workDir, '.claude_review_state.json.blocked.lockdir')),
    'the decline path must unlock too — only the lock-acquisition failure skips the unlock'
  );
});

// ---------------------------------------------------------------------------
// Orphan .blocked clear — ownership re-checked at the destructive step
// ---------------------------------------------------------------------------

// This hook is where a mid-section takeover is an ORDINARY outcome rather than a thought
// experiment: `_clear_orphan_sidecar` takes the sidecar lock and then runs
// `_tree_has_dirty_reviewable`, i.e. a `git status -uall`, which on a large untracked tree takes
// tens of seconds — comfortably past the 30s TTL that `_sidecar_lock` reclaims on. A contender
// then legitimately owns the lock while this hook is still mid-scan, and the unlink that follows
// would destroy a marker the new owner had just raised for an edit this scan never saw: a lost
// blocking verdict with the gate still reading `passed=true`.
//
// The shim models exactly that — it hands ownership away at the `status` call, which is the slow
// step, then execs the real git so the tree's actual cleanliness still decides the outcome.
function installTakeoverGit(binDir) {
  const shim = [
    '#!/bin/bash',
    'for a in "$@"; do',
    '  if [[ "$a" == "status" ]]; then',
    '    if [[ -n "${SD0X_TAKEOVER_LOCKDIR:-}" && -d "$SD0X_TAKEOVER_LOCKDIR" ]]; then',
    "      printf '%s' 'sd0x-foreign-owner' > \"$SD0X_TAKEOVER_LOCKDIR/owner\"",
    '    fi',
    '    break',
    '  fi',
    'done',
    '# binDir is the FIRST PATH element below, so stripping it prevents self-exec.',
    'export PATH="${PATH#*:}"',
    'exec git "$@"',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'git'), shim);
  chmodSync(join(binDir, 'git'), 0o755);
}

function runOrphanClear(takeover) {
  const workDir = makeTempDir('sd0x-session-init-orphan-takeover-');
  const binDir = makeTempDir('sd0x-session-init-orphan-bin-');
  installTakeoverGit(binDir);
  // A real repo with a genuinely clean tree: the clear's precondition must hold, so that whether
  // the marker survives is decided by the ownership re-check and nothing else.
  spawnSync('git', ['init', '-q'], { cwd: workDir });
  const sidecar = join(workDir, '.claude_review_state.json.blocked');
  writeFileSync(sidecar, 'verdict_write_failed:code_review\n');
  const env = { PATH: `${binDir}:${process.env.PATH}` };
  if (takeover) env.SD0X_TAKEOVER_LOCKDIR = join(workDir, '.claude_review_state.json.blocked.lockdir');
  // No state file → the creation branch, which ends in `_clear_orphan_sidecar`.
  const result = runHook({ cwd: workDir, input: { session_id: 'orphan-clear-session' }, env });
  return { result, survived: existsSync(sidecar) };
}

test('session-init: orphan sidecar clear declines when the lock was taken over mid-scan', () => {
  // Control: on a clean tree with the lock held throughout, the orphan IS cleared. Without this
  // the test would pass against a hook that never clears at all.
  const control = runOrphanClear(false);
  assert.equal(control.result.status, 0);
  assert.equal(
    control.survived,
    false,
    'control: a clean tree with an uncontended lock must still retire the orphan'
  );

  const contended = runOrphanClear(true);
  assert.equal(contended.result.status, 0, 'declining to clear is not an error');
  assert.equal(
    contended.survived,
    true,
    "a displaced writer must not delete the new owner's marker, however clean the tree looked"
  );
  assert.match(contended.result.stderr, /clear abandoned — lock was taken over/);
});
