# Progress channel for the codex exec adapter

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-05
> **Status**: Candidate Complete
> **Note**: Work item 7 of the tech spec's § 5 — opened after the 4.6.0 release from user feedback: a healthy background dispatch was read as hung because nothing about a run is observable until it ends. Amends INV-002 (size) and the spec's v1 "Not present" row; leaves INV-003/INV-005/INV-006 as they are.
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.2 Adapter contract (Progress row, Size row, Not present row)
> **Depends On**: [Live acceptance and release](./2026-09-03-live-acceptance-and-release.md) — 4.6.0 is the baseline this changes
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-002 amended here; INV-005 is what the new channel must never violate

## Background

`scripts/codex-exec.js` appended the child's whole JSONL stream to one in-memory string, parsed it
only on `close`, pre-created the report empty, and kept the child's stderr only as a failure tail.
For a background run every observable artifact — `.out`, `.err`, `report.md` — was therefore empty
until the end, indistinguishable from a hang. The call-site contract made it worse: a background
dispatch was awaited by its completion notification alone, with no way to ask "is it still working".
Blind verdict on the feedback: `ACTIONABLE` at 0.98 (thread `01a06fa8-0772-7e90-bf27-87195574e388`);
the issue analysis and its constraint table are in this conversation's record and summarized below.

## Requirements

- Keep stdout as **exactly one** control record on success (the contract every caller parses).
- Make a run observable while it runs, from facts the stream actually carries — measured on
  codex-cli 0.149.0: `thread.started` first; `item.started`/`item.completed` for
  `command_execution` with `command` and `status`; `item.completed` with `item.type=error` on runs
  that still exit 0; `usage` only on `turn.completed`; **no** `model`/`effort` fields and **no**
  timestamps.
- Heartbeat ≠ progress: every periodic line states how old the last event is.
- Token usage is shown only once reported; never zero, never a percentage.
- Silence is advised, never acted on: the adapter still owns no timeout (INV-003, INV-005).
- Everything lives inside the `0700` alloc dir at `0600` and dies with `cleanup` (INV-007).
- The caller observes a background dispatch by **push**, not by a Claude-side read loop — the one
  part of the feedback declined, for context cost. What "push" turned out to mean after the review
  rounds: a `persistent` Monitor whose own local loop reads the adapter-owned `progress.json`
  every 30 s (a shell read, no model turn) and emits only state changes — `started`, five-minute
  marks, the stall advisory, the terminal status — so the conversation sees about four lines per
  ten-minute review; the 60 s stderr lines stay on the task panel, unredirected, for anyone who
  wants the detail.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `scripts/codex-exec.js` progress channel; fixture + adapter tests; INV-002 amendment; spec § 3.2 rows; `codex-transport.md` § Progress; `codex-code-review/SKILL.md` § Step 3.5 one sentence |
