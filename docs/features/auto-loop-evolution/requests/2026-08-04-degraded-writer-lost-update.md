# Degraded Writers Can Discard the Lock Holder's Transaction (R16)

> **Created**: 2026-08-04
> **Status**: Pending
> **Priority**: P2
> **Found by**: Codex review round 4 of the auto-loop-autonomy checkpoint/ledger work, while
> auditing the `# UNLOCKED-WRITER:` exceptions that `test/hooks/state-commit-ownership.test.js`
> newly made visible

## Background

Four code paths write `.claude_review_state.json` **without holding the lock**, by design. Each is
declared `# UNLOCKED-WRITER:` and each relies on the same argument: the durable record is the
`.blocked` sidecar marker, so the JSON write is best-effort and losing it is harmless.

The argument is incomplete. The JSON write is not an *append* — it is `jq … > tmp && mv tmp
"$STATE_FILE"`, a **whole-file replace**. Losing it is harmless; *landing* it is not. An unlocked
writer that staged its snapshot before the lock holder committed will, on `mv`, discard everything
the holder wrote — round counts, review receipts, iteration history — none of which the sidecar
restores.

This predates the R6/R10 checkpoint work. It was surfaced, not introduced, by the staging-placement
invariant added in that work.

## The interleaving

| Step | Process A (no lock) | Process B (holds `$LOCKDIR`) |
|------|---------------------|------------------------------|
| 1 | `_lock` fails → degraded branch | — |
| 2 | reads `$STATE_FILE`, stages a snapshot | — |
| 3 | — | commits newer round / verdict / history |
| 4 | `mv` lands, replacing B's commit | B's write is gone, silently |

`_may_commit_state` cannot prevent step 4: it returns success precisely *because*
`_EDIT_HOLDS_LOCK=0`, so there is no ownership to assert.

The gate stays fail-closed — A's sidecar marker is still there — so the failure is **not** a missed
review. It is silent loss of unrelated state, which surfaces later as a gate that re-opens for no
visible reason or a round counter that moves backwards.

## Sites

| File | Site | Note |
|------|------|------|
| `hooks/post-edit-format.sh` | `_state_staging_file` else-branch (~:354) and the two bare `mv`s in the doc-plane degraded branch (~:1478, ~:1484) | Staging beside `$STATE_FILE` is correct here — `$LOCKDIR` is the contender's — but the *commit* is the problem, not the placement |
| `hooks/post-tool-review-state.sh` | `update_aggregate_blocked` (~:2479) | Reads and rewrites the main state after `_lock` failed |
| `hooks/post-tool-review-state.sh` | `init_state_file` — its **unlocked** path only, i.e. `_init_staging_file`'s else-branch reached from `update_aggregate_blocked` | `[[ -f ]]` + overwriting rename is **not** atomic create-if-absent: both processes can observe an absent file, and the unlocked initializer's `mv` can replace the holder's initialized-and-updated document with the default one. Its **locked** path is no longer in scope — it stages under `$LOCKDIR` and re-proves `_own_lock` at the rename, so a displaced holder's `mv` now fails instead of landing |
| `hooks/post-edit-format.sh` | `init_state_file` (~:964) reached unlocked from the degraded doc branch | Same defect as the row above, and the function's own comment defers itself here. It commits via `_may_commit_state && mv`, which returns success precisely because `_EDIT_HOLDS_LOCK=0` — a fix worked from this table alone would leave this hook defective |

## Requirements

- On lock contention, write the sidecar and emit the degraded `[AUTO_LOOP_STATE]` fact **only**;
  do not replace the main JSON state.
- If a degraded path must record something durable beyond the marker, put it in a separate
  append-only or event-shaped record rather than in the transactional state file.
- Give `init_state_file` genuine create-if-absent semantics for unlocked callers — e.g. same-
  filesystem hard-link publication treating `EEXIST` as success — or restrict it to locked callers.

## Scope

| Scope | Description |
|-------|-------------|
| In | The four sites above; the degraded-write contract; `init_state_file` atomicity; concurrent-commit tests that actually exercise an unlocked writer racing the holder |
| Out | The locked write paths (already correct); the sidecar mechanism itself; the staging-placement invariant (closed) |

## Why this is deferred rather than fixed in place

Status is `Pending` — the bare token the request-status vocabulary requires. Nothing here has been
started; the deferral rationale is this section, not an annotation on the field.

It changes what a degraded write *is* across two hooks, and every caller of the affected helpers
(`update_change_flag`, `invalidate_review`, the doc-plane branch, `update_aggregate_blocked`) depends
on the current contract. `rules/auto-loop.md` § Cap Diagnostic Protocol directs an architecture-level
finding to ⛔ Need Human rather than a bounded mid-loop adjustment, and `rules/fix-all-issues.md`
§ Exceptions requires it be recorded rather than dropped. This document is that record.

## Verification (when taken up)

The current ownership suite treats an `# UNLOCKED-WRITER:` declaration as sufficient and never
exercises a concurrent commit, so it would stay green through the whole defect. Any fix needs a
forced-interleaving test on the pattern of
`test/hooks/post-compact-auto-loop.test.js` — "a flag flipped WHILE the hook waits for the lock" —
where the unlocked writer stages, the holder commits, and the assertion is that the holder's fields
survive.

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-edit-format.sh` | Modify | Degraded doc/code plane: sidecar-only |
| `hooks/post-tool-review-state.sh` | Modify | `update_aggregate_blocked`; `init_state_file` atomicity |
| `test/hooks/state-commit-ownership.test.js` | Modify | Stop treating the declaration as sufficient once the paths no longer need it |
