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

The gate has **two axes**. The severity axis is decided by the **tier's blocking severity** (see `@rules/auto-loop.md` § Tiers: `fast` blocks on P0, `standard` — the default — on P0/P1, `thorough` on P0/P1/P2), never a fixed list; the scope axis by `@rules/scope-discipline.md`. "Critical" below = P0, or a security/data-integrity finding.

- **Blocked** ⇔ at least one finding that is "in-scope (incl. `uncertain`) ∧ at or above the tier's blocking severity" **or** "out-of-scope ∧ critical ∧ no valid `[USER_SKIPPED]`"
- **Ready**: no such finding — `gate_reason=NONE` is the only pairing lawful with Ready

The report's Gate section carries one line `gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>`. In-scope findings below the blocking line are **sub-threshold** (see `@rules/auto-loop.md` § Sub-Threshold Findings); out-of-scope non-critical findings are recorded as `[OUT_OF_SCOPE_DEFERRED]` and listed under the report's "Out-of-Scope Findings" section — neither blocks Ready.

## Scope Fields (fail-closed)

Every finding carries four scope fields (contract: `skills/codex-code-review/references/scope-contract.md` § Gate Derivation), judged against the **frozen** `SCOPE_BASELINE` from Step 1 — never recomputed:

```
origin=<in-diff|pre-existing|uncertain>
scope_reason=<diff-file|one-hop|branch-introduced|pre-existing-outside|uncertain>
scope=<in-scope|out-of-scope>   # derived, not free: out-of-scope ⇔ origin=pre-existing ∧ scope_reason=pre-existing-outside
evidence=<file:line call site, or a one-line blame/log -L citation; pre-existing-outside requires the complete negative case: not in the baseline, no one-hop call site, not branch-introduced>
```

One hop only: a direct caller or direct callee of a symbol the diff modified, with the call site cited. No transitive expansion. Non-code files: only baseline membership and branch introduction apply.

**Fail-closed reading** (the model applies this when consuming any report): a missing field, an unknown enum value, a contradictory combination (`origin=in-diff ∧ scope=out-of-scope`), or a `pre-existing-outside` whose evidence lacks the complete negative case ⇒ the finding is `uncertain` ⇒ **in-scope**. A reviewer that omits the fields degrades to today's behavior, never to something looser.

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

A `Blocked` result is routed by the **derived** sentinel × `gate_reason` pair (parent `SKILL.md` Step 4.5), never by the bare sentinel: only `Blocked × IN_SCOPE_BLOCKING` with the breaker untriggered enters this fix loop; `OUT_OF_SCOPE_CRITICAL` is human exit E1 (do **not** fix), `BOTH` resolves E1 first, and a triggered breaker is E2. For the pairing that does enter:

1. Remember the `threadId`
2. Fix every **in-scope** (incl. `uncertain`) finding at or above the tier's blocking severity (`${BLOCKING}`) — sub-threshold and out-of-scope ones are logged, not fixed
3. Re-review using `--continue <threadId>` — unless a rotation condition below holds, in which case open a new thread instead
4. Repeat until Ready — routing each round's result through Step 4.5 again

### Thread Rotation (central contract)

Every family's review loop references this section — code, doc, plan, test:coverage and
test:ac-trace consume it via their loop templates; `necessity` is **excluded in v1** (its first
dispatch is a constitutive debate pipeline, not a single template a fresh thread could rerun).
A reply thread degrades as it grows; rotation replaces the reply with a fresh dispatch when either
condition holds, checked before each re-review:

| # | Condition | Measurement | Tier |
|---|-----------|-------------|------|
| R-a | The same thread has already carried **3** reply re-reviews (the next dispatch opens a new thread) | **Behaviour-layer per-thread count**: the orchestrator counts replies per thread in conversation and resets to zero on a new thread; the `[THREAD_ROTATED]` line is the counting anchor. `review-state.js`'s `rounds` does **not** participate — it carries no threadId and accumulates across threads, so it can neither anchor nor bound a per-thread count | Default — threshold set by `auto-loop-project.md ## Review Thread Rotation` (2–6; unset = 3) |
| R-b | The context is judged too long to review well (early rotation) | Model judgment: batch bytes exceed the `resolve-review-profile.js` budget, or the report shows degradation signs (uncomparable findings, shrinking specificity). State the judgment when rotating on R-b | Default — the statement is the record |

**Rotation procedure**:

