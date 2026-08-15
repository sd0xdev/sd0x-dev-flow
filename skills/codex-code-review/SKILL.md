---
name: codex-code-review
description: "Code review using Codex MCP. Use when: PR review, code audit, second opinion on changes. Not for: doc review (use doc-review), security audit (use security-review). Output: severity-grouped findings + merge gate."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Bash(node:*), Read, Grep, Glob, Task
---

# Codex Code Review

<!-- Security note: Bash(bash:*) is broader than ideal; cannot scope to specific
     script paths until Claude Code #9354 resolves ${CLAUDE_PLUGIN_ROOT} in
     command frontmatter. Only invoke bash for project scripts (scripts/*). -->

## Trigger

- Keywords: review, PR, code review, second opinion, audit, check

## When NOT to Use

- Document review (use `doc-review`)
- Security-specific review (use `security-review`)
- Test coverage review (use `test-review`)
- Just want to understand code (use `code-explore`)

## Variants

| Variant | Command | Scope | Pre-checks |
|---------|---------|-------|------------|
| Fast    | `/codex-review-fast` | Diff only | None |
| Full    | `/codex-review` | Diff + local checks | lint:fix + build |
| Branch  | `/codex-review-branch` | Full branch | None |

## Shared Workflow

```
Collect changes → [Pre-checks if Full] → Codex Review → Gate: derive sentinel × gate_reason (Step 4.5)
  → Ready × NONE → next gate | Blocked × IN_SCOPE_BLOCKING × untriggered → fix loop | other Blocked outcomes → E1/E2
```

Dual dispatch adds a second reviewer, and is opt-in:

```
--dual:  … → Codex + Task in parallel → Merge findings in conversation (field-level)
  → Gate: derive sentinel × gate_reason (Step 4.5)
  → Ready × NONE → next gate | Blocked × IN_SCOPE_BLOCKING × untriggered → fix loop | other Blocked outcomes → E1/E2
```

### Step 0: Reviewer Mode

**Default: Codex alone.** Do not launch a secondary reviewer. One reviewer, one verdict, noted in Step 4.5 — there is no mode field, no aggregate plane and no state machine behind this choice: which reviewers ran is a fact of the conversation, not of a store (hook-lightweighting § 3.3).

**`--dual` (Branch variant only):** adds a second reviewer **in parallel**, and the merge is yours to perform in conversation (Step 4). A second opinion for releases, security-sensitive changes and public API surfaces — nothing persists it, nothing blocks on it, and the next invocation starts single again unless the flag is passed again.

| Variant | `--dual` accepted? |
|---------|--------------------|
| Fast (`/codex-review-fast`) | No — single only |
| Full (`/codex-review`) | No — single only |
| Branch (`/codex-review-branch`) | Yes, off unless passed |

See `@rules/auto-loop.md § Review Dispatch` for why single is the default.

### Step 1: Collect Change Metadata

Collect **metadata only** — Codex reads the actual diffs and file contents itself via sandbox access.

| Variant | Collection Method |
|---------|-------------------|
| Fast    | `CHANGED_FILES`: `git diff --name-only HEAD` + `DIFF_STAT`: `git diff --stat HEAD` |
| Full    | Same as Fast |
| Branch  | Same + `CURRENT_BRANCH` + `BASE_BRANCH` + `COMMIT_COUNT` |

Codex independently reads full diffs and file contents via `git diff HEAD -- <file>` + `cat` (per research instructions).

**Scope baseline (frozen here).** Compute the baseline file set once, now, and freeze it for the whole review session (`@rules/scope-discipline.md` § Scope Baseline):

| Variant | Baseline set |
|---------|-------------|
| Fast / Full | `git diff --name-only HEAD` ∪ untracked (`git ls-files --others --exclude-standard`) |
| Branch (incl. `--dual`) | `git diff --name-only $(git merge-base ${BASE_BRANCH} HEAD)` ∪ the same uncommitted + untracked set |

`${BASE_BRANCH}` resolution (Branch variant): explicit argument first (e.g. `/codex-review-branch origin/develop`); else `git symbolic-ref --short refs/remotes/origin/HEAD`; else `origin/main` — verify each candidate with `git rev-parse --verify` before use. All candidates failing → abort as a **parameter error** and ask for an explicit base; never continue on an empty baseline (an empty baseline would misread every unmodified file as out-of-scope), and the abort is not a human exit. Record the resolved base and the frozen file list in the review report metadata, and inject the list into every reviewer prompt as `SCOPE_BASELINE`.

The frozen baseline is task-scoped and immutable: the initial reviewer, the inline secondary, `--continue`, and every same-task re-dispatch reuse the same list — no path recomputes it. The only growth is the user-named monotonic union of `@rules/scope-discipline.md` § Scope Baseline; ordinary fix edits during a round never write back into it.

### Step 1.1: Resolve the tier (required before dispatch)

The gate is tier-derived, and the **reviewer** has to be told which severities block — otherwise it emits `✅ Ready` / `⛔ Blocked` against its own assumption, and that is the verdict you note in Step 4.5. Resolve the tier first, then bind `TIER` and `BLOCKING` into the prompt:

| Tier | `BLOCKING` | Source |
|------|-----------|--------|
| `fast` | `P0` | `auto-loop-project.md ## Tier` |
| `standard` (default) | `P0/P1` | unset, unrecognized, or explicit |
| `thorough` | `P0/P1/P2` | explicit, **or** the Branch variant, **or** a security / data-integrity change |

The Branch variant is `thorough` by definition, so `BLOCKING = P0/P1/P2` there regardless of project config — a P2 blocks a branch review. Escalation for a security or data-integrity change applies to every variant, and you say that you escalated.

### Step 1.5: Feature Context & AC Detection (Spec-Driven Review)

Execute: `bash scripts/resolve-feature.sh` → parse JSON output.

| Field | Use |
|-------|-----|
| `has_requests` | Gate: only proceed if true |
| `docs_path` | Glob for request docs |
| `confidence` | Require >= medium |

If `has_requests=true` AND `confidence` in (high, medium):
1. Glob `${docs_path}/requests/*.md`, sort descending, take latest
2. Read latest request doc
3. Extract `## Acceptance Criteria` section (parse `- [ ]` / `- [x]` items)
4. Filter out quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/pr-review`
5. Cap: max 20 ACs (truncate with "... and N more" note)
6. Build `SPEC_CHECKLIST` variable, set `REQUEST_DOC_PATH`

Graceful degradation: resolve-feature fails / no requests / no AC section / parse error → `SPEC_CHECKLIST = null` (skip silently).

### Step 2: Pre-checks (Full variant only)

```bash
{LINT_FIX_COMMAND}
{BUILD_COMMAND}
```

These placeholders are resolved from the host project's `CLAUDE.md` or `package.json` scripts. Record results as `LOCAL_CHECKS`.

### Step 3: Dispatch

**Case A: First review (no `--continue`)**

Dispatch Codex. Launch the secondary reviewer **only** when `--dual` was passed:

1. **Codex MCP (primary)**: Use `mcp__codex__codex` with variant-specific prompt:

   | Variant | Prompt Template |
   |---------|-----------------|
   | Fast    | `references/codex-prompt-fast.md` |
   | Full    | `references/codex-prompt-full.md` |
   | Branch  | `references/codex-prompt-branch.md` |

   Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

   **Save the returned `threadId`.**

2. **Secondary reviewer — `--dual` only, skip entirely otherwise**: Use `Task` tool with reviewer selection cascade:

   | Priority | Reviewer | subagent_type | Condition |
   |----------|----------|---------------|-----------|
   | 1 | `pr-review-toolkit:code-reviewer` | `pr-review-toolkit:code-reviewer` | Default choice |
   | 2 | `strict-reviewer` | `strict-reviewer` | Priority 1 fails/times out |
   | 3 | Codex-only (degraded) | — | Both unavailable |

   **Selection**: Try priority 1 first. If Task fails or times out (30s), try priority 2. If both unavailable, fall back to Codex-only (degraded mode — proceed with Codex results only, apply degradation matrix from `references/review-common.md`).

   **Task prompt** (provide changed file list + diff stats, request P0/P1/P2/Nit findings in standard output format):

   ```
   Review the code changes for correctness, security, performance, and maintainability issues.

   ## Changed Files
   <git diff --name-only output>

   ## Diff Stats
   <git diff --stat output>

   ## Scope Baseline (frozen)
   <SCOPE_BASELINE — the frozen file list from Step 1; do NOT recompute it>

   Read the actual diffs and file contents yourself to perform the review.

   Before reporting findings, independently verify each one:
   1. Evidence check: what specific code proves it's real? (file:line)
   2. Context check: did you read enough surrounding code?
   3. False positive check: could it be intentional design?
   4. Severity check: could it be more severe than initially assessed?
   5. Gap check: what related issues might you have overlooked?
   Only report findings that survive all 5 checks.

   Classify every finding against the frozen baseline (contract:
   references/review-common.md § Scope Fields): origin=<in-diff|pre-existing|uncertain>,
   scope_reason=<diff-file|one-hop|branch-introduced|pre-existing-outside|uncertain>,
   scope=<in-scope|out-of-scope> (derived: out-of-scope ⇔ pre-existing ∧
   pre-existing-outside), evidence=<file:line call site, or a blame/log -L citation;
   pre-existing-outside requires the complete negative case>. One hop only — no
   transitive expansion; no citable evidence → uncertain.

   Output findings in this format:
   - [P0/P1/P2/Nit] file:line issue description → fix recommendation | origin=... scope_reason=... scope=... evidence=...

   Group by severity. Include a final gate: ✅ Ready or ⛔ Blocked, with one line
   gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH> — Blocked ⇔ an
   in-scope (incl. uncertain) finding at or above ${BLOCKING}, or an out-of-scope
   P0/security/data-integrity finding with no valid [USER_SKIPPED]; NONE pairs only
   with Ready.
   ```

**Case B: Loop review (has `--continue`)**

- **Codex**: Use `mcp__codex__codex-reply` with re-review template from `references/review-common.md`
- **Secondary** (`--dual` only): re-dispatch in parallel, fresh context. Cycle resets on any code edit.

### Step 3.5: Await Results

**Single reviewer (default dispatch):** await Codex. Its verdict is the gate *for this dispatch*. Go to Step 4.

If Codex itself is unavailable there is nothing to degrade to — the one reviewer *is* the gate. Emit `⛔ Blocked` + `⚠️ Need Human` and stop; do not silently substitute a subagent, because that would swap the reviewer the gate was defined against without the user having asked for it.

**`--dual`:** Codex is the **blocking** reviewer — await its result for the initial gate. Secondary runs in background (`run_in_background: true`) and is **non-blocking**:

| Secondary Status | Action |
|-----------------|--------|
| Completed before Codex | Include in aggregation (Step 4) |
| Completed after Codex, before precommit | Reconcile at pre-precommit checkpoint |
| Still running at precommit | Proceed with Codex gate (authoritative); a late result is normalized fail-closed, merged conservatively, and its derived pair routed through the Step 4.5 matrix — a late in-scope blocking finding re-opens the fix loop, a late out-of-scope critical finding is E1, never a silent re-open |
| Failed/timed out | Apply degradation matrix per `references/review-common.md § Dual Reviewer Aggregation` |

### Step 4: Consolidate Output

**Single reviewer (default dispatch):** Codex's findings are the output as-is. Sort P0 → P1 → P2 → Nit. Gate (dual-axis): first normalize every finding's scope fields fail-closed (`references/review-common.md § Scope Fields`), then BLOCKED ⇔ an in-scope (incl. `uncertain`) finding at or above the tier's blocking severity, **or** an out-of-scope critical finding (P0 / security / data-integrity) with no valid `[USER_SKIPPED]`; else READY with `gate_reason=NONE` (see `references/review-common.md § Merge Gate`; `standard` is the default and blocks on P0/P1). The `[source: ...]` tag is omitted — there is only one source.

**`--dual`:**

1. **Normalize** both sets of findings to unified format: `[severity] file:line description → fix | origin=<...> scope_reason=<...> scope=<...> evidence=<...>` — the four scope fields survive normalization; a source that omitted them gets `uncertain` (fail-closed), never a blank
   - Codex findings: already in standard format
   - toolkit findings: apply Severity Mapping (see `references/review-common.md § Severity Mapping`)
   - strict-reviewer findings: already use P0/P1/P2/Nit

2. **Deduplicate & merge by field** using key = `file + canonical_issue_text` (ignore line ±5 difference). Normalize each reviewer's findings fail-closed **before** merging, then merge conservatively per field (`references/review-common.md § Deduplication Algorithm`):
   - severity: highest wins (P0 > P1 > P2 > Nit)
   - scope: any source `in-scope` or `uncertain` → `in-scope`; `out-of-scope` only when **every** source independently proves it
   - origin / scope_reason: sources conflict → `uncertain`
   - security/data-integrity domain: any source hits → the aggregate keeps the critical domain
   - evidence: keep all — never discard with the losing severity

   `[USER_SKIPPED]` applies only **after** the aggregate identity forms: an aggregate that lands in-scope is not excluded by a disposition recorded against the out-of-scope reading.

3. **Tag source**: `source = codex | toolkit | both`

4. **Sort**: P0 → P1 → P2 → Nit

5. **Gate decision** (dual-axis, on the conservative aggregate): an in-scope (incl. `uncertain`) finding at or above the tier's blocking severity, or an out-of-scope critical finding with no valid `[USER_SKIPPED]` → BLOCKED; else → READY with `gate_reason=NONE`

Output format keeps the merged scope fields and adds the source tag:

```
- [P0] file:line issue → fix | origin=in-diff scope_reason=diff-file scope=in-scope evidence=<...> [source: both]
- [P1] file:line issue → fix | origin=uncertain scope_reason=uncertain scope=in-scope evidence=<...> [source: codex]
```

### Step 4.5: Output the gate and note the verdict

Output the standard gate sentinel:
- `✅ Ready` — if READY (no blocking finding on either axis)
- `⛔ Blocked` — if BLOCKED

**Route on derived values, never declarations.** Before acting on the reviewer's sentinel, normalize all findings fail-closed (`references/review-common.md § Scope Fields`) and **derive** the expected sentinel × `gate_reason`; the reviewer's declared pair is an unverified claim. Four canonical recalculations: a declared `Ready × NONE` wrapping a real in-scope blocking finding routes as `Blocked × IN_SCOPE_BLOCKING` — a reviewer cannot wrap a real blocking finding in a lawful pairing; a declared `Ready × NONE` wrapping an out-of-scope critical finding with no valid `[USER_SKIPPED]` routes as `Blocked × OUT_OF_SCOPE_CRITICAL`; both classes present under a single declared reason derives `Blocked × BOTH`; a declared `Blocked` with no blocking finding on either axis routes as `Ready × NONE`. Findings too incomplete to derive → conservatively `Blocked × BOTH`. "Breaker triggered" is the model's own fix-phase state (`@rules/scope-discipline.md` § Circuit Breaker), not a reviewer field — check it before routing. The matrix indexes on the **derived** pair:

| Sentinel × `gate_reason` × breaker | Action |
|------------------------------------|--------|
| `✅ Ready` × `NONE` | The only lawful Ready pairing — note pass, proceed to the next gate |
| `⛔ Blocked` × `IN_SCOPE_BLOCKING` × not triggered | Fix loop (§ Review Loop below) |
| `⛔ Blocked` × `IN_SCOPE_BLOCKING` × triggered | **No fix loop**: human exit E2 (`@rules/scope-discipline.md` § Human Exits) |
| `⛔ Blocked` × `OUT_OF_SCOPE_CRITICAL` | `note code_review fail`; **do not fix** — human exit E1 (closed-set options) |
| `⛔ Blocked` × `BOTH` × not triggered | E1 first (the user's decision may change scope); afterwards the remaining in-scope blocking findings are fixed — the two classes never cancel |
| `⛔ Blocked` × `BOTH` × triggered | E1 and E2 merge into a **single** Need Human decision point: one notification carrying both the closed-set options and the re-scope decision |
| Contradictory declaration (`Ready` × a blocking value, `Blocked` × `NONE`), missing or unknown values | Same as every row: re-index this matrix by the derived pair; findings insufficient to derive → treat as `⛔ Blocked` × `BOTH` |

Out-of-scope findings that are not critical never block Ready: they are listed in the report's "Out-of-Scope Findings" section and recorded as `[OUT_OF_SCOPE_DEFERRED]` lines (`@rules/scope-discipline.md` § Records).

Then **self-note the verdict** — this is the declared-provenance record the reminder hooks read
(hook-lightweighting § 3.2), and it is behaviour-layer: an attestation the conversation can audit,
not a gate anything blocks on. Installed copy first:

```bash
CHECKER=".claude/scripts/review-state.js"; [ -f "$CHECKER" ] || CHECKER="scripts/review-state.js"
node "$CHECKER" note code_review pass   # on ✅ Ready
node "$CHECKER" note code_review fail   # on ⛔ Blocked — increments the rounds count
```

Note after **every** round's verdict, not only the terminal one: a `fail` note is what keeps the
`rounds` fact honest across the fix → re-review loop, and a `pass` note resets it. The note binds
to the current tree digest, so any later edit re-opens the plane by construction — there is no
verdict to clear. A failed or unavailable note never fails the review: the checks are the job, the
note is a courtesy for the reminders, and the missing-note cost is one redundant reminder line.

## Shared Definitions

See `references/review-common.md` for:
- Severity levels (P0/P1/P2/Nit)
- Review dimensions
- Merge gate definitions
- Re-review prompt template
- Gate sentinels (behaviour-layer prose contracts)
- Dual Reviewer Aggregation (severity mapping, deduplication, degradation matrix, source attribution)

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

A `⛔ Blocked` enters this loop only through the Step 4.5 routing matrix — `Blocked × IN_SCOPE_BLOCKING` with the breaker untriggered. `OUT_OF_SCOPE_CRITICAL`, `BOTH`, and a triggered breaker route to their human exits instead; sending a critical out-of-scope finding through this loop is exactly the sweep `@rules/scope-discipline.md` closes.

Blocked → fix the in-scope blocking findings → `/codex-review-fast --continue <threadId>` (the re-review prompt carries the frozen `SCOPE_BASELINE` and the active disposition list — `references/review-common.md § Re-review Prompt Template`) → repeat until Ready.
Ready with only sub-threshold findings → **log and proceed to `/precommit`**. No extra fix pass, no extra re-review — see `@rules/auto-loop.md § Sub-Threshold Findings` for what counts as sub-threshold at each tier.

Round cap comes from the tier — the table in `@rules/auto-loop.md § Tiers` owns the numbers, and restating them here is what let them drift last time. The cap is the backstop, not the stall detector: a stall (`@rules/auto-loop.md § Stall Detection` — three consecutive rounds that close nothing, counted by the model from the review reports) normally shows first. Same issue recurring at the cap → report blocker, request intervention.

This loop converges on the **review result**. Reaching Ready ends it — a stale reminder line from a hook is not a finding, and no further round addresses it; the Step 4.5 note is what retires the reminder.

### Loop Behavior

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex MCP | Stateful → `mcp__codex__codex-reply(threadId)` continues context |
| Secondary (`--dual` only) | Re-dispatched every iteration, fresh context |

Any code edit resets the review cycle — the reviewer must re-run.

### Pre-precommit Checkpoint (`--dual` only)

Before triggering `/precommit`, reconcile any pending secondary result:

A late secondary result goes through the same normalization and field-level merge as Step 4 (fail-closed scope fields, conservative aggregate), and its outcome routes through the Step 4.5 matrix — a late out-of-scope critical finding is E1, not a silent re-open of the fix loop:

| Condition | Action |
|-----------|--------|
| Task completed + the merged aggregate has a blocking finding on either axis (in-scope ≥ `${BLOCKING}`, or out-of-scope critical with no valid `[USER_SKIPPED]`) | Re-emit BLOCKED → route via the Step 4.5 matrix (fix loop only for `IN_SCOPE_BLOCKING`, breaker untriggered) |
| Task completed + no blocking finding on either axis | Union aggregate → proceed to precommit |
| Task still running | Proceed with Codex gate (authoritative); if the late result produces a blocking finding on either axis after merge, route it via the Step 4.5 matrix. Branch review is always `thorough`, so a late in-scope P2 counts |

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2/Nit)
- [ ] Gate is clear (✅ Ready / ⛔ Blocked)
- [ ] Issues include: file:line, description, fix suggestion
- [ ] Codex performed independent project research
- [ ] Branch variant: dimension rating table included

## References

- Shared definitions: `references/review-common.md`
- Fast prompt: `references/codex-prompt-fast.md`
- Full prompt: `references/codex-prompt-full.md`
- Branch prompt: `references/codex-prompt-branch.md`
- Research instructions: `references/codex-research-instructions.md`

## Examples

```
Input: /codex-review-fast
Action: git diff → Codex → findings + Gate

Input: /codex-review --focus "auth"
Action: lint:fix → build → git diff → Codex (focus: auth) → findings + Gate

Input: /codex-review-branch origin/develop
Action: branch diff + history → Codex → Rating table + Findings + Gate

Input: /codex-review-branch origin/develop --dual
Action: branch diff + history → Codex + Task parallel → merge findings → Rating table + Findings + Gate → note verdict

Input: /codex-review-fast (Codex unavailable)
Action: ⛔ Blocked + ⚠️ Need Human — the single reviewer is the whole gate, so there is nothing to degrade to
```
