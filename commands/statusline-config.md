---
description: Customize Claude Code statusline segments, themes, and colors.
argument-hint: [theme-name] | "add/remove <segment>" | "no args for defaults"
allowed-tools: Read, Write, Bash(bash:*), Bash(cat:*), Bash(chmod:*), Bash(echo:*), AskUserQuestion
---

**Must read and follow the skill below before executing this command:**

@skills/statusline-config/SKILL.md

## Context

- Current statusline script: !`bash -c 'cat ~/.claude/statusline-command.sh 2>/dev/null || echo "(no script found)"'`

## Task

Customize the Claude Code statusline. Follow the skill workflow strictly.

### Arguments

Parse from `$ARGUMENTS`:

| Argument | Description | Default |
|----------|-------------|---------|
| `<theme-name>` | Theme to apply: `catppuccin-mocha` (or `catppuccin`), `dracula`, `nord`, `ansi-default`, `none` | `ansi-default` |
| `add/remove <segment>` | Enable or disable a specific segment | — |
| (no args) | Apply best-practice defaults | All ON + `ansi-default` |

```
$ARGUMENTS
```

### Key Requirements

- Generated script must be POSIX `#!/bin/sh`
- Must use `jq` for JSON parsing with fallback defaults
- Must support `CLAUDE_STATUSLINE_THEME` env var and `NO_COLOR` convention
- Must verify script works after writing

## Examples

```bash
# Apply best-practice defaults
/statusline-config

# Switch to catppuccin theme (alias for catppuccin-mocha)
/statusline-config catppuccin-mocha

# Remove cost segment
/statusline-config remove cost

# Full custom setup
/statusline-config "add git, remove cost, use dracula"
```
