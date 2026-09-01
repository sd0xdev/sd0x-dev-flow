# Intent — review-loop-recovery

> **Doc class**: Intent (ancillary — Design record). Written by the planner, checked by the
> implementer. Work that contradicts an Invariant or Non-goal stops and asks — amending this
> file is a re-decision, not a sync.

## North star

When a review loop stops converging on an oversized target (the "ant death spiral"), the model
escapes by *removing the fuel* — stabilizing drift-prone references and narrowing per-round
attention — and *banking passed work* through the existing commit workflow, without reducing
review depth, going manual, or routing around any gate.

## Non-goals

- No pre-pass checkpoint commit in v1: committing work whose gates have not passed hides it
  from later dispatches (`git diff HEAD` shrinks) and silences reminders (a clean tree is not
  owed). That design is v2, gated on a frozen inclusive review-base OID — documented, not built.
- No composable or scoped partial verdicts: one slot per plane stays; a pass for files A–C
  never authorizes committing them while D–F in the same plane remain unpassed.
- No `owed = !passed` reminder formula (it would make every fresh clean checkout owe all gates
  forever); only the narrow clean-tree-with-current-fail hardening, as a separate change.
- No new diagnosis classes, no enforcement hooks, no repo-wide purge of the existing
  `file:line` reference stock (574 lines at the 2026-09-01 snapshot — mostly in exempt
  records; historical records keep theirs by design).

## Invariants

- `INV-001`: The closed diagnosis class table is unchanged; `SCATTER` and `REFERENCE_DRIFT`
  are adjustment *subtypes* of `ATTENTION_DIFFUSION`, stated at declaration time.
- `INV-002`: The v1 sequence is fixed: bounded adjustment → outer gate pass at the
  post-adjustment digest → verdict noted → user-approved `/smart-commit --execute`. A commit
  alone never defines a change boundary; the next edit opens a new change with a fresh first
  dispatch.
- `INV-003`: Every review verdict is a whole-change verdict — the `SCATTER` partition
  sequences fixing inside one fix phase and never narrows what a dispatch reviews; the
  whole-change re-review at unchanged tier runs only after every known blocking finding is
  fixed, exactly as the central loop contract already requires.
- `INV-004`: A reference-stability pass targets at most 5 explicitly enumerated files, never
  `--auto`, applies one homogeneous transformation, and its internal checks are evidence —
  never the outer terminal verdict.
- `INV-005`: Point-in-time records (requests, ADRs, review logs), review evidence, scope
  proofs, and generated report formats keep exact `file:line`; durable-reference guidance
  applies to maintained docs and comments only.
- `INV-006`: Everything ships reminder-layer. The recovery adjustment performs no **mutating**
  git operation and never creates a checkpoint/stash — suggesting the user create a stash/WIP
  branch before a risky pass is advisory prose, never a step. Read-only git inspection
  (status/diff/log) continues under the existing review flow. The only mutating git route in
  the whole flow is the post-pass `/smart-commit --execute`, under its unchanged Anchor
  Register #4 full-plan, per-use approval contract.

## Acceptance sketch

Simulate a stalled doc-heavy change: three review rounds close no findings, and the persistent
findings are stale positional references. The model declares
`ATTENTION_DIFFUSION / REFERENCE_DRIFT` naming ≤ 5 target files with measured pointer counts,
runs one reference-stability pass (pointers become `path § heading` / `path + symbol` forms),
the outer doc review re-runs at the new digest and reaches `✅ Mergeable`, the verdict is
noted, and only then is `/smart-commit --execute` offered with the full plan. Afterwards,
`rules/docs-writing.md` § Durable References exists, a maintained doc authored under it uses
no bare line-number locator, and the record-class exemptions still show exact lines.
