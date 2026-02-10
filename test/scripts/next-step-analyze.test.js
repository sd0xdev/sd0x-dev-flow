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
  assert.equal(output.version, 1);
  // Only main-branch finding (no state-related findings)
  const stateFindings = output.findings.filter(f =>
    f.id.startsWith('gate-') || f.id === 'state-drift'
  );
  assert.equal(stateFindings.length, 0, 'No gate findings without state file');
});

// ---------------------------------------------------------------------------
// Test 10: Profile gating — no src/ dir, skip test-gap
// ---------------------------------------------------------------------------
test('profile gating — no src/ dir, test-gap not emitted', () => {
  const dir = createTempRepo();
  // Create a file outside src/
  addAndCommitFile(dir, 'lib/utils.js', 'a');
  writeFileSync(join(dir, 'lib/utils.js'), 'a2');
  writeReviewState(dir);

  const { output } = runAnalyze(dir);
  const f = output.findings.find(f => f.id === 'test-gap');
  assert.equal(f, undefined, 'test-gap should NOT fire without src/ directory');
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
// Test 13: Gate uses computed required — code files in diff trigger gate
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
