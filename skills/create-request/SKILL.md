---
name: create-request
description: "Create, update, or scan per-task request tickets for progress tracking. These are date-prefixed non-lifecycle docs under requests/, NOT feature-level requirements (use /req-analyze for those). Use when: tracking task progress, updating completion status, scanning incomplete requests, checking request status dashboard. Not for: feature-level problem-space analysis (use req-analyze for 1-requirements.md lifecycle doc), tech specs (use tech-spec), code implementation (use feature-dev). Output: request ticket with status tracking, referencing parent tech-spec."
allowed-tools: Read, Grep, Glob, Write, Bash, AskUserQuestion, Agent
---

# Create/Update Request Skill

## Trigger

- Keywords: create request, new request, write request, build request, update request, sync progress, scan requests, request status, incomplete requests, request dashboard

## Mode Overview

```mermaid
flowchart LR
    A[/create-request] --> B{Mode?}
    B -->|--status| C[Scan: Discover → Parse → Filter → Report]
    B -->|--update-all| F[Batch Update: Scan → Git Verify → Batch Edit → Report]
    B -->|--update| D[Update: Load → Analyze → Map → Update → Report]
    B -->|default| E[Create: Gather → Explore → Generate → Confirm]
```

## Modes

| Mode     | Trigger Condition             | Action                          |
| -------- | ----------------------------- | ------------------------------- |
| `create` | No file specified / new request | Gather info -> Fill template -> Create file |
| `update` | File specified / update request | Read current state -> Check implementation -> Update progress |
| `update-all` | `--update-all` flag | Batch scan → git verify → update all stale docs → report |
| `scan`   | `--status` flag                 | Scan all requests -> Parse metadata -> Filter incomplete -> Report |

### Arguments

| Flag | Applies To | Description |
|------|-----------|-------------|
| `--verify-ac` | `--update` (single) | Dispatch Explore agent to verify AC completion with evidence (file:line). Supports auto-detected path via feature context 5-level cascade. Not available with `--update-all`. |

## When NOT to Use

- **Feature-level requirements analysis** (use `/req-analyze` — produces `1-requirements.md`, a Phase 1 lifecycle doc for problem-space analysis; see Relationship section below)
- Viewing request structure (use request-tracking)
- Writing tech spec (use /tech-spec)
- Code development (use feature-dev)

## Relationship with `/req-analyze`

Request tickets are **work breakdown units** derived from `/tech-spec`, not requirements documents themselves. They live in a different document class per `@rules/docs-numbering.md`.

| Dimension | `/create-request` → `requests/YYYY-MM-DD-*.md` | `/req-analyze` → `1-requirements.md` |
|-----------|------------------------------------------------|---------------------------------------|
| Doc class | **Request ticket** (date-prefixed, non-lifecycle — per `@rules/docs-numbering.md`) | **Lifecycle** (Phase 1, numeric prefix) |
| Count per feature | **Many** (one per task) | **One** (upsert) |
| Position in workflow | **After** `/tech-spec` (execution phase) | **Before** `/tech-spec` (design phase) |
| Content focus | Execution — Status, Progress, AC checklist, Related Files | Problem space — 5-Why, FR/NFR, MoSCoW, stakeholders |
| Granularity | **Single task** (≤ 8 substantive ACs; gate receipts excluded from the budget, never from the lifecycle count) | **Feature-wide** |
| Update pattern | Status tracking (`scan` / `update` / `update-all` / `--verify-ac`) | Document upsert |
| Audience | Executors, progress trackers | Designers, decision-makers |

### Workflow ordering

```
/req-analyze → /tech-spec → /create-request → /feature-dev
   (Phase 1)    (Phase 2)    (ticket per task)    (implement)
```

A request ticket references its parent `/tech-spec` for technical detail and may optionally link to `1-requirements.md` for problem-space rationale (when `/req-analyze` was run).

A feature directory may also carry `intent-<key>.md` (ancillary — Design record, written by
`/req-analyze` or `/tech-spec`): constraints only — North star, Non-goals, `INV-*` invariants,
acceptance sketch — read by both the designer and the implementer. Tickets never restate it; the
implementing skills load it themselves before writing code.

### Anti-patterns to avoid

| Anti-pattern | Correct approach |
|--------------|------------------|
| Writing 5-Why / stakeholder analysis inside a request ticket | Put it in `1-requirements.md` via `/req-analyze`; ticket just references it |
| Adding `## Progress` / `## Status` tables to `1-requirements.md` | Progress tracking belongs in request tickets, not the lifecycle requirements doc |
| Creating one request ticket per whole feature (AC > 8) | Split by layer or functional area; see Granularity Guide in `references/template.md` |
| Treating `1-requirements.md` as a prerequisite for creating requests | It is advisory-only; requests work standalone when only tech-spec exists |

---

## Create Mode Workflow

```
Phase 1: Gather     -> Collect feature, title, priority, requirements
Phase 1.5a: Quick   -> AC count + layer keyword scan (pre-Explore)
Phase 2: Explore    -> Search related code + tech specs
Phase 1.5b: Refined -> Layer mixing (Related Files) + scope breadth + WBS (post-Explore)
Phase 3: Generate   -> Fill template + create file(s)
Phase 4: Confirm    -> Display result + suggest next steps
```

## Phase 1.5: Granularity Check

Assess whether the request should be split into multiple focused tickets. This runs in two passes to balance early detection with accurate analysis.

### Signal Detection

| Signal | Detection | Weight |
|--------|-----------|--------|
| **AC count > 8** | Count per § Pre-Render AC Count below — this whole phase runs in Create Mode, where no ticket is rendered yet — then exclude receipts per § Quality-Gate AC Classifier | Primary |
| **Layer mixing** | **1.5a**: keyword scan for `rules/`, `hooks/`, `scripts/` in requirements text. **1.5b**: classify Related Files into behavior-layer (`.md` rules/skills) vs code-layer (`.sh`/`.js` hooks/scripts) | Primary |
| **Scope breadth** | Requirements has 3+ functionally independent areas | Primary |
| **WBS groups ≥ 2** | Tech spec has `Work Breakdown` heading with 2+ independent task groups (secondary, high-confidence only) | Secondary (×0.5) |
| **Effort > 3 days** | Tech spec WBS has multiple M/L items | Secondary (×0.5) |

### Pre-Render AC Count

Phase 1.5 runs inside the **Create Mode** workflow, before Phase 3 renders anything, so § Live
Checkbox ACs — which reads a rendered `## Acceptance Criteria` section — has no input here and
would count zero, silently suppressing every split suggestion this phase exists to produce.

One rule, governing **every** count taken before the ticket exists: the overall `{N}`, and each
`{AC_count_A}` / `{AC_count_B}` in the split suggestion after grouping. Count the criteria gathered
at Phase 1 item 6, **one per list item**, whatever form the user wrote them in — numbered, hyphenated
or plain lines. Then exclude receipts per § Quality-Gate AC Classifier, applied to those same
strings — one of that classifier's two permitted uses. The subgroup counts are the same units as the
total, or a split "into two tickets of ≤ 8" can be proposed out of groups that were never measured
the same way as the number that triggered it.

