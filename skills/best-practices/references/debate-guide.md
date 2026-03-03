# Best Practices Audit — Debate Guide (Phase 3)

## Canonical Mechanism

Invoke `/codex-brainstorm` command. The Skill tool is a Claude Code built-in (always available, no `allowed-tools` declaration needed). Do NOT use raw `mcp__codex__codex` calls as a substitute — `/codex-brainstorm` handles MCP orchestration internally.

> The `mcp__codex__codex` / `mcp__codex__codex-reply` in `allowed-tools` exist because `/codex-brainstorm` uses them internally during the debate flow.

## Debate Topic Template

```
Topic: Does the project's [technology] implementation align with industry best practices?
```

## Constraints to Pass

Pass ONLY the following — do NOT pass Phase 1-2 conclusions:

| Pass | Do NOT Pass |
|------|-------------|
| Phase 1 source list (URLs + type) | Claude's analysis or opinions |
| Phase 2 concern file locations (file:line) | Conclusions about compliance |
| The topic question | Leading questions ("is X correct?") |

Let Claude and Codex judge independently, ensuring Codex is not biased by Claude's conclusions.

## Completion Criteria

| Condition | Description |
|-----------|-------------|
| Minimum rounds | 3 debate rounds |
| Early exit | Nash equilibrium reached before 3 rounds |
| Max rounds | 5 rounds (from codex-brainstorm default) |

## Expected Artifact

- Debate log with equilibrium status
- `threadId` from the debate session (for Phase 4 reference)

## Gate

Phase 4 is blocked until Phase 3 is complete. The Phase 4 "Debate Conclusion" field cannot be filled without Phase 3 output.
