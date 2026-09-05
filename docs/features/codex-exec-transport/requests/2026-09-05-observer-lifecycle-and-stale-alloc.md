# Observer lifecycle and stale alloc sweep

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-05
> **Status**: Candidate Complete
> **Note**: Work item 8 of the tech spec's § 5 — a bug fix on item 7, opened the same day from what the operator saw in `/tasks`: many "running" tasks that were watching nothing. Amends INV-002 (size) only.
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.2 Adapter contract (`alloc` row, Size row), § 5 item 8
> **Depends On**: [Progress channel](./2026-09-05-progress-channel.md) — the observation recipe this fixes
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-002 amended here; INV-003/INV-005/INV-006 untouched

## Background

Two defects with one root: **an observer whose lifetime is not bound to what it observes.**

1. **Orphaned watchers.** The § Progress recipe's only exit was a terminal `status` read from
   `progress.json`. After `cleanup` removed that file the loop had nothing to read and no reason
   to stop; a wrong path or a preflight failure that never wrote the file behaved the same. The
   contract put the termination on a manual `TaskStop` whose task id lived only in the
   conversation — and a context compaction dropped it. Measured 2026-09-05: **7** watcher shells
   from cleaned-up dispatches still polling, the oldest for 1 h 50 min, every one of them showing
   as a running task. Silence from a watcher is supposed to mean *running*; these were silent
   forever.
2. **Stale scratch directories.** `cleanup` is the caller's step, and a caller that is gone — a
   lost completion notification, a killed session, a compaction that dropped the alloc record —
   never runs it. Nothing else ever removed an alloc directory. Measured 2026-09-05: **2180**
   `codex-exec-*` directories under the temp root, the oldest from 2026-09-04 11:10, 59 created
   that day; the adapter test suite was checked and leaks none (`before=2180 after=2180`).

## Root cause

- Defect 1: `codex-transport.md` § Progress step 2 — the recipe treated "no readable file" as
  "not yet" indefinitely; step 3 made termination a conversation-held obligation.
- Defect 2: `scripts/codex-exec.js` `alloc()` — no reaping path existed; the lifecycle assumed a
  caller who always reaches `cleanup`.

## Fix

**Direct fix; existing design retained.** The adapter stays the sole owner of the scratch
lifecycle (INV-007) and the reference stays the sole statement of the choreography (INV-001).

