const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skill = readFileSync(resolve(root, 'skills/safe-remove/SKILL.md'), 'utf8');
const policy = readFileSync(resolve(root, 'skills/safe-remove/references/removal-policy.md'), 'utf8');

// R3 made docs/skill-catalog.yml the sole registration surface. A removal whose verification
// does not sweep the catalog can report "Verification passed" while the command stays registered
// — these pins keep the catalog in both the SKILL's Phase 5 sweep and the policy's skill row.

test('safe-remove Phase 5 verification sweeps docs/skill-catalog.yml', () => {
  assert.match(skill, /command: \/<name>" docs\/skill-catalog\.yml/,
    'Phase 5 must grep the catalog for the removed command — an orphaned entry re-registers the skill');
});

test('removal-policy skill row includes the catalog verification command', () => {
  const skillRow = policy.split('\n').find((l) => /^\|\s*skill\s*\|/.test(l));
  assert.ok(skillRow, 'removal-policy.md must keep a skill row in the verification table');
  assert.match(skillRow, /docs\/skill-catalog\.yml/,
    'the skill verification row must include the canonical registration surface');
});

// Structural detection: any table/row language on the same line as a CLAUDE filename, in either
// order, plus the removed section heading (built by concatenation so this file does not itself
// trip the global scan in claude-md-coverage.test.js).
const FORBIDDEN_TABLE_INSTRUCTION = new RegExp(
  'table(?:\\s+rows?)?[^\\n]*CLAUDE(?:\\.template)?\\.md'
  + '|CLAUDE(?:\\.template)?\\.md[^\\n]*table'
  + '|Command ' + 'Quick Reference',
  'i');

test('safe-remove patch instructions target the catalog, not a CLAUDE command table', () => {
  for (const [label, content] of [['SKILL.md', skill], ['removal-policy.md', policy]]) {
    assert.ok(!FORBIDDEN_TABLE_INSTRUCTION.test(content),
      `${label} must route registration removal to docs/skill-catalog.yml, not a CLAUDE table`);
  }
});

test('the forbidden-instruction regex catches the exact historical patch instructions', () => {
  // Mutation fixtures: the pre-R3 strings this pin exists to keep out. A regex that misses them
  // is vacuous — these are the literal instructions safe-remove used to carry.
  const historical = [
    // Trailing text keeps the string from ending in `.md'`, which READER_PATTERN in
    // claude-md-coverage.test.js would classify as a CLAUDE file read (this file reads none).
    'Remove table rows from CLAUDE.md, .claude/CLAUDE.md, CLAUDE.template.md files',
    '| Skill table row | CLAUDE.md, .claude/CLAUDE.md, CLAUDE.template.md | Remove entire row |',
    'Add entries to CLAUDE.md command table',
  ];
  for (const fixture of historical) {
    assert.ok(FORBIDDEN_TABLE_INSTRUCTION.test(fixture), `must catch historical instruction: ${fixture}`);
  }
});
