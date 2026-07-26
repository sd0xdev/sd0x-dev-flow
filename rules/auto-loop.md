# Auto-Loop Rule ⚠️ CRITICAL

**Fix -> immediately re-review -> fail -> fix again -> ... -> ✅ Pass -> next step**

## Prohibited Behaviors

❌ **Fixing ≠ Verifying**: Claiming "issue fixed" or "already addressed" without running re-review is a violation. Every fix must be verified by invoking the review command — self-assessment does not count.
❌ **Skipping dual dispatch**: Code review commands must launch both Codex + secondary reviewer in parallel on every iteration (first pass AND loop re-reviews). Secondary is always dispatched in v1.
❌ Asking "Should I re-review?" or "Continue?" after fixing
❌ Asking "要執行嗎？" / "should I execute?" / any confirmation before required review steps — auto-loop mandates execution, not permission
❌ Stopping after outputting a summary without executing review
❌ Waiting for user instructions
❌ **Declaring as executing**: Saying "need to run X" without actually invoking the tool
❌ **Summary as completion**: Outputting a polished summary then stopping, without executing the next step
❌ **Context/token excuse**: Citing context window limits, long session, or token budget as reason to skip or defer review. If context is genuinely exhausted, the model must still attempt the review — failure to invoke is a violation regardless of reason. See @rules/context-management.md for measurement-based context policy.
❌ **Polished summary during active loop**: Outputting a completion-style summary (table, checklist, "all done" language) while fix-review-precommit cycle is still active. Brief operational status lines ("Fixed 3 issues, running review...") are allowed; terminal summaries are not until all gates pass.

> **Token budget advisory**: `<budget:token_budget>` tags in skill definitions are planning signals only. They never justify stopping, skipping review, or deferring auto-loop obligations. See @rules/context-management.md for full context policy.

## Auto-Trigger

| Change Type | Event              | Execute Immediately  |
| ----------- | ------------------ | -------------------- |
| code files  | Fix P0/P1/P2       | `/codex-review-fast` |
| code files  | review Ready + P2/Nit | P2/Nit Quality Sweep |
| code files  | review Ready (no P2/Nit) | `/precommit` |
| code files  | precommit Pass     | Adequacy Gate (if request doc) → Doc Sync |
| code files  | precommit failure  | Fix -> re-run        |
| `.md`       | Fix doc issues     | `/codex-review-doc`  |
| `.md`       | review failure     | Fix -> re-run        |

### Dual Review Mode

Code review commands dispatch two reviewers in parallel. This section defines the interaction with auto-loop.

| Rule | Description |
|------|-------------|
| First-pass dual | Code review command must dual-dispatch on first pass (Codex + secondary background) |
| Non-blocking secondary | Secondary reviewer runs in background and does not block initial gate emission |
| Late P0/P1 | Within same review session, late secondary P0/P1 re-opens fix→re-review loop |
| Loop re-review | `--continue` loops re-dispatch both reviewers (Codex `--continue` + secondary fresh). Secondary is always dispatched in v1 (no skip exception). |
| Pre-precommit checkpoint | Before `/precommit`, reconcile any pending secondary result; if late P0/P1, re-enter review loop |
| Cycle reset | Any code edit resets the review cycle — both reviewers must re-run regardless of prior pass status |

## P2/Nit Quality Sweep

**Gate ✅ Ready + P2/Nit exists → batch fix → verify → precommit**

When Codex review returns `✅ Ready` but findings include P2 or Nit items:

| Step | Action | Detail |
|------|--------|--------|
| 1 | Batch-fix | Fix all P2/Nit in one pass (1 attempt) |
| 2 | Verify | 1 batched Codex `--continue` re-review |
| 3 | Evaluate | Check resolution status |
| 4 | Continue | Proceed to `/precommit` or stop |

### Resolution Evaluation

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | Unresolved P2 | ⚠️ Need Human — stop, report reason |
| 2 | Unresolved Nit only | Continue — Nit exemption with log |
| 3 | All resolved | `/precommit` |

### Nit Exemption Log

When unresolved Nit items are exempted, output structured log:

```
[NIT_DEFERRED] file:line | issue | reason: possible-false-positive | timestamp
```

### No P2/Nit Path

Gate ✅ Ready + no P2/Nit → directly `/precommit` (unchanged behavior).

## Exit Conditions

**Convergence decision table** (authoritative — mirrors tech-spec §3.3 T1). Each iteration evaluates the conditions top-to-bottom; first match wins. State lives in `.claude_review_state.json` `iteration_history`.