| Out | A hard total-time limit (a second knob — INV-006; its own request); model/effort display (not derivable); a Claude-side fixed-interval poll; any change to exit semantics or the success record |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/codex-exec.js` | Modify | Per-line JSONL parsing; `events.jsonl` (raw stream) and `progress.json` (atomic rewrite via exclusively created temp files — a deterministic first name, an unpredictable retry on collision) created at preflight; tagged `[CODEX_EXEC_PROGRESS]` stderr lines — `started` on `thread.started`, a periodic line every 60 s, `done` on success — with child text escaped to one physical line; one shared `abort()` for every post-start failure; stall advisory after two silent ticks; `CODEX_EXEC_TICK_MS` test seam; every dynamic stderr field escaped to one physical line (child text truncated to 80 chars, paths never truncated); a resume's thread id seeded into the progress state before any event. 149 → **219** lines (209 on landing, 217 after the round-1 fixes, 216 after round 2's, 219 after the fresh thread's two rounds — historical measurements; the last is this item's closing figure, superseded by work item 8, which raised INV-002 to ≤290 and measured 289) |
| `test/fixtures/codex-exec/fake-codex.js` | Modify | `ok` mode emits the measured stream shape (`turn.started`, a `command_execution` open/close, an `error` item, `turn.completed` with `usage`); `FAKE_CODEX_EVENTS`, `FAKE_CODEX_EARLY_LINES`, `FAKE_CODEX_TOOL_COMMAND`, `FAKE_CODEX_USAGE` seams |
| `test/fixtures/codex-exec/fs-fault.js` | Modify | `readstream` mode — an injected prompt-read failure after spawn |
| `test/scripts/codex-exec.test.js` | Modify | `diagnostic()` helper — the failure diagnostic is found by tag, and every line before it must be tagged; the progress-channel block (after the review rounds: record shape, raw-stream byte equality, tagged start/done lines, held-child cadence and advisory, usage after `turn.completed`, no-event age, squatters at the final and at every predictable temp name — that one parameterized over a success and a failure run, so the block's `test()` declarations are fewer than the cases the runner counts — a forged-diagnostic command, a forged token value, a temp root whose name forges a diagnostic, an injected post-start failure, a resume without `thread.started`); size budget re-pinned to ≤220 with `STALL_TICKS` pinned by value |
| `docs/features/codex-exec-transport/2-tech-spec.md` | Modify | § 3.2: alloc record, `invalid_progress_file`, JSONL row, new Progress row, Not present row amended, Size row |
| `docs/features/codex-exec-transport/intent-codex-exec-transport.md` | Modify | Preamble "keeps no state" qualified to *across dispatches*; INV-002 ≤220 |
| `skills/codex-code-review/references/codex-transport.md` | Modify | § Alloc record; § Files path count; new § Progress |
| `skills/codex-code-review/SKILL.md` | Modify | § Step 3.5: observe a background dispatch via the `persistent` Monitor recipe on the alloc record's `progressFile` (nothing redirected; `TaskStop` after the completion notification); `Monitor` granted here and on the three thin entry points (`codex-review`, `codex-review-fast`, `codex-review-branch`); a progress line is never a verdict |
| `test/skills/codex-transport.test.js` | Modify | `Progress` added to the required sections; a pin on what § Progress must say |

## Acceptance Criteria

- [x] stdout on a successful `start`/`resume` is still exactly one control record, unchanged in shape — both commands assert one stdout line and the full sorted key set (`test/scripts/codex-exec.test.js`, the `start review` and `resume` cases)
- [x] `events.jsonl` holds every non-empty JSONL line the child emitted, in order (a blank or whitespace-only line is dropped, as the adapter's JSONL contract already reads the stream — *AC narrowed 2026-09-05 after work item 8's doc review: the byte-equality fixture emits no blank lines, so it never proved the broader "every raw line" wording*); `progress.json` holds the final state (`status`, `threadId`, `events`, `tool`, `tools_completed`, `last_event_s_ago`, `usage`, `errors`, `elapsed_s`); both `0600` inside the alloc dir; a squatter at either path is refused with exit 2 `invalid_progress_file` before the child runs — byte-equality against the fake's own emitted lines, the full `progress.json` key set, and squatters at the final paths **and at every predictable temp name** (the round-2 P1: a squatter at the terminal temp name used to leave the file at `running`)
- [x] stderr on success carries only `[CODEX_EXEC_PROGRESS]` lines: `started thread=… class=… profile=…` as soon as `thread.started` arrives, `done elapsed=MM:SS report=…` last; the periodic line reports event age, `tokens=unreported` until a `usage` payload arrives, and appends `— no event for Ns, check` after two silent ticks without ending the run — proved on a held child that has consumed the early lines (`started` on stderr and no `done` while held; numeric age; `tokens=in:4070/out:82` once `turn.completed` is early); child text is escaped to one physical line so a `\n[CODEX_EXEC_ERROR]` inside a command cannot forge a diagnostic (round-1 P1)
- [x] On a failure the `[CODEX_EXEC_ERROR]` diagnostic is still present and identified by its tag; `progress.json` reads `failed`; every stderr line before the diagnostic is tagged — four child failure modes plus an injected prompt-read failure after spawn, all through the one shared `abort()` (round-1 P1)
- [x] Mutation-checked, and the check is **recorded, not merely claimed**: the eleven `sed` mutations below in Progress each turn exactly the guarding test(s) red, and the restored adapter's control run is green. Evidence type is runtime verification with the commands written down so anyone can re-run them **against the item-7 closing tree** (the recorded line count, suite size and result belong to that snapshot; work item 8 changed the adapter and the suite after it, so a re-run today measures a different tree); there is deliberately no permanent mutation harness (`@rules/testing.md` § Conventions — representative proof is where assurance stops)
- [x] Adapter ≤220 lines at this item's close (219 measured — Related Files carries the history; **superseded by work item 8**, which raised INV-002 to ≤290 for the stale sweep and measured 289 — `requests/2026-09-05-observer-lifecycle-and-stale-alloc.md`), zero npm dependencies, still one file; INV-002 and the spec Size row say so — and the size-budget test reads both documents
- [x] `/codex-review-fast` → `✅ Ready`; `/precommit` → `## Overall: ✅ PASS`; `/codex-review-doc` → `✅ Mergeable`. **At the moment the notes were made (2026-09-05, Testing row)**: `✅ Ready` at `gate_reason=NONE` with zero findings from the third code thread `01a0708c-c48c-7402-bfeb-f6aa064c8398`, noted at code-plane digest `sha256:d073fd9e…`; `## Overall: ✅ PASS` self-noted by the precommit runner at that same digest; `✅ Mergeable` from doc thread `01a0706c-d182-70e1-9751-08d3318ab577` reply 2, noted at doc digest `sha256:48b46e96…`. The earlier passes this AC once cited (`sha256:97f8c950…`) were superseded by the review rounds the Testing row records; these are the ones that stand. This tick is itself a doc-plane edit — the item-6 ticket's caveat — so it is verified by one more doc reply, whose verdict lives in the conversation and is the last thing said; `review-state.js check` is the live answer

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | `/issue-analyze` on the feedback: blind verdict ACTIONABLE 0.98; live probe of the `--json` stream fixed what is derivable and what is not; seven contract conflicts enumerated, two excluded from scope (hard timeout, model/effort) |
| Development | Done (item 7 close, 2026-09-05 — superseded by work item 8 the same day) | Adapter 219 lines at this item's close (Related Files carries the measurement history); adapter suite 68/68 at the last mutation run of this item; the mutation record is below |
| Testing | Done | `/codex-test-review --ac-trace` on thread `01a06fc7-ea06-7172-a874-371779e248b0`, every report validated `[SENTINEL_VALID] contract=test:ac-trace`: round 1 `gate: Inadequate` gaps [1, 2, 3, 5, 6]; round 2 `gate: Inadequate` gaps [3, 5]; round 3 `gate: Adequate`, gaps [] → **✅ Adequate**. Every gap was closed as a test or a rerunnable record, not logged. `/codex-review-fast` at `thorough`, thread `01a06fea-8c46-7622-a83b-4ca7f322c4a1`: round 1 `⛔ Blocked` (P0 temp-file symlink follow, P1 unescaped child text, P1 `running` left on non-child failures, P2 spec not amended); round 2 `⛔ Blocked` (P1 terminal snapshot suppressed by a predictable-name squatter, P2 stale mutation C, P2 INV-002 wording); round 3 `✅ Ready` — then the Doc Sync's observation recipe re-opened the code plane through its test pins, and round 4 `⛔ Blocked` (P0 the `tee` mirror followed symlinks, P2 INV-007 not amended / guard fooled by a quoted key). Three replies spent → `[THREAD_ROTATED] plane=code_review old=01a06fea-8c46-7622-a83b-4ca7f322c4a1 new=01a07047-cdbf-7ca3-b1f6-10fd284a90fb reason=rounds`; fresh thread round 1 `⛔ Blocked` (P2 resume without `thread.started` left `progress.json.threadId` null); reply 1 `⛔ Blocked` (P1 raw report path on the `done` line, P2 apostrophe in the pasted recipe literal, P2 stale mutation record); reply 2 `⛔ Blocked` (P1 raw token values on the periodic line — the same class a third time, closed by rendering finite numbers only; P2 stale ticket summaries); reply 3 `⛔ Blocked` (P2 the recipe's greedy `sed` read keys nested inside the child-sent `usage` object as top-level state — closed by parsing with `node`; P2 ticket summaries lagging the A–K record). Three replies spent again → `[THREAD_ROTATED] plane=code_review old=01a07047-cdbf-7ca3-b1f6-10fd284a90fb new=01a0708c-c48c-7402-bfeb-f6aa064c8398 reason=rounds`; third thread round 1 `✅ Ready`, `gate_reason=NONE`, zero findings, noted at code-plane digest `sha256:d073fd9e…`; `/precommit` `## Overall: ✅ PASS` self-noted at that digest (4693 tests, 4685 pass, 0 fail, 8 skipped). `/codex-review-doc` on thread `01a07023-b140-77d1-acf9-7a211ab62a7c`: round 1 `⛔` (Monitor grant missing, recipe not executable), round 2 `⛔` (no Monitor duration, unanchored regex), round 3 `⛔` (`$DIR` unbound, ticket stale), reply 3 `✅ Mergeable`, noted at doc digest `sha256:c54094f8…` — then this ticket's own record refresh reopened the doc plane and the thread's three replies were spent → `[THREAD_ROTATED] plane=doc_review old=01a07023-b140-77d1-acf9-7a211ab62a7c new=01a0706c-d182-70e1-9751-08d3318ab577 reason=rounds`; fresh thread round 1 `⛔` (`events.jsonl` promised every line while the adapter drops blank ones; this ticket cited a superseded code pass as current); reply 1 `✅ Mergeable`, noted at doc digest `sha256:78fb76c6…` — superseded by the `node`-parsing recipe fix; reply 2 `✅ Mergeable`, noted at doc digest `sha256:48b46e96…` (the pass the gate AC cites); reply 3 `⛔` on the closing edit itself — this row had still called reply 2 "the next dispatch" while the AC cited its pass, a chronology contradiction, fixed here. Three replies spent → `[THREAD_ROTATED] plane=doc_review old=01a0706c-d182-70e1-9751-08d3318ab577 new=<the fresh thread, recorded in the conversation> reason=rounds`; that thread's verdict on this very edit is the conversation's last word and is deliberately not written back here. Suite counts are re-measured at the mutation record below whenever the adapter moves |
| Acceptance | Candidate Complete | Six functional ACs checked with evidence; the gate AC checked at the moment its three notes were made — code `sha256:d073fd9e…` (review and precommit), doc `sha256:48b46e96…` — with the caveat that AC states: this row is a doc-plane edit, verified by one more doc reply whose verdict is the conversation's last word. The one thing the feedback asked for that was declined — a Claude-side fixed-interval poll — is recorded as declined in `codex-transport.md` § Progress, which now carries the observation choreography the review rounds shaped: nothing redirected (the task panel is the live 60 s view — a `2>` to a file left it reading *No output yet*, and a `tee` mirror was a symlink-overwrite path, both measured 2026-09-05), a `persistent` Monitor reading the adapter-owned `progress.json` and surfacing state changes only, `TaskStop` after the completion notification; `Monitor` granted to the four parent-session review skills and pinned away from every `context: fork` skill |

