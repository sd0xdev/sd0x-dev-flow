const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const {
  safeSlug,
  sha1,
  hasScript,
  pmCommand,
  detectPackageManager,
  tailLinesFromFile,
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
