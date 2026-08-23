---
name: doc-review
description: "Document review via Codex MCP. Use when: reviewing .md docs, tech spec audit, document quality check. Not for: code review (use codex-code-review), test review (use test-review). Output: 5-dimension rating table + gate."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(node:*), Read, Grep, Glob, Task
context: fork
agent: Explore
---

# Document Review Skill

## Trigger

- Keywords: review doc, document review, tech spec review, review-spec, doc-refactor, streamline doc

## When NOT to Use

- Code review (use `codex-code-review`)
- Test coverage review (use `test-review`)
- Just want to read a document (use Read directly)

## Commands

| Command             | Description            | Use Case          |
| ------------------- | ---------------------- | ----------------- |
| `/codex-review-doc` | Codex reviews .md docs | Document changes  |
| `/review-spec`      | Review tech spec       | Spec confirmation |
| `/doc-refactor`     | Streamline documents   | Doc too long      |
| `/update-docs`      | Research & update docs | After code change |

## Workflow: `/codex-review-doc`

```
Target set → Deterministic checks → Resolve profiles + batches → Codex review per batch → Rating table + Gate → Loop
```

**All changed `.md` in one change are one review plan.** The plan is the unit; it holds one or more
physical batches, and within the budget it is exactly one batch and therefore one dispatch. Reviewing
file-by-file is what this workflow replaced — it multiplied a three-file change into three whole-
document reviews.

### Step 1: Determine the Target Set

| Condition | Action |
|-----------|--------|
| Paths specified | Use them — all of them, as one plan |
| No path | `git diff --name-only HEAD` and untracked, filtered to `.md` |
| Nothing changed | Report it and stop; there is no document to review |

Never narrow a multi-file change to one file, and never ask the user to pick one. A file the plan
drops is a file nothing reviewed.

### Step 2: Deterministic Checks First

```bash
node scripts/check-doc-links.js --root "$(git rev-parse --show-toplevel)" <changed .md paths>
```

Resolves the repo-local **file links** it can classify, prints the ones that do not resolve, and
prints `unresolved` — how many link shapes it declined to classify. **Heading fragments are out of
scope**: `[x](#frag)` is dropped uncounted the way an external URL is, and `[x](./a.md#frag)` is
checked as a link to `a.md` alone. A dead `#fragment` is therefore not a finding this step
establishes, and the reviewer is free to raise one.

**Scan only the paths that exist in the working tree.** A deleted `.md` (the resolver reports it
`deleted: true`) is **omitted from this scan** — passing it produces an `unreadable` failure that
hands the reviewer a defect when the deletion *is* the change. Its review copy is
`git show HEAD:<path>`, and the prompt says so per file.

`Bash(node:*)` and `Task` are in `allowed-tools` since review-loop-resilience (2026-08-23): the
fallback dispatch below names `scripts/lib/review-dispatch.js` and `scripts/validate-family-sentinel.js`
as steps of this workflow, and a named step should not stall on a permission prompt mid-review. The
earlier deliberate omission protected against *unnamed* `node` invocations riding a review's grant;
the boundary is now behavioural — this workflow invokes `node` only for the scripts its steps name
(the link check, the profile resolver, the dispatch decision, the sentinel validator, the state note).
**Advisory input, not a gate**: it always exits 0, and its output is fed to the reviewer as
*findings already established* so the LLM does not spend a pass rediscovering them. `markdownlint`
does not resolve links, so nothing else answers this.

**Pass both fields to the prompt, and never `failures` alone.** It is a scanner, not a CommonMark
parser — this repository ships zero dependencies — so `failures: []` settles the link question only
alongside `unresolved: 0`. With `unresolved > 0` that many link shapes went unchecked, and saying
"already settled" over them is the one way this advisory input can cost a review rather than save
one.

### Step 3: Resolve Profiles and Batches

```bash
node scripts/resolve-review-profile.js --tier <effective tier> --files <a.md,b.md> --root "$(git rev-parse --show-toplevel)"
```

Emits a per-file profile with the reasons it is not shallower, plus the batch plan. Richer inputs —
the `##` sections a shallow profile is confined to, and whether code landed with the change — go in
via `--plan <file|->`, a JSON document of the same shape the resolver prints:

