---
name: test-review
description: Test review knowledge base. Covers test coverage review, test generation, coverage analysis.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Test Review Skill

## Trigger

- Keywords: test coverage, test review, are tests sufficient, generate tests, test gen, coverage

## When NOT to Use

- Code review (use codex-code-review)
- Document review (use doc-review)
- Just want to run tests (use `/verify`)

## Commands

| Command              | Description               | Use Case              |
| -------------------- | ------------------------- | --------------------- |
| `/codex-test-review` | Review test sufficiency   | **Required**          |
| `/codex-test-gen`    | Generate unit tests       | Add missing tests     |
| `/check-coverage`    | Test coverage analysis    | After feature dev     |

## Workflow

```
Read tests -> Compare with source code -> Assess coverage -> Output gaps + Gate
```

## Review Dimensions

| Dimension       | Scoring Criteria                       | Weight |
| --------------- | -------------------------------------- | ------ |
| Happy path      | All public methods, main flows         | High   |
| Error handling  | try/catch, error callbacks             | High   |
| Edge cases      | null/undefined, extremes, empty sets   | Medium |
| Mock quality    | Not excessive, not insufficient        | Medium |

## Verification

- Coverage assessment includes all dimensions
- Gate is clear (✅ Tests sufficient / ⛔ Needs additions)
- Missing tests have specific suggestions

## Three-Layer Tests

| Type        | Directory           | Mock             | Focus              |
| ----------- | ------------------- | ---------------- | ------------------ |
| Unit        | `test/unit/`        | ✅ Full          | Single function logic |
| Integration | `test/integration/` | Only external    | Inter-module interaction |
| E2E         | `test/e2e/`         | ❌ Prohibited    | Complete flow      |

## Common Boundaries

| Type   | Cases                                            |
| ------ | ------------------------------------------------ |
| String | `""`, `" "`, `null`, `undefined`, very long string |
| Number | `0`, `-1`, `NaN`, `Infinity`, `MAX_SAFE_INTEGER` |
| Array  | `[]`, `[null]`, very large array, nested array   |
| Object | `{}`, `null`, circular reference                 |

## Examples

```
Input: Are this service's tests sufficient?
Action: /codex-test-review -> Assess coverage -> Output gaps + Gate
```

```
Input: Add tests for this function
Action: /codex-test-gen -> Generate AAA pattern tests -> /codex-test-review
```
