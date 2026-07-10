---
name: precommit-fast
description: "Quick pre-commit checks — lint:fix -> test"
allowed-tools: Bash(node:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Bash(npx:*), Bash(python*:*), Bash(pytest:*), Bash(ruff:*), Bash(mypy:*), Bash(cargo:*), Bash(go:*), Bash(golangci-lint:*), Bash(./gradlew:*), Bash(mvn:*), Bash(bundle:*), Bash(rubocop:*), Bash(rspec:*), Bash(git:*), Read, Grep, Glob
---

# Pre-Commit Checks (Fast)

## Trigger

- Keywords: precommit fast, quick precommit, lint and test, precommit-fast

## When NOT to Use

- Full precommit with build step (use `/precommit`)
- Verification loop (use `/verify`)
- Just running tests (run directly)

## Workflow Steps

| Step | Goal | Safety | Skip if Missing |
|------|------|--------|----------------|
| lint-fix | Auto-fix code style issues | read-write | yes |
| test-unit | Run fast test suite | read-only | yes |

**Failure behavior**: continue-all (run all steps, report all results)

## Task

Run quick pre-commit checks: **lint:fix -> test** (no build step)

### Step 1: Check for runner script

Use Glob to check if `.claude/scripts/precommit-runner.js` exists in the project root.

- **Found** → run: `node .claude/scripts/precommit-runner.js --mode fast --tail 60`
  - If runner emits `## Overall: ✅ PASS`, use its output and skip to the Output section.
  - If runner emits `## Overall: ⚠️ NO CHECKS RUN` (no matching `package.json` scripts), do **NOT** treat it as a pass — fall through to Step 2 ecosystem detection to run the project's real checks.
  - If runner **fails** (`## Overall: ❌ FAIL`), treat as a real precommit failure (do not silently fallback).
- **NOT found** → **Auto-install attempt**:
  1. **Node.js gate**: Use Glob to check if `package.json` exists. If no `package.json` → skip, fall through to Step 2.
  2. **Locate plugin scripts**: 3-level Glob fallback (short-circuit on first match):
     - `Glob: ~/.claude/plugins/**/sd0x-dev-flow/scripts/precommit-runner.js`
     - `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/precommit-runner.js`
     - Plugin-relative: try reading `@scripts/precommit-runner.js`
  3. **Plugin not found** → fall through to Step 2.
  4. **Plugin found** → copy runner + lib/utils.js (skip on conflict) → run.

### Step 2: Fallback (no runner script)

Detect the project ecosystem to run steps manually.

| Manifest | Ecosystem | Lint-fix | Test |
|----------|-----------|----------|------|
| `package.json` | Node.js | `{pm} lint:fix` | `{pm} test:fast` / `test:unit` / `test` |
| `pyproject.toml` | Python | `ruff check --fix .` | `pytest tests/unit/` |
| `Cargo.toml` | Rust | `cargo clippy --fix` | `cargo test` |
| `go.mod` | Go | `golangci-lint run --fix` | `go test ./...` |
| `build.gradle` | Java | `./gradlew spotlessApply` | `./gradlew test` |
| `pom.xml` | Java (Maven) | `mvn spotless:apply` | `mvn test` |
| `Gemfile` | Ruby | `bundle exec rubocop -a` | `bundle exec rspec` |

After lint:fix completes, run `git diff --name-only` to capture auto-fixed files.

## Output

```markdown
## Precommit (fast)

## Results

| Step | Status | Notes |
|------|--------|-------|
| lint:fix | ✅/❌/⏭️ | skipped if no script |
| test | ✅/❌/⏭️ | skipped if no script |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
