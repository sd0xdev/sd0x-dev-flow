# Codex Prompt: Document Review

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Document Review) -->

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior technical document reviewer. Please review the following document.

## Document Info
- Path: ${FILE_PATH}
- Type: ${FILE_TYPE}
- Project root: ${PROJECT_ROOT}

## ⚠️ Important: You must independently read and research the project ⚠️

The document path is provided above. You **must** read the document content and research the project yourself using your sandbox access. Do NOT expect pre-provided file content — you are responsible for reading the document and verifying its accuracy.

### Document Reading (Priority)
1. Read the full document: \`cat ${FILE_PATH}\`
2. If the document is long: \`cat ${FILE_PATH} | head -300\` then \`cat ${FILE_PATH} | tail -200\`

### Code-Documentation Consistency Research
1. Check project structure: \`ls src/\`, \`ls scripts/\`, \`ls skills/\`
2. Search for files/classes mentioned in the document: \`grep -r "keyword" . -l --include="*.ts" --include="*.js" --include="*.sh" | head -10\`
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

## Severity Calibration ⚠️

Be deliberate about what you mark 🔴. A 🔴 blocks the document and costs a full review round, so it is reserved for defects that would **mislead a reader into doing the wrong thing**:

| Mark 🔴 | Do NOT mark 🔴 |
|---------|----------------|
| A described file, function, flag or command that does not exist | Wording that could be clearer |
| A described behaviour that contradicts what the code actually does | A section you would have structured differently |
| A security or data-handling instruction that is wrong or unsafe | A missing section that no rule requires |
| An internal contradiction — two passages that cannot both be true | Prose where a table would be tidier |
| A broken cross-reference to another document | Hypothetical future concerns not present in the change |

Everything else belongs in 🟡 or ⚪. If you are unsure whether something is 🔴, it is not.

Do not manufacture findings to fill a section. An empty 🔴 section is a legitimate, common result.

Dimensions 1-3 (Architecture / Performance / Security) apply **only where the document actually specifies a design**. A README, a request doc, or a rules file has no architecture to critique — rate those dimensions `N/A` rather than inventing concerns.

## Output Format

Your report **must** begin with the literal line \`## Document Review\`. The state hook uses that
header to tell a document review apart from a code or security review; a report without it is
recorded as no verdict at all, and the review has to be run again.

## Document Review

### Review Summary

| Dimension              | Rating (1-5⭐) | Notes |
|------------------------|----------------|-------|
| Architecture Design    | ...            | ...   |
| Performance            | ...            | ...   |
| Security               | ...            | ...   |
| Documentation Quality  | ...            | ...   |
| Code Consistency       | ...            | ...   |

### 🔴 Must Fix (blocking — see Severity Calibration)

- [Section/Line] Issue description -> Fix recommendation

(Write \`None\` if there are none. That is a normal outcome.)

### 🟡 Suggested Changes (non-blocking)

- [Section/Line] Issue description -> Fix recommendation

### ⚪ Optional Improvements

- Suggestion

### Deferred Findings

For every 🟡 and ⚪ above, emit one line here, starting at column 0:

\`\`\`
[NIT_DEFERRED] <file:line> | <issue> | reason: sub-threshold-doc | <ISO8601 UTC>
\`\`\`

That tag and field order are parsed out of this output by a hook and stored with a TTL, which is what stops the same item being raised again next session. Field 2 is the issue text, field 3 the reason — do not reorder them, and do not use a different tag. Omit this section entirely if there are no 🟡 or ⚪ items.

### Gate

- ✅ Mergeable: No 🔴 items
- ⛔ Needs revision: Has 🔴 items`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
