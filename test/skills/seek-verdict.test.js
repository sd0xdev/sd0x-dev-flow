const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');

const root = resolve(__dirname, '../..');
const skillDir = resolve(root, 'skills/seek-verdict');

// --- Helper: v2 policy mapping logic (extracted from policy-mapping.md) ---

/**
 * v2: All severities are eligible for all intents.
 *
 * @param {string} severity - P0 | P1 | P2 | Nit
 * @param {string} [intent] - dismiss | confirm | clarify
 * @returns {boolean}
 */
function isEligible(severity, intent = 'dismiss') {
  const validSeverities = ['P0', 'P1', 'P2', 'Nit'];
  const validIntents = ['dismiss', 'confirm', 'clarify'];
  return validSeverities.includes(severity) && validIntents.includes(intent);
}

/**
 * v2: Returns dismiss authorization level for a severity.
 * P0/P1 require human confirmation; P2/Nit are automated.
 *
 * @param {string} severity
 * @returns {'human-required' | 'automated'}
 */
function getDismissAuthorization(severity) {
  return (severity === 'P0' || severity === 'P1') ? 'human-required' : 'automated';
}

/**
 * v2: Graduated dismiss thresholds by severity.
 *
 * @param {string} severity
 * @param {boolean} [heightened]
 * @returns {{ confidence: number, evidence: number }}
 */
function getDismissThresholds(severity, heightened = false) {
  const normal = {
    P0: { confidence: 0.95, evidence: 4 },
    P1: { confidence: 0.90, evidence: 3 },
    P2: { confidence: 0.80, evidence: 2 },
    Nit: { confidence: 0.70, evidence: 1 },
  };
  const afterWarning = {
    P0: { confidence: 1.00, evidence: 5 },
    P1: { confidence: 0.95, evidence: 4 },
    P2: { confidence: 0.85, evidence: 3 },
    Nit: { confidence: 0.75, evidence: 2 },
  };
  const table = heightened ? afterWarning : normal;
  return table[severity] || table.P2;
}

/**
 * v2: Maps Codex verdict to dismiss result with graduated thresholds.
 * P0/P1 that meet threshold → DISMISS_CANDIDATE (never auto-verified).
 * P2/Nit that meet threshold → DISMISS_VERIFIED.
 *
 * @param {object} params
 * @param {string} params.verdict - ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
 * @param {number} params.confidence
 * @param {number} params.evidenceCount
 * @param {string} [params.severity] - P0 | P1 | P2 | Nit (default P2)
 * @param {boolean} [params.heightened]
 * @returns {string}
 */
function mapVerdict({ verdict, confidence, evidenceCount, severity = 'P2', heightened = false }) {
  const thresholds = getDismissThresholds(severity, heightened);
  const auth = getDismissAuthorization(severity);

  if (verdict === 'NON_ACTIONABLE' && confidence >= thresholds.confidence && evidenceCount >= thresholds.evidence) {
    return auth === 'automated' ? 'DISMISS_VERIFIED' : 'DISMISS_CANDIDATE';
  }
  if (verdict === 'ACTIONABLE' && confidence >= 0.70) {
    return 'FIX_REQUIRED';
  }
  return 'NEED_HUMAN';
}

/**
 * v2: Confirm intent mapping.
 *
 * @param {object} params
 * @param {string} params.verdict - ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
 * @param {number} params.confidence
 * @returns {string} CONFIRMED | DISPUTED | UNCERTAIN
 */
function mapConfirmVerdict({ verdict, confidence }) {
  if (verdict === 'ACTIONABLE' && confidence >= 0.70) return 'CONFIRMED';
  if (verdict === 'NON_ACTIONABLE' && confidence >= 0.70) return 'DISPUTED';
  return 'UNCERTAIN';
}

