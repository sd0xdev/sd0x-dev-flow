# Codex Prompt: Document Review

Used with `mcp__codex__codex`:

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
2. Search for files/classes mentioned in the document: \`grep -r "keyword" src/ -l | head -10\`
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
