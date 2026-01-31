---
name: feature-dev
description: Feature development workflow. Covers implementation, verification, pre-commit checks, refactoring. Guides through design -> implement -> verify -> review -> commit flow.
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
Requirements -> Design -> Implement -> Test -> Review -> Commit
                │          │            │        │          │
                ▼          ▼            ▼        ▼          ▼
           /codex-     /codex-      /verify  /codex-    /precommit
           architect   implement             review-fast
```

## Commands

| Phase     | Command              | Description             |
| --------- | -------------------- | ----------------------- |
| Design    | `/codex-architect`   | Get architecture advice |
| Implement | `/codex-implement`   | Codex writes code       |
| Verify    | `/verify`            | Run tests to verify     |
| Review    | `/codex-review-fast` | Code review             |
| Commit    | `/precommit`         | lint + typecheck + test |
| Refactor  | `/simplify`          | Final refactoring       |

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
