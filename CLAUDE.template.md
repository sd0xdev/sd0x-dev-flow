# {PROJECT_NAME}

**How binding is a line in this file?** Three tiers: **Anchor** (never deviate), **Default** (the normal call; deviate by stating a `[DEVIATION]` line that cites a fact signal, then *keep working*), **Guidance** (advisory). This file's own baseline is **Default** and lines above that baseline are marked inline -- @rules/discretion.md classifies the plugin-managed `rules/*.md`, not this file, but its **Anchor Register is the authority everywhere**: a line here that hits the Register is Anchor no matter how it is worded or where it is restated.

Judgment inside the Default range is the expected behaviour, not a tolerated exception: decide from the change in front of you and continue. Uncertainty alone is not a reason to stop and ask -- the human exits are the union of the ones enumerated in @rules/auto-loop.md and, for scope, in the contract @rules/scope-discipline.md points to (`skills/codex-code-review/references/scope-contract.md` § Human Exits); those two enumerations are the closed list, not this sentence.

## Required Checks (Stop Hook reminded)

This table constrains the **end state**, not your choreography. How you batch edits, how deep you review, and when you run each gate are yours to choose; what is fixed is that every gate a change class requires has passed *after the last edit in that class*.

| Change Type | Must Run | Can Skip |
|-------------|----------|----------|
| code files | `/codex-review-fast` -> `/precommit` | - |
| `.md` docs | `/codex-review-doc` | `/codex-review-fast` |

Comment-only edits get no free pass: comments can carry compiler/lint/build directives, so edits to code files are conservatively classified as code even when only comments changed.

> **What the Stop Hook actually does** (hook-lightweighting, 2026-08-13): it is a **reminder, not a gate** — it prints which gates the reminder state still shows as owed and always exits 0. Verdicts are recorded via `node scripts/review-state.js note <plane> <pass|fail>` (installed projects: `.claude/scripts/review-state.js`), bound to the tree digest, so an edit re-opens its plane's reminder. What binds is the behaviour layer — the terminal completion invariant in @rules/auto-loop.md. One caveat carried over from the enforcement era still holds: a recorded precommit pass proves the command ran, not which stages existed to run — `/precommit` resolves lint / build / test from whatever your manifest actually defines, and it prints the resolved stages; read them rather than assuming.

Before PR: `/pr-review`

## Workflow

Reference shapes, not scripts — deviate when the change calls for it:

```
Feature: develop -> write tests -> /verify -> /codex-review-fast + /codex-test-review -> /precommit -> /pr-review
Bug fix: /issue-analyze -> /bug-fix -> investigate -> fix -> regression test -> /verify -> /codex-review-fast -> /precommit
```

### Auto-Loop

| After editing... | Review | Then on pass |
|------------------|--------|--------------|
| code files | `/codex-review-fast` | `/precommit` |
| `.md` docs | `/codex-review-doc` | (done) |

The terminal completion invariant, tiers, sub-threshold handling, and sentinels live in @rules/auto-loop.md (highest priority). One reviewer — Codex — by default; when Codex is unavailable, a contract-aware fallback reviewer carries the gate under the same mechanism, fail-closed per family contract (@rules/auto-loop.md § Review Dispatch); `--dual` is `/codex-review-branch` opt-in only.

**What is yours to decide**: the effective tier (escalate above the configured baseline when the change warrants it -- never below), when to batch and when to review, how deep to review, and when 80 is a passing grade rather than another round. **What is not**: the four Anchor corollaries -- Declaring != Executing, Summary != Completion, Fixing != Verifying, and an edit re-opening its own plane's gate. Naming a gate is not running it, and no context or session pressure outranks an open one. Sub-threshold findings are **logged and passed**, not weighed: @rules/auto-loop.md § Sub-Threshold Findings allows exactly two on-the-spot fixes (a one-line fix in a file already open, and a finding whose severity was mis-assigned to something that is really a security or data-integrity defect) -- anything else is a `[DEVIATION]`, not a judgment call.

## Test Requirements

<!-- block:node-ts -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New Service/Provider | `test/unit/` required | `src/service/xxx.ts` -> `test/unit/service/xxx.test.ts` |
| Modify existing logic | Existing pass + new logic | `src/provider/*.ts` -> `test/unit/provider/*.test.ts` |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `src/controller/*.ts` -> `test/integration/controller/*.test.ts` |
<!-- /block -->

<!-- block:python -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New module | Unit test required | `src/module.py` -> `tests/unit/test_module.py` |
| Modify existing logic | Existing pass + new logic | `src/*.py` -> `tests/unit/test_*.py` |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `src/routes/*.py` -> `tests/integration/test_*.py` |
<!-- /block -->