| # | Condition | Action | Rationale |
|---|-----------|--------|-----------|
| 1 | `current_round >= max_rounds` | ⚠️ Need Human | Hard cap, **hook-detected** by `stop-guard.sh` — advisory in the default `warn` mode (stderr warning, exit 0), blocking only in `strict` or dual-review mode. Default 10, configurable via `## Max Rounds` in `auto-loop-project.md`. Tracked via `iteration_history.current_round`. |
| 2 | `findings_by_round[n].total == 0` AND the gate verdict itself passed | Proceed to `/precommit` | All findings resolved this round; early-exit optimization. **The count alone is not proof**: `_update_iteration()` derives `total` by counting `- [P0]`/`#### P0`-style lines, and an output in any other shape (reviewer error, truncated response, a format change) yields a perfectly ordinary `0`. There is no `parse_ok` field to tell the two apart, so a zero must be corroborated by a passing `✅ Ready` / aggregate gate before it is read as convergence. |
| 3 | `total >= prev_total` AND fingerprint overlap >= 50% for 3+ consecutive rounds | ⚠️ Need Human | Plateau — same issues recurring despite fixes. Would be tracked via `iteration_history.findings_by_round[].fingerprints`. **V2 — not yet implemented** (see note below). |
| 4 | `total >= prev_total` AND fingerprint overlap < 50% for 3+ consecutive rounds | Continue | New issues appearing, not plateau. **V2 — not yet implemented.** |
| 5 | `total < prev_total` | Continue | Converging toward zero. |
| 6 | `total == null` (parse failure) | Continue | Non-computable; rely on hard cap (row 1). Defensive only — `_update_iteration()` writes `total` as an integer sum of the P0/P1/P2/Nit counts, so a null reaches this row only from a hand-edited, legacy, or corrupt state file. |

> **Rows 3–4 are a V2 design target, not current behavior.** `_update_iteration()` stores per-round counts and timestamps but no `fingerprints` array, so overlap is not computable today. Until hook-side fingerprint storage lands, **row 1 is the only convergence exit the hook observes at all** — and even that one only *blocks* in `strict`/dual mode; under the default `warn` it prints to stderr and allows the stop. That is precisely why its counter must never be silently rewound (see Round counter lifecycle): in warn mode the behaviour layer is the enforcement. Consistent with [plan-review-loop tech spec](../docs/features/plan-review-loop/2-tech-spec.md) OQ-9.

### Round counter lifecycle

`current_round` counts rounds **within one convergence loop**, not edits.

| Event | `current_round` | `total_rounds_session` |
|-------|-----------------|------------------------|
| **Code**-review iteration (`_update_iteration()`), passing or not | +1 (best-effort — see below) | +1 (same) |
| Doc review (`/codex-review-doc`), passing or not | unchanged | unchanged |
| Code edit (`post-edit-format.sh`) | unchanged | unchanged |
| Convergence — **`precommit`** passes **while the counter is valid and below the CLAMPED cap** | reset to 0 | unchanged |
| Convergence — same, but the counter is invalid or has reached the clamped cap | **not reset** (see note) | unchanged |
| New session (`session-init.sh`) | reset to 0 | preserved |

The `+1` is **best-effort, not guaranteed.** `_update_iteration()` degrades to a no-op (returns 0, never aborts the hook) when the state file is absent, when `_lock` times out against a concurrent writer, when `mktemp` fails, when the `jq` rewrite fails, or when the final rename fails — each path logs to stderr and leaves the counter where it was. (The absent-state and rename paths were silent until 2026-07-25; the rename one additionally reported *success* under `HOOK_DEBUG=1`, which is why a hard cap that never fired was undiagnosable from the logs.) A skipped increment always *undercounts*, so the effect is a hard cap reached later than the nominal `max_rounds`, never earlier. The same applies to any code-review verdict that is dropped upstream (unanchored command, MCP output with no Merge Gate): no verdict recorded means no `_update_iteration()` call, hence no round. Treat `current_round` as a lower bound on rounds actually run.

`_update_iteration()` is called from the code-review branches only (Bash and MCP), on **both** the pass and fail paths — a `⛔ Blocked` round costs budget exactly like a `✅ Ready` one. The doc-review branches record their verdict without touching `iteration_history`, so a doc-only loop has no round budget and never reaches the row-1 hard cap — it converges on `✅ Mergeable` or not at all. A passing `doc_review` does **not** reset `current_round`, even though it is a terminal gate. `current_round` is a **code** counter — only the code-review branches increment it — so letting a doc gate zero it is a cross-plane refund. It was one until 2026-07-25, and the consequence was concrete: with `code_review.passed = false` at round 9 of 10, one passing `/codex-review-doc` rewound the round to 0 and emptied `findings_by_round`, so repeated doc passes held an unconverged code loop permanently below row 1 — the only convergence exit that is actually enforced. A doc-only session is unaffected in either design: it never increments the counter, so there was never anything for its reset to do.

