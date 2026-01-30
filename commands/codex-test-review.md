---
description: 用 Codex MCP 審查測試案例是否足夠，建議增加的邊界案例。支援循環審核上下文保持。
argument-hint: [<file-or-dir|描述>] [--type unit|integration|e2e] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
skills: test-review
---

## Context

- Git status: !`git status -sb`
- Git diff (test files): !`git diff --name-only HEAD 2>/dev/null | grep -E '\.test\.ts$' | head -5`

## Task

你現在要使用 Codex MCP 審查測試覆蓋是否足夠。

### Arguments 解析

```
$ARGUMENTS
```

### 智能輸入

| 輸入           | 範例                     | 行為                         |
| -------------- | ------------------------ | ---------------------------- |
| 檔案路徑       | `test/unit/xxx.test.ts`  | 直接審查該檔案               |
| 目錄           | `test/unit/service/`     | 審查目錄下所有測試           |
| 「未提交」描述 | `"檢查未提交代碼的測試"` | 自動找 git diff 變更的檔案   |
| 模組名稱       | `"portfolio service"`    | 搜尋相關測試檔案             |
| 無參數         | -                        | 自動偵測 git diff 或最近修改 |
| `--continue`   | `--continue <threadId>`  | 繼續之前的審核會話           |

### Step 1: 智能偵測審查目標

根據 $ARGUMENTS 決定審查目標：

1. **有具體檔案/目錄路徑**：直接使用
2. **有描述性文字**：搜尋相關測試檔案
3. **無參數**：偵測 git diff 中的測試檔案，或最近修改的測試

使用 `Read`、`Glob`、`Grep` 工具找出：

- `TEST_FILE`：測試檔案路徑
- `SOURCE_FILE`：對應的源碼檔案（從測試路徑推測）
- `TEST_TYPE`：unit / integration / e2e

### Step 2: 讀取測試與源碼內容

```bash
# 讀取測試檔案
Read(TEST_FILE)

# 讀取對應源碼（如果存在）
# test/unit/service/xxx.test.ts → src/service/xxx.ts
Read(SOURCE_FILE)
```

### Step 3: 執行審核

**情況 A：首次審核（無 `--continue`）**

使用 `mcp__codex__codex` 工具啟動新審核會話：

```typescript
mcp__codex__codex({
  prompt: `你是資深測試工程師，專精於 TypeScript/Jest 測試。請審查測試覆蓋是否足夠。

## 測試類型：${TEST_TYPE}

## 測試檔案
\`\`\`typescript
${TEST_CONTENT}
\`\`\`

## 對應源碼
\`\`\`typescript
${SOURCE_CONTENT}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

在審核測試覆蓋時，你**必須**執行以下調研，不要只依賴上面提供的內容：

### 調研步驟
1. 了解專案結構：\`ls src/\`、\`ls test/\`
2. 搜尋相關源碼：\`grep -r "className" src/ --include="*.ts" -l | head -10\`
3. 讀取源碼了解完整邏輯：\`cat <源碼路徑> | head -150\`
4. 搜尋現有測試模式：\`ls test/unit/\` 或 \`cat test/unit/xxx.test.ts | head -50\`
5. 找出源碼中的所有分支和錯誤處理路徑

### 驗證重點
- 源碼中有哪些 public 方法？測試是否覆蓋？
- 源碼中有哪些 if/else/switch 分支？測試是否覆蓋？
- 源碼中有哪些 try/catch？測試是否覆蓋錯誤路徑？
- 源碼中的參數驗證邏輯是否有測試？

## 審核維度

### 1. 覆蓋完整性
- 所有 public 方法是否都有測試
- 所有分支（if/else/switch）是否都覆蓋
- 所有錯誤處理路徑是否都測試

### 2. 邊界條件
- 空值處理：null、undefined、空字串、空陣列
- 極值處理：0、負數、最大值、最小值
- 特殊字元：特殊符號、unicode、emoji

### 3. 錯誤場景
- 外部服務失敗（API 錯誤、超時）
- 無效輸入
- 資源不存在
- 權限不足

### 4. 併發與狀態
- 多次呼叫的行為
- 狀態變更的正確性
- Race condition

### 5. Mock 合理性（僅 Unit Test）
- Mock 是否過度（導致測試無效）
- Mock 是否不足（導致測試不穩定）

## 輸出格式

### 覆蓋評估

| 維度 | 評分（1-5⭐） | 說明 |
|------|--------------|------|
| 正向路徑 | ... | ... |
| 錯誤處理 | ... | ... |
| 邊界條件 | ... | ... |
| Mock 合理性 | ... | ... |

### 🔴 必須補充（P0/P1）

列出缺失的關鍵測試案例，並提供建議的測試程式碼。

### 🟡 建議補充（P2）

列出可選的邊界案例測試。

### Gate

- 無 🔴 項目：✅ 測試充足
- 有 🔴 項目：⛔ 需補充測試`,
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
    prompt: `我已補充測試案例。請重新審核：

## 更新後的測試檔案
\`\`\`typescript
${TEST_CONTENT}
\`\`\`

請驗證：
1. 之前指出的 🔴 缺失是否已補充？
2. 新增的測試是否正確覆蓋問題場景？
3. 是否引入了新的測試問題？
4. 更新 Gate 狀態`,
  });
```

### Step 4: 整合輸出

將 Codex 的審核結果整理為標準格式。

## Review Loop 自動化

**⚠️ 遵循 @CLAUDE.md 審核循環規則 ⚠️**

當審核結果為 ⛔ 需補充測試 時：

1. 記住 `threadId`
2. 補充缺失的測試
3. 使用 `--continue <threadId>` 重新審核
4. 重複直到 ✅ 測試充足

## Output

````markdown
## 測試覆蓋審查報告

### 審查範圍

- 檔案：<TEST_FILE>
- 類型：Unit / Integration / E2E
- 對應源碼：<SOURCE_FILE>

### 覆蓋評估

| 維度        | 評分      | 說明 |
| ----------- | --------- | ---- |
| 正向路徑    | ⭐⭐⭐⭐☆ | ...  |
| 錯誤處理    | ⭐⭐⭐☆☆  | ...  |
| 邊界條件    | ⭐⭐☆☆☆   | ...  |
| Mock 合理性 | ⭐⭐⭐⭐☆ | ...  |

### 🔴 必須補充（P0/P1）

1. **缺失**：<description>
   - **位置**：`src/xxx.ts:123`
   - **建議測試**：
     ```typescript
     it('should ...', () => { ... });
     ```

### 🟡 建議補充（P2）

1. **缺失**：<description>
   - **邊界條件**：<edge case>

### 邊界案例建議

| 類型 | 案例                  | 優先級 |
| ---- | --------------------- | ------ |
| 空值 | null / undefined 輸入 | P1     |
| 極值 | 最大/最小值邊界       | P2     |
| 併發 | 多請求同時處理        | P2     |
| 超時 | 外部服務超時          | P1     |

### Gate

✅ 測試充足 / ⛔ 需補充測試 (N 個 🔴 項目)

### 循環審核

如需補充後重新審核，請使用：
`/codex-test-review --continue <threadId>`
````

## Examples

```bash
# 指定檔案
/codex-test-review test/unit/service/xxx.test.ts

# 檢查未提交代碼
/codex-test-review "檢查未提交代碼測試案例是否足夠"

# 檢查特定模組
/codex-test-review "portfolio service 測試"

# 自動偵測
/codex-test-review

# 補充後繼續審核（保持上下文）
/codex-test-review --continue abc123
```
