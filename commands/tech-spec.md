---
description: 根據需求產出技術功能方案文件
argument-hint: <需求描述> [--request] [--no-save]
allowed-tools: Read, Grep, Glob, Bash(git:*), Write
skills: tech-spec
---

## Task

根據需求產出技術方案文件。

### 需求

```
$ARGUMENTS
```

### 執行指引

遵循 skill 中的流程和模板：

| 階段     | 參考文件                                         |
| -------- | ------------------------------------------------ |
| 流程     | @skills/tech-spec/SKILL.md               |
| 方案模板 | @skills/tech-spec/references/template.md |

### 參數說明

- `--request` - 同時生成需求單
- `--no-save` - 不儲存到 docs/

## Examples

```bash
/tech-spec "新增用戶配額管理功能"
/tech-spec "優化快取效能" --request
```
