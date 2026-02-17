---
description: Quick pre-commit checks — lint:fix -> test:unit
argument-hint: [--skip-lint]
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Bash(rubocop:*), Bash(rspec:*), Bash(git:*), Read, Grep, Glob
intent:
  goal: Run quick pre-commit quality checks (no build step)
  steps:
    - name: lint-fix
      goal: Auto-fix code style issues
      preferred: ["lint:fix"]
      alternatives: ["lint"]
      skip-if-missing: true
      safety: read-write
    - name: test-unit
      goal: Run unit test suite
      preferred: ["test:unit"]
      alternatives: ["test"]
      skip-if-missing: true
      safety: read-only
  failure-behavior: continue-all
---

## Task

Run quick pre-commit checks: **lint:fix -> test:unit** (no build step)

### Step 1: Check for runner script

Use Glob to check if `.claude/scripts/precommit-runner.js` exists in the project root.

- **Found** → run: `node .claude/scripts/precommit-runner.js --mode fast --tail 60`
  - If runner succeeds, use its output and skip to the Output section.
  - If runner **fails**, treat as a real precommit failure (do not silently fallback).
- **NOT found** → skip to Step 2 (do NOT attempt to run the runner).

### Step 2: Fallback (no runner script)

If the runner was not found in Step 1, detect the project ecosystem to run steps manually.

**Ecosystem detection** (check project root for manifest files):

| Manifest | Ecosystem | Lint-fix | Test |
|----------|-----------|----------|------|
| `package.json` | Node.js | `{pm} lint:fix` | `{pm} test:unit` or `{pm} test` |
| `pyproject.toml` | Python | `ruff check --fix .` | `pytest tests/unit/` |
| `Cargo.toml` | Rust | `cargo clippy --fix` | `cargo test` |
| `go.mod` | Go | `golangci-lint run --fix` | `go test ./...` |
| `build.gradle` | Java (Gradle) | `./gradlew spotlessApply` | `./gradlew test` |
| `build.gradle.kts` | Java (Gradle KTS) | `./gradlew spotlessApply` | `./gradlew test` |
| `pom.xml` | Java (Maven) | `mvn spotless:apply` | `mvn test` |
| `Gemfile` | Ruby | `bundle exec rubocop -a` | `bundle exec rspec` |

For Node.js projects, auto-detect package manager from lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm).

Read `package.json` (or equivalent manifest) to check which scripts/tools exist, then run available steps in order:

| Step | package.json script | If missing |
|------|-------|------------|
| lint:fix | `lint:fix` | Skip with note (not all projects have it) |
| test:unit | `test:unit`, fallback to `test` | Skip with note |

After lint:fix completes, run `git diff --name-only` to capture auto-fixed files.

### Graceful Skip Rules

| Scenario | Behavior |
|----------|----------|
| No `lint:fix` script | Skip, log "no lint:fix script — skipped" |
| No `test:unit` or `test` script | Skip, log "no test script — skipped" |
| No `package.json` | Report error, cannot run checks |

## Output

```markdown
## Precommit (fast)

## Results

| Step      | Status | Notes |
| --------- | ------ | ----- |
| lint:fix  | ✅/❌/⏭️ | skipped if no script |
| test:unit | ✅/❌/⏭️ | skipped if no script |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
