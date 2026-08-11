# Artifact authority classification and research-consumer migration

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-09
> **Status**: In Progress
> **Note**: Second of three siblings (r1 → r2 → r3). The consumer migration is meaningless without the classifier, so both tech-spec steps land together here.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- Technical detail (primary source)

## Background

Every document in this repo is treated as a living document owing perpetual code alignment.
`pickCanonicalDocs` (`scripts/lib/doc-classifier.js:368`) answers "which file is the tech
spec", and its consumers read that as "which file describes the system" — so a frozen
design record is handed to research as though it were current behaviour, and then reviewed
for drift against code it never claimed to describe. The reach is derivable rather than
counted by hand: `git grep -ln canonical_docs 3744d58 -- scripts/ skills/` returns 12 files
(44 lines), and they do not all play the same part — some produce the alias, some read and
forward it, some only forward, some read it to select a document, one writes a same-named
snapshot field, and the rest are instruction surfaces describing it. § 3.2 of the tech spec
carries the role-by-role table. Tech specs are 49.1% of the corpus.

## Requirements

- A document's role (`Current authority` / `Design record` / `Work record` / `History record`) is machine-resolvable
- Resolution works on all 245 documents the source sets cover — the union of the four sets across the 82 feature directories, not the repo's 533 `.md` files — with **no migration**; path defaults supply day-one behaviour
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
| `scripts/lib/feature-resolver.js` | Modify | **Done** — forwarded only `doc_inventory` + `canonical_docs` before this change; now forwards the four source sets, with empty-set defaults on the `key: null` and cli/branch/diff early returns |
| `scripts/classify-docs-cli.js` | Modify | **Done** — serialized only `canonical_docs` before this change; now emits the source sets, including on the no-repository and top-level-error exits |
| `scripts/config/doc-taxonomy.json` | Modify | Path-default table lives here as the per-repo configuration surface |
| `skills/ask/SKILL.md`, `skills/runbook/SKILL.md`, `skills/architecture/SKILL.md`, `skills/feasibility-study/SKILL.md`, `skills/tech-brief/SKILL.md` | Modify | Resolve current behaviour against code + `rules/` + `current_authority`; consult `design_records` only for design rationale |
| `skills/req-analyze/SKILL.md`, `skills/create-request/SKILL.md`, `skills/adr/SKILL.md`, `skills/test-health/SKILL.md` | Modify | Non-role-aware callers, migrated to the wrapper for the failure payload |
| `allowed-tools` of every skill | **Unchanged** | The wrapper migration first made four skills instruct a `bash` command their tool list forbade. The fix was a Node entrypoint runnable under the `Bash(node:*)` they already grant — not a widened permission. The test now checks instruction and permission together |
| `skills/create-request/references/feature-context-resolution.md` | Modify (promoted) | Documents the source sets alongside the deprecated alias. **Two drifted copies existed**; this is now the single canonical one — see the `/tech-spec` row for why it moved here |
| `scripts/resolve-feature-cli.js` | Modify | The low-level CLI behind the wrapper — shares `EMPTY_CONTEXT()` so no exit prints a bare `{}` |
| `scripts/resolve-feature.js` | New | The resolver entrypoint and single owner of the failure payload: spawns the CLI and discards its output unless it is one parseable JSON document **of the agreed shape**, otherwise emits the full shape with `scan_error: true`. Node rather than shell because the four research skills that had to migrate grant `Bash(node:*)` and not `Bash(bash:*)` — and it is shell-agnostic, which matters where the interactive shell is zsh. Neither permission is universal in the other direction: `/codex-code-review` grants bash and no node |
| `scripts/lib/context-shape.js` | New | The payload shape, in a module that **requires nothing**. The wrapper first imported `EMPTY_CONTEXT` from `feature-resolver`, which transitively loads `doc-classifier`, the taxonomy loader and the metadata parser — a load-time error anywhere in that graph killed the wrapper before `main()` ran, so the file whose job is surviving resolver failures sat inside their blast radius |
| `scripts/resolve-feature.sh` | Modify | Reduced to a shim that `exec`s the Node entrypoint. Not vestigial: it is the entrypoint for `!` context blocks and for `/test-health` and `/codex-code-review`. Two implementations of a fallback drift, and the one that drifts is the one nobody reads |
| `skills/tech-spec/SKILL.md`, `skills/tech-spec/references/native-feature-resolution.md` (New), `skills/tech-spec/references/feature-context-resolution.md` (Deleted) | Restructure | The per-command pairing check surfaced a pre-existing gap the file-wide one could not see: `/tech-spec` grants `Bash(git:*)` only, yet the shared reference **it owned** instructs `node scripts/resolve-feature.js`. Permissions were not widened — the user's call, and their decision here. The first attempt annotated the mismatch (`> **Non-executing reader**: /tech-spec`) and rounds 11–13 each found a new way to reverse the annotation from elsewhere in the same file, ending with a plain later sentence that no whole-line grammar can refuse. **Prose cannot carry a mechanical guarantee about what a skill will not do**, so the file moved instead: the shared algorithm now lives with `/create-request` (unrestricted `Bash`), `/tech-spec` has a command-free `native-feature-resolution.md`, and it links nothing that instructs the resolver. The escape hatch is deleted, not policed |
| `README.md` + 5 locale copies, `scripts/generate-readme-catalog.js` | Modify | Scripts inventory 18 → 19 |
| `skills/runbook/references/discovery-heuristics.md` | Modify | The per-section map `SKILL.md` sends the agent to. Migrated with the skill, not after it: it still assigned canonical docs High confidence, which sources an operational procedure from a design record |
| `test/scripts/doc-metadata.test.js` | New | Role resolution, override, malformed input, unknown path |
| `test/scripts/doc-classifier.test.js` | Modify | Source-set output; alias parity |
| `test/skills/scan-error-gate.test.js` | New | Consumers gate on `scan_error !== false`; every role-aware surface calls the wrapper; the wrapper emits one payload of the agreed shape whatever the CLI does. The pairing check binds **each command line** to the permission of every skill that can reach that file, following `SKILL.md → reference → reference` to a fixpoint, folding shell line-continuations first and requiring the interpreter to be the command head. Each of those four was a hole a reviewer opened: the file-wide version stayed green while `/runbook`'s two real commands became a forbidden shim (a correct mention elsewhere satisfied it); `bash \` + newline matched no detector; `env node …` matched the node entrypoint although `Bash(node:*)` will not run it; and a reference loaded through another reference was attributed to nobody. There is **no exemption**: the annotation that used to grant one is deleted, because rounds 11–15 showed a prose declaration cannot bind what the rest of the file says. The detector is an **allowlist** — the permitted command spellings are enumerated, everything else fails closed — after three rounds of extending a denylist and each round meeting the next unlisted shell spelling. It detects on normalized text and admits only on the literal, so `"node …"`, `resolve-feature\.js` and an NBSP normalize to a permitted form yet are still refused. **Most of those do run** — quoting one argument does not make it a filename with spaces, and a backslash before an ordinary character is dropped — so what the rule enforces is one canonical spelling per command, not inertness; round 16 corrected the opposite claim |
| `test/skills/runbook.test.js` | Modify | The cascade is pinned by role order with a negative control, replacing the assertion that required the four-priority version |

