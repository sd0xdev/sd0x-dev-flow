---
description: Verification loop — lint -> typecheck -> unit -> integration -> e2e
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

2. `$ARGUMENTS` == "fast" -> lint + unit only
3. Otherwise -> lint -> typecheck -> unit -> integration -> e2e
4. Integration/E2E default to single file only; specify path explicitly:

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

## Failures (if any)

- Root cause: <first error>
- Fix: <suggestion>
```
