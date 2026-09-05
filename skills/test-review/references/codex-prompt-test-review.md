# Codex Prompt: Test Coverage Review

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Test Review) -->

## First Review Prompt

You are a senior test engineer. Review whether test coverage is sufficient.

## Test Type: ${TEST_TYPE}

## Test File

${TEST_PATH}

## Corresponding Source

${SOURCE_PATH}

## ⚠️ Important: You must independently research the project ⚠️

**Paths, not contents** — deliberately. A test-coverage review is a review dispatch
(`@rules/codex-invocation.md` § Which dispatches this file governs), so a first dispatch carries
metadata and you read the files yourself. An excerpt pasted here would be the dispatcher's choice
of which branches matter, and the untested branch it left out is the finding this review exists to
produce. Open both paths above and read them to the end.

### Research Steps

1. Inventory the repository before assuming a layout: `ls`, then locate the source and test roots
   (not every project has `src/` or `test/unit/`)
2. Read the test file and its source **whole**: `cat <path>` (chunk with `sed -n '1,200p'`, … when long)
3. Search for the symbol's other call sites and sibling tests: `grep -rl "<symbol>" <source roots>`
4. Read the neighbouring tests to learn the project's conventions before judging this one
5. Find all branches and error handling paths in source

### Verification Focus

- Which public methods exist in source? Are they tested?
- Which if/else/switch branches exist? Are they covered?
- Which try/catch blocks exist? Are error paths tested?
- Is parameter validation logic tested?

## Review Dimensions

### 1. Coverage Completeness

- Are all public methods tested
- Are all branches (if/else/switch) covered
- Are all error handling paths tested

### 2. Boundary Conditions

- Null handling: null, undefined, empty string, empty array
- Extreme values: 0, negative numbers, max, min
- Special characters: special symbols, unicode, emoji

### 3. Error Scenarios

- External service failure (API error, timeout)
- Invalid input
- Resource not found
- Insufficient permissions

### 4. Concurrency & State

- Behavior on multiple calls
- State change correctness
- Race condition

### 5. Mock Reasonableness (Unit Test only)

- Is mocking excessive (making tests ineffective)
- Is mocking insufficient (making tests flaky)

## Output Format

### Coverage Assessment

| Dimension | Rating (1-5⭐) | Notes |
|-----------|----------------|-------|
| Happy path | ... | ... |
| Error handling | ... | ... |
| Boundary conditions | ... | ... |
| Mock reasonableness | ... | ... |

### 🔴 Must Add (P0/P1)

List missing critical test cases with suggested test code.

### 🟡 Suggested Addition (P2)

List optional boundary case tests.

### Gate

End the report with the verdict terminal ALONE at the start of the final line — never inside a
list item or sentence:
- No 🔴 items → end with `✅ Tests sufficient`
- Has 🔴 items → end with `⛔ Tests need supplementation`

## Re-review Prompt

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume — same thread only. Rotation: per the central contract
(`skills/codex-code-review/references/review-common.md` § Review Loop — Thread Rotation), at the
R-a threshold (3 replies on this thread; `## Review Thread Rotation` override, 2–6) or on R-b
judged context overrun, dispatch the first-review prompt above on a **new** thread instead — no
old findings fed; reconcile orchestration-side; record `[THREAD_ROTATED]`.

I have added test cases. Please re-review:

## Updated Test File

```
${TEST_CONTENT}
```

Please verify:
1. Have previously identified 🔴 gaps been filled?
2. Do new tests correctly cover the problem scenarios?
3. Did new tests introduce any issues?
4. Update Gate status
