# Codex Prompt: Branch Review

<!-- Research block source of truth: @codex-research-instructions.md (Standard Research Block) -->

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer. Comprehensively review all changes in this feature branch.

## Branch Info
- Current branch: ${CURRENT_BRANCH}
- Base branch: ${BASE_BRANCH}
- Commit count: ${COMMIT_COUNT}

## Changed Files
${CHANGED_FILES}

## Diff Stats
${DIFF_STAT}

${SPEC_CHECKLIST ? `## Specification Checklist

The following acceptance criteria are defined for this feature (from ${REQUEST_DOC_PATH}):

${SPEC_CHECKLIST}

Verify each AC against the code changes:
1. Is the AC satisfied by the implementation?
2. Are there code patterns that contradict the spec?
3. Are there untested edge cases for any AC?

Include an AC Coverage section in your output.` : ''}

## ⚠️ Important: You must independently research the project ⚠️

The changed files and diff stats are listed above. You **must** read the actual diffs, commit history, and file contents yourself using your sandbox access. Do NOT expect a pre-provided diff — you are responsible for reading all changes in context.

### Git Exploration (Priority)
1. Read commit history: \`git log ${BASE_BRANCH}..HEAD --oneline\`
2. Read the full branch diff: \`git diff ${BASE_BRANCH}..HEAD\`
3. For each changed file, read the full diff: \`git diff ${BASE_BRANCH}..HEAD -- <file-path>\`
4. Read full content of key changed files: \`cat <changed file> | head -200\`

### Project Research
1. Understand project structure: \`ls src/\`, \`ls test/\`
2. Read core changed files: \`cat <main changed file> | head -200\`
3. Search related tests: \`ls test/unit/\` or \`grep -r "describe" test/ -l | head -5\`
4. Understand module dependencies of changes: \`grep -r "import.*<module name>" . -l --include="*.ts" --include="*.js" | head -10\`
5. Check for missing tests: compare changed files with test files

### Verification Focus
- What is the main purpose of this branch?
- Are changes complete (including tests, docs)?
- Are there potential side effects?

## Review Dimensions

### 1. Feature Completeness
- Are commits logically clear
- Are there missing changes
- Are there unfinished TODOs

### 2. Code Quality
- Correctness (logic errors, boundary conditions)
- Type safety
- Error handling coverage

### 3. Security
- Injection attack risks
- Authentication/authorization bypass
- Sensitive data handling

### 4. Performance
- N+1 queries
- Memory leaks
- Blocking operations

### 5. Test Coverage
- Does new code have tests
- Are tests sufficient
- Is there regression risk

### 6. Documentation
- Do docs need updating
- Does README need updating

## Before Finalizing: Deliberate

Wait. Before assigning severity levels, independently verify each finding:

1. **Evidence check**: For each issue, what specific code proves it's real? (file:line quote)
2. **Context check**: Did you read enough surrounding code to understand intent?
3. **False positive check**: Could this be intentional design? Check for comments, tests, or docs.
4. **Severity check**: Is the severity right — in **both** directions? Could this be worse than you assessed, and could it be *less* than you assessed?
5. **Gap check**: What related issues might you have overlooked?

Only report findings that survive all 5 checks.

## Severity Levels

- **P0**: System crash, data loss, security vulnerability
- **P1**: Functional anomaly, severe performance degradation
- **P2**: Code quality, maintainability
- **Nit**: Style suggestion

### Calibration ⚠️

This is the **thorough** review — the depth variant, run before releases and on security-sensitive branches. **P0, P1 and P2 all block here**, so the line that matters most is P2 vs Nit: a maintainability defect a future reader would trip over is P2; a stylistic preference is Nit.

Severity still has to be earned in both directions. A finding is P0/P1 when you can describe the **concrete failure path** — given this input or this state, this code produces the wrong result, crashes, or leaks. If you cannot name the input, it is not P1, and calling it one here does not make the branch safer; it only obscures the findings that are.

Do not manufacture findings to fill a section. A clean branch is a legitimate result.

## Output Format

### Branch Overview
<one-sentence description of branch purpose>

### Review Summary

| Dimension            | Rating     | Notes |
| -------------------- | ---------- | ----- |
| Feature Completeness | ⭐⭐⭐⭐☆ | ...   |
| Code Quality         | ⭐⭐⭐⭐☆ | ...   |
| Security             | ⭐⭐⭐⭐⭐ | ...   |
| Performance          | ⭐⭐⭐⭐☆ | ...   |
| Test Coverage        | ⭐⭐⭐☆☆  | ...   |

### Findings

#### P0
- [file:line] Issue -> Fix recommendation

#### P1
- [file:line] Issue -> Fix recommendation

#### P2
- [file:line] Issue -> Fix recommendation

### Missing Items
- Missing tests
- Missing docs

${SPEC_CHECKLIST ? `### AC Coverage

| AC | Status | Evidence |
|----|--------|----------|
| <AC text> | ✅ Implemented / ⚠️ Partial / ❌ Missing / N/A | file:line |` : ''}

### Deferred Findings

For every Nit — the only sub-threshold severity at this tier — emit one line here, starting at column 0:

\`\`\`
[NIT_DEFERRED] <file:line> | <issue> | reason: sub-threshold-Nit | <ISO8601 UTC>
\`\`\`

That tag and field order are parsed out of this output by a hook and stored with a TTL, which is what stops the same finding being raised again next session. Field 2 is the issue text, field 3 the reason — do not reorder them. Omit this section entirely if there are no Nits.

### Merge Gate

This is a branch review, which runs at the \`thorough\` tier: **P0, P1 and P2 all block.** Only a Nit is sub-threshold.

- ✅ Ready: no P0/P1/P2
- ⛔ Blocked: has a P0, P1 or P2, needs fix`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
