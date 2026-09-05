---
name: codex-code-review
description: "Code review using Codex exec. Use when: PR review, code audit, second opinion on changes. Not for: doc review (use doc-review), security audit (use security-review). Output: severity-grouped findings + merge gate."
allowed-tools: Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Bash(node:*), Read, Grep, Glob, Task, Write
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
Resolve adapter → [Pre-checks if Full] → Collect changes & freeze baseline → Codex Review → Gate: derive sentinel × gate_reason (Step 4.5)
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

**`--dual` (Branch variant only):** adds a second reviewer **in parallel**; on the Codex-healthy path the merge is yours to perform in conversation (Step 4). A second opinion for releases, security-sensitive changes and public API surfaces — nothing persists it, nothing blocks on it, and the next invocation starts single again unless the flag is passed again. When Codex is out, there is no merge: the validated fallback report carries the gate alone (Step 3.5 Codex-failure path).

| Variant | `--dual` accepted? |
|---------|--------------------|
| Fast (`/codex-review-fast`) | No — single only |
| Full (`/codex-review`) | No — single only |
| Branch (`/codex-review-branch`) | Yes, off unless passed |

See `@rules/auto-loop.md § Review Dispatch` for why single is the default.

### Step 0.5: Resolve the adapter locator (before any snapshot)

Resolve the adapter through `references/codex-transport.md` § Locator **now**, and let any
auto-install that section prescribes happen here — before Step 1 freezes anything.

The ordering is the transport contract's, not a preference: in a consuming repository whose first
review predates the installed adapter, § Locator's second step *writes* it into the tree. Resolve it
at dispatch time instead and that write lands after Step 1 froze the changed-file set and the scope
baseline, so the new untracked file is a tree change no baseline contains and no reviewer prompt
lists — a review whose own snapshot went stale while it ran.

A `setup-required` locator outcome (no adapter at any step) stops here and is surfaced to the
operator. It is **not** `codex_fail`: nothing was dispatched, so no fallback reviewer runs and no
verdict is noted.

### Step 0.7: Pre-checks (Full variant only)

```bash
{LINT_FIX_COMMAND}
{BUILD_COMMAND}
```

These placeholders are resolved from the host project's `CLAUDE.md` or `package.json` scripts. Record
results as `LOCAL_CHECKS`.

**It is numbered before Step 1 for the same reason Step 0.5 is.** `{LINT_FIX_COMMAND}` writes — a
project-wide lint fix edits files, and a build can regenerate them. Run it after Step 1 and those
edits land outside the frozen changed-file set and scope baseline: delivered changes every reviewer
dispatch then misses or misclassifies as out-of-scope. Settle the tree first — adapter, then
pre-checks — and freeze once, over the tree that will actually be reviewed. It was numbered Step 2
until 2026-09-04, which put it after the freeze.

If anything writes to the tree *after* Step 1 has run, Step 1 is redone in full. The baseline is
frozen once per review session, and a baseline computed over a tree that has since changed is not
the one this review is judging.

### Step 1: Collect Change Metadata

Collect **metadata only** — Codex reads the actual diffs and file contents itself via sandbox access.

`TASK_DESCRIPTION` is the original task in one or two sentences, captured here and **frozen for
the whole review session** — every first, fallback, and rotated dispatch carries the same value,
and it is never rewritten from review findings (`rules/codex-invocation.md`, the three-part
dispatch shape).

`CHANGED_FILES` is the **frozen baseline set itself**, not a narrower query — the two are computed
from the same expression below, because a manifest that is a subset of the baseline hands the
reviewer a shorter change than the one it is told to judge. The change that added this paragraph
proves it: the transport adapter, its reference and their tests were all untracked, so
`git diff --name-only HEAD` alone omitted every one of them.

| Variant | Collection Method |
|---------|-------------------|
| Fast    | `CHANGED_FILES`: `git diff --name-only HEAD` ∪ `git ls-files --others --exclude-standard` + `DIFF_STAT`: `git diff --stat HEAD`, plus a line count for each untracked file (`wc -l`), which no diff stat covers |
| Full    | Same as Fast |
| Branch  | Resolve `MERGE_BASE` **once**, per § Resolving the Branch base below, then use only that object id: `CHANGED_FILES`: `git diff --name-only $MERGE_BASE` ∪ the same uncommitted and untracked sets + `DIFF_STAT`: `git diff --stat $MERGE_BASE` + `CURRENT_BRANCH` + `BASE_BRANCH` + `COMMIT_COUNT` |

