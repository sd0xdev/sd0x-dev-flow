'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'check-comment-blocks.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
const {
  findBlocks,
  classify,
  isExemptBlock,
  listFiles,
  scan,
  BLOCK_THRESHOLD,
  WARN_THRESHOLD,
} = require(SCRIPT);

function commentLines(n, prefix = '# ') {
  return Array.from({ length: n }, (_, i) => `${prefix}line ${i + 1}`).join('\n');
}

function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function runCli(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

// --- findBlocks ---

test('findBlocks: contiguous shell comments counted as one block', () => {
  const blocks = findBlocks(`code line\n${commentLines(5)}\ncode line\n`);
  assert.deepEqual(blocks, [{ line: 2, count: 5 }]);
});

test('findBlocks: blank line splits a block in two', () => {
  const content = `${commentLines(3)}\n\n${commentLines(4)}\n`;
  const blocks = findBlocks(content);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].count, 3);
  assert.equal(blocks[1].count, 4);
  assert.equal(blocks[1].line, 5);
});

test('findBlocks: block at end of file without trailing newline is reported', () => {
  const blocks = findBlocks(`code\n${commentLines(6, '// ')}`);
  assert.deepEqual(blocks, [{ line: 2, count: 6 }]);
});

test('findBlocks: JSDoc continuation lines (`*`, `/*`, indented) count as comments', () => {
  const content = 'code\n/**\n * a\n * b\n */\ncode\n';
  const blocks = findBlocks(content);
  assert.deepEqual(blocks, [{ line: 2, count: 4 }]);
});

test('findBlocks: empty content → no blocks', () => {
  assert.deepEqual(findBlocks(''), []);
});

test('findBlocks: bare block comment counts unprefixed interior lines (P1 regression)', () => {
  // /* + 28 rationale lines without any prefix + */ — must be ONE 30-line block.
  const interior = Array.from({ length: 28 }, (_, i) => `rationale line ${i + 1}`).join('\n');
  const content = `code();\n/*\n${interior}\n*/\ncode();\n`;
  const blocks = findBlocks(content);
  assert.deepEqual(blocks, [{ line: 2, count: 30 }]);
});

test('findBlocks: single-line /* ... */ does not trap the scanner in-block', () => {
  const content = '/* one-liner */\ncode();\ncode();\n';
  assert.deepEqual(findBlocks(content), [{ line: 1, count: 1 }]);
});

test('findBlocks: shell/# or // comment containing /* (glob) does not enter block state', () => {
  const content = '# match path/*\ncode\n// see src/*\ncode\n';
  const blocks = findBlocks(content);
  assert.deepEqual(blocks, [{ line: 1, count: 1 }, { line: 3, count: 1 }]);
});

// --- classify ---

test('classify: 24 → null, 25/29 → warn, 30 → block', () => {
  assert.equal(classify(WARN_THRESHOLD - 1), null);
  assert.equal(classify(WARN_THRESHOLD), 'warn');
  assert.equal(classify(BLOCK_THRESHOLD - 1), 'warn');
  assert.equal(classify(BLOCK_THRESHOLD), 'block');
});

// --- isExemptBlock ---

test('isExemptBlock: license and directive headers are exempt, prose is not', () => {
  const spdx = `// SPDX-License-Identifier: MIT\n${commentLines(30, '// ')}`;
  const copyright = `# Copyright (c) 2026 Example\n${commentLines(30)}`;
  const eslint = `/* eslint-disable no-console */\n${commentLines(30, '// ')}`;
  const shellcheck = `# shellcheck disable=SC2086\n${commentLines(30)}`;
  const prose = commentLines(31, '// ');
  for (const content of [spdx, copyright, eslint, shellcheck]) {
    assert.equal(isExemptBlock(content, findBlocks(content)[0]), true);
  }
  assert.equal(isExemptBlock(prose, findBlocks(prose)[0]), false);
});

// --- listFiles / scan ---

