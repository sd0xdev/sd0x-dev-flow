# Intent — opportunistic-fix-envelope

> **Doc class**: Intent (ancillary — Design record). Written by the planner, checked by the
> implementer. Work that contradicts an Invariant or Non-goal stops and asks — amending this
> file is a re-decision, not a sync.

## North star

The plugin decides, per change, how much "fix it in passing" that change can afford — from the
risk of the **primary** change, not from the finding — so a contained domain edit absorbs a small
adjacent pre-existing fix while an infrastructure edit carries none; auditable from the transcript,
never costing a review round of its own.

## Non-goals

- No blast-radius scan and no overall risk score on the latch's path: the 2026-07-26 r4 equilibrium
  that rejected `risk-analyze.js` auto-integration stands; `/risk-assess` stays a separate advisory skill.
- No second path authority (`## Infra Paths` or similar): project path classification lives
  only in `scripts/config/sensitive-paths.json`.
- No task-owned primary file set in v1: the dirty tree is the primary-risk union (conservative, measured).
- No new Anchor Register item, gate sentinel, `gate_reason` value, or human exit.
- No dismissal semantics: a deferral never claims the finding is non-actionable, never emits
  `[DISMISS_VERDICT]`, and leaves `/seek-verdict` untouched.
- No persistence: the three records are transcript conventions like `[NIT_DEFERRED]`.

## Invariants

- `INV-001`: The envelope governs **opportunistic candidates only** — `origin=pre-existing`,
  in-scope via `diff-file` or `one-hop`, `change_relation=independent` with primary-hunk evidence
  (reviewer-supplied, or implementer-supplied before the first review under the same evidence
  standard, recorded `source=self`), not P0 / security / data-integrity. Everything else,
  including any missing, unknown or contradictory field, is mandatory (fail-closed).
- `INV-002`: The envelope is monotone: provisional `closed` until resolved; resolved before the
  first opportunistic edit or at review Step 1; ratchets downward only; effective class is
  `min(derived, project ceiling)`; the model's semantic class may escalate above the path
  result and never de-escalate a path hit.
- `INV-003`: No opportunistic-only review round: admission happens only during implementation
  before the first review or inside a fix phase a mandatory blocking finding already opened;
  a report that would be `✅ Ready` with only deferred candidates stays `✅ Ready`.
- `INV-004`: Gate predicate: `⛔ Blocked ⇔ ∃ in-scope ∧ ≥ tier-blocking ∧ obligation ∈
  {mandatory, admitted}` ∨ the existing out-of-scope-critical disjunct; `gate_reason` keeps its
  four values; an admitted finding stays owed until fixed.
- `INV-005`: Reviewer independence: prompts request `change_relation` neutrally and never carry
  the envelope, the ceiling or a desired disposition; orchestration never rewrites a reviewer's
  `origin` or `change_relation` toward `independent`.
- `INV-006`: Inherited anchors hold unchanged — every admitted edit re-opens review (Register
  #6), records carry no secrets (#2), a security / data-integrity primary change reviews at
  `thorough` (#3); the sub-threshold on-the-spot exception becomes origin-aware, never wider.

## Acceptance sketch

Primary change edits `scripts/lib/tree-digest.js`, which a `sensitive-paths.json` rule marks
`risk_class=rollout-sensitive`. The reviewer reports a pre-existing P1 in a direct caller with
`change_relation=independent` and cited primary hunks. The model emits
`[OPPORTUNISTIC_BUDGET] class=closed …`, the finding is recorded `[OPPORTUNISTIC_DEFERRED]
reason=closed`, Step 4.5 derives `✅ Ready × NONE`, the pass is noted, and the caller is not
edited. The same finding beside a primary change confined to one `skills/<name>/SKILL.md`
(`contained`, envelope `small`) with one mandatory P1 open is admitted, fixed in that fix phase,
recorded `[OPPORTUNISTIC_FIX]`, and the whole change is re-reviewed at the new digest. In both
runs the reviewer prompt contains no envelope or ceiling.
