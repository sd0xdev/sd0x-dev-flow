# Review Common Definitions

## Severity Levels

- **P0**: System crash, data loss, security vulnerability
- **P1**: Functional anomaly, severe performance degradation
- **P2**: Code quality, maintainability concerns
- **Nit**: Style suggestions, minor improvements

## Review Dimensions

| Dimension       | Checklist |
|-----------------|-----------|
| Correctness     | Logic errors, boundary conditions, null handling, off-by-one, type safety, error handling |
| Security        | Injection attacks (SQL/NoSQL/Command), auth bypass, sensitive data leaks, OWASP Top 10 |
| Performance     | N+1 queries, memory leaks, unnecessary loops/computations, blocking operations |
| Maintainability | Naming clarity, function length, single responsibility, duplicate code, testability |

## Merge Gate

The gate is decided by the **tier's blocking severity** (see `@rules/auto-loop.md` § Tiers): `fast` blocks on P0, `standard` (the default) on P0/P1, `thorough` on P0/P1/P2.

- **Ready**: No finding at or above the tier's blocking severity
- **Blocked**: At least one such finding, needs fix

Findings below that line are **sub-threshold** — reported, not blocking. See `@rules/auto-loop.md` § Sub-Threshold Findings for what to do with them.

## Codex Independent Research (Required)

Codex **must** perform its own research, not rely only on provided diff/context:

### Git Exploration (Priority)

1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Check full content of changed files: `cat <changed file> | head -200`

### Project Research

- Search called functions: `grep -r "functionName" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10`
- Read related files: `cat <file-path> | head -100`
- Understand class definitions: `grep -rA 20 "class ClassName" . --include="*.ts" --include="*.js"`

## Review Loop

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is Blocked:

1. Remember the `threadId`
2. Fix every finding at or above the tier's blocking severity (`${BLOCKING}`) — sub-threshold ones are logged, not fixed
3. Re-review using `--continue <threadId>`
4. Repeat until Ready

## Sub-Threshold Findings

When review returns Ready with findings **below** the tier's blocking severity, they do **not** re-open the loop. Log them and move on:

```
[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>
```

That tag and field order are **hook-parsed** (`post-tool-review-state.sh` → `.claude_nit_history.json`, TTL-deduplicated across sessions). Field 2 is the issue text, field 3 is the reason — putting the severity in field 2 mis-files the entry, and any other tag is not read at all.

**The line has to come out of the reviewer's output, not your prose.** The parse runs on the review tool's result, so `${BLOCKING}`-derived deferrals are produced by Codex under the `### Deferred Findings` section of the prompt templates. A line you type yourself reads fine to a human and persists nothing.

Then proceed to `/precommit`. Two exceptions where fixing anyway is right (per `@rules/auto-loop.md` § Sub-Threshold Findings): the fix is one line in a file already open, or the finding is a mis-assigned security / data-integrity issue that should have been P0/P1.

There is no batch-fix-then-re-review sweep. It cost a full extra review round per cycle to chase findings the tier had already declared non-blocking.

### Finding Identity

Used when comparing findings across rounds (to tell a persisting issue from a new one):

| Step | Description |
|------|-------------|
| Parse | Extract findings from Codex output (tag-based `[P2]`/`[Nit]` or section-based `#### P2`/`#### Nit`) |
| Identity | Key = `file + canonicalized issue text` (line number approximate, may shift after fix) |
| Dedupe | Same key across reviews counts as 1 item |
| False-positive | Same key persists after a genuine fix → treat as `possible-false-positive`, log and defer |

