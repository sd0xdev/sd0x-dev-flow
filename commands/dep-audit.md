---
description: Audit dependency security risks
argument-hint: [--level <severity>] [--fix]
allowed-tools: Bash(yarn audit *), Bash(npm audit *), Bash(pnpm audit *), Bash(npx *), Bash(bash *), Read, Glob
skills: security-review
intent:
  goal: Audit project dependencies for known security vulnerabilities
  steps:
    - name: audit
      goal: Scan dependencies for vulnerabilities
      preferred: ["audit"]
      skip-if-missing: false
      safety: read-only
  failure-behavior: report-all
---

## Arguments

$ARGUMENTS = optional parameters

- `--level <severity>` - Minimum reporting level (low/moderate/high/critical), default: moderate
- `--fix` - Attempt automatic fix

## Task

### Step 1: Check for audit script

First, check if `scripts/dep-audit.sh` exists in the project root. If the file exists, run it:

```bash
bash scripts/dep-audit.sh $ARGUMENTS
```

If it succeeds, use its output and skip to the Output section.

### Step 2: Fallback (no audit script)

If the script does not exist, detect the project ecosystem and run the audit manually.

**Ecosystem detection** (check project root for manifest files):

| Manifest | Ecosystem | Audit Command | Fix Command |
|----------|-----------|---------------|-------------|
| `package.json` + `pnpm-lock.yaml` | Node (pnpm) | `pnpm audit --audit-level {LEVEL}` | `pnpm audit --fix` |
| `package.json` + `yarn.lock` | Node (yarn) | `yarn audit --level {LEVEL}` | `yarn audit --fix` or `npx yarn-audit-fix` |
| `package.json` | Node (npm) | `npm audit --audit-level={LEVEL}` | `npm audit fix` |
| `pyproject.toml` | Python | `pip-audit` or `safety check` | `pip-audit --fix` |
| `Cargo.toml` | Rust | `cargo audit` | `cargo audit fix` |
| `go.mod` | Go | `govulncheck ./...` | _(manual fix)_ |
| `build.gradle` | Java | `./gradlew dependencyCheckAnalyze` | _(manual fix)_ |

Default `{LEVEL}` is `moderate` unless `--level` argument is provided.

If `--fix` is specified, run the fix command for the detected ecosystem after audit.
If no recognized manifest file exists, report an error.

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
