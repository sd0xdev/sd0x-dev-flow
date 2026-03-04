---
description: Load GitHub PR review comments into AI session — summarize, plan, fix, writeback.
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*), Bash(jq:*), Read, Grep, Glob, AskUserQuestion
argument-hint: "[PR#|URL] [--mode summary|plan|fix] [--all] [--writeback] [--budget <N>]"
---

@skills/load-pr-review/SKILL.md

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(detached)"`
- Repo: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "(unknown)"`
- PR: !`gh pr view --json number,title,state --jq '"#\(.number) \(.title) [\(.state)]"' 2>/dev/null || echo "(no PR on this branch)"`

## Task

Load the PR review comments per SKILL.md workflow. Use context block data for PR auto-detection.

### Arguments

| Arg | Description |
|-----|-------------|
| `<PR#\|URL>` | Target PR (default: current branch PR) |
| `--mode summary\|plan\|fix` | Interaction mode (default: summary) |
| `--all` | Include resolved + outdated threads |
| `--writeback` | Enable reply/resolve writeback |
| `--budget <N>` | Max loaded comments (default: 30) |

### Workflow

1. **Resolve PR** — from args or context block data
2. **Fetch** — run script `fetch` subcommand
3. **Present** — based on `--mode`
4. **Fix** (if mode=fix) — apply changes per thread, trigger auto-loop
5. **Writeback** (if `--writeback`) — dry-run plan → AskUserQuestion → execute

## Examples

```bash
/load-pr-review
/load-pr-review 42 --mode plan
/load-pr-review https://github.com/owner/repo/pull/42 --mode fix
/load-pr-review --all --budget 50
/load-pr-review --mode fix --writeback
```
