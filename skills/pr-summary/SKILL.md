---
name: pr-summary
description: "List open PRs, filter automation PRs, group by ticket ID, format as Markdown. Use when: user asks for PR summary, PR status, or /pr-summary"
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*)
---

# PR Summary

List open PRs, filter automation PRs (dependabot/snyk), group by ticket ID, output formatted summary.

## When NOT to Use

| Scenario | Use Instead |
|----------|-------------|
| Create a new PR | `/create-pr` |
| Review PR code | `/codex-review` |
| View single PR details | `gh pr view <N>` |
| Pre-merge analysis | `/merge-prep` |

## Input

`/pr-summary [--author <user>] [--label <label>]`

| Argument | Description | Default |
|----------|-------------|---------|
| `--author <user>` | Filter by author | All |
| `--label <label>` | Filter by label | All |

## Workflow

### 1. Run Script

```bash
bash skills/pr-summary/scripts/pr-summary.sh [--author <user>] [--label <label>]
```

The script automatically:

| Step | Action |
|------|--------|
| Fetch | `gh pr list --json` to get open PRs (max 200) |
| Filter | Exclude `dependabot/*` and `snyk-*` |
| Group | Group by ticket ID (`{TICKET_PATTERN}` or `[A-Z]+-\d+`) |
| Detect | Identify stacked PRs (base is not main/master/develop) |
| Output | Write formatted text to `/tmp/pr-summary.md` |

### 2. Display Results

Read `/tmp/pr-summary.md` and display to user.

### 3. Provide Copy Instructions

```
Content written to /tmp/pr-summary.md
Copy: cat /tmp/pr-summary.md | pbcopy
```

## Output Format

### Markdown (default)

```markdown
**PROJ-520**

https://github.com/user/repo/pull/123
> fix: Add Redis cache for contract codes

https://github.com/user/repo/pull/124
> fix: Tune server timeouts (stacked on fix/PROJ-520)

**PROJ-123**

https://github.com/user/repo/pull/99
> feat: Add DeFi portfolio tracking
```

### Grouping Rules

| Condition | Strategy |
|-----------|----------|
| Same ticket ID | Same group |
| Stacked PR (base is feature branch) | Same group, annotate `(stacked on <base>)` |
| No ticket / unrelated | Standalone entry |

### Filter Rules

| PR Source | Action |
|-----------|--------|
| `dependabot/*` | Exclude |
| `snyk-*` | Exclude |
| Others | Keep |

## References

| File | Purpose |
|------|---------|
| [pr-summary.sh](scripts/pr-summary.sh) | PR fetch, filter, group, format script |

## Verification

- [ ] Lists all open PRs (excluding dependabot/snyk)
- [ ] PRs grouped by ticket ID
- [ ] Stacked PRs annotated with dependency
- [ ] Output format is valid Markdown
- [ ] `/tmp/pr-summary.md` written
