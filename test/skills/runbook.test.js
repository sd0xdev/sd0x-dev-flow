const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync, existsSync } = require('node:fs');

const skillPath = resolve(__dirname, '../../skills/runbook/SKILL.md');
const templatePath = resolve(__dirname, '../../skills/runbook/references/template.md');
const discoveryPath = resolve(__dirname, '../../skills/runbook/references/discovery-heuristics.md');
const checkOutputPath = resolve(__dirname, '../../skills/runbook/references/check-output.md');
const docsNumberingPath = resolve(__dirname, '../../rules/docs-numbering.md');
const taxonomyPath = resolve(__dirname, '../../scripts/config/doc-taxonomy.json');

test('runbook SKILL.md exists with valid frontmatter', () => {
  assert.ok(existsSync(skillPath), 'SKILL.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.startsWith('---'), 'should start with frontmatter');
  assert.ok(content.includes('name: runbook'), 'should have name field');
  assert.ok(content.includes('description:'), 'should have description field');
  assert.ok(content.includes('allowed-tools:'), 'should have allowed-tools field');
});

test('runbook SKILL.md has required sections', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('## Trigger'), 'should have Trigger section');
  assert.ok(content.includes('## When NOT to Use'), 'should have When NOT to Use section');
  assert.ok(content.includes('## Workflow'), 'should have Workflow section');
  assert.ok(content.includes('## Verification'), 'should have Verification section');
});

test('runbook SKILL.md defines create/update/check modes', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('Create Mode'), 'should define Create Mode');
  assert.ok(content.includes('Update Mode'), 'should define Update Mode');
  assert.ok(content.includes('Check Mode'), 'should define Check Mode');
});

test('runbook SKILL.md integrates feature resolver', () => {
  const content = readFileSync(skillPath, 'utf8');
  // The wrapper, not the CLI. `resolve-feature.js` is what owns the `scan_error: true` failure
  // payload (doc-review-phasing r2); a skill calling the CLI direct gets partial stdout or nothing
  // on failure, with no field for the gate to read. `test/skills/scan-error-gate.test.js` enforces
  // that rule across every role-aware surface — this assertion is the one for this skill, and it
  // used to pin the opposite.
  assert.ok(
    content.includes('node scripts/resolve-feature.js'),
    'should invoke the feature resolver through the wrapper'
  );
  assert.ok(
    !content.includes('node scripts/resolve-feature-cli.js'),
    'should not invoke the CLI directly'
  );
  assert.ok(
    content.includes('doc_inventory'),
    'should use doc_inventory for runbook detection'
  );
});

test('runbook SKILL.md defines --request flag for multi-request selection', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('--request'), 'should define --request flag');
  assert.ok(
    content.includes('AskUserQuestion'),
    'should use AskUserQuestion for multi-request selection'
  );
});

test('runbook SKILL.md includes redaction rules', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('Redaction'), 'should have redaction section');
  assert.ok(content.includes('${ENV_VAR_NAME}'), 'should have env var placeholder pattern');
});

test('runbook template has all 9 sections', () => {
  assert.ok(existsSync(templatePath), 'template.md should exist');
  const content = readFileSync(templatePath, 'utf8');
  const requiredSections = [
    'Release Summary',
    'SRE Quick Reference',
    'Scope / Blast Radius',
    'Preconditions Checklist',
    'Deployment Procedure',
    'Verification / Smoke Tests',
    'Monitoring Signals',
    'Rollback Plan',
    'Open Risks / Human Checks',
  ];
  for (const section of requiredSections) {
    assert.ok(
      content.includes(section),
      `template should include "${section}" section`
    );
  }
});

test('runbook template includes provenance block', () => {
  const content = readFileSync(templatePath, 'utf8');
  assert.ok(
    content.includes('runbook-provenance'),
    'template should include provenance HTML comment'
  );
  assert.ok(
    content.includes('sources:'),
    'provenance should use multi-source array format'
  );
  assert.ok(
    content.includes('sha:'),
    'provenance should track SHA per source'
  );
});

