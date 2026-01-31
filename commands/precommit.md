---
description: Pre-commit checks — lint:fix -> build -> test:unit
allowed-tools: Bash(node:*), Read
---

## Context

- Run: !`node scripts/precommit-runner.js --mode full --tail 80`

## Task

Always use the script `scripts/precommit-runner.js` to run all checks first.
If needed, manually run `{LINT_FIX_COMMAND}` and `{BUILD_COMMAND}` and `{TEST_COMMAND}`.

## Output

```markdown
## Results

| Step      | Status |
| --------- | ------ |
| lint:fix  | ✅/❌  |
| build     | ✅/❌  |
| test:unit | ✅/❌  |

## Changed Files (after lint:fix)

- <files>

## Checklist

- [ ] All three checks pass
- [ ] git status clean
```
