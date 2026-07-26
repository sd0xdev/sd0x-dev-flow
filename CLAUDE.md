# sd0x-dev-flow — Harness Engineering for Claude Code

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
> With both set, the flag is honoured in **both** of stop-guard's modes: from `precommit.mode` when a state file exists, and from the invoked command name (`/precommit` vs `/precommit-fast`) in the transcript fallback. The fallback arm ships with the same change as this note — before it, the flag was state-file-only, so a session without a readable state file (the degraded path where an unproven verdict is least affordable) silently accepted the fast gate. Verify rather than assume: `grep -c PRECOMMIT_REQUIRE_FULL hooks/stop-guard.sh` should report 4, and a checkout predating this change reports 0.
>
> Even with both, the flag gates the **command variant**, not the stages that ran: a repo with no build script records `full` with no typecheck behind it. See `docs/features/precommit-tiering/2-tech-spec.md` §6.

Before PR: `/pr-review`

## Workflow

```
Feature: develop -> write tests -> /verify -> /codex-review-fast + /codex-test-review -> /precommit -> /pr-review
Bug fix: /issue-analyze -> /bug-fix -> investigate -> fix -> regression test -> /verify -> /codex-review-fast -> /precommit
```

### Auto-Loop Rule ⚠️

After editing code or docs, you **MUST** run the review command **in the same reply** — do not stop, do not ask, do not just summarize.

| After editing... | Immediately run | Then on pass |
|------------------|----------------|--------------|
| code files | `/codex-review-fast` | `/precommit` |
| `.md` docs | `/codex-review-doc` | (done) |
| Review found **blocking** issues | Fix all → re-run same review | — |
| Review found **sub-threshold** issues | Log `[NIT_DEFERRED]`, do not re-review | continue to the "Then on pass" column |

One reviewer — Codex. `/codex-review-fast` and `/codex-review-doc` do not launch a secondary; `/codex-review-branch --dual` is the only code-review entry point where two reviewers run, and it is off unless the flag is passed. (`/plan-review --dual` is the plan-mode equivalent, also off by default.)

What counts as blocking comes from the **tier** (`fast` P0 · `standard` P0/P1 · `thorough` P0/P1/P2). Unset means `standard`. **80 is a passing grade** — reach for `thorough` when the change is security, data integrity, a release, or public API, not by default.

**Declaring ≠ Executing**: Saying "should run review" without invoking the Skill tool is a violation.
**Summary ≠ Completion**: Outputting a table then stopping is a violation.

Full spec: @rules/auto-loop.md (§ Tiers, § Sub-Threshold Findings)

## Test Requirements

| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New script/skill | `test/` required | `scripts/xxx.sh` -> `test/scripts/xxx.test.js` |
| Modify existing logic | Existing pass + new logic | `skills/<name>/SKILL.md` -> `test/skills/<name>.test.js` |
| Bug fix | Regression test | - |

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
2. **Test command** -- `npm test`（`node --test $(find test -name '*.test.js')` — npm scripts 走 `/bin/sh`，`**` glob 不展開巢狀目錄，勿用 `test/**/*.test.js`）
3. **Author attribution** -- use developer's GitHub username, never AI names (exception: `/smart-commit --ai-co-author`). Forbidden patterns in commit messages **and PR title/body** (canonical source: `scripts/commit-msg-guard.sh`): Co-Authored-By AI, Generated-by tags, emoji robot tags. Commits: install `commit-msg-guard.sh` via `/install-scripts`. PRs: `/create-pr` Step 4b enforces sanitization automatically.
4. **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push` (exception: `/push-ci` may execute `git push` after user approval; `/smart-commit --execute` may execute `git add` + `git commit` after user approval)

## Tech Stack

Node.js . JavaScript . node:test

## Key Entrypoints

| File | Purpose |
|------|---------|
| `scripts/run-skill.sh` | Skill script runner |
| `package.json` | Project config |

## Footguns

| Problem | Solution |
|---------|----------|
| `!` context check: `ls`/`find` on home-dir paths blocked | Use `bash -c 'test -f "$HOME/..." && echo ok \|\| echo missing' 2>/dev/null \|\| echo "unknown (sandbox)"` |
| `!` context check: `allowed-tools` must match | If `allowed-tools: Bash(bash:*)`, wrap all `!` checks in `bash -c '...'` |
| `${CLAUDE_PLUGIN_ROOT}` unavailable in command `.md` | Cannot narrow `allowed-tools` to specific script paths; use `Bash(bash:*)` until [#9354](https://github.com/anthropics/claude-code/issues/9354) resolved |
| `!` context check: jq `()` triggers permission parser | Use `gh --template` (Go templates): `--template '{{.field}}'` — `{{ }}` is not shell-special |
| Background process monitoring | Use Monitor tool for streaming stdout (e.g., `gh run watch`); `Bash(run_in_background)` for one-shot completion notification |
| `sleep N` (N >= 2) as first Bash command | Blocked by harness; retry via re-execution or use Monitor for process waiting |

## Rules

- @rules/auto-loop.md -- Auto review loop (highest priority)
- @rules/auto-loop-project.md -- Project-specific auto-loop overrides (user-owned)
- @rules/codex-invocation.md -- Codex must independently research (critical)
- @rules/fix-all-issues.md -- Zero tolerance
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