```json
{ "tier": "standard", "code_changed": false,
  "files": [ { "path": "docs/features/x/2-tech-spec.md",
               "profile": "living-sync", "sections": ["3. Design"] } ] }
```

Three things this step decides, and none of them is negotiable afterwards:

- **The profile is resolved before the prompt is built.** A shallow prompt for a change that did not
  earn one is never assembled, so there is no mismatch to detect afterwards and nothing to poison.
- **Escalation is one-way and per file.** One file escalating raises that file's questions and the
  batch's shared dimensions; it never withdraws another file's `record-diff` exemption.
- **An over-budget plan splits loudly.** Say which batches were produced and why, then dispatch each.
  Never claim one dispatch you did not make, and never drop a file to fit.

### Step 4: Codex Review, One Dispatch Per Batch

**First review**: `mcp__codex__codex` with the doc review prompt. See `references/codex-prompt-doc.md`.

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

**Save the returned `threadId`** — one per batch.

**Loop review**: `mcp__codex__codex-reply` with the re-review template. See `references/review-loop-doc.md` — its Loop Rules carry the thread-rotation clause (central contract).

**Codex unavailable → fallback carries the gate** (`@rules/auto-loop.md` § Review Dispatch): decide via `scripts/lib/review-dispatch.js` (`contract:'doc'`), record `[REVIEWER_FALLBACK] plane=doc_review from=codex to=contract-neutral-reviewer reason=<…> | <ISO8601>` (sticky for this change), dispatch `contract-neutral-reviewer` via Task with `references/codex-prompt-doc.md` as the governing template — batch manifest, profiles and frozen file list included (P3 = one retry on a fresh instance) — and validate the raw report with `node scripts/validate-family-sentinel.js doc` before adopting the verdict (exactly one of `✅ Mergeable` / `⛔ Needs revision`, no foreign terminal). Fallback agents are stateless, so each loop round is a fresh dispatch. Carriers exhausted → no gate sentinel, behaviour-layer `⚠️ Need Human`, nothing noted.

Stop `cat`-ing whole existing files into the prompt. Codex has sandbox access; the prompt carries the
file list, each file's profile, and what that profile says to read.

### Step 5: Consolidate Output

Organize results into rating table + severity-grouped findings + gate. One gate for the plan: a batch
that comes back `⛔ Needs revision` blocks the plan.

**The conjunction is behaviour-layer, and the state slot cannot hold it.** The reminder state
(hook-lightweighting § 3.2) stores one `doc_review` note and a later note overwrites it — last
write wins, whatever an earlier batch said. Hold the conjunction yourself: fix and re-dispatch
every blocked batch (`references/review-loop-doc.md` § Loop Rules), and call the plan Mergeable
only when the **latest** dispatch of every batch passed — never because the final dispatch
happened to. Then self-note the plan's verdict once, not per batch:

```bash
CHECKER=".claude/scripts/review-state.js"; [ -f "$CHECKER" ] || CHECKER="scripts/review-state.js"
node "$CHECKER" note doc_review pass   # every batch's latest dispatch passed
node "$CHECKER" note doc_review fail   # any batch still blocked — increments the rounds count
```

The note is the declared-provenance record the reminder hooks read; it is advisory, binds to the
current tree digest (a later `.md` edit re-opens the plane by construction), and a failed note
never fails the review — the cost is one redundant reminder line.

## Review Profiles

Resolved by `scripts/resolve-review-profile.js`, never chosen by hand at dispatch time.

| Profile | Used when | Reviewer reads | Questions |
|---------|-----------|----------------|-----------|
| `full-design` | Design landing pre-implementation; unknown classification; security / data-integrity; any escalation | Whole changed document + linked design context | All five dimensions |
| `implementation-sync` | Current-authority doc updated after code landed | Changed hunks + enclosing `##` sections + preamble + link definitions | Does any reviewed section contradict the implementation? Is any affected cross-reference dead? |
| `living-sync` | Current-authority doc, doc-only edit | Changed sections | Accuracy and internal consistency |
| `record-diff` | Design / work / history record | Changed hunks | Is the edit internally coherent and correctly marked as a record? **No code-alignment obligation** |
| `executable` | Instruction surfaces (`skills/**`, `rules/**`) | Changed sections + the file's own contract | Does the instruction still execute? Any conflicting directive? |

