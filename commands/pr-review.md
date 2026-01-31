---
description: PR self-review — review changes, produce checklist, update rules
allowed-tools: Bash(git:*), Read, Grep, Glob, Edit
---

## Context

- Status: !`git status -sb`
- Diff: !`git diff --stat origin/main...HEAD || git diff --stat HEAD~1`
- Commits: !`git log --oneline -10`

## Task

1. Review: correctness, security, perf
2. PR checklist: tests, rollout, compat
3. Discover new rules -> update CLAUDE.md or .claude/rules/

## Output

```markdown
## Review Notes

- <findings>

## PR Checklist

- [ ] Tests pass
- [ ] No breaking changes
- [ ] Docs updated

## Rules Update (if any)

- <proposed patch>
```
