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
| Granularity | **Single task** (AC ≤ 8) | **Feature-wide** |
| Update pattern | Status tracking (`scan` / `update` / `update-all` / `--verify-ac`) | Document upsert |
| Audience | Executors, progress trackers | Designers, decision-makers |

### Workflow ordering

```
/req-analyze → /tech-spec → /create-request → /feature-dev
   (Phase 1)    (Phase 2)    (ticket per task)    (implement)
```

A request ticket references its parent `/tech-spec` for technical detail and may optionally link to `1-requirements.md` for problem-space rationale (when `/req-analyze` was run).

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
| **AC count > 8** | Count `- [ ]` items. Exclude quality-gate ACs matching: `/codex-review-fast`, `/codex-review-doc`, `/codex-review`, `/precommit`, `/precommit-fast`, `/pr-review` | Primary |
| **Layer mixing** | **1.5a**: keyword scan for `rules/`, `hooks/`, `scripts/` in requirements text. **1.5b**: classify Related Files into behavior-layer (`.md` rules/skills) vs code-layer (`.sh`/`.js` hooks/scripts) | Primary |
| **Scope breadth** | Requirements has 3+ functionally independent areas | Primary |
| **WBS groups ≥ 2** | Tech spec has `Work Breakdown` heading with 2+ independent task groups (secondary, high-confidence only) | Secondary (×0.5) |
| **Effort > 3 days** | Tech spec WBS has multiple M/L items | Secondary (×0.5) |

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

This request has {N} acceptance criteria (target: ≤8) and {layer_info}.

Suggested split:
1. {Title A} — {scope A} ({AC_count_A} AC)
2. {Title B} — {scope B} ({AC_count_B} AC)

