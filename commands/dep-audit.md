---
description: Audit npm dependency security risks
argument-hint: [--level <severity>] [--fix]
allowed-tools: Bash(yarn audit *), Bash(npm audit *), Bash(bash *), Read
skills: security-review
---

## Arguments

$ARGUMENTS = optional parameters

- `--level <severity>` - Minimum reporting level (low/moderate/high/critical), default: moderate
- `--fix` - Attempt automatic fix

## Task

Execute dependency security audit:

```bash
bash scripts/dep-audit.sh $ARGUMENTS
```

## Examples

```bash
# Report moderate and above vulnerabilities (default)
/dep-audit

# Only report high/critical
/dep-audit --level high

# Attempt automatic fix
/dep-audit --fix
```

## Output

```markdown
## Audit Results

| Severity | Count |
| :------- | ----: |
| Critical |     0 |
| High     |     2 |
| Moderate |     5 |
| Low      |    10 |

## Vulnerability Details

### [high] Prototype Pollution

- **Package**: lodash
- **Fix**: Available

## Gate

✅ **PASS** - No moderate or above vulnerabilities
❌ **FAIL** - Found high severity vulnerabilities
```

## Severity Levels

| Level    | Description                        |
| :------- | :--------------------------------- |
| critical | Most severe, fix immediately       |
| high     | High risk                          |
| moderate | Medium risk (default)              |
| low      | Low risk                           |
