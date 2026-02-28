---
description: Interact with Obsidian vault via CLI — search, capture notes, daily log, tasks
argument-hint: [--check] [--vault <name>] [context|capture|daily|task] [args...]
allowed-tools: Bash(bash:*)
---

## Context

- Obsidian CLI: !`bash -c 'command -v obsidian >/dev/null 2>&1 && obsidian version 2>/dev/null || test -x "/Applications/Obsidian.app/Contents/MacOS/obsidian" && /Applications/Obsidian.app/Contents/MacOS/obsidian version 2>/dev/null || echo "not found"' 2>/dev/null || echo "unknown (sandbox)"`
- Config: !`bash -c 'test -f "$HOME/.sd0x/obsidian-cli.env" && cat "$HOME/.sd0x/obsidian-cli.env" || echo "no config"' 2>/dev/null || echo "unknown (sandbox)"`

## Task

Interact with Obsidian vault using the official CLI.

**Must read and follow the skill below:**

@skills/obsidian-cli/SKILL.md

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--check` | Run preflight doctor (CLI + app + vault) |
| `--vault <name>` | Set default vault |
| `context --query <q>` | Search vault for context |
| `capture --file <path> --text <content>` | Write/append note to vault |
| `daily --text <content>` | Append to today's daily note |
| `task --add <text>` | Add a task to daily note |
| `task --list` | List today's tasks |

### Workflow

1. **First use**: Run preflight to verify setup
   ```bash
   bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh --check
   ```
2. **Set vault** (if needed):
   ```bash
   bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh --vault "My Vault"
   ```
3. **Execute intent**:
   ```bash
   bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh <intent> [args]
   ```

## Examples

```bash
# Check CLI readiness
/obsidian-cli --check

# Set default vault
/obsidian-cli --vault "Dev Notes"

# Search vault for context before coding
/obsidian-cli context --query "authentication flow"

# Capture a decision
/obsidian-cli capture --file "dev/decisions/2026-02-28-auth.md" --text "Decided on JWT with refresh tokens"

# Log to daily note
/obsidian-cli daily --text "- Implemented JWT auth middleware"

# Add a follow-up task
/obsidian-cli task --add "Add rate limiting to auth endpoints"
```
