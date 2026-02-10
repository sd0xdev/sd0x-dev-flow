---
description: Validate skill quality against routing, progressive loading, and verification criteria.
argument-hint: [--deep] [--json]
allowed-tools: Read, Grep, Glob, Bash(node:*)
---

**Must read and follow the skill below before executing this command:**

@skills/skill-health-check/SKILL.md

## Context

- Skills directory: !`ls skills/ | wc -l` skills
- Commands directory: !`ls commands/ | wc -l` commands

## Task

Run skill health check.

### Arguments

```
$ARGUMENTS
```

| Parameter | Description |
|-----------|-------------|
| `--deep` | Include manual review dimensions (Step 2) |
| `--json` | Output JSON format |

### Workflow

```
Run skill-lint.js → [Optional: manual review] → Report + Gate
```

1. **Run automated lint**: `node skills/skill-health-check/scripts/skill-lint.js --fix-hint` (append `--json` if `$ARGUMENTS` contains `--json`)
2. **If `--deep`** (from `$ARGUMENTS`): Read flagged skills and evaluate Why>What, scope, progressive loading, routing precision
3. **Output**: Health report + Gate sentinel

## Output

```markdown
# Skill Health Check Report

## Summary
| Metric | Value |
|--------|-------|
| Skills scanned | N |
| P0/P1/P2 | N/N/N |

## Per-Skill Results
| Skill | Routing | When-NOT | Output | Status |
|-------|---------|----------|--------|--------|

## Gate: ✅ All Pass / ⛔ N issues
```

## Examples

```bash
/skill-health-check
/skill-health-check --deep
/skill-health-check --json
```
