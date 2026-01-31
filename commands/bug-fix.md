---
description: Bug/Issue fix workflow. Investigate -> locate -> fix -> test -> review.
argument-hint: [issue-url or problem description]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(yarn:*), Bash(gh:*)
skills: bug-fix
---

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Task

Perform a Bug/Issue fix.

### Arguments

```
$ARGUMENTS
```

### Workflow

Follow the workflow in the skill:

| Phase       | Action                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Investigate | `gh issue view` / `Grep` / `/git-investigate`                              |
| Locate      | `Read` related code                                                         |
| Fix         | `Edit` minimal changes                                                      |
| Test        | Add tests at appropriate level (see @skills/bug-fix/references/testing-guide.md) |
| Review      | `/verify` -> `/codex-review-fast` -> `/precommit`                           |

### Test Requirements ⚠️

| Bug Type      | Required    | Recommended |
| ------------- | ----------- | ----------- |
| Logic error   | Unit        | -           |
| Service issue | Unit        | Integration |
| API issue     | Integration | E2E         |
| User flow     | E2E         | -           |

## Examples

```bash
/bug-fix https://github.com/user/repo/issues/123
/bug-fix "API returns 500 error when token is empty"
/bug-fix "TypeError: Cannot read property 'balance'"
```
