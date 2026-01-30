---
description: 調查代碼歷史，追蹤變更來源和根本原因
argument-hint: <file:line> 或 <關鍵字>
allowed-tools: Bash(git:*), Read, Grep, Glob
skills: git-investigate
---

## Task

調查代碼歷史，找出變更來源。

### 調查目標

```
$ARGUMENTS
```

支援格式：

- `src/path/file.ts:123` - 特定檔案行號
- `functionName` - 函數名稱
- `"error message"` - 關鍵字搜尋

### 執行指引

遵循 skill 中的流程和命令：

| 階段     | 參考文件                                               |
| -------- | ------------------------------------------------------ |
| 流程     | @skills/git-investigate/SKILL.md               |
| Git 命令 | @skills/git-investigate/references/commands.md |

## Examples

```bash
/git-investigate src/service/order/order.ts:50
/git-investigate "calculateFee"
/git-investigate "TypeError: Cannot read property"
```