### Live Checkbox ACs

Every path that counts ACs **in a ticket that exists** — Scan Mode's AC Progress, the
§ AC-Form Preflight, Phase 2.5's verification input and decision table, Phase 3's Progress mapping,
Phase 4 and batch mode — counts the **same items**, or the same ticket gets two different AC counts
depending on who is looking.

The qualifier is load-bearing: this definition reads a **rendered** section, so the only counts that
do not come from here are Create Mode's, defined at § Pre-Render AC Count.

An AC is a **top-level hyphen-form task-list item** inside `## Acceptance Criteria` that is live document text —
`^ {0,3}-\s+\[(?: |x|X)\]` after live-text masking. The indent bound is load-bearing: a deeper
indent under a paragraph is a *continuation of that paragraph*, so `Example only:` followed by an
indented `- [x] illustrative checkbox` is visible prose, not a task list, and an unbounded `^\s*[-*]`
counts it as a checked AC. CommonMark also allows `*` and `+` bullets and ordered task items; this
repo's template emits hyphens and the corpus contains no other form, so the extractor accepts the
hyphen form only and anything else reaches the § AC-Form Preflight's Need Human exit rather than
being promoted. A
checkbox inside a fenced block, an HTML comment, or an indented code example is illustration, not an
acceptance criterion, and a section holding nothing else has no ACs at all — which is the
§ AC-Form Preflight's no-mutation exit, not an empty AC set. Some tickets record ACs as an
**AC → evidence table** instead; that is a valid form which none of these paths can count, and it
takes the same exit.

### Quality-Gate AC Classifier

**Scope: display and granularity only. This classifier never touches status derivation.** Exactly
two paths use it — Scan Mode's AC Progress (what the dashboard shows) and Phase 1.5's split signal.
Phase 2.5's decision table, Phase 4's lifecycle and batch mode's Status rule count **every** AC and
do not consult it.

That boundary is the point. Classifying free-text ACs with a regex is inherently approximate: six
successive refinements each measured clean against the whole corpus, and each was then shown to
admit a behavioural requirement or drop a real receipt. Where a misread only shifts a displayed count it is visible; where it shifts the split suggestion
it may not be, since an undercount can suppress the suggestion silently. Both are advisory and
reversible, which is the property that matters. Where it fed status derivation, a
false positive removed an AC from the set a ticket had to satisfy — so a ticket could reach
`Completed` without the work. The fix is not a better regex; it is not letting an approximate signal
decide a durable record.

One consequence, and it is the correct one: an unchecked `Pass /precommit` keeps a ticket at
`In Progress` until that gate actually runs. A ticket whose gates have not run is not finished.

An AC is a quality gate **only when it is a receipt** — its content is *that a gate ran, or why it
has not*. Neither containing a gate command nor merely opening with one is the test:
`` `/precommit` — Try script -> fallback + graceful skip `` opens with a gate command and is an
implementation requirement for `/precommit`. A receipt is a gate command plus **one** of:

| Receipt marker | Example |
|---|---|
| a receipt word — `Pass` / `Passed` / `passes` / `通過` | `Pass /codex-review-doc` |
| a `round N` citation | `` `/codex-review-fast` round 1 `` |
| a named verdict sentinel after a dash — exactly these six **pairs**: `✅ PASS` / `✅ Ready` / `✅ Mergeable` / `⛔ Blocked` / `⛔ Needs revision` / `❌ FAIL` | `` `/precommit` — ✅ PASS `` |
| a gate **lifecycle** tail — `superseded` or `pending` followed within a bounded window by a `round N` or `verdict` reference, or `tracked below` | `` — pending Codex round 30 verdict `` |

**A bare marker must also end the receipt** — the intended semantics, subject to § Known residuals
below, which names the forms the published regex still accepts against this rule. `pass`, `round N` and `tracked below` are ordinary
English too, so each must be followed by end-of-AC, a parenthetical, or a paired verdict sentinel —
otherwise `` /precommit passes selected flags through to the underlying runner ``, `` round 3 results
must be persisted `` and `` failure details are tracked below the originating step `` all read as
receipts. A receipt is short; a requirement continues into a sentence.

`superseded` and `pending` need that bounded follow-on precisely because they are ordinary English:
`` `/precommit` — pending jobs must resume after the build finishes `` is a behavioural requirement,
and dropping it from the displayed count understates what is left. (Under the old design, where
this classifier fed status derivation, the same misread could let a ticket advance without the AC.
That is why it no longer does — the consequence is now a wrong number on a dashboard or a
misfired split suggestion.) Labels are optional and may be bold or plain (`AC-8:`, `**AC-Q1**`).

