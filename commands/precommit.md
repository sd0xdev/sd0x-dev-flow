---
description: 提交前檢查：lint:fix → build → test:unit
allowed-tools: Bash(node:*), Read
---

## Context

- Run: !`node scripts/precommit-runner.js --mode full --tail 80`

## Task

一律使用腳本指令 `scripts/precommit-runner.js` 先執行所有檢查。
如有需要，可以手動執行 `{LINT_FIX_COMMAND}` 和 `{BUILD_COMMAND}` 和 `{TEST_COMMAND}`。

## Output

```markdown
## 結果

| Step      | Status |
| --------- | ------ |
| lint:fix  | ✅/❌  |
| build     | ✅/❌  |
| test:unit | ✅/❌  |

## 變更檔案（lint:fix 後）

- <files>

## Checklist

- [ ] 三件套全過
- [ ] git status 乾淨
```
