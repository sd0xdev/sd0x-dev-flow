# Fix watch-ci fork + Monitor streaming incompatibility

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Follow-up fix for regression introduced by `2026-04-10-watch-ci-monitor-tool-migration.md`.
> **Created**: 2026-04-13
> **Status**: In Progress
> **Note**: 8/9 AC verified by code/test evidence; AC #5 — live CI verdict delivery — remains unchecked and requires user execution post-merge to close
> **Priority**: P1
> **Tech Spec**: Pending (implement directly from research findings; create if scope expands)
> **Parent request**: [`2026-04-10-watch-ci-monitor-tool-migration.md`](./2026-04-10-watch-ci-monitor-tool-migration.md)

## Background

A user reported that `/push-ci` → `/watch-ci` claims "CI monitor launched in streaming mode" but never delivers a completion verdict, even though the CI run has already finished successfully (verified via manual `gh run list`).

**Root cause** (Codex blind verdict: ACTIONABLE @ 0.89 confidence):

| Fact | Source |
|------|--------|
| `skills/watch-ci/SKILL.md:5` **declared** `context: fork` at the time of regression | Unchanged since `c5baedd` until the 2026-04-13 fix |
| `07ec604` (Monitor migration) set Monitor streaming as default mode | Same commit did **not** touch the `context:` field |
| `context: fork` runs skill in an isolated sub-agent; parent receives summary when fork returns | Claude Code Skills docs |
| Monitor tool streaming notifications are bound to the session/context that started them | Claude Code Tools reference |
| Once the forked context returns, the Monitor pipeline is no longer guaranteed to deliver events to the parent | Inference from docs above |

The same SKILL.md file already carried a warning at lines 92/110: "background notifications **in forked context** are unreliable." The migration moved from `run_in_background` to Monitor assuming the limitation was tool-scoped, when it was actually context-scoped. The warning and the new default contradict each other.

Prior evidence this is a known failure mode: commit `aa74c3a` explicitly switched the default away from async-in-fork after hitting the same symptom with `run_in_background`.

**Selected approach**: **A** (remove `context: fork` from watch-ci). Confirmed by user on 2026-04-13.

## Requirements

Restore reliable CI verdict delivery by removing the context/Monitor mismatch. Pick one of the approaches below and implement it end-to-end.

### Approach A (recommended) — Remove `context: fork` from watch-ci

- `skills/watch-ci/SKILL.md`: remove `context: fork` from frontmatter
- Monitor runs in the main conversation context; streaming notifications flow back to the user session naturally
- Trade-off: watch-ci consumes parent context tokens during monitoring. Expected bounds: ≤ 3 runs watched in parallel (typical is 1-2; upper bound enforced by existing timeout), `gh run watch` stdout is line-based status updates (< 1 KB per event, < 50 events per typical run → hard envelope < 50 KB per run), typical observed delta ~5 KB per invocation on a single-run success path

### Approach B (fallback) — Keep fork, revert default to `--blocking`

- `skills/watch-ci/SKILL.md`: keep `context: fork`, change Step 3b default back to foreground (`gh run watch` inline)
- Remove `Monitor` from `allowed-tools` (or retain but document that streaming notifications are unsupported from a forked skill; avoid any "non-forked context" hand-waving since watch-ci always runs forked under this approach)
- Trade-off: Claude is blocked while CI runs; loses the v2.1.98 Monitor benefit for the common path

### Approach C (do nothing structural) — Honest wording only

