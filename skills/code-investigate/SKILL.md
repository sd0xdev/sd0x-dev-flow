---
name: code-investigate
description: Dual-perspective code investigation. Claude explores independently, then Codex explores independently (no feeding), finally integrate both conclusions.
allowed-tools: Read, Grep, Glob, Bash, mcp__codex__codex
context: fork
---

# Code Investigate Skill

## Trigger

- Keywords: 調查代碼, investigate code, 功能怎麼運作, 追蹤實作, 雙重確認, 深入了解, code 怎麼運作, 這段代碼做什麼, 調研代碼, 代碼調研

## When NOT to Use

- 只需快速查找（直接用 Grep/Glob）
- 代碼審查（用 codex-review）
- 系統驗證（用 feature-verify）
- Git 歷史追蹤（用 git-investigate）

## Core Principle

```
⚠️ Codex 必須獨立探索，禁止 Claude 餵養結論 ⚠️
```

```
┌─────────────────┐     ┌─────────────────┐
│ Claude 獨立調查 │     │ Codex 獨立調查  │
│   (Phase 1-2)   │     │    (Phase 3)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
   ┌───────────┐           ┌───────────┐
   │ Claude    │           │ Codex     │
   │ 結論      │           │ 結論      │
   └─────┬─────┘           └─────┬─────┘
         │                       │
         └───────────┬───────────┘
                     ▼
              ┌─────────────┐
              │  整合報告   │
              │  (Phase 4)  │
              └─────────────┘
```

## Workflow

| Phase | 名稱            | 動作                    | 產出             |
| ----- | --------------- | ----------------------- | ---------------- |
| 1     | Claude Explore  | Grep/Glob/Read 搜尋代碼 | 相關檔案清單     |
| 2     | Claude Conclude | 分析邏輯、形成理解      | 初步結論（內部） |
| 3     | Codex Explore   | 調用 Codex MCP 獨立探索 | Codex 分析報告   |
| 4     | Integrate       | 比對雙方視角、標示差異  | 整合報告         |

## Codex 調用規則

### 必要參數

| 參數              | 值          | 說明     |
| ----------------- | ----------- | -------- |
| `sandbox`         | `read-only` | 強制只讀 |
| `approval-policy` | `never`     | 自動執行 |
| `cwd`             | 專案根目錄  | 探索起點 |

### 正確方式

```typescript
mcp__codex__codex({
  prompt: `# 代碼調查任務

## 問題
${userQuestion}

## 專案資訊
- 路徑：${cwd}
- 技術棧：{FRAMEWORK} + TypeScript + {DATABASE}

請**獨立探索**代碼庫，回答：
1. 相關檔案有哪些？
2. 核心邏輯如何運作？
3. 資料流是什麼？
4. 有哪些關鍵依賴？

請自行 grep/read 探索，給出你的分析。`,
  cwd: '/path/to/project',
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

### 禁止方式

| 模式       | 問題                    | 範例                               |
| ---------- | ----------------------- | ---------------------------------- |
| 餵養結論   | Claude 結論洩漏給 Codex | `Claude 發現這些檔案：${findings}` |
| 引導性問題 | 預設答案                | `我認為問題出在 cache，請驗證`     |
| 限制範圍   | 阻止獨立探索            | `只看 src/service/`                |

## Verification Checklist

| 檢查項            | 標準                                |
| ----------------- | ----------------------------------- |
| Claude 獨立結論   | Phase 2 形成結論，未輸出給用戶      |
| Codex prompt 乾淨 | 只含問題 + 專案路徑，無 Claude 發現 |
| 報告視角分離      | Claude / Codex 結論分開呈現         |
| 整合完整          | 標示共識點、差異點、可能遺漏        |

## References

| 檔案                            | 用途              | 何時讀         |
| ------------------------------- | ----------------- | -------------- |
| `references/prompts.md`         | Codex prompt 模板 | Phase 3 調用前 |
| `references/output-template.md` | 報告格式          | Phase 4 整合時 |

## Examples

### 功能調查

```
輸入：調查 訂單處理流程怎麼運作的
Phase 1: Grep "processOrder" → Read src/service/order/*.ts
Phase 2: 形成理解：Controller → Service → Repository 寫入
Phase 3: Codex 獨立探索（只給問題 + 路徑）
Phase 4: 整合報告 → 標示雙方視角
```

### 機制理解

```
輸入：API 的快取機制怎麼運作？
Phase 1: Grep "cache" + "portfolio" → Read 相關檔案
Phase 2: 理解 Redis TTL + fallback 機制
Phase 3: Codex 獨立調查
Phase 4: 比對差異 → 輸出整合報告
```

### 問題診斷

```
輸入：為什麼 token price 有時候是 null？
Phase 1: 搜尋 price 相關邏輯 + error handling
Phase 2: 識別可能的 fallback 路徑
Phase 3: Codex 獨立診斷
Phase 4: 綜合雙方發現 → 列出可能原因
```
