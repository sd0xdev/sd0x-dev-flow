'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  applyOverrides,
  runDeterministicChecks,
  findUnderCoveredDimensions,
  aggregateDimensions,
  selectGate,
  consolidate,
  mergeVerdicts,
  matchesElementId,
  STANCE_RE,
  ROUND_REF_RE,
  DIM_NAMES,
  AUDIT_CLEAR,
  AUDIT_REVISE,
} = require('../../../scripts/skills/necessity-audit/consolidate');

function makeElement(overrides = {}) {
  return {
    id: 'FR-1',
    kind: 'FR',
    primary_dimension: 1,
    claude: { classification: 'Keep', rationale: 'core requirement' },
    evidence: [],
    final: 'Keep',
    ...overrides,
  };
}

function makeDebate(overrides = {}) {
  return {
    threadId: '019dab42-abcd-1234',
    rounds: 3,
    equilibriumReached: true,
    conclusion: 'In round 1 Codex opened Challenge. Round 2 saw Defend on FR-5. Round 3 Accept. Necessity Now is clean. Abstraction Justification challenged at FR-5. Extensibility Speculation covered. Configurability Excess: flag OK. Premature Optimization: no measurement needed. Scope Drift clean.',
    evidenceCitations: [],
    roundsText: '',
    ...overrides,
  };
}

function makePreflight(overrides = {}) {
  return {
    absPath: '/repo/docs/features/foo/2-tech-spec.md',
    relPath: 'docs/features/foo/2-tech-spec.md',
    featureKey: 'foo',
    docKind: 'tech-spec',
    greenfield: false,
    depth: 'normal',
    activeDimensions: [1, 2, 3, 4, 5, 6],
    skipPreflight: false,
    banners: [],
    warnings: [],
    ...overrides,
  };
}

test('STANCE_RE matches Challenge/Defend/Accept/Reject/Concede', () => {
  assert.ok(STANCE_RE.test('After debate, Codex Challenges FR-5'));
  assert.ok(STANCE_RE.test('Defend: this abstraction is used'));
  assert.ok(STANCE_RE.test('Accept the cut'));
  assert.ok(!STANCE_RE.test('plain text with no stance'));
});

test('applyOverrides — single override keeps final=Cut and records user_override (selectGate narrative relies on both)', () => {
  const elements = [makeElement({ id: 'FR-5', final: 'Cut' })];
  const result = applyOverrides(elements, 'FR-5:needed for Q3 rollout');
  assert.equal(result[0].final, 'Cut', 'final must remain Cut so selectGate can surface "kept via --override" narrative');
  assert.equal(result[0].user_override.kept_reason, 'needed for Q3 rollout');
  assert.ok(result[0].user_override.timestamp);
});

test('applyOverrides — multiple overrides via semicolon', () => {
  const elements = [
    makeElement({ id: 'FR-5', final: 'Cut' }),
    makeElement({ id: 'FR-7', final: 'Cut' }),
  ];
  const result = applyOverrides(elements, 'FR-5:reason A; FR-7:reason B');
  assert.equal(result[0].user_override.kept_reason, 'reason A');
  assert.equal(result[1].user_override.kept_reason, 'reason B');
});

test('applyOverrides — empty override string is no-op', () => {
  const elements = [makeElement({ id: 'FR-5', final: 'Cut' })];
  const result = applyOverrides(elements, '');
  assert.equal(result[0].final, 'Cut');
  assert.equal(result[0].user_override, undefined);
});

test('runDeterministicChecks — all 6 conditions pass on happy path', () => {
  const debate = makeDebate();
  const elements = [makeElement({ codex: { evidence: [{ type: 'file:line', location: 'a.js:10' }] } })];
  const checks = runDeterministicChecks(debate, elements, 'normal');
  assert.equal(checks.rounds_ok, true);
  assert.equal(checks.has_evidence_citation, true);
  assert.equal(checks.has_explicit_stance, true);
  assert.equal(checks.has_threadId, true);
  assert.equal(checks.equilibrium_required_met, true);
  assert.equal(checks.conclusion_references_rounds, true);
});

test('runDeterministicChecks — conclusion without round reference fails', () => {
  const debate = makeDebate({ conclusion: 'Consensus reached via Accept stance. No round mentions.' });
  const checks = runDeterministicChecks(debate, [makeElement()], 'normal');
  assert.equal(checks.conclusion_references_rounds, false);
  assert.equal(checks.has_explicit_stance, true, 'stance check is independent of round-reference check');
});

