# Repo Rename Sync — sd0x-dev-flow → sd0x-harness

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-08-16
> **Status**: In Progress
> **Note**: No 2-tech-spec exists for this feature; the design source is the 2026-08-16 rename impact analysis (Codex blind verdict, confidence 0.94). Supersedes the zero-rename constraint recorded in `../1-requirements.md` — that record stays frozen as-is.
> **Priority**: P1
> **Requirements**: [1-requirements.md](../1-requirements.md) <- Feature-level rationale (records the earlier decision NOT to rename; this ticket executes the rename that decision deferred)

## Background

The GitHub repository was renamed `sd0xdev/sd0x-dev-flow` → `sd0xdev/sd0x-harness` (GitHub side only). Old-slug URLs survive via GitHub redirect, but third-party consumers (star-history query params, banner artwork) do not, and canonical locators in the repo are now stale. The plugin/package identity `sd0x-dev-flow` is **not** renamed — only repository locators change.

## Requirements

- Update every GitHub repository locator (`sd0xdev/sd0x-dev-flow`) to `sd0xdev/sd0x-harness` in live docs, install commands, and marketplace source metadata
- Replace assets that bake in the old slug and cannot follow redirects (banner artwork, star-history parameters)
- Keep plugin identity untouched: `"name": "sd0x-dev-flow"` in plugin.json/package.json, `sd0x-dev-flow@sd0xdev-marketplace`, `/sd0x-dev-flow:*` namespace, `~/.cache/sd0x-dev-flow/` and other namespaced paths
- Smoke-test that the new slug installs (new-slug consumer resolution was not empirically verified during analysis)

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | Repo-slug references in 6 READMEs, CHANGELOG, marketplace.json source.repo, 2 SKILL.md install commands, 2 live tech-specs, banner.jpg |
| Out   | Plugin/package/product rename (separate breaking migration if ever wanted); `docs/features/` records (frozen); `release.yml`/`ci.yml` (auto-adapt via `${{ github.repository }}`); cache/state/config dirs (plugin-namespaced); local-machine steps (listed below, not repo changes) |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `README.md` + 5 locale READMEs | Modify | banner raw URL, `marketplace add`, `npx skills add`, star-history `repos=` ×4 each (3 image URLs + 1 URL-encoded click-through href) |
| `banner.jpg` | Replace | Artwork bakes in old slug bottom-right; needs regenerated asset |
| `.claude-plugin/marketplace.json` | Modify | `plugins[0].source.repo` only; `name`/`owner` fields unchanged |
| `CHANGELOG.md` | Modify | GitHub Releases link |
| `skills/codex-setup/SKILL.md`, `skills/project-setup/SKILL.md` | Modify | 2 files, 3 command occurrences (1 + 2); keep `sd0x-dev-flow@sd0xdev-marketplace` |
| `docs/features/cross-tool-portability/2-tech-spec.md`, `docs/features/statusline-config/2-tech-spec.md` | Modify | Live install-command examples (current-authority docs, not records) |

## Acceptance Criteria

- [ ] `banner.jpg` no longer displays `sd0xdev/sd0x-dev-flow` (asset regenerated or slug text removed)
- [x] All 6 READMEs: star-history `repos=` parameter → `sd0xdev/sd0x-harness` (4 references per file: 3 image URLs + 1 URL-encoded `repos=sd0xdev%2F...` click-through href — the encoded form was caught by doc review round 1)
- [x] All 6 READMEs: banner raw URL, `/plugin marketplace add`, `npx skills add` → new slug; `sd0x-dev-flow@sd0xdev-marketplace` line unchanged
- [x] `.claude-plugin/marketplace.json` `source.repo` → `sd0xdev/sd0x-harness`; plugin `name` stays `sd0x-dev-flow`
- [x] `CHANGELOG.md` Releases link → new slug
- [x] `skills/codex-setup/SKILL.md` and `skills/project-setup/SKILL.md` install commands → new slug, plugin identity untouched
- [x] Both live tech-specs (cross-tool-portability, statusline-config) install commands → new slug
- [ ] Smoke test: `/plugin marketplace add sd0xdev/sd0x-harness` and `npx skills add sd0xdev/sd0x-harness` both resolve
- [x] Pass /codex-review-doc (READMEs, CHANGELOG, SKILL.md, tech-specs — 5 batches, all ✅ Mergeable; batch 5 converged at round 7)
- [x] Pass /codex-review-fast + /precommit (marketplace.json) — /precommit ✅ PASS (2026-08-16, re-run after final test edits); marketplace.json itself carried zero findings across 6 review rounds; code gate closed ✅ Ready (gate_reason=NONE) at round 6 after the loop also hardened the push-guard surfaces it surfaced mid-review (push-ci/epic-merge protected-branch refusals; `rules/git-workflow.md` push-safety credential paragraph byte-pinned in `test/rules/discretion-tiers.test.js`, verified by executed mutation probes) — security-escalated to thorough
- [x] `grep -rnE 'sd0xdev(/|%2F)sd0x-dev-flow'` (plain **and** URL-encoded) over `README*.md`, `CHANGELOG.md`, `skills/`, `.claude-plugin/`, `docs/features/cross-tool-portability/2-tech-spec.md`, and `docs/features/statusline-config/2-tech-spec.md` returns **zero** matches
- [x] Remaining `sd0xdev/sd0x-dev-flow` matches under `docs/features/` are audited and belong only to frozen records (request tickets, superseded requirements) — no live current-authority doc among them

## Local-Machine Steps (not repo changes — operator checklist)

- [ ] `git remote set-url origin https://github.com/sd0xdev/sd0x-harness.git`
- [ ] Refresh `~/.claude/plugins/known_marketplaces.json` + marketplace checkout remote (re-register or edit)
- [ ] Never recreate a repo at the old `sd0xdev/sd0x-dev-flow` path — it would kill all redirects

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-16 impact analysis: 2 must-change (banner, star-history), ~15 files should-change; Codex blind verdict confidence 0.94 |
| Development | Done | 12 text files replaced (2026-08-16); banner regeneration prompt delivered — banner.jpg asset itself pending, user to AI-generate. Review loop also hardened protected-branch × force-with-lease refusals in `skills/push-ci/SKILL.md` and `skills/epic-merge/SKILL.md` (+ regression tests) and byte-pinned the `rules/git-workflow.md` push-safety credential paragraph — in-scope findings surfaced by the gate, security-escalated to thorough; code review ✅ Ready at round 6 |
| Testing | Done | grep zero-match + frozen-record audit pass; `git ls-remote` resolves both slugs (same HEAD); `npm test` 3710 pass / 0 fail; `/precommit` ✅ PASS; runtime install smoke (`/plugin marketplace add` + `npx skills add`) still user-owned |
| Acceptance | In Progress | Doc gate ✅; code gate ✅ (round 6, gate_reason=NONE); remaining: banner asset regeneration + runtime install smoke test — both user-owned |

## References

- Requirements: [1-requirements.md](../1-requirements.md) (records the earlier zero-rename decision this ticket supersedes)
- Related Request: [2026-04-12-harness-engineering-rebrand.md](./2026-04-12-harness-engineering-rebrand.md)
