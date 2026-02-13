const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/next-step/scripts/analyze.js');
const tempDirs = [];

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-ns-'));
  tempDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' }
  );
  return dir;
}

function writeReviewState(dir, overrides = {}) {
  const state = {
    session_id: '',
    updated_at: new Date().toISOString(),
    has_code_change: false,
    has_doc_change: false,
    code_review: { executed: false, passed: false, last_run: '' },
    doc_review: { executed: false, passed: false, last_run: '' },
    precommit: { executed: false, passed: false, last_run: '' },
    ...overrides,
  };
  writeFileSync(join(dir, '.claude_review_state.json'), JSON.stringify(state, null, 2));
}

function runAnalyze(dir, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--json', ...extraArgs], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    // Non-zero exit code — still parse stdout
    const stdout = (err.stdout || '').toString();
    try {
      return { output: JSON.parse(stdout), exitCode: err.status };
    } catch {
      return { output: null, exitCode: err.status, raw: stdout, stderr: (err.stderr || '').toString() };
    }
  }
}

function addAndCommitFile(dir, filePath, content) {
  const full = join(dir, filePath);
  mkdirSync(join(dir, filePath, '..'), { recursive: true });
  writeFileSync(full, content);
  execFileSync('git', ['add', filePath], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', `add ${filePath}`],
    { cwd: dir, stdio: 'ignore' }
  );
}

function stageFile(dir, filePath, content) {
  const full = join(dir, filePath);
  mkdirSync(join(dir, filePath, '..'), { recursive: true });
  writeFileSync(full, content);
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1: No changes, clean state (on non-main branch)
// ---------------------------------------------------------------------------
test('no changes, clean state — 0 findings, exit 0', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/test'], { cwd: dir, stdio: 'ignore' });
  // Write review state and commit it so it's not untracked
  writeReviewState(dir);
  writeFileSync(join(dir, '.gitignore'), '');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output, exitCode } = runAnalyze(dir);
  assert.equal(exitCode, 0);
  assert.equal(output.findings.length, 0);
  assert.equal(output.diff_summary.total, 0);
});

// ---------------------------------------------------------------------------
// Test 2: Code changed, no review
// ---------------------------------------------------------------------------
test('code changed, no review — P0 gate-missing-code', () => {
  const dir = createTempRepo();
  // Create a dirty .js file so hasChanges=true
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/foo.js', 'a');
  writeFileSync(join(dir, 'src/foo.js'), 'b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output, exitCode } = runAnalyze(dir);
  assert.equal(exitCode, 2);
  const f = output.findings.find(f => f.id === 'gate-missing-code');
  assert.ok(f, 'gate-missing-code finding should exist');
  assert.equal(f.priority, 'P0');
});

// ---------------------------------------------------------------------------
// Test 3: src/ changed, no test/ in diff
// ---------------------------------------------------------------------------
test('src/ changed, no test/ — P1 test-gap', () => {
  const dir = createTempRepo();
  // Create src/ directory so profile gating passes
  mkdirSync(join(dir, 'src', 'service'), { recursive: true });
  addAndCommitFile(dir, 'src/service/foo.ts', 'export const foo = 1;');
  // Now modify the file to create a diff against HEAD~1
  writeFileSync(join(dir, 'src/service/foo.ts'), 'export const foo = 2;');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.ok(f, 'test-gap finding should exist');
  assert.equal(f.priority, 'P1');
});

// ---------------------------------------------------------------------------
// Test 4: Auth file touched
// ---------------------------------------------------------------------------
test('auth file touched — P1 security-hotspot', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  addAndCommitFile(dir, 'src/auth/login.ts', 'export function login() {}');
  writeFileSync(join(dir, 'src/auth/login.ts'), 'export function login() { return true; }');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'security-hotspot');
  assert.ok(f, 'security-hotspot finding should exist');
  assert.equal(f.priority, 'P1');
});

// ---------------------------------------------------------------------------
// Test 5: New command, no README
// ---------------------------------------------------------------------------
test('new command added, no README — P2 readme-missing', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'commands'), { recursive: true });
  addAndCommitFile(dir, 'commands/existing.md', '# existing');
  // Add a new command file (uncommitted change via diff HEAD)
  writeFileSync(join(dir, 'commands/new-cmd.md'), '# new');
  // Stage + commit so it shows in diff HEAD~1..HEAD style
  // Actually, git diff HEAD shows unstaged changes, so just write it
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'readme-missing');
  assert.ok(f, 'readme-missing finding should exist');
  assert.equal(f.priority, 'P2');
});

