# codex-implement: make the review-and-reject contract deliverable

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`).
> **Created**: 2026-09-04
> **Status**: Pending
> **Priority**: P2
> **Origin**: Deferred out of work item 4 of the codex-exec-transport feature as
> **one opportunistic candidate** (`@rules/scope-discipline.md` § Resident Guard item 6):
> `origin=pre-existing`, in-scope via `diff-file`, `change_relation=independent`, non-critical, and
> the envelope is `closed`, so it is recorded and deferred rather than admitted.
>
> **Second correction, same day**: the Step 2 → Step 3 stale-context finding was also removed from
> this ticket and fixed in work item 4 instead. Three reviewers showed it is **branch-introduced**,
> not pre-existing: the precondition it depends on did not exist at `HEAD`, where Step 2 was followed
> directly by the dispatch. A branch-introduced finding is `mandatory` under the candidate predicate,
> so deferring it was not available either. One finding remains here.
>
> **Correction, same day**: an earlier version of this ticket recorded them as
> `[OUT_OF_SCOPE_DEFERRED]`, which two reviewers showed was the wrong disposition —
> `skills/codex-implement/SKILL.md` is in this branch's frozen baseline, so it is mechanically
> in-scope and out-of-scope was never available for it. A third finding was withdrawn outright: it
> claimed the Reject row still instructs `git checkout -- <path>` for baseline-present paths, and the
> current row restricts that command to baseline-absent paths, so it did not describe the tree.

## Background

Work item 4 converted `codex-implement` from the MCP envelope to the exec transport. The conversion
itself was the dispatch; the review rounds that followed then made substantial corrections to the
review-and-reject workflow **inside item 4** — the rollback scoping, the baseline, the detector
comparisons, the ordering of the pre-check against context collection. What is left here is the one
defect that predates the migration and that none of those corrections touched.

The genuinely dangerous one was fixed inside item 4 and is **not** deferred here: the rejection path
used to run `git checkout . && git clean -fd`, which discards every unstaged tracked change in the
checkout and irreversibly deletes every untracked file. That is gone, replaced by a baseline the
skill records and a rollback scoped to paths that had no prior state.

What remains is the contract's *precision*, and it is deferred because it is refinement of
pre-existing behaviour rather than anything the transport change introduced.

## The deferred findings

| # | Site | Finding |
| - | ---- | ------- |
| 1 | § Step 3a precondition | The dirty-tree opt-out obtains acceptance of **no rollback**, but the same paths also have no **review visibility**: a modified baseline-present untracked or ignored file keeps its `??`/`!!` status, so `git diff HEAD` omits it and the new-file listing skips it. The workflow still promises the user a complete changeset. Acceptance must cover both limits, or the dirty-tree path must be disallowed |

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `skills/codex-implement/SKILL.md` § Step 2, § Step 3a, § Step 3b; `agents/codex-implementer.md` insofar as it follows them; the tests pinning those steps |
| Out | The transport dispatch itself (item 4, done), the adapter, and the detection table — which was corrected inside item 4 and is measured |

## Acceptance Criteria

- [ ] The dirty-tree acceptance covers **both** lost rollback and lost review visibility, in those words, or the path is disallowed
- [ ] Pass `/codex-review-fast` → `/precommit`; pass `/codex-review-doc`

## References

- Parent feature: [2-tech-spec.md](../2-tech-spec.md)
- Deferred from: [non-gate skills transport switch](./2026-09-03-non-gate-skills-transport-switch.md)
