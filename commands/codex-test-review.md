---
description: Review test case sufficiency using Codex MCP, suggest additional edge cases. Supports review loop with context preservation.
argument-hint: [<file-or-dir|description>] [--type unit|integration|e2e] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/test-review/SKILL.md
@skills/test-review/references/codex-prompt-test-review.md

## Context

- Git status: !`git status -sb`
- Git diff (test files): !`git diff --name-only HEAD 2>/dev/null | grep -E '\.test\.ts$' | head -5`

## Task

Review test coverage sufficiency using Codex MCP (5 review dimensions + coverage assessment).

### Arguments

```
$ARGUMENTS
```

### Smart Input

| Input               | Example                    | Behavior                               |
| ------------------- | -------------------------- | -------------------------------------- |
| File path           | `test/unit/xxx.test.ts`    | Directly review that file              |
| Directory           | `test/unit/service/`       | Review all tests in directory          |
| Description         | `"check uncommitted tests"`| Auto-find files changed in git diff    |
| Module name         | `"portfolio service"`      | Search related test files              |
| No parameter        | -                          | Auto-detect from git diff              |
| `--continue`        | `--continue <threadId>`    | Continue previous review session       |

### Workflow

```
Smart detect → Read test + source → Codex review (5 dimensions) → Coverage assessment + Gate → Loop
```

1. **Detect target**: Smart input resolution (file/dir/description/auto)
2. **Read content**: Test file + corresponding source file
3. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
4. **Output**: Coverage assessment table + severity-grouped gaps + Gate

### Key Rules

- **Codex must independently research** — read source to find all branches and error paths
- **Save `threadId`** — for review loop continuation
- **5 review dimensions** — Coverage, Boundaries, Errors, Concurrency, Mock quality
- **Gate sentinels** — output `✅ Tests sufficient` or `⛔ Tests need supplementation`

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

````markdown
## Test Coverage Review Report

### Review Scope
- File: <TEST_FILE>
- Type: Unit / Integration / E2E
- Corresponding source: <SOURCE_FILE>

### Coverage Assessment
| Dimension           | Rating     | Notes |
| ------------------- | ---------- | ----- |
| Happy path          | ⭐⭐⭐⭐☆ | ...   |
| Error handling      | ⭐⭐⭐☆☆  | ...   |
| Boundary conditions | ⭐⭐☆☆☆   | ...   |
| Mock reasonableness | ⭐⭐⭐⭐☆ | ...   |

### 🔴 Must Add (P0/P1)
1. **Missing**: <description> → Suggested test code

### Gate
✅ Tests sufficient / ⛔ Tests need supplementation (N 🔴 items)

### Loop Review
To re-review after additions: `/codex-test-review --continue <threadId>`
````

## Examples

```bash
/codex-test-review test/unit/service/xxx.test.ts
/codex-test-review "portfolio service tests"
/codex-test-review
/codex-test-review --continue abc123
```
