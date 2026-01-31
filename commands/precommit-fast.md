---
description: Quick pre-commit checks — lint:fix -> test:unit
allowed-tools: Bash(node:*), Read
---

## Context

- Run: !`node scripts/precommit-runner.js --mode fast --tail 60`

## Task

Always use the script `scripts/precommit-runner.js` to run all checks first.
If needed, manually run `{LINT_FIX_COMMAND}` and `{TEST_COMMAND}`.

## Output

```markdown
## Results

| Step      | Status |
| --------- | ------ |
| lint:fix  | ✅/❌  |
| test:unit | ✅/❌  |

## Checklist

- [ ] Both checks pass
- [ ] git status clean
```