Codex reads the diffs and file contents itself, and **which command shows them depends on the
variant and on whether the file is tracked** — one blanket `git diff HEAD -- <file>` is wrong for two
of the three cases:

| What | How Codex reads it |
|------|--------------------|
| Fast / Full, tracked file | `git diff HEAD -- <file>` |
| Branch, tracked file | `git diff $MERGE_BASE -- <file>` for the committed part, plus `git diff HEAD -- <file>` for what is uncommitted on top — the id resolved once below, never a fresh `git merge-base` here |
| Untracked file, any variant | `cat <file>` — git has no diff for a file it does not track, so the whole file is the change |

The variant's prompt template carries the same instruction; this row exists so the metadata step and
the prompt cannot drift apart.

**Scope baseline (frozen here).** Compute the baseline file set once, now, and freeze it for the whole review session (`skills/codex-code-review/references/scope-contract.md` § Scope Baseline):

| Variant | Baseline set |
|---------|-------------|
| Fast / Full | `git diff --name-only HEAD` ∪ untracked (`git ls-files --others --exclude-standard`) |
| Branch (incl. `--dual`) | `git diff --name-only $MERGE_BASE` ∪ the same uncommitted + untracked set — the same single id, not a second computation |

#### Resolving the Branch base

**`${BASE_BRANCH}` is resolved to an object id here, once, and only that id travels onward.** A ref
name is not safe to render into shell source: git accepts `;`, backticks and parentheses in a valid
ref, `rev-parse --verify` accepts such a ref, and placeholders are bound *textually* before the
command runs — so double quotes around a rendered ref do not help, since the metacharacters are
already in the source when the shell parses it. Only never rendering the ref does.

1. Run the resolution with the ref as a **shell-single-quoted literal**, which suppresses expansion:
   `git merge-base -- 'the/resolved/ref' HEAD` (an embedded apostrophe is written `'\''`).
2. **Verify the result is 40 hex characters** before using it. Anything else is a parameter error:
   abort and ask for an explicit base.
3. Bind that id as `MERGE_BASE` and use it everywhere above and in every prompt. No later step
   recomputes it — one baseline, one id, which is also what the frozen-baseline contract requires.

`${BASE_BRANCH}` itself still travels to the reviewer as **metadata** (a name in the prompt's Task
and Scope sections); what it must never do is appear inside a command the reviewer will run.

`${BASE_BRANCH}` resolution (Branch variant): explicit argument first (e.g. `/codex-review-branch origin/develop`); else `git symbolic-ref --short refs/remotes/origin/HEAD`; else `origin/main` — verify each candidate with `git rev-parse --verify` before use. All candidates failing → abort as a **parameter error** and ask for an explicit base; never continue on an empty baseline (an empty baseline would misread every unmodified file as out-of-scope), and the abort is not a human exit. Record the resolved base and the frozen file list in the review report metadata, and inject the list into every reviewer prompt as `SCOPE_BASELINE`.

The frozen baseline is task-scoped and immutable: the initial reviewer, the inline secondary, `--continue`, and every same-task re-dispatch reuse the same list — no path recomputes it. The only growth is the user-named monotonic union of `skills/codex-code-review/references/scope-contract.md` § Scope Baseline; ordinary fix edits during a round never write back into it.

### Step 1.1: Resolve the tier (required before dispatch)

The gate is tier-derived, and the **reviewer** has to be told which severities block — otherwise it emits `✅ Ready` / `⛔ Blocked` against its own assumption, and that is the verdict you note in Step 4.5. Resolve the tier first, then bind `TIER` and `BLOCKING` into the prompt:

| Tier | `BLOCKING` | Source |
|------|-----------|--------|
| `fast` | `P0` | `@rules/auto-loop-project.md ## Tier` |
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



### Step 3: Dispatch