test('discovery heuristics defines the 5-priority cascade in role order', () => {
  // This pinned the four-priority version — `Canonical docs … High` as P2 — for one release after
  // `SKILL.md` had already moved to the source sets, so the suite stayed green while the two
  // instruction surfaces contradicted each other and `SKILL.md` still pointed here for per-section
  // mapping. A runbook is executed against production, so sourcing a step from a design record at
  // High confidence can describe a procedure that was never built. Rows are asserted by ORDER, not
  // by mere presence: presence alone is what let the stale table pass.
  assert.ok(existsSync(discoveryPath), 'discovery-heuristics.md should exist');
  const content = readFileSync(discoveryPath, 'utf8');
  const rows = content.split('\n').filter((l) => /^\|\s*[1-5]\s*\|/.test(l));
  assert.equal(rows.length, 5, `expected a 5-row cascade, got ${rows.length}`);
  const expected = [
    [/Related Files/, /High/],
    [/`current_authority`/, /High/],
    [/`design_records`/, /Medium/],
    [/Feature-local/, /Medium/],
    [/Repo-wide/, /Low/],
  ];
  expected.forEach(([scope, confidence], i) => {
    assert.match(rows[i], scope, `P${i + 1}: wrong scope: ${rows[i]}`);
    assert.match(rows[i], confidence, `P${i + 1}: wrong confidence: ${rows[i]}`);
  });
  // The negative control the old version lacked: no cascade row may hand a canonical/design doc
  // High confidence. Prose may still QUOTE the retired row — that is the history, not the rule.
  for (const row of rows) {
    const [, , scope, confidence] = row.split('|');
    assert.ok(!(/[Cc]anonical/.test(scope) && /High/.test(confidence)),
      `no cascade row may source from canonical docs at High confidence: ${row}`);
  }
  assert.ok(!/design_records`[^|]*\| High/.test(content),
    'design records are intent, never High confidence');
});

test('a Related Files path that is a design record is demoted, not promoted by P1', () => {
  // P1 is High confidence, and a request's Related Files table routinely names `2-tech-spec.md`.
  // Without an explicit demotion the row this feature removed returns through the front door: a
  // design record sourcing an operational step at High confidence. Both surfaces must say so —
  // the skill body and the reference the skill points at for per-section mapping.
  for (const rel of ['skills/runbook/SKILL.md', 'skills/runbook/references/discovery-heuristics.md']) {
    const content = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    assert.match(content, /P1 path is classified before it is used/,
      `${rel}: must state that a P1 path is resolved before use`);
    assert.match(content, /`design_records`[^.]*treated as \*\*P3\*\*/,
      `${rel}: must demote a design-record path arriving via P1 to P3`);
  }
  // Prose alone is not the repair. The reference carries the *executable* algorithm the skill
  // delegates per-section mapping to, and its step 1 read "Check P1 scope (Related Files) — if
  // found, use with High confidence" with no classification — so the file stated the rule at the
  // top and contradicted it in the procedure, and an assertion on the prose passed anyway.
  const ref = readFileSync(
    resolve(__dirname, '../..', 'skills/runbook/references/discovery-heuristics.md'), 'utf8');
  const step1 = ref.split('\n').find((l) => /^\s*1\. Check P1 scope/.test(l));
  assert.ok(step1, 'the execution pattern must still have a step 1');
  assert.ok(!/use with High confidence/.test(step1),
    `step 1 must not promote a P1 hit unconditionally: ${step1.trim()}`);
  assert.match(step1, /RESOLVE THE PATH'S ROLE FIRST|classif/i,
    `step 1 must classify before using: ${step1.trim()}`);
  assert.match(ref, /in `design_records` → do not use it here/,
    'step 1 must route a design-record path to P3 rather than using it');
});

test('discovery heuristics marks design-record sourcing unverified and gates on scan_error', () => {
  // The per-section map is what `skills/runbook/SKILL.md:130` sends the agent to, so the role
  // split has to hold *here*, not only in the skill body.
  const content = readFileSync(discoveryPath, 'utf8');
  assert.match(content, /unverified/, 'a design-record step must be marked unverified');
  assert.match(content, /scan_error\s*!==\s*false/,
    'the reference must carry the same gate the skill does');
  assert.match(content, /node scripts\/resolve-feature\.js/,
    'and must resolve through the wrapper');
});

test('discovery heuristics includes redaction rules', () => {
  const content = readFileSync(discoveryPath, 'utf8');
  assert.ok(content.includes('Redaction'), 'should have redaction section');
  assert.ok(content.includes('API keys'), 'should mention API keys');
  assert.ok(content.includes('placeholder'), 'should specify placeholder replacement');
});

test('check output template defines Fresh/Stale/Missing/Unknown statuses', () => {
  assert.ok(existsSync(checkOutputPath), 'check-output.md should exist');
  const content = readFileSync(checkOutputPath, 'utf8');
  assert.ok(content.includes('Fresh'), 'should define Fresh status');
  assert.ok(content.includes('Stale'), 'should define Stale status');
  assert.ok(content.includes('Missing'), 'should define Missing status');
  assert.ok(content.includes('Unknown'), 'should define Unknown status');
});

test('check output template defines verdict logic', () => {
  const content = readFileSync(checkOutputPath, 'utf8');
  assert.ok(content.includes('Ready'), 'should define Ready verdict');
  assert.ok(content.includes('Stale'), 'should define Stale verdict');
  assert.ok(content.includes('Incomplete'), 'should define Incomplete verdict');
});

test('docs-numbering rule supports ancillary semantic naming', () => {
  const content = readFileSync(docsNumberingPath, 'utf8');
  assert.ok(
    content.includes('Ancillary'),
    'should have Ancillary Documents section'
  );
  assert.ok(
    content.includes('runbook-'),
    'should list runbook naming pattern'
  );
  assert.ok(
    content.includes('semantic'),
    'should mention semantic prefixes'
  );
});

test('doc-taxonomy.json has runbook type in ancillary namespace', () => {
  const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'));
  const runbookType = taxonomy.types.find(t => t.id === 'runbook');
  assert.ok(runbookType, 'should have runbook type');
  assert.equal(runbookType.namespace, 'ancillary', 'runbook should be ancillary namespace');
  assert.ok(
    runbookType.semantic_pattern,
    'runbook should have semantic_pattern'
  );
  assert.match(
    'runbook-release.md',
    new RegExp(runbookType.semantic_pattern),
    'runbook-release.md should match semantic_pattern'
  );
});
