# Codex Re-Review Loop: Plan Review

Used with `mcp__codex__codex-reply` after plan revision (loop exception per `rules/codex-invocation.md`: providing the revised plan is acceptable because Codex already has full project context from the first round — but VERIFY, never CONFIRM).

```typescript
mcp__codex__codex-reply({
  threadId: SAVED_THREAD_ID,  // from the first codex-prompt-plan.md round
  prompt: `The plan has been revised in response to your findings. The full revised plan (redacted) is below. Re-review it as a fresh candidate artifact — do NOT assume the revisions are correct.

## Revised Plan (round ${ROUND})

${REVISED_PLAN_TEXT}

## Verification Tasks

1. For each finding from your previous round: is it actually resolved in the revised plan? Verify against the repository (git/grep/cat) where the finding referenced code facts — do not take the revision's word for it.
2. Did the revisions introduce NEW issues? (new steps with new assumptions, removed steps that were load-bearing, scope drift from the stated goal)
3. Re-apply all five review dimensions (assumptions, completeness, correctness/feasibility, over/under-engineering, risk) to any section that changed.

## Output Format

### Resolution Status

| Previous finding | Status (resolved / partially / unresolved) | Evidence |
|------------------|--------------------------------------------|----------|

### New Findings

#### P0 / P1 / P2 / Nit
- [Section] Issue -> evidence -> fix direction

### Gate

End your reply with the line \`## Plan Review\` followed by exactly ONE verdict line: \`✅ Plan Ready\` if all previous P0/P1 are resolved AND no new ones were introduced, or \`⛔ Plan Blocked\` if P0/P1 remain or were introduced.

⚠️ Sentinel constraints (hard requirement): output exactly one verdict line, never both — ambiguous output containing both markers is treated as blocked. NEVER output the bare strings "✅ Ready", "✅ Mergeable", "⛔ Blocked", or "## Gate:" anywhere in your reply.`,
});
```

## Loop Rules

| Rule | Detail |
|------|--------|
| Same thread | Always `codex-reply` with the saved `threadId` — context preservation across rounds |
| Verify, not confirm | Ask "is it resolved?" + "did fixes introduce new issues?" — never "are my fixes correct?" |
| Redaction every round | `REVISED_PLAN_TEXT` re-passes the Step 2 redaction contract before each send |
| Round budget | Each round increments `plan_review.iteration_history.current_round` (hook-side, via `## Plan Review` sentinel parse); cap = `max_rounds` (default 5) |
| User escape check | Before dispatching each round, check for explicit user skip intent (NFR-5) |
