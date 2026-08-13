# Auto-Loop Hook Internals — Implementation Notes

> **Status: Historical（2026-08-13, hook-lightweighting）** — 本文描述的強制層機器（dispatch
> 配對、receipt ledger、gate 推導、strict/dual Stop、`.claude_review_state.json`）已整體退役，
> 由 out-of-repo 提醒狀態（`scripts/review-state.js`）取代。全文保留作 forensic record，
> 不再描述任何活著的 hook。現行契約：`docs/features/hook-lightweighting/2-tech-spec.md`。

Forensic record of *why* the auto-loop hooks have the shape they do. Every paragraph here was paid for by a real defect.

**This document is deliberately not loaded into session context.** It moved out of `rules/auto-loop.md`, which is imported via `@` on every session: 71% of that rule was material like this — lock protocols, symlink archaeology, byte-offset pairing — that a model cannot act on but must nonetheless carry. The rule keeps the behavioural contract; this file keeps the reasoning.

Read this when **changing** a hook, **debugging** a gate that did not fire, or **reviewing** a change to the state machine. Do not read it to decide what to do next in a loop — `rules/auto-loop.md` is authoritative for that.

| Related | Path |
|---------|------|
| Behavioural contract | [`rules/auto-loop.md`](../../../rules/auto-loop.md) |
| Feature tech spec | [`2-tech-spec.md`](./2-tech-spec/2-tech-spec.md) |
| Writing hooks | `hooks/post-tool-review-state.sh`, `hooks/post-edit-format.sh`, `hooks/post-compact-auto-loop.sh`, `hooks/session-init.sh` |
| Reading hook | `hooks/stop-guard.sh` |

---

## 1. State file

**File**: `.claude_review_state.json` (locally ignored)

```json
{
  "session_id": "abc123",
  "updated_at": "2026-01-26T10:00:00Z",
  "has_code_change": true,
  "has_doc_change": false,
  "code_review":  { "executed": true,  "passed": true,  "last_run": "2026-01-26T10:00:00Z" },
  "doc_review":   { "executed": false, "passed": false },
  "precommit":    { "executed": true,  "passed": true,  "last_run": "2026-01-26T10:01:00Z" }
}
```

That is an **abridged illustration**, not the schema. The creation shape is the heredoc in `init_state_file()` (`post-tool-review-state.sh`), which also carries `review_mode`, `aggregate_gate`, `plan_review`, `iteration_history`, and `schema_version`. Further keys appear at runtime as their owners write them — `review_phase` (gate transitions), `changed_files_since_review` (written by `post-edit-format.sh`, cleared by `_reset_changed_files()`), `session_commit_scope` (`session-init.sh`). Each hook writes only the subtree it owns.

All **four** writing hooks coordinate on the shared `${STATE_FILE}.lockdir`. `session-init.sh` was the exception until 2026-07-26: it rewrote the *whole* file on a session change without taking the lock, so a verdict committed between its `jq` read and its `mv` was silently clobbered by the reset. On contention it now skips the reset rather than writing unlocked; the retained state is safe because stale gate values only matter once something is edited, and the edit hook invalidates them first.

### 1.1 State-lock ownership

Acquisition writes a per-process `owner` token; release removes the directory only when that token still matches. Two consequences the old flag-based release did not have: a process whose lock was taken over no longer deletes its successor's lock on the way out, and each committing `mv` re-checks ownership so a displaced writer degrades through the fail-closed handler (a marker, or a logged skip) instead of committing over a live transaction.

Stale recovery takes the lock by **renaming it aside** to a process-unique tombstone rather than `rm -rf` + `mkdir`: the delete-then-create pair let two contenders that both judged the lock stale each enter the critical section. A takeover between the ownership re-check and the `mv` remains — the same check-then-act residual the lock itself has. Narrowed, not closed.

---

## 2. Round counter lifecycle

`current_round` counts rounds **within one convergence loop**, not edits.

| Event | `current_round` | `total_rounds_session` |
|-------|-----------------|------------------------|
| **Code**-review iteration (`_update_iteration()`), passing or not | +1 (best-effort) | +1 (same) |
| Doc review (`/codex-review-doc`), passing or not | unchanged | unchanged |
| Code edit (`post-edit-format.sh`) | unchanged | unchanged |
| **`precommit`** passes, counter valid and below the CLAMPED cap | reset to 0 | unchanged |
| Same, but counter invalid or at the clamped cap | **not reset** | unchanged |
| New session (`session-init.sh`) | reset to 0 | preserved |

### 2.1 The `+1` is best-effort

