# Context Management Rule

**Measure → decide → act. Never guess.**

## Prohibited Behaviors

❌ Claiming "context too long" or "running low on context" without first running `/context` — if `/context` is unavailable or errors, proceed with work; unavailability is not evidence of exhaustion
❌ Stopping or deferring work at ≤ 70% used
❌ Using context state to skip an auto-loop obligation (review / precommit)
❌ Proposing a new session before trying `/compact` and retrying

## Auto-Compact Mode

If the user has auto-compact on, the harness owns compaction. Skip all of the monitoring below, never mention context capacity, never propose a new session or `/compact` — just do the task. Detect it from `[auto-compact]` markers or a conversation that has already been auto-compacted.

## Three-Tier Policy (manual compact mode only)

| Zone | Condition | Action |
|------|-----------|--------|
| Normal | used < 80% | Continue. Run `/context` at major milestones |
| Compact | 80% ≤ used < 92% | `/compact` at the next major boundary, then continue |
| Critical | used ≥ 92% | Finish pending auto-loop obligations → `/compact` → if still ≥ 92%, propose a new session with handoff |

Milestone checks (precommit pass, review complete, task group done) are **diagnostic** — do not change behaviour on a reading alone. Skip the check if `/context` ran within the last 2 tool calls.

## Compact Preservation

A compact summary must carry forward: the pending task list and current progress, this session's architectural decisions, active review threadIds (for `--continue`), the uncommitted file list, and the current plan file path.

Also carry any active `/orchestrate` run's `baseline_sha256` — the hex digest `run-verify.js snapshot` prints to stderr. It is stored nowhere on disk, so losing it makes the run unresumable, and resume needs both the digest **and** the original baseline bytes at `.claude_workflows/<run-id>/baseline.json`. Preserve the run-id and that path alongside it. (Compaction is the only such loss this rule can prevent — a crash or a cleared conversation drops it just as completely.)

Never put secrets, tokens, or passwords in a compact summary (per @rules/security.md).

## Auto-Loop Precedence

Context state never overrides auto-loop. Even in the Critical zone, attempt the review/precommit obligations before stopping. See @rules/auto-loop.md.
