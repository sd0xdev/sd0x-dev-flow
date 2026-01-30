---
name: doc-review
description: Document review knowledge base. Covers tech spec review, document audit, document refactoring.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Document Review Skill

## Trigger

- Keywords: 審核文件, review doc, 文件審查, 技術方案審核, review-spec, doc-refactor, 精簡文件

## When NOT to Use

- 代碼審查（用 codex-code-review）
- 測試覆蓋審查（用 test-review）
- 只是想讀文件（直接 Read）

## Commands

| 命令                | 說明                | 適用場景   |
| ------------------- | ------------------- | ---------- |
| `/codex-review-doc` | Codex 審核 .md 文件 | 文件變更   |
| `/review-spec`      | 審核技術方案        | 方案確認   |
| `/doc-refactor`     | 文件精簡重構        | 文件過長   |
| `/update-docs`      | 調研後更新文件      | 代碼變更後 |

## Workflow

```
偵測 .md 變更 → 選擇審核命令 → 輸出審核結果 + Gate
```

## Review Dimensions

| 維度     | 檢查項                         |
| -------- | ------------------------------ |
| 結構     | 標題層級、段落組織、目錄完整性 |
| 內容     | 準確性、完整性、一致性         |
| 代碼範例 | 範例正確性、與實際代碼一致     |
| 技術方案 | 需求覆蓋、風險識別、測試策略   |

## Verification

- 每個問題標記嚴重程度
- Gate 明確（✅ Pass / ⛔ Block）
- 修復建議具體可行

## Required Actions

| 變更類型   | 必須執行                              |
| ---------- | ------------------------------------- |
| `.md` 文檔 | `/codex-review-doc` 或 `/review-spec` |
| 技術方案   | `/review-spec`                        |
| README     | `/codex-review-doc`                   |

## Examples

```
輸入：幫我審核這份技術方案
動作：/review-spec → 檢查完整性/可行性/風險 → 輸出 Gate
```

```
輸入：這份文件太長了，幫我精簡
動作：/doc-refactor → 表格化 + Mermaid → 輸出對比
```
