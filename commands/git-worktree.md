---
description: Manage git worktrees — create, list, remove, parallel branch development
argument-hint: [add|list|remove|prune] [--branch <name>] [--base <ref>]
allowed-tools: Bash(git:*), Read, Grep, Glob
---

## Context

- Worktrees: !`git worktree list 2>/dev/null || echo 'not in a git repo'`
- Branch: !`git rev-parse --abbrev-ref HEAD`

## Task

Follow the `git-worktree` skill workflow.

### Sub-commands

| Sub-command | Action |
|-------------|--------|
| `add` | Create new worktree (ask for branch + purpose) |
| `list` | Show all worktrees with status |
| `remove` | Remove a worktree (with confirmation) |
| `prune` | Clean up stale worktree records |
| (none) | Show current worktrees and suggest actions |

### Naming

Use `wt-{repo-shortname}-{purpose}` format, placed in repo's parent directory.

## Output

For `add`: the exact `git worktree add` command and next steps.
For `list`: formatted table of worktrees.
For `remove`: confirmation prompt then `git worktree remove` command.
