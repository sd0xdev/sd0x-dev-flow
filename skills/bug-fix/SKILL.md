---
name: bug-fix
description: "Bug fix workflow. Use when: fixing bugs, resolving issues, regression fixes. Not for: new features (use feature-dev), understanding code (use code-explore). Output: fix + regression test + review gate."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(yarn:*), Bash(gh:*)
---

# Bug Fix Skill

## Trigger

- Keywords: bug, issue, fix, error, broken, failing

## When NOT to Use

- New feature development (use feature-dev)
- Just want to understand code (use code-explore)

## Workflow

```
Investigate ──→ Locate ──→ Fix ──→ Test ──→ Review
  │               │        │        │        │
  ▼               ▼        ▼        ▼        ▼
gh issue        Grep     Edit    Write    /codex-review-fast
/git-inv        Read     tests   /verify  /precommit
```

## Phase 1: Investigation

| Source         | Action                   |
| -------------- | ------------------------ |
| GitHub Issue   | `gh issue view <number>` |
| Error message  | `Grep("error message")`  |
| Code history   | `/git-investigate`       |

**Output root cause analysis**:

- Problem location: `src/xxx.ts:123`
- Root cause: <specific cause>
- Impact scope: <which features are affected>

## Phase 2: Fix

| Principle             | Description                          |
| --------------------- | ------------------------------------ |
| Minimal changes       | Only modify what is necessary        |
| No new issues         | Confirm changes don't affect other features |

## Phase 3: Add Tests ⚠️

**Bug fixes must have tests at the corresponding level**

| Bug Type        | Required    | Recommended |
| --------------- | ----------- | ----------- |
| Logic error     | Unit        | -           |
| Service issue   | Unit        | Integration |
| API issue       | Integration | E2E         |
| User flow       | E2E         | -           |

Detailed guide: [testing-guide.md](./references/testing-guide.md)

## Phase 4: Review

```bash
/verify              # Run tests
/codex-review-fast   # Code review
/codex-test-review   # Test review
/precommit           # Pre-commit checks
```

## Review Loop

**⚠️ Follow @rules/auto-loop.md**

```
Fix → Review → Issues found → Fix again → ... → ✅ Pass
```

## Output

```markdown
## Bug Fix Report
- **Root cause**: <analysis>
- **Fix**: <description of changes>
- **Regression test**: <test result>
- **Gate**: ✅ Fixed / ⛔ Needs further investigation
```

## Verification

- [ ] Issue confirmed fixed
- [ ] Tests at corresponding level written
- [ ] All tests passing
- [ ] Code review passed (Gate ✅)

## Examples

```
Input: Fix issue #123 - calculation error
Action: gh issue view → locate → fix → write Unit Test → /verify → /codex-review-fast
```

```
Input: API returning 500 error
Action: Grep error → read code → fix → write Integration Test → /verify → /codex-review-fast
```
