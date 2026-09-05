# Core review family: switch to the exec transport

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-03
> **Status**: Candidate Complete
> **Note**: Work item 3 of 6 in the tech spec's § 5. One coherent slice: every gate-carrying review family flips together so no family's first dispatch uses one transport while its loop documentation names another.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.4 call-site shape; § 2 inventory
> **Depends On**: [codex-transport reference, Codex Profile setting and negative guards](./2026-09-03-codex-transport-reference-and-guards.md)
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-001, INV-004, INV-005, INV-007 bind this ticket

## Background

The review loop's gate verdicts come from the code, doc, plan and test families; their prompt
templates and loop references carry the `mcp__codex__codex({…})` envelopes and the `codex-reply`
continuation. This ticket strips the envelopes to prompt bodies and makes every dispatch cite
`codex-transport.md`, preserving `threadId` and rotation, and keeping the Degradation Matrix's thresholds, priorities and outcomes intact. The Matrix itself is not untouched: its three carrier labels become `Codex exec`, and it gains a four-line **When these rows apply** paragraph naming `codex_fail` (adapter exit 1) as the trigger — a doc reviewer found the Matrix had never stated when its rows applied.

## Requirements

- Prompt templates become body-only (envelope, `sandbox`, `approval-policy` removed; prompt text
  preserved in the narrow sense the Acceptance Criterion states — the conversion kept what each
  prompt asks Codex to do, with review-driven corrections recorded separately. "byte-preserved" was
  the original wording and is wrong, and so is a flat "semantically preserved": one explanation was
  deliberately rewritten because it had become false. `git diff HEAD` is the authoritative inventory):
  `codex-prompt-{fast,full,branch}.md`, `codex-prompt-doc.md`,
  `review-loop-{doc,plan}.md`, `codex-prompt-{test-review,ac-trace}.md`,
  `seek-verdict/references/verdict-prompt.md`, `codex-research-instructions.md` variants.
- Every call site in the family says only "dispatch per `codex-transport.md` § Start / § Resume";
  `review-common.md` § Review Loop, § Thread Rotation and § Degradation Matrix rename "Codex MCP"
  → "Codex exec" with priorities, R-a/R-b and outcomes untouched.
