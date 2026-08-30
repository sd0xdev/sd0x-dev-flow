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
| Review Log | `review-log-<topic>.md` | Intent | `intent-<feature>.md` |

The Intent basename is **exactly** `intent-<feature>.md` for the feature directory it sits in —
consumers resolve that exact name; a wildcard scan only surfaces strays or ambiguity.

## Size Limit — 500 Lines

**Scope: the feature documents this file governs** — everything under `docs/features/`. It is not a
line budget for `.md` files at large. **Functional documents are out of scope entirely** (see Exempt
below): a functional document is an *instruction surface* — it is loaded as a unit and executed, not
read section by section, so length costs nothing the way it costs a reader who scrolls, and there is
no numbered-subfolder shape to split it into. Compressing one to stay under a limit that never
applied to it removes information for no benefit — which is the failure this paragraph exists to
prevent.

**What this rule is actually against is bloat** — the tech spec or requirements doc that keeps
absorbing sections until no one reads it end to end. 500 lines is the *signal* that a prose document
has probably reached that point, not a mechanical trigger: **the model judges the individual file**.
A 550-line spec whose sections are genuinely one argument may stand (state the call and the reason);
a 350-line doc already sprawling across unrelated concerns is better addressed early. What is not a
judgment call: letting a lifecycle doc grow unbounded because the fix is work, or compressing away
live information to duck under a number.

### Prune first, then merge, then split

Three remedies, in this order. Splitting was once the only one named here, and it is the only one
that leaves the total unchanged — a corpus can only grow under a rule whose sole answer to "too
long" is "put it in more files".

| Order | Remedy | Applies when | What it costs |
|-------|--------|--------------|---------------|
| 1 | **Prune** | The content is no longer true, describes a design that was never built, or is duplicated verbatim in a doc that owns it | Nothing — dead text is not information |
| 2 | **Merge** | Two sections say the same thing from different angles, or a section belongs to a doc that already covers the topic | Nothing, if the surviving copy is the fuller one |
| 3 | **Split** | What remains is all live, all unique, and still too long for one read | The reader gains a hop; the corpus gains a file |

**Prune means removing text that is dead, not text that is inconvenient.** Live information is
moved, never deleted: if it is true and stated nowhere else, it goes into the doc that owns it —
that is remedy 2, not remedy 1. Say which remedy you applied and why, and if you pruned, say what
made the text dead (superseded by which change, duplicated in which file).

Records are exempt from all three. A request ticket, review log or ADR states a point in time; text
in it going out of date is the record working, and pruning it destroys the only copy. See
`skills/update-docs/SKILL.md` § Step 1.5.

| Lines (prose docs under `docs/features/`) | Reading |
|-------|--------|
| ≤ 400 | Fine |
| 401–500 | Prune the dead sections at the next substantive edit; split if what is left is still over |
| > 500 | Act — prune, merge, or split, in that order. The model may keep it whole by stating why this file reads better unsplit |

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
| `1-intent.md` (any `[0-4]-intent.md`) | The numbered form mis-types via the classifier's prefix fallback (phase 1 → requirements); intent is ancillary, never numbered |
| `intent.md` | Unclassifiable appendix — the basename must carry the feature key: `intent-<feature>.md` |
