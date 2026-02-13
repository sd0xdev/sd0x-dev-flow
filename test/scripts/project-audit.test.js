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

const scriptPath = resolve(__dirname, '../../skills/project-audit/scripts/audit.js');
const tempDirs = [];

function createTempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-audit-'));
  tempDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--allow-empty', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' }
  );
  return dir;
}

function runAudit(dir, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--json', '--dir', dir, ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    try {
      return { output: JSON.parse(stdout), exitCode: err.status };
    } catch {
      return { output: null, exitCode: err.status, raw: stdout, stderr: (err.stderr || '').toString() };
    }
  }
}

function runAuditMarkdown(dir) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--markdown', '--dir', dir], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    return { output: stdout, exitCode: 0 };
  } catch (err) {
    return { output: (err.stdout || '').toString(), exitCode: err.status };
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 1: Empty repo — Blocked, exit 2, P0 (no manifest)
// ---------------------------------------------------------------------------
test('empty repo — Blocked, exit 2, missing manifest P0', () => {
  const dir = createTempRepo();
  const { output, exitCode } = runAudit(dir);
  assert.equal(exitCode, 2);
  assert.equal(output.status, 'Blocked');
  assert.ok(output.findings.p0 > 0, 'Should have P0 findings');
  const manifestCheck = output.checks.find(c => c.id === 'runnability-manifest');
  assert.equal(manifestCheck.result, 'fail');
  assert.equal(manifestCheck.priority, 'P0');
});

// ---------------------------------------------------------------------------
// Test 2: Minimal Node.js project — Needs Work, exit 1
// ---------------------------------------------------------------------------
test('minimal Node.js project — Needs Work, exit 1', () => {
  const dir = createTempRepo();
  // package.json with only test script
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    scripts: { test: 'echo test' },
  }));
  writeFileSync(join(dir, 'README.md'), '# Test\n\nA test project.\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.js'), 'console.log("hello");');

  const { output, exitCode } = runAudit(dir);
  assert.equal(exitCode, 1, `Expected exit 1, got ${exitCode}`);
  assert.equal(output.status, 'Needs Work');
  assert.ok(output.overall_score > 0 && output.overall_score < 80, `Score should be between 0-80, got ${output.overall_score}`);
});

// ---------------------------------------------------------------------------
// Test 3: Full Node.js project — Healthy, exit 0, score >= 80
// ---------------------------------------------------------------------------
test('full Node.js project — Healthy, exit 0, score >= 80', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'LICENSE'), 'MIT License');
  // Rich README
  const readmeLines = [];
  readmeLines.push('# Full Project');
  readmeLines.push('');
  readmeLines.push('## Installation');
  readmeLines.push('npm install');
  readmeLines.push('');
  readmeLines.push('## Usage');
  readmeLines.push('Import and use.');
  readmeLines.push('');
  readmeLines.push('## API');
  readmeLines.push('See docs.');
  readmeLines.push('');
  readmeLines.push('## Contributing');
  readmeLines.push('PRs welcome.');
  // Pad to > 50 lines
  for (let i = 0; i < 40; i++) readmeLines.push(`Line ${i + 13}`);
  writeFileSync(join(dir, 'README.md'), readmeLines.join('\n'));

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'full-project',
    scripts: { start: 'node .',  dev: 'nodemon', build: 'tsc', test: 'jest', lint: 'eslint .', typecheck: 'tsc --noEmit' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, 'yarn.lock'), '');
  writeFileSync(join(dir, '.env.example'), 'DB_URL=');
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), 'export const app = 1;');
  writeFileSync(join(dir, 'src', 'lib.ts'), 'export const lib = 2;');
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', 'app.test.ts'), 'test("a", () => {});');

  const { output, exitCode } = runAudit(dir);
  assert.equal(exitCode, 0);
  assert.equal(output.status, 'Healthy');
  assert.ok(output.overall_score >= 80, `Expected score >= 80, got ${output.overall_score}`);
});

