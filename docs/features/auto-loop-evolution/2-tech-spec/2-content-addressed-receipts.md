# Tech Spec: Content-Addressed Review Receipts

> **Doc class**: Tech-spec sub-document (numbered from 1 inside `2-tech-spec/`, no lifecycle
> meaning — per `@rules/docs-numbering.md` § Size Limit split shape).
> **Companion ticket**: [`../requests/2026-08-11-content-addressed-receipts.md`](../requests/2026-08-11-content-addressed-receipts.md)
> **Status**: Draft, revised through doc-review rounds 1–14. Round 14: `bound → contested`
> is pinned as a first-class reducer transition (both orders were always asserted; the
> compaction-materialized acknowledgment lands on a born-bound survivor whose twin is gone
> and must stand on its own), and the asymmetric-cutoff test reduces the actual compacted
> record set. Round 13: a derived contest
> survives compaction — before dropping any member of a read-time-derived contest,
> compaction materializes the explicit `contested` acknowledgment for every surviving member
> (write-ahead, fsync'd before the drop), so an asymmetric 48h cutoff can never revive the
> survivor; the pinned transition list gains in-flight → ambiguous (with its `frontier_end`
> payload); the activation-prefix re-hash cost is stated and amortized per lock hold; the
> cross-time content proofs are named per record kind. Round 12: the activation
> barrier gains **activation_prefix_digest** — like the frontier, a byte offset applied
> across time is proven by content, so every use requires both the identity match and the
> recomputed [0, activated_at) digest, else capture-time binding disables; the read-time
> collision predicate is the **general reducer state, never a partial event list** —
> nonterminal ∧ un-owned, so a terminal `ambiguous` D1 with its orphan disposed does not
> contest the next dispatch; a `contested` event matching a read-time-derived contest is
> accepted silently as acknowledgment (the one pinned post-terminal exception). Round 11: an
> **activation barrier** (SessionStart via `hooks/session-init.sh`, or lazy at
> first protocol contact) makes "this call's own entry" decidable — pre-barrier entries are
> never capture-time bound and are quarantined wholesale; the single-in-flight rule became a
> **read-time reducer invariant** so the twin crash prefix (two dispatch lines, no contested
> events yet) folds contested without depending on its own acknowledgments; the dispatch
> blocking duty names **`exit 2`** (the only blocking PreToolUse status — a generic nonzero
> does not block); frontier application requires a recomputed **prefix_digest** match, not
> file identity alone. Round 10: the per-session
> visibility "world probe" is retired for a **per-dispatch decision** the dispatch record
> itself carries — a capture-time bind rides the dispatch line as `bound_tooluse_id` (one
> record, line-atomic), otherwise `frontier_start` (transcript file identity + size) opens a
> claim window closed by `frontier_end` on the terminal event; accounting is brought current
> before any bind, and an
> unaccountable orphan poisons `ambiguous`; frontier records gain contiguity,
> liveness-based retention and write-ahead ordering, with the exclusion set = dispositions ∪
> frontier coverage; **fsync is durability, never atomicity** — the indivisible records are
> single JSONL lines and every multi-line sequence is prefix-safe; tombstones have exactly
> one shape, `{id, pairs:[{plane, digest},…]}`. Round 9: expiry-drop safety argued by
> accounting, never clocks; the reducer's in-flight definition adds **un-owned** so a
> task-owned dispatch coexists with a fresh foreground one. Rounds 1–8 history: content
> addressing → correlation → transcript pairing → call-level dispatches + contested
> concurrency + WB2b ecosystem-orchestrator correction → eager binding, event-sourced
> lifecycle, crash-atomic settlements with per-plane recognition
> (`post-tool-review-state.sh:3818–3903`, `:4022–4028`) → universal disposition; no-verdict
> as attempt record (spends identity, never evidence); pinned reducer table. Decisions
> marked ⚖️ are settled; ❓ are open.

## 1. Requirement Summary

**Problem.** Gate state is maintained as an event-driven mirror: every Edit/Write must be observed,
classified, locked, and written into `.claude_review_state.json`; every verdict must be parsed out
of tool stdout. Every unobservable event is a silent desync. Evidence (2026-08-11, one session,
all gates genuinely passed): a >30KB precommit output truncated by the harness lost its verdict; a
hand-composed reply prompt without the provenance phrase lost five verdicts; a `.md` written
*outside the repo* re-opened the doc gate (`post-edit-format.sh:1463`, extension-only match); a
backgrounded precommit had no recovery path at all. The machinery answering for this —
epochs, sidecars, background markers, lock-contention branches — is ~6,000 lines across three
hooks and still leaks.

**Goal.** Derive gate state at check time from **content**, not maintain it through events. Two
separately-defined questions (round-1 finding 3):

> **Obligation** — is this gate *owed*? A plane owes its gate iff its dirty set is non-empty
> (§ 3.5). A clean checkout owes nothing.
> **Validity** — is the owed gate *closed*? Iff a producer-emitted passing **verdict** record
> exists for the plane's **current** digest, not superseded by a newer verdict for that same
> digest, and no unresolved tombstone stands against that pair (§ 3.5, § 4).

**Constraints (user-set).** The receipt log adds **zero new** repository-local artifacts: it lives
outside the repo directory in a per-repo local cache, and needs no `.gitignore` entry. (The
pre-existing runtime artifacts — `.claude_review_state.json`, `.claude_nit_history.json`, the
`.claude/cache/` precommit/XDG data — are explicitly **not** relocated by this ticket; that is the
❓ Q5 follow-up. Documents like this spec follow the normal `docs/features/` flow.) Anchor Register
#5–#7 untouched: gate *recording* changes, gate *obligations* do not — § 3.5 preserves today's
obligation behaviour, including dual-mode aggregate enforcement (§ 3.4). Round/stall progress
ledger is out of scope (it tracks convergence, not gate state).

## 2. Existing Code Analysis

| Component | Today | Relevant fact |
|-----------|-------|---------------|
| `.claude_review_state.json` (repo root, gitignored) | Mutable mirror: `has_code_change`, `has_doc_change`, per-gate `{executed,passed,last_run}`, epochs, `background_reviews`, sidecars | `post-tool-review-state.sh:64`, `stop-guard.sh:141` — a runtime artifact living in the repo root, held out of git only by ignore entries |
| `hooks/post-edit-format.sh` | PostToolUse on Edit/Write: classifies plane by extension, locks, invalidates receipts, stamps edit epochs | `:1463` doc branch has no repo-containment check — the incident class this design deletes |
| `hooks/post-tool-review-state.sh` | Parses Bash stdout (whole-command anchored) and MCP output (provenance phrase + anchored header + sentinel) into receipt mutations | Consumer-side stdout parsing is the truncation-fragile channel |
| `hooks/stop-guard.sh` | Reads the mirror; corrupt-shape checks; sidecar fail-closed logic; transcript fallback; releases obligations when git proves the tree clean (`:519–526`); dual mode forces strict and lets `aggregate_gate` override the individual code verdict (`:691–721`); honours `PRECOMMIT_REQUIRE_FULL=1` by rejecting non-`full` modes (`:1125–1137`) | The obligation, aggregate and mode behaviours § 3.4–3.5 must preserve |
| `scripts/precommit-runner.js` | Computes `overallPass` at `:297–301`, prints `## Overall:` at `:394`; persists `summary.json`/`summary.md` that no hook consumes as receipts | Producer already knows the verdict; it just doesn't record it anywhere a checker reads |
| `.claude/cache/precommit/<slug>/<HEAD>/` | Existing per-repo slug **format** `basename--8hex`; the hash input is the remote URL with `repoRoot` fallback (`precommit-runner.js:107–110`) | § 3.3 reuses the visible format but defines its own hash input — stated there to avoid conflation |

## 3. Technical Solution

### 3.1 Architecture

```mermaid
sequenceDiagram
    participant P as Producer (runner / review dispatch)
    participant L as Verdict log (per-repo local cache, outside the repo dir)
    participant S as stop-guard (check time)
    participant G as git (content oracle)

    alt review producer
        P->>G: digest at dispatch
        P->>L: append {kind:"dispatch", key, planes:{…}, …} (locked single-line append)
        P->>G: revalidate digest at completion — endpoints must match
        P->>L: append {kind:"settlement", dispatch_id, completion_id, plane_results} via transcript pairing (§ 3.4)
    else runner (no dispatch record)
        P->>G: validation baseline after lint:fix
        P->>G: recompute at overallPass — PASS requires equality; FAIL is exempt
        P->>L: append {kind:"verdict", plane:"precommit", digest, mode, …}
    end
    Note over P,L: edits are NEVER observed — no hook runs at edit time for gate state
    S->>L: final pairing sweep — may APPEND bind/disposition/settlement records (§ 3.4)
    S->>G: recompute plane digests + dirty sets now
    S->>L: newest verdict-bearing record for (plane, current digest) + tombstone check
    S->>S: owed? (dirty set) → valid? (pass ∧ mode_ok ∧ no unresolved tombstone) → closed / open
```

Producers write and the checker derives, with one deliberate overlap (round-7): stop-guard's
**final pairing sweep runs before derivation and may itself append bind events,
`tooluse_disposition` records, and settlements** — universal disposition (§ 3.4) makes the sweep a
writer of all three: pairing a completion appends its bind and settlement, and accounting for a
same-key entry that will never bind appends its quarantine disposition. At check time it is a
producer for completions that landed after their own sweep, under the same lock and write-failure
duties as any producer. Zero **edit-event** observation for gate
invalidation — the dispatch/result/recovery hook sites of § 3.4 remain; what is gone is observing
Edit/Write to maintain gate state. An edit invalidates implicitly (the digest drifts); a late
verdict validates implicitly (its **dispatch-time** digest still matches); an out-of-repo write is
invisible by construction (git never reports it).

### 3.2 Plane digest — ⚖️ content of the plane, not the delta

**Decision: digest the plane's full content state (index overlaid with working-tree changes), not
the dirty-file delta.** The delta form (`hash of files differing from HEAD`) breaks on `git commit`:
the dirty set empties, the digest changes, and every verdict for an unchanged tree is spuriously
invalidated — re-introducing a desync class. Content form survives commits: committing moves HEAD
to *equal* the content; the content itself — and therefore the digest — is unchanged.

```
plane_digest(plane):
  entries = git ls-files -s                                  # index: mode + blob OID + path
          overlay (from git status --porcelain=v1 -z --untracked-files=all):
            tracked file with working-tree modification:
              blob OID := git hash-object <file>             # compute-only, no -w, no odb write
              mode     := effective working-tree mode        # executable bit read from the fs,
                                                             # NOT the stale index mode
            untracked in-repo file (enumerated per file — never a collapsed dir/ entry):
              add (mode, hash-object OID, path)
            deleted file: drop
  filter entries by plane classifier
  digest = sha256( sorted "mode SP oid SP path\0" records — raw path bytes, NUL-delimited )
```

- **Enumeration is explicit** (round-1 finding 4): `--untracked-files=all` is required — the
  porcelain default collapses an untracked directory into one `dir/` entry, silently omitting
  nested files. Paths are kept as **raw bytes** end to end (`-z` NUL delimiting, no locale
  re-encoding), and the **effective mode** of an unstaged entry comes from the filesystem, so an
  unstaged `chmod +x` changes the digest.
- **Fail-closed enumeration**: symlinks hash as git blobs of the link target string (git's own
  semantics). Gitlinks/submodules are **content-sensitive, never index-frozen** (round-2 finding):
  a clean submodule checked out at the index OID contributes that OID; one checked out at a
  *different* commit overlays its current `HEAD` OID (content-correct — the superproject status
  reports the path dirty either way, so the plane is owed); one with uncommitted internal
  changes, or uninitialized or unreadable, has no OID that names its content and marks the digest
  `partial`. A merge conflict, an unreadable file, or any git command failure likewise marks the
  digest `partial` — a `partial` digest **never matches anything**, so the gate stays open rather
  than silently passing.
- **Plane classifier** (matches today's conservative rule): doc = `\.(md|mdx)$`; code = everything
  else. Comment-only and config edits stay code, unchanged.
- **Containment is free**: inputs come from git, which only reports in-repo paths. The
  `post-edit-format.sh:1463` incident class cannot exist.
- **Gitignored files are excluded** — consistent with today's git-status-derived review target
  sets; runtime artifacts never perturb the digests (doubly so from outside the repo dir, § 3.3).
- **Cost** (round-1 🟡): the honest bound is one full-index enumeration + sort per derivation, plus
  `hash-object` for dirty/untracked files only. Both plane digests and both dirty sets come out of
  **one** index pass, and one stop invocation computes them **once** — `precommit` reuses the
  code-plane digest, never a second derivation. Current tree (~90 dirty files) ≈ tens of ms; a
  repo with hundreds of thousands of tracked paths pays the enumeration+sort and is the documented
  bound, with the huge-file cap in § 4. Producer-side derivations added by correlation and
  revalidation — dispatch + completion for a review, baseline + final for the runner — are each
  one more index pass of the same bound, paid per gate run, not per stop.

### 3.3 Verdict record — ⚖️ JSONL in a per-repo cache outside the repo directory

```json
{"v":1,"kind":"verdict","plane":"precommit","digest":"sha256:…","verdict":"pass","mode":"full",
 "head":"a57d96d","time":"2026-08-11T05:36:16Z","producer":"precommit-runner"}
```

The log is **mixed-kind** — `dispatch`, `dispatch_event`, `tooluse_disposition`, `frontier`,
`activation`, `settlement`, `verdict` (runner rows), and (in the fallback file) `tombstone`
records share the
schema's envelope, and every rule below is kind-aware: selection and supersession read
**verdict-bearing records only** (runner rows and settlement `plane_results` projections —
§ 3.4); dispatch records, their events, dispositions, frontier and activation records live
under § 3.4's lifecycle; tombstones under § 4's resolution protocol.

- **Location** `${XDG_CACHE_HOME:-$HOME/.cache}/sd0x-dev-flow/receipts/<repo-slug>/verdicts.jsonl`.
  `<repo-slug>` reuses the precommit cache's visible **format** (`basename--8hex`) but ⚖️ defines
  its own hash input: the repo root's `realpath`. (The existing runner slug hashes the remote URL
  with `repoRoot` fallback — `precommit-runner.js:107–110`; keying receipts by remote would merge
  two checkouts of one remote, which is exactly wrong for working-tree digests.) Only an
  **absolute** `XDG_CACHE_HOME` is honoured — the XDG spec requires it, and a relative value
  (e.g. `.claude/cache`) would resolve back inside the repo; relative or empty falls back to
  `$HOME/.cache`, and the resolved path is verified to lie outside the repo root before first
  use. The receipt log adds zero new repository-local artifacts and survives reboots. ⚖️ Rejected `.claude/cache/`
  (inside the repo directory); rejected `$TMPDIR` (a verdict keyed to an unchanged tree should
  survive a reboot — losing one costs a 7-minute suite re-run for nothing).
- **Selection semantics** (round-1 finding 6) — ⚖️ existence keyed to the current digest, with
  same-digest supersession: the record consulted is the **newest verdict-bearing record for
  `(plane, current_digest)`** — a runner `kind == "verdict"` row or a settlement's
  `plane_results[plane]` verdict projection (§ 3.4); `"no-verdict"` entries, dispatch/event and
  tombstone records never participate in selection. A
  later verdict for a *different* digest is irrelevant — the tree it described is not this tree,
  so a pass for digest `A` still closes the gate when the tree returns to `A`. A later verdict
  for the **same** digest supersedes: pass-then-fail on identical content means the newer run's
  verdict governs. The § 1 invariant is worded to exactly this.
- **Append discipline** (round-1 🟡): appends and compaction both take the repo's existing
  **portable `mkdir` ownership-aware lock** protocol (`post-tool-review-state.sh:230` — stock
  macOS ships no `flock`, and this design adds no native-lock dependency; the lock dir sits
  beside the file it guards). `O_APPEND` alone is not an atomicity guarantee for regular files,
  and an uncoordinated SessionStart compaction could replace the file under a concurrent
  appender's inode. A torn tail is expected, not exceptional (round-8): a reader ignores an
  unterminated final line; a writer, under the lock, truncates the torn tail before appending —
  so a partial settlement is never visible as data and never blocks the log. Every load-bearing
  kind — dispatches, lifecycle events (contested/bound/owned/expired/ambiguous), tooluse
  dispositions, frontier records, activation records, settlements, tombstones — is fsync'd before its
  lock is released and before any cursor advance (round-9: losing a quarantine or contested
  event after the cursor moved would re-admit an excluded tooluse_id on recovery — correlation
  evidence is not history). **fsync buys durability, never atomicity** (round-10): a crash can
  persist any prefix of the lines appended under one lock hold, so the protocol never relies
  on multi-line all-or-nothing. Whatever must be indivisible IS one line — the dispatch with
  its capture-time bind (`bound_tooluse_id`, § 3.4), the single settlement, the batch
  tombstone (§ 4) — and every multi-line sequence is ordered so each legal prefix is safe on
  its own: dispatch before its events, the frontier line before any disposition it retires,
  and a recovered prefix at worst leaves a dispatch unbound or a disposition duplicated —
  states the reducer already treats as retry-safe or idempotent, never as evidence. Compaction
  rewrites go through a temp file in the same directory: write, fsync the file, atomic rename
  over the log, fsync the directory — a crash leaves either the old file or the new one,
  whole. Only explicitly diagnostic records (superseded verdict history)
  accept the OS flush window, where a loss costs archaeology, nothing else. Compaction is **kind-aware** — one newest-per-pair rule cannot
  govern a mixed log: **verdicts** keep the newest per `(plane, digest)` ("newest" = append order under
  the lock, never wall-clock time — `post-tool-review-state.sh:2783` documents why wall clocks
  cannot order events); **dispatch** records and their lifecycle events are kept while
  in-window — identity is bound by id (§ 3.4), so retention is governed by the 48h window,
  never by positional counting — retired by `expired` events and dropped only past the window,
  and **never asymmetrically out of a derived contest** (round-13: a read-time contest is
  derived from the *relative position* of two base records, so dropping one member's record
  while the other survives would erase the evidence and revive the survivor): before dropping
  any dispatch record that participates in a read-time-derived contest with a surviving
  member, compaction **materializes the explicit `contested` acknowledgment for every
  surviving member** — appended and fsync'd BEFORE the drop, the same write-ahead shape as
  the frontier-before-disposition rule — so the contest outlives the eviction of its
  evidence and no record drop can change any survivor's fold; **tombstones** are pruned only when resolved (§ 4). **Load-bearing
  records are never trimmed by the diagnostic cap** (round-5): the newest verdict per pair,
  in-window dispatch records with their lifecycle events, and in-window settlement records
  (settlements are the **spent-identity ledger** — replay protection must survive compaction,
  including a concurrent session's SessionStart), plus unresolved tombstones and their
  resolutions. The N=200
  cap budgets **diagnostic history only** (superseded verdicts beyond the newest); when
  load-bearing records alone exceed it, the file grows — the cap yields, correctness does not.
  Each load-bearing kind is bounded or deliberately not (round-6/7): dispatches, their events
  and dispositions age out at 48h; **frontier and activation records are exempt from the 48h rule** — their
  retention is liveness-based (§ 3.4: kept while any file with their transcript_file_id
  remains scannable, dropped only once none exists), because they are precisely what makes
  dropping the aged dispositions safe and the capture-time bind decidable; newest-per-pair verdicts keep the **most recently touched
  50 pairs per plane** (LRU by append order) — evicting an older pair costs at most one
  re-review if that exact tree ever returns, an availability trade, never a correctness one,
  since a missing verdict fails closed; a **settlement outlives the 48h window whenever any of
  its plane projections is an LRU-retained newest verdict** — the record is kept whole, its
  completion_id spent for as long as it exists, so verdict retention and replay protection
  expire together, never separately (round-8); **unresolved tombstones are intentionally unbounded** —
  resolution prunes them, but a failure set that never resolves is retained forever because
  fail-closed is worth more than a cap: the set is expected ~empty, its growth is itself the
  loud signal, and the remedy is reading and resolving it, never trimming it.
- `planes`: `code_review`, `doc_review`, `precommit` (precommit records carry `mode`, enum
  `full|fast`, validated on read — an unknown mode is an invalid record). The digest for
  `precommit` is the **code-plane digest** — precommit gates the code plane.
- **Trust root note**: cooperative threat model, unchanged. Records are **producer-emitted**, not
  cryptographically signed (round-1 🟡): any process running as the user can forge one, exactly as
  it can forge today's state file. The property this design preserves is *resistance to accidental
  minting* — prose, `cat`, or truncated stdout never parse into a record: **precommit** sheds its
  output-parsing dependence in two steps (runner append now; Bash + Skill parsing retire once
  WB2b's ecosystem orchestration lands — § 3.4), and the output-parsing path that remains
  end-state — MCP review recognition (§ 3.4) — is a guarded receipt producer whose recognition
  rules (provenance phrase + anchored header + sentinel) are unchanged; only producer code paths
  append.

### 3.4 Producers

| Producer | Integration | Replaces |
|----------|-------------|----------|
| `precommit-runner.js` | At `overallPass` computation (`:297–301`): compute code-plane digest, append record. Stdout untouched. WB2b extends it into the multi-ecosystem orchestrator (below) | The whole-command anchored Bash regex, the 30KB fragility, the backgrounding hole; after WB2b, also the Skill-route verdict parsing (`post-tool-review-state.sh:3818–3903`) |
| MCP review path | **Digest at dispatch, verdict bound to it** — see below | Receipt mutation + `background_reviews` markers (dispatch-record replaces them, same purpose, simpler shape) |
| `aggregate_gate` (`emit-review-gate.sh`) | ⚖️ **Unchanged in this ticket** (round-1 finding 1): dual mode keeps its current mirror path wholesale — `stop-guard.sh:691–721` still forces strict and lets the aggregate verdict override the individual code result. Folding it into the log is deferred with plan-review (❓ Q1), and until then stop-guard's dual-mode branch reads what it reads today | Nothing yet |

**Dispatch-time digest binding** (round-1 finding 2; correlation state machine hardened rounds
2–3). A review verdict must be bound to the content state it was dispatched against — never to
whatever tree exists when the result arrives. The hook payload carries no `tool_use_id`
(`post-tool-review-state.sh:2791`), and `sha256(TOOL_INPUT)` proves **request equivalence, never
dispatch identity** — the receipt-integrity record already establishes exactly this
(`../requests/2026-08-08-receipt-integrity-issues-9-10-11.md:417`). So the correlation state is
richer than a key: dispatch records are **session-scoped instances**, and completions are
**identities consumed at most once**:

```
dispatch record   {kind:"dispatch", dispatch_id, key, planes:{<plane>:<digest>,…}, session_id,
                   seq, time, transcript_file_id, frontier_start, bound_tooluse_id?}
                  — transcript_file_id + frontier_start: the transcript's file identity and
                  byte size, captured under the receipt lock at PreToolUse — every dispatch
                  records its claim window's causal start. File identity = device + inode +
                  a hash of the transcript's first line — which makes accidental aliasing
                  unlikely, never impossible (round-11: inode reuse plus an identical first
                  line can still collide), so identity is a fast path only; every
                  cross-time application carries its own content proof — the frontier's
                  `prefix_digest` (§ rescan safety below) and the activation barrier's
                  `activation_prefix_digest` (§ visibility below), one per offset-bearing
                  record kind. bound_tooluse_id: present iff the call's own entry was
                  already visible at capture (§ visibility below) — the bind then rides the
                  dispatch line itself: one record, crash-atomic by line-atomicity, no
                  separate `bound` event to lose.
                  — **immutable and call-level, one per tool call** (round-6: one review
                  request may open both planes at once — post-tool-review-state.sh:3585–3588 —
                  so per-plane records would break 1:1 transcript alignment; the planes map
                  carries each plane's dispatch digest). dispatch_id = (session_id, seq),
                  stable and never reused.
                  key = sha256(canonical TOOL_INPUT) — canonical means UTF-8, recursively
                  sorted keys, no insignificant whitespace (jq -cS): hooks receive tool_input
                  re-serialized, never raw payload bytes (post-tool-review-state.sh:430), so
                  the encoding is pinned by spec, not by whichever jq printed it

lifecycle events  the log is append-only, so a dispatch's state is **never edited in place**
                  (round-7 — the earlier mutable-looking `status`/`consumed_by` fields are
                  superseded): every transition is its own single-line record
                  {kind:"dispatch_event", dispatch_id, event, …} with
                  event ∈ contested | owned (carries task_id) | bound (carries tooluse_id) |
                  ambiguous (round-9/10 — the orphan poison: an unaccountable same-key entry
                  below the capture point; terminal, never binds, completions refused) |
                  expired. A terminal event on a never-bound dispatch carries
                  **frontier_end** — the transcript size at its own append — closing that
                  dispatch's claim window so no later entry is ever attributed to it
                  (round-10). Plus the settlement record below as the consuming terminal. A
                  dispatch's state is the FOLD of its events in append order, and **contested
                  has absolute precedence**: once contested, any later owned/bound/settlement
                  for that dispatch_id is refused at read time and reported. Ownership is its
                  own event and its own field — a task_id on an `owned` event is never a
                  completion identity and spends nothing.
                  Reducer rules, pinned (round-8): valid transitions are in-flight → bound →
                  settled, **in-flight → contested and bound → contested** (round-14: both
                  orders were always asserted below — "bound-then-contested and
                  contested-then-bound reduce identically" — and a compaction-materialized
                  acknowledgment lands on a born-bound survivor whose derivation evidence
                  is gone, so `bound → contested` must be a first-class transition, not an
                  exception: after compaction that acknowledgment is an ORDINARY
                  bound → contested event, authoritative on its own, never dependent on
                  re-proving the removed twin), in-flight/bound → expired, in-flight →
                  ambiguous (round-13 — the event carries `frontier_end`, closing the
                  dispatch's claim window; refused on a bound dispatch), and bound →
                  owned → settled; a dispatch whose line carries `bound_tooluse_id`
                  (round-10 capture-time bind) is **born in the bound state** — a later
                  `bound` event for it is refused as conflicting unless payload-identical;
                  the single-in-flight rule is ALSO a **read-time invariant** (round-11 —
                  contested must never depend on its own acknowledgment events surviving a
                  crash: the legal prefix "D1's line, D2's line, crash before either
                  contested event" would otherwise fold to two live dispatches): whenever
                  D2's base line was appended while same-key D1 was still in-flight per the
                  collision predicate — D1 was **nonterminal and un-owned** at D2's line,
                  i.e. no settlement, `expired`, `contested`, `ambiguous`,
                  unknown-event-poison, or `owned` record for D1 sits earlier in the log
                  than D2's line, decidable from append order alone (round-12: the
                  predicate is the general reducer state, never a partial event list — a
                  D1 already terminal `ambiguous` with its orphan disposed does NOT
                  contest D2, which is exactly the "next same-key dispatch starts clean"
                  promise) — the fold reduces BOTH to contested, permanently,
                  whether or not the explicit contested events were ever written; the next
                  sweep still appends those events as durable acknowledgment, idempotent
                  with the read-time rule; "in-flight" for the next PreToolUse's single-in-flight
                  check means **nonterminal ∧ un-owned** — un-contested ∧ un-settled ∧
                  un-expired ∧ un-ambiguous ∧ not poisoned by an unknown event ∧ un-owned
                  (round-9/12:
                  a task-owned dispatch is already bound and only its own task's completion
                  can settle it, so a foreground same-key call coexists instead of
                  contesting — this is the § 3.4 background-coexistence contract, stated
                  here so the collision predicate and the prose cannot diverge). A
                  duplicate event is idempotent iff payload-identical; conflicting
                  duplicates (two `bound` with different tooluse_ids, two `owned` with
                  different task_ids) fail closed — the dispatch reduces to contested and is
                  reported. An event after a terminal (settlement, expired, contested,
                  ambiguous) is
                  refused at read time and reported — with ONE pinned exception (round-12):
                  a `contested` event that matches a read-time-derived contest is accepted
                  silently as its durable acknowledgment, never reported as a violation;
                  every other post-terminal event still refuses. An event whose dispatch_id
                  has no base
                  record is ignored and reported; an unknown event kind poisons its dispatch
                  fail-closed. contested wins in BOTH orders — bound-then-contested and
                  contested-then-bound reduce identically. Candidate selection and state
                  checks re-run under the receipt lock after transcript scanning, and
                  compaction preserves fold-equivalence: reducing the compacted log yields
                  the same states as the full log

matching          a result matches only within its OWN session_id, by exact key — and the key
                  proves request EQUIVALENCE only; identity comes from transcript order below

single in-flight rule (round-6 — the permutation guard): at most ONE in-flight dispatch per
                  (session, key). A PreToolUse that finds one already in-flight marks BOTH
                  records **contested** — contested dispatches never settle (every completion
                  pairing them is refused, loudly) and clear only by expiry. Concurrent
                  byte-identical calls are the one case where transcript block order cannot be
                  proven to match lock-acquisition order (parallel PreToolUse hooks race for
                  the mkdir lock independently of how the assistant turn ordered its tool-use
                  blocks — equal counts do not prove equal order), so they are refused outright
                  rather than aligned. Order alignment below therefore only ever reads
                  *settled* history, where order is guaranteed: a later same-key call's
                  PreToolUse fires only after the earlier call's transcript entry exists

single verdict-writing path — transcript pairing (round-5: the PostToolUse payload carries no
identity, so NO verdict is ever written from a payload alone; a foreground PostToolUse is
merely the TRIGGER for an immediate pairing sweep, and background completion is recovered by
the same sweep on later hook events):
  the session transcript stores every tool call with a genuine per-call tool-use id, in call
  order. Pairing has two phases (round-7: absolute k-th counting broke the moment any record
  aged out of the log — **position is only ever a bootstrap; identity is the durable form**):

  visibility        (round-9/10: transcript publication and dispatch append are separate
                    operations, so pairing needs a CAUSAL boundary, not an order heuristic.
                    Round-10 retires the per-session "world probe" — no probe event, no
                    persisted world record, no cross-process memory, and no inference from
                    whether *some* same-key entry happens to exist: whether THIS call's
                    entry was visible at PreToolUse time is decided per dispatch, under the
                    receipt lock, from observations the dispatch record itself carries, so
                    the decision is durable, deterministic, and replayable by any process):
                    · activation barrier (round-11 — what makes "this call's own entry"
                      DECIDABLE, not inferred): the protocol's first act for a session is
                      appending {kind:"activation", session_id, transcript_file_id,
                      activated_at:<transcript byte size at append>,
                      activation_prefix_digest:<sha256 of transcript bytes
                      [0, activated_at)>} — written at
                      SessionStart (`hooks/session-init.sh`, before any tool call exists,
                      so every real entry of the session postdates it), or **lazily at
                      first protocol contact** when the session predates the writer's
                      deployment. Like the frontier (round-12), the barrier is a byte
                      offset applied across time, so its application is proven by
                      content, never by identity alone: every use requires **both** the
                      file identity match **and** the recomputed digest of
                      [0, activated_at) to equal activation_prefix_digest — either
                      mismatch (truncate-in-place, inode reuse with an identical first
                      line, a rebuilt prefix) disables capture-time binding entirely and
                      falls to the conservative frontier-only / quarantine path. Cost,
                      stated not hidden (round-13): the verification re-hashes
                      [0, activated_at) — bytes-small for a SessionStart barrier (the
                      transcript holds only its header), but O(activated_at) for a
                      lazily-activated long session, potentially tens of MB. Accepted as a
                      transitional cost scoped to the rollout boundary, and amortized: the
                      producer verifies at most once per lock hold, and the in-process
                      result is never shared across processes (no trust crosses the lock). Everything below activated_at is pre-barrier: never
                      claimable as any call's own entry, quarantined wholesale by the
                      first sweep ("first sweep" is thereby defined — quarantine every
                      same-key undisposed entry ending ≤ activated_at). A lazily-activated
                      session may quarantine its own in-flight calls' entries — their
                      completions refuse, one wasted review at the rollout boundary,
                      fail-closed. No readable activation record → **no capture-time bind
                      at all** (frontier-only binding, which claims nothing below
                      frontier_start) — the protocol degrades, never guesses
                    · precondition — accounting current, then decide: before binding
                      anything, the producer resolves every TERMINAL same-key dispatch's
                      claim window — [its frontier_start, its frontier_end) — quarantining
                      the unclaimed candidate inside it, if any. A pending same-key dispatch
                      means contested (single in-flight rule); accounting that cannot be
                      brought current under the lock appends nothing and poisons the new
                      dispatch `ambiguous` — fail-closed, never a guess
                    · entry visible at capture: after the precondition, a same-key
                      undisposed entry in **[activated_at, frontier_start)** that no
                      window claims can only be this call's own — every dispatch-less
                      orphan is structurally excluded: pre-barrier entries by activated_at,
                      in-barrier entries because a call in this session cannot run
                      unrecorded (the exit-2 duty below), and a newer concurrent same-key
                      call is contested. The dispatch line carries `bound_tooluse_id`, so
                      bind and dispatch are ONE record and no crash can separate them. The
                      newest same-key undisposed entry is **reserved** while a live window
                      could claim it: quarantine never touches it until its claiming
                      dispatch reaches a terminal state
                    · entry not visible at capture: the dispatch records only
                      `frontier_start`; binding claims the FIRST same-key entry at offset
                      ≥ frontier_start via a later `bound` event — exactly one is expected
                      (single in-flight), a second in-window candidate → refuse and report.
                      A same-key undisposed entry in [activated_at, frontier_start) that
                      survives the precondition yet cannot be this call's own (this branch
                      already observed the entry was NOT visible at capture) poisons the
                      dispatch `ambiguous`: it never binds, its completions are refused,
                      the orphan is then quarantined unaccounted, and the next same-key
                      dispatch starts clean — one wasted review, loud, safe — never a
                      guessed bind
                    · why no in-barrier orphan exists: a PreToolUse that cannot durably
                      append its dispatch record **blocks the tool call with `exit 2`** —
                      the one PreToolUse status the hook contract treats as blocking; a
                      generic nonzero is a *non-blocking* error (this repo's own contract
                      notes: `hooks/stop-guard.sh:486`; the existing blocking guard
                      `hooks/pre-edit-guard.sh:91` uses exactly `exit 2`) and would let
                      the call run unrecorded, so the duty names the exact status and § 6
                      tests assert the tool body did not run, not merely that the hook
                      exited nonzero. Pairing is session-scoped, so no other session's
                      entries enter this window. The residual — an entry whose dispatch
                      was fsync'd but whose session crashed before any sweep — dies with
                      its session: a dead session's transcript is never scanned again,
                      and its pending dispatches retire by expiry
  disposition (universal — round-8/9: EVERY entry ends with a durable disposition; a
                    candidate set that only remembers successes re-admits its failures after
                    a cursor loss)
                    an un-contested dispatch's entry → a `bound` event carrying the
                    tooluse_id — from that record on the pair is identified BY ID, never by
                    position; a CONTESTED dispatch → a quarantine record
                    {kind:"tooluse_disposition", session_id, key, tooluse_id,
                    reason:"contested"} — terminal, its completion refused by name
                    (assignment within a contested set is arbitrary and harmless — every
                    member refuses identically); an entry that no live claim window can
                    claim and no reservation protects (a pre-migration call, an orphan
                    resolved by the ambiguity protocol above, a terminal window's unclaimed
                    candidate, a record already dropped by age) → quarantined "unaccounted",
                    never bound. Quarantine is never issued while an in-flight same-key
                    dispatch's window could still claim the entry
  rescan safety     candidate isolation lives in the disposition records, never in the
                    cursor: a full rescan reconstructs exactly the same excluded set by
                    reading them back — the exclusion set is the **union** of live
                    disposition records and frontier coverage. Compaction folds aged
                    dispositions into one monotonically-advancing **frontier record** per
                    (session, key) — {kind:"frontier", session_id, key, transcript_file_id,
                    upto_end:<offset>, prefix_digest}: "every same-key entry whose end
                    offset is ≤ upto_end in THIS transcript file is terminally disposed".
                    prefix_digest = sha256 of the transcript bytes [0, upto_end), computed
                    when the frontier is written (compaction holds the lock and reads the
                    transcript; round-11 — file identity alone cannot rule out a rebuilt
                    file reusing inode and first line, so byte-range application is proven
                    by content, exactly as gate validity is). Three rules make it
                    sound (round-10): it advances only over a **contiguous prefix** in which
                    every same-key entry is terminally disposed — never past an undisposed
                    entry; it applies only when **both** the observed transcript's file
                    identity matches its transcript_file_id **and** the recomputed digest
                    of bytes [0, upto_end) equals prefix_digest — either mismatch makes the
                    frontier inapplicable, and the rescan falls back to dispositions alone,
                    quarantining whatever nothing accounts for (fail-closed: an unaccounted
                    entry is never bound, so a stale frontier can only over-quarantine,
                    never re-admit); and its retention is **liveness-based, never the 48h
                    age rule** — it is kept while any file with its transcript_file_id
                    remains scannable and droppable only once none exists (round-9: aging
                    dispositions out with their dispatches would have re-opened the very
                    hole they close). Write-ahead order, pinned in § 3.3: the frontier line
                    is appended and fsync'd BEFORE any disposition it covers is dropped —
                    a crash between the two leaves both, redundant and consistent, never a
                    gap.
                    Transcript wall-clock timestamps are never used for any pairing or
                    expiry decision (no clock is shared with the log, and per
                    post-tool-review-state.sh:2783 wall clocks cannot order events anyway):
                    all ages are measured on log-side records stamped by the writing hook
                    and ordered by seq; a malformed or future time fails closed to "expired
                    for pairing, retained for exclusion"; the 48h boundary is exclusive —
                    at exactly 48h a record is already expired
  completion identity = the transcript tool-use id, domain-prefixed ("tooluse:<id>"), or
                        "task:<task_id>" for a background task's report
  settle            a completion whose id matches a bound (or task-owned), un-contested,
                    un-expired dispatch with an un-spent identity → append ONE settlement
                    record: {kind:"settlement", dispatch_id, completion_id,
                    plane_results:{<plane>: {verdict, digest:<dispatch digest>} |
                    "no-verdict", …}} — a single independently-valid JSONL line (round-7:
                    several rows under one lock is not crash-atomic; the earlier "one verdict
                    row per plane" is superseded). Per-plane review verdicts are PROJECTIONS
                    of settlement records — § 3.3/§ 3.5 selection reads runner verdict rows
                    and settlement plane_results alike. Crash before the line: nothing is
                    spent and the retry is safe; after it: everything is settled — no partial
                    state can exist
  plane recognition a plane's entry carries a verdict ONLY when that plane's own request-side
                    and output-side recognition both succeed — the per-namespace rules are
                    unchanged, including the refusal of an output claiming both namespaces
                    (post-tool-review-state.sh:4022–4028 today): a dual-namespace output
                    settles EVERY plane as "no-verdict" (identity spent, loud); a dual-plane
                    dispatch whose output is recognized as exactly one namespace settles that
                    plane's verdict and the other plane as "no-verdict". Nothing is ever
                    copied across planes — a sentinel absent for a plane can never mint that
                    plane's receipt
  either record contested                 → refuse the completion, loudly — never bind, never
                                            settle (contested precedence is absolute)
  identity genuine but no valid review sentinel for ANY plane
                                          → settlement with all planes "no-verdict": the
                                            identity is spent, nothing new lands, no
                                            endless re-sweep, no later mis-binding. A
                                            "no-verdict" is an ATTEMPT record, never
                                            evidence about the tree (round-8): it does not
                                            participate in selection, so the gate reads
                                            whatever real evidence remains — open when this
                                            digest has no verdict, and **still closed when
                                            an earlier same-digest PASS stands**: a failed
                                            recognition says nothing about the content,
                                            and a reviewer who found problems emits a
                                            FAIL, which does supersede
  transcript unreadable, or a bind/settle precondition fails
                                          → append NOTHING, loudly — fail-closed
  an expired dispatch that WAS bound is refused BY NAME (its tooluse_id names it); one that
  never got bound leaves its entry to the disposition rules — quarantined "unaccounted" once
  no live window can claim it — so its completion is refused by exclusion, never by a clock;
  on neither path can a late result fall through to a newer same-key dispatch

sweep sites & cost  a foreground PostToolUse triggers an immediate sweep; later hook events
                  retry; **stop-guard runs a final sweep before deriving gates** — which makes
                  stop-guard a WRITER of bind events, tooluse dispositions and settlements
                  at check time, not a pure
                  reader (§ 3.1 shows it; the ticket's stop-guard row names it) — so a
                  completion that landed after its own PostToolUse sweep still settles before
                  the gate is read; still-unpaired means the gate stays open, retried within
                  the expiry window. Sweeps keep a **persistent per-session transcript
                  cursor**, and its state is a byte offset PLUS the pending set (round-7: a
                  tool_use and its result are different transcript records, so an offset
                  alone either re-scans the unresolved suffix forever or loses the request
                  context) — the pending set is exactly the unbound and bound-but-unsettled
                  dispatch_ids already in the log, and the transcript-side exclusions are the
                  disposition records (round-8), so no second bookkeeping structure exists to
                  drift and a rescan reconstructs both from the log alone. The cursor advances only after every event behind it is durably
                  applied or durably classified no-op (the bound/settlement/expired events
                  and the tooluse dispositions are that record); forward scans are O(new bytes), not O(transcript) — this
                  session's transcripts reach tens of MB, so the full scan is priced, not
                  hidden: a lost or invalid cursor falls back to exactly one full rescan

background handoff (the PostToolUse that reports "moved to background as task <id>"):
  exactly one un-consumed, un-owned candidate → mark it background-owned by that task_id
  zero or ≥2 candidates                       → mark NONE, refuse loudly — a mis-owned
                                                dispatch would let one review's report ride
                                                another's digest
  a task-owned dispatch pairs only with its own task's completion ("task:<id>")

spent identities  the ledger is **schema-borne, not inferred** (rounds 6–7): spent = every
                  settlement record's completion_id — verdict-bearing and all-no-verdict
                  settlements alike; an `owned` event's task_id is ownership, never
                  consumption, and spends nothing. Nothing consumes a completion twice, on
                  any path. The set is **load-bearing state with its own retention** (§ 3.3)
                  — it never rides superseded-verdict trimming

verdict record    {kind:"verdict", plane, digest, …} remains the **runner's** single-plane
                  row (one plane, one line — already crash-atomic); review verdicts have no
                  standalone row at all — they exist only as settlement projections, so no
                  sibling rows can ever be separated by a crash

expiry            dispatch records never match across sessions; a dispatch older than 48h
                  (log-side age, its own writer's stamp) is refused at settlement time — by
                  name when bound, by disposition exclusion when not. Within the retention
                  window, retirement is an `expired` EVENT, never a deletion. The drop
                  condition is **age, never liveness** (round-6 — "session is dead" is
                  undecidable from the log): a dispatch and its events may be dropped
                  outright only past the 48h window, and **what makes the drop safe is
                  accounting, not any clock** (round-9 — the earlier age-symmetry argument
                  assumed a transcript/log clock that does not exist and is fully retired):
                  the frontier record outlives the drop, so every entry the dropped records
                  had disposed stays excluded on rescan, and an entry with no surviving
                  records is unaccounted → quarantined on next contact, never bound. A drop
                  can therefore never shift a survivor's identity. The remedy for an expired
                  dispatch is a fresh review, never a guessed binding
```

**What the dispatch digest does and does not claim** (round-3 finding). The reviewer reads the
**live working tree** in its own sandbox (`skills/doc-review/SKILL.md:118` — prompts carry
metadata, not content), so a dispatch-instant digest is *not* an immutable snapshot of what was
read. The producer therefore **revalidates at completion**: the verdict is appended only when the
digest recomputed at result time equals the dispatch digest, so a verdict means "the content was
X at dispatch **and** X at completion". The residual — an unobserved writer mutating the tree
mid-review and reverting it exactly before completion — is documented and accepted for v1: it
requires an external or cross-session writer (this design observes no edit events, by design),
which is the same exposure today's event model has for any writer outside the harness. The strict
remedy — materializing the digest's entry list into an immutable snapshot the reviewer reads —
is ❓ Q6, priced separately, not silently claimed.

**Backgrounded MCP calls emit no PostToolUse completion event** — the real report arrives as a
task notification (`post-tool-review-state.sh:2741`) — so a dispatch record alone creates no
result event. The `background_reviews` machinery is therefore replaced, not deleted: the
transcript-recovery producer above is the load-bearing replacement, and its **ownership marking**
is what lets a foreground twin of the same request coexist with a backgrounded one without either
stealing the other's completion. If recovery never runs (session ends first), the dispatch record
is retired by expiry and the gate stays open — fail-closed.

**Producer coverage: every path that closes the precommit gate today keeps a producer**
(round-6 correction — the round-5 draft claimed the Skill-level ecosystem fallback mints no
receipt today; that is **factually wrong**: `post-tool-review-state.sh:3818–3903` recognizes a
`TOOL_NAME=Skill` route as a precommit verdict source — when the runner reported
`NO CHECKS RUN` and the precommit Skill ran the ecosystem checks itself
(`skills/precommit/SKILL.md:40–60` — pytest/cargo/go/…), the Skill's final `## Overall:` line
closes the gate). Dropping that route with nothing in its place would regress every non-Node
repo, so this ticket takes the clean end state instead of a fragile parity shim: **the runner
becomes the single multi-ecosystem orchestrator (WB2b)** — it learns the same manifest
detection the Skill table encodes (pyproject.toml / Cargo.toml / go.mod / …), runs those
checks as its own steps, and appends the receipt directly, identical to the Node path. The
Skill keeps its human-facing fallback narrative, but the receipt always comes from the
runner's append; Bash **and** Skill output parsing retire together, only once WB2b covers the
ecosystems the Skill table ships. Until WB2b lands in the phased rollout, the Skill-route
recognition stays live — retiring it earlier would be the regression the round-6 review caught.

The runner needs no dispatch step, but "same process" is not atomicity (round-3 finding): checks
run for minutes on a shared tree. The runner captures its **validation baseline** digest after
the last intentionally-mutating step (`lint:fix`) and before build/test, recomputes it at
`overallPass`, and **refuses to write a PASS receipt on an endpoint mismatch** — drift that
persists to `overallPass` is caught and reported loudly, the gate stays open. An exact A→B→A
flap *during* build/test is the same endpoint limitation as the review residual above — one
documented residual, one strict remedy (❓ Q6), claimed nowhere as closed. FAIL verdicts and
tombstones are exempt from the equality requirement: negative evidence about a drifted tree
still names the digest it observed.

### 3.5 Check-time derivation (stop-guard)

Two questions per plane, in order (round-1 finding 3 — obligation is defined, not deleted):

```
dirty(plane)    = plane-filtered entries of git status --porcelain=v1 -z --untracked-files=all
owed(plane)     = dirty(plane) ≠ ∅          # clean checkout owes nothing — preserves
                                            # stop-guard.sh:519–526's clean-tree release
V(plane)        = newest verdict-bearing record for (plane, plane_digest(plane))
                  # a runner verdict row, or a settlement's plane_results[plane] verdict
                  # projection (§ 3.4); "no-verdict" entries, dispatch/event and tombstone
                  # records never participate; newest = append order
closed(plane)   = V(plane) exists ∧ V(plane).verdict == "pass" ∧ mode_ok(plane)
                  ∧ unresolved_tombstones(plane, plane_digest(plane)) == ∅    # § 4 veto
gate(plane)     = ¬owed(plane) ∨ closed(plane)

mode_ok: non-precommit planes → true
         precommit → mode ∈ {full, fast} ∧ (PRECOMMIT_REQUIRE_FULL=1 → mode == "full")
                                            # preserves stop-guard.sh:1125–1137 (finding 5)
```

Worked behaviours, pinned by tests: a fresh clean checkout owes nothing; a doc-only change owes
only `doc_review`; a code-only change owes `code_review` + `precommit`; a committed change leaves
every plane clean → nothing owed (today's behaviour); an edit made and reverted leaves the dirty
set empty → nothing owed, and any pre-edit verdict is again valid anyway (same digest); a session
restart changes nothing — there is no session state to lose.

- Plane classification of a porcelain **rename record uses the union of its old and new paths** —
  a `.md` → `.js` rename owes both planes: the doc plane lost a file, the code plane gained one.
- Fail-closed inherits naturally: no log, unreadable log, digest mismatch, `partial` digest,
  invalid mode → the owed gate stays open.
- Dual mode: the aggregate branch is untouched (§ 3.4) — this derivation replaces only the
  individual-receipt reads.
- `[AUTO_LOOP_STATE]` fact blocks keep their shape; `receipts=` fields are now derived, with
  `source=digest` appended for observability.
- The corrupt-shape validation (`stop-guard.sh:475`) **narrows, not retires** (round-2 finding):
  the per-plane receipt shape checks go with the receipts, but the validator keeps guarding
  exactly what § 3.6's Stays column keeps in the mirror — `review_mode`, `aggregate_gate`
  (`.executed`/`.gate`, including the malformed-scalar cases its comments document), and
  plan/progress fields. Sidecar fail-closed branches for verdict-write loss and transcript
  fallback for per-plane gate state retire. (Transcript fallback for *other* duties, and the
  § 3.4 recovery producer's transcript read, are untouched.)

### 3.6 What is deleted, what stays

| Retired (gate-state path) | Stays |
|---------------------------|-------|
| `has_code_change` / `has_doc_change` flags **as stored state** — obligation is derived from the dirty set at check time (§ 3.5) + all edit-time invalidation in `post-edit-format.sh` (its formatting duties remain). **Every stored-flag consumer migrates with them** (round-2 finding): `user-prompt-review-guard.sh:208–225`, `post-skill-auto-loop.sh:210–211` and `post-compact-auto-loop.sh:300–301` read the flags to decide prompting/`[AUTO_LOOP_STATE]`/post-compact re-injection, and `session-init.sh:587` initializes them — a missing field read as `false` would silently report "no change". The compat fields keep being written until WB5 migrates each consumer to the derived reads | Round counting, `[LOOP_PROGRESS]`, stall streaks, `[NIT_DEFERRED]` history — the progress ledger keeps its current home and writers (relocation is ❓ Q5, not this pass) |
| Edit epochs; `background_reviews` markers — **replaced by** the dispatch records **plus the narrowed transcript-recovery producer** of § 3.4 (backgrounded MCP calls emit no PostToolUse completion event, so recovery is a load-bearing piece of the replacement, not deleted choreography) | `aggregate_gate` mirror + stop-guard dual-mode branch (§ 3.4 — deferred with plan-review, ❓ Q1); the § 3.5 residual-state validator that guards them |
| `verdict_write_failed` sidecars, lock-contention degraded branches for receipts | Plan-review state (out of scope this pass) |
| Whole-command Bash anchoring for precommit; 30KB sensitivity; the Skill-route verdict parsing (`post-tool-review-state.sh:3818–3903`) — both **only after WB2b** absorbs the ecosystem fallbacks (§ 3.4) | MCP output recognition (as verdict trigger only) · `[AUTO_LOOP_STATE]` emission (now derived) |

Estimated reduction: the three hooks' gate-state machinery (~thousands of lines) collapses to one
digest library (~200 lines), the dispatch/verdict append sites, and one derivation block.

## 4. Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Digest cost on very large repos / huge untracked files | One index pass per derivation, digests computed once per stop invocation (§ 3.2); huge files: optional size cap with loud skip ⇒ `partial` digest ⇒ never matches ⇒ fail-closed |
| Concurrent appends / compaction races | The portable `mkdir` ownership-aware lock (§ 3.3) held by appenders **and** compaction; single-line appends |
| **Producer append failure with an older same-digest pass readable** (round-1 finding 7) | Two-tier write with **explicit resolution, never clock comparison** (round-3: wall clocks cannot order events across files — `post-tool-review-state.sh:2783` is why the hooks already use monotonic sequence). On primary append failure the producer writes a **tombstone** — **one schema, everywhere**: `{kind:"tombstone", id, pairs:[{plane, digest},…], time}` (round-10: a scalar single-plane form no longer exists — the runner's single-plane failure is the one-element `pairs` case of the same shape, so no reader can ever meet two versions; a record whose `pairs` is missing or malformed is treated as **unresolved for every pair**, fail-closed). `id` is a **cryptographically random UUID** (`crypto.randomUUID()` in Node, `uuidgen` in shell; no shared allocator, no session input — the runner has neither), and resolution matches per pair by the **full `(plane, digest, id)` tuple**, so even a colliding id cannot resolve another pair's tombstone — to the **separate fallback path** `${TMPDIR:-/tmp}/sd0x-dev-flow/<repo-slug>.tombstones.jsonl` (a distinct location, *not* necessarily an independent filesystem failure domain — `$TMPDIR` can share a volume with the cache home), admitted under the same containment rules as the primary cache: absolute resolved path outside the repo root, directory created `0700` with ownership checked, symlinks refused. Both files use the same per-file `mkdir` lock, and **no path ever holds both locks at once**: each file operation completes (acquire → read/write → release) before the other file is touched — a tombstone appended after a PASS's fallback read simply stays unresolved, which over-blocks and can never deadlock or fail open. **An unresolved tombstone unconditionally blocks its `(plane, digest)`**: stop-guard accepts a PASS only when every tombstone for that pair is resolved. A later primary PASS resolves tombstones by recording their ids in its `resolves` **array** — every matching id it read, written only after actually reading the fallback file; a producer that cannot read the fallback writes no `resolves`, and a fallback file that exists but is unreadable or malformed counts as **unresolved tombstones present** for every pair, so the failure mode is **over-blocking, never fail-open**. Compaction prunes only resolved tombstones (§ 3.3). `$TMPDIR` volatility (tombstone lost to reboot) is part of the residual below. If **both** writes fail, the producer exits loudly, and the residual — an older same-digest pass closing a gate whose newer run failed — is documented and accepted: same class as today's sidecar-write-failure hole, not a regression. What **is** guaranteed fail-closed is check-time unavailability: no readable log ⇒ owed gates open (the ticket AC scopes its claim to exactly this). Producers additionally verify writability at start and refuse to run the gate silently degraded — a mitigation, not a guarantee, since permissions can change mid-run. **Multi-plane settlement append failure (round-9)**: a failed settlement tombstones as **one crash-atomic line** of that same schema — a single id, a single append (line-atomic, per § 3.3: the indivisible records are single lines), so a crash cannot leave one plane blocked while its sibling fails open; `pairs` carries **only the verdict-bearing plane projections** — a `"no-verdict"` projection acquires **no** tombstone, because an attempt record is not evidence and must not veto an older same-digest PASS (§ 3.4 round-8 algebra). Blocking and resolution stay per-pair: each `(plane, digest)` in `pairs` blocks independently, and a later PASS resolves by the full `(plane, digest, id)` tuple — the batch is shorthand for its pairs, never a new unit of veto |
| A commit between verdict and check | By design survives (content digest, § 3.2) — a feature, pinned by a dedicated test |
| Renames / symlinks / gitlinks / conflicts / mode changes | Explicit recipe rows in § 3.2, each fail-closed or content-correct; pinned by tests (incl. nested-untracked and unstaged-chmod) |
| Two sessions, same repo | Log is per-checkout (`realpath` slug) and digest-keyed; a concurrent edit that leaves the endpoints unequal is caught by endpoint revalidation (§ 3.4); the exact endpoint-ABA flap is the documented ❓ Q6 residual, not claimed closed |
| Cache dir unavailable (`$HOME` unset, permissions) | Fail-closed: no readable log ⇒ owed gates open; producers refuse to run silently (above) |
| Migration breakage | Phased (§ 5); dual-read window with `source=` observability |

## 5. Work Breakdown

| # | Task | Size | Depends |
|---|------|------|---------|
| WB1 | `scripts/lib/tree-digest.js` + unit tests (determinism, plane split, containment, rename/delete/untracked-nested/CRLF, unstaged chmod, symlink/gitlink/conflict fail-closed, commit-survival) | M | — |
| WB2 | Runner append + writability preflight + tombstone fallback; regression: >30KB output, piped, backgrounded — verdict still lands | S | WB1 |
| WB2b | Runner multi-ecosystem orchestration (§ 3.4 round-6): manifest detection from the Skill table (pyproject/Cargo/go.mod/…), ecosystem checks as runner steps with the same direct append; Bash + Skill precommit output parsing retire **only after** this lands, with the Skill-route recognition kept live until then | M | WB2 |
| WB3 | MCP event-sourced dispatch lifecycle (immutable call-level dispatch + dispatch_event records, pinned reducer table incl. un-owned in-flight, contested precedence) + per-dispatch visibility decision (activation barrier with activation_prefix_digest at SessionStart or lazy first contact / capture-time bind on the dispatch line / `frontier_start` claim windows closed by `frontier_end` / accounting precondition + `ambiguous` poisoning / dispatch-append failure blocks the call with `exit 2`) + read-time twin-contested invariant (nonterminal ∧ un-owned predicate) + universal disposition writer (`bound`/`quarantined` per transcript entry) + frontier records (file identity + prefix_digest, contiguity, liveness retention, write-ahead) + single-settlement writer (plane_results per-plane recognition, schema-borne spent ledger, background ownership, offset+pending cursor, torn-tail recovery) + load-bearing fsync with prefix-safe write ordering before lock release / cursor advance; crash-at-every-boundary, contested-refusal, quarantine-isolation, no-shift-after-drop, no-verdict-algebra, one-sentinel-only / dual-namespace-refused, expiry-by-name and replay tests; forged-sentinel negative controls both directions | M | WB1 |
| WB4 | stop-guard: **final pairing sweep as a check-time writer** (bind, `tooluse_disposition` and settlement appends under the producer lock + write-failure duties), then obligation + validity derivation (incl. `mode_ok`, rename-union classification, dual-mode aggregate branch untouched, residual-state validator narrowed not removed); dual-read (digest path preferred, mirror fallback); tombstone merge read; `source=` field; single/dual-mode acceptance tests | M | WB1–3 |
| WB5 | Retire event machinery (post-edit gate branches, epochs, markers, sidecars) **and migrate every stored-flag consumer** — `user-prompt-review-guard.sh`, `post-skill-auto-loop.sh`, `post-compact-auto-loop.sh`, `session-init.sh` (§ 3.6) — to derived reads, compat fields written until each lands; pointer comments to superseding mechanism | L | WB4 proven |
| WB6 | Doc sync: `rules/auto-loop.md` § Enforcement, `../4-implementation.md` | S | WB5 |

## 6. Testing Strategy

Seed suite = the three incident classes as regressions (ticket AC 1–3), plus, each named in § 3.5's
worked behaviours or § 3.2's recipe: obligation set (clean checkout / doc-only / code-only /
committed / reverted / restart / rename-union owing both planes), dispatch-binding (tree edited
mid-review → gate stays open; unbound verdict refused; ≥2 same-key dispatches with differing
digests → refused; backgrounded call recovered by transcript pairing and bound to its dispatch
digest), selection (pass-A, fail-B, return-to-A → closed; pass-then-fail same digest → open),
mode policy (`PRECOMMIT_REQUIRE_FULL=1` rejects `fast` and unknown modes), correlation state
machine (concurrent byte-identical twin dispatches → both contested, every completion refused —
including the reversed-lock-order permutation where counts are equal but orders differ; a
contested dispatch with a later bound/owned/settlement event → refused at read time, contested
precedence absolute; sequential same-key dispatches bind eagerly and settle by tooluse_id; one
call opening doc + code planes → one dispatch record, ONE settlement — plane_results settle the
recognized plane's verdict and the other plane `"no-verdict"`, a dual-namespace output settles
every plane `"no-verdict"`, and a sentinel absent for a plane never mints that plane's receipt;
crash at EVERY bind/settle boundary → either nothing spent and the retry is safe, or fully
settled — no observable partial state; no-verdict algebra (round-8): all-no-verdict with no
prior same-digest verdict → gate open, all-no-verdict with an older same-digest PASS → gate
STAYS CLOSED (attempt records are not evidence), one-plane-no-verdict with an older PASS for
that plane → that plane stays closed while the recognized plane settles fresh; quarantine
isolation (round-8): contested pair → fresh same-key dispatch after cursor invalidation binds
ONLY its own entry (the quarantined tooluse_ids are reconstructed from disposition records,
never re-admitted); a call whose PreToolUse dispatch append failed → its entry quarantined
unaccounted, the next call unaffected; a pre-migration transcript entry → quarantined
unaccounted; background handoff with zero or multiple candidates marks none; a replayed or
duplicate delivery pairs to a spent identity → refused; a spent completion identity is never
consumed twice on any path, including after a concurrent session's SessionStart compaction;
canonical-key equality across Pre/Post events, differing JSON key order, and non-ASCII
content; a bound expired dispatch's late result refused by name, a never-bound one quarantined
as unaccounted, while a fresh same-key dispatch still binds and settles; a >48h record dropped
with **no shift** in any survivor's binding — the no-shift negative control, now via
disposition accounting; a malformed or future log timestamp → expired for pairing, retained
for exclusion (fail-closed, both clock-skew directions across the 48h cutoff); torn tail →
reader ignores the unterminated line, writer truncates then appends under the lock, an
fsync'd settlement survives the crash; reducer table (round-8): bound-then-contested and
contested-then-bound reduce identically, conflicting duplicate bound/owned events → contested
and reported, event-after-terminal refused, unknown event kind poisons fail-closed; cursor
state = offset + pending dispatch_ids: crash before and after cursor advancement both recover
without loss or double-apply, cursor invalidation → exactly one full rescan then incremental
again; a completion landing after its own PostToolUse sweep settles in
stop-guard's final sweep; endpoint revalidation — result-time digest ≠ dispatch digest →
verdict refused),
visibility decision (round-9/10): both capture cases exercised — entry visible at capture
(the dispatch line carries `bound_tooluse_id`; **no separate bound event exists** and the
reserved newest is never quarantined while a live window could claim it) and entry not
visible (`frontier_start` captured under the lock, the first same-key entry at-or-past it
binds via a `bound` event; an unaccountable orphan below frontier_start → the dispatch
poisons `ambiguous`, its completions refused, the orphan then quarantined, and the **next**
same-key dispatch binds clean); the round-10 regression: a terminal never-bound same-key
dispatch's window candidate is quarantined by the accounting precondition **before** a new
same-key dispatch binds — a stale entry with stale PASS output can never be claimed as the
new call's own; `frontier_end` closes a terminal window so an entry appended later is never
attributed to it; activation barrier (round-11): a SessionStart-activated session binds its
own entry (≥ activated_at) while a pre-barrier same-key entry with pending stale PASS output
is quarantined wholesale and never capture-time bound — the rollout regression; a
lazily-activated mid-rollout session refuses its pre-barrier in-flight calls fail-closed; no
readable activation record → capture-time binding disabled entirely, frontier-only binding
still works; activation aliasing (round-12): truncate-in-place, inode reuse with an
identical first line, and a rebuilt prefix each fail the activation_prefix_digest check →
capture-time binding disabled, conservative path taken, nothing bound by identity alone;
ambiguous-then-clean (round-12): `D1 → ambiguous(frontier_end) → orphan disposition → D2` —
D2 is NOT contested by the read-time invariant (D1 was terminal at D2's line) and settles
normally, while the acknowledgment exception accepts a matching derived-contest `contested`
event silently and still refuses every other post-terminal event; a PreToolUse whose dispatch append fails **blocks the tool call with `exit 2`**
and the test asserts the tool body never ran (a generic nonzero exit is the negative
control — it must NOT block, per the hook contract); twin crash prefix (round-11): the log
ending "D1's line, D2's line" with no contested events folds BOTH to contested at read time
— every bind or settlement for either is refused, and the next sweep's explicit contested
events change nothing;
frontier soundness (round-10/11): the frontier applies only when transcript_file_id matches
**and** the recomputed prefix digest equals prefix_digest — either mismatch (including an
inode-reuse alias with identical first line) → dispositions-only rescan, unaccounted entries
quarantined, nothing re-admitted; it never advances past an undisposed entry (contiguity negative control);
write-ahead — crash between the frontier append and the disposition drop → both survive and
the exclusion set is identical; disposition-drop recovery: aged dispositions folded into a
`frontier` record, then cursor loss → exactly one full rescan reconstructs the exclusion
set (dispositions ∪ frontier coverage) and re-admits no quarantined identity; ownership
coexistence (round-9): `bound → owned(task_id)` → a fresh same-key foreground PreToolUse
dispatches **un-contested**, then the task completion settles the owned dispatch and the
foreground completion settles its own — neither refused; durability (round-9/10):
power-loss injected after **each** load-bearing append (activation record, dispatch incl.
capture-time bind, lifecycle event incl. `ambiguous`, disposition, frontier record,
settlement, tombstone) and
on both sides of cursor advance — for activation specifically at all three SessionStart
boundaries: before the append (degrades to lazy activation), mid-line (torn tail ignored,
lazy activation), and after append + fsync (the barrier holds) — → **every persisted prefix
reduces to a safe state** —
nothing spent twice, no bind guessed, gates fail closed, single-line records whole or
absent; compaction-rewrite crash → the old file or the new file, whole, never a mix,
compaction invariants (same-key contest **semantics** survive compaction intact — in-window
multiples survive diagnostic-cap compaction, while the 48h rule may evict a member only under
the materialization duty; the round-13/14 asymmetric-cutoff regression: D1 just past the
48h window, D2 just inside it, **no explicit contested events**, D2 born bound with a pending
completion → compaction materializes D2's `contested` acknowledgment before dropping D1, and
reducing the **actual compacted record set** — D2's born-bound base plus the acknowledgment,
D1 absent — still yields contested via the first-class `bound → contested` transition and
refuses D2's completion — a record drop changes no survivor's fold; a multi-id `resolves` clears every tombstone it read; a
tombstone id collision cannot resolve another pair's tombstone — negative control; a
multi-plane **batch tombstone** blocks each of its `pairs` independently, carries only
verdict-bearing pairs — a `"no-verdict"` projection stays tombstone-free and an older
same-digest PASS for it keeps standing — and each pair resolves separately by its full
`(plane, digest, id)` tuple), runner
endpoint mismatch (baseline-vs-`overallPass` digest mismatch → PASS receipt refused; the exact
endpoint-ABA flap is the documented Q6 residual, not tested as caught), digest recipe
(nested untracked, unstaged chmod, symlink, conflict → `partial`; submodule: clean-at-index OID /
different-commit overlay / dirty-inside → `partial`), commit-survival, cross-plane independence
(doc edit leaves code verdict valid and vice versa), fail-closed set (no log / mismatch /
`partial` / unresolved tombstone blocks its pair until a PASS `resolves` it / fallback file
present-but-unreadable ⇒ treated as unresolved tombstones, blocks / invalid mode /
unavailable cache dir / relative `XDG_CACHE_HOME` falling back outside the repo / `$TMPDIR`
fallback failing containment → refused), dual-mode aggregate precedence unchanged, residual-state
validator still rejecting malformed `aggregate_gate` scalars, stored-flag consumer consistency
through the dual-read window, and guard tests in both directions per `@rules/testing.md`
§ Conventions (Guards row): forged line refused; genuine producer line accepted, same words.
Full-suite green throughout the dual-read window.

## 7. Open Questions ❓

1. **Aggregate/plan gates**: `aggregate_gate` and plan-review keep their current mirror paths in
   this ticket (§ 3.4); folding them into the log is the follow-up. Confirm the follow-up's
   ordering relative to Q5.
2. **Compaction budgets**: per-kind bounds are settled in § 3.3 — diagnostic history N=200,
   verdict pairs LRU-50 per plane, dispatches (with their events) by 48h age, frontier and
   activation records
   by transcript-file liveness (§ 3.4); unresolved
   tombstones are deliberately unbounded (§ 3.3 — fail-closed over capped). Raise the bounded
   ones if archaeology or long-lived branch flip-flops prove useful.
3. **Worktrees**: the `realpath` slug gives each worktree its own log — conservative and correct
   (different checkouts, different trees); confirm during WB4.
4. **`STOP_GUARD_MODE=strict`** semantics under dual-read: strict should trust only the digest
   path once WB4 lands — confirm before WB5.
5. **Relocating the residual runtime artifacts**: `.claude_review_state.json`,
   `.claude_nit_history.json` and the existing `.claude/cache/` precommit/XDG data (~9.7 MB today)
   stay where they are under this ticket. Moving them to the same per-repo cache home is a
   follow-up ticket; only then does the repo reach a true zero-runtime-artifact state.
6. **Immutable validation snapshots**: § 3.4's endpoint revalidation accepts a documented
   mid-window flap residual — for both producers. The strict remedy for the **reviewer** is
   materializing the digest's entry list (mode + OID + path) into a frozen tree Codex reads
   instead of the live checkout (one tree copy per round; changes the reviewer-facing skill
   contract). For the **runner** it is exclusive tree ownership for the validation window, or
   running build/test against a materialized snapshot (a worktree-style copy) with artifacts
   written outside it — a different mechanism with a different cost profile, specified here so
   "shared Q6" does not silently mean "reviewer-only fix". Price both after v1 field data shows
   whether the residual ever bites.
7. **Non-Node ecosystems — resolved in scope as WB2b** (round-6): the Skill-route fallback IS a
   receipt producer today (`post-tool-review-state.sh:3818–3903`), so parity requires the runner
   to absorb the ecosystem checks before output parsing retires (§ 3.4). The remaining open
   question is only the supported-ecosystem list: WB2b ships the table
   `skills/precommit/SKILL.md:40–60` encodes; confirm during WB2b whether any ecosystem beyond
   it needs first-class steps or stays on the documented open-gate path.
