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
  - If runner emits `## Overall: ⚠️ NO CHECKS RUN`, do **NOT** treat it as a pass — fall through to Step 2 ecosystem detection to run the project's real checks. The marker means **no project validation executed and no policy step failed** (validation steps all skipped or `unavailable`; a policy step that FAILS is `❌ FAIL`, never this marker) — whether the repo declares no runnable checks or the required tools were unavailable to the runner (which orchestrates the ecosystem table below itself: manifest detection + first-class steps). The runner self-notes its own verdict (`review-state.js note precommit pass|fail`); on `⚠️ NO CHECKS RUN` it notes nothing — the slot is untouched and the reminder persists, which is the correct reading of "nothing validated".
  - If runner **fails** (`## Overall: ❌ FAIL`), treat as a real precommit failure (do not silently fallback).
- **NOT found** → **Auto-install attempt**:
  1. **Manifest gate**: Use Glob to check if any known manifest exists (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `build.gradle`, `build.gradle.kts`, `pom.xml`, `Gemfile`). None → skip, fall through to Step 2. (The runner orchestrates every ecosystem in the Step 2 table, so a non-Node manifest justifies the install just as well.)
  2. **Locate plugin scripts**: 3-level Glob fallback (short-circuit on first match):
     - `Glob: ~/.claude/plugins/**/sd0x-dev-flow/scripts/precommit-runner.js`
     - `Glob: ${REPO_ROOT}/node_modules/sd0x-dev-flow/scripts/precommit-runner.js`
     - Plugin-relative: try reading `@scripts/precommit-runner.js`
  3. **Plugin not found** → fall through to Step 2.
  4. **Plugin found** → copy runner + lib/utils.js + review-state.js + lib/tree-digest.js (skip on conflict) → run. The checker pair is the runner's self-note dependency — without it the runner still runs every check and reports; only the advisory note is skipped, loudly.

### Step 2: Fallback (no runner script)

Detect the project ecosystem to run steps manually.

| Manifest | Ecosystem | Lint-fix | Test |
|----------|-----------|----------|------|
| `package.json` | Node.js | `{pm} lint:fix` | `{pm} test:fast` / `test:unit` / `test` |
| `pyproject.toml` | Python | `ruff check --fix .` | `pytest tests/unit/` |
| `Cargo.toml` | Rust | `cargo clippy --fix` | `cargo test` |
| `go.mod` | Go | `golangci-lint run --fix` | `go test ./...` |
| `build.gradle` / `build.gradle.kts` | Java | `./gradlew spotlessApply` | `./gradlew test` |
| `pom.xml` | Java (Maven) | `mvn spotless:apply` | `mvn test` |
| `Gemfile` | Ruby | `bundle exec rubocop -a` | `bundle exec rspec` |

> **How the runner executes this table**: same semantics as `skills/precommit/SKILL.md` § Ecosystem detection — a missing required tool is `unavailable` and blocks ✅ PASS; repo-declared capabilities (spotless / rubocop / rspec) skip only on **definitive tool-native absence evidence** (lockfile membership, the tool's own not-found diagnostic); an ambiguous or timed-out probe is `unavailable`, never a skip.

After lint:fix completes, run `git diff --name-only` to capture auto-fixed files.

**After a conclusive fallback run, self-note the outcome** — `note precommit pass` when every
executed check passed, `note precommit fail` when the checks ran and at least one failed (the
`rounds` count stays path-independent):

```bash
CHECKER=".claude/scripts/review-state.js"; [ -f "$CHECKER" ] || CHECKER="scripts/review-state.js"
node "$CHECKER" note precommit pass   # or fail
```

An **inconclusive** run (checks could not execute) notes nothing — the slot stays untouched, like
the runner's `⚠️ NO CHECKS RUN`. The note is advisory; a failed note never fails the run.

## Output

```markdown
## Precommit (fast)

## Results

| Step | Status | Notes |
|------|--------|-------|
| lint:fix | ✅/❌/⏭️/⛔ | ⏭️ = repo opted out (skip); ⛔ = required tool unavailable (blocks PASS) |
| test | ✅/❌/⏭️/⛔ | same legend |

## Changed Files (after lint:fix)

- <files or "(none)">

## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN (no project validation executed AND no policy step failed; fall through to Step 2, needs human if nothing runnable exists)

## Checklist

- [ ] All available checks pass
- [ ] git status reviewed
```
