---
name: test-review
description: "Test coverage review via Codex exec. Use when: reviewing test sufficiency, identifying coverage gaps, test quality audit. Not for: generating tests (use codex-test-gen), code review (use codex-code-review). Output: coverage analysis + gap report."
allowed-tools: Bash(git:*), Bash(node:*), Read, Grep, Glob, Write, Task
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

**First review**: dispatch per `@skills/codex-code-review/references/codex-transport.md` § Start with the test review prompt. See `references/codex-prompt-test-review.md`.

**Loop review**: dispatch per § Resume with the re-review template. See `references/codex-prompt-test-review.md`. Rotation applies per the central contract (see § Review Loop below).

**`codex_fail` → fallback carries the gate** (adapter **exit 1** only — `@skills/codex-code-review/references/codex-transport.md` § Completion state machine: a pending or unknown completion keeps the gate **open** with no fallback, exit 2 is a configuration error, and an `alloc`/`cleanup` failure is a lifecycle error) (`@rules/auto-loop.md` § Review Dispatch): decide via `scripts/lib/review-dispatch.js` (`contract:'test:coverage'`), record `[REVIEWER_FALLBACK]`, dispatch `contract-neutral-reviewer` via Task with `references/codex-prompt-test-review.md` as the governing template (P3 = one retry, fresh instance), and validate the raw report with `node scripts/validate-family-sentinel.js test:coverage` before adopting the verdict. Carriers exhausted → no gate sentinel, behaviour-layer `⚠️ Need Human`.


**Save the returned `threadId`.**

## Workflow: `/codex-test-review --ac-trace`

AC traceability mode — maps Acceptance Criteria from request docs to test evidence.

```
--ac-trace input → Read request doc → Parse ACs → Filter quality-gate → Search evidence → Codex verify → Matrix + Gate
```

### Step 1: Input Resolution

| Input | Behavior |
|-------|----------|
| `--ac-trace <request-path>` | Read specified request doc |
| `--ac-trace` (no path) | Auto-detect from `docs/features/*/requests/*.md` via git diff context |
| No `--ac-trace` | Existing behavior (5-dimension coverage review) |

### Step 2: Parse & Filter ACs

1. Locate `## Acceptance Criteria` section in request doc
2. Parse `- [ ]` / `- [x]` items
3. Filter out quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/pr-review`

### Step 3: Search Evidence

For each non-quality-gate AC:

| Evidence Type | Priority | How to Find |
|--------------|----------|-------------|
| Automated test | 1 (preferred) | Search Related Files test paths; match AC text → test assertions |
| Runtime verification | 2 | Search `/feature-verify` results at L3+ confidence |
| Manual exception | 3 (verified only) | Check AC annotation `<!-- exception: REASON, expires: DATE -->` |

### Step 4: Codex Verify (independent)

Fresh thread (§ Start). See `references/codex-prompt-ac-trace.md`.

| Rule | Detail |
|------|--------|
| Cache | `request-path + git diff hash` key; same session reuse |
| `codex_fail` — adapter **exit 1 only** (`@skills/codex-code-review/references/codex-transport.md` § Completion state machine: pending/unknown keeps the gate open with no fallback; exit 2 is a configuration error; `alloc`/`cleanup` failures are lifecycle errors) | Fallback carries the verification (`@rules/auto-loop.md` § Review Dispatch): decide via `scripts/lib/review-dispatch.js` (`contract:'test:ac-trace'`), record `[REVIEWER_FALLBACK]`, dispatch `contract-neutral-reviewer` via Task with `references/codex-prompt-ac-trace.md` as the governing template (P3 = one retry, fresh instance); validate the raw report with `node scripts/validate-family-sentinel.js test:ac-trace` before deriving the public sentinel |
| Carriers exhausted | No validated raw report exists, so **no raw or public AC gate sentinel is derived** — mark all items `⚠️ Inconclusive` in the body and surface behaviour-layer `⚠️ Need Human` only (whatever the mode); note nothing |


**Save the returned `threadId`.**

### Step 5: Exception Validation (3-gate)

| Gate | Check |
|------|-------|
| Reason class | Closed enum: `ENV_UNAVAILABLE` / `UNSAFE_TO_AUTOMATE` / `ONE_TIME_MIGRATION` |
| Codex verification | Must emit `VALID_EXCEPTION` |
| Expiry | ISO 8601; expired = ⛔ (strict) or ⚠️ (advisory) |

**Exception caps** (from @rules/testing.md): 1-8 AC = max 1; 9-12 = max 2; 13+ = hard cap 2.
**Prohibited domains**: Security AC, Data-integrity AC, Regression AC = no exceptions allowed.

### Step 6: Output + Gate

Gate sentinels (from @rules/testing.md). These public forms are **derived** from the raw report's `gate:` line — `gate: Adequate` → `✅ Adequate`, `gate: Adequate_with_exceptions` → `⚠️ Adequate with exceptions`, `gate: Need_Human` → `⚠️ Need Human`, `gate: Inadequate` → `⛔ Inadequate`. Whoever produced the raw report (Codex or fallback carrier), the raw layer is what `validate-family-sentinel.js test:ac-trace` checks; this skill's derivation alone produces the public form:

| Sentinel | Meaning |
|----------|---------|
| `✅ Adequate` | All ACs covered by evidence |
| `⚠️ Adequate with exceptions` | Validated exceptions within cap |
| `⚠️ Need Human` | Every carrier exhausted (behaviour-layer only — never derived from a report), or the validated report is inconclusive |
| `⛔ Inadequate` | Unverified exception, cap breach, or prohibited domain |

## Workflow: `/codex-test-gen`

```
Read source → Derive test path → Codex generate → Save test file → Suggest review
```

### Steps

1. Read source file
2. Derive test path: `src/service/xxx.ts` → `test/unit/service/xxx.test.ts`
3. **Bind `FUNCTION_NAME` before rendering the prompt**: the function named in the invocation, or
   the literal `all` when the caller supplied only a path — `/codex-test-gen src/service/xxx.ts`
   is the documented file-only form, so the placeholder must resolve to something. It used to carry
   its own default inside the template; nothing evaluates the template now, so the binding is the
   caller's and it is stated here.
4. Codex generates tests. See `references/codex-prompt-test-gen.md`.
5. Save to target path
6. Suggest: run tests then `/codex-test-review`

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

**Thread rotation** — central contract (`@skills/codex-code-review/references/review-common.md` § Review Loop — Thread Rotation): at the R-a threshold (3 replies on this thread; `@rules/auto-loop-project.md ## Review Thread Rotation` overrides, 2–6) or on R-b judged context overrun, dispatch the first-review template on a **new** thread instead of replying — no old findings fed, reconciliation orchestration-side — and record `[THREAD_ROTATED]`.

