---
description: 用 Codex MCP 為指定函數生成單元測試
argument-hint: <file-path> [--function <name>] [--output <path>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Write
skills: test-review
---

## Context

- Git status: !`git status -sb`

## Task

你現在要使用 Codex MCP 生成單元測試。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                | 說明                     |
| ------------------- | ------------------------ |
| `<file-path>`       | 必填，要生成測試的源檔案 |
| `--function <name>` | 可選，指定函數名稱       |
| `--output <path>`   | 可選，指定輸出路徑       |

### Step 1: 讀取源檔案

```bash
Read(FILE_PATH)
```

將源檔案內容保存為 `SOURCE_CONTENT`。

### Step 2: 推導測試檔案路徑

如果沒有指定 `--output`，自動推導：

- `src/service/xxx.service.ts` → `test/unit/service/xxx.service.test.ts`
- `src/provider/yyy.ts` → `test/unit/provider/yyy.test.ts`

### Step 3: 執行 Codex 生成測試

使用 `mcp__codex__codex` 工具：

```typescript
mcp__codex__codex({
  prompt: `你是一位 測試專家。請為以下代碼生成完整的單元測試。

## 源檔案
- 路徑：${FILE_PATH}
- 函數：${FUNCTION_NAME || 'all'}

\`\`\`typescript
${SOURCE_CONTENT}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

在生成測試前，你**必須**執行以下調研：

### 調研步驟
1. 了解測試結構：\`ls test/unit/\`、\`ls test/integration/\`
2. 搜尋相似測試：\`ls test/unit/service/\` 或 \`grep -r "describe" test/unit/ --include="*.ts" -l | head -5\`
3. 讀取現有測試範例：\`cat <相似測試路徑> | head -100\`
4. 了解源碼依賴：\`grep -r "import" ${FILE_PATH} | head -10\`
5. 搜尋相關 interface/type：\`grep -r "interface" src/ --include="*.ts" -l | head -5\`

### 驗證重點
- 專案使用什麼測試模式？
- Mock 是如何設置的？
- 現有測試使用什麼 assertion 風格？

## 測試框架
- Jest
- {FRAMEWORK_MOCK_LIB}

## 測試規範
1. 每個 public 方法至少一個測試
2. 覆蓋正常路徑和邊界情況
3. 使用 mock 隔離外部依賴
4. 測試名稱清晰描述預期行為
5. 遵循 AAA 模式（Arrange-Act-Assert）

## 測試模板
\`\`\`typescript
import { createApp, close } from '{FRAMEWORK_MOCK_LIB}';
// import { Framework } from '{FRAMEWORK_WEB}';
// import { Application } from '{FRAMEWORK_CORE}';

describe('ServiceName', () => {
  let app: Application;
  let service: ServiceClass;

  beforeAll(async () => {
    app = await createApp<Framework>();
    service = await app.getApplicationContext().getAsync(ServiceClass);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('methodName', () => {
    it('should do something when condition', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
\`\`\`

## 輸出要求
1. 只輸出完整的測試代碼
2. 包含所有必要的 import
3. 使用 describe/it 組織測試
4. 參考專案現有測試風格
5. 添加適當的註釋說明測試目的`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

### Step 4: 保存測試檔案

將 Codex 生成的測試代碼保存到目標路徑：

```bash
Write(OUTPUT_PATH, TEST_CODE)
```

## Output

```markdown
## 測試生成報告

### 檔案資訊

- 源檔案：<source-path>
- 測試檔案：<test-path>
- 函數：<function-name or all>

### 生成結果

測試代碼已保存到：`<test-path>`

### 測試結構

- describe: <ServiceName>
  - describe: <methodName>
    - it: should ...
    - it: should ...

### 下一步

1. 執行測試：`TEST_ENV=unit yarn jest <test-path>`
2. 審查測試：`/codex-test-review <test-path>`
```

## Examples

```bash
# 為整個檔案生成測試
/codex-test-gen src/service/user/user.service.ts

# 為特定函數生成測試
/codex-test-gen src/service/user/user.service.ts --function getUserById

# 指定輸出路徑
/codex-test-gen src/service/xxx.ts --output test/unit/xxx.test.ts
```