<!-- block:go -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New package | Unit test required | `pkg/xxx/xxx.go` -> `pkg/xxx/xxx_test.go` |
| Modify existing logic | Existing pass + new logic | `*.go` -> `*_test.go` (same package) |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `handler/*.go` -> `handler/*_test.go` |
<!-- /block -->

<!-- block:rust -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New module | Unit test required | `src/xxx.rs` -> `#[cfg(test)] mod tests` in same file or `tests/` |
| Modify existing logic | Existing pass + new logic | Same module `#[test]` functions |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `src/routes/*.rs` -> `tests/` integration tests |
<!-- /block -->

<!-- block:ruby -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New class | Unit test required | `lib/xxx.rb` -> `spec/unit/xxx_spec.rb` |
| Modify existing logic | Existing pass + new logic | `lib/*.rb` -> `spec/unit/*_spec.rb` |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `app/controllers/*.rb` -> `spec/requests/*_spec.rb` |
<!-- /block -->

<!-- block:java -->
| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New class | Unit test required | `src/main/.../Xxx.java` -> `src/test/.../XxxTest.java` |
| Modify existing logic | Existing pass + new logic | Same test class |
| Bug fix | Regression test | - |
| New API endpoint | Unit + Integration | `src/main/.../XxxController.java` -> `src/test/.../XxxControllerTest.java` |
<!-- /block -->

Coverage: happy path + error handling + edge cases (null, empty, extremes)

## Skill Discovery

There is no command table here by design: each skill's frontmatter `description` (`skills/<name>/SKILL.md`) is the dispatcher's discovery interface, and the plugin's `docs/skill-catalog.yml` is the canonical registry. Typical flows: feature work -> `/feature-dev`, bug fixing -> `/bug-fix`, commits -> `/smart-commit`.

## Development Rules

Tier is marked per rule; the unmarked ones are Default and you may deviate with a stated signal.

