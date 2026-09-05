const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/codex-code-review/SKILL.md');
const fastPromptPath = resolve(root, 'skills/codex-code-review/references/codex-prompt-fast.md');
const fullPromptPath = resolve(root, 'skills/codex-code-review/references/codex-prompt-full.md');
const branchPromptPath = resolve(root, 'skills/codex-code-review/references/codex-prompt-branch.md');
const reviewCommonPath = resolve(root, 'skills/codex-code-review/references/review-common.md');

// --- Step 1.5: Feature & AC Detection ---

test('SKILL.md has Step 1.5 Feature Context & AC Detection', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Step 1\.5.*Feature Context.*AC Detection/i);
});

test('SKILL.md Step 1.5 references resolve-feature.sh', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /resolve-feature\.sh/);
});

test('SKILL.md Step 1.5 has confidence threshold (medium)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /confidence.*medium/i);
});

test('SKILL.md Step 1.5 has quality-gate AC filter', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /quality-gate ACs matching/);
  assert.match(content, /codex-review-fast/);
  assert.match(content, /precommit/);
});

test('SKILL.md Step 1.5 has AC cap (max 20)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /max 20 ACs/i);
});

test('SKILL.md Step 1.5 has graceful degradation', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /SPEC_CHECKLIST = null.*skip silently/i);
});

// --- Step 1.6 (retired): Deferred Finding Context ---
// Hook-lightweighting § 3.4: the nit-history store was deleted with the hook that
// owned it, so the preload step that read it is gone. Prior deferred findings reach
// the reviewer through the review itself. A resurrected read would point the skill
// at a file nothing writes.

test('SKILL.md no longer preloads the retired nit-history store', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(!/Deferred Finding Context/i.test(content), 'the Step 1.6 preload must stay retired');
  assert.ok(!content.includes('.claude_nit_history.json'), 'the deleted store must not be read');
  assert.ok(!content.includes('DEFERRED_CONTEXT'), 'the injection variable must not survive the step');
  assert.ok(!content.includes('<deferred_context>'), 'the XML block format must not survive the step');
});

// --- Prompt Templates: SPEC_CHECKLIST injection ---

const promptVariants = [
  { name: 'fast', path: fastPromptPath },
  { name: 'full', path: fullPromptPath },
  { name: 'branch', path: branchPromptPath },
];

for (const variant of promptVariants) {
  test(`${variant.name} prompt has SPEC_CHECKLIST conditional injection`, () => {
    const content = readFileSync(variant.path, 'utf8');
    // The templates became body-only markdown with the exec transport, so the JS ternary that
    // carried this conditionality is now an explicit INCLUDE-ONLY-IF marker. The property pinned
    // is unchanged: the section is conditional, not unconditional.
    assert.match(content, /INCLUDE ONLY IF a request doc with acceptance criteria/);
    assert.match(content, /Specification Checklist/);
  });

  test(`${variant.name} prompt has REQUEST_DOC_PATH reference`, () => {
    const content = readFileSync(variant.path, 'utf8');
    assert.match(content, /REQUEST_DOC_PATH/);
  });

  test(`${variant.name} prompt has AC Coverage output section`, () => {
    const content = readFileSync(variant.path, 'utf8');
    assert.match(content, /AC Coverage/);
    assert.match(content, /Implemented.*Partial.*Missing/);
  });

  test(`${variant.name} prompt no longer injects the retired DEFERRED_CONTEXT`, () => {
    const content = readFileSync(variant.path, 'utf8');
    assert.ok(!content.includes('DEFERRED_CONTEXT'), 'the nit-history preload retired with its store');
  });

  test(`${variant.name} prompt SPEC_CHECKLIST is before research instructions`, () => {
    const content = readFileSync(variant.path, 'utf8');
    const specIdx = content.indexOf('Specification Checklist');
    const researchIdx = content.indexOf('independently research the project');
    assert.ok(specIdx > 0, 'Specification Checklist should exist');
    assert.ok(researchIdx > 0, 'Research instructions should exist');
    assert.ok(specIdx < researchIdx, 'Specification Checklist should appear before research instructions');
  });

  test(`${variant.name} prompt AC Coverage is before Merge Gate`, () => {
    const content = readFileSync(variant.path, 'utf8');
    const acIdx = content.indexOf('AC Coverage');
    const gateIdx = content.indexOf('Merge Gate');
    assert.ok(acIdx > 0, 'AC Coverage should exist');
    assert.ok(gateIdx > 0, 'Merge Gate should exist');
    assert.ok(acIdx < gateIdx, 'AC Coverage should appear before Merge Gate');
  });

}

// --- review-common.md: AC Coverage Format ---

test('review-common.md has AC Coverage Format section', () => {
  const content = readFileSync(reviewCommonPath, 'utf8');
  assert.match(content, /AC Coverage Format.*Spec-Driven Review/);
});

test('review-common.md AC Coverage has status definitions', () => {
  const content = readFileSync(reviewCommonPath, 'utf8');
  assert.match(content, /Implemented/);
  assert.match(content, /Partial/);
  assert.match(content, /Missing/);
  assert.match(content, /not applicable/i);
});

