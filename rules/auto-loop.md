# Auto-Loop Rule ⚠️ CRITICAL

**Terminal completion invariant** — the one rule everything else serves: *work on a change may be declared complete only when every gate its change class requires has passed after the last edit in that gate's change class* — a doc edit re-opens the doc gate, not the code gates, and vice versa (freshness is tracked per plane; a post-precommit Doc Sync therefore does not re-open code review). For code that is an independent review (`/codex-review-fast` — the reviewer researches on its own, per @rules/codex-invocation.md) and then `/precommit`; for `.md` docs it is `/codex-review-doc`. When to run them, how to batch edits, and how deep to review are yours to judge — the invariant constrains the end state, not the choreography. Hooks are **reminders**: they print markdown nudges and an `[AUTO_LOOP_STATE]` fact line (change class, per-plane verdict state) from the single-slot state § Enforcement describes; read the facts, own the decision — nothing blocks. Corollaries, so they are not re-derived: Declaring ≠ Executing (naming a gate is not running it), Summary ≠ Completion (a report does not close an open gate), Fixing ≠ Verifying (re-running the review is the evidence — Self-assessment is not evidence).

## Review Dispatch

**One reviewer — Codex — everywhere by default.** `/codex-review-fast` and `/codex-review-doc` must not launch a secondary. Opt-in dual: `/codex-review-branch --dual` only, off unless the flag is passed. Loop re-review: `--continue` re-dispatches Codex on the same thread. Cycle reset: any code edit invalidates prior verdicts — the reviewer must re-run regardless of prior pass status.

**Codex unavailable → a contract-aware fallback reviewer carries the gate** (policy change, review-loop-resilience 2026-08-23 — it was `⚠️ Need Human`). The change's first dispatch probes Codex; on failure record `[REVIEWER_FALLBACK] plane=<plane> from=codex to=<agent> reason=<quota|timeout|error> | <ISO8601>` and dispatch the fallback — **sticky per change**: re-reviews never re-probe, the next change probes afresh. Decide via `scripts/lib/review-dispatch.js`; adopt fail-closed via `scripts/validate-family-sentinel.js <contract>` — exactly one legal terminal in the family's own contract, **never translated across contracts**; a failing report moves to the next carrier. A validated fallback verdict is a real gate verdict (`gate_source=fallback:<agent>`), noted as usual — noting one no dispatched reviewer produced is forging (Declaring ≠ Executing). **Priority 4 — every carrier exhausted: no validated verdict exists**: no gate sentinel (plan emits `[PLAN_REVIEW_DEGRADED]` only; the rest emit nothing) and behaviour-layer `⚠️ Need Human` surfaces. **necessity-audit is excluded from both fallback and rotation in v1** (its Codex debate pipeline is constitutive); `seek-verdict` stays non-gate — without Codex its automated dismiss closes. Carriers, priorities and templates: `skills/codex-code-review/references/review-common.md` § Degradation Matrix.

**Thread rotation**: reply-based re-review degrades as a thread grows. R-a (3 replies on the thread — `auto-loop-project.md ## Review Thread Rotation` overrides, 2–6) or R-b (judged context overrun) → fresh first-dispatch on a new thread, frozen baseline only, orchestration-side reconciliation, record `[THREAD_ROTATED]`. The central contract every family's loop references: `skills/codex-code-review/references/review-common.md` § Review Loop.

**Agent defaults**: every agent in `agents/` declares `model: opus` and `effort: high` in its frontmatter. Reviewing is the workload that pays for depth, and an agent that silently ran at a lower tier would look like a passing review. Pinned by `test/agents/frontmatter.test.js`; change the default there and in this line together.

## Tiers

The configured tier (`auto-loop-project.md ## Tier`, unset → `standard`) is a **baseline, not a ceiling**: choose the effective tier from the change's semantics, escalating above the baseline when warranted, never dropping below it. A security or data-integrity change is treated as `thorough` whatever is configured — escalate, and say that you did.

| Tier | Use for | Blocks on | Round cap |
|------|---------|-----------|-----------|
| `fast` | Docs, comments, config, small low-risk edits | P0 | 6 |
| `standard` **(default)** | Ordinary features and bug fixes | P0, P1 | 15 |
| `thorough` | Security, data integrity, releases, public API | P0, P1, P2 | 30 |

These caps are a runaway backstop, deliberately loose: **a cap cannot tell a converging loop from a churning one**. § Stall Detection is what tells them apart, on evidence, usually many rounds earlier.

