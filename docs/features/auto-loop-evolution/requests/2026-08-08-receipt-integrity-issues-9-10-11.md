# Three Ways a Review Receipt Went Missing (Issues #9, #10, #11)

> **Created**: 2026-08-08
> **Status**: Candidate Complete
> **Priority**: P0
> **Found by**: Three independent GitHub issue reports against 4.1.0/4.1.1, triaged together
> because all three end at the same symptom: a review that ran, passed, and left no receipt

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
`PostToolUse` event and has no hook firing point anywhere. The verdict exists and is simply
unreachable from the hook's process.

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

Counts are test blocks (`test('#N: …')`), taken from the files as they stand. One exception, so the
numbers below can be reproduced: the `session-init.test.js` regression is named
`test('a new session clears background_reviews …')` without the `#10:` prefix, because it sits in a
suite organised by session lifecycle rather than by issue — grep for `background_reviews` there, not
for the prefix.

| Fix | Evidence |
|-----|----------|
| #9 | 3-way repro (local copy defers to itself; plugin copy defers; control with no `CLAUDE_PROJECT_DIR` works) → **13** tests in `test/hooks/plugin-local-arbitration.test.js`, covering the symlinked, dev-mode, nested-project, stray-copy and unresolvable layouts, plus a structural pin over all seven hooks |
| #10 | **13** in `post-tool-review-state.test.js` (incl. three negative controls, the plan-plane scope, both directions of the request-side predicate, and a foreground verdict retiring its marker on *each* plane), **5** in `stop-guard.test.js`, **5** in `post-edit-format.test.js` (edit-time retirement on both planes, a cross-plane control, and the degraded lock-contention arm on both planes), **1** in `session-init.test.js` |
| #11 | **6** in `post-tool-review-state.test.js` — both planes × both verdicts, text-block arrays, and a negative pairing non-JSON with payload-less JSON — plus **3** in `jq-filter-fidelity.test.js` running the extracted normalizer under real `jq`, which is the only place the `has_payload` guard is observable |

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

## Related Files

| File | Change |
|------|--------|
| `hooks/post-tool-review-state.sh` | #9 arbitration, #10 handoff branch + marker, #11 normalizer |
| `hooks/stop-guard.sh` | #9 arbitration, #10 open-gate note |
| `hooks/post-edit-format.sh` | #9 arbitration, #10 edit-time marker retirement |
| `hooks/post-compact-auto-loop.sh`, `user-prompt-review-guard.sh`, `post-skill-auto-loop.sh`, `pre-edit-guard.sh` | #9 arbitration |
| `hooks/session-init.sh` | #10 — `background_reviews` added to the new-session reset (no arbitration block; untouched by #9) |
| `test/hooks/plugin-local-arbitration.test.js` | New — #9 |
| `test/hooks/post-tool-review-state.test.js` | #10 + #11 tests, stub `jq` extended |
| `test/hooks/stop-guard.test.js` | #10 tests, stub `jq` extended |
| `test/hooks/post-edit-format.test.js` | #10 edit-time retirement tests, stub `jq` extended |
| `test/hooks/session-init.test.js` | #10 session-reset test |
| `test/hooks/jq-filter-fidelity.test.js` | #11 — the extracted normalizer under real `jq`; the `has_payload` guard is invisible to every stubbed suite |

## References

- `rules/auto-loop.md` § Enforcement — the fail-closed sidecar #9 rendered unreachable
- `rules/discretion.md` § Anchor Register #3 — why #9 was reviewed at `thorough`
- `docs/features/auto-loop-evolution/4-implementation.md` — hook mechanics