`_update_iteration()` degrades to a no-op (returns 0, never aborts the hook) when the state file is absent, when `_lock` times out against a concurrent writer, when `mktemp` fails, when the `jq` rewrite fails, or when the final rename fails — each path logs to stderr and leaves the counter where it was. The absent-state and rename paths were silent until 2026-07-25; the rename one additionally reported *success* under `HOOK_DEBUG=1`, which is why a hard cap that never fired was undiagnosable from the logs.

A skipped increment always *undercounts*, so the effect is a hard cap reached later than the nominal `max_rounds`, never earlier. The same applies to any verdict dropped upstream (unanchored command, MCP output with no Merge Gate): no verdict recorded → no `_update_iteration()` call → no round. **Treat `current_round` as a lower bound on rounds actually run.**

### 2.2 Why a doc gate does not reset it

`_update_iteration()` is called from the code-review branches only (Bash and MCP), on **both** the pass and fail paths — a `⛔ Blocked` round costs budget exactly like a `✅ Ready` one. The doc-review branches record their verdict without touching `iteration_history`, so a doc-only loop has no round budget and never reaches the hard cap; it converges on `✅ Mergeable` or not at all.

A passing `doc_review` does **not** reset `current_round`, even though it is a terminal gate. `current_round` is a **code** counter, so letting a doc gate zero it is a cross-plane refund. It was one until 2026-07-25, and the consequence was concrete: with `code_review.passed = false` at round 9 of 10, one passing `/codex-review-doc` rewound the round to 0 and emptied `findings_by_round`, so repeated doc passes held an unconverged code loop permanently below the cap — the only convergence exit that is actually enforced. A doc-only session is unaffected either way: it never increments the counter, so there was never anything for its reset to do.

### 2.3 The reset is gate-conditioned and validity-conditioned

Both conditions live in `update_state()`'s jq filter.

The passing gate must be `precommit` specifically (`$passed == true and $key == "precommit"`) — no other terminal gate qualifies.

The counter must also be one stop-guard would itself accept as unspent: the writer **mirrors the reader's `ITER_PARSED` validation** — object-typed `iteration_history`, a `number` that is integral and in range, and `current_round` below the cap **after the cap is clamped to the producer contract 3..50**.

The mirror is load-bearing because the writer runs first. A guard that merely checked `type == "number"` against the raw `max_rounds` reset `{current_round: 51, max_rounds: 100000}` to a clean `0`, while the reader clamps that cap to 50 and reads the same state as an exhausted budget — the writer was refunding, from under the reader, the only convergence exit actually enforced.

One asymmetry inside that mirror is easy to get backwards, and was:

| | Raw literal must be digits-only? | Why |
|---|---|---|
| `current_round` | **Yes** | jq preserves each number's literal form (`1e2` stays `1E+2`), and it reaches the reader's final bash regex verbatim |
| `max_rounds` | **No** | The reader clamps it first; only the clamp's *output* is interpolated |

Canonicality must therefore be tested on the raw `current_round` and on the **clamped** cap. Testing the raw cap reopened the same class of divergence pointing the other way: `{current_round: 4, max_rounds: 1e2}` reads to stop-guard as a valid, unspent `4 50`, while the writer refused to reset on `1E+2` — so the loop walked to the cap and latched on `⚠️ Need Human` with no visible cause. Both filters are pinned to the same answers under real `jq` by `test/hooks/jq-filter-fidelity.test.js` — which feeds **raw JSON text**, not `JSON.stringify`'d objects, because the divergent inputs (`1e2`, `-0`, `3.5`) cannot be expressed as object literals that survive serialization.

Two more traps the mirror closes: jq has no integer type, so `type == "number"` admits `current_round: 3.5` — the reader rejects a fractional counter as corrupt, and resetting it to a clean `0` would destroy the very corruption the reader fails closed on. And `//` is deliberately absent from the filter: jq's alternative operator treats both `null` and `false` as "missing", so `(.current_round // 0)` mapped a `current_round: false` to 0 and one passing `/precommit` rewrote it to a clean `0`. An invalid counter simply does not qualify for the reset — it survives for stop-guard to keep flagging, and self-heals only through a deliberate human edit. The mirror stays an inline copy in each hook rather than a shared extraction because the two run in different hooks with different failure modes (reader: classify → warn/block; writer: qualify → reset); the differential test is what keeps the copies honest.

### 2.4 Latching

Once the counter reaches the clamped cap the reset stops applying even when precommit passes: the loop has already been escalated to a human, and letting one passing precommit refund the whole budget would hand the same unbounded loop back to the model.

"Latched" means the **reset no longer fires**, not that the number is clamped. Nothing pins it to `max_rounds`, and under the default `warn` mode the counter keeps incrementing past the cap on every further code-review round. **A value above `max_rounds` is normal and is not evidence of corruption.** Clearing a latched counter is a human action — start a new session, or edit `iteration_history.current_round` deliberately.

