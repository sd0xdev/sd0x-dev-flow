---
description: Pre-merge analysis and preparation — conflict detection, impact analysis, suggested commands (analysis-only, no auto-merge)
argument-hint: <source-branch> [--target <branch>]
allowed-tools: Bash(git:*), Read, Grep, Glob
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Status: !`git status --porcelain | head -5`

## Task

Follow the `merge-prep` skill workflow:

1. **Validate**: Source branch exists, target exists, working tree clean
2. **Analyze**: Run `skills/merge-prep/scripts/pre-merge-check.sh <source> [target]`
3. **Report**: Display pre-merge analysis (commits, files, conflicts)
4. **Conflicts**: If detected, analyze patterns and suggest resolution strategies
5. **Commands**: Output merge commands for manual execution

Arguments:
- `<source-branch>`: Branch to merge (required)
- `--target <branch>`: Target branch (default: `{TARGET_BRANCH}` or `main`)

## Output

Pre-merge analysis report with conflict details and copy-pasteable merge commands.
**v1 is analysis-only** — commands are output, never auto-executed.
