---
description: Quick second-opinion using Codex MCP (diff only, no tests). Supports review loop with context preservation.
argument-hint: [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-code-review/SKILL.md
@skills/codex-code-review/references/codex-prompt-fast.md

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

Quick code review using Codex MCP (diff only, no lint/build/test).

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                                 |
| ----------------------- | ------------------------------------------- |
| `--focus "<text>"`      | Focus on specific area (e.g. "auth")        |
| `--base <gitref>`       | Compare with specified branch (e.g. origin/main) |
| `--continue <threadId>` | Continue a previous review session          |

### Workflow

```
git diff → Codex review (diff only) → Findings + Gate → Loop if Blocked
```

1. **Collect diff**: `git diff HEAD --no-color | head -2000` (or `git diff <base>..HEAD` if `--base`)
2. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
3. **Output**: Severity-grouped findings + Merge Gate

### Key Rules

- **Codex must independently research** — not rely only on diff
- **Save `threadId`** — for review loop continuation
- **Gate sentinels** — output `✅ Ready` or `⛔ Blocked` for hook parsing

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

```markdown
## Codex Quick Review Report

### Review Scope
- Change stats: <git diff --stat summary>
- Focus area: <focus or "all">

### Findings
#### P0 (Must Fix)
- [file:line] Issue -> Fix recommendation
#### P1 (Should Fix)
- [file:line] Issue -> Fix recommendation
#### P2 (Suggested Improvement)
- [file:line] Issue -> Fix recommendation

### Merge Gate
✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review
To re-review after fixes: `/codex-review-fast --continue <threadId>`
```

## Examples

```bash
/codex-review-fast
/codex-review-fast --focus "authentication"
/codex-review-fast --base origin/main
/codex-review-fast --continue abc123
```