The reset is **gate-conditioned and validity-conditioned**, both in `update_state()`'s jq filter. The passing gate must be `precommit` specifically (`$passed == true and $key == "precommit"`) — no other terminal gate qualifies. And the counter must be one stop-guard would itself accept as unspent: the writer **mirrors the reader's `ITER_PARSED` validation** — object-typed `iteration_history`, a `number` that is integral and in range, and `current_round` below the cap **after the cap is clamped to the producer contract 3..50**. The mirror is load-bearing because the writer runs first: a guard that merely checked `type == "number"` against the raw `max_rounds` reset `{current_round: 51, max_rounds: 100000}` to a clean `0`, while the reader clamps that cap to 50 and reads the same state as an exhausted budget — the writer was refunding, from under the reader, the only convergence exit actually enforced. One asymmetry inside that mirror is easy to get backwards and was, briefly: jq preserves each number's **literal** form (`1e2` stays `1E+2`), and the reader's last gate is a bash regex over the pair it emits. `current_round` reaches that regex verbatim, so its raw literal must be digits-only — but the cap does **not**: the reader clamps it first, and only the clamp's *output* is interpolated. Canonicality must therefore be tested on the raw `current_round` and on the **clamped** cap. Testing the raw cap reopened the same class of divergence pointing the other way: `{current_round: 4, max_rounds: 1e2}` reads to stop-guard as a valid, unspent `4 50`, while the writer refused to reset on `1E+2` — so the loop walked to the cap and latched on `⚠️ Need Human` with no visible cause. A counter that fails any of these checks simply does not qualify for the reset and survives intact for stop-guard to keep flagging. Both filters are pinned to the same answers under real `jq` by `test/hooks/jq-filter-fidelity.test.js`. Once the counter reaches the clamped cap the reset stops applying even when precommit passes: at that point the loop has already been escalated to a human, and letting a single passing precommit refund the whole budget would hand the same unbounded loop back to the model. "Latched" here means the **reset no longer fires**, not that the number is clamped — nothing pins it to `max_rounds`, and under the default `warn` mode (where row 1 only prints to stderr) the counter keeps incrementing past the cap on every further code-review round. A value above `max_rounds` is therefore normal and is not evidence of corruption. Clearing a latched counter is a human action — start a new session, or edit `iteration_history.current_round` deliberately.

A code edit is a step *inside* the loop (review → fix → re-review), so it must not refund the round budget — resetting there made the row-1 hard cap unreachable, since auto-loop always edits between reviews. `findings_by_round` follows the same lifecycle and is capped at the 50 most recent entries.

**Advisory exits** (orthogonal to convergence — do not depend on `iteration_history`):

- ✅ All Pass
  - Code changes: review + precommit all passed
  - Doc changes: doc review passed
- ⛔ Need Human — Architecture changes, feature removal, user requests stop
- ⚠️ Need Human — Feature docs not found (3-level fallback exhausted)
- ⚠️ Need Human — P0/P1 dismiss candidate awaiting human confirmation (via `/seek-verdict`)

## Strategic Reset (opt-in, near-cap)

When `total_rounds_session >= max_rounds - 3` and `strategic_reset_fired = false`, the post-compact hook injects a `[STRATEGIC_RESET]` checklist. This fires once per state-file lifetime (reset when the state file is recreated).

Enable via `auto-loop-project.md`: `## Think Harder: enabled`

The checklist prompts re-reading original requirements, challenging assumptions, and trying fundamentally different approaches before escalating at max_rounds.

`total_rounds_session` is incremented alongside `current_round` on every **code**-review iteration that `_update_iteration()` actually commits (see the best-effort caveat under Round counter lifecycle) and is **never** reset — not on code edits, not on convergence, not on session start (unlike `current_round`, see Round counter lifecycle above). This ensures the strategic reset fires based on cumulative effort, not per-cycle effort.

## Correct Behavior

```
"Fixed 3 issues, running /codex-review-fast..."
[Execute: Codex --continue + Secondary fresh — parallel dispatch]
"Codex: ✅ Ready. Secondary: ✅ Ready. Running /precommit..."
[Execute]
"All passed ✅"
```

## ⚠️ Behavior Anchor: Execute Within the Same Reply

### Correct Pattern

```
[Edit complete] -> Invoke review tool in the same reply -> Wait for result -> Report
```

```
Claude: [Edit tool complete]
        ↓
        "Updated, running review..."
        ↓
        [Skill tool: /codex-review-doc]  <- Same reply
        ↓
        "Review passed ✅" or "Issues found, fixing..."
```

### Incorrect Pattern

```
[Edit complete] -> Output summary -> [Stop] -> User follows up -> Then execute review
```

```
Claude: [Edit tool complete]
        ↓
        "Updated requirements doc ✅"
        ↓
        [Output polished table summary]
        ↓
        "Next step: suggest running /codex-review-doc"  <- ❌ Declaring as executing
        ↓
        [Stop, waiting for user]  <- ❌ Violates rule
```

### Key Principles