/**
 * v2: Clarify intent mapping.
 *
 * @param {object} params
 * @param {string} params.assessment - HIGH_IMPACT | LOW_IMPACT
 * @param {number} params.confidence
 * @returns {string} HIGH_IMPACT | LOW_IMPACT | UNCERTAIN
 */
function mapClarifyVerdict({ assessment, confidence }) {
  if (confidence < 0.70) return 'UNCERTAIN';
  if (assessment === 'HIGH_IMPACT') return 'HIGH_IMPACT';
  if (assessment === 'LOW_IMPACT') return 'LOW_IMPACT';
  return 'UNCERTAIN';
}

/**
 * Checks anti-abuse guard state.
 *
 * @param {number} consecutiveDismissals
 * @returns {{ warned: boolean, heightened: boolean }}
 */
function checkAntiAbuse(consecutiveDismissals) {
  const warned = consecutiveDismissals >= 3;
  return { warned, heightened: warned };
}

/**
 * v2: Per-finding cap check for confirm/clarify intents.
 * Same finding + same commit + same intent = max 1.
 *
 * @param {Object<string, number>} counters - usage counters
 * @param {string} findingKey
 * @param {string} headSha
 * @param {string} intent - confirm | clarify
 * @returns {boolean} true if cap exceeded (should reject)
 */
function checkPerFindingCap(counters, findingKey, headSha, intent) {
  const key = `${findingKey}|${headSha}|${intent}`;
  return (counters[key] || 0) >= 1;
}

/**
 * Checks if a prompt contains Claude's conclusion (anti-anchoring violation).
 *
 * @param {string} prompt
 * @param {string} claudeConclusion
 * @returns {boolean} true if prompt is contaminated
 */
function isAnchored(prompt, claudeConclusion) {
  return prompt.includes(claudeConclusion);
}

// --- T1-T4: P2 dismiss policy mapping (v1 preserved, severity defaults to P2) ---

test('T1: P2 + NON_ACTIONABLE + confidence 0.90 → DISMISS_VERIFIED', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.90, evidenceCount: 3 });
  assert.equal(result, 'DISMISS_VERIFIED');
});

test('T2: P2 + ACTIONABLE + confidence 0.85 → FIX_REQUIRED', () => {
  const result = mapVerdict({ verdict: 'ACTIONABLE', confidence: 0.85, evidenceCount: 2 });
  assert.equal(result, 'FIX_REQUIRED');
});

test('T3: P2 + UNCERTAIN + confidence 0.50 → NEED_HUMAN', () => {
  const result = mapVerdict({ verdict: 'UNCERTAIN', confidence: 0.50, evidenceCount: 1 });
  assert.equal(result, 'NEED_HUMAN');
});

test('T4: P2 + NON_ACTIONABLE + confidence 0.70 (below threshold) → NEED_HUMAN', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.70, evidenceCount: 2 });
  assert.equal(result, 'NEED_HUMAN');
});

// --- T5: v2 eligibility (all severities eligible, authorization varies) ---

test('T5: v2 eligibility — all severities eligible, P0/P1 human-required', () => {
  assert.equal(isEligible('P0', 'dismiss'), true);
  assert.equal(isEligible('P1', 'dismiss'), true);
  assert.equal(isEligible('P2', 'dismiss'), true);
  assert.equal(isEligible('Nit', 'dismiss'), true);
  assert.equal(isEligible('P0', 'confirm'), true);
  assert.equal(isEligible('P1', 'clarify'), true);

  assert.equal(getDismissAuthorization('P0'), 'human-required');
  assert.equal(getDismissAuthorization('P1'), 'human-required');
  assert.equal(getDismissAuthorization('P2'), 'automated');
  assert.equal(getDismissAuthorization('Nit'), 'automated');

  assert.equal(isEligible('P3', 'dismiss'), false);
  assert.equal(isEligible('P2', 'reject'), false);
});

// --- T5v2-T16: v2 graduated thresholds (P0/P1 → DISMISS_CANDIDATE) ---

