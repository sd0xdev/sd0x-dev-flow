# change_relation field, fix obligation and the owed-now gate

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-02
> **Status**: Pending
> **Note**: Work item 1 of 5 in the tech spec's § 5. Lands first because it closes the "always mandatory" hole with contract text and tests alone — no envelope latch, no config change, no script.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.3 is the contract this ticket implements
> **Intent**: [intent-opportunistic-fix-envelope.md](../intent-opportunistic-fix-envelope.md) <- INV-001, INV-004, INV-005 bind this ticket

## Background

A pre-existing P1 in a baseline file, or in one direct caller, is in-scope today and Step 4.5
routes it into the fix loop unconditionally — the primary change's risk never enters the decision.
Before an envelope can shape the budget, the review contract needs to say *whether the primary
diff affects a finding* (a neutral reviewer field) and to let a proven-independent candidate be
deferred without the gate reading it as a blocking finding. This ticket adds exactly that:
the field, the obligation set, and the gate predicate. It ships no budget logic.

## Requirements

- Add `change_relation=<affected|independent|uncertain>` as the fifth scope field; `independent`
  on an in-scope finding must cite the primary hunk(s) (`file:@@-a,b+c,d`) and, for one-hop, the
  call site.
- Fail-closed normalization: missing or unknown → `uncertain`; `origin=in-diff ∧ independent` or
  `branch-introduced ∧ independent` → contradictory → `uncertain`; `independent` without hunk
  evidence → `uncertain`. Orchestration may escalate toward mandatory, never toward independent.
- Define `fix_obligation ∈ {mandatory, admitted, deferred}` and the gate predicate
  `⛔ Blocked ⇔ ∃ in-scope ∧ ((mandatory ∧ severity ≥ tier_blocking) ∨ admitted)` ∨ the existing
  out-of-scope-critical disjunct. `gate_reason` keeps its four values; `IN_SCOPE_BLOCKING` means
  *owed now*.
- Dual merge stays conservative: any `affected` / `uncertain` source → mandatory.
- Request the field neutrally on all five prompt surfaces; none may mention an envelope, a
  ceiling or a desired disposition. The re-review template gains the fixed sentence asking the
  reviewer to re-evaluate `change_relation` against the current primary diff.
- Resident guard and `fix-all-issues.md` wording per spec § 3.6 and § 2.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | Contract text in `review-common.md`, `scope-contract.md`, `SKILL.md` § Step 4.5 / § Review Loop, five prompt surfaces, `rules/scope-discipline.md`, `rules/fix-all-issues.md`; the tests that pin each |
| Out | The envelope latch and `[OPPORTUNISTIC_BUDGET]` resolution (spec § 5 item 2); `risk_class` in `sensitive-paths.json` (item 3); `## Opportunistic Fix Ceiling` (item 4); `auto-loop.md` sub-threshold wording and override row (items 2 and 4); doc sync (item 5). Until item 2 lands, the provisional envelope is `closed`, so every candidate this ticket can classify is deferred — that is the intended interim state |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/codex-code-review/references/review-common.md` | Modify | § Scope Fields: fifth field + evidence rule + fail-closed reading; § Merge Gate: obligation-aware predicate; § Re-review Prompt Template: re-evaluation sentence; § Dual Reviewer Aggregation: merge rule |
| `skills/codex-code-review/references/scope-contract.md` | Modify | New § Opportunistic Envelope (candidate predicate, obligation set, gate predicate only — no envelope table yet); § Behavior Table split to seven rows; § Gate Derivation `IN_SCOPE_BLOCKING` = owed-now |
| `skills/codex-code-review/SKILL.md` | Modify | § Step 3 inline secondary prompt requests the field; § Step 4.5 derives obligation before the pair; § Review Loop admits candidates only inside an open fix phase |
| `skills/codex-code-review/references/codex-prompt-{fast,full,branch}.md` | Modify | Findings format carries `change_relation=<...>`; neutral wording |
| `rules/scope-discipline.md` | Modify | Resident guard: provisional `closed`, candidate exclusions, deferral ≠ dismiss, no opportunistic-only round, three record literals |
| `rules/fix-all-issues.md` | Modify | Preamble "every **owed** in-scope blocking issue"; Opportunistic budget deferral exception row |
| `test/skills/scope-review-contract.test.js` | Modify | Fifth field on all five surfaces; derivation fixtures; prompts carry no budget |
| `test/rules/scope-discipline.test.js` | Modify | Seven behavior rows; five resident record literals; guard sentences |
| `test/rules/contract-routing.test.js` | Modify | `RECORD_LINE` gains the three `OPPORTUNISTIC_*` tokens |
| `test/skills/seek-verdict.test.js` | Modify | Regression: a deferral never emits or inherits `[DISMISS_VERDICT]` |

## Acceptance Criteria

- [ ] `review-common.md` § Scope Fields defines `change_relation` with the hunk-evidence rule, and its fail-closed reading covers missing, unknown, `in-diff ∧ independent`, `branch-introduced ∧ independent`, and `independent` without hunks — each normalizing to `uncertain`
- [ ] All five prompt surfaces (three variant templates, `SKILL.md` § Step 3 inline secondary, re-review template) request `change_relation` in neutral wording, and none contains "envelope", "ceiling" or a desired disposition; the re-review template carries the re-evaluation sentence
- [ ] `scope-contract.md` states the candidate predicate, `fix_obligation ∈ {mandatory, admitted, deferred}`, and `⛔ Blocked ⇔ ∃ in-scope ∧ ((mandatory ∧ severity ≥ tier_blocking) ∨ admitted)` ∨ out-of-scope-critical; `gate_reason` keeps four values and `IN_SCOPE_BLOCKING` is defined as owed-now
- [ ] `SKILL.md` § Step 4.5 derives obligation from normalized findings before indexing the (unchanged, seven-row) matrix; a sole deferred candidate derives `✅ Ready × NONE`; § Review Loop admits a candidate only inside a fix phase a mandatory finding opened
- [ ] `rules/scope-discipline.md` carries the resident guard sentences and the three record literals; `rules/fix-all-issues.md` preamble says "owed" and its exception table has the Opportunistic budget deferral row with the never-applies list
- [ ] Derivation fixtures pinned in `scope-review-contract.test.js`: one-hop independent → candidate; one-hop affected → mandatory; `in-diff ∧ independent` → mandatory; sole deferred → Ready; mandatory + admitted → Blocked; admitted P2 under `standard` persisting after the mandatory fix → still Blocked; dual merge with one `uncertain` source → mandatory
- [ ] `scope-discipline.test.js` pins seven behavior rows and five resident record literals; `contract-routing.test.js` `RECORD_LINE` accepts the three new tokens; `seek-verdict.test.js` pins that a deferral is not a dismissal
- [ ] `npm test` passes; `rules/auto-loop.md` is untouched by this ticket
- [ ] Pass `/codex-review-fast` → `/precommit`
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Spec § 3.3 and intent INV-001/004/005 fixed the contract; nothing left to decide |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.3, § 5 item 1, § 6
- Intent: [intent-opportunistic-fix-envelope.md](../intent-opportunistic-fix-envelope.md)
- Parent axis: [scope-discipline 2-tech-spec.md](../../scope-discipline/2-tech-spec.md)
