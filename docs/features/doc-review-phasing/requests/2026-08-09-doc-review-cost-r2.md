# Artifact authority classification and research-consumer migration

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-09
> **Status**: Pending
> **Note**: Second of three siblings (r1 → r2 → r3). The consumer migration is meaningless without the classifier, so both tech-spec steps land together here.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- Technical detail (primary source)

## Background

Every document in this repo is treated as a living document owing perpetual code alignment.
`pickCanonicalDocs` (`scripts/lib/doc-classifier.js:206`) answers "which file is the tech
spec", and eight consumers read that as "which file describes the system" — so a frozen
design record is handed to research as though it were current behaviour, and then reviewed
for drift against code it never claimed to describe. Tech specs are 49.1% of the corpus.

## Requirements

- A document's role (`Current authority` / `Design record` / `Work record` / `History record`) is machine-resolvable
- Resolution works on all 255 existing documents with **no migration** — path defaults supply day-one behaviour
- Optional in-document metadata overrides the default in both directions
- Research consumers stop treating frozen design records as current-behaviour sources

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `scripts/lib/doc-metadata.js`; path-default table; four source sets; deprecated `canonical_docs` alias; migration of the research consumers |
| Out | Any bulk edit of existing documents (deferred, `2-tech-spec.md` § 5); review profiles and the resolver (r3) |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/lib/doc-metadata.js` | New | Blockquote metadata parser + path defaults, fail-closed to `Current authority` |
| `scripts/lib/doc-classifier.js` | Modify | Emit `current_authority` / `design_records` / `work_records` / `history_records`; keep `canonical_docs` as a computed alias |
| `scripts/lib/feature-resolver.js` | Modify | Forwards only `doc_inventory` + `canonical_docs` out of the scan today (`:31`, `:35`) — must forward the source sets, with empty-set defaults on the `key: null` and cli/branch/diff early returns |
| `scripts/classify-docs-cli.js` | Modify | Serializes only `canonical_docs` today (`:30`) — must emit the source sets |
| `scripts/config/doc-taxonomy.json` | Modify | Path-default table lives here as the per-repo configuration surface |
| `skills/ask/SKILL.md`, `skills/runbook/SKILL.md`, `skills/architecture/SKILL.md`, `skills/feasibility-study/SKILL.md`, `skills/tech-brief/SKILL.md` | Modify | Resolve current behaviour against code + `rules/` + `current_authority`; consult `design_records` only for design rationale |
| `skills/tech-spec/references/feature-context-resolution.md`, `skills/create-request/references/feature-context-resolution.md` | Modify | **Two copies exist** — document the source sets alongside the deprecated alias in both |
| `test/scripts/doc-metadata.test.js` | New | Role resolution, override, malformed input, unknown path |
| `test/scripts/doc-classifier.test.js` | Modify | Source-set output; alias parity |

## Acceptance Criteria

- [ ] All four roles resolve from path alone, with no metadata present in any file
- [ ] Explicit metadata overrides the path default in **both** directions (a tech spec can declare itself current authority; a `docs/` file can declare itself a record)
- [ ] Malformed or annotated values (`Design record (mostly)`) fall through to the path default rather than being guessed at
- [ ] An unrecognised path resolves to `Current authority` (fail-closed toward the deeper obligation)
- [ ] `scanFeatureDocs` emits the four source sets; every existing `doc-classifier` test passes against the retained `canonical_docs` alias
- [ ] The sets survive both propagation boundaries (`feature-resolver.js`, `classify-docs-cli.js`), with empty-set defaults asserted on every null / early-return path
- [ ] A frozen tech spec is **absent** from current-behaviour sources (asserted as an absence) yet still reachable for design questions
- [ ] Pass `/codex-review-fast` and `/precommit` (code plane), `/codex-review-doc` (doc plane)

## Progress

| Phase | Status | Note |
| ---- | ------ | ---- |
| Analysis | Done | Consumer inventory taken 2026-08-09: 8 `canonical_docs` call sites |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- Tech Spec: [Doc Review Phasing](../2-tech-spec.md) § 3.1–3.2, § 4 Steps 2–3
- Sibling: [r1 — upfront gates](./2026-08-09-doc-review-cost-r1.md)
- Sibling: [r3 — cheap review path](./2026-08-09-doc-review-cost-r3.md)