// ---------------------------------------------------------------------------
// Test 4: Go project — lint/type pass (built-in)
// ---------------------------------------------------------------------------
test('Go project — lint/type pass from built-in checks', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21');
  writeFileSync(join(dir, 'README.md'), '# Go Project\n\nA Go project.\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.go'), 'package main');

  const { output } = runAudit(dir);
  const lintCheck = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(lintCheck.result, 'pass', 'Go should auto-pass lint/typecheck');
  const typeCheck = output.checks.find(c => c.id === 'stability-type-config');
  assert.equal(typeCheck.result, 'pass', 'Go should auto-pass type config');
});

// ---------------------------------------------------------------------------
// Test 5: Rust project — lint/type pass (clippy/rustfmt built-in)
// ---------------------------------------------------------------------------
test('Rust project — lint/type pass from static typing', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"');
  writeFileSync(join(dir, 'README.md'), '# Rust Project\n\nA Rust project.\n');

  const { output } = runAudit(dir);
  const lintCheck = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(lintCheck.result, 'pass', 'Rust should auto-pass lint/typecheck');
  const typeCheck = output.checks.find(c => c.id === 'stability-type-config');
  assert.equal(typeCheck.result, 'pass', 'Rust should auto-pass type config');
});

// ---------------------------------------------------------------------------
// Test 6: README quality bands — fail/partial/pass thresholds
// ---------------------------------------------------------------------------
test('README quality — fail/partial/pass thresholds', () => {
  // No README
  const dir1 = createTempRepo();
  writeFileSync(join(dir1, 'package.json'), '{}');
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.checks.find(c => c.id === 'oss-readme').result, 'fail');

  // Minimal README (< 20 lines, < 2 sections)
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), '{}');
  writeFileSync(join(dir2, 'README.md'), '# Title\nSome text.\n');
  const { output: out2 } = runAudit(dir2);
  assert.equal(out2.checks.find(c => c.id === 'oss-readme').result, 'fail');

  // Partial README (>= 20 lines, >= 2 sections)
  const dir3 = createTempRepo();
  writeFileSync(join(dir3, 'package.json'), '{}');
  const partialLines = ['# Title', '', '## Section 1', ''];
  for (let i = 0; i < 20; i++) partialLines.push(`Line ${i}`);
  writeFileSync(join(dir3, 'README.md'), partialLines.join('\n'));
  const { output: out3 } = runAudit(dir3);
  assert.equal(out3.checks.find(c => c.id === 'oss-readme').result, 'partial');

  // Full README (>= 50 lines, >= 4 sections)
  const dir4 = createTempRepo();
  writeFileSync(join(dir4, 'package.json'), '{}');
  const fullLines = ['# Title', '', '## Section 1', '', '## Section 2', '', '## Section 3', ''];
  for (let i = 0; i < 45; i++) fullLines.push(`Line ${i}`);
  writeFileSync(join(dir4, 'README.md'), fullLines.join('\n'));
  const { output: out4 } = runAudit(dir4);
  assert.equal(out4.checks.find(c => c.id === 'oss-readme').result, 'pass');
});

// ---------------------------------------------------------------------------
// Test 7: Test ratio bands — fail/partial/pass
// ---------------------------------------------------------------------------
test('test ratio — fail(<10%) / partial(10-30%) / pass(>=30%)', () => {
  // No tests (0%)
  const dir1 = createTempRepo();
  writeFileSync(join(dir1, 'package.json'), '{}');
  mkdirSync(join(dir1, 'src'), { recursive: true });
  for (let i = 0; i < 10; i++) writeFileSync(join(dir1, 'src', `mod${i}.js`), 'x');
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.checks.find(c => c.id === 'robustness-test-ratio').result, 'fail');

  // Partial (1/10 = 10%)
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), '{}');
  mkdirSync(join(dir2, 'src'), { recursive: true });
  mkdirSync(join(dir2, 'test'), { recursive: true });
  for (let i = 0; i < 10; i++) writeFileSync(join(dir2, 'src', `mod${i}.js`), 'x');
  writeFileSync(join(dir2, 'test', 'mod0.test.js'), 'test');
  const { output: out2 } = runAudit(dir2);
  assert.equal(out2.checks.find(c => c.id === 'robustness-test-ratio').result, 'partial');

  // Pass (4/10 = 40%)
  const dir3 = createTempRepo();
  writeFileSync(join(dir3, 'package.json'), '{}');
  mkdirSync(join(dir3, 'src'), { recursive: true });
  mkdirSync(join(dir3, 'test'), { recursive: true });
  for (let i = 0; i < 10; i++) writeFileSync(join(dir3, 'src', `mod${i}.js`), 'x');
  for (let i = 0; i < 4; i++) writeFileSync(join(dir3, 'test', `mod${i}.test.js`), 'test');
  const { output: out3 } = runAudit(dir3);
  assert.equal(out3.checks.find(c => c.id === 'robustness-test-ratio').result, 'pass');
});