Options:
- "Split into {N} requests" (Recommended)
- "Keep as 1 request"
```

Split by: **layer** (behavior vs code) if detected, then **functional area** if scope breadth detected, then **balanced AC groups** as fallback.

### Sibling Request Output

When user accepts split, create indexed files: `YYYY-MM-DD-{title-slug}-r1.md`, `...-r2.md`, etc. (e.g., `2026-03-18-auth-fix-r1.md`, `2026-03-18-auth-fix-r2.md`). Each gets its own AC subset (target ≤8), scoped Related Files, and conditional `> **Depends On**:` header if dependency exists between siblings.

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

1. Resolve feature context using 5-level cascade (`node scripts/resolve-feature-cli.js`)
2. Scan `docs/features/<key>/requests/*.md` for incomplete requests (Status not in `[Completed, Done, Superseded, Archived]` — the closed set is defined once in `scripts/lib/request-status.js`; keep this list identical to `CLOSED_REQUEST_STATUS`)
3. If exactly 1 active request → auto-select
4. If multiple active requests → AskUserQuestion with numbered list
5. If 0 active requests → offer to create new via create mode
6. If feature not resolved → Gate: Need Human

```
Phase 1: Load      -> Read existing request document
Phase 2: Analyze   -> Analyze Related Files + git changes
Phase 2.5: Verify  -> (--verify-ac only) Agent-based AC verification
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

### Phase 2.5: AC Verification Agent (`--verify-ac` only)

Dispatched when `--verify-ac` flag is present on single-request `--update`. Supports auto-detected path via feature context 5-level cascade. Skipped otherwise (default path unchanged, <10 sec).

**Input**: AC_LIST from `## Acceptance Criteria` (filter quality-gate ACs per codex-code-review Step 1.5 pattern). RELATED_FILES from `## Related Files` table.

```
Agent({
  description: "Verify AC completion for <feature>",
  subagent_type: "Explore",
  prompt: `AC verification specialist.
    AC_LIST: ${AC_LIST}
    RELATED_FILES: ${RELATED_FILES}
    For each AC: read code, verify implementation.
    Output per AC:
    - Status: Complete | Partial | Not Found | Inconclusive
    - Evidence: file:line references
    - Confidence: High | Medium | Low
    - Gap (if Partial): what is missing`
})
```

**Timeout**: 60 sec hard limit. Unverified ACs on timeout marked `Inconclusive`.

**Graceful degradation**: Agent dispatch fails → warn user, fall back to git-based heuristic (Phase 2 results).

**Confidence-to-status mapping**:

| Condition | Status |
|-----------|--------|
| All AC `Complete` with `High` confidence | `Completed` |
| All AC checked but any `Medium`/`Low`/`Inconclusive` | `Candidate Complete` + verification summary in Progress.Note |
| Some AC `Not Found` or `Partial` | `In Progress` |

### Phase 3: Progress Mapping Rules

| Implementation Status               | Progress Update      |
| ------------------------------------ | -------------------- |
| Related Files have commits           | Development -> In Progress |
| Test files added/modified            | Testing -> In Progress |
| `/codex-review-fast` passed          | Development -> Done  |
| `/precommit` passed                  | Testing -> Done      |
| All Acceptance Criteria checked      | Acceptance -> Done   |

### Phase 4: Auto-Update Items

| Section               | Update Logic                              |
| --------------------- | ----------------------------------------- |
| `Status`              | Canonical lifecycle: Pending → In Progress → Candidate Complete → Completed. Candidate Complete = all AC checked but not closure-grade verified (either heuristic-only, or `--verify-ac` with non-High confidence). Only `--verify-ac` with all-High confidence sets `Completed`. Normalize variants: `In Development`/`In Dev` → `In Progress`; `Done` → `Completed` |
| `Progress` table      | Update each phase status based on git changes |
| `Acceptance Criteria` | Check checkboxes based on implementation/test results |
| `Progress.Note`       | Add latest commit message summary         |
| `Note` (metadata)     | Commentary about the Status belongs here, **never appended to the `Status` line** — `Status` is compared by exact equality against a closed-status set, so any annotation reopens the request. See `references/template.md` |

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

Support two metadata formats (try in order, use first match):

| Format | Status Pattern | Priority Pattern | Created Pattern |
|--------|---------------|-----------------|-----------------|
| Blockquote | `> **Status**: <value>` | `> **Priority**: <value>` | `> **Created**: <value>` |
| Table | `^\| Status \| **?<value>**? \|` (anchor to line start, metadata section only — first 15 lines) | `^\| Priority \| <value> \|` | `^\| Created \| <value> \|` |

**Fallback**: If metadata missing, extract date from filename (`YYYY-MM-DD-*`), default status to `unknown`, priority to `--`.

**AC Progress**: Count `- [x]` (checked) vs total `- [ ]` + `- [x]` in `## Acceptance Criteria` section.

**Feature name**: Extract from path — second segment after `docs/features/` (e.g., `docs/features/auth/requests/...` → `auth`).

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
2. **Candidate Complete** — heuristic-complete, needs `--verify-ac` confirmation
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
git log --oneline --all -- skills/<feature>/ | head -5
```

**Exclude docs-only commits**: Filter out commits that only touch `docs/` paths — these are doc-sync commits, not implementation evidence. A valid evidence commit must touch at least one non-docs file.

### Phase 3: Classification

| Category | Condition | Action |
|----------|-----------|--------|
| ALL_CHECKED | AC all `[x]` but Status ≠ Completed/Candidate Complete | Update Status → Candidate Complete (heuristic-only, not Completed) |
| HAS_COMMITS | Git commits exist for Related Files | Read doc → verify AC → update |
| LEGACY_METADATA | No blockquote Status (table format or missing) | Check table format; if already Completed → skip |
| NO_EVIDENCE | No git commits, AC unchecked | Skip (report as unchanged) |

### Phase 4: Batch Edit Rules

For each updatable doc:

1. **Status**: If all AC checked (heuristic) → `Candidate Complete`. If some AC checked → `In Progress`. Only `--verify-ac` (single update) can set `Completed`.
2. **AC checkboxes**: Cross-reference git diff to determine which ACs are met. Only check ACs with clear implementation evidence.
3. **Progress table**: Update phase statuses based on commits found.
4. **Missing metadata**: Add blockquote metadata header if doc only has table format or no metadata.

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
- Acceptance criteria use checkboxes

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