- Frontmatters of the direct owners gain `Bash(node:*)`, Write, Read and lose the two MCP tools — **except `plan-review`, which gains no `Write`** (INV-007's user-approved exemption: plan mode withholds that tool before `ExitPlanMode`, so it writes the prompt by heredoc);
  every in-scope frontmatter `description` **containing the phrase `Codex MCP`** — whatever the
  preposition ("via", "using") — replaces it with `Codex exec` (`scripts/generate-readme-catalog.js`
  copies descriptions into the README catalog, so a stale one would resurface at item 5);
  `--continue <threadId>` keeps its meaning (`resume`).
- The probe stays the first real `start`; `codex_fail` routes through `review-dispatch.js` exactly
  as today; long calls use background launch per the state machine.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `codex-code-review`, `codex-review`, `codex-review-fast`, `codex-review-branch`, `codex-review-doc`, `doc-review`, `plan-review`, `test-review`, `codex-test-review`, `seek-verdict`; their references and tests — exactly spec § 5 item 3 |
| Out | Non-gate conversations incl. `codex-security` / `security-review` (item 4, per § 5); README, catalog, `sharingan`, delegator frontmatters (item 5); `necessity-audit` (item 4 — its debate pipeline is excluded from fallback and needs its own `resume` mapping) |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/codex-code-review/SKILL.md` | Modify | § Step 3 dispatch, § Step 3.5 Await Results (the Codex-failure / fallback path), § Review Loop — cite the reference; frontmatter `description` says "using Codex exec" |
| `skills/codex-code-review/references/review-common.md` | Modify | Transport terminology; § Review Loop / § Degradation Matrix rows |
| `skills/codex-code-review/references/codex-prompt-{fast,full,branch}.md` | Modify | Body-only |
| `skills/doc-review/SKILL.md`, `skills/doc-review/references/codex-prompt-doc.md`, `skills/doc-review/references/review-loop-doc.md` | Modify | Same |
| `skills/plan-review/**`, `skills/test-review/**`, `skills/seek-verdict/**` | Modify | Same |
| `test/rules/review-loop-resilience.test.js` | Modify | Its two transport-label strings (`Codex MCP` in the carrier rows) become `Codex exec` — so carrier **ordering and outcomes** are byte-identical, but those two label expectations are not, and an earlier draft of this row claimed every assertion was. **Scope amended 2026-09-04** during the code-review loop: one further assertion had to migrate. It pinned the literal `Codex unavailable → fallback carries the gate`, which the transport contract's completion state machine makes wrong — the trigger is `codex_fail`, adapter exit 1 only — so keeping it byte-identical would have required keeping a defect. It now pins only that a fallback branch exists in `doc-review`; the trigger invariant moved to Guard 5 in `codex-transport-guards.test.js`, which owns it for every dispatch site. |
| `skills/codex-review{,-fast,-branch,-doc}/SKILL.md`, `skills/codex-test-review/SKILL.md` | Modify | Frontmatter grants |
| `test/skills/{review-spec,seek-verdict}.test.js` | Inspected, unchanged | Checked against the transport contract and needed no edit — recorded because an earlier draft listed them as `Modify`, which `git status` contradicts |
| `test/skills/{plan-review,testing-rules}.test.js`, `test/skills/scope-review-contract.test.js` | Modify | Re-pin against the transport contract (`test/skills/best-practices/skill-contract.test.js` is item 4's — `codex-brainstorm` stays on MCP until then) |
| `test/rules/codex-transport-guards.test.js` | Modify | Remove this ticket's **converted** skills from the Guard 2 allowlist. `skills/test-review/references/codex-prompt-test-gen.md` stays on it: it is in scope by path but deliberately still MCP-wrapped (see the criterion below), so it leaves the allowlist when its owner converts at item 5 |
| `skills/feature-verify/references/blackbox-testing.md` | Modify | **Scope amended 2026-09-04**, third amendment, and this one follows from a change made *in* this ticket rather than from a pre-existing defect. Bringing `rules/codex-invocation.md` into a state an operator can actually satisfy required stating which dispatches it governs; the honest line ("classify by the caller's act") newly governs the brainstorm dispatches that `feature-verify` and `necessity-audit` use to obtain a verdict. That immediately made this file's `Do you agree with the overall verdict?` a prohibited confirmation prompt — and it asked about a verdict the specified payload never carries, so it was unanswerable either way. One line, rewritten to ask what verdict the evidence supports. The class was then swept rather than left to surface one instance per review round: all 14 brainstorm-dispatching skills were grepped for confirmation-prompt shapes and this was the only real hit |

## Acceptance Criteria

- [x] No file under the in-scope skills contains `mcp__codex__codex(` or `codex-reply(` — **with one deliberate exception**: `skills/test-review/references/codex-prompt-test-gen.md` was converted and then **reverted** to its MCP form. Its owner `codex-test-gen/SKILL.md` is item 5's, so converting the template alone left `/codex-test-gen` with no executable transport instruction at all; a doc reviewer reproduced the broken chain and named reverting as the correct resolution. It converts with its owner.
- [x] Every **converted** prompt template is body-only — the exception being the test-generation template named in the criterion above, which stays MCP-wrapped until its owner converts — and the conversion **preserved what each prompt asks Codex to do**: no instruction, question, ordering or severity rule changed as a side effect of removing the envelope.

  **The authoritative inventory of what changed is `git diff HEAD`, not this ticket.** Four drafts of this criterion tried to carry a complete change list and each was shown incomplete — by count, by category, or by both. A prose list cannot stay exhaustive against a diff, and pretending otherwise wasted four review rounds. What follows is therefore **notable changes with their reasons**, not a closed set.

  *Mechanical, from the conversion itself*: (a) de-escaping, since the escapes existed only to survive the JS template literal; (b) blank lines after headings, which markdown formatting requires outside a literal — this forced the `\n` → `\s+` relaxation in `scope-review-contract.test.js`; (c) JS ternaries replaced by `<!-- INCLUDE ONLY IF … -->` / `<!-- END conditional section -->`; (d) logical-OR defaults (`${LOCAL_CHECKS || 'Skipped (--no-tests)'}`, `${DISPOSITIONS || 'None'}`) reduced to bare placeholders with the default moved to the dispatcher (`codex-code-review/SKILL.md` § Step 3) — nothing evaluates an expression in a body-only file. **One rendered value changed with (d)**: the empty `LOCAL_CHECKS` case renders `Skipped` instead of `Skipped (--no-tests)`, because `--no-tests` is a flag that exists nowhere in this repository, so the old default documented an option nobody could pass.

  *Driven by review findings, in dispatched prompt bodies*: `codex-prompt-doc.md` and `review-loop-doc.md` each gained a `markdownlint-disable-next-line MD055 MD056` comment, because `${BATCH_MANIFEST}` expands into a table the linter cannot see from the template; and `codex-prompt-doc.md` § Output Format had the `## Document Review` header explanation **rewritten** — `HEAD` said a state hook parses it, which hook-lightweighting made false, so it now says nothing parses it and gives the real reason.

  *Driven by review findings, outside any dispatched body*: `codex-prompt-plan.md` lost the sentence that also carried the guarantee that `${PLAN_TEXT}` is the **redacted** Step 2 output and that high-confidence secret hits never reach the prompt — the guarantee still holds in `plan-review/SKILL.md` § Redaction, so nothing is broken, but its removal went unrecorded until a reviewer found it. `codex-research-instructions.md` gained a `## Variant: Plan Review` section (`codex-prompt-plan.md` cited a variant that did not exist) and had its opening description corrected. And **eight** `auto-loop-project.md` → `@rules/auto-loop-project.md` citation repairs landed across **six** files — `codex-code-review/SKILL.md` (2), `plan-review/SKILL.md` (2), `review-common.md`, `review-loop-doc.md`, `review-loop-plan.md` and `test-review/SKILL.md` (1 each); an earlier draft said three across three, having counted only one round's worth.
- [x] Every in-scope dispatch site reads "dispatch per `codex-transport.md` § Start" (first dispatch / rotation) or "§ Resume with the remembered `threadId`" and states nothing else about invocation
- [x] `review-common.md` § Thread Rotation and § Degradation Matrix carry the same thresholds, priorities and outcomes as before (the R-a **condition and threshold**, the carrier ordering and the priority-4 outcome are unchanged — the R-a row's own text did change, in the citation repair recorded above; the two carrier-label expectations in `review-loop-resilience.test.js` did change, `Codex MCP` → `Codex exec`, and the Related Files row records that with the third assertion edit)
- [x] Direct-owner frontmatters hold `Bash(node:*)`, Write, Read and no `mcp__codex__*` — with `plan-review` holding `Bash(node:*)` and Read but **no `Write`**, the exemption INV-007 records; `grep -l "Codex MCP"` over the in-scope `SKILL.md` files is empty; the in-scope thin entry points (`codex-review`, `codex-review-fast`, `codex-review-branch`, `codex-review-doc`, `codex-test-review`) are decided **here**, per file: a router that only invokes its parent skill loses its Codex grant and gains nothing; one that dispatches itself is a direct owner — the decision is recorded in Progress, and nothing is deferred to item 5
- [x] `rules/codex-invocation.md` § Loop review exception, as rewritten by item 2, still governs § Resume on the same thread and a rotated thread's first dispatch. **Scope amended 2026-09-04** during the doc-review loop, for the second time in this ticket and for the same kind of reason: the original clause added "this ticket changes nothing in that file", and two findings made that unachievable rather than strict. (a) The pointer paragraph claimed the transport is "the only place a command line appears", which is false of that file's own `git`/`grep` prompt examples — a literal overclaim, corrected in place. (b) `seek-verdict`'s Phase B packet is a **fresh** `§ Start` dispatch carrying the finding text and the diff, which § Prohibited patterns forbids outright; blind adjudication of a claim cannot omit the claim, so the file gains a **closed two-caller** § Verification dispatch exception, keyed to the blind-verdict protocol and authorizing `seek-verdict` plus `issue-analyze`, which independently implements the same act. A later round widened it from one caller after a reviewer showed the act-based scope governs `issue-analyze` while the exclusivity sentence denied it the exception it needs. § Loop review exception's core anti-anchoring paragraph is unchanged, but the section **did** gain a one-paragraph preface saying the verification rebuttal is governed solely by the two-row exception — recorded because an earlier draft of this line claimed the section was untouched
- [x] `review-dispatch.test.js` and `contract-routing.test.js` pass with **no assertion edited**. **Scope amended 2026-09-04, fourth amendment**: `test/skills/scope-review-contract.test.js` needed **two**, and an earlier draft of this line reported only the first. (i) It pinned `${DISPOSITIONS || 'None'}` — a JavaScript expression that only evaluated while the template lived inside a template literal. Stripping the envelope left it unevaluated and shippable to Codex as literal text, and a doc reviewer's words for the assertion were exact: it *preserved* the defect rather than detecting it. Keeping it byte-identical would have required keeping the bug. It now pins `${DISPOSITIONS}` plus `assert.doesNotMatch(common, /\$\{[A-Z_]+\s*\|\|/)`, and a derived guard in `codex-transport.test.js` extends the check to every body-only template. (ii) The Task-heading assertion relaxed `## Task \(frozen\)\n\$\{TASK_DESCRIPTION\}` to `\s+`, because markdown formatting puts a blank line after a heading once the text is no longer inside a template literal — the same transformation (b) the corrected AC above enumerates. Also: `review-loop-resilience.test.js` passes with its two `Codex MCP` label strings changed to `Codex exec` plus the one trigger assertion the Related Files amendment authorizes; Guard 2's allowlist no longer names any **converted** in-scope path — `codex-prompt-test-gen.md` is the one in-scope path still on it, by the deliberate exception above, and an earlier draft of this clause said "any in-scope path" without that qualifier
- [x] One `/codex-review-fast` and one `/codex-review-doc` run on this branch go through the adapter end to end (control record read, `threadId` reused on a re-review) — the gates of this ticket are its own acceptance. Far exceeded in practice: the doc plane alone ran three batches over ~10 rounds through `alloc → Write → start|resume → read → cleanup`, exercised R-a thread rotation five times with `[THREAD_ROTATED]` recorded, and produced two live **exit 2** refusals from operator error (a malformed `--thread-id`, and reusing a scratch directory a previous run had already created `report.md` in). Both behaved exactly as § Completion state machine specifies — configuration errors, **no** `codex_fail`, no fallback dispatched, no note written — which is the clause's own acceptance evidence
- [x] Pass `/codex-review-fast` → `/precommit` — code gate `✅ Ready gate_reason=NONE`; `/precommit` `## Overall: ✅ PASS` (lint:fix, build, 4413 tests / 4405 pass / 0 fail / 8 skipped)
- [x] Pass `/codex-review-doc` — `✅ Mergeable` on all three conversion batches and on the closing review of this record

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Inventory in spec § 2 (22 start-body files / 11 reply-body files, 15 reply occurrences, across all skills; this slice owns the review-family share); slice boundary fixed by § 5 item 3 |
| Development | Done | 27 `.md` surfaces converted. **Frontmatter decided per file, as this ticket's AC requires**: direct owners (`codex-code-review`, `doc-review`, `plan-review`, `test-review`, `seek-verdict`) hold `Bash(node:*)` + Write + Read; the five thin routers (`codex-review`, `codex-review-fast`, `codex-review-branch`, `codex-review-doc`, `codex-test-review`) dispatch nothing, so they lost the MCP grant and gained no transport grant — they keep exactly the non-transport grants they already had, which differ per router — `codex-review` also holds `Bash(yarn:*)` and `Bash(npm:*)`, `codex-review-fast` and `codex-review-branch` hold `Bash(git:*)` + `Bash(bash:*)`, and `codex-review-doc` and `codex-test-review` hold `Bash(git:*)` alone. `plan-review` is the one direct owner **without** `Write` (INV-007's user-approved exemption: plan mode withholds that tool before `ExitPlanMode`). Nothing was deferred to item 5 |
| Testing | Done | Full suite 4409 / 4401 pass / 0 fail / 8 skipped. New guards, each mutation-tested with the edit confirmed applied: the body-only expression scan (five shapes — `\|\|`, `??`, `&&`, `.trim()`, ternary — all caught, including one **inside a fence**, the case an earlier version missed); the adapter's stdin error path (removing it printed a raw `node:events` stack); and the prompt-delivery check (removing it emitted a full success record for a half-written prompt) |
| Acceptance | Done | Verdicts obtained: doc plane `✅ Mergeable` on three conversion batches and on the review of this record; code plane `✅ Ready gate_reason=NONE`; `/precommit` `## Overall: ✅ PASS`. Code and precommit were noted and their digests hold. **The doc plane is the one gate this row cannot assert closed at the moment of writing**, because writing this row is itself the change class's last edit — it moves the digest and re-opens the plane by design. The sequence is: this bookkeeping → one more `/codex-review-doc` over it → `review-state.js note doc_review pass`. An earlier draft claimed `owed=false` on every plane here, which a reviewer showed `check` contradicted at that instant, and always would |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 2, § 3.4, § 5 item 3
- Intent: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md)
- Parent contract: `skills/codex-code-review/references/review-common.md` § Review Loop
