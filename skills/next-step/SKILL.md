---
name: next-step
description: "Context-aware next step advisor. Use when: user asks what to do next, workflow progression is unclear, session just started with dirty worktree. Not for: executing the suggested command (user decides), auto-loop decisions (hooks handle that). Output: 1-3 prioritized suggestions with reasoning."
---

# Next Step Advisor

## When NOT to Use

- Auto-loop already handling review/precommit flow (hooks track and assist)
- User gave a clear, specific instruction (just do it)
- Mid-execution of a skill workflow (follow that skill's progression)

## Procedure

1. Collect context signals (stop when enough to decide)
2. Determine work type from branch name or conversation
3. Identify current phase from executed commands and state
4. Output 1-3 prioritized suggestions

## Context Signals

Collect in order, stop when enough to decide:

| # | Signal | How | Purpose |
|---|--------|-----|---------|
| 1 | Conversation history | Review current session | What commands ran, what passed/failed |
| 2 | Git branch | `git branch --show-current` | Work type (feat/fix/docs/refactor) |
| 3 | Git status | `git status -sb` | Uncommitted changes? |
| 4 | Changed files | `git diff --name-only` | .ts/.js vs .md vs mixed |
| 5 | Review state | `.claude_review_state.json` | Review/precommit progress |
| 6 | Feature docs | `docs/features/<feature>/` | tech-spec/request completeness |

## Decision Matrix

### Work Type Detection

| Branch Pattern | Work Type |
|----------------|-----------|
| `feat/*` | feature-dev |
| `fix/*`, `hotfix/*` | bug-fix |
| `docs/*` | documentation |
| `refactor/*`, `perf/*` | refactor |
| `chore/*`, `ci/*`, `test/*` | Infer from conversation |
| No pattern / `release/*` | Infer from conversation |

### Feature Development Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/codex-architect` or `/feasibility-study` (large feature) |
| Architecture designed | `/codex-implement` or manual coding |
| Code written, no tests | Write tests, then `/verify` |
| `/verify` pass | `/codex-review-fast` + `/codex-test-review` |
| `/verify` fail | Fix failing tests, re-run `/verify` |
| `/codex-review-fast` fail | Fix issues (auto-loop handles this) |
| `/codex-test-review` fail | Fix test gaps, re-run `/codex-test-review` |
| `/codex-review-fast` + `/codex-test-review` pass | `/precommit` |
| `/precommit` pass | Doc Sync (confirm no new code edit first), then manual commit |
| `/precommit` fail | Fix issues, re-run |
| Doc Sync done | `git add && git commit`, then `/pr-review` |
| All gates pass | Create PR via `gh pr create` |

### Bug Fix Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/issue-analyze` or `/bug-fix` |
| Root cause identified | Fix code + write regression test |
| Fix applied | `/verify` |
| `/verify` pass | `/codex-review-fast` |
| `/verify` fail | Fix tests, re-run `/verify` |
| `/codex-review-fast` pass | `/precommit` |
| `/precommit` pass | Manual commit (Doc Sync only if `docs/features/` mapping exists) |

### Documentation Work

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/tech-spec` or `/update-docs` |
| Docs written/updated | `/codex-review-doc` |
| `/codex-review-doc` pass | Manual commit |
| `/codex-review-doc` fail | Fix, re-review |

### Refactoring

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/code-explore` to understand current state |
| Understood | `/simplify` |
| Refactored | `/verify` → `/codex-review-fast` → `/precommit` |

### Investigation (no code changes expected)

| Situation | Suggest |
|-----------|---------|
| Want to understand code | `/code-explore` |
| Track a specific change | `/git-investigate` |
| Analyze a GitHub issue | `/issue-analyze` |
| Need architecture advice | `/codex-architect` or `/codex-brainstorm` |
| Evaluate feasibility | `/feasibility-study` |

## Document Completeness Check

When a feature directory exists in `docs/features/`, cross-check document pairs:

| State | Suggest |
|-------|---------|
| tech-spec exists, no request | `/create-request` |
| request exists, no tech-spec | `/tech-spec` |
| Both exist, code changed | `/update-docs` + `/create-request --update` |
| Neither exists, requirements clear | `/tech-spec` first, then `/create-request` |
| tech-spec just completed (this session) | `/create-request` immediately |

Detection: scan `docs/features/<feature>/` for `*tech-spec*` and `requests/*.md`.

**Scope**: Only check current feature (inferred from branch + changed files). Supports `<feature>/`, `<feature>/<subfeature>/`, and global `docs/features/requests/`. When no clear match, suggest "confirm doc structure" instead of forcing a command.

## Non-Command Suggestions

When the best next step is NOT a slash command:

| Signal | Suggest |
|--------|---------|
| Requirements unclear or ambiguous | "Confirm requirements with PM/user before proceeding" |
| Large scope, no issue/spec | "Open issue or write tech-spec to align scope" |
| Affects other services/APIs | "Confirm upstream/downstream API contracts" |
| Security-sensitive change | `/codex-security` before proceeding |
| All gates pass, branch ready | "Manual git add && commit, prepare PR" |
| PR ready | "Push to remote, open PR for review" |
| No clear task | "Clarify what to do — don't start without clear requirements" |
| Session just started, dirty worktree | "Handle uncommitted changes first" |

## Output

```
📍 [work type] | [branch] | [current phase]

➡️ Suggestions:
1. **[command/action]** — [reason] (primary)
2. **[command/action]** — [reason] (alternative)
3. **[command/action]** — [reason] (optional, if applicable)

⚠️ [preconditions or risks, if any]
```

## Verification

- [ ] Context signals collected (at least branch + status)
- [ ] Work type correctly identified
- [ ] Suggestions match the progression table for that work type
- [ ] Non-command suggestions used when appropriate

## Examples

```
📍 feature-dev | feat/user-auth | code written, no tests
➡️ Suggestions:
1. **Write unit tests** — new service must have corresponding tests
2. **/verify** — run after tests are written
```

```
📍 bug-fix | fix/PROJ-1234 | review passed
➡️ Suggestions:
1. **/precommit** — required after review pass
```

```
📍 unknown | main | no changes, just started
➡️ Suggestions:
1. **Clarify task** — don't start without clear requirements
2. **/code-explore** — if you want to understand existing code
```

```
📍 feature-dev | feat/payments | precommit pass
➡️ Suggestions:
1. **Doc Sync** — update tech-spec + request after precommit pass
2. **git add && commit** — after Doc Sync completes or N/A

⚠️ Confirm no new code edits before proceeding to Doc Sync
```

```
📍 feature-dev | feat/auth | tech-spec completed, no request
➡️ Suggestions:
1. **/create-request** — tech-spec exists, generate corresponding request doc (primary)
2. **/codex-review-doc** — review after request doc is created

⚠️ Detected docs/features/auth/ has tech-spec but no requests/*.md
```
