const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/deep-research/SKILL.md');

// --- SKILL.md content assertions ---

test('deep-research SKILL.md has 4-phase pipeline', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Phase 0/i, 'should have Phase 0');
  assert.match(content, /Phase 1/i, 'should have Phase 1');
  assert.match(content, /Phase 2/i, 'should have Phase 2');
  assert.match(content, /Phase 3/i, 'should have Phase 3');
});

test('deep-research SKILL.md has 3 roles (researcher, synthesizer, validator)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /researcher.*synthesizer.*validator/is, 'should mention all 3 roles');
});

test('deep-research SKILL.md has claim registry', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /claim/i, 'should mention claim');
  assert.match(content, /registry/i, 'should mention registry');
});

test('deep-research SKILL.md has completeness scoring', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /completeness/i, 'should mention completeness');
});

test('deep-research SKILL.md has mode system', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--mode/, 'should have --mode flag');
  assert.match(content, /exploratory.*compliance.*decision/is, 'should list all 3 modes');
});

test('deep-research SKILL.md has conditional debate', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /--debate/, 'should have --debate flag');
  assert.match(content, /auto.*force.*off/is, 'should list all 3 debate options');
});

test('deep-research SKILL.md has web research cascade', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /WebSearch/i, 'should mention web research');
});

test('deep-research SKILL.md under 500 lines', () => {
  const content = readFileSync(skillPath, 'utf8');
  const lineCount = content.split('\n').length;
  assert.ok(lineCount < 500, `SKILL.md has ${lineCount} lines, should be under 500`);
});

// --- Catalog registration ---

test('docs/skill-catalog.yml registers /deep-research', () => {
  const content = readFileSync(resolve(root, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/deep-research$/m, '/deep-research must be registered in the skill catalog');
});

// --- Reference file assertions ---

test('research-roles.md exists with 3 roles', () => {
  const path = resolve(root, 'skills/deep-research/references/research-roles.md');
  assert.ok(existsSync(path), 'research-roles.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /researcher/i, 'should mention researcher role');
  assert.match(content, /synthesizer/i, 'should mention synthesizer role');
  assert.match(content, /validator/i, 'should mention validator role');
});

test('scoring-model.md exists with 4-signal model', () => {
  const path = resolve(root, 'skills/deep-research/references/scoring-model.md');
  assert.ok(existsSync(path), 'scoring-model.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /source.diversity/i, 'should mention source diversity signal');
});

test('claim-registry.md exists with evidence model', () => {
  const path = resolve(root, 'skills/deep-research/references/claim-registry.md');
  assert.ok(existsSync(path), 'claim-registry.md should exist');
  const content = readFileSync(path, 'utf8');
  assert.match(content, /evidence/i, 'should describe evidence model');
  assert.match(content, /URL/i, 'should support URL evidence');
});

// --- v1.1 Trigger Redesign assertions ---

test('deep-research SKILL.md description contains Universal', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Universal multi-source/, 'description should say Universal');
});

test('deep-research SKILL.md description does NOT contain hard "Not for" audit exclusion', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.doesNotMatch(content, /Not for:.*audit-only/i, 'should not have hard audit-only exclusion');
});

test('deep-research SKILL.md trigger has zh-TW keywords', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /了解/, 'should have zh-TW keyword 了解');
  assert.match(content, /調查/, 'should have zh-TW keyword 調查');
});

test('deep-research SKILL.md "When NOT to Use" has 3 rows (not 5)', () => {
  const content = readFileSync(skillPath, 'utf8');
  const section = content.match(/## When NOT to Use[\s\S]*?(?=\n## |\n> \*\*)/);
  assert.ok(section, 'should have "When NOT to Use" section');
  const tableRows = section[0].match(/^\|[^|]+\|[^|]+\|$/gm) || [];
  const dataRows = tableRows.filter(r => !r.includes('---'));
  assert.ok(dataRows.length <= 4, `should have at most 4 rows (header + 3 data), got ${dataRows.length}`);
});

test('deep-research SKILL.md Phase 0 has Specialized Skill Suggestion', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Specialized Skill Suggestion/, 'should have Phase 0 skill suggestion');
});

test('deep-research SKILL.md Phase 0 has Auto-Budget Downgrade', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Auto-Budget Downgrade/, 'should have auto-budget downgrade');
});

test('deep-research SKILL.md web cascade has agent-browser detection protocol', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /agent-browser detection/, 'should have agent-browser detection protocol');
});

test('deep-research SKILL.md has MECE boundary note', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /MECE boundary/, 'should have MECE boundary note');
});

test('deep-research SKILL.md has Argument Validation section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Argument Validation/, 'should have argument validation section');
});
