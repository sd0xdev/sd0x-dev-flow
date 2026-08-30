# Intent Template

Copy this shape into `docs/features/<key>/intent-<key>.md` — the basename is **exactly**
`intent-<key>.md` for the feature directory it sits in (`@rules/docs-numbering.md` § Ancillary docs).
Hard cap **60 lines**: a designer skims it in two minutes. The dedup test is absolute — *anything
an agent could infer by reading the diff does not belong here*. Non-goals and invariants pass
that test; restated requirements do not.

```markdown
# Intent — <feature>

> **Doc class**: Intent (ancillary — Design record). Written by the planner, checked by the
> implementer. Work that contradicts an Invariant or Non-goal stops and asks — amending this
> file is a re-decision, not a sync.

## North star

<1-2 sentences: why this feature exists — the outcome that makes it worth building.>

## Non-goals

<What is deliberately out of scope. This is the least reconstructible part from code — write it.>

## Invariants

<3-7, each with a grep-able ID:>
- `INV-001`: <a property the implementation must never violate>
- `INV-002`: <…>

## Acceptance sketch

<One end-to-end verification the finished feature must pass, stated concretely enough that a
reader can check a diff against it.>
```

## Writing rules

- **Projection, not authorship**: the content is a projection of the planning phase already run —
  `/req-analyze` Phase 1's 5-Why root problem and Goals/Non-Goals, or `/tech-spec`'s requirement
  clarification. Do not invent constraints the analysis never established.
- **One-way authorship arrow**: `/req-analyze` creates it; `/tech-spec` creates it only when
  absent, and otherwise reads and validates — a spec is never a reason to rewrite intent.
- **Invariants are cited, not vibed**: each carries an `INV-nnn` ID so a conflict can name the
  exact line it violates. Cap of 7 keeps the deviation gate from becoming noise.
