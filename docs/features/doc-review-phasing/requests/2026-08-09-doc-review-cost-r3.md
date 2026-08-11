# Cheap doc-review path, Doc Sync contract, and prune-first

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-09
> **Status**: Candidate Complete
> **Note**: Third of three siblings (r1 → r2 → r3). This is the causal fix; it needs r2's classification to resolve profiles and r1's counters to have been running long enough to constitute a baseline.
> **Depends On**: [r1 — upfront gates and baseline](./2026-08-09-doc-review-cost-r1.md) · [r2 — authority classification](./2026-08-09-doc-review-cost-r2.md)
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- Technical detail (primary source)

## Background

A 3-line edit to a 500-line document triggers a whole-document five-dimension review; each
fix re-opens the gate and the next round re-reads the whole file
(`skills/doc-review/references/codex-prompt-doc.md:21`). `feature-dev` Doc Sync then runs
`/codex-review-doc` **per updated file**. Meanwhile `rules/auto-loop.md`'s Doc Sync sentence
asks for design records to be re-aligned to code they never described, and
`rules/docs-numbering.md` states the remedy for bloat is "splitting, never deleting
content" — the line under which 241 feature docs were added and 0 removed.

## Requirements

- Review depth follows the artifact's role and the producer's declared intent, never session state
- A shallow profile is granted only when the diff supports it; escalation is deterministic and happens **before** the prompt is built
- Deterministic checks (file-link resolution) run before the LLM and feed it only failures
- All changed `.md` in one change are reviewed under **one logical review plan** — one physical dispatch while the plan is within the file/byte budget, and a loud, deterministic split into batches that are each themselves within budget when it is not — the sole exception being a reported single-file batch whose one file exceeds the byte limit
- Doc Sync stops asking for records to mirror subsequent code; completed requests are frozen
- Pruning and merging become first-class remedies for bloat, alongside splitting

## Scope

