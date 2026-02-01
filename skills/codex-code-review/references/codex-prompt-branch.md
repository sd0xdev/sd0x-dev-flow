# Codex Prompt: Branch Review

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer. Comprehensively review all changes in this feature branch.

## Branch Info
- Current branch: ${CURRENT_BRANCH}
- Base branch: ${BASE_BRANCH}
- Commit count: ${COMMIT_COUNT}

## Commit History
${COMMIT_HISTORY}

## Changed Files
${CHANGED_FILES}

## Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Before reviewing the branch, you **must** perform the following research:

### Research Steps
1. Understand project structure: \`ls src/\`, \`ls test/\`
2. Read core changed files: \`cat <main changed file> | head -200\`
3. Search related tests: \`ls test/unit/\` or \`grep -r "describe" test/ -l | head -5\`
4. Understand module dependencies of changes: \`grep -r "import.*<module name>" src/ -l | head -10\`
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

## Severity Levels

- **P0**: System crash, data loss, security vulnerability
- **P1**: Functional anomaly, severe performance degradation
- **P2**: Code quality, maintainability
- **Nit**: Style suggestion

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

### Merge Gate
- ✅ Ready: No P0/P1
- ⛔ Blocked: Has P0/P1, needs fix`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