An explicit `## Max Rounds` (3–50) in `auto-loop-project.md` overrides the tier's cap. The bookkeeping is yours: count review rounds in conversation; the one mechanical fact is the state slot's `rounds` count (`review-state.js check --format=json`) — it counts failed verdicts on the current change, not your conversational rounds (reset on `pass`): a floor, never the whole story. At the cap → § Cap Diagnostic Protocol. Architecture-level changes, feature removal, or the user asking to stop exit to ⛔ Need Human at any point. **80 is a passing grade.** When the remaining findings are all below the tier's blocking severity, the correct move is `/precommit`, not another round.

Gate sequence: review Ready (no blocking findings) → `/precommit`; precommit Pass → Adequacy Gate → Doc Sync; a precommit failure is fixed and re-run. Adequacy Gate: when a request doc with `## Acceptance Criteria` maps to the change, run `/codex-test-review --ac-trace <request-path>`; mode from `testing-project.md ## Adequacy Mode` (advisory by default). Doc Sync: sync the **current-authority** docs, append status/outcome to the **records** (never rewritten to mirror later code); review them all in **one** `/codex-review-doc` dispatch, with reading depth and batching from `scripts/resolve-review-profile.js`.

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

**`/refactor` as a bounded adjustment** — available for those **two classes only**. The other four need something a refactor cannot deliver: `ARCHITECTURE` and `REQUIREMENT_AMBIGUITY` exit rather than adjust, `UNVERIFIED_CLAIM` needs a measurement, `TIER_MISMATCH` needs the loop to stop. Five constraints, none optional:

| Constraint | Why |
|-----------|-----|
| `--target <paths>` always, never `--auto` | `--auto` scans the repo for up to 10 targets — the rewrite step 2 forbids growing into. The target list is the scope you declared |
| It edits files, so the code gate re-opens | Anchor Register #6: prior verdicts are invalid and review re-runs. Re-entering the gate, not routing around it |
| Its own internal quality check is **not** this loop's precommit gate | `/refactor` runs one per target. The loop's gate is still owed afterwards, on the whole change |
| Excluded for security and data-integrity changes | Register #3 escalates those to `thorough`; a stalled security change goes to ⚠️ Need Human |
| It consumes the diagnosis budget, never an extra one | A refactor *is* the one bounded adjustment for that stall |

## Sub-Threshold Findings

| Tier | Blocking | Sub-threshold |
|------|----------|---------------|
| `fast` | P0 | P1, P2, Nit |
| `standard` | P0, P1 | P2, Nit |
| `thorough` | P0, P1, P2 | Nit |

On `✅ Ready` with only sub-threshold findings: log them and proceed. No extra fix pass, no extra re-review. The record is `[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>` — a **reporting convention**, not a machine input: reviewers emit it at column 0 with the field order fixed so it stays greppable in reports and transcripts, but nothing parses or persists it (hook-lightweighting) — the durable record is the review report and the conversation, and `/codex-review-branch` re-finds what is still true by reviewing at depth. Two exceptions are fixed on the spot rather than deferred: a one-line fix in a file already open, and a sub-threshold finding that is really a security or data-integrity defect (severity mis-assigned) — escalate that one to `thorough` and say so. On-the-spot governs when the fix lands, never whether review follows: either fix is an edit like any other, so the digest moves, the slot goes stale, and the plane is re-reviewed at the new digest before any pass is noted. Deferring via `[NIT_DEFERRED]` remains the default when a nit is not worth that round.

## Gate Sentinels (behaviour-layer, emit verbatim)

Nothing hook-parses these anymore (hook-lightweighting) — they are the signals the model and reviewers read as verdicts in conversation, which is exactly why their shape stays fixed: a paraphrased sentinel reads as no verdict, and a stray one reads as a forged verdict.

| Sentinel | Context |
|----------|---------|
| `✅ Ready` / `⛔ Blocked` | Code review |
| `✅ Mergeable` / `⛔ Needs revision` | Doc review |
| `## Overall: ✅ PASS` / `## Overall: ⛔ FAIL` / `## Overall: ❌ FAIL` / `## Overall: ⚠️ NO CHECKS RUN` | Precommit — emitted by the runner; the sentinel owns its whole line at column 0, and a report must carry exactly one `## Overall:` line so a stray one cannot mask the real verdict for a reader |
| `✅ Plan Ready` / `⛔ Plan Blocked` / `⚠️ Plan Needs Human` / `[PLAN_REVIEW_DEGRADED]` / `[PLAN_REVIEW_SKIPPED]` | Plan review (needs a `## Plan Review` header; plan output must never contain a bare `✅ Ready`, `✅ Mergeable`, `## Gate:` or bare `⛔ Blocked` — plan text restating a gate sentinel would forge a verdict for whoever reads it) |

