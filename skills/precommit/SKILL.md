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
| comment_blocks | Reject over-long comment blocks (`@rules/docs-writing.md` § Code Comments) | read-only | yes |
| lint-fix | Auto-fix code style issues | read-write | yes |
| build | Verify compilation succeeds | read-only | yes |
| test-unit | Run full test suite | read-only | yes |

**Failure behavior**: continue-all (run all steps, report all results)

`comment_blocks` is a **policy** step, and the asymmetry is deliberate (`POLICY_STEPS` in `scripts/precommit-runner.js`): it can FAIL the run, but it never counts as "validation ran". A run where policy was the only thing that executed still reports `⚠️ NO CHECKS RUN`, so a repo whose real checks are pytest/cargo cannot bank a `✅ PASS` on a passing comment scan alone. It runs first because it is static and cheap.

## Task

Run pre-commit checks: **lint:fix -> build -> test**

### Step 1: Check for runner script

Use Glob to check if `.claude/scripts/precommit-runner.js` exists in the project root.

- **Found** → run: `node .claude/scripts/precommit-runner.js --mode full --tail 80`
  - If runner emits `## Overall: ✅ PASS`, use its output and skip to the Output section.
  - If runner emits `## Overall: ⚠️ NO CHECKS RUN`, do **NOT** treat it as a pass — fall through to Step 2 ecosystem detection so the project's real checks run. The marker means **no project validation executed and no policy step failed** — every validation step was a skip or `unavailable`, and any policy step (comment_blocks) either skipped or passed (a FAILING policy step is `❌ FAIL`, never this marker — line 30's asymmetry) — whether because the repo declares no runnable checks or because the required tools were not available to the runner (which orchestrates the ecosystem table below itself: it detects pyproject.toml/Cargo.toml/go.mod/… and runs those checks as first-class steps). Since WB5b the **runner's own append is the only receipt source** (spec § 3.6): the legacy Skill/Bash slash-form parsing retired once WB2b folded the ecosystem fallbacks into the runner, so a Step 2 fallback run mints **no** receipt at all and the gate stays open until the runner itself executes. This is fail-closed: an all-skip run never satisfies the gate on its own.
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
| `build.gradle` / `build.gradle.kts` | Java (Gradle) | `./gradlew spotlessApply` | `./gradlew build` | `./gradlew test` |
| `pom.xml` | Java (Maven) | `mvn spotless:apply` | `mvn compile` | `mvn test` |
| `Gemfile` | Ruby | `bundle exec rubocop -a` | — | `bundle exec rspec` |

> **How the runner executes this table** (WB2b): a **required tool** missing from the environment (ruff, pytest, cargo, go, golangci-lint, mvn, bundle, the gradle wrapper — the runner never falls back to a global `gradle`) marks that step `unavailable`, which **blocks ✅ PASS** — incomplete validation must not let a sibling check mint the receipt. A **repo-declared capability** absent is an ordinary skip, but only on **definitive non-membership evidence** — never a manifest grep, and never an ambiguous probe failure (broken build config, broken task, network-dependent resolution), which stays `unavailable`: Ruby rubocop/rspec membership is read from `Gemfile.lock` text — rspec counts `rspec` or its executable provider `rspec-core` — after `bundle check` passes (a failing `bundle check` or unreadable lockfile is `unavailable`); Gradle spotless skips only on Gradle's own `Task 'spotlessApply' not found` diagnostic from `gradlew help --task spotlessApply` (a marker-less failure is `unavailable` — Gradle realizes tasks lazily, so a configured-but-broken task fails the probe exactly like an absent one); Maven spotless skips only on the `No plugin found for prefix` marker from `mvn help:describe -Dplugin=spotless` — any other failure is `unavailable`. All probes are bounded (`PRECOMMIT_PROBE_TIMEOUT_MS`, default 120s; output capped) and logged; a probe timeout is `unavailable`, never a skip. Python tests run `pytest tests/unit/` when that directory exists, else bare `pytest` (config-driven discovery — a repo with no tests fails loudly on exit 5 instead of silently skipping). Clippy runs with `--allow-dirty --allow-staged`: precommit operates on a dirty tree by definition.

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
| lint:fix | ✅/❌/⏭️/⛔ | ⏭️ = repo opted out (skip); ⛔ = required tool unavailable (blocks PASS) |
| build | ✅/❌/⏭️/⛔ | same legend |
| test | ✅/❌/⏭️/⛔ | same legend |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN (no project validation executed AND no policy step failed — validation steps all skipped/unavailable, policy steps skipped or passed; fall through to Step 2, needs human if nothing runnable exists)

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
