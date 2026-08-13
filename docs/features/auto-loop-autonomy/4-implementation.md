# Auto-Loop Autonomy — Implementation Notes

> **Status: Historical（2026-08-13, hook-lightweighting）** — 本文描述的 hook 端記帳（progress
> ledger、stall 發射器、checkpoint 旗標）已退役；行為層準則（診斷分類、anti-loop budget、
> 三輪停滯門檻）存續於 `rules/auto-loop.md`，改由模型自行記帳。全文保留作考古記錄。
> 現行契約：`docs/features/hook-lightweighting/2-tech-spec.md`。

Archaeology for decisions the hooks reference by pointer. Requests R1–R10 live in `./requests/`;
the consolidated spec is `./2-tech-spec.md`.

> **Size** — 544 lines (`wc -l`, 2026-08-08), past the 500 in `@rules/docs-numbering.md` § Size Limit,
> and **kept whole deliberately for now**. The sections are independent (§1 = R6, §2 = R9, §3 = R10),
> so this file is a genuine split candidate rather than one long argument — the split is owed, not
> excused.
>
> ```
> [DEVIATION] rule=@rules/docs-numbering.md § Size Limit  default=past 500 lines, split is the default
> chosen=keep whole this round; record the target shape and the trigger (before R11 adds a section)
> reason=the cut is its own change with its own review, not a tail-end edit appended to this one
> signal=wc -l = 544; 13 inbound references across 9 files, measured below
> ```
>
> § Size Limit requires repointing links in *both* directions, and
> `grep -rn 'auto-loop-autonomy/4-implementation.md' . --exclude-dir=node_modules --exclude-dir=.git`
> reports **15 references in 11 files** (2026-08-08). Two of those are self-mentions that no move has
> to repoint — this note's own grep line, and the path written into the R10 ticket's Deferred
> Findings row — leaving **13 real inbound references across 9 files** (references by directory:
> `docs/` 4, `hooks/` 4, `test/` 3, `rules/` 2 — these sum to the 13, not the 9). The `hooks/` ones
> are comments, which the comment-block checker also reads.
> Shape to produce: `4-implementation/` with `4-implementation.md` as the main file and
> `1-cap-diagnosis.md` / `2-progress-ledger.md` / `3-stall-detection.md` beneath it.

## 1. The mid-loop diagnosis checkpoint

R6 (`./requests/2026-07-26-cap-diagnostic-protocol-r6.md`) defined the Cap Diagnostic Protocol as a
**behaviour-layer** obligation that fires at the round cap. The hook side was built as one
*auxiliary* injection in `post-compact-auto-loop.sh`. Three properties of that first build meant the
protocol could not, in practice, fire before the cap:

| Property | Consequence |
|----------|-------------|
| Runs only in the `SessionStart:compact` hook | A loop that never compacts never sees it. Compaction is not correlated with being stuck |
| Gated on `## Think Harder: enabled` | Opt-in, and unset in the shipping scaffold — so off by default |
| Threshold `total_rounds_session >= max_rounds - 3` | Two failures at once, below |

### 1.1 Why `current_round`, not `total_rounds_session`

`total_rounds_session` is **cumulative across the state file's lifetime, spanning sessions** —
`hooks/session-init.sh` zeroes `current_round` at SessionStart but deliberately leaves this one
alone (`:3`), so it is even further from "rounds on this change" than the name suggests; `current_round` counts
rounds on **this** change and resets when precommit passes. The diagnosis is about *this change* not
converging — "have I been circling the same defect?" — so a session-cumulative counter answers a
different question. Concretely, on a long session it fires on effort already spent on changes that
have since passed their gates, and it cannot express a fixed round at all: with
`max_rounds - 3` clamped up to 1 (`hooks/post-compact-auto-loop.sh:418-419` before this change), the
threshold is 27 at `thorough`, 2 at `standard`, and 1 at `fast` (the caps of the time — 30 / 5 / 3;
R10 raised the latter two, see §3.1) — where the unclamped value is 0, so
the clamp is doing the work. "Check in at round 10" is unrepresentable at every tier.

