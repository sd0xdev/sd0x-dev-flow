---
description: Smart partial rebase — analyze squash-merged commits, generate precise rebase --onto command
argument-hint: [--base <branch-or-commit>] [--target <ref>]
allowed-tools: Bash(git:*), Bash(bash:*), Read, Grep, Glob
---

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Status: !`git status --porcelain | head -5`

## Task

Follow the `smart-rebase` skill workflow:

1. **Analyze**: Run `skills/smart-rebase/scripts/smart-rebase-analyze.sh` with provided options
2. **Identify**: Determine cut point (auto-detect or from `--base`)
3. **Display**: Show rebase plan with keep/drop commits
4. **Confirm**: Wait for user confirmation
5. **Execute**: Output `git rebase --onto` command (or execute if user authorizes)
6. **Verify**: Confirm history after rebase

Arguments:
- `--base <ref>`: Cut point — the last commit of the already-merged base branch
- `--target <ref>`: Rebase target (default: `origin/main`)

## Output

Rebase plan table with keep/drop commits.
- **With `--base`**: includes copy-pasteable `git rebase --onto` command
- **Auto-detect (no `--base`)**: analysis report with cherry status per commit; may require `--base` follow-up for squash-merge scenarios

Default is command-output only — Claude does not execute `git rebase` unless user explicitly authorizes.
