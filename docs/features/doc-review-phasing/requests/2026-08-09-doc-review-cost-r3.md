# Cheap doc-review path, Doc Sync contract, and prune-first

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-09
> **Status**: Pending
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
- Deterministic checks (link/anchor resolution) run before the LLM and feed it only failures
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
| `scripts/check-doc-links.js` | New | Repo-relative target + local fragment resolution; skip external URLs and templated placeholders |
| `skills/doc-review/SKILL.md` + `references/codex-prompt-doc.md` + `references/review-loop-doc.md` | Modify | Profiles, section-scoped reading, batched dispatch, deterministic checks first |
| `skills/feature-dev/SKILL.md` | Modify | Retire "per updated file"; Doc Sync targets current-authority docs only |
| `rules/auto-loop.md` | Modify | Replace the Doc Sync sentence (Default tier) |
| `rules/docs-numbering.md`, `rules/docs-writing.md` | Modify | Prune / merge first, alongside splitting |
| `skills/tech-spec/SKILL.md`, `skills/create-request/SKILL.md` + templates | Modify | Write-time budgets |
| `docs/features/doc-review-phasing/4-implementation.md` | New | The feature's current-authority record of what shipped — nothing else creates it (`/update-docs` syncs an existing target, it does not author a missing one) |
| `scripts/config/doc-taxonomy.json` | Modify | Owns the review-budget keys (12 files / 200,000 bytes) alongside the § 3.1 path defaults r2 adds |
| `test/scripts/resolve-review-profile.test.js`, `test/scripts/check-doc-links.test.js` | New | Escalation, batch budget, path containment and checker behaviour |

## Acceptance Criteria

- [ ] A shallow profile whose diff touches an out-of-whitelist `##` section escalates to `full-design`
- [ ] Escalation to `full-design` on any of: a `scripts/config/sensitive-paths.json` hit; `--tier thorough`; a missing or unparseable `--tier` — including a semantic security change on a generic path with **zero** path hits (Anchor Register #3)
- [ ] A within-budget multi-doc change produces exactly one dispatch carrying **per-file** profiles; a `record-diff` file keeps its exemption from code-alignment questions even when another file in the same batch escalated; an over-budget plan splits **loudly** and every emitted batch is itself within budget, except a reported single-file batch whose one file exceeds 200,000 bytes — group by feature folder (`.md` outside `docs/features/**` in one final `(root)` group), then chunk each group in path order; a 25-file feature folder yields several batches, and a single file over 200,000 bytes forms its own batch and is reported rather than skipped. Union of batches = the full changed set
- [ ] The budget is a stated, configurable pair — default 12 files / 200,000 bytes, whichever is hit first, owned by `scripts/config/doc-taxonomy.json` — with an inclusive-boundary test on each limit (12 files and exactly 200,000 bytes stay in one batch; the 13th file and the 200,001st byte open the next)
- [ ] Link checker: dead relative link and dead fragment detected; valid fragment, external URL and templated placeholder pass; `..` traversal and symlink-escape targets rejected via `realpath` repository containment; it is advisory input, not a gate
- [ ] The Doc Sync sentence is replaced coherently across `rules/auto-loop.md` and the skills, with no surviving "per updated file"; Anchor rows verified intact against `test/rules/discretion-tiers.test.js`
- [ ] A completed request produces a freeze action or a stated reason; new docs conform to the write-time budgets
- [ ] `4-implementation.md` exists and records what shipped; measurement reported against r1's baseline — which must cover **at least 10 completed doc cycles collected before this ticket's first edit lands** — covering dispatches/cycle, bytes/dispatch, profile mix and dispatch-to-verdict loss, before any § 5 machinery is proposed
- [ ] Pass `/codex-review-fast` and `/precommit` (code plane), `/codex-review-doc` (doc plane)

## Progress

| Phase | Status | Note |
| ---- | ------ | ---- |
| Analysis | Done | Design converged 2026-08-09 (see `2-tech-spec.md` § Provenance) |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- Tech Spec: [Doc Review Phasing](../2-tech-spec.md) § 3.3–3.4, § 4 Steps 4–6
- Sibling: [r1 — upfront gates](./2026-08-09-doc-review-cost-r1.md)
- Sibling: [r2 — authority classification](./2026-08-09-doc-review-cost-r2.md)
