# Auto-Loop Rule ⚠️ CRITICAL

**Terminal completion invariant** — the one rule everything else serves: *work on a change may be declared complete only when every gate its change class requires has passed after the last edit in that gate's change class* — a doc edit re-opens the doc gate, not the code gates, and vice versa (freshness is tracked per plane; a post-precommit Doc Sync therefore does not re-open code review). For code that is an independent review (`/codex-review-fast` — the reviewer researches on its own, per @rules/codex-invocation.md) and then `/precommit`; for `.md` docs it is `/codex-review-doc`. When to run them, how to batch edits, and how deep to review are yours to judge — the invariant constrains the end state, not the choreography. Hooks emit `[AUTO_LOOP_STATE]` fact blocks (change class, receipts, round/cap, tier, pending obligations); read the facts, own the decision. Corollaries, so they are not re-derived: Declaring ≠ Executing (naming a gate is not running it), Summary ≠ Completion (a report does not close an open gate), Fixing ≠ Verifying (re-running the review is the evidence — Self-assessment is not evidence).

## Review Dispatch

**One reviewer — Codex — everywhere by default.** `/codex-review-fast` and `/codex-review-doc` must not launch a secondary. Opt-in dual: `/codex-review-branch --dual` only, off unless the flag is passed. Loop re-review: `--continue` re-dispatches Codex on the same thread. Cycle reset: any code edit invalidates prior verdicts — the reviewer must re-run regardless of prior pass status.

**Codex unavailable is not a fallback — it is `⚠️ Need Human`.** A built-in reviewer agent may be run when the user asks for one, and what it produces is **advisory findings, never a gate verdict**: substituting it silently swaps the reviewer the gate was defined against. The contract lives in `skills/codex-code-review/SKILL.md` § Step 2 and `references/review-common.md` § Degradation Matrix — read those rather than re-deriving it here. Two facts worth knowing before you reach for one: the receipt hook recognizes producers by **command name** (`/codex-review*`, `/review-spec`), so a Task agent closes no gate whatever its output says; and `/review-spec` **is** a recognized doc-plane producer, which makes it the one skill-sanctioned path that both uses a built-in agent and records a receipt.

**Agent defaults**: every agent in `agents/` declares `model: opus` and `effort: high` in its frontmatter. Reviewing is the workload that pays for depth, and an agent that silently ran at a lower tier would look like a passing review. Pinned by `test/agents/frontmatter.test.js`; change the default there and in this line together.

## Tiers

The configured tier (`auto-loop-project.md ## Tier`, unset → `standard`) is a **baseline, not a ceiling**: choose the effective tier from the change's semantics, escalating above the baseline when warranted, never dropping below it. A security or data-integrity change is treated as `thorough` whatever is configured — escalate, and say that you did.

| Tier | Use for | Blocks on | Round cap |
|------|---------|-----------|-----------|
| `fast` | Docs, comments, config, small low-risk edits | P0 | 3 |
| `standard` **(default)** | Ordinary features and bug fixes | P0, P1 | 5 |
| `thorough` | Security, data integrity, releases, public API | P0, P1, P2 | 30 |

An explicit `## Max Rounds` (3–50) in `auto-loop-project.md` overrides the tier's cap and is the value the hooks persist. `current_round >= max_rounds` → § Cap Diagnostic Protocol below (the hook reports only the neutral fact "Review round cap reached (n/max)"; the disposition is yours). Architecture-level changes, feature removal, or the user asking to stop exit to ⛔ Need Human at any point. **80 is a passing grade.** When the remaining findings are all below the tier's blocking severity, the correct move is `/precommit`, not another round.

Gate sequence: review Ready (no blocking findings) → `/precommit`; precommit Pass → Adequacy Gate → Doc Sync; a precommit failure is fixed and re-run. Adequacy Gate: when a request doc with `## Acceptance Criteria` maps to the change, run `/codex-test-review --ac-trace <request-path>`; mode comes from `testing-project.md ## Adequacy Mode` (advisory by default, strict is opt-in). Doc Sync: when the change maps to a feature under `docs/features/`, sync the tech spec and request doc, then doc-review the result.

## Cap Diagnostic Protocol

Hitting the round cap is a diagnosis point, not an automatic hand-off — **except** for security or data-integrity changes, which skip this protocol entirely: cap hit → ⚠️ Need Human directly. The trigger is the cap itself, behaviour-layer, independent of whether compaction ever fires.

