---
description: Quick second-opinion using Codex MCP (diff only, no tests). Supports review loop with context preservation.
argument-hint: [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

You will use Codex MCP for a quick code review (diff only, no lint/build/test).

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                                 |
| ----------------------- | ------------------------------------------- |
| `--focus "<text>"`      | Focus on specific area (e.g. "auth")        |
| `--base <gitref>`       | Compare with specified branch (e.g. origin/main) |
| `--continue <threadId>` | Continue a previous review session          |

### Step 1: Collect Git Diff

Collect the code changes to review:

```bash
# If --base parameter, compare with specified branch; otherwise check uncommitted changes
git diff HEAD --no-color | head -2000
```

Save diff content as `GIT_DIFF` variable.

### Step 2: Execute Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` to start a new review session:

```typescript
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer. Review the following code changes, focus on finding issues rather than praise.

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
- Search called functions: \`grep -r "functionName" src/ --include="*.ts" -l\`
- Read related files: \`cat <file-path> | head -100\`
- Understand class definitions: \`grep -A 20 "class ClassName" src/\`

## Review Dimensions

| Dimension      | Checklist |
|----------------|-----------|
| Correctness    | Logic errors, boundary conditions, null handling, off-by-one |
| Security       | Injection attacks, auth bypass, sensitive data leaks, OWASP Top 10 |
| Performance    | N+1 queries, memory leaks, unnecessary loops, blocking operations |
| Maintainability| Naming clarity, function length, duplicate code, over-abstraction |

## Severity Level Definitions

- **P0**: Would cause system crash, data loss, security vulnerability
- **P1**: Would cause functional anomaly, severe performance degradation
- **P2**: Code quality issues, maintainability concerns
- **Nit**: Style suggestions, minor improvements

## Output Format

### Findings

- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation>

### Merge Gate

- ✅ Ready: No P0/P1, safe to merge
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

### Step 3: Consolidate Output

Organize Codex review results into the standard format.

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Blocked:

1. Remember the `threadId`
2. Fix P0/P1 issues
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Ready

## Output

```markdown
## Codex Quick Review Report

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

#### Nit

- [file:line] Suggestion

### Merge Gate

✅ Ready / ⛔ Blocked (need to fix N P0/P1 issues)

### Loop Review

To re-review after fixes, use:
\`/codex-review-fast --continue <threadId>\`
```

## Examples

```bash
# Basic usage - review uncommitted changes
/codex-review-fast

# Focus on specific area
/codex-review-fast --focus "authentication"

# Compare with main branch
/codex-review-fast --base origin/main

# Continue review after fixes (preserve context)
/codex-review-fast --continue abc123
```