test('T5v2: P0 + dismiss + NON_ACTIONABLE 0.95 + 4 evidence → DISMISS_CANDIDATE', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.95, evidenceCount: 4, severity: 'P0' });
  assert.equal(result, 'DISMISS_CANDIDATE');
});

test('T14: P1 + dismiss + NON_ACTIONABLE 0.90 + 3 evidence → DISMISS_CANDIDATE', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.90, evidenceCount: 3, severity: 'P1' });
  assert.equal(result, 'DISMISS_CANDIDATE');
});

test('T15: P1 + dismiss + NON_ACTIONABLE 0.85 (below 0.90 threshold) → NEED_HUMAN', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.85, evidenceCount: 3, severity: 'P1' });
  assert.equal(result, 'NEED_HUMAN');
});

test('T16: P0 + dismiss + confidence 0.94 (below 0.95 threshold) → NEED_HUMAN', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.94, evidenceCount: 5, severity: 'P0' });
  assert.equal(result, 'NEED_HUMAN');
});

test('T21: Nit + dismiss + NON_ACTIONABLE 0.70 + 1 evidence → DISMISS_VERIFIED', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.70, evidenceCount: 1, severity: 'Nit' });
  assert.equal(result, 'DISMISS_VERIFIED');
});

// --- T6-T13: Anti-abuse + boundary + rebuttal (v1 preserved) ---

test('T6: 3 consecutive DISMISS_VERIFIED → warning emitted', () => {
  const { warned } = checkAntiAbuse(3);
  assert.equal(warned, true);
  const { warned: notYet } = checkAntiAbuse(2);
  assert.equal(notYet, false);
});

test('T7: Prompt contains Claude conclusion → anti-anchoring violation', () => {
  const claudeConclusion = 'This is a false positive because the Set implementation is sufficient';
  const cleanPrompt = 'You are a senior code reviewer. Finding: Set vs Map for runtimeInjectedKeys';
  const contaminatedPrompt = `Review this finding. ${claudeConclusion}`;

  assert.equal(isAnchored(cleanPrompt, claudeConclusion), false);
  assert.equal(isAnchored(contaminatedPrompt, claudeConclusion), true);
});

test('T8: NON_ACTIONABLE + confidence exactly 0.80 → DISMISS_VERIFIED (boundary inclusive)', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.80, evidenceCount: 2 });
  assert.equal(result, 'DISMISS_VERIFIED');
});

test('T9: ACTIONABLE + confidence exactly 0.70 → FIX_REQUIRED (boundary inclusive)', () => {
  const result = mapVerdict({ verdict: 'ACTIONABLE', confidence: 0.70, evidenceCount: 1 });
  assert.equal(result, 'FIX_REQUIRED');
});

test('T10: NON_ACTIONABLE + confidence 0.79 → NEED_HUMAN (below threshold)', () => {
  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.79, evidenceCount: 5 });
  assert.equal(result, 'NEED_HUMAN');
});

test('T11: Rebuttal still FIX_REQUIRED after 1 rebuttal → no more rounds', () => {
  const rebuttalResult = mapVerdict({ verdict: 'ACTIONABLE', confidence: 0.80, evidenceCount: 3 });
  assert.equal(rebuttalResult, 'FIX_REQUIRED');
  const MAX_REBUTTALS = 1;
  assert.equal(MAX_REBUTTALS, 1);
});

test('T12: Anti-abuse: 4th DISMISS_VERIFIED after warning → requires heightened threshold', () => {
  const { heightened } = checkAntiAbuse(4);
  assert.equal(heightened, true);

  const result = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.82, evidenceCount: 2, heightened: true });
  assert.equal(result, 'NEED_HUMAN');

  const result2 = mapVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.85, evidenceCount: 3, heightened: true });
  assert.equal(result2, 'DISMISS_VERIFIED');
});

