---
name: feature-dev
description: "Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use code-explore), reviewing code (use codex-code-review). Output: implemented feature + tests + review gate."
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Feature Development Skill

## Trigger

- Keywords: develop feature, implement, write code, verify, precommit, commit, refactor, simplify

## When NOT to Use

- Just want to understand code (use Explore)
- Review code (use codex-code-review)
- Review documents (use doc-review)
- Test-related (use test-review)

## Workflow

```
Requirements -> Design -> Implement -> Test -> Review -> Commit -> Doc Sync
                │          │            │        │          │          │
                ▼          ▼            ▼        ▼          ▼          ▼
           /codex-     /codex-      /verify  /codex-    /precommit  /update-docs
           architect   implement             review-fast             /create-request --update
```

## Commands

| Phase     | Command              | Description             |
| --------- | -------------------- | ----------------------- |
| Design    | `/codex-architect`   | Get architecture advice |
| Implement | `/codex-implement`   | Codex writes code       |
| Verify    | `/verify`            | Run tests to verify     |
| Review    | `/codex-review-fast` | Code review             |
| Commit    | `/precommit`         | lint + typecheck + test |
| Doc Sync  | `/update-docs`       | Sync docs with code     |
| Doc Sync  | `/create-request --update` | Update request progress |
| Refactor  | `/simplify`          | Final refactoring       |

## Output

- Implemented feature code + tests
- Review gate: ✅ Pass / ⛔ Issues found
- Pre-commit results: lint + typecheck + test

## Verification

- All tests pass
- lint + typecheck with no errors
- Code review passed (Gate ✅)

## Testing Requirements

| Change Type               | Test Requirements                           |
| ------------------------- | ------------------------------------------- |
| New Service/Provider      | Must have corresponding unit test           |
| Modify existing logic     | Ensure existing tests pass + new logic tested |
| Bug fix                   | Must add regression test                    |

## Test File Mapping

```
src/service/xxx.service.ts       -> test/unit/service/xxx.service.test.ts
src/provider/evm/parser.ts       -> test/unit/provider/evm/parser.test.ts
src/controller/xxx.controller.ts -> test/integration/controller/xxx.test.ts
```

## Doc Sync (after precommit Pass)

**⚠️ Auto-triggered by @rules/auto-loop.md — behavior-layer rule, not hook-enforced.**

Only when change maps to a feature under `docs/features/`. Target detection uses 3-level fallback — see `/update-docs` for algorithm details.

```
precommit Pass
  → Locate feature docs (see /update-docs 3-level fallback)
  → /update-docs docs/features/<feature>/2-tech-spec.md
  → /create-request --update docs/features/<feature>/requests/<date>-<title>.md
  → /codex-review-doc (per updated file)
  → Safety valve: new code diff? → back to review loop (see /update-docs)
```

## Review Loop

**MUST re-review after fix until PASS**

```
Review -> Issues found -> Fix -> Re-review -> ... -> ✅ Pass -> Done
```

## Examples

```
Input: Implement a fee calculation method
Action: /codex-architect -> /codex-implement -> /verify -> /codex-review-fast -> /precommit
```

```
Input: This code needs refactoring
Action: /simplify -> streamline code, eliminate duplication -> /codex-review-fast
```