test('ROUND_REF_RE — matches specific round references', () => {
  assert.ok(ROUND_REF_RE.test('round 2 saw Defend'));
  assert.ok(ROUND_REF_RE.test('R3 Accept'));
  assert.ok(ROUND_REF_RE.test('Round 5 concluded'));
  assert.ok(!ROUND_REF_RE.test('three rounds total'), 'word-number count is not a specific round ref');
  assert.ok(!ROUND_REF_RE.test('rounds of challenge'), 'generic plural is not a specific round ref');
});

test('runDeterministicChecks — rounds < 2 fails', () => {
  const debate = makeDebate({ rounds: 1 });
  const checks = runDeterministicChecks(debate, [makeElement()], 'normal');
  assert.equal(checks.rounds_ok, false);
});

test('runDeterministicChecks — empty threadId fails', () => {
  const debate = makeDebate({ threadId: '' });
  const checks = runDeterministicChecks(debate, [makeElement()], 'normal');
  assert.equal(checks.has_threadId, false);
});

test('runDeterministicChecks — no evidence citation fails', () => {
  const debate = makeDebate();
  const checks = runDeterministicChecks(debate, [makeElement()], 'normal');
  assert.equal(checks.has_evidence_citation, false);
});

test('runDeterministicChecks — deep depth without equilibrium fails', () => {
  const debate = makeDebate({ equilibriumReached: false });
  const checks = runDeterministicChecks(debate, [makeElement()], 'deep');
  assert.equal(checks.equilibrium_required_met, false);
});

test('runDeterministicChecks — normal depth without equilibrium passes', () => {
  const debate = makeDebate({ equilibriumReached: false });
  const checks = runDeterministicChecks(debate, [makeElement()], 'normal');
  assert.equal(checks.equilibrium_required_met, true);
});

test('findUnderCoveredDimensions — all dims mentioned in conclusion', () => {
  const debate = makeDebate();
  const uncovered = findUnderCoveredDimensions([1, 2, 3, 4, 5, 6], debate.conclusion);
  assert.deepEqual(uncovered, []);
});

test('findUnderCoveredDimensions — missing dimension detected', () => {
  const partial = 'Necessity Now and Abstraction Justification only covered.';
  const uncovered = findUnderCoveredDimensions([1, 2, 3, 4, 5, 6], partial);
  assert.ok(uncovered.includes(3));
  assert.ok(uncovered.includes(4));
});

test('findUnderCoveredDimensions — brief depth with only dims 1-3', () => {
  const partial = 'Necessity Now and Abstraction Justification and Extensibility Speculation.';
  const uncovered = findUnderCoveredDimensions([1, 2, 3], partial);
  assert.deepEqual(uncovered, []);
});

test('aggregateDimensions — High when ≥2 Cut in a dim', () => {
  const elements = [
    makeElement({ id: 'FR-1', primary_dimension: 1, final: 'Cut' }),
    makeElement({ id: 'FR-2', primary_dimension: 1, final: 'Cut' }),
  ];
  const dims = aggregateDimensions(elements, [1, 2, 3, 4, 5, 6]);
  assert.equal(dims[1].severity, 'High');
});

test('aggregateDimensions — includes name field per tech-spec §3.3.2 schema', () => {
  const elements = [makeElement({ primary_dimension: 1, final: 'Keep' })];
  const dims = aggregateDimensions(elements, [1, 2, 3, 4, 5, 6]);
  assert.equal(dims[1].name, DIM_NAMES[1]);
  assert.equal(dims[6].name, DIM_NAMES[6]);
  // Skipped dims also carry name
  const partial = aggregateDimensions(elements, [1, 2, 3]);
  assert.equal(partial[4].name, DIM_NAMES[4]);
  assert.equal(partial[4].severity, 'Skipped');
});

test('aggregateDimensions — Clean when no Review/Cut', () => {
  const elements = [makeElement({ primary_dimension: 1, final: 'Keep' })];
  const dims = aggregateDimensions(elements, [1, 2, 3, 4, 5, 6]);
  assert.equal(dims[1].severity, 'Clean');
});

