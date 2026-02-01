---
description: Post-development test completion. Analyze developed features, check integration/e2e coverage, write missing tests.
argument-hint: [--type integration|e2e] [--dry-run]
allowed-tools: Read, Grep, Glob, Write, Bash
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/post-dev-test/SKILL.md

## Context

- Git status: !`git status -sb`
- Recent changes: !`git diff --name-only HEAD~5 2>/dev/null | grep -E '^src/' | head -10`
- Existing integration tests: !`ls test/integration/ 2>/dev/null | head -5`
- Existing e2e tests: !`ls test/e2e/ 2>/dev/null | head -5`

## Task

Based on conversation context, analyze developed features, check integration/e2e test coverage, and write missing tests.

### Arguments

```
$ARGUMENTS
```

| Parameter                 | Description                                     |
| ------------------------- | ----------------------------------------------- |
| `--type integration\|e2e` | Specify test type (default: check both)         |
| `--dry-run`               | Analyze only, do not write                      |

## Output

```markdown
## Test Completion Report

### Analyzed Features

- Feature name: <identified from context>
- Modules involved: <Service / Provider / Controller>
- Code changes: ✅ Has changes / ❌ No changes

### Existing Coverage

| Test Type   | File | Coverage Status |
| ----------- | ---- | --------------- |
| Integration | ...  | ✅/❌           |
| E2E         | ...  | ✅/❌           |

### Added Tests

| File Path            | Type        | Covered Scenarios |
| -------------------- | ----------- | ----------------- |
| test/integration/... | Integration | ...               |
| test/e2e/...         | E2E         | ...               |

### Execution Results

✅ All tests passed / ❌ Failures found (see below)

> ⚠️ Even with full coverage, tests must be run when there are code changes to confirm no regression
```

## Examples

```bash
# Automatically analyze and complete tests
/post-dev-test

# Only complete e2e tests
/post-dev-test --type e2e

# Analyze only, do not write
/post-dev-test --dry-run
```

## Workflow Position

```
/feature-dev → /verify → /codex-review-fast → /post-dev-test → /precommit
                                                    ↑
                                              (you are here)
```
