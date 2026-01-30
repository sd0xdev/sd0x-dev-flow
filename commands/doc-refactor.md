---
description: 重構文件：精簡、不失訊息量、用 sequenceDiagram 視覺化流程。
argument-hint: <file path>
allowed-tools: Read, Grep, Glob, Edit
---

## Task

針對 `$ARGUMENTS` 指定的文件：

1. **分析原始內容**

   - 計算行數
   - 識別核心資訊 vs 冗餘

2. **重構**

   - 長段落 → 表格
   - 步驟 → sequenceDiagram
   - 重複 → 單一來源

3. **驗證**
   - 關鍵資訊保留
   - 行數減少

## 精簡標準

| 文件類型       | 目標行數 |
| -------------- | -------- |
| CLAUDE.md      | < 50     |
| rules/\*.md    | < 30     |
| agents/\*.md   | < 50     |
| commands/\*.md | < 40     |

## Output

```markdown
## 重構結果

- 原始：X 行
- 精簡：Y 行（-Z%）

## 變更

- <summary>
```
