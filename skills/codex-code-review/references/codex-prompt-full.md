# Codex Prompt: Full Review (with Local Checks)

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer. Perform a comprehensive review of the following code changes.

## Local Check Results
${LOCAL_CHECKS || 'Skipped (--no-tests)'}

## Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

${FOCUS ? `## Focus Area\nPay special attention to: ${FOCUS}` : ''}

## ⚠️ Important: You must independently research the project ⚠️

When reviewing code, you **must** perform the following research, do not rely only on the diff above:

### Git Exploration (Priority)
1. Check change status: \`git status\`
2. Check changed files: \`git diff --name-only HEAD\`
3. Check full changes for specific file: \`git diff HEAD -- <file-path>\`
4. Check full content of changed files: \`cat <changed file> | head -200\`

### Project Research
1. Understand project structure: \`ls src/\`, \`ls test/\`
2. Search related source: \`grep -r "functionName" src/ -l | head -10\`
3. Read full source for context: \`cat <source path> | head -200\`
4. Search existing tests: \`ls test/unit/\` or \`grep -r "describe" test/ -l | head -5\`
5. Read related tests for expected behavior: \`cat <test path> | head -100\`

### Verification Focus
- Do changes follow existing code style?
- Do changes have corresponding tests?
- Do changes affect other modules?
- Are dependencies correct?

## Review Dimensions

### Correctness
- Logic errors, boundary conditions, null handling
- Type safety
- Error handling coverage

### Security
- Injection attacks (SQL/NoSQL/Command)
- Authentication/authorization bypass
- Sensitive data handling
- OWASP Top 10

### Performance
- N+1 queries
- Memory leaks
- Blocking operations
- Unnecessary computations

### Maintainability
- Naming clarity
- Single responsibility
- Appropriate abstraction level
- Testability

## Severity Levels

- **P0**: System crash, data loss, security vulnerability
- **P1**: Functional anomaly, severe performance degradation
- **P2**: Code quality, maintainability
- **Nit**: Style suggestion

## Output Format

### Findings

#### P0
- [file:line] Issue -> Fix recommendation

#### P1
- [file:line] Issue -> Fix recommendation

#### P2
- [file:line] Issue -> Fix recommendation

### Tests Recommendation
- Suggested new test cases

### Merge Gate
- ✅ Ready: No P0/P1
- ⛔ Blocked: Has P0/P1, needs fix`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
