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
| Review Log | `review-log-<topic>.md` | | |

## Size Limit — 500 Lines

**Scope: the feature documents this file governs** — everything under `docs/features/`. It is not a
line budget for `.md` files at large. **Functional documents are out of scope entirely** (see Exempt
below): a functional document is an *instruction surface* — it is loaded as a unit and executed, not
read section by section, so length costs nothing the way it costs a reader who scrolls, and there is
no numbered-subfolder shape to split it into. Compressing one to stay under a limit that never
applied to it removes information for no benefit — which is the failure this paragraph exists to
prevent.

**What this rule is actually against is bloat** — the tech spec or requirements doc that keeps
absorbing sections until no one reads it end to end. The counter-move is **splitting sections out
into the numbered subfolder**, not deleting content. 500 lines is the *signal* that a prose document
has probably reached that point, not a mechanical trigger: **the model judges the individual file**.
A 550-line spec whose sections are genuinely one argument may stand (state the call and the reason);
a 350-line doc already sprawling across unrelated concerns is better split early. What is not a
judgment call: letting a lifecycle doc grow unbounded because splitting is work, or compressing away
information to duck under a number.

| Lines (prose docs under `docs/features/`) | Reading |
|-------|--------|
| ≤ 400 | Fine |
| 401–500 | Consider splitting at the next substantive edit |
| > 500 | Split is the default — the model may keep it whole by stating why this file reads better unsplit |

Measure with `wc -l`. Lines, not bytes — that is what the reader scrolls.

**Splitting is a manual edit — no skill does it for you.** `/update-docs` syncs docs against code and `/doc-refactor` condenses one file; neither moves sections into a subfolder or rewrites inbound links. The shape to produce:

```
docs/features/<feature>/2-tech-spec/
├── 2-tech-spec.md        # Main: canonical filename, keeps §-structure, links to subs
├── 1-<sub-topic>.md      # Subs: numbered from 1, no lifecycle meaning
└── 2-<sub-topic>.md
```

Three constraints, each with a parser behind it: the main file keeps the **canonical filename** (`doc-classifier.js` sets `is_canonical` only on an exact match); the folder keeps the **lifecycle prefix** (`_inferParentType` resolves a directory by its `^[0-4]-`, so no taxonomy entry is needed); and sub-file numbers restart at 1 because the parent's type overrides theirs — `3-core-logic.md` inside `2-tech-spec/` must not leak as a phase-3 architecture doc.

**A move breaks links in both directions, and only one of them is visible from outside.** Inbound
links break silently, so finish the job: `grep -rn '<old-filename>' docs/ skills/ rules/ scripts/ test/` and repoint every hit — the path gains one directory level, so a sibling `./2-tech-spec.md` becomes `./2-tech-spec/2-tech-spec.md` and a `../` reference gains a `../`. Scripts that hard-code the old path count too. **Then the other direction**: every relative link *inside* the moved file has shifted by the same amount, and those fail just as silently — verify each one resolves rather than eyeballing it:

```bash
grep -o '](\.[^)]*)' <moved-file> | sed 's/^](//;s/)$//' | while read -r l; do
  [ -e "$(dirname <moved-file>)/$l" ] || echo "DEAD $l"
done
```

Then run `/codex-review-doc` on the result.

**Cut at the section that dominates**, not at an arbitrary line count. Usually one `##` section carries most of the file, and its `###` boundaries are the natural sub-documents. A split landing mid-argument is worse than the long file.

**Exempt — functional documents**, i.e. every `.md` that is an instruction surface rather than a
document someone reads:

| Exempt | Why |
|--------|-----|
| `skills/**` — `SKILL.md` and its bundled `references/*.md` | Loaded as a unit by the dispatcher; a reference is pulled in whole by the skill that owns it |
| `agents/*.md`, `commands/*.md` | Same — a system prompt or command body, not a document |
| `rules/*.md` loaded via `@` | Splitting adds import hops without reducing what loads — reduce the content instead |
| Templates, generated files and fixtures | Their length is dictated by what they generate or fix |
| Any file that is one unsplittable table | No cut point exists that is not mid-argument |

The test is *not* the directory but the role: if the file is loaded and acted on as a whole, the
limit does not apply. `docs/**` prose is the thing it does apply to.

## Cross-references

Relative paths only: `./2-tech-spec.md` at the same level, `../2-tech-spec.md` from a subfolder, `./0-feasibility-study/0-feasibility-study.md` into one.

## Prohibited

| ❌ | Why |
|----|-----|
| `tech-spec.md` | Lifecycle docs (phases 0-4) need their numeric prefix |
| `5-runbook.md` | Ancillary docs use semantic prefixes, not phase numbers |
| `2026-01-30-tech-spec.md` | Date prefixes belong to `requests/` only |
| `2_Tech_Spec.md` | kebab-case, lowercase |
