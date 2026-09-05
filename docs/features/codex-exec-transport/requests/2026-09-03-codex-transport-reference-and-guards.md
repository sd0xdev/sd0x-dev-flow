# codex-transport reference, Codex Profile setting and negative guards

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-09-03
> **Status**: Candidate Complete
> **Note**: Work item 2 of 6 in the tech spec's § 5. Pure instruction-surface work: one reference, two rule touches, three tests. Nothing calls the adapter yet; the guards start with an allowlist that items 3–5 shrink to empty.
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- § 3.3 and § 3.4 are the contract this ticket implements
> **Depends On**: [codex-exec adapter and fake-CLI tests](./2026-09-03-codex-exec-adapter-and-fake-cli-tests.md)
> **Intent**: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md) <- INV-001, INV-005, INV-006 bind this ticket

## Background

INV-001 requires one transport authority: a single reference that spells the invocation, file,
completion and profile contracts, with every future call site citing it instead of restating it —
the mirror-drift lesson from the opportunistic-fix-envelope loop. The guards that keep it single
must exist before the first skill is converted.

## Requirements

- `skills/codex-code-review/references/codex-transport.md` with the six sections of spec § 3.3:
  Locator (auto-install cascade, `protocol_mismatch` → explicit `--force`, preflight before the
  scope baseline freezes), Files (per-dispatch lifecycle), § Alloc / § Start / § Resume / § Cleanup
  (the only place the command lines are spelled; § Start names `codex-implement` as the sole
  `--class implement` owner), Completion state machine (`start`/`resume` only), Profile, Permission.
- `rules/codex-invocation.md`: one pointer line to the reference; "MCP thread" → "exec thread",
  and the tool name that opens § Loop review exception (`mcp__codex__codex-reply`) becomes
  "§ Resume on the same thread" — the sentence's anti-anchoring meaning is byte-preserved, the
  carrier name is not (Guard 2 forbids the token in `rules/` once item 5 empties the allowlist).
- `rules/auto-loop.md` § Override Contract: row `## Codex Profile` — Setting — consumed by
  `codex-transport.md` § Profile — Default; matching heading in `rules/auto-loop-project.md`.
- Three negative guards (spec § 3.4), each self-tested by planting the forbidden token in a fixture.

## Scope

| Scope | Description |
| ----- | ----------- |
| In | The reference, the two rule edits, the project-override heading, the three guard tests with their initial allowlists |
| Out | Converting any skill or prompt template (items 3–4); README (item 5); a tier→profile map (non-goal); any change to `review-dispatch.js`, `validate-family-sentinel.js`, the Degradation Matrix or rotation thresholds |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/codex-code-review/references/codex-transport.md` | New | The sole invocation/orchestration contract |
| `rules/codex-invocation.md` | Modify | Pointer + terminology; anti-anchoring text untouched |
| `rules/auto-loop.md` | Modify | `## Codex Profile` row in § Override Contract |
| `rules/auto-loop-project.md` | Modify | Empty `## Codex Profile` heading |
| `test/skills/codex-transport.test.js` | New | Section pins, state-machine sentences, `--class implement` ownership guard |
| `test/rules/codex-transport-guards.test.js` | New | No operational `codex exec` line outside the allowlist; no `mcp__codex` in active surfaces. The initial Guard 2 allowlist is an **inventory of the paths still carrying the token after this ticket** — 33 `skills/*/SKILL.md` (31 grantees plus `best-practices` and `seek-verdict`, which mention it without a grant), the reference/prompt files, `skills/sharingan/scripts/scan-repo.js` and its two references; **not** `rules/codex-invocation.md`, which this ticket cleans — and the test asserts the allowlist **equals** the set of token-bearing paths (a stale entry fails it, so each later ticket must shrink it; item 5 empties it) |
| `test/rules/override-contract.test.js` | Modify | The exact mapping-table and scaffold-heading inventory (its "Override Contract" rows and `auto-loop-project.md` heading list) gains `## Codex Profile` |

## Acceptance Criteria

