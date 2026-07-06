---
name: dep-audit
description: "Audit dependency security risks"
allowed-tools: Bash(yarn audit:*), Bash(npm audit:*), Bash(pnpm audit:*), Bash(npx:*), Bash(bash:*), Read, Glob
---

# Dependency Audit

## Trigger

- Keywords: dep audit, dependency audit, security audit dependencies, dep-audit

## When NOT to Use

- OWASP code review (use `/codex-security`)
- Code review (use `/codex-review-fast`)
- General security review (use `/codex-security`)

## Workflow Steps

| Step | Goal | Safety |
|------|------|--------|
| audit | Scan dependencies for vulnerabilities | read-only |

**Failure behavior**: report-all

## Task

### Arguments

```
$ARGUMENTS
```

- `--level <severity>` — Minimum reporting level (low/moderate/high/critical), default: moderate
- `--fix` — Attempt automatic fix

### Step 1: Check for audit script

Use Glob to check if `.claude/scripts/dep-audit.sh` exists in the project root.

- **Found** → run: `bash .claude/scripts/dep-audit.sh $ARGUMENTS`
  - If script succeeds, use its output and skip to the Output section.
  - If script **fails**, treat as a real audit failure (do not silently fallback).
- **NOT found** → skip to Step 2 (do NOT attempt to run the script).

### Step 2: Fallback (no audit script)

Detect the project ecosystem and run the audit manually.

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

## Output

```markdown
## Audit Results

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Moderate | 0 |
| Low | 0 |

## Vulnerability Details

### [severity] Issue Title

- **Package**: package-name
- **Fix**: Available / Not available

## Gate

✅ **PASS** — No moderate or above vulnerabilities
❌ **FAIL** — Found high severity vulnerabilities
```

## Examples

```bash
/dep-audit
/dep-audit --level high
/dep-audit --fix
```