// ---------------------------------------------------------------------------
// Test 6: Locale drift
// ---------------------------------------------------------------------------
test('locale drift — P2 when partial README update', () => {
  const dir = createTempRepo();
  // Create multiple README files
  addAndCommitFile(dir, 'README.md', '# Main');
  addAndCommitFile(dir, 'README.zh-TW.md', '# 中文');
  addAndCommitFile(dir, 'README.ja.md', '# 日本語');
  // Only modify README.md (not the others)
  writeFileSync(join(dir, 'README.md'), '# Main v2');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'locale-drift');
  assert.ok(f, 'locale-drift finding should exist');
  assert.equal(f.priority, 'P2');
  assert.ok(f.message.includes('1/3'), `Expected 1/3 in message, got: ${f.message}`);
});

// ---------------------------------------------------------------------------
// Test 7: On main branch
// ---------------------------------------------------------------------------
test('on main branch — P3 main-branch', () => {
  const dir = createTempRepo();
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'main-branch');
  assert.ok(f, 'main-branch finding should exist');
  assert.equal(f.priority, 'P3');
});

// ---------------------------------------------------------------------------
// Test 8: Max findings cap
// ---------------------------------------------------------------------------
test('max findings cap — suppressed count correct', () => {
  const dir = createTempRepo();
  // Create conditions for many findings
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'commands'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'test-skill'), { recursive: true });
  addAndCommitFile(dir, 'src/auth.ts', 'a');
  addAndCommitFile(dir, 'src/token.ts', 'b');
  addAndCommitFile(dir, 'src/password.ts', 'c');
  addAndCommitFile(dir, 'commands/a.md', 'x');
  addAndCommitFile(dir, 'skills/test-skill/SKILL.md', 'y');
  addAndCommitFile(dir, 'README.md', 'r1');
  addAndCommitFile(dir, 'README.zh-TW.md', 'r2');
  addAndCommitFile(dir, 'migration/001.sql', 'z');
  // Dirty all files
  writeFileSync(join(dir, 'src/auth.ts'), 'a2');
  writeFileSync(join(dir, 'src/token.ts'), 'b2');
  writeFileSync(join(dir, 'src/password.ts'), 'c2');
  writeFileSync(join(dir, 'commands/a.md'), 'x2');
  writeFileSync(join(dir, 'skills/test-skill/SKILL.md'), 'y2');
  writeFileSync(join(dir, 'README.md'), 'r1b');
  writeFileSync(join(dir, 'migration/001.sql'), 'z2');
  writeReviewState(dir, {
    has_code_change: true,
    has_doc_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
    doc_review: { executed: false, passed: false, last_run: '' },
  });

  // Use max-findings 3 to test capping
  const { output } = runAnalyze(dir, ['--max-findings', '3']);
  assert.equal(output.findings.length, 3);
  assert.ok(output.suppressed > 0, `Expected suppressed > 0, got ${output.suppressed}`);
});

// ---------------------------------------------------------------------------
// Test 9: State file missing — graceful fallback
// ---------------------------------------------------------------------------
test('state file missing — graceful fallback, no crash', () => {
  const dir = createTempRepo();
  // No writeReviewState — file does not exist

  const { output, exitCode } = runAnalyze(dir);
  assert.ok(output, 'Should produce valid output without state file');
  assert.equal(output.version, 2);
  // Only main-branch finding (no state-related findings)
  const stateFindings = output.findings.filter(f =>
    f.id.startsWith('gate-') || f.id === 'state-drift'
  );
  assert.equal(stateFindings.length, 0, 'No gate findings without state file');
});

// ---------------------------------------------------------------------------
// Test 10: Profile gating — no src/ dir, skip test-gap
// ---------------------------------------------------------------------------
test('profile gating — no source dir, test-gap not emitted', () => {
  const dir = createTempRepo();
  // Create a file outside all source prefixes (src/, lib/, app/, pkg/)
  addAndCommitFile(dir, 'scripts/utils.js', 'a');
  writeFileSync(join(dir, 'scripts/utils.js'), 'a2');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.equal(f, undefined, 'test-gap should NOT fire without source directory');
});

