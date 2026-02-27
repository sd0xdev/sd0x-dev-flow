---
description: Initialize 1Password CLI session to avoid repeated biometric prompts
argument-hint: [--account <name>] [--list] [--check] [--clear]
allowed-tools: Bash(bash:*)
---

## Context

- Session file: !`bash -c 'test -f "$HOME/.op-claude-session" && echo "exists" || echo "No session file"' 2>/dev/null || echo "unknown (sandbox)"`
- op CLI: !`bash -c 'command -v op >/dev/null 2>&1 && op --version 2>/dev/null || echo "op CLI not found"' 2>/dev/null || echo "unknown (sandbox)"`

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
| `--account <name>` | 1Password account identifier — shorthand or UUID (optional, uses default) |
| `--list` | List available 1Password accounts |
| `--check` | Check current session status |
| `--clear` | Remove session file |

### Workflow

| Mode | Command | Success Confirmation |
|------|---------|---------------------|
| Init (default) | `bash skills/op-session/scripts/op-session-init.sh` | Verify `STATUS=active`, remind wrapper usage |
| `--account <id>` | `bash skills/op-session/scripts/op-session-init.sh --account <id>` | Verify `STATUS=active` for specified account |
| `--check` | `bash skills/op-session/scripts/op-session-init.sh --check` | Report returned status (`active`/`expired`/`no_session`/`invalid`) |
| `--list` | `bash skills/op-session/scripts/op-session-init.sh --list` | Display account list only |
| `--clear` | `bash skills/op-session/scripts/op-session-init.sh --clear` | Confirm session file removed |

After successful init, all subsequent `op` calls must use:
`bash skills/op-session/scripts/op-with-session.sh <subcommand> [args]`

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
