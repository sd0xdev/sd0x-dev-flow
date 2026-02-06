---
description: Claude Code configuration health check for .claude/ directory
argument-hint: [--fix]
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(wc:*), Bash(du:*), Bash(rm:*)
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- .claude/ exists: !`ls -d .claude 2>/dev/null && echo "yes" || echo "no"`

## Task

Run a health check on the `.claude/` directory structure, reporting issues and suggesting fixes.

**⚠️ Must read and follow the skill below:**

@skills/claude-health/SKILL.md

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--fix` | Auto-fix P1 issues (delete junk files, create .gitignore) |

### Workflow

Execute all 7 checks from the skill, then output a consolidated report.

## Output

See skill for output format.

## Examples

```bash
# Run health check
/claude-health

# Auto-fix P1 issues
/claude-health --fix
```
