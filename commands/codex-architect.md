---
description: 用 Codex 獲取架構/設計建議（第三大腦）
argument-hint: "<question>" [--context <files>] [--mode design|review|compare]
allowed-tools: Read, Grep, Glob, mcp__codex__codex, mcp__codex__codex-reply
skills: codex-architect
---

## Task

獲取 Codex 的架構建議，形成雙視角。

### 問題

```
$ARGUMENTS
```

### 執行指引

遵循 skill 中的流程和模板：

| 階段     | 參考文件                                                        |
| -------- | --------------------------------------------------------------- |
| 流程     | @skills/codex-architect/SKILL.md                        |
| 專案知識 | @skills/codex-architect/references/project-knowledge.md |

## Examples

```bash
/codex-architect "這個快取設計合理嗎？" --context src/service/cache/
/codex-architect "微服務 vs 單體？" --mode compare
```
