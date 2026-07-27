# Document Numbering Rules

Feature documents live in `docs/features/<feature>/`. Lifecycle docs carry a **numeric prefix** for their phase; ancillary docs carry a **semantic prefix** instead.

```
docs/features/<feature>/
├── 0-feasibility-study.md       # Lifecycle — or a 0-feasibility-study/ folder
├── 1-requirements.md            #   with 0-feasibility-study.md + N-<sub-topic>.md inside
├── 2-tech-spec.md
├── 3-architecture.md
├── 4-implementation.md
├── runbook-release.md           # Ancillary — semantic prefix, no phase number
├── checklist-deploy.md
└── requests/
    └── YYYY-MM-DD-<title>.md    # Date-prefixed
```

## Lifecycle docs

`<N>-<kebab-case-name>.md`, where N reflects **phase order, not priority**. Gaps are fine — `0, 2, 3` just means phase 1 did not apply.

| Number | Phase | Command | Required |
|--------|-------|---------|----------|
| 0 | Feasibility study | `/feasibility-study` | Recommended |
| 1 | Requirements spec | `/req-analyze` | Recommended |
| 2 | Technical spec | `/tech-spec` | Required |
| 3 | Architecture design | `/architecture` | Recommended |
| 4+ | Implementation / appendix | — | As needed |

## Ancillary docs

Operational or supplementary artifacts that belong to no phase. `doc-classifier.js` recognizes them by `semantic_pattern` (step 4 of its 7-step precedence), not by prefix fallback — the namespace is `ancillary` in `scripts/config/doc-taxonomy.json`.

| Type | Pattern | Type | Pattern |
|------|---------|------|---------|
| Runbook | `runbook-<topic>.md` | Handoff | `handoff-<topic>.md` |
| Checklist | `checklist-<topic>.md` | Briefing | `briefing-<topic>.md` |
| ADR | `adr-<number>-<title>.md` | FP Brief | `*-fp-brief.md` |

## Size Limit — 500 Lines

**Over 500 lines, split into a numbered subfolder.** Length is how a document stops being read: past a few hundred lines the reader — human or model — skims, and a detail at line 700 is functionally absent even though it is written down.

| Lines | Action |
|-------|--------|
| ≤ 400 | Fine |
| 401–500 | Split at the next substantive edit rather than growing further |
| > 500 | **Split now** |

Measure with `wc -l`. Lines, not bytes — that is what the reader scrolls.

**Splitting is a manual edit — no skill does it for you.** `/update-docs` syncs docs against code and `/doc-refactor` condenses one file; neither moves sections into a subfolder or rewrites inbound links. The shape to produce:

```
docs/features/<feature>/2-tech-spec/
├── 2-tech-spec.md        # Main: canonical filename, keeps §-structure, links to subs
├── 1-<sub-topic>.md      # Subs: numbered from 1, no lifecycle meaning
└── 2-<sub-topic>.md
```

Three constraints, each with a parser behind it: the main file keeps the **canonical filename** (`doc-classifier.js` sets `is_canonical` only on an exact match); the folder keeps the **lifecycle prefix** (`_inferParentType` resolves a directory by its `^[0-4]-`, so no taxonomy entry is needed); and sub-file numbers restart at 1 because the parent's type overrides theirs — `3-core-logic.md` inside `2-tech-spec/` must not leak as a phase-3 architecture doc.

Inbound links break silently, so finish the job: `grep -rn '<old-filename>' docs/ skills/ rules/ scripts/ test/` and repoint every hit — the path gains one directory level, so a sibling `./2-tech-spec.md` becomes `./2-tech-spec/2-tech-spec.md` and a `../` reference gains a `../`. Scripts that hard-code the old path count too. Then run `/codex-review-doc` on the result.

**Cut at the section that dominates**, not at an arbitrary line count. Usually one `##` section carries most of the file, and its `###` boundaries are the natural sub-documents. A split landing mid-argument is worse than the long file.

Exempt: `rules/*.md` loaded via `@` (splitting adds import hops without reducing what loads — reduce the content instead), generated files and fixtures, and any file that is one unsplittable table.

## Cross-references

Relative paths only: `./2-tech-spec.md` at the same level, `../2-tech-spec.md` from a subfolder, `./0-feasibility-study/0-feasibility-study.md` into one.

## Prohibited

| ❌ | Why |
|----|-----|
| `tech-spec.md` | Lifecycle docs (phases 0-4) need their numeric prefix |
| `5-runbook.md` | Ancillary docs use semantic prefixes, not phase numbers |
| `2026-01-30-tech-spec.md` | Date prefixes belong to `requests/` only |
| `2_Tech_Spec.md` | kebab-case, lowercase |
