# Codex Invocation Rule ⚠️ CRITICAL

**Codex must independently research. Never feed it your conclusions.**

Codex is a second pair of eyes, not a rubber stamp. Tell it the answer and ask "is this right?" and you have paid full price for agreement.

**How a prompt is carried is not this file's subject.** The transport — locator, files, the
`start` / `resume` command lines, exit codes, the completion state machine and the profile setting —
is owned by `skills/codex-code-review/references/codex-transport.md`, which is the authority on all
of it and the only place an operational Codex transport command line appears (this file's own `git`
and `grep` examples are prompt content, not transport). (Fallback-policy sites additionally name the one
trigger `codex_fail` = adapter exit 1, because a guard requires them to; that reference's opening
section says how the two fit together.) This file governs only what a prompt may contain.

## Which dispatches this file governs

**Review and verification dispatches**, and nothing else. Everything below — § Required, the
§ Prohibited patterns table, both exceptions — is about not anchoring a *reviewer*, which is what the
opening sentence says and what every row of that table is aimed at.

A **conversation** dispatch is a different act and is not governed here: `codex-implement` is given
the code it must change, `codex-explain` the code it must explain, `codex-brainstorm` the topic. Each
carries content *by construction* — `${CODE_CONTENT}`, `${TARGET_CONTENT}` and the rest — and each
would violate the table below on its first line if this file reached them. It does not, and that
boundary is stated here rather than left implicit: an earlier draft called those skills
"non-conflicting" (false — they do carry what the table forbids) and a later one called the question
"open", which left an operator unable to obey both this file and an executable skill contract in the
same tree. The prompt contract for a conversation dispatch is its own skill's.

The test is the **act, not the transport**: all of them travel over the same adapter. If a dispatch
asks Codex to *judge* something — a diff, a document, a plan, a finding — it is governed here.

**`codex-brainstorm` sits on both sides, and the caller decides which.** Open-ended brainstorming —
explore the space, argue to equilibrium — is a conversation and is excluded. But `feature-verify`
§ P5: Verdict and `necessity-audit` § Phase B invoke the same skill to obtain a **verdict** (an
integrated judgement over runtime results; `Keep|Review|Cut` over spec elements), and by the test
above those dispatches are governed. Classify by the **caller's act**, not by the skill's name. What
such a dispatch may carry is § Judgement-over-evidence exception below — it is not § Required's
metadata-only shape, and saying so here rather than leaving the two to collide is the point.

## Required in every first-dispatch prompt

A *review* first-dispatch prompt (§ Which dispatches this file governs). Give **metadata** (changed file list, diff stats, the task) and mandate exploration. Never paste the diff or the code itself — Codex has sandbox access and finds what you did not think to show it.

```
## ⚠️ Important: You must independently research the project ⚠️

### Git Exploration (Priority)
1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Read changed files to the end: `cat <changed file>` (chunk with `sed -n` when long)

### Project Research
- Search related code: `grep -r "keyword" src/ --include="*.ts" -l`
- Read related files: `cat <file-path> | head -100`
```

Review operations run read-only with approvals off — the transport pins both, so no call site chooses them (`codex-transport.md` § Start). Use the prompt template from `@skills/*/references/` rather than composing one ad hoc.

**A dispatch carries exactly three parts, and nothing migrates between them across rounds**:
(1) the **frozen task contract** — task description, frozen scope baseline, original ACs, and
`FOCUS` only if the *user or original task* supplied it, frozen at first dispatch (the dispatcher
never synthesizes or expands `FOCUS` from review findings — that is the cumulative-attack pattern
through a side door); (2) **current facts** — changed-file list, diff stats, local check results,
and on a same-thread reply the new diff plus currently valid dispositions (convergence state, not
attack directions); (3) the **fixed review contract** from the template. Old findings, reviewer
interpretations, and "we fixed X, now attack Y" belong to none of the three.

## Prohibited patterns

