const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');

const skillPath = resolve(__dirname, '../../skills/architecture/SKILL.md');
const templatePath = resolve(__dirname, '../../skills/architecture/references/template.md');
const codexPromptPath = resolve(__dirname, '../../skills/architecture/references/codex-prompt.md');
const agentPath = resolve(__dirname, '../../agents/architecture-designer.md');
const docsNumberingPath = resolve(__dirname, '../../rules/docs-numbering.md');

test('architecture SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.startsWith('---'), 'should start with frontmatter');
  assert.ok(content.includes('name: architecture'), 'should have name field');
  assert.ok(content.includes('description:'), 'should have description field');
  assert.ok(content.includes('allowed-tools:'), 'should have allowed-tools field');
});

test('architecture SKILL.md has 4-phase workflow', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('Phase 0'), 'should have Phase 0: Context Resolution');
  assert.ok(content.includes('Phase 1'), 'should have Phase 1: Architecture Research');
  assert.ok(content.includes('Phase 2'), 'should have Phase 2: Architecture Design');
  assert.ok(content.includes('Phase 3'), 'should have Phase 3: Verification');
  assert.ok(content.includes('Phase 4'), 'should have Phase 4: Output');
});

test('architecture SKILL.md references feature-context-resolution', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(
    content.includes('feature-context-resolution'),
    'should reference shared feature-context-resolution'
  );
});

test('architecture SKILL.md includes codex-brainstorm for verification', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(
    content.includes('codex-brainstorm'),
    'Phase 3 should use /codex-brainstorm for adversarial verification'
  );
});

test('architecture SKILL.md has Verification checklist', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('## Verification'), 'should have Verification section');
  assert.ok(content.includes('- [ ]'), 'should have checklist items');
});

test('architecture output template has all 8 required sections', () => {
  assert.ok(existsSync(templatePath), 'template.md should exist');
  const content = readFileSync(templatePath, 'utf8');
  const requiredSections = [
    'Architecture Overview',
    'Component Responsibilities',
    'Data Flow',
    'Integration Points',
    'Architecture Decisions',
    'Deployment',
    'Verification',
    'Cross-References',
  ];
  for (const section of requiredSections) {
    assert.ok(
      content.includes(section),
      `template should include "${section}" section`
    );
  }
});

test('architecture output template has AD-N decision format', () => {
  const content = readFileSync(templatePath, 'utf8');
  assert.ok(content.includes('AD-1'), 'should have AD-1 example');
  assert.ok(content.includes('**Context**'), 'AD format should include Context');
  assert.ok(content.includes('**Options**'), 'AD format should include Options');
  assert.ok(content.includes('**Decision**'), 'AD format should include Decision');
  assert.ok(content.includes('**Rationale**'), 'AD format should include Rationale');
});

test('architecture Codex prompt template exists with research instructions', () => {
  assert.ok(existsSync(codexPromptPath), 'codex-prompt.md should exist');
  const content = readFileSync(codexPromptPath, 'utf8');
  assert.ok(
    content.includes('independently research'),
    'should include independent research mandate'
  );
  // Inverted for the exec transport: the adapter pins the sandbox, so a template that still names it
  // is restating an authority it does not own. What the template must do instead is cite § Start.
  assert.ok(
    !content.includes('read-only'),
    'the transport pins the sandbox; this template must not restate it'
  );
  assert.match(
    content,
    /codex-transport\.md` § Start/,
    'and it must cite the canonical transport'
  );
});

test('architecture-designer agent exists with valid frontmatter', () => {
  assert.ok(existsSync(agentPath), 'architecture-designer.md should exist');
  const content = readFileSync(agentPath, 'utf8');
  assert.ok(content.startsWith('---'), 'should start with frontmatter');
  assert.ok(content.includes('name: architecture-designer'), 'should have correct name');
  assert.ok(content.includes('tools:'), 'should have tools field');
});

test('docs-numbering Phase 3 references /architecture', () => {
  const content = readFileSync(docsNumberingPath, 'utf8');
  const phase3Row = content.split('\n').find((line) =>
    line.includes('Architecture design') && line.includes('| 3')
  );
  assert.ok(phase3Row, 'should have Phase 3 Architecture design row');
  assert.ok(
    phase3Row.includes('`/architecture`'),
    'Phase 3 row should reference /architecture'
  );
  assert.ok(
    !phase3Row.includes('`/deep-analyze`'),
    'Phase 3 row should NOT reference /deep-analyze'
  );
});

test('architecture states a deterministic rule for picking one tech spec from design_records', () => {
  // `design_records` is an array and more than one entry can be `type: tech-spec` — a split spec
  // contributes its main file and every sub-document. `docs/features/auto-loop-evolution/` is that
  // case in this repository right now, so "the entry" without a rule leaves the skill with two
  // candidate paths and no way to choose. The rule is checked in both files that act on it.
  const skill = readFileSync(skillPath, 'utf8');
  assert.match(skill, /`is_canonical: true`|is_canonical/,
    'SKILL.md must say how a split spec is disambiguated');
  assert.match(skill, /Need Human/,
    'SKILL.md must name an exit for the case it cannot disambiguate');
  assert.match(skill, /auto-loop-evolution/,
    'SKILL.md must cite the live ambiguous case, so the rule is not read as hypothetical');

  const prompt = readFileSync(codexPromptPath, 'utf8');
  assert.ok(!/scan_error[^.]*pass the literal string/s.test(prompt),
    'the prompt reference must not prescribe a substitute value for a scan_error run — SKILL.md '
    + 'takes the Need Human exit there, so Track C is never reached');
  assert.match(prompt, /DESIGN_RECORD_PATH/,
    'the prompt must be handed the selected path rather than listing the directory itself');
  assert.ok(!/ls docs\/features\/\$\{FEATURE_KEY\}\//.test(prompt),
    'the prompt must not tell Codex to list the feature directory and pick a spec by name');
});
