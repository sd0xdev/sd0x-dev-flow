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
  langFor,
  classify,
  isExemptBlock,
  measurable,
  listFiles,
  scan,
  BLOCK_THRESHOLD,
  WARN_THRESHOLD,
} = require(SCRIPT);

// Projects blocks to the two fields a boundary test is about. `findBlocks` also returns `headRun`
// and `restLine` — the bridge bookkeeping the directive exemption reads — and spelling those into
// every boundary assertion would bury what each one actually pins. They get their own tests below.
function shape(blocks) {
  return blocks.map(({ line, count }) => ({ line, count }));
}

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
  assert.deepEqual(shape(blocks), [{ line: 2, count: 5 }]);
});

test('findBlocks: blank line bridges a block instead of splitting it', () => {
  const content = `${commentLines(3)}\n\n${commentLines(4)}\n`;
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 1, count: 7 }]);
});

test('findBlocks: multiple blank lines still bridge; code ends the block', () => {
  const content = `${commentLines(3)}\n\n\n${commentLines(4)}\ncode();\n${commentLines(2)}\n`;
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 1, count: 7 }, { line: 11, count: 2 }]);
});

test('findBlocks: blanks bridge a header past the threshold (the escape this closes)', () => {
  // 23 comment lines + blank + 28 comment lines was two compliant runs under the
  // old contiguous rule; as one logical block it is 51 lines and blocking.
  const content = `${commentLines(23)}\n\n${commentLines(28)}\ncode();\n`;
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 1, count: 51 }]);
  assert.equal(classify(blocks[0].count), 'block');
});

test('findBlocks: block at end of file without trailing newline is reported', () => {
  const blocks = findBlocks(`code\n${commentLines(6, '// ')}`);
  assert.deepEqual(shape(blocks), [{ line: 2, count: 6 }]);
});

test('findBlocks: JSDoc continuation lines (`*`, `/*`, indented) count as comments', () => {
  const content = 'code\n/**\n * a\n * b\n */\ncode\n';
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 2, count: 4 }]);
});

test('findBlocks: empty content → no blocks', () => {
  assert.deepEqual(findBlocks(''), []);
});

test('findBlocks: bare block comment counts unprefixed interior lines (P1 regression)', () => {
  // /* + 28 rationale lines without any prefix + */ — must be ONE 30-line block.
  const interior = Array.from({ length: 28 }, (_, i) => `rationale line ${i + 1}`).join('\n');
  const content = `code();\n/*\n${interior}\n*/\ncode();\n`;
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 2, count: 30 }]);
});

test('findBlocks: single-line /* ... */ does not trap the scanner in-block', () => {
  const content = '/* one-liner */\ncode();\ncode();\n';
  assert.deepEqual(shape(findBlocks(content)), [{ line: 1, count: 1 }]);
});

test('findBlocks: shell/# or // comment containing /* (glob) does not enter block state', () => {
  const content = '# match path/*\ncode\n// see src/*\ncode\n';
  const blocks = findBlocks(content);
  assert.deepEqual(shape(blocks), [{ line: 1, count: 1 }, { line: 3, count: 1 }]);
});

// --- language dispatch (shell has no /* */ comment form) ---

test("findBlocks lang=sh: `case $x in /*)` does not open a block state", () => {
  // Regression: the /* arm made every following line count as a comment, so 35
  // lines of executable shell were reported as one blocking comment block.
  const tail = Array.from({ length: 35 }, (_, i) => `path_${i}=$(pwd)`).join('\n');
  const content = `#!/usr/bin/env bash\ncase "$1" in\n  /*) echo absolute ;;\nesac\n${tail}\n`;
  const blocks = findBlocks(content, 'sh');
  assert.deepEqual(shape(blocks), [{ line: 1, count: 1 }]);
});

test("findBlocks lang=sh: a `*)` default arm is not a comment line", () => {
  const content = 'case "$1" in\n  *) echo fallback ;;\nesac\n';
  assert.deepEqual(findBlocks(content, 'sh'), []);
});

test('findBlocks lang=sh: a genuine 35-line # block is still blocking (negative control)', () => {
  // Deleting the language dispatch must not make this pass — without it the
  // shell path is untested and the fix above would read as "flags nothing".
  const content = `${commentLines(35)}\nexec_command\n`;
  const blocks = findBlocks(content, 'sh');
  assert.deepEqual(shape(blocks), [{ line: 1, count: 35 }]);
  assert.equal(classify(blocks[0].count), 'block');
});

