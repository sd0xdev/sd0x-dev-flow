---
description: Investigate code history, track change origins and root causes
argument-hint: <file:line> or <keyword>
allowed-tools: Bash(git:*), Read, Grep, Glob
skills: git-investigate
---

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

### Execution Guide

Follow the workflow and commands in the skill:

| Phase        | Reference                                              |
| ------------ | ------------------------------------------------------ |
| Workflow     | @skills/git-investigate/SKILL.md               |
| Git Commands | @skills/git-investigate/references/commands.md |

## Examples

```bash
/git-investigate src/service/order/order.ts:50
/git-investigate "calculateFee"
/git-investigate "TypeError: Cannot read property"
```
