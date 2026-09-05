# Auto-Loop Rule ⚠️ CRITICAL

**Terminal completion invariant** — the one rule everything else serves: *work on a change may be declared complete only when every gate its change class requires has passed after the last edit in that gate's change class* — a doc edit re-opens the doc gate, not the code gates, and vice versa (freshness is tracked per plane; a post-precommit Doc Sync therefore does not re-open code review). For code that is an independent review (`/codex-review-fast` — the reviewer researches on its own, per @rules/codex-invocation.md) and then `/precommit`; for `.md` docs it is `/codex-review-doc`. When to run them, how to batch edits, and how deep to review are yours to judge — the invariant constrains the end state, not the choreography. Hooks are **reminders**: they print markdown nudges and an `[AUTO_LOOP_STATE]` fact line (change class, per-plane verdict state) from the single-slot state § Enforcement describes; read the facts, own the decision — nothing blocks. Corollaries, so they are not re-derived: Declaring ≠ Executing (naming a gate is not running it), Summary ≠ Completion (a report does not close an open gate), Fixing ≠ Verifying (re-running the review is the evidence — Self-assessment is not evidence).

## Review Dispatch

**One reviewer — Codex — everywhere by default.** `/codex-review-fast` and `/codex-review-doc` must not launch a secondary. Opt-in dual: `/codex-review-branch --dual` only, off unless the flag is passed. Loop re-review: `--continue` re-dispatches Codex on the same thread. Cycle reset: any code edit invalidates prior verdicts — the reviewer must re-run regardless of prior pass status.

**`codex_fail` → a contract-aware fallback reviewer carries the gate** — `codex_fail` is the transport's own outcome, **adapter exit 1 only** (`skills/codex-code-review/references/codex-transport.md` § Completion state machine): a pending or unknown completion keeps the gate open and dispatches nothing, exit 2 is a configuration error, and an `alloc`/`cleanup` failure is a lifecycle error. The `reason=` label is a separate axis from the trigger, but it never substitutes for it: `timeout` may be selected **only after an adapter exit 1 has independently occurred** and the diagnostic attributes that failure to a timeout. A host-level event alone does not qualify — a foreground ceiling leaves a still-running process (unknown completion) and a killed adapter terminates by signal, not exit 1; both keep the gate open and dispatch nothing (policy change, review-loop-resilience 2026-08-23 — it was `⚠️ Need Human`). The change's first dispatch probes Codex; on failure record `[REVIEWER_FALLBACK] plane=<plane> from=codex to=<agent> reason=<quota|timeout|error> | <ISO8601>` and dispatch the fallback — **sticky per change**: re-reviews never re-probe, the next change probes afresh. Decide via `scripts/lib/review-dispatch.js`; adopt fail-closed via `scripts/validate-family-sentinel.js <contract>` — exactly one legal terminal in the family's own contract, **never translated across contracts**; a failing report moves to the next carrier. A validated fallback verdict is a real gate verdict (`gate_source=fallback:<agent>`), noted as usual — noting one no dispatched reviewer produced is forging (Declaring ≠ Executing). **Priority 4 — every carrier exhausted: no validated verdict exists**: no gate sentinel (plan emits `[PLAN_REVIEW_DEGRADED]` only; the rest emit nothing) and behaviour-layer `⚠️ Need Human` surfaces. **necessity-audit is excluded from both fallback and rotation in v1** (its Codex debate pipeline is constitutive); `seek-verdict` stays non-gate — without Codex its automated dismiss closes. Carriers, priorities and templates: `skills/codex-code-review/references/review-common.md` § Degradation Matrix.

**Thread rotation**: reply-based re-review degrades as a thread grows. R-a (3 replies on the thread — `auto-loop-project.md ## Review Thread Rotation` overrides, 2–6) or R-b (judged context overrun) → fresh first-dispatch on a new thread, frozen baseline only, orchestration-side reconciliation, record `[THREAD_ROTATED]`. The central contract every family's loop references: `skills/codex-code-review/references/review-common.md` § Review Loop.

**Agent defaults**: every agent in `agents/` declares `model: opus` and `effort: high` in its frontmatter. Reviewing is the workload that pays for depth, and an agent that silently ran at a lower tier would look like a passing review. Pinned by `test/agents/frontmatter.test.js`; change the default there and in this line together.

## Tiers

The configured tier (`auto-loop-project.md ## Tier`, unset → `standard`) is a **baseline, not a ceiling**: choose the effective tier from the change's semantics, escalating above the baseline when warranted, never dropping below it. A security or data-integrity change is treated as `thorough` whatever is configured — escalate, and say that you did.

| Tier | Use for | Blocks on | Round cap |
|------|---------|-----------|-----------|
| `fast` | Docs, comments, config, small low-risk edits | P0 | 6 |
| `standard` **(default)** | Ordinary features and bug fixes | P0, P1 | 15 |
| `thorough` | Security, data integrity, releases, public API | P0, P1, P2 | 30 |

These caps are a runaway backstop, deliberately loose: **a cap cannot tell a converging loop from a churning one**. § Stall Detection and Diagnosis is what tells them apart, on evidence, usually many rounds earlier.