**Bind every placeholder before writing `prompt.md` — both cases below.** The templates are body-only
now, so no expression in them is evaluated by anything: a `${X || 'default'}` is copied into the
prompt literally and shipped to Codex as text (it was, until a doc review caught it). Two have no
natural empty form and the dispatcher supplies it — `${LOCAL_CHECKS}` becomes `Skipped` when no local
checks ran, and `${DISPOSITIONS}` becomes `None` when there are none. This sits **above** the Case A /
Case B split deliberately: `${DISPOSITIONS}` is consumed by Case B, so a `--continue` dispatcher that
skipped Case A would otherwise never have read its binding rule.

**Case A: First review (no `--continue`)**

Dispatch Codex. Launch the secondary reviewer **only** when `--dual` was passed:

1. **Codex (primary)**: dispatch per `references/codex-transport.md` § Start with the variant-specific prompt:

   | Variant | Prompt Template |
   |---------|-----------------|
   | Fast    | `references/codex-prompt-fast.md` |
   | Full    | `references/codex-prompt-full.md` |
   | Branch  | `references/codex-prompt-branch.md` |


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
   pre-existing-outside), change_relation=<affected|independent|uncertain> (does the
   primary diff change this defect's inputs, reachability, contract, error behaviour,
   state, or operational impact? adjacency is not effect — a cited one-hop call site
   proves the defect is nearby, not that this change reaches it),
   evidence=<file:line call site, or a blame/log -L citation;
   pre-existing-outside requires the complete negative case; change_relation=independent
   on an in-scope finding requires the primary hunk(s) as file:@@-a,b+c,d>. One hop only — no
   transitive expansion; no citable evidence → uncertain.

   Output findings in this format:
   - [P0/P1/P2/Nit] file:line issue description → fix recommendation | origin=... scope_reason=... scope=... change_relation=... evidence=...

   Group by severity. Include a final gate: ✅ Ready or ⛔ Blocked, with one line
   gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH> — Blocked ⇔ an
   in-scope (incl. uncertain) finding at or above ${BLOCKING}, or an out-of-scope
   P0/security/data-integrity finding (valid [USER_SKIPPED] records, if any, are
   applied orchestration-side after your report); NONE pairs only with Ready.
   ```

**Case B: Loop review (has `--continue`)**

- **Rotation check first**: before each reply, apply `references/review-common.md` § Review Loop — Thread Rotation (central contract): at the R-a threshold (3 replies on this thread; `@rules/auto-loop-project.md ## Review Thread Rotation` overrides, 2–6) or on R-b judged context overrun, do **not** reply — dispatch Case A's first-review template on a **new** thread (frozen baseline only; old findings and dispositions reconciled orchestration-side after the fresh report) and record `[THREAD_ROTATED]`.
- **Codex**: otherwise dispatch per `references/codex-transport.md` § Resume with the re-review template from `references/review-common.md`
- **Under fallback** (sticky carrier for this change): agents are stateless — every re-review is a fresh Step 3.5-style dispatch to the same carrier, so rotation is automatically satisfied; validate each report the same way before noting. **Reconcile it like a rotated report** (`references/review-common.md` § Thread Rotation step 3): an old unclosed finding the fresh report omits is closed if its fix is in the diff, and otherwise re-enters this round with its identity and severity and `change_relation=uncertain` — a fresh carrier's silence never retires an unfixed owed finding.
- **Secondary** (`--dual` only): re-dispatch in parallel, fresh context. Cycle resets on any code edit.

### Step 3.5: Await Results

**Single reviewer (default dispatch):** await Codex. Its verdict is the gate *for this dispatch*. Go to Step 4.

If the transport reports `codex_fail` — **adapter exit 1 only** (`references/codex-transport.md` § Completion state machine): quota, network, an unreachable CLI, a malformed stream. A pending or unknown completion keeps the gate **open** and dispatches nothing; exit 2 is a configuration error to fix, not a Codex failure; an `alloc`/`cleanup` failure is a lifecycle error surfaced to the operator. On `codex_fail` the gate does **not** stop: a contract-aware fallback carries it (`@rules/auto-loop.md` § Review Dispatch). Named steps, in order:

