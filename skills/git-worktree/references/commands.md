# Git Worktree Command Reference

## Basic Operations

| Command | Description | Example |
|---------|-------------|---------|
| `git worktree list` | List all worktrees | - |
| `git worktree add <path> <branch>` | Add worktree with existing branch | `git worktree add ../wt-fix fix/bug` |
| `git worktree add -b <new> <path> <base>` | Add worktree with new branch | `git worktree add -b feat/x ../wt-x main` |
| `git worktree add --detach <path> <ref>` | Detach mode (no branch) | `git worktree add --detach ../wt-test v1.0` |
| `git worktree remove <path>` | Remove worktree | `git worktree remove ../wt-fix` |
| `git worktree prune` | Clean up deleted worktree records | - |

## Management

| Command | Description |
|---------|-------------|
| `git worktree lock <path>` | Lock worktree to prevent deletion |
| `git worktree unlock <path>` | Unlock worktree |
| `git worktree move <old> <new>` | Move worktree path |
| `git worktree list --porcelain` | Machine-readable output |

## PR Review Flow

```bash
# 1. Fetch PR branch
git fetch origin pull/<number>/head:pr-<number>

# 2. Create worktree
git worktree add ../wt-pr-<number> pr-<number>

# 3. Enter and work
cd ../wt-pr-<number>

# 4. Cleanup
cd -
git worktree remove ../wt-pr-<number>
git branch -D pr-<number>
```

## Hotfix Flow

```bash
# 1. Create hotfix branch from main
git worktree add -b fix/hotfix-<id> ../wt-hotfix main

# 2. Fix
cd ../wt-hotfix
# edit → test → commit → push

# 3. Cleanup
cd -
git worktree remove ../wt-hotfix
```

## Parallel Development Flow

```bash
# Main repo continues feature A
# Open worktree for feature B
git worktree add -b feat/B ../wt-feat-B main

# Both sides develop independently, commits share history
# Cleanup when done
git worktree remove ../wt-feat-B
```

## Important Notes

| Rule | Description |
|------|-------------|
| Branch exclusive | Same branch cannot be checked out in two worktrees |
| Cleanup method | Prefer `git worktree remove`, avoid just `rm -rf` |
| Path convention | Place in repo's parent directory, name `wt-{repo}-{purpose}` |
| .claude sharing | `.claude/` is in main repo root, shared across worktrees |
| node_modules | Not shared across worktrees, run `install` separately |
