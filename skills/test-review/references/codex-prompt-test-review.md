# Codex Prompt: Test Coverage Review

## First Review Prompt

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior test engineer. Review whether test coverage is sufficient.

## Test Type: ${TEST_TYPE}

## Test File
\`\`\`
${TEST_CONTENT}
\`\`\`

## Corresponding Source
\`\`\`
${SOURCE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

When reviewing test coverage, you **must** perform the following research:

### Research Steps
1. Understand project structure: \`ls src/\`, \`ls test/\`
2. Search related source: \`grep -r "className" src/ -l | head -10\`
3. Read source to understand full logic: \`cat <source path> | head -150\`
4. Search existing test patterns: \`ls test/unit/\` or \`cat test/unit/xxx.test.ts | head -50\`
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

- No 🔴 items: ✅ Tests sufficient
- Has 🔴 items: ⛔ Tests need supplementation`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Re-review Prompt

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<from --continue parameter>',
  prompt: `I have added test cases. Please re-review:

## Updated Test File
\`\`\`
${TEST_CONTENT}
\`\`\`

Please verify:
1. Have previously identified 🔴 gaps been filled?
2. Do new tests correctly cover the problem scenarios?
3. Did new tests introduce any issues?
4. Update Gate status`,
});
```