1. **Decide** — call `scripts/lib/review-dispatch.js` (`node -e "console.log(JSON.stringify(require('./scripts/lib/review-dispatch.js').decide({contract:'code',probe:'codex_fail',sticky:'none'})))"` shape) for the next action. Record `[REVIEWER_FALLBACK] plane=code_review from=codex to=<agent> reason=<quota|timeout|error> | <ISO8601>`; the selection is **sticky for this change** — re-reviews do not re-probe, the next change probes Codex afresh.
2. **Dispatch** the carrier via Task with this variant's own prompt template and the frozen `SCOPE_BASELINE` (the same template Codex would have received — the template is the contract):

   | Priority | Carrier | Depth guarantee |
   |----------|---------|-----------------|
   | 2 | `strict-reviewer` | Repo-owned agent; frontmatter pinned by `test/agents/frontmatter.test.js` |
   | 3 | `pr-review-toolkit:code-reviewer` | Plugin agent — the pin cannot reach it, so the call-site MUST explicitly request `model: opus`, `effort: high` (best-effort) |

3. **Validate fail-closed** — pipe the carrier's raw report to `node scripts/validate-family-sentinel.js code`. Exit 0 (exactly one of `✅ Ready` / `⛔ Blocked`, no foreign family terminal) → the report **is** the gate verdict with `gate_source=fallback:<agent>`; note it as usual. Exit 1 → this carrier's dispatch failed; move to the next priority. A terminal is never translated across contracts.
4. **Priority 4 — both carriers exhausted**: no validated verdict exists — carriers may have run, but no report survived the family contract. Emit **no** gate sentinel, surface behaviour-layer `⚠️ Need Human`, and note nothing.

**`--dual` (Codex-healthy path):** Codex is the **blocking** reviewer — await its result for the initial gate. Secondary runs in background (`run_in_background: true`) and is **non-blocking**:

| Secondary Status | Action |
|-----------------|--------|
| Completed before Codex | Include in aggregation (Step 4) |
| Completed after Codex, before precommit | Reconcile at pre-precommit checkpoint |
| Still running at precommit | Proceed with Codex gate (authoritative); a late result is normalized fail-closed, merged conservatively, and its derived pair routed through the Step 4.5 matrix — a late in-scope **owed** finding re-opens the fix loop (`fix_obligation=mandatory` at or above the blocking severity, or `admitted` at any severity), a late in-scope `deferred` candidate is recorded (`[OPPORTUNISTIC_DEFERRED]` at blocking severity, `[NIT_DEFERRED]` below it) and re-opens nothing, a late out-of-scope critical finding is E1, never a silent re-open |
| Failed/timed out | Apply degradation matrix per `references/review-common.md § Dual Reviewer Aggregation` |

**`--dual` (Codex-failure path):** when the probe fails under `--dual`, the same fallback chain above carries the gate **alone** — the validated fallback report is the gate verdict, no aggregation is waited on or built, and no Codex thread exists to continue. The healthy-path table above does **not** apply, and the secondary's report — whether it completed before Codex failed, before precommit, or after — is never merged into the fallback's gate derivation **and never carries the gate itself**. Handle it under the **Codex-down secondary policy**: normalize it fail-closed on arrival, derive each finding's `fix_obligation` exactly as the gate carrier's report gets it (`references/scope-contract.md § Opportunistic Envelope`), then act on its **owed** blocking findings only, conservatively — a secondary in-scope `mandatory` blocking finding, or an `admitted` one at any severity, re-opens the fix loop; a secondary finding deriving `deferred` is recorded (`[OPPORTUNISTIC_DEFERRED]` at blocking severity, `[NIT_DEFERRED]` below it) and re-opens nothing; a secondary out-of-scope critical finding is E1 — while a secondary `✅ Ready` is advisory and notes **nothing**: it never substitutes for a validated fallback verdict, and Step 4.5's `✅ Ready × NONE` row is indexed only by the gate carrier's own report, never by a secondary's. In particular, at Priority 4 (every fallback carrier exhausted — no validated verdict exists) the gate stays open with behaviour-layer `⚠️ Need Human` **whatever the secondary reported**. Nothing is silently merged or dropped. The pre-precommit checkpoint below is likewise Codex-healthy-only — on this path there is no aggregate to reconcile and no Codex gate to proceed with.