1. *(Guidance)* **Reference existing code** -- find similar files first, keep style consistent; when the shape is non-obvious, name the simplest design chosen and why
2. **Test command** -- `{TEST_COMMAND}`
3. **Anchor** -- **Author attribution** -- use developer's GitHub username, never AI names (exception: `/smart-commit --ai-co-author`). Forbidden patterns in commit messages **and PR title/body** (canonical source: `scripts/commit-msg-guard.sh`): Co-Authored-By AI, Generated-by tags, emoji robot tags. Commits: install `commit-msg-guard.sh` via `/install-scripts`. PRs: `/create-pr` Step 4b enforces sanitization automatically.
4. **Anchor** -- **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push` (exception: `/push-ci` may execute `git push` after user approval; `/smart-commit --execute` may execute `git add` + `git commit` after user approval)

Rules 3 and 4 are Anchor Register #4 (@rules/discretion.md); their exception lists are part of the anchor, so adding or removing one is itself an Anchor-level change.

## Tech Stack

<!-- block:node-ts -->
{FRAMEWORK} . TypeScript . {DATABASE} . Redis . Jest
<!-- /block -->
<!-- block:python -->
{FRAMEWORK} . Python . {DATABASE}
<!-- /block -->
<!-- block:go -->
Go . {DATABASE}
<!-- /block -->
<!-- block:rust -->
Rust . {DATABASE}
<!-- /block -->
<!-- block:ruby -->
{FRAMEWORK} . Ruby . {DATABASE}
<!-- /block -->
<!-- block:java -->
{FRAMEWORK} . Java . {DATABASE}
<!-- /block -->

## Key Entrypoints

<!-- block:node-ts -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | DI config |
| `{BOOTSTRAP_FILE}` | Bootstrap entry |
<!-- /block -->
<!-- block:python -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | App config |
| `{BOOTSTRAP_FILE}` | Entry point |
<!-- /block -->
<!-- block:go -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | App config |
| `{BOOTSTRAP_FILE}` | Entry point (main.go) |
<!-- /block -->
<!-- block:rust -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | App config |
| `{BOOTSTRAP_FILE}` | Entry point (main.rs) |
<!-- /block -->
<!-- block:ruby -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | App config |
| `{BOOTSTRAP_FILE}` | Entry point |
<!-- /block -->
<!-- block:java -->
| File | Purpose |
|------|---------|
| `{CONFIG_FILE}` | App config |
| `{BOOTSTRAP_FILE}` | Entry point (Application.java) |
<!-- /block -->

## Footguns

<!-- block:node-ts -->
| Problem | Solution |
|---------|----------|
| Circular dependency | Lazy loading getter |
| Provider Scope | `@Scope(Prototype)` |
| TEST_ENV | Must set `unit`/`integration`/`e2e` |
<!-- /block -->
<!-- block:python -->
| Problem | Solution |
|---------|----------|
| Circular imports | Import inside function |
| Virtualenv not activated | Use `python -m pytest` |
<!-- /block -->
<!-- block:go -->
| Problem | Solution |
|---------|----------|
| Import cycle | Interface in separate package |
| Test isolation | Use `t.Parallel()` carefully |
<!-- /block -->
<!-- block:rust -->
| Problem | Solution |
|---------|----------|
| Borrow checker | Clone or restructure ownership |
| Async runtime | Ensure single runtime instance |
<!-- /block -->
<!-- block:ruby -->
| Problem | Solution |
|---------|----------|
| Load order | Use autoloading (Zeitwerk) |
| Gem conflicts | Use Bundler, check Gemfile.lock |
<!-- /block -->
<!-- block:java -->
| Problem | Solution |
|---------|----------|
| Circular dependency | Constructor injection + interfaces |
| Bean scope | Check `@Scope` annotations |
<!-- /block -->

### Command Template Sandbox Rules

| Problem | Solution |
|---------|----------|
| `!` context check: `ls`/`find` on home-dir paths blocked | Use `bash -c 'test -f "$HOME/..." && echo ok \|\| echo missing' 2>/dev/null \|\| echo "unknown (sandbox)"` |
| `!` context check: `allowed-tools` must match | If `allowed-tools: Bash(bash:*)`, wrap all `!` checks in `bash -c '...'` |
| `${CLAUDE_PLUGIN_ROOT}` unavailable in command `.md` | Cannot narrow `allowed-tools` to specific script paths; use `Bash(bash:*)` until [#9354](https://github.com/anthropics/claude-code/issues/9354) resolved |
| Background process monitoring | Use Monitor tool for streaming stdout (e.g., `gh run watch`); `Bash(run_in_background)` for one-shot completion notification |
| `sleep N` (N >= 2) as first Bash command | Blocked by harness; retry via re-execution or use Monitor for process waiting |

## Customization

Replace these placeholders with your project values:

| Placeholder | Your Value |
|-------------|------------|
| `{PROJECT_NAME}` | Your project name |
| `{FRAMEWORK}` | MidwayJS 3.x / NestJS / Express / Django / FastAPI / Gin / Actix / Rails / Spring Boot |
| `{CONFIG_FILE}` | src/configuration.ts / settings.py / config.yaml |
| `{BOOTSTRAP_FILE}` | bootstrap.js / main.py / main.go / main.rs |
| `{DATABASE}` | MongoDB / PostgreSQL / MySQL / SQLite |
| `{TEST_COMMAND}` | yarn test:unit / pytest / go test / cargo test |
| `{LINT_FIX_COMMAND}` | yarn lint:fix / ruff check --fix / golangci-lint run --fix |
| `{BUILD_COMMAND}` | yarn build / cargo build / go build |
| `{TYPECHECK_COMMAND}` | yarn typecheck / mypy . / (implicit for compiled languages) |
| `{TICKET_PATTERN}` | Ticket ID regex in branch names (e.g. `[A-Z]+-\d+`) |
| `{ISSUE_TRACKER_URL}` | Issue tracker browse URL (e.g. `https://jira.example.com/browse/`) |
| `{TARGET_BRANCH}` | Default PR/merge target branch (e.g. `main` or `develop`) |

## Rules

- @rules/discretion.md -- **Read this first**: Anchor / Default / Guidance, the Anchor Register, and how to deviate
- @rules/auto-loop.md -- Auto review loop (highest priority)
- @rules/auto-loop-project.md -- Project-specific auto-loop overrides (user-owned)
- @rules/codex-invocation.md -- Codex must independently research (critical)
- @rules/fix-all-issues.md -- Zero tolerance for blocking findings; sub-threshold ones are logged, not fixed
- @rules/scope-discipline.md -- Scope axis orthogonal to severity; out-of-scope pre-existing defects get a recorded exit, not a repo-wide sweep
- @rules/testing.md -- Test pyramid, conventions, evidence model, adequacy gate
- @rules/testing-project.md -- Project-specific testing overrides (user-owned)
- @rules/framework.md
- @rules/security.md
- @rules/docs-writing.md
- @rules/docs-numbering.md
- @rules/git-workflow.md
- @rules/logging.md
- @rules/self-improvement.md -- Corrected → record → prevent recurrence
- @rules/context-management.md -- Data-driven context monitoring (measure before deciding)