The threshold is now a fixed round — `AUTO_LOOP_CHECKPOINT_ROUNDS`, default 10 — read against
`current_round`. **Caps as of this section: `fast` 3, `standard` 5, `thorough` 30 — R10 raised the
first two to 6 and 15, see §3.1.** Under those original caps the checkpoint was normally out of
reach at `fast` and `standard` — those tiers hit their cap first and the Cap Diagnostic Protocol
took over there — but *not by construction*: nothing clamps `current_round` to `max_rounds`, and
stop-guard in `warn` mode (this project's setting) does not stop the loop, so a standard-tier loop
that ran past its cap did reach 10 and fire. Harmless, and worth stating rather than implying an
invariant that is not enforced. At the time that left the long-running `thorough` loop (cap 30) as
the only tier that structurally needed a checkpoint before its cap; §3.1 is where that changed.

One consequence is **not** harmless and is recorded here rather than fixed: the `update_state` reset
that clears `strategic_reset_fired` is guarded by `current_round < max_rounds`, so once a loop is
past its cap that clear stops firing and the flag stays set — the checkpoint cannot fire again for
the rest of the session. It is bounded there, not for the state file's lifetime, because
SessionStart clears the flag too (§1.2); before that second clear existed the latch really was
permanent. Reachable only in the same past-the-cap window.

### 1.2 Two channels, one flag

| Channel | Hook | Trigger | Switch |
|---------|------|---------|--------|
| **Primary** | `post-tool-review-state.sh` `_update_iteration` | `current_round` first reaches the threshold | none — always on |
| Auxiliary | `post-compact-auto-loop.sh` | compaction with `current_round >= threshold` | `## Think Harder: enabled` |

Both read and write `iteration_history.strategic_reset_fired`, so whichever fires first silences the
other. That is `rules/auto-loop.md` § Cap Diagnostic Protocol's **"Anti-loop cap: 1 diagnosis per
change"** expressed in state rather than restated as prose in two hooks.

**Two sites clear the flag, and both are required** — each pairs it with a reset of `current_round`,
which is what the threshold reads:

| Clear site | Resets | Without it |
|-----------|--------|------------|
| `post-tool-review-state.sh` `update_state`, on a passing precommit | `current_round`, `findings_by_round` | The first change to reach round 10 is the only one in the session to get a diagnosis |
| `hooks/session-init.sh`, at SessionStart | `current_round`, `findings_by_round` | The flag survives into the next session with `current_round` back at 0, so no change in it can ever reach the checkpoint |

The second was missed when the threshold moved from the session-cumulative
`total_rounds_session` to the per-change `current_round`: preserving the flag across a session was
correct under the old counter and silently disabling under the new one.

The primary channel emits **on the flip only**, comparing the flag read before the write against the
flag read back after it. It does not re-derive the condition from the round it believes it wrote:
the flag in the file is the sole record of whether the checklist already fired, and a checkpoint
printed every round is noise the model learns to skip past.

**Both channels do the read, the decision and the write inside one lock**, and the auxiliary one had
to be corrected to. Its first build read the flag before `_lock`, then assigned `true`
unconditionally under the lock and emitted a message constructed before either — three separate
opportunities to act on a stale decision, in two directions that are both invisible afterwards:

| Interleaving | Effect |
|--------------|--------|
| Primary crosses the threshold between the read and the lock | Both channels emit for one change — the anti-loop cap breached by the mechanism meant to express it |
| A passing precommit clears the flag between the read and the lock | The blind `= true` marks the **fresh** cycle as already fired, silently disabling the checkpoint for the whole next change |

`mv` is a whole-file replace, so read → rewrite → commit has to be one transaction; the lock is what
makes it one. The message is now built only after the commit succeeds, so it belongs to whichever
process actually performed the false→true transition.

Serializing the transaction is necessary and **not sufficient**, and the second half is *where the
temp file lives*. This hook staged into `mktemp "${STATE_FILE}.XXXXXX"` — a sibling — which leaves
the temp reachable after the lock is gone: hold the lock past its TTL, stage; a contender judges the
lock stale, renames it aside, acquires the successor and commits a verdict; the displaced writer
resumes and renames its still-reachable temp over that verdict. The `_own_lock` check before the
`mv` does not save it, because the check can pass and the process be descheduled before the rename.
Staging under `$LOCKDIR` (as `_lock_staging_file` already did in the primary hook) makes the failure
structural: the takeover carries the temp away with the lock directory, so the `mv` has nothing to
rename. `test/hooks/state-commit-ownership.test.js` now enforces this tree-wide, anchored on the
**commit** rather than on `mktemp` — a rule keyed on the template text cannot see `t=$(mktemp)`,
which stages in `$TMPDIR` and is worse than a sibling because the rename may also be cross-device.
It fails closed on an origin it cannot resolve, accepts only the named staging helpers (§1.3), and
requires `$LOCKDIR` exactly: an unrelated `${OTHER_LOCKDIR}` is not carried away by a takeover of
the state lock and so gives none of the guarantee.

**The static invariant is a guard over that structural property, not the property itself**, and the
distinction settles how far it is worth hardening. Three review rounds each surfaced a further way
to write a commit the regex could not see — a quoted helper substitution, `mv --`, a destination
alias, an indexed assignment. Chasing them one at a time has no fixed point, because regex cannot
model Bash: `eval` and `${!ref}` stay outside any set that can be written. The proposed alternative,
a runtime predicate re-checking the temp's directory before each rename, was **not** adopted: the
placement *already is* that predicate at runtime — a displaced owner's temp is gone, so the `mv`
fails by rename semantics — and retrofitting ~31 commit sites would need its own opt-out for the
declared unlocked writers, rebuilding the declaration mechanism one layer down.

### 1.3 Placement is a property of the caller, not of the function

The invariant's first shape assumed each writer is either locked or unlocked, so a function could
pick one placement once. `init_state_file` is neither, and treating it as "unlocked" was a real hole
rather than a modelling nicety: five of its six call sites are inside the critical section, and only
`update_aggregate_blocked` reaches it because `_lock` failed. Declared unlocked, it staged beside
the state file and committed with a bare `mv` for **all six** — so a locked caller displaced by a
stale-recovery takeover renamed the all-default document over the successor's state, clearing every
receipt, `has_code_change` and `iteration_history`. The declaration made that invisible to both
static invariants, which is the escape hatch behaving exactly as designed and the reason it is worth
so little on its own.

The fix branches where the ambiguity is — on `$HAVE_LOCK`, in `_init_staging_file` — rather than
picking a placement for the function:

| Caller | Stages | Commit predicate |
|--------|--------|------------------|
| Holds the lock (5 sites) | `_lock_staging_file`, i.e. under `$LOCKDIR`, after `_own_lock` | `_may_init_commit` → `_own_lock`, re-proved **at** the rename |
| `_lock` failed (1 site) | beside `$STATE_FILE`, `# UNLOCKED-WRITER:` declared on that branch | `_may_init_commit` → true; best-effort by contract, and its lost-update case stays deferred |

Both static invariants had to learn the third case, and the risk in teaching them is that the
guarantee moves *into* the two new helpers where nothing pins it — `_init_staging_file` could stage
beside the state file on both branches and every extended assertion would still pass. So the
helpers' own shapes are asserted: the `$HAVE_LOCK` branch, the `_own_lock || return 1` before
staging, the declaration on the else branch, and `_may_init_commit`'s exact predicate (a bare
`return 0` there satisfies every commit-line check while proving nothing). Five mutants confirm it —
staging beside when locked, dropping the pre-staging `_own_lock`, a `return 0` predicate, removing
the declaration, and an unguarded `mv` — each killed with the offending line named.