```regex
^(?:(?:\*\*[^*]{1,24}\*\*|[A-Za-z][\w.-]{0,12})\s*[:：]?\s+)?(?:(?:pass(?:ed|es)?|通過)\s+`?/(?:codex-review-fast|codex-review-doc|codex-review|precommit-fast|precommit|pr-review)\b|`?/(?:codex-review-fast|codex-review-doc|codex-review|precommit-fast|precommit|pr-review)`?(?:[^—(（:：]{0,40}?(?:\bpass(?:ed|es)?\b|通過|\bround\s+\d+\b)(?=\s*$|\s*[（(]|\s*[,，—–]\s*[✅⛔❌])|[^—(（:：]{0,60}?\s*[—–]\s*(?:round\s+\d+|(?:superseded|pending)[^—]{0,30}?(?:round\s+\d+|verdict)|[^—]{0,40}?\btracked below\b(?=\s*$|\s*[（(]|\s*[,，—–]\s*[✅⛔❌])|(?:✅\s*(?:PASS|Ready|Mergeable)|⛔\s*(?:Blocked|Needs revision)|❌\s*FAIL))))
```

Case-insensitive (`/i`) — `` `/codex-review-doc` pass `` is as much a receipt as `Pass /codex-review-doc`.


Three ways to be a receipt: a receipt word then a gate command; a gate command followed closely by
one; or a gate command whose line ends in an explicit **verdict tail** after a dash — `— round 3`,
`— ✅ PASS`, `— ⛔ Blocked`. That third branch is why a separator is not an unconditional boundary:
`` `/codex-review-fast` re-review after the round-2 fixes — round 3, ⛔ Blocked `` is a receipt whose
decisive token sits past the dash. What the tail must **not** be is prose — `` `/precommit` — Try
script -> fallback `` has a dash and is an implementation requirement, and a bare `✅` is not enough
either (`— ✅ 已驗證` stays substantive). Only a named verdict sentinel counts, and only as one of the six **pairs** above — the mark and the
word are matched together, not as a cross-product, so `✅ FAIL`, `❌ Ready` and `⛔ PASS` are not
receipts. A contradictory sentinel is malformed text, and reading it as a receipt would hide a real AC from
the displayed count — or a gate lifecycle tail in the bounded form the table
above requires, because an unchecked gate AC recording why its gate has not run yet is still
bookkeeping, not work. Two real ones live in
`docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md`.
The bounded window still stops at `(` and `（`, so a gate AC whose tail sits past a parenthetical
stays counted as work. Two real ones do:
`docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md` lines 860
and 878, `` `/precommit` then `/codex-review-doc` … (task #85) — pending … ``. These are **known,
intentional** exceptions, not oversights: widening past parentheses is where behavioural ACs live,
and the failure direction here overstates the displayed remainder rather than understating it. It
does not hold the lifecycle open — under the all-AC rule an unchecked receipt does that on its own.
Revisit only with a corpus measurement showing the widened form adds no false positive.

| Excluded — a receipt that a gate ran | Kept — the command is the subject of real work |
|---|---|
| `Pass /codex-review-doc（✅ Mergeable）` | ``  `/precommit` — Try script -> fallback + graceful skip `` |
| ``Pass `/codex-review-fast` → `/precommit` `` | ``  `/pr-review` 整合：自動呼叫 fast mode `` |
| ``  `/codex-review-doc` 通過 `` | ``…Stop 回報的事實…且不含 `/codex-review-fast` `` |
| `AC-8: Pass /codex-review-doc … ✅ Verified` | ``…新增 10 個測試（…`/precommit` 路由…）`` |
| `` `/codex-review-fast` round 1 — ⛔ Blocked `` | `Skill routing：支援至少 8 個 route target（…）` |
| `` `/codex-review-doc` pass `` | ``  `/precommit` runner 支援 ecosystem 偵測 — ✅ 已驗證 `` |
| `` `/precommit` — ✅ PASS (comment_blocks, lint:fix, build, test) `` | `提供 copy-pasteable 修正指令（如 …）` |

Every row is a real AC from this repo's `requests/`, and both columns are pinned by
`test/skills/create-request-scan.test.js`. The right column is what a position-only rule got wrong:
it dropped implementation work from the displayed count, so the dashboard understated what was left. The left column's last two rows are what a bold-label-only rule got wrong in
the other direction — a real receipt counted as work overstates the displayed remainder. It does
not hold the lifecycle open: by the all-AC rule an unchecked receipt keeps a ticket open on its own,
whatever this classifier says about it.

**Known residuals.** The published regex is looser than the prose above in places: forms like
`Pass /precommit must preserve selected flags` and `` `/precommit` — round 3 results must be
persisted `` still match, because the terminator rule reaches the bare post-command markers but
not every route. These are **accepted approximation residuals**, not open defects. Chasing them
produced six refinements, each corpus-clean and each then shown to admit prose or drop a receipt;
the seventh attempt dropped 26 real receipts. Bounding the classifier to display and granularity
is what makes residuals affordable. The cost is a slightly wrong number on a dashboard, or an
advisory split signal that fires when it need not (false negative) or stays silent when it should
fire (false positive); the route that made them dangerous is closed. Tighten one only with a corpus measurement showing it
adds no false negative.

**The classifier fails toward substantive** — when an AC is genuinely ambiguous, keep it. Since the
classifier no longer feeds status, the cost of either error is a display figure or an advisory
split signal rather than a lifecycle decision; keeping an ambiguous AC still makes the count honest about what a reader can
verify.

### Decision Logic

```
signal_count = primary_count + 0.5 × secondary_count

< 2  → proceed as single request (no suggestion)
≥ 2  → suggest split (advisory AskUserQuestion)
≥ 3  → strongly recommend split
```

### Split Suggestion

When triggered, use AskUserQuestion:

```
## Granularity Assessment

This request has {N} substantive acceptance criteria (target: ≤8, gate receipts excluded) and {layer_info}.

Suggested split:
1. {Title A} — {scope A} ({AC_count_A} AC)
2. {Title B} — {scope B} ({AC_count_B} AC)

Options:
- "Split into {N} requests" (Recommended)
- "Keep as 1 request"
```

Split by: **layer** (behavior vs code) if detected, then **functional area** if scope breadth detected, then **balanced AC groups** as fallback.

### Sibling Request Output

When user accepts split, create indexed files: `YYYY-MM-DD-{title-slug}-r1.md`, `...-r2.md`, etc. (e.g., `2026-03-18-auth-fix-r1.md`, `2026-03-18-auth-fix-r2.md`). Each gets its own AC subset (target ≤8 substantive, counted per § Pre-Render AC Count), scoped Related Files, and conditional `> **Depends On**:` header if dependency exists between siblings.

## Create Mode: Interaction

If incomplete info, ask:

```
1. Feature area: Which feature? (e.g., auth, billing, notifications)
2. Title: Brief description
3. Priority: P0 (urgent) / P1 (high) / P2 (medium)
4. Background: Why is this needed?
5. Requirements: What needs to be done? (list)
6. Acceptance criteria: How do we know it's done?
```

---

## Update Mode Workflow

**Path resolution**: `--update` supports three forms:

| Form | Behavior |
|------|----------|
| `--update <path>` | Use explicit path (must match `docs/features/*/requests/*.md`) |
| `--update` (no path) | Auto-detect from feature context (see `references/feature-context-resolution.md`) |
| `--update <keyword>` | Resolve feature key, then find active request(s) |

**Auto-detection logic** (when no explicit path):

1. Resolve feature context using the 5-level cascade — `node scripts/resolve-feature.js`, the
   wrapper that owns the failure payload; the CLI behind it is not the entrypoint
1b. **`scan_error` gate** — `scan_error !== false` ⇒ the source sets are **unknown, not empty**.
   Report it and take the ⚠️ Need Human exit. This is the step that matters most here: an
   unreadable `requests/` directory returns the same empty set as a feature with no tickets, so
   without the gate step 5 below reads it as "0 active requests" and creates a **duplicate**
   ticket beside the one it could not see. Gate on `!== false`, not `=== true`: a `{}` payload
   from a shell fallback carries no such field, so a non-null `key` is not evidence of
   completeness
2. Scan `docs/features/<key>/requests/*.md` for incomplete requests (Status not in `[Completed, Done, Superseded, Archived]` — the closed set is defined once in `scripts/lib/request-status.js`; keep this list identical to `CLOSED_REQUEST_STATUS`)
3. If exactly 1 active request → auto-select
4. If multiple active requests → AskUserQuestion with numbered list
5. If 0 active requests → offer to create new via create mode
6. If feature not resolved → Gate: Need Human

```
Phase 0: Freeze    -> Reparse Status. Closed (`CLOSED_REQUEST_STATUS`) -> no ordinary update: report frozen, exit.
                      One path continues: an explicitly authorized factual correction (Phase 4.5), which performs
                      that correction and nothing else, recorded in `Progress.Note`
Phase 1: Load      -> Read existing request document
Phase 2: Analyze   -> Analyze Related Files + git changes
Phase 2.4: Preflight -> § AC-Form Preflight (all modes, unconditional)
Phase 2.5: Verify    -> (--verify-ac only) agent-based AC verification
Phase 3: Map       -> Compare implementation with Acceptance Criteria
Phase 4: Update    -> Update Progress / Status / Checkboxes
Phase 5: Report    -> Output change summary
```

### Phase 2: Analyze Implementation Progress

```bash
# Get changes for Related Files from request document
git log --oneline --since="<created_date>" -- <related_files>

# Check test status
grep -rE "describe|it\(" test/ --include="*<feature>*"

# Check review status
git log --oneline --grep="codex-review" -- <related_files>
```

### AC-Form Preflight (all modes, unconditional)

**This runs in every update mode** — `--update` with or without `--verify-ac`, and `--update-all`
(its step 2). It is defined here, outside the verify-only phase, because that phase declares itself
"skipped otherwise": a reader following the mode instructions would otherwise skip the only
definition of the check and reach mutation logic with an unparsed AC set.

Order: **Phase 0 freeze check → this preflight → any status, Progress-table or checkbox mutation.**

That is the whole of what it gates, and the narrowness is deliberate. An **authorized factual
correction** — Phase 4.5's exception: a wrong path, a wrong date, an unfilled template placeholder —
runs after Phase 0 and **does not pass through this preflight**, because it derives nothing from the
AC set and asks nothing of it. Gating it here would revoke the one edit Phase 4.5 and
`/update-docs` § Step 1.5 both keep reachable, and revoke it exactly where it is needed most: a
ticket recording its ACs as an evidence table has no parsed checkboxes, so it would become the one
ticket whose wrong path can never be corrected. Such a correction changes the authorized fact and
`Progress.Note` only, and says so in the report.

Read the ticket's ACs per § Live Checkbox ACs. If there is **no readable live checkbox AC set** —
no `## Acceptance Criteria` section at all
(`docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md` is a real
one); the section present but containing no checkbox items; ACs recorded as an evidence table
(`docs/features/scope-discipline/requests/2026-08-15-scope-discipline-implementation.md`); or any
other form this procedure cannot parse — **or the section contains a checkbox-like item outside that
grammar at all** (`* [ ]`, `+ [ ]`, `1. [ ]`, an item indented past three spaces), or mixes task-list
items with an evidence table — then **no status mutation**: report it and take the
⚠️ Need Human exit. Never call an unparsed AC set empty, and never derive a status from one —
"every AC is checked" is vacuously true of nothing, and that is how a ticket with no
ACs at all would be promoted.

**A non-empty parse is not a complete one**, which is why the unsupported-form clause is not
redundant with the empty-set clause. A section holding `- [x] done` beside `* [ ] not done` parses
to one item, all of them checked — the unchecked AC written in an unsupported marker does not fail
the check, it *disappears*, and the ticket promotes with outstanding work. Mixed representation is
refused for the same reason: whichever form this procedure cannot read is the form whose state stops
being counted. Refuse the section as a whole; never parse the part that happens to be readable.

### Phase 2.5: AC Verification Agent (`--verify-ac` only)

Dispatched when `--verify-ac` flag is present on single-request `--update`. Supports auto-detected path via feature context 5-level cascade. Skipped otherwise (default path unchanged, <10 sec).

**Input**: AC_LIST is the **complete** live checkbox AC set the § AC-Form Preflight parsed (§ Live Checkbox ACs) — **not** filtered by § Quality-Gate AC Classifier. Filtering it here was the last status-path leak: gate ACs dropped out of the report, so the report could not carry one result per AC and the table read it as unaccounted — the classifier reaching status through report validity after being told it never decides status. RELATED_FILES from `## Related Files` table.

```
Agent({
  description: "Verify AC completion for <feature>",
  subagent_type: "Explore",
  prompt: `AC verification specialist.
    AC_LIST: ${AC_LIST}
    RELATED_FILES: ${RELATED_FILES}
    For each AC: read code, verify implementation.
    A ticket is a RECORD of work done at a point in time, not a description of today's code:
    a Related File missing from the working tree is NOT evidence the AC was never met.
    For every absent path, consult git history before concluding:
      git log --diff-filter=D --oneline -- <path>    # which commit deleted it
      git show <deletion-commit>^:<path> | grep -n '<pattern>'   # NOTE the ^ — the path does
        # not exist AT the deletion commit; `git show <deletion-commit>:<path>` exits 128.
        # For a merge commit pick the parent explicitly (^1 / ^2).
      git log -S '<distinctive string>' --oneline -- <path>   # find the introducing commit
    Output per AC:
    - Status: Complete | Complete (later removed) | Partial | Not Found | Inconclusive
    - Evidence: file:line references (historical evidence as commit:file:line)
    - Confidence: High | Medium | Low
    - Gap (if Partial): what is missing`
})
```

**Timeout**: 60 sec hard limit. Unverified ACs on timeout marked `Inconclusive`.

**Graceful degradation**: Agent dispatch fails → warn the user and fall back to the git-based
heuristic (Phase 2 results). **A failed dispatch is not a verification result — it means
`--verify-ac` did not run.** So the run continues as ordinary `--update`: the decision table below
is skipped entirely, checkboxes come from implementation evidence exactly as they do without the
flag, and the ceiling is `Candidate Complete` (only a completed verification can set `Completed`).
Reading a failed dispatch as an "empty report" instead would send it into the invalid-report rules,
where Phase 4 forbids touching any checkbox — and the heuristic's whole job is to set them. Two
directives, two different outcomes for the same input; this sentence is which one wins.

**A deleted subject is not an unmet AC.** Verification runs against the tree as it is now, but the
ticket records the tree as it was. When a later change removes what an AC was about — this repo's
hook-lightweighting deleted `hooks/post-tool-review-state.sh` and `hooks/session-init.sh` in
`0b3b8f5`, and three `test/hooks/*.test.js` suites in `91b5fc9` (both 2026-08-13), all of them
named as Related Files by older P0 tickets — a naive run
returns `Not Found` for every one of them and the mapping above would push a finished ticket back
to `In Progress`. That is not a status update; it is falsifying the record, and it points the
reader at work that does not exist. Resolve such an AC through git history and record it as
`Complete (later removed)`, naming the removing commit. If history cannot settle it, the AC is
`Inconclusive` — never `Not Found`, and never a downgrade.

Write that finding into **`Progress.Note`**, never into a new top-level metadata field. Phase 4.5
and `skills/update-docs/SKILL.md` § Step 1.5 agree that `--update`'s mutable set is exactly four
fields — Status, the Progress table, AC checkboxes, `Progress.Note` — and adding a `Note:` or
`Verification:` line to the ticket's metadata blockquote edits the record itself. A verification
result is commentary on the work, so it belongs in the Progress table beside the phase it concerns.

**Confidence-to-status mapping**:

**Ordered — the first matching rule wins.** The rules are a decision procedure, not independent
tests: `Inconclusive` is a *verdict* while `High` / `Medium` / `Low` are *confidence*, so one AC
carries both and would match several independent descriptions at once.

**In an *accounted* report, decisive verdicts drive the status directly; the boxes are consulted
only when the report yields no usable lifecycle conclusion — an invalid or unaccounted report — or
for `Inconclusive`.** The accounting qualifier is not
decoration: an unaccounted report can still be full of decisive-looking verdicts — v3.0.12 records
seven `Complete`/`High` results for a nine-AC ticket — and rules 1–2 must ignore every one of them.
For `Complete`, `Complete (later removed)`, `Partial` and `Not Found` in an accounted report the
report carries a
verdict *and* a confidence per AC, and Phase 4 updates the boxes from that same evidence, so reading
both would only invite them to disagree. Two earlier versions of this table read checkbox state for
those verdicts as well, and each needed a verdict→checkbox transition matrix before it was
deterministic: an AC reported `Complete` at `Medium` matched different rules depending on an
unwritten rule about what the checkbox became. Confining the boxes to the cases below removes that
question rather than answering it.

The boxes speak in two situations, and only two. The **invalid-report rules**, where the report
yields no usable lifecycle conclusion — and note the distinction: an unaccounted report is not an
empty one. It can carry real, valid findings (the two demoted tickets in this repo record 3-of-5 and
7-of-9 verified ACs), and those findings belong in `Progress.Note`. What it cannot do is settle the
lifecycle, because a conclusion drawn from a partial account is not a conclusion about the whole.
So the boxes decide the status and the partial evidence is kept rather than discarded. And
`Inconclusive`, which is the one verdict carrying **no completion information** — "nothing was
learned" is not evidence of done or not-done, so the preserved box is again the only thing that
speaks. An `Inconclusive` result on an *unchecked* AC therefore reopens the ticket, while the same
result on a checked one does not: collapsing those two into one status would advance unresolved
work to `Candidate Complete` while Phase 4 leaves its box unchecked — a ticket simultaneously
`Candidate Complete` and, by that status's own definition, not eligible for it.

The **AC set** is every live checkbox AC the ticket has (§ Live Checkbox ACs) — **all of them**,
gate receipts included. This table does not consult § Quality-Gate AC Classifier: that classifier is
an approximate reading of free text, and letting it decide status meant one misread could drop an AC
from the set a ticket had to satisfy.

The set is **accounted for** when the report carries exactly one result per AC, in order, each with
a verdict from `{Complete, Complete (later removed), Partial, Not Found, Inconclusive}` and a
confidence from `{High, Medium, Low}`. A missing, duplicated, extra or malformed row means it is
not.

| # | Stage | Condition | Status |
|---|-------|-----------|--------|
| 1 | report validity | The report is empty, unparseable or unaccounted for, **and** any AC is unchecked | `In Progress`. The report settles nothing about the whole, so the ticket's own record stands, and it says the work is unfinished. Any partial findings it did carry go in `Progress.Note` |
| 2 | report validity | The report is empty, unparseable or unaccounted for, and every AC is checked | `Candidate Complete`, stating in `Progress.Note` that verification did not conclude |
| 3 | verdicts | Any AC `Partial` or `Not Found` | `In Progress` |
| 4 | verdicts | Any AC `Inconclusive` on an **unchecked** AC | `In Progress`. Nothing was learned, so the preserved box is the only evidence and it says the work is unfinished |
| 5 | verdicts | Any remaining `Inconclusive` (on an already-checked AC), or any confidence below `High` | `Candidate Complete` + verification summary in `Progress.Note` |
| 6 | verdicts | Every AC is `Complete` or `Complete (later removed)` at `High` | `Completed`. Record **every** removal commit in `Progress.Note` (the Acceptance row's Note cell) — one AC or twelve |

**The table's domain begins after a successful § AC-Form Preflight.** An unreadable AC set exits
there and never reaches here, which is why no row covers it — a row that did would be dead.

Rules 1–6 exhaust the declared input space, so there is no catch-all row: rules 1–2 take every
invalid or unaccounted report, and rules 3–6 take every combination of the five verdicts and three
confidence values that an accounted report can carry. A row labelled "anything else" sat here until
two independent reviews enumerated the space and found nothing that reached it — a fallback nothing
can reach is not safety, it is a false impression of it. If a future verdict or confidence value is
added, add its row rather than relying on a fallback.

Rule 6 is the only rule that yields `Completed`. It never sees a report that did not conclude,
because rules 1–2 have already taken those. There is no empty-set rule any more: the § AC-Form
Preflight already exits on a ticket with no readable ACs, and now that gate receipts are counted,
classification can no longer empty the set.
Every row names exactly one outcome — a row offering two would put the choice back where this table
exists to remove it.

### Phase 3: Progress Mapping Rules

| Implementation Status               | Progress Update      |
| ------------------------------------ | -------------------- |
| Related Files have commits           | Development -> In Progress |
| Test files added/modified            | Testing -> In Progress |
| `/codex-review-fast` passed          | Development -> Done  |
| `/precommit` passed                  | Testing -> Done      |
| **Every** AC checked (§ Live Checkbox ACs — all of them) | Acceptance -> Done   |

### Phase 4: Auto-Update Items

**Phase 0 and the § AC-Form Preflight must both have passed.** `--update` reparses the Status before anything else and stops on a
closed ticket, exactly as batch mode's step 1 does — the ordering is a step in the declared
workflow, not a clause inside a table row, because a reader following the phases in order would
otherwise reach these mutations before Phase 4.5 tells them the record is frozen. The only path
that edits a closed ticket is the separately authorized factual correction Phase 4.5 defines.

| Section               | Update Logic                              |
| --------------------- | ----------------------------------------- |
| `Status`              | Canonical lifecycle: Pending → In Progress → Candidate Complete → Completed. The `Candidate Complete` invariant is stated below this table, once. **Under `--verify-ac` the status is whatever Phase 2.5's decision table yields; do not maintain a second mapping here.** That table reaches `Candidate Complete` by more routes than a summary keeps up with — an unaccounted report with every AC checked, a remaining `Inconclusive` on an already-checked AC even at `High`, and any confidence below `High` — which is why this row delegates instead of enumerating. Only that table's closing rule sets `Completed`. Normalize variants **at creation or manual authoring only**: `In Development`/`In Dev` → `In Progress`; `Done` → `Completed`. `--update` must **not** normalize `Done`: it is a member of `CLOSED_REQUEST_STATUS` (Phase 4.5), so a ticket carrying it is frozen and an update may change nothing on it — rewriting it to `Completed` is an edit to a closed record, not a normalization. The freeze check runs before every Phase 4 mutation in single-update mode exactly as it does at batch step 1 |
| `Progress` table      | Update each phase status based on git changes |
| `Acceptance Criteria` | Under `--verify-ac`, the transition is per verdict and independent of confidence: `Complete` and `Complete (later removed)` → **checked**; `Partial` and `Not Found` → **unchecked**; `Inconclusive` → **leave the box as it was** (nothing was learned); an invalid or unaccounted report → **change nothing**. Without `--verify-ac`, check boxes from implementation/test evidence as before. This decides the boxes only. Phase 2.5's status table is driven by the report, with two documented fallbacks to the boxes — the invalid-report rules, and `Inconclusive`, which carries no completion information — so the two cannot disagree |
| `Progress.Note`       | Add latest commit message summary         |
| `Note` (metadata)     | **Creation and manual authoring only — `--update` must not write it.** When a ticket is written or hand-edited, commentary about the Status belongs here rather than appended to the `Status` line: `Status` is compared by exact equality against a closed-status set, so any annotation reopens the request. `--update`'s mutable set is the four rows above (Phase 4.5); an update's own commentary goes in `Progress.Note`. See `references/template.md` |

**The `Candidate Complete` invariant.** Candidate Complete means every AC is checked — all of them,
with no exception for gate receipts — and closure-grade verification has not concluded. § Quality-Gate
AC Classifier is display-only and is not consulted.

### Phase 4.5: Freeze — a request ticket is a record, not a living document

A request ticket states what was asked for and what happened. That makes it a **record**: it is
appended to while the work runs, and it is never rewritten afterwards to match what the code later
became. Doc sync (`/update-docs`) does not touch it at all — see that skill's Step 1.5.

| Status | What `--update` may change |
|--------|----------------------------|
| **Any status not in `CLOSED_REQUEST_STATUS`** — `isOpenRequestStatus()` is the negation, so this covers `Pending`, `In Progress`, `Candidate Complete`, the variants Phase 4 normalizes (`In Development`, `In Dev`), `Design`, `Proposed`, and a Status that failed to parse | Status, Progress table, AC checkboxes, Progress.Note — the fields above. Naming only the three canonical values here would leave every other open status admitted by Phase 0 with no mutable set at all, which reads as frozen and is the opposite of what the parser says |
| **Any member of `CLOSED_REQUEST_STATUS`** — currently `Completed`, `Done`, `Superseded`, `Archived` | **Nothing.** A closed ticket is frozen |

The closed set is `CLOSED_REQUEST_STATUS` in `scripts/lib/request-status.js` — the same list Scan
Mode filters on, and the only place it is defined.

Reopening is a decision, not an update: when work resumes on a closed ticket, say so and create a
new ticket that references it, rather than editing history so it reads as though it was never
finished. The one exception is a factual correction to the record itself — a wrong path, a wrong
date, or **an unfilled template placeholder**: text that was never a statement about this ticket at
all, such as a trailing `**Status**: Pending / In Progress / …` legend the author never replaced.

**The exception authorizes only that correction, and its eligible targets are closed:** a
non-lifecycle recorded fact (a path, a date, a reference), or the removal of an unfilled
placeholder. It must **never** change `Status`, a Progress phase status, or AC checkbox state —
those are the lifecycle fields, and they stay governed by the freeze, the AC-form preflight and the
ordinary transition rules whatever else is being corrected. Without that exclusion the exemption
swallows the rule it follows: a wrong `Status` on a closed ticket is a "fact" in ordinary language,
so an agent could relabel a lifecycle edit as a correction and walk straight past the preflight.
Unrelated tidying is not authorized either — the correction is the named fact and nothing beside
it.
Removing one is not cleanup of record content, because it never was record content; leaving it is
worse than removing it, since a second Status field that `parseRequestStatus()` does not read and
no later update maintains will drift into contradicting the real one. Correcting it in place —
writing today's status into it — is the one thing not allowed: that manufactures the duplicate
rather than removing it. State the removal in `Progress.Note` as with any other correction — which is a correction, not a re-sync, and is stated as such in the report.

This is what stops the cost this skill's tickets kept paying: a frozen ticket is reviewed under the
`record-diff` profile, whose whole point is that drift from today's code is not a finding
(`skills/doc-review/SKILL.md` § Review Profiles).

### Update Mode: Interaction

If confirmation needed, ask:

```
1. Confirm target request document path
2. Any manually completed items to check off?
3. Any blocked items to mark?
```

---

## Scan Mode Workflow

```
Phase 1: Discover  -> Glob docs/features/*/requests/*.md (exclude archived/)
Phase 2: Parse     -> Extract Status, Priority, Created, AC progress from each doc
Phase 3: Filter    -> Keep incomplete (Status ∉ CLOSED_REQUEST_STATUS: Completed, Done, Superseded, Archived)
Phase 4: Report    -> Group by status, sort by priority then date, output markdown
```

### Phase 1: Discovery

```
Glob: docs/features/*/requests/*.md
Exclude: docs/features/*/requests/archived/*.md
```

Count total, active, and archived separately.

### Phase 2: Metadata Parsing

**Status is parsed by `parseRequestStatus()` in `scripts/lib/request-status.js` — that module is the
contract; the Status column below only restates it.** It recognises **three** conventions, and it is
what `skills/next-step/scripts/analyze.js` and `scripts/lib/fc-extractor.js` already call. A
hand-rolled scan implementing only some of them reports real tickets as `unknown` — a
`## Status: Completed` ticket read as unknown lands in the report as open work, which is the
opposite of what it says. Priority and Created have no such module: parse them per this table.

| Format | Status Pattern | Priority Pattern | Created Pattern |
|--------|---------------|-----------------|-----------------|
| Blockquote | `> **Status**: <value>` | `> **Priority**: <value>` | `> **Created**: <value>` |
| Heading | `^#{1,6}\s*Status\s*:\s*<value>` — e.g. `## Status: Completed` | — | — |
| Table | `/^\|\s*status\s*\|([^\|\n]+)\|/im` — the parser's actual expression: a **negated class** for the cell (three competing quantifiers over one run measured cubic, ~20s on a malformed row), case-insensitive on the word `status` only. Bold is stripped from the extracted, trimmed cell afterwards, never by a second whole-line pattern | `^\| Priority \| <value> \|` | `^\| Created \| <value> \|` |

Order is **blockquote → heading → table**, first match wins. The scan window is the first
**30** lines (`HEAD_LINES` in that module), measured against this repo's corpus — not 15.

**Fallback**: If metadata missing, extract date from filename (`YYYY-MM-DD-*`), default status to
`unknown`, priority to `--`. `unknown` classifies as **open** in Phase 3, matching
`isOpenRequestStatus()`: an unlabelled ticket is unfinished work, never finished work.

**AC Progress**: Derive the checked and total counts **per § Live Checkbox ACs** — that section owns
the item syntax (including `[X]`) and the live-text rule; restating either here is how they drifted —
then report the count **excluding gate receipts**, per § Quality-Gate AC Classifier. Note gate ACs
separately if at all.

This is one of the classifier's two permitted uses, and it is why it exists: on this repo there are
open tickets whose only unchecked ACs are gate receipts. Without this exclusion their raw checkbox
ratio would read as incomplete even though every substantive AC is done — which is the misreading
the exclusion prevents, not one it leaves behind. Said the other way round: after the exclusion
those tickets display a complete substantive ratio, and the deficit exists only in the pre-filter
count.

(No corpus count is quoted: the number depends on the exact measurement procedure, and the
rationale does not need it.)

**This is a display figure, not the lifecycle.** Status is derived from **every** AC (Phase 2.5,
Phase 4, batch mode), so a ticket showing `6/6` here can still be `In Progress` because a gate has
not run. That is not an inconsistency — the dashboard answers "how much of the work is left" and the
status answers "is this ticket finished", and an un-run gate means it is not.

Report AC progress as `—`, never as `0/0` and never as a finding, for **every** unreadable AC form
§ Live Checkbox ACs names: an evidence table
(`docs/features/scope-discipline/requests/2026-08-15-scope-discipline-implementation.md`), a ticket
with no `## Acceptance Criteria` section
(`docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md`), a section
holding no live checkbox items, or an unsupported syntax. Scan Mode is **display-only**, so it does
not take the preflight's Need Human exit — but rendering any of these as `0/0` would publish "this
ticket has no ACs" when the truth is "this procedure cannot read them".

**Feature name**: Extract from path — the segment **immediately after** `docs/features/`, i.e. the third path segment (e.g., `docs/features/auth/requests/...` → `auth`; two segments after the prefix is `requests`, the same for every ticket).

### Phase 3: Filter & Classify

| Status | Classification | Include in Report |
|--------|---------------|-------------------|
| Completed | Done | No |
| Done | Done | No |
| Superseded | Done | No |
| Archived | Done | No |
| In Progress / In Development / In Dev | Active | Yes |
| Candidate Complete | Active (needs verification) | Yes — group after In Progress |
| Pending | Backlog | Yes |
| Design / Proposed | Pre-work | Yes |
| unknown | Backlog (grouped with Pending) | Yes |

**Stale detection**: Pending requests with Created date > 30 days ago → mark `[stale]`.

### Phase 4: Report Format

Console-only markdown output (no file creation). Group by status in actionability order:

1. **In Progress** — active work, highest actionability
2. **Candidate Complete** — all ACs checked, not closure-grade verified (heuristic-only, or a `--verify-ac` run that did not conclude); needs a closure-grade `--verify-ac`
3. **Pending** — backlog, includes stale detection
4. **Design / Proposed** — pre-implementation

Each group as a table with columns: `#`, `Request`, `Feature`, `Priority`, `Created`, `AC`, `Path`.
Pending group adds a `Stale` column.

**Sort order within each group**: Priority descending (`P0 > P1 > P2 > --`), then Created ascending (oldest first).

Bottom summary table: status counts + average age (days since Created).

Summary line at top: `N incomplete / M total (K archived excluded)`.

---

## Batch Update Mode (`--update-all`)

Scan all incomplete requests, cross-reference with git history, and batch-update docs where implementation evidence exists. This automates what would otherwise require running `--update` on each doc individually.

```
Phase 1: Discover  -> Reuse Scan Mode Phase 1-3 to find incomplete docs
Phase 2: Verify    -> For each doc, check git log for Related Files commits
Phase 3: Classify  -> Sort into: updatable (has commits) vs unchanged (no commits)
Phase 4: Batch Edit -> Update Status, AC checkboxes, Progress table for each updatable doc
Phase 5: Report    -> Output change summary table
```

### Phase 2: Git Verification

For each incomplete request doc, extract the feature name from path and search for evidence:

**Priority**: Use Related Files from request doc when available (most accurate). Fall back to feature slug heuristic only when Related Files section is absent.

```bash
# Priority 1: Use Related Files from request doc (if present)
# Parse "## Related Files" table → extract file paths → git log per path

# Priority 2: Feature slug heuristic (fallback)
git log -5 --oneline --all -- skills/<feature>/
```

**Read git's own exit status, and do not pipe it away.** `git log … | head -5` reports the status of
`head`, which is 0 even when git exited 128 — so a non-repository, an unreadable object store and a
genuine "no commits" all look identical, and the tri-state below collapses to `NO_COMMITS` exactly
where it must not. Use `-5` on git itself. Status 0 with output → `HAS_COMMITS`; status 0 with no
output → `NO_COMMITS`; **any non-zero status → `EVIDENCE_UNKNOWN`**. A shallow clone is the same
class: it can answer "nothing found" without having the history to know, so treat a repository
reporting `--is-shallow-repository` as `true` as `EVIDENCE_UNKNOWN` rather than as an answer.

**Exclude docs-only commits**: Filter out commits that only touch `docs/` paths — these are doc-sync commits, not implementation evidence. A valid evidence commit must touch at least one non-docs file.

**Report one of three results per document**, never a bare boolean: `HAS_COMMITS`, `NO_COMMITS`, or
`EVIDENCE_UNKNOWN` when the probe did not conclude (nonzero `git log`, unreadable repository,
missing history). Phase 3 row 4 is only sound over `NO_COMMITS`; `EVIDENCE_UNKNOWN` takes the
⚠️ Need Human exit before classification.

### Phase 3: Classification

Classification **queues** an action; nothing here edits a document. Every `Action` below is a
proposal that Phase 4 executes only after its freeze and AC-form preflights pass — which is what
makes those preflights a guarantee rather than a convention.

**Ordered first-match**: a doc takes the action of the **first** row it satisfies and no other. The
rows overlap by construction — a `Pending` ticket with unchecked ACs and no commits satisfies more
than one — so an unordered reading queues two contradictory actions for one document. How the
Status is *written* (blockquote, heading, table, or absent) is deliberately **not** a category here:
representation decides the shape of the edit, never whether to edit, and it is settled in Phase 4
step 6.

| # | Category | Condition | Action |
|---|----------|-----------|--------|
| 1 | FROZEN | Status ∈ `CLOSED_REQUEST_STATUS` per `parseRequestStatus()` | Skip, report as frozen. First because a closed ticket must never be reached by a later row |
| 2 | ALL_CHECKED | Checkbox ACs parsed successfully (**not** an evidence-table ticket — see the AC-form preflight) **and** every AC is checked **per § Live Checkbox ACs** (all of them) but Status ≠ Completed/Candidate Complete | Update Status → Candidate Complete (heuristic-only, not Completed) |
| 3 | HAS_COMMITS | Git commits exist for Related Files | Read doc → verify AC → update |
| 4 | OTHERWISE | No earlier row matched, and Phase 2 returned `NO_COMMITS` | Skip, report as unchanged, naming the reason where it is an unreadable AC set |

Phase 2 returns one of three results, and row 4 depends on which: `HAS_COMMITS`, `NO_COMMITS`, or
**`EVIDENCE_UNKNOWN`** — a `git log` that exited nonzero, an unreadable repository, any probe that
did not conclude. `EVIDENCE_UNKNOWN` never reaches classification at all: report it and take the
⚠️ Need Human exit, exactly as the `scan_error` gate does for an unreadable `requests/` directory
and for the same reason. Unknown evidence is not absent evidence, and the whole of row 4 rests on
that difference: "no earlier row matched" entails "no qualifying commits" only when the probe
actually answered. Read the other way, a repository that could not be searched would be reported as
a document with nothing to do.

Row 4 is the **residual**, deliberately: every document Scan Mode returns must match some row, and a document that matches no row has no defined action — the same defect as two contradictory ones.

A Status that `parseRequestStatus()` resolved from the **heading** or **table** form is not a
category and not "missing metadata" — Phase 2 lists all three forms as canonical, and this repo has
real `## Status: Completed` tickets. It classifies by its value like any other, and row 1 catches it
when that value is closed. A `parseRequestStatus()` of `null` is open by `isOpenRequestStatus()` and
classifies on evidence. Both are then **edited** per Phase 4 step 6, which owns the form question.

### Phase 4: Batch Edit Rules

For each updatable doc:

1. **Frozen docs (preflight — before any mutation)**: A doc whose Status is in `CLOSED_REQUEST_STATUS` is skipped and reported as frozen — Phase 4.5 applies to batch mode identically. Scan Mode already filters these out, so a closed doc reaching Phase 4 means the status was misparsed — a stale scan or a misclassification. That is exactly why the check must run **first**: reparse the Status here and stop, rather than editing a historical record through steps that would otherwise have already run.
2. **AC form (preflight — before any status or checkbox edit)**: Apply § AC-Form Preflight (all modes, unconditional). A ticket recording its ACs as an evidence table has no parsed checkboxes, and "zero parsed checkboxes" must never read as "all checked" — that is how a table-form ticket would be set to `Candidate Complete` vacuously. Report it and leave it unmutated, exactly as single-request mode does.
3. **AC checkboxes**: Cross-reference git diff to determine which ACs are met. Only check ACs with clear implementation evidence. **This runs before the Status step, not after it.** Status is derived *from* the checkboxes, so deriving it first reads the pre-update state: a `Pending 0/14` ticket whose commits satisfy every AC would be written `In Progress` and then have all fourteen boxes checked, leaving `In Progress 14/14` — and making this section's own `Pending 0/14 → Candidate Complete 14/14` example unreachable.
4. **Status**: Count **every** AC per § Live Checkbox ACs — the gate classifier is display-only and is not consulted here, so an unchecked `Pass /precommit` does hold the ticket open, which is what an un-run gate means. If all ACs are checked (heuristic) → `Candidate Complete`. If only some are → `In Progress`. Only `--verify-ac` (single update) can set `Completed`.
5. **Progress table**: Update phase statuses based on commits found.
6. **Missing metadata**: Table format is a **valid canonical format** (Phase 2, `parseRequestStatus()`), so a
   table-format ticket is not missing metadata — never add a blockquote header beside it. Blockquote outranks
   table in the parser's precedence, so doing that silently changes the value every consumer reads. Update the
   Status field the ticket already has, in place and in its own format. Only when `parseRequestStatus()` returns
   `null` may a field be added, and then a bare `> **Status**: <value>` line — not a whole metadata header.

### Phase 5: Report Format

```markdown
## Batch Update Report

| # | Request | Feature | Before | After | Changes |
|---|---------|---------|--------|-------|---------|
| 1 | Bug-fix redesign | bug-fix-redesign | Pending 0/14 | Candidate Complete 14/14 | Status + AC + Progress |
| 2 | Safe-remove | safe-remove | Pending 0/12 | Candidate Complete 12/12 | Status + AC |
| 3 | Multi-ecosystem | multi-ecosystem | Pending 0/23 | Pending 0/23 | (no changes — no commits) |

**Updated**: N / **Unchanged**: N / **Total scanned**: N
```

## Write-Time Budget

A ticket is a work unit, not a narrative. It stays readable only if it is written to a budget and
updated by **overwriting** rather than appending.

| Item | Budget |
|------|--------|
| Whole ticket | ~100 lines (`wc -l`). Past 150, the ticket is doing a tech spec's job — move the design out and link to it |
| Acceptance Criteria | ≤ 8 **substantive** (Phase 1.5 splits above that). Gate receipts do not count toward it and are not deducted from the rendered ticket — a ticket may legitimately render 8 substantive ACs plus its receipts |
| Background | ≤ 10 lines — why this exists, not how it will be built |
| `Progress` table | Cells are **overwritten**, never appended to |

**Overwrite, do not accumulate.** Each update replaces the phase status and its note; it does not add
a round. A ticket carrying "Round 1 … Round 7 …" is a review log wearing a ticket's name — that
belongs in `review-log-<topic>.md`, and moving it there costs nothing because the ticket never needed
it. This is where request tickets grow without anyone deciding they should.

The budget is a write-time target, not a gate. A ticket already over it is trimmed at the next
substantive edit — unless it is closed, in which case it is frozen (Phase 4.5) and left alone.

**Trimming is authoring, never updating, and never rides along on a correction.** `--update` and
`--update-all` do not trim at any length: their mutable set is the four fields Phase 4.5 names, and
Background, Requirements, Scope and Related Files are frozen record content however far over budget
the ticket runs. Nor does Phase 4.5's factual-correction exception authorize it — that exception
covers **only what it names** (the erroneous fact, or an unfilled template placeholder) and nothing
else in the document. Trimming is not a correction, so it never rides along on one.
Letting a one-line correction carry a rewrite of unrelated sections would reopen the whole record
through the narrowest door in the contract. "The next substantive edit" therefore means authoring
the ticket before it becomes a record; trimming an existing record is a separately authorized
refactor, stated as such.

## File Naming

**Format**: `YYYY-MM-DD-kebab-case-title.md`

**Location**: `docs/features/{feature}/requests/`

## Output

- Request document at `docs/features/<feature>/requests/YYYY-MM-DD-<title>.md`
- Sections: Background, Requirements, Scope, Related Files, Acceptance Criteria, Progress, References
- Status: New or Updated

## Verification

- File naming follows convention
- All template sections are filled
- Related file links are correct
- Acceptance criteria are written **per § Live Checkbox ACs** — that section owns the syntax; restating it here would make this a second extraction contract, which is the drift this delegation exists to prevent. Authoring a form it does not accept means the ticket could never be updated. A ticket may instead record ACs as an **AC → evidence table**; that is a valid form which no update mode can count, so such a ticket is reported and left unmutated rather than verified

## After Creation

Request tickets are created **after** `/tech-spec` exists (see Relationship section). Suggest execution-oriented next steps:

1. `/feature-dev` — Start implementation following the ticket's Acceptance Criteria
2. `/verify` — Run tests after implementation
3. `/create-request --update` — Sync progress as work completes

**Exception**: If the ticket was created before a tech spec exists (emergency or exploratory work), consider running `/tech-spec` first to capture the technical design the ticket will execute against.

## References

- `references/template.md` - Request template + naming convention

## Related Skills

| Skill              | Purpose                   |
| ------------------ | ------------------------- |
| `request-tracking` | Request structure knowledge base |
| `tech-spec`        | Tech spec writing         |
| `feature-dev`      | Development workflow      |

## Examples

### Create Mode

```
Input: /create-request Feature: Auth Title: Fix validation Priority: P1
Action: Explore related code -> Fill template -> Create file -> Suggest next steps
```

```
Input: Create a request document
Action: Ask for required info -> Explore -> Create -> Confirm
```

### Update Mode

```
Input: /create-request --update docs/features/auth/requests/2026-01-23-fix-login-validation.md
Action: Read request -> Analyze git changes -> Update Progress -> Output summary
```

```
Input: Update request progress
Action: Identify request from context -> Analyze implementation -> Auto-update -> Confirm
```

```
Input: (after development complete) Sync request document
Action:
  1. Read Related Files
  2. git log to check changes
  3. Update: Development unchecked -> done, Testing unchecked -> in progress
  4. Check completed Acceptance Criteria
  5. Status: Pending -> In Progress
```
