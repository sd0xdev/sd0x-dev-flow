'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');

const { decide, FALLBACK_CARRIERS, CONTRACTS } = require(resolve(__dirname, '../../../scripts/lib/review-dispatch.js'));

const base = (over = {}) => ({
  contract: 'doc',
  probe: 'codex_ok',
  sticky: 'none',
  priority: 1,
  validatorResult: null,
  threadRounds: 0,
  threshold: 3,
  ...over,
});

test('healthy codex: first dispatch targets codex, not note-eligible until validated', () => {
  const a = decide(base());
  assert.deepEqual(a, { kind: 'dispatch', target: 'codex', priority: 1, degradedForm: null, noteEligible: false });
});

test('validated codex report is note-eligible', () => {
  const a = decide(base({ validatorResult: 'pass' }));
  assert.equal(a.kind, 'dispatch');
  assert.equal(a.noteEligible, true);
});

test('probe failure routes to P2 for every fallback-bearing contract', () => {
  for (const contract of CONTRACTS.filter((c) => c !== 'necessity')) {
    const a = decide(base({ contract, probe: 'codex_fail' }));
    assert.equal(a.kind, 'dispatch', contract);
    assert.equal(a.priority, 2, contract);
    assert.equal(a.target, FALLBACK_CARRIERS[contract][0], contract);
    assert.equal(a.noteEligible, false, contract);
  }
});

test('code fallback priority order: strict-reviewer (P2) then toolkit (P3)', () => {
  const p2 = decide(base({ contract: 'code', probe: 'codex_fail' }));
  assert.equal(p2.target, 'strict-reviewer');
  const p3 = decide(base({ contract: 'code', probe: 'codex_fail', priority: 2, validatorResult: 'fail' }));
  assert.deepEqual(p3, { kind: 'dispatch', target: 'pr-review-toolkit:code-reviewer', priority: 3, degradedForm: null, noteEligible: false });
});

test('validator failure advances one priority; a pass stays and notes', () => {
  const next = decide(base({ probe: 'codex_fail', priority: 2, validatorResult: 'fail' }));
  assert.equal(next.priority, 3);
  assert.equal(next.target, 'contract-neutral-reviewer'); // fresh-instance retry
  const stay = decide(base({ probe: 'codex_fail', priority: 3, validatorResult: 'pass' }));
  assert.deepEqual(stay, { kind: 'dispatch', target: 'contract-neutral-reviewer', priority: 3, degradedForm: null, noteEligible: true });
});

test('exhaustion is per-contract terminal: plan gets [PLAN_REVIEW_DEGRADED], the rest no sentinel; never note-eligible', () => {
  for (const contract of CONTRACTS.filter((c) => c !== 'necessity')) {
    const last = 1 + FALLBACK_CARRIERS[contract].length;
    const a = decide(base({ contract, probe: 'codex_fail', priority: last, validatorResult: 'fail' }));
    assert.equal(a.kind, 'terminal', contract);
    assert.equal(a.target, null, contract);
    assert.equal(a.noteEligible, false, contract);
    if (contract === 'plan') assert.equal(a.degradedForm, '[PLAN_REVIEW_DEGRADED]');
    else assert.equal(a.degradedForm, null, contract);
  }
});

test('sticky fallback never re-probes: carrier stays fallback even when the probe would succeed', () => {
  const a = decide(base({ sticky: 'fallback', probe: 'codex_ok', priority: 2 }));
  assert.equal(a.kind, 'dispatch');
  assert.equal(a.target, 'contract-neutral-reviewer');
});

test('rotation fires at the threshold on the codex reply path only', () => {
  assert.equal(decide(base({ threadRounds: 2 })).kind, 'dispatch');
  const r = decide(base({ threadRounds: 3 }));
  assert.deepEqual(r, { kind: 'rotate', target: 'codex', priority: 1, degradedForm: null, noteEligible: false });
  assert.equal(decide(base({ threadRounds: 4 })).kind, 'rotate');
  // Custom threshold from ## Review Thread Rotation (2-6).
  assert.equal(decide(base({ threadRounds: 2, threshold: 2 })).kind, 'rotate');
  assert.equal(decide(base({ threadRounds: 5, threshold: 6 })).kind, 'dispatch');
  // Fallback carriers are stateless — every round is fresh, so no rotate action there.
  assert.equal(decide(base({ sticky: 'fallback', threadRounds: 9, priority: 2 })).kind, 'dispatch');
});

