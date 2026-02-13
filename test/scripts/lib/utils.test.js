const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const {
  safeSlug,
  sha1,
  hasScript,
  pmCommand,
  detectPackageManager,
  tailLinesFromFile,
  stripAnsi,
  defaultStdoutFilter,
  testStdoutFilter,
  runCapture,
  readPackageJson,
  ensureDir,
  writeText,
  appendLog,
  getPluginName,
  qualifyCommand,
} = require('../../../scripts/lib/utils');

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safeSlug', () => {
  assert.equal(safeSlug('Hello World'), 'Hello-World');
  assert.equal(safeSlug('Hello, World!!'), 'Hello-World');
  assert.equal(safeSlug(''), '');
  assert.equal(safeSlug('Hello   World'), 'Hello-World');

  const long = 'a'.repeat(90);
  assert.equal(safeSlug(long).length, 80);
  assert.equal(safeSlug(long), 'a'.repeat(80));
});

test('sha1', () => {
  assert.equal(sha1('hello'), 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  assert.equal(sha1(''), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(sha1('✓'), '698a879938bf4d71b92190d2b8f19c0e1d4abeef');
});

test('hasScript', () => {
  assert.equal(hasScript({ scripts: { test: 'node test.js' } }, 'test'), true);
  assert.equal(hasScript({ scripts: { build: 'node build.js' } }, 'test'), false);
  assert.equal(hasScript(null, 'test'), false);
  assert.equal(hasScript({ name: 'no-scripts' }, 'test'), false);
});

test('pmCommand', () => {
  assert.deepEqual(pmCommand('npm', 'test'), ['npm', ['run', 'test', '--']]);
  assert.deepEqual(pmCommand('npm', 'test', ['-u']), [
    'npm',
    ['run', 'test', '--', '-u'],
  ]);
  assert.deepEqual(pmCommand('yarn', 'test'), ['yarn', ['test']]);
  assert.deepEqual(pmCommand('pnpm', 'test', ['--filter', 'api']), [
    'pnpm',
    ['test', '--filter', 'api'],
  ]);
});

test('detectPackageManager', () => {
  const pnpmDir = makeTempDir('sd0x-pnpm-');
  writeFileSync(join(pnpmDir, 'pnpm-lock.yaml'), '');
  assert.equal(detectPackageManager(pnpmDir), 'pnpm');

  const yarnDir = makeTempDir('sd0x-yarn-');
  writeFileSync(join(yarnDir, 'yarn.lock'), '');
  assert.equal(detectPackageManager(yarnDir), 'yarn');

  const npmDir = makeTempDir('sd0x-npm-');
  assert.equal(detectPackageManager(npmDir), 'npm');

  const bothDir = makeTempDir('sd0x-both-');
  writeFileSync(join(bothDir, 'yarn.lock'), '');
  writeFileSync(join(bothDir, 'pnpm-lock.yaml'), '');
  assert.equal(detectPackageManager(bothDir), 'pnpm');
});

test('tailLinesFromFile', () => {
  const dir = makeTempDir('sd0x-tail-');
  const filePath = join(dir, 'sample.txt');
  writeFileSync(filePath, 'line1\nline2\nline3\nline4');

  assert.equal(tailLinesFromFile(filePath, 2), 'line3\nline4');

  const emptyPath = join(dir, 'empty.txt');
  writeFileSync(emptyPath, '');
  assert.equal(tailLinesFromFile(emptyPath, 5), '');

  const missingPath = join(dir, 'missing.txt');
  assert.equal(tailLinesFromFile(missingPath, 5), '');
});

test('stripAnsi', () => {
  // Plain text - no change
  assert.equal(stripAnsi('hello world'), 'hello world');
  assert.equal(stripAnsi(''), '');

  // Single ANSI code
  assert.equal(stripAnsi('\x1B[32mgreen\x1B[0m'), 'green');

  // Multiple ANSI codes
  assert.equal(
    stripAnsi('\x1B[1m\x1B[32mPASS\x1B[39m\x1B[22m test/foo.test.js'),
    'PASS test/foo.test.js'
  );

  // Bold + color reset
  assert.equal(stripAnsi('\x1B[1mBold\x1B[0m Normal'), 'Bold Normal');

  // Jest-style FAIL output with colors
  assert.equal(
    stripAnsi('\x1B[1m\x1B[31mFAIL\x1B[39m\x1B[22m test/bar.test.js'),
    'FAIL test/bar.test.js'
  );

  // Mixed content
  assert.equal(
    stripAnsi('prefix \x1B[33mwarn\x1B[0m suffix'),
    'prefix warn suffix'
  );
});

test('defaultStdoutFilter', () => {
  // Should always return true
  assert.equal(defaultStdoutFilter('anything'), true);
  assert.equal(defaultStdoutFilter(''), true);
  assert.equal(defaultStdoutFilter('PASS test/foo.test.js'), true);
  assert.equal(defaultStdoutFilter('FAIL test/bar.test.js'), true);
});

test('testStdoutFilter - PASS suppression', () => {
  // Individual PASS lines should be suppressed
  assert.equal(testStdoutFilter('PASS test/foo.test.js'), false);
  assert.equal(testStdoutFilter('  PASS test/bar.test.js'), false);

  // PASS with ANSI codes should also be suppressed
  assert.equal(
    testStdoutFilter('\x1B[1m\x1B[32mPASS\x1B[39m\x1B[22m test/foo.test.js'),
    false
  );
});

test('testStdoutFilter - FAIL always shown', () => {
  // FAIL lines should always be shown
  assert.equal(testStdoutFilter('FAIL test/foo.test.js'), true);
  assert.equal(testStdoutFilter('  FAIL test/bar.test.js'), true);

  // FAIL with ANSI codes
  assert.equal(
    testStdoutFilter('\x1B[1m\x1B[31mFAIL\x1B[39m\x1B[22m test/bar.test.js'),
    true
  );

  // Lines containing FAIL anywhere
  assert.equal(testStdoutFilter('Something FAIL something'), true);
});

test('testStdoutFilter - summary lines always shown', () => {
  // Test summary lines
  assert.equal(testStdoutFilter('Tests: 10 passed, 10 total'), true);
  assert.equal(testStdoutFilter('Test Suites: 5 passed, 5 total'), true);
  assert.equal(testStdoutFilter('Time: 2.5s'), true);
  assert.equal(testStdoutFilter('Ran all test suites.'), true);
});

test('testStdoutFilter - error indicators always shown', () => {
  // Error keywords
  assert.equal(testStdoutFilter('ERROR: something went wrong'), true);
  assert.equal(testStdoutFilter('Error: test failed'), true);
  assert.equal(testStdoutFilter('✕ test name (5ms)'), true);
  assert.equal(testStdoutFilter('✖ another test'), true);
});

test('testStdoutFilter - other output allowed', () => {
  // Blank lines
  assert.equal(testStdoutFilter(''), true);

  // Regular output
  assert.equal(testStdoutFilter('Running tests...'), true);
  assert.equal(testStdoutFilter('> jest --coverage'), true);

  // Partial matches that are NOT PASS/FAIL
  assert.equal(testStdoutFilter('PASSING through'), true);
  assert.equal(testStdoutFilter('FAILURE mode'), true);
});

// =============================================================================
// runCapture
// =============================================================================

test('runCapture with successful command', async () => {
  const result = await runCapture('node', ['-e', 'process.stdout.write("hello")']);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'hello');
  assert.equal(result.stderr, '');
});

test('runCapture with failing command', async () => {
  const result = await runCapture('node', ['-e', 'process.exit(42)']);
  assert.equal(result.code, 42);
});

test('runCapture with nonexistent command', async () => {
  const result = await runCapture('nonexistent-cmd-xyz-12345', []);
  assert.equal(result.code, 127);
});

test('runCapture captures stderr', async () => {
  const result = await runCapture('node', ['-e', 'process.stderr.write("err")']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, 'err');
});

// =============================================================================
// readPackageJson
// =============================================================================

test('readPackageJson with valid file', () => {
  const dir = makeTempDir('sd0x-pkg-');
  writeFileSync(join(dir, 'package.json'), '{"name":"test","version":"1.0.0"}');
  const pkg = readPackageJson(dir);
  assert.deepEqual(pkg, { name: 'test', version: '1.0.0' });
});

test('readPackageJson with missing file', () => {
  const dir = makeTempDir('sd0x-pkg-missing-');
  const pkg = readPackageJson(dir);
  assert.equal(pkg, null);
});

test('readPackageJson with invalid JSON', () => {
  const dir = makeTempDir('sd0x-pkg-invalid-');
  writeFileSync(join(dir, 'package.json'), '{invalid json}');
  const pkg = readPackageJson(dir);
  assert.equal(pkg, null);
});

// =============================================================================
// File utilities
// =============================================================================

test('ensureDir creates nested directories', () => {
  const dir = makeTempDir('sd0x-ensure-');
  const nested = join(dir, 'a', 'b', 'c');
  ensureDir(nested);
  assert.ok(existsSync(nested));
});

test('writeText creates file with content', () => {
  const dir = makeTempDir('sd0x-write-');
  const filePath = join(dir, 'sub', 'test.txt');
  writeText(filePath, 'hello world');
  assert.equal(readFileSync(filePath, 'utf8'), 'hello world');
});

test('appendLog appends to file', () => {
  const dir = makeTempDir('sd0x-append-');
  const filePath = join(dir, 'log.txt');
  appendLog(filePath, 'line1\n');
  appendLog(filePath, 'line2\n');
  assert.equal(readFileSync(filePath, 'utf8'), 'line1\nline2\n');
});

// =============================================================================
// getPluginName / qualifyCommand
// =============================================================================

test('getPluginName returns sd0x-dev-flow from plugin.json', () => {
  const name = getPluginName();
  assert.equal(name, 'sd0x-dev-flow');
});

test('qualifyCommand prefixes short-form commands', () => {
  assert.equal(qualifyCommand('/codex-review-fast'), '/sd0x-dev-flow:codex-review-fast');
  assert.equal(qualifyCommand('/precommit'), '/sd0x-dev-flow:precommit');
  assert.equal(qualifyCommand('/update-docs'), '/sd0x-dev-flow:update-docs');
});

test('qualifyCommand returns already-qualified commands unchanged', () => {
  assert.equal(
    qualifyCommand('/sd0x-dev-flow:codex-review-fast'),
    '/sd0x-dev-flow:codex-review-fast'
  );
});

test('qualifyCommand returns non-slash inputs unchanged', () => {
  assert.equal(qualifyCommand('foo'), 'foo');
  assert.equal(qualifyCommand(''), '');
  assert.equal(qualifyCommand(null), null);
});
