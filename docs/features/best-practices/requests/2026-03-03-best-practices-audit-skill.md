# Best Practices Audit Skill

> **Created**: 2026-03-03
> **Status**: In Development
> **Priority**: P1
> **Tech Spec**: Pending
> **Source**: Codex Brainstorm Nash Equilibrium (2026-03-03)

## Background

sd0x-dev-flow 目前缺少「業界最佳實踐對標」能力。onekey onchain 專案已有成熟的 `best-practices` skill，採用 4-phase workflow（業界調研 → 專案分析 → Codex brainstorm 辯論 → Gap report）。此 skill 可完全通用化，不依賴任何特定基礎設施。

## Requirements

- 從 onekey `best-practices` skill 通用化，移除 OneKey 特定內容
- 4-phase workflow：Industry Research → Codebase Analysis → Adversarial Debate → Gap Report
- Phase 1 使用 WebSearch + WebFetch（WebSearch 不可用時降級為 WebFetch-only + 使用者提供來源；agent-browser 為 optional enhancement）
- Phase 3 強制調用 `/codex-brainstorm`，不可跳過
- 強制 citation + file:line mapping 門檻（brainstorm 攻擊點 B）
- Phase 4 報告必填「辯論結論」欄位

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md + command wrapper + 報告 template |
| Out | agent-browser 整合（deferred）、domain-specific 調研模板 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/best-practices/SKILL.md` | New | Skill 定義（含 references/ progressive disclosure） |
| `skills/best-practices/references/output-templates.md` | New | Phase 1/2/4 輸出範本 |
| `skills/best-practices/references/debate-guide.md` | New | Phase 3 辯論指南 |
| `commands/best-practices.md` | New | Command wrapper |
| `CLAUDE.md` | Modify | Command table 新增 |
| `.claude/CLAUDE.md` | Modify | Command table 新增 |
| `CLAUDE.template.md` | Modify | Command table 新增 |

## Acceptance Criteria

- [x] SKILL.md 包含 4-phase workflow（Industry → Codebase → Debate → Report）
- [x] Phase 3 強制調用 codex-brainstorm（有 Gate 阻擋跳過）
- [x] Phase 4 報告含必填「辯論結論」欄位
- [x] 強制 citation（至少 3 個獨立來源）
- [x] 強制 file:line mapping（Phase 2 疑慮項必須引用代碼位置）
- [x] When NOT to Use section 完備
- [x] Output section 定義報告格式
- [x] Verification checklist 完備
- [ ] `/skill-health-check` 全維度通過
- [x] `/codex-review-doc` 通過（Round 3 ✅ Mergeable）

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Codex Brainstorm 均衡結論確認 Rank #1 |
| Development | Done | SKILL.md + references/ + command wrapper + CLAUDE.md 更新 |
| Testing | In Progress | `/codex-review-doc` 通過；`/skill-health-check` 待執行 |
| Acceptance | In Progress | 8/10 AC checked |

## References

- Source: onekey `best-practices` skill
- Brainstorm threadId: `019cb1d4-8534-7932-bd24-6b3054091171`
- 均衡結論：Rank #1，S-M effort，雙方共識