// ---------------------------------------------------------------------------
// Test 8: AC completion rate — N/A + partial
// ---------------------------------------------------------------------------
test('AC completion — N/A (no features) + partial (50%)', () => {
  // No features dir
  const dir1 = createTempRepo();
  writeFileSync(join(dir1, 'package.json'), '{}');
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.checks.find(c => c.id === 'scope-ac-completion').result, 'n/a');

  // 50% completion
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), '{}');
  mkdirSync(join(dir2, 'docs', 'features', 'feat-a', 'requests'), { recursive: true });
  writeFileSync(
    join(dir2, 'docs', 'features', 'feat-a', 'requests', '2026-01-01-test.md'),
    '## AC\n\n- [x] Done 1\n- [x] Done 2\n- [ ] Todo 1\n- [ ] Todo 2'
  );
  const { output: out2 } = runAudit(dir2);
  const ac = out2.checks.find(c => c.id === 'scope-ac-completion');
  assert.equal(ac.result, 'partial');
  assert.ok(ac.message.includes('50%'), `Expected 50% in message, got: ${ac.message}`);
});

// ---------------------------------------------------------------------------
// Test 9: Confidence metric — N/A checks reduce confidence
// ---------------------------------------------------------------------------
test('confidence — N/A checks reduce dimension confidence', () => {
  const dir = createTempRepo();
  // Only package.json — scope checks should be N/A (no docs/features)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
  writeFileSync(join(dir, 'README.md'), '# Test\n');

  const { output } = runAudit(dir);
  const scope = output.dimensions.scope;
  // Both scope checks should be N/A → confidence = 0
  assert.equal(scope.confidence, 0, `Expected scope confidence 0, got ${scope.confidence}`);
  assert.equal(scope.applicable_checks, 0);
});

// ---------------------------------------------------------------------------
// Test 10: Status determination — Blocked / Needs Work / Healthy
// ---------------------------------------------------------------------------
test('status — Blocked/Needs Work/Healthy correctly determined', () => {
  // Blocked (no README = P0, no manifest = P0)
  const dir1 = createTempRepo();
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.status, 'Blocked');

  // Needs Work (has manifest + README but missing CI = P1)
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), JSON.stringify({ name: 'test', scripts: { test: 'jest', start: 'node .', dev: 'node .', build: 'tsc' } }));
  writeFileSync(join(dir2, 'LICENSE'), 'MIT');
  writeFileSync(join(dir2, 'tsconfig.json'), '{}');
  writeFileSync(join(dir2, 'yarn.lock'), '');
  writeFileSync(join(dir2, '.env.example'), 'X=1');
  const readmeLines = ['# Project', '', '## Install', '', '## Usage', '', '## API', ''];
  for (let i = 0; i < 45; i++) readmeLines.push(`Line ${i}`);
  writeFileSync(join(dir2, 'README.md'), readmeLines.join('\n'));
  const { output: out2 } = runAudit(dir2);
  // Should have P1 (missing CI, missing tests) but no P0
  assert.equal(out2.status, 'Needs Work');

  // Healthy is tested in Test 3
});

// ---------------------------------------------------------------------------
// Test 11: next_actions — /create-request suggested when >= 3 P0+P1
// ---------------------------------------------------------------------------
test('next_actions — /create-request suggested when >= 3 P0+P1', () => {
  const dir = createTempRepo();
  // Empty repo has many P0+P1 findings
  const { output } = runAudit(dir);
  const p0p1Count = output.findings.p0 + output.findings.p1;
  assert.ok(p0p1Count >= 3, `Expected >= 3 P0+P1, got ${p0p1Count}`);
  const createReq = output.next_actions.find(a => a.id === 'create-request');
  assert.ok(createReq, 'next_actions should include create-request');
  assert.equal(createReq.command, '/sd0x-dev-flow:create-request');
});

