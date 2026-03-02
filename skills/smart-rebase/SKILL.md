---
name: smart-rebase
description: "Smart partial rebase for squash-merge repositories. Auto-detect which commits to keep/drop when base branch was squash-merged into target. Use when: user says 'rebase', 'partial rebase', 'base already merged', 'smart rebase', or /smart-rebase. Not for: simple git rebase (use git directly), merge conflict resolution (use /merge-prep), branch switching (use git checkout). Output: rebase plan table + copy-pasteable git rebase --onto command."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(bash:*)
---

# Smart Rebase — Partial Rebase for Squash-Merge Repos

Analyze branch history → identify squash-merged commits → generate precise `git rebase --onto` command.

## When NOT to Use

- Simple `git rebase` without squash-merge complexity (use git directly)
- Merge conflict resolution (use `/merge-prep`)
- Branch management or switching (use git commands)
- Cherry-picking specific commits (use `git cherry-pick`)

## Core Problem

In squash-merge repositories, when a feature branch is based on another branch that was already squash-merged:

```
main:    A ─── S (squash merge of B1+B2+B3) ─── ...
              ↑
feature: A ─ B1 ─ B2 ─ B3 ─ F1 ─ F2 ─ F3
              ↑ drop (in S)   ↑ keep (unique)
```

Need: `git rebase --onto main B3 feature` to keep only F1-F3.

## Permissions

Claude **must not** execute `git rebase` unless user explicitly authorizes. Default: output commands for manual execution.

> **Note on `allowed-tools`**: `Bash(bash:*)` is required to run the analysis script. Cannot narrow to specific script paths until [#9354](https://github.com/anthropics/claude-code/issues/9354) is resolved.

## Prerequisites

Before starting, validate:

| Check | Command | Fail action |
|-------|---------|-------------|
| Not on shared branch | `git branch --show-current` must not be `main` or `develop` | Abort with warning |
| Clean working tree | `git status --porcelain` must be empty | Abort: "stash or commit changes first" |
| Not detached HEAD | `git symbolic-ref HEAD` succeeds | Abort: "checkout a branch first" |

## Workflow

```
Step 1: Analyze → run script to detect commits
Step 2: Identify → determine keep/drop boundary (cut point)
Step 3: Display → output rebase plan
Step 4: Confirm → user reviews
Step 5: Execute → output or execute rebase command
Step 6: Verify → confirm history is correct
```

### Step 1: Analyze

```bash
bash skills/smart-rebase/scripts/smart-rebase-analyze.sh [--target origin/main]
```

Auto-detect mode uses `git cherry` to find commits already cherry-picked to target. Squash merges cannot be detected by `git cherry` — proceed to Step 2.

### Step 2: Identify Cut Point

**Case A — User provides base branch or commit**

```bash
# Resolve the common ancestor as cut candidate
git merge-base <base-branch> HEAD
# Or specify the cut point commit directly
bash skills/smart-rebase/scripts/smart-rebase-analyze.sh --base <branch-or-commit>
```

**Case B — Inference needed**

1. Check `target_new` squash merge commit messages
2. Compare with `commits` messages in current branch
3. Identify which commits are covered by the squash merge
4. Confirm cut point and re-run with `--base`

**Case C — `git cherry` detected all**

When `cherry_dropped > 0`, detected commits can be dropped. Verify cut point is contiguous (all drops must precede all keeps).

### Step 3: Display Plan

```markdown
## Rebase Plan

| Item           | Value                                   |
| -------------- | --------------------------------------- |
| Current branch | feat/my-feature                         |
| Target         | origin/main (dd21265c)                  |
| Cut point      | 06a7fae6                                |
| Keep           | 3 commits                               |
| Drop           | 15 commits (already in main via squash) |

### Commits to Keep

1. `57d7898a` feat: Add error classification framework
2. `05c11119` docs: Document classification rules
3. `da987681` fix: Correct classification accuracy

### Commits to Drop (already in main)

1. `f76209f4` docs: Add RPC optimization design
   ...
```

### Step 4: User Confirmation

Display plan and wait for user confirmation before proceeding.

### Step 5: Execute

```bash
# Fetch only if target is a remote-tracking ref
git fetch origin <target-branch>   # skip if target is local
git rebase --onto <target> <cut-point> <branch>
```

- Default: output commands for manual execution
- User-authorized: execute directly

### Step 6: Verify

```bash
# Confirm history is correct
git log --oneline -10

# Confirm commit count
git log --oneline HEAD --not <target> | wc -l
```

On success, suggest force push:

```bash
git push --force-with-lease origin <branch>
```

## Conflict Handling

| Scenario                | Action                                        |
| ----------------------- | --------------------------------------------- |
| Already squash-merged   | `git rebase --skip` (dropped commit)           |
| Real content conflict   | Manual resolve → `git rebase --continue`       |
| Cannot resolve          | `git rebase --abort` to restore original state |

## Prohibited

- No rebase on shared branches (main/develop)
- No force push to main/develop
- No rebase without user confirmation
- Always use `--force-with-lease` (prevent overwriting others' pushes)

## Output

Rebase plan table with keep/drop commits:
- **With `--base`**: includes `git rebase --onto` command ready to copy-paste
- **Auto-detect**: analysis report with cherry status per commit; may require `--base` follow-up

## Verification

- [ ] Prerequisites validated (not shared branch, clean tree, not detached)
- [ ] Script output parsed and displayed as plan table
- [ ] User confirmed before any rebase execution
- [ ] Post-rebase commit count matches expected keep count
- [ ] `--force-with-lease` used (never `--force`)

## Examples

```bash
# Auto-detect (cherry-pick scenarios)
/smart-rebase

# Specify base branch (squash-merge scenarios)
/smart-rebase --base fix/feature-xyz

# Specify non-main target
/smart-rebase --target origin/develop --base fix/hotfix-123
```

## References

| File | Purpose | When to Read |
|------|---------|-------------|
| [smart-rebase-analyze.sh](scripts/smart-rebase-analyze.sh) | Analysis script | Step 1 |
