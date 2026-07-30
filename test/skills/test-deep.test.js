const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/test-deep/SKILL.md');

// --- SKILL.md content assertions ---

test('test-deep SKILL.md has progressive ladder (unit → integration → e2e)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /unit.*integration.*e2e/is, 'should describe progressive ladder order');
});

test('test-deep SKILL.md has fail-fast behavior', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /fail.fast/i, 'should mention fail-fast');
});

test('test-deep SKILL.md has triage pipeline', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /triage/i, 'should mention triage');
  assert.match(content, /pipeline/i, 'should mention pipeline');
});

test('test-deep SKILL.md has fixer catalog', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /fixer/i, 'should mention fixer');
  assert.match(content, /catalog/i, 'should mention catalog');
});

test('test-deep SKILL.md has safety tiers (safe, side-effect, destructive)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /safe.*side.effect.*destructive/is, 'should list all three safety tiers');
});

test('test-deep SKILL.md has test selection via git diff mapping', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /git diff/i, 'should mention git diff');
  assert.match(content, /mapping/i, 'should mention mapping');
});

test('test-deep SKILL.md has session artifacts / cache', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /cache.*test.deep/i, 'should reference cache/test-deep path');
});

test('test-deep SKILL.md has secret redaction', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /redact/i, 'should mention redaction');
});

test('test-deep SKILL.md under 500 lines', () => {
  const content = readFileSync(skillPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 500, `SKILL.md has ${lineCount} lines, should be under 500`);
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /test-deep', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/test-deep$/m, '/test-deep must be registered in the skill catalog');
});

// --- Reference file assertions ---

test('test-selection.md exists with git diff strategy', () => {
  const path = resolve(root, 'skills/test-deep/references/test-selection.md');
  assert.ok(existsSync(path), 'test-selection.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /git diff/i, 'should describe git diff strategy');
});

test('triage-pipeline.md exists with parser spec', () => {
  const path = resolve(root, 'skills/test-deep/references/triage-pipeline.md');
  assert.ok(existsSync(path), 'triage-pipeline.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /parser/i, 'should describe parser');
});

test('fixer-catalog.md exists with fixer definitions', () => {
  const path = resolve(root, 'skills/test-deep/references/fixer-catalog.md');
  assert.ok(existsSync(path), 'fixer-catalog.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /fixer/i, 'should describe fixers');
});
