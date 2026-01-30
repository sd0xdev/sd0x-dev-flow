---
description: 創建或重構 Claude Code skill
argument-hint: <skill-name> [docs-path]
allowed-tools: Read, Grep, Glob, Write, Task
skills: create-skill
---

## Task

創建或重構 skill。

### 參數

```
$ARGUMENTS
```

### 執行指引

遵循 skill 中的流程和結構規範：

| 階段 | 參考文件                              |
| ---- | ------------------------------------- |
| 流程 | @skills/create-skill/SKILL.md |

## Examples

```bash
/create-skill circuit-breaker docs/features/resilience
/create-skill codex-brainstorm  # 重構現有 skill
```