## Acceptance Criteria

- [x] All four roles resolve from path alone, with no metadata present in any file
- [x] Explicit metadata overrides the path default in **both** directions (a tech spec can declare itself current authority; a `docs/` file can declare itself a record)
- [x] Malformed or annotated values are never guessed at. **The AC as originally written said they
      "fall through to the path default"; that was wrong and was corrected during review.** For a
      tech spec the path default is `Design record` — a *shallower* obligation — so a garbled
      declaration bought a cheaper review than writing none at all. A role line that is present but
      unreadable (annotated, unknown value, empty value, two different roles, one good line beside
      one bad, or a line naming the key while missing the grammar) now resolves to
      `Current authority`, and `Current behavior authority: No` cannot demote it from there.
      Absence still takes the path default
- [x] An unrecognised path resolves to `Current authority` (fail-closed toward the deeper obligation)
- [x] `scanFeatureDocs` emits the four source sets; every existing `doc-classifier` test passes against the retained `canonical_docs` alias
- [x] The sets survive both propagation boundaries (`feature-resolver.js`, `classify-docs-cli.js`), with empty-set defaults asserted on every null / early-return path
- [x] **`resolve-feature-cli.js` too** — the low-level CLI behind `scripts/resolve-feature.js`,
      which the AC above did not name and which still printed a bare `{}` on its no-repository and
      caught-error exits. Both CLIs now share `EMPTY_CONTEXT()`. Every skill that names the
      resolver calls an entrypoint **it is permitted to run** — the pairing is asserted, because the
      first migration gave `/ask`, `/runbook` and `/tech-brief` a `bash` command their
      `allowed-tools` forbade: an instruction that reads correct and cannot execute, invisible to
      every text-level check