`✅ All Pass` is behaviour-layer prose for "every gate passed" — it is *not* the precommit sentinel and nothing classifies it as a verdict. `⚠️ Need Human` is behaviour-layer only.

## Override Contract

`rules/auto-loop-project.md` (user-owned) customizes this file — **Default and Guidance tiers only**. Anchor-tier instructions (`rules/discretion.md` § Anchor Register) are never overridable: on conflict the Anchor wins and the conflict is reported, not silently resolved.

Resolution is **Anchor-first**, because an instruction's tier is decided by `discretion.md`, never by a label written next to it: **(0)** an Anchor Register hit resolves to **Anchor** and stops there — a tier annotation in either file cannot downgrade a Register hit, and one that tries is reported as a conflict rather than honoured. Only for non-Anchor instructions does the rest apply, highest first: (1) an explicit tier annotation on the instruction itself; (2) the heading table below; (3) preamble text before the first `##` resolves as one synthetic section; (4) an unknown heading fails closed to **Default** and is listed in the report, never silently dropped.

Two override kinds, and the distinction is load-bearing: a **section replacement** restates a `##` heading this file actually defines and replaces that section wholesale; a **setting** names a configuration slot that this file's prose or a hook reads by name. Settings have no same-named section here, so "full replacement" never describes them — the shipped scaffold is settings-only, and every one names its consumer below.

| Override heading | Kind — consumed by | Tier |
|------------------|--------------------|------|
| preamble (synthetic section) | Header — the live precedence declaration, resolved as one synthetic section | Default |
| `## Tier` | Setting — § Tiers, "the configured tier … baseline, not a ceiling" | Default — the security/data-integrity escalation sentence in § Tiers is Anchor-tier (Anchor Register #3 hit, resolved at step 0) and stays binding whatever tier is configured |
| `## Max Rounds` | Setting — § Tiers cap sentence; the model tracks rounds against it | Default |
| `## Plan Review` | Setting — `/plan-review` self-invocation in plan mode | Default |
| `## Plan Review Max Rounds` | Setting — `/plan-review` loop bookkeeping, counted in conversation | Default |
| `## Git Memory` | Setting — post-compact git-context nudge (printed by default since hook-lightweighting; heading kept for compatibility) | Default |
| `## Think Harder` | Setting — § Cap Diagnostic Protocol after a compaction, read by the model (no hook injects it) | Default |
| `## Review Thread Rotation` | Setting — the R-a rotation threshold (2–6, unset = 3) read behaviourally by `review-common.md` § Review Loop; counted in conversation, no hook reads it | Default |

No row is a section replacement: `## Tier` is deliberately **not** this file's `## Tiers`, and the other six name no section at all. A user who does want a section replacement restates that section's exact heading — the mechanism is available, the scaffold just does not ship one.

## Enforcement

There is none — by design (hook-lightweighting, 2026-08-13). Hooks are **reminders**: the state is one slot per plane (`code_review`, `doc_review`, `precommit`) under `~/.cache/sd0x-dev-flow/state/<repo-key>/`, outside the repo. The gate verdict itself is behaviour-layer (the reviewer's report — § Review Dispatch); the slot records it — `node scripts/review-state.js note <plane> <pass|fail>` by the model after the reviewer ran, or by the precommit runner on its own conclusive outcome — and a verdict never noted still stands, it just keeps its reminder alive. The note binds the verdict to the current tree digest, so an edit re-opens its plane's reminder because the digest changed — committing the reviewed tree does not. `check` derives what is owed (`passed ⇔ noted ∧ digest match ∧ verdict pass`) and the hooks print it as markdown; `note <plane> fail` increments the slot's `rounds`, `pass` resets it. Nothing blocks, nothing exits nonzero: a stale or missing slot re-reminds on every firing until the next note, and the honest way to silence a reminder is to run the gate and note the verdict — noting without running is forging one. Checker unavailable → hooks fall back to plain git facts and claim no verdict. Escape hatch: `HOOK_BYPASS=1`. Context capacity never overrides an open gate (@rules/context-management.md). Mechanics: `docs/features/hook-lightweighting/2-tech-spec.md` §3. Overrides: @rules/auto-loop-project.md.
