'use strict';

/**
 * Pure dispatch decision table for the review loop (review-loop-resilience).
 *
 * `decide(state)` answers "what does the orchestrator do next" for one review dispatch step.
 * Zero dependencies, no I/O — skills call it via `node -e` and the harness unit-tests the
 * sequences directly. It decides; it never dispatches, validates or notes anything itself.
 *
 * state = {
 *   contract:        'code' | 'doc' | 'plan' | 'test:coverage' | 'test:ac-trace' | 'necessity',
 *   probe:           'codex_ok' | 'codex_fail',      // this change's first-dispatch probe result
 *   sticky:          'none' | 'fallback',            // per-change carrier stickiness
 *   priority:        1..N,                           // carrier priority being evaluated (1 = codex)
 *   validatorResult: null | 'pass' | 'fail',         // validate-family-sentinel.js on the last report
 *   threadRounds:    0..N,                           // replies carried by the current thread (behaviour-layer count)
 *   threshold:       2..6,                           // R-a rotation threshold (## Review Thread Rotation; unset = 3)
 * }
 * action = { kind: 'dispatch' | 'rotate' | 'terminal', target: string|null,
 *            priority?: number, degradedForm: string|null, noteEligible: boolean }
 *
 * noteEligible is true only when a validated report exists to note (validatorResult === 'pass').
 * Terminal actions never note: no reviewer ran ⇒ no verdict exists (Priority 4).
 * Contract: docs/features/review-loop-resilience/2-tech-spec.md §3.2.1.
 */

const CODEX = 'codex';

/** Fallback carriers per contract, in priority order starting at P2. */
const FALLBACK_CARRIERS = {
  // code keeps its native contract carriers: repo-owned strict-reviewer first (frontmatter-pinned),
  // plugin toolkit agent after (pin cannot reach it — call-site asks for opus/high, best-effort).
  code: ['strict-reviewer', 'pr-review-toolkit:code-reviewer'],
  // Non-code contracts ride the pinned contract-neutral-reviewer; P3 is one retry on a fresh instance.
  doc: ['contract-neutral-reviewer', 'contract-neutral-reviewer'],
  plan: ['contract-neutral-reviewer', 'contract-neutral-reviewer'],
  'test:coverage': ['contract-neutral-reviewer', 'contract-neutral-reviewer'],
  'test:ac-trace': ['contract-neutral-reviewer', 'contract-neutral-reviewer'],
  // necessity is excluded from fallback in v1: its first dispatch is a constitutive Codex debate
  // pipeline, not a template a single reviewer could rerun.
  necessity: [],
};

const CONTRACTS = Object.keys(FALLBACK_CARRIERS);
const PROBES = ['codex_ok', 'codex_fail'];
const STICKY = ['none', 'fallback'];
const VALIDATOR_RESULTS = [null, 'pass', 'fail'];

const isInt = (v) => Number.isInteger(v);

function assertState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('state must be an object');
  }
  const { contract, probe, sticky, priority, validatorResult, threadRounds, threshold } = state;
  if (!CONTRACTS.includes(contract)) throw new TypeError(`unknown contract: ${contract}`);
  if (!PROBES.includes(probe)) throw new TypeError(`unknown probe: ${probe}`);
  if (!STICKY.includes(sticky)) throw new TypeError(`unknown sticky: ${sticky}`);
  if (priority !== undefined && (!isInt(priority) || priority < 1)) throw new TypeError(`invalid priority: ${priority}`);
  if (!VALIDATOR_RESULTS.includes(validatorResult === undefined ? null : validatorResult)) {
    throw new TypeError(`invalid validatorResult: ${validatorResult}`);
  }
  if (threadRounds !== undefined && (!isInt(threadRounds) || threadRounds < 0)) throw new TypeError(`invalid threadRounds: ${threadRounds}`);
  if (threshold !== undefined && (!isInt(threshold) || threshold < 2 || threshold > 6)) throw new TypeError(`invalid threshold: ${threshold}`);
  // Fail-closed on impossible carrier positions: priority 1 is Codex and each fallback carrier
  // adds one. Anything past `exhausted + 1` names a carrier that does not exist, and no branch
  // may index the carrier table off its end (a `pass` at a phantom priority must throw, never
  // return `target: undefined` with `noteEligible: true`).
  if (priority !== undefined && contract !== undefined && FALLBACK_CARRIERS[contract] !== undefined) {
    const maxPriority = 1 + FALLBACK_CARRIERS[contract].length + 1; // last real carrier + the exhausted step
    if (priority > maxPriority) {
      throw new TypeError(`priority ${priority} exceeds carrier range for contract ${contract} (max ${maxPriority})`);
    }
  }
  // Relational invariants — a contradictory state throws instead of silently normalizing, so a
  // ghost pass (e.g. a claimed validated pass at an exhausted priority while the probe says
  // Codex is healthy) can never fall through a branch that ignores one of its fields.
  if (priority !== undefined && priority > 1 && probe === 'codex_ok' && sticky !== 'fallback') {
    throw new TypeError(
      `contradictory state: priority ${priority} names a fallback position but probe=codex_ok with sticky=${sticky} routes to Codex (priority 1)`
    );
  }
  if (contract === 'necessity' && priority !== undefined && priority > 1) {
    throw new TypeError('contradictory state: necessity has no fallback carriers, priority > 1 names a position that cannot exist');
  }
  // On the fallback path, priority 1 means "no carrier has been dispatched yet" — Codex did not
  // report (probe failed or the change is sticky past it), and P2 has not run. A validatorResult
  // there reports a carrier that cannot exist: consuming 'pass' would forge note eligibility for
  // a report nobody produced, and 'fail' would advance the chain past the P2 dispatch that never
  // happened (round-12 P1).
  const onFallbackPath = probe === 'codex_fail' || sticky === 'fallback';
  const effPriority = priority === undefined ? 1 : priority;
  const effValidator = validatorResult === undefined ? null : validatorResult;
  if (onFallbackPath && effPriority === 1 && effValidator !== null) {
    throw new TypeError(
      `contradictory state: validatorResult '${effValidator}' at priority 1 on the fallback path names a carrier report that cannot exist (Codex did not report and no fallback carrier has been dispatched)`
    );
  }
}

