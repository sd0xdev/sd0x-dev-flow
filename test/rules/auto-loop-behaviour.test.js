'use strict';

// Behaviour-layer pins carried over from the deleted test/rules/stall-detection.test.js.
// That file pinned the hook emitter contract ([LOOP_STALL]/[STRATEGIC_RESET]) and died with
// its subject (hook-lightweighting); the tier caps and the anti-loop budget were behaviour-layer
// assertions and survive here, re-pinned against the rewritten rule text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const loopDiagnostics = readFileSync(
  resolve(root, 'skills/codex-code-review/references/loop-diagnostics.md'), 'utf8');
const autoLoop = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');

test('tier table maps each tier to its blocking severities and round cap', () => {
  assert.match(autoLoop, /\| `fast` \| Docs, comments, config, small low-risk edits \| P0 \| 6 \|/,
    'fast: P0 blocks, cap 6');
  assert.match(autoLoop, /\| `standard` \*\*\(default\)\*\* \| Ordinary features and bug fixes \| P0, P1 \| 15 \|/,
    'standard: P0/P1 block, cap 15');
  assert.match(autoLoop, /\| `thorough` \| Security, data integrity, releases, public API \| P0, P1, P2 \| 30 \|/,
    'thorough: P0/P1/P2 block, cap 30');
});

// Statements the extraction duplicated across the resident summary and its canonical contract.
//
// Pinning one side is not pinning the policy. `loop-diagnostics.md` declares itself canonical over
// the summary ("any disagreement between them is a defect in the summary"), so a guard on the
// resident copy alone leaves the copy that GOVERNS free to change — measured: `**3** consecutive
// stall rounds` → `**5**` and gutting the fourth-stall exit both survived the whole suite when
// applied to the contract, while the same edits to the rule went red.
//
// This list is the class fix for a defect that recurred four times in this change (lessons L17,
// L18): a duplicated statement is asserted on EVERY carrier, so divergence in either direction is
// what goes red, rather than one hand-picked side. Add a row here in the same commit that
// duplicates a statement.
const STALL_POLICY_CARRIERS = {
  'rules/auto-loop.md': () => autoLoop,
  'skills/codex-code-review/references/loop-diagnostics.md': () => loopDiagnostics,
};
const DUPLICATED_STALL_POLICY = [
  /\*\*3\*\* consecutive stall rounds is the signal/,
  /A \*\*fourth\*\* stall on the same change → ⚠️ Need Human/,
  /The same change hitting the cap a \*\*second\*\* time → ⚠️ Need Human/,
  /Never re-try an adjustment recorded as failed/,
  /absence is not a signal/,
];

// Register-citing statements that travelled into the contract. Prose declaring them Anchor is
// not a guard; these are the mechanical half of the two-carrier pair (tech spec § 3.4).
const ANCHOR_CITING_DIAGNOSTICS = [
  /which skip this protocol entirely/,          // Register #3 → ⚠️ Need Human
  /It edits files, so the code gate re-opens/,  // Register #6
  /Excluded for security and data-integrity changes/, // Register #3
];

test('relocated Anchor-citing policy when scanned → survives verbatim in the contract', () => {
  assert.ok(ANCHOR_CITING_DIAGNOSTICS.length >= 3,
    'all three relocated Register-citing statements must stay pinned');
  for (const pat of ANCHOR_CITING_DIAGNOSTICS) {
    assert.match(loopDiagnostics, pat, `Anchor-citing statement lost from the contract: ${pat}`);
  }
  assert.match(loopDiagnostics, /are not new Register items/,
    'the contract must declare that its inherited hits create no new Register items');
});

test('duplicated stall policy when compared → every statement holds on every carrier', () => {
  // Floors first. Without them, deleting the contract from the carrier map and THEN editing the
  // contract's own copy passes the whole suite — measured — which is precisely the defect these
  // lists were introduced to close, displaced one level up. Same pattern as the CONTRACTS floors
  // in contract-routing.test.js; it was applied to that registry in this commit and not to these.
  assert.ok(Object.keys(STALL_POLICY_CARRIERS).length >= 2,
    'both carriers of the stall policy must stay registered — the canonical one governs');
  assert.ok(DUPLICATED_STALL_POLICY.length >= 5,
    'the duplicated-statement list must not shrink; add a row when a statement is duplicated');
  for (const [name, body] of Object.entries(STALL_POLICY_CARRIERS)) {
    for (const pat of DUPLICATED_STALL_POLICY) {
      assert.match(body(), pat, `${name} lost a duplicated stall-policy statement: ${pat}`);
    }
  }
});

test('anti-loop budget: one cap diagnosis, three stall diagnoses, then a human', () => {
  // The budget table moved to the on-demand contract (rules-residency); the exits it routes to
  // stay resident, because a session must know them before it loads anything.
  assert.match(loopDiagnostics, /\| Round cap \| \*\*1\*\* diagnosis per change \|/,
    'the cap earns exactly one diagnosis per change');
  assert.match(loopDiagnostics, /\| Stall \| \*\*3\*\* per change \|/,
    'stalls earn three diagnoses per change');
  assert.match(autoLoop, /\*\*1\*\* diagnosis per change for the cap, \*\*3\*\* per change for stalls/,
    'the resident stanza must still carry both budgets');
  assert.match(autoLoop, /A \*\*fourth\*\* stall on the same change → ⚠️ Need Human/,
    'a fourth stall must route to a human, not a fourth diagnosis');
});

test('stall detection is model-side bookkeeping — no hook emitter is promised', () => {
  // Both carriers: the prose this guards moved to the contract, so guarding only the rule would
  // leave the file that actually discusses stalls unpoliced.
  for (const body of [autoLoop, loopDiagnostics]) {
    assert.doesNotMatch(body, /\[LOOP_STALL\]|\[LOOP_PROGRESS\]|\[STRATEGIC_RESET\]|\[STALL_MEMORY\]/,
      'the emitters died with their recorder (hook-lightweighting) — neither carrier may promise them');
  }
  assert.match(autoLoop, /\*\*3\*\* consecutive stall rounds is the signal/,
    'the three-round threshold survives as behaviour-layer guidance');
  assert.match(autoLoop, /Never re-try an adjustment recorded as failed/,
    'the stall-memory lesson survives the mechanism — and stays resident, not deferred');
});

test('the rounds count is named as the one mechanical fact, honestly scoped', () => {
  assert.match(autoLoop, /`rounds` count \(`review-state\.js check --format=json`\)/,
    'the state slot rounds count is the surviving mechanical input');
  assert.match(autoLoop, /it counts failed verdicts on the current change, not your conversational rounds/,
    'the count must be scoped honestly — a floor, not the whole story');
});