There is also an **earlier checkpoint**: at round 10 on the same change (`AUTO_LOOP_CHECKPOINT_ROUNDS`), the round-counting hook emits `[STRATEGIC_RESET]` and you run this same protocol — diagnose, one bounded adjustment, back to the loop. It fires once per change **per session** — `hooks/session-init.sh` clears both the flag and `current_round` at SessionStart, so a change carried into a new session can reach it again after ten fresh rounds — and only matters at `thorough`, where the cap is 30 and ten rounds of circling is already the signal the cap exists to catch. It is a checkpoint, not a cap: nothing blocks, and the round budget is untouched. It is **on by default with no opt-in switch** — the effective opt-out is setting `AUTO_LOOP_CHECKPOINT_ROUNDS` well above the tier's cap, which is why nothing gates it. Well above, not cap+1: nothing clamps `current_round` to `max_rounds`, so a loop running past its cap in `warn` mode can still reach a threshold set just above it. The post-compact injection is an auxiliary channel for the same checklist, never the trigger.

1. **Diagnose** — classify the stall as exactly one class from the closed table below; state the class and its observed signals in a short block, not free prose.
2. **One bounded adjustment** — declared *before* it is made: name the scope (which files), the nature (the class's direction column), and the size (a single split, a single re-scope, or ≤ 5 focused edits). An adjustment must never grow into a rewrite mid-loop; if the diagnosis itself shows architecture-level change is needed, exit ⛔ Need Human instead of adjusting.
3. **Return to the loop** — re-enter review with the adjustment as the change under review.

**Anti-loop cap: 1 diagnosis per change.** The same change hitting the cap a **second** time after a diagnosis → ⚠️ Need Human, no second diagnosis. This split lives entirely here — the hook cannot distinguish first from second (it sees only round/cap), so in `warn` mode this rule is the only enforcement; treat it as binding.

**What the diagnosis is made of.** Each **code** review round that commits its counter emits `[LOOP_PROGRESS] round=n closed=a persisted=b new=c findings=d` — finding *identities* closed, carried over, and introduced since the previous round. Not every round: the doc plane never emits one (the ledger rides the code-review branches only), and a code round that loses the lock or fails its write emits nothing. **Absence is not a signal** — diagnose from the lines you have, and never read a missing one as `closed=0`. Counts alone cannot tell "fixed one, introduced one" from "nothing moved"; both read `total=2`. When `persisted + new < findings` the ledger could not read this round's findings (section-shaped reports carry no per-finding text) and its figures are not evidence. Otherwise a run of `closed=0` with findings outstanding is the churn signature and points at `ATTENTION_DIFFUSION` or `ARCHITECTURE`; steady `closed>0 new=0` says the loop is converging and the right move is to keep going, not to diagnose. It is a fact, not a verdict — nothing blocks on it. Mechanics: `docs/features/auto-loop-autonomy/4-implementation.md` §2.

| Class | Signals | Bounded direction |
|-------|---------|-------------------|
| `ARCHITECTURE` | Same defect recurs across files; fixing A breaks B | Stop patching; back to design, re-scope |
| `DOC_TOO_LONG` | Target exceeds the `@rules/docs-numbering.md` limit; reviewer repeatedly flags inconsistency | Split or shrink first, then resume review |
| `ATTENTION_DIFFUSION` | Fixes introduce new defects; the same fact is recorded wrong repeatedly | Shrink the batch; verify each item before merging |
| `UNVERIFIED_CLAIM` | Blocking findings cluster on unmeasured claims | Measure first; write the derivation command into the doc |
| `TIER_MISMATCH` | Findings persistently below the blocking threshold | Converge per tier and move to the next gate |
| `REQUIREMENT_AMBIGUITY` | Reviewer and implementer disagree on what "correct" means | Ask the human; stop guessing |

## Sub-Threshold Findings

| Tier | Blocking | Sub-threshold |
|------|----------|---------------|
| `fast` | P0 | P1, P2, Nit |
| `standard` | P0, P1 | P2, Nit |
| `thorough` | P0, P1, P2 | Nit |

On `✅ Ready` with only sub-threshold findings: log them and proceed. No extra fix pass, no extra re-review. The durable record is `[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>` — hook-parsed at column 0 from the *review tool's* output (the same line in your own prose persists nothing), field order fixed. Two exceptions are fixed on the spot with no new round: a one-line fix in a file already open, and a sub-threshold finding that is really a security or data-integrity defect (severity mis-assigned — escalate to `thorough` and say so).

## Gate Sentinels (hook-parsed, emit verbatim)

| Sentinel | Context |
|----------|---------|
| `✅ Ready` / `⛔ Blocked` | Code review |
| `✅ Mergeable` / `⛔ Needs revision` | Doc review |
| `## Overall: ✅ PASS` / `## Overall: ⛔ FAIL` / `## Overall: ❌ FAIL` / `## Overall: ⚠️ NO CHECKS RUN` | Precommit — the sentinel owns its whole line at column 0; the parser takes the *last* `## Overall:` line, so a stray one masks a real FAIL |
| `✅ Plan Ready` / `⛔ Plan Blocked` / `⚠️ Plan Needs Human` / `[PLAN_REVIEW_DEGRADED]` / `[PLAN_REVIEW_SKIPPED]` | Plan review (needs a `## Plan Review` header; plan output must never contain a bare `✅ Ready`, `✅ Mergeable`, `## Gate:` or bare `⛔ Blocked`) |

`✅ All Pass` is behaviour-layer prose for "every gate passed" — it is *not* the precommit sentinel and no hook classifies it as a verdict. `⚠️ Need Human` is behaviour-layer only.

## Override Contract

`rules/auto-loop-project.md` (user-owned) customizes this file — **Default and Guidance tiers only**. Anchor-tier instructions (`rules/discretion.md` § Anchor Register) are never overridable: on conflict the Anchor wins and the conflict is reported, not silently resolved.

Resolution is **Anchor-first**, because an instruction's tier is decided by `discretion.md`, never by a label written next to it: **(0)** an Anchor Register hit resolves to **Anchor** and stops there — a tier annotation in either file cannot downgrade a Register hit, and one that tries is reported as a conflict rather than honoured. Only for non-Anchor instructions does the rest apply, highest first: (1) an explicit tier annotation on the instruction itself; (2) the heading table below; (3) preamble text before the first `##` resolves as one synthetic section; (4) an unknown heading fails closed to **Default** and is listed in the report, never silently dropped.

Two override kinds, and the distinction is load-bearing: a **section replacement** restates a `##` heading this file actually defines and replaces that section wholesale; a **setting** names a configuration slot that this file's prose or a hook reads by name. Settings have no same-named section here, so "full replacement" never describes them — the shipped scaffold is settings-only, and every one names its consumer below.

| Override heading | Kind — consumed by | Tier |
|------------------|--------------------|------|
| preamble (synthetic section) | Header — the live precedence declaration, resolved as one synthetic section | Default |
| `## Tier` | Setting — § Tiers, "the configured tier … baseline, not a ceiling" | Default — the security/data-integrity escalation sentence in § Tiers is Anchor-tier (Anchor Register #3 hit, resolved at step 0) and stays binding whatever tier is configured |
| `## Max Rounds` | Setting — § Tiers cap sentence; the hooks persist the value | Default |
| `## Plan Review` | Setting — `/plan-review` self-invocation in plan mode | Default |
| `## Plan Review Max Rounds` | Setting — plan-review state init | Default |
| `## Git Memory` | Setting — post-compact hook, git-context injection | Default |
| `## Think Harder` | Setting — post-compact hook, § Cap Diagnostic Protocol auxiliary channel | Default |

No row is a section replacement: `## Tier` is deliberately **not** this file's `## Tiers`, and the other five name no section at all. A user who does want a section replacement restates that section's exact heading — the mechanism is available, the scaffold just does not ship one.

## Enforcement

PostToolUse records receipts into `.claude_review_state.json`; Stop reads them and warns when a gate is open (blocks only in `strict` or dual mode). A hook that cannot durably record a transition writes a fail-closed sidecar marker and stop-guard invalidates the affected gate — a gate re-opening for no visible reason is that design, not a bug. Context capacity never overrides an open gate (@rules/context-management.md). Escape hatches: `HOOK_DEBUG=1` (debug output), `HOOK_BYPASS=1` (emergency skip). Mechanics, parser anchoring, and the archaeology behind every paragraph this file used to carry: `docs/features/auto-loop-evolution/4-implementation.md`. Project overrides: @rules/auto-loop-project.md.
