---
description: 快速提交檢查：lint:fix → test:unit
allowed-tools: Bash(node:*), Read
---

## Context

- Run: !`node scripts/precommit-runner.js --mode fast --tail 60`

## Task

一律使用腳本指令 `scripts/precommit-runner.js` 先執行所有檢查。
如有需要，可以手動執行 `{LINT_FIX_COMMAND}` 和 `{TEST_COMMAND}`。

## Output

```markdown
## 結果

| Step      | Status |
| --------- | ------ |
| lint:fix  | ✅/❌  |
| test:unit | ✅/❌  |

## Checklist

- [ ] 兩項全過
- [ ] git status 乾淨
```