// ---------------------------------------------------------------------------
// Test 11: Rename detected in diff
// ---------------------------------------------------------------------------
test('rename detected — file counted in diff summary with renamed status', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/rename-test'], { cwd: dir, stdio: 'ignore' });
  addAndCommitFile(dir, 'src/old-name.js', 'export const x = 1;');
  // Rename via git mv (staged but NOT committed — shows as R100 in diff HEAD)
  execFileSync('git', ['mv', 'src/old-name.js', 'src/new-name.js'], { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  assert.ok(output.diff_summary.renamed > 0, `Expected renamed > 0, got ${output.diff_summary.renamed}`);
  assert.ok(output.diff_summary.total > 0, 'Should detect changed files');
});

// ---------------------------------------------------------------------------
// Test 12: Untracked directory expanded
// ---------------------------------------------------------------------------
test('untracked directory — files expanded into diff summary', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/untracked-dir'], { cwd: dir, stdio: 'ignore' });
  // Create an untracked directory with files
  mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true });
  writeFileSync(join(dir, 'newdir', 'a.js'), 'a');
  writeFileSync(join(dir, 'newdir', 'b.js'), 'b');
  writeFileSync(join(dir, 'newdir', 'sub', 'c.js'), 'c');
  writeReviewState(dir);
  // Commit review state so it's not untracked
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  // Should expand untracked directory into individual files
  assert.ok(output.diff_summary.added >= 3, `Expected at least 3 added files, got ${output.diff_summary.added}`);
  assert.ok(output.diff_summary.total >= 3, `Expected at least 3 total files, got ${output.diff_summary.total}`);
});

// ---------------------------------------------------------------------------
// Test 13: Stale code+doc state on clean worktree — suppresses gate-missing-code/doc
// ---------------------------------------------------------------------------
test('stale state on clean worktree — gate-missing-code and gate-missing-doc suppressed', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/stale'], { cwd: dir, stdio: 'ignore' });
  // State says both code AND doc changed, but worktree is clean
  writeReviewState(dir, {
    has_code_change: true,
    has_doc_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
    doc_review: { executed: false, passed: false, last_run: '' },
  });
  // Commit the state file so it's not untracked
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output, exitCode } = runAnalyze(dir);
  // Should have state-drift
  const drift = output.findings.find(f => f.id === 'state-drift');
  assert.ok(drift, 'state-drift should fire on clean worktree with stale state');
  // gate-missing-code: antecedent true (has_code_change=true, passed=false) but suppressed
  const gateCode = output.findings.find(f => f.id === 'gate-missing-code');
  assert.equal(gateCode, undefined, 'gate-missing-code should NOT fire on clean worktree');
  // gate-missing-doc: antecedent true (has_doc_change=true, passed=false) but suppressed
  const gateDoc = output.findings.find(f => f.id === 'gate-missing-doc');
  assert.equal(gateDoc, undefined, 'gate-missing-doc should NOT fire on clean worktree');
  assert.equal(exitCode, 2, 'state-drift is P0, exit code should be 2');
});

// ---------------------------------------------------------------------------
// Test 14: Stale precommit state on clean worktree — suppresses gate-missing-precommit
// ---------------------------------------------------------------------------
test('stale state on clean worktree — gate-missing-precommit suppressed', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/stale-pre'], { cwd: dir, stdio: 'ignore' });
  // State says review passed but precommit pending — but worktree is clean
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: false, passed: false, last_run: '' },
  });
  // Commit the state file so it's not untracked
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output, exitCode } = runAnalyze(dir);
  const drift = output.findings.find(f => f.id === 'state-drift');
  assert.ok(drift, 'state-drift should fire');
  // gate-missing-precommit: antecedent true (passed=true, precommit=false) but suppressed
  const gatePre = output.findings.find(f => f.id === 'gate-missing-precommit');
  assert.equal(gatePre, undefined, 'gate-missing-precommit should NOT fire on clean worktree');
  assert.equal(exitCode, 2, 'state-drift is P0');
});

