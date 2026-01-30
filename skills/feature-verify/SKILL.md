---
name: feature-verify
description: System diagnosis skill (READ-ONLY). Verifies feature behavior through code analysis, data validation, and Codex deep confirmation. All operations are strictly read-only - NO data modification allowed.
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Task, Skill
context: fork
---

# Feature Verification Skill

## Trigger

- Keywords: verify, investigate, diagnose, check if working, anomaly, validate
- User provides credentials for data sources

## When NOT to Use

- 需要修改數據（此 skill 僅限讀取）
- 單純代碼審查（用 codex-review）
- 功能開發（用 feature-dev）

## Core Principle

```
⚠️ ALL OPERATIONS MUST BE READ-ONLY ⚠️
```

```
Claude 獨立分析 → 形成結論 → Codex 第三視角確認 → 整合報告
```

## Workflow

```
Phase 1: Explore    → 理解系統架構、數據流、觸發點
Phase 2: Plan       → 建立驗證清單，呈報用戶確認
Phase 3: Execute    → 執行只讀查詢，記錄 expected vs actual
Phase 4: Analyze    → Claude 獨立形成診斷結論
Phase 5: Confirm    → /codex-brainstorm 第三視角驗證
Phase 6: Integrate  → 綜合雙視角，產出最終報告
```

## Safety Rules

| Rule              | Description                            |
| ----------------- | -------------------------------------- |
| **READ-ONLY**     | 禁止任何寫入/更新/刪除操作             |
| PLAN-FIRST        | 執行查詢前先呈報驗證計畫               |
| CREDENTIAL-SAFETY | 輸出中不暴露完整憑證                   |
| INDEPENDENT-FIRST | Claude 先獨立得出結論，再請 Codex 確認 |

## Verification Checklist

| Category           | Checks                              |
| ------------------ | ----------------------------------- |
| Feature Checks     | API endpoints, jobs, error handling |
| Data Checks        | Collections, aggregations, external |
| Integration Checks | End-to-end flow                     |

## Verification

- 報告包含 Executive Summary + Status
- 每項檢查有 expected/actual/status
- Claude + Codex 視角都有記錄
- 建議分為 Immediate / Further / Long-term

## References

- `references/queries.md` - 查詢模板 + 安全規則
- `references/output-template.md` - 報告格式

## Examples

```
輸入：/feature-verify User Auth
      MongoDB: mongodb://...
      {ANALYTICS}: project_id={PROJECT_ID}
動作：Explore → Plan → Execute queries → Analyze → Codex confirm → Report
```

```
輸入：verify user auth is working correctly
動作：Phase 1-6 流程 → 輸出診斷報告
```