So the guard was closed where closure is exhaustive and bounded elsewhere:

| Hole | Treatment |
|------|-----------|
| Destination alias (`target="$STATE_FILE"; mv "$tmp" "$target"`) | **Exhaustive.** Every `mv` in the tree is enumerated and its destination classified; unclassified fails. An alias is in no vocabulary, so it cannot be silent |
| Variable mutation with no `name=` (`tmp[0]=`, `printf -v`, `read`, nameref) | **Closed set**, fail-closed — a match the walk cannot parse is an offender, not a skip |
| `eval`, `${!ref}` | Out of reach, and left so. Placement is what holds |

Each bypass was *verified* during development by mutating a real hook — inserting the shape between
the safe assignment and the commit and confirming the suite turned red with the offending line
named. That harness is **not** checked in: it writes to `hooks/*.sh`, and a test that mutates the
tree it is testing is a restore-on-failure hazard for anyone running the suite. What ships instead
is a two-directional table over `variableMutationRe` in
`test/hooks/state-commit-ownership.test.js`, whose negative half is the load-bearing one — every
entry mentions the temp name the way ordinary hook code does (`read -r line < "$tmp"`,
`for tmpdir in …`, `dtmp+=`), so a regex loosened into false positives fails there rather than
quietly flagging real code.

The `# UNLOCKED-WRITER:` escape hatch survives all of this, and the degraded path is why it must:
when `_lock` **failed**, `$LOCKDIR` belongs to the contender, so staging inside it would be exactly
the intrusion the invariant exists to prevent. Beside the state file is correct there — those writes
are best-effort by construction and already carry a `.blocked` marker. What the declaration does
*not* mean is "audited and safe"; those commits can still discard the holder's transaction, which is
the deferred defect in `../auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md`.

