---
name: codex-architect
description: Codex architecture consulting (third brain). Get Codex architecture advice during design phase, forming dual perspective with Claude.
allowed-tools: Read, Grep, Glob, mcp__codex__codex, mcp__codex__codex-reply
---

# Codex Architect Skill（第三大腦）

## Trigger

- Keywords: 架構設計, 方案評估, 技術選型, 第三大腦, Codex 建議, 設計諮詢, 問問 Codex, 第二意見

## When NOT to Use

- 代碼實作（用 /codex-implement）
- 代碼審查（用 /codex-review）
- 深度討論/窮舉（用 /codex-brainstorm）

## Usage

```bash
/codex-architect "<問題>"
/codex-architect "評估這個設計" --context src/xxx.ts --mode review
/codex-architect "Redis vs MongoDB?" --mode compare
```

## Modes

| Mode    | Purpose      | When             |
| ------- | ------------ | ---------------- |
| design  | 提供設計建議 | 從零開始（預設） |
| review  | 評估現有設計 | 驗證方案、找問題 |
| compare | 比較多個方案 | 技術選型         |

## Core Principle

```
User → Claude → Codex → 整合
         ↓        ↓       ↓
      初步思考  第三視角  綜合建議
```

## Codex Prompt Template

使用 `mcp__codex__codex` 時，必須包含以下內容：

```typescript
mcp__codex__codex({
  prompt: `你是資深架構師。請針對以下問題提供架構建議。

## 問題
${QUESTION}

## 模式
${MODE} (design/review/compare)

## ⚠️ 重要：你必須自主調研專案 ⚠️

在提供架構建議前，你**必須**執行以下調研：

### 調研步驟
1. 了解專案結構：\`ls src/\`、\`ls src/service/\`、\`ls src/provider/\`
2. 搜尋相關模組：\`grep -r "關鍵字" src/ --include="*.ts" -l | head -10\`
3. 讀取現有實現：\`cat <相關檔案> | head -150\`
4. 了解現有架構模式和約定

### 驗證重點
- 現有架構是什麼樣的？
- 現有代碼風格和模式是什麼？
- 有什麼相似的功能可以參考？

## 輸出要求

1. 先說明你調研了哪些檔案
2. 基於專案現況提供建議
3. 考慮與現有架構的一致性

...（其他審核維度）`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Workflow Integration

```
/codex-architect → /tech-spec → /review-spec → /codex-implement → /codex-review-fast
    設計              規劃         審核           實作              審查
```

## Verification

- 報告包含 Codex 建議 + Claude 觀點
- 共識點與差異點明確標示
- 最終建議有整合雙視角

## References

- `references/project-knowledge.md` - 專案架構知識 + 報告模板

## Examples

```
輸入：/codex-architect "如何設計高併發快取？"
動作：Codex 分析 → Claude 補充 → 整合輸出
```

```
輸入：/codex-architect "這個 API 設計有問題嗎？" --mode review
動作：Codex 評估 → Claude 驗證 → 輸出問題 + 建議
```
