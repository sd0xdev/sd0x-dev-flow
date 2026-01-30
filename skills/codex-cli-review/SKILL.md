---
name: codex-cli-review
description: Use Codex CLI (not MCP) to review uncommitted changes. Codex explores the codebase independently with full disk read access.
allowed-tools: Bash(bash:*), Read, Grep, Glob
context: fork
---

# Codex CLI Review Skill

## Trigger

- Keywords: codex cli review, cli review, 腳本審核, script review

## When to Use

- 需要 Codex 自主探索整個專案（完整磁碟讀取）
- 不需要 MCP 的上下文保持功能
- 想要使用 Codex CLI 原生的審核格式

## When NOT to Use

- 需要循環審核（用 `/codex-review-fast --continue`）
- 需要追問 Codex（用 MCP 版本）
- 只想看 diff 不想等 Codex 探索（用 `/codex-review-fast`）

## Difference from MCP Version

| 特性       | CLI 版本（本 skill） | MCP 版本         |
| ---------- | -------------------- | ---------------- |
| 自主探索   | ✅ 完整磁碟讀取      | ⚠️ 需明確指示    |
| 上下文保持 | ❌ 無                | ✅ threadId      |
| 循環審核   | ❌ 每次獨立          | ✅ --continue    |
| 格式       | Codex 原生格式       | 自訂 prompt 格式 |
| 執行方式   | 腳本調用             | MCP tool 調用    |

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: 檢查變更                                                │
├─────────────────────────────────────────────────────────────────┤
│ git status --porcelain                                          │
│ 無變更 → 提早退出                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: 執行 Codex CLI                                          │
├─────────────────────────────────────────────────────────────────┤
│ codex review --uncommitted                                      │
│   -c 'sandbox_permissions=["disk-full-read-access"]'            │
│                                                                 │
│ Codex 會自主：                                                   │
│ - 讀取變更的檔案                                                 │
│ - 探索相關的依賴                                                 │
│ - 查看現有測試                                                   │
│ - 理解專案結構                                                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: 輸出審核結果                                            │
├─────────────────────────────────────────────────────────────────┤
│ Codex 原生格式：                                                 │
│ - Summary                                                       │
│ - Issues (Critical/Major/Minor/Suggestion)                      │
│ - Recommendations                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Script

```bash
bash skills/codex-cli-review/scripts/review.sh [options]
```

### Options

| 參數                | 說明           |
| ------------------- | -------------- |
| `--base <branch>`   | 與指定分支比較 |
| `--title "<text>"`  | 設定審核標題   |
| `--prompt "<text>"` | 自訂審核指令   |

### I/O Contract

**Input:**

- Git working directory with changes

**Output:**

- Codex 審核報告（stdout）
- Exit code: 0 = 成功, 非 0 = 失敗

## Verification

- [ ] 腳本執行無錯誤
- [ ] Codex 有探索專案（看 output 中有 file references）
- [ ] 輸出包含 Issues 分類

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

## Related

| 命令/Skill             | 差異                      |
| ---------------------- | ------------------------- |
| `/codex-review-fast`   | MCP 版本，支援循環審核    |
| `/codex-review`        | MCP 版本，含 lint + build |
| `/codex-review-branch` | MCP 版本，審核整個分支    |