test('necessity: codex failure goes to its own existing degradation, and it never rotates', () => {
  const fail = decide(base({ contract: 'necessity', probe: 'codex_fail' }));
  assert.deepEqual(fail, { kind: 'terminal', target: null, degradedForm: 'necessity-existing-degradation', noteEligible: false });
  const sticky = decide(base({ contract: 'necessity', sticky: 'fallback' }));
  assert.equal(sticky.kind, 'terminal');
  const rot = decide(base({ contract: 'necessity', threadRounds: 99 }));
  assert.equal(rot.kind, 'dispatch');
  assert.equal(rot.target, 'codex');
});

test('malformed state fails closed with a throw', () => {
  assert.throws(() => decide(null), TypeError);
  assert.throws(() => decide({}), TypeError);
  assert.throws(() => decide(base({ contract: 'unknown' })), TypeError);
  assert.throws(() => decide(base({ probe: 'maybe' })), TypeError);
  assert.throws(() => decide(base({ sticky: 'yes' })), TypeError);
  assert.throws(() => decide(base({ threshold: 1 })), TypeError);
  assert.throws(() => decide(base({ threshold: 7 })), TypeError);
  assert.throws(() => decide(base({ threadRounds: -1 })), TypeError);
  assert.throws(() => decide(base({ priority: 0 })), TypeError);
  assert.throws(() => decide(base({ validatorResult: 'ok' })), TypeError);
});

test('defaults: omitted optional fields resolve to first dispatch with threshold 3', () => {
  const a = decide({ contract: 'code', probe: 'codex_ok', sticky: 'none' });
  assert.deepEqual(a, { kind: 'dispatch', target: 'codex', priority: 1, degradedForm: null, noteEligible: false });
  const r = decide({ contract: 'code', probe: 'codex_ok', sticky: 'none', threadRounds: 3 });
  assert.equal(r.kind, 'rotate');
});

test('a claimed pass at a phantom priority throws instead of note-enabling a ghost carrier', () => {
  // P1 fix (codex review 2026-08-23): priority 4 for doc names no carrier, so a validator pass
  // there is a contradictory state — fail closed with TypeError, never {target: undefined,
  // noteEligible: true}.
  assert.throws(() => decide({ contract: 'doc', probe: 'codex_fail', sticky: 'fallback', priority: 4, validatorResult: 'pass' }), TypeError);
  assert.throws(() => decide({ contract: 'code', probe: 'codex_fail', sticky: 'fallback', priority: 4, validatorResult: 'pass' }), TypeError);
});

test('priority beyond the exhausted step is rejected for the contract', () => {
  // max = 1 (codex) + carriers + 1 (exhausted step). doc: carriers=2 → max 4; 5 is impossible.
  assert.throws(() => decide({ contract: 'doc', probe: 'codex_fail', sticky: 'fallback', priority: 5, validatorResult: null }), TypeError);
  // necessity has no carriers → max 2; 3 is impossible even though necessity short-circuits.
  assert.throws(() => decide({ contract: 'necessity', probe: 'codex_fail', sticky: 'none', priority: 3, validatorResult: null }), TypeError);
  // The exhausted step itself stays legal: doc priority 4 with a fail routes to the terminal.
  const r = decide({ contract: 'doc', probe: 'codex_fail', sticky: 'fallback', priority: 3, validatorResult: 'fail' });
  assert.equal(r.kind, 'terminal');
});

test('relational invariants: a Codex-healthy probe with a fallback-range priority throws on every contract', () => {
  // P1 fix (codex review 2026-08-23, round 8): the Codex branch used to ignore `priority`, so
  // {probe: codex_ok, priority: 4, validatorResult: 'pass'} became note-eligible at priority 1 —
  // a ghost pass smuggled past the exhausted step. Contradictory field pairs now throw.
  for (const contract of CONTRACTS) {
    const max = 1 + FALLBACK_CARRIERS[contract].length + 1;
    for (let p = 2; p <= max; p += 1) {
      for (const validatorResult of [null, 'pass', 'fail']) {
        assert.throws(
          () => decide({ contract, probe: 'codex_ok', sticky: 'none', priority: p, validatorResult }),
          TypeError,
          `${contract} priority ${p} validatorResult ${validatorResult} must throw under codex_ok/none`
        );
      }
    }
  }
});