// ---------------------------------------------------------------------------
// Test 15: Doc changed, no doc review — P0 gate-missing-doc
// ---------------------------------------------------------------------------
test('doc changed, no review — P0 gate-missing-doc', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'docs/update'], { cwd: dir, stdio: 'ignore' });
  addAndCommitFile(dir, 'docs/guide.md', '# Guide');
  writeFileSync(join(dir, 'docs/guide.md'), '# Updated Guide');
  writeReviewState(dir, {
    has_doc_change: true,
    doc_review: { executed: false, passed: false, last_run: '' },
  });

  const { output, exitCode } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'gate-missing-doc');
  assert.ok(f, 'gate-missing-doc should fire when docs changed and review not passed');
  assert.equal(f.priority, 'P0');
  assert.equal(exitCode, 2);
});

// ---------------------------------------------------------------------------
// Test 16: Gate uses computed required — code files in diff trigger gate
// ---------------------------------------------------------------------------
test('gate computed from diff — code files trigger code_review gate', () => {
  const dir = createTempRepo();
  // Review state does NOT have has_code_change, but diff has .js files
  mkdirSync(join(dir, 'lib'), { recursive: true });
  addAndCommitFile(dir, 'lib/foo.js', 'a');
  writeFileSync(join(dir, 'lib/foo.js'), 'b');
  writeReviewState(dir, {
    has_code_change: false, // state says no code change
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'gate-missing-code');
  assert.ok(f, 'gate-missing-code should fire based on computed gates even when has_code_change is false');
  assert.equal(f.priority, 'P0');
});

// ---------------------------------------------------------------------------
// Test 17: Python code triggers gate
// ---------------------------------------------------------------------------
test('Python .py file triggers code_review gate', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/app.py', 'print("hello")');
  writeFileSync(join(dir, 'src/app.py'), 'print("world")');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output, exitCode } = runAnalyze(dir);
  assert.equal(output.gates.code_review.required, true, '.py should trigger code gate');
  const f = output.findings.find(f => f.id === 'gate-missing-code');
  assert.ok(f, 'gate-missing-code should fire for Python files');
  assert.equal(exitCode, 2);
});

// ---------------------------------------------------------------------------
// Test 18: Go project skips test-gap
// ---------------------------------------------------------------------------
test('Go project — test-gap skipped due to co-located tests', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/main.go', 'package main');
  writeFileSync(join(dir, 'src/main.go'), 'package main\nfunc main() {}');
  // Create go.mod to signal Go ecosystem
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.equal(f, undefined, 'test-gap should NOT fire in Go projects');
});

// ---------------------------------------------------------------------------
// Test 19: Rust project skips test-gap
// ---------------------------------------------------------------------------
test('Rust project — test-gap skipped due to inline tests', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/lib.rs', 'fn main() {}');
  writeFileSync(join(dir, 'src/lib.rs'), 'fn main() { println!("hello"); }');
  // Create Cargo.toml to signal Rust ecosystem
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.equal(f, undefined, 'test-gap should NOT fire in Rust projects');
});

// ---------------------------------------------------------------------------
// Test 20: Vendor dir files ignored for gate
// ---------------------------------------------------------------------------
test('vendor dir files ignored — gate not triggered even with has_code_change', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/vendor'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
  addAndCommitFile(dir, 'node_modules/pkg/index.js', 'a');
  writeFileSync(join(dir, 'node_modules/pkg/index.js'), 'b');
  // Simulate hook behavior: has_code_change=true from hook (hook doesn't filter vendors)
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  assert.equal(output.gates.code_review.required, false, 'vendor .js should NOT trigger code gate');
  const f = output.findings.find(f => f.id === 'gate-missing-code');
  assert.equal(f, undefined, 'gate-missing-code should NOT fire for vendor-only edits');
});

// ---------------------------------------------------------------------------
// Test 21: Python test pattern recognized
// ---------------------------------------------------------------------------
test('Python test pattern — _test.py suppresses test-gap', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  addAndCommitFile(dir, 'src/service.py', 'class Service: pass');
  addAndCommitFile(dir, 'tests/test_service.py', 'def test_service(): pass');
  writeFileSync(join(dir, 'src/service.py'), 'class Service:\n  def run(self): pass');
  writeFileSync(join(dir, 'tests/test_service.py'), 'def test_service():\n  assert True');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.equal(f, undefined, 'test-gap should NOT fire when Python tests are in diff');
});