**Sentinel alias union** (no canonicalization): `✅ Tests sufficient` / `✅ Sufficient` carry one pass semantic, `⛔ Tests need supplementation` / `⛔ Needs additions` one fail semantic. Both shapes stay legal exactly as written — nothing rewrites one into the other — and every report carries exactly one terminal (`validate-family-sentinel.js test:coverage` rejects mixing).

Max 3 rounds. Still failing → report blocker.

## Output

```markdown
## Test Coverage Review
| Dimension | Coverage | Rating |
|-----------|----------|--------|
| ...       | ...      | ⭐1-5  |

<findings and suggestions>

✅ Tests sufficient
```

The report ends with **exactly one** terminal, alone at column 0 on the final line, drawn from the
alias union above — pass: `✅ Tests sufficient` **or** `✅ Sufficient`; fail: `⛔ Tests need
supplementation` **or** `⛔ Needs additions`. All four are legal exactly as written, which is why
this list must match the union rather than name a preferred pair: `validate-family-sentinel.js
test:coverage` accepts all four, and the first-pass prompt emits `⛔ Tests need supplementation`, so
a two-form list here would reject the template's own output. Never place two alternatives on one line.

## Verification

- [ ] Coverage assessment includes all dimensions
- [ ] Exactly one gate terminal from the four-form alias union (`✅ Tests sufficient` / `✅ Sufficient` / `⛔ Tests need supplementation` / `⛔ Needs additions`), alone at column 0 on the final line
- [ ] Missing tests have specific code suggestions
- [ ] Codex independently researched source code branches

## References

- Test review prompt: `references/codex-prompt-test-review.md`
- Test gen prompt: `references/codex-prompt-test-gen.md`
- AC trace prompt: `references/codex-prompt-ac-trace.md`
- Standards: @rules/testing.md

## Examples

```
Input: /codex-test-review test/unit/service/xxx.test.ts
Action: Read test + source → Codex review → Coverage assessment + Gate

Input: /codex-test-gen src/service/xxx.ts
Action: Read source → Codex generate → Save test → Suggest review

Input: Are this service's tests sufficient?
Action: /codex-test-review → Assess coverage → Output gaps + Gate

Input: /codex-test-review --ac-trace docs/features/auth/requests/2026-03-01-login.md
Action: Parse AC → Filter quality-gate → Search evidence → Codex verify → Matrix + Gate
```