function decide(state) {
  assertState(state);
  const contract = state.contract;
  const probe = state.probe;
  const sticky = state.sticky;
  const priority = state.priority === undefined ? 1 : state.priority;
  const validatorResult = state.validatorResult === undefined ? null : state.validatorResult;
  const threadRounds = state.threadRounds === undefined ? 0 : state.threadRounds;
  const threshold = state.threshold === undefined ? 3 : state.threshold;

  // necessity: v1 excludes both mechanisms — never rotate, and codex failing routes to the
  // skill's own existing degradation, never to a fallback carrier.
  if (contract === 'necessity') {
    if (probe === 'codex_fail' || sticky === 'fallback') {
      return { kind: 'terminal', target: null, degradedForm: 'necessity-existing-degradation', noteEligible: false };
    }
    return { kind: 'dispatch', target: CODEX, priority: 1, degradedForm: null, noteEligible: validatorResult === 'pass' };
  }

  const onCodex = sticky !== 'fallback' && probe === 'codex_ok';

  if (onCodex) {
    // Rotation applies only to the stateful reply path: fallback carriers are stateless, so
    // every fallback round is already a fresh dispatch.
    if (threadRounds >= threshold) {
      return { kind: 'rotate', target: CODEX, priority: 1, degradedForm: null, noteEligible: false };
    }
    return { kind: 'dispatch', target: CODEX, priority: 1, degradedForm: null, noteEligible: validatorResult === 'pass' };
  }

  // Fallback path — probe failed on this change's first dispatch, or the carrier is already
  // sticky from earlier in the change (sticky never re-probes: quota flapping must not flip
  // carriers mid-loop).
  const carriers = FALLBACK_CARRIERS[contract];
  let p = priority < 2 ? 2 : priority;
  if (validatorResult === 'pass') {
    // A validated pass can only come from a carrier that exists — bounds-check before indexing,
    // so an exhausted-range priority with a claimed pass fails closed instead of note-enabling
    // a verdict from a nonexistent carrier.
    if (p - 2 >= carriers.length) {
      throw new TypeError(`validatorResult 'pass' at priority ${p} names no carrier for contract ${contract}`);
    }
    return { kind: 'dispatch', target: carriers[p - 2], priority: p, degradedForm: null, noteEligible: true };
  }
  if (validatorResult === 'fail') p += 1;
  const idx = p - 2;
  if (idx >= carriers.length) {
    // Priority 4: every carrier exhausted. No reviewer ran ⇒ no verdict exists ⇒ nothing is
    // noted. plan alone has a reviewer-unavailable degraded form of its own; the rest emit no
    // gate sentinel at all — behaviour-layer ⚠️ Need Human surfaces in conversation.
    return {
      kind: 'terminal',
      target: null,
      degradedForm: contract === 'plan' ? '[PLAN_REVIEW_DEGRADED]' : null,
      noteEligible: false,
    };
  }
  return { kind: 'dispatch', target: carriers[idx], priority: p, degradedForm: null, noteEligible: false };
}

module.exports = { decide, FALLBACK_CARRIERS, CONTRACTS };
