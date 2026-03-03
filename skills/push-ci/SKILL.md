---
name: push-ci
description: "Push to remote and monitor CI. Validates branch safety, executes git push WITH explicit user approval, then monitors CI run status via gh CLI. Use when: user says 'push', 'push and watch CI', 'ship it', 'push-ci'. Not for: committing (use /smart-commit), creating PRs (use /create-pr), merging (use /merge-prep)."
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob, AskUserQuestion
---

# Push & CI Monitor

Push to remote with user approval, then monitor CI run until completion.

## Authorization

```
⚠️ This skill is the ONLY authorized path for Claude to execute `git push`.
⚠️ All other skills and rules MUST output push commands only (not execute).
⚠️ Push REQUIRES explicit user approval via AskUserQuestion — no exceptions.
```

| Rule | This Skill | All Other Skills |
|------|-----------|-----------------|
| `git push` | Execute (after user approval) | Forbidden (output only) |
| `git push --force` | Forbidden | Forbidden |
| Push to protected branches (main/master/develop/release/*) | Warn + pre-approval via AskUserQuestion (terminal hook is final gate) | Forbidden |

## Defense in Depth: Push Safety

| Layer | Mechanism | Scope | Reliability |
|-------|-----------|-------|-------------|
| **L1: git pre-push hook** | `pre-push-gate.sh` reads `/dev/tty` for terminal confirmation | Protected branches + non-fast-forward detection | Immune to Claude Code permission caching |
| **L2: AskUserQuestion** | In-session advisory prompt before push | All pushes | May be auto-approved by session caching (advisory only) |
| **L3: git-workflow rules** | Claude forbidden from raw `git push` | All contexts | Behavioral enforcement |

**Primary gate**: `pre-push-gate.sh` (install via `/install-scripts`). This script runs as a git pre-push hook and prompts the developer directly via `/dev/tty`, which is immune to Claude Code's permission caching. AskUserQuestion remains as an advisory UX layer but is **not the authorization gate** — the git hook is.

**Why AskUserQuestion alone is insufficient**: Session permission caching can auto-approve AskUserQuestion calls in long-running sessions, especially with `-c` continue mode. See GitHub Issue #15400.

## Workflow

```mermaid
sequenceDiagram
    participant C as Claude
    participant U as User
    participant GH as GitHub

    C->>C: Phase 0: Preflight
    alt Protected branch detected
        C->>U: ⚠️ Warning + ask pre-approval
        U->>C: Continue / Abort
    end
    C->>U: Phase 1: Show push plan + ask approval
    U->>C: Approve / Reject
    alt Approved
        C->>GH: Execute git push
        C->>GH: Phase 2: gh run watch --exit-status
        GH-->>C: CI result
        C->>U: Phase 3: Verdict + failure logs
    else Rejected
        C->>U: Abort (no push)
    end
```

### Phase 0: Preflight

Run all checks. Hard-abort on infrastructure failures; warn-and-confirm on protected branches.

```bash
# 1. Current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# 2. Protected branch detection
# If main, master, develop, or release/* → warn + AskUserQuestion pre-approval
# (do NOT hard-abort; let user decide)

# 3. Remote exists
git ls-remote --exit-code origin >/dev/null 2>&1

# 4. Working tree status
git status --short

# 5. Commits ahead of remote
git rev-list --count origin/$BRANCH..HEAD 2>/dev/null || echo "new branch"

# 6. Local HEAD SHA (for CI run matching later)
HEAD_SHA=$(git rev-parse HEAD)
```

| Check | Pass | Fail |
|-------|------|------|
| Branch is not protected | Continue | **Warn + AskUserQuestion** (see below) |
| Remote exists | Continue | Abort: "No remote 'origin' configured" |
| Has commits ahead | Continue | Abort: "Nothing to push (0 commits ahead)" |

**Protected branch pre-approval flow** (advisory — terminal hook remains final gate):

When branch is `main`, `master`, `develop`, or `release/*`:

1. Show warning with branch name and commit count
2. Use AskUserQuestion with options:
   - "Continue — push to `<branch>`" — proceed to Phase 1
   - "Abort" — stop immediately
3. If user aborts → stop. If user continues → proceed to Phase 1 (push approval asked separately). Note: the git pre-push hook will still require terminal confirmation via `/dev/tty` as the final authorization gate.

### Phase 1: Push Plan + User Approval

Present push summary and **ask user for explicit approval** using AskUserQuestion:

```markdown
## Push Plan

- Branch: `<branch>`
- Remote: `origin`
- Commits: <N> ahead
- HEAD: `<sha>`

Command to execute: `git push origin <branch>`
```

**Gate**: Use AskUserQuestion with options:
- "Approve push" — proceed to execute
- "Abort" — stop, do not push

**If user rejects → stop immediately. Do NOT retry or persuade.**

### Phase 2: Execute Push + Monitor CI

After user approval:

**Command assembly** (deterministic):

```bash
# 1. Build and execute push command (ONLY after explicit approval)
# ⚠️ Always unset ALLOW_PUSH_PROTECTED to prevent env inheritance bypassing the hook.
# Only set ALLOW_FORCE_WITH_LEASE when --force-with-lease is explicitly requested.
if [[ "$FORCE_WITH_LEASE" == "true" ]]; then
  if [[ "$SET_UPSTREAM" == "true" ]]; then
    ALLOW_PUSH_PROTECTED= ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease -u origin "$BRANCH"
  else
    ALLOW_PUSH_PROTECTED= ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease origin "$BRANCH"
  fi
else
  if [[ "$SET_UPSTREAM" == "true" ]]; then
    ALLOW_PUSH_PROTECTED= ALLOW_FORCE_WITH_LEASE= git push -u origin "$BRANCH"
  else
    ALLOW_PUSH_PROTECTED= ALLOW_FORCE_WITH_LEASE= git push origin "$BRANCH"
  fi
fi
# If push fails (non-zero exit) → stop immediately, report error, do NOT proceed to CI

# 2. Find CI runs matching HEAD_SHA (only if push succeeded)
RUNS=$(gh run list --branch "$BRANCH" --limit 10 --json databaseId,headSha,status,name \
  --jq "[.[] | select(.headSha == \"$HEAD_SHA\")]")

# 3. Monitor all matching runs (worst result = overall verdict)
# For each run in RUNS:
#   gh run watch <run-id> --exit-status
#   Record pass/fail per run
# If RUNS is empty after 30s retry (3 attempts, 10s interval) → report no CI
# Overall verdict = worst individual result (any fail → overall fail)

# 4. Timeout enforcement
# Track START_TIME=$(date +%s) before watch loop.
# After each poll, check: if (now - START_TIME) > TIMEOUT_MINUTES*60 → stop, report ⚠️ Timeout.
```

**`--set-upstream` auto-detect**: If `git rev-parse --abbrev-ref --symbolic-full-name @{u}` fails (no upstream), add `-u` automatically.

**CI Run Selection** — match by `headSha + branch`, not "latest" (see step 2 above).

**Multiple CI runs**: If multiple workflow runs match the same SHA (e.g. CI + Auto Release), monitor all of them in parallel. Report verdict for each run individually. Overall verdict is the worst result across all runs.

If no run found after 30 seconds, retry up to 3 times (10s interval). If still not found:

```
⚠️ No CI run detected for SHA <sha>. Possible causes:
- No workflow configured for this branch
- Path-filtered workflow didn't trigger
- Check: gh run list --branch <branch>
```

**Timeout**: Default 10 minutes. Configurable via `--timeout <minutes>`.

### Phase 3: Verdict

| CI Result | Action |
|-----------|--------|
| Pass | Output: "✅ CI passed — `<run-url>`" |
| Fail | Output: failing jobs + `gh run view <id> --log-failed` summary |
| Timeout | Output: "⚠️ CI still running after <N>min — `gh run watch <id>`" |

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--timeout <min>` | CI watch timeout in minutes | 10 |
| `--force-with-lease` | Use `--force-with-lease` instead of regular push | off |
| `--set-upstream` | Add `-u` flag (first push of new branch) | auto-detect |

**`--force` is NOT supported.** Force push is always forbidden.

## Prohibited

```
- Executing git push WITHOUT prior user approval via AskUserQuestion
- Suggesting or executing git push --force (ever)
- Pushing to protected branches WITHOUT explicit user pre-approval via AskUserQuestion
- Setting ALLOW_PUSH_PROTECTED=1 (this skill must NEVER set this env var; it is reserved for manual developer use only)
- Auto-triggering this skill (disable-model-invocation: true)
- Skipping preflight checks
- Monitoring wrong CI run (must match HEAD SHA)
```

## Verification

- [ ] Preflight passed (branch + remote + commits)
- [ ] User approved push via AskUserQuestion
- [ ] Push executed successfully
- [ ] CI run matched by HEAD SHA (not "latest")
- [ ] Verdict reported (pass/fail/timeout)

## Examples

```
Input: /push-ci
Phase 0: Preflight — branch feat/auth, 3 commits ahead, remote OK
Phase 1: Show plan → user approves
Phase 2: git push origin feat/auth → gh run watch 12345 --exit-status
Phase 3: ✅ CI passed — https://github.com/.../actions/runs/12345
```

```
Input: /push-ci --timeout 15
Phase 0-1: Same as above
Phase 2: Monitor with 15-minute timeout
Phase 3: Verdict
```

```
Input: /push-ci --force-with-lease
Phase 0: Preflight (warns on protected branches)
Phase 1: Show plan with --force-with-lease → user approves
Phase 2: git push --force-with-lease origin feat/rebase-cleanup
Phase 3: CI monitoring
```

```
Input: /push-ci (on main branch)
Phase 0: Preflight — ⚠️ "main is a protected branch" → AskUserQuestion pre-approval
User: Continue → proceed
Phase 1: Show plan → user approves push
Phase 2: git push origin main → gh run watch
Phase 3: ✅ CI passed
```
