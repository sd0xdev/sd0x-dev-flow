# sd0x-dev-flow

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

### Auto-Loop Rule ⚠️

After editing code or docs, you **MUST** run the review command **in the same reply** — do not stop, do not ask, do not just summarize.

| After editing... | Immediately run | Then on pass |
|------------------|----------------|--------------|
| code files | `/codex-review-fast` | `/precommit` |
| `.md` docs | `/codex-review-doc` | (done) |
| Review found issues | Fix all → re-run same review | — |

**Declaring ≠ Executing**: Saying "should run review" without invoking the Skill tool is a violation.
**Summary ≠ Completion**: Outputting a table then stopping is a violation.

Full spec: @rules/auto-loop.md

## Test Requirements

| Change Type | Required Tests | File Mapping |
|-------------|---------------|--------------|
| New script/skill | `test/` required | `scripts/xxx.sh` -> `test/scripts/xxx.test.js` |
| Modify existing logic | Existing pass + new logic | `commands/*.md` -> `test/commands/*.test.js` |
| Bug fix | Regression test | - |

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
| `/feature-verify` | Feature verification (READ-ONLY) | Development |
| `/code-explore` | Code exploration | Understanding |
| `/code-investigate` | Dual-perspective code investigation | Understanding |
| `/git-investigate` | Track code history | Finding source |
| `/issue-analyze` | Issue deep analysis | Root cause |
| `/repo-intake` | One-time project scan | Onboarding |
| `/next-step` | Change-aware next step advisor | Development |
| `/risk-assess` | Uncommitted code risk assessment | Development |
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
| `/project-audit` | Project health audit with scoring | Quality |
| `/best-practices` | Industry best practices audit | Quality |
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
| `/install-scripts` | Install plugin scripts to .claude/scripts/ | Onboarding |
| `/project-setup` | Auto-detect and configure project | Onboarding |
| `/claude-health` | Claude Code config health check | Onboarding |
| `/pr-review` | PR self-review checklist | Before PR |
| `/smart-commit` | Smart batch commit (group + message + commands) | Git |
| `/push-ci` | Push (with approval) + CI monitor | Git |
| `/create-pr` | Create GitHub PR from branch | Git |
| `/git-worktree` | Manage git worktrees | Git |
| `/smart-rebase` | Smart partial rebase (squash-merge repos) | Git |
| `/pr-summary` | PR status summary (grouped by ticket) | Git |
| `/contract-decode` | EVM contract error/calldata decoder | Blockchain |
| `/merge-prep` | Pre-merge analysis and preparation | Git |
| `/obsidian-cli` | Obsidian vault integration via CLI | Tooling |
| `/op-session` | Initialize 1Password CLI session | Tooling |
| `/skill-health-check` | Validate skill quality | Tooling |

## Development Rules

1. **Reference existing code** -- find similar files first, keep style consistent
2. **Test command** -- `node --test test/**/*.test.js`
3. **Author attribution** -- use developer's GitHub username, never AI names (exception: `/smart-commit --ai-co-author`)
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
- @rules/self-improvement.md -- Corrected → record → prevent recurrence
