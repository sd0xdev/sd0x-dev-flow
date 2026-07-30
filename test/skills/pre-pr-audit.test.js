const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');

// --- SKILL.md content assertions ---

test('pre-pr-audit SKILL.md has 5 dimensions with weights', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /Execution Integrity.*25%/, 'should have Execution Integrity 25%');
  assert.match(content, /Coverage Adequacy.*25%/, 'should have Coverage Adequacy 25%');
  assert.match(content, /Test Quality.*20%/, 'should have Test Quality 20%');
  assert.match(content, /Risk-to-Test Alignment.*20%/, 'should have Risk-to-Test Alignment 20%');
  assert.match(content, /Evidence Governance.*10%/, 'should have Evidence Governance 10%');
});

test('pre-pr-audit SKILL.md has scoring model reference', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /references\/scoring-model\.md/, 'should reference scoring-model.md');
});

test('pre-pr-audit SKILL.md has 3-tier gate sentinels', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /✅ PR-Ready/, 'should have PR-Ready sentinel');
  assert.match(content, /⚠️ PR-Caution/, 'should have PR-Caution sentinel');
  assert.match(content, /⛔ PR-Blocked/, 'should have PR-Blocked sentinel');
});

test('pre-pr-audit SKILL.md has hard-fail overrides', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /Hard-Fail Overrides/, 'should have Hard-Fail section');
  assert.match(content, /Precommit stale/, 'should check precommit freshness');
  assert.match(content, /Evidence stale/, 'should check evidence freshness');
  assert.match(content, /Critical untested/, 'should check critical untested files');
});

test('pre-pr-audit SKILL.md has Prohibited block', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /git add.*git commit.*git push/i, 'should prohibit git actions');
});

test('pre-pr-audit SKILL.md has fast/deep modes', () => {
  const content = readFileSync(resolve(root, 'skills/pre-pr-audit/SKILL.md'), 'utf8');
  assert.match(content, /fast/, 'should have fast mode');
  assert.match(content, /deep/, 'should have deep mode');
  assert.match(content, /--strict/, 'should have strict flag');
});

// --- References ---

test('scoring-model.md exists with formulas', () => {
  const path = resolve(root, 'skills/pre-pr-audit/references/scoring-model.md');
  assert.ok(existsSync(path), 'scoring-model.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /pass.*1\.0/i, 'should define pass = 1.0');
  assert.match(content, /N\/A.*excluded/i, 'should define N/A = excluded');
  assert.match(content, /final_index/, 'should have final index formula');
});

test('output-template.md exists with sentinel strings', () => {
  const path = resolve(root, 'skills/pre-pr-audit/references/output-template.md');
  assert.ok(existsSync(path), 'output-template.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /PR-Ready/, 'should have PR-Ready sentinel');
  assert.match(content, /PR-Blocked/, 'should have PR-Blocked sentinel');
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /pre-pr-audit', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/pre-pr-audit$/m, '/pre-pr-audit must be registered in the skill catalog');
});