- Keep fork + Monitor default, but remove the promise of auto-verdict; state "launch-only, verify manually via `gh run view`"
- **Not recommended** — UX regression; effectively reverts the whole migration

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `skills/watch-ci/SKILL.md` context/mode fix; `skills/push-ci/SKILL.md` Phase 3 wording sync; verification that `/push-ci` → `/watch-ci` delivers verdict on a real CI run |
| In | Remove the self-contradictory "forked context unreliable" warning (or rewrite to match the new behavior) |
| In | Add lint/guardrail preventing re-introduction (optional — see AC 6) |
| Out | Rewriting the entire watch-ci workflow; changing `gh run watch` CLI usage; touching other skills that use `context: fork` |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/watch-ci/SKILL.md` | Modify | Remove `context: fork` (Approach A) OR revert default to `--blocking` (Approach B). Remove contradictory warnings. |
| `skills/push-ci/SKILL.md` | Modify | Sync Phase 3 wording so it does not promise streaming verdicts unreachable under the chosen approach |
| `docs/features/watch-ci-monitor-migration/requests/2026-04-10-watch-ci-monitor-tool-migration.md` | Modify | Append regression note + link to this follow-up request |
| `scripts/lint/skill-frontmatter.*` (optional, create if absent) | Create/Modify | Forbid `context: fork` combined with `Monitor` in `allowed-tools` + "non-blocking default" claim in body |

## Acceptance Criteria

> Granularity note: the 6 non-gate items below count toward the ≤8 target; the 3 quality-gate items (`/codex-review-fast`, `/codex-review-doc`, `/precommit`) are excluded from the granularity count per `skills/create-request/SKILL.md` Phase 1.5 rules.

- [x] Chosen approach (A or B) is documented in this ticket (update Background/Scope) before implementation
- [x] `skills/watch-ci/SKILL.md` no longer contains the `context: fork` + Monitor-default contradiction (either field removed or default reverted) — `context: fork` removed from frontmatter; verified by `test/skills/watch-ci.test.js` test 1
- [x] `skills/watch-ci/SKILL.md` contradictory "forked context unreliable" warning lines are removed or rewritten to reflect the chosen approach — 2 body warnings + 1 Prohibited Actions line rewritten; verified by `test/skills/watch-ci.test.js` test 3
- [x] `skills/push-ci/SKILL.md` Phase 3 wording matches the chosen approach (no false "receive progress notifications" promise) — verified: after Approach A, the existing wording at line 159-162 is accurate (no edit required); confirmed by `grep forked skills/push-ci/SKILL.md` returning zero matches
- [ ] Manual reproduction: `/push-ci` on a branch that triggers a real CI run delivers a pass/fail verdict to the parent session automatically, without manual `gh run view` — **requires live CI run for verification; pending user execution post-merge**
- [x] Regression note appended to `2026-04-10-watch-ci-monitor-tool-migration.md` linking to this ticket — appended as a 3-row `Cause / Symptom / Follow-up` table
- [x] `/codex-review-fast` passes — ✅ Ready (dual reviewer: Codex + pr-review-toolkit:code-reviewer) after 3 P2/Nit sweep rounds; 1 P2 (`hasContextKey` column-0 anchoring) dismissed via `/seek-verdict` blind verdict NON_ACTIONABLE @ 0.90
- [x] `/codex-review-doc` passes — ✅ Mergeable, 5⭐ across all dimensions (2026-04-10 parent ticket + 2026-04-13 follow-up ticket)
- [x] `/precommit` passes — ✅ PASS: lint:fix (714 files, 0 errors), test:ci (1221 pass / 0 fail / 2 skipped), build skipped (no build script)

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | `/issue-analyze` completed 2026-04-13. Codex blind verdict: ACTIONABLE @ 0.89. Root cause identified. |
| Development | Done | Approach A applied 2026-04-13: removed `context: fork`; reworded 3 contradictory warning lines; appended regression note to parent ticket |
| Testing | Done | New file `test/skills/watch-ci.test.js` (4 assertions, semantic YAML-tolerant parsing); `/codex-test-review` ✅ Tests sufficient after 3 P2 sweep rounds |
| Acceptance | In Progress | 8/9 AC verified by code/test evidence; AC #5 (live CI verdict delivery) still unchecked — requires user to run `/push-ci` on a real feature branch post-merge and observe the verdict landing in the parent session |

## References

- Parent request: `./2026-04-10-watch-ci-monitor-tool-migration.md`
- Introducing commit: `07ec604` (feat: Migrate watch-ci to Monitor tool streaming as default mode)
- Prior-art commit documenting forked-context unreliability: `aa74c3a` (fix: Switch watch-ci default to foreground and add quick-check step)
- Claude Code Skills docs: `context:` field semantics (fork creates isolated sub-agent, returns summary on completion)
- Claude Code Tools reference: Monitor tool streaming lifecycle bound to invoking session
- User report (conversation on 2026-04-13): observed on a `feat/*` branch after `/push-ci` — CI run finished with `success` (verified via `gh run list`) but no verdict was delivered back to the session. Reproduction recipe (no private data needed): (1) create a feature branch with a trivial commit that triggers the project CI workflow; (2) run `/push-ci`; (3) observe that the watch-ci step claims "CI monitor launched in streaming mode" then returns without any follow-up notification; (4) run `gh run list --branch <branch>` to confirm the run actually completed.