| Principle                  | Description                                                      |
| -------------------------- | ---------------------------------------------------------------- |
| **Declaring ≠ Executing**  | Saying "need to run" does not equal having run it                |
| **Summary ≠ Completion**   | After outputting a summary, the review process is still ongoing  |
| **Execute in same reply**  | After Edit completes, must invoke review tool in the same reply  |
| **Stop only on result**    | Can only stop after seeing review result (Pass/Fail)             |

## Enforcement Mechanism

### Three-Layer Defense

```
[Edit/Write] -> [PostToolUse Hook] -> [State file update]
                                          ↓
[Context Compact] -> [SessionStart compact] -> [Re-inject auto-loop from state]
                                          ↓
[Stop Hook] <- Read state file <- [Review command executed]
```

| Layer       | Mechanism                          | Trigger              |
| ----------- | ---------------------------------- | -------------------- |
| PostToolUse | Track file changes + review result | Edit/Bash execution  |
| SessionStart (compact) | Re-inject auto-loop rules after compaction (stdout → context) | Context compaction |
| Stop Hook   | Warn before stopping if review pending (strict mode: block) | When attempting stop  |

### State File Schema

**File**: `.claude_review_state.json` (locally ignored)

```json
{
  "session_id": "abc123",
  "updated_at": "2026-01-26T10:00:00Z",
  "has_code_change": true,
  "has_doc_change": false,
  "code_review": {
    "executed": true,
    "passed": true,
    "last_run": "2026-01-26T10:00:00Z"
  },
  "doc_review": { "executed": false, "passed": false },
  "precommit": {
    "executed": true,
    "passed": true,
    "last_run": "2026-01-26T10:01:00Z"
  }
}
```

> **Note**: The above is an **abridged illustration**, not the full schema. The creation shape is the heredoc in `init_state_file()` (`hooks/post-tool-review-state.sh`), which additionally carries `review_mode`, `aggregate_gate`, `plan_review`, `iteration_history`, and `schema_version`. Further keys appear at runtime as their owners write them — `review_phase` (gate transitions), `changed_files_since_review` (edit tracking — written by `post-edit-format.sh`, cleared by `_reset_changed_files()`), `session_commit_scope` (`session-init.sh`). Each hook writes only the subtree it owns.
>
> All **four** hooks that write this file — `post-tool-review-state.sh`, `post-edit-format.sh`, `post-compact-auto-loop.sh`, `session-init.sh` — coordinate on the shared `${STATE_FILE}.lockdir`. `session-init.sh` was the exception until 2026-07-26: it rewrote the *whole* file on a session change without taking the lock, so a verdict committed between its `jq` read and its `mv` was silently clobbered by the reset. On contention it now skips the reset rather than writing unlocked; the retained state is safe because the stale gate values only matter once something is edited, and the edit hook invalidates them first.

### Fail-Closed Sidecar

**Files**: `${STATE_FILE}.blocked` — one reason per line, treated as a **set**, not a scalar — **plus** per-event emergency markers written as **sibling files** named `${STATE_FILE}.blocked.event.<stem>`, one reason per file. The two are read as a single union; every reader consults both.

When a hook cannot durably record a state transition (lock lost, `mktemp` failed, `jq` failed, state file uncreatable), it records a marker here instead of failing silently.

**Why there are two files, not one.** The shared `.blocked` file is rewritten or removed **wholesale** by a clearer holding the lock. That is only sound if every writer is serialized too, and the setter's last-resort path deliberately was not: on lock timeout it appended anyway, because dropping a marker is worse than duplicating one. A whole-file rewrite therefore raced an unserialized append, and no amount of re-reading closes that — the clearer's final snapshot is a subprocess, so an append landing between that read returning and the `rm`/`mv` is invisible to it and is then erased. Three rounds narrowed the window without removing it, which is what check-then-act always does.

The last-resort path no longer touches the shared file. It creates its own file under a name no other writer will choose, so creation and retirement act on **disjoint names** and cannot destroy one another. Two consequences follow, and both matter:

| | Effect |
|---|---|
| Shared file | Now has **no** unserialized writers, which is what makes the clearers' snapshot comparison sufficient rather than merely narrow |
| Spin budget | Setters are back to the default 20 spins (~2 s). They briefly used 70 to out-wait `session-init.sh`'s `timeout 5` tree scan; that only bought anything while a timeout meant a lose-able append. It also **cost** something: setters call the sidecar lock *inside* the state lock, so a transaction with four failing writes waited 4 × 7 s — measured at 29.95 s against `LOCK_TTL=30`, running itself to its own takeover threshold. `test/hooks/post-edit-format.test.js` derives that bound from the three constants rather than restating a number. |

