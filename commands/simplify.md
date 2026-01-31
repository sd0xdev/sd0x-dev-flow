---
description: Wrap-up refactoring — simplify code, eliminate duplication, preserve behavior
argument-hint: <file or directory>
allowed-tools: Read, Grep, Glob, Edit, Bash(TEST_ENV=unit npx jest:*)
---

## Task

For `$ARGUMENTS`:

1. **Run tests first** (establish baseline)
2. **Refactor**
   - Dead code removal
   - Extract duplicates (3+ repeats)
   - Simplify nesting (> 3 levels)
3. **Run tests again** (confirm nothing broken)

## Output

```markdown
## Refactoring Summary

- [file:line] <change>

## Test Results

✅/❌

## Next Steps

- <suggestions>
```

## Constraints

- ❌ Do not change business logic
- ❌ Do not add new features
