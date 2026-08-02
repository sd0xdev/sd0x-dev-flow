const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/create-request/SKILL.md');

// --- SKILL.md content assertions ---

test('create-request SKILL.md has Scan Mode Workflow section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Scan Mode Workflow/, 'should have Scan Mode Workflow section');
});

test('create-request SKILL.md modes table has scan row', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scan.*--status/i, 'should have scan mode with --status trigger');
});

test('create-request SKILL.md has stale detection (30 days)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /30 days/i, 'should mention 30 days stale threshold');
});

test('create-request SKILL.md has metadata format documentation', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Blockquote/i, 'should document blockquote format');
  assert.match(content, /[Tt]able/, 'should document table format');
});

test('create-request SKILL.md has complete status filter list', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Completed/, 'should list Completed as complete status');
  assert.match(content, /Done/, 'should list Done as complete status');
  assert.match(content, /Superseded/, 'should list Superseded as complete status');
});


test('create-request SKILL.md trigger keywords include scan', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /scan requests/, 'should have scan requests trigger keyword');
});
