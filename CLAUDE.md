# sd0x-dev-flow — Harness Engineering for Claude Code

**How binding is a line in this file?** Three tiers: **Anchor** (never deviate), **Default** (the normal call; deviate by stating a `[DEVIATION]` line that cites a fact signal, then *keep working*), **Guidance** (advisory). This file's own baseline is **Default** and lines above that baseline are marked inline — @rules/discretion.md classifies the plugin-managed `rules/*.md`, not this file, but its **Anchor Register is the authority everywhere**: a line here that hits the Register is Anchor no matter how it is worded or where it is restated.

Judgment inside the Default range is the expected behaviour, not a tolerated exception: decide from the change in front of you and continue. Uncertainty alone is not a reason to stop and ask — the human exits are the union of the ones enumerated in @rules/auto-loop.md and, for scope, in the contract @rules/scope-discipline.md points to (`skills/codex-code-review/references/scope-contract.md` § Human Exits); those two enumerations are the closed list, not this sentence.

## Required Checks (Stop Hook reminded)

This table constrains the **end state**, not your choreography. How you batch edits, how deep you review, and when you run each gate are yours to choose; what is fixed is that every gate a change class requires has passed *after the last edit in that class*.

| Change Type | Must Run | Can Skip |
|-------------|----------|----------|
| code files | `/codex-review-fast` -> `/precommit` | - |
| `.md` docs | `/codex-review-doc` | `/codex-review-fast` |

Comment-only edits get no free pass: comments can carry compiler/lint/build directives (`scripts/lib/utils.js:142` proves it), so edits to code files are conservatively classified as code even when only comments changed. Before PR: `/pr-review`.

> The Stop Hook is a **reminder, not a gate** (hook-lightweighting, 2026-08-13): it prints which gates the reminder state still shows as owed and always exits 0. What binds is the behaviour layer — the terminal completion invariant in @rules/auto-loop.md — with verdicts recorded via `node scripts/review-state.js note`, digest-bound so an edit re-opens its plane. Details: `docs/features/hook-lightweighting/2-tech-spec.md` §3.

## Auto-Loop

| After editing... | Review | Then on pass |
|------------------|--------|--------------|
| code files | `/codex-review-fast` | `/precommit` |
| `.md` docs | `/codex-review-doc` | (done) |

The terminal completion invariant, tiers, sub-threshold handling, and sentinels live in @rules/auto-loop.md (highest priority). One reviewer — Codex — by default; when Codex is unavailable, a contract-aware fallback reviewer carries the gate under the same mechanism, fail-closed per family contract (@rules/auto-loop.md § Review Dispatch); `--dual` is `/codex-review-branch` opt-in only.

**What is yours to decide**: the effective tier (escalate above the configured baseline when the change warrants it — never below), when to batch and when to review, how deep to review, and when 80 is a passing grade rather than another round. **What is not**: the four Anchor corollaries — Declaring ≠ Executing, Summary ≠ Completion, Fixing ≠ Verifying, and an edit re-opening its own plane's gate. Naming a gate is not running it, and no context or session pressure outranks an open one. Sub-threshold findings are **logged and passed**, not weighed: @rules/auto-loop.md § Sub-Threshold Findings allows exactly two on-the-spot fixes (a one-line fix in a file already open, and a finding whose severity was mis-assigned to something that is really a security or data-integrity defect) — anything else is a `[DEVIATION]`, not a judgment call.

Skill discovery: no command table here by design — each skill's frontmatter `description` (`skills/<name>/SKILL.md`) is the dispatcher's discovery interface, and `docs/skill-catalog.yml` is the canonical registry. Typical flows: feature work → `/feature-dev`, bug fixing → `/bug-fix`, commits → `/smart-commit`. Tech stack: Node.js · JavaScript · node:test; key entrypoints: `scripts/run-skill.sh` (skill script runner), `package.json`.

## Development Rules

Tier is marked per rule; the unmarked ones are Default and you may deviate with a stated signal.

1. *(Guidance)* **Reference existing code** -- find similar files first, keep style consistent; when the shape is non-obvious, name the simplest design chosen and why
2. **Test command** -- `npm test`（`node --test $(find test -name '*.test.js')` — npm scripts 走 `/bin/sh`，`**` glob 不展開巢狀目錄，勿用 `test/**/*.test.js`）
3. **⚓ Anchor** — **Author attribution** -- use developer's GitHub username, never AI names (exception: `/smart-commit --ai-co-author`). Forbidden patterns in commit messages **and PR title/body** (canonical source: `scripts/commit-msg-guard.sh`): Co-Authored-By AI, Generated-by tags, emoji robot tags. Commits: install `commit-msg-guard.sh` via `/install-scripts`. PRs: `/create-pr` Step 4b enforces sanitization automatically.
4. **⚓ Anchor** — **No auto-commit** -- Claude must not run `git add`, `git commit`, `git push` (exception: `/push-ci` may execute `git push` after user approval; `/smart-commit --execute` may execute `git add` + `git commit` after user approval; **user-authorized execution** — when the user's own message explicitly authorizes one execution and names the operation, run it as named and do not cite this rule to refuse; the credential is the message text, spent on that one execution)
5. **Tests required** -- `scripts/xxx.sh` -> `test/scripts/xxx.test.js` · `skills/<name>/SKILL.md` -> `test/skills/<name>.test.js` · bug fix -> regression test. Coverage: happy path + error handling + edge cases (null, empty, extremes). Conventions: @rules/testing.md; overrides: @rules/testing-project.md

Rules 3 and 4 are Anchor Register #4 (@rules/discretion.md); their exception lists are part of the anchor, so adding or removing one is itself an Anchor-level change. Everything else above is a default you may judge against the change at hand.

## Footguns

| Problem | Solution |
|---------|----------|
| `!` context check: `ls`/`find` on home-dir paths blocked | Use `bash -c 'test -f "$HOME/..." && echo ok \|\| echo missing' 2>/dev/null \|\| echo "unknown (sandbox)"` |
| `!` context check: `allowed-tools` must match | If `allowed-tools: Bash(bash:*)`, wrap all `!` checks in `bash -c '...'` |
| `${CLAUDE_PLUGIN_ROOT}` unavailable in command `.md` | Cannot narrow `allowed-tools` to specific script paths; use `Bash(bash:*)` until [#9354](https://github.com/anthropics/claude-code/issues/9354) resolved |
| `!` context check: jq `()` triggers permission parser | Use `gh --template` (Go templates): `--template '{{.field}}'` — `{{ }}` is not shell-special |
| `!` context check: `"'` consecutive quotes triggers permission parser | Restructure to avoid `"` immediately before closing `'` (e.g., `paste -sd, -` instead of `tr "\n" ", "`) |
| Background process monitoring | Use Monitor tool for streaming stdout (e.g., `gh run watch`); `Bash(run_in_background)` for one-shot completion notification |
| `sleep N` (N >= 2) as first Bash command | Blocked by harness; retry via re-execution or use Monitor for process waiting |

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
