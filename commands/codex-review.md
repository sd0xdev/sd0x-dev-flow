---
description: Full second-opinion using Codex MCP (with lint:fix + build). Supports review loop with context preservation.
argument-hint: [--no-tests] [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-code-review/SKILL.md
@skills/codex-code-review/references/codex-prompt-full.md

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

Full code review using Codex MCP with local checks (lint:fix + build) before review.

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                                 |
| ----------------------- | ------------------------------------------- |
| `--no-tests`            | Skip lint:fix and build steps               |
| `--focus "<text>"`      | Focus on specific area (e.g. "auth")        |
| `--base <gitref>`       | Compare with specified branch (e.g. origin/main) |
| `--continue <threadId>` | Continue a previous review session          |

### Workflow

```
lint:fix → build → git diff → Codex review (full) → Findings + Gate → Loop if Blocked
```

1. **Local checks** (unless `--no-tests`): `{LINT_FIX_COMMAND}` then `{BUILD_COMMAND}` — record as `LOCAL_CHECKS`
2. **Collect diff**: `git diff HEAD --no-color | head -2000`
3. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
4. **Output**: Local check results + severity-grouped findings + test recommendations + Merge Gate

### Key Rules

- **Run local checks first** — lint:fix + build catch basic issues before Codex review
- **Codex must independently research** — not rely only on diff
- **Save `threadId`** — for review loop continuation
- **Includes test recommendations** — Codex suggests missing test cases

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

```markdown
## Codex Full Review Report

### Local Checks
- lint:fix: ✅ Pass / ❌ Fail
- build: ✅ Pass / ❌ Fail

### Review Scope
- Change stats: <git diff --stat summary>
- Focus area: <focus or "all">

### Findings
#### P0 (Must Fix)
- [file:line] Issue -> Fix recommendation
#### P1 (Should Fix)
- [file:line] Issue -> Fix recommendation

### Tests Recommendation
- Suggested new test cases

### Merge Gate
✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review
To re-review after fixes: `/codex-review --continue <threadId>`
```

## Examples

```bash
/codex-review
/codex-review --no-tests
/codex-review --focus "database queries"
/codex-review --base origin/main
/codex-review --continue abc123
```
