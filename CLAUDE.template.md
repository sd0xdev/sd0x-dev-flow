# {PROJECT_NAME}

## Required Checks (Stop Hook enforced)

| Change Type | Must Run | Can Skip |
|-------------|----------|----------|
| code files | `/codex-review-fast` -> `/precommit` | - |
| `.md` docs | `/codex-review-doc` | `/codex-review-fast` |
| Comments only | - | All |

Before PR: `/pr-review`

## Workflow

```
Feature: develop -> write tests -> /verify -> /codex-review-fast + /codex-test-review -> /precommit -> /pr-review
Bug fix: /issue-analyze -> /bug-fix -> investigate -> fix -> regression test -> /verify -> /codex-review-fast -> /precommit
```

### Auto-Loop Rule

After editing code or docs, you **MUST** run the review command **in the same reply** — do not stop, do not ask, do not just summarize.

| After editing... | Immediately run | Then on pass |
|------------------|----------------|--------------|
| code files | `/codex-review-fast` | `/precommit` |
| `.md` docs | `/codex-review-doc` | (done) |
| Review found issues | Fix all -> re-run same review | - |

**Declaring != Executing**: Saying "should run review" without invoking the Skill tool is a violation.
**Summary != Completion**: Outputting a table then stopping is a violation.

Full spec: @rules/auto-loop.md

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

## Command Quick Reference

| Command | Description | When |
|---------|-------------|------|
| `/codex-brainstorm` | Adversarial brainstorm | Exploration |
| `/feasibility-study` | Feasibility analysis | Requirements |
| `/tech-spec` | Generate tech spec | Design |
| `/review-spec` | Review tech spec | Design |
| `/deep-analyze` | Deep analysis + roadmap | Design |
| `/project-brief` | PM/CTO executive summary | Design |
| `/codex-architect` | Architecture advice | Design |
| `/codex-implement` | Codex writes code | Development |
| `/bug-fix` | Bug fix workflow | Bug fixing |
| `/feature-dev` | Feature development | Development |
| `/code-explore` | Code exploration | Understanding |
| `/git-investigate` | Track code history | Finding source |
| `/issue-analyze` | Issue deep analysis | Root cause |
| `/repo-intake` | One-time project scan | Onboarding |
| `/verify` | Run tests | Development |
| `/codex-review-fast` | Quick review (diff) | **Required** |
| `/codex-review` | Full review (lint+build) | Important PR |
| `/codex-review-branch` | Full branch review | Important PR |
| `/codex-cli-review` | CLI review (full disk) | Deep review |
| `/codex-review-doc` | Review .md files | Doc changes |
| `/codex-explain` | Explain complex code | Understanding |
| `/precommit` | lint + typecheck + test | **Required** |
| `/precommit-fast` | lint + test (no build) | Quick check |
| `/codex-security` | OWASP Top 10 | Security-sensitive |
| `/codex-test-gen` | Generate unit tests | Adding tests |
| `/codex-test-review` | Review test coverage | **Required** |
| `/post-dev-test` | Post-dev test completion | After feature |
| `/check-coverage` | Test coverage analysis | Quality |
| `/dep-audit` | Dependency vulnerability audit | Periodic / PR |
| `/update-docs` | Sync docs with code | Doc changes |
| `/doc-refactor` | Simplify documents | Doc changes |
| `/create-request` | Create/update request docs | Planning |
| `/create-skill` | Create new skills | Tooling |
| `/simplify` | Code simplification | Refactoring |
| `/de-ai-flavor` | Remove AI artifacts | Doc changes |
| `/zh-tw` | Rewrite in Traditional Chinese | i18n |
| `/install-rules` | Install plugin rules to .claude/rules/ | Onboarding |
| `/install-hooks` | Install plugin hooks to .claude/ | Onboarding |
| `/project-setup` | Auto-detect and configure project | Onboarding |
| `/pr-review` | PR self-review checklist | Before PR |

## Development Rules

1. **Reference existing code** -- find similar files first, keep style consistent
2. **Test command** -- `{TEST_COMMAND}`
3. **Author attribution** -- use developer's GitHub username, never AI names
4. **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push`

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

## Rules

- @rules/auto-loop.md -- Auto review loop (highest priority)
- @rules/codex-invocation.md -- Codex must independently research (critical)
- @rules/fix-all-issues.md -- Zero tolerance
- @rules/testing.md
- @rules/framework.md
- @rules/security.md
- @rules/docs-writing.md
- @rules/docs-numbering.md
- @rules/git-workflow.md
- @rules/logging.md