// ---------------------------------------------------------------------------
// Test 12: Markdown output — correct format sections
// ---------------------------------------------------------------------------
test('markdown output — has all expected sections', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
  writeFileSync(join(dir, 'README.md'), '# Test\n');

  const { output } = runAuditMarkdown(dir);
  assert.ok(output.includes('## Project Audit Report'), 'Should have report header');
  assert.ok(output.includes('### Dimensions'), 'Should have dimensions section');
  assert.ok(output.includes('### Checks'), 'Should have checks section');
  assert.ok(output.includes('## Gate:'), 'Should have gate sentinel');
});

// ---------------------------------------------------------------------------
// Test 13: Exit codes — 0/1/2 mapping
// ---------------------------------------------------------------------------
test('exit codes — 0 (healthy), 1 (P1), 2 (P0)', () => {
  // Exit 2 (P0)
  const dir1 = createTempRepo();
  const { exitCode: code1 } = runAudit(dir1);
  assert.equal(code1, 2, 'Empty repo should exit 2');

  // Exit 1 (P1, no P0) — need manifest + README but missing other things
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), JSON.stringify({ name: 'test', scripts: { start: 'node .' } }));
  const readmeLines = ['# Project', '', '## Install', '', '## Usage', '', '## API', ''];
  for (let i = 0; i < 45; i++) readmeLines.push(`Line ${i}`);
  writeFileSync(join(dir2, 'README.md'), readmeLines.join('\n'));
  const { exitCode: code2 } = runAudit(dir2);
  assert.equal(code2, 1, 'Minimal project with no CI should exit 1');

  // Exit 0 is tested in Test 3
});

// ---------------------------------------------------------------------------
// Test 14: 12 checks always present
// ---------------------------------------------------------------------------
test('all 12 checks present in output', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), '{}');
  writeFileSync(join(dir, 'README.md'), '# Test\n');

  const { output } = runAudit(dir);
  assert.equal(output.checks.length, 12, `Expected 12 checks, got ${output.checks.length}`);
  const ids = output.checks.map(c => c.id);
  const expected = [
    'oss-license', 'oss-readme',
    'robustness-ci', 'robustness-lint-typecheck', 'robustness-test-ratio',
    'scope-declared-impl', 'scope-ac-completion',
    'runnability-manifest', 'runnability-scripts', 'runnability-env-docker',
    'stability-lock-audit', 'stability-type-config',
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `Missing check: ${id}`);
  }
});

// ---------------------------------------------------------------------------
// Test 15: Version field
// ---------------------------------------------------------------------------
test('output has version 1', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), '{}');
  const { output } = runAudit(dir);
  assert.equal(output.version, 1);
});

// ---------------------------------------------------------------------------
// Test 16: scope-declared-impl fail and pass branches
// ---------------------------------------------------------------------------
test('scope-declared-impl — fail (docs but no src) and pass (docs + src)', () => {
  // Fail: feature docs exist but no source dir
  const dir1 = createTempRepo();
  writeFileSync(join(dir1, 'package.json'), '{}');
  mkdirSync(join(dir1, 'docs', 'features', 'feat-a'), { recursive: true });
  writeFileSync(join(dir1, 'docs', 'features', 'feat-a', 'spec.md'), '# Spec');
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.checks.find(c => c.id === 'scope-declared-impl').result, 'fail');

  // Pass: feature docs + src dir
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), '{}');
  mkdirSync(join(dir2, 'docs', 'features', 'feat-a'), { recursive: true });
  writeFileSync(join(dir2, 'docs', 'features', 'feat-a', 'spec.md'), '# Spec');
  mkdirSync(join(dir2, 'src'), { recursive: true });
  writeFileSync(join(dir2, 'src', 'app.js'), 'x');
  const { output: out2 } = runAudit(dir2);
  assert.equal(out2.checks.find(c => c.id === 'scope-declared-impl').result, 'pass');
});