test('relational invariants: necessity rejects every fallback position whatever the probe says', () => {
  assert.throws(() => decide({ contract: 'necessity', probe: 'codex_ok', sticky: 'none', priority: 2, validatorResult: 'pass' }), TypeError);
  assert.throws(() => decide({ contract: 'necessity', probe: 'codex_fail', sticky: 'none', priority: 2, validatorResult: null }), TypeError);
  assert.throws(() => decide({ contract: 'necessity', probe: 'codex_fail', sticky: 'fallback', priority: 2, validatorResult: 'pass' }), TypeError);
});

test('relational invariants: the legal states around the contradiction still decide (negative control)', () => {
  // Same fields, minus the contradiction — the invariant must not over-reject.
  const healthy = decide({ contract: 'doc', probe: 'codex_ok', sticky: 'none', priority: 1, validatorResult: 'pass' });
  assert.deepEqual(healthy, { kind: 'dispatch', target: 'codex', priority: 1, degradedForm: null, noteEligible: true });
  const sticky = decide({ contract: 'doc', probe: 'codex_ok', sticky: 'fallback', priority: 2, validatorResult: 'pass' });
  assert.equal(sticky.noteEligible, true, 'sticky fallback at a real carrier position stays legal even if the probe recovered');
  const necessity = decide({ contract: 'necessity', probe: 'codex_ok', sticky: 'none', priority: 1, validatorResult: 'pass' });
  assert.equal(necessity.noteEligible, true);
});

test('relational invariants: a validatorResult at priority 1 on the fallback path throws (round-12 P1)', () => {
  // No carrier has been dispatched at priority 1 on the fallback path, so a validatorResult
  // there names a report nobody produced: 'pass' used to return P2 with noteEligible:true (a
  // forged note for a carrier that never ran), and 'fail' used to advance to P3, skipping the
  // required P2 dispatch entirely.
  for (const contract of CONTRACTS) {
    for (const validatorResult of ['pass', 'fail']) {
      assert.throws(
        () => decide({ contract, probe: 'codex_fail', sticky: 'none', priority: 1, validatorResult }),
        TypeError,
        `${contract} codex_fail P1 validatorResult ${validatorResult} must throw`
      );
      assert.throws(
        () => decide({ contract, probe: 'codex_ok', sticky: 'fallback', priority: 1, validatorResult }),
        TypeError,
        `${contract} sticky-fallback P1 validatorResult ${validatorResult} must throw`
      );
      // priority omitted defaults to 1 — the same contradiction must not slip through.
      assert.throws(
        () => decide({ contract, probe: 'codex_fail', sticky: 'none', validatorResult }),
        TypeError,
        `${contract} codex_fail default-priority validatorResult ${validatorResult} must throw`
      );
    }
  }
});

test('fallback path: Codex failure with no validatorResult always dispatches P2 first (negative control)', () => {
  // The legal first fallback step — same fields minus the contradiction.
  const first = decide({ contract: 'doc', probe: 'codex_fail', sticky: 'none', priority: 1, validatorResult: null });
  assert.deepEqual(first, { kind: 'dispatch', target: 'contract-neutral-reviewer', priority: 2, degradedForm: null, noteEligible: false });
  const code = decide({ contract: 'code', probe: 'codex_fail', sticky: 'none', validatorResult: null });
  assert.equal(code.target, 'strict-reviewer');
  assert.equal(code.priority, 2);
  assert.equal(code.noteEligible, false);
  // A validated pass AT a real carrier position (P2) still notes — the invariant is scoped to P1.
  const adopted = decide({ contract: 'doc', probe: 'codex_fail', sticky: 'fallback', priority: 2, validatorResult: 'pass' });
  assert.equal(adopted.noteEligible, true);
});

test('healthy codex: validator fail stays P1 re-dispatch, never advances the fallback chain', () => {
  // On the healthy path a failed validation means Codex re-reports on the same carrier —
  // advancing to P2 here would swap reviewers on a change whose probe said Codex is fine.
  // Contrast: the same validatorResult at a fallback carrier advances the chain (tested above).
  const a = decide({ contract: 'doc', probe: 'codex_ok', sticky: 'none', priority: 1, validatorResult: 'fail' });
  assert.deepEqual(a, { kind: 'dispatch', target: 'codex', priority: 1, degradedForm: null, noteEligible: false });
  const code = decide({ contract: 'code', probe: 'codex_ok', sticky: 'none', validatorResult: 'fail' });
  assert.equal(code.target, 'codex');
  assert.equal(code.priority, 1);
  assert.equal(code.noteEligible, false);
});