test('aggregateDimensions — Skipped for inactive dim', () => {
  const elements = [];
  const dims = aggregateDimensions(elements, [1, 2, 3]);
  assert.equal(dims[4].severity, 'Skipped');
  assert.equal(dims[5].severity, 'Skipped');
  assert.equal(dims[6].severity, 'Skipped');
});

test('selectGate — Cut with no override → ⛔', () => {
  const elements = [makeElement({ final: 'Cut' })];
  const checks = { rounds_ok: true, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, []);
  assert.equal(gate, AUDIT_REVISE);
  assert.ok(narrative.some(n => n.includes('flagged for removal')));
});

test('selectGate — All Cut with override → ✅ with narrative', () => {
  const elements = [makeElement({ final: 'Cut', user_override: { kept_reason: 'needed', timestamp: '2026-04-20' } })];
  const checks = { rounds_ok: true, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, []);
  assert.equal(gate, AUDIT_CLEAR);
  assert.ok(narrative.some(n => n.includes('kept via --override')));
});

test('selectGate — Deterministic fail → ⛔ with Need Human narrative', () => {
  const elements = [makeElement()];
  const checks = { rounds_ok: false, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, []);
  assert.equal(gate, AUDIT_REVISE);
  assert.ok(narrative.some(n => n.includes('⚠️ Need Human')));
  assert.ok(narrative.some(n => n.includes('rounds_ok')));
});

test('selectGate — No Cut, no under-cover → ✅', () => {
  const elements = [makeElement({ final: 'Keep' })];
  const checks = { rounds_ok: true, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, []);
  assert.equal(gate, AUDIT_CLEAR);
  assert.equal(narrative.length, 0);
});

test('selectGate — No Cut but dim under-covered → ✅ with narrative', () => {
  const elements = [makeElement({ final: 'Keep' })];
  const checks = { rounds_ok: true, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, [3]);
  assert.equal(gate, AUDIT_CLEAR);
  assert.ok(narrative.some(n => n.includes('under-covered')));
});

test('consolidate — end-to-end with all-good inputs', () => {
  const phaseA = { elements: [makeElement({ id: 'FR-1', final: 'Keep' })] };
  const debate = makeDebate({ evidenceCitations: [{ type: 'file:line', location: 'src/fr-1.ts:42' }] });
  const preflight = makePreflight();
  const report = consolidate({ phaseA, debate, preflight, overrides: '', depth: 'normal' });
  assert.equal(report.schema_version, 1);
  assert.equal(report.gate, AUDIT_CLEAR);
  assert.equal(report.debate.threadId, debate.threadId);
  assert.equal(report.debate.skill_invocation, 'codex-brainstorm');
});

test('consolidate — deep depth without equilibrium → ⛔', () => {
  const phaseA = { elements: [makeElement()] };
  const debate = makeDebate({ equilibriumReached: false });
  const preflight = makePreflight({ depth: 'deep' });
  const report = consolidate({ phaseA, debate, preflight, overrides: '', depth: 'deep' });
  assert.equal(report.gate, AUDIT_REVISE);
  assert.equal(report.deterministic_checks.equilibrium_required_met, false);
});

test('matchesElementId — FR-1 does NOT match FR-10 (word boundary)', () => {
  assert.ok(matchesElementId('src/foo-fr-1.ts:42', 'FR-1'));
  assert.ok(!matchesElementId('src/foo-fr-10.ts:42', 'FR-1'));
  assert.ok(!matchesElementId('handlerFR-10-extra', 'FR-1'));
  assert.ok(matchesElementId('handler FR-1 extra', 'FR-1'));
});

test('matchesElementId — case insensitive, component with colon', () => {
  assert.ok(matchesElementId('audit of component:CacheLayer done', 'component:CacheLayer'));
  assert.ok(!matchesElementId('component:CacheLayerV2 referenced', 'component:CacheLayer'));
});

test('mergeVerdicts — Codex explicit Cut overrides Claude Keep (stricter wins)', () => {
  const phaseA = {
    elements: [makeElement({ id: 'FR-5', claude: { classification: 'Keep', rationale: 'core' } })],
  };
  const debate = makeDebate({
    perElementVerdicts: [{ classification: 'Cut', id: 'FR-5', rationale: 'no consumer', evidence: null }],
    evidenceCitations: [],
  });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].codex.classification, 'Cut');
  assert.equal(merged[0].final, 'Cut');
});