// ---------------------------------------------------------------------------
// Test 17: scope-ac-completion fail and pass branches
// ---------------------------------------------------------------------------
test('scope-ac-completion — fail(<50%) and pass(>=80%)', () => {
  // Fail: 1/3 = 33%
  const dir1 = createTempRepo();
  writeFileSync(join(dir1, 'package.json'), '{}');
  mkdirSync(join(dir1, 'docs', 'features', 'f1', 'requests'), { recursive: true });
  writeFileSync(
    join(dir1, 'docs', 'features', 'f1', 'requests', '2026-01-01-test.md'),
    '- [x] Done\n- [ ] Todo 1\n- [ ] Todo 2'
  );
  const { output: out1 } = runAudit(dir1);
  assert.equal(out1.checks.find(c => c.id === 'scope-ac-completion').result, 'fail');

  // Pass: 4/5 = 80%
  const dir2 = createTempRepo();
  writeFileSync(join(dir2, 'package.json'), '{}');
  mkdirSync(join(dir2, 'docs', 'features', 'f1', 'requests'), { recursive: true });
  writeFileSync(
    join(dir2, 'docs', 'features', 'f1', 'requests', '2026-01-01-test.md'),
    '- [x] a\n- [x] b\n- [x] c\n- [x] d\n- [ ] e'
  );
  const { output: out2 } = runAudit(dir2);
  assert.equal(out2.checks.find(c => c.id === 'scope-ac-completion').result, 'pass');
});

// ---------------------------------------------------------------------------
// Test 18: stability-lock-audit pass (lock + audit script)
// ---------------------------------------------------------------------------
test('stability-lock-audit — pass when lock + audit script exist', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'test',
    scripts: { audit: 'npm audit' },
    dependencies: { lodash: '^4.0.0' },
  }));
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const { output } = runAudit(dir);
  assert.equal(output.checks.find(c => c.id === 'stability-lock-audit').result, 'pass');
});

// ---------------------------------------------------------------------------
// Test 19: Invalid --dir exits 2
// ---------------------------------------------------------------------------
test('invalid --dir exits 2 with error', () => {
  const badPath = join(tmpdir(), 'sd0x-nonexistent-dir-' + Date.now());
  const { exitCode } = runAudit(badPath);
  assert.equal(exitCode, 2);
});

// ---------------------------------------------------------------------------
// Test 20: Non-git repo without --dir exits 2
// ---------------------------------------------------------------------------
test('non-git repo without --dir exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-audit-nogit-'));
  tempDirs.push(dir);
  try {
    execFileSync('node', [scriptPath, '--json'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.fail('Expected non-zero exit');
  } catch (err) {
    assert.equal(err.status, 2, 'Should exit 2 when not in a git repo');
  }
});

// ---------------------------------------------------------------------------
// Test 21: Go _test.go files counted as tests, not source
// ---------------------------------------------------------------------------
test('Go_test.go files excluded from source count, counted as tests', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21');
  writeFileSync(join(dir, 'README.md'), '# Go\n');
  mkdirSync(join(dir, 'pkg'), { recursive: true });
  // 3 source .go files + 1 _test.go file
  writeFileSync(join(dir, 'pkg', 'main.go'), 'package main');
  writeFileSync(join(dir, 'pkg', 'handler.go'), 'package main');
  writeFileSync(join(dir, 'pkg', 'util.go'), 'package main');
  writeFileSync(join(dir, 'pkg', 'main_test.go'), 'package main');

  const { output } = runAudit(dir);
  const ratio = output.checks.find(c => c.id === 'robustness-test-ratio');
  // 1 test / 3 src = 33% → pass
  assert.equal(ratio.result, 'pass', `Expected pass (33%), got ${ratio.result}: ${ratio.message}`);
  assert.ok(ratio.message.includes('1/3') || ratio.message.includes('33%'), `Ratio should be ~33%, got: ${ratio.message}`);
});

// ---------------------------------------------------------------------------
// Test 22: Dotnet ecosystem detection via *.csproj glob
// ---------------------------------------------------------------------------
test('dotnet ecosystem detected via*.csproj glob', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'MyApp.csproj'), '<Project></Project>');
  writeFileSync(join(dir, 'README.md'), '# Dotnet\n');

  const { output } = runAudit(dir);
  // Dotnet is static-typed → lint/typecheck should pass
  const lintCheck = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(lintCheck.result, 'pass', 'Dotnet should auto-pass lint/typecheck');
  // Manifest should be found via glob fallback
  const manifest = output.checks.find(c => c.id === 'runnability-manifest');
  assert.equal(manifest.result, 'pass', 'Dotnet csproj should be detected as manifest');
});

