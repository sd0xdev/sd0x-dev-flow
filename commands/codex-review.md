---
description: Full second-opinion using Codex MCP (with lint:fix + build). Supports review loop with context preservation.
argument-hint: [--no-tests] [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

You will use Codex MCP for a full code review (with lint:fix + build + review).

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                                 |
| ----------------------- | ------------------------------------------- |
| `--no-tests`            | Skip lint:fix and build steps               |
| `--focus "<text>"`      | Focus on specific area (e.g. "auth")        |
| `--base <gitref>`       | Compare with specified branch (e.g. origin/main) |
| `--continue <threadId>` | Continue a previous review session          |

### Step 1: Run Local Checks (unless --no-tests)

If `--no-tests` not specified, run local checks first:

```bash
# lint:fix
{LINT_FIX_COMMAND}

# build
{BUILD_COMMAND}
```

Record check results (pass/fail), save as `LOCAL_CHECKS`.

### Step 2: Collect Git Diff

```bash
# If --base parameter, compare with specified branch; otherwise check uncommitted changes
git diff HEAD --no-color | head -2000
```

Save diff content as `GIT_DIFF` variable.

### Step 3: Execute Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` to start a new review session:

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
2. Search related source: \`grep -r "functionName" src/ --include="*.ts" -l | head -10\`
3. Read full source for context: \`cat <source path> | head -200\`
4. Search existing tests: \`ls test/unit/\` or \`grep -r "describe" test/ --include="*.ts" -l | head -5\`
5. Read related tests for expected behavior: \`cat <test path> | head -100\`

### Verification Focus
- Do changes follow existing code style?
- Do changes have corresponding tests?
- Do changes affect other modules?
- Are dependencies correct?

## Review Dimensions

### Correctness
- Logic errors, boundary conditions, null handling
- Type safety (TypeScript)
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

**Remember the returned `threadId` for subsequent review loops.**

**Case B: Loop review (has `--continue`)**

Use `mcp__codex__codex-reply` to continue the previous session:

```typescript
mcp__codex__codex -
  reply({
    threadId: '<from --continue parameter>',
    prompt: `I have fixed the previously identified issues. Please re-review:

## Local Check Results
${LOCAL_CHECKS || 'Skipped'}

## New Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

Please verify:
1. Have previous P0/P1 issues been correctly fixed?
2. Did fixes introduce new issues?
3. Update Merge Gate status`,
  });
```

### Step 4: Consolidate Output

Integrate Codex review results and local check results into the standard format.

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Blocked:

1. Remember the `threadId`
2. Fix P0/P1 issues
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Ready

## Output

```markdown
## Codex Full Review Report

### Local Checks

- lint:fix: ✅ Pass / ❌ Fail
- build: ✅ Pass / ❌ Fail

### Review Scope

- Change stats: <git diff --stat summary>
- Focus area: <focus or "all">

### Findings

#### P0 (Must Fix)

- [file:line] Issue -> Fix recommendation

#### P1 (Should Fix)

- [file:line] Issue -> Fix recommendation

#### P2 (Suggested Improvement)

- [file:line] Issue -> Fix recommendation

### Tests Recommendation

- Suggested new test cases

### Merge Gate

✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review

To re-review after fixes, use:
`/codex-review --continue <threadId>`
```

## Examples

```bash
# Full review (with lint + build)
/codex-review

# Skip local checks
/codex-review --no-tests

# Focus on specific area
/codex-review --focus "database queries"

# Compare with main branch
/codex-review --base origin/main

# Continue review after fixes (preserve context)
/codex-review --continue abc123
```
