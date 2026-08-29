# Loop Diagnostics — stall detection and the cap diagnostic protocol

Loaded on demand. `rules/auto-loop.md` carries the resident core: the terminal completion invariant,
the tier table and its round caps, sub-threshold handling, and the gate sentinels. This file carries
what a session needs only once a loop is *not converging* — how a stall is recognised from the
review reports, what a diagnosis is made of, the closed class table, and the anti-loop budgets.

Load it when review rounds are failing to close findings, when a round cap or the round-10
checkpoint is reached, or when a bounded adjustment is being chosen.

Every rule here was resident prose until 2026-08-29 and **the move changed no policy**
(`docs/features/rules-residency/2-tech-spec.md` § 3.4). One prose edit was made in the move: the
`/refactor` paragraph named "those two classes", whose antecedent did not travel, so the two are
now named outright.

**Tier.** This file sits outside `rules/discretion.md` § File Baselines, which assigns tiers to
the 13 plugin-managed `rules/*.md` files. It inherits the tier each statement already had in
`rules/auto-loop.md`, and that is **not uniform**:

- **Anchor** — "It edits files, so the code gate re-opens" (§ Cap Diagnostic Protocol,
  `/refactor` constraints). `discretion.md` § File Baselines gives `auto-loop.md` "Register #5–#7
  items → Anchor", and this is Register #6(a).
- **Default** — everything else here, including the two statements about security and
  data-integrity changes (they skip this protocol and go to ⚠️ Need Human; `/refactor` is excluded
  for them). These **cite** Register #3 but are not it: `discretion.md` scopes that hit to
  `auto-loop.md` **§ Tiers** — "a security or data-integrity change is reviewed at `thorough`
  whatever tier is configured" — a review-*depth* rule. Stall routing is a different rule with a
  different consequence, and it resolved to `auto-loop.md`'s Default baseline. Default means a
  `[DEVIATION]` line is available, as it was before the move.

Inherited tiers resolve at step 0 and **are not new Register items**. Reading the Default pair as
Anchor would delete their deviation route, which would be a policy change — and this move makes
none. Changing either tier is an Anchor Register amendment in `rules/discretion.md` plus
`test/rules/discretion-tiers.test.js`, with human approval.

**Where the two layers overlap, this file is canonical.** The thresholds and budgets also appear
in `rules/auto-loop.md` § Stall Detection and Diagnosis, because a session must know them before
it knows it needs this file; that resident statement is a summary of what follows, and any
disagreement between them is a defect in the summary.

## Stall Detection

A cap answers "how long has this gone on"; what matters is "is anything moving". Since hook-lightweighting nothing counts this for you — you answer it from the review reports in front of you.

A **stall round** is one where findings are outstanding and the round closed none of them. Count findings, not severities — a round left correctly unfixed because all of it is sub-threshold still counts. **3** consecutive stall rounds is the signal to stop fixing and diagnose. Closing a finding — or leaving none outstanding — resets the streak; a round you cannot compare per-finding holds it where it was (**absence is not a signal**).

On the signal, run § Cap Diagnostic Protocol — the same three steps, at the point the evidence appeared rather than at an arbitrary round. Nothing blocks. `✅ Ready` with only sub-threshold findings is not a stall; it is `/precommit`.

### Stall Memory

Trying the same adjustment twice is the failure this prevents. Once a bounded adjustment has resolved — or failed to — **state it in the conversation** in a form a compact summary will carry: the class, what was tried, and the outcome (e.g. "stall adjustment: ATTENTION_DIFFUSION — split the 6-file batch into 2 — closed 3 of 5, streak reset"). Nothing persists this for you anymore; the conversation and the compact summary are the record, which is why the statement must be explicit rather than implied by the diff.

**Never re-try an adjustment recorded as failed.** A class appearing twice with two failed adjustments is itself the signal — the class is probably wrong, or it is `ARCHITECTURE` under another name. The record is scoped to the change: a new change starts clean.

## Cap Diagnostic Protocol

Reached from any trigger — a stall (evidence), the round cap (budget), or the round-10 checkpoint below — and from none for security or data-integrity changes, which skip this protocol entirely: **any** trigger → ⚠️ Need Human directly. Otherwise all are diagnosis points, not automatic hand-offs, and all are behaviour-layer: you keep the count, you call the trigger.

