const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/test-health/SKILL.md');

// --- SKILL.md assertions ---

test('test-health SKILL.md exists', () => {
  assert.ok(existsSync(skillPath), 'skills/test-health/SKILL.md should exist');
});

test('test-health SKILL.md has quick and full modes', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /quick/i, 'should describe quick mode');
  assert.match(content, /full/i, 'should describe full mode');
  assert.match(content, /--full/, 'should have --full flag');
});

test('test-health SKILL.md has output schema', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Test Inventory/i, 'should have test inventory section');
  assert.match(content, /Code Coverage/i, 'should have code coverage section');
  assert.match(content, /Trend/i, 'should have trend section');
});

test('test-health SKILL.md has consume-first strategy', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /consume/i, 'should mention consume-first');
  assert.match(content, /heuristic/i, 'should mention heuristic fallback');
});

test('test-health SKILL.md has anti-theater guardrails', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /composite score/i, 'should mention no composite score');
  assert.match(content, /source.*transparency/i, 'should mention source transparency');
});

// --- Reference file assertions ---

test('artifact-formats.md exists with format table', () => {
  const p = resolve(root, 'skills/test-health/references/artifact-formats.md');
  assert.ok(existsSync(p), 'artifact-formats.md should exist');
  const content = readFileSync(p, 'utf8');
  assert.match(content, /LCOV/i, 'should describe LCOV format');
  assert.match(content, /Cobertura/i, 'should describe Cobertura format');
  assert.match(content, /JaCoCo/i, 'should describe JaCoCo format');
});

test('trend-schema.md exists with snapshot schema', () => {
  const p = resolve(root, 'skills/test-health/references/trend-schema.md');
  assert.ok(existsSync(p), 'trend-schema.md should exist');
  const content = readFileSync(p, 'utf8');
  assert.match(content, /snapshot/i, 'should describe snapshot schema');
  assert.match(content, /repoKey/i, 'should describe repoKey formula');
  assert.match(content, /lock/i, 'should describe lock pattern');
});

test('test-count-parsers.md exists with framework parsers', () => {
  const p = resolve(root, 'skills/test-health/references/test-count-parsers.md');
  assert.ok(existsSync(p), 'test-count-parsers.md should exist');
  const content = readFileSync(p, 'utf8');
  assert.match(content, /node:test/i, 'should describe node:test parser');
  assert.match(content, /jest/i, 'should describe jest parser');
  assert.match(content, /count_level/i, 'should describe count_level');
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /test-health', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/test-health$/m, '/test-health must be registered in the skill catalog');
});