**A timeout was not the only way to become unserialized.** The row above was written when it was, and it was wrong for the second case: a setter that *acquired* the lock and was then **displaced** — `_sidecar_lock` reclaims on age alone, and setters run inside the state lock, whose TTL is the same 30 s, so a slow transaction can drift past its own sidecar lock's expiry — appended anyway, because nothing between `mkdir` and `>>` re-read the owner token. One live displaced holder falsifies "no unserialized writers" just as completely as the timeout path did, and it is the harder one to see, because the process genuinely did hold the lock at the moment it decided to write. `_set_own_sidecar_locked` now re-checks ownership immediately before its first mutating statement and returns a distinct `rc=3`, which the caller diverts to a per-event marker with its own diagnostic. The clearers already carried the mirror-image check; the setter is what was missing. This narrows the window to two adjacent statements rather than closing it — a takeover between the check and the `>>` remains, and is the same residual the state lock's own pre-commit re-check carries.

**Sibling files, not a marker directory.** The per-event plane is `${STATE_FILE}.blocked.event.<stem>` alongside the state file, and that is a security boundary rather than a layout preference. An earlier `.blocked.d/` directory made the orphan clear a `rm -f "$dir"/…`, which resolves **through** a symlink at `$dir` and unlinks the *target's* files — so a symlink committed at `.blocked.d` turned the clear into "delete every regular file in an arbitrary directory". Git stores symlinks, and `.claude_review_state.json.*` is gitignored, so cloning the repo was enough to arm it. `rm -f` on a symlink **file** unlinks the link and never its target, so the same accident against a sibling name destroys nothing. An `lstat` guard on the directory would not have been equivalent: that is check-then-act, and the name can be swapped between the check and the `rm`.

Per-event markers are retired **only** by `session-init.sh`'s orphan clear, and only the specific filenames that clear enumerated — one created afterwards has a name the retiring loop never saw. Its precondition (a new session over a tree with no dirty reviewable file) is the one under which every marker is an orphan by definition. For the lock-timeout case they are rare, so holding one until the next clean session over-blocks briefly and in the safe direction.

That "rare" does **not** transfer to the other way a per-event marker is created, and the difference is worth stating because the lifetime is the same while the cost is not. A lock timeout is a transient race that resolves itself; the write-failure divert fires on a **persistent local condition** — a directory or an unwritable file sitting at the shared `.blocked` name — which recurs on every call for as long as it lasts. Two consequences follow. Each failing call adds another undeduplicated marker file rather than re-raising one. And because a per-event marker is invisible to the ordinary retirement paths, the session stays in strict mode even after the verdict that the marker stood in for lands successfully: `_clear_own_sidecar` operates on the shared file alone, so the successful write that supersedes a `verdict_write_failed:*` cannot retire its private twin. Both are fail-closed, and deliberately so — the divert exists precisely because the ordinary bookkeeping could not be trusted to run — but the escape is a human one (fix the path, then start a session over a clean tree), not something the next passing gate will clear.

Stop-guard reads the sidecar and **invalidates the affected gate in every case**. Whether that invalidation also *blocks* depends on which markers are present:

| Sidecar contents | Gate | Mode |
|------------------|------|------|
| Only transient markers (see **Transient allowlist** below) | Invalidated | Unchanged — `warn` still warns and exits 0 |
| Any non-transient marker, or a **mix** of transient and non-transient | Invalidated | Escalated to `strict`, overriding the configured `GUARD_MODE` |
| Present but **empty or unreadable** | Invalidated | Escalated to `strict` — a file that exists but yields no lines is itself evidence of a failed write |

"Forces strict blocking regardless of `GUARD_MODE`" was written here as an unconditional claim, and it is wrong in the first row: the transient allowlist exists precisely so a lock contention that resolves itself does not override a user's `warn` preference.

Markers are **keyed by the plane that wrote them**, because the two writing hooks invalidate different gates. An unkeyed marker let a *doc* edit retire evidence of a lost *code* verdict — fail-OPEN, since the previous round's `✅` survived. Losing a `PASS` is safe (the gate stays unsatisfied and is re-requested); losing a `⛔` is not.

| Plane | Markers | Cleared by |
|-------|---------|-----------|
| Edit — code | `edit_lock_contention:code`, `state_init_failed:code`, `state_write_failed:code` | A committed **code**-edit transaction (`post-edit-format.sh`), or `session-init.sh`'s clean-tree check |
| Edit — doc | `edit_lock_contention:doc`, `state_init_failed:doc`, `state_write_failed:doc` | A committed **doc**-edit transaction, or the same session check |
| Verdict | `verdict_write_failed:code_review` / `:doc_review` / `:precommit` | The next successful write of **that same gate**; also by the edit transaction that invalidates that gate (code branch → `code_review` + `precommit`; doc branch → `doc_review`) |
| Aggregate gate | `lock_failure`, `aggregate_write_failed` | A **committed** aggregate transition (`update_aggregate_gate`), **or** a committed edit transaction on either plane (`post-edit-format.sh`) — both branches reset `aggregate_gate` to `executed=false`/`gate=null`, which is the same fail-closed value the lost transition would have left. A single-*review* write does **not** qualify: it never touches `aggregate_gate`, so erasing the marker there would drop a lost dual-gate transition. |

