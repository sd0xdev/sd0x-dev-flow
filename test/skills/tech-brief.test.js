const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const SKILL = resolve(ROOT, 'skills/tech-brief/SKILL.md');
const OUTPUT_TPL = resolve(ROOT, 'skills/tech-brief/references/output-template.md');
const SOURCE_GUIDE = resolve(ROOT, 'skills/tech-brief/references/source-guide.md');

// --- SKILL.md structure ---

test('SKILL.md exists and has valid frontmatter', () => {
  assert.ok(existsSync(SKILL), 'SKILL.md should exist');
  const content = readFileSync(SKILL, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  assert.ok(fm, 'should have frontmatter');
  assert.match(fm[1], /name:\s*tech-brief/, 'name should be tech-brief');
  assert.match(fm[1], /description:/, 'should have description');
  assert.match(fm[1], /allowed-tools:/, 'should have allowed-tools');
});

test('SKILL.md has Trigger section', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Trigger/, 'should have Trigger section');
  assert.match(content, /tech brief/i, 'should include tech brief keyword');
});

test('SKILL.md has When NOT to Use section', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## When NOT to Use/, 'should have When NOT to Use section');
  assert.match(content, /project-brief/, 'should reference project-brief');
  assert.match(content, /fp-brief/, 'should reference fp-brief');
});

test('SKILL.md has depth levels', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /brief/, 'should mention brief depth');
  assert.match(content, /normal/, 'should mention normal depth');
  assert.match(content, /deep/, 'should mention deep depth');
  assert.match(content, /## Depth Levels/, 'should have Depth Levels section');
});

test('SKILL.md has workflow phases', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Context Resolution/, 'should have Context Resolution phase');
  assert.match(content, /Multi-Source Collection/, 'should have Multi-Source Collection phase');
  assert.match(content, /Synthesis/, 'should have Synthesis phase');
});

test('SKILL.md has 6 output sections', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /Background & Problem/, 'should have Background section');
  assert.match(content, /Design Decisions/, 'should have Design Decisions section');
  assert.match(content, /Implementation Highlights/, 'should have Implementation section');
  assert.match(content, /Limitations & Known Issues/, 'should have Limitations section');
  assert.match(content, /Discussion & References/, 'should have Discussion section');
  assert.match(content, /Next Steps/, 'should have Next Steps section');
});

test('SKILL.md has Verification checklist', () => {
  const content = readFileSync(SKILL, 'utf8');
  assert.match(content, /## Verification/, 'should have Verification section');
  assert.match(content, /\[[ x]\]/, 'should have checklist format');
});


// --- Reference files ---

test('output-template.md has Depth Matrix and Evidence Insufficient rule', () => {
  assert.ok(existsSync(OUTPUT_TPL), 'output-template.md should exist');
  const content = readFileSync(OUTPUT_TPL, 'utf8');
  assert.match(content, /## Depth Matrix/, 'should have Depth Matrix');
  assert.match(content, /Evidence Insufficient/, 'should have Evidence Insufficient rule');
  assert.match(content, /Source Provenance/, 'should have Source Provenance template');
});

test('source-guide.md has 3 stages and missing source handling', () => {
  assert.ok(existsSync(SOURCE_GUIDE), 'source-guide.md should exist');
  const content = readFileSync(SOURCE_GUIDE, 'utf8');
  assert.match(content, /Stage 1/, 'should have Stage 1');
  assert.match(content, /Stage 2/, 'should have Stage 2');
  assert.match(content, /Stage 3/, 'should have Stage 3');
  assert.match(content, /Missing Source/, 'should have Missing Source handling');
});

// --- Integration ---

test('docs/skill-catalog.yml registers /tech-brief', () => {
  const content = readFileSync(resolve(ROOT, 'docs/skill-catalog.yml'), 'utf8');
  assert.match(content, /^ {2}- command: \/tech-brief$/m, '/tech-brief must be registered in the skill catalog');
});
