---
description: Push to remote (with user approval) and monitor CI status.
argument-hint: [--timeout <min>] [--force-with-lease] [--set-upstream]
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*), Read, Grep, Glob, AskUserQuestion
---

**Must read and follow the skill below before executing this command:**

@skills/push-ci/SKILL.md

## Context

- Branch: !`git rev-parse --abbrev-ref HEAD`
- Remote: !`gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || echo "no remote"`
- Ahead: !`bash -c 'b=$(git rev-parse --abbrev-ref HEAD) && git rev-list --count "origin/$b..HEAD" 2>/dev/null || echo "new branch"'`
- HEAD SHA: !`git rev-parse --short HEAD`
- Status: !`git status --short | head -5`

## Task

Execute the push-ci workflow: preflight → user approval → push → CI monitor → verdict.

### Arguments

Parse from `$ARGUMENTS`:

| Argument | Description | Default |
|----------|-------------|---------|
| `--timeout <min>` | CI watch timeout in minutes | 10 |
| `--force-with-lease` | Use `--force-with-lease` flag | off |
| `--set-upstream` | Add `-u` flag for new branches | auto-detect |

```
$ARGUMENTS
```

### Key Rules

- **User approval is mandatory** — use AskUserQuestion before push
- **This is the ONLY skill authorized to execute `git push`**
- **Never push to protected branches** (main, master, develop, release/*)
- **Never use `--force`** (only `--force-with-lease` when explicitly requested)
- **Match CI run by HEAD SHA**, not "latest"

## Examples

```bash
/push-ci
/push-ci --timeout 15
/push-ci --force-with-lease
```