The "Cleared by" column describes markers in the **shared** file. A marker that took the per-event path carries the same reason string but a different lifetime: it is retired only by `session-init.sh`'s orphan clear, never by the gate write or edit transaction that would have retired its shared-file twin. That is deliberate — the per-event path is taken precisely when the ordinary bookkeeping could not be trusted to run.

**Transient allowlist**: stop-guard treats `edit_lock_contention:code`, `edit_lock_contention:doc`, and `lock_failure` as transient — a sidecar containing *only* these does not force strict mode. Any other marker, or any mix, does. An **empty or unreadable** sidecar escalates (`_SIDECAR_LINES_SEEN == 0` → not-all-transient): a file that exists but yields no lines is itself evidence of a failed write.

Every sidecar mutation in all three writing hooks reaches for a dedicated `mkdir`-based lock (`SIDECAR_LOCKDIR`): **the same protocol in each of the three copies**, same directory name and TTL, because a lock only some writers take excludes nothing. The two halves then diverge deliberately, and the difference is the fail-closed direction of each:

| Half | Lock unavailable | Why |
|------|------------------|-----|
| **Set** (`_set_own_sidecar`) | Writes a **per-event marker** instead and logs it | Declining would DROP the marker, and a marker exists only because a blocking verdict was already lost. Writing it to a private filename means the fallback is not merely tolerable but race-free: no clearer can retire a name it never enumerated. This row previously read "appends unserialized" — harmless-sounding, and the source of the one window that survived three rounds of narrowing. |
| **Clear** (`_clear_own_sidecar`) | Declines — the set is retained | A clear removes evidence. Doing that unserialized can erase a line another writer added between the read and the rewrite. |

Ownership-aware clears commit via `mktemp` + `mv`; a clear that cannot stage its rewrite **retains the full set** rather than dropping it.

The per-event marker is not only the lock-unavailable fallback. A setter that *holds* the lock and still cannot write the shared file **diverts to the same private marker**, for every failure — not just the symlink refusal. The two are reported separately because they mean different things (a symlink must not be written *through*; an ordinary failure was attempted and failed), but they no longer differ in whether the evidence survives. Restricting the divert to the symlink case read as "an ordinary write failure means nothing can be written at that path", and that inference does not hold: the shared sidecar has one fixed name, so a **directory** sitting on it fails the append with `EISDIR` while `_sidecar_emergency_mark` — which needs neither `mktemp` nor a lock, only a sibling filename — would have succeeded right beside it. Under the old rule the marker was dropped there, and `post-tool-review-state.sh`'s aggregate caller then read the empty sidecar plane as *total persistence loss* and escalated a recoverable condition to a blocking `exit 2`. That escalation is also what makes the `exit 2` branch's own reasoning sound: it infers "no on-disk channel remains" from the emergency marker having failed, which is only true if the emergency marker is always **attempted**.

It is deliberately **not** the same protocol as the state lock, in two respects worth knowing when debugging:

| | State lock (`${STATE_FILE}.lockdir`) | Sidecar lock (`${STATE_FILE}.blocked.lockdir`) |
|---|---|---|
| Staleness | TTL **or** dead owner (`pid` file + `kill -0`) | TTL only — no `pid` file, so a writer killed mid-section wedges every sidecar mutation for the full 30 s rather than being reclaimed by the next contender |
| Retry budget | `REVIEW_STATE_LOCK_TIMEOUT` seconds (env-overridable; the hook suites set `0`) | Fixed 20 spins (~2 s) — the env override has no effect on this path |

**State-lock ownership.** Acquisition writes a per-process `owner` token; release removes the directory only when that token still matches. Two consequences the old flag-based release did not have: a process whose lock was taken over no longer deletes its successor's lock on the way out, and each committing `mv` re-checks ownership so a displaced writer degrades through the fail-closed handler (a marker, or a logged skip) instead of committing over a live transaction. Stale recovery takes the lock by **renaming it aside** to a process-unique tombstone rather than `rm -rf` + `mkdir`: the delete-then-create pair let two contenders that both judged the lock stale each enter the critical section. A takeover between the ownership re-check and the `mv` remains a residual of the same check-then-act shape the lock itself has — narrowed, not closed.

`session-init.sh` is the one full-file delete, and it is correct *only* under its precondition: it removes the sidecar when a new session finds the working tree free of dirty reviewable files, at which point every marker — whatever plane wrote it — is by definition an orphan, because no dirty file remains for any of them to stand in for. Its `git status -uall` scan runs **inside** the lock, not before it; scanning first left a seconds-wide window in which a concurrent `verdict_write_failed:*` append was unlinked, retiring evidence of a lost blocking verdict whose gate still read `passed=true`. Lock unavailable → the sidecar is retained.