A code edit is a step *inside* the loop (review → fix → re-review), so it must not refund the round budget — resetting there made the hard cap unreachable, since auto-loop always edits between reviews. `findings_by_round` follows the same lifecycle and is capped at the 50 most recent entries.

---

## 3. Fail-closed sidecar

**Files**: `${STATE_FILE}.blocked` — one reason per line, treated as a **set**, not a scalar — **plus** per-event emergency markers written as **sibling files** named `${STATE_FILE}.blocked.event.<stem>`, one reason per file. The two are read as a single union; every reader consults both.

When a hook cannot durably record a state transition (lock lost, `mktemp` failed, `jq` failed, state file uncreatable), it records a marker here instead of failing silently.

### 3.1 Why there are two files, not one

The shared `.blocked` file is rewritten or removed **wholesale** by a clearer holding the lock. That is only sound if every writer is serialized too, and the setter's last-resort path deliberately was not: on lock timeout it appended anyway, because dropping a marker is worse than duplicating one. A whole-file rewrite therefore raced an unserialized append, and no amount of re-reading closes that — the clearer's final snapshot is a subprocess, so an append landing between that read returning and the `rm`/`mv` is invisible to it and is then erased. Three rounds narrowed the window without removing it, which is what check-then-act always does.

The last-resort path no longer touches the shared file. It creates its own file under a name no other writer will choose, so creation and retirement act on **disjoint names** and cannot destroy one another.

| | Effect |
|---|---|
| Shared file | Now has **no** unserialized writers, which is what makes the clearers' snapshot comparison sufficient rather than merely narrow |
| Spin budget | Setters are back to the default 20 spins (~2 s). They briefly used 70 to out-wait `session-init.sh`'s `timeout 5` tree scan; that only bought anything while a timeout meant a lose-able append. It also **cost** something: setters call the sidecar lock *inside* the state lock, so a transaction with four failing writes waited 4 × 7 s — measured at 29.95 s against `LOCK_TTL=30`, running itself to its own takeover threshold. `test/hooks/post-edit-format.test.js` derives that bound from the three constants rather than restating a number |

### 3.2 A timeout was not the only way to become unserialized

A setter that *acquired* the lock and was then **displaced** — `_sidecar_lock` reclaims on age alone, and setters run inside the state lock, whose TTL is the same 30 s, so a slow transaction can drift past its own sidecar lock's expiry — appended anyway, because nothing between `mkdir` and `>>` re-read the owner token.

One live displaced holder falsifies "no unserialized writers" just as completely as the timeout path did, and it is the harder one to see, because the process genuinely did hold the lock at the moment it decided to write. `_set_own_sidecar_locked` now re-checks ownership immediately before its first mutating statement and returns a distinct `rc=3`, which the caller diverts to a per-event marker with its own diagnostic. The clearers already carried the mirror-image check; the setter is what was missing. This narrows the window to two adjacent statements rather than closing it.

### 3.3 Sibling files, not a marker directory

The per-event plane is `${STATE_FILE}.blocked.event.<stem>` alongside the state file, and that is a **security boundary** rather than a layout preference.

An earlier `.blocked.d/` directory made the orphan clear a `rm -f "$dir"/…`, which resolves **through** a symlink at `$dir` and unlinks the *target's* files — so a symlink committed at `.blocked.d` turned the clear into "delete every regular file in an arbitrary directory". Git stores symlinks, and `.claude_review_state.json.*` is gitignored, so cloning the repo was enough to arm it. `rm -f` on a symlink **file** unlinks the link and never its target, so the same accident against a sibling name destroys nothing. An `lstat` guard on the directory would not have been equivalent: that is check-then-act, and the name can be swapped between the check and the `rm`.

### 3.4 Per-event marker lifetime

Per-event markers are retired **only** by `session-init.sh`'s orphan clear, and only the specific filenames that clear enumerated — one created afterwards has a name the retiring loop never saw. Its precondition (a new session over a tree with no dirty reviewable file) is the one under which every marker is an orphan by definition.

For the lock-timeout case they are rare, so holding one until the next clean session over-blocks briefly and in the safe direction. That "rare" does **not** transfer to the other creation path. A lock timeout is a transient race that resolves itself; the write-failure divert fires on a **persistent local condition** — a directory or an unwritable file sitting at the shared `.blocked` name — which recurs on every call for as long as it lasts. Two consequences:

- Each failing call adds another undeduplicated marker file rather than re-raising one.
- A per-event marker is invisible to the ordinary retirement paths, so the session stays in strict mode even after the verdict the marker stood in for lands successfully: `_clear_own_sidecar` operates on the shared file alone, so a successful write cannot retire its private twin.