- [x] Empty sets are distinguishable from an unreadable corpus: `scan_error` is present on every
      resolver branch and every CLI exit, `false` only for confirmed absence, and every consumer
      skill gates on it (`test/skills/scan-error-gate.test.js`)
- [x] A frozen tech spec is **absent** from current-behaviour sources (asserted as an absence) yet still reachable for design questions
- [x] Every gate this change class requires was run, and re-run after the last edit in its own plane — code plane `✅ Ready` plus `## Overall: ✅ PASS`, both after the last code edit; doc plane re-dispatched on every ticket edit, first reaching `✅ Mergeable` on its fifth round. **This box is not the closure authority and cannot be**: it is edited by the same act that re-opens the doc gate, so it can only ever describe the state before its own round. The terminal verdict is the receipt's (`.claude_review_state.json` → `doc_review.passed`), which the Stop gate reads and this ticket does not attempt to duplicate. See § Review History

## Deferred Findings (sub-threshold, logged not fixed)

`@rules/auto-loop.md` § Sub-Threshold Findings: on a passing gate with only sub-threshold findings,
they are logged and passed. **They are recorded here rather than only as `[NIT_DEFERRED]` lines**,
because that sentinel is parsed from the *review tool's* output — printing it from a shell command
persists nothing, which is a distinction worth stating once instead of rediscovering.

| # | Site | Sev | Finding |
|---|------|-----|---------|
| 1 | `scripts/lib/doc-classifier.js:248` | P2 | `_readHead` stops **successfully** at the configured newline count (30) or at EOF, and stops **incomplete** at the 1 MiB cap. So when the head window does not complete within 1 MiB — an oversized early body line after an otherwise complete metadata preamble — it returns `complete: false`, and `_resolveRole` (`:280`) then discards the *entire* partial head, including a valid demotion it had already read, resolving the document to `FALLBACK_ROLE` = `Current authority`. The discarded declaration is one that was read, not one past the abandon point; a declaration below the preamble would never be honoured anyway. A large body *after* the first 30 lines is unaffected, because the newline count is checked before the byte cap |
| 2 | `test/scripts/doc-metadata.test.js:536` | Nit | The unusable-key table has no CRLF variant, and `null` is not pinned directly on the "unset means default" side |
| 3 | `test/skills/architecture.test.js` | P2 | The selection-rule test matches keywords; restoring the zero-candidate row to `Gate: Need Human` leaves it green |
| 4 | `test/skills/scan-error-gate.test.js` | P2 | Consumer discovery is pinned as a helper, but reverting the live derivation to `instructions(rel)` leaves the suite green — no fence-only consumer exists in the corpus to distinguish them |
| 5 | `skills/feasibility-study/SKILL.md` § Phase 1 | P2 | The requirements-candidate rule (zero / one / uniquely canonical / ambiguous) has no test; deleting the table leaves the suite green |

Items 3–5 are one follow-up, not three: **pin the instruction-surface policies**. Each is a rule
stated in a `.md` that the code cannot enforce, and the shared gap is that the live corpus does not
exercise the branch. The pattern that fixes them is the one rounds 18–19 established — take the text
as an argument and supply the case the repository lacks. Codex agreed with this disposition on the
documentation plane and named item 4 the most valuable of the three, since consumer discovery decides
which skills must carry the fail-closed gate at all.

## Progress

