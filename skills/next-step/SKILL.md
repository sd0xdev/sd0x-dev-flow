---
name: next-step
description: "Change-aware next step advisor. Use when: user asks what to do next, workflow progression is unclear, session just started with dirty worktree. Not for: executing the suggested command (user decides), auto-loop decisions (hooks handle that). Output: findings-based suggestions or session summary with commit seed."
---

# Next Step Advisor

## When NOT to Use

- Auto-loop already handling review/precommit flow (hooks track and assist)
- User gave a clear, specific instruction (just do it)
- Mid-execution of a skill workflow (follow that skill's progression)

## Procedure

1. Run `node skills/next-step/scripts/analyze.js --json` to collect deterministic findings
2. Parse the JSON output — findings, gates, diff summary, phase, feature_context, next_actions, backlog
3. **If P0/P1 findings exist** → format top 3 as actionable suggestions (Findings Mode)
4. **If mid-pipeline** (gates not all passed, no P0/P1) → use progression tables to suggest next step
5. **If phase = post_precommit** → suggest doc sync + request update (use next_actions)
6. **If phase = feature_complete** → output feature complete summary with backlog
7. **If all gates pass and no P0/P1** → output session summary with commit seed (Summary Mode, P2/P3 shown as oversights)

## Script Integration

The analyze script runs 16 deterministic heuristics against git state, review state, and feature context:

| Priority | Heuristics | Meaning |
|----------|-----------|---------|
| P0 | Gate missing (code review, doc review, precommit), state drift | Required steps not completed |
| P1 | Test gap, security hotspot, migration risk, doc-sync-needed, request-stale | Important oversights |
| P2 | README missing, skill-lint needed, locale drift, mixed concerns, ac-incomplete | Quality improvements |
| P3 | Main branch warning, feature-complete | Informational |

The script exits with code 0 (no P0/P1), 1 (has P1), or 2 (has P0).

### Output Fields (v2)

| Field | Type | Description |
|-------|------|-------------|
| phase | string | `mid_development` / `post_precommit` / `ready_to_commit` / `feature_complete` / `clean` |
| feature_context | object | `{ key, source, confidence, docs_path, has_tech_spec, has_requests }` |
| next_actions | array | `[{ id, command, args, reason, confidence }]` sorted by confidence desc |
| backlog | object/null | `{ total_features, incomplete_features }` — only when phase = feature_complete |

### Script Failure Fallback

If the script fails or is unavailable, fall back to manual signal collection:

| # | Signal | How |
|---|--------|-----|
| 1 | Git branch | `git branch --show-current` |
| 2 | Git status | `git status -sb` |
| 3 | Changed files | `git diff --name-only HEAD` |
| 4 | Review state | `.claude_review_state.json` |

Then use the Progression Tables below.

## Dispatch Mode (--go flag)

When `--go` is provided, auto-execute the top `next_action` IF:
- `next_actions[0]` exists AND `confidence >= 0.8`
- No P0 findings
- Command is not null

Output: "Auto-dispatching: [command] [args]" then invoke the Skill tool and report the result.

Safety: NEVER dispatch on P0. Fall back to advisory mode if confidence < 0.8.

## Progression Tables (mid-pipeline fallback)

Used when script shows P0 gate issues or when determining which workflow step comes next.

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
| `/codex-review-fast` pass | `/precommit` |
| `/precommit` pass | **Doc Sync** → `/update-docs` + `/create-request --update` |
| Doc sync complete | Manual commit + `/pr-review` |
| All gates pass | Session summary (see output below) |

### Bug Fix Progression

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/issue-analyze` or `/bug-fix` |
| Root cause identified | Fix code + write regression test |
| Fix applied | `/verify` |
| `/verify` pass | `/codex-review-fast` |
| `/codex-review-fast` pass | `/precommit` |
| `/precommit` pass | Manual commit |

### Documentation Work

| Last Completed | Next Step |
|----------------|-----------|
| (nothing yet) | `/tech-spec` or `/update-docs` |
| Docs written/updated | `/codex-review-doc` |
| `/codex-review-doc` pass | Manual commit |

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

## Output Format — Findings Mode

When the script detects actionable findings, format the top 3:

```
📍 [work type] | [branch] | [current phase]

⚠️ Findings ([count]):
1. **[P0/P1/P2] [finding id]** — [message] → [suggestion]
2. **[P0/P1/P2] [finding id]** — [message] → [suggestion]
3. **[P0/P1/P2] [finding id]** — [message] → [suggestion]
[+N more if suppressed]

➡️ Next: [primary action based on highest priority finding]
```

## Output Format — Session Summary (all gates pass, no P0/P1)

When all gates pass and no actionable findings remain, summarize the session instead of suggesting "commit/push":

```
📍 [work type] | [branch] | all gates passed

✅ Session Summary:
- [what was accomplished, derived from diff summary and conversation]
- [key changes: N files changed, types of changes]

⚠️ Oversights (if any P2/P3 remain):
- [P2/P3 findings as optional improvements]

💬 Commit seed:
  [type]: [concise description of all changes]
```

The commit seed is a suggestion — the user decides the final message.

## Output Format — Feature Complete (phase = feature_complete, backlog exists)

```
📍 [work type] | [branch] | feature complete

✅ Feature [key] Complete
- All gates passed, no sync issues remaining

📋 Backlog ([N] incomplete):
- [feature-key] — status: [status], unchecked AC: [count]
- ...

➡️ Next: Pick a feature from the backlog or start new work
```

## Document Completeness Check

When a feature directory exists in `docs/features/`, cross-check document pairs:

| State | Suggest |
|-------|---------|
| tech-spec exists, no request | `/create-request` |
| request exists, no tech-spec | `/tech-spec` |
| Both exist, code changed | `/update-docs` + `/create-request --update` |

## Non-Command Suggestions

When the best next step is NOT a slash command:

| Signal | Suggest |
|--------|---------|
| Requirements unclear | "Confirm requirements with PM/user before proceeding" |
| Affects other services | "Confirm upstream/downstream API contracts" |
| Security-sensitive change | `/codex-security` before proceeding |
| No clear task | "Clarify what to do — don't start without clear requirements" |
| Session just started, dirty worktree | "Handle uncommitted changes first" |

## Verification

- [ ] Script ran successfully (or fallback used)
- [ ] Findings formatted with priority and actionable suggestions
- [ ] Session summary includes commit seed when all clear
- [ ] Non-command suggestions used when appropriate
