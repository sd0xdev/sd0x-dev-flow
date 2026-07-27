# 敏感路徑 Advisory Hint (R4)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Pending
> **Note**: 「依變更性質自動分流」的可交付版本。分流只到建議層級 — 機械化硬 gate 在本次半徑內無法誠實達成，理由見 Design Decision
> **Priority**: P2
> **Depends On**: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`
> **Equilibrium**: Nash Equilibrium (3 rounds, Claude vs Codex)

## Background

目標是讓低風險變更少些儀式、安全與資料完整性變更仍受硬保護。辯論淘汰了兩條看似可行的路徑：

**淘汰 1 — 用 `risk-analyze.js` 的 gate 決定是否需要 review。** 實測：乾淨工作樹 105ms，真實 commit diff **12.1 秒**（O(files × patterns) 全庫 grep，`risk-analyze.js:341-365`）。且雙向失準——`migrationSafety` 未進入 `computeOverall`（`:532` 只吃三個維度），無 rollback 的破壞性 migration 可得 Low/PASS；反向則把一個文件修正 commit 評為 Critical/BLOCK(92)。該 skill 自身亦聲明不涵蓋安全與正確性。

**淘汰 2 — hook 依路徑自動寫 `review_mode=dual`。** 看似單調（只會變嚴），實則不然：dual 會把 session 釘在只有 `/codex-review-branch --dual` 能滿足的 aggregate gate（`stop-guard.sh:591`），`STOP_GUARD_MODE=warn` 救不了（`:577` 無條件轉 strict），且無降級路徑；同時 `.sql`/`.json`/`.yaml` 不在 code extension 集合中，對這些頭號敏感檔案會造成「strict 但零義務」。

存活的是**只發建議、不動狀態**的版本。

## Requirements

- 專案可設定的敏感路徑規則，比對後只輸出 hint 欄位
- 路徑比對必須 anchored、root-relative，支援 include/exclude
- 設定檔無效時回報 `unknown`，不得靜默視為不匹配
- 不得宣稱涵蓋完整安全語意；模型可在無路徑命中時依語意自行升級
- 絕不寫入 `review_mode` 或任何 enforcement 狀態

## Scope

| Scope | Description |
| ----- | ----------- |
| In | 新增敏感路徑設定檔；hint 欄位併入 R2 的 `[AUTO_LOOP_STATE]`；anchored 比對邏輯與測試 |
| Out | **寫入 `review_mode=dual`**（辯論淘汰，理由見 Background）；**`risk-analyze.js` 自動整合**（辯論淘汰）；`--no-blast` 廉價模式（辯論淘汰）；`.sql`/`.json`/`.yaml` 納入 code 分類（enforcement coverage 變更，另立需求單）；enforcement-escalation 一級狀態與 provenance（schema 變更，硬化軌） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/config/sensitive-paths.json` | New | anchored include/exclude 規則，比照 `file-classification.json` 結構 |
| `hooks/post-edit-format.sh` | Modify | 比對路徑，將 hint 欄位加入 R2 的事實訊號 |
| `test/hooks/sensitive-paths.test.js` | New | anchored 比對、include/exclude、無效設定回報 unknown |

## Acceptance Criteria

- [ ] 敏感路徑規則以 anchored path segment 比對（如 `(^|/)auth(/|$)`），非任意子字串
- [ ] 支援 include 與 exclude，且測試涵蓋正例（`auth`、`auth/login.ts`、`src/auth/login.ts`）與反例（`author/index.ts`、`docs/features/auth/2-tech-spec.md`）
- [ ] 設定檔缺失或格式錯誤時輸出 `sensitivity=unknown`，不靜默視為未命中
- [ ] 命中時僅輸出 `sensitivity_hint` / `rule` / `path` / `suggested_tier` / `suggested_route` 等建議欄位
- [ ] 全 diff 可證：未寫入 `review_mode`，未寫入任何 enforcement 狀態欄位
- [ ] 比對成本 < 50ms（實測為證），不引入任何全庫掃描
- [ ] 內建預設規則以「範例」呈現，文件明確聲明非完整安全涵蓋
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 分流強度 | 只發建議 | hook 寫 `review_mode=dual` | dual 耦合 strict + aggregate 收據 + branch 全域審查三件事，且無降級路徑，誤判成本是卡死而非多跑 |
| 風險來源 | 路徑規則 | `risk-analyze.js` 評分 | 評分 12 秒、雙向失準、且自身聲明不涵蓋安全語意 |
| 涵蓋宣稱 | 明示不完整 | 宣稱高風險必被攔 | 安全語意常住在 `src/services/user.ts` 這類泛用路徑，路徑比對無法證明完整涵蓋 |
| 預設規則 | 範例而非真理 | 內建通用清單 | 敏感路徑高度專案相關 |

## Known Limitation

本張**無法**達成「所有高風險變更皆被機械硬 gate」。在 warn 預設 + 模型擁有語意分類的前提下，唯一可由 hook 寫入的升級管道（`review_mode=dual`）帶有上述卡死風險。要真正機械化，需要一個與 dual 解耦的 enforcement-escalation 狀態概念，屬 schema 變更、另立硬化軌。此限制為辯論的均衡結論，非疏漏。

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Codex 辯論 R3 建議 P4；淘汰理由經 Claude 實測（12.1s 計時、`stop-guard.sh:577/591` 驗證） |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 前置: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
- 淘汰方案來源: [Risk Assess](../../risk-assess/)
- 相關: [Security Rules](../../../../rules/security.md)