One scan detail that is not incidental: the state document is JSON emitted from a `cat << EOF`, so
its closing `}` sits at column 0 inside `init_state_file` and reads as a function end to any
line-based scan. The three heredoc-aware scans (the bound resolver, the rename inventory and the
placement walk) exclude heredoc bodies for that reason — and the same exclusion
keeps a line inside the JSON that resembles an assignment or an `mv` from being read as code.

**If the lock is unavailable the auxiliary channel skips the injection along with the mark** — the
earlier design injected anyway, reasoning a repeat is cheap, which is true only if the injection is
otherwise correct. Outside the lock this hook cannot read the flag safely, so injecting means
emitting a checklist it never earned.

Both channels are therefore **best-effort under lock or infrastructure failure**, and neither is
guaranteed: `_update_iteration` skips on lock contention too. What makes that acceptable is that a
skip leaves the flag *false*, so the checkpoint stays eligible and the next successful review round
or compaction retries it. The `>= threshold` condition rather than `== threshold` is what makes the
retry work — a state that arrives past the checkpoint without ever crossing it still fires.

### 1.4 What the checkpoint is not

It adjudicates nothing and blocks nothing — it is a `[STRATEGIC_RESET]` fact line, consistent with
R2's neutral-fact emission model (`./requests/2026-07-26-factual-hook-signals-r2.md`). The cap is
still enforced by `stop-guard.sh`; the disposition (diagnose → one bounded adjustment → back to the
loop, or exit to ⚠️ Need Human) is still behaviour-layer and defined solely by
`rules/auto-loop.md` § Cap Diagnostic Protocol.

`AUTO_LOOP_CHECKPOINT_ROUNDS` is digit-validated in both hooks before it reaches `[[ -ge ]]`. That
is not defensive habit: bash expands command substitution inside an array subscript in arithmetic
contexts, so an unvalidated `a[$(...)]` in the environment would execute from a hook. The same guard
already protects `max_rounds` and `current_round` read out of the state file, which is likewise an
ordinary working-tree file and therefore untrusted input.

## 2. The progress ledger

Ticket: [R9](./requests/2026-08-04-progress-ledger-r9.md).

The question behind it: *"review 輪數常常過多，但可能又是真的有發現問題… 我要的是有實質進度。"* Capping rounds
answers the wrong question — it stops a productive loop and a churning one identically. What was
missing is a way to tell the two apart.

### 2.1 Why counts cannot answer it

`iteration_history.findings_by_round` recorded only severity counts. Consider two rounds:

| Round | Findings | Counts say | Actually happened |
|-------|----------|-----------|-------------------|
| 1 | A, B | `total=2` | — |
| 2 | A, C | `total=2` | B closed, C introduced |
| 2′ | A, B | `total=2` | nothing moved |

Rounds 2 and 2′ are **identical** under counts and opposite in meaning. The second is the churn the
user is describing; the first is ordinary progress. No aggregate over severities separates them —
only finding **identity** does.

### 2.2 What an identity is

The finding's own text with the severity tag stripped **and the leading `file:line` reduced to
`file`**, horizontal whitespace collapsed, truncated to 120 **`cut -c` units** (`cut -c` is byte-based on
GNU coreutils and character-based on BSD, so a non-ASCII finding can be cut mid-character; jq
substitutes U+FFFD deterministically, so the identity stays stable per platform); the set is sorted,
deduplicated, and capped at 40 per round.

Both strippings are load-bearing, and each prevents a specific false reading:

| Stripped | Otherwise |
|----------|-----------|
| The severity tag | A finding re-graded P1 → P2 reads as one closed and one new |
| The `:line` (looped, so `file:line`, `file:line:col` and deeper all reduce to `file`) | A fix anywhere in a file shifts the lines below it, so **every untouched finding in that file** reads as closed-and-reintroduced — the churn signature inverted, on the round that made the most progress |

The `file` component is deliberately kept: two findings sharing issue text in different files are
different findings.

The main substitution is a **loop anchored to the location token's trailing edge**
(`s/^([^[:space:]]+):[0-9]+([[:space:]]|$)/\1\2/` under `:a … ta`). Both halves are load-bearing,
and each fixes the other's failure mode — the two were found in sequence, each while fixing the one
before:

