# Scope-discipline 落地 — issue #12 → 規格 → 實作決策鏈

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-08-15
> **Status**: Candidate Complete
> **Priority**: P1
> **Issue**: [#12 提案：scope-discipline 規則——review loop 不應把 pre-existing 缺陷擴散成全 repo 掃射](https://github.com/sd0xdev/sd0x-dev-flow/issues/12)
> **Tech Spec**: [`../2-tech-spec.md`](../2-tech-spec.md)（commit `eaed253`，經 6 輪 doc review）← 設計決策全部在規格內

## 決策鏈

| 節點 | 產出 | 記錄 |
|------|------|------|
| Issue #12 | 問題陳述：severity 單軸的 review loop 把 out-of-scope pre-existing 缺陷當成本次變更的 blocking finding，擴散成全 repo 掃射 | GitHub issue |
| Tech spec | scope 軸與 severity 正交；task 級不可變 baseline；三條 in-scope 條件（fail-closed）；E1/E2 兩個 human exit；斷路器只擋擴張不改分類；gate 推導 normalization-first、路由永遠走推導值 | `../2-tech-spec.md`，commit `eaed253` |
| 本實作 | WB1–WB7 全數落地（下表），全套 `npm test` 3652 pass / 0 fail | 本 ticket |

## 工作分解落地狀態

| WB | 內容 | 狀態 |
|----|------|------|
| WB1 | `rules/scope-discipline.md` 本體（baseline、determination、行為表六列、records、閉集三選項、helper-sweep ban、斷路器、gate derivation、E1/E2、Anchor 相容） | ✅ |
| WB2 | `rules/discretion.md`：12→13、標題更新、新 baseline 列（Register #2/#3/#6 例外標注） | ✅ |
| WB3 | `test/rules/discretion-tiers.test.js` 同步；新 `test/rules/scope-discipline.test.js`（11 tests）；新 `test/skills/project-setup-counts.test.js`（計數 forcing，從 `rules/` 目錄推導） | ✅ |
| WB4 | 三份 codex-prompt（fast/full/branch）＋`review-common.md`（雙軸 Merge Gate、§ Scope Fields、§ Deduplication Algorithm 欄位級合併、re-review 模板帶凍結 baseline 與 dispositions）＋parent `SKILL.md` 六落點＋TTL 句移除 | ✅ |
| WB5 | 新 `test/skills/scope-review-contract.test.js`（10 tests）：三條 reviewer 路徑雙軸 gate、`gate_reason` 四值 enum、七列路由矩陣、宣告≠推導四例重算、dual 欄位級合併、TTL 負向斷言＋positive control | ✅ |
| WB6 | 根 `CLAUDE.md`＋`CLAUDE.template.md`（closed-list 聯集句＋rules 清單）、`docs/rules.md`、`rules/fix-all-issues.md` 例外列、project-setup 五處計數（14＋2＝16）、六語系 README（15→16、12→13）、`scripts/generate-readme-catalog.js` 樣本清單納入新規則 | ✅ |
| WB7 | 本 ticket | ✅ |

## 實作期間的偏差與補充（相對規格）

規格未預見、實作中補上的兩處，均非設計變更：

1. **README 產生器**：`scripts/generate-readme-catalog.js` 的計數與樣本清單是寫死的產生輸出，
   手動編輯 README.md 的產生區塊會被 `--check` 冪等測試抓到。實作把樣本清單改在產生器內
   （`codex-invocation` 之後插入 `scope-discipline`）並重新產生，與五個語系檔對齊。
2. **CLAUDE 讀者 allowlist**：`test/skills/claude-md-coverage.test.js` 的 `ALLOWED_CLAUDE_READERS`
   需列入 `scope-discipline.test.js`（pin 的是 closed-list 聯集句，屬 prose pin 而非 command
   registration）。

用語統一：規格與三份 prompt 的「derived, not free」措辭同步寫入
`rules/scope-discipline.md` § Gate Derivation；`review-common.md` § Merge Gate 保留既有 pin 要求的
「decided by the **tier's blocking severity**」原句（`test/skills/review-dispatch.test.js:244`）。

## Acceptance Criteria

規格 § 6 測試策略的全部項目即為 AC，對應證據：

| AC | 證據 |
|----|------|
| 行為表六列、records 字面、閉集三選項、USER_SKIPPED 五例有效性、fail-closed、baseline 凍結、斷路器、gate 推導、E1/E2＋closed-list 聯集句、Anchor 相容 | `test/rules/scope-discipline.test.js`（11 tests） |
| discretion-tiers 13 檔 deepEqual＋新列 | `test/rules/discretion-tiers.test.js` |
| 三條 reviewer 路徑雙軸 gate、七列矩陣、宣告≠推導四例、dual 合併、scope 欄位在四個 prompt 表面、TTL 退場 | `test/skills/scope-review-contract.test.js`（10 tests） |
| project-setup 五處計數＝從 `rules/` 推導的 14／16 | `test/skills/project-setup-counts.test.js` |
| 全套回歸 | `npm test`：3652 pass / 0 fail / 4 skipped（2026-08-15） |

## 變更清單

規則與治理：`rules/scope-discipline.md`（新）、`rules/discretion.md`、`rules/fix-all-issues.md`、
`CLAUDE.md`、`CLAUDE.template.md`、`docs/rules.md`。
Reviewer 契約：`skills/codex-code-review/SKILL.md`、
`skills/codex-code-review/references/review-common.md`、
`skills/codex-code-review/references/codex-prompt-{fast,full,branch}.md`。
計數與宣傳面：`skills/project-setup/SKILL.md`、六語系 `README*.md`、
`scripts/generate-readme-catalog.js`。
測試：`test/rules/scope-discipline.test.js`（新）、`test/skills/scope-review-contract.test.js`（新）、
`test/skills/project-setup-counts.test.js`（新）、`test/rules/discretion-tiers.test.js`、
`test/skills/claude-md-coverage.test.js`。

## 後續（規格 § 7 開放問題，不在本 ticket 範圍）

1. 斷路器閾值（5 檔／第二子系統）為提案值，第一次實際觸發後檢討。
2. 條件 2 的動態呼叫（事件、DI、字串 dispatch）v1 落入 `uncertain` fail-closed，誤保守率待實績。
