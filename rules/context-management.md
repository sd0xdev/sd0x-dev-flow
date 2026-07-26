# Context Management Rule

**Measure → decide → act. Never guess.**

## Prohibited Behaviors

❌ Claiming "context too long" or "running low on context" without first running `/context` (if `/context` is unavailable or errors, proceed with work — unavailability is not evidence of exhaustion)
❌ Stopping or deferring work when context used ≤ 70%
❌ Using context state to skip auto-loop obligations (review/precommit)
❌ Proposing new session without first attempting `/compact` + retry

## Auto-Compact Mode

When the user has enabled auto-compact (Claude Code setting), the harness handles compaction automatically. In this mode:

- **Skip all manual context monitoring** — no `/context` checks, no Three-Tier zone tracking
- **Never mention context capacity** — do not warn about context size, propose new sessions, or suggest `/compact`
- **Focus entirely on the task** — context management is the harness's responsibility, not the model's

Detection: if prior messages show `[auto-compact]` markers or the conversation has been auto-compacted, treat auto-compact as enabled.

## Three-Tier Policy (manual compact mode only)

| Zone | Condition | Action |
|------|-----------|--------|
| Normal | used < 80% | Continue. Run `/context` at major milestones |
| Compact | 80% ≤ used < 92% | `/compact` at next major boundary, then continue |
| Critical | used ≥ 92% | Complete pending auto-loop obligations first → `/compact` → if still ≥ 92% → propose new session with handoff |

## Milestone Check

At major milestones (precommit pass, review complete, task group done), run `/context`.
This is diagnostic — do not stop or change behavior based solely on a check.
**Cooldown**: Skip if `/context` was checked within the last 2 tool calls (avoid overhead in dense review loops).

## Compact Preservation

When compacting, ensure summary preserves:
- Pending task list and current progress
- Architectural decisions from this session
- Active review threadIds (for --continue)
- Uncommitted file list
- Current plan file path (if any)
- Any active `/orchestrate` run's `baseline_sha256` (the hex digest `run-verify.js snapshot` printed to stderr) — it is deliberately stored nowhere on disk, so losing it makes the run unresumable. Compaction is the loss this rule can do anything about, not the only one: ending the session, a crash, or clearing the conversation drop it just as completely, and none of those are recoverable by preserving it in a summary. Preserve the run-id and the baseline file path alongside it: resume needs the digest **and** the original baseline bytes (which, unlike the digest, do live on disk at `.claude_workflows/<run-id>/baseline.json`).
- Never include secrets, tokens, or passwords in compact summary (per @rules/security.md)

## Auto-Loop Precedence

Context management cannot override auto-loop:
- Even at Critical zone, must attempt review/precommit before stopping
- See @rules/auto-loop.md for full obligations
