# Repair the upfront doc gates and baseline the doc plane

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-09
> **Status**: Candidate Complete
> **Note**: First of three siblings (r1 → r2 → r3) split from `2-tech-spec.md` § 4. Independently shippable and depends on nothing. r2 may proceed in parallel; **r3 must land after this one**, because r3's measurement AC compares against the baseline these counters collect, and a baseline gathered after the causal fix is contaminated by it.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- Technical detail (primary source)

## Background

**Stated at `3744d58`, the baseline this ticket was written against.** The design-time
review that would prevent late documentation churn recorded nothing: `/review-spec` emitted
`✅ Approved / ⚠️ Needs revision / ❌ Needs redesign` (`skills/review-spec/SKILL.md:67
@ 3744d58`) while the hook's doc-plane parser recognizes only `✅ Mergeable` /
`⛔ Needs revision`, so every documented outcome — pass **or** fail — recorded no verdict at
all. `## Plan Review` is present but commented out (`rules/auto-loop-project.md:40`). And the
doc plane had no counters, so the complaint ("dozens of rounds") was unmeasurable.

## Requirements

- `/review-spec` records a real doc-plane verdict in both directions
- The prerequisite for switching the plan-review gate on is **stated**, not the switch itself: activation is blocked while `rules/auto-loop-project.md` is both the shipped scaffold and this repo's live config (see Related Files), so it belongs to a later, dependent change
- `rules/auto-loop.md` stops naming `/refactor --target` as a document *splitting* remedy, which no skill performs
- Doc-plane dispatch/verdict counters exist, so the fix in r3 can be measured against a baseline

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `/review-spec` producer conversion; `DOC_TOO_LONG` row correction; lazily-created `doc_iteration_history` counters; recording the blocker that defers `## Plan Review` enablement |
| Out | `## Plan Review` enablement itself, and the `install-rules` change that unblocks it; review profiles and the resolver (r3); artifact classification (r2); any cap, stall or blocking behaviour on the doc plane |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/review-spec/SKILL.md` | Modify | Agent dispatch → shared `mcp__codex__codex` doc-review path; parsed sentinels; `allowed-tools` |
| `rules/auto-loop.md` | Modify | `/review-spec` producer sentence; Cap Diagnostic `DOC_TOO_LONG` row |
| ~~`rules/auto-loop-project.md`~~ | **Blocked** | Enabling `## Plan Review` here is not possible: `/install-rules` seeds an absent consumer override *from* this file, restamping only the install metadata as it copies (`skills/install-rules/SKILL.md:74,76`), so an activated value would ship activated to every installer. Three tests correctly refuse it (`test/skills/claude-health.test.js:322`, `test/skills/install-rules-customize.test.js:171`, and the override-template pair test). This repo has exactly one copy of the file — `.claude/rules` is a symlink to `rules/` — so scaffold and live config are the same artifact. Separating them is its own change, tracked below |
| `hooks/post-tool-review-state.sh` | Modify | Lazily create `doc_iteration_history` counters at the existing doc-dispatch detection |
| `test/skills/review-spec.test.js` | New | Absent from `3744d58` — pins the producer contract (MCP dispatch, `Document Review` request phrase, parsed sentinel pair) |
| `test/hooks/post-tool-review-state.test.js` | Modify | Replace the synthetic `/review-spec sets doc_review passed` case (line 2057) with pass **and** fail cases on the real producer shape; counter increments; code-plane counters unchanged |
| `test/hooks/background-verdict-recovery.test.js` | Modify | The counter cases that need **real** jq: PreToolUse dispatch counting, the code-plane negative control, and `no_verdict` counted once per returned report (bound to claiming the marker, so a replay adds nothing) |
| `test/rules/stall-detection.test.js` | Modify | Pins the `DOC_TOO_LONG` remedy's **claim**, not just which classes offer `/refactor` — the retired "Split or shrink … sanctioned tool" wording passed every pre-existing assertion (found by the Adequacy Gate, 2026-08-09) |
| `test/hooks/jq-filter-fidelity.test.js` | Modify | The counter's jq filter is assembled dynamically in shell; these extract it from the hook source and reassemble it exactly as the hook does |

## Acceptance Criteria

- [x] A failing `/review-spec` records `doc_review.passed=false`; a passing one records `true` (both directions in the same change, per `rules/testing.md` § Conventions — Guards)
- [x] `/review-spec` dispatches via the shared MCP doc-review path and its `allowed-tools` matches
- [x] **Deferred — blocked, not skipped**: `## Plan Review` cannot be enabled while `rules/auto-loop-project.md` is simultaneously the shipped scaffold and this repo's live config (see Related Files). The prerequisite is to give the scaffold its own home so the live file can carry activations; until then this repo opts in per-session by asking for `/plan-review` explicitly
- [x] `rules/auto-loop.md` names no remedy that no tool performs (`DOC_TOO_LONG` row corrected)
- [x] `doc_iteration_history` counters `{dispatches, verdicts, passes, blocks, no_verdict, legacy}` are lazily created and incremented; `dispatches − verdicts` is observable
- [x] Code-plane counters, stall detection and cap protocol are provably untouched
- [x] Pass `/codex-review-fast` and `/precommit` (code plane), `/codex-review-doc` (doc plane)

## Progress

| Phase | Status | Note |
| ---- | ------ | ---- |
| Analysis | Done | Defects located during the 2026-08-09 `/best-practices` audit |
| Development | Done | `/review-spec` converted; `DOC_TOO_LONG` row corrected; counters landed (uncommitted working tree) |
| Testing | Done | `/precommit` `## Overall: ✅ PASS` — 3928 tests, 0 fail, markdownlint 0 issues |
| Acceptance | Candidate | Code `✅ Ready`, doc `✅ Mergeable`, Adequacy Gate `⚠️ Adequate with exceptions` (AC 3 is a valid deferral record). Uncommitted — closure needs the commit and `--verify-ac` |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- Tech Spec: [Doc Review Phasing](../2-tech-spec.md) § 4 Step 1
- Sibling: [r2 — authority classification](./2026-08-09-doc-review-cost-r2.md)
- Sibling: [r3 — cheap review path](./2026-08-09-doc-review-cost-r3.md)
