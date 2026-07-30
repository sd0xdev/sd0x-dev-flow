const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/remind/SKILL.md');

// --- SKILL.md content assertions ---

test('remind SKILL.md has smart detection with state file', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /detection/i, 'should mention detection');
  assert.match(content, /state/i, 'should reference state file');
});

test('remind SKILL.md has rule loading via Read tool', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /rules?\//i, 'should reference rules/ directory');
  assert.match(content, /Read/i, 'should use Read tool');
});

test('remind SKILL.md has --all nuclear mode', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--all/, 'should have --all flag');
});

test('remind SKILL.md has output format with Rule Context', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Finding/i, 'should have findings in output');
  assert.match(content, /Rule Context/i, 'should have Rule Context section');
});

test('remind SKILL.md under 500 lines', () => {
  const content = readFileSync(skillPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 500, `SKILL.md has ${lineCount} lines, should be under 500`);
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /remind', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/remind$/m, '/remind must be registered in the skill catalog');
});

// --- Extraction-target liveness ---
// The skill's value is quoting real rule text; a mapping that names a section which no longer
// exists silently degrades /remind into memory-based correction. Every "Section to Extract"
// target named by SKILL.md / detection-rules.md must exist in its source file.

test('remind extraction targets exist in rules/auto-loop.md', () => {
  const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');
  assert.match(autoLoop, /Terminal completion invariant/, 'detections 1-2 extract the invariant paragraph');
  assert.match(autoLoop, /^Gate sequence:/m, 'detection 3 extracts the Gate sequence paragraph');
  assert.match(autoLoop, /^## Tiers$/m, 'the Gate sequence paragraph is anchored inside § Tiers');
});

test('remind extraction targets exist in CLAUDE.md (nuclear mode + detection 6)', () => {
  const claudeMd = readFileSync(resolve(root, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /^## Required Checks/m, 'detection 6 + --all extract the Required Checks table');
  assert.match(claudeMd, /^## Auto-Loop$/m, '--all extracts the Auto-Loop section');
});

test('remind mappings do not reference sections removed by the auto-loop rewrite', () => {
  const skill = readFileSync(skillPath, 'utf8');
  const detection = readFileSync(resolve(root, 'skills/remind/references/detection-rules.md'), 'utf8');
  for (const [label, content] of [['SKILL.md', skill], ['detection-rules.md', detection]]) {
    assert.ok(!content.includes('The Four Anchors'), `${label} references removed section "The Four Anchors"`);
    assert.ok(!content.includes('Auto-Trigger'), `${label} references removed section "Auto-Trigger"`);
    assert.ok(!content.includes('## Auto-Loop Rule` section'), `${label} references removed CLAUDE section`);
  }
});

// --- Reference file assertions ---

test('detection-rules.md exists with auto-loop mapping', () => {
  const path = resolve(root, 'skills/remind/references/detection-rules.md');
  assert.ok(existsSync(path), 'detection-rules.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /auto-loop/i, 'should reference auto-loop rule');
});