| Form | Fails on | Result |
|------|----------|--------|
| Fixed two passes | `a.yml:12:34:56` | Leaves `a.yml:12` — still line-sensitive, which is the whole defect |
| Unanchored loop | `src/rev:12.js:34` | Strips colons *mid-path* down to `src/rev.js`, colliding with a real finding in `src/rev.js` |
| Anchored loop | — | Any coordinate depth reduces to `file`; a colon inside the path survives |

**Only the first token is ever examined.** The reviewer contract is
`- [SEV] <file:line> <issue> -> <fix>` (`skills/codex-code-review/references/review-common.md`), so
the location is delimited by a **space** — which means a path containing one is not the first token
and the loop never sees a location at all.

A second expression that searched the rest of the line for something location-shaped was built to
close that, and **reverted**. It read `- [Nit] timeout 30:5 seconds` as a location and produced
`timeout 30 seconds` — byte-identical to a real `timeout 30 seconds` finding. Identities pass
through `sort -u`, so that does not merely mislabel one finding, it **deletes** one. Trading a
residual that misclassifies a finding for one that discards a finding is the wrong direction, and
the measurement makes the trade unnecessary: **0 of 800 tracked files here contain a space, a
colon, or a terminal `:digits`**. Two rounds of trying to close this residual each introduced a
worse defect than the residual itself — the signal to stop patching, not to patch more carefully.

The invariant that failure violated is now asserted directly rather than inferred: the suite has an
**injectivity** test comparing pairs that a location-hunting normalizer collapses. A table of
input→output pins cannot catch two *different* inputs reaching the same output, which is the failure
mode that costs something.

**Accepted residuals**, all pinned in `test/hooks/identity-normalization.test.js` so changing one is
a decision rather than a surprise. Rows 1–2 keep their line number, so a line shift reads as churn
for that one finding and nothing collides. **Row 3 does collide** — that is what "undecidable"
means here, and it is worth stating rather than letting the summary sentence cover it: measured,
`src/rev:12:34 stale cache`, `src/rev:34 stale cache` and `src/rev stale cache` all normalize to
`src/rev stale cache`, so `sort -u` keeps one of the three and the ledger under-counts that round.
Accepted because the shape requires a filename literally ending in `:digits` — 0 of 800 tracked
files here — and the counter is advisory. Pinned by an explicit collision assertion, not left to
the injectivity pairs, which by construction only cover inputs that must stay distinct:

| Residual | Why it stays |
|----------|--------------|
| `docs/My File.md:12` (path containing a space) | The contract's delimiter is a space, so nothing marks where the path ends |
| `src/a.ts:12-14` (range) | Not a `:line` suffix; the contract specifies a line, not a range |
| `src/rev:12:34` (filename ending in `:digits`) | **Undecidable**, not merely unhandled — equally "file `src/rev:12`, line 34" and "file `src/rev`, line 12, col 34" |

The last is worth being explicit about: no regex resolves it, because the ambiguity is in the
grammar rather than in the pattern. Closing any of the three means changing what **every** reviewer
emits — a delimiter in the finding line, as `[NIT_DEFERRED]` already uses — which is a change to the
review protocol, not to this hook. Weighed against an advisory counter that adjudicates nothing,
that is not the trade to make here. It is recorded rather than dropped.

The suite extracts the two `sed` programs from the hook source and runs them under the real `sed`,
for the same reason `jq-filter-fidelity.test.js` does it: the hook suites drive the hook through a
hand-written JS stub bin, so a table checked against a re-typed copy of the regex would test the
copy. Extraction asserts its marker is **unique** and follows backslash continuations up to the next
pipeline stage, so a stale duplicate invocation cannot silently become the tested program.

The bounds exist because this is written into the state file every round. 40 × 120 chars × the
existing 50-round retention window is the worst case, and the retention cap was already there.