### Step 4: Consolidate Output

**Single reviewer (default dispatch):** Codex's findings are the output as-is. Sort P0 → P1 → P2 → Nit. Gate (dual-axis): first normalize every finding's scope fields fail-closed (`references/review-common.md § Scope Fields`), derive each finding's `fix_obligation` (`references/scope-contract.md § Opportunistic Envelope`), then BLOCKED ⇔ an in-scope (incl. `uncertain`) `mandatory` finding at or above the tier's blocking severity, **or** an in-scope `admitted` finding at any severity, **or** an out-of-scope critical finding (P0 / security / data-integrity) with no valid `[USER_SKIPPED]`; else READY with `gate_reason=NONE` (see `references/review-common.md § Merge Gate`; `standard` is the default and blocks on P0/P1). The `[source: ...]` tag is omitted — there is only one source.

**Fallback carrier (Codex out — with or without `--dual`):** the validated fallback report proceeds unchanged through the single-reviewer gate derivation above and on to Step 4.5 — single-reviewer mode, so per-finding `[source: ...]` tags are omitted exactly as on the Codex path; provenance rides on `gate_source=fallback:<agent>` and the `[REVIEWER_FALLBACK]` record, not on finding tags. It is never merged with a secondary; a secondary report that exists is handled by the Codex-down secondary policy (Step 3.5 Codex-failure path) — **owed** blocking findings escalate (mandatory at or above the blocking severity, or admitted at any severity), a `deferred` candidate is recorded and escalates nothing, and its `Ready` never notes.

**`--dual` (Codex-healthy path only):**

1. **Normalize** both sets of findings to unified format: `[severity] file:line description → fix | origin=<...> scope_reason=<...> scope=<...> change_relation=<...> evidence=<...>` — the five scope fields survive normalization; a source that omitted them gets `uncertain` (fail-closed), never a blank
   - Codex findings: already in standard format
   - toolkit findings: apply Severity Mapping (see `references/review-common.md § Severity Mapping`)
   - strict-reviewer findings: already use P0/P1/P2/Nit

2. **Deduplicate & merge by field** using key = `file + canonical_issue_text` (ignore line ±5 difference). Normalize each reviewer's findings fail-closed **before** merging, then merge conservatively per field (`references/review-common.md § Deduplication Algorithm`):
   - severity: highest wins (P0 > P1 > P2 > Nit)
   - scope: any source `in-scope` or `uncertain` → `in-scope`; `out-of-scope` only when **every** source independently proves it
   - change_relation: any source `affected` or `uncertain` → mandatory; `independent` only when **every** source independently reports it with primary-hunk evidence
   - origin / scope_reason: sources conflict → `uncertain`
   - security/data-integrity domain: any source hits → the aggregate keeps the critical domain
   - evidence: keep all — never discard with the losing severity

   `[USER_SKIPPED]` applies only **after** the aggregate identity forms: an aggregate that lands in-scope is not excluded by a disposition recorded against the out-of-scope reading.

3. **Tag source**: `source = codex | toolkit | both`

4. **Sort**: P0 → P1 → P2 → Nit

5. **Gate decision** (dual-axis, on the conservative aggregate, after deriving `fix_obligation`): an in-scope (incl. `uncertain`) `mandatory` finding at or above the tier's blocking severity, an in-scope `admitted` finding at any severity, or an out-of-scope critical finding with no valid `[USER_SKIPPED]` → BLOCKED; else → READY with `gate_reason=NONE`

Output format keeps the merged scope fields and adds the source tag:

```
- [P0] file:line issue → fix | origin=in-diff scope_reason=diff-file scope=in-scope change_relation=affected evidence=<...> [source: both]
- [P1] file:line issue → fix | origin=uncertain scope_reason=uncertain scope=in-scope change_relation=uncertain evidence=<...> [source: codex]
```

### Step 4.5: Output the gate and note the verdict

Output the standard gate sentinel:
- `✅ Ready` — if READY (no blocking finding on either axis)
- `⛔ Blocked` — if BLOCKED

