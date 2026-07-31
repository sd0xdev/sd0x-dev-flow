# Stacked PR Mode — r2 v1 實作

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-07-31
> **Status**: Pending
> **Note**: 不被 r1 的 Q1 阻塞（v1 主路徑為輸出手動 push 指令）；但 Phase D rollout 偵測細節依賴 r1 Q2 的實測結果，實作時以保守降級為預設
> **Priority**: P1
> **Tech Spec**: [Link](../2-tech-spec.md)
> **Depends On**: [r1 設計前置與 Preview 實測](./2026-07-31-stacked-pr-mode-r1.md)
> **Requirements**: [Link](../1-requirements.md)

## Background

依 [tech spec](../2-tech-spec.md) 實作 `/create-pr --stack` 模式（WBS W1/W2/W4）：sync 分類先行、chain 驗證、逐層 PR create/edit（可重入）、依賴標記三模式、環境偵測與降級——全程不執行 push/rebase（Anchor #4 零變更）。

## Requirements

- `/create-pr` SKILL.md 新增 `--stack` 模式，行為依 spec §3.3–§3.4（W1）
- 細節承載於 `references/stack-mode.md`，SKILL.md 控制在 500 行內（R6）
- 新增契約測試 + 保留既有 sanitization regression（W2）
- doc sync：`docs/skill-catalog.yml`（W4）

## Scope

| Scope | Description |
| ----- | ---------- |
| In    | W1（SKILL.md + references）、W2（測試）、W4（catalog sync） |
| Out   | W3 `/push-ci --branches` 擴充（待 r1 Q1 裁決後另開票）；自動執行任何 `gh stack` 指令（Won't v1）；auto-merge / merge queue（Won't v1） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/create-pr/SKILL.md` | Modify | 新增 `--stack` 模式入口與摘要 |
| `skills/create-pr/references/stack-mode.md` | New | Phase A–D 細節、依賴標記契約、shell 安全契約 |
| `test/skills/create-pr.test.js` | New | stacked 模式契約測試（spec §6） |
| `docs/skill-catalog.yml` | Modify | create-pr 條目 description 同步 |

## Acceptance Criteria

- [ ] `--stack` dry-run：三層線性 chain 輸出逐層 PR 指令，base 鏈正確，全程無 push/rebase 執行（Signal 1、5）
- [ ] Phase A sync 分類依 per-state × per-mode 處置表：ABSENT 中止於 PR 規劃前並輸出待 push 清單；`LOCAL_AHEAD` dry-run 警告續行、`--execute` 拒絕
- [ ] Phase B 驗證：ancestry（`merge-base --is-ancestor`）、PR 政策（`--state all`，OPEN-且-base-相符或 ABSENT）、非線性/單層/空 chain 依 spec 處置（Signal 4）
- [ ] 依賴標記依情境正確（dry-run：下層 PR 已存在用 `#N`、ABSENT 用 branch 標記；execute 用 `#N`；update 將 branch 標記升級為 `#N`），無未解析佔位符
- [ ] 逐層 Step 4b sanitization 與 execute 模式 Step 7b 生效（Signal 3）；shell 安全契約落實（escaping、`--`、heredoc delimiter）
- [ ] 降級路徑：`gh-stack` 未安裝/未 rollout → 明確訊息 + Multi-PR 模式適配標記（Signal 2）
- [ ] `test/skills/create-pr.test.js` 覆蓋 spec §6 的 Unit 案例（Manual 列由第 1、6、8 項行為 AC 透過 `/feature-verify` 承接）；既有 `create-pr-sanitization.test.js` 無刪減；`npm test` 通過（Signal 6）
- [ ] 模擬第二層失敗：輸出各層狀態，重跑不重複建立（Signal 7）
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | done   | tech spec ✅ Mergeable（r1） |
| Development | -     | |
| Testing    | -      | |
| Acceptance | -      | |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §3.3–§3.4、§5、§6
- Requirements: [1-requirements.md](../1-requirements.md) §5、§8
- Sibling: [r1 — 設計前置](./2026-07-31-stacked-pr-mode-r1.md)
