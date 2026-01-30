---
description: Bug/Issue 修復流程。調查 → 定位 → 修復 → 測試 → 審查。
argument-hint: [issue-url 或問題描述]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(yarn:*), Bash(gh:*)
skills: bug-fix
---

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Task

進行 Bug/Issue 修復。

### Arguments

```
$ARGUMENTS
```

### 流程

遵循 skill 中的工作流：

| 階段 | 動作                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 調查 | `gh issue view` / `Grep` / `/git-investigate`                              |
| 定位 | `Read` 相關代碼                                                            |
| 修復 | `Edit` 最小修改                                                            |
| 測試 | 補充對應層級測試 (見 @skills/bug-fix/references/testing-guide.md) |
| 審查 | `/verify` → `/codex-review-fast` → `/precommit`                            |

### 測試要求 ⚠️

| Bug 類型     | 必須        | 建議        |
| ------------ | ----------- | ----------- |
| 邏輯錯誤     | Unit        | -           |
| Service 問題 | Unit        | Integration |
| API 問題     | Integration | E2E         |
| 用戶流程     | E2E         | -           |

## Examples

```bash
/bug-fix https://github.com/user/repo/issues/123
/bug-fix "API 回傳 500 錯誤當 token 為空"
/bug-fix "TypeError: Cannot read property 'balance'"
```
