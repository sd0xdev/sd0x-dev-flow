---
description: 收尾重構：簡化代碼、消除重複、不改行為
argument-hint: <file or directory>
allowed-tools: Read, Grep, Glob, Edit, Bash(TEST_ENV=unit npx jest:*)
---

## Task

針對 `$ARGUMENTS`：

1. **先跑測試**（確認 baseline）
2. **重構**
   - Dead code removal
   - Extract duplicates (3+ repeats)
   - Simplify nesting (> 3 levels)
3. **再跑測試**（確認沒破壞）

## Output

```markdown
## 重構摘要

- [file:line] <change>

## 測試結果

✅/❌

## 下一步

- <suggestions>
```

## 限制

- ❌ 不改業務邏輯
- ❌ 不加新功能
