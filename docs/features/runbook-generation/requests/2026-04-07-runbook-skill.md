# Runbook Generation Skill

> **Created**: 2026-04-07
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [Tech Spec](../2-tech-spec.md)

## Background

sd0x-dev-flow 有 60+ feature 文件但無 operational documentation。開發者和 SRE 上線功能時缺乏標準化 runbook，部署步驟散落在多個 skill 中，無統一的 pre-deployment checklist、rollback 程序或監控指引。

## Requirements

- 建立 `/runbook` skill，支援 create / update / check 三種模式
- 標準化 9 區段 runbook 模板（Release Summary → SRE Quick Ref → Scope → Preconditions → Deployment → Verification → Monitoring → Rollback → Open Risks）
- 整合 feature resolver (`resolve-feature-cli.js`) 自動定位 feature context
- 使用 scoped discovery cascade 從 canonical docs + request docs + codebase 提取內容
- 嵌入 provenance manifest 支援 `--check` mode staleness 偵測
- 同步更新 `rules/docs-numbering.md` 正式化 ancillary semantic naming

## Scope

| Scope | Description |
|-------|-------------|
| In | `/runbook` skill (SKILL.md + references)、docs-numbering rule update、static contract tests |
| Out | Incident response runbook (v2)、`sync_handler` implementation (v2)、auto-trigger on doc-sync (v2) |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/runbook/SKILL.md` | New | Skill definition with frontmatter, workflow, modes |
| `skills/runbook/references/template.md` | New | 9-section runbook template with provenance block |
| `skills/runbook/references/discovery-heuristics.md` | New | Scoped discovery cascade and redaction rules |
| `skills/runbook/references/check-output.md` | New | `--check` mode output template |
| `rules/docs-numbering.md` | Modify | Add ancillary semantic naming section (align with doc-taxonomy.json) |
| `.claude/rules/docs-numbering.md` | Modify | Mirror root rules update |
| `CLAUDE.md` | Modify | Add `/runbook` to Command Quick Reference |
| `.claude/CLAUDE.md` | Modify | Add `/runbook` to Command Quick Reference |
| `test/skills/runbook.test.js` | New | Static contract tests for skill structure |
| `test/scripts/doc-classifier.test.js` | Modify | Add `runbook-release.md` classification assertion |

## Acceptance Criteria

- [x] AC1: `skills/runbook/SKILL.md` exists with valid frontmatter (name, description, allowed-tools) and defines create/update/check mode dispatch matching tech spec §3.3
- [ ] AC2: SKILL.md integrates feature resolver (`node scripts/resolve-feature-cli.js`) for auto-detection and uses `doc_inventory` for runbook existence check
- [x] AC3: SKILL.md defines `--request <path|title>` flag with multi-request selection fallback (auto-select single / AskUserQuestion multiple)
- [x] AC4: Template has 9 sections matching tech spec §3.4 structure, outputs to `docs/features/{feature}/runbook-release.md`
- [x] AC5: Template includes `<!-- runbook-provenance -->` block with multi-source array format (per-section `sources: [{file, sha}]`)
- [ ] AC6: Discovery heuristics defines 4-priority scoped cascade (Related Files → Canonical → Feature-local → Repo-wide) with redaction rules for secrets/tokens/internal endpoints
- [x] AC7: `rules/docs-numbering.md` formally supports ancillary semantic naming (aligned with `doc-taxonomy.json` ancillary namespace)
- [x] AC8: `--check` mode output template defines Fresh/Stale/Missing/Unknown per-section multi-source status with SHA comparison
- [x] AC9: `doc-classifier.test.js` asserts `runbook-release.md` classified as `{ type: "runbook", namespace: "ancillary" }`
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best practices audit + adversarial debate completed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 7/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

**Status**: In Progress

## Scope Clarification

This request delivers the `/runbook` skill and supporting assets (template, references, tests, rule updates). It does **not** generate a `runbook-release.md` for this feature itself — that is a downstream usage of the skill after it is built.

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Best Practices Audit: conversation record (2026-04-07, debate threadId: 019d668d-6147-7101-ac69-3ad475950a2a)
- Reused infrastructure: `scripts/lib/feature-resolver.js`, `scripts/lib/doc-classifier.js`, `scripts/config/doc-taxonomy.json`
- Existing test suite: `test/scripts/doc-classifier.test.js` (extend for runbook type)
- Industry Sources: [PagerDuty](https://www.pagerduty.com/resources/automation/learn/what-is-a-runbook/), [incident.io](https://incident.io/blog/automated-runbook-guide)
