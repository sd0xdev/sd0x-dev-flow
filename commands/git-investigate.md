---
description: Investigate code history, track change origins and root causes
argument-hint: <file:line> or <keyword>
allowed-tools: Bash(git:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/git-investigate/SKILL.md

## Task

Investigate code history to find the source of changes.

### Investigation Target

```
$ARGUMENTS
```

Supported formats:

- `src/path/file.ts:123` - Specific file and line number
- `functionName` - Function name
- `"error message"` - Keyword search

## Examples

```bash
/git-investigate src/service/order/order.ts:50
/git-investigate "calculateFee"
/git-investigate "TypeError: Cannot read property"
```
