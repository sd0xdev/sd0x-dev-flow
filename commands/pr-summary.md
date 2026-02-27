---
description: PR status summary — list open PRs, filter bots, group by ticket ID
argument-hint: [--author <user>] [--label <label>]
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*)
---

## Context

- Repo: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo 'unknown'`

## Task

Follow the `pr-summary` skill workflow:

1. Run `skills/pr-summary/scripts/pr-summary.sh` with any provided arguments
2. Display the formatted output to user
3. Provide copy instructions

Arguments:
- `--author <user>`: Filter PRs by author
- `--label <label>`: Filter PRs by label

## Output

Formatted PR list grouped by ticket ID, with stacked PRs annotated.
File written to `/tmp/pr-summary.md` for easy copying.
