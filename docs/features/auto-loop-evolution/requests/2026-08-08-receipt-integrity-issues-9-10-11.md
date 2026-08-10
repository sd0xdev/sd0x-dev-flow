# Three Ways a Review Receipt Went Missing (Issues #9, #10, #11)

> **Created**: 2026-08-08
> **Status**: In Progress
> **Note**: ⛔ Code gate OPEN — rounds 23–26 (2×P1; 5×P1,2×P2; 4×P1,1×P2; 5×P1,1×P2) each returned
> Blocked on the count-parameterized retirement round 22 left in place; all fixed, round 27
> re-review pending. See § Review history and § What is still not done
> **Priority**: P0
> **Found by**: Three independent GitHub issue reports against 4.1.0/4.1.1, triaged together
> because all three end at the same symptom: a review that ran, passed, and left no receipt
>
> **Length** — 833 lines (`wc -l`), over the 500-line default in `@rules/docs-numbering.md` § Size Limit, and
> deliberately kept whole. The rule's remedy is splitting sections into a numbered subfolder, a shape
> defined for lifecycle docs (`2-tech-spec/`) and not for `requests/`, whose filenames are
> date-prefixed with no sub-numbering. More to the point, the three issues are not three documents:
> each section's argument is that the *other two* hid it, and § Verification, § Acceptance Criteria
> and § Related Files are single tables indexed across all three plus the 4.2.1 follow-up. Cutting
> anywhere lands mid-argument, which the rule names as worse than the long file.

## Background

Three separately-filed issues turned out to be three unrelated causes of one observable failure —
`.claude_review_state.json` reads `executed: false` for a review that genuinely happened. The
symptom is indistinguishable across all three, which is why they were filed as three bugs rather
than one, and why fixing them in one pass was worth doing: each hides the others.

They are ordered below by dependency, not severity. **#9 had to be fixed first**: while every
*arbitrated* hook was declining to run — which includes both the PostToolUse hook that records
receipts and the Stop hook that reads them — the other two were unobservable from the consuming end.

The three reports corroborate each other in a way worth recording. #11's reporter set
`CLAUDE_PROJECT_DIR` to a clean temp directory "to prevent the plugin hook from deferring early" —
which is precisely the #9 workaround, arrived at independently by someone investigating a different
bug.

## #9 — the arbitration block fired zero times, not twice

Seven of the eight `hooks/*.sh` open with a "plugin defers to local" block whose stated purpose is
avoiding double-fire (`session-init.sh` is the eighth and carries no such block). Its three
conditions were: `CLAUDE_PROJECT_DIR` set, no dev-mode `hooks/hooks.json`, and a local copy of
`basename "$0"` present and executable.

**All three are satisfied by the local copy itself.** `basename "$0"` says WHICH HOOK this is; it
never says WHICH COPY. So the local copy deferred to itself, the plugin copy deferred to the local
one, and the hook never ran at all — the exact inverse of the double-fire the block existed to
prevent, and silent.

Everything downstream then failed open. `auto-loop.md` § Enforcement's fail-closed sidecar is never
written by a hook that does not execute, and `STOP_GUARD_MODE=strict` does not help because
stop-guard defers on the same block. Per Anchor Register #3 this is a data-integrity defect and was
reviewed at `thorough`.

**Fix**: decide deferral by **origin**, not by path identity.

```bash
_IS_PLUGIN_COPY=false
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  case "$(dirname "$0")/" in "${CLAUDE_PLUGIN_ROOT%/}"/hooks/) _IS_PLUGIN_COPY=true ;; esac
elif [[ -n "$_SELF_DIR" && -n "$_LOCAL_DIR" && "$_SELF_DIR" != "$_LOCAL_DIR" ]]; then
  _IS_PLUGIN_COPY=true
fi
```

The origin signal already exists in the registrations: `hooks/hooks.json` registers
`${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh` while settings register
`"$CLAUDE_PROJECT_DIR"/.claude/hooks/<name>.sh`. Four properties are load-bearing, none obvious:

| Property | Why |
|----------|-----|
| The origin test is **lexical** (`dirname "$0"`, not the resolved path) | When `.claude/hooks` is a symlink to the plugin's own hooks dir, `pwd -P` resolves the *local* copy into the plugin directory — so a resolved origin test would call it the plugin's and restore the very zero-fire being fixed |
| It matches the plugin's **hooks directory exactly**, not any descendant of the plugin root | Every `hooks/hooks.json` entry is spelled `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh`, so that one directory is the entire registered surface. A `${CLAUDE_PLUGIN_ROOT}/*` prefix additionally swallows a **project nested under the plugin root** — `/plugin/examples/app/.claude/hooks/<name>.sh` — classifying the local copy as the plugin's, deferring it to itself, and reproducing the original zero-fire in a layout the first round of tests did not cover. Found in review round 2 |
| `pwd -P` is kept for the **fallback** comparison | On a host that does not export `CLAUDE_PLUGIN_ROOT`, a symlinked `.claude` otherwise yields a lexically different directory and the local copy again defers to itself |
| An undecidable origin leaves the guard **false**, so the hook runs | Bailing out looks like the safe direction and is not. Double-fire is visible and recoverable; zero-fire is silent, which is what let this survive a release |

A path comparison alone was not enough, and the gap was found by review rather than by the original
analysis: with `.claude/hooks` symlinked to the plugin's hooks directory, **both** invocations
resolve to one directory, both read "I am the local copy", neither defers, and every hook runs
twice — which for the review-state hook counts each round twice against the cap.

Applied to all seven arbitrated hooks. `session-init.sh` has no arbitration block, so #9 does not
touch it — it is nonetheless changed by #10 below, which adds `background_reviews` to the fields a
new session resets.

## #10 — a backgrounded review can never record a receipt

When an MCP call outlives the foreground timeout the harness **completes** the tool call with a
handoff placeholder and delivers the real report later as a task notification — which is not a
`PostToolUse` event and fires no hook of its own.

> **Superseded in 4.2.1.** Everything below is the 4.2.0 fix, and it rests on a claim that turned
> out to be false: that the verdict was therefore *unreachable*. It is delivered into the
> transcript, which every hook event already carries a path to. See § Follow-up (4.2.1) — the
> report is reachable, which converts the advisory marker into a real receipt and closes three of
> the four residuals listed here. The 4.2.0 machinery is unchanged and still does its job when
> recovery declines.

This is not an edge case. `rules/codex-invocation.md` mandates that Codex research the project on
its own, so exceeding the foreground window is the normal case for anything beyond a trivial diff.
The failure is also self-reinforcing: the rational response to `executed: false` is to re-run, and a
re-run is *more* likely to time out than the first attempt.

**Fix** — the issue's own option 3, plus persistence. No verdict was observed, so none is invented:
manufacturing one would be the same fail-open class as #9. What is recorded is that a review-shaped
*request* was backgrounded and no hook-visible verdict arrived — never that a review ran.

| Piece | Behaviour |
|-------|-----------|
| Normalizer | Handles a **bare array** of content blocks — the shape a handoff actually arrives in |
| `_mcp_output_is_background_handoff` | Recognizes the placeholder **on the first non-empty line** |
| `_record_background_review` | Appends `{plane, task, at}` to `background_reviews`, capped at the 5 most recent. **Doc and code planes only** — see the plane scope below |
| `_clear_background_reviews` | Retires that plane's markers when a foreground verdict lands |
| `post-edit-format.sh` | Retires that plane's markers in the **same write** that an edit uses to re-open the gate — on the locked path *and* the degraded lock-contention path, which the doc plane spells out twice |
| `session-init.sh` | Clears all markers on a new session |
| `[AUTO_LOOP_STATE] event=review_verdict_unrecordable … reason=backgrounded task=<id>` | States the fact where the model reads it immediately |
| `stop-guard.sh` | Prints advisory handoff context beside the open gate, filtered to planes still open — it surfaces the request-shaped handoff without attributing the gate's cause |

**The payload shape was got wrong the first time, and it made the fix inert.** The first version was
verified only against `{content:[…]}`; when the bare-array shape failed, that was written off as a
bad fixture. A live handoff then proved the opposite — the real `tool_response` is
`[{"type":"text","text":"MCP tool …"}]` with no wrapping object, which the normalizer resolved to
`empty`, leaving every branch below unreachable. The corroborating signal was there to be read:
`updated_at` never advanced across the backgrounded call.

**Marker lifecycle**, without which the marker is worse than nothing. `stop-guard` filters on "is
this plane's gate open", so a marker outlives its own review passing and re-attaches itself to the
*next* time that gate opens — telling the reader a freshly-reopened gate is waiting on a task that
finished long ago. The session case is settled by the placeholder's own words: *"it does not survive
exiting this session."* So markers are retired on verdict and cleared at session start.

