---
description: Initialize 1Password CLI session to avoid repeated biometric prompts
argument-hint: [--account <name>] [--list] [--check] [--clear]
allowed-tools: Bash(bash:*)
---

## Context

- Session file: !`ls -la ~/.op-claude-session 2>/dev/null || echo "No session file"`
- op CLI: !`command -v op 2>/dev/null && op --version 2>/dev/null || echo "op CLI not found"`

## Task

Initialize a 1Password CLI session for this Claude Code session.

**Must read and follow the skill below:**

@skills/op-session/SKILL.md

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--account <name>` | 1Password account shorthand (optional, uses default) |
| `--list` | List available 1Password accounts |
| `--check` | Check current session status |
| `--clear` | Remove session file |

### Workflow

1. Run `bash skills/op-session/scripts/op-session-init.sh` with provided arguments
2. On success, confirm session is active
3. Remind: all subsequent `op` calls must use `bash skills/op-session/scripts/op-with-session.sh <subcommand> [args]`

## Examples

```bash
# Initialize with default account
/op-session

# Initialize with specific account
/op-session --account my-team

# List available accounts
/op-session --list

# Check if session is still valid
/op-session --check

# Clean up session
/op-session --clear
```
