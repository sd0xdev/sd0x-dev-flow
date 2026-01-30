---
description: 初始化專案設定。自動偵測框架、PM、資料庫，替換 CLAUDE.md 所有 placeholder。
argument-hint: [--detect-only]
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git:*), Bash(ls:*)
skills: project-setup
---

## Context

- Repo root: !`git rev-parse --show-toplevel`
- package.json exists: !`test -f package.json && echo "yes" || echo "no"`

## Task

為當前專案初始化 CLAUDE.md 設定。

### Arguments

```
$ARGUMENTS
```

- `--detect-only`：只偵測並顯示結果，不寫入 CLAUDE.md

### 執行指引

遵循 skill 中的流程和結構規範：

| 階段 | 參考文件 |
| ---- | ------- |
| 流程 | @skills/project-setup/SKILL.md |
| 偵測規則 | @skills/project-setup/references/detection-rules.md |

## Examples

```bash
# 自動偵測 + 確認 + 寫入
/project-setup

# 只偵測，不修改
/project-setup --detect-only
```
