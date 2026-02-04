---
description: Pre-commit checks — lint:fix -> build -> test:unit
argument-hint: [--skip-build] [--skip-lint]
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(git:*), Read, Grep, Glob
intent:
  goal: Run pre-commit quality checks before committing code
  steps:
    - name: lint-fix
      goal: Auto-fix code style issues
      preferred: ["lint:fix"]
      alternatives: ["lint"]
      skip-if-missing: true
      safety: read-write
    - name: build
      goal: Verify compilation succeeds
      preferred: ["build"]
      alternatives: ["typecheck"]
      skip-if-missing: true
      safety: read-only
    - name: test-unit
      goal: Run unit test suite
      preferred: ["test:unit"]
      alternatives: ["test"]
      skip-if-missing: true
      safety: read-only
  failure-behavior: continue-all
---

## Task

Run pre-commit checks: **lint:fix -> build -> test:unit**

### Step 1: Check for runner script

First, check if `scripts/precommit-runner.js` exists in the project root. If the file exists, run it:

```bash
node scripts/precommit-runner.js --mode full --tail 80
```

If it succeeds, use its output and skip to the Output section.

### Step 2: Fallback (no runner script)

If `scripts/precommit-runner.js` does not exist, **skip Step 1 entirely** and detect the project ecosystem to run steps manually.

**Ecosystem detection** (check project root for manifest files):

| Manifest | Ecosystem | Lint-fix | Build | Test |
|----------|-----------|----------|-------|------|
| `package.json` | Node.js | `{pm} lint:fix` | `{pm} build` | `{pm} test:unit` or `{pm} test` |
| `pyproject.toml` | Python | `ruff check --fix .` | — | `pytest tests/unit/` |
| `Cargo.toml` | Rust | `cargo clippy --fix` | `cargo build` | `cargo test` |
| `go.mod` | Go | `golangci-lint run --fix` | `go build ./...` | `go test ./...` |
| `build.gradle` | Java | `./gradlew spotlessApply` | `./gradlew build` | `./gradlew test` |

For Node.js projects, auto-detect package manager from lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm).

Read `package.json` (or equivalent manifest) to check which scripts exist, then run available steps in order:

| Step | package.json script | If missing |
|------|-------|------------|
| lint:fix | `lint:fix` | Skip with note (not all projects have it) |
| build | `build` | Skip with note |
| test:unit | `test:unit`, fallback to `test` | Skip with note |

Run each available step sequentially. Report all results even if a step fails.

After lint:fix completes, run `git diff --name-only` to capture auto-fixed files.

### Graceful Skip Rules

| Scenario | Behavior |
|----------|----------|
| No `lint:fix` script | Skip, log "no lint:fix script — skipped" |
| No `build` script | Skip, log "no build script — skipped" |
| No `test:unit` or `test` script | Skip, log "no test script — skipped" |
| No `package.json` | Report error, cannot run checks |

## Output

```markdown
## Precommit (full)

## Results

| Step      | Status | Notes |
| --------- | ------ | ----- |
| lint:fix  | ✅/❌/⏭️ | skipped if no script |
| build     | ✅/❌/⏭️ | skipped if no script |
| test:unit | ✅/❌/⏭️ | skipped if no script |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
