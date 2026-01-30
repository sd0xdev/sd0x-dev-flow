---
name: git-investigate
description: Code investigation knowledge base. Covers code history tracking, issue introduction analysis, root cause diagnosis.
allowed-tools: Bash(git:*), Read, Grep, Glob
---

# Git Investigate Skill

## Trigger

- Keywords: 代碼歷史, git blame, 追蹤變更, 誰寫的, 什麼時候改的, 根本原因, 考古

## When NOT to Use

- 代碼審查（用 codex-review）
- 功能開發（用 feature-dev）
- 只是想看代碼（直接 Read）

## Command

```bash
/git-investigate src/service/xxx.ts:123      # 特定行
/git-investigate processToken                 # 函數名稱
/git-investigate "error message"              # 關鍵字
```

## Workflow

```
定位代碼 → git blame → 找到 commit → 追蹤歷史 → 分析變更 → 報告
```

## Investigation Framework

| Question       | Method                        |
| -------------- | ----------------------------- |
| 誰寫的？       | `git blame`                   |
| 什麼時候改的？ | `git log --follow`            |
| 為什麼改？     | commit message + PR           |
| 遺漏了什麼？   | `git diff` 比較原始 vs 問題版 |

## Common Patterns

| Pattern  | Symptom       | Root Cause     |
| -------- | ------------- | -------------- |
| 類型移除 | enum 值被刪除 | 假設不再需要   |
| 條件簡化 | if 條件變少   | 重構時遺漏     |
| 重命名   | 部分地方沒改  | 搜尋不完整     |
| 邊界忽略 | 只處理主流程  | 沒考慮特殊情況 |

## Verification

- 報告包含：調查目標、作者資訊、時間線、原始 vs 問題代碼
- 根本原因有明確分析
- 修復建議具體可行

## References

- `references/commands.md` - Git 命令速查 + 報告模板

## Examples

```
輸入：這行代碼是誰改的？
動作：git blame → 找到 commit → 追蹤 PR → 輸出報告
```

```
輸入：這個 bug 是什麼時候引入的？
動作：git log -p -S → 定位引入點 → 分析原因 → 輸出報告
```