1. Fix the outstanding findings as usual — rotation never interrupts a fix in progress.
2. Open the new thread with the family's **first-dispatch template**: the full independent-research contract of `@rules/codex-invocation.md` applies again exactly as on round one. The frozen scope baseline (file list) rides in the prompt — metadata the invocation contract already allows; the baseline is **not** recomputed (`skills/codex-code-review/references/scope-contract.md` § Scope Baseline).
3. The old thread's unclosed findings and dispositions carry issue text and **never enter the new prompt** — feeding them anchors the reviewer. After the fresh report arrives, reconcile on the orchestration side: map old unclosed findings and currently valid dispositions onto the new report via § Finding Identity, then re-derive the gate per `skills/codex-code-review/references/scope-contract.md` § Gate Derivation. A mapping that fails is fail-closed: the unmatched finding returns to the gate.
4. Record `[THREAD_ROTATED] plane=<plane> old=<threadId> new=<threadId> reason=<rounds|context> | <ISO8601>` at column 0 (reporting convention — greppable, nothing parses it) and reset the per-thread count; subsequent replies use the new thread.

The rotation unit is the **batch's thread**: one-thread-per-batch is unchanged — a rotation swaps
which thread that is, never how many run at once. Stall streaks and round caps are **not** reset by
rotation; they measure the change, not the thread.

## Sub-Threshold Findings

When review returns Ready with findings **below** the tier's blocking severity, they do **not** re-open the loop. Log them and move on:

```
[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>
```

That tag and field order are a **reporting convention** — nothing parses or persists the line
(hook-lightweighting § 3.3: the nit-history store retired with the hook that owned it). The durable
record is the review report and the conversation, where the line is greppable; keep the fixed field
order for exactly that grep. Field 2 is the issue text, field 3 is the reason. Deferrals belong in
the reviewer's output under the `### Deferred Findings` section of the prompt templates, so the
report itself carries them — a depth review (`/codex-review-branch`) re-finds what is still true by
reviewing, not by reading a store.

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
  prompt: `The task state has changed since your last review (fixes applied, or a disposition recorded). Please re-review:

## ${LOCAL_CHECKS ? 'Local Check Results\n' + LOCAL_CHECKS + '\n\n##' : ''} New Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

## Scope Baseline (frozen — unchanged for this task, do NOT recompute)
${SCOPE_BASELINE}

## Active Dispositions
${DISPOSITIONS || 'None'}

Please verify:
1. Have the previously identified blocking issues been correctly fixed?
2. Did the fixes introduce new issues?
3. Keep the scope fields on every finding (origin / scope_reason / scope / evidence), judged against the frozen baseline above
4. The assurance boundary from the first dispatch still applies: a blocking guard finding needs a violated behavior/AC/invariant plus a counterexample on the real path; further hardening of demonstrated properties is Nit
5. Update Merge Gate status, including the gate_reason line`,

> These five items are the whole re-review ask — fixed across rounds. The dispatcher never appends
> round-specific attack directions here (`rules/codex-invocation.md` § Prohibited patterns, cumulative
> attack list).
});
```

> The re-review deliberately does **not** ask for a status roll-call of sub-threshold findings. They were already logged as `[NIT_DEFERRED]` and are not what the loop is converging on; asking re-surfaces them and buys another round.

`DISPOSITIONS` is the currently valid `[OUT_OF_SCOPE_DEFERRED]` / `[USER_SKIPPED]` lines for this task — carried by the model from the conversation and the prior reports (reporting conventions, nothing persists them). Validity is checked per `skills/codex-code-review/references/scope-contract.md` § Closed-Set Options before a line is included.

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
- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation> | origin=<...> scope_reason=<...> scope=<...> evidence=<...> [source: codex|toolkit|both]
```

> Note: `[source: ...]` is required under `--dual` aggregation (Codex healthy) and omitted in single-reviewer mode — the default Codex dispatch **and** the fallback-alone path alike: no carrier prompt requests the tag, so a fallback report carries none, and its provenance rides on `gate_source=fallback:<agent>` plus the `[REVIEWER_FALLBACK]` record instead. The four scope fields (§ Scope Fields) are never omitted: a source that lacked them normalizes to `uncertain` fail-closed.

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