// ---------------------------------------------------------------------------
// Test 23: Non-Node lock-audit pass for Go (built-in audit)
// ---------------------------------------------------------------------------
test('stability-lock-audit — pass for Go project with go.sum (built-in audit)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21');
  writeFileSync(join(dir, 'go.sum'), 'example.com/dep v1.0.0 h1:abc=');
  writeFileSync(join(dir, 'README.md'), '# Go\n');

  const { output } = runAudit(dir);
  const lockAudit = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.equal(lockAudit.result, 'pass', `Go with go.sum should pass lock-audit, got ${lockAudit.result}: ${lockAudit.message}`);
});

// ---------------------------------------------------------------------------
// Test 24: Non-Node lock-audit pass for Rust (built-in audit)
// ---------------------------------------------------------------------------
test('stability-lock-audit — pass for Rust project with Cargo.lock (built-in audit)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "test"');
  writeFileSync(join(dir, 'Cargo.lock'), '[[package]]\nname = "test"');
  writeFileSync(join(dir, 'README.md'), '# Rust\n');

  const { output } = runAudit(dir);
  const lockAudit = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.equal(lockAudit.result, 'pass', `Rust with Cargo.lock should pass lock-audit, got ${lockAudit.result}: ${lockAudit.message}`);
});

// ---------------------------------------------------------------------------
// Test 25: Nested .csproj detected (shallow recursive scan)
// ---------------------------------------------------------------------------
test('dotnet nested csproj detected via shallow recursive scan', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'src', 'MyApp'), { recursive: true });
  writeFileSync(join(dir, 'src', 'MyApp', 'MyApp.csproj'), '<Project></Project>');
  writeFileSync(join(dir, 'README.md'), '# Dotnet\n');

  const { output } = runAudit(dir);
  const lintCheck = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(lintCheck.result, 'pass', 'Nested csproj should detect dotnet ecosystem');
  const manifest = output.checks.find(c => c.id === 'runnability-manifest');
  assert.equal(manifest.result, 'pass', 'Nested csproj should be detected as manifest');
});

// ---------------------------------------------------------------------------
// Test 26: Cross-ecosystem lock file — Go + package-lock.json gives partial, not pass
// ---------------------------------------------------------------------------
test('stability-lock-audit — cross-ecosystem lock gives partial (go.mod + package-lock.json)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21');
  // Unrelated package-lock.json from some Node tooling — no go.sum
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  writeFileSync(join(dir, 'README.md'), '# Go\n');

  const { output } = runAudit(dir);
  const lockAudit = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.equal(lockAudit.result, 'partial', `Go with only package-lock.json (no go.sum) should be partial, got ${lockAudit.result}: ${lockAudit.message}`);
});

