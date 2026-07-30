const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/deep-explore/SKILL.md');

// --- SKILL.md content assertions ---

test('deep-explore SKILL.md has multi-wave workflow', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Wave 1/i, 'should have Wave 1');
  assert.match(content, /Wave 2/i, 'should have Wave 2');
  assert.match(content, /Wave 3/i, 'should have Wave 3 (optional)');
});

test('deep-explore SKILL.md has completeness score', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /completeness/i, 'should mention completeness');
  assert.match(content, /score/i, 'should mention score');
  assert.match(content, /novelty_rate/i, 'should have novelty rate formula');
});

test('deep-explore SKILL.md has 80/20 contract', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /80%/, 'should mention 80%');
  assert.match(content, /20%/, 'should mention 20%');
  assert.match(content, /peripheral/i, 'should mention peripheral');
});

test('deep-explore SKILL.md has routing guard', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /code-explore/i, 'should reference code-explore');
  assert.match(content, /redirect/i, 'should mention redirect');
});

test('deep-explore SKILL.md has claim registry', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /claim/i, 'should mention claim');
  assert.match(content, /registry/i, 'should mention registry');
});

test('deep-explore SKILL.md has precedence table', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--waves/i, 'should mention --waves');
  assert.match(content, /hard ceiling/i, 'should mention hard ceiling');
});

test('deep-explore SKILL.md under 500 lines', () => {
  const content = readFileSync(skillPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 500, `SKILL.md has ${lineCount} lines, should be under 500`);
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /deep-explore', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/deep-explore$/m, '/deep-explore must be registered in the skill catalog');
});

// --- Reference file assertions ---

test('agent-prompt.md exists with 80/20 contract', () => {
  const path = resolve(root, 'skills/deep-explore/references/agent-prompt.md');
  assert.ok(existsSync(path), 'agent-prompt.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /80%/i, 'should mention 80% allocation');
  assert.match(content, /20%/i, 'should mention 20% peripheral');
});

test('synthesis.md exists with claim registry', () => {
  const path = resolve(root, 'skills/deep-explore/references/synthesis.md');
  assert.ok(existsSync(path), 'synthesis.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /claim/i, 'should mention claim registry');
});
