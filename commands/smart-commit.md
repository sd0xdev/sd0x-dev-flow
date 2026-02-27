---
description: Smart batch commit — group changes by cohesion, generate commit messages matching project style, output git commands
argument-hint: [--scope <path>] [--type <type>] [--ai-co-author]
allowed-tools: Bash(git:*), Read, Grep, Glob
---

## Context

- Status: !`git status --short`
- Recent style: !`git log --oneline -10`
- Branch: !`git rev-parse --abbrev-ref HEAD`

## Task

Follow the `smart-commit` skill workflow:

1. **Detect mode**: Read CLAUDE.md / git-workflow rules → manual or auto
2. **Pre-flight**: Verify `/precommit` passed for code changes
3. **Collect**: `git status`, `git diff --stat`, exclude sensitive files
4. **Group**: High-cohesion grouping (staged first, then by feature/type)
5. **Generate**: Commit messages matching project style + git commands
6. **Verify**: `git status` after user executes

Arguments:
- `--scope <path>`: Only include changes under this path
- `--type <type>`: Force all commits to use this type (feat/fix/docs/etc.)
- `--ai-co-author`: Add `Co-Authored-By: Claude <noreply@anthropic.com>` trailer to commit messages (off by default)

## Output

For each commit group, output a code block with copy-pasteable git commands.
Respect `rules/git-workflow.md` — if Claude is forbidden from git commit, output commands only.
