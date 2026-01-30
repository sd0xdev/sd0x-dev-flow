---
description: 用 Codex MCP 審核指定文件。支援循環審核上下文保持。
argument-hint: [<file-path>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Glob
skills: doc-review
---

## Context

- Git modified docs: !`git diff --name-only HEAD 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Git staged docs: !`git diff --cached --name-only 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Untracked docs: !`git ls-files --others --exclude-standard 2>/dev/null | grep -E '\.(md|txt)$' | head -5`

## Task

你現在要使用 Codex MCP 審核文件。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                       |
| ----------------------- | -------------------------- |
| `<file-path>`           | 文件路徑（可選，自動偵測） |
| `--continue <threadId>` | 繼續之前的審核會話         |

### Step 1: 確定目標文件

**有指定路徑**：直接使用該路徑

**無指定路徑**：按優先順序自動選擇：

1. **Git 已修改的文檔** - `git diff --name-only HEAD` 中的 `.md` 文件
2. **Git 已暫存的文檔** - `git diff --cached --name-only` 中的 `.md` 文件
3. **新增的文檔** - `git ls-files --others --exclude-standard` 中的 `.md` 文件

如果找到多個文件，列出並詢問用戶要審核哪個。

### Step 2: 讀取文件內容

```bash
Read(TARGET_FILE)
```

將文件內容保存為 `FILE_CONTENT` 變數。

### Step 3: 執行審核

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具啟動新審核會話：

```typescript
mcp__codex__codex({
  prompt: `你是資深技術文件審核專家。請審核以下文件。

## 文件資訊
- 路徑：${FILE_PATH}
- 類型：${FILE_TYPE}
- 專案根目錄：${PROJECT_ROOT}

## 文件內容
\`\`\`${FILE_TYPE}
${FILE_CONTENT}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

在審核「代碼與文檔一致性」時，你**必須**執行以下調研：

### 調研步驟
1. 執行 \`ls src/\` 了解專案結構
2. 搜尋文檔中提到的檔案/類別：\`grep -r "關鍵字" src/ --include="*.ts" -l | head -10\`
3. 讀取相關檔案：\`cat <檔案路徑> | head -100\`
4. 驗證：
   - 文檔提到的檔案是否存在？
   - 函數名/類別名是否正確？
   - 技術描述是否與實際代碼一致？

## 審核維度

### 1. 架構設計（Architecture）
- 系統邊界是否清晰
- 組件職責是否單一
- 依賴關係是否合理
- 擴展性與可維護性

### 2. 性能考量（Performance）
- 是否有潛在性能瓶頸
- 批量處理與並發設計
- 緩存策略是否合適
- 資源使用效率

### 3. 安全性（Security）
- 是否有敏感資料洩露風險
- 權限控制是否完善
- 輸入驗證是否充分
- 錯誤處理是否安全

### 4. 文件品質（Documentation Quality）
- 結構是否清晰
- 內容是否完整
- 技術描述是否準確
- 範例是否充足
- 是否符合 docs-writing 規範（表格優先、Mermaid 流程圖）

### 5. 代碼與文檔一致性（需自主調研）
- 偽代碼是否與實際 codebase 風格一致
- 引用的檔案/方法是否存在（**執行 grep/cat 驗證**）
- 技術細節是否準確

## 輸出格式

### 審核摘要

| 維度         | 評分（1-5⭐） | 說明 |
|--------------|--------------|------|
| 架構設計     | ...          | ...  |
| 性能考量     | ...          | ...  |
| 安全性       | ...          | ...  |
| 文件品質     | ...          | ...  |
| 代碼一致性   | ...          | ...  |

### 🔴 必須修改（P0/P1）

- [章節/行號] 問題描述 → 修改建議

### 🟡 建議修改（P2）

- [章節/行號] 問題描述 → 修改建議

### ⚪ 可選改進

- 建議

### Gate

- ✅ 可合併：無 🔴 項目
- ⛔ 需修改：有 🔴 項目`,
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
    prompt: `我已修改文件。請重新審核：

## 更新後的文件內容
\`\`\`${FILE_TYPE}
${FILE_CONTENT}
\`\`\`

請驗證：
1. 之前的 🔴 必須修改項目是否已修正？
2. 修改是否引入了新問題？
3. 修改後的文件品質如何？
4. 更新 Gate 狀態`,
  });
```

### Step 4: 整合輸出

將 Codex 的審核結果整理為標準格式。

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ 需修改 時：

1. 記住 `threadId`
2. 修改文件
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ 可合併

## Output

```markdown
## 文件審核報告

### 審核文件

- 路徑：<file-path>
- 類型：<markdown|txt>

### 審核摘要

| 維度       | 評分       | 說明 |
| ---------- | ---------- | ---- |
| 架構設計   | ⭐⭐⭐⭐☆  | ...  |
| 性能考量   | ⭐⭐⭐☆☆   | ...  |
| 安全性     | ⭐⭐⭐⭐⭐ | ...  |
| 文件品質   | ⭐⭐⭐⭐☆  | ...  |
| 代碼一致性 | ⭐⭐⭐☆☆   | ...  |

### 🔴 必須修改（P0/P1）

1. [章節/行號] 問題描述 → 修改建議

### 🟡 建議修改（P2）

1. [章節/行號] 問題描述 → 修改建議

### ⚪ 可選改進

- 建議

### Gate

✅ 可合併 / ⛔ 需修改 (N 個 🔴 項目)

### 循環審核

如需修改後重新審核，請使用：
`/codex-review-doc --continue <threadId>`
```

## Examples

```bash
# 審核指定文件
/codex-review-doc docs/features/xxx/tech-spec.md

# 自動偵測變更的文檔
/codex-review-doc

# 修改後繼續審核（保持上下文）
/codex-review-doc --continue abc123
```

## 相關規範

審核時參考以下規範：

- @rules/docs-writing.md - 文檔撰寫規則
