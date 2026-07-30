const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/fp-brief/SKILL.md');

// --- SKILL.md structure assertions ---

test('fp-brief SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'skills/fp-brief/SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fmMatch, 'should have frontmatter block');
  assert.match(fmMatch[1], /^name:\s*fp-brief/m, 'name should be fp-brief');
  assert.match(fmMatch[1], /^description:/m, 'should have description');
  assert.match(fmMatch[1], /^allowed-tools:/m, 'should have allowed-tools');
});

test('fp-brief SKILL.md has Trigger section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Trigger/i, 'should have Trigger section');
  assert.match(content, /first.principles/i, 'trigger should mention first principles');
});

test('fp-brief SKILL.md has When NOT to Use section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /When NOT to Use/i, 'should have When NOT to Use section');
  assert.match(content, /project-brief/i, 'should mention project-brief as alternative');
  assert.match(content, /feasibility-study/i, 'should mention feasibility-study as alternative');
});

test('fp-brief SKILL.md has brief/normal/deep depth levels', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /brief/, 'should mention brief depth');
  assert.match(content, /normal/, 'should mention normal depth');
  assert.match(content, /deep/, 'should mention deep depth');
});

test('fp-brief SKILL.md has 3-phase workflow', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Phase 1/i, 'should have Phase 1');
  assert.match(content, /Phase 2/i, 'should have Phase 2');
  assert.match(content, /Phase 3/i, 'should have Phase 3');
});

test('fp-brief SKILL.md has 7-section output structure', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Root Problem/i, 'should mention Root Problem');
  assert.match(content, /Assumptions Register/i, 'should mention Assumptions Register');
  assert.match(content, /Reasoning Chain/i, 'should mention Reasoning Chain');
  assert.match(content, /Alternative Rejection/i, 'should mention Alternative Rejection');
  assert.match(content, /Decision Sensitivity/i, 'should mention Decision Sensitivity');
  assert.match(content, /Open Unknowns/i, 'should mention Open Unknowns');
  assert.match(content, /Verification Delta/i, 'should mention Verification Delta');
});

test('fp-brief SKILL.md has Verification checklist', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Verification/i, 'should have Verification section');
  assert.match(content, /\[[ x]\]/, 'should have checklist items');
});

test('fp-brief SKILL.md under 500 lines', () => {
  const content = readFileSync(skillPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 500, `SKILL.md has ${lineCount} lines, should be under 500`);
});

// --- Reference file assertions ---

test('output-template.md exists with depth matrix', () => {
  const path = resolve(root, 'skills/fp-brief/references/output-template.md');
  assert.ok(existsSync(path), 'output-template.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /Depth Matrix/i, 'should have depth matrix');
  assert.match(content, /Evidence Insufficient/i, 'should have evidence insufficient rule');
});

test('detection-rules.md exists with priority table', () => {
  const path = resolve(root, 'skills/fp-brief/references/detection-rules.md');
  assert.ok(existsSync(path), 'detection-rules.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /Priority/, 'should have priority column');
  assert.match(content, /tech-spec/, 'should detect tech-spec format');
  assert.match(content, /feasibility-study/, 'should detect feasibility-study format');
  assert.match(content, /request-doc/, 'should detect request-doc format');
  assert.match(content, /unknown/, 'should have unknown fallback');
});

test('extraction-guide.md exists with section heuristics', () => {
  const path = resolve(root, 'skills/fp-brief/references/extraction-guide.md');
  assert.ok(existsSync(path), 'extraction-guide.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /Root Problem/i, 'should have Root Problem extraction');
  assert.match(content, /5.Why/i, 'should mention 5-Why method');
  assert.match(content, /Secret Redaction/i, 'should have security section');
});

test('codex-verify-prompt.md exists with mandatory fields', () => {
  const path = resolve(root, 'skills/fp-brief/references/codex-verify-prompt.md');
  assert.ok(existsSync(path), 'codex-verify-prompt.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /independently research/i, 'should have independent research instruction');
  assert.match(content, /git status/, 'should include git status command');
  assert.match(content, /git diff/, 'should include git diff command');
  assert.match(content, /sandbox.*read-only/i, 'should specify read-only sandbox');
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /fp-brief', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/fp-brief$/m, '/fp-brief must be registered in the skill catalog');
});