Both are fail-closed, deliberately — the divert exists precisely because the ordinary bookkeeping could not be trusted to run. The escape is a human one (fix the path, then start a session over a clean tree), not something the next passing gate will clear.

### 3.5 How stop-guard reads it

Stop-guard **invalidates the affected gate in every case**. Whether that invalidation also *blocks* depends on which markers are present:

| Sidecar contents | Gate | Mode |
|------------------|------|------|
| Only transient markers | Invalidated | Unchanged — `warn` still warns and exits 0 |
| Any non-transient marker, or a **mix** | Invalidated | Escalated to `strict`, overriding the configured `GUARD_MODE` |
| Present but **empty or unreadable** | Invalidated | Escalated to `strict` — a file that exists but yields no lines is itself evidence of a failed write |

**Transient allowlist**: `edit_lock_contention:code`, `edit_lock_contention:doc`, `lock_failure`. A sidecar containing *only* these does not force strict mode. Any other marker, or any mix, does. Empty or unreadable escalates (`_SIDECAR_LINES_SEEN == 0` → not-all-transient).

The allowlist is **closed and default-deny** by design. It began as a denylist naming only `state_init_failed`, which meant every reason producers added later defaulted to the *lenient* branch — and they added three that are not races at all (`state_write_failed`, `verdict_write_failed:<gate>` — retired as a producer in WB5b, still recognized here so an old marker cannot become lenient by outliving its writer, `aggregate_write_failed`), each describing a state whose recorded verdict is known wrong in the unsafe direction. A transient marker is one a lock *race* produced — the race already resolved in someone's favour, so the file's content is a real write, just possibly not ours — and escalating that to strict would silently override an explicit `warn` choice. Everything else, including an unrecognized marker from a newer producer, escalates: adding a reason must never silently weaken the gate.

"Forces strict blocking regardless of `GUARD_MODE`" was once written here as an unconditional claim, and it is wrong in the first row: the transient allowlist exists precisely so a lock contention that resolves itself does not override a user's `warn` preference.

### 3.6 Markers are keyed by plane

The two writing hooks invalidate different gates. An unkeyed marker let a *doc* edit retire evidence of a lost *code* verdict — fail-OPEN, since the previous round's `✅` survived. Losing a `PASS` is safe (the gate stays unsatisfied and is re-requested); losing a `⛔` is not.

| Plane | Markers | Cleared by |
|-------|---------|-----------|
| Edit — code | `edit_lock_contention:code`, `state_init_failed:code`, `state_write_failed:code` | A committed **code**-edit transaction (`post-edit-format.sh`), or `session-init.sh`'s clean-tree check |
| Edit — doc | `edit_lock_contention:doc`, `state_init_failed:doc`, `state_write_failed:doc` | A committed **doc**-edit transaction, or the same session check |
| Verdict *(retired in WB5b — no longer produced)* | `verdict_write_failed:code_review` / `:doc_review` / `:precommit` | Historical: the next successful write of that same gate, or the edit transaction invalidating it. Both clearers went with the producer; a marker left on disk from before the retirement is still **recognized** by the reader above, fail-closed, and now clears only by the whole-file delete below |
| Aggregate gate | `lock_failure`, `aggregate_write_failed` | A **committed** aggregate transition (`update_aggregate_gate`), **or** a committed edit transaction on either plane — both branches reset `aggregate_gate` to `executed=false`/`gate=null`, the same fail-closed value the lost transition would have left. A single-*review* write does **not** qualify: it never touches `aggregate_gate`, so erasing the marker there would drop a lost dual-gate transition |

The "Cleared by" column describes markers in the **shared** file. A per-event marker carries the same reason string but the lifetime in §3.4.

### 3.7 The sidecar lock

Every sidecar mutation in all three writing hooks reaches for a dedicated `mkdir`-based lock (`SIDECAR_LOCKDIR`): **the same protocol in each copy**, same directory name and TTL, because a lock only some writers take excludes nothing. The two halves then diverge deliberately, and the difference is the fail-closed direction of each:

| Half | Lock unavailable | Why |
|------|------------------|-----|
| **Set** (`_set_own_sidecar`) | Writes a **per-event marker** instead and logs it | Declining would DROP the marker, and a marker exists only because a blocking verdict was already lost. A private filename makes the fallback race-free: no clearer can retire a name it never enumerated |
| **Clear** (`_clear_own_sidecar`) | Declines — the set is retained | A clear removes evidence. Doing that unserialized can erase a line another writer added between the read and the rewrite |

