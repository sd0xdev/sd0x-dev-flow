---
description: Review test case sufficiency using Codex MCP, suggest additional edge cases. Supports review loop with context preservation.
argument-hint: [<file-or-dir|description>] [--type unit|integration|e2e] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
skills: test-review
---

## Context

- Git status: !`git status -sb`
- Git diff (test files): !`git diff --name-only HEAD 2>/dev/null | grep -E '\.test\.ts$' | head -5`

## Task

You will use Codex MCP to review whether test coverage is sufficient.

### Arguments Parsing

```
$ARGUMENTS
```

### Smart Input

| Input               | Example                    | Behavior                               |
| ------------------- | -------------------------- | -------------------------------------- |
| File path           | `test/unit/xxx.test.ts`    | Directly review that file              |
| Directory           | `test/unit/service/`       | Review all tests in directory          |
| Description         | `"check uncommitted tests"`| Auto-find files changed in git diff    |
| Module name         | `"portfolio service"`      | Search related test files              |
| No parameter        | -                          | Auto-detect git diff or recent changes |
| `--continue`        | `--continue <threadId>`    | Continue previous review session       |

### Step 1: Smart Detection of Review Target

Determine review target based on $ARGUMENTS:

1. **Has specific file/directory path**: Use directly
2. **Has descriptive text**: Search related test files
3. **No parameter**: Detect test files in git diff, or recently modified tests

Use `Read`, `Glob`, `Grep` tools to find:

- `TEST_FILE`: Test file path
- `SOURCE_FILE`: Corresponding source file (inferred from test path)
- `TEST_TYPE`: unit / integration / e2e

### Step 2: Read Test and Source Content

```bash
# Read test file
Read(TEST_FILE)

# Read corresponding source (if exists)
# test/unit/service/xxx.test.ts -> src/service/xxx.ts
Read(SOURCE_FILE)
```

### Step 3: Execute Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` to start a new review session:

```typescript
mcp__codex__codex({
  prompt: `You are a senior test engineer specializing in TypeScript/Jest testing. Review whether test coverage is sufficient.

## Test Type: ${TEST_TYPE}

## Test File
\`\`\`typescript
${TEST_CONTENT}
\`\`\`

## Corresponding Source
\`\`\`typescript
${SOURCE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

When reviewing test coverage, you **must** perform the following research, do not rely only on the content above:

### Research Steps
1. Understand project structure: \`ls src/\`, \`ls test/\`
2. Search related source: \`grep -r "className" src/ --include="*.ts" -l | head -10\`
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

**Remember the returned `threadId` for subsequent review loops.**

**Case B: Loop review (has `--continue`)**

Use `mcp__codex__codex-reply` to continue the previous session:

```typescript
mcp__codex__codex -
  reply({
    threadId: '<from --continue parameter>',
    prompt: `I have added test cases. Please re-review:

## Updated Test File
\`\`\`typescript
${TEST_CONTENT}
\`\`\`

Please verify:
1. Have previously identified 🔴 gaps been filled?
2. Do new tests correctly cover the problem scenarios?
3. Did new tests introduce any issues?
4. Update Gate status`,
  });
```

### Step 4: Consolidate Output

Organize Codex review results into the standard format.

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Tests need supplementation:

1. Remember the `threadId`
2. Add missing tests
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Tests sufficient

## Output

````markdown
## Test Coverage Review Report

### Review Scope

- File: <TEST_FILE>
- Type: Unit / Integration / E2E
- Corresponding source: <SOURCE_FILE>

### Coverage Assessment

| Dimension         | Rating    | Notes |
| ----------------- | --------- | ----- |
| Happy path        | ⭐⭐⭐⭐☆ | ...   |
| Error handling    | ⭐⭐⭐☆☆  | ...   |
| Boundary conditions | ⭐⭐☆☆☆ | ...   |
| Mock reasonableness | ⭐⭐⭐⭐☆ | ...  |

### 🔴 Must Add (P0/P1)

1. **Missing**: <description>
   - **Location**: `src/xxx.ts:123`
   - **Suggested test**:
     ```typescript
     it('should ...', () => { ... });
     ```

### 🟡 Suggested Addition (P2)

1. **Missing**: <description>
   - **Edge case**: <edge case>

### Edge Case Suggestions

| Type    | Case                    | Priority |
| ------- | ----------------------- | -------- |
| Null    | null / undefined input  | P1       |
| Extreme | Max/min value boundary  | P2       |
| Concurrency | Multiple concurrent requests | P2 |
| Timeout | External service timeout | P1      |

### Gate

✅ Tests sufficient / ⛔ Tests need supplementation (N 🔴 items)

### Loop Review

To re-review after additions, use:
`/codex-test-review --continue <threadId>`
````

## Examples

```bash
# Specify file
/codex-test-review test/unit/service/xxx.test.ts

# Check uncommitted code
/codex-test-review "Check if uncommitted code has sufficient tests"

# Check specific module
/codex-test-review "portfolio service tests"

# Auto-detect
/codex-test-review

# Continue review after additions (preserve context)
/codex-test-review --continue abc123
```