| Phase | Status | Note |
| ---- | ------ | ---- |
| Analysis | Done | Consumer inventory taken 2026-08-09, derived not counted: `git grep -ln canonical_docs 3744d58 -- scripts/ skills/` → 12 files / 44 lines, roles split in tech spec § 3.2 |
| Development | Done | `doc-metadata.js` + § `doc_roles` config; four source sets through both propagation boundaries; five consumer skills migrated, and the two `feature-context-resolution.md` copies merged into one canonical copy under `/create-request` (uncommitted working tree) |
| Testing | Done | 42 (`doc-metadata`) + 61 (`doc-classifier`) + 39 (`feature-resolver`) + 6 (`classify-docs-cli`) + 27 (`skills/scan-error-gate`) + 16 (`skills/runbook`) + 11 (`skills/architecture`) across the affected files. Counts drift as rounds add pins — derive rather than trust: `node --test test/scripts/doc-metadata.test.js test/scripts/doc-classifier.test.js test/scripts/feature-resolver.test.js test/scripts/classify-docs-cli.test.js test/skills/scan-error-gate.test.js test/skills/runbook.test.js test/skills/architecture.test.js` |
| Acceptance | Code plane was green at the time — `✅ Ready` (round 21) + precommit `## Overall: ✅ PASS`, both after this ticket's last code edit. **Correction (2026-08-11): those verdicts no longer describe the working tree.** r3 landed new code (`scripts/check-doc-links.js`, `scripts/resolve-review-profile.js` and their tests) in the same uncommitted change, which re-opened the code plane for everything in it (Anchor Register #6). What is recorded here is what was gated then; the live receipt is `.claude_review_state.json`. Doc plane reached `✅ Mergeable` on round 5 and has been re-dispatched after every subsequent ticket edit; its current verdict is the receipt's, not this row's — § Review History explains why the ticket cannot hold it. Five sub-threshold findings logged in § Deferred Findings, none blocking | Read `.claude_review_state.json` → `doc_review` for the doc plane's state at any moment; this row records what was gated, not whether the gate is open right now. Round 9's earlier `✅ Ready` was superseded by every round after it. The arc is worth recording: after round 10 the findings stopped being about the feature and became about the *guards* written for it. Rounds 12–14 blocked on the same defect class at a new boundary each time (`ARCHITECTURE`, answered by inverting the detector to an allowlist); rounds 17–19 blocked on each round's own new guard being weaker than its comment claimed (`ATTENTION_DIFFUSION`, answered by a deletion audit). See § Review History for what each round found |

**Measured effect** — the classified corpus, 82 feature directories:

| Source set | Documents |
|------------|-----------|
| `current_authority` | **8** |
| `design_records` | 84 |
| `work_records` | 146 |
| `history_records` | 7 |
| Total | 245 |

8 of 245 documents (3.3%) owe code alignment, against 245 before this change. The 8 are five
`4-implementation.md` plus three fail-closed outliers — `dual-reviewer/3-auto-loop-integration.md`,
`rule-override-pattern/3-customize-v2.md` and `post-dev-recap/briefing-recap-2026-04-17.md`, whose
filenames match no lifecycle whitelist entry. Fail-closed means those three are reviewed at full
depth until someone says otherwise, which is the correct default, not a gap. Derivation:

```bash
node -e "const {scanFeatureDocs}=require('./scripts/lib/doc-classifier');const fs=require('fs');
const t={current_authority:0,design_records:0,work_records:0,history_records:0};
const dirs=fs.readdirSync('docs/features',{withFileTypes:true}).filter(x=>x.isDirectory());
const t0=process.hrtime.bigint();
for(const d of dirs){const r=scanFeatureDocs('docs/features/'+d.name); for(const k in t) t[k]+=r[k].length;}
console.log(t, 'features='+dirs.length, 'ms='+Number(process.hrtime.bigint()-t0)/1e6)"
```

The counts are exact and reproduce every run. The **timing is not a stable figure** and is not
claimed as one: a cold-cache first run and a warm one differ by several times, so the command
above prints whatever this machine did this time. What the change is claimed to have improved is
the *shape* of the read — bounded by lines rather than reading whole files — and the counts, not
a millisecond number.

