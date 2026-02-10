const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execSync } = require('node:child_process');

const runnerPath = resolve(__dirname, '../../scripts/verify-runner.js');
const tempDirs = [];

function createTempRepo(pkgJson, lockfile) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-verify-'));
  tempDirs.push(dir);
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync(
    'git -c user.name="test" -c user.email="test@test" commit --allow-empty -m "init"',
    { cwd: dir, stdio: 'ignore' }
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson));
  if (lockfile === 'pnpm') writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
  if (lockfile === 'yarn') writeFileSync(join(dir, 'yarn.lock'), '');
  return dir;
}

function writeScript(dir, name, exitCode) {
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(scriptPath, 0o755);
  return `./${name}`;
}

function runVerify(dir, args) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sd0x-verify-cache-'));
  tempDirs.push(cacheDir);
  const env = {
    ...process.env,
    CLAUDE_VERIFY_CACHE_DIR: cacheDir,
  };
  const stdout = execSync(`node ${runnerPath} ${args.join(' ')}`, {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
  const match = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(match, 'log dir not found in output');
  const logDir = match[1];
  const summary = JSON.parse(
    readFileSync(join(logDir, 'summary.json'), 'utf8')
  );
  return { stdout, summary, logDir };
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify runner fast mode', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      lint: './pass.sh',
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runVerify(dir, ['--mode', 'fast']);
  assert.equal(summary.overallPass, true);
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['lint', 'test_unit']
  );
});

test('verify runner full mode', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      lint: './pass.sh',
      typecheck: './pass.sh',
      'test:unit': './pass.sh',
      'test:integration': './pass.sh',
      'test:e2e': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runVerify(dir, [
    '--mode',
    'full',
    '--integration',
    'tests/integration.test.js',
    '--e2e',
    'tests/e2e.test.js',
  ]);
  assert.equal(summary.overallPass, true);
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['lint', 'typecheck', 'test_unit', 'test_integration', 'test_e2e']
  );
});

test('verify runner full mode runs typecheck with tsconfig', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      lint: './pass.sh',
      typecheck: './pass.sh',
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeFileSync(join(dir, 'tsconfig.json'), '{}');

  const { summary } = runVerify(dir, ['--mode', 'full']);
  assert.equal(summary.overallPass, true);
  const typecheckStep = summary.steps.find(step => step.name === 'typecheck');
  assert.ok(typecheckStep, 'typecheck step missing');
  assert.equal(typecheckStep.code, 0);
});

test('verify fast mode skips lint when script missing', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runVerify(dir, ['--mode', 'fast']);
  assert.equal(summary.overallPass, true);
  const lintStep = summary.steps.find(step => step.name === 'lint');
  assert.ok(lintStep, 'lint step should exist as skip');
  assert.equal(lintStep.status, 'skip');
  assert.equal(lintStep.reason, 'script missing');
});

test('verify full mode skips integration without --integration arg', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      lint: './pass.sh',
      'test:unit': './pass.sh',
      'test:integration': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runVerify(dir, ['--mode', 'full']);
  const intStep = summary.steps.find(step => step.name === 'test_integration');
  assert.ok(intStep, 'integration step should exist');
  assert.equal(intStep.status, 'skip');
  assert.match(intStep.reason, /file not specified/);
});