test('scan: fixture with blocking, warning, exempt, and clean files', () => {
  const root = makeFixture({
    'hooks/big.sh': `echo hi\n${commentLines(30)}\necho done\n`,
    'scripts/warned.js': `code();\n${commentLines(27, '// ')}\ncode();\n`,
    'skills/deep/nested/license.js': `// SPDX-License-Identifier: MIT\n${commentLines(35, '// ')}\ncode();\n`,
    'scripts/clean.sh': `${commentLines(10)}\necho ok\n`,
    'scripts/ignored.md': commentLines(40),
    'other/outside.sh': commentLines(40),
  });
  try {
    const findings = scan(root);
    assert.equal(findings.length, 2);
    const block = findings.find((f) => f.severity === 'block');
    assert.equal(block.file, path.join('hooks', 'big.sh'));
    assert.equal(block.line, 2);
    assert.equal(block.count, 30);
    const warn = findings.find((f) => f.severity === 'warn');
    assert.equal(warn.file, path.join('scripts', 'warned.js'));
    assert.equal(warn.count, 27);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listFiles: missing scan dirs and exempt prefixes are skipped', () => {
  const root = makeFixture({
    'scripts/a.js': 'code();\n',
    'scripts/vendor-not-exempt.js': 'code();\n',
  });
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'y.js'), commentLines(40, '// '));
  try {
    const files = listFiles(root);
    assert.deepEqual(files, [path.join('scripts', 'a.js'), path.join('scripts', 'vendor-not-exempt.js')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- CLI ---

test('CLI: exit 1 + BLOCK line when a ≥30 block exists', () => {
  const root = makeFixture({ 'hooks/big.sh': `${commentLines(32)}\necho hi\n` });
  try {
    const { code, stdout } = runCli(['--root', root]);
    assert.equal(code, 1);
    assert.match(stdout, /BLOCK hooks\/big\.sh:1 — 32 contiguous comment lines/);
    assert.match(stdout, /docs-writing\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: exit 0 with warnings printed but not blocking', () => {
  const root = makeFixture({ 'scripts/w.js': `${commentLines(26, '// ')}\ncode();\n` });
  try {
    const { code, stdout } = runCli(['--root', root]);
    assert.equal(code, 0);
    assert.match(stdout, /WARN {2}scripts\/w\.js:1 — 26/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: --json emits ok/blocking/warnings structure', () => {
  const root = makeFixture({ 'scripts/w.js': `${commentLines(26, '// ')}\ncode();\n` });
  try {
    const { code, stdout } = runCli(['--root', root, '--json']);
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.blocking.length, 0);
    assert.equal(parsed.warnings.length, 1);
    assert.equal(parsed.warnings[0].count, 26);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scan: nested vendor/node_modules under a scan dir are exempt at any depth (P1 regression)', () => {
  const root = makeFixture({
    'skills/demo/vendor/x.js': commentLines(40, '// '),
    'scripts/pkg/node_modules/y.js': commentLines(40, '// '),
    'scripts/ok.js': 'code();\n',
  });
  try {
    assert.deepEqual(listFiles(root), [path.join('scripts', 'ok.js')]);
    assert.deepEqual(scan(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: non-existent --root → exit 2, not a clean pass (P1 regression)', () => {
  const { code, stderr } = runCli(['--root', '/definitely/not/a/repository']);
  assert.equal(code, 2);
  assert.match(stderr, /not a directory/);
});

test('CLI: existing dir with none of hooks/scripts/skills → exit 2 (wrong root)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-empty-'));
  try {
    const { code, stderr } = runCli(['--root', root]);
    assert.equal(code, 2);
    assert.match(stderr, /wrong root/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: unknown flag → exit 2 with usage', () => {
  const { code, stderr } = runCli(['--bogus']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown flag --bogus/);
});

test('CLI: clean tree → exit 0 with OK line', () => {
  const root = makeFixture({ 'scripts/c.sh': `${commentLines(5)}\necho ok\n` });
  try {
    const { code, stdout } = runCli(['--root', root]);
    assert.equal(code, 0);
    assert.match(stdout, /OK — no comment block/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- Regression guard: the real repo must stay free of blocking blocks ---

test('repo regression: hooks/ scripts/ skills/ contain no ≥30-line comment block', () => {
  const blocking = scan(REPO_ROOT).filter((f) => f.severity === 'block');
  assert.deepEqual(blocking, [], `blocking blocks found: ${JSON.stringify(blocking)}`);
});