// ---------------------------------------------------------------------------
// Test 22: Multi-language file types counted
// ---------------------------------------------------------------------------
test('multi-language file types — .py and .rs both counted', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/multi-lang'], { cwd: dir, stdio: 'ignore' });
  addAndCommitFile(dir, 'app.py', 'a');
  addAndCommitFile(dir, 'lib.rs', 'b');
  writeFileSync(join(dir, 'app.py'), 'a2');
  writeFileSync(join(dir, 'lib.rs'), 'b2');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  assert.ok(output.file_types['.py'] > 0, 'file_types should include .py');
  assert.ok(output.file_types['.rs'] > 0, 'file_types should include .rs');
});

// ---------------------------------------------------------------------------
// Test 23: Feature context — branch feat/my-feature
// ---------------------------------------------------------------------------
test('feature context — branch feat/my-feature resolves key', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/my-feature'], { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir);
  // Commit state so worktree is clean
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  assert.ok(output.feature_context, 'feature_context should exist');
  assert.equal(output.feature_context.key, 'my-feature');
  assert.equal(output.feature_context.source, 'branch');
  assert.equal(output.feature_context.confidence, 'high');
});

// ---------------------------------------------------------------------------
// Test 24: doc-sync-needed fires
// ---------------------------------------------------------------------------
test('doc-sync-needed — P1 when precommit passed + feature docs exist + code changed', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/sync-test'], { cwd: dir, stdio: 'ignore' });
  // Create feature docs structure
  mkdirSync(join(dir, 'docs', 'features', 'sync-test'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'sync-test', '2-tech-spec.md'), '# Tech Spec');
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/foo.ts', 'export const x = 1;');
  // Now modify code file to create a diff
  writeFileSync(join(dir, 'src/foo.ts'), 'export const x = 2;');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output, exitCode } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'doc-sync-needed');
  assert.ok(f, 'doc-sync-needed should fire when precommit passed + feature docs + code changed');
  assert.equal(f.priority, 'P1');
  assert.ok(f.suggestion.includes('/update-docs'), 'suggestion should include /update-docs');
});

// ---------------------------------------------------------------------------
// Test 25: request-stale fires
// ---------------------------------------------------------------------------
test('request-stale — P1 when request status Pending but precommit passed', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/stale-req'], { cwd: dir, stdio: 'ignore' });
  // Create feature + request with Pending status
  mkdirSync(join(dir, 'docs', 'features', 'stale-req', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'stale-req', '2-tech-spec.md'), '# Tech Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'stale-req', 'requests', '2026-01-01-test.md'),
    '| Status | **Pending** |\n\n## Acceptance Criteria\n\n- [ ] Item 1\n- [x] Item 2'
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/bar.ts', 'a');
  writeFileSync(join(dir, 'src/bar.ts'), 'b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'request-stale');
  assert.ok(f, 'request-stale should fire when request is Pending and precommit passed');
  assert.equal(f.priority, 'P1');
});

// ---------------------------------------------------------------------------
// Test 26: ac-incomplete fires
// ---------------------------------------------------------------------------
test('ac-incomplete — P2 with correct N/M count', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/ac-check'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'ac-check', 'requests'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'features', 'ac-check', 'requests', '2026-01-01-test.md'),
    '## AC\n\n- [ ] Item 1\n- [ ] Item 2\n- [x] Item 3\n- [x] Item 4\n- [ ] Item 5'
  );
  writeReviewState(dir);
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add docs'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'ac-incomplete');
  assert.ok(f, 'ac-incomplete should fire when unchecked items exist');
  assert.equal(f.priority, 'P2');
  assert.ok(f.message.includes('3/5'), `Expected 3/5 in message, got: ${f.message}`);
});

// ---------------------------------------------------------------------------
// Test 27: feature-complete fires
// ---------------------------------------------------------------------------
test('feature-complete — P3 when all gates pass + no sync issues', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/complete-test'], { cwd: dir, stdio: 'ignore' });
  // Feature docs with no stale request
  mkdirSync(join(dir, 'docs', 'features', 'complete-test', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'complete-test', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'complete-test', 'requests', '2026-01-01-test.md'),
    '| Status | **Complete** |\n\n- [x] Done'
  );
  // Clean worktree (all changes committed) + all gates passed
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add all'],
    { cwd: dir, stdio: 'ignore' }
  );
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  // Commit review state too so worktree stays clean
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'feature-complete');
  assert.ok(f, 'feature-complete should fire when all gates pass and no sync issues');
  assert.equal(f.priority, 'P3');
});