**Adequacy Gate** — the first `--ac-trace` returned ⛔ Inadequate, and it was right about one thing
that was not a test gap: `classify-docs-cli.js` printed `{}` on its no-repository and `.catch`
exits, so the AC's "empty-set defaults on every null / early-return path" held for the resolver but
not for the CLI. A consumer calling `.map()` on a source set got a TypeError on exactly the paths
where it is hardest to diagnose. Fixed with an `emptyPayload()` built from `emptySourceSets()`.

Four assertions were passing for the wrong reason, each now carrying a control that fails when the
guard is removed: the `scope: first_segment` case (its path matched an earlier rule, and the shipped
config cannot demonstrate that scope at all — the instruction-surface rule is last and its role *is*
the fallback, so both answers coincide); the symlink case (never asserted the symlink); the
unreadable-file case (its fixture read the same either way); and `/ask`'s routing (asserted the four
names occurred somewhere, which survives swapping two routes — verified by mutation).

## Review History

One row per recorded round or grouped phase — mostly blocking rounds, because the *shape* of this
loop is the finding, but the convergence and re-review verdicts are here too and rounds 5–8 share a
single row. Rounds 1–8 (thread `019fe9f8`) were about the feature and converged to `✅ Ready` at
round 9. Everything after it was
about the guards written for the feature — a class of finding that only appears once the tests are
strong enough to be worth attacking.

