---
description: 驗證迴圈：lint → typecheck → unit → integration → e2e
argument-hint: [fast|full]
allowed-tools: Bash(node:*), Bash(yarn:*), Bash(npx:*), Read, Grep
---

## Context

- Branch: !`git branch --show-current`
- Changes: !`git diff --stat HEAD`

## Task

1. Run the repo verify runner:

```
node scripts/verify-runner.js $ARGUMENTS
```

2. `$ARGUMENTS` == "fast" → lint + unit only
3. Otherwise → lint → typecheck → unit → integration → e2e
4. Integration/E2E 預設只跑單檔，需明確指定路徑：

```
node scripts/verify-runner.js --integration test/integration/xxx.test.ts
node scripts/verify-runner.js --e2e test/e2e/xxx.test.ts
```

## Output

```markdown
## Results

| Step      | Status |
| --------- | ------ |
| lint      | ✅/❌  |
| typecheck | ✅/❌  |
| unit      | ✅/❌  |

## Failures（如有）

- Root cause: <first error>
- Fix: <suggestion>
```