### Re-review Prompt Template

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<from --continue parameter>',
  prompt: `I have fixed the previously identified issues. Please re-review:

## ${LOCAL_CHECKS ? 'Local Check Results\n' + LOCAL_CHECKS + '\n\n##' : ''} New Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

Please verify:
1. Have the previously identified blocking issues been correctly fixed?
2. Did the fixes introduce new issues?
3. Update Merge Gate status`,
});
```

> The re-review deliberately does **not** ask for a status roll-call of sub-threshold findings. They were already logged as `[NIT_DEFERRED]` and are not what the loop is converging on; asking re-surfaces them and buys another round.

## Dismiss Verdict Format

When a finding is verified via `/seek-verdict`, output:

**Dismiss intent**:

```
[DISMISS_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | verdict=<DISMISS_VERIFIED|DISMISS_CANDIDATE|FIX_REQUIRED|NEED_HUMAN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601> | intent=dismiss | authorization=<automated|human-required|human-confirmed>
```

**Confirm/Clarify intent**:

```
[SEEK_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | intent=<confirm|clarify> | verdict=<CONFIRMED|DISPUTED|HIGH_IMPACT|LOW_IMPACT|UNCERTAIN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601>
```

| Field | Redaction |
|-------|-----------|
| `key` | File path + issue summary (<= 120 chars); no code snippets |
| `evidence` | File:line references only; no source code |
| All fields | No secrets/tokens/passwords/API keys |

## Output Findings Format

```
- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation> [source: codex|toolkit|both]
```

> Note: `[source: ...]` is required under `--dual` and omitted in single-reviewer mode, which is the default.

## AC Coverage Format (Spec-Driven Review)

When `SPEC_CHECKLIST` is injected (feature has request doc with ACs), review output includes:

| AC | Status | Evidence |
|----|--------|----------|
| AC text | Status | file:line reference |

**Status values**: ✅ Implemented, ⚠️ Partial, ❌ Missing, N/A (not applicable to this change)

**Omitted when**: No feature detected, no request doc, or no AC section.

## Gate Sentinels

- `✅ Ready` — Passed (code review)
- `⛔ Blocked` — Failed (code review)

**Where the effective mode is single these sentinels are the whole gate** — effective, not merely un-flagged: a persisted `review_mode=dual`, or an aggregate-plane marker left by a failed transition, puts the aggregate gate in charge no matter how this review was dispatched. They ride in the reviewer's own output, which `post-tool-review-state.sh` parses into `code_review.passed`. Do **not** run `scripts/emit-review-gate.sh` — no argument is safe outside `--dual`, and they are unsafe in different ways. See § Aggregate-Plane Writes.

**Under `/codex-review-branch --dual` only**, additionally run `bash scripts/emit-review-gate.sh PENDING` before dispatch and `... READY|BLOCKED` after aggregation (it outputs `REVIEW_GATE=<value>`, consumed by the same hook). There the emitter is the point — it is what makes an incomplete aggregate fail closed.

## Dual Reviewer Aggregation (opt-in)

**This whole section applies only under `/codex-review-branch --dual`.** The default everywhere is a single reviewer (Codex). Where the aggregate plane is dormant, none of the mapping, deduplication or degradation logic below runs — Codex's findings are the output as-is.

Dormant is not the same as `review_mode == "single"`. Two states arm the plane while only one reviewer ran, and neither is discharged by that reviewer's verdict: a persisted `review_mode=dual` (a default invocation does not reset it, and no downgrade exists), and an `aggregate_write_failed` or `lock_failure` marker.

When `--dual` is passed, `review_mode=dual` and two reviewers run in parallel. This section defines how to merge their results.

### Aggregate-Plane Writes

What `scripts/emit-review-gate.sh` actually does, per argument and per lock outcome. Source: `hooks/post-tool-review-state.sh` — `update_aggregate_gate` (locked) and `update_aggregate_blocked` (fallback).

| Argument | Outer lock | `review_mode` | `aggregate_gate` | Marker on failure |
|----------|-----------|---------------|------------------|-------------------|
| `PENDING` | acquired | → `dual` | armed (`executed=false`) | `aggregate_write_failed` |
| `READY` / `BLOCKED` | acquired | untouched | verdict recorded | `aggregate_write_failed` |
| any of the three | **failed** | → `dual` (best-effort) | → `BLOCKED` (best-effort) | `lock_failure`, raised **before** the best-effort JSON state write |

`aggregate_write_failed` has three raise points and they do not share an ordering: state-file initialization failure and staging failure raise it **before** the aggregate transition's jq/rename sequence; only a failed commit raises it **after**.

Three consequences that dense prose kept losing:

- **A `review_mode=dual` written by any of these rows outlives the review that caused it.** It forces stop-guard into `strict` and stays there until the state file is rebuilt or the field is changed by hand — SessionStart preserves it, and no supported `dual → single` downgrade exists.
- **`READY`/`BLOCKED` can still set `review_mode=dual`** — not on the normal path, but whenever the outer lock fails and the whole call diverts to the fallback row.
- **A marker tells you nothing about what `review_mode` currently reads.** `aggregate_write_failed` means the locked transition did not commit; `lock_failure` means the lock was never held and the write that follows it is best-effort. Neither implies a particular field value. Check both signals — never infer one from the other.

### Severity Mapping (toolkit → standard)

`pr-review-toolkit:code-reviewer` uses confidence scoring. Map to P0-Nit:

| toolkit Output | Default Mapping | Upgrade Condition |
|----------------|-----------------|-------------------|
| Critical (confidence 90-100) | P1 | Contains P0 keywords → P0 |
| Important (confidence 80-89) | P2 | — |
| < 80 confidence | Not reported | toolkit filters internally |

**P0 keywords**: crash, data loss, security vulnerability, injection, auth bypass, RCE, SSRF, XSS

`strict-reviewer` already uses P0/P1/P2/Nit format — no mapping needed.

### Deduplication Algorithm

| Step | Rule |
|------|------|
| Key | `canonical_file_path + canonical_issue_text` |
| Line tolerance | ±5 lines (ignore line number differences within range) |
| Conflict resolution | Same key → keep highest severity (P0 > P1 > P2 > Nit) |
| Source merge | Same key from both reviewers → `source = "both"` |

### Degradation Matrix

| Scenario | Behavior | Gate Source | Output |
|----------|----------|------------|--------|
| Codex ✅ + Secondary ✅ | Union aggregation | `codex+toolkit` | Full dual findings |
| Codex ✅ + Secondary ❌ | Codex-only + degradation warning | `codex-only` | `⚠️ Secondary reviewer unavailable` |
| Codex ❌ + Secondary ✅ | `⛔ Blocked` + `⚠️ Need Human`; report the secondary's findings as advisory | `none` | `⚠️ Codex MCP unavailable — secondary cannot carry the gate` |
| Both ❌ | `⛔ Blocked` + `⚠️ Need Human` | `none` | Both reviewers failed |

**Codex failing never degrades to a passing gate**, in either mode. It is the gate everywhere — `--dual` adds a second set of eyes, not a second authority — so a secondary-only result is advisory findings plus `⚠️ Need Human`, matching what the READMEs say happens when Codex is absent. The row above used to read `toolkit-only`, which let a review pass on a reviewer the rest of this skill calls non-authoritative.

### Source Attribution

Every finding includes a source tag:

| Source | Meaning |
|--------|---------|
| `codex` | Found by Codex MCP only |
| `toolkit` | Found by secondary reviewer only |
| `both` | Found by both reviewers (deduplicated) |

Output format: `- [P0] file:line issue → fix [source: both]`

### Review Loop (under `--dual`)

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex MCP | Stateful → `mcp__codex__codex-reply(threadId)` continues context |
| Secondary | Re-dispatched every iteration (fresh context), for as long as `--dual` stays in effect for this review session |

Codex gate is authoritative for timing. Secondary runs non-blocking in background. Aggregation reconciled at pre-precommit checkpoint. Any code edit resets the review cycle — both reviewers must re-run.

Without `--dual` the loop is just Codex: `--continue <threadId>` on the same thread until the gate passes. There is no secondary to reconcile and no pre-precommit checkpoint to wait on.

That describes the **dispatch**, not necessarily the gate. On a state file where `review_mode` already reads `dual`, the aggregate plane still governs and no number of single-reviewer rounds discharges it — see `SKILL.md` § Step 4.5 for what Stop reports and which obligations have no command at all.
