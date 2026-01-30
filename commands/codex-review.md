---
description: 用 Codex MCP 取得完整 second-opinion（含 lint:fix + build）。支援循環審核上下文保持。
argument-hint: [--no-tests] [--focus "<text>"] [--base <gitref>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

你現在要使用 Codex MCP 進行完整代碼審查（含 lint:fix + build + review）。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                             |
| ----------------------- | -------------------------------- |
| `--no-tests`            | 跳過 lint:fix 和 build 步驟      |
| `--focus "<text>"`      | 聚焦特定區域（如 "auth"）        |
| `--base <gitref>`       | 與指定分支比較（如 origin/main） |
| `--continue <threadId>` | 繼續之前的審核會話               |

### Step 1: 執行本地檢查（除非 --no-tests）

如果沒有 `--no-tests` 參數，先執行本地檢查：

```bash
# lint:fix
{LINT_FIX_COMMAND}

# build
{BUILD_COMMAND}
```

記錄檢查結果（成功/失敗），保存為 `LOCAL_CHECKS`。

### Step 2: 收集 Git Diff

```bash
# 如果有 --base 參數，與指定分支比較；否則查看未提交變更
git diff HEAD --no-color | head -2000
```

將 diff 內容保存為 `GIT_DIFF` 變數。

### Step 3: 執行審核

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具啟動新審核會話：

```typescript
mcp__codex__codex({
  prompt: `你是資深 Code Reviewer。請對以下代碼變更進行全面審核。

## 本地檢查結果
${LOCAL_CHECKS || '跳過（--no-tests）'}

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
1. 了解專案結構：\`ls src/\`、\`ls test/\`
2. 搜尋相關源碼：\`grep -r "functionName" src/ --include="*.ts" -l | head -10\`
3. 讀取完整源碼了解上下文：\`cat <源碼路徑> | head -200\`
4. 搜尋現有測試：\`ls test/unit/\` 或 \`grep -r "describe" test/ --include="*.ts" -l | head -5\`
5. 讀取相關測試了解預期行為：\`cat <測試路徑> | head -100\`

### 驗證重點
- 變更是否符合現有代碼風格？
- 變更是否有對應的測試？
- 變更是否影響其他模組？
- 變更中的依賴是否正確？

## 審核維度

### 正確性
- 邏輯錯誤、邊界條件、null 處理
- 類型安全（TypeScript）
- 錯誤處理覆蓋

### 安全性
- 注入攻擊（SQL/NoSQL/Command）
- 認證/授權繞過
- 敏感資料處理
- OWASP Top 10

### 效能
- N+1 查詢
- 記憶體洩漏
- 阻塞操作
- 不必要的計算

### 可維護性
- 命名清晰度
- 函數職責單一
- 適當的抽象層級
- 測試可測性

## 嚴重等級

- **P0**: 系統崩潰、資料遺失、安全漏洞
- **P1**: 功能異常、效能嚴重下降
- **P2**: 程式碼品質、可維護性
- **Nit**: 風格建議

## 輸出格式

### Findings

#### P0
- [file:line] 問題 → 修復建議

#### P1
- [file:line] 問題 → 修復建議

#### P2
- [file:line] 問題 → 修復建議

### Tests 建議
- 建議新增的測試案例

### Merge Gate
- ✅ Ready：無 P0/P1
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

## 本地檢查結果
${LOCAL_CHECKS || '跳過'}

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

### Step 4: 整合輸出

將 Codex 的審核結果和本地檢查結果整合為標準格式。

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ Blocked 時：

1. 記住 `threadId`
2. 修復 P0/P1 問題
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ Ready

## Output

```markdown
## Codex 完整審核報告

### 本地檢查

- lint:fix: ✅ Pass / ❌ Fail
- build: ✅ Pass / ❌ Fail

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

### Tests 建議

- 建議新增的測試案例

### Merge Gate

✅ Ready / ⛔ Blocked (需修復 N 個 P0/P1)

### 循環審核

如需修復後重新審核，請使用：
`/codex-review --continue <threadId>`
```

## Examples

```bash
# 完整審核（含 lint + build）
/codex-review

# 跳過本地檢查
/codex-review --no-tests

# 聚焦特定區域
/codex-review --focus "database queries"

# 與 main 分支比較
/codex-review --base origin/main

# 修復後繼續審核（保持上下文）
/codex-review --continue abc123
```
