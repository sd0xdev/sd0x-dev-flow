# Doc Review Phasing — Tech Spec

> **Doc role**: Design record
> **Status**: Draft (design converged; see § Provenance)
> **Current behavior authority**: No — until Step 4 creates `4-implementation.md`, the only current authority for this feature is the code and `rules/` themselves
> **Scope**: doc-plane review cost — artifact authority classification, review profiles, deterministic pre-dispatch resolution, upfront-gate repair

## 1. Problem

The doc plane burns review rounds out of proportion to what changed. A 3-line edit to a
500-line document triggers a whole-document, five-dimension review; each fix re-opens the
gate and the next round re-reads the whole file. Measured state of the corpus **at commit
`3744d58`**, read from the commit rather than from the worktree — `git ls-tree -r --name-only
3744d58 -- docs | grep '\.md$'`, then `git show 3744d58:<path> | wc -l` per file. (`git
ls-files` would answer for the index, which by then already carried this feature's own edits.)
"Markdown-only" means a commit **every** one of whose changed paths ends in `.md`, anywhere in
the repo and not only under `docs/` — counted in one pass, `--root` included so the initial
commit is not silently dropped:

```bash
git log --no-merges --format='%H' --name-only --root 3744d58 | awk '
/^[0-9a-f]{40}$/ { if (n>0) { tot++; if (md==n) allmd++ }; n=0; md=0; next }
NF==0 { next } { n++; if ($0 ~ /\.md$/) md++ }
END { if (n>0) { tot++; if (md==n) allmd++ }; print allmd, "of", tot }'
```

| Metric | Value |
|--------|-------|
| `docs/**/*.md` | 255 files / 45,904 lines |
| Tech specs (`2-tech-spec*.md`) | 59 files / 22,518 lines (49.1% of corpus; median 397 lines) |
| Request docs | 143 files / 12,027 lines (26.2%) |
| Closed-but-unarchived requests | 61 files / 4,845 lines (only 3 requests actually archived) |
| Feature docs added / deleted over 488 commits | 241 / 0 |
| Markdown-only commits | 209 of 488 (43%); a further 142 touch `.md` alongside code (351 in total) |
| Doc-plane round counter | does not exist (`current_round` is code-only, `post-tool-review-state.sh` §_update_iteration) |

## 2. Root Causes (ranked)

> **This section is the diagnosis baseline at `3744d58`, not a description of the current
> tree.** Step 1 of § 4 has since landed in this working tree, so the first half of cause 5
> and the `/review-spec` paragraph below are already repaired. Line numbers are quoted
> `@ 3744d58` where the file has moved since; read them against that commit.

| # | Cause | Evidence |
|---|-------|----------|
| 1 | **Every document is treated as a living document owing perpetual code alignment** — a frozen design record and a live behaviour reference are reviewed under the same obligation | `skills/doc-review/references/codex-prompt-doc.md` (5 fixed dimensions for every target); no classification consulted anywhere on the review path |
| 2 | **Role-blind reviewer attention** — every doc review reads the full file and rates 5 dimensions (Architecture / Performance / Security / Quality / Consistency), even post-implementation sync where the design was already reviewed on the code plane | `skills/doc-review/SKILL.md` Step 2 (whole-file read); `codex-prompt-doc.md:21` ("Read the full document") |
| 3 | **Undifferentiated authority space** — closed requests, review logs and live specs share one namespace; `doc-classifier.js` already excludes `requests/`+`archived/` from the canonical map but `/codex-review-doc` never consults it, and `canonical_docs` still hands a frozen tech spec to research consumers as though it described current behaviour | `scripts/lib/doc-classifier.js:206` `pickCanonicalDocs`; consumers `skills/ask/SKILL.md:84`, `skills/runbook/SKILL.md:128`, `skills/feasibility-study/SKILL.md:39` |
| 4 | **Unscoped global receipt** — `/codex-review-doc` is single-target; `feature-dev` Doc Sync runs it *per updated file*; a pass writes one boolean with no record of which files were covered | `skills/feature-dev/SKILL.md` § Doc Sync; `doc_review.passed` in the state schema |
| 5 | **No upfront gate actually fires** — the design-time review that would prevent late churn is either unrecordable or switched off | `/review-spec` verdict is unparseable (below); `rules/auto-loop-project.md:40` `## Plan Review` is commented out |
| 6 | **No write-time budget and no prune step** — tech specs are routinely produced near 400 lines; completed requests stay live; 241 feature docs added, 0 deleted | corpus distribution above |

At `3744d58`, `/review-spec` emitted `✅ Approved / ⚠️ Needs revision / ❌ Needs redesign`
(`skills/review-spec/SKILL.md:67 @ 3744d58`), while the hook's doc-plane parser
(`_mcp_doc_review_passed`, `_skill_output_has_verdict`) recognized only `✅ Mergeable` /
`⛔ Needs revision`. Every documented `/review-spec` outcome — pass **or** fail — recorded
**no verdict at all**; the one test that passed did so by feeding the undocumented
`✅ Mergeable` sentinel. It was also an `Agent` dispatch, invisible to dispatch accounting.
Step 1 converted it to the shared MCP path and pinned both directions.

### Why `/refactor` is not the lever

| Layer | Fact |
|-------|------|
| Signal | `DOC_TOO_LONG` is reachable only via the Cap Diagnostic Protocol, whose three triggers all read the code-only round counter — a doc-only loop never fires it (structurally zero, not "low probability") |
| Tool | For `.md`, `/refactor` dispatches `/doc-refactor`, which **condenses**; `rules/docs-numbering.md` prescribes **splitting** and states no skill performs it |
| Cost | Refactor edits files → gates re-open → up to 3 internal doc rounds per target; `--auto` can select 10 targets |

## 3. Design — Classify the artifact, declare the intent, resolve deterministically

No new gate. The existing `doc_review` plane, receipt and sentinel pair
(`✅ Mergeable` / `⛔ Needs revision`) are unchanged. Three layers decide **how deep** a
review runs and **what the reviewer reads** — never *whether* it runs.

| Layer | Answers | Owned by |
|-------|---------|----------|
| **Artifact classification** | What is this document, and does it owe code alignment at all? | `scripts/lib/doc-metadata.js` — path defaults + optional in-document metadata |
| **Producer intent** | Why is this review happening — design landing, post-implementation sync, record edit? | the dispatching skill, as a named review profile |
| **Deterministic resolution** | Is the requested profile supported by the evidence? | `scripts/resolve-review-profile.js`, run **before** the prompt is assembled |

### 3.1 Artifact classification (zero migration)

Four roles, closed set: `Current authority` · `Design record` · `Work record` ·
`History record`. Resolution mirrors `scripts/lib/request-status.js` — **defined
negatively and failing toward the deeper obligation**: a document is exempt from code
alignment only when it resolves to a non-authority role; anything unrecognised resolves to
`Current authority`, which owes the fullest review.

Precedence, as `resolveDocRole` actually applies it — the order matters, because two of these
steps are not "metadata beats path" and reading it that way gets the answer wrong:

| # | Condition | Result |
|---|-----------|--------|
| 0 | Either configured key is unusable | `Current authority` — nothing in this document is readable, see below |
| 1 | Authority `Yes` | `Current authority` — a promotion wins over `Doc role`, over `No`, and over the path |
| 1b | A `Doc role` line present but **unreadable** | `Current authority` — and step 4 cannot demote it |
| 2 | `Doc role: <exact member of the closed set>` | that role |
| 3 | Path default | the table below, then `Current authority` |
| 4 | Authority `No`, applied **last** | demotes a `Current authority` result **reached by step 2 or 3** to `History record`, and nothing else |

Step 1b is the one that had to be corrected during review, and the correction is the whole design
in miniature. Falling through to the path default looked like the conservative choice and is the
opposite: a tech spec's path default is `Design record`, so a garbled declaration bought a
*shallower* obligation than writing none. Unreadable means any of — annotated value, unknown
value, empty value, two different roles, one good line beside one bad, or a line naming the key
while missing the grammar (`> **Doc role** Work record`, one asterisk, an unclosed bold run, the
combined omission `> **Doc role Work record`). All of them cost the document the deepest role.

The last of those forced a second correction, on the opposite side. A misplaced *closing* delimiter
— `> **Doc role Work record**:` — parses as a perfectly well-formed declaration of a key named
`Doc role Work record`, and skipping other keys' lines is exactly what keeps a configured key of
`Doc role` from reading `> **Status**: Draft` as garbled. So the rule is narrower than "skip other
keys": a bold phrase that **begins with the configured key plus a boundary** is ambiguous, counts as
a mention, and fails closed. The cost is a genuine key of the form `<our key><space>…` being read as
a garbled declaration of ours — which buys a deeper review, the side to be wrong on. `Doc roleplay`
is unaffected: no boundary follows the key, so it is simply another key.

And `No` cannot then demote it: `No` withdraws an
authority *claim*, and a garbled role line makes no claim to withdraw — otherwise an unreadable
line plus `No` would be a full exemption bought with a typo.

The **authority** line is deliberately not symmetric: a malformed one falls through. An unreadable
`No` that falls through *refuses* an exemption, and the annotated `No — until Step 4 lands` in this
document's own preamble is the documented behaviour the corpus relies on. Only an unreadable `Yes`
loses anything, and what it loses is a promotion to a deeper review its author asked for.

Step 4 is the one that surprises: `No` on a document the path calls a tech spec leaves it a
`Design record`, not a `History record`, because `No` withdraws an authority claim rather than
assigning a category. The reason it must work that way is clearest on a different artifact: a
request ticket carrying `No` would leave `work_records` if `No` re-categorised, and an open
ticket would vanish from the consumer looking for one — so `No` is defined to demote only what
was claiming authority in the first place.

Path defaults — chosen so the change is **code-only and behaves correctly on day one across all
245 documents the source sets cover, with no migration**. 245 is the union of the four sets over
the 82 feature directories, not every `.md` in the repo — there are 533 of those, and the ones
outside `docs/features/` are not classified by this pass:

| Path | Default role | Current behaviour authority |
|------|--------------|------------------------------|
| `docs/features/*/requests/**` | Work record | No |
| `docs/features/**/review-log-*.md`, `adr-*.md` | History record | No |
| `docs/features/**/{0-feasibility-study,1-requirements,2-tech-spec,3-architecture}*` | Design record | No |
| `docs/features/**/4-implementation*` | Current authority | Yes |
| `skills/**`, `rules/**`, `agents/**`, `commands/**` | Current authority (instruction surface) | Yes |
| everything else under `docs/`, `README*` | Current authority | Yes (fail-closed) |

Explicit metadata overrides the default **in both directions** — a tech spec that really is
the living behaviour reference declares it and is reviewed as one. Format is a
top-of-document blockquote, not YAML front matter: measured over the 59 tech specs, 4 carry
any status line and **zero** carry a machine-readable `lifecycle:`/`maintenance:` key, so
front matter would be a format nothing in the corpus uses. The blockquote form is already
what `request-status.js` parses (`> **Status**: …`), so one parser shape covers both.

```markdown
> **Doc role**: Design record
> **Status**: Accepted
> **Current behavior authority**: No
```

Exact-match-after-trim discipline as in `request-status.js`; an annotated value
(`Design record (mostly)`) does not match. It does **not** fall through to the path default — a
role line that is present but unreadable is step 1b above: it resolves to `Current authority`, and
step 4's `No` cannot demote it. Falling through is what made a typo cheaper than silence.

**Where it is read is part of the format.** Not "anywhere in the first 30 lines" — the
metadata is the *contiguous run* of `> **Key**: value` lines at the very top, after optional
blank lines and at most one ATX heading (up to three leading spaces, as CommonMark allows).
The first line that is not metadata-shaped ends it, and nothing below is read; the 30-line
window is the ceiling on how far that run may reach, not a search area. This is what makes a
quoted example unreachable without classifying Markdown constructs: an illustration sits
below whatever introduces it. Implementation and the rounds behind it: `doc-metadata.js`
§ `_headWindow`.

**The key names are configurable; an unusable one refuses rather than degrades.** `metadata.role_key`
and `metadata.authority_key` are matched literally on punctuation and case-insensitively on the
key text; `metadata.head_lines` is configurable too, validated as a positive safe integer (anything
else — `0.5`, `-5`, `Infinity`, a string — falls back to 30, because a window that keeps zero lines
would hide a first-line promotion). A key that cannot be written on one metadata line — containing
`**`, ending in `*`, holding a line terminator, empty, or not a string at all — is refused, and
**an unset key is not an unusable one**: it means the documented default. The refusal fails **the
whole document** to `Current authority`,
path defaults included. Two milder policies were tried and both leave the same hole: matching
nothing, and substituting the built-in key, each silently drop every promotion written the
configured way, and the second additionally re-enables a key the repo was trying to replace.
An unusable key means declarations cannot be read at all, and an unreadable declaration cannot be
the basis of an exemption. The failure is loud by construction — every document lands in
`current_authority` until the config is fixed. An *unset* key is not a broken one: it means the
documented default.

Two consequences the format buys, both deliberate:

| Consequence | Direction | Mitigation |
|---|---|---|
| A declaration below the preamble is ignored, **including** a `Yes` promotion — so a placement error can also make review too shallow | Either | Put it at the top; that is the whole contract |
| A raw metadata template at the top *is* a declaration — a blockquote is both the syntax and the way to display it, so the two are not decidable apart | Too shallow | Show templates inside a fence, as every document here already does. Measured over `find docs skills rules agents -name '*.md'` (533 files) exactly one parses as declaring metadata, and it is this file |

### 3.2 Authority-aware source sets

`pickCanonicalDocs` currently answers one question — "which file is the tech spec" — and
every research consumer reads that as "which file describes the system". Splitting the
output makes the tombstone **mechanical** rather than a banner a reader may ignore:

Each set holds the **same classified entry objects** `doc_inventory` holds — `{ file, type,
namespace, confidence, is_canonical, role }`, with `file` relative to the feature directory — not
bare paths. The four sets partition by resolved `role`, so an entry appears in exactly one set and
nothing is dropped. What they partition is **not** `doc_inventory`: `scanFeatureDocs` calls
`partitionByRole([...inventory, ...requestItems])`, because the inventory keeps its pre-existing
meaning and excludes `requests/` by path while the role sets cover it. So the union of the four sets
is a **superset** of `doc_inventory` — strictly larger whenever the feature has request tickets —
and `doc_inventory.length` is not the corpus size. § 3.2's counts are the union.

The "typically" in the table below is load-bearing: these are the **path defaults**, not the
contents. Membership follows the resolved role, so any document can move — a request declaring
`Current behavior authority: Yes` lands in `current_authority`, and a document whose filename
matches no whitelist entry lands there too, fail-closed.

| Source set | Typically | Answers |
|------------|-----------|---------|
| `current_authority` | `4-implementation*`, docs explicitly marked authoritative, **and everything unrecognised** | "what does the system do now", once the consumer adds code and `rules/` |
| `design_records` | tech specs, architecture, feasibility, requirements | "why was it built this way" |
| `work_records` | `requests/**` | "what was asked for, and is it still open" |
| `history_records` | review logs, ADRs | "what was decided, when" |

A consumer that needs *all* request tickets therefore reads `requests/**` by path, not
`work_records` by set — the set answers "which documents are work records", and an explicitly
reclassified ticket is not one.

`canonical_docs` is retained as a deprecated alias so nothing that still reads it breaks. An earlier
draft of this paragraph said "eight existing consumers" and named seven; the number was not derived
from anything, so here is the enumeration instead, with its command. **At baseline commit
`3744d58`**, `git grep -ln canonical_docs 3744d58 -- scripts/ skills/` returns **12 files**:

| Role | Files |
|------|-------|
| Produces it | `scripts/lib/doc-classifier.js` |
| Reads it, derives `has_*` from it, forwards it | `scripts/lib/feature-resolver.js` |
| Forwards it | `scripts/classify-docs-cli.js` |
| Reads it to select a file | `scripts/lib/fc-extractor.js` (`canonicalDocs.requirements`, `canonicalDocs.tech_spec`) |
| Writes a **same-named** snapshot field | `scripts/lib/fc-aggregator.js` — `source_of_truth.canonical_docs` is an already-reduced `sources` object, not the resolver's property. The name collision is why an earlier draft of this table listed it as a reader |
| Instruction surfaces reading it | `/ask`, `/feasibility-study`, `/runbook`, `/tech-brief` + its `references/source-guide.md`, and **both** copies of `feature-context-resolution.md` |

"Mentions it" and "chooses a document with it" are different questions and grep answers only the
first — which is exactly why the old bare count could not be checked, and why the split above is
made by reading each site rather than by counting hits.

That table is **historical**, and r2's point is that the **research** consumers on its bottom row
fall: `/ask`, `/runbook`, `/feasibility-study` and `/tech-brief` now read the source sets. The row
does not fall entirely — `skills/create-request/references/feature-context-resolution.md` § Cross-Link
Invariants still resolves *filenames* through `canonical_docs.<role>.file`, which is a legitimate
legacy use: picking a filename is not picking an authority, and the alias is still the map from role
to canonical filename. In code nothing moved: `fc-extractor.js` remains the reader and
`fc-aggregator.js` the downstream snapshot writer. Neither migration is attempted here.

The alias itself is selected from `doc_inventory`, **unchanged from before the split**. Computing it from
`current_authority` + `design_records` was tried first and is wrong for a reason worth recording:
a canonical-role document that declares itself `History record` or `Work record` leaves both sets,
so the alias — and the legacy `has_tech_spec` derived from it — would flip to null/false on a file
still sitting in the inventory. An alias that changes answers is not an alias.

#### `scan_error` — empty is not the same as unknown

Four empty sets answer two different questions: "this feature has no such documents" and "the
corpus could not be enumerated". A consumer picking review depth from `current_authority` cannot
tell them apart, and the wrong reading — an unreadable directory taken as "nothing owes alignment"
— is fail-open. `scan_error` is on every branch of the resolver and every exit of the CLI, `true`
whenever enumeration failed: an unreadable feature or `requests/` directory, a broken taxonomy, or
no git repository. Confirmed absence leaves it `false`. The resolver still does not throw — a throw would leave the
caller with whatever its own shell fallback produced, which is the shapeless `{}` this payload
contract exists to replace — so the failure is reported in the result instead. Callers reach it
through `scripts/resolve-feature.js`, which owns that fallback centrally and emits the full shape
with `scan_error: true`; writing a per-caller `|| echo '{}'` is what the wrapper removes. The
entrypoint is Node rather than shell for a permissions reason, not a stylistic one: the four
research skills that had to migrate (`/adr`, `/ask`, `/runbook`, `/tech-brief`) grant `Bash(node:*)`
and not `Bash(bash:*)`, so a shell-only entrypoint would have forced them to either widen their tool
surface or carry an exemption — and the first migration attempt shipped instructions those skills
were not permitted to run. Neither permission is universal in the other direction either:
`/codex-code-review` grants `Bash(bash:*)` and **no** node permission at all, so
`scripts/resolve-feature.sh` is a live entrypoint, not a vestige — a shim that `exec`s the same
file and holds no logic, serving `!` context blocks and the bash-granting callers. The invariant is
that a skill names the entrypoint **it is permitted to run**, asserted per command line in
`test/skills/scan-error-gate.test.js`.

The failure payload's shape lives in `scripts/lib/context-shape.js`, a module that requires
nothing. The wrapper first imported it from `feature-resolver`, which transitively loads
`doc-classifier`, the taxonomy loader and the metadata parser — so a load-time error anywhere in
that graph killed the wrapper before `main()` ran (exit 1, no JSON, no `scan_error`), putting the
wrapper inside the blast radius of the failures it exists to report. The wrapper also validates the
child's stdout **structurally** before passing it through: parseable is not usable, since `7`, `[]`
and `{"scan_error":false}` all parse and none of them survives `payload.design_records.map(...)`.

Two more decisions in that file, recorded here rather than in its header. **Captured, not
streamed**: `node cli || echo '<fallback>'` emits *both* documents when the CLI writes part of one
and then dies — the partial stdout is on the wire before the fallback fires, so the consumer gets
two concatenated documents and `JSON.parse` throws before any gate can read `scan_error`.
`spawnSync` lets a failed invocation's stdout be discarded instead. **Spawned rather than
`require`d**: the CLI can die in ways an in-process `try/catch` never sees — `process.exit`, a fatal
OOM, a native crash — which are exactly the failures the payload contract exists for, so the
wrapper has to survive them from outside the process. `maxBuffer` is set explicitly to 32 MiB:
`spawnSync` otherwise caps stdout at 1 MiB and signals overflow by killing the child with SIGTERM,
turning a *successful* scan of a large corpus into a `scan_error: true` no operator could read as
"you outgrew a constant". Overflow stays fail-closed; the cliff is raised and named, not removed. The
Step 4 profile resolver must treat `true` as "cannot decide" rather than as an empty corpus.

Which payloads `projectionIsConsistent` (`scripts/detect-scope.js`) refuses on top of the shape
check, and what each one does downstream: [`./4-implementation.md`](./4-implementation.md)
§ 1.6.

### 3.3 Review profiles

| Profile | Used when | Reviewer reads | Questions |
|---------|-----------|----------------|-----------|
| `full-design` | Design landing pre-implementation; unknown classification; security / data-integrity; any escalation | Whole changed document + linked design context | Completeness, feasibility, architecture, risk, security, testing |
| `implementation-sync` | Current-authority doc updated after code landed | Changed hunks + enclosing `##` sections + preamble + link definitions | (1) Does any reviewed section contradict the implementation? (2) Is any affected cross-reference dead? |
| `living-sync` | Current-authority doc, doc-only edit | Changed sections | Accuracy and internal consistency |
| `record-diff` | Design / work / history record | Changed hunks | Is the edit internally coherent and correctly marked as a record? **No code-alignment obligation** |
| `executable` | Instruction surfaces (`skills/**`, `rules/**`) | Changed sections + the file's own contract | Does the instruction still execute? Any conflicting directive? |

New (untracked) files are read whole under any profile — every line is new.

### 3.4 Deterministic resolution, and why it replaces the state machine

`scripts/resolve-review-profile.js` takes the changed-file list and the producer's requested
profile, and emits the resolved profile plus a batched dispatch plan. It **escalates** —
never de-escalates — when:

| Condition | Resolution |
|-----------|------------|
| Classification unknown or metadata malformed | `full-design` |
| Diff touches a `##` section the declared whitelist does not cover | `full-design` |
| A **requested** shallow profile declares no whitelist at all | `full-design` |
| A changed path matches `scripts/config/sensitive-paths.json` | `full-design` (Anchor Register #3) |
| `--tier` argument is `thorough`, absent, or unparseable | `full-design` (Anchor Register #3) |
| Requested profile shallower than the artifact's role permits | the role's profile |

The whitelist is the load-bearing control **over a producer's claim**, and that scope is the
whole of it: a producer that names `implementation-sync` for a sweeping rewrite gets
`full-design` anyway, because the claim is checked against the diff. Where no profile is
requested the resolver derives one from the artifact's role and scopes the read from the diff
itself — there is no claim to falsify, and demanding a declaration there would escalate every
file on the default path, records included. That is not a hypothetical: it is what the first
implementation did, and running it over a 49-file change resolved all 49 to `full-design`.
A declared whitelist is checked whether or not a profile came with it, since declaring
sections is itself a claim about scope.

**Sensitivity has two inputs, and neither is `sensitivity_hint`.** That field is transient
hook output (`hooks/post-edit-format.sh:260` prints it onto an `[AUTO_LOOP_STATE]` line) and
is persisted nowhere, so it cannot be read at dispatch — an earlier draft of this section
depended on it and was wrong. Instead: (a) the resolver **recomputes** path hits itself from
`scripts/config/sensitive-paths.json`, using that file's own segment-anchored matching; and
(b) the producer passes its **effective tier** as a required `--tier` argument, which is what
carries a *semantic* security change on a generic path. Input (a) is a floor, never a
ceiling — the config's own `_comment` states it is example coverage and that security
semantics often live in paths no rule catches. Input (b) fails closed: a missing or
unparseable `--tier` resolves to `full-design`, so a producer cannot obtain a shallow review
by omitting it.

Apart from those two inputs, everything the resolver reads is derived from `git diff`
**at dispatch time**. That single property
retires the entire two-factor state machine the previous draft of this spec specified:

| Retired mechanism | Failure it carried | Why it is unnecessary now |
|-------------------|--------------------|---------------------------|
| `doc_sync_pending` state token | `.claude_review_state.json` persists across sessions, so authorization leaked; armed on precommit passes mapping to no doc at all; needed its own atomic `session-init.sh` reset | Evidence is recomputed per dispatch; there is no armed window to leak |
| `doc_phase` persisted in the dispatch pin | The pin is a shared, set-if-absent **per-plane** scalar and the hook payload carries no correlation key — two concurrent doc dispatches inherit one another's phase, satisfying the wrong depth of gate (the gap flagged 2026-08-09 in `../auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md`) | Nothing is persisted; each dispatch resolves independently, so concurrent dispatches cannot alias |
| Poison-on-mismatch (record no verdict, re-run) | A fail-closed patch over a producer-bug path — by then the shallow prompt had already been delivered | The resolver runs *before* the prompt is assembled; a shallow prompt is never built |
| `doc_phase=` in `[AUTO_LOOP_STATE]` across all six emitter hooks | A byte-identical block in six files plus a field-order test, changed together | Profile is not session state and is not published |

`[DOC_PHASE_REQUEST]` and `doc_phase` are therefore **not** introduced. The producer names
its profile in the resolver call, and the resolver's answer is what the prompt is built from.

### 3.5 Guardrails (Anchor-compatible)

| Guardrail | Basis |
|-----------|-------|
| Security / data-integrity change ⇒ `full-design` regardless of classification or requested profile | Anchor Register #3 (`thorough` whatever is configured) |
| Profile narrows what the reviewer *reads*, never *whether* review runs; edits still re-open their plane's gate | Anchor Register #5, #6 |
| Unknown / unreadable classification ⇒ `full-design` | Fail toward the deeper mode |
| No resolver outcome auto-passes a review; sentinels and receipts unchanged | Existing enforcement model |

## 4. Implementation Roadmap

Six steps, each independently shippable in one review cycle, in this order. Steps 1–3 are
prerequisites for Step 4 being cheap; Step 4 is the causal fix.

### Step 1 — Repair the upfront gates, and baseline the doc plane

| | |
|---|---|
| Status | **Landed in this working tree** (uncommitted). The rows below are the ticket as written; § 2's baseline describes what it replaced |
| Files | `skills/review-spec/SKILL.md`, `rules/auto-loop.md` (`/review-spec` producer sentence; Cap Diagnostic `DOC_TOO_LONG` row), `hooks/post-tool-review-state.sh`, **new** `test/skills/review-spec.test.js` (absent from `3744d58`), `test/hooks/post-tool-review-state.test.js` (its `/review-spec sets doc_review passed` case at line 2057 is the synthetic one to replace), `test/hooks/background-verdict-recovery.test.js` (the real-jq PreToolUse counter cases, the code-plane negative control, and the `no_verdict` counting-on-claim cases), `test/hooks/jq-filter-fidelity.test.js` (the counter's jq filter is assembled dynamically in shell; these reassemble it exactly as the hook does) |
| Change | Convert `/review-spec` from an `Agent` dispatch to the shared `mcp__codex__codex` doc-review path emitting the parsed sentinels (`✅ Mergeable` / `⛔ Needs revision`), and update `allowed-tools`. Correct the `DOC_TOO_LONG` row, which names `/refactor --target` for a splitting operation no skill performs. Add lazily-created `doc_iteration_history` counters `{dispatches, verdicts, passes, blocks, no_verdict, legacy}` at the existing PreToolUse doc-dispatch detection — no caps, no stalls, nothing blocking |
| Blocked | **Enabling `## Plan Review` is deferred to a prerequisite change.** `/install-rules` seeds an absent consumer override *from* `rules/auto-loop-project.md`, restamping only the install metadata as it copies (`skills/install-rules/SKILL.md:74,76`) — an activated setting would carry through unchanged. This repo has exactly one copy of that file (`.claude/rules` is a symlink to `rules/`) — so it is the shipped scaffold and the live config at once, and an activation here ships to every installer. Three tests refuse it by design. The prerequisite is to give the scaffold a distinct home; that is an `install-rules` change, not this step's |
| AC | A failing `/review-spec` records `doc_review.passed=false` and a passing one records `true` (both directions tested, per `rules/testing.md` § Conventions — Guards); `dispatches − verdicts` is observable; code-plane counters untouched; no rule names a remedy no tool performs |
| Why first | The complaint is a *rate*, and today it is unmeasurable. Also the cheapest real win: the design-time gate that prevents late churn currently records nothing and is switched off |

### Step 2 — Artifact classification, zero migration

| | |
|---|---|
| Files | new `scripts/lib/doc-metadata.js`, new `test/scripts/doc-metadata.test.js`, `scripts/lib/doc-classifier.js`, `scripts/lib/feature-resolver.js`, `scripts/classify-docs-cli.js`, `scripts/config/doc-taxonomy.json`, `test/scripts/doc-classifier.test.js` |
| Change | Parse the § 3.1 blockquote metadata (top-of-document preamble bounded by a 30-line ceiling, exact match after trim; an ABSENT declaration falls through to the path default, a present-but-unreadable one fails closed to `Current authority` directly). Add the path-default table. Extend `scanFeatureDocs` to emit the four source sets of § 3.2, keeping `canonical_docs` as a computed deprecated alias. **Propagate them**: before this step, `feature-resolver.js` copied only `doc_inventory` and `canonical_docs` out of the scan (`scripts/lib/feature-resolver.js:31,35` @ `3744d58`) and `classify-docs-cli.js` serialized only those two (`scripts/classify-docs-cli.js:30` @ `3744d58`) — adding sets to `scanFeatureDocs` alone would have left every consumer blind to them. Both boundaries forward the sets as of r2, including empty-set defaults on every null / early-return path |
| AC | All four roles resolve from path with no metadata present; explicit metadata overrides in both directions; malformed / annotated values resolve to `Current authority` rather than to the path default or a guess, and `No` cannot demote that result; unknown path ⇒ `Current authority`; every existing `doc-classifier` test still passes against the alias; the sets survive `feature-resolver` and the CLI, with empty-set defaults asserted on the `key: null` and CLI/branch/diff early returns |

### Step 3 — Migrate research consumers to source sets

| | |
|---|---|
| Files | `skills/ask/SKILL.md`, `skills/runbook/SKILL.md`, `skills/architecture/SKILL.md`, `skills/feasibility-study/SKILL.md`, `skills/tech-brief/SKILL.md`, `skills/create-request/references/feature-context-resolution.md` (the two copies were merged into this one), their tests |
| Change | "What does the system do now" resolves against code + `rules/` + `current_authority`; `design_records` are consulted only for "why was it designed this way" and are labelled as such in the answer |
| AC | A frozen tech spec is no longer returned as a current-behaviour source (test asserts the absence, not just the presence of the new set); design questions still reach it |

### Step 4 — The cheap review path (causal fix)

| | |
|---|---|
| Files | new `scripts/resolve-review-profile.js`, new `scripts/check-doc-links.js`, their tests, `scripts/config/doc-taxonomy.json` (the review-budget keys), `skills/doc-review/SKILL.md`, `skills/doc-review/references/codex-prompt-doc.md`, `skills/doc-review/references/review-loop-doc.md`, `skills/feature-dev/SKILL.md`, new `docs/features/doc-review-phasing/4-implementation.md` |
| Change | Ship the five profiles and the resolver of § 3.3–3.4, including the two sensitivity inputs. The batch plan is a **per-file** profile mapping, not one profile for the batch: one file's escalation raises that file's questions and, when it escalates to `full-design`, the batch's shared dimensions — it never strips the record files' exemption from code-alignment questions. Run the deterministic link checker **before** the LLM review and feed the reviewer its failures **and its own coverage** (`markdownlint` does not resolve links); resolve every target with `realpath` and reject anything outside the repository root or reached through a symlink escape. The checker is a scanner, not a CommonMark parser — this repository ships zero dependencies — so it reports `unresolved`, the number of link-shaped constructs it declined to classify, and the prompt binds on the pair: `failures: []` settles the link question only alongside `unresolved: 0`. That is what makes narrowing safe; inventing a finding is what it must never do, because a finding reaches the reviewer as established fact. Replace `feature-dev`'s per-updated-file Doc Sync line with **one logical review plan** covering all changed `.md` — the plan is the unit, and it holds one or more physical batches. Within the file/byte budget the plan is exactly **one** batch and therefore one dispatch, which is the case that buys the saving. Over budget the resolver fails **loud**: it splits the plan by feature folder in a deterministic order, says which batches it produced and why, and dispatches each — never silently truncating, and never claiming one dispatch it did not make. The budget is **12 files or 200,000 bytes of changed-file content, whichever is hit first** (the corpus median is 397 lines, so 12 median files ≈ 190 KB — the two limits bite at roughly the same place); it lives in `scripts/config/doc-taxonomy.json` alongside the path defaults, which is already the per-repo configuration surface. Splitting is **two passes, and the second is what makes the bound real**: (a) group by feature folder, with every `.md` outside `docs/features/**` in one final `(root)` group; (b) chunk each group, files in path order, starting a new batch at the file that would exceed either limit. Grouping alone does not bound anything — `auto-loop-evolution/` is 25 files / 319,862 bytes and `create-pr-stacked/` is 11 / 428,170 at `3744d58`, so a feature-folder batch is routinely over on its own. Every emitted batch is then within budget, with exactly one exception, which is reported rather than hidden: a batch holding a single file that alone exceeds the byte limit. Boundaries are inclusive: 12 files and 200,000 bytes are within budget; the 13th file or the 200,001st byte opens the next batch. A single file over 200,000 bytes is its own batch and is reported as over-budget rather than skipped — there is nothing left to split, and dropping it would be the silent truncation this whole clause exists to prevent. Groups are emitted in path order and their union is always the full changed set. Stop `cat`-ing whole existing files. Write `4-implementation.md` as the feature's current-authority record of the shipped mechanics (nothing else creates it; `/update-docs` syncs an existing target, it does not author a missing one) |
| AC | Shallow profile with an out-of-whitelist diff escalates to `full-design`; a `sensitive-paths.json` hit escalates; a missing or unparseable `--tier` escalates; a semantic security change on a generic path escalates via `--tier thorough` with zero path hits; a within-budget multi-doc change produces one plan, one batch, one dispatch, with per-file profiles; a `record-diff` file carries no code-alignment question even when another file in the same batch escalated; an over-budget plan splits loudly and **every emitted batch is itself within budget, except a reported single-file batch whose one file exceeds 200,000 bytes** — a 25-file feature folder chunks further, boundaries pinned at 12/13 files and at 200,000/200,001 bytes, a single over-sized file forms its own batch and is reported, and the union of batches is the full changed set; dead relative link detected, external URL and templated placeholder pass, traversal and symlink-escape targets rejected (heading fragments were taken out of scope on the owner's decision — `4-implementation.md` § 1.8); a construct the scanner declines raises `unresolved` rather than passing silently; the checker is advisory input, not a gate; `4-implementation.md` exists and describes what shipped |

### Step 5 — Rewrite the Doc Sync contract; freeze requests on completion

| | |
|---|---|
| Files | `rules/auto-loop.md` § Tiers Doc Sync sentence, `skills/feature-dev/SKILL.md`, `skills/update-docs/SKILL.md`, `skills/create-request/SKILL.md`, `test/rules/*` |
| Change | Doc Sync becomes: update the affected **current-authority** docs and close out the active request; do **not** rewrite design or history records to mirror subsequent code; when the implementation diverged from the design, append a bounded Outcome/Deviations note or write a superseding record; a single batched doc review covers all `.md` edited. On completion a request is marked closed and frozen (`record-diff` thereafter) |
| AC | Sentence is Default-tier and replaced coherently across rule and skills (no surviving "per updated file"); a completed request produces a freeze action or a stated reason; Anchor rows untouched — verified against `test/rules/discretion-tiers.test.js` |

### Step 6 — Prune-first, write-time budgets, and measurement

| | |
|---|---|
| Files | `rules/docs-numbering.md`, `rules/docs-writing.md`, `skills/tech-spec/SKILL.md` + template, `skills/create-request/SKILL.md` + template |
| Change | Make **prune / merge first** the default response to bloat, alongside splitting — the current text's "the remedy is splitting, never deleting content" is the line under which 241 docs were added and 0 removed. Write-time budgets: `/tech-spec` targets ≤ ~300 active lines (cohesion exception must be stated at 400); `/create-request` targets ~100 lines, AC ≤ 8, overwriting progress cells instead of appending rounds. After ~20 completed doc cycles compare dispatches/cycle, bytes/dispatch, profile mix and dispatch-to-verdict loss against the Step 1 baseline |
| AC | New docs conform to the budgets; the prune path is named as a first-class remedy; measurement is reported before any deferred machinery (§ 5) is built |

## 5. Deferred (re-entry criterion: Step 6 measurement shows recall failure)

Identifier/symbol extraction, repo-wide authority search, one-hop semantic link traversal,
`covers:` ownership metadata, file/section manifest hashes, scope hashes echoed by
reviewers, receipt consumption by covered section, `DOC_IMPACT_UNRESOLVED`, automatic
**semantic section chunking** (not Step 4's physical dispatch batching, which ships),
and a one-time backfill of role banners across the 245 documents the source sets cover.
Rationale: this machinery's delivery cost (a feature folder, a spec, hook schema surgery,
dozens of review rounds) is drawn from exactly the budget it claims to save; it must be
justified by measured recall failure, not anticipated.

## 6. Risks Accepted

| Risk | Bound |
|------|-------|
| An unstructured `grep`/`Glob` reaches a frozen design record and reads it as current behaviour | Source sets remove it from the *default* research path, not from the filesystem; § 3.1 metadata gives a human-visible banner where it matters. Backfill is deferred |
| A producer names a shallow profile it is not entitled to | The changed-section whitelist is the control, and it is deterministic. Same cooperative-trust boundary as the existing `## Document Review` header (the hook's stated threat model: trust root is `.claude/` integrity; adversarial producers are out of scope) |
| A section untouched by the diff is invalidated by the code change and is missed under a shallow profile | Step 6 measures it; the § 5 machinery is the answer only if observed |
| Path defaults are right for this repo and may be wrong elsewhere | They live in `doc-taxonomy.json`, which is already the per-repo configuration surface |
| Anchor-slug edge cases (Unicode, duplicate headings) in the link checker | Tests pin behaviour; advisory-only, so a miss costs one finding, not a gate |
| The upfront design gate stays off, because `## Plan Review` cannot be activated where the scaffold and the live config are one file (Step 1 § Blocked) | Until the scaffold gets its own home — an `install-rules` change, not this feature's — the opt-in is per session: ask for `/plan-review` explicitly. When it is activated it inherits `## Plan Review Max Rounds` (default 5), and Step 6 measures it with the rest |

## 7. Testing Strategy

| Step | Layer | Key cases |
|------|-------|-----------|
| 1 | Unit (`test/skills/`, `test/hooks/`) | `/review-spec` pass **and** fail both record a verdict; counters increment on dispatch and on each outcome; code-plane counters unchanged |
| 2 | Unit (`test/scripts/`) | Role resolution from path for all four roles; metadata override both directions; malformed / annotated / missing values; unknown path ⇒ `Current authority`; alias parity with existing classifier tests |
| 3 | Integration | Frozen tech spec absent from current-behaviour sources; present for design questions |
| 4 | Unit + integration | Whitelist escalation; sensitivity escalation; batching; per-profile question sets; link checker positive and negative cases |
| 5 | Rules tests | Replaced sentence coherent across rule + skills; Anchor rows intact |
| 6 | Measurement | Reported against the Step 1 baseline, not asserted by test |

Guard cases follow `rules/testing.md` § Conventions — Guards: every refusal ships with the matching
acceptance case in the same change.

## 8. Non-Goals / Invariants Preserved

- No change to *whether* review runs, gate re-opening, receipt semantics or sentinel pairs.
- No second gate, no new human exit, no new `[AUTO_LOOP_STATE]` field.
- `/refactor` trigger probability is deliberately **not** raised.
- Code-plane counters, stall detection and the Cap Diagnostic Protocol are untouched.
- No bulk rewrite of the 245 covered documents is required for any step to work.

## 9. Open Questions

| # | Question | Owner / when |
|---|----------|--------------|
| 1 | Should `4-implementation*` really be the only lifecycle doc defaulting to current authority, or should an explicitly `Status: Accepted` tech spec also qualify? | Decide from Step 2 test evidence over this repo's 59 specs |
| 2 | Does `executable` need to be distinct from `living-sync`, or does the instruction-surface question collapse into accuracy? | Decide at Step 4 from the first ten dispatches |
| 3 | Whether the deprecated `canonical_docs` alias is removed after Step 3 or kept indefinitely for external consumers | After Step 3 lands |

## Provenance

Design converged through adversarial Claude+Codex debate: an initial 3-round exchange (10
attacks, both positions revised) produced the state-machine draft this document replaces; a
second exchange under `/best-practices` (thread `019fe228-5796-7091-ac99-fe002636768f`,
early convergence at round 2, all four attacks conceded) retired the state machine in favour
of the classification + intent + resolver design above, benchmarked against Google's
minimum-viable-documentation and design-doc practice, ADR immutability, and
deterministic-checks-before-human-review.