test('mergeVerdicts — citation without explicit verdict retains Claude classification', () => {
  const phaseA = {
    elements: [makeElement({ id: 'FR-1', claude: { classification: 'Review', rationale: 'borderline' } })],
  };
  const debate = makeDebate({
    perElementVerdicts: [],
    evidenceCitations: [{ type: 'file:line', location: 'src/fr-1.ts:42' }],
  });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].codex.classification, 'Review');
  assert.equal(merged[0].codex.evidence.length, 1);
  assert.equal(merged[0].final, 'Review');
});

test('mergeVerdicts — no citation + no verdict leaves element without codex field', () => {
  const phaseA = { elements: [makeElement({ id: 'FR-9', claude: { classification: 'Keep', rationale: 'clean' } })] };
  const debate = makeDebate({ perElementVerdicts: [], evidenceCitations: [] });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].codex, undefined);
  assert.equal(merged[0].final, 'Keep');
});

test('mergeVerdicts — FR-1 citation does not leak into FR-10 element', () => {
  const phaseA = {
    elements: [
      makeElement({ id: 'FR-1', claude: { classification: 'Keep', rationale: '' } }),
      makeElement({ id: 'FR-10', claude: { classification: 'Keep', rationale: '' } }),
    ],
  };
  const debate = makeDebate({
    perElementVerdicts: [],
    evidenceCitations: [{ type: 'file:line', location: 'note about FR-10 only' }],
  });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].codex, undefined);      // FR-1 not referenced
  assert.equal(merged[1].codex.evidence.length, 1);   // FR-10 properly attached
});

test('mergeVerdicts — id-tagged citation attaches via elementId, not text match', () => {
  const phaseA = { elements: [makeElement({ id: 'FR-5', claude: { classification: 'Keep', rationale: 'core' } })] };
  const debate = makeDebate({
    perElementVerdicts: [{ classification: 'Cut', id: 'FR-5', rationale: 'no consumer', evidence: 'src/foo.ts:42' }],
    evidenceCitations: [
      { type: 'file:line', location: 'src/foo.ts:42', elementId: 'FR-5' }, // id-tagged (new path)
    ],
  });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].codex.classification, 'Cut');
  assert.equal(merged[0].codex.evidence.length, 1);
  assert.equal(merged[0].codex.evidence[0].location, 'src/foo.ts:42');
  assert.equal(merged[0].codex.evidence[0].elementId, undefined, 'elementId should be stripped from final evidence');
});

test('consolidate — id-tagged evidence satisfies has_evidence_citation check', () => {
  const phaseA = { elements: [makeElement({ id: 'FR-5', claude: { classification: 'Keep', rationale: 'core' } })] };
  const debate = makeDebate({
    perElementVerdicts: [{ classification: 'Cut', id: 'FR-5', rationale: 'no consumer', evidence: 'src/foo.ts:42' }],
    evidenceCitations: [{ type: 'file:line', location: 'src/foo.ts:42', elementId: 'FR-5' }],
  });
  const preflight = makePreflight();
  const report = consolidate({ phaseA, debate, preflight, overrides: 'FR-5:keeping', depth: 'normal' });
  assert.equal(report.deterministic_checks.has_evidence_citation, true);
});

test('stricter — unknown classification on b returns a (defensive)', () => {
  const phaseA = { elements: [makeElement({ id: 'FR-1', claude: { classification: 'Keep', rationale: '' } })] };
  const debate = makeDebate({
    perElementVerdicts: [{ classification: 'drop', id: 'FR-1', rationale: '', evidence: null }], // unknown label
  });
  const merged = mergeVerdicts(phaseA, debate);
  assert.equal(merged[0].final, 'Keep');
});

test('selectGate — failed check AND under-covered both surface in narrative', () => {
  const elements = [makeElement({ id: 'FR-1', final: 'Keep' })];
  const checks = { rounds_ok: false, has_evidence_citation: true, has_explicit_stance: true, has_threadId: true, equilibrium_required_met: true };
  const { gate, narrative } = selectGate(elements, checks, [4, 5]);
  assert.equal(gate, AUDIT_REVISE);
  assert.ok(narrative.some(n => n.includes('deterministic checks failed')));
  assert.ok(narrative.some(n => n.includes('under-covered')), 'under-covered line must not be dropped');
});