Ownership-aware clears commit via `mktemp` + `mv`; a clear that cannot stage its rewrite **retains the full set** rather than dropping it.

The per-event marker is not only the lock-unavailable fallback. A setter that *holds* the lock and still cannot write the shared file **diverts to the same private marker, for every failure** — not just the symlink refusal. The two are reported separately because they mean different things (a symlink must not be written *through*; an ordinary failure was attempted and failed), but they no longer differ in whether the evidence survives.

Restricting the divert to the symlink case read as "an ordinary write failure means nothing can be written at that path", and that inference does not hold: the shared sidecar has one fixed name, so a **directory** sitting on it fails the append with `EISDIR` while `_sidecar_emergency_mark` — which needs neither `mktemp` nor a lock, only a sibling filename — would have succeeded right beside it. Under the old rule the marker was dropped there, and the aggregate caller then read the empty sidecar plane as *total persistence loss* and escalated a recoverable condition to a blocking `exit 2`. That escalation is also what makes the `exit 2` branch's own reasoning sound: it infers "no on-disk channel remains" from the emergency marker having failed, which is only true if the emergency marker is always **attempted**.

It is deliberately **not** the same protocol as the state lock:

| | State lock (`${STATE_FILE}.lockdir`) | Sidecar lock (`${STATE_FILE}.blocked.lockdir`) |
|---|---|---|
| Staleness | TTL **or** dead owner (`pid` file + `kill -0`) | TTL only — no `pid` file, so a writer killed mid-section wedges every sidecar mutation for the full 30 s rather than being reclaimed by the next contender |
| Retry budget | `REVIEW_STATE_LOCK_TIMEOUT` seconds (env-overridable; the hook suites set `0`) | Fixed 20 spins (~2 s) — the env override has no effect on this path |

### 3.8 Reading the sidecar without aborting the hook

stop-guard's classification loop reads both sidecar planes **once each, via `cat`**, and the choice of `cat` over a shell redirection is load-bearing. `tr '\n' ',' < "$f"` looks equivalent and is not: the `< "$f"` redirection is performed by the *shell*, so its failure is reported before `tr` runs and `2>/dev/null` (which redirects tr's stderr) does not suppress it. Under `set -euo pipefail` that non-zero substitution aborts the hook — exit 1 with no JSON on stdout, which the harness treats as a hook error and **allows the Stop**. A sidecar exists only because a blocking verdict was lost, so that is the worst possible moment to fail open. `cat` opens the file itself, so both the stderr redirect and the `||` fallback apply to the open failure. The same reasoning retired a second shell-performed open (`done < file` feeding the loop): each source is opened exactly once, with exactly one failure path.

The read also deliberately bypasses the writers' `_sidecar_read_all` helper. That helper absorbs per-source errors with `|| true` so its `set -e` callers are not aborted by an unreadable marker — right for writers, wrong here: it would pin `_SIDECAR_READABLE` to `true` forever and turn "unreadable marker is unknown, and unknown default-denies" (§3.5) into dead code. The distinction between "nothing was written" and "something was written and we cannot see it" only survives if the read reports its own failure per source.

### 3.9 The one full-file delete

`session-init.sh` removes the sidecar when a new session finds the working tree free of dirty reviewable files, at which point every marker — whatever plane wrote it — is by definition an orphan, because no dirty file remains for any of them to stand in for.

Its `git status -uall` scan runs **inside** the lock, not before it; scanning first left a seconds-wide window in which a concurrent `verdict_write_failed:*` append (a live producer at the time; retired in WB5b) was unlinked, retiring evidence of a lost blocking verdict whose gate still read `passed=true`. Lock unavailable → the sidecar is retained.

---

## 4. Sentinel parsing

### 4.1 Who reads what

| Role | Owner | What it does |
|------|-------|--------------|
| Producer | Review skills (MCP) · `precommit-runner.js` | Emit the sentinel in their output; the runner additionally appends its own content-addressed receipt |
| State writer | `post-tool-review-state.sh` (PostToolUse) | Parses tool output and records the verdict — the dispatch/settlement records for reviews, the state-file **mirror** (advisory since the WB5c flip) and the round ledger for precommit |
| Primary enforcer | `stop-guard.sh` (Stop) | **Derives** the answer at check time: current per-plane tree digest vs the content-addressed verdict log (`scripts/lib/gate-derive.js`). It never re-parses reviewer output, and on a derivable tree no stored change flag decides obligation or validity. The flags are not *unread*: whenever the state file exists they are still type-validated by the corrupt-shape guard (a malformed one forces strict mode) and read before derivation, and they remain the last-resort mirror where derivation cannot answer at all |
| Fallback parser | `stop-guard.sh`, transcript mode | Narrow legacy path only: no state file **and** the derivation could not answer (not a repository). Missing `jq` is *not* this path — that branch exits earlier, before any transcript scan. A derivable tree never reaches it |