The checkpoint fires at round 10 on the same change: run this same protocol once — diagnose, one bounded adjustment, back to the loop. Once per change; it is a checkpoint, not a cap — nothing blocks and the round budget is untouched. It catches the loop that circles without ever producing a clean no-progress streak (round 10 sits inside the budget at `standard`/`thorough`, past it at `fast`).

1. **Diagnose** — classify the stall as exactly one class from the closed table below; state the class and its observed signals in a short block, not free prose.
2. **One bounded adjustment** — declared *before* it is made: name the scope (which files), the nature (the class's direction column), and the size (a single split, a single re-scope, or ≤ 5 focused edits). An adjustment must never grow into a rewrite mid-loop; if the diagnosis itself shows architecture-level change is needed, exit ⛔ Need Human instead of adjusting.
3. **Return to the loop** — re-enter review with the adjustment as the change under review.

**Anti-loop budget.** The cap and the stall are budgeted separately, because they mean different things:

| Trigger | Budget | On exhaustion |
|---------|--------|---------------|
| Round cap | **1** diagnosis per change | The same change hitting the cap a **second** time → ⚠️ Need Human, no second diagnosis |
| Stall | **3** per change | A **fourth** stall on the same change → ⚠️ Need Human, no fourth diagnosis |

A stall may recur where a cap hit may not: the cap fires at a fixed number, so a second hit says the adjustment bought nothing, whereas a stall re-arms only after real progress, so a second one says the loop moved and stopped again — still addressable. Past three it stops being true — a fourth is not the answer.

Both budgets are yours to keep, in conversation — nothing counts rounds or streaks for you — so this rule is the only enforcement; treat it as binding.

**What the diagnosis is made of.** Compare consecutive review reports by finding *identity* — closed, persisted, new. Counts alone cannot tell "fixed one, introduced one" from "nothing moved". A report you cannot compare per-finding is not evidence — **absence is not a signal**; never read an uncomparable round as "nothing closed". Rounds closing nothing with findings outstanding is the churn signature (`ATTENTION_DIFFUSION` or `ARCHITECTURE`); steady closing says keep going. That hand-read run and a stall call are the same observation: one streak, one diagnosis.

| Class | Signals | Bounded direction |
|-------|---------|-------------------|
| `ARCHITECTURE` | Same defect recurs across files; fixing A breaks B | Stop patching; back to design, re-scope |
| `DOC_TOO_LONG` | Target exceeds the `@rules/docs-numbering.md` limit; reviewer repeatedly flags inconsistency | Prune dead sections first, then merge; `/refactor --target <file>` **condenses** and splitting is manual — `@rules/docs-numbering.md` § Size Limit |
| `ATTENTION_DIFFUSION` | Fixes introduce new defects; the same fact is recorded wrong repeatedly | Shrink the batch; verify each item before merging — `/refactor --target <churning files>` when the diffusion is structural |
| `UNVERIFIED_CLAIM` | Blocking findings cluster on unmeasured claims | Measure first; write the derivation command into the doc |
| `TIER_MISMATCH` | Findings persistently below the blocking threshold | Converge per tier and move to the next gate |
| `REQUIREMENT_AMBIGUITY` | Reviewer and implementer disagree on what "correct" means | Ask the human; stop guessing |

**`/refactor` as a bounded adjustment** — available for **`DOC_TOO_LONG` and `ATTENTION_DIFFUSION` only**. The other four need something a refactor cannot deliver: `ARCHITECTURE` and `REQUIREMENT_AMBIGUITY` exit rather than adjust, `UNVERIFIED_CLAIM` needs a measurement, `TIER_MISMATCH` needs the loop to stop. Five constraints, none optional:

| Constraint | Why |
|-----------|-----|
| `--target <paths>` always, never `--auto` | `--auto` scans the repo for up to 10 targets — the rewrite step 2 forbids growing into. The target list is the scope you declared |
| It edits files, so the code gate re-opens | Anchor Register #6: prior verdicts are invalid and review re-runs. Re-entering the gate, not routing around it |
| Its own internal quality check is **not** this loop's precommit gate | `/refactor` runs one per target. The loop's gate is still owed afterwards, on the whole change |
| Excluded for security and data-integrity changes | Register #3 escalates those to `thorough`; a stalled security change goes to ⚠️ Need Human |
| It consumes the diagnosis budget, never an extra one | A refactor *is* the one bounded adjustment for that stall |

