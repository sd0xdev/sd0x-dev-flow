# Document Review Loop

## Re-review Prompt Template

Used with `mcp__codex__codex-reply` when the documents are revised. **One thread per batch** — the
`threadId` belongs to the batch that produced the findings, so re-review goes back to that thread
with that batch's files, never to a merged one.

```typescript
mcp__codex__codex-reply({
  threadId: '<the threadId this batch returned>',
  prompt: `I have revised the documents in this batch. Please re-review:

## Batch
| # | Path | Profile |
|---|------|---------|
${BATCH_MANIFEST}

Profiles are unchanged from the first round unless the table above says otherwise; a fix that
touched a section outside a file's original scope raises that file's profile, and the table shows
the raised one.

Please read the updated files yourself — each to the extent its profile covers — and verify:
1. Have previous 🔴 must-fix items been addressed?
2. Did the revisions introduce new issues?
3. Update Gate status

Keep the same 🔴 bar as the first round — a 🔴 is a defect that would mislead a reader into
doing the wrong thing (a nonexistent file, a contradicted behaviour, an unsafe instruction,
an internal contradiction, a broken cross-reference). Do not re-raise the previous round's
🟡/⚪ items, and do not open a fresh general critique of a document that has already been
through this loop: report only what the revision broke and what it failed to fix.

Begin your report with the literal line \`## Document Review\`, exactly as in the first round.`,
});
```

> Both prompts carry the phrase `Document Review` by construction, which is what the state hook's
> request-side provenance check reads. Mirrors the code plane, where `Merge Gate` appears in both
> the initial template and this loop's "Update Merge Gate status" line.

## Loop Rules

When review result is ⛔ Needs revision:

1. Remember the `threadId` — one per batch
2. Revise the documents
3. Re-review each batch that came back ⛔, using `--continue <that batch's threadId>`
4. Repeat until every batch is ✅ Mergeable

A batch that already passed is not re-dispatched unless the fixes touched one of its files. The
plan's gate is the conjunction: one ⛔ batch blocks the plan. Hold it yourself — the receipt keeps
only the most recent batch verdict (last write wins), so the plan is Mergeable only when the latest
dispatch of **every** batch passed, never because the final dispatch happened to.

## Gate Sentinels (for Hook parsing)

- `✅ Mergeable` / `## Gate: ✅` — Passed
- `⛔ Needs revision` / `## Gate: ⛔` — Failed

Both markers are read **BLOCKED-first**: output carrying both records a failure. `✅ All Pass` is
NOT a doc sentinel — it is behavior-layer prose (`rules/auto-loop.md`), and the hook no longer
accepts it.
