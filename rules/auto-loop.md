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
| 1 | `current_round >= max_rounds` | ⚠️ Need Human | Hard cap. Default 10, configurable via `## Max Rounds` in `auto-loop-project.md`. Tracked via `iteration_history.current_round`. |
| 2 | `findings_by_round[n].total == 0` | Proceed to `/precommit` | All findings resolved this round; early-exit optimization. |
| 3 | `total >= prev_total` AND fingerprint overlap >= 50% for 3+ consecutive rounds | ⚠️ Need Human | Plateau — same issues recurring despite fixes. Tracked via `iteration_history.findings_by_round[].fingerprints`. |
| 4 | `total >= prev_total` AND fingerprint overlap < 50% for 3+ consecutive rounds | Continue | New issues appearing, not plateau. |
| 5 | `total < prev_total` | Continue | Converging toward zero. |
| 6 | `total == null` (parse failure) | Continue | Non-computable; rely on hard cap (row 1). |

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

`total_rounds_session` is incremented on every review iteration (in `_update_iteration()`) and is **never** reset on code edits (unlike `current_round`). This ensures the strategic reset fires based on cumulative effort, not per-cycle effort.

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

> **Note**: The above shows the full field schema; the actual hook may only update a subset of fields.

### Debug and Escape Hatch

| Environment Variable | Purpose                   | Use Case        |
| -------------------- | ------------------------- | --------------- |
| `HOOK_DEBUG=1`       | Output debug information  | Troubleshooting |
| `HOOK_BYPASS=1`      | Skip Stop Hook checks     | Emergency       |

### Standard Gate Sentinels

Review commands must output standard markers. Hook-parsed sentinels are consumed by `stop-guard.sh`; behavior-layer sentinels are consumed by Claude's auto-loop logic only.

| Sentinel | Context | Meaning | Parsed by |
|----------|---------|---------|-----------|
| `✅ Ready` | Code review | No P0/P1 | Hook + behavior |
| `⛔ Blocked` | Code review | Has P0/P1 | Hook + behavior |
| `✅ Mergeable` | Doc review | No 🔴 items | Hook + behavior |
| `⛔ Needs revision` | Doc review | Has 🔴 items | Hook + behavior |
| `✅ All Pass` | Precommit | All checks passed | Hook |
| `⛔ FAIL` / `❌ FAIL` | Precommit | Check failed | Hook |
| `⚠️ Need Human` | Any | Needs human intervention | Behavior-layer only |
| `✅ Plan Ready` | Plan review (requires `## Plan Review` header) | No P0/P1, plan converged | Hook + behavior |
| `⛔ Plan Blocked` | Plan review (requires `## Plan Review` header) | Has P0/P1, loop continues | Hook + behavior |
| `⚠️ Plan Needs Human` | Plan review | max_rounds reached without convergence | Behavior-layer only |
| `[PLAN_REVIEW_DEGRADED]` | Plan review | Reviewer unavailable or secret detected (fail-closed) | Hook + behavior |
| `[PLAN_REVIEW_SKIPPED]` | Plan review | User-intent bypass | Hook + behavior |

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