// ---------------------------------------------------------------------------
// Test 27: scope-declared-impl — pass with code files outside src/ dir
// ---------------------------------------------------------------------------
test('scope-declared-impl — pass when code exists outside src/ (e.g. scripts/)', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'README.md'), '# Feature\n');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'audit.js'), 'const x = 1;\n');
  writeFileSync(join(dir, 'README.md'), '# Test\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'scope-declared-impl');
  assert.equal(check.result, 'pass', `Code in scripts/ should satisfy scope check, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 28: scope-declared-impl — fail with only test files
// ---------------------------------------------------------------------------
test('scope-declared-impl — fail when only test files exist (no source code)', () => {
  const dir = createTempRepo();
  mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'features', 'README.md'), '# Feature\n');
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', 'foo.test.js'), 'const assert = require("assert");\n');
  writeFileSync(join(dir, 'README.md'), '# Test\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'scope-declared-impl');
  assert.equal(check.result, 'fail', `Only test files should not satisfy scope check, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 29: stability-lock-audit — n/a for Node project with zero dependencies
// ---------------------------------------------------------------------------
test('stability-lock-audit — n/a for Node zero-dependency project', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zero-deps', scripts: { test: 'echo ok' } }));
  writeFileSync(join(dir, 'README.md'), '# Zero\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.equal(check.result, 'n/a', `Node project with zero deps should be n/a, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 30: stability-lock-audit — Go projects still checked (not n/a)
// ---------------------------------------------------------------------------
test('stability-lock-audit — Go project without go.sum still fails (no n/a bypass)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n\ngo 1.21\n');
  writeFileSync(join(dir, 'README.md'), '# Go\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.notEqual(check.result, 'n/a', `Go project should not get n/a for lock-audit, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 31: runnability-env-docker — n/a for zero deps + no runtime scripts
// ---------------------------------------------------------------------------
test('runnability-env-docker — n/a when zero deps and no runtime scripts', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tool', scripts: { test: 'node --test' } }));
  writeFileSync(join(dir, 'README.md'), '# Tool\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'runnability-env-docker');
  assert.equal(check.result, 'n/a', `Zero-dep non-runtime project should be n/a for env-docker, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 32: runnability-scripts — non-runtime with test only → pass
// ---------------------------------------------------------------------------
test('runnability-scripts — non-runtime project with test script passes', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tool', scripts: { test: 'node --test' } }));
  writeFileSync(join(dir, 'README.md'), '# Tool\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'runnability-scripts');
  assert.equal(check.result, 'pass', `Non-runtime with test should pass, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 33: runnability-scripts — non-runtime with no scripts → fail
// ---------------------------------------------------------------------------
test('runnability-scripts — non-runtime project with no scripts fails', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'empty' }));
  writeFileSync(join(dir, 'README.md'), '# Empty\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'runnability-scripts');
  assert.equal(check.result, 'fail', `Non-runtime with no scripts should fail, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 34: stability-type-config — partial for pure JS project
// ---------------------------------------------------------------------------
test('stability-type-config — pure JS project gets partial (not fail)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'js-only', scripts: { test: 'echo ok' } }));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(dir, 'README.md'), '# JS\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'stability-type-config');
  assert.equal(check.result, 'partial', `Pure JS project should be partial, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 35: isNodeZeroDeps — workspace root not treated as zero-deps
// ---------------------------------------------------------------------------
test('stability-lock-audit — workspace root with no root deps is not n/a', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'monorepo',
    workspaces: ['packages/*'],
    scripts: { test: 'echo ok' },
  }));
  writeFileSync(join(dir, 'README.md'), '# Monorepo\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'stability-lock-audit');
  assert.notEqual(check.result, 'n/a', `Workspace root should not get n/a for lock-audit, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 36: runnability-env-docker — mixed node+go repo not n/a
// ---------------------------------------------------------------------------
test('runnability-env-docker — mixed node+go repo does not get n/a', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'mixed', scripts: { test: 'echo ok' } }));
  writeFileSync(join(dir, 'go.mod'), 'module example.com/mixed\n\ngo 1.21\n');
  writeFileSync(join(dir, 'README.md'), '# Mixed\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'runnability-env-docker');
  assert.notEqual(check.result, 'n/a', `Mixed node+go repo should not bypass env-docker check, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 37: runnability-scripts — serve-only runtime gets partial (not pass)
// ---------------------------------------------------------------------------
test('runnability-scripts — serve-only runtime project gets partial', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'serve-only',
    scripts: { serve: 'vite preview' },
  }));
  writeFileSync(join(dir, 'README.md'), '# Serve\n');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'runnability-scripts');
  assert.equal(check.result, 'partial', `serve-only runtime should be partial (serve detected but missing build/test), got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Helper: bulk file creation for docs-heavy tests
// ---------------------------------------------------------------------------
function createManyFiles(dir, count, ext, subdir = '') {
  const target = subdir ? join(dir, subdir) : dir;
  if (subdir) mkdirSync(target, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(target, `file-${i}${ext}`), `# File ${i}\n`);
  }
}

// ---------------------------------------------------------------------------
// Test 38: docs-heavy with markdownlint pass
// ---------------------------------------------------------------------------
test('docs-heavy + markdownlint script + config → lint-typecheck pass', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'docs-project',
    scripts: { test: 'echo ok', 'lint:md': 'npx markdownlint-cli2 "**/*.md"' },
  }));
  writeFileSync(join(dir, '.markdownlint-cli2.jsonc'), '{ "config": { "default": true } }');
  writeFileSync(join(dir, 'README.md'), '# Docs Project\n');
  // 30 .md files + 5 .js files → doc_ratio = 30/35 ≈ 86% ≥ 60%, docs ≥ 30
  createManyFiles(dir, 30, '.md', 'docs');
  createManyFiles(dir, 5, '.js', 'scripts');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(check.result, 'pass', `Docs-heavy + both signals should pass, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 39: docs-heavy with config only → partial
// ---------------------------------------------------------------------------
test('docs-heavy + config only (no script) → lint-typecheck partial', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'docs-project',
    scripts: { test: 'echo ok' },
  }));
  writeFileSync(join(dir, '.markdownlint-cli2.jsonc'), '{ "config": { "default": true } }');
  writeFileSync(join(dir, 'README.md'), '# Docs\n');
  createManyFiles(dir, 30, '.md', 'docs');
  createManyFiles(dir, 5, '.js', 'scripts');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(check.result, 'partial', `Docs-heavy + config only should be partial, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 40: docs-heavy with no markdownlint signals → fallback to fail
// ---------------------------------------------------------------------------
test('docs-heavy + no markdownlint signals → lint-typecheck fail (fallback)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'docs-project',
    scripts: { test: 'echo ok' },
  }));
  writeFileSync(join(dir, 'README.md'), '# Docs\n');
  createManyFiles(dir, 30, '.md', 'docs');
  createManyFiles(dir, 5, '.js', 'scripts');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(check.result, 'fail', `Docs-heavy with no signals should fall through to fail, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 41: non-docs-heavy ignores markdown lint config
// ---------------------------------------------------------------------------
test('non-docs-heavy project ignores markdownlint config → lint-typecheck fail', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'code-project',
    scripts: { test: 'echo ok' },
  }));
  writeFileSync(join(dir, '.markdownlint-cli2.jsonc'), '{ "config": { "default": true } }');
  writeFileSync(join(dir, 'README.md'), '# Code\n');
  // 5 .md + 20 .js → doc_ratio = 5/25 = 20% < 60% → not docs-heavy
  createManyFiles(dir, 5, '.md', 'docs');
  createManyFiles(dir, 20, '.js', 'src');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(check.result, 'fail', `Non-docs-heavy should ignore markdownlint config, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 42: docs-heavy threshold boundary — 29 docs not enough
// ---------------------------------------------------------------------------
test('docs-heavy boundary — 29 .md files does not qualify (need >= 30)', () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'almost-docs',
    scripts: { test: 'echo ok', 'lint:md': 'npx markdownlint-cli2 "**/*.md"' },
  }));
  writeFileSync(join(dir, '.markdownlint-cli2.jsonc'), '{ "config": { "default": true } }');
  writeFileSync(join(dir, 'README.md'), '# Almost\n');
  // 28 in docs/ + 1 README.md = 29 total .md + 1 .js → doc_ratio = 29/30 ≈ 97% but docs = 29 < 30
  createManyFiles(dir, 28, '.md', 'docs');
  createManyFiles(dir, 1, '.js', 'scripts');

  const { output } = runAudit(dir);
  const check = output.checks.find(c => c.id === 'robustness-lint-typecheck');
  assert.equal(check.result, 'fail', `29 docs should not qualify as docs-heavy, got ${check.result}: ${check.message}`);
});

// ---------------------------------------------------------------------------
// Test 43: next_actions commands use qualified format
// ---------------------------------------------------------------------------
test('next_actions commands use qualified /sd0x-dev-flow: prefix', () => {
  const dir = createTempRepo();
  // Empty repo generates many findings → next_actions with commands
  const { output } = runAudit(dir);
  const withCommands = output.next_actions.filter(a => a.command);
  assert.ok(withCommands.length > 0, 'Should have next_actions with commands');
  for (const action of withCommands) {
    assert.ok(
      action.command.startsWith('/sd0x-dev-flow:'),
      `Expected qualified command, got: ${action.command}`
    );
  }
});
