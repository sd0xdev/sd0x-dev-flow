---
name: git-worktree
description: "Git worktree management. Work on multiple branches simultaneously without switching or re-cloning. Use when: user mentions worktree, parallel development, simultaneous branches, or /git-worktree"
allowed-tools: Read, Grep, Glob, Bash(git:*)
---

# Git Worktree

## Trigger

- Keywords: worktree, parallel development, simultaneous branches, work directory, checkout another branch

## When NOT to Use

- Only need to switch branches (use `git checkout`)
- Need a fully independent repo copy (use `git clone`)
- Temporarily view a single file (use `git show branch:file`)

## Core Concept

```
┌─────────────────────────────────────────────────┐
│              .git (shared object database)        │
│         commits / blobs / trees / refs           │
├────────────┬────────────┬────────────────────────┤
│ repo/      │ ../wt-A/   │ ../wt-B/               │
│ (main)     │ (feat/A)   │ (feat/B)               │
│ HEAD       │ HEAD       │ HEAD                   │
│ index      │ index      │ index                  │
│ files      │ files      │ files                  │
└────────────┴────────────┴────────────────────────┘
```

| Property | Description |
|----------|-------------|
| Shared objects | All worktrees share the same commit/blob/tree store |
| Independent HEAD | Each worktree has its own HEAD and index |
| Branch exclusive | Same branch cannot be checked out in two worktrees |
| Shared commits | Commits from any worktree appear in the same history |

## Naming Convention

```
~/Project/
├── my-repo/                    # Main repo (main or dev branch)
├── wt-{repo}-hotfix/           # worktree: hotfix
├── wt-{repo}-feat-gas/         # worktree: feature/gas
└── wt-{repo}-review-pr-123/    # worktree: PR review
```

**Format**: `wt-{repo-shortname}-{purpose}`, placed in the same parent directory as the repo.

## Workflow

### Create Worktree

```bash
# 1. Checkout existing branch
git worktree add ../wt-{repo}-hotfix fix/hotfix-123

# 2. Create new branch and checkout (from main)
git worktree add -b feat/new-feature ../wt-{repo}-new-feat main

# 3. Detach mode (temporarily view tag/commit)
git worktree add --detach ../wt-{repo}-review v1.2.3
```

### Daily Operations

```bash
# List all worktrees
git worktree list

# Enter worktree and work normally
cd ../wt-{repo}-hotfix
git status
git commit -am "fix: ..."
git push -u origin fix/hotfix-123

# Return to main repo
cd ../my-repo
```

### Cleanup Worktree

```bash
# Recommended: use git command to remove
git worktree remove ../wt-{repo}-hotfix

# If directory was manually deleted
git worktree prune

# Lock to prevent accidental deletion (long-lived worktrees)
git worktree lock ../wt-{repo}-hotfix
git worktree unlock ../wt-{repo}-hotfix

# Move worktree path
git worktree move ../wt-old ../wt-new
```

## Common Scenarios

| Scenario | Action |
|----------|--------|
| Develop two features simultaneously | Create a worktree for each, checkout respective branches |
| Hotfix without affecting current work | `git worktree add ../wt-hotfix fix/xxx` |
| Review PR without switching branch | `git worktree add ../wt-review-123 origin/feat/xxx` |
| Run tests on old version | `git worktree add --detach ../wt-test v1.0.0` |
| Compare two versions | Open two worktrees, each checking out different tags |

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `branch is already checked out` | Branch is in use by another worktree | Create new branch or use `--detach` |
| `is not a valid directory` | Worktree directory was manually deleted | `git worktree prune` |
| `.claude` config not in worktree | Worktree only has working files | `.claude/` is in main repo, shared via git |

## Verification

- [ ] `git worktree list` shows correct worktrees
- [ ] Worktree directory can `git status` normally
- [ ] After completion, clean up with `git worktree remove`

## References

- `references/commands.md` — Command quick reference

## Examples

### Parallel Development + Hotfix

```
Input: I need to continue developing gas-account while fixing a hotfix
Action:
  1. git worktree add -b fix/hotfix-456 ../wt-{repo}-hotfix main
  2. cd ../wt-{repo}-hotfix → fix → commit → push
  3. git worktree remove ../wt-{repo}-hotfix
```

### Review PR

```
Input: Checkout PR #123 branch to review
Action:
  1. git fetch origin pull/123/head:pr-123
  2. git worktree add ../wt-{repo}-pr-123 pr-123
  3. cd ../wt-{repo}-pr-123 → review/test
  4. git worktree remove ../wt-{repo}-pr-123
```

### Run Tests on Old Version

```
Input: Run tests on v1.0.0
Action:
  1. git worktree add --detach ../wt-{repo}-test v1.0.0
  2. cd ../wt-{repo}-test → run tests
  3. git worktree remove ../wt-{repo}-test
```
