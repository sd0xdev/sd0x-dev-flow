# Document Review Loop

## Re-review Prompt Template

Used with `mcp__codex__codex-reply` when document is revised:

```typescript
mcp__codex__codex-reply({
  threadId: '<from --continue parameter>',
  prompt: `I have revised the document. Please re-review:

## Document Path
${FILE_PATH}

Please read the updated document yourself using \`cat ${FILE_PATH}\` and verify:
1. Have previous 🔴 must-fix items been addressed?
2. Did revisions introduce new issues?
3. What is the quality of the revised document?
4. Update Gate status

Begin your report with the literal line \`## Document Review\`, exactly as in the first round.`,
});
```

> Both prompts carry the phrase `Document Review` by construction, which is what the state hook's
> request-side provenance check reads. Mirrors the code plane, where `Merge Gate` appears in both
> the initial template and this loop's "Update Merge Gate status" line.

## Loop Rules

When review result is ⛔ Needs revision:

1. Remember the `threadId`
2. Revise the document
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Mergeable

## Gate Sentinels (for Hook parsing)

- `✅ Mergeable` / `## Gate: ✅` — Passed
- `⛔ Needs revision` / `## Gate: ⛔` — Failed

Both markers are read **BLOCKED-first**: output carrying both records a failure. `✅ All Pass` is
NOT a doc sentinel — it is behavior-layer prose (`rules/auto-loop.md`), and the hook no longer
accepts it.
