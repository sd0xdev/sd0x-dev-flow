'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const REPO = join(__dirname, '..', '..');
const SKILL = join(REPO, 'skills', 'update-docs', 'SKILL.md');
const { BUILTIN_ROLE_CONFIG, FALLBACK_ROLE } = require(join(REPO, 'scripts', 'lib', 'doc-metadata.js'));

const readSkill = () => readFileSync(SKILL, 'utf8');

// The classification table in this skill is not decoration: it is the instruction an agent follows
// when deciding whether a document may be rewritten. It shipped once saying `2-tech-spec.md` was
// Current authority while `doc-metadata.js` classified it as a Design record — an instruction to
// rewrite a frozen record, which is the one thing the surrounding prose exists to forbid. Prose and
// code cannot be kept in step by reading them side by side, so the table is derived from the code
// here instead.

test('every role in the executable closed set appears in the skill table', () => {
  const skill = readSkill();
  assert.ok(BUILTIN_ROLE_CONFIG.closed_set.length >= 4,
    `expected the four-role closed set, saw ${BUILTIN_ROLE_CONFIG.closed_set.length}`);
  for (const role of BUILTIN_ROLE_CONFIG.closed_set) {
    assert.ok(skill.includes(`| ${role}`),
      `role "${role}" is in BUILTIN_ROLE_CONFIG.closed_set but starts no row in the skill's table`);
  }

  // Negative control: a role the code does not define must not be satisfiable by this check, or the
  // assertion above would pass on a table listing arbitrary invented roles.
  assert.ok(!BUILTIN_ROLE_CONFIG.closed_set.includes('Provisional authority'),
    'fixture: the invented role must genuinely be absent from the closed set');
  assert.ok(!skill.includes('| Provisional authority'),
    'the table must not carry a role the executable closed set does not define');
});

test('each lifecycle prefix is documented under the role the resolver actually assigns it', () => {
  const skill = readSkill();
  // Read the row a document type is documented under, by locating its literal in the table and
  // walking back to the row's first cell. Matching on the row rather than on mere presence is the
  // point: the pre-fix table mentioned `2-tech-spec.md` too — under the wrong role.
  const rowFor = (needle) => {
    const line = skill.split('\n').find((l) => l.startsWith('|') && l.includes(needle));
    return line ? line.split('|')[1].trim() : null;
  };

  const designPattern = BUILTIN_ROLE_CONFIG.path_defaults.find((d) => d.name === 'design-records');
  assert.ok(designPattern && designPattern.role === 'Design record',
    'fixture: the resolver must still classify lifecycle 0-3 as Design record');
  for (const stem of ['0-feasibility-study', '1-requirements', '2-tech-spec', '3-architecture']) {
    assert.ok(new RegExp(designPattern.pattern).test(stem),
      `fixture: ${stem} must match the resolver's design-record pattern`);
    const row = rowFor(`\`${stem}`);
    assert.ok(row && row.startsWith('Design record'),
      `${stem} is a Design record to the resolver but the skill documents it under "${row}"`);
  }

  const implPattern = BUILTIN_ROLE_CONFIG.path_defaults.find((d) => d.name === 'implementation-record');
  assert.equal(implPattern.role, FALLBACK_ROLE,
    'fixture: 4-implementation must still be the fallback (current-authority) role');
  const implRow = rowFor('`4-implementation');
  assert.ok(implRow && implRow.startsWith(FALLBACK_ROLE),
    `4-implementation is ${FALLBACK_ROLE} to the resolver but the skill documents it under "${implRow}"`);
});
