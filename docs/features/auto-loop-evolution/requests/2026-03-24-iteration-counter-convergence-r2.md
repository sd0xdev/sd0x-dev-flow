# Iteration Counter + Convergence Detection

> **Created**: 2026-03-24
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [Auto-Loop Evolution](../2-tech-spec/2-tech-spec.md) Section 3.2-3.4 (State Schema v2, T1)

## Background

`rules/auto-loop.md:83` defines a "3 rounds on same issue" exit condition, but `.claude_review_state.json` has no iteration counter or finding history. After context compaction, the model forgets how many rounds have been attempted, risking infinite loops. Academic research (Yang et al. EMNLP 2025) confirms exponential decay in debugging effectiveness — first 2 rounds capture 75% of improvement.

## Requirements

- Add `iteration_history` to state schema (schema v2 migration)
- Implement finding fingerprint algorithm (`sha256(file|canonical_issue_text)`)
- Extract finding counts from review output via sentinel parsing
- Implement convergence detection infra (per-round finding storage for future overlap computation)
- Update stop-guard to respect hard cap (max_rounds=10 default in state file; override slot in `auto-loop-project.md` for behavior-layer, hook-side auto-parsing not implemented in this revision)
- Re-inject iteration state after context compaction

## Scope

| Scope | Description |
|-------|-------------|
| In | State schema v2 migration, iteration counter, fingerprint, convergence heuristic, stop-guard integration, compact hook |
| Out | ML-based predictive stop model; cross-project fingerprint sharing |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-tool-review-state.sh` | Modify | Schema migration + `_update_iteration()` function |
| `hooks/post-edit-format.sh` | Modify | Unified schema migration |
| `hooks/stop-guard.sh` | Modify | Read iteration counter, apply hard cap |
| `hooks/post-compact-auto-loop.sh` | Modify | Inject `[ITERATION_STATE]` sentinel |
| `rules/auto-loop.md` | Modify | Update exit condition to reference `max_rounds` |
| `rules/auto-loop-project.md` | Modify | Add `max_rounds` override slot |

## Acceptance Criteria

- [x] State schema v2 with `iteration_history` field (backward compatible)
- [x] Schema migration function `_migrate_state_v2()` in both state writers
- [x] Finding counts extracted via both tag-based (`[P0]`/`[Nit]`) and section-based (`#### P0`/`#### Nit`) formats
- [x] Fingerprint uses `sha256(file|canonical_issue_text)` with number/whitespace normalization
- [x] Convergence: hard cap (max_rounds=10) enforced by stop-guard hook; zero findings detection via existing auto-loop gate logic. Fingerprint overlap heuristic specified in tech spec §3.3 T1 (behavior-layer, not yet codified in `auto-loop.md` — follow-up task)
- [x] `auto-loop.md` exit condition updated to reference state file `max_rounds`
- [x] Iteration state survives context compaction (`[ITERATION_STATE]` sentinel)
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep Research + Tech Spec completed |
| Development | Done | Commit `e646b13` |
| Testing | Done | 150 hook tests pass + Codex ✅ + precommit ✅ + CI ✅ |
| Acceptance | Done | 9/9 AC checked (fingerprint overlap = infra only, codification is follow-up) |
