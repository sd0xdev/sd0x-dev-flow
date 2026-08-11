const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  chmodSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../skills/next-step/scripts/analyze.js');
const tempDirs = [];
// Paths a test made unreadable to deny the script an open/list. `rmSync` cannot recurse into a
// 0000 directory, so permissions must be restored BEFORE the temp-dir sweep or the dir leaks.
const chmodRestore = [];

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

// Preloaded into the analyze child process by the determinism tests, so directory enumeration is
// handed back reversed no matter what the host filesystem would have returned. See the helper.
const READDIR_DESCENDING = resolve(__dirname, 'helpers/readdir-descending.js');
const READDIR_EACCES = resolve(__dirname, 'helpers/readdir-eacces.js');

// The audit file lives OUTSIDE the repo under test on purpose: an untracked file inside it dirties
// the worktree, and `feature-complete` — the gate the backlog tests depend on — never fires on a
// dirty tree. The observation would silently destroy the thing being observed.
function makeAuditPath() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-ns-audit-'));
  tempDirs.push(dir);
  return join(dir, 'readdir.log');
}

// Proof that the analyze child went THROUGH the patched API for the directories that matter. The
// preload working in a probe process is a different claim: a refactor to `fs.promises.readdir`,
// `opendirSync`, or a `readdirSync` captured before the preload ran bypasses the patch entirely,
// and every determinism test below would go back to asserting whatever the filesystem returned —
// green, and measuring nothing.
/**
 * The 1-based line of the first `readdirSync` call after `anchorRe` in analyze.js.
 *
 * DERIVED from the source rather than written down, because the number is only useful if it still
 * points at the same CALL after the file moves. A literal would drift into pointing at a different
 * one, which is worse than not checking at all.
 */
function readdirSiteAfter(anchorRe, within = 5) {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => anchorRe.test(l));
  assert.ok(start >= 0, `no line in analyze.js matches ${anchorRe} — the call-site anchor has drifted`);
  // Bounded, and that bound is the whole point. An unbounded forward scan does not fail when the
  // anchored call disappears — it silently RETARGETS to the next `readdirSync` in the file, which
  // here is the unrelated ac-incomplete scan of the same directory, so the attribution assertion
  // then passes by pointing at exactly the call it was written to exclude. Measured: refactoring
  // the anchored scan to `opendirSync` left the test green. Failing to find the call within a few
  // lines of its own explanatory comment IS the signal that it moved or went away.
  for (let i = start; i < Math.min(lines.length, start + within); i += 1) {
    if (/readdirSync\(/.test(lines[i])) return i + 1;
  }
  assert.fail(
    `no readdirSync call within ${within} lines of ${anchorRe} in analyze.js — the scan it pins has moved or changed API`
  );
}

/**
 * Each entry is a directory suffix, or `{ suffix, atLine }` to also pin WHICH call read it.
 *
 * The suffix alone is presence, not attribution, and for `requests/` directories the difference is
 * load-bearing: analyze.js enumerates the same one from two heuristics, so a test meaning to pin the
 * order-sensitive scan was equally satisfied by the unrelated later one — including in the scenario
 * the audit exists to exclude, where the order-sensitive scan has been refactored to an API this
 * preload does not patch. `atLine` closes that by comparing against the call site the preload
 * records from its own stack.
 */
function assertIntercepted(auditPath, expected) {
  const rows = (existsSync(auditPath) ? readFileSync(auditPath, 'utf8').split('\n').filter(Boolean) : [])
    .map((l) => {
      const [dir, site = ''] = l.split('\t');
      return { dir, site };
    });
  for (const entry of expected) {
    const { suffix, atLine } = typeof entry === 'string' ? { suffix: entry } : entry;
    const hits = rows.filter((r) => r.dir.endsWith(suffix));
    assert.ok(
      hits.length > 0,
      `the analyze child must have enumerated ${suffix} through the patched readdirSync; intercepted: ${JSON.stringify(rows)}`
    );
    if (atLine !== undefined) {
      assert.ok(
        hits.some((r) => new RegExp(`analyze\\.js:${atLine}:`).test(r.site)),
        `${suffix} must have been enumerated by the call at analyze.js:${atLine}, not merely by some other call; ` +
          `saw ${JSON.stringify(hits.map((h) => h.site))}`
      );
    }
  }
}