| Scope | Description |
| ----- | ----------- |
| In | Five review profiles; `scripts/resolve-review-profile.js`; `scripts/check-doc-links.js`; batched dispatch; Doc Sync contract rewrite; request freezing; prune-first rules; write-time budgets; the § 4 Step 6 measurement |
| Out | The deferred recall machinery (`2-tech-spec.md` § 5); any bulk backfill of role banners; new gates, new sentinels, new `[AUTO_LOOP_STATE]` fields |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/resolve-review-profile.js` | New | Resolve profile from classification + requested intent + `git diff`; escalate on whitelist miss, sensitivity, or unknown role |
| `scripts/check-doc-links.js` | New | Repo-relative file-target resolution; skip external URLs, templated placeholders and heading fragments |
| `skills/doc-review/SKILL.md` + `references/codex-prompt-doc.md` + `references/review-loop-doc.md` | Modify | Profiles, section-scoped reading, batched dispatch, deterministic checks first |
| `skills/feature-dev/SKILL.md` | Modify | Retire "per updated file"; Doc Sync targets current-authority docs only |
| `rules/auto-loop.md` | Modify | Replace the Doc Sync sentence (Default tier) |
| `rules/docs-numbering.md`, `rules/docs-writing.md` | Modify | Prune / merge first, alongside splitting |
| `skills/tech-spec/SKILL.md`, `skills/create-request/SKILL.md` + templates | Modify | Write-time budgets |
| `docs/features/doc-review-phasing/4-implementation.md` | New | The feature's current-authority record of what shipped — nothing else creates it (`/update-docs` syncs an existing target, it does not author a missing one) |
| `scripts/config/doc-taxonomy.json` | Modify | Owns the review-budget keys (12 files / 200,000 bytes) alongside the § 3.1 path defaults r2 adds |
| `test/scripts/resolve-review-profile.test.js`, `test/scripts/check-doc-links.test.js` | New | Escalation, batch budget, path containment and checker behaviour |

## Acceptance Criteria

- [x] A shallow profile whose diff touches an out-of-whitelist `##` section escalates to `full-design`
- [x] Escalation to `full-design` on any of: a `scripts/config/sensitive-paths.json` hit; `--tier thorough`; a missing or unparseable `--tier` — including a semantic security change on a generic path with **zero** path hits (Anchor Register #3)
- [x] A within-budget multi-doc change produces exactly one dispatch carrying **per-file** profiles; a `record-diff` file keeps its exemption from code-alignment questions even when another file in the same batch escalated; an over-budget plan splits **loudly** and every emitted batch is itself within budget, except a reported single-file batch whose one file exceeds 200,000 bytes — group by feature folder (`.md` outside `docs/features/**` in one final `(root)` group), then chunk each group in path order; a 25-file feature folder yields several batches, and a single file over 200,000 bytes forms its own batch and is reported rather than skipped. Union of batches = the full changed set
- [x] The budget is a stated, configurable pair — default 12 files / 200,000 bytes, whichever is hit first, owned by `scripts/config/doc-taxonomy.json` — with an inclusive-boundary test on each limit (12 files and exactly 200,000 bytes stay in one batch; the 13th file and the 200,001st byte open the next)
- [x] Link checker: dead relative link detected; external URL and templated placeholder pass; `..` traversal and symlink-escape targets rejected via `realpath` repository containment; it is advisory input, not a gate. **Heading fragments are out of scope** (owner's decision, 2026-08-10, after 11 review rounds): `[x](#frag)` is dropped uncounted, `[x](./a.md#frag)` is checked as a link to `a.md`. The measured basis — 0 fragment findings across 544 documents while the anchor side produced 4 of 6 blocking findings in round 11 — is in `../4-implementation.md` § 1.7 Round 11
- [x] The Doc Sync sentence is replaced coherently across `rules/auto-loop.md` and the skills, with no surviving "per updated file"; Anchor rows verified intact against `test/rules/discretion-tiers.test.js`
- [x] A completed request produces a freeze action or a stated reason; new docs conform to the write-time budgets
- [x] `4-implementation.md` exists and records what shipped, and reports the r1 baseline **against the figures `doc_iteration_history` actually holds** — cumulative `dispatches`, `verdicts`, and the dispatch-to-verdict loss derived from them (18 dispatches / 2 verdicts = 89% loss at the time of writing) — before any § 5 machinery is proposed. Rewritten from the original per-cycle wording (dispatches/cycle, bytes/dispatch, "10 completed doc cycles", profile mix) on the owner's decision, 2026-08-10: r1 shipped a cumulative aggregate with no per-cycle records and no byte or profile fields, so those four quantities are not derivable from any counter this feature ships, and an AC no instrument can answer is a permanently open gate rather than a measurement. Per-cycle measurement is deferred with § 5. See `../4-implementation.md` § 2
- [x] Pass `/codex-review-fast` and `/precommit` (code plane), `/codex-review-doc` (doc plane) — code plane `✅ Ready` (round 21, zero findings) + `## Overall: ✅ PASS`, both after the last code edit; doc plane `✅ Mergeable` on its second round; Adequacy Gate `Adequate` with zero gaps for both r2 and r3. **This box is not the closure authority and cannot be** (same caveat as r2's): it is edited by the same act that re-opens the doc gate, so the terminal verdict is the receipt's (`.claude_review_state.json`), which the Stop gate reads

## Progress

| Phase | Status | Note |
| ---- | ------ | ---- |
| Analysis | Done | Design converged 2026-08-09 (see `2-tech-spec.md` § Provenance) |
| Development | Done | Two scripts, five profiles, batch budget, Doc Sync contract, freeze, prune-first, write-time budgets |
| Testing | Done | 161 cases across the three files this ticket owns (101 link checker + 43 profile resolver + 17 doc-review skill); full suite green after every round — final figures in `../4-implementation.md` § 3 |
| Acceptance | Done | Rewritten AC 8 satisfied — the original per-cycle wording was retired as unmeasurable on the owner's decision (see its note). Quality gates green at the time of this row: code `✅ Ready` (round 21) + precommit `✅ PASS`, doc `✅ Mergeable` (round 2), AC-trace `Adequate` / no gaps for r2 and r3. The live verdict is the receipt's, not this row's |

**Status**: Candidate Complete — all AC checked with the quality gates green at the behaviour layer; `Completed` is reserved for a closure-grade verification (`/create-request --update --verify-ac` with all-High confidence), which has not run. The change is one uncommitted working tree shared with r2, so the freeze action follows the commit, not this row

## References

- Tech Spec: [Doc Review Phasing](../2-tech-spec.md) § 3.3–3.4, § 4 Steps 4–6
- Sibling: [r1 — upfront gates](./2026-08-09-doc-review-cost-r1.md)
- Sibling: [r2 — authority classification](./2026-08-09-doc-review-cost-r2.md)