**Route on derived values, never declarations.** Before acting on the reviewer's sentinel, normalize all findings fail-closed (`references/review-common.md § Scope Fields`), **derive each finding's `fix_obligation`** (`references/scope-contract.md § Opportunistic Envelope` — `mandatory` unless the finding is a proven opportunistic candidate; `admitted` or `deferred` per the envelope), then **derive** the expected sentinel × `gate_reason`; the reviewer's declared pair is an unverified claim. A finding whose obligation is `deferred` is recorded and does not block; one that is `admitted` blocks at **any** severity for the fix phase it was admitted into — that phase does not re-dispatch while it is unfixed; the verifying re-review derives it afresh. Four canonical recalculations: a declared `Ready × NONE` wrapping a real in-scope blocking finding routes as `Blocked × IN_SCOPE_BLOCKING` — a reviewer cannot wrap a real blocking finding in a lawful pairing; a declared `Ready × NONE` wrapping an out-of-scope critical finding with no valid `[USER_SKIPPED]` routes as `Blocked × OUT_OF_SCOPE_CRITICAL`; both classes present under a single declared reason derives `Blocked × BOTH`; a declared `Blocked` with no blocking finding on either axis routes as `Ready × NONE`. Findings too incomplete to derive → conservatively `Blocked × BOTH`. "Breaker triggered" is the model's own fix-phase state (`skills/codex-code-review/references/scope-contract.md` § Circuit Breaker), not a reviewer field — check it before routing. The matrix indexes on the **derived** pair:

