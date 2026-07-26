# {PROJECT_NAME}

## Required Checks (Stop Hook enforced)

| Change Type | Must Run | Can Skip |
|-------------|----------|----------|
| code files | `/codex-review-fast` -> `/precommit` | - |
| `.md` docs | `/codex-review-doc` | `/codex-review-fast` |
| Comments only | - | All |

> **What the Stop Hook actually enforces**: that *a* precommit gate ran and passed — not *which* variant. `/precommit-fast` skips the build/typecheck step yet satisfies the gate by default. Two settings are needed to make the full variant above actually binding, and each alone is insufficient:
>
> | Setting | Without it |
> |---------|-----------|
> | `PRECOMMIT_REQUIRE_FULL=1` | a passing `mode: fast` (or an unrecorded mode) satisfies the gate |
> | `STOP_GUARD_MODE=strict` | the default `warn` mode prints the missing step to stderr and **still exits 0** |
>
> With both set, the flag is honoured in both of stop-guard's modes: from `precommit.mode` when `.claude_review_state.json` exists, and from the invoked command name (`/precommit` vs `/precommit-fast`) when it falls back to reading the transcript.
>
> Even with both, the flag gates the **command variant**, not the stages that ran: `/precommit` resolves lint / build / test from whatever your manifest actually defines, so a repo with no build script records `full` with no build behind it. The gate proves which command was invoked; it cannot prove which stages existed to run. `/precommit` prints the resolved stages — read them rather than assuming.

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
| `/req-analyze` | Requirements analysis + 1-requirements.md | Planning |
| `/feasibility-study` | Feasibility analysis | Requirements |
| `/tech-spec` | Generate tech spec | Design |
| `/review-spec` | Review tech spec | Design |
| `/plan-review` | Pre-ExitPlanMode adversarial plan review loop | Planning |
| `/orchestrate` | Agent-driven workflow planning + read-only fanout (report-only v1) | Planning |
| `/deep-analyze` | Deep analysis + roadmap | Design |
| `/architecture` | Architecture design + 3-architecture.md | Design |
| `/project-brief` | PM/CTO executive summary | Design |
| `/fp-brief` | First-principles briefing | Understanding |
| `/tech-brief` | Technical briefing for developer sharing | Understanding |
| `/recap-doc` | Post-development recap document generator | Understanding |
| `/recap-ask` | Recap-bounded Q&A follow-up | Understanding |
| `/post-dev-recap` | Guided post-dev recap (scope + doc + Q&A) | Understanding |
| `/codex-architect` | Architecture advice | Design |
| `/codex-implement` | Codex writes code | Development |
| `/bug-fix` | Bug fix workflow | Bug fixing |
| `/debug` | Interactive debugging | Debugging |
| `/feature-dev` | Feature development | Development |
| `/feature-verify` | Feature verification (READ-ONLY) | Development |
| `/load-pr-review` | Load PR review comments into session | Development |
| `/pr-comment` | Post review comments to PR | Development |
| `/ask` | Context-aware Q&A with auto context gathering | Understanding |
| `/deep-explore` | Multi-wave parallel code exploration | Understanding |
| `/deep-research` | Universal multi-source research orchestration | Understanding |
| `/code-explore` | Code exploration | Understanding |
| `/code-investigate` | Dual-perspective code investigation | Understanding |
| `/git-investigate` | Track code history | Finding source |
| `/issue-analyze` | Issue deep analysis | Root cause |
| `/repo-intake` | One-time project scan | Onboarding |
| `/next-step` | Change-aware next step advisor | Development |
| `/remind` | Lightweight model correction with rule loading | Development |
| `/risk-assess` | Uncommitted code risk assessment | Development |
| `/test-deep` | Context-aware test orchestration | Development |
| `/verify` | Run tests | Development |
| `/codex-review-fast` | Quick review (diff) | **Required** |
| `/codex-review` | Full review (lint+build) | Important PR |
| `/codex-review-branch` | Full branch review | Important PR |
| `/codex-cli-review` | CLI review (full disk) | Deep review |
| `/codex-review-doc` | Review .md files | Doc changes |
| `/seek-verdict` | Independent finding verification (dismiss/confirm/clarify) | Review |
| `/codex-explain` | Explain complex code | Understanding |
| `/precommit` | lint + typecheck + test | **Required** |
| `/precommit-fast` | lint + test (no build) | Quick check |
| `/codex-security` | OWASP Top 10 | Security-sensitive |
| `/codex-test-gen` | Generate unit tests | Adding tests |
| `/codex-test-review` | Review test coverage | **Required** |
| `/post-dev-test` | Post-dev test completion | After feature |
| `/check-coverage` | Test coverage analysis | Quality |
| `/test-health` | Holistic test coverage measurement | Quality |
| `/pre-pr-audit` | Pre-PR confidence audit (5-dimension scoring) | Quality |
| `/project-audit` | Project health audit with scoring | Quality |
| `/best-practices` | Industry best practices conformance audit | Quality |
| `/necessity-audit` | Detect over-engineering in lifecycle specs (6-dim + Codex debate) | Quality |
| `/dep-audit` | Dependency vulnerability audit | Periodic / PR |
| `/generate-runner` | Generate customized precommit runner | Tooling |
| `/update-docs` | Sync docs with code | Doc changes |
| `/doc-refactor` | Simplify documents | Doc changes |
| `/runbook` | Generate/update feature release runbook | Operations |
| `/create-request` | Create/update request docs | Planning |
| `/safe-remove` | Safely remove plugin assets | Tooling |
| `/refactor` | Multi-target refactoring orchestrator | Refactoring |
| `/simplify` | Code simplification | Refactoring |
| `/ui-first-principles` | Scenario → JTBD → field-priority IA reasoning | Design |
| `/de-ai-flavor` | Remove AI artifacts | Doc changes |
| `/zh-tw` | Rewrite in Traditional Chinese | i18n |
| `/install-rules` | Install plugin rules to .claude/rules/ | Onboarding |
| `/install-hooks` | Install plugin hooks to .claude/ | Onboarding |
| `/install-scripts` | Install plugin scripts to .claude/scripts/ | Onboarding |
| `/codex-setup` | Initialize Codex CLI infrastructure (AGENTS.md + hooks) | Onboarding |
| `/project-setup` | Auto-detect and configure project | Onboarding |
| `/claude-health` | Claude Code config health check + plugin sync | Onboarding / After update |
| `/pr-review` | PR self-review checklist | Before PR |
| `/smart-commit` | Smart batch commit (identity/signing diagnostics + group + message + commands) | Git |
| `/bump-version` | Bump package + plugin version in sync | Git |
| `/git-profile` | Git identity and GPG signing profile manager | Git |
| `/push-ci` | Push (with approval) + delegate to /watch-ci | Git |
| `/watch-ci` | Monitor GitHub Actions CI runs | Git |
| `/create-pr` | Create GitHub PR from branch | Git |
| `/smart-rebase` | Smart partial rebase (squash-merge repos) | Git |
| `/epic-merge` | Sequential squash-merge of stacked PR chains into epic branch | Git |
| `/pr-summary` | PR status summary (grouped by ticket) | Git |
| `/contract-decode` | EVM contract error/calldata decoder | Blockchain |
| `/jira` | Jira integration (view/branch/transition) | Jira workflow |
| `/merge-prep` | Pre-merge analysis and preparation | Git |
| `/obsidian-cli` | Obsidian vault integration via CLI | Tooling |
| `/op-session` | Initialize 1Password CLI session | Tooling |
| `/sharingan` | Analyze external repos + generate skills | Tooling |
| `/skill-health-check` | Validate skill quality | Tooling |
| `/statusline-config` | Customize statusline segments and themes | Tooling |