**The four `source=` tokens.** The fact line names which *path* produced the answer — a path, not a
verdict, which is the distinction to hold on to: `source=digest` says the derivation ran, whether it
found a closing receipt or found nothing and left the gate open. The vocabulary is closed:

| Token | The path that answered |
|-------|------------------------|
| `source=digest` | The derivation ran against the content-addressed log. `mirror_planes=<planes>` rides along only for a **not-a-repo** tree, where the stored flags remain the sole obligation evidence — an `unverifiable` tree instead forces both gates open and invalidates every mirror receipt, so it never falls back |
| `source=git_probe degraded=derive_unavailable` | The derivation could not run (the resolver was absent or failed) and the WB5c fallback probe answered from a direct `git status`, fail-closed on anything it could not read — including a `.git` ancestor git itself refuses |
| `source=state_file` | The legacy mirror answered, which now happens only where derivation is impossible outright |
| `source=transcript degraded=no_state_file` | The § 4.2 legacy path — no state file **and** the derivation did not answer |

Absent from the table by design: **jq unavailable**. That branch exits before either the derivation
or the transcript scan is reached (`stop-guard.sh`, the `command -v jq` guard), so it emits no
`source=` at all. A degradation that is disclosed is never a wrong answer; an undisclosed one is the
failure this vocabulary exists to prevent. The full derivation contract, including the authoritative-negative rule and tombstone
veto, is in [`2-tech-spec/2-content-addressed-receipts.md`](./2-tech-spec/2-content-addressed-receipts.md)
§ 3.5–§ 3.6.

**What retired in WB5b, and why the rest of this section still stands.** Review recognition by
command name (`/codex-review*`, `/review-spec` in a Bash line) and the Skill-output verdict parsing
are gone — a slash command in text proves the text appears, not that a review ran. The precommit
slash forms went with them, and with them the 30KB transcript-truncation sensitivity that came from
parsing skill output. What survives is the **runner** recognition below (§ 4.6) and the MCP routing,
because those are the two routes whose producer actually executes — and they survive in different
capacities: MCP routing is how a review verdict is recognized at all, whereas for precommit the
authoritative receipt is the runner's own append and the surviving anchored recognition owns only
the advisory mirror and the ledger's convergence reset. Content-addressed receipts:
[`2-tech-spec/2-content-addressed-receipts.md`](./2-tech-spec/2-content-addressed-receipts.md).

### 4.2 Transcript verdict/invocation pairing

The fallback's two scans used to be position-blind — "does a verdict appear anywhere" and "does the command appear anywhere", never related in time. A transcript reading `/precommit-fast` → `## Overall: ✅ PASS` → `/precommit` therefore satisfied the gate for the *newer* invocation using the *older* run's verdict, and the `PRECOMMIT_REQUIRE_FULL` branch — which reads the variant off that same trailing invocation — then declared the full gate met. Two checks, both satisfied, zero evidence. The code and doc planes had the identical shape.

A verdict now counts only when it appears **after** the last matching invocation; unpaired reads as absent, i.e. `(invoked, no verdict)`.

This whole mechanism is now a **narrow legacy path**: it is reached only when there is no state file *and* the derivation did not answer — a tree that is not a repository, with no probe result either. Its use is disclosed on the fact line as `source=transcript degraded=no_state_file`, and the pairing rules below still govern it.

The comparison is by **byte offset**, not line number: the transcript is JSONL, so one line packs a whole message and a report of the previous gate routinely shares a line with the announcement of the next command — line granularity therefore had to accept equality, and accepting equality is exactly what let the older run's verdict through. Both scans run on the **plan-sentinel-stripped** stream, because stripping deletes bytes and measuring one side on the raw transcript would read the two off different rulers, letting upstream plan-review output push a genuine verdict behind its own invocation.

**Known over-block (deliberate)**: the command detectors match prose, so `/precommit` written in a summary *after* a passing run re-opens the gate — the same weakness the `(invoked, no verdict)` branch already had for mentions *before* a verdict, and fail-closed in the same direction. The state-file branch pairs by construction and is unaffected.

### 4.3 Precommit anchoring — state writer

In `post-tool-review-state.sh` the precommit sentinel is the WHOLE line `## Overall: ✅ PASS` — matched at column 0, last `## Overall:` line wins, and **nothing may follow it** on that line. A prefix match would let the `## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN` template line in `skills/precommit/SKILL.md` bank a pass; taking the first match instead of the last would let a `## Overall: ✅ PASS` inside the runner's embedded test tail mask a real final `❌ FAIL`.

