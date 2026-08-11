# Source Collection Guide

Multi-source collection strategy for `/tech-brief`. Three stages executed sequentially.

## Stage 1: Document Collection

Read feature docs from resolver output. All sources are optional.

| Source | Set | Discovery Method | Extract |
|--------|-----|-----------------|---------|
| `2-tech-spec.md` | `design_records` | filter the set by `type === 'tech-spec'` | Problem, Goals, Architecture, Design Decisions, Risks, Open Questions |
| `3-architecture.md` | `design_records` | filter the set by `type === 'architecture'` | Architecture diagram, AD-N decisions, Trade-offs |
| `0-feasibility-study/` | `design_records` | filter the set by `type === 'feasibility'` | Alternative comparison, Rejection reasons |
| `4-implementation.md` | `current_authority` | the set directly — **no `doc_inventory` fallback** | Implementation notes, Lessons learned |

**The set is the filter; the alias is not a selector.** The first three rows named
`canonical_docs.<role>` here, which reads as "the alias and the set agree". They do not have to:
`canonical_docs` picks from `doc_inventory` by *type*, ignoring the resolved role, so a tech spec
that declares `Doc role: History record` stays non-null in the alias while leaving `design_records`
(pinned at `test/scripts/doc-classifier.test.js:534`). Selecting through it would hand a document
the corpus no longer calls design evidence to a brief that presents it as exactly that. And it is not a path selector either: it is chosen across the whole inventory by type and
canonicality, so with a historical canonical `2-tech-spec.md` beside a design-record variant
`2-tech-spec-v2.md` it names the *other* file. Each set entry already carries its own `file` — use
that, and never rejoin through the alias.

The fourth row has no alternative selector on purpose. Filtering `doc_inventory` by
`type === 'implementation'` reads the *path*, not the resolved role: an implementation doc
carrying `> **Current behavior authority**: No` resolves to `History record` and leaves
`current_authority`, yet stays an implementation entry in the inventory. The filter would then
feed a superseded record to the brief as current behaviour — the exact failure the split exists
to prevent. No row has a `type` fallback: the set is the selector for all four, and the entry's own
`file` is the path. The fourth is called out separately only because `type === 'implementation'`
is the fallback someone would reach for, and it is the one that fails hardest.

**What the split buys a brief**: the first three rows say what was *intended*; the fourth and the
code say what *shipped*. Attribute accordingly — a design record's claim written up as delivered
behaviour is how a brief misleads a reader who cannot check the code.

**Note**: `canonical_docs` is the deprecated alias, retained while consumers migrate. It provides
only 4 roles (`tech_spec`, `architecture`, `feasibility`, `requirements`) and is selected from
`doc_inventory` — unchanged from before the split, so it answers "which file is the tech spec" and
says nothing about whether that file is current. The source sets are the current interface.

### Feature Resolver Invocation

```bash
node scripts/resolve-feature.js [--feature <key>]
```

Parse JSON output for the source sets (`current_authority`, `design_records`, `work_records`,
`history_records`) and `doc_inventory`. If resolver fails or returns null key, Gate: Need Human.

## Stage 2: Code & Git Evidence

Collect implementation evidence from git history and source files.

| Step | Command | Cap | Output |
|------|---------|-----|--------|
| 1. Commit history | `git log --oneline -20 -- docs/features/<key>/ skills/<key>/ scripts/` | 20 commits | Timeline, change summary |
| 2. Diff stats | `git diff --stat HEAD~20..HEAD -- <feature-paths>` | Summary only | File-level change magnitude |
| 3. Changed file list | `git diff --name-only HEAD~20..HEAD -- <feature-paths>` | All | File paths for next step |
| 4. File reading | Read top 5 changed **source files** (exclude docs/test/config) | 5 files, 100 lines each | `file:line` references, code context |

### File Selection for Reading

From the changed file list (step 3):

1. Exclude: `docs/**`, `test/**`, `*.json` config, `*.md`
2. Sort by: change frequency (files appearing in more commits first)
3. Take top 5
4. For each: Read targeted sections (function definitions, key logic) up to 100 lines

If no source files remain after filtering (docs-only change), skip file reading and note in provenance: `[Implementation section based on git log only]`.

## Stage 3: Request Selection

Collect request doc metadata (AC status, progress, references).

### Selection Rules

Unlike forward-looking skills (e.g. `/create-request --update`), tech-brief is a **post-development** tool — completed features are its primary use case. Therefore, include **all** request docs regardless of status.

| Condition | Action |
|-----------|--------|
| 0 request docs | `[Source unavailable — no request docs found for this feature]` |
| 1 request doc | Use it |
| 2-3 request docs | Use all, sorted by date desc |
| >3 request docs | Use top 3 by date desc, note `[N additional request docs omitted]` |

**No status filter**: All request docs are included (Completed, In Progress, Candidate Complete, Pending, etc.). This is intentional — tech-brief needs the canonical implementation record from completed requests for Background, References, and Next Steps sections.

### Extraction Targets

From each selected request doc:

| Section | Extract |
|---------|---------|
| `## Acceptance Criteria` | Checked/unchecked items for Limitations section |
| `## Progress` | Phase statuses for Next Steps section |
| `## References` | Codex threadIds, PR links for Discussion section |
| `> **Status**:` | Current status for Background section |

### PR Link Fallback

| Priority | Source | Pattern |
|----------|--------|---------|
| 1 | Request `## References` | Direct links |
| 2 | Git log | `Merge pull request #N` patterns |
| 3 | None found | `[No PR links found]` |

## Missing Source Handling

When any source is unavailable:

```markdown
[Source unavailable — no <type> found for this feature]
```

When partial data:

```markdown
[Partial — <type> exists but lacks data for this subsection]
```

Never fabricate content. If all sources for a section are missing, the section still appears in output with the missing source marker (never omit sections).

## Section-to-Source Priority Mapping

| Section | Primary | Secondary | Fallback |
|---------|---------|-----------|----------|
| 1. Background | tech-spec §1 | request doc status/background | git log first commit |
| 2. Design Decisions | tech-spec §3 + architecture AD-N | feasibility study | tech-spec §3 only |
| 3. Implementation | Changed files + git diff | tech-spec §2 | git log + diff stat |
| 4. Limitations | tech-spec §4 + §7 | request AC unchecked | tech-spec §7 only |
| 5. Discussion | request `## References` | git merge commits | `[No references found]` |
| 6. Next Steps | request `## Progress` | tech-spec §5 | `[No roadmap available]` |