| Round | Verdict | What blocked |
|-------|---------|--------------|
| 5–8 | ⛔ | A prefix-ambiguity parse hole; three launderable test guards; a preamble-boundary inconsistency; and `skills/runbook/references/discovery-heuristics.md` left unmigrated while `runbook.test.js` pinned the stale four-priority cascade — the suite stayed green on two contradicting instruction surfaces |
| 9 | ✅ Ready | Superseded by every edit since |
| 10 | ⛔ | The wrapper imported its own failure shape through the resolver graph it reports on; `/runbook` printed a shell compound `Bash(node:*)` cannot execute; the pairing test bound entrypoints **per file**, so switching `/runbook`'s two real commands to a forbidden shim left the suite green |
| 11 | ⛔ | Guards, not fixes: the import allowlist read only single-quoted `require('…')`; the pairing check assumed one physical line and accepted `env node …`; the non-executing declaration could hide inside an HTML comment; `isContextShape` passed a six-array object as "the full shape" |
| 12 | ⛔ | Guards again: an interpreter-keyed detector could not see `/usr/bin/bash …` and dropped it silently; the mermaid exemption applied to the whole fence, so relabelling a shell block (or leaving a fence unclosed) hid a forbidden command; the non-executing hatch survived a `~~struck-through~~` pledge followed by its reversal |
| 13 | ⛔ | The scanner lost commands at shell quote boundaries (`bash "scripts/resolve-feature.sh"`, and `bash scripts/resolve-""feature.sh` where the literal path never appears at all); a mermaid arrow label could carry `$(bash …)`, which expands before the arrow "command" fails; `<code>…</code>` and Markdown link labels were a third instruction context; and the prose pledge was reversible by a plain later sentence |
| 14 | ⛔ | `SKILL.md` files were not graph nodes, so one hop through `@skills/architecture/SKILL.md` reconnected `/tech-spec` to a resolver command; the native reference dropped Level 3b's existence condition, which changes the answer rather than shortening it; the denylist still missed an escaped dot (`resolve-feature\.sh`), a path constructed in a variable, and `<(bash …)` in an arrow label; `length > 0` accepted whitespace-only filenames; three living design docs still described a two-copy world |
| 15 | ⛔ | The `chmod -x` half was missing, so a bare `scripts/resolve-feature.sh` in prose still named a runnable file; the allowlist admitted spellings that normalize to a permitted command but cannot be written that way; a four-space indented block was not read as code; `/tech-spec`'s native Level 3b existence condition was undocumented |
| 16 | ⛔ | The placeholder grammar `<[^<>]*>` re-admitted process substitution plus a redirect (`<(printf x)> /dev/null`), which the shell runs and from which the skill gets no JSON; the `chmod -x` repair was a mode bit with no test pinning it, so `chmod +x` restores the bypass with every scan test green; two accuracy defects — a comment and this document both claimed the refused spellings cannot execute, and this table still recorded round 15 as pending |
| 17 | ⛔ | A new thread (`019feba6`), because the old one stopped accepting continuations — and it found a different class of defect entirely: `/architecture`'s Codex prompt told the reviewer to list the feature directory and pick the spec by name, which re-selects a history record over the live design; `/test-health` branched on `has_tech_spec` alone, so an unreadable corpus reported as "no feature docs detected"; the consumer list was hand-kept rather than derived; a relative `../../x/SKILL.md` link was not a graph edge; `feature-resolver.js`'s `@returns` omitted `scan_error` |
| 18 | ⛔ | Three of the round-17 fixes were weaker than their own comments: `design_records` is an array and `docs/features/auto-loop-evolution/` really does hold two `type: tech-spec` design records, so "the entry" had no rule; the prompt reference offered a substitute value for a `scan_error` run that `SKILL.md` § Phase 0 exits on; and the relative-link edge was exercised only by self-cycles, so deleting the branch left every test green |
| 19 | ⛔ | Converging: two findings, both on the previous round's own fixes. The tech-spec selector's rules were phrased over `design_records` rather than over the tech-spec candidates — `docs/features/codex-review-spec/` has one canonical *requirements* record and the literal rule selects it — and it collapsed "no spec" into the Need Human exit that the mode table calls ordinary code-only mode; fence-inclusive consumer discovery was implemented but no input in the repository distinguished it from the fence-stripping version |
| 20 | ✅ Ready | No P0 or P1 remains. Codex independently re-ran the deletion audit — every pin it tried went red except two it named: the architecture selector's zero-candidate row, and the wiring of consumer discovery into the live derivation (the helper is pinned, its use is not). Both are P2, logged `[NIT_DEFERRED]` and passed rather than opening round 21. It also scanned all 82 features against the selection rule: 23 with zero tech-spec candidates, 58 with exactly one, 1 multi-candidate with exactly one canonical (`auto-loop-evolution`), 0 ambiguous |
| 21 | ✅ Ready | Re-review of the code plane, re-opened by the two edits the doc plane's first round caused (`/feasibility-study` added to the invocation floor, stale commentary replaced). Codex removed the Phase 0 command in memory and confirmed the new floor entry fails specifically rather than sitting there vacuous. `## Overall: ✅ PASS` re-run afterwards |
| Doc 1 | ⛔ | `/feasibility-study` read source sets it never obtained; an acceptance box contradicted the progress table; two frozen design records were redirected to the live reference without marking the procedure below them as pre-r2; the alias consumer count was a bare number matching nothing it named |
| Doc 2 | ⛔ | The alias count moved rather than became derivable; stale test commentary now said the opposite of `/feasibility-study`'s new contract, and the invocation floor did not include it |
| Doc 3 | ⛔ | Three precision defects, no 🔴 |
| Doc 4 | ⛔ | Codex wrote "No 🔴" and the three findings were all narrative errors I had introduced while correcting the previous round; the test-pinning gap joined items 3–5 in § Deferred Findings |
| Doc 5 | ✅ Mergeable | The remaining findings were role misclassifications in my own correction — `fc-aggregator.js` writes a same-named snapshot field rather than reading the alias, and the instruction-surface row does not fall entirely because cross-link *filename* resolution is a legitimate legacy use of it. Codex also caught that the `[NIT_DEFERRED]` lines had been *printed* rather than persisted: that sentinel is parsed from a review tool's output, so a `printf` records nothing |
| Doc 6 | ⛔ | The rounds above were themselves recorded wrong: this history showed three doc rounds where the session transcript shows six, the Acceptance row's status and its note contradicted each other, and two bare consumer counts had survived the correction that was supposed to make them derivable |
| Doc 7 | ⛔ | The six-round chronology was unsupported by the only thread the reviewer can read; deferred item 1 named the wrong declaration location (the discarded demotion is one already read, not one past the abandon point); and the Review History introduction claimed a table shape the table does not have |
| Doc 8 | ⛔ | The pre-declared `*(pending)*` row did not terminate anything: after a passing verdict the file would sit permanently at "pending, gate open, box unchecked", moving the off-by-one from a missing row to a frozen one. The record's authority had to move out of the ticket. Also: "two rounds spent on the record" overstated what the table shows |

