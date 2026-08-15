# README Skill Catalog Auto-Sync

> **Created**: 2026-04-07
> **Status**: In Progress
> **Priority**: P2
> **Tech Spec**: [Tech Spec](../2-tech-spec.md)

## Background

README 聲稱 87 skills 但實際有 90 個，catalog 只列出 76 個，14 個 skills 完全未出現。每次新增 skill 需手動更新 8+ files（README + CLAUDE.md + CLAUDE.template.md + 5 locale），導致 systemic drift。需要建立 single source of truth 和自動產生機制。

## Requirements

- 建立 `docs/skill-catalog.yml` manifest（90 entries: category/featured/use_when/public + optional description override）
- 建立 `scripts/generate-readme-catalog.js` 從 manifest + SKILL.md frontmatter 產生 README blocks
- 在 README.md 加入 comment markers（hero count + what's included + install coverage + essential + full catalog）
- Essential Skills 區段加入 `Use when` 欄位
- Description 從 SKILL.md frontmatter 衍生，manifest 提供 optional override

## Scope

| Scope | Description |
|-------|-------------|
| In | `skill-catalog.yml` manifest、generator script、README.md comment markers、Essential section 改進、tests、run `/readme-i18n-sync` to propagate to 5 locale READMEs |
| Out | CI auto-trigger for re-generation（v2）、CLAUDE.md auto-sync（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `docs/skill-catalog.yml` | New | Skill catalog manifest (90 entries) |
| `scripts/generate-readme-catalog.js` | New | README block generator from manifest |
| `README.md` | Modify | Add comment markers, fix counts, update catalog |
| `test/scripts/generate-readme-catalog.test.js` | New | Generator contract + integration tests |

## Acceptance Criteria

- [ ] AC1: `docs/skill-catalog.yml` has entries for all `skills/` directories — generator emits warnings for mismatches (missing entries or orphaned entries) per tech spec §3.4 validation
- [x] AC2: Generator produces correct counts matching `public: true` skill count in hero, what's included, install coverage, and `<summary>` locations
- [x] AC3: Essential Skills table uses 2-column format (`Skill | Use when`) with 12-15 `featured: true` entries
- [x] AC4: Full catalog uses grouped 2-column tables per category with per-category counts; Review category preserves 3-column `Loop Support` table per tech spec §3.3
- [x] AC5: Description derived from `SKILL.md` frontmatter by default; manifest `description` used only as override
- [x] AC6: Generator is idempotent (running twice produces identical output)
- [x] AC7: README.md contains all 5 BEGIN/END comment marker pairs (HERO-COUNT, WHATS-INCLUDED-COUNT, INSTALL-COVERAGE, ESSENTIAL-SKILLS, FULL-CATALOG)
- [x] AC8: No unmanaged `\d+ skills` strings remain in README outside comment markers
- [x] AC9: `skill-catalog.yml` passes YAML validation + all `category` values match defined `categories[].id`
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best practices audit + adversarial debate completed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 8/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

**Status**: In Progress

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Best Practices Audit: conversation record (2026-04-07, debate threadId: 019d6713-2caf-77b3-96f9-6be7d8ca9adc)
- Reused infrastructure: `skills/*/SKILL.md` frontmatter (90/90 have description), `/readme-i18n-sync` skill