An explicit `## Max Rounds` (3–50) in `auto-loop-project.md` overrides the tier's cap. The bookkeeping is yours: count review rounds in conversation; the one mechanical fact is the state slot's `rounds` count (`review-state.js check --format=json`) — it counts failed verdicts on the current change, not your conversational rounds (reset on `pass`): a floor, never the whole story. At the cap → § Stall Detection and Diagnosis. Architecture-level changes, feature removal, or the user asking to stop exit to ⛔ Need Human at any point. **80 is a passing grade.** When the remaining findings are all below the tier's blocking severity, the correct move is `/precommit`, not another round.

Gate sequence: review Ready (no blocking findings) → `/precommit`; precommit Pass → Adequacy Gate → Doc Sync; a precommit failure is fixed and re-run. Adequacy Gate: when a request doc with `## Acceptance Criteria` maps to the change, run `/codex-test-review --ac-trace <request-path>`; mode from `testing-project.md ## Adequacy Mode` (advisory by default). Doc Sync: sync the **current-authority** docs, append status/outcome to the **records** (never rewritten to mirror later code); review them all in **one** `/codex-review-doc` dispatch, with reading depth and batching from `scripts/resolve-review-profile.js`.

## Stall Detection and Diagnosis

A cap answers "how long has this gone on"; what matters is "is anything moving". A **stall round**
is one where findings are outstanding and the round closed none of them — counted by finding
*identity*, not by severity or count. **3** consecutive stall rounds is the signal to stop fixing
and diagnose; closing a finding — or leaving none outstanding — resets the streak, and a round you
cannot compare per-finding holds it where it was (**absence is not a signal**). `✅ Ready` with only sub-threshold findings is not a
stall; it is `/precommit`.

On that signal — or at the round cap, or at the round-10 checkpoint — diagnose, make **one bounded
adjustment** declared before it is made, and return to the loop. Security and data-integrity changes
skip the protocol entirely: any trigger → ⚠️ Need Human. Budgets, kept by you in conversation:
**1** diagnosis per change for the cap, **3** per change for stalls.
The same change hitting the cap a **second** time → ⚠️ Need Human, no second diagnosis.
A **fourth** stall on the same change → ⚠️ Need Human, no fourth diagnosis.
Never re-try an adjustment recorded as failed — state each one's class, action and outcome in the
conversation so a compact summary carries it.

→ `skills/codex-code-review/references/loop-diagnostics.md` — the round-10 checkpoint, stall
memory, what a diagnosis is made of, the
closed class table (`ARCHITECTURE`, `DOC_TOO_LONG`, `ATTENTION_DIFFUSION`, `UNVERIFIED_CLAIM`,
`TIER_MISMATCH`, `REQUIREMENT_AMBIGUITY`) with signals and bounded directions, the five
constraints on `/refactor` as a bounded adjustment, the two `ATTENTION_DIFFUSION` subtypes —
`SCATTER` (fix-batch partition inside one fix phase) and `REFERENCE_DRIFT`
(reference-stability pass) — and the banking sequence (adjustment → gate pass → note →
user-approved commit).

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
| `## Think Harder` | Setting — the diagnosis protocol after a compaction, read by the model (no hook injects it); § Stall Detection and Diagnosis routes to `loop-diagnostics.md` § Cap Diagnostic Protocol, which carries the checklist | Default |
| `## Review Thread Rotation` | Setting — the R-a rotation threshold (2–6, unset = 3) read behaviourally by `review-common.md` § Review Loop; counted in conversation, no hook reads it | Default |
| `## Codex Profile` | Setting — the Codex profile every dispatch carries, read by `skills/codex-code-review/references/codex-transport.md` § Profile; unset means Codex's own default configuration, and selection is not tier-dependent in v1 | Default |

No row is a section replacement: `## Tier` is deliberately **not** this file's `## Tiers`, and the other seven name no section at all. A user who does want a section replacement restates that section's exact heading — the mechanism is available, the scaffold just does not ship one.

## Enforcement

There is none — by design (hook-lightweighting, 2026-08-13). Hooks are **reminders**: the state is one slot per plane (`code_review`, `doc_review`, `precommit`) under `~/.cache/sd0x-dev-flow/state/<repo-key>/`, outside the repo. The gate verdict itself is behaviour-layer (the reviewer's report — § Review Dispatch); the slot records it — `node scripts/review-state.js note <plane> <pass|fail>` by the model after the reviewer ran, or by the precommit runner on its own conclusive outcome — and a verdict never noted still stands, it just keeps its reminder alive. The note binds the verdict to the current tree digest, so an edit re-opens its plane's reminder because the digest changed — committing the reviewed tree does not. `check` derives what is owed (`passed ⇔ noted ∧ digest match ∧ verdict pass`) and the hooks print it as markdown; `note <plane> fail` increments the slot's `rounds`, `pass` resets it. Nothing blocks, nothing exits nonzero: a stale or missing slot re-reminds on every firing until the next note, and the honest way to silence a reminder is to run the gate and note the verdict — noting without running is forging one. Checker unavailable → hooks fall back to plain git facts and claim no verdict. Escape hatch: `HOOK_BYPASS=1`. Context capacity never overrides an open gate (@rules/context-management.md). Mechanics: `docs/features/hook-lightweighting/2-tech-spec.md` §3. Overrides: @rules/auto-loop-project.md.