**Three events retire a marker, not two.** Review round 2 found the third. A backgrounded review's
report arrives as a task notification, which fires no hook — so the normal way it gets acted on is
an *edit*, and an edit re-opens the plane's gate on its own. `stop-guard`'s filter is "is this plane's
gate open", which the edit has just made true again, so the marker matched and the reader was told a
freshly-reopened gate was waiting on a thread that had already finished before the change existed.
Retirement therefore rides the **same jq write** as the invalidation (`invalidate_review` for the
code plane, the doc branch's own atomic write for the doc plane): an edit *this hook commits* cannot
re-open a gate while a stale explanation stays behind. It is not an ordering guarantee in general —
a handoff committing after the write appends a marker that predates it, the residual § No review
generation records.

The doc plane needed the clause **twice**, and round 3 caught the second one missing. Its transform
exists in two copies — inside the lock, and again as the degraded best-effort rewrite taken on lock
contention — while the code plane reaches retirement through `invalidate_review` on both arms and so
had nothing to duplicate. The degraded arm still re-opens the gate, so a marker surviving it
re-attaches to a gate the edit itself caused. Uncontended tests cannot see this: both arms produce
the same state file, and only a held lock separates them.

**Plane scope — markers are persisted for doc and code only.** The handoff branch still *emits* the
`[AUTO_LOOP_STATE]` fact for a backgrounded plan review, because that costs no state and the plan
loop runs inside the session that reads it. But `plan_review` is warn-only and isolated from the
code/doc gates by design (`stop-guard.sh` § plan-review pending advisory), so a persisted plan marker
would have no reader — and no retirement path either, since every clearing site above is doc/code.
The alternative, extending the lifecycle to plan, needs a predicate that does not exist: the closest
one, `PLAN_PENDING`, requires `plan_review.executed == true`, which a backgrounded review never sets
— it would be false in exactly the case the marker exists for.

**The anchoring is the subtle part.** A substring match on the two obvious phrases is wrong, and
wrong in a way that would have been shipped: this repo's own issue #10 write-ups quote the
placeholder, and the handoff branch runs *ahead* of every verdict branch and exits — so reviewing
these very documents would have swallowed the review's real verdict. A `^`-anchored `grep` is not
enough either, since those quotes sit inside an indented code fence and `^` matches any line.
Matching the first non-empty line removes the class.

Persistence is in the state file rather than stderr alone because stderr does not survive a
compaction, and this failure is *defined* by recurring across rounds.

**Four things this deliberately does not do**, each because the cost outran what the evidence
supported:

- **No reconciliation.** Task outputs do exist under `.../tasks/<id>.output`, but every one observed
  was written by a Bash/Monitor task. Whether MCP background tasks write to the same location is
  **unverified**, and building reconciliation on an unverified path is the `UNVERIFIED_CLAIM`
  failure mode.
- **No gate discharge.** The marker is advisory. No consumer reads it as a receipt.
- **No authenticated provenance.** The marker is minted from a **request-side substring** — `Merge
  Gate` or `Document Review` in the raw `tool_input` — which is the same evidence the verdict
  branches use, and it cuts both ways. A review prompt that drops the phrase records nothing (this
  change's own round-2 code review did exactly that, and left no marker); a backgrounded call that
  merely *discusses* the phrase records one. Tightening the predicate cannot separate them, so the
  fix went to the consuming end: stop-guard says a task whose **request looked like** a review was
  handed off, never that a review ran. Both directions are pinned by tests, so this is a stated
  property rather than a latent surprise.
- **No review generation.** One ordering survives retirement: a review dispatched *before* a
  concurrent edit can time out *after* it, appending its marker to a gate the edit had just
  re-opened for its own reason. `{plane, task, at}` cannot separate that from the ordinary case —
  `at` is stamped when the handoff is observed, which is later than the edit either way, and the
  dispatch time this would need is not visible from `PostToolUse`, which fires only after the call
  returns. Closing it means a `PreToolUse` capture of a per-plane generation: real machinery, for an
  advisory line, reachable only when something edits files concurrently with a review. So the fix
  went to the **claim** instead — stop-guard states only what the request-side marker witnesses (a
  task whose request looked like a review was handed off and left no hook-visible verdict) and stops
  asserting it is the *only* reason the gate is open, pointing the reader at the change instead. The advice is unaffected either way: continuing the thread with the current diff
  is what `@rules/codex-invocation.md` § Loop review exception permits and shows how to do — it
  sanctions that path, it does not mandate it.

The residual flagged in the first draft — "does `PostToolUse` actually fire with the placeholder?" —
was **settled by observation, not argument**: the review of this very change was itself backgrounded,
which is how the bare-array shape was caught. `PostToolUse` does fire; it was the normalizer that
was wrong.

## Follow-up (4.2.1) — the report is reachable, so the marker becomes a receipt

The 4.2.0 write-up reasoned from "no hook fires for the notification" to "the verdict cannot be
read", and the second does not follow from the first. The notification is appended to the
**transcript**, and every hook event carries `transcript_path` — `stop-guard.sh` has read it since
long before any of this. What was missing was never a channel. It was a **key**: something proving
which dispatch a given report belongs to. The marker had been carrying the harness's task id all
along, recorded for a different purpose.

**The transcript is not merely a viable surface — for MCP tasks it is the only one.** Measured
rather than assumed, and this closes § No reconciliation as written: MCP task ids are `k`-prefixed,
and `find /private/tmp/claude-* ~/.claude -name 'k*.output'` returns nothing on a machine holding
207 task output files (82 `a`, 125 `b`). MCP notifications carry `<result>` inline and no
`<output-file>`; background-Bash notifications carry the pointer and no `<result>`. `TaskOutput`
answers for an `mcp_task` with `output: ""`, so it synchronises but carries nothing. `TaskCompleted`
is a different namespace entirely — the `TaskCreate` to-do list, backed by
`~/.claude/tasks/<session>/N.json`. No hook fires on delivery. The design is correct by
elimination, not by preference.

| Piece | Behaviour |
|-------|-----------|
| `_record_dispatch_epoch` | **PreToolUse**: draws a shared, per-session `seq_counter` (not wall-clock `EPOCHSECONDS`) and unconditionally increments `dispatch_count[plane]`; `dispatch_epoch[plane]` itself is still set-if-absent, so the plane keeps the **earliest** in-flight instant, but the count is how many dispatches are relying on it |
| `_DISPATCH_EPOCH_RETIRE_JQ` | Shared jq filter, used by every retirement site: decrements `dispatch_count[plane]` and clears `dispatch_epoch[plane]` **only once the count reaches zero** — i.e. only once every dispatch that ever shared the instant has resolved. One filter rather than two independently-written copies, after round 21 found `_clear_background_reviews` carrying its own separate unconditional `del` alongside `_clear_dispatch_epoch`'s |
| `_bg_recovered_report` | Streams the transcript tail, finds the delivery whose **envelope** carries the task id, unwraps `<result>` |
| `_recover_background_reviews` | Per marker: compares the marker's `dispatch_epoch` against the plane's `last_edit_epoch_by_plane`, verifies the plane, records the receipt, consumes the marker. Re-checks the same comparison after the write, to catch an edit landing in the gap between eligibility and commit |
| `_consume_background_review` | Removes **one** marker by task id |
| `_clear_dispatch_epoch` | Retires a plane's dispatch epoch **without** touching its markers, via the shared retirement filter (one decrement, not an unconditional clear) — for a foreground response that resolves the dispatch but records no verdict (no sentinel, or provenance too ambiguous to route) |
| Trigger | The events `hooks.json` matches, now including `TaskOutput` — the harness's own "is that task done" call, and so the promptest signal available |

(§ Ordering, not content — and why that no longer needs ownership proof, below, explains why there is no `_record_dispatch_fingerprint` row: the mechanism it belonged to — dispatch pinning, content fingerprinting, ownership proof — was deleted in its entirety rather than patched a sixth time.)

**Provenance is two-sided, and binds tighter than the foreground path's.** Request side: the marker
names the plane, minted from the actual prompt. Output side: the notification carries the report.
Both halves hang off one task id — where the foreground path can only ask whether a single tool
call's input and output happen to agree, having no identifier tying either to a dispatch. This
retires § No authenticated provenance above: the marker is no longer the *only* evidence.

**The discrimination is structural, not textual — in two places, and the second was missed the
first time.** A Bash tool result is recorded as a `user` entry too, so `cat`-ing any file that
quotes a notification would mint a verdict under any grep-shaped reader. Three structural fields
separate them: `.origin.kind == "task-notification"`, `has("toolUseResult")` absent, and
`.message.content` a string rather than a `tool_result` block array. Measured across 7 transcripts:
**64 of 64** codex deliveries carry `origin.kind`, and no tool result carries any of the three. (An
earlier draft of this section said 9 of 10, from a smaller sample; the pessimistic figure is
withdrawn.)

Those three authenticate the **entry**. They say nothing about **which dispatch it answers**, and
the first implementation matched the task id with `contains` against the whole entry — payload
included. A genuine delivery for task B whose *report* quoted `<task-id>task-A</task-id>` therefore
satisfied task A's marker and banked B's verdict against A. Reports in this repository quote exactly
that, so it was reachable. It is the same defect as #9 and #11 one layer further out — a payload
read as though it were metadata — and the fix is to match the id and status only in the envelope,
the text before the first `<result>`.

**These are provenance, not authentication, and the distinction is the same one the foreground MCP
path already states about itself.** `transcript_path` arrives on the hook's stdin, so a caller that
fabricates a whole hook event can point it anywhere. What the three fields cannot be produced by is
an *ordinary harness-recorded tool result* — the confusion that actually occurs. Review round 1
raised the forgery reading as a P1; blind verification returned NON_ACTIONABLE at 0.98, on the
ground that the same caller has strictly shorter routes already (the foreground verdict branches
accept a synthetic request and report with no pending task, and `.claude_review_state.json` is an
ordinary writable file that stop-guard type-checks but does not attribute). SLSA's vocabulary for
this is **unsigned provenance** — recorded for forensics and transparency, explicitly not a control
against an active adversary.

### Ordering, not content — and why that no longer needs ownership proof

The first implementation compared a wall-clock edit stamp against the handoff time, bounded by a
120 s window. That was wrong, and round 14 killed it outright (§ Review history). The replacement
was a per-plane content fingerprint, sampled at dispatch, compared at recovery. That was *sound in
principle* — and it is what rounds 16 through 20 spent five rounds failing to make sound in
practice, because it needed something the payload structurally cannot supply.

**What the fingerprint actually needed, and could never get.** A content fingerprint answers "does
the tree recovery sees match the tree the reviewer read", which only matters if the two dispatches
being compared are known to be *the same dispatch*. Hook events carry no `tool_use_id` — the only
key surviving PreToolUse → PostToolUse is `sha256($TOOL_INPUT)`, which proves the **request** was
byte-identical, never that the **dispatch** was the same one. Every defect in rounds 16–20 (see
§ What is still not done — now resolved, below) was a different way of detecting the cases where
that premise silently failed: publish accounting, an ambiguity latch, its storage location, its own
race with the lock that would have made it safe. Five relocations, one architecture-level cause,
ending in round 20's `⛔ Need Human` exit per `rules/auto-loop.md` § Cap Diagnostic Protocol step 2 —
because neither of the two closing moves (a host-provided correlation key; a dispatch protocol that
cannot produce concurrent byte-identical requests) was a bounded adjustment.

**The insight that closes it without either move: a monotone-conservative scalar needs no ownership
proof, because every ambiguity resolves toward refusal.** The fingerprint's ownership problem existed
because a *leaked or foreign* fingerprint could bank a verdict against the wrong tree — a false
*accept*. An epoch cannot do that **as long as retirement is reference-counted, not set-if-absent's
mirror-image "clear-if-present."** `dispatch_epoch[plane]` is set-if-absent, so a second dispatch on
the same plane never overwrites it — the plane keeps the **earliest** in-flight instant. Round 21
found that an unconditional `del` on resolution broke the "only stricter, never looser" claim this
paragraph used to make unqualified: dispatch A resolving cleared the epoch out from under
still-in-flight dispatch B, and B's *eventual* marker — recorded later, from whatever the live epoch
held at that moment — could freeze an instant inherited from an unrelated, later dispatch C. That is
a false accept, the exact failure mode this design exists to rule out, produced by a clearing rule
that didn't track how many dispatches actually needed the value it was about to delete. The fix is
`dispatch_count[plane]`, incremented on every draw and decremented on every resolution: an epoch
retires only when the count that gates it reaches zero, i.e. only once every dispatch that ever
shared it has also resolved. With counting, a leaked epoch, read by the wrong dispatch, only makes
the next recovery **stricter** — refuses a case it might otherwise have granted — never looser; the
set-if-absent write is still what makes THAT direction sound. There is nothing here to forge into a
wrongful accept once retirement is counted, so there is nothing here that needs a
`tool_use_id`-shaped proof of ownership. The fingerprint's whole five-round chase was a consequence
of trying to protect a claim ("this is the tree I reviewed") that only a false accept can corrupt;
an ordering claim ("was this plane edited before or after dispatch") has no such failure mode — but
only once its own bookkeeping (how many dispatches are still relying on this instant) is honest about
who else needs the value before deleting it.

**This is not round 14's mistake under a new name, and the difference is what each clock is claiming
to prove.** Round 14's wall-clock window stood in for *content identity* — "no edit within N seconds"
was read as "the tree hasn't changed", which is unsound on its own terms (Cloudflare's 2017
leap-second outage is filed under exactly this belief; clocks are not monotonic and do not describe
trees). The epoch here proves nothing about content — it proves only an **ordering**, and identity of
the *report* being recovered is supplied separately, and soundly, by Half A: the host-provided task
id, unique per dispatch, matched in the envelope rather than inferred from a payload digest. Splitting
"is this the right report" (task id — proven) from "is it still fresh" (epoch — ordering only, safe
to get wrong in one direction) is what the fingerprint design conflated into one unfalsifiable claim.

**What this gives up, stated plainly.** The fingerprint preserved one case the epoch cannot: a file
edited and then reverted returns to the same content, and the old design's verdict correctly
survived recovery (Gerrit spells this `changekind:NO_CHANGE`). Ordering cannot tell a revert from any
other edit — both read as "the plane was edited after dispatch" and both refuse. That is a real
reduction in the already-minority recovery rate (§ Measured cost), traded for removing the entire
unfalsifiable-ownership surface that cost five rounds and closed with no fix in sight. The trade was
made once, explicitly, rather than accepted as a side effect: **`/refactor`** was asked directly
whether the mechanism could be simplified or replaced by prompting the model, found that both
alternatives it considered failed on measurement (backgrounding is the *normal* case for this
project's review latency, not an edge case — both a fresh review and a same-thread `codex-reply` on
a narrow diff exceeded the 120 s foreground window in measurement), and this ordering-only design was
the bounded adjustment that survived scrutiny.

The epoch stays **per plane**, for the same reason the fingerprint was: the freshness model is per
plane, and a doc edit must not invalidate an in-flight code review or vice versa. `dispatch_epoch` and
`last_edit_epoch_by_plane` are both plane-keyed objects for exactly that reason.

### Consuming, not clearing

`_clear_background_reviews` retires a whole plane, which is right when a foreground verdict lands
and wrong on recovery: this repo keeps up to five markers per plane, so recovering an older task's
`✅ Ready` also deleted a newer replacement task's marker, and the replacement's `⛔ Blocked` then
had nothing to attach to. A pass banked and a block lost, from one recovery. Recovery consumes by
task id. A marker refused on the staleness ordering is *also* consumed: the refusal is permanent — a
stale edit-vs-dispatch ordering never becomes fresh again — so retaining it only bought a repeated
`-ge` comparison and a stderr line on every subsequent event for the rest of the session.

**Consuming has to prove the marker was there.** The first version filtered the array and reported
whatever `jq` and `mv` reported, which is not the same claim: a marker already retired by someone
else produced a perfectly successful no-op, and the caller — which consumes before it writes,
precisely so a failure cannot bank a stale verdict — read that as permission to write. The
interleaving that costs a verdict: recovery reads marker A and its report, a concurrent foreground
review clears the plane and banks `⛔ Blocked`, recovery's consume succeeds against an array that no
longer contains A, and the recovered `✅ Ready` overwrites the block. `jq` now emits nothing when the
task is absent, so the empty-output check the writer already had turns that into a refusal.

**The dispatch epoch outlives its dispatch in the same two cases a pin once did, and is retired the
same way — now reference-counted, not merely cleared.** A review that comes back in the
**foreground** leaves the plane's epoch standing with nothing to naturally retire it —
`_clear_dispatch_epoch` is called explicitly on both no-verdict foreground branches (no sentinel;
ambiguous BOTH-namespace provenance) and, after round 21's P1#2, on a background recovery's success
path too — `update_state`'s 5th/6th-arg marker consumption retires only the `background_reviews`
marker, never the epoch/count behind it, so both success branches in `_recover_background_reviews`
call `_clear_dispatch_epoch` explicitly once `update_state` confirms it consumed the marker this
call. The four **refusal** branches guard the same call on `_consume_background_review` itself having
removed something: that function filters out **every** row matching `(task, plane)`, so two marker
rows sharing a key — the same handoff observed twice, a duplicated `PostToolUse` delivery — collapse
to zero rows on whichever consume runs first, and an unconditional decrement on the second, already-
empty consume would over-retire the count out from under a dispatch that never resolved at all;
pinned by its own regression test (§ Verification). Across a **session boundary**, `session-init.sh`
deletes `dispatch_epoch`, `dispatch_count`, `last_edit_epoch_by_plane` and `seq_counter` outright —
deletes, not empties, for the same reason as before: `_clear_background_reviews` and
`_clear_dispatch_epoch` both use the keys' textual presence as a pre-filter, so an empty `{}` left
behind would put a lock and a temp file on the hot path of every verdict for the rest of the session.

**One marker per `(task, plane)`, not per task.** A prompt asking for both namespaces writes a `doc`
*and* a `code` marker under one task id. Keyed on the id alone, the doc marker's plane-routing
refusal deleted the code marker with it, and the code iteration that followed refused a verdict that
was sitting there to be recovered — a pass lost to a refusal about a different plane. Both the
standalone consume and the receipt transaction's own clause match on the pair.

**The recovery window is bracketed, not merely compensated.** The freshness check that authorizes the
write and the write itself are not one atomic step, and the post-write re-check (§ Ordering, not
content) is what catches an edit landing between them. It converges to shut, but late: a Stop hook
firing inside the window reads a passing receipt whose marker is already gone and ends the session. A
fail-closed sidecar spans exactly that window — raised before the write, lowered once the re-check has
had its say, on every exit path including the refusal branches. What is deliberately *not* rolled
back is the iteration counter: a superseded verdict is withdrawn, but the round genuinely ran, and
un-counting it would make § Stall Detection read a loop that moved as one that did not.

**The interval the edit epoch closes, and the one nothing closes.** The dispatch epoch is stamped
*before* the reviewer reads the tree, so an edit landing between that stamp and the handoff is what
the reviewer actually read — and the edit epoch catches it regardless of whether the edit is later
reverted, which is the trade stated in § Ordering, not content. `post-edit-format.sh` stamps
`last_edit_epoch_by_plane[plane] = now` on every edit; that write exists in **three** jq programs,
which is the whole risk in it: the code plane goes through `invalidate_review`, while the doc plane
writes its own update and branches on whether the state carries an `aggregate_gate`. A fixture
exercises exactly one branch of a two-branch `if`, so each of the three has its own case; dropping the
stamp from any one of them fails a test that names its branch. **`now` is no longer wall-clock**
(round 21's P2): all three sites, plus `_record_dispatch_epoch`, draw from one shared `seq_counter`
incremented under lock, so both sides of the `edited_at >= dispatch_epoch` comparison are draws from
the same strictly-increasing source rather than two independent reads of the system clock — the
comparison no longer depends on `EPOCHSECONDS` (or `date -u +%s`) being monotonic across a leap
second, an NTP step, or a suspended sandbox clock. What no per-edit stamp reaches, whichever clock it
draws from, is a mutation made through Bash — `sed -i`, `git apply`, `lint:fix` — since nothing stamps
an edit epoch for those; that gap is named in full in § What is still not done.

### Measured cost

`tail -n 2000` is O(1) in file size — 19 ms against a 74 MB transcript. The two-grep pre-filter is
~12 ms and short-circuits when no marker is pending, which is the overwhelmingly common case. The
epoch comparison itself is a scalar read under the state lock — no unbounded term remains: the
per-plane content fingerprint that used to cost 76 ms here and 2.93 s on a 6,849-file tree (§
Ordering, not content) is gone along with the mechanism it served.

### What is still not done

**The round-16–20 architecture gap is resolved — by deletion, not by a sixth relocation.** Five
rounds chased one cause: a dispatch could not prove the pin it read was its own, because hook events
carry no `tool_use_id` and `sha256($TOOL_INPUT)` proves request equivalence, never dispatch identity.

| Round | Where the same defect surfaced |
|-------|-------------------------------|
| 16 | All-or-nothing publish accounting marked a successfully-pinned plane as failed |
| 17 | The accounting's own mismatch branch emitted the input unchanged, so a plane whose reservation another dispatch had taken was marked published |
| 18 | The ambiguity record was a `.blocked` reason, which `stop-guard.sh` reads as non-transient — one transient failure wedged both planes for the session |
| 19 | Relocated to the state file, which needs the state lock — the same lock whose loss is what loses the pin |
| 20 | Relocated again to a lock-free marker file, and `session-init.sh` clears the whole `*.pinfail.*` glob at SessionStart — which erases a **concurrent** session's live marker, because the marker is keyed by plane and nothing in it says which session owns it |

Round 20 closed with a `⛔ Need Human` exit per `rules/auto-loop.md` § Cap Diagnostic Protocol step 2,
because neither closing move on offer — a host-provided correlation key, or a dispatch protocol that
cannot produce concurrent byte-identical requests — was a bounded adjustment. `/refactor`, invoked on
exactly that exit, took a third option the protocol did not anticipate: the mechanism needing the
proof (dispatch pinning — `_record_dispatch_fingerprint`, the pin snapshot/retire pair, the
`.pinfail.*` marker, all eight functions) does not have to exist. § Ordering, not content — and why
that no longer needs ownership proof states the reasoning; the outcome here is that every row in the
table above is retired along with the mechanism it patched, including round 20's SessionStart
erasure — there is no `*.pinfail.*` glob left for a concurrent session's marker to lose. Architecture
findings on this change: **6 → 0.**

**A receipt still describes a tree only up to the next Bash command, and the simplification makes
this gap WIDER, not the same size.** Every gate in this repository shares the underlying property:
`post-edit-format.sh` fires on Edit/Write/NotebookEdit only, so a `sed -i`, a `git apply` or a
`lint:fix` run through Bash mutates the tree and stamps no edit epoch. The fingerprint design this
replaced digested tree *content* at recovery time, so a Bash mutation inside the review window still
changed the digest and was still caught — its residual gap was narrower: only the window between
recovery's final scan and the moment it released its guard, after the content check had already run.
The ordering design has no content check to run: `last_edit_epoch_by_plane[plane]` is written only by
the same three tools, so a Bash mutation made at ANY point — before, during, or after the review — is
invisible to it end to end, not just in a late residual window. This is a real capability traded away
by the simplification, not a restatement of the fingerprint design's own gap: the fingerprint closed
Bash-sourced mutations during the review and left open a race after it; the ordering design leaves
Bash-sourced mutations open throughout, and is exactly as trustworthy on this axis as a foreground
review already was (`/codex-review-fast` itself has never detected a Bash mutation made after it
finished). Closing it needs one of two architecture-level moves (a PreToolUse guard for Bash that
pessimistically invalidates every in-flight epoch, trading most of an already-minority recovery rate
for coverage of a window now measured in the whole review's duration; or a content digest computed at
handoff and compared to one taken at dispatch, which is the capability being given up here).
Recorded here rather than patched, per `rules/fix-all-issues.md` § Exceptions ("beyond current
scope — needs architecture-level change").

Recovery is in-session only — an alignment rather than a limitation, since markers are cleared at
session start and the transcript is per-session, so both halves expire together. And the channel
fires for a **minority** of backgrounded reviews in practice: counting genuine handoffs against
delivered codex notifications gives 15 %, 22 % and 29 % across three real transcripts. Some of that
gap is tasks superseded by `codex-reply` on the same thread rather than lost deliveries, so the
figure is a floor on waste rather than a measure of it — and the edit-then-revert case §
Ordering, not content gave up narrows that floor further, though by how much is not separately
measured.

## #11 — a `tool_response` that is a string of serialized JSON

The host sends this shape for some synchronous MCP completions. Left unparsed it stays one line
beginning with `{`, its newlines still literal `\n`, so every start-of-line-anchored review matcher
misses and the receipt is silently dropped.

**Fix**: normalize four shapes rather than three, with the re-parse **conditional on the parsed
object carrying a recognized payload field**. A review report that merely begins with `{` parses to
nothing useful and passes through unchanged, so the change can only add receipts, never reroute an
output that already worked.

`try fromjson catch null` rather than `fromjson?`: the `?` form yields *empty* on a non-JSON string,
and binding empty via `as $p` produces no pipeline output — turning "parse failed" into "no output",
which is another dropped receipt wearing a different hat.

## Verification

Each fix was reproduced against HEAD before being written, and re-run after.

Counts are test blocks (`test('#N: …')`), taken from the files as they stand, **unless a row says
otherwise**. Two exceptions, to prefix-based derivation rather than to block counting, so the numbers
below can be reproduced: the `session-init.test.js` regression for #10 is named
`test('a new session clears background_reviews …')` without the `#10:` prefix, because it sits in a
suite organised by session lifecycle rather than by issue — grep for `background_reviews` there, not
for the prefix; and its 4.2.1 sibling is named
`test('a new session clears every freshness clock, so the first dispatch is not born stale')`, same
suite, same reason — grep for `dispatch_epoch`. The test itself asserts key-deletion on all four
freshness fields (`dispatch_epoch`, `dispatch_count`, `last_edit_epoch_by_plane`, `seq_counter`),
`dispatch_count` and `seq_counter` added in round 21's fix.

| Fix | Evidence |
|-----|----------|
| #9 | 3-way repro (local copy defers to itself; plugin copy defers; control with no `CLAUDE_PROJECT_DIR` works) → **13** tests in `test/hooks/plugin-local-arbitration.test.js`, covering the symlinked, dev-mode, nested-project, stray-copy and unresolvable layouts, plus a structural pin over all seven hooks |
| #10 | **13** in `post-tool-review-state.test.js` (incl. three negative controls, the plan-plane scope, both directions of the request-side predicate, and a foreground verdict retiring its marker on *each* plane), **5** in `stop-guard.test.js`, **5** in `post-edit-format.test.js` (edit-time retirement on both planes, a cross-plane control, and the degraded lock-contention arm on both planes), **1** in `session-init.test.js` |
| #11 | **6** in `post-tool-review-state.test.js` — both planes × both verdicts, text-block arrays, and a negative pairing non-JSON with payload-less JSON — plus **3** in `jq-filter-fidelity.test.js` running the extracted normalizer under real `jq`, which is the only place the `has_payload` guard is observable |
| 4.2.1 | **51** in `test/hooks/background-verdict-recovery.test.js` — the three structural discrimination selects (Bash tool result, assistant message, `origin.kind`-less user entry) each with a look-alike negative control, envelope-only id and status matching (a foreign report merely quoting our task id does not satisfy our marker), consume-by-task presence in both directions, consume keyed on `(task, plane)`, refuse-once, dispatch-epoch set-if-absent and its earliest-wins property under a second in-flight dispatch, the request-side predicate stamping only the plane it names, freshness ordering in all three directions (edited-after refuses, edited-in-the-SAME-second refuses, edited-before recovers), the supersede re-check's own same-second/strictly-before pair (function-level harness, extracted from the hook rather than re-typed — the negative control a mutation on that specific line needs, since every other case in this file exercises the FIRST freshness check only), both no-verdict foreground branches retiring their epoch (no sentinel; ambiguous BOTH-namespace provenance, asserted to clear both planes), a foreground verdict retiring only its own dispatch's epoch and leaving the other plane's untouched, edit-epoch stamping across all three jq programs including the no-aggregate doc branch, the `TaskOutput` trigger and its own output minting no verdict, a marker that cannot be retired banking no receipt, both verdict branches retiring the marker inside the same lock section as the receipt at all four foreground sites, the terminal refusals consuming their marker rather than re-reading it forever, (round 21) four more: reference counting — a plane resolving does not clear the epoch while a second, still-outstanding dispatch on it needs it (P1#1); a recovered verdict releases its plane's dispatch count so the NEXT dispatch on it can recover too, across two full dispatch→background→recover cycles (P1#2); a malformed marker `dispatch_epoch` cannot reach bash arithmetic as an injection, asserted by a sentinel file that must never be created (P1#4); and a refusal only decrements the count for a marker it actually consumed, not one already gone — two duplicate marker rows for the same `(plane, task)` (a repeated `PostToolUse` delivery), where the second consume finds nothing left and an unconditional decrement would over-retire the count out from under a third, genuinely-outstanding dispatch; and (round 22) five more, all under the count-parameterized `_DISPATCH_EPOCH_RETIRE_JQ` (`$n` replacing the hardcoded `1`): a foreground verdict retires BOTH its own dispatch and a stray marker a second dispatch on the same plane left behind, in the same write (P1#1); the 5-marker cap eviction credits the evicted marker's **own** plane, not the plane that triggered the eviction (P1#2); a legacy `/codex-review-fast` verdict — never `PreToolUse`-tracked — leaves an outstanding MCP dispatch's count and epoch untouched rather than releasing a count it never incremented (P1#3); a foreground response matching no recognized shape still releases the plane the *request* named, via the request-side predicate, mirroring the existing ambiguous-both-namespaces branch (P1#4); and a marker whose `dispatch_epoch` is corrupted to a leading-zero numeral (`"08"`) refuses recovery instead of an octal-arithmetic false negative inside `[[ ]]` that `set -e` cannot see (P1#5); **1** test block in `jq-filter-fidelity.test.js` carrying four assertions (this row departs from the `test(` convention above, and says so rather than inflating the count) for the receipt filter's consume clause — plane-wide retirement on a foreground verdict, task-scoped retirement on a recovery, and both no-op controls (neither argument; a task id with no marker on the named plane) — unaffected by the Half B deletion, since the clause it pins is Half A's; rewritten in round 22 to assert the CURRENT invariant (`update_state` no longer wipes a plane on `$cp` alone — that moved to `_clear_background_reviews` — see the row-21 P1#2 fix above) after the AC trace caught the assertion still pinning the pre-round-21 wildcard-wipe behavior; **1** in `session-init.test.js` for the session-boundary reset of `dispatch_epoch`, `dispatch_count`, `last_edit_epoch_by_plane` and `seq_counter`, key-deletion (not emptying) asserted for all four. Every case with a freshness dimension runs against a real jq comparison rather than a stub, since a stub cannot produce an ordering that differs for the right reason. Count reproducible with `grep -c '^test(' test/hooks/background-verdict-recovery.test.js` |

**The `has_payload` guard needed a test the stubbed suites structurally cannot provide.** The AC
trace found the negative control green with the guard deleted; the first response was to narrow the
AC, on the argument that the two branches are indistinguishable. **That argument was wrong**, and
the round-7 doc review refuted it with jq output rather than reasoning. Two facts it rests on:
`tostring` re-serializes with JSON escapes **decoded**, and the plan-review branches match with
*unanchored* `grep` and no provenance check. So a payload-less object holding
`"## Plan Review"` and `"[PLAN_REVIEW_SKIPPED]"` is inert while guarded and
becomes a plan-state write the moment the guard is gone. Measured:

```console
$ jq -rn '{foo:"## Plan Review"} | tostring'
{"foo":"## Plan Review"}
```

The reason no stubbed test could see it is worth keeping: `post-tool-review-state.test.js`'s stub
does not re-implement the normalizer *minus* the guard — it re-implements it *with the guard always
applied*, so deleting the production clause changes nothing the stub does. The test therefore lives
in `test/hooks/jq-filter-fidelity.test.js`, which **extracts the production filter text** and runs
it under the real `jq`. The AC keeps its original claim, because the claim is now proven.

**Mutation-checked**, because a test that is green before and after the fix proves nothing. Each run
restores the file through a `trap` and asserts the mutant actually applied first — an unapplied
substitution looks exactly like a surviving test:

| Mutation | Result |
|----------|--------|
| Remove `"$_SELF_DIR" != "$_LOCAL_DIR"` | `#9: the LOCAL copy runs instead of deferring to itself` fails |
| Remove the `CLAUDE_PLUGIN_ROOT` origin test | `#9: symlinked install — exactly one of the two invocations does the work` fails |
| Widen the origin match back to `${CLAUDE_PLUGIN_ROOT%/}/*` | `#9: a project nested under the plugin root — the local copy still runs` fails |
| Replace the first-line anchor with an unanchored substring match | `#10: NEG — a real review QUOTING the placeholder still records its own verdict` fails |
| Remove both edit-time retirement clauses | both `#10: a … edit retires the … marker whose gate it re-opens` fail |
| Remove only the **degraded** doc arm's clauses | `#10: the DEGRADED doc path retires the doc marker too` fails while the locked doc test still passes — which is what isolates the two arms |
| Remove `invalidate_review "code_review"` from the degraded **code** arm | `#10: the DEGRADED code path retires the code marker through invalidate_review` fails, alone — 86/88 pass |
| Remove `_clear_background_reviews code` from the MCP verdict branch | `#10: a foreground CODE verdict retires the code marker` fails, alone — 289/291 pass |
| Remove the `⛔ Blocked` branch from `_mcp_code_review_passed` | 4 fail, including `#11: the same shape carrying BOTH verdicts records passed=false` — the single-sentinel version this replaced stayed green, because the parser is fail-closed and returns `false` with no verdict at all |
| Remove the `has_payload` gate (`($p \| unwrap)` unconditionally) | `real jq: a payload-less object passes through UNCHANGED, escapes and all` fails, alone — 44/45 pass. Invisible to every stubbed suite, see above |
| **Round 21.** Weaken the retirement trigger (`<= 0` → `< 0`) | 6 fail, including both P1#1 and P1#2 regressions — a count that reaches exactly zero (the ordinary single-dispatch case) no longer retires at all, a permanent leak |
| Remove the `dispatch_count` increment's set-if-absent-vs-unconditional distinction (increment only when absent, mirroring the epoch) | P1#1 regression fails — the count would read 1 for two concurrent dispatches instead of 2, indistinguishable from the original bug |
| Remove the `marker_de` digit-validation guard | P1#4 regression fails, alone — the injection sentinel is created |
| Replace the guarded decrement (`if _consume_background_review …; then _clear_dispatch_epoch …; fi`) with an unconditional decrement, at the staleness-refusal site | The double-marker regression fails, alone — the count over-retires and the epoch is falsely cleared while a second dispatch is still outstanding |
| Weaken the floor-at-zero clause inside the shared retirement filter (`if $n < 0 then 0 else $n`) | **Survives — not treated as a gap.** The retirement trigger checks `<= 0`, not `== 0`, so the `dispatch_count[$p]` key is deleted whenever the decremented value is non-positive whether or not it was floored — no input distinguishes floored-vs-negative once that branch has already decided to delete the key. The floor is provably redundant defense-in-depth against a count somehow going negative (a missed increment, e.g. a failed `_record_dispatch_epoch` write), not load-bearing logic a test could meaningfully pin |

Reproducible without a bespoke harness. Five properties the command needs, none optional, and each
one is a way an earlier draft got it wrong:

| Property | What goes wrong without it |
|----------|---------------------------|
| The whole run is a **subshell** | `trap … EXIT` fires when the *shell* exits, not when a pasted block ends — so an interactive paste returns to the prompt with the hook still mutated |
| A **unique** backup (`mktemp`) | A shared `/tmp` path can be another run's file, and an unconditional restore then overwrites the source with it |
| The trap installed **after** the backup succeeds, and the cleanup **idempotent** | Installed earlier it restores from a file that does not exist; shared non-terminating across `EXIT`/`INT`/`TERM` it runs twice, the second time from a backup the first already deleted |
| A **uniqueness assertion** on the substitution | An unapplied mutant is indistinguishable from a surviving test |
| The backup deleted **only after a successful copy**, and the failure surfaced | An unconditional `rm` destroys the only recoverable copy while the hook is still mutated; and since the trap's status does not reach the caller, a *passing* test would exit 0 over a corrupted hook |

`node` does the edit because it substitutes fixed strings: the jq programs below contain `$p`, `$r`
and `/`, which `perl -e` interpolates and `sed` treats as a delimiter.

```bash
(
  f=hooks/post-tool-review-state.sh
  bak=$(mktemp) && cp "$f" "$bak" || exit 1
  restore() {
    [ -e "$bak" ] || return 0
    cp "$bak" "$f" || { printf 'RESTORE FAILED — the original is preserved at %s\n' "$bak" >&2; return 1; }
    rm -f "$bak"
  }
  trap restore EXIT
  trap 'restore; exit 130' INT
  trap 'restore; exit 143' TERM

  node -e 'const fs=require("fs"),[f,o,n]=process.argv.slice(1),s=fs.readFileSync(f,"utf8");
if (s.split(o).length-1 !== 1) { console.error("mutant not unique — aborting"); process.exit(9); }
fs.writeFileSync(f, s.replace(o, n));' \
    "$f" '(if ($p | has_payload) then ($p | unwrap) else $r end)' '($p | unwrap)' || exit 9

  node --test test/hooks/jq-filter-fidelity.test.js; st=$?
  restore || exit 1
  exit "$st"
)
```

The explicit `restore` before `exit` is what lets a restoration failure **override** a passing test —
a trap's status never reaches the caller. The `EXIT` trap stays as the net for every early exit
above it, and re-running on a preserved backup is a second attempt, not a double-free.

Measured on all three paths: a failing test exits 1 and a passing one exits 0, both with the file
byte-identical again **on the next command** rather than the next shell; and with the target made
unwritable, the run exits 1, leaves the backup in place, and prints the path to it.

## Review history

| Round | Reviewer | Verdict | Outcome |
|-------|----------|---------|---------|
| 1 | Codex, `thorough` (Anchor Register #3) | ⛔ Blocked — 2 × P2 | Both fixed: origin-based arbitration, marker lifecycle |
| 2 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P2 | Both fixed: exact `hooks/` origin match, edit-time marker retirement |
| 2 | Codex, `thorough` — doc plane | ⛔ Needs revision — 2 × 🔴 | Both fixed: plane scope stated and narrowed to doc/code, `session-init.sh` reconciled |
| 3 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P2 | One fixed (degraded doc arm), one answered by narrowing the claim rather than building a generation counter — see § No review generation |
| 3 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 3 × 🟡 | All three 🟡 were stale quantifiers left by the round-2 revision ("every hook", "Three properties", "Both stubs"); each is a one-line correction in a file already open, so they were fixed rather than deferred |
| 4 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P2 | Fixed: the stop-guard line claimed a review had run, which request-side substring provenance cannot establish — narrowed to what the marker witnesses, both directions of the predicate now pinned by tests |
| 4 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 4 × 🟡 | Same class again: quantifiers and labels the round-3 revision left stale, plus one overstated cross-reference ("prescribes" → "permits"); corrected in place |
| 5 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P2 | Fixed: the note described the surviving race **backwards** — it said "an edit since the handoff", but such an edit retires the marker. The unresolved ordering is dispatch → edit → handoff, and "never having reviewed" leaves a gate open rather than re-opening it |
| 5 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 3 × 🟡 | Logged `[NIT_DEFERRED]`; one of the three was the same reversed clause the code plane blocked on, so it was already fixed |
| 6 | Codex, `thorough` — code plane | ✅ Ready — 0 findings | Codex re-derived the ordering from the writers before comparing it to the string, and confirmed the assertions fail on a re-reversal rather than pinning the current wording |
| 6 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 3 × 🟡 | Provenance wording, the review-history over-generalization, and the test-counting rule; all three folded into the Doc Sync below rather than deferred, since Doc Sync rewrites those same sections |
| — | Adequacy Gate (`--ac-trace`, advisory) | ⛔ Inadequate — ACs 8, 14, 15; AC 16 inconclusive | The only round that read the ACs against the tests rather than the code against itself, and it found three gaps six code reviews had not: no code-plane twin for either retirement path, a missing cell of #11's two-planes × two-verdicts matrix, and a `passed` assertion that was only an `executed` one |
| 7 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P2 | The new BLOCKED-code test asserted nothing: `_mcp_code_review_passed` is fail-closed, so a payload carrying only `⛔ Blocked` is satisfied by the no-verdict fallback. Rewritten to carry **both** sentinels, which is the BLOCKED-first precedence the parser actually claims |
| 7 | Codex, `thorough` — doc plane | ⛔ Needs revision — 2 × 🔴 | Both acted on, and the first is the sharpest finding of the whole change: the "`has_payload` is unobservable" argument written one round earlier was **false**, refuted with jq output — `tostring` decodes escapes, and the plan-review greps are unanchored. A real-`jq` test replaced the narrowed AC. The second rewrote the mutation command, whose `trap` claim its own snippet did not implement |
| 8 | Codex, `thorough` — code plane | ✅ Ready — 0 findings | Confirmed the rewritten BLOCKED test fails in the required negative direction, that `extractFilter` delimits the normalizer safely, and that the escaped-sentinel fixture is a real integrity case rather than a serialization curiosity |
| 8 | Codex, `thorough` — doc plane | ⛔ Needs revision — 1 × 🔴 | The round-7 rewrite of the mutation command was still wrong, and in a way worth recording: a `trap … EXIT` pasted into an interactive shell fires when that **shell** exits, not when the block ends, so the hook stays mutated at the prompt. Fixed by scoping the whole run to a subshell with an idempotent cleanup and terminating `INT`/`TERM` handlers — then run, and the restoration observed |
| 9 | Codex, `thorough` — doc plane | ⛔ Needs revision — 1 × 🔴 | Third pass on the same six lines, and the third real defect in them: `restore()` ran `rm -f "$bak"` even when the copy failed, destroying the only recoverable original — and because a trap's status never reaches the caller, a *passing* test would have exited 0 over a corrupted hook. Fixed and measured on all three paths, including one with the target made unwritable |
| 10 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 1 × 🟡, 1 × ⚪ | Every path traced clean. The two 🟡 are logged: the stale quantifier this file's own review history warned about (fixed in place), and the standing suggestion that executable prose belongs in a checked-in script — three rounds of real safety defects in one snippet is the evidence for it, and it is the natural companion to the 401–500-line split this document has now entered |
| — | Adequacy Gate re-run (`--ac-trace`) | ✅ Adequate — `gaps: []` | All 16 non-quality-gate ACs COVERED, 0 exceptions. AC 15 is the one it raised to High confidence, because the test extracts the production filter rather than maintaining a copy of it |
| 11 | Codex, `thorough` — doc plane | ✅ Mergeable — 0 × 🔴, 2 × 🟡 | Both 🟡 were introduced by the edit that recorded the row above — "the only round" went stale the moment the gate ran twice, and round 10's verdict was logged as 2 × 🟡 when one of the two was ⚪. The pattern this file has named three times now, caught once more on the last edit before the gate closed |
| 12–13 | Codex, `thorough` — code plane | ⛔ Blocked | The wall-clock design's own rounds, not enumerated individually because the design they reviewed is gone: both landed on the same place — a receipt whose freshness is argued from a *time window* cannot say what the reviewer read. Superseded by the two rounds below rather than fixed |
| 14 | Codex, `thorough` — code plane | ⛔ Blocked — 4 × P1, 4 × P2 | The round that ended the wall-clock design outright. `TRANSCRIPT_PATH` treated as harness-authenticated when it is host input; recovery running after every Bash event while edit epochs advanced only on Edit/Write/NotebookEdit; the marker and edit-generation checks outside the lock that commits the verdict; and `AUTO_LOOP_BG_FOREGROUND_WINDOW` neither validated nor bounded to the real handoff interval. Three of the four are the same sentence: **a window is not evidence**. Answered by the content fingerprint, not by tightening the window |
| 15 | Codex, `thorough` — code plane | ⛔ Blocked — 5 × P1 | First review of the content-addressed design, and it found the digest was of the wrong thing: it hashed **rendered `git diff` output** rather than raw tracked content. Plus the `TaskOutput` allowlist gap, receipt mutation and marker consumption in separate transactions, a multi-second fingerprint computed before the check that could discard it, and a dispatch pin retired only on a *recognized* handoff |
| 16 | Codex, `thorough` — code plane | ⛔ Blocked — 4 × P1 | Two bounded (per-plane publish accounting; a unique recovery-guard token that must land in the **shared** `.blocked` file, not only the unretirable emergency marker). Two not: a dedicated dispatch-ambiguity latch, and the live-worktree/immutable-snapshot question |
| 17 | Codex, `thorough` — code plane | ⛔ Blocked — 5 × P1 | Four fixed, and the first of them is the round's real finding: **round 16's own Fix A had introduced the defect it was meant to prevent** — its publish filter's `else .` branch emitted the input unchanged, so `mv` succeeded and a plane whose reservation another dispatch had taken was marked published, raising nothing. Also: the plane-wide `verdict_write_failed` latch retired by an unrelated verdict; the foreground receipt and its marker retirement still in two lock windows; and gitlinks probed only *after* the plane pathspec, which left the doc plane accepting a submodule the code plane refused. The fifth is architecture-level — see § What is still not done |
| 18 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P1, 1 × P2, 1 × Nit | And round 17's own fix did it again, in the other direction: the dedicated latch was raised as a **`.blocked` sidecar reason**, which `stop-guard.sh` reads as an unrecognized, therefore non-transient marker — escalating the session to strict and forcing all four gates false, with nothing to retire it. A transient pin failure would have held both planes shut until a clean-tree SessionStart. Moved to a state-file key — which round 19 then showed was still wrong. The P2 was the matching test defect: the latch's writer was asserted by source text only, so `false && _latch_…` would have passed. Now executed. The remaining P1 is the architecture-level one — see § What is still not done |
| 19 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P1, 1 × P2 | **Third home for one marker, and the round that says why there was never going to be a good one.** A state-file key needs the state lock, and every caller reaches the reporter having just failed to take that lock or released it — so the one condition that loses a pin is the condition that loses its record. Now a lock-free marker file (`<state>.pinfail.<plane>`): existence is the whole content, so two racing writers agree and no serialization is owed. The P2 named four mutations the round-18 test would not have caught — sibling-plane clobbering, retirement by an unrelated verdict, a dropped SessionStart delete, and a sidecar write routed through a variable to evade the source regex — and all four are now killed, the last by a behavioural assertion rather than a text search |
| 20 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P1, 1 × P2, 1 × Nit | **The loop's last round on the fingerprint design.** Three bounded findings were fixed: the marker probe read `-f` only, so a **directory** planted at the fixed path defeats both `rm -f` and `: >` while the state file stays writable — and reading that as absence is the fail-open direction, now `-e \|\| -L`; the writer test asserted no *sidecar reason* by name, which a variable-routed `_set_own_sidecar` evades, now a recording stub with a blanket `SIDECAR:` refusal; and one stale comment. The second P1 was **not** fixed: `session-init.sh` clears the whole `*.pinfail.*` glob unconditionally, erasing a concurrent session's live marker — Codex classified it in its own words as "another manifestation of the recorded missing-correlation architecture issue", which makes it the fifth site of one cause and a ⛔ Need Human exit under § Cap Diagnostic Protocol step 2, not a sixth relocation |
| — | `/refactor` (user-invoked on the round-20 exit) | Simplification decision, not a review verdict | Asked directly whether the mechanism could be simplified or replaced by prompting the model. Measured that backgrounding is the **normal** case for this project's review latency (a fresh review and a same-thread `codex-reply` on a narrow diff both exceeded the 120 s foreground window), which ruled out "just wait in the foreground". Then identified that dispatch pinning (Half B — content fingerprint, ownership proof, the eight functions rounds 16–20 kept patching) exists only to authorize a claim that a *monotone-conservative scalar* does not need, because every ambiguity in it resolves toward refusal rather than toward a false accept (§ Ordering, not content). User confirmed: delete Half B, keep Half A (transcript verification — the report-recovery half), replace fingerprint comparison with per-plane epoch **ordering** |
| 21 | Codex, `thorough` — code plane | ⛔ Blocked — 4 × P1, 1 × P2 | Submitted: Half B deleted; `_record_dispatch_epoch`/`_clear_dispatch_epoch` added; freshness re-expressed as `last_edit_epoch_by_plane[plane] >= dispatch_epoch[plane]`. All five findings fixed. **P1s**: (1) `_clear_dispatch_epoch`'s unconditional `del` let one dispatch's resolution clear an epoch a second, still-in-flight dispatch on the same plane still needed — a false accept once that second dispatch's own marker, recorded later, froze an instant inherited from an unrelated third dispatch (§ Ordering, not content now states this); (2) `update_state`'s 5th/6th-arg marker consumption retired the `background_reviews` entry but never the epoch/count behind it, permanently poisoning the plane's next recovery; (3) the § What is still not done Bash-mutation paragraph claimed the ordering design still caught Bash-sourced mutations during a review — false: the design has no content check at all, a strictly *wider* gap than the fingerprint design's, now stated plainly; (4) `marker_de`, read unvalidated off a `\t`-delimited state-file line, reached two bash `-ge` arithmetic comparisons, where a value shaped like an array-subscript command substitution executes. **P2**: `last_edit_epoch_by_plane`/`dispatch_epoch` sourced `EPOCHSECONDS`/wall clock on both sides of the ordering comparison — not provably monotonic (leap seconds, NTP steps, a suspended sandbox clock). **Fix**: `dispatch_count[plane]` reference counting, retiring an epoch only once every dispatch sharing it has resolved, via one shared jq filter (`_DISPATCH_EPOCH_RETIRE_JQ`) used by every retirement site — a second, independently-written unconditional `del` was found inside `_clear_background_reviews` during the fix and closed the same way; explicit `_clear_dispatch_epoch` calls added to both recovery success branches; a digit-validation guard on `marker_de`; a shared, lock-incremented `seq_counter` replacing wall-clock on all four stamp sites. 4 regression tests added (46 total in `background-verdict-recovery.test.js`, up from 42); full suite re-run (3873 total, 3867 pass, 0 fail, 6 skipped); new guards mutation-checked — see § Acceptance Criteria 4.2.1 |
| 22 | Codex, `thorough` — code plane | ⛔ Blocked — 6 × P1, 1 × P2 | Round 21's reference counting released exactly **1 unit per retirement site**, which round 21 itself never generalized past the single-dispatch case. **P1s**: (1) `update_state`'s own wildcard marker-wipe (task `""`) removed a plane's stray markers as a side effect of its own write, so by the time `_clear_background_reviews` ran right after it there was nothing left to count — crediting only its flat "self" unit and under-crediting the swept marker's, leaking `dispatch_count` by exactly the number of markers that happened to be present; (2) `_record_background_review`'s `.[-5:]` cap silently evicted the oldest marker with no `dispatch_count` decrement at all — the evicted marker's plane leaked forever, indistinguishable from an unrecovered dispatch; (3) the legacy Bash/Skill verdict paths (`hooks.json` registers PreToolUse for the MCP tool only) called the same release as an MCP foreground verdict, over-releasing a count they never incremented — a concurrently outstanding MCP dispatch on the same plane had its reference count retired out from under it; (4) an MCP response matching no recognized shape (a CLI crash, a truncated payload) fell through every branch and retired nothing — a permanent leak with no marker to even show it happened; (5) `marker_de`'s digit-only guard (`^[0-9]+$`) accepted a leading-zero string, which bash then parses as octal — a value like `"08"` errors on the `-ge` comparison, and because that sits inside an `if [[ ... ]]; then`, `set -e` never sees it: the error silently reads as "false", skipping the refusal and risking a stale review banked as fresh. **P2**: stale "fingerprint"/"content addressing" language in ≥3 locations (a request-doc paragraph, a hook comment, a test-fixture comment) describing the Half-B mechanism round 21 had already deleted. **Fix**: `_DISPATCH_EPOCH_RETIRE_JQ` takes a bound `$n` (units to release) instead of a hardcoded `1`; `update_state`'s wildcard wipe removed entirely — the plane-wide wipe and its accounting now live only in `_clear_background_reviews`, which counts what it actually removes in the SAME jq transaction; `_record_background_review` computes the evicted prefix BEFORE truncating to `.[-5:]` and credits each evicted row's OWN `.plane`; `_clear_background_reviews` gains a `release_self` parameter — `true` at the two MCP-foreground call sites (their own dispatch WAS tracked), `false` at the two legacy Bash/Skill sites (never tracked, so release only whatever markers are actually swept); a new fallback branch on the MCP verdict elif-chain releases whatever plane(s) the REQUEST asked for when no shape matched, mirroring the existing ambiguous-response branch; `marker_de`/`edited_at`'s guard tightened to `^(0\|[1-9][0-9]*)$`, refusing any leading zero outright. 5 regression tests added (51 total in `background-verdict-recovery.test.js`, up from 46); the stale terminology corrected at all flagged locations plus one more the sweep found (a hook comment still calling the ordering check "the fingerprint comparison"); full suite re-run, all green — see § Acceptance Criteria 4.2.3 |
| 23 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P1 | Both findings hit the same class round 22 introduced by splitting the wipe out of `update_state`: (1) `update_state`'s own wildcard marker-wipe (task `""`) and its `_clear_background_reviews` follow-up call ran under **two separate locks**, so a crash or a stale-recovery takeover between them left the markers gone but the count uncredited — a permanent leak on the unlucky interleaving, not merely a correctness gap; (2) the 5-marker cap eviction still released one unit per evicted **row**, not per distinct task, so a duplicated marker for one `(plane, task)` straddling the cap boundary over-released. **Fix**: the wildcard wipe moves back INTO `update_state`'s own jq transaction, released through a new `def retire_dispatch_epoch($p; $n)` (`_DISPATCH_EPOCH_RETIRE_DEF`) prepended as its own bash-string piece — `_clear_background_reviews` as a separate call is retired; `$n` for both the wipe and the cap eviction is dedup-counted by distinct task, not row. 2 regression tests added (53 total in `background-verdict-recovery.test.js`, up from 51); full suite re-run green — see § Acceptance Criteria 4.2.4 |
| 24 | Codex, `thorough` — code plane | ⛔ Blocked — 5 × P1, 2 × P2 | Fresh independent review (new thread, metadata-only prompt) of round 23's fold, requested rather than guessed at from a stale compacted task list. Codex independently re-derived the reference-counting invariant and found the fold incomplete in five more places, plus two lower-severity gaps. **P1s**: (1) `invalidate_review` (in `post-edit-format.sh`, the edit-time discard path) dropped a plane's markers on a real edit without ever releasing `dispatch_count`/`dispatch_epoch` for them — a permanent leak, since a deleted marker is never revisited by any other code path (this directly reversed an earlier, wrong worry logged pre-round-23 that fixing this would "double-release"; it does not, because nothing else can ever find that marker again); (2) `update_state`'s task-scoped branch (recovery banking one marker) and `_consume_background_review` still released the epoch/count via a SEPARATE follow-up call after the marker removal, the same split-transaction hazard round 23 fixed for the wildcard branch but left standing here; (3) the round-23 cap-eviction dedup counted distinct tasks WITHIN the evicted set only — a duplicate task's rows can straddle the cap boundary (one evicted, one retained), so an evicted row was still credited even when a sibling row for the same task survived; fixed with a jq array-difference (`$evicted_pairs - $retained_pairs`) so a task with any surviving row is never credited; (4) the MCP verdict routing chain released only the plane(s) a *recognized* branch explicitly touched — a dual-plane request whose response was recognized as ONE plane (or as a plan-shaped report matching neither) left the other plane's PreToolUse increment stranded; fixed with `_settled_doc`/`_settled_code` flags set at every real settlement point plus an unconditional sweep after the whole chain that releases whatever the request acquired and no branch settled; (5) `_record_background_review`'s four failure exits (lock contention, state-file absent, mktemp unavailable, a lost-lock write) left the PreToolUse increment stranded with no marker ever written to explain it — fixed with a compensating `_clear_dispatch_epoch` call on every failure path, safe because the function has exactly one call site and no retry. **P2s**: (6) the doc-edit branch's DEGRADED (lock-contended) arm omitted both the monotonic edit-stamp AND the marker/reference release the LOCKED arm performs — racy by the file's own contract, but wrong when it does land; both added to match the locked arm's jq shape; (7) this doc's own historical description of `_clear_background_reviews` as the current locus (the very call round 23 already retired) — corrected below. 0 new regression tests yet — code-level fixes complete and manually verified (real-`jq` sanity tests against Codex's concrete repro scenarios for findings 1 and 3), full suite re-run pending — see § Acceptance Criteria 4.2.5 |
| 25 | Codex, `thorough` — code plane | ⛔ Blocked — 4 × P1, 1 × P2 | Fresh independent review (new thread continued via `codex-reply`, diff reproduced by Codex itself from `git diff`/`cat` commands rather than pasted — per `@rules/codex-invocation.md`'s loop-review exception) of round 24's fold, after a clean 3887-test full-suite run. Found the round-24 fold itself introduced or left four new defects, all P1, plus one P2 test-quality gap. **P1s**: (1) `update_state`'s task-scoped branch trusted a marker's PRESENCE from a separate, earlier precondition check under the same lock — but `post-edit-format.sh`'s degraded (lock-contended) writer deliberately commits WITHOUT taking this lock at all (`_may_commit_state`, a documented latency trade-off), so it can remove that exact marker between the precondition check and this write; the stale "present" reading then released a unit this transaction never actually retired anything for, corrupting a second, genuinely still-outstanding dispatch's count — fixed by re-deriving presence FRESH inside the same jq read that performs the removal (`$present` bound from the same `map(select(...))` the removal itself filters on), mirroring `_consume_background_review`'s already-correct pattern; (2)+(3) two compensating-release call sites (`_clear_dispatch_epoch`, on both its `_record_background_review`-failure-branch call sites, and `_record_dispatch_epoch`'s own PreToolUse increment) used a single best-effort `_lock` attempt at the global 5s default — for `_clear_dispatch_epoch` this is itself compensation for an already-failed write, so a second lock failure leaks a `dispatch_count` unit with zero durable trace; for `_record_dispatch_epoch` a silent give-up leaves the PostToolUse release side unable to tell "this dispatch never got a reference" from "it did", risking release of an unrelated, still-outstanding dispatch's count — fixed by parameterizing `_lock` with an optional per-call timeout override (`_lock 25` for the rare, already-degraded compensating-release sites, converging toward `LOCK_TTL`'s 30s stale-reclaim horizon; `_lock 10` for the hot PreToolUse path, a moderate increase bounded by its every-MCP-call latency cost); closing the ambiguity fully needs a per-dispatch token threaded PreToolUse→PostToolUse, logged as a residual architecture-level gap rather than attempted here (`rules/fix-all-issues.md` "beyond current scope"); (4) the MCP verdict routing chain's `_settled_doc`/`_settled_code` flags (round-24 P1#4's own fix) were set unconditionally after calling `update_state`/`_clear_dispatch_epoch`, but both return 0 on every documented degraded-failure path too — a failed retirement attempt still set the flag, permanently skipping that plane in the chain's own unconditional sweep (the exact safety net the flag exists to feed) — fixed two ways: `_clear_dispatch_epoch` now returns a real, meaningful exit code (0 only when it can positively confirm no release was needed, or that its own `mv` landed; 1 whenever an attempted release could not be confirmed — every pre-existing fire-and-forget caller ignores the return value, so none of them changed behavior), and a new `_alf_write_confirmed(plane, want)` helper gates the `update_state`-based settlement points on a READ-BACK receipt match (plus absence of a fresh `verdict_write_failed:<plane>` sidecar) rather than trusting the call's return code — a documented, already-accepted blind spot survives (a receipt that already equalled the requested value before a silently-failed write reads as confirmed; the codebase already carries this same blind spot at `_alf_transition`, not new here). **P2**: the doc-plane's own reference-counting arithmetic — written independently of the code-plane's `invalidate_review`, in FOUR separately-written jq programs (locked/degraded arms × aggregate-gate-present/absent) — had zero real-`jq` test coverage; only the code plane's twin (round-24 P1#1) had been verified against the real filter. Fixed with 4 new real-jq tests in `test/hooks/post-edit-format.test.js`, one per jq variant, mirroring the round-24 P1#1 pair's dedup + full-retire scenarios. Fixing finding #2/#3's `_lock` signature (an unconditional `${1:-$LOCK_TIMEOUT}` default expansion on every call, not just the previously-rare contended branch) also required adding `LOCK_TIMEOUT` to `background-verdict-recovery.test.js`'s function-level harness (`HOOK_GLOBALS`) — its extracted-function tests do not source the whole hook, and that global was never needed there before this change made `_lock` read it unconditionally. All five findings fixed; the finding-#1 fix's own code comment initially pushed `update_state`'s surrounding comment block to 35 lines (over the repo's 30-line blocking threshold, `@rules/docs-writing.md` § Code Comments) — migrated to this row, a 2-line pointer left in its place. Full suite re-run: 3891 tests, 3885 pass, 0 fail, 6 pre-existing skips (unrelated to this change) — see § Acceptance Criteria 4.2.6 |
| 26 | Codex, `thorough` — code plane | ⛔ Blocked — 5 × P1, 1 × P2 | Re-dispatch on the existing thread (`codex-reply`, diff reproduced by Codex itself, per `@rules/codex-invocation.md`'s loop-review exception) of round 25's fold. Found the round-25 read-back/confirmation and lock-timeout fixes each left one gap of their own. **P1s**: (1) `_alf_write_confirmed`'s new `_alf_sidecar_has` marker check (round-25 P1#4) was a BLIND scan of every per-event marker — it could not tell "this marker pre-dates my own call" from "this marker appeared because my write just failed", so a STALE `verdict_write_failed:<plane>` sidecar left over from an earlier, already-resolved failure made a write that genuinely landed read back as unsettled forever (nothing on the success path ever clears a per-event sibling — only the SHARED `.blocked` file is cleared) — fixed by snapshotting whether the marker existed BEFORE the call (`_alf_lost0`, taken by `_alf_begin`) and comparing it against a fresh read taken by `_alf_write_confirmed` itself, so only a marker that appeared DURING this call counts; (2) the read-back check itself (`now == want`) is a value-only comparison that cannot tell "this call committed" from "the receipt already held `$want` and this call's write then failed silently" — a documented blind spot from round 25 that turned out to be reachable — fixed with a new operation-local commit signal, `_us_committed`, a global reset to `0` at the top of every `update_state` call and set to `1` ONLY at the actual successful `mv` that commits the write, which `_alf_write_confirmed` now checks FIRST, before ever looking at the receipt; (3) several `_clear_dispatch_epoch` call sites are the LAST command in their own `&&`/`\|\|` list (e.g. `_clear_dispatch_epoch doc && _settled_doc=true`'s sibling forms, the malformed-code-report exit branch, the final unconditional sweep loop) — under the production hook's actual `set -euo pipefail`, a bare failing command in that position aborts the whole hook mid-write, dropping whatever verdict PostToolUse was in the middle of recording; audited every call site against bash's own `&&`/`\|\|`-list errexit-exemption rule (only the command after the FINAL `&&`/`\|\|` in a list trips `set -e`) and added `\|\| true` at the six genuinely exposed sites, leaving the three already-safe `&&`-guarded settlement sites untouched; (4) round 25's fix for the same finding widened the compensating-release lock-timeout from 5s to 25s, which narrows the exposure window but does not close it — a live-but-slower-than-25s lock owner still loses the release permanently, and a third timeout-tuning attempt was explicitly rejected as the wrong adjustment class (`rules/auto-loop.md`'s Stall Memory principle: a repeated adjustment is itself the signal the class is wrong) — fixed instead with a durable `dispatch_pending_release:<plane>` marker, written when `_clear_dispatch_epoch`'s own lock attempt fails, and drained into the NEXT successful `_clear_dispatch_epoch` call's own release count on the same plane (a credit that could not land immediately is applied later rather than leaked permanently; if the following jq/mv transaction itself then fails, the drained credit is re-marked rather than dropped); documented residual, honestly stated rather than hidden: a plane never touched again after a failed release still leaks — attributed to the same pre-existing architecture-level gap already on record (no `tool_use_id` in the PreToolUse/PostToolUse hook payload, so concurrent dispatches on one plane cannot be individually identified), out of scope for this bounded fix per `rules/fix-all-issues.md`'s "beyond current scope" exception; (5) `_record_dispatch_epoch`'s four failure paths (lock timeout, `init_state_file` failure, staging failure, jq/mv failure) each mean the PreToolUse increment they were supposed to record never actually committed, but a release triggered afterward by request-text logic (which has no per-dispatch token to check against) had no way to tell that from "it did commit, decrement the real one" — risking decrement of a real, unrelated, still-outstanding dispatch's count on the same plane — fixed with a durable `dispatch_acquire_failed:<plane>` marker written on every one of the four failure paths, consumed by `_clear_dispatch_epoch` BEFORE it ever touches the real `dispatch_count`, and consumed a second way at the two MCP-foreground `release_self` decision points (downgrading `release_self` to `false` when this specific dispatch's own increment never landed); verified safe under concurrency — consuming the WRONG marker between unrelated dispatches on the same plane can only ever cause an EXTRA leaked (un-decremented) unit, never an incorrect early release, since the mechanism only ever SKIPS a decrement and never performs an extra one. **P2**: `_clear_dispatch_epoch`'s lock-timeout override (round-25 P1#2/#3) was a single value shared by every caller rather than a genuine per-call-site parameter — fixed by making it an explicit optional 2nd argument, with only the four `_record_background_review` compensating-release sites (already-degraded, best-effort paths) passing `25`; every other call site keeps the ordinary default. All six findings fixed; one of the fixes (`_clear_dispatch_epoch`'s docblock, after accumulating round-25's and two of round-26's own finding paragraphs) pushed the surrounding comment block to 40 lines, over the repo's 30-line blocking threshold — compressed to a short pointer at this row, mirroring the round-25 remedy. 9 new regression tests in `background-verdict-recovery.test.js` (66 total, up from 57): findings #1/#2 covered directly via the function-level harness (extending `HOOK_FNS` with `_alf_val`/`_alf_field`/`_alf_receipt`/`_alf_write_confirmed`/`_sidecar_is_marker`/`_sidecar_emergency_mark`/`_sidecar_consume_marker`, 4 tests — positive and negative control for each of the two sub-fixes); finding #3 via a NEW `set -e`-enabled harness variant (`runInHookHarnessErrexit`, added alongside the existing `-uo pipefail`-only harness rather than switching it — Codex's own review named the missing `-e` as why the bug shipped undetected, and retrofitting `-e` onto the shared harness would have been an unreviewed behavior change for the ~50 pre-existing tests that use it); finding #4 via a two-call harness sequence (lock held with `timeout=0` to fail fast, then freed, proving the second call's release folds in the first one's stranded credit); finding #5 via a harness test proving the marker-consumption path returns success WITHOUT touching a seeded, unrelated real dispatch's count; and two structural (static-regex) tests pinning the P2 fix's call-site scoping and the MCP sites' marker-consumption downgrade. Two PRE-EXISTING structural tests (round-23's "every foreground verdict retires its plane…" and round-22's "…binds release_self correctly…") had gone stale against finding #5's own `release_self` change (a hardcoded `"true"` literal became a per-call variable) and were updated in the same pass — the second exists to distinguish "the semantic assertion changed" from "the semantic assertion was quietly weakened": it still asserts exactly 2 hardcoded-`false` legacy sites and 2 plane-matched-variable MCP sites, rather than only loosening the pattern. Full suite re-run pending — see § Acceptance Criteria 4.2.7 |
| 27 | Codex, `thorough` — code plane | ⛔ Blocked — 5 × P1 | Re-dispatch on the existing thread (`codex-reply`, diff reproduced by Codex itself, per `@rules/codex-invocation.md`'s loop-review exception) of round 26's fold, after a clean 3900-test full-suite run (round-26 row's own `EXIT:0`). Found round 26's own confirmation and release-accounting fixes each left one further gap — none a rubber stamp. **P1s**: (1) round 26 P1#1/#2's fix left `_alf_write_confirmed` checking `_us_committed` FIRST but still falling through to the `_alf_lost0`/fresh-marker comparison when `_us_committed` read `0` — that fallback is racy against a CONCURRENT (not stale) dispatch on the SAME plane in both directions: a second dispatch's own in-flight failure can plant a fresh `verdict_write_failed:<plane>` marker during THIS call's window, false-rejecting a write that actually landed; and a second dispatch's own success can clear the marker during the window, false-confirming a write that actually failed — the review's own regression test (`background-verdict-recovery.test.js:1736`) was named directly as enshrining the unsafe fallback, since it manually supplied `_us_committed=1` and a fresh marker and asserted rejection, which the fix's own correct behavior must now overturn — fixed by deleting the fallback entirely: `_alf_write_confirmed` is now `[[ "${_us_committed:-0}" == "1" ]]` alone, since round 26 P1#2 already established `_us_committed` is set at the one instant that matters (the actual committing `mv`, same jq transaction as any bundled epoch retirement) and nothing else running inside one hook invocation can race it; (2) `_clear_dispatch_epoch`'s per-invocation base credit (`+1` per call, on top of whatever markers it drains) was uncapped per PLANE per invocation — the hook's own unconditional final sweep loop can call it a second time for a plane already settled earlier in the SAME invocation (e.g. a settlement site's own explicit call, followed by the sweep's blanket retry for "just in case"), and that second call charged a second base unit for zero additional real dispatches, over-releasing `dispatch_count` by exactly one and risking release of a concurrent, genuinely still-outstanding dispatch on the same plane — fixed with `_cde_attempted_planes`, an invocation-scoped (naturally scoped — each hook run is a fresh bash process) space-separated tracker of which planes have already been attempted THIS invocation: the base credit is `1` only on a plane's first attempt, `0` (drain-only) on every subsequent same-invocation retry for that plane, while two genuinely SEPARATE invocations on the same plane still compound normally, each starting with an empty tracker; (3) every one of `_clear_dispatch_epoch`'s failure paths (lock-acquisition failure, staging failure, post-lock jq/mv/ownership-loss failure) re-marked only `_drained` as a fresh `dispatch_pending_release:<plane>` marker, silently dropping the invocation's OWN base credit whenever the base-crediting attempt itself was the one that failed — a genuine, permanent leak on exactly the failure path the marker mechanism exists to prevent — fixed by re-marking the FULL `n` (`_base + _drained`) on every failure branch, plus a new `if n -eq 0` short-circuit (unlock, return 0) for the now-common case where a same-invocation retry with nothing to drain has nothing owed at all; (4) `dispatch_acquire_failed:<plane>` markers (round-26 P1#5) are plane-scoped, not dispatch-scoped — the hook payload carries no `tool_use_id`, so an unrelated CONCURRENT dispatch on the same plane can wrongly consume another dispatch's own failure marker, which for THIS marker's specific consumers can only ever cause an extra leaked (never an incorrectly early) release per round 26's own safety argument, but is nonetheless a real cross-dispatch identity gap — evaluated for a local fix and found to have none: no per-dispatch identity is available anywhere in the payload to scope the marker by, making this the sixth site of the SAME pre-existing "no `tool_use_id`" architecture-level gap already on record (round-20's SessionStart marker-erasure finding, round-26 P1#4's own residual note) rather than a sixth relocation of a fixable bug — documented, not fixed, per `rules/fix-all-issues.md`'s "beyond current scope" exception, task #106; (5) `_sidecar_consume_marker`'s tombstone rename target, `"${f}.consumed.$-${RANDOM}${RANDOM}"`, still began with `$f`'s own value — which already carries `SIDECAR_EVENT_PREFIX` — so the tombstone itself still matched every reader's `SIDECAR_EVENT_PREFIX*` glob; a lost `rm -f` race on the tombstone (the file staying behind after a crash between the `mv` and the `rm`) let a SECOND consumer's glob re-discover and re-claim the same already-consumed marker, double-releasing whatever it represented — fixed by renaming into the file's own established `.blocked.staging.` prefix instead (`"${STATE_FILE}.blocked.staging.consumed.$-${RANDOM}${RANDOM}"`), the same prefix `_sidecar_emergency_mark`'s own staging convention already proves invisible to every reader's glob. 4 of 5 findings fixed (#1, #2, #3, #5); finding #4 documented as architecture-level, out of scope — see § Acceptance Criteria 4.2.8. `state-commit-ownership.test.js`'s `NON_STATE_DESTINATIONS` classifier needed no further change for the finding-#5 rename (the fix kept the destination variable named `$tomb`, already matched by the round-26-added `sidecar marker tombstone` entry). Two PRE-EXISTING tests had gone stale against the corrected semantics and were rewritten rather than loosened: the finding-#1 negative-control test (`background-verdict-recovery.test.js:1736`, named directly by Codex as enshrining the unsafe fallback) now asserts `_us_committed` alone decides the outcome, with no marker of any freshness able to override it; and the round-26 finding-#4 drain test's assertion flipped from expecting `dispatch_count === undefined` (double-release, the old "correct" reading) to `dispatch_count.code === 1` (single release, per finding #2's fix) — plus a new positive-control test proving two genuinely separate invocations on the same plane still compound their base credits normally, so the fix narrows exactly the double-counting case and nothing wider. `_clear_dispatch_epoch`'s docblock, pushed to 36 comment lines mid-edit by the finding #2/#3 paragraphs (over the repo's 30-line blocking threshold), compressed to a ~12-line pointer at this row, mirroring the round-25/round-26 remedy; `check-comment-blocks.js` re-run clean. `background-verdict-recovery.test.js`: 68/68 pass (up from 66 — 2 rewritten, 3 new: finding #1's corrected negative-control, finding #2's corrected drain assertion plus its new positive-control, finding #3's post-lock-failure full-`n` re-mark test, finding #5's tombstone-reclaim test). Full suite re-run pending — see § Acceptance Criteria 4.2.8 |
| 28 | Codex, `thorough` — code plane | ⛔ Blocked — 2 × P1, 1 × P2 | Re-dispatch on the existing thread (`codex-reply`, diff reproduced by Codex itself, per `@rules/codex-invocation.md`'s loop-review exception) of round 27's fold, after a clean 3902-test full-suite run (round-27 row's own `EXIT:0`). Found `_cde_attempted_planes` itself (round-27 finding #2's fix) left one gap, and re-evaluated round-27 finding #4's severity upward rather than accepting the prior disposition. **P1s**: (1) `_cde_attempted_planes` registered a plane the instant a `_clear_dispatch_epoch` call was ATTEMPTED, before knowing whether that call's own credit landed anywhere — every `_sidecar_emergency_mark` write is itself best-effort (`\|\| true`); a lock failure at the SAME time the compensating mark write also fails (e.g. transient disk pressure) left nothing durable anywhere, yet the plane was already marked "attempted", permanently suppressing every later same-invocation retry's base credit for the rest of that hook invocation — a real, deterministic, 100%-reproducible loss in that combination, not a rare edge case — fixed by moving registration to AFTER the credit is durably accounted for: a new `_marked` flag tracks whether every `_sidecar_emergency_mark` call in a given failure branch succeeded, and the plane is appended to `_cde_attempted_planes` only when `_retired == true` (committed) or `_marked == true` (fully re-parked), at the three sites that can register a plane at all — never unconditionally, and never on a call whose own base contribution was zero; (2) round-27 finding #4's own residual note ("can only ever cause an extra leaked unit, never an incorrectly early release") was traced and found INCOMPLETE: a dispatch F whose PreToolUse acquisition fails, followed by a genuinely fresh dispatch S on the same plane that succeeds, followed by S consuming F's stray `dispatch_acquire_failed` marker at its own settlement point (downgrading S's `release_self` rather than F's, since nothing distinguishes them) — F can then time out into `_record_background_review`, which samples "the current plane epoch" (now S's fresh one) and attaches it to F's marker; when F's stale pre-edit report is later recovered, `marker_de` reads as newer than the edit stamp and F's stale report passes the freshness check it should have failed. This is a false-positive stale-verdict acceptance, not merely an over-conservative leak — the round-27 documentation understated it. Evaluated for a bounded local fix; the reviewer's own suggested mitigation (poison plane freshness — refuse background recovery for a plane with an outstanding, unconsumed `dispatch_acquire_failed` marker) is implementable with existing infrastructure but trades away background-recovery availability on the affected plane whenever such a marker is outstanding, a product/behavior trade-off rather than a pure bug fix — escalated to ⚠️ Need Human per `@rules/auto-loop.md` rather than applied unilaterally; see § Acceptance Criteria 4.2.9 and the human decision point recorded there. **P2**: the round-27 finding #3 regression test (post-lock full-credit re-mark) seeded `dispatch_count.code = 1`, under which a later call's own fresh base-1 credit alone zeroed the count whether or not the failed call's re-mark had actually worked — the test passed identically under the fixed and the round-27-buggy implementation — fixed by seeding `2` (so the two outcomes diverge: fixed reaches 0, buggy leaves 1 stuck) plus a direct assertion that exactly one `dispatch_pending_release:code` marker file exists on disk between the two calls. Finding #1 fix covered by a new regression test forcing a genuinely held lock (real `$LOCKDIR`) together with a stubbed, always-failing `_sidecar_emergency_mark` for call 1, then restoring both and retrying in the same script for call 2 — proving the retry still applies its own base credit rather than reading the plane as already settled. `background-verdict-recovery.test.js`: 69/69 pass (up from 68 — 1 new for finding #1, finding #3's test strengthened in place). Full suite re-run pending — see § Acceptance Criteria 4.2.9 |
| 29 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P1, 1 × P2, 1 × Nit | Re-dispatch on the existing thread (`codex-reply`, diff reproduced by Codex itself, per `@rules/codex-invocation.md`'s loop-review exception) of round 28's fold, after a clean 3903-test full-suite run (§ Acceptance Criteria 4.2.9's own `EXIT:0`) and the human's decision to accept round-28 finding #2's residual risk. Explicitly asked to verify finding #1's fix and to confirm the stale-verdict architecture note's documentation is consistent with the already-made decision without re-arguing it — honored: Codex did not re-litigate the decision and only flagged a stale doc-pointer Nit for it. **P1**: round-28 finding #1's own fix (the `_marked` flag) was traced to a further, more precise loss than round 27's original finding #3 covered — the flag was set across a LOOP of `n` separate one-unit `_sidecar_emergency_mark` writes per failure branch, so a transient failure partway through that loop lost whatever units the remaining un-written markers were meant to represent, with no record of how many; concretely, a plane already registered by an earlier successful base-parking (so a same-invocation retry reads `_base=0`) can drain an existing marker, have its transaction fail, and then have its own re-mark loop ALSO partially fail — since `_base=0` for this retry, no registration-tracking code path is even touched, so the credit vanishes with zero trace and the plane stays "registered" from the earlier, now-stale success — fixed by eliminating the loop-of-N-writes mechanism entirely: each failure branch now writes ONE marker whose body embeds the whole count (`dispatch_pending_release:<plane>:<n>`, e.g. `dispatch_pending_release:code:2`), so the write either lands atomically in full or not at all, with no partial-persistence state to lose track of; a new `_sidecar_consume_counted_marker` helper (same claim-and-tombstone mechanics as `_sidecar_consume_marker`) parses, digit-validates (`^(0\|[1-9][0-9]*)$` — the same leading-zero guard as round-22 finding #5, for the same octal-arithmetic reason), and consumes such a marker, printing the extracted count; the drain loop sums across however many counted markers happen to exist. A "peek before commit, drain only after success" alternative (deferring the destructive drain until after the transaction commits) was considered and rejected before writing any code: it introduces a NEW double-release race, since two concurrent invocations could both peek the same still-undrained markers before either drains them and each independently commit a transaction crediting those same units twice. **P2**: neither the round-27 finding #3 test nor its round-28 strengthening ever seeded an EXISTING pending marker before forcing a fresh failure, so `n = _base + _drained` was only ever exercised with `_drained = 0` — a call whose own base landed but which also had something real to drain was untested; fixed with a new test seeding a pre-existing counted marker (`dispatch_pending_release:code:2`) and asserting a fresh call's own base(1) + drained(2) together retire a count of 3, plus a companion test proving the drain sums across TWO separate leftover counted markers rather than stopping after the first. **Nit**: `_record_dispatch_epoch`'s docblock (round-27/28's own correction) still described the stale-verdict architecture finding as "a product decision left to the human" and pointed at § 4.2.8, both now stale since the human decided in round 28 — corrected to state the decision was made and accepted, pointing at § 4.2.9. All three fixed; the new counted-marker format required updating one exact-body test assertion (`background-verdict-recovery.test.js:1934`, `dispatch_pending_release:code` → `dispatch_pending_release:code:1`) and adding the new helper (`_sidecar_consume_counted_marker`) to the function-level harness's explicit `HOOK_FNS` list — omitting it first made the drain loop silently call an undefined function and drain 0 every time, caught by the new base+drained test failing with exactly the "only base applied" signature. 4 new/updated regression tests (72 total in `background-verdict-recovery.test.js`, up from 69: the base+drained test, the multi-marker-sum test, a leading-zero-rejection test for the new helper, plus the marker-format assertion update). `check-comment-blocks.js` re-run clean (`_clear_dispatch_epoch`'s docblock rewritten to describe the atomic-counted-marker mechanism rather than the retired loop, still under the 25-line warning threshold). Full suite re-run: 3906 tests, 3900 pass, 0 fail, 6 pre-existing skips — see § Acceptance Criteria 4.2.10 |
| 30 | Codex, `thorough` — code plane | ⛔ Blocked — 1 × P1, 2 × P2 | Re-dispatch on the existing thread (`codex-reply`, diff reproduced by Codex itself, per `@rules/codex-invocation.md`'s loop-review exception) of round 29's fold, after a clean 3906-test full-suite run (round-29 row's own `EXIT:0`). Found round 29's own atomic-counted-marker redesign traded the old loop-of-N-writes loss for a narrower but still-real one, plus a validation gap the new marker format itself opened. Confirmed as genuinely fixed and not re-litigated: the round-29 Nit (`_record_dispatch_epoch`'s docblock correction). **P1**: the round-29 redesign still **destructively drained** existing counted markers to learn their total BEFORE knowing whether the transaction they fed would land — a same-invocation retry (`_base=0`, already registered) that drained a pre-existing marker and then failed BOTH the jq transaction and its own single-marker full-`n` replacement write permanently lost the drained credit, since the source marker was already gone by the time the replacement write was attempted; the next call would then see base=0 (still registered) and drained=0 (nothing left to find), and falsely report success without ever touching `dispatch_count` — fixed by replacing the destructive drain with a non-destructive **peek**: a new `_sidecar_peek_counted_markers(prefix)` scans and prints every matching marker's path and count WITHOUT removing anything, and a new `_sidecar_consume_marker_path(path)` consumes an exact, already-peeked path — called ONLY after the transaction that folds its value has positively committed, all still within the same held lock (so no concurrent invocation can peek the same not-yet-consumed markers, which is exactly why the round-29 docblock's own rejected "peek before commit, drain only after success" alternative does NOT reopen here: that alternative deferred the destructive drain until after releasing the lock, letting two invocations peek before either drained — this design never releases the lock between peek and consume). On any failure path, `_clear_dispatch_epoch` now re-marks at most its OWN `_base` (bounded to 0 or 1) — never the full `n` — so a peeked marker this call did not write is never destroyed on a failure it did not cause; there is nothing borrowed from an earlier marker left to lose. **P2 (1)**: the counted-marker digit-validation regex (`^(0\|[1-9][0-9]*)$`, from round-29's own leading-zero fix) had no upper length bound — a marker body embedding a value like `9223372036854775808` (2^63) overflows bash's signed 64-bit `$(( ))` and wraps to a large negative `n`, which `_DISPATCH_EPOCH_RETIRE_JQ` would then use to INCREASE `dispatch_count` instead of retiring it, with the source marker already gone — fixed by bounding the regex to `^(0\|[1-9][0-9]{0,14})$` (15 digits, orders of magnitude beyond any real dispatch count while staying far below where summing several such values could itself overflow) directly inside `_sidecar_peek_counted_markers`, so an over-length count is never reported by the peek and never reaches `n` at all. **P2 (2)**: neither the round-27/28/29 tests ever forced a re-marking failure with BOTH `_base` and `_drained` non-zero on the SAME call, so a semantic reintroduction of the old N-write-loop bug (or the round-30 destructive-drain bug itself) would still have passed the existing suite unnoticed — fixed with a new three-call same-invocation regression test: call1 (lock genuinely held) marks its own base(1) and registers; call2 (lock free, `_base=0`) peeks call1's marker, forces BOTH `jq` and the emergency-mark replacement to fail, and must leave the peeked marker on disk byte-for-byte unchanged (asserted via in-script checkpoints written to the harness's own stdout, since a `readdirSync` from the Node side only ever sees the state after the WHOLE script — all three calls — has finished, never a snapshot between them); call3 (real `jq` and marking restored) must then recover that same untouched marker and fully retire the plane. A companion test proves an over-length digit count is never reported by the new peek function and the malformed marker is left in place, never consumed. All three findings fixed. 2 new regression tests (74 total in `background-verdict-recovery.test.js`, up from 72 — the peek-not-destroy-on-failure test and the overflow-rejection test), plus `HOOK_FNS` updated to extract the two new helpers (`_sidecar_peek_counted_markers`, `_sidecar_consume_marker_path`) in place of the now-deleted `_sidecar_consume_counted_marker`, and the one pre-existing test that called that deleted function directly rewritten against the new peek function (renamed, same count) and one other pre-existing test's title corrected in place (it exercises `_clear_dispatch_epoch`'s overall behavior, not the deleted helper — no test-count change). `check-comment-blocks.js` re-run clean (`_clear_dispatch_epoch`'s docblock rewritten to describe the peek/consume-by-path mechanism and the 15-digit bound, 19 lines — still under the 25-line warning threshold). Full suite re-run — see § Acceptance Criteria 4.2.11 |

**Adequacy was the only review *type* that read the ACs against the tests**, rather than the code
against itself, and that is the reason to run it: six code reviews had passed over the three gaps
its row above lists. Two of the three were **symmetry** gaps — one plane or arm tested, the other
argued to follow from shared code — and that argument is exactly what an AC trace does not accept.
The third was not symmetry but assertion strength: `executed` where the claim needed `passed`.

Round 1 also produced a finding neither reviewer raised: the review call was itself backgrounded,
which exposed the inert normalizer described above. Three fixes went into that round, not two.

Round 2 repeated the pattern twice more, and both are worth keeping. The code reviewer found that
the round-1 fix was *narrower than the class it claimed to close*: a descendant match reads as the
same rule but reproduces zero-fire whenever a project sits under the plugin root. And the doc
reviewer found the plan plane recording markers that nothing retires — an asymmetry the
implementation had, the document did not mention, and neither reviewer would have seen from the
other's half of the change.

**Rounds 3 and 4 found the same class of doc defect twice**, and it is worth naming rather than
just fixing: both rounds repeatedly turned up a *stale quantifier or label* that a previous revision
had left behind — the counted kind ("every hook", "Three properties", "Both stubs", "Two things")
and, in round 4, scope labels and one overstated cross-reference ("prescribes" → "permits") of the
same shape. Adding a row to a table or an item to a list does not touch the sentence above it that
says how many there are — or what it is — and nothing mechanical checks the two against each other.
The signal is cheap once known: after revising a doc, re-read every number **and every scope word**
that describes a structure you changed.

Round 2's doc review was itself backgrounded, and this time the marker landed: the state file
recorded `{"plane":"doc","task":"kviu64mc0"}` against the live handoff. That is the #10 fix verified
end-to-end against the real host payload rather than a fixture — the failure it replaces is the one
where the first implementation was checked against `{content:[…]}` and shipped inert.

All three affected stub `jq` implementations — in `post-tool-review-state.test.js`,
`stop-guard.test.js` and `post-edit-format.test.js` — were extended to match the hooks rather than
stubbed to a bare exit:
an unrecognized query falls through to an empty write, which the hook reads as a failed `jq` — so a
stub gap is indistinguishable from the hook declining to write, and the test would have passed
against a stub artifact.

## Acceptance Criteria

- [x] The local hook copy runs instead of deferring to itself, including through a symlinked `.claude`
- [x] The plugin copy still defers when a local copy is installed and registered (no double-fire)
- [x] An unresolvable path leaves the guard false, so the hook runs
- [x] All seven arbitrated hooks carry the resolved-path comparison, pinned structurally
- [x] A symlinked install (`.claude/hooks` → the plugin's hooks dir) executes exactly once, not twice
- [x] A project nested **under** the plugin root still runs its local copy, and the plugin copy still defers
- [x] A bare content-block array is normalized, so the handoff branch is reachable at all
- [x] Markers are retired on a foreground verdict, on the edit that re-opens their plane (locked **and** degraded arms), and cleared at session start
- [x] The stop-guard note states what the marker witnesses — request-side evidence only, not proof a review ran, and not the sole reason the gate is open
- [x] Markers are persisted for the doc and code planes only — the planes that have a gate and a retirement path
- [x] A backgrounded **doc or code** review records a marker and an `[AUTO_LOOP_STATE]` fact naming the reason and task; a backgrounded **plan** review emits the fact only
- [x] The marker never discharges the gate, and stop-guard surfaces the request-shaped handoff beside the open gate without attributing its cause
- [x] A review quoting the placeholder still records its own verdict
- [x] A JSON-string `tool_response` records the receipt on both planes, for both verdicts
- [x] Payload-less JSON and non-JSON text pass through unchanged — pinned under real `jq`, escapes intact, so a decoded sentinel cannot reach the unanchored plan-review greps
- [x] Regression tests exist for all three, mutation-checked on the two load-bearing guards
- [x] `/codex-review-fast` round 1 — ⛔ Blocked, 2 × P2, both fixed
- [x] `/codex-review-fast` round 2 — ⛔ Blocked, 2 × P2, both fixed
- [x] `/codex-review-doc` round 2 — ⛔ Needs revision, 2 × 🔴, both fixed
- [x] `/codex-review-fast` re-review after the round-2 fixes — round 3, ⛔ Blocked, 2 × P2, both answered
- [x] `/codex-review-doc` re-review after the round-2 fixes — round 3, ✅ Mergeable, 3 × 🟡 corrected in place
- [x] `/codex-review-fast` re-review after the round-3 fixes — round 4, ⛔ Blocked, 1 × P2, fixed
- [x] `/codex-review-doc` re-review after the round-3 fixes — round 4, ✅ Mergeable, 4 × 🟡 corrected in place
- [x] `/codex-review-fast` re-review after the round-4 fix — round 5, ⛔ Blocked, 1 × P2, fixed
- [x] `/codex-review-doc` re-review after the round-4 revision — round 5, ✅ Mergeable, 3 × 🟡 logged
- [x] `/codex-review-fast` re-review after the round-5 fix — round 6, ✅ Ready, 0 findings
- [x] `/codex-review-doc` re-review after the round-5 fix — round 6, ✅ Mergeable, 3 × 🟡 folded into Doc Sync
- [x] `/precommit` — ✅ PASS (comment_blocks, lint:fix, build, test)
- [x] `/codex-review-doc` re-review of the Doc Sync revision — ✅ Mergeable, 1 × 🟡 fixed on the spot under § Sub-Threshold Findings exception 1
- [x] Adequacy Gate (`/codex-test-review --ac-trace`, advisory) — ⛔ Inadequate on ACs 8, 14, 15 + AC 16 inconclusive; three tests added, one AC narrowed, mutation commands recorded
- [x] `/codex-review-fast` after the Adequacy Gate closure — round 7, ⛔ Blocked, 1 × P2, fixed
- [x] `/codex-review-doc` after the Adequacy Gate closure — round 7, ⛔ Needs revision, 2 × 🔴, both acted on
- [x] `/codex-review-fast` after the round-7 fixes — round 8, ✅ Ready, 0 findings
- [x] `/codex-review-doc` after the round-7 fixes — round 8, ⛔ Needs revision, 1 × 🔴 (mutation-command trap scope), fixed
- [x] `/precommit` after the round-7 and round-8 changes — ✅ PASS (first run ❌ FAIL on markdownlint; `lint:fix` applied 11 fixes to this document, re-run green)
- [x] `/codex-review-doc` after the round-8 fix — round 9, ⛔ Needs revision, 1 × 🔴, fixed
- [x] `/codex-review-doc` after the round-9 fix — round 10, ✅ Mergeable, 1 × 🟡 + 1 × ⚪ logged (the 🟡 fixed on the spot under § Sub-Threshold Findings exception 1: "Four properties" → "Five")
- [x] Adequacy Gate re-run after the closure — ✅ **Adequate**, `gaps: []`, all 16 non-quality-gate ACs COVERED, 0 exceptions
- [x] `/codex-review-doc` after recording the Adequacy re-run — round 11, ✅ Mergeable, 2 × 🟡 (both stale claims this edit itself introduced; fixed on the spot under exception 1)

### 4.2.1 — backgrounded verdict recovery

- [x] A completed backgrounded review's verdict is recovered from the transcript and recorded as a receipt, for the doc and code planes and for both verdicts
- [x] Only a genuine `task-notification` entry can mint a verdict — a Bash tool result, an assistant message, and a `user` entry lacking `origin.kind` are each refused by their own negative control
- [x] The task id and status are matched in the **envelope** only, so a delivery whose report quotes another task's id does not satisfy that task's marker
- [x] Staleness is decided by a per-plane edit-vs-dispatch **ordering**, never by content and never by a wall-clock window — `last_edit_epoch_by_plane[plane] >= dispatch_epoch[plane]` refuses; `dispatch_epoch` is stamped at PreToolUse, set-if-absent, so a second in-flight dispatch on the plane never overwrites the earlier instant (§ Ordering, not content states why this needs no ownership proof, and what it gives up: an edit-then-revert no longer survives recovery, unlike the content-fingerprint design it replaces)
- [x] The comparison is `>=`, not `>` — an edit landing in the same second as the dispatch is unordered with respect to it, and unordered resolves to refusal, pinned in both directions plus the boundary itself
- [x] A doc edit leaves a code marker recoverable, and a code edit refuses one — both directions pinned, across all three jq programs that stamp `last_edit_epoch_by_plane` (the code plane's `invalidate_review`, and the doc plane's aggregate and no-aggregate branches)
- [x] A marker with no dispatch epoch at all (predates this mechanism, or its own PreToolUse never ran) refuses recovery rather than treating "no evidence" as "fresh"
- [x] Recovery consumes **one** marker by task id, and a marker refused on an eligibility check is consumed too
- [x] The recovery window is bracketed: the freshness check that authorizes the write and the write itself are not one atomic step, so a **second**, post-write re-check of the same ordering catches an edit landing in the gap between them, and supersedes the just-written verdict back to `false` if it lands there — its own same-second boundary is pinned separately (function-level harness, since no end-to-end fixture can stage an edit landing inside a single hook invocation's internal gap)
- [x] A receipt is never written from a marker that was already retired — consuming precedes the write and its failure refuses it
- [x] A foreground response that resolves a dispatch but records no verdict (no sentinel; or provenance ambiguous across both namespaces) explicitly retires that dispatch's epoch, so the next dispatch on the plane does not inherit a stale instant — both branches pinned, including the ambiguous one requiring the underlying *request* (not just the output) to name both planes
- [x] A foreground verdict retires only its own dispatch's epoch, leaving a concurrent dispatch on the **other** plane's epoch untouched
- [x] A foreground verdict retires its plane's markers inside the **same lock section** that writes the receipt, at all four sites
- [x] A new session clears both `dispatch_epoch` and `last_edit_epoch_by_plane` by key deletion, not by emptying to `{}` — both are read for textual presence as a pre-filter elsewhere, and an empty object left behind would put a lock and a temp file on the hot path of every verdict for the rest of the session
- [x] Mutation-checked on every new guard: the `>=` boundary on both the recovery-eligibility check and the independent post-write supersede re-check, dispatch-epoch set-if-absent, both no-verdict foreground branches' epoch retirement. One guard's mutant (`"$marker_de" == "0"` removed from the eligibility disjunct) survived and is not treated as a gap: for non-negative epoch seconds it is provably redundant with the adjacent `-ge` comparison — any real timestamp `>= 0` already refuses when `marker_de` is `0` — so no input distinguishes the mutant from the original, and the disjunct stands as defense-in-depth / explicit documentation of intent rather than as load-bearing logic a test could meaningfully pin
- [x] **Round 20's `⛔ Need Human` exit is resolved.** Not by the correlation key the protocol asked for — Half B (dispatch pinning: `_record_dispatch_fingerprint`, the pin snapshot/retire pair, the `.pinfail.*` marker and SessionStart's glob-clear of it, 8 functions) is deleted in full. There is no `pending_dispatch` key, no `*.pinfail.*` marker, and no SessionStart clearing of either — the round-20 finding (a cross-session marker erasure with no session identity to check) has no marker left to erase. § What is still not done records this as resolved rather than deferred
- [x] `/codex-review-fast` round 21 — ⛔ Blocked, 4 × P1, 1 × P2, all five fixed (round-21 row, § Review history)

### 4.2.2 — round 21's reference-counting and monotonic-sequencing fixes

- [x] An epoch is retired only once every dispatch that ever shared it has resolved — `dispatch_count[plane]` increments on every draw and decrements on every resolution; a plane resolving does not clear the epoch while a second, still-outstanding dispatch on it needs it (P1#1 regression, § Ordering, not content restates the corrected claim)
- [x] The decrement lives in one shared jq filter (`_DISPATCH_EPOCH_RETIRE_JQ`), used by both `_clear_dispatch_epoch` and `_clear_background_reviews` — the second site had its own independently-written unconditional `del` carrying the identical defect, found while fixing the first (`_clear_background_reviews` itself is retired at round 23 — the wipe it performed moves back into `update_state`'s own transaction; see § 4.2.4)
- [x] A background recovery's success path releases its plane's dispatch count explicitly (`update_state`'s marker-consuming arguments retire only the marker, never the epoch/count) — pinned across two full dispatch→background→recover cycles on the same plane, so the mechanism is proven to work repeatedly, not just once (P1#2 regression)
- [x] A refusal branch decrements the count only for a marker it actually consumed — `_consume_background_review` filters out every row matching `(task, plane)`, so two duplicate rows (a repeated `PostToolUse` delivery for one handoff) collapse to zero on the first consume; an unconditional decrement on the second, already-empty consume would over-retire the count out from under a genuinely outstanding dispatch
- [x] `marker_de`, read off a `\t`-delimited state-file line, is validated as all-digits before reaching either of the two bash `-ge` arithmetic comparisons that consume it, closing a command-injection vector a value shaped like an array-subscript command substitution would otherwise reach (P1#4 regression)
- [x] `last_edit_epoch_by_plane` and `dispatch_epoch` are both stamped from one shared, lock-incremented `seq_counter`, not wall-clock `EPOCHSECONDS`/`date -u +%s` — both sides of the ordering comparison are draws from the same strictly-increasing source, not two independent clock reads (P2 fix)
- [x] The § What is still not done Bash-mutation paragraph is corrected: the ordering design has no content check at all and is blind to a Bash-sourced mutation at any point (before, during, or after review) — a strictly *wider* gap than the fingerprint design it replaced, not a restatement of the same one (P1-3 fix)
- [x] Mutation-checked: the retirement trigger's `<= 0` boundary, the count-increment's unconditional-vs-set-if-absent distinction, the `marker_de` digit guard, and the conditional-decrement-on-consume-success pattern all kill their mutant. The floor-at-zero clause inside the shared retirement filter does not — provably redundant with the `<= 0` trigger, since a decremented value that is non-positive gets its key deleted whether or not it was floored; documented as defense-in-depth, not a gap (§ Verification mutation table)
- [ ] `/precommit` after this revision — superseded by round 22 finding new blocking issues in the round-21 fix before precommit was reached; tracked as a round-23 gate in § 4.2.3 below
- [ ] `/codex-review-doc` on this revision — same, tracked below

### 4.2.3 — round 22's count-parameterized retirement

- [x] `update_state`'s own jq no longer removes any `background_reviews` marker on the plane wildcard (task `""`) — the plane-wide wipe, and the count it must credit, live entirely in `_clear_background_reviews` now; the task-scoped branch (`$ct` **and** `$cp` both set, used by recovery banking one marker) is unaffected and still removes exactly that marker (round 23 folds this wipe back into `update_state`'s own transaction and retires `_clear_background_reviews` as a separate call — see § 4.2.4)
- [x] A foreground verdict resolving its own dispatch while a second, still-outstanding dispatch on the same plane has already backgrounded a marker retires **both** units in the one write — the marker is superseded, `dispatch_count` and `dispatch_epoch` for the plane both fully retire, not left stuck at 1
- [x] The 5-marker cap's eviction (`.[-5:]`) is computed and credited in the SAME jq transaction as the truncation: the evicted prefix's own `.plane` fields are read before truncating, and each evicted row decrements its OWN plane's `dispatch_count` — pinned with a mixed-plane fixture (1 doc + 4 code at the cap, a 6th code marker added) so a same-plane eviction cannot be mistaken for correct cross-plane accounting
- [x] A legacy Bash/Skill verdict (`/codex-review-fast` run directly, not through the MCP tool) does not decrement a `dispatch_count` it never incremented — `_clear_background_reviews`'s `release_self` parameter is `false` at both legacy call sites, `true` at both MCP-foreground call sites; pinned against a concurrently outstanding MCP dispatch on the same plane, which must survive the legacy call untouched
- [x] An MCP response matching no recognized shape (not doc-owned, not a plan verdict, not a code review, not the background-handoff phrase, not the ambiguous both-namespaces case) still releases whatever plane(s) the request asked for, proven from the request side only — mirroring the existing ambiguous-response branch rather than inventing a new provenance rule
- [x] `marker_de` and `edited_at` refuse any leading-zero numeral outright (`^(0|[1-9][0-9]*)$`), not just non-digit input — closing the case where the prior all-digits guard let a value like `"08"` through, bash then parsed it as octal, the invalid digit errored the `-ge` comparison, and the error — sitting inside an `if [[ ... ]]; then` — read as silent `false` under `set -e` rather than aborting, defeating the freshness check by a different route than the injection the original guard closed
- [x] The stale "fingerprint"/"content addressing" language describing the deleted Half-B mechanism is corrected everywhere the round-22 review and its own follow-up sweep found it: the request doc's § Consuming, not clearing paragraph, a `_recover_background_reviews` code comment that still called the ordering check "the fingerprint comparison", a second code comment pointing a future fix at "the fingerprint track", and three comments plus one dead fixture field (`fp`) in the test files
- [x] Mutation-checked: `$n` bound to `1` in `_clear_dispatch_epoch` reproduces the pre-round-22 single-release behavior exactly (verified standalone against real `jq` before splicing into the hook); the cap-eviction accounting verified against both a 5-pre-existing/6th-added fixture and a no-eviction control
- [x] 5 new regression tests in `background-verdict-recovery.test.js` (51 total, up from 46), one per P1 finding; full 3-file suite (`background-verdict-recovery.test.js`, `jq-filter-fidelity.test.js`, `post-tool-review-state.test.js`) re-run green after every fix, including a pre-existing `jq-filter-fidelity.test.js` test updated to assert the NEW (correct) no-wildcard-wipe behavior in place of the OLD (buggy) plane-wide wipe it had pinned
- [x] `/codex-review-fast` round 22 — ⛔ Blocked, 6 × P1, 1 × P2, all seven fixed (round-22 row, § Review history)

### 4.2.4 — round 23's transaction-fold and dedup fixes

- [x] (P1#1) `update_state`'s wildcard plane-wipe on `$cp` alone — removed at round 22 into a separate `_clear_background_reviews` call under its own lock — moves back INTO `update_state`'s own jq transaction, calling the shared decrement through a `def retire_dispatch_epoch($p; $n)` (`_DISPATCH_EPOCH_RETIRE_DEF`) prepended as its own bash-string piece rather than spliced into the literal, which had corrupted `jq-filter-fidelity.test.js`'s text-extraction of the program. `$n` is dedup-counted by DISTINCT TASK, not marker row, so a duplicated marker for one `(plane, task)` is credited once. `_clear_background_reviews` is retired as a separate call
- [x] (P1#2 part 2) the 5-marker cap eviction (4.2.3 above) still released one unit per evicted ROW — the same duplicate-row hazard P1#1 fixes for the plane-wide sweep. `$evicted` is now grouped by plane and deduped to distinct tasks before releasing, through the same shared `retire_dispatch_epoch`, instead of a third hand-rolled copy of the decrement
- [x] 2 new regression tests in `background-verdict-recovery.test.js` (53 total, up from 51); full suite re-run green
- [x] `/codex-review-fast` round 23 — ⛔ Blocked, 2 × P1, both fixed (round-23 row, § Review history)

### 4.2.5 — round 24's settlement, dedup-refinement, and compensating-release fixes

Fresh independent Codex review (new thread, metadata-only prompt per `@rules/codex-invocation.md`) of the round-23 fold, dispatched rather than continuing to guess at remaining work from a stale compacted task list. Full finding narrative: round-24 row, § Review history.

- [x] (P1#1) `invalidate_review` (`hooks/post-edit-format.sh`) releases `dispatch_count`/`dispatch_epoch` for every plane whose markers a real edit discards, computed via the same distinct-task dedup as the wildcard-wipe fix — a deleted marker is never revisited by any other code path, so not releasing here was a permanent leak, not a double-release risk (this reverses an earlier, pre-round-23 worry logged in this doc that releasing here would double-release)
- [x] (P1#2) `update_state`'s task-scoped branch (the recovery-banking-one-marker path) and `_consume_background_review` both fold their `retire_dispatch_epoch` call into the SAME jq transaction as the marker removal, closing the split-transaction/split-lock hazard round 23 fixed for the wildcard branch but left standing on these two paths; all four call sites that used to follow up with a separate `_clear_dispatch_epoch` call are simplified accordingly
- [x] (P1#3) cap eviction's distinct-task dedup (4.2.4 above) is refined to also exclude any evicted pair that has a surviving row: `$evicted_pairs - $retained_pairs` (jq array difference, by value), verified against a real-`jq` repro (a duplicate task's two rows straddling the cap boundary) before landing — dedup WITHIN the evicted set alone was insufficient
- [x] (P1#4) the MCP verdict routing chain (`hooks/post-tool-review-state.sh`) settles every plane the ORIGINAL REQUEST acquired, not just the plane(s) a *recognized* branch happens to touch: `_settled_doc`/`_settled_code` flags are set at every genuine settlement point in the elif chain (including the Priority-2.5 fallback and the code-branch's early exit, which releases doc first since its own `exit 0` bypasses everything after it), and an unconditional sweep after the whole chain releases whatever the request-side predicates (`_mcp_request_asked_for_doc_review`/`_mcp_request_asked_for_code_review`) say was acquired but not settled — closing the gap for a dual-plane request whose response reads as one plane only, or as a plan-shaped report matching neither
- [x] (P1#5) `_record_background_review`'s four failure exits (lock contention, state file absent, `mktemp` unavailable, a lost-lock write) each call the existing `_clear_dispatch_epoch` as a compensating release for the PreToolUse increment they otherwise strand — safe because the function has exactly one call site and no retry path, verified by grep before relying on it
- [x] (P2#6) the doc-edit branch's degraded (lock-contended) arm gains both the monotonic `last_edit_epoch_by_plane` stamp and the marker/reference release the locked arm already performs, in both `has_agg` variants — racy by the file's own contract (the degraded arm may lose the race entirely), but wrong when it does land
- [x] (P2#7) this doc's own historical description of `_clear_background_reviews` as the current locus — the call round 23 already retired — corrected at § 4.2.2, § 4.2.3, § Related Files, and this section
- [x] Full 3-file suite (`background-verdict-recovery.test.js`, `jq-filter-fidelity.test.js`, `post-tool-review-state.test.js`) re-run after all seven fixes AND the six regression tests below — clean; whole-repo suite also re-run (3887 tests, 3881 pass, 0 fail, 6 pre-existing skips unrelated to this change)
- [x] Regression tests for the five P1 findings above — 6 new tests: 2 in `test/hooks/post-edit-format.test.js` for P1#1 (real jq, not the file's stub — the stub never modelled `dispatch_count`/`dispatch_epoch`), and 4 in `test/hooks/background-verdict-recovery.test.js` for P1#2 (atomic-transaction), P1#3 (cap-eviction straddle dedup), P1#4 (dual-plane sweep), P1#5 (compensating release via the function-level harness with a stubbed `init_state_file`)
- [x] `/codex-review-fast` round 24 — ⛔ Blocked, 5 × P1, 2 × P2, all seven fixed (round-24 row, § Review history)
- [x] `/codex-review-fast` round 25 — ⛔ Blocked, 4 × P1, 1 × P2, all five fixed (round-25 row, § Review history)

### 4.2.6 — round 25's TOCTOU, lock-robustness, and settlement-confirmation fixes

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-25 row, § Review history.

- [x] (P1#1) `update_state`'s task-scoped branch re-derives marker presence FRESH inside the same jq read that performs the removal, rather than trusting the separate, earlier precondition check under the same lock — closes the window where `post-edit-format.sh`'s degraded (lock-contended, deliberately unlocked) writer removes the same marker between that check and this write
- [x] (P1#2)+(P1#3) `_lock` takes an optional per-call timeout override; `_clear_dispatch_epoch`'s two compensating-release call sites use a 25s budget (converging toward `LOCK_TTL`'s 30s stale-reclaim horizon — these are rare, already-degraded paths where correctness outweighs the wait) and `_record_dispatch_epoch`'s hot PreToolUse path uses a moderate 10s budget (bounded by its every-MCP-call latency cost); every pre-existing bare `_lock` call is unaffected (falls back to the unchanged global default). Fully closing the ambiguity needs a per-dispatch token threaded PreToolUse→PostToolUse — logged as a residual, accepted architecture-level gap, not attempted here
- [x] (P1#4) `_clear_dispatch_epoch` returns a real exit code (0 = confirmed no-op-or-landed, 1 = attempted release could not be confirmed); a new `_alf_write_confirmed(plane, want)` helper gates `update_state`-based settlement points on a read-back receipt match plus absence of a fresh `verdict_write_failed:<plane>` marker; every settlement point in the MCP verdict routing chain (`_settled_doc`/`_settled_code`) now sets its flag only when the underlying release is confirmed, so an unconfirmed attempt falls through to the chain's own unconditional sweep instead of being silently treated as settled
- [x] (P2#5) 4 new real-`jq` tests added in `test/hooks/post-edit-format.test.js` for the doc plane's reference-counting arithmetic — one per independently-written jq variant (locked/degraded arms × aggregate-gate present/absent) — mirroring round-24 P1#1's code-plane dedup + full-retire pair, which was the only real-jq coverage that existed before this round
- [x] `background-verdict-recovery.test.js`'s function-level harness (`HOOK_GLOBALS`) updated to include `LOCK_TIMEOUT`, made a hard dependency of every `_lock` call (not just the contended branch) by the P1#2/#3 fix above
- [x] Full suite re-run after all fixes — 3891 tests, 3885 pass, 0 fail, 6 pre-existing skips (round-25 row, § Review history)
- [x] `check-comment-blocks.js` re-run clean — no ≥30-line blocks (the finding-#1 fix's own comment was migrated here, per round-25 row)
- [x] `/codex-review-fast` round 26 — ⛔ Blocked, 5 × P1, 1 × P2, all six fixed (round-26 row, § Review history)

### 4.2.7 — round 26's marker-staleness, commit-signal, set -e, and durable-release fixes

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-26 row, § Review history.

- [x] (P1#1) `_alf_write_confirmed` compares `_alf_lost0` (a `verdict_write_failed:<plane>` marker snapshot taken by `_alf_begin` BEFORE the call) against a fresh read taken by `_alf_write_confirmed` itself, rather than trusting `_alf_sidecar_has`'s blind scan of every per-event marker — closes the false-reject where a STALE marker from an earlier, already-resolved failure sank a genuinely-committed write
- [x] (P1#2) `update_state` sets a new global, `_us_committed`, reset to `0` at the top of every call and to `1` only at the actual successful `mv` that commits the write; `_alf_write_confirmed` checks it FIRST, before the receipt — closes the false-confirm where a receipt that already held `$want` before a silently-failed write read as confirmed
- [x] (P1#3) every `_clear_dispatch_epoch` call site audited against bash's own `&&`/`||`-list errexit-exemption rule (only the command after the FINAL `&&`/`||` in a list trips `set -e`); `|| true` added at the six sites that were genuinely the last command in their list (the four `_record_background_review` compensating-release sites, the malformed-code-report exit branch, and the final unconditional sweep loop), leaving the three already-`&&`-guarded settlement sites (`_clear_dispatch_epoch <plane> && _settled_<plane>=true`) untouched
- [x] (P1#4) a `_clear_dispatch_epoch` lock-acquisition failure now writes a durable `dispatch_pending_release:<plane>` marker (via `_sidecar_emergency_mark`); the NEXT successful `_clear_dispatch_epoch` call on the same plane drains every such marker (`_sidecar_consume_marker`, looped) into its own release count, and re-marks the drained credit if its own jq/mv transaction then fails — not a third timeout-tuning attempt (round-25's 5s→25s already tried once and rejected as the wrong adjustment class); documented residual: a plane never touched again after a failed release still leaks, attributed to the existing architecture-level "no `tool_use_id` in the hook payload" gap, out of scope here
- [x] (P1#5) every one of `_record_dispatch_epoch`'s four failure paths now writes a durable `dispatch_acquire_failed:<plane>` marker; `_clear_dispatch_epoch` consumes it BEFORE ever touching the real `dispatch_count`, and the two MCP-foreground `release_self` decision points consume it a second way to downgrade `release_self` to `false` when their own increment never landed — cross-contamination between unrelated dispatches on the same plane can only ever leak an extra unit, never cause an incorrect early release
- [x] (P2#6) `_clear_dispatch_epoch` takes a genuine optional 2nd argument (`lock_timeout`) forwarded to `_lock`; only the four `_record_background_review` compensating-release sites pass `25`, every other call site keeps the ordinary default
- [x] `_clear_dispatch_epoch`'s docblock, pushed to 40 comment lines by accumulated round-25/26 finding paragraphs, compressed to a short pointer at this section (`@rules/docs-writing.md` § Code Comments 30-line blocking threshold); `check-comment-blocks.js` re-run clean
- [x] 9 new regression tests in `background-verdict-recovery.test.js` (66 total, up from 57) — 4 for findings #1/#2 (function-level harness, extending `HOOK_FNS` with `_alf_val`/`_alf_field`/`_alf_receipt`/`_alf_write_confirmed`/`_sidecar_is_marker`/`_sidecar_emergency_mark`/`_sidecar_consume_marker`), 1 for finding #3 (new `set -e`-enabled harness variant, `runInHookHarnessErrexit`, kept separate from the existing `-uo pipefail`-only harness rather than switching it), 1 for finding #4 (two-call sequence proving a stranded credit is drained by the next successful call), 1 for finding #5 (proving marker consumption returns success without touching an unrelated real dispatch's count), and 2 structural tests (call-site timeout scoping; MCP release_self downgrade). Two pre-existing structural tests (round-22's and round-23's own foreground-verdict-site pins) updated in the same pass — finding #5 turned the two MCP sites' `release_self` from a hardcoded `"true"` literal into a per-call variable, which the old assertions read literally; both now assert the semantic property (2 hardcoded-`false` legacy sites, 2 plane-matched-variable MCP sites) rather than a weakened pattern match
- [x] First full-suite run after the round-26 code fixes surfaced one unrelated failure: `state-commit-ownership.test.js`'s structural `mv`-classifier (a whole-tree scan requiring every rename to resolve to `COMMIT` or a named `NON_STATE_DESTINATIONS` entry) had never been told about `_sidecar_consume_marker`'s own tombstone rename (`mv "$f" "$tomb"`, added earlier this session for finding #5's marker-consumption mechanism) — added a `sidecar marker tombstone` entry naming that destination, the deliberate-naming discipline the test's own docstring asks for. Not a round-26 finding; a test-classifier gap the first genuinely-full run exposed
- [x] Full suite re-run after all fixes — 3900 tests, 3894 pass, 0 fail, 6 pre-existing skips (`EXIT:0`)
- [x] `/codex-review-fast` round 27 — ⛔ Blocked, 5 × P1, 4 fixed + 1 documented architecture-level (round-27 row, § Review history)

### 4.2.8 — round 27's TOCTOU, retry-double-count, transaction-loss, and tombstone fixes

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-27 row, § Review history.

- [x] (P1#1) `_alf_write_confirmed` simplified to `[[ "${_us_committed:-0}" == "1" ]]` alone — the round-26 `_alf_lost0`/fresh-marker fallback deleted entirely, closing a TOCTOU racy against a CONCURRENT dispatch on the same plane in both the false-reject and false-confirm directions; `_us_committed` alone is sufficient because round-26 P1#2 already established it is set at the single instant that matters, and nothing else runs inside one hook invocation to race it
- [x] (P1#2) `_cde_attempted_planes`, an invocation-scoped tracker of which planes `_clear_dispatch_epoch` has already been attempted for this hook run — base credit (`_base`) is `1` only on a plane's first attempt per invocation, `0` (drain-only) on a same-invocation retry (e.g. the unconditional final sweep re-calling for an already-settled plane); two genuinely separate invocations on the same plane still compound their base credits normally
- [x] (P1#3) every `_clear_dispatch_epoch` failure path (lock-acquisition failure, staging failure, post-lock jq/mv/ownership-loss failure) now re-marks the FULL `n = _base + _drained` as a `dispatch_pending_release:<plane>` marker, not just `_drained` — closes the permanent leak where a failure on the base-crediting attempt itself dropped that credit; a new `if n -eq 0` short-circuit (unlock, return 0) covers the common same-invocation-retry-with-nothing-to-drain case
- [x] (P1#4) `dispatch_acquire_failed:<plane>` marker cross-consumption between unrelated concurrent dispatches on the same plane evaluated for a local fix and found to have none — no per-dispatch identity exists anywhere in the hook payload (`tool_use_id` is not present) to scope the marker by; documented as the sixth site of the same pre-existing architecture-level gap already on record (round-20's SessionStart marker-erasure finding, round-26 P1#4's own residual note), per `rules/fix-all-issues.md`'s "beyond current scope" exception — task #106
- [x] (P1#5) `_sidecar_consume_marker`'s tombstone destination changed from `"${f}.consumed.$-${RANDOM}${RANDOM}"` (still matched `SIDECAR_EVENT_PREFIX*`, since `$f` already carries that prefix) to `"${STATE_FILE}.blocked.staging.consumed.$-${RANDOM}${RANDOM}"` (the file's own established staging prefix, already proven invisible to every reader's glob) — closes the double-release where a lost `rm -f` race on the tombstone let a second consumer re-claim an already-consumed marker
- [x] Two PRE-EXISTING tests rewritten to test the CORRECTED semantics rather than loosened: the finding-#1 negative-control test (named directly by Codex as enshrining the unsafe fallback) now asserts `_us_committed` alone decides the outcome; the round-26 finding-#4 drain test's assertion flipped from `dispatch_count === undefined` (double-release) to `dispatch_count.code === 1` (single release), plus a new positive-control test proving two separate invocations still compound normally
- [x] `_clear_dispatch_epoch`'s docblock, pushed to 36 comment lines mid-edit by the finding #2/#3 paragraphs, compressed to a ~12-line pointer at this section (`@rules/docs-writing.md` § Code Comments 30-line blocking threshold); `check-comment-blocks.js` re-run clean
- [x] `background-verdict-recovery.test.js`: 68/68 pass (up from 66) — finding #1's corrected negative-control, finding #2's corrected drain assertion plus its new positive-control, finding #3's post-lock-failure full-`n` re-mark test, finding #5's tombstone-reclaim test
- [x] `state-commit-ownership.test.js`'s `NON_STATE_DESTINATIONS` classifier needed no further change — the finding-#5 rename kept the destination variable named `$tomb`, already matched by the round-26-added `sidecar marker tombstone` entry
- [x] Full suite re-run after all round-27 fixes — 3902 tests, 3896 pass, 0 fail, 6 pre-existing skips (`EXIT:0`)
- [x] `/codex-review-fast` round 28 — ⛔ Blocked, 2 × P1, 1 × P2, 2 fixed + 1 escalated to ⚠️ Need Human (round-28 row, § Review history)

### 4.2.9 — round 28's invocation-tracker registration fix, test strengthening, and an open architecture decision

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-28 row, § Review history.

- [x] (P1#1) `_cde_attempted_planes` registration moved from unconditional (at the top of `_clear_dispatch_epoch`, before any lock/mark/commit attempt) to conditional on the credit actually landing somewhere — a new `_marked` flag tracks whether every `_sidecar_emergency_mark` write in a failure branch succeeded, and a plane is appended to the tracker only when `_retired == true` or `_marked == true`, never on a call whose own base contribution was zero
- [x] (P2) the round-27 finding #3 regression test re-seeded with `dispatch_count.code = 2` (was `1`, under which the test passed identically whether or not the fix worked) plus a direct assertion that exactly one `dispatch_pending_release:code` marker file exists on disk between the two calls
- [x] New regression test for finding #1: a genuinely held lock (real `$LOCKDIR`) combined with a stubbed, always-failing `_sidecar_emergency_mark` forces call 1 to leave nothing durable anywhere; both are then restored and call 2 retries in the same script, proving the retry still applies its own fresh base credit rather than reading the plane as already settled — under the round-28 bug this left `dispatch_count.code` permanently stuck for the rest of the invocation
- [x] `background-verdict-recovery.test.js`: 69/69 pass (up from 68 — 1 new, 1 strengthened in place)
- [x] `check-comment-blocks.js` re-run clean after the `_record_dispatch_epoch` docblock's finding-#4/#2 severity correction (below)
- [x] Full suite re-run after the round-28 fixes — 3903 tests, 3897 pass, 0 fail, 6 pre-existing skips (`EXIT:0`)
- [x] **⚠️ Need Human — resolved**: round 28 re-evaluated round-27 finding #4 (`dispatch_acquire_failed:<plane>` marker cross-consumption between unrelated concurrent dispatches on the same plane) and found the round-27 documentation understated the risk — it is not merely an over-conservative leaked reference count, but can let a genuinely stale background-recovered verdict pass a freshness check (traced concretely: a failed dispatch F, a fresh dispatch S on the same plane, S wrongly consuming F's failure marker, F later timing out into `_record_background_review`, which samples the plane's now-S-fresh epoch and attaches it to F's marker — F's stale report then reads as fresh on recovery). No exact per-dispatch fix exists (the hook payload carries no `tool_use_id`). Presented to the human as a three-way choice (accept residual risk / implement fail-closed poisoning, trading away background-recovery availability on affected planes / redesign with a real per-dispatch identity, a payload-level change). **Decision: accept the residual risk as documented** — consistent with how this same root-cause family (6 prior sites, same "no per-dispatch identity" gap) has been handled at every earlier site. No further code change from this decision; the corrected severity characterization in `_record_dispatch_epoch`'s docblock and this section stands as the permanent record
- [x] `/codex-review-fast` round 29 (re-review of the round-28 fixes themselves, per Anchor Register #6 — any code edit invalidates prior verdicts) — ⛔ Blocked, 1 × P1, 1 × P2, 1 × Nit, all three fixed (round-29 row, § Review history; § Acceptance Criteria 4.2.10)

### 4.2.10 — round 29's atomic-counted-marker redesign

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-29 row, § Review history.

- [x] (P1) the loop-of-`n`-separate-one-unit-marker-writes mechanism in every `_clear_dispatch_epoch` failure branch replaced with a single atomic write per branch whose body embeds the whole count (`dispatch_pending_release:<plane>:<n>`) — either the full credit lands in that one write or none of it does, eliminating the partial-persistence state the loop mechanism could lose track of
- [x] New helper `_sidecar_consume_counted_marker(prefix)` — same claim-and-tombstone consume mechanics as `_sidecar_consume_marker`, parses and digit-validates (`^(0|[1-9][0-9]*)$`, the same leading-zero/octal-arithmetic guard as round-22 finding #5) the embedded count, prints it on success; the drain loop sums across however many leftover counted markers exist for the plane
- [x] (P2) new test: a call whose own base(1) lands AND which drains a pre-existing counted marker(2) retires the SUM (3), not just one term — the gap neither the round-27 nor round-28 test exercised
- [x] New test: `_sidecar_consume_counted_marker`'s drain sums across TWO separate leftover markers for the same plane, not just the first one found
- [x] New test: a leading-zero count (`dispatch_pending_release:code:08`) is rejected outright, never consumed, mirroring round-22 finding #5's established guard pattern
- [x] (Nit) `_record_dispatch_epoch`'s docblock corrected — the stale-verdict architecture note no longer reads "a product decision left to the human" pointing at § 4.2.8; it states the decision was made and accepted, pointing at § 4.2.9
- [x] `background-verdict-recovery.test.js:1934`'s exact-body marker assertion updated for the new format (`dispatch_pending_release:code` → `dispatch_pending_release:code:1`)
- [x] `_sidecar_consume_counted_marker` added to the function-level harness's `HOOK_FNS` extraction list — its omission on the first pass made the drain loop silently call an undefined function (drain always 0), caught by the new base+drained test failing with exactly that signature before the fix landed
- [x] `background-verdict-recovery.test.js`: 72/72 pass (up from 69 — 3 new, 1 updated for the marker-format change)
- [x] `check-comment-blocks.js` re-run clean — `_clear_dispatch_epoch`'s docblock rewritten to describe the atomic-counted-marker mechanism, still under the 25-line warning threshold
- [x] Full suite re-run after the round-29 fixes — 3906 tests, 3900 pass, 0 fail, 6 pre-existing skips
- [ ] `/precommit` then `/codex-review-doc` on this request doc's own changes (task #85) — pending Codex round 30's verdict on this round's fixes

### 4.2.11 — round 30's peek-then-consume-after-commit redesign

Re-dispatch on the existing thread (`codex-reply`), diff reproduced by Codex itself rather than pasted, per `@rules/codex-invocation.md`'s loop-review exception. Full finding narrative: round-30 row, § Review history.

- [x] (P1) `_clear_dispatch_epoch`'s destructive drain (round-29's `_sidecar_consume_counted_marker`, which claimed-and-removed a marker to learn its count) replaced with a non-destructive **peek**: new `_sidecar_peek_counted_markers(prefix)` prints `<path><TAB><count>` for every matching, digit-valid marker without removing anything; new `_sidecar_consume_marker_path(path)` consumes an exact, already-peeked path
- [x] Consumption moved to strictly AFTER the transaction that folds a peeked marker's value has positively committed, still inside the same held state lock (never released between peek and consume) — the property that keeps this safe from the round-29 docblock's own rejected "peek before commit, drain after success" alternative, which failed by releasing the lock between the two steps
- [x] Every failure path re-marks at most `_base` (bounded to 0 or 1) — never the full `n` — since a peeked-but-not-yet-consumed marker this call did not write is never destroyed by a failure it did not cause
- [x] (P2) counted-marker digit regex bounded from `^(0|[1-9][0-9]*)$` to `^(0|[1-9][0-9]{0,14})$` (15 digits) — closes the bash `$(( ))` signed-64-bit overflow (a value like `9223372036854775808` wrapping negative and then INCREASING `dispatch_count` via `_DISPATCH_EPOCH_RETIRE_JQ` instead of retiring it)
- [x] (P2) new test: a 3-call same-invocation sequence (lock genuinely held → base(1) marked and registered; lock free with `_base=0` → both `jq` and the emergency-mark replacement forced to fail; jq and marking restored) proves the peeked marker survives the middle call's total failure byte-for-byte, and the final call recovers it and fully retires the plane — checked via in-script stdout checkpoints, since a `readdirSync` from the Node side only ever observes state after the WHOLE script (all three calls) has finished, never a snapshot between them
- [x] New test: an over-length digit count (Codex's own `9223372036854775808` PoC) is never reported by `_sidecar_peek_counted_markers` and the malformed marker is left in place, never consumed
- [x] Round-29 Nit (verified, not re-litigated): `_record_dispatch_epoch`'s docblock correction confirmed genuinely fixed by Codex — no further change needed
- [x] `HOOK_FNS` updated: `_sidecar_consume_counted_marker` (deleted) replaced by `_sidecar_peek_counted_markers` + `_sidecar_consume_marker_path`
- [x] The one pre-existing test that called the deleted helper directly (`... rejects a leading-zero count ...`) rewritten against `_sidecar_peek_counted_markers`; one other pre-existing test's title corrected in place (it exercises `_clear_dispatch_epoch`'s overall behavior, not the deleted helper — not a semantic change)
- [x] `background-verdict-recovery.test.js`: 74/74 pass (up from 72 — 2 new, 1 rewritten, 1 retitled)
- [x] `check-comment-blocks.js` re-run clean — `_clear_dispatch_epoch`'s docblock rewritten to describe the peek/consume-by-path mechanism and the 15-digit bound (19 lines, under the 25-line warning threshold)
- [x] Full suite re-run after the round-30 fixes — 3908 tests, 3902 pass, 0 fail, 6 pre-existing skips
- [ ] `/precommit` then `/codex-review-doc` on this request doc's own changes (task #85) — pending Codex round 31's verdict on this round's fixes

## Related Files

| File | Change |
|------|--------|
| `hooks/post-tool-review-state.sh` | #9 arbitration, #10 handoff branch + marker, #11 normalizer, 4.2.1 `_record_dispatch_epoch`/`_clear_dispatch_epoch` + the two ordering checks in `_recover_background_reviews` (Half B — dispatch pinning, content fingerprint, 8 functions — deleted); round 21 — `dispatch_count[plane]` reference counting, the shared `_DISPATCH_EPOCH_RETIRE_JQ` filter (also used by `_clear_background_reviews`), explicit epoch release on both recovery success branches, `marker_de` digit validation, `seq_counter` replacing wall-clock in `_record_dispatch_epoch`; round 22 — `_DISPATCH_EPOCH_RETIRE_JQ` count-parameterized (`$n` replacing the hardcoded `1`, every caller binding it differently); `update_state`'s wildcard plane-wipe on `$cp` alone removed (moved into `_clear_background_reviews`'s own `$n` count); `_clear_background_reviews` gained a `release_self` parameter and counts markers actually removed for its own plane in the same jq transaction; `_record_background_review`'s cap-eviction accounting credits the evicted marker's own plane, computed before the `.[-5:]` truncation; a new `else` arm on the MCP verdict routing elif-chain releases the request-named plane(s) on an unrecognized response shape; `marker_de`/`edited_at`'s digit guard tightened from `^[0-9]+$` to `^(0\|[1-9][0-9]*)$` to close an octal-arithmetic false negative on leading-zero values; round 23 — the wildcard plane-wipe moves back INTO `update_state`'s own jq transaction via the new `def retire_dispatch_epoch($p; $n)` (`_DISPATCH_EPOCH_RETIRE_DEF`, a separate bash-string piece); `_clear_background_reviews` is retired as a standalone call; both the wildcard wipe and the 5-marker cap eviction dedup `$n` by DISTINCT TASK, not marker row; round 24 — `update_state`'s task-scoped branch and `_consume_background_review` fold their release into the SAME jq transaction as the marker removal (closing the split-transaction/split-lock hazard round 23 left on these two paths); cap-eviction dedup refined to `$evicted_pairs - $retained_pairs`, excluding any evicted pair with a surviving row; a `_settled_doc`/`_settled_code`-flagged unconditional sweep after the MCP verdict routing chain releases whatever the request acquired that no branch settled; `_record_background_review`'s four failure exits gain a compensating `_clear_dispatch_epoch` call |
| `hooks/stop-guard.sh` | #9 arbitration, #10 open-gate note |
| `hooks/post-edit-format.sh` | #9 arbitration, #10 edit-time marker retirement, 4.2.1 edit-time `last_edit_epoch_by_plane` stamp (code plane + both doc-plane branches; the fingerprint-poison writes these replaced are gone); round 21 — all three stamp sites draw from `seq_counter` instead of `EPOCHSECONDS`/wall clock; round 24 — a `_DISPATCH_EPOCH_RETIRE_JQ`/`_DISPATCH_EPOCH_RETIRE_DEF` twin (this file has no shared lib to source); `invalidate_review` now releases `dispatch_count`/`dispatch_epoch` (dedup by distinct task) for every plane whose markers it discards; both doc-edit locked branches release the same way; both doc-edit DEGRADED branches gain the monotonic edit stamp AND the release, matching the locked branches' jq shape |
| `hooks/post-compact-auto-loop.sh`, `user-prompt-review-guard.sh`, `post-skill-auto-loop.sh`, `pre-edit-guard.sh` | #9 arbitration |
| `hooks/session-init.sh` | #10 — `background_reviews` added to the new-session reset; 4.2.1 — `dispatch_epoch` and `last_edit_epoch_by_plane` added, `pending_dispatch` and the `*.pinfail.*` glob-clear removed with Half B (no arbitration block; untouched by #9); round 21 — `dispatch_count` and `seq_counter` added to the reset |
| `hooks/hooks.json` | 4.2.1 — PreToolUse entry for the codex tools (now epoch stamping, not dispatch pinning), `TaskOutput` added to the PostToolUse matcher |
| `test/hooks/plugin-local-arbitration.test.js` | New — #9 |
| `test/hooks/post-tool-review-state.test.js` | #10 + #11 tests, stub `jq` extended |
| `test/hooks/stop-guard.test.js` | #10 tests, stub `jq` extended |
| `test/hooks/post-edit-format.test.js` | #10 edit-time retirement tests, stub `jq` extended; round 24 — 2 new regression tests against REAL jq (the stub does not model `dispatch_count`/`dispatch_epoch`) for P1#1's distinct-task-deduped release and full-retirement-to-zero on `invalidate_review` |
| `test/hooks/session-init.test.js` | #10 session-reset test; 4.2.1 — `dispatch_epoch`/`last_edit_epoch_by_plane` reset test replaces the old `pending_dispatch` one; round 21 — extended to `dispatch_count` and `seq_counter` |
| `test/hooks/background-verdict-recovery.test.js` | New (4.2.1) — the recovery filter and the per-plane edit-vs-dispatch ordering, both under real `jq`; fingerprint-specific cases removed with Half B; round 21 — 4 new regression tests (P1#1 reference counting, P1#2 repeated release, P1#4 injection, the double-marker decrement guard), 42 → 46; round 22 — 5 new regression tests (P1#1-#5, count-parameterized retirement), 46 → 51, plus a new `runLegacyVerdict` test helper for the legacy Bash/Skill verdict path and 3 stale fingerprint-era comments corrected; round 23 — 2 new regression tests (P1#1 transaction fold, P1#2 part 2 cap-eviction dedup refinement), 51 → 53; round 24 — 4 new regression tests (P1#2 atomic transaction, P1#3 cap-eviction straddle dedup, P1#4 dual-plane sweep, P1#5 compensating release via the function-level harness), 53 → 57; P1#1 covered separately in `post-edit-format.test.js` (§ Acceptance Criteria 4.2.5) |
| `test/hooks/jq-filter-fidelity.test.js` | #11 — the extracted normalizer under real `jq`; the `has_payload` guard is invisible to every stubbed suite; round 22 — the `update_state` consume-clause test rewritten to assert the round-22 plane-wipe-moved-to-`_clear_background_reviews` invariant (was still pinning the pre-round-21 wildcard-wipe behavior, caught as a pre-existing failure while adding the round-22 regression tests); dead `fp` fingerprint-era fixture fields removed; round 23 — the same test rewritten again to assert the CURRENT invariant (`update_state`'s own transaction, `_clear_background_reviews` retired) |

## References

- `rules/auto-loop.md` § Enforcement — the fail-closed sidecar #9 rendered unreachable
- `rules/discretion.md` § Anchor Register #3 — why #9 was reviewed at `thorough`
- `docs/features/auto-loop-evolution/4-implementation.md` — hook mechanics
