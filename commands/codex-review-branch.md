---
description: Fully automated review of an entire feature branch using Codex MCP
argument-hint: [base-branch] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

## Context

- Current branch: !`git branch --show-current`
- Commits ahead of main: !`git rev-list --count main..HEAD 2>/dev/null || echo 0`
- Changed files: !`git diff --name-only main..HEAD 2>/dev/null | head -10`

## Task

You will use Codex MCP to review an entire feature branch.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                      |
| ----------------------- | -------------------------------- |
| `[base-branch]`         | Base branch (default: main)      |
| `--continue <threadId>` | Continue a previous review session |

### Step 1: Collect Branch Info

```bash
# Basic info
CURRENT_BRANCH=$(git branch --show-current)
BASE_BRANCH=${BASE:-main}
COMMIT_COUNT=$(git rev-list --count $BASE_BRANCH..HEAD)

# Changed files
CHANGED_FILES=$(git diff --name-only $BASE_BRANCH..HEAD)

# Full diff (size limited)
GIT_DIFF=$(git diff $BASE_BRANCH..HEAD --no-color | head -3000)

# Commit history
COMMIT_HISTORY=$(git log --oneline $BASE_BRANCH..HEAD)
```

### Step 2: Execute Codex Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` tool:

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
3. Search related tests: \`ls test/unit/\` or \`grep -r "describe" test/ --include="*.ts" -l | head -5\`
4. Understand module dependencies of changes: \`grep -r "import.*<module name>" src/ --include="*.ts" -l | head -10\`
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
- Type safety (TypeScript)
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

| Dimension           | Rating    | Notes |
| ------------------- | --------- | ----- |
| Feature Completeness| ⭐⭐⭐⭐☆ | ...   |
| Code Quality        | ⭐⭐⭐⭐☆ | ...   |
| Security            | ⭐⭐⭐⭐⭐ | ...   |
| Performance         | ⭐⭐⭐⭐☆ | ...   |
| Test Coverage       | ⭐⭐⭐☆☆  | ...   |

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

**Remember the returned `threadId` for subsequent review loops.**

**Case B: Loop review (has `--continue`)**

Use `mcp__codex__codex-reply` to continue:

```typescript
mcp__codex__codex -
  reply({
    threadId: '<from --continue parameter>',
    prompt: `I have fixed the previously identified issues. Please re-review:

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

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Blocked:

1. Remember the `threadId`
2. Fix P0/P1 issues
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Ready

## Output

```markdown
## Branch Review Report

### Branch Info

- Current branch: <branch>
- Base branch: <base>
- Commits: <count>

### Branch Overview

<one-sentence description>

### Review Summary

| Dimension            | Rating     | Notes |
| -------------------- | ---------- | ----- |
| Feature Completeness | ⭐⭐⭐⭐☆  | ...   |
| Code Quality         | ⭐⭐⭐⭐☆  | ...   |
| Security             | ⭐⭐⭐⭐⭐ | ...   |
| Performance          | ⭐⭐⭐⭐☆  | ...   |
| Test Coverage        | ⭐⭐⭐☆☆   | ...   |

### Findings

#### P0 (Must Fix)

- [file:line] Issue -> Fix recommendation

#### P1 (Should Fix)

- [file:line] Issue -> Fix recommendation

### Merge Gate

✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review

To re-review after fixes:
`/codex-review-branch --continue <threadId>`
```

## Examples

```bash
# Review current branch (compare with main)
/codex-review-branch

# Compare with specific branch
/codex-review-branch origin/develop

# Continue review after fixes
/codex-review-branch --continue abc123
```