**On the phrase `✅ All Pass`.** It is behaviour-layer prose for "every gate passed" — *not* the precommit sentinel, and no hook treats it as a verdict. Be precise about the scope of that claim, because one grep does still contain it: `_skill_output_has_verdict()` lists it among the markers that distinguish a real review verdict from a Skill *launch acknowledgement*. That is a presence test — "is this output a verdict at all", deciding whether to parse further — not a classifier, and it decides nothing about pass or fail. The classification below it drops the phrase outright.

An earlier version of that sentence claimed no hook scan matched it *at all*, which was flatly false; and before that it was untrue in the way that actually mattered: `stop-guard.sh`'s two **coarse, plane-agnostic** transcript scans (`REVIEW_PASSED` and `LAST_REVIEW`) both listed it among their passing patterns. In `LAST_REVIEW` that mattered in the wrong direction — `tail -1` takes the last matching line, so a message ending in the phrase out-ranked an earlier `⛔ Blocked` and cleared the coarse `BLOCKED_REASON`. The additive per-plane scans that run afterwards still caught that case, so it was not a live bypass; it was removed because a phrase the model emits freely in prose should not be able to out-rank a real verdict.

### 4.4 Precommit anchoring — transcript fallback

`stop-guard.sh`'s fallback cannot reuse that parser. It reads `tail -500` of a **JSONL** transcript, where a genuine sentinel sits inside a JSON string on a line beginning with `{`, so literal column-0 anchoring (`^`) would match nothing in production while still passing plain-text fixtures.

It instead demands the sentinel both **start** and **end** a line, in whichever of the two encodings applies:

| Side | Accepted |
|------|----------|
| Leading | `^`, a literal `\n` escape, or the opening `"` of the JSON string |
| Trailing | end-of-line, a literal `\n` escape, or `"` |

**Both groups are load-bearing.** With only the trailing one, a narration *ending* in the sentinel (`…I'll report ## Overall: ✅ PASS`) still matched, and since it carries no FAIL marker `tail -1` let it override an earlier real `⛔ FAIL`. With both, prose mentions fail on the leading side (they are preceded by a space or a backtick), so ``I'll print `## Overall: ✅ PASS` when green`` is rejected.

Command detection in the same mode uses a "not a command-name character" boundary for the same reason: `"/precommit"` and `<command-name>/precommit</command-name>` are the shapes a real transcript actually contains.

### 4.5 Plan namespace isolation

Plan sentinels live in the `plan_review.*` state subtree and never touch `code_review` / `doc_review` / `aggregate_gate`. Plan-review output must never contain bare `✅ Ready` / `✅ Mergeable` / `## Gate:` / bare `⛔ Blocked`. Stop-guard treats a pending plan review as **warn-only** (never blocks). Gate transitions flow through `scripts/emit-plan-gate.sh`; see `skills/plan-review/SKILL.md`.

### 4.6 Precommit runner command binding

Since WB5b this is the only precommit recognition that survives — the Skill route and the `/precommit` slash forms retired with it, and the 30KB transcript sensitivity went with them. Be precise about what it now produces: the **authoritative** receipt is the runner's own content-addressed append (`scripts/precommit-runner.js`, at the moment `overallPass` is computed), which owes nothing to stdout reaching this hook. What the recognition below still owns is the advisory mirror write and the round ledger's convergence reset. The Bash-plane precommit verdict is recorded only when the **entire** command is a standalone `precommit-runner.js` invocation — optional `HOOK_*=val` env prefixes, then `node <trusted-root>/precommit-runner.js`, then plain option arguments, anchored `^...$` with no embedded newline. A raw-text regex can never prove the runner *executed*, only that its text appears; whole-command anchoring is what defeats fabrication, because the runner text cannot hide inside a quoted `printf`, a never-run `false && …` branch, or a trailing `…; printf '## Overall: PASS'` chain — in every such case the command is not solely the runner, the match fails, and no verdict is recorded (fail-closed: `/precommit` re-runs cleanly).

Four defenses, each closing a distinct bypass:

| # | Defense | Bypass it closes |
|---|---------|-----------------|
| 1 | **Path binding** — script operand pinned to `.claude/scripts/` or `.sd0x/scripts/` | A dropped `/tmp/precommit-runner.js` that prints `## Overall: ✅ PASS` |
| 2 | **Env allowlist** — only `HOOK_*=<word>`, value `[A-Za-z0-9_]` only | Execution-affecting prefixes: `PATH=/tmp` (shadow node), `NODE_OPTIONS=--require=…`, `LD_PRELOAD=…` |
| 3 | **Metacharacter-free args** — restrictive charset, not `[^;\|&]` | `> >(printf '## Overall: ✅ PASS')` — no `;`/`\|`/`&`, but redirects the real stdout away while `printf` supplies a fake PASS |
| 4 | **Mode allowlist** (function body) — explicit `--mode`, every operand exactly `full`/`fast` | `--mode bogus` passes the structural grep but skips the build while lint+test still print PASS |

