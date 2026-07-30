# Locale README Count Generation + Hero Tail Derivation

> **Created**: 2026-07-30
> **Status**: Pending
> **Priority**: P2
> **Tech Spec**: [Tech Spec](../2-tech-spec.md)

## Background

v4.1.0 的 README v4 全篇重寫（英文 + 5 locale）驗證了一個既知缺口：generator 只產生英文 README 的 5 個 marker 區塊，locale README 的 marker 區塊為手動同步。目前 locale 區塊內的計數（96 bundled/public）落後英文（98）。現有 locale drift 測試釘的是 Hooks/Scripts 資源列、在地化 prose 的 hook 計數、與 tier round cap 對 `rules/auto-loop.md` 的一致性 —— 但**沒有任何測試釘 locale 的 skill 計數欄位**（HERO-COUNT、INSTALL-COVERAGE、What's Included、FULL-CATALOG summary/分類計數），drift 因此未被擋下。另外 HERO-COUNT 區塊內的 `~4% of Claude's context window` 尾綴是寫死的 prose，不是由 token 量測衍生，generator 無法驗證其真實性。

## Requirements

- generator 為 6 個 README（en + 5 locale）更新 **count-bearing marker 區塊**（HERO-COUNT、INSTALL-COVERAGE、WHATS-INCLUDED-COUNT、FULL-CATALOG 的 summary/分類計數）；ESSENTIAL-SKILLS 不含計數，明確排除在本張範圍外
- **在地化保留模型須二擇一並以測試釘住**（實作時決策並記錄）：(a) 只改寫衍生的數字/條目，保留 locale 自有文字（FULL-CATALOG 的在地化 summary、分類標題、表頭、描述，如 `README.zh-TW.md` 的分類段落）；或 (b) 引入完整 locale 模板/資料（glossary 目前只提供 Skills/Agents/Hooks/Rules/Scripts 五個標籤，不足以支撐 (b)，選 (b) 需先擴充）
- 修正現存 96→98 locale hero drift（generator 首跑即應消除）
- HERO-COUNT 的 `~4%` 尾綴改為 derive-or-remove：由 token 量測腳本衍生，或自 marker 區塊移出成手寫 prose
- 測試釘住修訂後的 contract：6 檔 skill 計數欄位與 disk inventory 相等；並涵蓋 marker 區塊外的 `allowed-tools` 宣告計數（harness 表第 5 列，6 檔現為 89/98，目前無測試釘住）— 納入生成、納入 drift 測試、或明確記錄排除，三擇一並記錄決策

## Scope

| Scope | Description |
|-------|-------------|
| In | `scripts/generate-readme-catalog.js` 多檔輸出、locale 標籤表、hero 尾綴 derive-or-remove、`test/scripts/generate-readme-catalog.test.js` contract 更新 |
| Out | locale prose 翻譯自動化（仍走 `/readme-i18n-sync`）、CI auto-trigger（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/generate-readme-catalog.js` | Modify | 多檔 marker 生成 + locale 標籤 + hero 尾綴處理 |
| `test/scripts/generate-readme-catalog.test.js` | Modify | 6-locale count contract、hero 尾綴新 contract |
| `README.md` + 5 locale README | Regenerate | marker 區塊由 generator 重寫 |
| `skills/readme-i18n-sync/references/glossary.md` | Read / Modify if (b) | locale 類別標籤來源；選模型 (b) 時需擴充 |

## Acceptance Criteria

- [ ] generator 一次執行更新 6 個 README 的 count-bearing marker 區塊（HERO-COUNT / INSTALL-COVERAGE / WHATS-INCLUDED-COUNT / FULL-CATALOG 計數；ESSENTIAL-SKILLS 除外）
- [ ] 在地化保留模型已決策（(a) 或 (b)）並有測試證明：locale 自有文字在重生成後存活，只有預期的生成欄位改變
- [ ] locale hero 計數與英文一致（98/98），96→98 drift 消除
- [ ] `~4%` 尾綴：衍生自量測，或移出 HERO-COUNT 區塊（擇一，記錄決策）
- [ ] locale drift 測試涵蓋 skill 計數欄位（HERO-COUNT、INSTALL-COVERAGE、What's Included、FULL-CATALOG summary 與各分類計數），並對 marker 外的 `allowed-tools` 計數（89/98）依 Requirements 的三擇一決策執行（生成／釘住／明確記錄排除）
- [ ] 既有 40 個 catalog 測試全數通過（contract 修訂處除外，需同步更新）
- [ ] `/codex-review-fast` → `/precommit` 通過

## Progress

| Phase | Status |
|-------|--------|
| Development | Pending |
| Testing | Pending |
| Acceptance | Pending |

## References

- 前置：[2026-04-07 README Skill Catalog Auto-Sync](./2026-04-07-readme-catalog-auto-sync.md)
- 觸發脈絡：v4 README 全篇重寫（2026-07-30）發現 locale 計數 drift 與 hero 尾綴不可驗證