These sentinels are **behaviour-layer prose contracts** — they ride in the reviewer's own output,
and on the Codex path nothing mechanical parses them (hook-lightweighting § 3.3). The one
mechanical reader is the fallback path: a fallback carrier's **raw report** must pass
`scripts/validate-family-sentinel.js <contract>` before its verdict may be adopted (§ Degradation
Matrix) — validation gates adoption, it still records nothing. What records the verdict is the
model's self-note (`SKILL.md` § Step 4.5): `note code_review pass` on Ready, `note code_review
fail` on Blocked. The note is an attestation the conversation can audit, never a gate.

## Dual Reviewer Aggregation (opt-in)

**This section's aggregation machinery — severity mapping, deduplication, source merge — applies only under `/codex-review-branch --dual`.** The default everywhere is a single reviewer (Codex); without the flag none of that merge logic runs — Codex's findings are the output as-is. **One subsection is expressly exempt from that scope: § Degradation Matrix** is the all-family central authority, consumed by every family's loop (single-reviewer included) with or without the flag — `rules/auto-loop.md` § Review Dispatch points here.

When `--dual` is passed **and Codex is healthy**, two reviewers run in parallel and **the merge happens in conversation** — there is no aggregate plane, no mode field and no state write. Which reviewers ran is a fact of the transcript, and the next invocation starts single again unless the flag is passed again. This section defines how to merge their results on that path; when Codex is out, nothing here merges — § Degradation Matrix and § Review Loop below define the fallback-alone rules that govern instead.

### Severity Mapping (toolkit → standard)

`pr-review-toolkit:code-reviewer` uses confidence scoring. Map to P0-Nit:

| toolkit Output | Default Mapping | Upgrade Condition |
|----------------|-----------------|-------------------|
| Critical (confidence 90-100) | P1 | Contains P0 keywords → P0 |
| Important (confidence 80-89) | P2 | — |
| < 80 confidence | Not reported | toolkit filters internally |

**P0 keywords**: crash, data loss, security vulnerability, injection, auth bypass, RCE, SSRF, XSS

`strict-reviewer` already uses P0/P1/P2/Nit format — no mapping needed.

### Deduplication Algorithm (field-level merge)

Normalize each reviewer's findings **fail-closed first** (§ Scope Fields), then merge per field — a keep-one-record dedupe would wash out the in-scope reading before normalization can see it:

| Step | Rule |
|------|------|
| Key | `canonical_file_path + canonical_issue_text` |
| Line tolerance | ±5 lines (ignore line number differences within range) |
| severity | Same key → keep highest severity (P0 > P1 > P2 > Nit) |
| scope | Any source `in-scope` or `uncertain` → aggregate `in-scope`; aggregate `out-of-scope` **only when every source independently proves it** with complete negative evidence |
| origin / scope_reason | Sources conflict → aggregate `uncertain` |
| security/data-integrity domain | Any source hits → the aggregate keeps the critical domain |
| evidence | Keep all sources' evidence — never discard it with the losing severity |
| Source merge | Same key from both reviewers → `source = "both"` |

`[USER_SKIPPED]` applies **after** the aggregate identity forms: a disposition recorded against an out-of-scope reading cannot exclude an aggregate that lands in-scope. The gate derivation (§ Merge Gate) runs on the conservative aggregate.

### Degradation Matrix

The central degradation authority for **every family**, not only `--dual`: a single-reviewer loop
consumes the Codex-❌ rows below directly (it simply has no Secondary column to aggregate).
Carrier order per family is decided by `scripts/lib/review-dispatch.js` (`FALLBACK_CARRIERS`):

| Contract | Priority 1 | Priority 2 | Priority 3 | Priority 4 |
|----------|-----------|-----------|-----------|------------|
| `code` | Codex MCP | `strict-reviewer` (repo-owned, frontmatter-pinned opus/high) | `pr-review-toolkit:code-reviewer` (plugin; pin best-effort at call site) | exhausted — no validated verdict |
| `doc` / `plan` / `test:coverage` / `test:ac-trace` | Codex MCP | `contract-neutral-reviewer` | `contract-neutral-reviewer` (one retry, fresh instance) | exhausted — no validated verdict |
| `necessity` | Codex MCP | — excluded from fallback in v1 (constitutive debate pipeline) | — | ⚠️ Need Human directly |

Each carrier runs the family's **first-dispatch template**, and its raw report must pass
`scripts/validate-family-sentinel.js <contract>` before adoption; a failing report moves to the
next carrier, sticky per change (`@rules/auto-loop.md` § Review Dispatch). Validation accepts only
terminals the dispatched producer is **authorized to emit**: for `plan` the orchestration-owned
forms — `⚠️ Plan Needs Human` (round-cap derivation, owning skill), `[PLAN_REVIEW_DEGRADED]`
(Priority-4 / secret-detected, dispatcher) and `[PLAN_REVIEW_SKIPPED]` (explicit user intent,
owning skill) — fail carrier validation even though they are plan-family terminals, and they are
rejected **anywhere in unquoted prose**, not only as verdict lines (the owning skill reads machine
tokens before verdict markers; fenced, blockquoted and inline-code occurrences are masked as data
first), so a defective carrier cannot fake exhaustion, a skip, or a round-cap hand-off and dodge
the P3 retry.

The secondary's status belongs to the first two rows only (`--dual`, Codex healthy). Once Codex is out, the carrier chain above is what advances or exhausts — a secondary succeeding never substitutes for a carrier, and a secondary failing never exhausts the chain:

| Scenario | Behavior | Gate Source | Output |
|----------|----------|------------|--------|
| Codex ✅ + Secondary ✅ (`--dual`) | Union aggregation | `codex+toolkit` | Full dual findings |
| Codex ✅ + Secondary ❌ (`--dual`) | Codex-only + degradation warning | `codex-only` | `⚠️ Secondary reviewer unavailable` |
| Codex ❌ → carrier report passes validation | **Fallback carries the gate** (contract-aware dispatch — `@rules/auto-loop.md` § Review Dispatch): the carrier runs the family's first-dispatch template and its raw report passed `scripts/validate-family-sentinel.js <contract>` | `fallback:<agent>` | `[REVIEWER_FALLBACK]` record + the fallback reviewer's full report |
| Codex ❌ → carrier report fails validation | That dispatch failed — move to the next carrier in the table above (sticky per change); the failing report is never adopted | — | `[REVIEWER_FALLBACK]` record; no verdict from that carrier |
| Codex ❌ + every fallback carrier invalid/exhausted (independent of secondary status) | Priority 4: **no validated verdict exists** — the gate stays open; surface behaviour-layer `⚠️ Need Human`, emit no gate sentinel | `none` | `[REVIEWER_FALLBACK]` record(s) for the failed dispatches; no gate sentinel |

**Codex failing never hands the gate to an unvalidated reviewer.** What changed (review-loop-resilience, 2026-08-23) is who may carry the gate when Codex is out: a fallback reviewer's report, validated fail-closed against the family's own terminal contract, is a **real gate verdict** with `gate_source=fallback:<agent>` — not advisory. Only the Codex-❌ rows were replaced; the `--dual` aggregation semantics above (severity mapping, field-level merge, conservative scope) are untouched, and `--dual` with Codex healthy still aggregates exactly as before. With every carrier exhausted (Priority 4) no report survived validation — carriers may have run and failed the family contract — so nothing is adopted and nothing is noted: a missing or invalid report never becomes a forged verdict.

### Source Attribution

Every finding in a **dual aggregate** (Codex healthy) includes a source tag:

| Source | Meaning |
|--------|---------|
| `codex` | Found by Codex MCP only |
| `toolkit` | Found by secondary reviewer only |
| `both` | Found by both reviewers (deduplicated) |
| *(fallback — record-level, not a finding tag)* | When a fallback carrier holds the gate (with or without `--dual`) there is no aggregate and the report stays in single-reviewer format with **no** per-finding tags — no carrier prompt requests one. Provenance is `gate_source=fallback:<agent>` plus the `[REVIEWER_FALLBACK]` record |

Output format: `- [P0] file:line issue → fix | origin=<...> scope_reason=<...> scope=<...> evidence=<...> [source: both]`

### Review Loop (under `--dual`)

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex MCP | Stateful → `mcp__codex__codex-reply(threadId)` continues context |
| Secondary | Re-dispatched every iteration (fresh context), for as long as `--dual` stays in effect for this review session |

On the **Codex-healthy path** the Codex gate is authoritative for timing: the secondary runs
non-blocking in background and aggregation is reconciled at the pre-precommit checkpoint. When
Codex is out (the Codex-❌ rows in § Degradation Matrix), the validated fallback report **is** the
gate — in single-reviewer format, provenance on `gate_source=fallback:<agent>` (§ Source
Attribution) — and there is no aggregation to wait on: a secondary already running is not awaited
and never merges into the fallback's gate derivation; whenever its report arrives it falls under
the parent skill's Codex-down secondary policy (Step 3.5 Codex-failure path) — blocking findings
escalate conservatively, but its `Ready` notes nothing and never substitutes for a validated
fallback verdict or closes a Priority-4 exhaustion — never silently merged or dropped. Any code
edit resets the review cycle — every reviewer carrying the gate must re-run.

Without `--dual` the loop has three executable paths, resolved in a fixed order. **R-b is judged
first, behaviour-layer** — it is a context-quality judgment (§ Thread Rotation) that
`scripts/lib/review-dispatch.js` cannot represent: the dispatcher's state has no context-overrun
field and its `rotate` branch tests only `threadRounds >= threshold` (R-a). Only when R-b does not
hold does the dispatcher decide among the rest: **continue** — Codex healthy and under the R-a
threshold → `--continue <threadId>` on the same thread (this is the sole path where same-thread
re-review is lawful: neither rotation condition holds); **rotate** — R-a holds → fresh first
dispatch on a new thread (the same fresh-dispatch contract an R-b rotation enters by the model's
own call); **fallback** — the change is sticky on a fallback carrier → stateless re-dispatch of
the family's first-dispatch template each round (no thread exists, so rotation does not apply).
In every path there is no secondary to reconcile and no pre-precommit checkpoint to wait on.