**How the bound itself became a defect.** The pipeline ends `| sort -u | head -40`. On its 40th line
`head` closes the pipe, `sort` takes SIGPIPE, and under `set -o pipefail` the substitution reports
failure — on success. The original `|| cur_ids=""` fallback then discarded the 40 identities already
captured, so a large round stored `ids: []`. The next round reads that as "nothing carried over" and
emits `closed=0` with `persisted + new == findings` — precisely the shape §2.3's `persisted + new <
findings` caveat does *not* flag, so the churn signal inverted with nothing to indicate it had.

The fix is `|| true`: the substitution has already assigned whatever it captured, and the `||` only
stops `set -e`. The regression test must exceed roughly one pipe buffer of identity text (~64 KB),
not merely the cap of 40 — around 60 findings truncate correctly *with the defect present*, so a
small case pins nothing. The three `_id_set_count` substitutions below it carry their own `||` guard
too, but a *different* one — `|| _closed=0`, not `|| true`, because they must land a usable value
rather than merely survive — and for a different reason: `comm` is a dependency this tree did not previously have, and a bare
substitution aborts the hook under `set -e` after the state commit, dropping `[STRATEGIC_RESET]`,
the `[NIT_DEFERRED]` ledger and the `[AUTO_LOOP_STATE]` block for a missing binary.

### 2.3 The emission

```
[LOOP_PROGRESS] round=12 closed=0 persisted=5 new=1 findings=6
```

**On the code plane only, and only when the round commits.** The ledger lives inside
`_update_iteration`, which is called from the two code-review branches and from nowhere else — the
doc-review branch does not increment a round, so a doc-only loop produces no `[LOOP_PROGRESS]` at
all. Within the code plane it is still conditional: losing the lock to a stale-recovery takeover, a
failed jq or a failed rename each return before the emission, having already logged the skip on
stderr. So a **missing** line means "no counted round happened", never "a round happened with
nothing closed" — and since `closed=0` is the churn signature the diagnosis keys on, reading absence
as `closed=0` inverts it. `rules/auto-loop.md` § Cap Diagnostic Protocol carries the same
qualification, because that is where the model reads it.

Counts only. Identities never cross into the record: a finding's text is reviewer-controlled and the
record is whitespace-delimited, so echoing one would let a finding named `new=99` forge a field —
the same structure-forging surface `_alf_val` exists to close for file paths.

One caveat the reader must apply first: `findings` counts **both** report shapes (`- [P0]` lines and
`#### P0` sections), while identities come only from the line shape — a section header carries no
per-finding text. So `persisted + new < findings` means the ledger could not see this round's
findings at all, and its `closed`/`new` are not evidence of anything. Check that before reading a
`closed=0`.

Otherwise, a run of `closed=0` with findings outstanding is the churn signature — stated in exactly
those words here, in §2.4 and in `rules/auto-loop.md` § Cap Diagnostic Protocol, because an earlier
draft added `new=0` to it in one place only. That extra condition inverts the signal: a round that
closes nothing *and* introduces one is the worst case, not an exempt one. It is a **fact, not a verdict**:
this hook does not decide whether the round was productive, and nothing blocks on it. Consistent
with R2's neutral-fact model, the disposition belongs to the behaviour layer — which is what
`rules/auto-loop.md` § Cap Diagnostic Protocol already defines, and why the round-10 checkpoint in
§1 is the natural place for the ledger to be read.

### 2.4 Interaction with the checkpoint

The two are complementary, not redundant. The checkpoint says *when* to stop and think (round 10);
the ledger supplies *what the diagnosis is made of* — a run of `closed=0` with findings outstanding
points at `ATTENTION_DIFFUSION` or `ARCHITECTURE`, while steady `closed>0 new=0` says the loop is
converging and the right move is to keep going, not to diagnose.

## 3. Stall detection and stall memory

Ticket: [R10](./requests/2026-08-07-stall-detection-r10.md).

§2 gave the loop a way to *describe* whether it is moving. It did not give anything a way to
*notice*. The reader of those `[LOOP_PROGRESS]` lines was the model, and the evidence that the
model does not reliably notice its own repetition is in this repository: `.claude/sd0x-dev-flow-lessons.md`
L5 (rounds 81/82), L7 (86/87) and L8 (91/92) are the same lesson — "a green light is a claim about
who made it green" — recorded three times across one hardening loop, with nothing observing that it
was the third time.

### 3.1 Why the cap could not do this job

The round cap was doing two jobs: runaway backstop, and stall detector. It is adequate at the first
and structurally incapable of the second, because it stops a converging loop and a churning one at
the same number. Everything the user asked for follows from separating them:

| | Before | After |
|---|---|---|
| Detects a stuck loop | Round cap (a count) | `[LOOP_STALL]` (evidence) |
| Fires at | A fixed round, tier-dependent | The round the evidence appears, usually much earlier |
| Cap's remaining job | Both | Runaway backstop only |
| Caps | 3 / 5 / 30 | 6 / 15 / 30 |

