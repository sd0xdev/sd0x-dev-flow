---
name: test-review
description: "Test coverage review via Codex MCP. Use when: reviewing test sufficiency, identifying coverage gaps, test quality audit. Not for: generating tests (use codex-test-gen), code review (use codex-code-review). Output: coverage analysis + gap report."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Write
context: fork
agent: Explore
---

# Test Review Skill

## Trigger

- Keywords: test coverage, test review, are tests sufficient, generate tests, test gen, coverage

## When NOT to Use

- Code review (use `codex-code-review`)
- Document review (use `doc-review`)
- Just want to run tests (use `/verify`)

## Commands

| Command              | Description             | Use Case            |
| -------------------- | ----------------------- | ------------------- |
| `/codex-test-review` | Review test sufficiency | **Required**        |
| `/codex-test-gen`    | Generate unit tests     | Add missing tests   |
| `/check-coverage`    | Test coverage analysis  | After feature dev   |

## Workflow: `/codex-test-review`

```
Smart detect target → Read test + source → Codex review (5 dimensions) → Coverage assessment + Gate → Loop if Needs additions
```

### Step 1: Smart Detection

| Input | Behavior |
|-------|----------|
| File path | Review that file directly |
| Directory | Review all tests in directory |
| Description | Auto-find related test files |
| Module name | Search related test files |
| No parameter | Auto-detect from git diff |

### Step 2: Read Test and Source

- Read test file (`TEST_FILE`)
- Read corresponding source (`SOURCE_FILE`, inferred from test path)

### Step 3: Codex Review

**First review**: `mcp__codex__codex` with test review prompt. See @references/codex-prompt-test-review.md.

**Loop review**: `mcp__codex__codex-reply` with re-review template. See @references/codex-prompt-test-review.md.

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

**Save the returned `threadId`.**

## Workflow: `/codex-test-gen`

```
Read source → Derive test path → Codex generate → Save test file → Suggest review
```

### Steps

1. Read source file
2. Derive test path: `src/service/xxx.ts` → `test/unit/service/xxx.test.ts`
3. Codex generates tests. See @references/codex-prompt-test-gen.md.
4. Save to target path
5. Suggest: run tests then `/codex-test-review`

## Review Dimensions

| Dimension       | Scoring Criteria                       | Weight |
| --------------- | -------------------------------------- | ------ |
| Happy path      | All public methods, main flows         | High   |
| Error handling  | try/catch, error callbacks             | High   |
| Edge cases      | null/undefined, extremes, empty sets   | Medium |
| Mock quality    | Not excessive, not insufficient        | Medium |

## Three-Layer Tests

| Type        | Directory           | Mock             | Focus               |
| ----------- | ------------------- | ---------------- | -------------------- |
| Unit        | `test/unit/`        | Full             | Single function      |
| Integration | `test/integration/` | Only external    | Inter-module         |
| E2E         | `test/e2e/`         | Prohibited       | Complete flow        |

## Common Boundaries

| Type   | Cases                                            |
| ------ | ------------------------------------------------ |
| String | `""`, `" "`, `null`, `undefined`, very long      |
| Number | `0`, `-1`, `NaN`, `Infinity`, `MAX_SAFE_INTEGER` |
| Array  | `[]`, `[null]`, very large, nested               |
| Object | `{}`, `null`, circular reference                 |

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

⛔ Needs additions → add tests → `/codex-test-review --continue <threadId>` → repeat until ✅ Sufficient.

Max 3 rounds. Still failing → report blocker.

## Output

```markdown
## Test Coverage Review
| Dimension | Coverage | Rating |
|-----------|----------|--------|
| ...       | ...      | ⭐1-5  |

### Gate: ✅ Tests sufficient / ⛔ Needs additions
```

## Verification

- [ ] Coverage assessment includes all dimensions
- [ ] Gate is clear (✅ Tests sufficient / ⛔ Needs additions)
- [ ] Missing tests have specific code suggestions
- [ ] Codex independently researched source code branches

## References

- Test review prompt: `references/codex-prompt-test-review.md`
- Test gen prompt: `references/codex-prompt-test-gen.md`
- Standards: @rules/testing.md

## Examples

```
Input: /codex-test-review test/unit/service/xxx.test.ts
Action: Read test + source → Codex review → Coverage assessment + Gate

Input: /codex-test-gen src/service/xxx.ts
Action: Read source → Codex generate → Save test → Suggest review

Input: Are this service's tests sufficient?
Action: /codex-test-review → Assess coverage → Output gaps + Gate
```
