---
description: Create or update a request document. Auto-fill template on creation, sync with implementation progress on update.
argument-hint: [--update <file-path>] [--feature <name>]
allowed-tools: Read, Grep, Glob, Write, Bash
skills: create-request
---

## Context

- Git status: !`git status -sb`
- Recent commits: !`git log --oneline -5`
- Existing requests: !`ls docs/features/*/requests/*.md 2>/dev/null | tail -5`

## Task

Determine mode based on $ARGUMENTS:

### Arguments

```
$ARGUMENTS
```

| Parameter          | Description                       |
| ------------------ | --------------------------------- |
| `--update <path>`  | Update mode: specify request path |
| `--feature <name>` | Create mode: specify feature area |
| No parameter       | Auto-determine from context       |

### Mode Detection

```
Has --update        -> Update Mode
Has --feature       -> Create Mode
Context references request doc -> Update Mode (after confirmation)
Other               -> Create Mode (ask for info)
```

### Create Mode

Follow the Create Mode Workflow in the skill:

1. **Gather**: Collect feature, title, priority, requirements
2. **Explore**: Search related code + tech spec
3. **Generate**: Fill template + create file
4. **Confirm**: Show result + suggest next steps

### Update Mode

Follow the Update Mode Workflow in the skill:

1. **Load**: Read existing request document
2. **Analyze**: Analyze Related Files + git changes
3. **Map**: Compare implementation with Acceptance Criteria
4. **Update**: Update Progress / Status / Checkboxes
5. **Report**: Output change summary

## Output

### Create Mode Output

```markdown
## Request Document Created

- Path: `docs/features/{feature}/requests/YYYY-MM-DD-title.md`
- Status: Pending

### Suggested Next Steps

1. `/tech-spec` - Write technical spec
2. `/codex-architect` - Get architecture advice
```

### Update Mode Output

```markdown
## Request Document Update Report

### File

`docs/features/{feature}/requests/YYYY-MM-DD-title.md`

### Change Summary

| Section             | Changes                  |
| ------------------- | ------------------------ |
| Status              | Pending -> In Development|
| Progress.Development| ⬜ -> 🔄 In Progress      |
| Progress.Testing    | ⬜ -> 🔄 In Progress      |
| Acceptance Criteria | 2/5 -> 4/5 ✅            |

### Git Activity

- `abc1234` feat: Implement token branch fix
- `def5678` test: Add near-zero denominator test

### Next Steps

- [ ] Complete remaining Acceptance Criteria
- [ ] Run `/codex-review-fast`
- [ ] Run `/precommit`
```

## Examples

```bash
# Create new request (interactive)
/create-request

# Create request for specific feature
/create-request --feature auth

# Update specific request
/create-request --update docs/features/auth/requests/2026-01-23-fix-login-validation.md

# Auto-update from context (after development)
/create-request --update
```

## Workflow Position

```
Requirements -> /create-request -> /tech-spec -> /feature-dev -> /create-request --update
                                                                        ↑
                                                                  (sync progress)
```