function runAnalyze(dir, extraArgs = [], { descendingReaddir = false, auditPath, eaccesPath } = {}) {
  const env = { ...process.env };
  if (eaccesPath) {
    // One directory made unreadable at the syscall, leaving the worktree and the diff untouched —
    // see helpers/readdir-eacces.js for why `chmod` cannot serve this test.
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require "${READDIR_EACCES}"`.trim();
    env.READDIR_EACCES_PATH = eaccesPath;
  }
  if (descendingReaddir) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require "${READDIR_DESCENDING}"`.trim();
    // When given, the preload logs every directory it intercepted IN THIS CHILD. That is the only
    // evidence that the script actually went through the patched API rather than around it.
    if (auditPath) env.READDIR_DESCENDING_AUDIT = auditPath;
  }
  try {
    const stdout = execFileSync('node', [scriptPath, '--json', ...extraArgs], {
      cwd: dir,
      encoding: 'utf8',
      env,
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
  for (const p of chmodRestore) {
    try { chmodSync(p, 0o755); } catch { /* already gone */ }
  }
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
// Test 5: New skill, no README
// ---------------------------------------------------------------------------
test('new skill added, no README — P2 readme-missing', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'skills', 'existing-skill'), { recursive: true });
  addAndCommitFile(dir, 'skills/existing-skill/SKILL.md', '# existing');
  // Add a new skill file (uncommitted change via diff HEAD)
  mkdirSync(join(dir, 'skills', 'new-skill'), { recursive: true });
  writeFileSync(join(dir, 'skills/new-skill/SKILL.md'), '# new');
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
  mkdirSync(join(dir, 'skills', 'test-skill'), { recursive: true });
  mkdirSync(join(dir, 'skills', 'new-skill'), { recursive: true });
  addAndCommitFile(dir, 'src/auth.ts', 'a');
  addAndCommitFile(dir, 'src/token.ts', 'b');
  addAndCommitFile(dir, 'src/password.ts', 'c');
  addAndCommitFile(dir, 'skills/test-skill/SKILL.md', 'y');
  addAndCommitFile(dir, 'skills/new-skill/SKILL.md', 'x');
  addAndCommitFile(dir, 'README.md', 'r1');
  addAndCommitFile(dir, 'README.zh-TW.md', 'r2');
  addAndCommitFile(dir, 'migration/001.sql', 'z');
  // Dirty all files
  writeFileSync(join(dir, 'src/auth.ts'), 'a2');
  writeFileSync(join(dir, 'src/token.ts'), 'b2');
  writeFileSync(join(dir, 'src/password.ts'), 'c2');
  writeFileSync(join(dir, 'skills/test-skill/SKILL.md'), 'y2');
  writeFileSync(join(dir, 'skills/new-skill/SKILL.md'), 'x2');
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
    '| Status | **Completed** |\n\n- [x] Done'
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
// Test 27b: an unreadable feature corpus withholds the completion claim
// ---------------------------------------------------------------------------
test('feature-complete — withheld when the feature corpus could not be enumerated', () => {
  // The exact shape of the fail-open: the key still resolves (from the branch), but enumeration
  // fails, so `has_tech_spec` / `has_requests` come back false — indistinguishable from a feature
  // with no documents. Every doc and request heuristic is skipped, and their silence used to be
  // read as "no sync work remains" and reported as "Ready for commit and /pr-review".
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/unreadable-test'], { cwd: dir, stdio: 'ignore' });
  const featureDir = join(dir, 'docs', 'features', 'unreadable-test');
  mkdirSync(join(featureDir, 'requests'), { recursive: true });
  writeFileSync(join(featureDir, '2-tech-spec.md'), '# Spec');
  writeFileSync(join(featureDir, 'requests', '2026-01-01-test.md'), '| Status | **Completed** |\n\n- [x] Done');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'add all'],
    { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'],
    { cwd: dir, stdio: 'ignore' });

  // The control first — readable, and the completion claim fires. Without it, the assertions below
  // would also pass on a build where `feature-complete` had simply stopped working.
  const readable = runAnalyze(dir).output;
  assert.ok(readable.findings.find((f) => f.id === 'feature-complete'),
    'control: feature-complete must fire while the corpus is readable');
  assert.ok(!readable.findings.find((f) => f.id === 'corpus-unreadable'));

  const out = runAnalyze(dir, [], { eaccesPath: join('docs', 'features', 'unreadable-test') }).output;
  // The scenario really is the one being claimed: same clean tree, same passing gates, and the
  // *only* difference is that enumeration failed. Asserted rather than assumed, because the first
  // version of this test used `chmod` and passed on a P0 about deleted files instead.
  assert.equal(out.feature_context.scan_error, true, 'the injected failure must reach the resolver');
  assert.equal(out.feature_context.key, 'unreadable-test', 'the key still resolves — that is the trap');
  assert.equal(out.diff_summary.total, 0, 'the worktree must stay clean, or another gate blocks first');
  // Same blockers in both runs, so nothing new pre-empts the claim under test. Asserted against the
  // control rather than against an absolute "no P0", because whichever gates the fixture happens to
  // trip must be identical on both sides — the difference has to be `scan_error` and nothing else.
  const p0s = (r) => r.findings.filter((f) => f.priority === 'P0').map((f) => f.id).sort();
  assert.deepEqual(p0s(out), p0s(readable), 'the injected run must trip no blocker the control does not');

  const unreadable = out.findings.find((f) => f.id === 'corpus-unreadable');
  assert.ok(unreadable, 'corpus-unreadable must be reported, not passed over in silence');
  assert.equal(unreadable.priority, 'P1');
  assert.ok(!out.findings.find((f) => f.id === 'feature-complete'),
    'a feature whose documents could not be read must not be declared complete');
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
    '| Status | **Completed** |\n\n- [x] Done'
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

test('backlog headline reports the COUNT of incomplete features, not the display limit', () => {
  // `incomplete_features` is truncated to 5 for display, and the headline printed that array's
  // length — so 21 incomplete features out of 30 rendered as "5/30 incomplete". The number a
  // reader uses to decide whether a backlog exists at all was capped at the size of the list
  // under it, silently and always in the direction of looking finished.
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/backlog-count'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'backlog-count', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'backlog-count', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'backlog-count', 'requests', '2026-01-01-done.md'),
    '| Status | **Completed** |\n\n- [x] Done'
  );
  // EIGHT incomplete features — more than the display limit of 5, which is the whole point.
  const INCOMPLETE = 8;
  for (let i = 0; i < INCOMPLETE; i += 1) {
    const key = `pending-feature-${String(i).padStart(2, '0')}`;
    mkdirSync(join(dir, 'docs', 'features', key, 'requests'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'features', key, 'requests', '2026-01-01-pending.md'),
      '| Status | **Pending** |\n\n- [ ] Todo'
    );
  }
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'all'], { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'], { cwd: dir, stdio: 'ignore' });

  const auditPath = makeAuditPath();
  const { output } = runAnalyze(dir, [], { descendingReaddir: true, auditPath });
  // The sort under test is over the FEATURE directory listing, so that is the enumeration that must
  // have been intercepted.
  assertIntercepted(auditPath, [join('docs', 'features')]);
  assert.ok(output.backlog, 'backlog should exist when feature_complete');
  assert.equal(output.backlog.total_features, INCOMPLETE + 1);
  assert.equal(output.backlog.incomplete_count, INCOMPLETE, 'the true count must survive truncation');
  assert.equal(output.backlog.incomplete_features.length, 5, 'the displayed list is still capped');
  // WHICH five are shown is decided by the sort — `readdirSync` order otherwise makes the visible
  // slice filesystem-dependent, so two machines report different backlogs for the same repo.
  assert.deepEqual(
    output.backlog.incomplete_features.map(f => f.key),
    ['pending-feature-00', 'pending-feature-01', 'pending-feature-02', 'pending-feature-03', 'pending-feature-04'],
    'the truncated slice must be the lexicographically first five, not whatever the filesystem returned'
  );

  // The rendered headline is what a human actually reads — assert on it, not just the JSON.
  // The script exits non-zero when findings exist, so read stdout off the error the same way
  // `runAnalyze` does; a bare execFileSync would throw on an ordinary, expected outcome.
  let md;
  try {
    md = execFileSync('node', [scriptPath, '--markdown'], { cwd: dir, encoding: 'utf8' });
  } catch (err) {
    md = (err.stdout || '').toString();
  }
  assert.match(md, new RegExp(`### Backlog \\(${INCOMPLETE}/${INCOMPLETE + 1} incomplete\\)`),
    `headline must report ${INCOMPLETE}, not the display limit:\n${md}`);
  assert.match(md, /Showing the first 5 of 8/, 'truncation must be stated, not silent');
});

test('backlog reports the SORTED-first open request status when a feature has several', () => {
  // `buildBacklogContext` keeps `openRequests[0].status` for the feature, so with two open requests
  // carrying DIFFERENT statuses the one reported is decided by the inner scan's order. That scan is
  // a separate `.sort()` from the feature-directory sort — pinning the latter says nothing about it,
  // and reversing it left the whole suite green.
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/multi-open'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'multi-open', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'multi-open', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'multi-open', 'requests', '2026-01-01-done.md'),
    '| Status | **Completed** |\n\n- [x] Done'
  );
  // A SECOND feature with two open requests whose statuses differ, so which one is picked shows.
  const other = join(dir, 'docs', 'features', 'zz-two-open', 'requests');
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, '2026-09-09-later.md'), '| Status | **Blocked** |\n\n- [ ] Todo');
  writeFileSync(join(other, '2026-01-01-earlier.md'), '| Status | **Pending** |\n\n- [ ] Todo');

  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'all'], { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });
  execFileSync('git', ['add', '.claude_review_state.json'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'state'], { cwd: dir, stdio: 'ignore' });

  const auditPath = makeAuditPath();
  const { output } = runAnalyze(dir, [], { descendingReaddir: true, auditPath });
  // The sort under test here is the INNER request scan, a different `.sort()` from the feature-dir
  // one — so the request directory itself is what must have gone through the patched API.
  assertIntercepted(auditPath, [join('zz-two-open', 'requests')]);
  assert.ok(output.backlog, 'backlog should exist when feature_complete');
  const f = output.backlog.incomplete_features.find(x => x.key === 'zz-two-open');
  assert.ok(f, 'the two-open-request feature must be listed');
  assert.equal(f.open_requests, 2, 'both requests are open — non-vacuity for the choice below');
  assert.equal(
    f.status,
    'Pending',
    'the sorted-FIRST open request (2026-01-01-earlier) decides the reported status, not filesystem order'
  );
});

