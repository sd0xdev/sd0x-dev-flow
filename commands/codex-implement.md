---
description: 用 Codex MCP 實作功能代碼，直接寫入檔案
argument-hint: "<requirement>" [--target <file>] [--context <files>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion
---

## Context

- Git status: !`git status --short | head -5`

## Task

你現在要使用 Codex MCP 實作功能代碼。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                | 說明                       |
| ------------------- | -------------------------- |
| `"<requirement>"`   | 必填，需求描述             |
| `--target <file>`   | 可選，目標檔案路徑         |
| `--context <files>` | 可選，參考檔案（逗號分隔） |

### Step 1: 解析需求

**如果有 `$ARGUMENTS`**：直接使用

**如果沒有參數**：詢問用戶：

1. 需求描述是什麼？
2. 要修改/創建哪個檔案？
3. 有沒有需要參考的檔案？

### Step 2: 收集上下文

在執行 Codex 前，先收集相關資訊：

1. 如果指定了目標檔案，讀取現有內容
2. 如果指定了上下文檔案，讀取參考代碼
3. 搜尋相似的現有實作作為參考

### Step 3: 執行 Codex 實作

使用 `mcp__codex__codex` 工具：

```typescript
mcp__codex__codex({
  prompt: `你是一位資深 TypeScript 開發者。請根據需求實作功能代碼。

## 需求描述
${REQUIREMENT}

## 目標檔案
${TARGET_PATH || '待定'}

## 現有內容（如果存在）
\`\`\`typescript
${TARGET_CONTENT || '（新檔案）'}
\`\`\`

## 參考檔案
${CONTEXT_CONTENT || '無'}

## ⚠️ 重要：你必須自主調研專案 ⚠️

在實作代碼前，你**必須**執行以下調研：

### 調研步驟
1. 了解專案結構：\`ls src/\`、\`ls src/service/\`、\`ls src/provider/\`
2. 搜尋相似實現：\`grep -r "相關關鍵字" src/ --include="*.ts" -l | head -10\`
3. 讀取相似代碼參考風格：\`cat <相似檔案> | head -150\`
4. 了解現有 interface：\`grep -r "interface" src/interface/ --include="*.ts" -l | head -5\`
5. 搜尋現有錯誤處理模式：\`grep -r "throw" src/ --include="*.ts" | head -10\`

### 驗證重點
- 專案使用什麼設計模式？
- 現有代碼風格是什麼？（命名、縮排、註釋）
- 類似功能是如何實現的？
- 錯誤處理使用什麼模式？

## 專案架構
- 框架：{FRAMEWORK}
- 語言：TypeScript (strict mode)
- 資料庫：MongoDB (Mongoose)
- 快取：Redis
- 測試：Jest

## 代碼風格規範
1. 使用 {FRAMEWORK} 依賴注入 (@Inject, @Provide)
2. Service 使用 @Provide() 裝飾器
3. 錯誤處理使用專案統一的錯誤類別
4. 使用 async/await，避免 callback
5. 變數命名使用 camelCase
6. 私有方法加上 private 修飾符
7. 加上必要的 TypeScript 類型註解

## 輸出要求
1. 輸出完整的可執行代碼
2. 包含所有必要的 import
3. 遵循專案代碼風格（基於調研結果）
4. 加上簡潔的註釋說明關鍵邏輯
5. 考慮錯誤處理和邊界情況

請直接輸出代碼，不要額外解釋。`,
  sandbox: 'workspace-write',
  'approval-policy': 'on-failure',
});
```

### Step 4: 確認變更

執行後，使用 `git diff` 顯示變更，詢問用戶：

```
是否接受這些變更？
1. ✅ 接受 - 保留變更，繼續審查
2. ❌ 拒絕 - 復原變更
3. 🔄 修改 - 提供修改建議，重新生成
```

**如果拒絕**：

```bash
git checkout .
git clean -fd
```

**如果修改**：收集修改建議，使用 `mcp__codex__codex-reply` 重新生成

### Step 5: 自動審查

用戶確認接受後，**必須**執行：

```bash
/codex-review-fast
```

## Review Loop

**⚠️ 遵循 @CLAUDE.md 審核循環規則：修復後必須重審，直到 ✅ PASS ⚠️**

## Output

````markdown
## Codex 實作報告

### 需求

<requirement>

### 變更摘要

| 檔案 | 操作      | 說明 |
| ---- | --------- | ---- |
| ...  | 新增/修改 | ...  |

### 變更詳情

```diff
<git diff output>
```
````

### 用戶確認

- [ ] 接受變更

### 審查結果

<codex-review-fast 輸出>

### Gate

✅ 實作完成並通過審查 / ⛔ 需要修改

````

## Examples

```bash
# 基本實作
/codex-implement "新增一個計算手續費的方法"

# 指定目標檔案
/codex-implement "新增 getUserBalance 方法" --target src/service/wallet.service.ts

# 帶參考檔案
/codex-implement "實作快取邏輯" --target src/service/cache.ts --context src/service/redis.ts
````
