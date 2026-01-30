---
description: GitHub Issue 深度分析。讀取 issue → 分類問題 → 選擇調查策略 → 整合四種調查工具。
argument-hint: <issue-number 或 issue-url>
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(gh:*), mcp__codex__codex
skills: issue-analyze
---

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Task

分析 GitHub Issue 並產出根因分析報告。

### Arguments

```
$ARGUMENTS
```

### 執行流程

```bash
# Step 1: 讀取 Issue
gh issue view <number> --json title,body,labels,comments,author,createdAt

# Step 2: 問題分類（見 SKILL.md 決策樹）
# - 回歸問題 → /git-investigate
# - 功能不理解 → /code-explore
# - 複雜根因 → /code-investigate
# - 多種可能 → /codex-brainstorm

# Step 3: 執行調查

# Step 4: 產出報告
```

### 執行指引

遵循 skill 中的流程：

| 階段 | 參考文件                                                    |
| ---- | ----------------------------------------------------------- |
| 流程 | @skills/issue-analyze/SKILL.md                      |
| 分類 | @skills/issue-analyze/references/classification.md  |
| 報告 | @skills/issue-analyze/references/report-template.md |

## When to Use

- ✅ 需要深入分析 GitHub Issue
- ✅ 不確定問題根因
- ✅ 需要系統性調查

## When NOT to Use

- ❌ 已知根因，直接修復（用 `/bug-fix`）
- ❌ 簡單問題，直接查代碼

## Examples

```bash
# 分析指定 issue 編號
/issue-analyze 123

# 分析 issue URL
/issue-analyze https://github.com/user/repo/issues/123

# 分析描述（無 issue 時）
/issue-analyze "API 回傳 500 當 token 為空"
```
