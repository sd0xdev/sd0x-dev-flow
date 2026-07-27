# Auto-Loop Rule ⚠️ CRITICAL

**Edit → review in the same reply → fix what blocks → re-review → pass → next gate.**

Everything below serves that sentence. Where this rule leaves room for judgment, use it; where it states an anchor, the anchor is not negotiable.

## The Four Anchors

| Anchor | Violation looks like |
|--------|---------------------|
| **Declaring ≠ Executing** | "Next step: run `/codex-review-fast`" — without invoking the tool |
| **Summary ≠ Completion** | A polished table or checklist, then stopping, while a gate is still open |
| **Fixing ≠ Verifying** | "Issue fixed" / "already addressed" without re-running the review. Self-assessment is not evidence |
| **Same reply** | Waiting for the user to say "continue" after an edit |

Corollaries, so they are not re-litigated: never ask "should I re-review?" / "要執行嗎？" before a required step — the loop mandates execution, not permission. Never cite context window, session length, or token budget as grounds to skip or defer a review; if context is genuinely tight, still attempt it (see @rules/context-management.md, and note that `<budget:token_budget>` tags are planning signals only). Brief operational lines ("Fixed 3, re-running review…") are fine mid-loop; terminal summaries are not, until every gate passes.

## Tiers

The tier sets **how much** review a change gets. It never changes *whether* the loop runs, and never relaxes the four anchors.

| Tier | Use for | Blocks on | Round cap |
|------|---------|-----------|-----------|
| `fast` | Docs, comments, config, small low-risk edits | P0 | 3 |
| `standard` **(default)** | Ordinary features and bug fixes | P0, P1 | 5 |
| `thorough` | Security, data integrity, releases, public API | P0, P1, P2 | 30 |

Set it in `auto-loop-project.md` under `## Tier`. Unset or unrecognized → `standard`. An explicit `## Max Rounds` (3–50) overrides the tier's cap **and** is the value the hooks persist and check — one setting, both layers. Checking is not blocking: only `strict` or dual mode stops on it (§ Exit Conditions). Left unset the two diverge: you follow the tier while the hook-side cap sits at its default 30. A security or data-integrity change is treated as `thorough` whatever is configured — escalate, and say that you did.

**80 is a passing grade.** `standard` exists to ship a correct, tested change and stop. When the reviewer's remaining findings are all below the tier's blocking severity, the correct move is `/precommit`, not another round. Chasing the last few points is what `thorough` is for — a deliberate choice, not the default gravity.

## Auto-Trigger

| Change | Event | Execute immediately |
|--------|-------|--------------------|
| code | Fixed a blocking finding | `/codex-review-fast` |
| code | review Ready (no blocking findings) | `/precommit` |
| code | review Ready, only sub-threshold findings | Log, then `/precommit` |
| code | precommit Pass | Adequacy Gate (if request doc) → Doc Sync |
| code | precommit failure | Fix → re-run |
| `.md` | Fixed doc issues, or review failed | `/codex-review-doc` |

### Review Dispatch

**One reviewer — Codex — everywhere by default.** `/codex-review-fast` and `/codex-review-doc` dispatch Codex alone and must not launch a secondary.

| | |
|---|---|
| Opt-in dual | `/codex-review-branch --dual` only, off unless the flag is passed. For releases and security-sensitive work, not routine fixes |
| Loop re-review | `--continue` re-dispatches Codex on the same thread |
| Cycle reset | Any code edit resets the review cycle — the reviewer must re-run regardless of prior pass status |

> **Why single is the default.** Dual dispatch doubled the token and wall-clock cost of every iteration, and because `review_mode: "dual"` forces `stop-guard` into `strict`, it turned every advisory warning into a hard block. Worth paying for on a release; not on a typical fix. No fail-closed property depends on it — in `single` mode `code_review.passed` governs the gate, and the sidecar, round cap and corrupt-state escalations behave identically.

### Verification Depth

Fixes must be **verified**, not **proved**. Re-running the review after a fix is the required evidence; a regression test (per @rules/testing.md) is the required cover. State plainly what ran and what it reported.