test('review-common.md AC Coverage has omission conditions', () => {
  const content = readFileSync(reviewCommonPath, 'utf8');
  assert.match(content, /Omitted when.*No feature detected/i);
});

// --- Graceful degradation: null handling ---

test('all prompt templates use conditional injection (not unconditional)', () => {
  for (const variant of promptVariants) {
    const content = readFileSync(variant.path, 'utf8');
    // Balance alone was not enough: deleting BOTH markers around `### AC Coverage` left the
    // remaining markers balanced, so that section could silently become unconditional. Pin the
    // exact ordered schema instead — which regions exist, in which order, and around what.
    const regions = [];
    const re = /<!-- INCLUDE ONLY IF ([^>]*?) -->([\s\S]*?)<!-- END conditional section -->/g;
    for (const m of content.matchAll(re)) regions.push({ cond: m[1].trim(), body: m[2] });
    assert.equal(regions.length, 3,
      `${variant.name}: expected exactly the FOCUS, Specification Checklist and AC Coverage regions`);
    assert.match(regions[0].cond, /\$\{FOCUS\} was supplied/, `${variant.name}: region 1 is FOCUS`);
    assert.match(regions[0].body, /## Focus Area/, `${variant.name}: region 1 wraps the Focus Area`);
    assert.match(regions[1].cond, /request doc with acceptance criteria/, `${variant.name}: region 2 is the checklist`);
    assert.match(regions[1].body, /## Specification Checklist/, `${variant.name}: region 2 wraps the checklist`);
    assert.match(regions[2].cond, /request doc with acceptance criteria/, `${variant.name}: region 3 is AC Coverage`);
    assert.match(regions[2].body, /### AC Coverage/, `${variant.name}: region 3 wraps AC Coverage`);
    // Counting `##` headings was still a heuristic: the AC-Coverage region is followed only by
    // `###` sections, so moving its END to EOF kept the count at zero while Deferred Findings,
    // Out-of-Scope Findings, Merge Gate and Structured Summary all became conditional. Enumerate
    // instead — each region's body must contain EXACTLY the headings it is supposed to wrap.
    // Heading enumeration alone still let a START marker move EARLIER across heading-free content:
    // putting it before `${SCOPE_BASELINE}` made the frozen scope value conditional while the
    // heading list stayed identical. So also require adjacency — a region's first non-blank line
    // must BE its heading, and it must still carry the section's own content — an END moved up
    // above `Pay special attention to: ${FOCUS}` left only the heading conditional while the
    // instruction it guards became unconditional.
    for (const [i, r] of regions.entries()) {
      const lines = r.body.split('\n').filter((l) => l.trim() !== '');
      assert.match(lines[0] || '', /^#{1,6} /,
        `${variant.name}: region ${i + 1} opens on content before its heading — the START marker is too early`);
      assert.ok(lines.length >= 2,
        `${variant.name}: region ${i + 1} holds only its heading — the END marker is too early, so the ` +
        'content the section exists to make conditional is now unconditional');
    }
    const headingsIn = (body) => (body.match(/^#{1,6} .*/gm) || []).map((h) => h.trim());
    assert.deepEqual(headingsIn(regions[0].body), ['## Focus Area'],
      `${variant.name}: the FOCUS region must wrap the Focus Area heading and nothing else`);
    assert.deepEqual(headingsIn(regions[1].body), ['## Specification Checklist'],
      `${variant.name}: the checklist region must wrap exactly its own heading`);
    assert.deepEqual(headingsIn(regions[2].body), ['### AC Coverage'],
      `${variant.name}: the AC Coverage region must wrap exactly its own heading — an END at EOF ` +
      'would silently make Deferred Findings, Out-of-Scope Findings and the Merge Gate conditional');
    // An unmatched marker cannot show up as a region, so count them independently too.
    assert.equal((content.match(/<!-- INCLUDE ONLY IF/g) || []).length, 3, `${variant.name}: no stray START`);
    assert.equal((content.match(/<!-- END conditional section -->/g) || []).length, 3, `${variant.name}: no stray END`);
  }
});

test('review-common.md re-review template: the Local Check Results region is closed and wraps its section', () => {
  const content = readFileSync(resolve(root, 'skills/codex-code-review/references/review-common.md'), 'utf8');
  const regions = [...content.matchAll(/<!-- INCLUDE ONLY IF ([^>]*?) -->([\s\S]*?)<!-- END conditional section -->/g)];
  assert.equal(regions.length, 1, 'exactly one conditional region');
  assert.match(regions[0][1], /\$\{LOCAL_CHECKS\} is non-empty/);
  assert.match(regions[0][2], /## Local Check Results/, 'the region wraps the section it guards');
  assert.doesNotMatch(regions[0][2], /## New Git Diff/, 'the mandatory diff section must sit OUTSIDE the conditional');
  // Count BOTH markers: counting only ENDs let an unmatched START pass.
  assert.equal((content.match(/<!-- INCLUDE ONLY IF/g) || []).length, 1, 'no stray START');
  assert.equal((content.match(/<!-- END conditional section -->/g) || []).length, 1, 'no stray END');
});
