# Git Investigation Commands

## Locate Author

```bash
# View line author
git blame -L 120,130 src/service/xxx.ts

# Show more context
git blame -L 120,130 -C -C src/service/xxx.ts
```

## Search Changes

```bash
# Search code additions/deletions
git log -p --all -S "keyword" -- "*.ts" | head -150

# Search commit messages
git log --grep="keyword" --oneline

# Track file history
git log --oneline --follow -- src/service/xxx.ts
```

## View Details

```bash
# Show commit info
git show abc123 --stat

# View file at specific commit
git show abc123:src/service/xxx.ts

# Compare versions
git diff abc123..def456 -- src/service/xxx.ts
```

## Find Deleted Code

```bash
# Find commit that deleted code
git log -p --all -S "deleted_code" -- "*.ts"
```

## Find PR Info

```bash
# From commit message (#123)
gh pr view 123
```

## Cross Reference

```bash
# Related changes in same period
git log --since="2024-01-01" --until="2024-01-31" --oneline -- src/service/
```

## Common Problem Patterns

| Pattern      | Symptom       | Root Cause     |
| ------------ | ------------- | -------------- |
| Type Removed | enum 值被刪除 | 假設不再需要   |
| Condition    | if 條件變少   | 重構時遺漏     |
| Rename       | 部分地方沒改  | 搜尋不完整     |
| Boundary     | 只處理主流程  | 沒考慮特殊情況 |
| Merge        | 代碼異常      | 解衝突時出錯   |

## Output Template

```markdown
# 代碼調查報告

## 調查目標

- 檔案：`<file>`
- 範圍：`<lines or function>`

## 作者資訊

| 角色     | 作者 | 時間       | Commit |
| -------- | ---- | ---------- | ------ |
| 原始作者 | @xxx | yyyy-mm-dd | abc123 |
| 問題引入 | @yyy | yyyy-mm-dd | def456 |

## 變更時間線

| 日期 | Commit | PR  | 變更說明 |
| ---- | ------ | --- | -------- |

## 原始代碼

\`\`\`typescript
// <commit>
<original code>
\`\`\`

## 問題代碼

\`\`\`typescript
// <commit>
<problematic code>
\`\`\`

## 根本原因分析

<分析>

## 建議修復

<修復方向>
```