- [x] `codex-transport.md` carries all six § 3.3 sections; § Alloc/Start/Resume/Cleanup reproduce the § 3.2 argv verbatim and are the only markdown in `skills/`, `agents/`, `rules/` containing an operational `codex exec` line
- [x] The completion state machine is scoped to `start`/`resume` and states that `alloc`/`cleanup` failures never call `review-dispatch.js`, never set the probe and never count as a Codex outcome; the background rule "launched ⇒ pending, unknown completion keeps the gate open" is present verbatim
- [x] § Profile states "not tier-dependent in v1" and reads `## Codex Profile`; `rules/auto-loop.md` § Override Contract has the row with `codex-transport.md` as consumer and `rules/auto-loop-project.md` has the heading; `test/rules/override-contract.test.js`'s exact row and heading inventories are extended and pass
- [x] `rules/codex-invocation.md` diff is limited to the pointer, the thread terminology and the § Loop review exception carrier name — a pin over its § Prohibited patterns table and over the exception's anti-anchoring clauses ("providing the new diff is fine", "scoped to the thread, never to the task", "Did the fixes introduce new issues?") passes, and `mcp__codex__codex-reply` no longer appears in the file
- [x] Guard 1 (no `codex exec` command line outside `codex-transport.md`, `scripts/codex-exec.js`, `test/**/codex-exec*`) and Guard 2 (no `mcp__codex` token in active surfaces outside its path-inventory allowlist) fail on a planted token and pass on the tree
- [x] Guard 3 proves `--class implement` appears only in `codex-transport.md` § Start and under `skills/codex-implement/`, and fails when planted anywhere else — the reference is allow-listed by name so the sole command-line authority does not fail its own guard
- [x] `npm test` passes; no skill's behaviour changes (no `SKILL.md` or prompt template is edited by this ticket)
- [x] Pass `/codex-review-doc` — re-opened by the § Locator amendment (Anchor Register #6), then
  closed again: `contract-neutral-reviewer` (fallback, Codex out of quota — `[REVIEWER_FALLBACK]
  plane=doc_review from=codex to=contract-neutral-reviewer reason=quota`) returned `✅ Mergeable`
  on the batch this ticket's file belongs to, at digest `sha256:4111d439…`, noted
- [x] Pass `/codex-review-fast` → `/precommit` — re-opened by the same amendment, then closed:
  `strict-reviewer` (fallback, same reason) returned `✅ Ready`; `/precommit` returned
  `## Overall: ✅ PASS`. Both noted at code-plane digest `sha256:0340ac88…`. At the moment the last
  of these three notes was made, `review-state.js check` reported `digest_match:true, owed:false`
  on all three planes. **This sentence, and every edit that added it, is itself a doc-plane change**
  — the ticket recording its own closure re-opens the plane it describes, which is why no wording
  here can claim a *current* state without becoming false the instant it is written. Read the AC
  boxes above as the point-in-time record of what closed the round that preceded this text, not as
  a live status — for the live status, run `review-state.js check` yourself

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Sections and guards fixed by spec § 3.3–3.4 and the brainstorm equilibrium (E, H, I) |
| Development | Done | `codex-transport.md` (9 sections); `codex-invocation.md` carrier-neutral with every anti-anchoring clause intact; `## Codex Profile` row in `auto-loop.md` § Override Contract (+ the byte-pinned table string and both inventories in `override-contract.test.js`) and the scaffold heading; 47 guard tests + 36 contract pins |
| Testing | Done | `npm test` 4,356 / 4,348 pass / 0 fail / 8 skipped. `/precommit` `## Overall: ✅ PASS`. Every new pin mutation-tested against the production path (revert → red, restore → green) |
| Acceptance | Candidate Complete | Reopened 2026-09-04 by the § Locator amendment (Anchor Register #6); closed again 2026-09-05 by a fresh fallback round on both planes, noted at the resulting digest — code `sha256:0340ac88…`, doc `sha256:4111d439…`. That note was true when made; this row's own existence is a later edit to the same doc-plane file, so the honest status of "is the doc plane owed right now" is whatever the current `review-state.js check` says, not whatever this sentence claims — see the caveat at the end of the Acceptance Criteria list above. Everything else in this row is the 2026-09-03 record for the rest of this ticket's scope and stands unchanged: the code plane took eleven rounds and one thread rotation (`[THREAD_ROTATED] plane=code_review old=01a06801-b45e-7af2-979c-b3d92962b99f new=01a0682e-20aa-7252-8f9b-f0c6dd33a8d9 reason=rounds`), and the length was earned rather than churned — **three** doc-review rounds each found a real code defect the code plane had passed over (the `0600` guarantee failing on error paths, a process-wide `umask(077)` leaking into implement-class workspace output, and a create-mode silently masked by the ambient umask, measured: `umask 277` → `0400`), after which the doc review returned `✅ Mergeable` with no findings, and a final bookkeeping-only round validated this record. Two structural corrections came out of it: the transport guards moved from shape-matching to closed membership predicates, and § Files replaced an unachievable "unconditional 0600" promise with a layered contract that states each layer's limit. `Candidate Complete` rather than `Completed`: no `--verify-ac` closure run |

## Reopened by item 6's acceptance (2026-09-04)

Item 6's consuming-project run found § Locator step 2 unable to resolve the adapter in a **versioned
marketplace cache**. The glob was `~/.claude/plugins/**/sd0x-dev-flow/scripts/codex-exec.js`, reused
as-is from `precommit-fast` § Step 1; it requires `scripts` to be an immediate child of the plugin
directory, and `cache/<marketplace>/<plugin>/<version>/scripts/…` interposes a version segment.
Measured with `fs.globSync` over three fixtures, with a positive control so the negative means
something:

| Layout | One-sided glob | Corrected glob |
|--------|----------------|----------------|
| `marketplaces/<m>/plugins/sd0x-dev-flow/scripts/` | match | match |
| `cache/<m>/sd0x-dev-flow/scripts/` | match | match |
| `cache/<m>/sd0x-dev-flow/<version>/scripts/` | **`[]`** | match |

Fixed here because this item owns `codex-transport.md` and item 6's Scope Out row routes any fix its
acceptance uncovers back to the owning item. § Locator step 2 now globs
`plugins/**/sd0x-dev-flow/**/scripts/codex-exec.js`, and **more than one match is an ambiguity**
— several installed versions, none of them knowably current — so the cascade takes step 4 and asks
the operator to install rather than guessing. That is the same conclusion the redactor resolution in
`codex-implement` reached independently, and the reason it is written down twice is that the first
time it was learned it was not carried across.

`skills/precommit-fast/SKILL.md` § Step 1 carries the identical one-sided glob for
`precommit-runner.js` and has the identical gap. It is **out of this change's frozen baseline** —
untouched by this feature — so it is recorded here rather than swept:

The predicate, so the follow-up is scoped to the class and not to the one site this run happened to
hit — `grep -rn 'plugins/\*\*/sd0x-dev-flow/' --include='*.md' skills/ | grep -v 'sd0x-dev-flow/\*\*'`
returns **five** sites in **three** files, every one of them requiring an immediate child and so
missing a versioned cache identically. Both fallback reviewers found the same five independently:

```
[OUT_OF_SCOPE_DEFERRED] skills/precommit-fast/SKILL.md:43 | one-sided plugin glob cannot resolve precommit-runner.js in a versioned marketplace cache — the same defect § Locator just fixed; also skills/project-setup/SKILL.md:157,261,360 and skills/claude-health/SKILL.md:145, five sites in three files by the grep above | suggested-ticket: widen every plugin-copy glob to the two-sided form and add the versioned-cache layout to their fixtures | 2026-09-04T16:20:00Z
```

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.3, § 3.4, § 5 item 2
- Intent: [intent-codex-exec-transport.md](../intent-codex-exec-transport.md)
- Precedent: `skills/precommit-fast/SKILL.md` § Auto-install attempt; `skills/create-pr/SKILL.md` "one canonical shell shape" principle
