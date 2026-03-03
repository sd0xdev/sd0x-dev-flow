const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync, mkdtempSync, rmSync } = require('node:fs');
const { execSync } = require('node:child_process');
const { tmpdir } = require('node:os');

const scriptPath = resolve(__dirname, '../../scripts/pre-push-gate.sh');

test('pre-push-gate.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('non-protected branch passes without confirmation', () => {
  const stdinData = 'refs/heads/feat/test abc123 refs/heads/feat/test 0000000000000000000000000000000000000000';
  const output = execSync(
    `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `non-protected branch should pass, got: ${output}`);
});

test('bypass allows protected branch push', () => {
  const stdinData = 'refs/heads/main abc123 refs/heads/main 0000000000000000000000000000000000000000';
  const output = execSync(
    `echo "${stdinData}" | ALLOW_PUSH_PROTECTED=1 bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `bypass should allow protected branch push, got: ${output}`);
});

test('protected branch without tty exits non-zero', () => {
  const stdinData = 'refs/heads/main abc123 refs/heads/main 0000000000000000000000000000000000000000';
  try {
    execSync(
      `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    // If /dev/tty is available and read returned empty, script should still exit non-zero
    // because confirmation != "yes"
    assert.fail('protected branch push should exit non-zero without "yes" confirmation');
  } catch (err) {
    if (err.code === 'ERR_ASSERTION') throw err;
    const output = (err.stdout || '') + (err.stderr || '');
    assert.ok(
      output.includes('pre-push-gate') || err.status !== 0,
      `protected branch push should fail without confirmation, got: ${output}`
    );
  }
});

test('detects all protected branch patterns', () => {
  const protectedBranches = ['main', 'master', 'develop', 'release/v1.0'];
  for (const branch of protectedBranches) {
    const stdinData = `refs/heads/${branch} abc123 refs/heads/${branch} 0000000000000000000000000000000000000000`;
    try {
      execSync(
        `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      assert.fail(`${branch} should be detected as protected and exit non-zero`);
    } catch (err) {
      if (err.code === 'ERR_ASSERTION') throw err;
      const output = (err.stdout || '') + (err.stderr || '');
      assert.ok(
        output.includes('protected branch') || output.includes('pre-push-gate'),
        `${branch} should be detected as protected, got: ${output}`
      );
    }
  }
});

test('non-protected branches pass through', () => {
  const safeBranches = ['feat/auth', 'fix/bug-123', 'docs/readme', 'refactor/cleanup'];
  for (const branch of safeBranches) {
    const stdinData = `refs/heads/${branch} abc123 refs/heads/${branch} 0000000000000000000000000000000000000000`;
    const output = execSync(
      `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('EXIT:0'), `${branch} should pass through, got: ${output}`);
  }
});

test('empty stdin (no refs) passes through', () => {
  const output = execSync(
    `echo "" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `empty stdin should pass through, got: ${output}`);
});

test('non-fast-forward push detected in real git repo', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'pre-push-test-'));
  try {
    execSync(
      'git init && git -c user.name=test -c user.email=test@test.com commit --allow-empty -m "init"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha1 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    execSync(
      'git -c user.name=test -c user.email=test@test.com commit --allow-empty -m "second"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha2 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    // Simulate force push: remote has sha2 but pushing sha1 (sha2 is NOT ancestor of sha1)
    const stdinData = `refs/heads/feat/test ${sha1} refs/heads/feat/test ${sha2}`;
    try {
      execSync(
        `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1`,
        { encoding: 'utf8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      assert.fail('non-fast-forward push should be blocked');
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      assert.ok(
        output.includes('Non-fast-forward') || output.includes('non-fast-forward'),
        `should detect non-fast-forward push, got: ${output}`
      );
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ALLOW_FORCE_WITH_LEASE bypasses non-fast-forward check', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'pre-push-test-'));
  try {
    execSync(
      'git init && git -c user.name=test -c user.email=test@test.com commit --allow-empty -m "init"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha1 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    execSync(
      'git -c user.name=test -c user.email=test@test.com commit --allow-empty -m "second"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha2 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    // With ALLOW_FORCE_WITH_LEASE, non-fast-forward on non-protected branch should pass
    const stdinData = `refs/heads/feat/test ${sha1} refs/heads/feat/test ${sha2}`;
    const output = execSync(
      `echo "${stdinData}" | ALLOW_FORCE_WITH_LEASE=1 bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { encoding: 'utf8', cwd: tmpDir }
    );
    assert.ok(output.includes('EXIT:0'), `ALLOW_FORCE_WITH_LEASE should allow non-ff push, got: ${output}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
