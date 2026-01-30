# Code Investigate Codex Prompts

## 必要參數

| 參數              | 值          | 說明                   |
| ----------------- | ----------- | ---------------------- |
| `sandbox`         | `read-only` | 強制只讀，防止意外修改 |
| `approval-policy` | `never`     | 自動批准 shell 命令    |
| `cwd`             | 專案根目錄  | Codex 探索的起點       |

## 標準調查 Prompt

```typescript
mcp__codex__codex({
  prompt: `# 代碼調查任務

## 問題
${userQuestion}

## 專案資訊
- 路徑：${cwd}
- 技術棧：{FRAMEWORK} + TypeScript + {DATABASE}

## 調查要求

請**獨立探索**代碼庫，回答以下問題：

1. **相關檔案**：哪些檔案與此功能相關？
2. **核心邏輯**：主要的處理流程是什麼？
3. **資料流**：資料如何流動（輸入 → 處理 → 輸出）？
4. **關鍵依賴**：依賴哪些服務/模組？
5. **邊界情況**：有哪些特殊處理？

## 探索建議

- 從 entrypoint 開始追蹤
- 使用 grep 搜尋關鍵字
- 閱讀相關 service/provider
- 注意 DI 注入的依賴

請給出你的完整分析。`,
  cwd: process.cwd(),
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## 特定功能調查

```typescript
mcp__codex__codex({
  prompt: `# 功能調查：${featureName}

專案路徑：${cwd}

請獨立探索這個功能的實作：

1. 找出所有相關檔案
2. 追蹤呼叫鏈
3. 理解資料結構
4. 識別外部依賴

不需要我提供任何線索，請自行探索並給出分析。`,
  cwd: process.cwd(),
  sandbox: 'read-only',
});
```

## 問題追蹤調查

```typescript
mcp__codex__codex({
  prompt: `# 問題追蹤

問題描述：${problemDescription}

專案路徑：${cwd}

請獨立調查：
1. 可能涉及的代碼區域
2. 潛在的問題點
3. 相關的邏輯分支
4. 可能的根本原因

請自行探索，給出你的診斷。`,
  cwd: process.cwd(),
  sandbox: 'read-only',
});
```

## 禁止的 Prompt 模式

| 模式       | 問題                    | 錯誤範例                                   |
| ---------- | ----------------------- | ------------------------------------------ |
| 餵養結論   | Claude 結論洩漏給 Codex | `Claude 發現這些檔案：${findings}，請確認` |
| 引導性問題 | 預設答案，限制探索      | `我認為問題出在 cache 機制，請驗證`        |
| 限制範圍   | 阻止獨立探索            | `只看 src/service/ 目錄`               |
| 確認式問題 | 不是探索，是驗證        | `這樣理解對嗎？`                           |

## 正確的 Prompt 原則

| 原則         | 說明                 | 範例                        |
| ------------ | -------------------- | --------------------------- |
| 只給問題     | 不給 Claude 的發現   | `訂單處理怎麼運作？` |
| 只給專案路徑 | 讓 Codex 自己探索    | `cwd: '/path/to/project'`   |
| 開放式探索   | 不限制搜尋範圍       | 不加 `只看 xxx 目錄`        |
| 要求獨立分析 | 明確說「請自行探索」 | `請獨立探索代碼庫`          |
