---
description: 用 Codex MCP 解釋複雜代碼邏輯
argument-hint: <file-path> [--lines <start>-<end>] [--depth brief|normal|deep]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`

## Task

你現在要使用 Codex MCP 解釋代碼邏輯。

### Arguments 解析

```
$ARGUMENTS
```

| 參數                    | 說明                               |
| ----------------------- | ---------------------------------- |
| `<file-path>`           | 必填，要解釋的檔案                 |
| `--lines <start>-<end>` | 可選，指定行範圍                   |
| `--depth <level>`       | 可選，解釋深度 (brief/normal/deep) |

### Depth Levels

| Level  | 說明                                 |
| ------ | ------------------------------------ |
| brief  | 一句話摘要                           |
| normal | 標準解釋（預設）                     |
| deep   | 深入分析：設計模式、複雜度、潛在問題 |

### Step 1: 讀取目標檔案

```bash
Read(FILE_PATH)
```

如果指定了 `--lines`，只提取該範圍的代碼。

### Step 2: 執行 Codex 解釋

使用 `mcp__codex__codex` 工具：

```typescript
mcp__codex__codex({
  prompt: `你是一位資深軟體工程師。請解釋以下代碼。

## 檔案資訊
- 路徑：${FILE_PATH}
- 範圍：${LINE_RANGE}
- 深度：${DEPTH}

## 代碼內容
\`\`\`typescript
${CODE_CONTENT}
\`\`\`

## ⚠️ 重要：你必須自主調研專案 ⚠️

在解釋代碼前，你**必須**執行以下調研：

### 調研步驟
1. 了解專案結構：\`ls src/\`
2. 搜尋相關依賴：\`grep -r "import.*from" ${FILE_PATH} | head -10\`
3. 讀取被引用的模組：\`cat <依賴路徑> | head -100\`
4. 搜尋調用此代碼的地方：\`grep -r "函數名" src/ --include="*.ts" -l | head -5\`

### 驗證重點
- 這段代碼在專案中的角色是什麼？
- 它與其他模組如何互動？
- 有哪些地方調用了這段代碼？

## 解釋要求（根據深度）

### brief
一句話摘要功能。

### normal
1. 功能概述
2. 執行流程（步驟分解）
3. 關鍵概念說明

### deep
1. 功能概述
2. 執行流程（步驟分解）
3. 使用的設計模式
4. 時間/空間複雜度
5. 潛在問題或改進建議
6. 依賴關係分析

## 輸出格式（使用繁體中文）

### 功能摘要
<一句話描述>

### 詳細解釋
<逐段解釋>

### 關鍵概念
- <概念1>: <說明>
- <概念2>: <說明>

### 專案關聯（基於調研）
- 被哪些模組調用
- 依賴哪些模組`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Output

```markdown
## 代碼解釋報告

### 檔案資訊

- 路徑：<file-path>
- 範圍：<line-range>
- 深度：<depth>

### 功能摘要

<一句話描述>

### 詳細解釋

<逐段解釋>

### 關鍵概念

- <概念>: <說明>

### 專案關聯

- 被調用位置：<locations>
- 依賴模組：<dependencies>
```

## Examples

```bash
# 解釋整個檔案
/codex-explain src/service/order/order.service.ts

# 解釋特定行範圍
/codex-explain src/service/order/order.service.ts --lines 50-100

# 深入分析
/codex-explain src/service/xxx.ts --depth deep
```
