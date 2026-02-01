# Document Review Loop

## Re-review Prompt Template

Used with `mcp__codex__codex-reply` when document is revised:

```typescript
mcp__codex__codex-reply({
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

## Loop Rules

When review result is ⛔ Needs revision:

1. Remember the `threadId`
2. Revise the document
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Mergeable

## Gate Sentinels (for Hook parsing)

- `✅ Mergeable` / `## Gate: ✅` — Passed
- `⛔ Needs revision` / `## Gate: ⛔` — Failed
