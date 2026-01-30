---
description: 建立或更新需求單。新建時自動填模板，更新時根據實作進度同步。
argument-hint: [--update <file-path>] [--feature <name>]
allowed-tools: Read, Grep, Glob, Write, Bash
skills: create-request
---

## Context

- Git status: !`git status -sb`
- Recent commits: !`git log --oneline -5`
- Existing requests: !`ls docs/features/*/requests/*.md 2>/dev/null | tail -5`

## Task

根據 $ARGUMENTS 決定模式：

### Arguments

```
$ARGUMENTS
```

| 參數               | 說明                        |
| ------------------ | --------------------------- |
| `--update <path>`  | 更新模式：指定需求單路徑    |
| `--feature <name>` | 建立模式：指定 feature area |
| 無參數             | 從上下文自動判斷            |

### Mode Detection

```
有 --update        → Update Mode
有 --feature       → Create Mode
上下文有需求單引用 → Update Mode（確認後）
其他               → Create Mode（詢問資訊）
```

### Create Mode

遵循 skill 中的 Create Mode Workflow：

1. **Gather**: 收集 feature, title, priority, requirements
2. **Explore**: 搜尋相關代碼 + 技術方案
3. **Generate**: 填充模板 + 建立檔案
4. **Confirm**: 顯示結果 + 建議下一步

### Update Mode

遵循 skill 中的 Update Mode Workflow：

1. **Load**: 讀取現有需求單
2. **Analyze**: 分析 Related Files + git 變更
3. **Map**: 比對實作與 Acceptance Criteria
4. **Update**: 更新 Progress / Status / Checkboxes
5. **Report**: 輸出變更摘要

## Output

### Create Mode Output

```markdown
## 需求單已建立

- 路徑：`docs/features/{feature}/requests/YYYY-MM-DD-title.md`
- 狀態：Pending

### 下一步建議

1. `/tech-spec` - 撰寫技術方案
2. `/codex-architect` - 獲取架構建議
```

### Update Mode Output

```markdown
## 需求單更新報告

### 檔案

`docs/features/{feature}/requests/YYYY-MM-DD-title.md`

### 變更摘要

| 區塊                | 變更                     |
| ------------------- | ------------------------ |
| Status              | Pending → In Development |
| Progress.開發       | ⬜ → 🔄 進行中           |
| Progress.測試       | ⬜ → 🔄 進行中           |
| Acceptance Criteria | 2/5 → 4/5 ✅             |

### Git 活動

- `abc1234` feat: Implement token branch fix
- `def5678` test: Add near-zero denominator test

### 下一步

- [ ] 完成剩餘 Acceptance Criteria
- [ ] 執行 `/codex-review-fast`
- [ ] 執行 `/precommit`
```

## Examples

```bash
# 建立新需求單（互動式）
/create-request

# 建立指定 feature 的需求單
/create-request --feature auth

# 更新指定需求單
/create-request --update docs/features/auth/requests/2026-01-23-fix-login-validation.md

# 根據上下文自動更新（開發完成後）
/create-request --update
```

## Workflow Position

```
需求 → /create-request → /tech-spec → /feature-dev → /create-request --update
                                                              ↑
                                                        （同步進度）
```