test('findBlocks lang=js: `#` is not a comment, `//` and JSDoc are', () => {
  const content = '#!/usr/bin/env node\nconst a = 1;\n// one\n/** two */\n';
  assert.deepEqual(shape(findBlocks(content, 'js')), [{ line: 3, count: 2 }]);
});

test('langFor: .sh → sh, .js and anything else → js', () => {
  assert.equal(langFor('hooks/stop-guard.sh'), 'sh');
  assert.equal(langFor('scripts/lib/utils.js'), 'js');
  assert.equal(langFor('scripts/no-extension'), 'js');
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

// --- measurable: the exemption × bridging interaction ---
//
// These two rules cancel each other if the exemption is applied to the whole block. Bridging says
// a blank line does not end a block; the exemption says a block headed by a directive is skipped.
// Together, one `// SPDX-License-Identifier` line plus a blank exempts everything below it, and the
// threshold becomes avoidable at the cost of one line — the same escape the bridging rule was added
// to close, re-opened through the other door. Both directions are pinned: the laundering case must
// be MEASURED, and the plain licence header the exemption exists for must stay exempt.

test('measurable: a directive header bridged into rationale exempts only the header', () => {
  const content = `// SPDX-License-Identifier: MIT\n\n${commentLines(60, '// ')}\ncode();\n`;
  const [block] = findBlocks(content, 'js');
  assert.deepEqual(
    { line: block.line, count: block.count, headRun: block.headRun, restLine: block.restLine },
    { line: 1, count: 61, headRun: 1, restLine: 3 },
    'the blank bridges, so this is one 61-line block whose exempt head is a single line'
  );
  assert.deepEqual(
    measurable(content, block), { line: 3, count: 60 },
    'the 60 rationale lines are measured, anchored at their own first line'
  );
  assert.equal(classify(measurable(content, block).count), 'block');
});

test('measurable: an unbridged directive header is exempt in full', () => {
  // The negative control. Without it, "exempt only the header" could be implemented as "exempt
  // nothing" and the test above would still pass — while every licence header in the tree started
  // failing the gate.
  const content = `// SPDX-License-Identifier: MIT\n${commentLines(60, '// ')}\ncode();\n`;
  const [block] = findBlocks(content, 'js');
  assert.equal(block.restLine, 0, 'no bridge, so there is no remainder to measure');
  assert.equal(measurable(content, block), null);
});

test('measurable: a bridged block with no directive is measured whole', () => {
  // The other negative control: the fix must not turn bridging itself off. `headRun` is short here
  // and the block is not exempt, so the FULL 61 lines stay blocking.
  const content = `// ordinary rationale\n\n${commentLines(60, '// ')}\ncode();\n`;
  const [block] = findBlocks(content, 'js');
  assert.deepEqual(measurable(content, block), block);
  assert.equal(block.count, 61);
});

test('measurable: repeated bridges do not each get their own exemption', () => {
  // `bridged` latches. If it reset per blank line, the last run would head a fresh "block" and a
  // directive could exempt a run after every blank — laundering restored one paragraph at a time.
  const content = `# shellcheck disable=SC2086\n\n${commentLines(20)}\n\n${commentLines(20)}\ncode\n`;
  const [block] = findBlocks(content, 'sh');
  assert.equal(block.headRun, 1);
  assert.deepEqual(measurable(content, block), { line: 3, count: 40 });
});

test('scan: an exempt header cannot launder a long block through a blank line', () => {
  // End-to-end through the real gate, not just the helper: this is the `comment_blocks` step
  // /precommit runs, so the finding has to reach the CLI's exit code.
  const root = makeFixture({
    'hooks/laundered.sh': `# SPDX-License-Identifier: MIT\n\n${commentLines(40)}\necho done\n`,
    'hooks/genuine-header.sh': `# SPDX-License-Identifier: MIT\n${commentLines(40)}\necho done\n`,
  });
  const findings = scan(root);
  assert.deepEqual(
    findings,
    [{ file: path.join('hooks', 'laundered.sh'), line: 3, count: 40, severity: 'block' }],
    'only the bridged one is reported, and at the rationale line rather than the directive line'
  );
  assert.equal(runCli(['--root', root]).code, 1);
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
    assert.match(stdout, /BLOCK hooks\/big\.sh:1 — 32 comment lines in one logical block/);
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