New (untracked) files are read whole under any profile — every line is new.

The profile narrows what the reviewer **reads**, never **whether** review runs, and no resolver
outcome auto-passes anything (Anchor Register #5, #6). Contract and escalation table:
`docs/features/doc-review-phasing/2-tech-spec.md` § 3.3–3.4.

## Review Dimensions

| Dimension           | Checks |
| ------------------- | ------ |
| Architecture Design | System boundaries, responsibilities, dependencies, extensibility |
| Performance         | Bottlenecks, concurrency, caching, resource usage |
| Security            | Data leakage, access control, input validation, error handling |
| Documentation Quality | Structure, completeness, accuracy, examples, docs-writing standards |
| Code Consistency    | Pseudocode matches codebase, referenced files exist, technical accuracy |

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

⛔ Needs revision → fix 🔴 items → `/codex-review-doc --continue <threadId>` → repeat until ✅ Mergeable.

The round budget is the tier's cap (`fast` — docs are the tier's primary case — caps at 6; an
explicit `## Max Rounds` in `rules/auto-loop-project.md` overrides it, per `rules/auto-loop.md`
§ Tiers). Still failing at the cap → report blocker.

**🔴 only.** 🟡 and ⚪ are non-blocking: log them and proceed.

```
[NIT_DEFERRED] file:line | issue | reason: sub-threshold-doc | <ISO8601>
```

That tag and field order are a **reporting convention** — nothing parses or persists the line
(hook-lightweighting § 3.3: the nit-history store retired with the hook that owned it). The durable
record is the review report and the conversation, where the line is greppable; keep the fixed field
order for exactly that grep. `references/codex-prompt-doc.md` asks Codex for a `### Deferred
Findings` section so the report itself carries the deferrals.

Do not batch-fix 🟡/⚪ and re-review to confirm — that spends a round on findings the gate already declared non-blocking. The two exceptions are the same as for code (`@rules/auto-loop.md` § Sub-Threshold Findings): a one-line fix in a file already open, and a mis-marked security / data-integrity issue that should have been 🔴.

What counts as 🔴 is pinned in `references/codex-prompt-doc.md § Severity Calibration` — it is the reviewer prompt, not this file, that keeps the loop short.

## Verification

- [ ] Each issue tagged with severity (🔴/🟡/⚪)
- [ ] Gate is clear (✅ Mergeable / ⛔ Needs revision)
- [ ] Codex verified code-documentation consistency independently

## Required Actions

| Change Type | Must Execute                          |
| ----------- | ------------------------------------- |
| `.md` docs  | `/codex-review-doc` or `/review-spec` |
| Tech spec   | `/review-spec`                        |
| README      | `/codex-review-doc`                   |

## References

- Doc review prompt: `references/codex-prompt-doc.md`
- Review loop: `references/review-loop-doc.md`
- Profile resolver: `scripts/resolve-review-profile.js` — profiles, escalation, batch plan
- Link checker: `scripts/check-doc-links.js` — advisory deterministic input. Reports `failures`
  **and** `unresolved`: it is a scanner, not a CommonMark parser, and `failures: []` settles the
  link question only when `unresolved` is 0
- Standards: @rules/docs-writing.md

## Examples

```
Input: /codex-review-doc docs/features/xxx/2-tech-spec.md
Action: Link check → resolve profile → Codex doc prompt scoped to the changed sections → Rating table + Findings + Gate

Input: /codex-review-doc
Action: Collect every changed .md → link check → one plan, one batch, one dispatch → Rating table + Gate

Input: /codex-review-doc (a 25-file feature folder)
Action: Resolver splits the plan loudly into batches, each within budget → one dispatch per batch → one consolidated gate

Input: Review this tech spec for me
Action: /review-spec → Check completeness/feasibility/risks → Output Gate

Input: This document is too long, streamline it
Action: /doc-refactor → Tabularize + Mermaid → Output comparison
```
