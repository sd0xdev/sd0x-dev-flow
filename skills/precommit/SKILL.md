---
name: precommit
description: "Pre-commit checks — lint:fix -> build -> test"
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Bash(rubocop:*), Bash(rspec:*), Bash(git:*), Read, Grep, Glob
---

# Pre-Commit Checks (Full)

## Trigger

- Keywords: precommit, pre-commit, lint and test, quality gate

## When NOT to Use

- Quick checks without build (use `/precommit-fast`)
- Verification loop without lint:fix (use `/verify`)
- Just running tests (run directly)

## Workflow Steps

| Step | Goal | Safety | Skip if Missing |
|------|------|--------|----------------|
| lint-fix | Auto-fix code style issues | read-write | yes |
| build | Verify compilation succeeds | read-only | yes |
| test-unit | Run full test suite | read-only | yes |

**Failure behavior**: continue-all (run all steps, report all results)

## Task

Run pre-commit checks: **lint:fix -> build -> test**

### Step 1: Check for runner script

Use Glob to check if `.claude/scripts/precommit-runner.js` exists in the project root.

- **Found** → run: `node .claude/scripts/precommit-runner.js --mode full --tail 80`
  - If runner emits `## Overall: ✅ PASS`, use its output and skip to the Output section.
  - If runner emits `## Overall: ⚠️ NO CHECKS RUN` (host repo has no matching `package.json` scripts), do **NOT** treat it as a pass — fall through to Step 2 ecosystem detection so the project's real checks (ruff/pytest, cargo, go test, …) run. This is fail-closed: an all-skip run never satisfies the gate on its own.
  - If runner **fails** (`## Overall: ❌ FAIL`), treat as a real precommit failure (do not silently fallback).
- **NOT found** → **Auto-install attempt** (see precommit-fast for identical auto-install logic), then fallback to Step 2.

### Step 2: Fallback (no runner script)

Detect the project ecosystem to run steps manually.

**Ecosystem detection**:

| Manifest | Ecosystem | Lint-fix | Build | Test |
|----------|-----------|----------|-------|------|
| `package.json` | Node.js | `{pm} lint:fix` | `{pm} build` | `{pm} test:ci` / `test` / `test:fast` / `test:unit` |
| `pyproject.toml` | Python | `ruff check --fix .` | — | `pytest tests/unit/` |
| `Cargo.toml` | Rust | `cargo clippy --fix` | `cargo build` | `cargo test` |
| `go.mod` | Go | `golangci-lint run --fix` | `go build ./...` | `go test ./...` |
| `build.gradle` | Java (Gradle) | `./gradlew spotlessApply` | `./gradlew build` | `./gradlew test` |
| `pom.xml` | Java (Maven) | `mvn spotless:apply` | `mvn compile` | `mvn test` |
| `Gemfile` | Ruby | `bundle exec rubocop -a` | — | `bundle exec rspec` |

For Node.js projects, auto-detect package manager from lockfile.

| Step | package.json script | If missing |
|------|---------------------|------------|
| lint:fix | `lint:fix` | Skip with note |
| build | `build` | Skip with note |
| test | `test:ci` → `test` → `test:fast` → `test:unit` | Skip with note |

After lint:fix completes, run `git diff --name-only` to capture auto-fixed files.

## Output

```markdown
## Precommit (full)

## Results

| Step | Status | Notes |
|------|--------|-------|
| lint:fix | ✅/❌/⏭️ | skipped if no script |
| build | ✅/❌/⏭️ | skipped if no script |
| test | ✅/❌/⏭️ | skipped if no script |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN (only when no runnable script AND no ecosystem check exists — needs human)

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