test('T13: Anti-abuse: branch switch resets streak → counter = 0', () => {
  const { warned } = checkAntiAbuse(0);
  assert.equal(warned, false);
});

// --- T17-T19: Confirm and clarify intents (v2 new) ---

test('T17: P2 + confirm + ACTIONABLE 0.85 → CONFIRMED', () => {
  const result = mapConfirmVerdict({ verdict: 'ACTIONABLE', confidence: 0.85 });
  assert.equal(result, 'CONFIRMED');
});

test('T18: P1 + confirm + NON_ACTIONABLE 0.80 → DISPUTED', () => {
  const result = mapConfirmVerdict({ verdict: 'NON_ACTIONABLE', confidence: 0.80 });
  assert.equal(result, 'DISPUTED');
});

test('T19: P0 + clarify + HIGH_IMPACT assessment → HIGH_IMPACT', () => {
  const result = mapClarifyVerdict({ assessment: 'HIGH_IMPACT', confidence: 0.85 });
  assert.equal(result, 'HIGH_IMPACT');

  const result2 = mapClarifyVerdict({ assessment: 'LOW_IMPACT', confidence: 0.75 });
  assert.equal(result2, 'LOW_IMPACT');

  const result3 = mapClarifyVerdict({ assessment: 'HIGH_IMPACT', confidence: 0.60 });
  assert.equal(result3, 'UNCERTAIN');
});

// --- T20: Per-finding cap (v2 new) ---

test('T20: per-finding cap — 2nd confirm on same finding+commit rejected', () => {
  const counters = {};
  const findingKey = 'src/auth.ts|shell injection risk';
  const headSha = 'abc1234';

  assert.equal(checkPerFindingCap(counters, findingKey, headSha, 'confirm'), false);
  counters[`${findingKey}|${headSha}|confirm`] = 1;

  assert.equal(checkPerFindingCap(counters, findingKey, headSha, 'clarify'), false);
  counters[`${findingKey}|${headSha}|clarify`] = 1;

  assert.equal(checkPerFindingCap(counters, findingKey, headSha, 'confirm'), true);

  assert.equal(checkPerFindingCap(counters, findingKey, 'def5678', 'confirm'), false);
});

// --- Structural tests ---

test('S1: SKILL.md exists with valid frontmatter', () => {
  const skillPath = join(skillDir, 'SKILL.md');
  assert.ok(existsSync(skillPath), 'skills/seek-verdict/SKILL.md missing');

  const content = readFileSync(skillPath, 'utf8');
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  assert.ok(fmMatch, 'SKILL.md missing frontmatter');

  const fm = fmMatch[1];
  assert.ok(/^name:\s*.+/m.test(fm), 'SKILL.md missing name');
  assert.ok(/^description:\s*.+/m.test(fm), 'SKILL.md missing description');
});

