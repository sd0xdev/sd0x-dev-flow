---
name: feature-dev
description: "Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use code-explore), reviewing code (use codex-code-review). Output: implemented feature + tests + review gate."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion, mcp__codex__codex, mcp__codex__codex-reply
---

# Feature Development Skill

## Trigger

- Keywords: develop feature, implement, write code, verify, precommit, refactor, simplify

## When NOT to Use

- Just want to understand code (use Explore)
- Review code only (use codex-code-review)
- Review documents only (use doc-review)
- Pure test-only tasks without feature changes (use `/codex-test-review` directly)

## Prohibited Actions

```
❌ git add | git commit | git push — per @rules/git-workflow.md
```

This skill implements features but does **not** commit. `/precommit` is a quality gate only. To commit, the user must invoke `/smart-commit --execute` separately.

<budget:token_budget>200000</budget:token_budget>

## Workflow

```
Requirements → Design → Implement → Test + Review → Precommit Gate → Doc Sync
                │          │            │                  │               │
                ▼          ▼            ▼                  ▼               ▼
           /codex-     /codex-    /verify              /precommit  /update-docs
           architect   implement  /codex-test-review   (or /precommit)  /create-request --update
                                  /codex-review-fast
```

**Design before code**: for a non-trivial change, briefly consider who owns each responsibility,
the simplest shape that fits the existing code, and why — and say what you chose when the choice
is non-obvious. Principles (clear names, small cohesive functions, dependency direction,
composition where it reduces coupling) are questions, not quotas: never add an abstraction to
demonstrate design. `/codex-architect` is for genuinely hard trade-offs (cross-module boundaries,
new public APIs, durable abstractions), not every feature.

## Commands

| Phase | Command | Description |
|-------|---------|-------------|
| Design | `/codex-architect` | Get architecture advice |
| Implement | `/codex-implement` | Codex writes code |
| Test: Run | `/verify` | Run tests (lint → typecheck → unit → integration) |
| Test: Review | `/codex-test-review` | **Mandatory** — review test sufficiency (5 dimensions) |
| Test: Generate | `/codex-test-gen` | Generate unit tests for gaps |
| Test: Integration | `/post-dev-test` | Write missing integration/e2e tests |
| Review | `/codex-review-fast` | Code review (auto-loop) |
| Precommit | `/precommit` | lint + build + test (auto-loop canonical path) |
| Doc Sync | `/update-docs` | Sync docs with code |
| Doc Sync | `/create-request --update` | Update request progress |
| Refactor | `/simplify` | Final refactoring |

## Test + Review Phase (Detail)

This is the core of feature-dev — ensuring sufficient test coverage before code review.

### Step 1: Run existing tests

```
/verify → all tests pass?
  Yes → Step 2
  No → fix failures → re-run /verify
```

### Step 2: Test adequacy review (mandatory for code changes)

```
/codex-test-review → ✅ Tests sufficient?
  Yes → Step 3
  No → close gaps (Step 2a) → /codex-test-review --continue
```

### Step 2a: Gap closure

| Gap Type | Remediation Command |
|----------|-------------------|
| Unit test missing/insufficient | `/codex-test-gen` → write tests → `/verify` |
| Integration/E2E missing | `/post-dev-test` → write tests → `/verify` |

### Step 3: Code review (auto-loop)

```
/codex-review-fast → ✅ Ready?
  Yes → Precommit Gate
  No → fix issues → re-run /codex-review-fast (auto-loop)
```

### Freshness rule

If code changes after the latest `✅ Tests sufficient` gate (e.g., fixes from code review), rerun `/verify` then `/codex-test-review --continue` before proceeding to precommit gate.

## Testing Requirements

Follow `@rules/testing.md` for conventions (AAA, naming, evidence model).
Follow `@rules/testing-project.md` for project-specific overrides (directories, runner, adequacy mode).

| Change Type | Test Requirements |
|-------------|-------------------|
| New Service/Provider | Must have corresponding unit test |
| Modify existing logic | Existing tests pass + new logic tested |
| Bug fix | Must add regression test |
| New API endpoint | Integration test required |
| Cross-service change | E2E test required |

## Test File Mapping

Use project convention from `@rules/testing-project.md`. If no override is defined, follow ecosystem defaults:

| Source Pattern | Test Pattern |
|---------------|-------------|
| `src/<module>/` | `test/unit/<module>/` or `test/<module>/` |
| `scripts/<name>.sh` | `test/scripts/<name>.test.js` |
| `skills/<name>/SKILL.md` | `test/skills/<name>.test.js` |

## Output

- Implemented feature code + tests
- Test adequacy gate: ✅ Tests sufficient
- Review gate: ✅ Ready
- Precommit results: ✅ All Pass

## Verification Checklist

- [ ] All tests pass (`/verify`)
- [ ] Test adequacy reviewed (`/codex-test-review`)
- [ ] Code review passed (`/codex-review-fast` ✅ Ready)
- [ ] Precommit passed (`/precommit` ✅ All Pass)
- [ ] No `git add/commit/push` executed

## Doc Sync (after precommit Pass)

**⚠️ Auto-triggered by @rules/auto-loop.md — behavior-layer rule, not hook-enforced.**

Only when change maps to a feature under `docs/features/`. Target detection uses 3-level fallback — see `/update-docs` for algorithm details.

```
precommit Pass
  → Locate feature docs (see /update-docs 3-level fallback)
  → /update-docs docs/features/<feature>/2-tech-spec.md      (current-authority doc)
  → /create-request --update docs/features/<feature>/requests/<date>-<title>.md   (record: status + outcome only)
  → /codex-review-doc            (ONE dispatch for every doc touched above)
  → Safety valve: new code diff? → back to review loop (see /update-docs)
```

**Sync the current-authority doc; append to the record.** The tech spec states what is true now, so
code landing makes it stale and it is rewritten. A request ticket, review log or ADR states what was
decided or done at a point in time — it is updated with status and outcome, never rewritten to match
today's code, because rewriting it destroys the record. `scripts/lib/doc-metadata.js` decides which a
file is; `/codex-review-doc` reviews each under the profile that classification earns.

One `/codex-review-doc` for all of them, not one per file: the changed docs are a single review plan
(`skills/doc-review/SKILL.md` § Workflow). Per-file dispatch is what multiplied a three-file doc sync
into three whole-document reviews.

## Review Loop

**MUST re-review after fix until PASS** (per @rules/auto-loop.md)

```
Review → Issues found → Fix → Re-review → ... → ✅ Pass → Next step
```

## Examples

```
Input: Implement a fee calculation method
Action: /codex-architect → /codex-implement → /verify → /codex-test-review → /codex-review-fast → /precommit
```

```
Input: This code needs refactoring
Action: /simplify → /verify → /codex-test-review → /codex-review-fast → /precommit
```

```
Input: Feature dev, continue (resuming work)
Action: Check git status → identify remaining tasks → continue from current phase
```