| Sentinel × `gate_reason` × breaker | Action |
|------------------------------------|--------|
| `✅ Ready` × `NONE` | The only lawful Ready pairing — note pass, proceed to the next gate |
| `⛔ Blocked` × `IN_SCOPE_BLOCKING` × not triggered | Fix loop (§ Review Loop below). `IN_SCOPE_BLOCKING` means **owed now**: a mandatory finding at or above the blocking severity, or an admitted one at any severity |
| `⛔ Blocked` × `IN_SCOPE_BLOCKING` × triggered | **No fix loop**: human exit E2 (`skills/codex-code-review/references/scope-contract.md` § Human Exits) |
| `⛔ Blocked` × `OUT_OF_SCOPE_CRITICAL` | `note code_review fail`; **do not fix** — human exit E1 (closed-set options) |
| `⛔ Blocked` × `BOTH` × not triggered | E1 first (the user's decision may change scope); afterwards the remaining in-scope blocking findings are fixed — the two classes never cancel |
| `⛔ Blocked` × `BOTH` × triggered | E1 and E2 merge into a **single** Need Human decision point: one notification carrying both the closed-set options and the re-scope decision |
| Contradictory declaration (`Ready` × a blocking value, `Blocked` × `NONE`), missing or unknown values | Same as every row: re-index this matrix by the derived pair; findings insufficient to derive → treat as `⛔ Blocked` × `BOTH` |

Out-of-scope findings that are not critical never block Ready: they are listed in the report's "Out-of-Scope Findings" section and recorded as `[OUT_OF_SCOPE_DEFERRED]` lines (`skills/codex-code-review/references/scope-contract.md` § Records). An in-scope finding whose obligation derived to `deferred` likewise never blocks Ready — at or above the blocking severity it is recorded as `[OPPORTUNISTIC_DEFERRED]` (same section); below it, a non-admitted finding keeps `[NIT_DEFERRED]` exactly as before (one record per finding, chosen by severity and obligation together) — and, when it is the only blocking-severity finding, the derived pair is `✅ Ready × NONE`.

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

Blocked → fix the findings this change owes — every `fix_obligation=mandatory` finding at or above the blocking severity, plus every `admitted` one — → re-review by the path the round dispatches to: same-thread `/codex-review-fast --continue <threadId>` (the re-review prompt carries the frozen `SCOPE_BASELINE` and the active disposition list — `references/review-common.md § Re-review Prompt Template`); a fresh first dispatch on a new thread when rotation R-a/R-b holds (`references/review-common.md § Thread Rotation`); or a stateless re-dispatch of the first-dispatch template when the change is sticky on a fallback carrier → repeat until Ready.
Ready with only sub-threshold findings → **log and proceed to `/precommit`**. No extra fix pass, no extra re-review — see `@rules/auto-loop.md § Sub-Threshold Findings` for what counts as sub-threshold at each tier.

**Admission happens only inside a fix phase this loop already opened.** An opportunistic candidate may be taken into the round that a `mandatory` blocking finding put the change into, and never into a round of its own: a report deriving `✅ Ready` is not re-opened to fix a candidate, whatever the envelope still allows (`references/scope-contract.md` § Opportunistic Envelope). Admitting one makes it `admitted`, which holds this phase open until it is fixed; declining leaves it `deferred` and recorded. The re-review then derives every finding afresh — an admitted fix that did not take is reported again and is a candidate again, and recorded, only if the fresh report still proves it one (pre-existing, `independent` with hunks, not P0 / security / data-integrity); under any other fresh classification it derives `mandatory` — never blocking on the earlier admission alone, never dropped.

Round cap comes from the tier — the table in `@rules/auto-loop.md § Tiers` owns the numbers, and restating them here is what let them drift last time. The cap is the backstop, not the stall detector: a stall (`@rules/auto-loop.md § Stall Detection and Diagnosis` — three consecutive rounds that close nothing, counted by the model from the review reports) normally shows first. Same issue recurring at the cap → report blocker, request intervention.

This loop converges on the **review result**. Reaching Ready ends it — a stale reminder line from a hook is not a finding, and no further round addresses it; the Step 4.5 note is what retires the reminder.

### Loop Behavior

| Reviewer | Loop Behavior |
|----------|---------------|
| Codex exec | Stateful → `references/codex-transport.md` § Resume with the remembered `threadId` continues context; rotation R-a/R-b (`references/review-common.md § Thread Rotation`) swaps in a fresh first dispatch on a new thread |
| Fallback carrier (Codex out, sticky per change) | Stateless → the family's first-dispatch template is re-dispatched each round; no thread exists, rotation does not apply |
| Secondary (`--dual` only) | Re-dispatched every iteration, fresh context |

Any code edit resets the review cycle — the reviewer must re-run.

### Pre-precommit Checkpoint (`--dual`, Codex-healthy path only)

On the Codex-failure path this checkpoint does not run — the fallback report carries the gate alone, and any secondary result follows Step 3.5's Codex-down secondary policy: **owed** blocking findings escalate (mandatory at or above the blocking severity, or admitted at any severity), a `deferred` candidate is recorded and escalates nothing, and its `Ready` notes nothing and never closes a gate. Before triggering `/precommit` on the healthy path, reconcile any pending secondary result:

A late secondary result goes through the same normalization and field-level merge as Step 4 (fail-closed scope fields, conservative aggregate), and its outcome routes through the Step 4.5 matrix — a late out-of-scope critical finding is E1, not a silent re-open of the fix loop:

| Condition | Action |
|-----------|--------|
| Task completed + the merged aggregate has an **owed** blocking finding on either axis (in-scope ≥ `${BLOCKING}` with `fix_obligation=mandatory`, in-scope `admitted` at any severity, or out-of-scope critical with no valid `[USER_SKIPPED]`) | Re-emit BLOCKED → route via the Step 4.5 matrix (fix loop only for `IN_SCOPE_BLOCKING`, breaker untriggered) |
| Task completed + no owed blocking finding on either axis (a `deferred` candidate is recorded, not blocking) | Union aggregate → proceed to precommit |
| Task still running | Proceed with Codex gate (authoritative); if the late result produces an **owed** blocking finding on either axis after merge, route it via the Step 4.5 matrix; a `deferred` candidate is recorded, not routed. Branch review is always `thorough`, so a late in-scope P2 counts — and an `admitted` one counts at any severity |

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
- Scope contract (on demand — findings outside the frozen baseline, uncertain scope, gate
  derivation): `references/scope-contract.md`
- Loop diagnostics (on demand — stalls, the round cap, bounded adjustments):
  `references/loop-diagnostics.md`

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

Input: /codex-review-fast (transport reports codex_fail — adapter exit 1)
Action: [REVIEWER_FALLBACK] → strict-reviewer (P2) runs the fast template → validate-family-sentinel.js code → validated report carries the gate (gate_source=fallback:strict-reviewer)
```