**The six rounds span two Codex threads, and that is why the count looks wrong from inside one of
them.** Doc 2–Doc 6 are five consecutive verdicts on thread `019febf4` (`⛔ ⛔ ⛔ ✅ ⛔`, 14:02–14:44
on 2026-08-10); Doc 1 ran before that thread existed. A reviewer reading only `019febf4` counts five
and is right about what it can see — the sixth is not in it. **This is an author-attributed work
record, not a repository-derived fact**: the repo holds no per-cycle receipt or timestamped
transcript that proves the earlier dispatch, so the claim is checkable only by someone with the
session transcript. Codex confirmed that the limitation being stated is what keeps it a usable
provenance note rather than an unfalsifiable one — and the missing receipt is itself the r3
requirement.

**Where this record is weak, and it is not the count.** Before the Doc 6 correction, the Doc 2 and
Doc 3 summaries both named a stale test comment contradicting `/feasibility-study`'s new contract.
The duplicated clause has been removed from Doc 3, because the surviving summaries cannot
substantiate which distinct comment that round identified. The two dispatches are distinct and
checkable in the thread; my *summaries* of them, written after the fact, are the reconstruction. The
rounds are the evidence.

**A review-history table inside the reviewed document cannot hold its own terminal verdict, and
rounds 6–8 are the proof.** Recording round N means editing the file under review, which re-opens the
doc gate and produces round N+1 whose findings the file does not record — so each reviewer correctly
reported the history as one round behind. Pre-declaring the in-flight round does not fix it either:
it terminates the *edits* while leaving the file asserting "pending, gate open" forever, which is the
same staleness pointing the other way.

**So this table is deliberately not the closure authority.** It records rounds that have **completed
and been read**; the terminal verdict is held by the doc-review receipt (`.claude_review_state.json`
→ `doc_review.passed`, `last_run`), which is written by the hook rather than by me and is the thing
the Stop gate actually reads. The last completed round is always the last row, the round in flight is
intentionally absent, and neither fact goes stale: a reader who needs the current gate state reads
the receipt, not this ticket.

Three of this ticket's doc rounds carried blocking findings **caused by the ticket's own review and
acceptance record** rather than by the change under review — each also carried a genuine
documentation defect, so the record was never the whole cost, but it was the recurring one. That is
r2 evidence for an r3 requirement: the per-cycle record has to live where writing it does not
re-open the thing it describes.

The persisted `doc_iteration_history` counter settles none of it: it is a cumulative aggregate
across r1 and r2 (`dispatches`/`verdicts`/`passes`/`blocks`) with no per-cycle records and no
timestamps — the same gap that makes r3's "≥ 10 cycles" acceptance criterion unverifiable as
written, and a concrete argument for r3 recording per-cycle entries rather than totals.

The `/feasibility-study` fix is the one worth carrying forward: the first attempt linked the shared
algorithm reference, and the pairing test refused it — that skill grants `Bash(bash:*)` and no node
permission, and the reference teaches the node entrypoint. The permission boundary was found by the
guard rather than by review, which is the whole point of having written it.

### Round 19 — `ATTENTION_DIFFUSION` diagnosis (round-cap budget, 1 of 1)

Nineteen rounds is past `standard`'s cap of 15, and the signature across rounds 17-19 is not the same
defect recurring — it is each round finding that the *previous* round's guard was weaker than its own
comment claimed. That is `ATTENTION_DIFFUSION`, and the bounded adjustment was declared before it was
made: **no new guard code; audit every assertion added since round 15 by deleting its subject and
confirming the test goes red.** Three had never been checked that way. Two were sound. The third —
the four-space CommonMark indented block — was not pinned at all: disabling the rule left every test
green. It is now pinned on supplied text, with the wrapped-list-continuation over-inclusion stated
rather than left to be rediscovered as a bug.