// ---------------------------------------------------------------------------
// Test 28: Phase post_precommit
// ---------------------------------------------------------------------------
test('phase post_precommit — detected when precommit passed + no P0/P1', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/phase-test'], { cwd: dir, stdio: 'ignore' });
  // No feature docs → no doc-sync-needed or request-stale
  // Both src and test changed → no test-gap P1
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'test'), { recursive: true });
  addAndCommitFile(dir, 'src/x.ts', 'a');
  addAndCommitFile(dir, 'test/x.test.ts', 'test a');
  writeFileSync(join(dir, 'src/x.ts'), 'b');
  writeFileSync(join(dir, 'test/x.test.ts'), 'test b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  assert.equal(output.phase, 'post_precommit', `Expected post_precommit, got: ${output.phase}`);
});

// ---------------------------------------------------------------------------
// Test 29: next_actions ordering — sorted by confidence descending
// ---------------------------------------------------------------------------
test('next_actions — sorted by confidence descending', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/actions-test'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/a.ts', 'a');
  writeFileSync(join(dir, 'src/a.ts'), 'b');
  // Code changed, review not passed → P0 gate-missing-code
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  assert.ok(output.next_actions.length > 0, 'next_actions should have entries');
  for (let i = 1; i < output.next_actions.length; i++) {
    assert.ok(
      output.next_actions[i - 1].confidence >= output.next_actions[i].confidence,
      `next_actions[${i - 1}].confidence >= next_actions[${i}].confidence`
    );
  }
});

// ---------------------------------------------------------------------------
// Test 30: Backlog context — lists incomplete features when feature_complete
// ---------------------------------------------------------------------------
test('backlog context — lists incomplete features when feature_complete', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/backlog-test'], { cwd: dir, stdio: 'ignore' });
  // Current feature: complete
  mkdirSync(join(dir, 'docs', 'features', 'backlog-test', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'backlog-test', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'backlog-test', 'requests', '2026-01-01-done.md'),
    '| Status | **Complete** |\n\n- [x] Done'
  );
  // Another feature: incomplete
  mkdirSync(join(dir, 'docs', 'features', 'other-feature', 'requests'), { recursive: true });
  writeFileSync(
    join(dir, 'docs', 'features', 'other-feature', 'requests', '2026-01-01-pending.md'),
    '| Status | **Pending** |\n\n- [ ] Todo 1\n- [ ] Todo 2'
  );
  // Clean worktree (all committed) + all gates passed
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add all'],
    { cwd: dir, stdio: 'ignore' }
  );
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  // feature-complete should fire for backlog-test
  const fc = output.findings.find(f => f.id === 'feature-complete');
  assert.ok(fc, 'feature-complete should fire');
  // backlog should list the incomplete feature
  assert.ok(output.backlog, 'backlog should exist when feature_complete');
  assert.equal(output.backlog.total_features, 2);
  const incomplete = output.backlog.incomplete_features.find(f => f.key === 'other-feature');
  assert.ok(incomplete, 'other-feature should be listed as incomplete');
  assert.equal(incomplete.unchecked_ac, 2);
});

// ---------------------------------------------------------------------------
// Test 31: --feature CLI override
// ---------------------------------------------------------------------------
test('--feature CLI override — overrides branch pattern detection', () => {
  const dir = createTempRepo();
  // On main branch (no feat/ pattern)
  mkdirSync(join(dir, 'docs', 'features', 'override-feature', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'override-feature', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'override-feature', 'requests', '2026-01-01-test.md'),
    '| Status | **Pending** |\n\n- [ ] Item'
  );
  writeReviewState(dir);
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add docs'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir, ['--feature', 'override-feature']);
  assert.ok(output.feature_context, 'feature_context should exist');
  assert.equal(output.feature_context.key, 'override-feature');
  assert.equal(output.feature_context.source, 'cli');
  assert.equal(output.feature_context.confidence, 'high');
  // AC incomplete should fire via feature context
  const ac = output.findings.find(f => f.id === 'ac-incomplete');
  assert.ok(ac, 'ac-incomplete should fire via --feature override');
});