### Mutation record (2026-09-05) — the runtime evidence behind the mutation AC

The script below is what was run, verbatim (BSD `sed -i ''`; from the repository root). Each
mutation is applied to a fresh copy of the adapter, only the guarding test is selected by name, and
the `# tests` count printed with each result proves the pattern selected **exactly the guarding
test set** — one test for A–G, the ok/failed pair for H; the
adapter is restored from the backup and `cmp` proves the restore is byte-identical before the control
run. Nothing here is a harness — it is the record of a check anyone can repeat.

```bash
BK=$(mktemp "${TMPDIR:-/tmp}/codex-exec.backup.XXXXXX") && cp scripts/codex-exec.js "$BK"
run() { node --test --test-name-pattern="$1" test/scripts/codex-exec.test.js 2>&1 | grep -E '^# (tests|pass|fail)' | tr '\n' ' '; echo; }
mut() { cp "$BK" scripts/codex-exec.js; sed -i '' "$2" scripts/codex-exec.js
  if cmp -s scripts/codex-exec.js "$BK"; then echo "$1: SED DID NOT APPLY"; else printf '%s → ' "$1"; run "$3"; fi; }
mut A "/fs.writeSync(p.eventsFd, line/d"                                                                  'events.jsonl = the raw stream'
mut B 's/const stall = idleMs >= STALL_TICKS \* TICK_MS ? .*$/const stall = "";/'                        'reports event age'
mut C "s/snapshot('failed'); fail('error', why); };/snapshot('running'); fail('error', why); };/"        'FAKE_CODEX_MODE=exit3'
mut D '/progress(`started thread=/d'                                                                      'tagged start line'
mut E "s/fd = createPrivate(tmp); }/fd = (() => { try { return fs.openSync(tmp, 'w', 0o600); } catch { return null; } })(); }/" 'snapshot temp path is never followed'
mut F 's/oneLine(d.tool)/d.tool/'                                                                         'multiline or tag-shaped command'
mut G "s/.on('error', (e) => abort(e.message)).pipe/.on('error', (e) => fail('error', e.message)).pipe/" 'prompt read stream erroring'
mut H "s/fd === null \&\& i < 4/fd === null \&\& i < 1/"                                                  'every predictable temp name'
mut I 's/report=${esc(p.report)}/report=${p.report}/'                                                     'temp root whose name carries a newline'
mut J "s/threadId: cmd === 'resume' ? p.thread : null/threadId: null/"                                    'emits no thread.started still records'
mut K 's/in:${num(d.usage.input_tokens)}/in:${d.usage.input_tokens}/'                                     'forged token value'
cp "$BK" scripts/codex-exec.js && cmp -s scripts/codex-exec.js "$BK" && printf 'control (restored) → ' && run 'progress channel'
rm -f "$BK"
```

Output, 2026-09-05, against the **68-test adapter suite at 219 lines** — the tree as it stood at
this item's close, after every review round in the Testing row. **This is the item-7 closing
snapshot, superseded the same day by work item 8** (`requests/2026-09-05-observer-lifecycle-and-stale-alloc.md`:
the adapter is 289 lines there and the suite far larger); the block was re-run verbatim whenever
the adapter moved *within item 7*, and the counts here are the counts of that last run. What makes
this output evidence for item 7 and not for item 8 is not the anchors — every A–K target string is
still present in today's adapter — but the snapshot the counts belong to: the recorded line count,
suite size and execution result are the earlier tree's, so a re-run today would report different
numbers and would be item 8's evidence, not this record's. The earlier versions of this record were
each caught by a review for exactly the ways a record can go stale (a one-line claim; prose where
commands belonged; a mutation aimed at a renamed symbol; counts bound to a superseded revision), so
the claim it makes is deliberately narrow — this script, this output, this tree:

```text
A → # tests 1 # pass 0 # fail 1
B → # tests 1 # pass 0 # fail 1
C → # tests 1 # pass 0 # fail 1
D → # tests 1 # pass 0 # fail 1
E → # tests 1 # pass 0 # fail 1
F → # tests 1 # pass 0 # fail 1
G → # tests 1 # pass 0 # fail 1
H → # tests 2 # pass 0 # fail 2
I → # tests 1 # pass 0 # fail 1
J → # tests 1 # pass 0 # fail 1
K → # tests 1 # pass 0 # fail 1
control (restored) → # tests 15 # pass 15 # fail 0
```

| Mutation | What it removes or restores | Guarding test (selected alone; H selects its ok/failed pair) |
|---|---|---|
| A | the `events.jsonl` append | `a successful run leaves events.jsonl = the raw stream …` |
| B | the stall advisory suffix | `the periodic line reports event age and, after silence, an advisory …` |
| C | the `failed` status in the shared `abort()` routine | `start under FAKE_CODEX_MODE=exit3` |
| D | the `started` stderr line | `stderr carries a tagged start line …` |
| E | `'w'` on the snapshot temp file — follows a planted symlink (round-1 P0) | `a symlink planted at the snapshot temp path is never followed …` |
| F | raw child `command` text on the stderr line (round-1 P1) | `a multiline or tag-shaped command stays one physical, tagged stderr line …` |
| G | a bare `fail()` on the prompt-read error path (round-1 P1) | `a post-start failure that is not the child's still records failed …` |
| H | the retry on an unpredictable temp name (round-2 P1) | `a squatter at every predictable temp name cannot suppress the terminal done/failed snapshot` |
| I | the raw report path on the `done` line (fresh-thread reply-1 P1) | `a temp root whose name carries a newline and the error tag cannot forge a diagnostic …` |
| J | the resume thread id seeded into the progress state (fresh-thread round-1 P2) | `a resume whose child emits no thread.started still records the supplied thread …` |
| K | the finite-number guard on the token fields of the periodic line (fresh-thread reply-2 P1) | `a forged token value in the usage payload cannot break the periodic line …` |

The first AC trace read the ticket's one-line "four mutations red, control green" as an unsupported
claim, and the second read the first version of this table — prose and ellipses where commands
should be, counts already stale — the same way; and the next was itself bound to a revision two
later fixes moved past. All of them were right; the script and output above are the run against the
tree as it stood at item 7's close, re-done whenever the adapter moved within that item — and left
as that snapshot once work item 8 took the adapter further.