**Accepted residual**: the defenses close *text-level* fabrication; they do not prove the file at the trusted path is the genuine runner. That is out of scope by design: the runner shares the `.claude/` trust root with the hook itself (an attacker who can rewrite one can rewrite the other), the PostToolUse payload carries no exit code to corroborate execution, and a manifest-hash check would live in the same trust root. The threat model here is **cooperative** (Claude's own auto-loop discipline), unlike `run-verify.js`'s adversarial fanout-worker model — closing text fabrication is the right boundary for it.

### 4.7 Verdicts belong to their producer

The MCP branch once mapped `^## Overall:` in a codex response to a precommit verdict, and a generic `✅ All Pass` to a code-review pass. Both were removed, for the same reason: **MCP is not the producer of either verdict.** Precommit executes over Bash (or the Skill's own output) — a verdict line inside an MCP response can only be codex *quoting* text: reviewing `precommit-runner.js`, reading a build log, or echoing the template line in `skills/precommit/SKILL.md`. That made the branch a live gate bypass, proven end-to-end: one codex response quoting the SKILL.md template flipped stop-guard from `Execute immediately: /precommit` to `All steps completed` with no precommit run. A namespace guard (requiring runner section headers) cannot fix it — those headers are exactly what codex reproduces when analyzing a precommit log; "ran it" and "quoted it" are lexically identical.

Dropping the branch is fail-closed both ways: a passing precommit is simply not recorded from MCP (stop-guard re-requests `/precommit`, and the Bash path records it), and a quoted FAIL can no longer spuriously revoke a genuine Bash-recorded pass. The doc/plan/code MCP branches stay, because codex MCP really is the reviewer producing those verdicts. Routing `✅ All Pass` to code_review had the extra cost of conflating two gates: any precommit output reaching MCP banked a code_review pass *and* reset `changed_files` — clearing the very tracking the code gate depends on.

---

## 5. Convergence rows 3–4 are a V2 target

`_update_iteration()` stores per-round counts and timestamps but no `fingerprints` array, so plateau detection (overlap ≥ 50% across 3+ rounds) is **not computable today**.

Until hook-side fingerprint storage lands, the round cap is the only convergence exit the hook observes at all — and even that one only *blocks* in `strict`/dual mode; under the default `warn` it prints to stderr and allows the stop. That is precisely why its counter must never be silently rewound (§2): **in warn mode the behaviour layer is the enforcement.** Consistent with [plan-review-loop tech spec](../plan-review-loop/2-tech-spec.md) OQ-9.

Row 2 of the decision table carries a related trap. `_update_iteration()` derives `total` by counting `- [P0]`/`#### P0`-style lines, so an output in any other shape (reviewer error, truncated response, a format change) yields a perfectly ordinary `0`. There is no `parse_ok` field to tell the two apart — which is why a zero must be corroborated by a passing gate verdict before it is read as convergence.

## 6. Max Rounds override — seeding vs reconciliation timing

Moved here from the `rules/auto-loop-project.md` template comments (R3 prose reduction). `## Max Rounds` is one switch driving BOTH caps: the behaviour-layer tier cap and the hook-persisted `iteration_history.max_rounds`. The hooks pick it up two different ways, and conflating them gets the timing wrong:

- **Seeding**: `init_state_file()`/migration read the override whenever state is CREATED, so any path that can create state seeds the cap from the file — a Markdown edit and an aggregate-only transition both call `init_state_file()` and so both qualify.
- **Reconciling** an already-persisted cap: exactly three entry paths — a code edit, a single-gate verdict write, an iteration write — which is what lets a changed value land mid-session instead of only at startup. Nothing else reconciles: not SessionStart (`session-init.sh` resets counters but preserves the cached cap), not a Markdown edit, not an aggregate-only transition, not the plan plane (NFR-7 forbids it), not Stop or PostCompact, which only read what is already there.

So editing `auto-loop-project.md`, itself a Markdown edit, has two outcomes: with state already present the new value takes effect on the FOLLOWING code edit or verdict/iteration write, not on the edit that set it; with no state file that same edit creates one and seeds it immediately. Neither delay binds the behaviour layer — the tier cap applies as soon as the rule has been read.

stop-guard checks the persisted cap either way, but only BLOCKS in strict or dual mode; the default warn mode reports to stderr and exits 0, so there the behaviour layer is the enforcement.