The audit is also why the segmentation and edge rules now take their text as an argument
(`segmentsIn`, `referencesIn`): a rule whose only evidence is the live corpus is pinned by whatever
the corpus happens to contain, which for three separate rules turned out to be nothing.

> **Thread change at round 17.** Rounds 10–16 ran on `019feae8`; two consecutive continuations of it
> were rejected by a content filter (the accumulated discussion of shell spellings reads as a
> security topic), and the rejection is not a Codex verdict. The review moved to a fresh session
> with a metadata-only brief, which is the same reviewer under the same contract — and the change of
> context is visible in the findings: round 17 raised nothing rounds 12–16 had circled.

### Round 14 — `ARCHITECTURE` diagnosis, and the one bounded adjustment

Three consecutive rounds (12, 13, 14) blocked on the *same* defect class at a new boundary:
`/usr/bin/bash`, then a quoted path, then an escaped dot / a constructed path / a process
substitution. Each fix removed one spelling and left the space of remaining spellings the same size.
Recorded as `[STALL_MEMORY] class=ARCHITECTURE`, and Codex named the remedy twice in round 14:
*use an allowlist rather than a growing denylist*, and *prohibit constructed paths explicitly so
they fail closed*.

The adjustment, declared before it was made and bounded to the detector plus the four files the
round's findings name: **the scanner is now an allowlist.** Any command context mentioning the
resolver must match one of four enumerated forms exactly — two canonical invocations, `/ask`'s
`Bash("node …")` tool-call step, and a fully-pinned mermaid arrow label. The argument tail is an
explicit character class rather than `.*`, so `|`, `;`, `&`, backtick and parentheses are excluded
by construction and `$(`, `<(`, `>(` need no rule of their own — **provided the placeholder
alternative is a language too**. It was not at first: `<[^<>]*>` re-admitted every excluded character
between the angle brackets, and round 16 found `<(printf x)> /dev/null` reading as one balanced
placeholder to the regex and as process substitution plus a redirect to the shell. The inner class
is now the finite set the repository uses (`<key>`, `<docs_path>`,
`<the feature key from $ARGUMENTS>`). Shell normalization (quote and
backslash removal) runs first, so a spelling that *is* the permitted command is recognized and then
refused by the permission rule. A resolver path bound to a variable is banned outright — it is the
one construction no text-level scanner can follow.

Seven mutations verify round 14, each red: escaped dot, constructed path, process substitution in an
arrow label, a pipeline appended to a permitted command, `/usr/bin/bash`, a direct CLI call, and the
`SKILL.md` graph hop. The regression bank in `test/skills/scan-error-gate.test.js` now carries every
spelling from rounds 12–14 as data, so the evidence outlives the fix that closed it.

**Round 13 is where the loop's own shape became the finding.** Rounds 10–13 all blocked on the
guard rather than on the feature, and each round the guard grew a new rule to refuse a new spelling.
Codex's fourth finding named why that could not converge: *arbitrary prose cannot provide a
mechanically reliable non-execution guarantee.* So round 13's fix is structural rather than
another rule — the `> **Non-executing reader**:` mechanism is **deleted**, and the mismatch it
existed to excuse is gone from the graph (see the `/tech-spec` row in Related Files). The three
parsing findings were fixed by normalising before classifying (shell quote removal), by requiring an
arrow label to be *inert*, and by widening the prose detector's boundary to any non-word character.

Six mutations verify round 13, each red: a quoted path, a path split by adjacent empty quotes, an
arrow label carrying a command substitution, an HTML `<code>` invocation, a Markdown link-label
invocation, and a prose reversal of `/tech-spec`'s intent. Round 12's four mutations
(`/usr/bin/bash` in a real fence, the same inside a `mermaid` fence, the same after an unclosed
fence, an unformatted prose invocation) remain red. Three of Codex's original round-12 mutations are
**not** claimed — they were written against the pre-rewrite scanner and did not apply.

## References

- Tech Spec: [Doc Review Phasing](../2-tech-spec.md) § 3.1–3.2, § 4 Steps 2–3
- Sibling: [r1 — upfront gates](./2026-08-09-doc-review-cost-r1.md)
- Sibling: [r3 — cheap review path](./2026-08-09-doc-review-cost-r3.md)
