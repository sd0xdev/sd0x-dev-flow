---
description: Load GitHub PR review comments into AI session — summarize, plan, fix, writeback.
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*), Bash(jq:*), Read, Grep, Glob, Edit, Write, AskUserQuestion
argument-hint: "[PR#|URL] [--mode summary|plan|fix] [--all] [--writeback] [--budget <N>]"
---

<!-- Bash(bash:*) required for context check wrapping — see CLAUDE.md Footguns -->

@skills/load-pr-review/SKILL.md

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)"`
- Repo: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "(unknown)"`
- PR: !`bash -c 'set -o pipefail; gh pr view --json number,title,state 2>/dev/null | jq -r "\"#\\(.number) \\(.title) [\\(.state)]\"" || echo "(no PR on this branch)"'`

## Task

Load the PR review comments per SKILL.md workflow. Use context block data for PR auto-detection.

### Arguments

| Arg | Description |
|-----|-------------|
| `<PR#\|URL>` | Target PR (default: current branch PR) |
| `--mode summary\|plan\|fix` | Interaction mode (default: summary) |
| `--all` | Include resolved + outdated threads |
| `--writeback` | Enable reply/resolve writeback |
| `--budget <N>` | Max loaded threads (default: 30, 200 with --all; GraphQL ceiling: 100) |

### Workflow

1. **Resolve PR** — from args or context block data
2. **Fetch** — run script `fetch` subcommand
3. **Present** — based on `--mode`
4. **Fix** (if mode=fix) — apply changes per thread, then auto-loop per @rules/auto-loop.md
5. **Writeback** (if `--writeback`) — dry-run plan → AskUserQuestion → execute

## Examples

```bash
/load-pr-review
/load-pr-review 42 --mode plan
/load-pr-review https://github.com/owner/repo/pull/42 --mode fix
/load-pr-review --all --budget 50
/load-pr-review --mode fix --writeback
```