## Development Rules

1. **Reference existing code** -- find similar files first, keep style consistent
2. **Test command** -- `{TEST_COMMAND}`
3. **Author attribution** -- use developer's GitHub username, never AI names (exception: `/smart-commit --ai-co-author`). Forbidden patterns in commit messages: `Co-Authored-By:.*Claude`, `Co-Authored-By:.*Anthropic`, `Generated with.*Claude`, `🤖.*Claude`. Install `commit-msg-guard.sh` via `/install-scripts` for programmatic enforcement.
4. **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push` (exception: `/push-ci` may execute `git push` after user approval; `/smart-commit --execute` may execute `git add` + `git commit` after user approval)

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

- @rules/auto-loop.md -- Auto review loop (highest priority)
- @rules/auto-loop-project.md -- Project-specific auto-loop overrides (user-owned)
- @rules/codex-invocation.md -- Codex must independently research (critical)
- @rules/fix-all-issues.md -- Zero tolerance
- @rules/testing.md
- @rules/framework.md
- @rules/security.md
- @rules/docs-writing.md
- @rules/docs-numbering.md
- @rules/git-workflow.md
- @rules/logging.md
- @rules/self-improvement.md -- Corrected → record → prevent recurrence
- @rules/context-management.md -- Data-driven context monitoring (measure before deciding)