### Debug and Escape Hatch

| Environment Variable | Purpose                   | Use Case        |
| -------------------- | ------------------------- | --------------- |
| `HOOK_DEBUG=1`       | Output debug information  | Troubleshooting |
| `HOOK_BYPASS=1`      | Skip Stop Hook checks     | Emergency       |

### Standard Gate Sentinels

Review commands must output standard markers. "Hook-parsed" spans two distinct consumers, and the difference matters when debugging a gate that did not fire:

| Role | Owner | What it does |
|------|-------|--------------|
| Producer | Review skills | Emit the sentinel in their output |
| State writer | `post-tool-review-state.sh` (PostToolUse) | Parses the tool output and records the verdict into `.claude_review_state.json` — this is where a sentinel becomes durable |
| Primary enforcer | `stop-guard.sh` (Stop) | Reads the **state file**; it does not re-parse reviewer output when state exists |
| Fallback parser | `stop-guard.sh`, transcript mode | Only when there is no readable state file: scans `tail -500` of the JSONL transcript for sentinels and command names, and **pairs** each verdict with the invocation it is credited to (see below) |

> **Transcript verdict/invocation pairing**: the fallback's two scans used to be position-blind — "does a verdict appear anywhere" and "does the command appear anywhere", never related in time. A transcript reading `/precommit-fast` → `## Overall: ✅ PASS` → `/precommit` therefore satisfied the gate for the *newer* invocation using the *older* run's verdict, and the `PRECOMMIT_REQUIRE_FULL` branch — which reads the variant off that same trailing invocation — then declared the full gate met. Two checks, both satisfied, zero evidence. The code and doc planes had the identical shape. A verdict now counts only when it appears **after** the last matching invocation; unpaired reads as absent, i.e. `(invoked, no verdict)`. The comparison is by **byte offset**, not line number: the transcript is JSONL, so one line packs a whole message and a report of the previous gate routinely shares a line with the announcement of the next command — line granularity therefore had to accept equality, and accepting equality is exactly what let the older run's verdict through. Both the command and the verdict scans run on the **plan-sentinel-stripped** stream, because stripping deletes bytes and measuring one side on the raw transcript would read the two off different rulers, letting upstream plan-review output push a genuine verdict behind its own invocation. **Known over-block (deliberate)**: the command detectors match prose, so `/precommit` written in a summary *after* a passing run re-opens the gate — the same weakness the `(invoked, no verdict)` branch already had for mentions *before* a verdict, and fail-closed in the same direction. The state-file branch pairs by construction and is unaffected.

Behavior-layer sentinels are consumed by Claude's auto-loop logic only — no hook reads them.

| Sentinel | Context | Meaning | Parsed by |
|----------|---------|---------|-----------|
| `✅ Ready` | Code review | No P0/P1 | Hook + behavior |
| `⛔ Blocked` | Code review | Has P0/P1 | Hook + behavior |
| `✅ Mergeable` | Doc review | No 🔴 items | Hook + behavior |
| `⛔ Needs revision` | Doc review | Has 🔴 items | Hook + behavior |
| `## Overall: ✅ PASS` | Precommit | All checks passed | Hook |
| `## Overall: ⛔ FAIL` / `## Overall: ❌ FAIL` | Precommit | Check failed | Hook |
| `## Overall: ⚠️ NO CHECKS RUN` | Precommit | Non-verdict — no runnable checks; no state recorded | Hook |
| `⚠️ Need Human` | Any | Needs human intervention | Behavior-layer only |
| `✅ Plan Ready` | Plan review (requires `## Plan Review` header) | No P0/P1, plan converged | Hook + behavior |
| `⛔ Plan Blocked` | Plan review (requires `## Plan Review` header) | Has P0/P1, loop continues | Hook + behavior |
| `⚠️ Plan Needs Human` | Plan review | max_rounds reached without convergence | Behavior-layer only |
| `[PLAN_REVIEW_DEGRADED]` | Plan review | Reviewer unavailable or secret detected (fail-closed) | Hook + behavior |
| `[PLAN_REVIEW_SKIPPED]` | Plan review | User-intent bypass | Hook + behavior |

