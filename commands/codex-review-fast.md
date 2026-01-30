---
description: 用 Codex MCP 快速 second-opinion（只看 diff、不跑測試）。支援循環審核上下文保持。
argument-hint: [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

你現在要使用 Codex MCP 進行快速代碼審查（只看 diff，不跑 lint/build/test）。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                             |
| ----------------------- | -------------------------------- |
| `--focus "<text>"`      | 聚焦特定區域（如 "auth"）        |
| `--base <gitref>`       | 與指定分支比較（如 origin/main） |
| `--continue <threadId>` | 繼續之前的審核會話               |

### Step 1: 收集 Git Diff

先收集需要審查的代碼變更：

```bash
# 如果有 --base 參數，與指定分支比較；否則查看未提交變更
git diff HEAD --no-color | head -2000
```

將 diff 內容保存為 `GIT_DIFF` 變數。

### Step 2: 執行審核

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具啟動新審核會話：

```typescript
mcp__codex__codex({
  prompt: `你是資深 Code Reviewer。請審核以下代碼變更，聚焦於發現問題而非表揚。

## Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

${FOCUS ? `## 聚焦區域\n請特別關注：${FOCUS}` : ''}

## ⚠️ 重要：你必須自主調研專案 ⚠️

在審核代碼時，你**必須**執行以下調研，不要只依賴上面提供的 diff：

### Git 探索（優先）
1. 查看變更狀態：\`git status\`
2. 查看變更的檔案：\`git diff --name-only HEAD\`
3. 查看特定檔案的完整變更：\`git diff HEAD -- <file-path>\`
4. 查看變更檔案的完整內容：\`cat <變更的檔案> | head -200\`

### 專案調研
- 查看被調用的函數：\`grep -r "functionName" src/ --include="*.ts" -l\`
- 讀取相關檔案：\`cat <檔案路徑> | head -100\`
- 了解類別定義：\`grep -A 20 "class ClassName" src/\`

## 審核維度

| 維度 | 檢查項 |
|------|--------|
| 正確性 | 邏輯錯誤、邊界條件、null 處理、off-by-one |
| 安全性 | 注入攻擊、認證繞過、敏感資料洩露、OWASP Top 10 |
| 效能 | N+1 查詢、記憶體洩漏、不必要的迴圈、阻塞操作 |
| 可維護性 | 命名清晰度、函數長度、重複代碼、過度抽象 |

## 嚴重等級定義

- **P0**: 會導致系統崩潰、資料遺失、安全漏洞
- **P1**: 會導致功能異常、效能嚴重下降
- **P2**: 程式碼品質問題、可維護性問題
- **Nit**: 風格建議、微小改進

## 輸出格式

### Findings

- [P0/P1/P2/Nit] <file:line> <問題描述> → <修復建議>

### Merge Gate

- ✅ Ready：無 P0/P1，可合併
- ⛔ Blocked：有 P0/P1，需修復`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

**記住返回的 `threadId`，用於後續循環審核。**

**情況 B：循環審核（有 `--continue`）**

使用 `mcp__codex__codex-reply` 繼續之前的會話：

```typescript
mcp__codex__codex -
  reply({
    threadId: '<從 --continue 參數獲取>',
    prompt: `我已修復之前指出的問題。請重新審核：

## 新的 Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

請驗證：
1. 之前的 P0/P1 問題是否已正確修復？
2. 修復是否引入了新問題？
3. 更新 Merge Gate 狀態`,
  });
```

### Step 3: 整合輸出

將 Codex 的審核結果整理為標準格式。

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ Blocked 時：

1. 記住 `threadId`
2. 修復 P0/P1 問題
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ Ready

## Output

```markdown
## Codex 快速審核報告

### 審核範圍

- 變更統計：<git diff --stat 摘要>
- 聚焦區域：<focus 或 "全部">

### Findings

#### P0 (必須修復)

- [file:line] 問題 → 修復建議

#### P1 (應該修復)

- [file:line] 問題 → 修復建議

#### P2 (建議改進)

- [file:line] 問題 → 修復建議

#### Nit

- [file:line] 建議

### Merge Gate

✅ Ready / ⛔ Blocked (需修復 N 個 P0/P1)

### 循環審核

如需修復後重新審核，請使用：
\`/codex-review-fast --continue <threadId>\`
```

## Examples

```bash
# 基本用法 - 審核未提交變更
/codex-review-fast

# 聚焦特定區域
/codex-review-fast --focus "authentication"

# 與 main 分支比較
/codex-review-fast --base origin/main

# 修復後繼續審核（保持上下文）
/codex-review-fast --continue abc123
```