Not expected: mutation-testing each fix to show its assertion fails without it, "blind controls", or harnesses that rewrite production files to score the suite. Mutation testing stays available when a reviewer specifically asks — it is **not** a standing requirement and must never run as an unprompted loop. Each mutant costs a full suite run, and a harness killed mid-run can leave production source rewritten; that happened, silently reverted a fix while its explanatory comment stayed behind, and cost more than the evidence was worth.

## Sub-Threshold Findings

A finding **below** the tier's blocking severity does not re-open the loop.

| Tier | Blocking | Sub-threshold |
|------|----------|---------------|
| `fast` | P0 | P1, P2, Nit |
| `standard` | P0, P1 | P2, Nit |
| `thorough` | P0, P1, P2 | Nit |

**On `✅ Ready` with only sub-threshold findings: log each one and proceed to `/precommit`.** No extra fix pass, no extra re-review.

```
[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>
```

**That exact tag, that exact field order — and it must come from the reviewer.** The line is hook-parsed at column 0 out of the *review tool's output* and written to `.claude_nit_history.json` with a TTL, which is what stops the same finding being re-raised next session. The reviewer prompts instruct Codex to emit it; the same line typed into your own prose triggers no PostToolUse and persists nothing, so restate deferrals for the reader if you like but do not treat that as the record. Field 2 is the issue, field 3 the reason — swapping them mis-files the entry, and any other tag is prose no hook reads. The name predates tiers; the severity rides in `reason:`.

Two exceptions, fixed in the current pass with no new round: a one-line fix in a file you already have open, and a sub-threshold finding that is actually a security or data-integrity defect (severity was mis-assigned — escalate to `thorough` and say so).

Sub-threshold findings are recorded, not lost: `/codex-review-branch` picks them up when the change is next reviewed at depth.

## Exit Conditions

Evaluated top-to-bottom, first match wins. State lives in `.claude_review_state.json` `iteration_history`.

| # | Condition | Action |
|---|-----------|--------|
| 1 | `current_round >= max_rounds` | ⚠️ Need Human |
| 2 | Zero findings **and** the gate verdict itself passed | `/precommit` |
| 3 | Findings decreasing | Continue |
| 4 | Findings not decreasing | Continue — plateau detection is V2, so row 1 is the backstop |

Row 1 is the only convergence exit the hook observes, and it only *blocks* in `strict` or dual mode; under the default `warn` it prints to stderr and lets the stop through. **In warn mode the behaviour layer is the enforcement** — treat the cap as binding on yourself.

Row 2's zero is not self-evidencing: the count is derived by pattern-matching finding lines, so a reviewer error or a format change also yields `0`. Corroborate it with a passing `✅ Ready` before reading it as convergence. And a passing review is not always a passing gate: whenever Stop names an aggregate obligation, no single-reviewer round discharges it — and a `Do NOT auto-retry` line means no command does. Take either at face value rather than re-reviewing into it.

`current_round` is a **lower bound** on rounds actually run — the increment is best-effort and a dropped verdict costs no round. It counts code-review rounds only; doc reviews and code edits do not touch it, and only a passing `/precommit` resets it. A value above `max_rounds` is normal, not corruption. Mechanics: [`docs/features/auto-loop-evolution/4-implementation.md`](../docs/features/auto-loop-evolution/4-implementation.md) §2.

**Advisory exits** (independent of `iteration_history`):

- ✅ All Pass — code: review + precommit passed; docs: doc review passed
- ⛔ Need Human — architecture change, feature removal, user asks to stop
- ⚠️ Need Human — feature docs not found (3-level fallback exhausted); or a P0/P1 dismiss candidate awaiting confirmation via `/seek-verdict`

## Strategic Reset (opt-in)

When `total_rounds_session >= max_rounds - 3` and it has not yet fired, the post-compact hook injects a `[STRATEGIC_RESET]` checklist — re-read the original requirements, challenge the assumptions, try a fundamentally different approach before escalating at the cap. Once per state-file lifetime.

Enable with `## Think Harder: enabled` in `auto-loop-project.md`. `total_rounds_session` is never reset, so this fires on cumulative effort rather than per-cycle effort.

## Gate Sentinels

Emit these verbatim. Hook-parsed ones become durable state; behaviour-layer ones are read by the loop only.