> **Precommit anchoring — state writer**: in `post-tool-review-state.sh` the precommit sentinel is the WHOLE line `## Overall: ✅ PASS` — matched at column 0, last `## Overall:` line wins, and **nothing may follow it** on that line. A prefix match would let the `## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN` template line in `skills/precommit/SKILL.md` bank a pass, and taking the first match instead of the last would let a `## Overall: ✅ PASS` inside the runner's embedded test tail mask a real final `❌ FAIL`. The bare phrase `✅ All Pass` in **Advisory exits** above is behavior-layer prose for "every gate passed" — it is *not* the precommit sentinel, and **no hook treats it as a verdict**. Be precise about the scope of that claim, because one grep does still contain the phrase: `post-tool-review-state.sh`'s `_skill_output_has_verdict()` lists it among the markers that distinguish a real review verdict from a Skill *launch acknowledgement*. That is a presence test — "is this output a verdict at all", deciding whether to parse further — not a classifier, and it decides nothing about pass or fail. The classification below it drops the phrase outright, which is what "no hook reads it" was always meant to say. An earlier version of this sentence claimed no hook scan matched it *at all*, which was flatly false, and before that it was untrue in the way that actually mattered: `stop-guard.sh`'s two **coarse, plane-agnostic** transcript scans (`REVIEW_PASSED` and `LAST_REVIEW`) both listed it among their passing patterns. In `LAST_REVIEW` that mattered in the wrong direction — `tail -1` takes the last matching line, so a message ending in the phrase out-ranked an earlier `⛔ Blocked` and cleared the coarse `BLOCKED_REASON`. The additive per-plane scans that run afterwards still caught that case, so it was not a live bypass; it was removed because a phrase the model emits freely in prose should not be able to out-rank a real verdict, and because a rule claiming "no hook reads it" while two greps did is a gap that only gets noticed once it matters.
>
> **Precommit anchoring — transcript fallback**: `stop-guard.sh`'s fallback cannot reuse that parser. It reads `tail -500` of a **JSONL** transcript, where a genuine sentinel sits inside a JSON string on a line beginning with `{`, so literal column-0 anchoring (`^`) would match nothing in production while still passing plain-text fixtures. It instead demands the sentinel both **start** and **end** a line, in whichever of the two encodings applies. Leading: `^`, a literal `\n` escape, or the opening `"` of the JSON string. Trailing: end-of-line, a literal `\n` escape, or `"`. **Both groups are load-bearing** — with only the trailing one, a narration *ending* in the sentinel (`…I'll report ## Overall: ✅ PASS`) still matched, and since it carries no FAIL marker `tail -1` let it override an earlier real `⛔ FAIL`. With both, prose mentions fail on the leading side (they are preceded by a space or a backtick), so ``I'll print `## Overall: ✅ PASS` when green`` is rejected. Command detection in the same mode uses a "not a command-name character" boundary for the same reason: `"/precommit"` and `<command-name>/precommit</command-name>` are the shapes a real transcript actually contains.
>
> **Plan namespace isolation**: plan sentinels live in the `plan_review.*` state subtree and never touch `code_review` / `doc_review` / `aggregate_gate`. Plan-review output must never contain bare `✅ Ready` / `✅ Mergeable` / `## Gate:` / bare `⛔ Blocked`. Stop-guard treats a pending plan review as **warn-only** (never blocks). Gate transitions flow through `scripts/emit-plan-gate.sh`; see `skills/plan-review/SKILL.md`.

### Adequacy Gate (behavior-layer, request-doc-aware)

After precommit Pass, if a request doc with `## Acceptance Criteria` is detected:

| Step | Action |
|------|--------|
| 1 | Auto-detect request doc (3-level fallback, same as doc sync) |
| 2 | `/codex-test-review --ac-trace <request-path>` |
| 3 | Evaluate gate (mode from `testing-project.md ## Adequacy Mode`) |

**Mode behavior**:

| Mode | ✅ Adequate | ⚠️ Adequate with exceptions | ⚠️ Need Human | ⛔ Inadequate |
|------|------------|--------------------|--------------| --------------|
| advisory (default) | Continue | Continue + log | Warn + continue | Warn + continue |
| strict | Continue | Continue + log | **Stop** (blocking) | Re-enter fix loop |
| off | Skip | Skip | Skip | Skip |

**Detection**: No request doc with AC section → skip (no gate). Same 3-level fallback as Doc Sync: context → git diff → `⚠️ Need Human`.

**v1 scope**: Behavior-layer only (no hook enforcement). Advisory mode default. Strict opt-in via `testing-project.md`.

### Doc Sync Note

Doc Sync is a **behavior-layer rule** (not hook-enforced). After precommit Pass, only when the change maps to a feature under `docs/features/`, auto-trigger:

1. `/update-docs <tech-spec-path>` — Incremental update of changed sections
2. `/create-request --update <request-path>` — Update Progress / Status / AC (e.g. `docs/features/<feature>/requests/<date>-<title>.md`)

**Target detection**: 3-level fallback (context → git diff → ⚠️ Need Human). See `/update-docs` for algorithm details.

**Safety valve**: After doc sync, compare code diff against pre-sync baseline; if new code changes exist, return to review loop. See `/update-docs` Safety Valve section.

## Project Customization

Project-specific overrides belong in `auto-loop-project.md` (not this file).
See `@rules/auto-loop-project.md` for your project's custom auto-loop behavior.
