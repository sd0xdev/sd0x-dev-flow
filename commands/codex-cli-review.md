---
description: 用 Codex CLI（非 MCP）審核未提交變更。Codex 會自主探索整個專案。
argument-hint: [--base <branch>] [--title "<text>"] [--prompt "<text>"]
allowed-tools: Bash(bash:*)
skills: codex-cli-review
---

## Context

- Git status: !`git status -sb`
- Changed files: !`git diff --name-only HEAD 2>/dev/null | head -10`

## Task

使用 Codex CLI 審核未提交變更。

### Arguments

```
$ARGUMENTS
```

### 執行腳本

```bash
bash skills/codex-cli-review/scripts/review.sh $ARGUMENTS
```

## Difference from MCP Version

| 特性       | CLI 版本（本命令） | MCP 版本      |
| ---------- | ------------------ | ------------- |
| 自主探索   | ✅ 完整磁碟讀取    | ⚠️ 需明確指示 |
| 上下文保持 | ❌ 無              | ✅ threadId   |
| 循環審核   | ❌ 每次獨立        | ✅ --continue |

## Output

Codex 原生審核格式：

- **Summary**: 變更概述
- **Issues**: Critical / Major / Minor / Suggestion
- **Recommendations**: 改進建議

## Review Loop

**注意**：此命令不支援循環審核（無上下文保持）。

如需循環審核，請使用：

```bash
/codex-review-fast --continue <threadId>
```

## Examples

```bash
# 審核未提交變更
/codex-cli-review

# 與 main 分支比較
/codex-cli-review --base main

# 帶標題
/codex-cli-review --title "Feature: User Auth"

# 自訂審核指令
/codex-cli-review --prompt "Focus on security and performance"
```
