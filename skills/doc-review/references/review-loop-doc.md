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

> Both prompts carry the phrase `Document Review` by construction — the header is what tells a
> document review apart from a code or security review in the report and the conversation
> (behaviour-layer since hook-lightweighting; nothing parses it). Mirrors the code plane, where
> `Merge Gate` appears in both the initial template and this loop's "Update Merge Gate status" line.

## Loop Rules

When review result is ⛔ Needs revision:

1. Remember the `threadId` — one per batch
2. Revise the documents
3. Re-review each batch that came back ⛔, using `--continue <that batch's threadId>` — **unless a rotation condition holds**: per the central contract (`skills/codex-code-review/references/review-common.md` § Review Loop — Thread Rotation), at the R-a threshold (3 replies on that batch's thread; `auto-loop-project.md ## Review Thread Rotation` overrides, 2–6) or on R-b judged context overrun, open a **new** thread for that batch with the first-dispatch template (`codex-prompt-doc.md`) instead — frozen batch manifest only, old findings reconciled orchestration-side — and record `[THREAD_ROTATED] plane=doc_review …`. The batch's per-thread count restarts; one-thread-per-batch is unchanged (the rotation swaps which thread, never how many)
4. Repeat until every batch is ✅ Mergeable

A batch that already passed is not re-dispatched unless the fixes touched one of its files. The
plan's gate is the conjunction: one ⛔ batch blocks the plan. Hold it yourself — the reminder state
holds one `doc_review` slot and a later note overwrites it (last write wins), so the plan is
Mergeable only when the latest dispatch of **every** batch passed, never because the final dispatch
happened to; self-note the plan's verdict once, after the conjunction is decided
(`../SKILL.md` § Step 5).

## Gate Sentinels (behaviour-layer, emit verbatim)

- `✅ Mergeable` — Passed
- `⛔ Needs revision` — Failed

The terminal stands **alone at column 0 on the report's final line** — never inside a heading,
list item or sentence. `## Gate: ✅`-style headed forms are not legal doc verdicts
(`scripts/validate-family-sentinel.js doc` rejects them), and a fallback carrier's raw report is
validated against exactly this shape before its verdict may be adopted.

Nothing parses these anymore (hook-lightweighting) — they are the fixed shapes the model and
reviewers read in reports, and the shape staying fixed is what keeps a verdict unambiguous. Read
them **BLOCKED-first**: output carrying both records a failure. `✅ All Pass` is NOT a doc
sentinel — it is behaviour-layer prose for "every gate passed" (`rules/auto-loop.md`).
