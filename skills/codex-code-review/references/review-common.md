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

Every finding carries four scope fields (contract: `@rules/scope-discipline.md` § Gate Derivation), judged against the **frozen** `SCOPE_BASELINE` from Step 1 — never recomputed:

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
3. Re-review using `--continue <threadId>`
4. Repeat until Ready — routing each round's result through Step 4.5 again

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
4. Update Merge Gate status, including the gate_reason line`,
});
```

> The re-review deliberately does **not** ask for a status roll-call of sub-threshold findings. They were already logged as `[NIT_DEFERRED]` and are not what the loop is converging on; asking re-surfaces them and buys another round.

`DISPOSITIONS` is the currently valid `[OUT_OF_SCOPE_DEFERRED]` / `[USER_SKIPPED]` lines for this task — carried by the model from the conversation and the prior reports (reporting conventions, nothing persists them). Validity is checked per `@rules/scope-discipline.md` § Closed-Set Options before a line is included.

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

> Note: `[source: ...]` is required under `--dual` and omitted in single-reviewer mode, which is the default. The four scope fields (§ Scope Fields) are never omitted: a source that lacked them normalizes to `uncertain` fail-closed.

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
and nothing mechanical parses them (hook-lightweighting § 3.3). What records the verdict is the
model's self-note (`SKILL.md` § Step 4.5): `note code_review pass` on Ready, `note code_review
fail` on Blocked. The note is an attestation the conversation can audit, never a gate.

## Dual Reviewer Aggregation (opt-in)

**This whole section applies only under `/codex-review-branch --dual`.** The default everywhere is a single reviewer (Codex). Without the flag, none of the mapping, deduplication or degradation logic below runs — Codex's findings are the output as-is.

When `--dual` is passed, two reviewers run in parallel and **the merge happens in conversation** — there is no aggregate plane, no mode field and no state write. Which reviewers ran is a fact of the transcript, and the next invocation starts single again unless the flag is passed again. This section defines how to merge their results.

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

Output format: `- [P0] file:line issue → fix | origin=<...> scope_reason=<...> scope=<...> evidence=<...> [source: both]`

### Review Loop (under `--dual`)

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex MCP | Stateful → `mcp__codex__codex-reply(threadId)` continues context |
| Secondary | Re-dispatched every iteration (fresh context), for as long as `--dual` stays in effect for this review session |

Codex gate is authoritative for timing. Secondary runs non-blocking in background. Aggregation reconciled at pre-precommit checkpoint. Any code edit resets the review cycle — both reviewers must re-run.

Without `--dual` the loop is just Codex: `--continue <threadId>` on the same thread until the gate passes. There is no secondary to reconcile and no pre-precommit checkpoint to wait on.
