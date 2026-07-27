# Convergence Rule Codification

> **Created**: 2026-03-25
> **Status**: Completed
> **Priority**: P2
> **Verified**: 2026-04-21 — `rules/auto-loop.md` §Exit Conditions rewritten as 6-row decision table mirroring tech-spec §3.3 T1 (hard cap / zero / plateau / non-plateau / converging / parse-null); advisory exits retained orthogonally; `.claude/rules/auto-loop.md` sync verified via `diff -q` (byte-identical).
> **Tech Spec**: [Auto-Loop Evolution](../2-tech-spec/2-tech-spec.md) Section 3.3 T1 (Convergence Detection)
> **Depends On**: [Iteration Counter (R2)](./2026-03-24-iteration-counter-convergence-r2.md)

## Background

R2 implemented per-round finding storage (`findings_by_round[]` in state schema v2) and hard cap enforcement (`max_rounds=10` in stop-guard). However, the full convergence heuristic from the tech spec (zero findings proceed, fingerprint overlap >= 50% plateau detection) is not yet codified as behavior-layer rules in `auto-loop.md`. Currently Claude relies on the hard cap only.

## Requirements

- Add convergence decision table to `rules/auto-loop.md` Exit Conditions section
- Define zero-findings detection rule (proceed to precommit)
- Define fingerprint overlap plateau detection (>= 50% overlap across 3+ rounds with non-decreasing total)
- Reference `iteration_history.findings_by_round[]` from state file

## Scope

| Scope | Description |
|-------|-------------|
| In | Behavior-layer convergence rules in auto-loop.md, referencing existing state infra |
| Out | Hook-side automated convergence (stop-guard only enforces hard cap); fingerprint computation in hooks |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `rules/auto-loop.md` | Modify | Add convergence decision table to Exit Conditions |
| `.claude/rules/auto-loop.md` | Modify | Mirror same convergence table |
| `docs/features/auto-loop-evolution/2-tech-spec/2-tech-spec.md` | Reference | Section 3.3 T1 convergence table is the source spec |

## Acceptance Criteria

- [x] `auto-loop.md` Exit Conditions includes convergence decision table (zero/plateau/converging/null)
- [x] Zero findings rule: `total == 0` in current round triggers precommit
- [x] Plateau rule: `total >= prev_total` AND fingerprint overlap >= 50% for 3+ rounds triggers Need Human
- [x] Rule references `iteration_history.findings_by_round[]` from `.claude_review_state.json`
- [x] Pass /codex-review-doc

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech spec §3.3 T1 defines convergence table |
| Development | Done | Convergence plateau added to auto-loop.md:87 |
| Testing | Done | Behavior-layer only (no hook tests needed) |
| Acceptance | Done | Codex review ✅ Ready + precommit ✅ Pass |
