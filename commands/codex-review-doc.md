---
description: Review documents using Codex MCP. Supports review loop with context preservation.
argument-hint: [<file-path>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Glob
skills: doc-review
---

## Context

- Git modified docs: !`git diff --name-only HEAD 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Git staged docs: !`git diff --cached --name-only 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Untracked docs: !`git ls-files --others --exclude-standard 2>/dev/null | grep -E '\.(md|txt)$' | head -5`

## Task

You will use Codex MCP to review documents.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                              |
| ----------------------- | ---------------------------------------- |
| `<file-path>`           | File path (optional, auto-detect)        |
| `--continue <threadId>` | Continue a previous review session       |

### Step 1: Determine Target File

**Path specified**: Use that path directly

**No path specified**: Auto-select in priority order:

1. **Git modified docs** - `.md` files from `git diff --name-only HEAD`
2. **Git staged docs** - `.md` files from `git diff --cached --name-only`
3. **New docs** - `.md` files from `git ls-files --others --exclude-standard`

If multiple files found, list them and ask the user which to review.

### Step 2: Read File Content

```bash
Read(TARGET_FILE)
```

Save file content as `FILE_CONTENT` variable.

### Step 3: Execute Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` to start a new review session:

```typescript
mcp__codex__codex({
  prompt: `You are a senior technical document reviewer. Please review the following document.

## Document Info
- Path: ${FILE_PATH}
- Type: ${FILE_TYPE}
- Project root: ${PROJECT_ROOT}

## Document Content
\`\`\`${FILE_TYPE}
${FILE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

When reviewing "code-documentation consistency", you **must** perform the following research:

### Research Steps
1. Run \`ls src/\` to understand project structure
2. Search for files/classes mentioned in the document: \`grep -r "keyword" src/ --include="*.ts" -l | head -10\`
3. Read related files: \`cat <file-path> | head -100\`
4. Verify:
   - Do files mentioned in the document exist?
   - Are function/class names correct?
   - Do technical descriptions match actual code?

## Review Dimensions

### 1. Architecture Design
- Are system boundaries clear
- Are component responsibilities single
- Are dependencies reasonable
- Extensibility and maintainability

### 2. Performance Considerations
- Are there potential performance bottlenecks
- Batch processing and concurrency design
- Is caching strategy appropriate
- Resource usage efficiency

### 3. Security
- Is there sensitive data leakage risk
- Is access control comprehensive
- Is input validation sufficient
- Is error handling secure

### 4. Documentation Quality
- Is structure clear
- Is content complete
- Are technical descriptions accurate
- Are examples sufficient
- Does it follow docs-writing standards (tables first, Mermaid diagrams)

### 5. Code-Documentation Consistency (requires independent research)
- Does pseudocode match actual codebase style
- Do referenced files/methods exist (**verify with grep/cat**)
- Are technical details accurate

## Output Format

### Review Summary

| Dimension              | Rating (1-5⭐) | Notes |
|------------------------|----------------|-------|
| Architecture Design    | ...            | ...   |
| Performance            | ...            | ...   |
| Security               | ...            | ...   |
| Documentation Quality  | ...            | ...   |
| Code Consistency       | ...            | ...   |

### 🔴 Must Fix (P0/P1)

- [Section/Line] Issue description → Fix recommendation

### 🟡 Suggested Changes (P2)

- [Section/Line] Issue description → Fix recommendation

### ⚪ Optional Improvements

- Suggestion

### Gate

- ✅ Mergeable: No 🔴 items
- ⛔ Needs revision: Has 🔴 items`,
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
    prompt: `I have revised the document. Please re-review:

## Updated Document Content
\`\`\`${FILE_TYPE}
${FILE_CONTENT}
\`\`\`

Please verify:
1. Have previous 🔴 must-fix items been addressed?
2. Did revisions introduce new issues?
3. What is the quality of the revised document?
4. Update Gate status`,
  });
```

### Step 4: Consolidate Output

Organize Codex review results into the standard format.

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Needs revision:

1. Remember the `threadId`
2. Revise the document
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Mergeable

## Output

```markdown
## Document Review Report

### Reviewed Document

- Path: <file-path>
- Type: <markdown|txt>

### Review Summary

| Dimension          | Rating     | Notes |
| ------------------ | ---------- | ----- |
| Architecture Design| ⭐⭐⭐⭐☆  | ...   |
| Performance        | ⭐⭐⭐☆☆   | ...   |
| Security           | ⭐⭐⭐⭐⭐ | ...   |
| Documentation Quality | ⭐⭐⭐⭐☆ | ...  |
| Code Consistency   | ⭐⭐⭐☆☆   | ...   |

### 🔴 Must Fix (P0/P1)

1. [Section/Line] Issue description → Fix recommendation

### 🟡 Suggested Changes (P2)

1. [Section/Line] Issue description → Fix recommendation

### ⚪ Optional Improvements

- Suggestion

### Gate

✅ Mergeable / ⛔ Needs revision (N 🔴 items)

### Loop Review

To re-review after revisions, use:
`/codex-review-doc --continue <threadId>`
```

## Examples

```bash
# Review a specific file
/codex-review-doc docs/features/xxx/tech-spec.md

# Auto-detect changed documents
/codex-review-doc

# Continue review after revisions (preserve context)
/codex-review-doc --continue abc123
```

## Related Standards

Reference the following standards when reviewing:

- @rules/docs-writing.md - Documentation writing rules