// ---------------------------------------------------------------------------
// Test 32: Blockquote status format — parseRequestStatus via request-stale
// ---------------------------------------------------------------------------
test('request-stale — parses blockquote status format (> **Status**: Pending)', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/bq-status'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'bq-status', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'bq-status', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'bq-status', 'requests', '2026-01-01-test.md'),
    '> **Created**: 2026-01-01\n> **Status**: Pending\n> **Priority**: P1\n\n## AC\n\n- [ ] Item 1'
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/bq.ts', 'a');
  writeFileSync(join(dir, 'src/bq.ts'), 'b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'request-stale');
  assert.ok(f, 'request-stale should fire for blockquote status format');
  assert.equal(f.priority, 'P1');
});

// ---------------------------------------------------------------------------
// Test 33: ac-incomplete blocks feature-complete
// ---------------------------------------------------------------------------
test('feature-complete blocked by ac-incomplete — no feature-complete when unchecked AC', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/ac-block'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'ac-block', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'ac-block', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'ac-block', 'requests', '2026-01-01-test.md'),
    '| Status | **Complete** |\n\n- [x] Done\n- [ ] Not done yet'
  );
  // Clean worktree + all gates passed
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add all'],
    { cwd: dir, stdio: 'ignore' }
  );
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'],
    { cwd: dir, stdio: 'ignore' }
  );

  const { output } = runAnalyze(dir);
  const ac = output.findings.find(f => f.id === 'ac-incomplete');
  assert.ok(ac, 'ac-incomplete should fire for unchecked items');
  const fc = output.findings.find(f => f.id === 'feature-complete');
  assert.ok(!fc, 'feature-complete should NOT fire when ac-incomplete exists');
});

// ---------------------------------------------------------------------------
// Test 34: docs-only diff — no post_precommit phase
// ---------------------------------------------------------------------------
test('docs-only diff — phase is not post_precommit even with precommit passed in state', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'docs/update'], { cwd: dir, stdio: 'ignore' });
  // Only .md files changed — precommit not required
  mkdirSync(join(dir, 'docs'), { recursive: true });
  addAndCommitFile(dir, 'docs/readme.md', '# Hello');
  writeFileSync(join(dir, 'docs/readme.md'), '# Updated');
  writeReviewState(dir, {
    has_doc_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  // precommit.required should be false (no code files)
  assert.equal(output.gates.precommit.required, false, 'precommit should not be required for docs-only');
  assert.notEqual(output.phase, 'post_precommit', 'phase should not be post_precommit for docs-only diff');
});

// ---------------------------------------------------------------------------
// Test 35: Nearly Complete status — request-stale fires, feature-complete blocked
// ---------------------------------------------------------------------------
test('Nearly Complete status — request-stale fires, no feature-complete', () => {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/nearly'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'nearly', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'nearly', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'nearly', 'requests', '2026-01-01-test.md'),
    '| Status | **Nearly Complete** |\n\n- [x] Done 1\n- [x] Done 2'
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/n.ts', 'a');
  writeFileSync(join(dir, 'src/n.ts'), 'b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  const rs = output.findings.find(f => f.id === 'request-stale');
  assert.ok(rs, 'request-stale should fire for "Nearly Complete" status');
  const fc = output.findings.find(f => f.id === 'feature-complete');
  assert.ok(!fc, 'feature-complete should NOT fire when request-stale exists');
});

// ---------------------------------------------------------------------------
// Test 36: next_actions commands use qualified format
// ---------------------------------------------------------------------------
test('next_actions commands use qualified /sd0x-dev-flow: prefix', () => {
  const dir = createTempRepo();
  // Code changed, no review → P0 findings → next_actions with commands
  mkdirSync(join(dir, 'src'), { recursive: true });
  addAndCommitFile(dir, 'src/foo.js', 'a');
  writeFileSync(join(dir, 'src/foo.js'), 'b');
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: false, passed: false, last_run: '' },
  });

  const { output } = runAnalyze(dir);
  const withCommands = output.next_actions.filter(a => a.command);
  assert.ok(withCommands.length > 0, 'Should have next_actions with commands');
  for (const action of withCommands) {
    assert.ok(
      action.command.startsWith('/sd0x-dev-flow:'),
      `Expected qualified command, got: ${action.command}`
    );
  }
});