| Sentinel | Context | Parsed by |
|----------|---------|-----------|
| `✅ Ready` / `⛔ Blocked` | Code review | Hook + behavior |
| `✅ Mergeable` / `⛔ Needs revision` | Doc review | Hook + behavior |
| `## Overall: ✅ PASS` | Precommit | Hook |
| `## Overall: ⛔ FAIL` / `## Overall: ❌ FAIL` | Precommit | Hook |
| `## Overall: ⚠️ NO CHECKS RUN` | Precommit — non-verdict, no state recorded | Hook |
| `✅ Plan Ready` / `⛔ Plan Blocked` | Plan review (needs a `## Plan Review` header) | Hook + behavior |
| `[PLAN_REVIEW_DEGRADED]` / `[PLAN_REVIEW_SKIPPED]` | Plan review | Hook + behavior |
| `⚠️ Need Human` · `⚠️ Plan Needs Human` | Any | Behavior-layer only |

Two rules govern how you write them:

1. **A precommit sentinel owns its whole line.** Column 0, nothing before or after it. A mention inside prose or a template line must not look like a verdict — the parser takes the last `## Overall:` line, so a stray one masks a real `FAIL`.
2. **Plan sentinels stay in their namespace.** Plan-review output must never contain a bare `✅ Ready`, `✅ Mergeable`, `## Gate:` or bare `⛔ Blocked`.

`✅ All Pass` is behaviour-layer prose for "every gate passed" — it is **not** the precommit sentinel and no hook classifies it as a verdict.

Parsing mechanics, transcript-fallback anchoring, and the archaeology behind both: [`4-implementation.md`](../docs/features/auto-loop-evolution/4-implementation.md) §4.

## Enforcement

| Layer | Mechanism | Trigger |
|-------|-----------|---------|
| PostToolUse | Records file changes and review verdicts into `.claude_review_state.json` | Edit / Bash / Skill |
| SessionStart (compact) | Re-injects auto-loop state after compaction | Context compaction |
| Stop | Reads the state file; warns before stopping with a gate open (blocks in `strict`) | Stop attempt |

When a hook cannot durably record a transition it writes a **fail-closed sidecar marker** rather than failing silently, and stop-guard invalidates the affected gate. You will see this as a gate that re-opens for no visible reason — that is the design, not a bug. Full protocol: [`4-implementation.md`](../docs/features/auto-loop-evolution/4-implementation.md) §1, §3.

| Escape hatch | Effect |
|--------------|--------|
| `HOOK_DEBUG=1` | Hook debug output |
| `HOOK_BYPASS=1` | Skip Stop hook checks (emergency) |

## Correct Behavior

```
"Fixed 3 issues, running /codex-review-fast..."
[Execute: Codex --continue]
"✅ Ready. 2 Nit deferred (logged). Running /precommit..."
[Execute]
"All passed ✅"
```

The failure mode this replaces: edit → polished summary → "next step: suggest running the review" → stop, waiting for the user. That is Declaring-as-Executing and Summary-as-Completion in one move.

### Adequacy Gate (behavior-layer)

After precommit Pass, if a request doc with `## Acceptance Criteria` is detected: auto-detect it (3-level fallback — context → git diff → `⚠️ Need Human`), run `/codex-test-review --ac-trace <request-path>`, then evaluate. Mode comes from `testing-project.md ## Adequacy Mode`.

| Mode | ✅ Adequate | ⚠️ With exceptions | ⚠️ Need Human | ⛔ Inadequate |
|------|------------|-------------------|---------------|---------------|
| advisory (default) | Continue | Continue + log | Warn + continue | Warn + continue |
| strict | Continue | Continue + log | **Stop** | Re-enter fix loop |
| off | Skip | Skip | Skip | Skip |

No request doc with an AC section → no gate. Behavior-layer only; strict is opt-in.

### Doc Sync

After precommit Pass, **only** when the change maps to a feature under `docs/features/`: `/update-docs <tech-spec-path>` for the changed sections, then `/create-request --update <request-path>` for Progress / Status / AC. Same 3-level target detection as above.

Safety valve: after syncing, compare the code diff against the pre-sync baseline — new code changes send you back into the review loop.

## Project Customization

Overrides belong in `auto-loop-project.md`, not here. See @rules/auto-loop-project.md.