test('CONTROL: the injected enumeration order really does reach the child process', () => {
  // The three `descendingReaddir` tests — two ABOVE this one, one below — rely on the preload
  // actually reversing what the script sees. (Stated as a direction rather than "the three below",
  // which was wrong and would let someone delete a covered test believing it was uncovered.) If
  // the preload silently failed to load — a moved helper, a NODE_OPTIONS the runtime declined, a
  // typo in the flag — every one of them would go back to asserting whatever the filesystem
  // returned, which is precisely the vacuity being fixed. That failure is invisible: the tests
  // still pass. So the injection is pinned directly, with a probe that reads the order the way the
  // script does.
  const dir = createTempRepo();
  const probeDir = join(dir, 'probe');
  mkdirSync(probeDir, { recursive: true });
  for (const name of ['a.md', 'b.md', 'c.md']) writeFileSync(join(probeDir, name), '');
  // Both call shapes, because the preload handles them with DIFFERENT code. `analyze.js` uses the
  // plain form for the scans these tests target and `{ withFileTypes: true }` at :135, so the
  // helper's Dirent branch is live production behaviour — but no test reached it: mutating that
  // branch to return a constant left this file at 49/49. An untested branch inside the very helper
  // that makes the other tests non-vacuous is the same vacuity one level down.
  const probe = join(dir, 'probe.js');
  writeFileSync(
    probe,
    "const fs = require('node:fs');\n"
      + "const plain = fs.readdirSync(process.argv[2]).join(',');\n"
      + "const dirents = fs.readdirSync(process.argv[2], { withFileTypes: true }).map((e) => e.name).join(',');\n"
      + 'process.stdout.write(`${plain}\\n${dirents}`);'
  );

  const readBoth = (env) => execFileSync('node', [probe, probeDir], { encoding: 'utf8', env }).split('\n');
  const [plain] = readBoth({ ...process.env });
  const [injected, injectedDirents] = readBoth({
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require "${READDIR_DESCENDING}"`.trim(),
  });

  assert.equal(injected, 'c.md,b.md,a.md', 'the preload must hand back strictly descending names');
  assert.equal(injectedDirents, 'c.md,b.md,a.md', 'and must sort Dirent entries by name, not by their String() form');
  assert.notEqual(injected, plain.split(',').sort().join(','), 'and that must differ from ascending order');
});

test('request-stale names a DETERMINISTIC request when several are open', () => {
  // The loop `break`s on the first open request, so without a sort the file named in the
  // suggestion is whichever `readdirSync` happened to return first — different machines, different
  // advice, same repo. `buildBacklogContext` sorted its scan; this one did not.
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/stale-order'], { cwd: dir, stdio: 'ignore' });
  const reqDir = join(dir, 'docs', 'features', 'stale-order', 'requests');
  mkdirSync(reqDir, { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'stale-order', '2-tech-spec.md'), '# Spec');
  // Enumeration order is INJECTED (`descendingReaddir`), not inferred from creation order. Creating
  // the files in reverse was the original attempt and it proved nothing: no filesystem promises to
  // hand entries back in the order they were made, so on a machine that returns them ascending an
  // implementation with no `.sort()` at all was accidentally right.
  for (const name of ['2026-03-03-third.md', '2026-02-02-second.md', '2026-01-01-first.md']) {
    writeFileSync(join(reqDir, name), '| Status | **Pending** |\n\n- [ ] Todo');
  }
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '-m', 'all'], { cwd: dir, stdio: 'ignore' });
  writeReviewState(dir, {
    has_code_change: true,
    code_review: { executed: true, passed: true, last_run: '' },
    precommit: { executed: true, passed: true, last_run: '' },
  });

  const auditPath = makeAuditPath();
  const { output } = runAnalyze(dir, [], { descendingReaddir: true, auditPath });
  // Pinned to the request-stale scan SPECIFICALLY. `runHeuristics` enumerates this same directory
  // again for the ac-incomplete heuristic further down, so a bare presence check is satisfied by
  // that unrelated call — including after the scan under test has been moved to an unpatched API,
  // which is the one thing the audit exists to rule out.
  assertIntercepted(auditPath, [{
    suffix: join('stale-order', 'requests'),
    atLine: readdirSiteAfter(/is decided by `readdirSync` order/),
  }]);
  const f = output.findings.find(x => x.id === 'request-stale');
  assert.ok(f, 'request-stale should fire with three open requests');
  assert.match(f.message, /2026-01-01-first\.md/, `the FIRST request in sorted order must be named, got: ${f && f.message}`);
  assert.match(f.suggestion, /2026-01-01-first\.md/, 'the suggestion must name the same file as the message');
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
// Regression: an UNRECOGNISED request Status must not read as finished work
// ---------------------------------------------------------------------------
test('feature-complete does NOT fire on an unrecognised request Status', () => {
  // analyze.js used to decide openness from a POSITIVE list of four values
  // (pending / in development / in progress / nearly complete). Anything outside it — including
  // `Candidate Complete`, the third most common value in this repo's 125 request docs, and
  // `Spec Complete` — counted as finished, so feature-complete could fire with open requests
  // outstanding. scripts/lib/request-status.js inverts that: closure requires exact membership in
  // a short closed set, and anything else is open.
  //
  // `Complete` (no trailing d) is the exact value three fixtures in this file used to carry. It
  // appears nowhere in the real corpus, and under the old list it silently meant "done"; under the
  // new one it means "nobody has defined this, so do not claim the work is finished". This test
  // pins that direction — without it, quietly adding `Complete` to CLOSED_REQUEST_STATUS to make
  // a fixture green would reintroduce exactly the class of bug the module was written to remove.
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/unknown-status'], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', 'unknown-status', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'unknown-status', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'unknown-status', 'requests', '2026-01-01-test.md'),
    '| Status | **Blocked On Review** |\n\n- [x] Done'
  );
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
  assert.ok(
    output.findings.find(f => f.id === 'request-stale'),
    'the open request must be REPORTED, not merely counted — asserting only the absence of '
      + 'feature-complete would also pass if the whole request-stale branch stopped running'
  );
  assert.ok(
    !output.findings.find(f => f.id === 'feature-complete'),
    'an open request with a status nobody has defined must keep feature-complete from firing'
  );
});

// ---------------------------------------------------------------------------
// Test 32b/32c: a Status that cannot be READ is still an open request
// ---------------------------------------------------------------------------

/**
 * Build a repo whose single request doc has the given body, with every gate passed and a clean
 * worktree — the exact state in which `feature-complete` is allowed to fire.
 */
function repoWithRequestBody(branch, key, body) {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', branch], { cwd: dir, stdio: 'ignore' });
  mkdirSync(join(dir, 'docs', 'features', key, 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', key, '2-tech-spec.md'), '# Spec');
  writeFileSync(join(dir, 'docs', 'features', key, 'requests', '2026-01-01-test.md'), body);
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
  return dir;
}

// A repo whose feature has one CLOSED request, plus whatever `plant` adds to `requests/` before
// the commit. The closed request is what makes the control meaningful: without it the feature has
// no requests at all, which is a different state from "every request reads as done".
// `plant` runs BEFORE the commit — the worktree must end clean, or `feature-complete` never fires
// and every assertion below is vacuous. `postCommit` is for setup git itself cannot survive, i.e.
// making a file unreadable: `git add .` fails outright on a 0000 file.
function repoWithPlantedRequest(branch, key, plant, postCommit) {
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', branch], { cwd: dir, stdio: 'ignore' });
  const reqDir = join(dir, 'docs', 'features', key, 'requests');
  mkdirSync(reqDir, { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', key, '2-tech-spec.md'), '# Spec');
  writeFileSync(join(reqDir, '2026-01-01-done.md'), '| Status | **Completed** |\n\n- [x] Done');
  if (plant) plant(reqDir, dir);
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
  if (postCommit) postCommit(reqDir, dir);
  return dir;
}

const AS_ROOT = process.getuid && process.getuid() === 0;

test('CONTROL: a feature whose only request is Completed IS declared complete', () => {
  // The baseline every "must not be complete" assertion below is measured against. Without it a
  // change that stopped emitting `feature-complete` entirely would leave those tests green.
  const dir = repoWithPlantedRequest('feat/readable-done', 'readable-done', null);

  const { output } = runAnalyze(dir);
  assert.ok(output.findings.find(f => f.id === 'feature-complete'), 'control: the closed request must permit completion');
  assert.ok(!output.findings.find(f => f.id === 'request-stale'), 'control: nothing here is open');
});

test('an UNREADABLE request is open — a broken symlink must not read as a closed request', () => {
  // Openness is defined NEGATIVELY: a request counts as closed only when its Status is one of the
  // known closed values. "Cannot be read" is therefore the same statement as "has no Status" —
  // both mean the work cannot be confirmed done. The per-file `catch` skipped it silently instead,
  // which is precisely the fail-open the `if (status)` guard was removed to close, reintroduced one
  // level down. It also needs no unusual document: a dangling symlink in `requests/` is enough, and
  // git stores those, so a clone can arrive already in this state.
  const dir = repoWithPlantedRequest('feat/broken-link', 'broken-link', (reqDir) => {
    symlinkSync('2026-01-01-missing.md', join(reqDir, '2026-06-06-dangling.md'));
  });

  const { output } = runAnalyze(dir);
  const stale = output.findings.find(f => f.id === 'request-stale');
  assert.ok(stale, 'an unreadable request must be reported as open');
  assert.match(stale.message, /2026-06-06-dangling\.md/, 'the finding must name the file that could not be read');
  assert.match(stale.message, /counts as open/, 'the message must state the rule being applied');
  assert.ok(
    !output.findings.find(f => f.id === 'feature-complete'),
    'a feature with an unreadable request must not be declared complete'
  );
});

test('a permission-denied request is open too', {
  skip: AS_ROOT ? 'running as root: chmod 000 is not enforced' : false,
}, () => {
  // The same rule via the other failure mode. Kept separate from the broken-symlink case because
  // they arrive through different `readFileSync` errors (EACCES vs ENOENT) and a fix that keyed on
  // one error code would pass only one of these.
  // Committed readable, then locked: `git add .` cannot read a 0000 file, and the worktree has to
  // end clean for `feature-complete` to be reachable at all. The Status inside deliberately says
  // `Completed`, so if the file could be opened it would read as CLOSED and produce no finding.
  // The finding therefore comes from the failure to open and from nothing else.
  const dir = repoWithPlantedRequest('feat/no-perm', 'no-perm', (reqDir) => {
    writeFileSync(join(reqDir, '2026-06-06-locked.md'), '| Status | **Completed** |\n');
  }, (reqDir) => {
    const p = join(reqDir, '2026-06-06-locked.md');
    chmodSync(p, 0o000);
    chmodRestore.push(p);
  });

  const { output } = runAnalyze(dir);
  assert.ok(output.findings.find(f => f.id === 'request-stale'), 'a request that cannot be opened must read as open');
  assert.ok(!output.findings.find(f => f.id === 'feature-complete'));
});

test('a requests DIRECTORY that cannot be listed is open — not "no requests"', {
  skip: AS_ROOT ? 'running as root: chmod 000 is not enforced' : false,
}, () => {
  // The enumeration failure covers every request at once, so reading it as the empty case is the
  // largest version of the same fail-open. `has_requests` already established the directory
  // exists, which is what separates this from a genuine ENOENT.
  const dir = repoWithPlantedRequest('feat/no-list', 'no-list', null);
  chmodSync(join(dir, 'docs', 'features', 'no-list', 'requests'), 0o000);
  chmodRestore.push(join(dir, 'docs', 'features', 'no-list', 'requests'));

  const { output } = runAnalyze(dir);
  const stale = output.findings.find(f => f.id === 'request-stale');
  assert.ok(stale, 'an unlistable requests directory must not read as an empty one');
  assert.match(stale.message, /could not be listed/, 'the message must name the actual failure');
  assert.ok(!output.findings.find(f => f.id === 'feature-complete'));
});

test('the BACKLOG counts a feature whose only request is unreadable', () => {
  // buildBacklogContext wrapped the whole per-feature loop in one `try`, so an unreadable request
  // both vanished itself AND took every request after it in sorted order with it. A feature whose
  // only request was a dangling symlink therefore disappeared from the backlog entirely — the one
  // list a reader uses to decide what is left to do.
  // Planted before the commit: an untracked directory makes the worktree dirty, `feature-complete`
  // then never fires, and the backlog is only built in that phase — so the test would assert
  // nothing at all.
  const dir = repoWithPlantedRequest('feat/backlog-unreadable', 'backlog-unreadable', (_reqDir, root) => {
    const otherReq = join(root, 'docs', 'features', 'other-broken', 'requests');
    mkdirSync(otherReq, { recursive: true });
    symlinkSync('nowhere.md', join(otherReq, '2026-01-01-dangling.md'));
  });

  const { output } = runAnalyze(dir);
  assert.ok(output.backlog, 'the current feature must be complete so the backlog is built');
  const entry = output.backlog.incomplete_features.find(f => f.key === 'other-broken');
  assert.ok(entry, 'a feature whose only request is unreadable must still appear in the backlog');
  assert.equal(entry.open_requests, 1, 'the unreadable request must be counted as one open request');
  assert.equal(entry.status, null, 'an unreadable request has no status to report');
});

test('a request with NO Status field is open — request-stale fires, feature-complete does not', () => {
  // `request-status.js` defines a missing Status as open: "no Status field" and "Status says
  // nothing closed" are the same statement about whether the work is finished. analyze.js used to
  // guard the predicate with `if (status)`, which made ABSENCE — the one value that can never be in
  // the closed set — the only value incapable of producing a finding. The negative taxonomy was
  // fully in place and this case still fell through it.
  const dir = repoWithRequestBody('feat/no-status', 'no-status', '# Request\n\nSome prose.\n\n- [x] Done');

  const { output } = runAnalyze(dir);
  const stale = output.findings.find(f => f.id === 'request-stale');
  assert.ok(stale, 'an unlabelled request must be reported as open');
  assert.match(stale.message, /no readable Status field/, 'the message must name the actual reason');
  assert.ok(
    !output.findings.find(f => f.id === 'feature-complete'),
    'a feature with an unlabelled request must not be declared complete'
  );
});

test('a Status BELOW the parser window is open — the doc reads Pending, the parser sees nothing', () => {
  // The window is what makes the case above reachable rather than hypothetical. `HEAD_LINES = 30`
  // was measured against this repo's corpus, where nothing sits lower — but analyze.js ships to
  // host projects with their own templates. Here the human-visible Status says `Pending`; the
  // parser returns null. If null were treated as closed, the tool would contradict the document it
  // just read, and it would do so silently.
  const filler = Array.from({ length: 34 }, (_, i) => `Line ${i + 1} of preamble.`).join('\n');
  const dir = repoWithRequestBody(
    'feat/deep-status', 'deep-status',
    `# Request\n\n${filler}\n\n| Status | **Pending** |\n\n- [x] Done`
  );

  const { output } = runAnalyze(dir);
  assert.ok(output.findings.find(f => f.id === 'request-stale'), 'a Status below the window must still read as open');
  assert.ok(
    !output.findings.find(f => f.id === 'feature-complete'),
    'the parser failing to SEE a Status must never be read as the request being closed'
  );
});

test('backlog lists a feature whose only request has no readable Status', () => {
  // The backlog builder had the same defect in a second form: `status != null && isOpen(status)`,
  // so a feature with an unlabelled request was omitted entirely unless it also happened to have
  // unchecked AC. Both consumers of the shared contract now let null flow into the predicate.
  const dir = createTempRepo();
  execFileSync('git', ['checkout', '-b', 'feat/backlog-null'], { cwd: dir, stdio: 'ignore' });

  // The feature under test: all AC checked, so unchecked_ac cannot be what puts it in the backlog.
  mkdirSync(join(dir, 'docs', 'features', 'zz-unlabelled', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'zz-unlabelled', 'requests', '2026-01-01-a.md'), '# R\n\n- [x] Done');

  // The current feature, closed, so feature_complete is reached and `backlog` is populated.
  mkdirSync(join(dir, 'docs', 'features', 'backlog-null', 'requests'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'backlog-null', '2-tech-spec.md'), '# Spec');
  writeFileSync(
    join(dir, 'docs', 'features', 'backlog-null', 'requests', '2026-01-01-test.md'),
    '| Status | **Completed** |\n\n- [x] Done'
  );
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
  assert.ok(output.backlog, 'precondition: the backlog is only built at phase feature_complete');
  const entry = output.backlog.incomplete_features.find(f => f.key === 'zz-unlabelled');
  assert.ok(entry, 'a feature whose request carries no Status must appear in the backlog');
  assert.equal(entry.unchecked_ac, 0, 'and it must be there for the STATUS, not for unchecked AC');
  assert.equal(entry.open_requests, 1);
  assert.equal(entry.status, null);
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
    '| Status | **Completed** |\n\n- [x] Done\n- [ ] Not done yet'
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