| Defect | Change | Where |
|---|---|---|
| 1 | The recipe counts consecutive polls without a parsable, shape-valid `progress.json` and exits after **three** (the first at once, then two 30 s sleeps — 60 s; *round 9 corrected "two", which was 30 s*) with one line: `progress unreadable for 60s — dispatch ended, cleaned up, or wrong path`. `cleanup` therefore terminates the watcher; `TaskStop` silences it sooner and is no longer an obligation | `codex-transport.md` § Progress steps 2–3; `codex-code-review/SKILL.md` § Step 3.5 |
| 2 | `alloc` reaps stale siblings before creating its own directory: every `codex-exec-*` entry under the temp root that is **this user's `0700` directory** (`lstat` — never a symlink) with a directory **mtime older than 24 h** is removed best-effort; a failing sweep never fails the `alloc`. *Amended in round 5 (below)*: the sweep also reads the owner record at the head of the candidate's `progress.json` — the one thing it reads inside — and never reaps a directory whose owner process still exists. The clock is sound because a live dispatch renames `progress.json` into its directory on every event and tick (measured: a same-directory rename refreshes the directory mtime), so a running dispatch is never a day stale | `scripts/codex-exec.js` `sweepStale()`, called from `alloc()`; `codex-transport.md` § Alloc, § Cleanup; spec § 3.2 `alloc` row |
| 2, review round 1 | Thorough-tier P2 (thread `01a070b8-f5cc-7a33-b98a-2f4f51f9d28e`): `lstat` validated one inode, `rmSync(d, {recursive})` re-resolved the name — a same-user neighbour swapping a live directory under the checked name would have it erased. Fix: rename the candidate to a random `.reap-*` quarantine name, re-`lstat`, compare `{dev, ino}`, delete only on a match; a mismatch renames it back. The pattern is `docs/features/workflow-orchestration/4-implementation.md` § 1.1 (rename → verify → delete); the full pinned-descriptor walk there does not fit a thin adapter and was not taken | `sweepStale()`; § Alloc; spec `alloc` row |
| 2, review round 2 | Same thread, reply 1, P2 again: the identity check was followed by `rmSync(q, {recursive})`, which re-resolves `q` — the window had moved from the checked name to the quarantine name, not closed. Fix: delete **bound to the inode** — `chdir(q)`, compare `stat('.')` with the validated `{dev, ino}`, unlink entries by relative name (resolved from the kernel's cwd reference, so a rename of `q` cannot redirect them), then a non-recursive `rmdir` that refuses contents. A substitute swapped in at `q` after the re-check keeps its files and stays quarantined | `reapPinned()`; § Alloc; spec `alloc` row |
| 2, review round 3 | Same thread, reply 2, two P2: (a) the per-entry `lstat → unlink` inside the pinned directory had the substitution window one level down — fixed with the repo's `unlinkVerified` ordering (rename to a random inner name → re-`lstat` → unlink only the checked inode, never a directory); (b) `process.cwd()` sat outside the best-effort boundary, so a removed inherited cwd would have failed `alloc` — moved inside. The parallel test review's P1s the same round: the after-pin swap and the child swap needed their own injections and controls; the cwd and inner-listing catches needed faults; the observer child needed cleanup on a failed assertion | `reapPinned()`; § Alloc; spec `alloc` row; fixture modes `sweep-swap-after-pin`, `sweep-swap-child`, `sweep-cwd`, `sweep-readdir-inner` |
| 2, review round 5 (fresh threads) | Code P1: the mtime is a heartbeat and a heartbeat can stop while its owner lives — a machine asleep for a day, or every snapshot failing — so a live dispatch could be reaped. Fix: positive liveness — the adapter writes `{"protocol":1,"status":"starting","pid":<pid>}` into `progress.json` at preflight (a guaranteed write before the child; a failure is `invalid_progress_file`), every snapshot carries `pid`, and the sweep reads that one file and skips a directory whose owner answers `kill(pid, 0)`. Code P2: the observer reset its miss count on any parsable JSON, so a wrong path holding `{}` was polled forever — the reader now requires `protocol` 1 and a run `status`. Code P2: the AC5c control disabled only the outer identity check, so the pinned one relocated the substitute and "erased" was false — both checks are mutated now and erasure is asserted at every name. Test P1: AC4 had no case where the periodic tick was the only refresh — a held silent child now proves it | `ownerAlive()`, preflight owner record, `snapshot()`; § Alloc, § Progress recipe; spec `alloc`/Progress rows |
| 2, review round 6 | Code P1: the owner check parsed `progress.json` whole under a 64 KiB cap, so a live dispatch whose snapshot had grown (the child's command text is unbounded) read as dead. Fix: the record is read as the fixed prefix every snapshot begins with — `{"protocol":1,"status":"…","pid":N` — 96 bytes, anchored at byte 0 (which is also what keeps a nested `pid` from counting), size behind it irrelevant. Code P2 / test P1: this ticket still said ≤260 and "nothing inside is read" — fixed, and the size test now pins the ticket too. Test P1s: preflight-before-spawn proven with a hold at the spawn call; the owner-record write failure injected; `EPERM` liveness tested with its control | `OWNER`, `ownerAlive()`; fixture modes `pause-before-spawn`, `progress-owner-write`, `sweep-kill-eperm`; the fake binary now writes whole lines synchronously (a 70 KiB command line reached the adapter truncated past the pipe buffer, and its trailing async write was dropped by `process.exit`) |
| 2, review round 7 | Code P1: `lstat` then a blocking `open` by name — a FIFO swapped in between parks the open forever and `alloc` with it. Fix: open `O_RDONLY\|O_NONBLOCK\|O_NOFOLLOW`, judge the descriptor with `fstat`. Test P1s: the 96-byte bound was not pinned (a whole-file read passed every test) — an injector now refuses any other read of the owner record; the `starting` record was proven written but not proven to count as live — the held pre-spawn test now ages the directory and runs an `alloc`. Test P2 taken: `pid: 0` — `kill(0, 0)` signals our own process group and succeeds, so zero would have protected debris forever; the sweep now requires `pid > 0` and the invalid-owner table pins it | `ownerAlive()`; fixture modes `sweep-fifo-swap`, `sweep-owner-read-budget`. Recorded because it is the class this repo keeps meeting: the first FIFO test passed vacuously — its candidate had no owner record, so the injector's rename threw before `mkfifo` and no FIFO was ever installed; the control (blocking open) then "passed" too. Both candidates now carry a live record, and the control is asserted to be killed by the deadline |
| 2, review round 9 (fresh threads) | Code P1: the owner probe read every unexpected error — `EIO`, `EMFILE`, a non-`ESRCH` kill error — as "dead", and the eligibility checks were made once under the old name, so a delayed `start` reactivating the same inode between check and rename lost its directory. Fix: the probe is tri-state (false only on proof: no record, non-file, non-owner prefix, `ESRCH`), and uid, mode, age and owner are re-decided on the quarantined inode, restoring the directory if any changed. Code P2: the watcher's "60s" was 30 s (poll at once, one sleep, exit) — three polls now. Code P2: the report's preflight `closeSync` sat outside the exit-2 boundary — an uncaught throw would have read as `codex_fail`. Test review the same round: `✅ Tests sufficient` on the fresh thread | `ownerAlive()`, `sweepStale()`, preflight; § Alloc, § Progress; fixture modes `sweep-probe-error`, `sweep-reactivate`, `report-close` |
| 2, review round 10 | Code, three P2: (a) the owner prefix accepted pids the adapter cannot write — `2147483648` (rejected by `kill()` with a validation error the tri-state read as "unknown, keep": permanent protection for debris), ten digits, a leading zero — now `[1-9]\d{0,9}` and `≤ INT32`; (b) `createPrivate` leaked the file and descriptor on a failed `fchmod`, and a failed snapshot rename left its temp — four per event; both cleaned up, with a 40-event faulted run asserting no `.tmp` debris; (c) two summaries still said "two polls" — corrected and pinned. Test P1: the outer probe catch (fstat/read) had no injector — added with its control | `OWNER`, `ownerAlive()`, `createPrivate()`, `snapshot()`; fixture modes `sweep-probe-error` (fstat/read), `snapshot-chmod`, `snapshot-rename`; fake seam `FAKE_CODEX_EXTRA_EVENTS` |
| — | INV-002 220 → 290 lines (measured 289; the reviewer allowed the constraint to move for this) | intent, spec Size row, size test |

Why alloc time and 24 h: the next dispatch is the one moment the adapter is guaranteed to run, so
garbage is bounded to one day's dispatches with no scheduler and no new subcommand; a day is long
enough that an unread report from an interrupted session is still there when the session resumes,
and short enough that the temp root never again holds thousands.

Rejected: having the Monitor run the adapter itself (one task, no `TaskStop`) — it would let the
Monitor's own rate limiting or timeout kill a review, which is the observability-fails-the-run
class § Progress exists to refuse.

## Acceptance Criteria

- [x] AC1: The § Progress recipe, run against a path that never exists, exits 0 after three polls
  (the first at once, then two 30 s sleeps — the 60 s the line claims) with exactly the one
  `progress unreadable` line — and against an empty file, a stable `{}`, and
  the preflight `starting` record likewise (only a `protocol` 1 snapshot with a run `status`
  counts as a read); the existing terminal-status run is unchanged
  (`test/skills/codex-transport.test.js`).
- [x] AC2: `alloc` removes a sibling `codex-exec-*` directory that is this user's `0700` and
  has a directory mtime 25 h old; keeps a fresh one, a `0755` one, a non-prefixed one, a regular
  file, and a symlink whose target it never follows (`test/scripts/codex-exec.test.js`).
- [x] AC3: Guard direction (`@rules/testing.md` § Guards): a copy of the adapter with the sweep
  call removed, run on the same fixture, leaves the stale directory in place — the test can go
  negative on the actual execution path.
- [x] AC4: A dispatch refreshes its directory mtime — after `start` runs on a directory whose
  mtime was set 25 h back, the mtime is current, so a later `alloc` keeps it; and a **silent**
  held dispatch, aged only after every start-time write, is refreshed by the periodic tick alone.
- [x] AC4b: A live dispatch whose heartbeat has stopped (held child, tick beyond the test, directory
  aged) is kept because its owner pid answers — also when its snapshot has grown past 64 KiB; a
  stale directory whose recorded owner pid is dead is reaped; the exact `starting` owner record is
  in `progress.json` while the adapter is held **before** its spawn call and the fake has not
  launched; a failed owner-record write is `invalid_progress_file` with no launch; `EPERM` from
  `kill(pid, 0)` keeps the directory and the control reading it as dead reaps it; a record that is
  not the adapter's prefix (nested pid, oversized pid, string pid, pid zero, wrong key order,
  symlinked file) gives no liveness; the `starting` record written before spawn counts as live
  (the held pre-spawn dispatch, aged, survives an `alloc`); only the 96-byte prefix is ever read
  (an injector refuses any other read, through the path or the open descriptor, and the control
  reading the whole file through the descriptor is reaped); a directory swapped in at the record's
  path after the open changes nothing while the control judging by name loses the candidate; an
  unexpected `EIO`/`EMFILE` on the open or `EINVAL` from `kill` keeps the candidate (unknown is not
  dead) and the control mapping it to dead reaps it; a directory reactivated on the same inode
  between the checks and the rename (a delayed `start` writing its record and refreshing the
  mtime) is given back, and the control deciding on identity alone reaps it; a failed preflight
  close of the report is `invalid_report_file`, exit 2; a
  FIFO swapped in at the record's path cannot hang the
  sweep (non-blocking open, descriptor judged) and the control without `O_NONBLOCK` hangs until
  the test deadline kills it; the control with the liveness call removed reaps the live dispatch.
- [x] AC5: Every best-effort catch in the sweep is driven deterministically through the preload
  fault injector — `sweep-readdir`, `sweep-lstat`, `sweep-rename`, `sweep-recheck`, `sweep-rm`
  (the first unlink), `sweep-restore` — with the target enumerated **first** so the continuation
  assertion is order-independent: `alloc` still exits 0, the faulted entry survives (under its own
  name for readdir/lstat/rename faults, under its quarantine name for recheck/unlink/restore
  faults, contents intact), and for every per-entry fault the second stale entry is still reaped —
  for `sweep-readdir` it survives too, since a failed root listing means no sweep at all; a control
  with the per-entry `lstat` catch removed aborts the whole `alloc`. The permission-based listing
  test stays as well.
- [x] AC5b: A stale-looking directory whose `uid` differs (Stats proxy) is never removed while a
  same-shaped directory of ours in the same run is — the ownership guard can go negative.
- [x] AC5c: A fresh directory swapped under the checked name between `lstat` and the rename is
  renamed back with its contents intact and nothing is left in quarantine; the control disables
  the whole protection that stands between the swap and erasure — the post-rename re-decision
  (identity, uid, mode, age, owner) and the pinned `stat('.')` identity check — and erases it at
  every name. Replacing the `{dev, ino}` comparison alone only relocates the substitute, which is
  the documented safe failure, so that narrower mutation is not the control.
- [x] AC5d: A fresh directory swapped in at the **quarantine** name after the re-check keeps its
  contents under that name (the non-recursive `rmdir` refuses it) and the moved-aside original is
  untouched; the control with the pinned `stat('.')` identity check replaced by `true` empties it.
- [x] AC5e: A fresh directory swapped in at the quarantine name **after the pin** keeps its
  same-named file while the stale file in the pinned original inode is the one removed; the
  control with the per-entry calls resolved through `q` instead of the pinned cwd erases it.
- [x] AC5f: A file swapped under an entry name after its `lstat` is parked under an inner
  quarantine name, never unlinked, and the moved-aside original is untouched; the control without
  the per-entry `{dev, ino}` comparison unlinks it. A stale entry holding a nested directory stays
  quarantined with it while the sweep continues.
- [x] AC5g: `process.cwd()` throwing once the target is quarantined, and `readdir('.')` throwing
  inside the pinned directory, each leave `alloc` at exit 0 with the entry quarantined and the
  next stale entry reaped. The observer sequence test kills and awaits its shell on any failure.
- [x] AC5h (known limit, characterized): a file swapped under the inner random name **after** its
  re-`lstat` is unlinked — the final unlink is name-based and guarded by unpredictability, as the
  precedent states; the test asserts that outcome so a change in either direction is noticed.
- [x] AC1b: The observer tolerates one miss and counts only consecutive misses — a runtime
  sequence (miss, valid `running` read, delete, miss, miss, miss → exit) where each poll is observable
  and the next one is released by the test over stdin (no scheduler interval), so `-ge 1` or a
  dropped `miss=0` fails; the `failed` terminal status is run too.
- [x] AC6: INV-002, the spec Size row, this ticket and the size test agree on ≤290 (lines counted as `wc -l` counts); `npm test` green.
- [x] AC7: Gates — `/codex-review-fast` `✅ Ready` (round 12, thread `01a0712d-1da0…`, noted at
  code digest `sha256:a34e052d…`), `/precommit` `## Overall: ✅ PASS` (noted at the same digest),
  `/codex-test-review --ac-trace` `✅ Adequate` (fresh thread `01a0717c-8d03-7521-864e-b733eb9b5606`,
  15/15 covered, 0 exceptions; the first thread `01a07170-613d…` returned `Inadequate` on the two
  AC wordings corrected above, and its resume was void — an empty prompt, recorded here so the
  count of dispatches is honest); `/codex-review-doc` over the whole `.md` batch is the last gate,
  and this tick is itself a doc-plane edit, so that review's verdict lives in the conversation and
  is the last thing said — this record does not restate it.

## Related Files

| File | Change |
|---|---|
| `scripts/codex-exec.js` | `STALE_MS`, `sweepStale()`, `reapPinned()`, call in `alloc()` |
| `test/scripts/codex-exec.test.js` | size budget 290 (counted as `wc -l`); `alloc reaps stale siblings` suite — fault table, swap windows with mutation controls, known-limit case |
| `test/skills/codex-transport.test.js` | recipe self-exit runs, consecutive-miss sequence over stdin; § Alloc / step 3 pins |
| `test/fixtures/codex-exec/fs-fault.js` | the `sweep-*` modes: target-first listing, per-stage faults, the four swap windows, cwd and inner-listing faults, `EPERM` liveness; `pause-before-spawn`, `progress-owner-write` |
| `test/fixtures/codex-exec/fake-codex.js` | whole-line synchronous stdout writes, so oversized lines survive the pipe buffer |
| `skills/codex-code-review/references/codex-transport.md` | § Alloc, § Cleanup, § Progress steps 2–3 and recipe |
| `skills/codex-code-review/SKILL.md` | Step 3.5 sentence |
| `docs/features/codex-exec-transport/2-tech-spec.md` | § 3.2 `alloc` row, Size row; § 5 item 8 |
| `docs/features/codex-exec-transport/intent-codex-exec-transport.md` | INV-002 |

## Progress

| Phase | Status | Notes |
|---|---|---|
| Investigation | ✅ | 7 orphaned watchers, 2180 stale dirs, test suite leaks 0 (measured) |
| Development | ✅ | First real `alloc` after landing reaped the temp root 2180 → 149 directories (all under a day old); the two review dispatches' watchers ended on their own at `done` |
| Review rounds | ✅ | 12 code-review rounds across three threads (two rotations), 12 test-review rounds across three threads; every round's findings closed in the next; no stall (each round closed the previous findings by identity) |
| Testing | ✅ | Test review round 1 (thread `01a070b8-ef9e-7640-a120-e65c5395571d`) `⛔` three P1 gaps — consecutive-miss semantics, per-entry fault paths, foreign-uid guard — closed (AC1b/AC5/AC5b); round 2 `⛔` two P1 — the quarantine-stage catches untested, `sweep-lstat` continuation order-dependent — closed (AC5 as now written); its P2s taken on the spot: stdin handshake for the observer sequence, `wc -l` line counting. Code review round 1 (thread `01a070b8-f5cc-7a33-b98a-2f4f51f9d28e`) `⛔` P2 closed by AC5c; round 2 `⛔` P2 (the quarantine-name window) closed by AC5d; round 3 `⛔` two P2 (child-entry window, `cwd` outside the boundary) closed by AC5e/AC5g. Test review round 3 `⛔` three P1 (after-pin swap untested, cwd/inner catches untested, observer child left blocked on failure) closed by AC5e/AC5g. Round 4 (reply 3 on both threads): code `⛔` P1 — the AC5e control mutated only two of the three per-entry resolutions, so it relocated the substitute instead of erasing it — plus P2 stale `240` in two summaries; test `⛔` the same control flaw plus the last inner window (`lstat(qn) → unlink(qn)`). Fixed: all three resolutions mutated with per-anchor checks and the control asserts the substitute is gone; the inner window is a **known limit** stated in § Alloc and pinned by a characterizing test (Node has no unlink-by-descriptor; the precedent relies on unpredictability the same way). Both threads exhausted 3 replies → the next dispatches rotate: `[THREAD_ROTATED] plane=code_review old=01a070b8-f5cc-7a33-b98a-2f4f51f9d28e new=<fresh> reason=rounds`, `[THREAD_ROTATED] plane=test_review old=01a070b8-ef9e-7640-a120-e65c5395571d new=<fresh> reason=rounds`. Round 5 (fresh threads `01a070f3-1686-7593-b24f-1a09f7ba9094` code, `01a070f3-0f85-7681-894c-c37f66f28a91` test): code `⛔` P1 liveness + two P2 (observer `{}`, AC5c control), test `⛔` P1 (tick-only refresh) — all closed (AC4/AC4b/AC1/AC5c as now written). Round 6 (reply 1 on both): code `⛔` P1 (64 KiB cap defeats the owner check) + P2 (ticket at ≤260, fix summary stale); test `⛔` four P1 (preflight chronology unproven, owner-write failure uninjected, `EPERM` branch untested, ticket at ≤260) — all closed (AC4b/AC6 as now written). Round 7 (reply 2 on both): code `⛔` P1 (FIFO swap hangs the blocking open); test `⛔` two P1 (96-byte bound unpinned, `starting` liveness unproven) + P2 `pid: 0` taken — all closed (AC4b as now written). The next dispatch on each thread is reply 3, the last before rotation. Round 8 (reply 3 on both): code `✅ Ready` (noted, digest `sha256:c443f4a6…`, then reopened by the test edits below); test `⛔` two P1 — the read-budget injector missed `readFileSync(fd)` through the numeric descriptor, and the FIFO test could not tell `fstat(fd)` from `stat(path)` — closed with a tightened injector, an after-open directory swap mode and controls for both. Both fresh threads exhausted 3 replies → rotation again: `[THREAD_ROTATED] plane=code_review old=01a070f3-1686-7593-b24f-1a09f7ba9094 new=01a0712d-1da0-7b42-9c87-76d23890e6c0 reason=rounds`, `[THREAD_ROTATED] plane=test_review old=01a070f3-0f85-7681-894c-c37f66f28a91 new=01a0712d-253a-7d33-9b45-cd07e51d9713 reason=rounds`. Round 9 (fresh threads): test `✅ Tests sufficient` (P2s deferred: 24 h boundary, cwd-restore fault, per-call inner faults); code `⛔` P1 + two P2 (above), closed. Round 10 (reply 1 on both): test `⛔` P1 (outer probe catch unreachable) + P2 drift; code `⛔` three P2 (non-canonical pid, `createPrivate`/rename leaks, two-polls summaries) — all closed. Round 11 (reply 2 on both): code `✅ Ready` (thread `01a0712d-1da0-7b42-9c87-76d23890e6c0`); test `⛔` P1 — the `snapshot-chmod` injector forgot the failed descriptor at the throw, so a missing close was unobservable — closed: the fixture tracks the fd until production closes it and exits 97 if a second temp opens while one is live; control drops the close branch and gets 97. P2 taken: pid `2147483647` is probed, not rejected. Round 12 (reply 3 on both): test `✅ Tests sufficient` (thread `01a0712d-253a-7d33-9b45-cd07e51d9713`), code `✅ Ready` (thread `01a0712d-1da0-7b42-9c87-76d23890e6c0`) — noted at code digest `sha256:a34e052d…`. `/precommit` round 1 `❌` on one markdownlint error (an unescaped `\|` in the spec's `alloc` row), round 2 `## Overall: ✅ PASS`, noted. Adequacy Gate (advisory): AC-trace thread `01a07170-613d-7b93-8749-40abc9dcb163` round 1 `gate: Inadequate` — two AC *wordings* disagreed with the tests they describe (AC5 claimed the second entry is reaped even for `sweep-readdir`; AC5c named a narrower mutation than the control performs) and AC6's `npm test` conjunct was inconclusive in the reviewer's read-only sandbox; both ACs reworded; the same-thread resume was void (an empty prompt — a build slip, recorded), so the re-verification was a fresh first dispatch, thread `01a0717c-8d03-7521-864e-b733eb9b5606`: `gate: Adequate` → `✅ Adequate`, 15/15 covered. Doc gate: fresh thread `01a07182-27e0-7d33-88a3-dcc098f99fa9` round 1 `⛔ Needs revision` — six 🔴, all documentation: the spec's locator summary still carried the one-sided glob; the transport's exit-0 row and INV-003 omitted the regular-file/`0600` report conjunct the adapter enforces; the spec's Progress row and item 7's AC still said "every raw line" where blank lines are dropped; item 7's ticket called its 219-line/68-test snapshot current. Reply 1 `⛔ Needs revision` — five of the six closed, but the item-7 record's historicization was incomplete (three passages still said "current" / "the tree as it stands", and the amendment had wrongly claimed the mutation anchors moved: all eleven are still present in the 289-line adapter). Reply 2 `⛔ Needs revision` — the item-7 record was now consistent, but this very sentence had recorded reply 1 as the closing verdict. Both addressed; subsequent verdicts remain in the conversation, and this record does not restate them. Deferred: the exact 24 h boundary and a fault on restoring the original cwd (`[NIT_DEFERRED]` in the round-3, round-4 and round-5 test reports) |
| Acceptance | ✅ (candidate) | Code, precommit and adequacy gates passed on the final tree; the doc gate runs last over the whole `.md` batch and its verdict is the conversation's last word |
