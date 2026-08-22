# Stacked PR Mode — r1 設計前置與 Preview 實測

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-07-31
> **Status**: In Progress
> **Note**: 原規劃含 `/feasibility-study`（授權落點評估）；使用者於 2026-07-31 直接裁決 v1 組合方案（`/push-ci` + `/create-pr`），該項由決策取代，不另跑
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec/2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

GitHub Stacked PR（2026-07-30 public preview）要納入 `/create-pr`，但 `gh stack` 系列指令觸及 Anchor Register #4 禁止操作。本票追蹤設計前置：授權決策、tech spec 產出，以及 preview 階段必須實測才能回填設計的開放問題（spec §7 Q1–Q3）。

## Requirements

- 裁決執行端授權設計並記錄（requirements §9 之首）
- 產出 `2-tech-spec.md` 並通過文件審查
- 實測回填 spec §7 的 preview 相關開放問題（Q1 人工確認、Q2 rollout 偵測、Q3 native stack 物件推定）

## Scope

| Scope | Description |
| ----- | ---------- |
| In    | 授權決策記錄、tech spec、Q1–Q3 確認/實測與 spec 回填 |
| Out   | v1 實作（SKILL.md/測試）→ [r2](./2026-07-31-stacked-pr-mode-r2.md)；Q4 CI 分層策略（延後）；auto-merge 矛盾實測（requirements §9，隨 rollout 再排） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `docs/features/create-pr-stacked/1-requirements.md` | Modify | Open Question 裁決記錄（已完成） |
| `docs/features/create-pr-stacked/2-tech-spec.md` | New | 技術設計（已完成，✅ Mergeable） |

> **路徑變更（2026-08-21 補記）**：上表與下方 AC 所寫的 `2-tech-spec.md` 是 2026-07-31 當時的路徑，
> 保留原文不改。該檔已依 `@rules/docs-numbering.md` § Size Limit 拆為
> [`../2-tech-spec/2-tech-spec.md`](../2-tech-spec/2-tech-spec.md)（主檔）與
> [`../2-tech-spec/1-core-logic.md`](../2-tech-spec/1-core-logic.md)（原 § 3.4 切出）。
> 引用 § 3.4 內個別項次（items）時應指向後者。

## Acceptance Criteria

- [x] 執行端授權決策記錄於 `1-requirements.md` §9（v1 組合方案：push → `/push-ci` 或使用者手動；PR ops → 既有 `gh pr create/edit` 契約；`gh stack` → 使用者自行執行）
- [x] `2-tech-spec.md` 產出並通過 `/codex-review-doc`（✅ Mergeable，2026-07-31）
- [ ] Q1：`/push-ci --branches` 是否屬 Anchor #4 例外的範圍內引數擴充 — 人工確認結果回填 spec §7
- [ ] Q2：repo rollout 偵測的可靠訊號實測，回填 spec §3.4 Phase D 的偵測設計
- [ ] Q3：手動 chained-base PR 是否為 native stack 物件（spec R4 推定為否）— 實測確認並回填
- [ ] Pass /codex-review-doc（spec 回填後）

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | done   | 授權決策 + tech spec 完成（2026-07-31） |
| Development | in progress | Q1–Q3 待確認/實測 |
| Testing    | -      | |
| Acceptance | -      | |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec/2-tech-spec.md) §7 Open Questions
- Requirements: [1-requirements.md](../1-requirements.md) §9
- Sibling: [r2 — v1 實作](./2026-07-31-stacked-pr-mode-r2.md)
