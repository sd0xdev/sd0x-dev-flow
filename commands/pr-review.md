---
description: PR 自我檢視：review changes、產出 checklist、更新 rules
allowed-tools: Bash(git:*), Read, Grep, Glob, Edit
---

## Context

- Status: !`git status -sb`
- Diff: !`git diff --stat origin/main...HEAD || git diff --stat HEAD~1`
- Commits: !`git log --oneline -10`

## Task

1. Review：correctness, security, perf
2. PR checklist：tests, rollout, compat
3. 發現新規則 → 更新 CLAUDE.md 或 .claude/rules/

## Output

```markdown
## Review Notes

- <findings>

## PR Checklist

- [ ] Tests pass
- [ ] No breaking changes
- [ ] Docs updated

## Rules Update（如有）

- <proposed patch>
```
