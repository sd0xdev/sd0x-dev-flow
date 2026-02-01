---
description: Fully automated review of an entire feature branch using Codex MCP
argument-hint: [base-branch] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-code-review/SKILL.md
@skills/codex-code-review/references/codex-prompt-branch.md

## Context

- Current branch: !`git branch --show-current`
- Commits ahead of main: !`git rev-list --count main..HEAD 2>/dev/null || echo 0`
- Changed files: !`git diff --name-only main..HEAD 2>/dev/null | head -10`

## Task

Review an entire feature branch using Codex MCP.

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                      |
| ----------------------- | -------------------------------- |
| `[base-branch]`         | Base branch (default: main)      |
| `--continue <threadId>` | Continue a previous review session |

### Workflow

```
Collect branch info → Codex review (6 dimensions) → Rating table + Findings + Gate → Loop if Blocked
```

1. **Collect branch info**:
   - `git diff ${BASE_BRANCH}..HEAD --no-color | head -3000`
   - `git log --oneline ${BASE_BRANCH}..HEAD`
   - `git diff --name-only ${BASE_BRANCH}..HEAD`
2. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
3. **Output**: Branch overview + rating table (6 dimensions) + severity-grouped findings + Merge Gate

### Key Rules

- **Reviews entire branch** — all commits from base, not just latest diff
- **6 review dimensions** — Feature Completeness, Code Quality, Security, Performance, Test Coverage, Documentation
- **Rating table** — star ratings per dimension
- **Codex must independently research** — read changed files, check tests, trace dependencies
- **Save `threadId`** — for review loop continuation

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

```markdown
## Branch Review Report

### Branch Info
- Current branch: <branch>
- Base branch: <base>
- Commits: <count>

### Branch Overview
<one-sentence description>

### Review Summary
| Dimension            | Rating     | Notes |
| -------------------- | ---------- | ----- |
| Feature Completeness | ⭐⭐⭐⭐☆ | ...   |
| Code Quality         | ⭐⭐⭐⭐☆ | ...   |
| Security             | ⭐⭐⭐⭐⭐ | ...   |
| Performance          | ⭐⭐⭐⭐☆ | ...   |
| Test Coverage        | ⭐⭐⭐☆☆  | ...   |

### Findings
#### P0 (Must Fix)
- [file:line] Issue -> Fix recommendation
#### P1 (Should Fix)
- [file:line] Issue -> Fix recommendation

### Merge Gate
✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review
To re-review after fixes: `/codex-review-branch --continue <threadId>`
```

## Examples

```bash
/codex-review-branch
/codex-review-branch origin/develop
/codex-review-branch --continue abc123
```
