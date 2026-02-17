---
description: Verification loop — lint -> typecheck -> unit -> integration -> e2e
argument-hint: [fast|full]
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Read, Grep, Glob
intent:
  goal: Run full verification loop for code quality
  steps:
    - name: lint
      goal: Check code style (read-only)
      preferred: ["lint"]
      skip-if-missing: true
      safety: read-only
    - name: typecheck
      goal: Static type checking
      preferred: ["typecheck"]
      skip-if-missing: true
      safety: read-only
      mode: full-only
    - name: test-unit
      goal: Run unit test suite
      preferred: ["test:unit"]
      alternatives: ["test"]
      skip-if-missing: true
      safety: read-only
    - name: test-integration
      goal: Run integration tests
      preferred: ["test:integration"]
      skip-if-missing: true
      safety: read-only
      mode: full-only
    - name: test-e2e
      goal: Run end-to-end tests
      preferred: ["test:e2e"]
      skip-if-missing: true
      safety: read-only
      mode: full-only
  failure-behavior: continue-all
---

## Context

- Branch: !`git branch --show-current`
- Changes: !`git diff --stat HEAD`

## Task

### Step 1: Check for runner script

Use Glob to check if `.claude/scripts/verify-runner.js` exists in the project root.

- **Found** → run: `node .claude/scripts/verify-runner.js $ARGUMENTS`
  - If runner succeeds, use its output and skip to the Output section.
  - If runner **fails**, treat as a real verification failure (do not silently fallback).
- **NOT found** → skip to Step 2 (do NOT attempt to run the runner).

### Step 2: Fallback (no runner script)

If the runner was not found in Step 1, detect the project ecosystem to run steps manually.

**Ecosystem detection** (check project root for manifest files):

| Manifest | Ecosystem | Lint | Typecheck | Test |
|----------|-----------|------|-----------|------|
| `package.json` | Node.js | `{pm} lint` | `{pm} typecheck` | `{pm} test:unit` |
| `pyproject.toml` | Python | `ruff check .` | `mypy .` | `pytest` |
| `Cargo.toml` | Rust | `cargo clippy` | _(implicit)_ | `cargo test` |
| `go.mod` | Go | `golangci-lint run` | `go vet ./...` | `go test ./...` |
| `build.gradle` | Java | `./gradlew spotlessCheck` | _(implicit)_ | `./gradlew test` |

For Node.js projects, auto-detect package manager from lockfile. Read `package.json` to check which scripts exist, then run in order:

**`$ARGUMENTS` == "fast"**: lint + unit only

**Otherwise (full)**: lint -> typecheck -> unit -> integration -> e2e

| Step | package.json script | If missing |
|------|-------|------------|
| lint | `lint` | Skip with note |
| typecheck | `typecheck` | Skip with note |
| unit | `test:unit`, fallback to `test` | Skip with note |
| integration | `test:integration` | Skip (requires explicit path) |
| e2e | `test:e2e` | Skip (requires explicit path) |

Integration/E2E default to single file only; specify path explicitly:

```bash
# Example: run a specific integration test
{PM} test:integration -- test/integration/xxx.test.ts
# Example: run a specific e2e test
{PM} test:e2e -- test/e2e/xxx.test.ts
```

### Graceful Skip Rules

| Scenario | Behavior |
|----------|----------|
| No `lint` script | Skip, log "no lint script — skipped" |
| No `typecheck` script | Skip, log "no typecheck script — skipped" |
| No `test:unit` or `test` script | Skip, log "no test script — skipped" |
| No `test:integration` script | Skip (only runs when explicitly specified) |
| No `test:e2e` script | Skip (only runs when explicitly specified) |
| No `package.json` | Report error, cannot run checks |

## Output

For **fast** mode:

```markdown
## Verify (fast)

| Step      | Status | Notes |
| --------- | ------ | ----- |
| lint      | ✅/❌/⏭️ | |
| unit      | ✅/❌/⏭️ | |

## Overall: ✅ PASS / ❌ FAIL
```

For **full** mode:

```markdown
## Verify (full)

| Step        | Status | Notes |
| ----------- | ------ | ----- |
| lint        | ✅/❌/⏭️ | |
| typecheck   | ✅/❌/⏭️ | |
| unit        | ✅/❌/⏭️ | |
| integration | ✅/❌/⏭️ | skipped unless path specified |
| e2e         | ✅/❌/⏭️ | skipped unless path specified |

## Failures (if any)

- Root cause: <first error>
- Fix: <suggestion>

## Overall: ✅ PASS / ❌ FAIL
```