Raising `standard` past 10 also closed a dead angle: `AUTO_LOOP_CHECKPOINT_ROUNDS` fires at round 10,
and while the default tier capped at 5 the checkpoint was live, tested code that a default-tier loop
reached only by running past its own cap — possible in `warn` mode, since nothing clamps
`current_round` to `max_rounds`, but not a path to design around. That caveat was already on the
record in `./2-tech-spec.md` §3.2 before this change; what was missing was any reason for the
default tier to reach round 10 the intended way. It is pinned now
(`test/rules/stall-detection.test.js`) rather than left to be re-broken by the next cap change.

### 3.2 The streak, and the third state

A stall round is `closed = 0` with findings outstanding **and** a readable ledger. The third
condition is the one that is easy to leave out, and leaving it out breaks the feature in whichever
direction the omission falls:

| Round shape | Must do | If it counted instead | If it reset instead |
|---|---|---|---|
| `closed=0`, readable | count | — | never fires |
| `closed>0` | reset | fires on any 3 rounds | — |
| `persisted + new < findings` | **hold** | manufactures a stall from an unreadable round | one section-shaped report erases three rounds of evidence |

The third row is R9's own caveat promoted to a branch: `persisted + new < findings` means the
identities could not be extracted, and "absence is not a signal" has to cut both ways. It is
asserted directly (`test/hooks/jq-filter-fidelity.test.js`, "a round the ledger could not read
HOLDS the streak") with a paired positive control on the same shape — the guard and its negative
control shipping together, per `rules/testing.md` § Conventions.

Threshold 3 is Reflexion's repeat-action heuristic (arXiv:2303.11366: "same action and same response
for more than 3 cycles") taken at its lower bound: the paper's condition is `> 3`, and 3 consecutive
stall rounds is the first point at which an observer can see the run forming. Erring early is the
right side to err on here, because the signal blocks nothing. `AUTO_LOOP_STALL_ROUNDS` moves it.

**Edge, not level.** `[LOOP_STALL]` is emitted only when the streak crosses the threshold, and
because any closing round resets the streak to zero, progress re-arms it automatically — no separate
`*_fired` flag, unlike the checkpoint. That asymmetry is deliberate: the checkpoint is once per
change (a fixed round cannot recur), a stall genuinely can recur, and it should, once the loop has
moved and stopped again.

The three set differences moved **ahead of** the jq write, because the streak is a function of
`closed` and a value computed after the commit could only be written by a second one. Each keeps its
own `||` fallback: `_id_set_count` shells out to `comm`, and what the move changed is the blast
radius of a missing `comm`, not its likelihood. Placed **after** the commit, as it was, a failure
lets the round land while every downstream signal is skipped; placed **before** it, where it is now,
the failure costs the whole round, which only undercounts. Undercounting is the safer of the two —
the streak is evidence for a diagnosis, and a missing round delays one where a landed-but-blind
round would poison it.

**Both new fields inherit §1.1's past-the-cap latch, and one of them inherits it differently.**
`stall_streak` and `stall_memory` are cleared on the same passing-precommit branch as
`strategic_reset_fired` (`hooks/post-tool-review-state.sh:1304-1308`), and that branch is guarded by
`current_round < max_rounds`. Past the cap the clear stops firing, so both survive into the next
change until SessionStart. For the flag the consequence is silence — a checkpoint that will not fire
again. For `stall_memory` it is not silence: change A's failed adjustments are **read back** under
change B's first `[LOOP_STALL]` and presented as evidence about B. `rules/auto-loop.md` § Stall
Detection says the memory is "cleared wherever `strategic_reset_fired` is", which is exactly true and
therefore inherits exactly this window. Recorded rather than fixed for the same reason §1.1 records
its half: the guard is one condition shared by several fields, and narrowing it is its own change.

### 3.3 Why the memory is read from the command

`[STALL_MEMORY]` is the "learning" half, and it is the half nothing in the repository had. The
record is model-authored, which creates a problem `[NIT_DEFERRED]` does not have: **the model has no
output stream the PostToolUse hook can see.** `tool_output` is the tool's, not the model's.

Reading `tool_output` was the obvious design and it is unshippable. The record's format is
documented in `rules/auto-loop.md` § Stall Detection, so a single `cat rules/auto-loop.md` would
put a well-formed record on that stream and forge one. A documented format that fabricates records
when the documentation is read is not a format worth shipping. The command the model types is the
closest thing to a model-authored stream that exists, so that is what the hook parses, and the full
`class= … | tried= … | outcome=` shape is required so that naming the marker (`grep '\[STALL_MEMORY\]'`)
matches nothing.

The read-back closes the loop: entries are replayed under a header, beneath the next `[LOOP_STALL]`
or `[STRATEGIC_RESET]`, so the memory cannot grow by being shown. **What guarantees that is the
split, not the indent** — an easy thing to state wrongly, and the first version of both this
paragraph and the code comment did. The ingest regex needs `[STALL_MEMORY]` *and* `class=` on one
line; the replay puts the marker on the header, which carries no `class=`, and the records on
indented lines carrying no marker. Neither half is a record. The indent is for the reader. Keep the
marker off the record lines and the property holds; move it onto them and indentation saves nothing,
because the ingest never anchored to column 0.

**One regex, used twice.** The gate and the extraction were two patterns, and only the extractor
required the trailing `| <ts>`. A record written without a timestamp therefore passed the gate,
extracted to nothing, and vanished — the silent drop this memory exists to prevent, reintroduced by
the ingest itself, and the reason `_upsert_stall_memory`'s own `ts` default was unreachable in
production. They are now the same `_SM_RE`, with the `ts` group optional and the two trailing field
bodies stopping at a quote so the shell's closing `'` is not stored as data. An empty `outcome=` still
matches, on purpose: it must reach the validator and be refused out loud rather than match nothing
and disappear.

Both directions are pinned, and the forgery test carries a realistic `cat` payload rather than an
empty one, so that pointing the ingest at `tool_output` fails it specifically.

Measured 2026-08-07, one mutation at a time: back up, replace the string, **assert exactly one
occurrence was replaced**, run, restore, `diff -q`. That assertion is not ceremony — an unapplied
substitution and a surviving mutant produce identical all-green output.

| Mutation | Killed by |
|---|---|
| ingest reads `TOOL_OUTPUT` instead of `COMMAND` | 5 stall-memory tests, incl. the forgery guard |
| blind-round branch removed (`if ($persisted + $newids) < $total` → `if false`) | exactly the blind-round test |
| edge → level (drop `(( streak_before < stall_t ))`) | exactly the fires-once test |
| the two-regex ingest restored | exactly the no-timestamp and empty-outcome tests |
| ingest field bodies back to `+` | exactly the no-space-record assertion |
| `[STALL_MEMORY]` moved onto the replayed record lines | the replay-shape and the SPLIT test |
| `stall_streak`/`stall_memory` clearing deleted from `session-init.sh` | exactly 1 test |
| the same clearing deleted from the convergence reset | exactly 1 test |

**The seventh row is the one worth reading.** It survived on the first attempt — against a test
written specifically to catch it. The jq stub in `test/hooks/post-tool-review-state.test.js`
hardcoded the replayed line's shape, so mutating the production template changed nothing any test
could observe: the stub supplied the behaviour unconditionally, which is the exact false-pass this
harness's text-gating discipline exists to prevent, reintroduced one clause at a time. The stub now
interpolates the shape out of the production filter's own template string. A stub clause may gate on
production text; it may never restate what the production code does.

### 3.4 `/refactor` as a bounded adjustment

R6 step 2 asks for one bounded adjustment and names a direction per class. Two of the six directions
are things `/refactor` already does, so it is named for those two and only those two —
`ARCHITECTURE` and `REQUIREMENT_AMBIGUITY` exit rather than adjust, `UNVERIFIED_CLAIM` needs a
measurement, `TIER_MISMATCH` needs the loop to stop.

The five constraints in the rule are each load-bearing, and the one worth restating here is that
`--auto` is forbidden: it scans the repository and takes up to ten targets, which is precisely the
mid-loop rewrite step 2 exists to prevent. `--target` also makes the adjustment's scope the thing
that was declared before making it, which is what step 2 asks for.

The budget split follows from §3.2's asymmetry: a cap hit twice means the adjustment bought nothing,
so it goes to the human; a stall twice means the loop moved and stopped again, which an adjustment
can still address. Three is where that stops being true, and it is deliberately the same 3 the
memory holds — when the replay is full of failed adjustments, a fourth is not the answer.

### 3.5 What this is not

It is not a gate. `[LOOP_STALL]` blocks nothing, changes no budget, and closes no receipt; like
`[LOOP_PROGRESS]` it is a fact, and `rules/auto-loop.md` owns the disposition. Nor does it replace
the round-10 checkpoint, which stays as the backstop for a loop that circles without ever quite
producing a `closed=0` run.