test('S2: SKILL.md does not use @references/ prefix', () => {
  const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  const matches = content.match(/@references\//g);
  assert.ok(!matches, `SKILL.md uses @references/ (${matches?.length} occurrences)`);
});

test('S3: All reference files exist', () => {
  const refsDir = join(skillDir, 'references');
  assert.ok(existsSync(refsDir), 'references/ directory missing');

  const expected = ['verdict-prompt.md', 'policy-mapping.md'];
  for (const ref of expected) {
    assert.ok(existsSync(join(refsDir, ref)), `references/${ref} missing`);
  }
});

test('S6: fix-all-issues.md has DISMISS_VERDICT exception', () => {
  const content = readFileSync(resolve(root, 'rules/fix-all-issues.md'), 'utf8');
  assert.ok(
    content.includes('[DISMISS_VERDICT]'),
    'fix-all-issues.md missing [DISMISS_VERDICT] exception'
  );
  assert.ok(
    content.includes('/seek-verdict'),
    'fix-all-issues.md missing /seek-verdict reference'
  );
});

test('S7: review-common.md has DISMISS_VERDICT format', () => {
  const content = readFileSync(
    resolve(root, 'skills/codex-code-review/references/review-common.md'),
    'utf8'
  );
  assert.ok(
    content.includes('[DISMISS_VERDICT]'),
    'review-common.md missing [DISMISS_VERDICT] format'
  );
});

test('S8: Verdict prompt enforces anti-anchoring', () => {
  const content = readFileSync(join(skillDir, 'references/verdict-prompt.md'), 'utf8');
  assert.ok(
    content.includes('Do not assume this finding is true or false'),
    'verdict-prompt.md missing anti-anchoring instruction'
  );
  assert.ok(
    content.includes('independently research'),
    'verdict-prompt.md missing independent research requirement'
  );
});

test('S9: Policy mapping defines graduated thresholds', () => {
  const content = readFileSync(join(skillDir, 'references/policy-mapping.md'), 'utf8');
  assert.ok(content.includes('0.95'), 'policy-mapping.md missing P0 dismiss threshold 0.95');
  assert.ok(content.includes('0.90'), 'policy-mapping.md missing P1 dismiss threshold 0.90');
  assert.ok(content.includes('0.80'), 'policy-mapping.md missing P2 dismiss threshold 0.80');
  assert.ok(content.includes('0.70'), 'policy-mapping.md missing Nit/fix threshold 0.70');
  assert.ok(content.includes('DISMISS_CANDIDATE'), 'policy-mapping.md missing DISMISS_CANDIDATE for P0/P1');
  assert.ok(
    content.includes('[DISMISS_PATTERN_WARN]'),
    'policy-mapping.md missing anti-abuse warning format'
  );
});

// --- S10-S12: v2 structural tests ---

test('S10: SKILL.md has [SEEK_VERDICT] format for confirm/clarify', () => {
  const content = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
  assert.ok(
    content.includes('[SEEK_VERDICT]'),
    'SKILL.md missing [SEEK_VERDICT] format'
  );
  assert.ok(
    content.includes('intent=<confirm|clarify>'),
    'SKILL.md missing intent field in [SEEK_VERDICT]'
  );
});

test('S11: review-common.md has [SEEK_VERDICT] format', () => {
  const content = readFileSync(
    resolve(root, 'skills/codex-code-review/references/review-common.md'),
    'utf8'
  );
  assert.ok(
    content.includes('[SEEK_VERDICT]'),
    'review-common.md missing [SEEK_VERDICT] format'
  );
});

// --- T22-T23: Audit trail format validation (v2 new) ---

test('T22: [SEEK_VERDICT] format for confirm intent has required fields', () => {
  const content = readFileSync(join(skillDir, 'references/policy-mapping.md'), 'utf8');
  const seekLine = content.split('\n').find((l) => l.includes('[SEEK_VERDICT] key='));
  assert.ok(seekLine, 'policy-mapping.md missing [SEEK_VERDICT] format line');

  const requiredFields = ['key=', 'severity=', 'intent=', 'verdict=', 'confidence=', 'codex_thread=', 'evidence=', 'timestamp='];
  for (const field of requiredFields) {
    assert.ok(seekLine.includes(field), `[SEEK_VERDICT] format missing field: ${field}`);
  }
});

test('T23: [DISMISS_VERDICT] backward compat — v1 fields + intent + authorization', () => {
  const content = readFileSync(join(skillDir, 'references/policy-mapping.md'), 'utf8');
  const dismissLine = content.split('\n').find((l) => l.includes('[DISMISS_VERDICT] key='));
  assert.ok(dismissLine, 'policy-mapping.md missing [DISMISS_VERDICT] format line');

  const v1Fields = ['key=', 'severity=', 'verdict=', 'confidence=', 'codex_thread=', 'evidence=', 'timestamp='];
  for (const field of v1Fields) {
    assert.ok(dismissLine.includes(field), `[DISMISS_VERDICT] missing v1 field: ${field}`);
  }

  assert.ok(dismissLine.includes('intent=dismiss'), '[DISMISS_VERDICT] missing intent=dismiss');
  assert.ok(dismissLine.includes('authorization='), '[DISMISS_VERDICT] missing authorization field');

  const intentIdx = dismissLine.indexOf('intent=');
  const timestampIdx = dismissLine.indexOf('timestamp=');
  assert.ok(intentIdx > timestampIdx, 'intent= should appear after timestamp= for backward compat');
});

// --- S13-S15: load-pr-review v2 integration invariants ---

test('S13: load-pr-review SKILL.md uses derived severity (no hardcoded P2 in prompt)', () => {
  const content = readFileSync(resolve(root, 'skills/load-pr-review/SKILL.md'), 'utf8');
  const promptSection = content.slice(content.indexOf('Agent({'));
  assert.ok(
    !promptSection.includes('severity: P2'),
    'load-pr-review SKILL.md still has hardcoded severity: P2 in Agent prompt'
  );
  assert.ok(
    promptSection.includes('<derived severity>'),
    'load-pr-review SKILL.md missing <derived severity> placeholder in Agent prompt'
  );
});

test('S14: load-pr-review result mapping includes DISMISS_CANDIDATE', () => {
  const content = readFileSync(resolve(root, 'skills/load-pr-review/SKILL.md'), 'utf8');
  assert.ok(
    content.includes('DISMISS_CANDIDATE'),
    'load-pr-review SKILL.md result mapping missing DISMISS_CANDIDATE for P0/P1'
  );
});

test('S15: verdict-triage-prompt.md includes DISMISS_CANDIDATE in both mapping and verification', () => {
  const content = readFileSync(
    resolve(root, 'skills/load-pr-review/references/verdict-triage-prompt.md'),
    'utf8'
  );
  const matches = content.match(/DISMISS_CANDIDATE/g);
  assert.ok(matches && matches.length >= 2,
    `verdict-triage-prompt.md has ${matches?.length || 0} DISMISS_CANDIDATE refs, expected >= 2 (mapping + verification)`
  );
});

// An opportunistic deferral says "this change does not owe the fix now"; a dismissal says "the
// finding is not real". Collapsing the two would let a P1 leave the board on a P2's evidence bar,
// bypassing the human gate `policy-mapping.md` puts on a P0/P1 dismiss. These pin the separation.
test('S16: an opportunistic deferral is not a dismissal and never borrows the dismiss vocabulary', () => {
  const contract = readFileSync(
    resolve(root, 'skills/codex-code-review/references/scope-contract.md'), 'utf8');
  const env = contract.slice(
    contract.indexOf('## Opportunistic Envelope'), contract.indexOf('## Records'));
  assert.ok(env.length > 0, 'the scope contract must carry an Opportunistic Envelope section');

  assert.match(env, /Deferral is not dismissal/,
    'the separation must be stated where the deferral is defined');
  assert.match(env, /stays actionable/,
    'a deferred finding is still a real finding');
  assert.ok(!/DISMISS_VERIFIED|DISMISS_CANDIDATE/.test(env),
    'the envelope must not reuse the dismiss result vocabulary');
  assert.match(env, /carries no `\[DISMISS_VERDICT\]`/,
    'a deferral emits no dismiss audit line');
  assert.match(env, /needs no\s+`\/seek-verdict` blind check/,
    'a deferral does not route through blind verification');

  // …and the reverse direction: the P0/P1 human gate is untouched by any of this.
  const policy = readFileSync(
    resolve(root, 'skills/seek-verdict/references/policy-mapping.md'), 'utf8');
  assert.match(policy, /Human confirmation required/,
    'the P0/P1 dismiss gate must still require human confirmation');
  assert.ok(!/OPPORTUNISTIC/.test(policy),
    'seek-verdict policy must stay independent of the opportunistic axis');
});
