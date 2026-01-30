---
description: 用 Codex MCP 全自動審核整個特性分支
argument-hint: [base-branch] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

## Context

- Current branch: !`git branch --show-current`
- Commits ahead of main: !`git rev-list --count main..HEAD 2>/dev/null || echo 0`
- Changed files: !`git diff --name-only main..HEAD 2>/dev/null | head -10`

## Task

你現在要使用 Codex MCP 審核整個特性分支。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                   |
| ----------------------- | ---------------------- |
| `[base-branch]`         | 基準分支（預設：main） |
| `--continue <threadId>` | 繼續之前的審核會話     |

### Step 1: 收集分支資訊

```bash
# 基本資訊
CURRENT_BRANCH=$(git branch --show-current)
BASE_BRANCH=${BASE:-main}
COMMIT_COUNT=$(git rev-list --count $BASE_BRANCH..HEAD)

# 變更的檔案
CHANGED_FILES=$(git diff --name-only $BASE_BRANCH..HEAD)

# 完整 diff（限制大小）
GIT_DIFF=$(git diff $BASE_BRANCH..HEAD --no-color | head -3000)

# commit 歷史
COMMIT_HISTORY=$(git log --oneline $BASE_BRANCH..HEAD)
```

### Step 2: 執行 Codex 審核

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具：

```typescript
mcp__codex__codex({
  prompt: `你是資深 Code Reviewer。請全面審核這個特性分支的所有變更。

## 分支資訊
- 當前分支：${CURRENT_BRANCH}
- 基準分支：${BASE_BRANCH}
- Commit 數量：${COMMIT_COUNT}

## Commit 歷史
${COMMIT_HISTORY}

## 變更的檔案
${CHANGED_FILES}

## Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

在審核分支前，你**必須**執行以下調研：

### 調研步驟
1. 了解專案結構：\`ls src/\`、\`ls test/\`
2. 讀取變更的核心檔案：\`cat <主要變更檔案> | head -200\`
3. 搜尋相關測試：\`ls test/unit/\` 或 \`grep -r "describe" test/ --include="*.ts" -l | head -5\`
4. 了解變更涉及的模組依賴：\`grep -r "import.*<模組名>" src/ --include="*.ts" -l | head -10\`
5. 檢查是否有遺漏的測試：比對變更檔案與測試檔案

### 驗證重點
- 這個分支的主要目的是什麼？
- 變更是否完整（包含測試、文檔）？
- 是否有潛在的副作用？

## 審核維度

### 1. 功能完整性
- Commit 是否邏輯清晰
- 是否有遺漏的變更
- 是否有未完成的 TODO

### 2. 代碼品質
- 正確性（邏輯錯誤、邊界條件）
- 類型安全（TypeScript）
- 錯誤處理覆蓋

### 3. 安全性
- 注入攻擊風險
- 認證/授權繞過
- 敏感資料處理

### 4. 效能
- N+1 查詢
- 記憶體洩漏
- 阻塞操作

### 5. 測試覆蓋
- 新代碼是否有測試
- 測試是否足夠
- 是否有 regression 風險

### 6. 文檔
- 是否需要更新文檔
- README 是否需要更新

## 嚴重等級

- **P0**: 系統崩潰、資料遺失、安全漏洞
- **P1**: 功能異常、效能嚴重下降
- **P2**: 程式碼品質、可維護性
- **Nit**: 風格建議

## 輸出格式

### 分支概述
<一句話描述這個分支的目的>

### 審核摘要

| 維度       | 評分      | 說明 |
| ---------- | --------- | ---- |
| 功能完整性 | ⭐⭐⭐⭐☆ | ...  |
| 代碼品質   | ⭐⭐⭐⭐☆ | ...  |
| 安全性     | ⭐⭐⭐⭐⭐ | ...  |
| 效能       | ⭐⭐⭐⭐☆ | ...  |
| 測試覆蓋   | ⭐⭐⭐☆☆  | ...  |

### Findings

#### P0
- [file:line] 問題 → 修復建議

#### P1
- [file:line] 問題 → 修復建議

#### P2
- [file:line] 問題 → 修復建議

### 遺漏項目
- 缺少的測試
- 缺少的文檔

### Merge Gate
- ✅ Ready：無 P0/P1
- ⛔ Blocked：有 P0/P1，需修復`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

**記住返回的 `threadId`，用於後續循環審核。**

**情況 B：循環審核（有 `--continue`）**

使用 `mcp__codex__codex-reply` 繼續：

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

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ Blocked 時：

1. 記住 `threadId`
2. 修復 P0/P1 問題
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ Ready

## Output

```markdown
## 分支審核報告

### 分支資訊

- 當前分支：<branch>
- 基準分支：<base>
- Commits：<count>

### 分支概述

<一句話描述>

### 審核摘要

| 維度       | 評分       | 說明 |
| ---------- | ---------- | ---- |
| 功能完整性 | ⭐⭐⭐⭐☆  | ...  |
| 代碼品質   | ⭐⭐⭐⭐☆  | ...  |
| 安全性     | ⭐⭐⭐⭐⭐ | ...  |
| 效能       | ⭐⭐⭐⭐☆  | ...  |
| 測試覆蓋   | ⭐⭐⭐☆☆   | ...  |

### Findings

#### P0 (必須修復)

- [file:line] 問題 → 修復建議

#### P1 (應該修復)

- [file:line] 問題 → 修復建議

### Merge Gate

✅ Ready / ⛔ Blocked (需修復 N 個 P0/P1)

### 循環審核

如需修復後重新審核：
`/codex-review-branch --continue <threadId>`
```

## Examples

```bash
# 審核當前分支（與 main 比較）
/codex-review-branch

# 與指定分支比較
/codex-review-branch origin/develop

# 修復後繼續審核
/codex-review-branch --continue abc123
```
