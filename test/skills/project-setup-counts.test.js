'use strict';

// Forcing function for the rule-count claims in skills/project-setup/SKILL.md (issue #12, WB3).
// The expected counts are DERIVED from the rules/ directory — adding or removing a managed rule
// without updating every count site turns this red, which is the point: before this test, the
// five sites drifted silently (R3 in the scope-discipline tech spec).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const setup = readFileSync(resolve(root, 'skills/project-setup/SKILL.md'), 'utf8');

// User-owned override templates are the only rules/*.md files that are not plugin-managed.
const OVERRIDE_TEMPLATES = ['auto-loop-project.md', 'testing-project.md'];
const allRules = readdirSync(resolve(root, 'rules')).filter((f) => f.endsWith('.md')).sort();
const managed = allRules.filter((f) => !OVERRIDE_TEMPLATES.includes(f));
const M = managed.length;
const TOTAL = M + OVERRIDE_TEMPLATES.length;

test('rules directory when enumerated → the override set is exactly the two known templates', () => {
  for (const f of OVERRIDE_TEMPLATES) {
    assert.ok(allRules.includes(f), `expected override template missing from rules/: ${f}`);
  }
  assert.ok(M >= 13, `managed rule count collapsed unexpectedly: ${M}`);
});

test('project-setup counts when claimed → all five sites carry the derived managed/total counts', () => {
  const sites = [
    `copy ${M} managed rules + 2 override templates`,
    `Copy all ${M} managed rules:`,
    `(${TOTAL} \`@rules/\` references (${M} managed + 2 override templates)`,
    `✅ ${M}/${M} managed rules + 2 override templates`,
    `contains ${TOTAL} \`.md\` files (${M} managed + 2 override templates)`,
  ];
  for (const s of sites) {
    assert.ok(setup.includes(s), `project-setup count site out of sync with rules/ (expected "${s}")`);
  }
});

test('project-setup rules table when read → lists every managed rule by filename', () => {
  // The 5.2 copy table is the operative inventory: a rule missing here is a rule project-setup
  // silently never installs, whatever the counts say.
  const tableStart = setup.indexOf('Copy all');
  const tableEnd = setup.indexOf('3. Create override template', tableStart);
  assert.ok(tableStart !== -1 && tableEnd > tableStart, 'the 5.2 copy-rules block must exist');
  const block = setup.slice(tableStart, tableEnd);
  for (const f of managed) {
    assert.ok(block.includes(`\`${f}\``), `managed rule missing from the project-setup copy table: ${f}`);
  }
});

test('stale counts when scanned → no leftover pre-change claim survives anywhere in the file', () => {
  // Negative half with a self-test: the patterns must catch the exact pre-change wording and
  // must not catch the current derived wording (rules/testing.md § Guards, both directions).
  const stale = [
    new RegExp(`copy ${M - 1} managed rules`),
    new RegExp(`Copy all ${M - 1} managed rules`),
    new RegExp(`✅ ${M - 1}/${M - 1} managed rules`),
    new RegExp(`contains ${TOTAL - 1} \`\\.md\` files`),
  ];
  assert.ok(stale[0].test(`copy ${M - 1} managed rules + 2 override templates`), 'guard fixture: stale wording must be caught');
  assert.ok(!stale[0].test(`copy ${M} managed rules + 2 override templates`), 'current wording must pass');
  for (const p of stale) {
    assert.ok(!p.test(setup), `stale count survives in project-setup: ${p}`);
  }
});