| Pattern | Example | Why it's wrong |
|---------|---------|---------------|
| Feeding full diff/content | `"## Git Diff \`\`\`diff … 2000 lines …\`\`\`"` | Burns tokens and hands Codex a truncated slice instead of full context |
| Feeding code | `"Here's the fix: \`\`\`code\`\`\` Is it correct?"` | Codex sees only what you showed; it cannot find what you missed |
| Feeding conclusion | `"Claude found the bug is in X, confirm?"` | Presupposes the answer — Codex will not challenge it |
| Leading question | `"I think the problem is caching, verify?"` | Anchors Codex to your hypothesis |
| Scope restriction | `"Only look at src/service/"` | Prevents discovery in related files, which is where the second opinion pays |
| Confirmation prompt | `"These fixes look good, right?"` | Invites agreement, not analysis |
| Cumulative attack list | Each re-dispatch or fallback dispatch appends prior findings or aims the reviewer at named tests/guards/mutations | Feeding attack directions is feeding conclusions in mirror image — review depth grows round over round. Every first, fallback, and rotated dispatch is the fixed template plus current task metadata; dispatcher-authored attack programmes stay out |

The shared shape: every one of these narrows what Codex can find to what you already believe. If the prompt could not possibly produce a finding that surprises you, it is not a review.

## Judgement-over-evidence exception

§ Required's metadata-only rule assumes the reviewer can go and find the subject itself. A
**judgement-over-evidence** dispatch has no such subject in the tree: `feature-verify` asks for a
verdict over runtime observations that exist only in that run, and `necessity-audit` over spec
elements it has already extracted. Handing those over is not anchoring — it is the question.

So for these two dispatches, and no others: the payload is the artifact under judgement plus the
objective evidence about it (the run's own P1/P3/P4 records; the spec elements), and § Required's
"never paste the content" rows do not apply to that artifact. Everything else in § Prohibited
patterns does, and the conclusion rows apply with full force: no dispatcher verdict, no preferred
answer, no confirmation prompt, no list of directions to attack. Ask what verdict the evidence
supports, never whether Codex agrees with yours.

## Verification dispatch exception

**A blind-verdict dispatch is governed by this file and cannot obey it unmodified**, which is why the
exception exists rather than an exclusion. It adjudicates a claim, so § Which dispatches this file
governs puts it squarely here; and blind verification of a claim is impossible without stating the
claim, so its packet must carry `${ORIGINAL_FINDING_TEXT}` and `${RELEVANT_DIFF}` — which
§ Prohibited patterns would otherwise forbid outright.

**Authorized callers of the blind-verdict protocol** — a closed list, because the exception is keyed
to the protocol rather than to one skill's name: `skills/seek-verdict/` (which defines it) and
`skills/issue-analyze/` (which implements the same act on an issue or review-comment claim). A skill
not on this list that finds itself needing the exception is telling you it should be invoking
`/seek-verdict` instead; adding a third caller is a change to this list, made here.

**Two dispatches are covered, and no more.** `seek-verdict` uses both rows — the fresh dispatch and
its one rebuttal — and covering only the first would leave the second unexecutable; `issue-analyze`
uses the fresh-dispatch row alone:

| Covered | What it may carry |
|---|---|
| Phase B, fresh thread (`§ Start`) | The finding under review and the relevant diff |
| The **one** `§ Resume` rebuttal (`skills/seek-verdict/SKILL.md` § Rebuttal) | Objective counter-evidence, and a request to reconsider the verdict it already gave |

The boundary is what keeps this honest: the packet presents the finding as a **claim to be
adjudicated, never a conclusion to confirm**; the rebuttal carries evidence that can be checked, not
attack directions or a list of guards to aim at; the reviewer must reach `NON_ACTIONABLE`
independently; and `skills/seek-verdict/references/policy-mapping.md`'s confidence and evidence
thresholds, not the verdict alone, decide whether anything closes. The rebuttal is **one round** —
that cap is what stops this from becoming the cumulative-attack pattern § Prohibited patterns bans.
Only the authorized callers listed above may cite this exception, and no review dispatch may cite it at all.

## Loop review exception

This section governs **review** loops. The verification rebuttal above is also a § Resume dispatch
but is governed solely by that two-row exception: it inherits none of the fix-verification or
"did the fixes introduce new issues?" payload below.

For a `codex-transport.md` § Resume dispatch continuing **the same thread**, providing the new diff is fine — Codex already has project context from the first pass **on that thread**; the exception is scoped to the thread, never to the task. After a thread rotation (`skills/codex-code-review/references/review-common.md` § Review Loop), the new thread's first dispatch is a **first dispatch**: the full contract above applies again in whole — metadata only, mandated exploration, no diff or conclusions pasted — with the frozen scope baseline riding as metadata the contract already allows. Old-thread findings and dispositions never enter the new prompt; they are reconciled orchestration-side after the fresh report. Within a thread, still: give the diff, not your reading of it; ask it to *verify* the fixes, not confirm them; and always include "Did the fixes introduce new issues?"
