# Max Rounds Project Override Parser

> **Created**: 2026-03-25
> **Status**: Completed
> **Priority**: P2
> **Verified**: 2026-04-21 — init_state_file now reads project override via awk-based `_read_project_max_rounds` (section-scoped, HTML-comment aware). Regression tests: 6 in `test/hooks/post-edit-format.test.js` + 4 in `test/hooks/post-tool-review-state.test.js` covering override=15, no-override, commented placeholder, multi-line HTML comment isolation, out-of-range rejection. 242 hook tests green.
> **Tech Spec**: [Auto-Loop Evolution](../2-tech-spec/2-tech-spec.md) Section 3.2 (Rule Migration)
> **Depends On**: [Iteration Counter (R2)](./2026-03-24-iteration-counter-convergence-r2.md)

## Background

R2 added `iteration_history.max_rounds` to the state schema (default 10) and `auto-loop-project.md` has an override slot (`## Max Rounds`). However, hook-side code hardcodes `max_rounds: 10` in both `post-tool-review-state.sh` (migration) and `post-edit-format.sh` (init). No parser reads the project override from `auto-loop-project.md` to set the state file value.

## Requirements

- Parse `max_rounds` override from `rules/auto-loop-project.md` (or `.claude/rules/auto-loop-project.md`)
- Apply parsed value during schema migration and state init
- Fallback to default 10 when override not set or file not found
- Document override syntax in `auto-loop-project.md`

## Scope

| Scope | Description |
|-------|-------------|
| In | Hook-side parser for max_rounds override, state init/migration update |
| Out | Runtime max_rounds change (requires state file re-init); UI for configuration |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-tool-review-state.sh` | Modify | Parse max_rounds from project override during migration |
| `hooks/post-edit-format.sh` | Modify | Parse max_rounds from project override during init |
| `rules/auto-loop-project.md` | Modify | Document override syntax (e.g., `max_rounds: 15`) |
| `.claude/rules/auto-loop-project.md` | Modify | Mirror same override syntax |

## Acceptance Criteria

- [x] `auto-loop-project.md` has documented `max_rounds` override syntax
- [x] `_migrate_state_v2()` reads override and applies to `iteration_history.max_rounds`
- [x] `init_state_file()` in post-edit-format.sh reads override for initial value
- [x] Fallback to 10 when override not found or file missing
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Identified during R2 Codex review |
| Development | Done | Changed heredoc from `<<'EOF'` to `<<EOF` with runtime `_mr` expansion in both hooks' `init_state_file` |
| Testing | Done | 10 R6 regression tests (6 in post-edit-format + 4 in post-tool-review-state) + stub jq `--argjson` support patch |
| Acceptance | Done | Fresh state with override=15 → `iteration_history.max_rounds=15` verified |
