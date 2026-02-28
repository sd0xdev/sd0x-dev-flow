---
name: obsidian-cli
description: "Obsidian vault integration via official CLI. Use when: capturing dev artifacts to Obsidian vault, searching vault for context, appending to daily note, managing tasks in vault. Not for: general note-taking without Obsidian (use regular files), browsing Obsidian docs (use agent-browser). Output: vault search results, captured notes, task updates."
allowed-tools: Bash(bash:*)
---

# Obsidian CLI Integration

## Trigger

- Keywords: obsidian, vault, daily note, capture to vault, search vault, obsidian task

## When NOT to Use

- Obsidian is not installed or CLI is not enabled
- User wants to edit markdown files directly (just use Read/Write)
- User wants to browse Obsidian docs (use agent-browser)
- User wants general task management without Obsidian

## Prerequisites

- Obsidian v1.12+ with CLI enabled (Settings > General > Command line interface)
- Obsidian desktop app must be running (CLI uses IPC)

## Workflow

```
/obsidian-cli [intent] [args]
     │
     ▼
 obsidian-preflight.sh --check
     │
     ├─ FAIL → Report issue + remediation
     │
     └─ OK → Resolve vault
              │
              ▼
         obsidian-exec.sh <intent> [args]
              │
              ├─ context → search vault, return results
              ├─ capture → write note/append to file
              ├─ daily   → append to daily note
              └─ task    → add/query tasks
```

## Scripts

| Script | Purpose | Invocation |
|--------|---------|------------|
| `obsidian-preflight.sh` | Doctor + vault resolve + config | `bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh [--check\|--vault <id>\|--print-env]` |
| `obsidian-exec.sh` | Safe intent execution with timeout | `bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh <intent> [args]` |

### Preflight

```bash
# Check CLI + app + IPC readiness
bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh --check

# Set default vault
bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh --vault "My Vault"

# Print resolved env (for debugging)
bash scripts/run-skill.sh obsidian-cli obsidian-preflight.sh --print-env
```

Output lines:
```
STATUS=ok|error
VAULT=<resolved-vault-name>
OBSIDIAN_VERSION=<version>
ERROR=<message if STATUS=error>
```

### Exec Intents

| Intent | Args | CLI Commands Used |
|--------|------|-------------------|
| `context` | `--query <q> [--limit N]` | `obsidian search` |
| `capture` | `--file <path> --text <content>` | `obsidian files:create`, `obsidian files:append` |
| `daily` | `--text <content>` | `obsidian daily:append` |
| `task` | `--add <text>` or `--list` | `obsidian tasks` |

```bash
# Search vault for context
bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh context --query "auth middleware"

# Capture a decision record
bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh capture --file "dev/decisions/2026-02-28-auth.md" --text "..."

# Append to daily note
bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh daily --text "- Implemented auth middleware refactor"

# Add a task
bash scripts/run-skill.sh obsidian-cli obsidian-exec.sh task --add "Review PR #42 auth changes"
```

## Vault Resolution Policy

Deterministic precedence (first match wins):

1. `--vault <name>` explicit argument
2. `OBSIDIAN_VAULT` environment variable
3. `~/.sd0x/obsidian-cli.env` persisted default
4. CLI-discovered active vault

## Verification

- [ ] `obsidian-preflight.sh --check` outputs `STATUS=ok`
- [ ] Vault resolution returns correct vault name
- [ ] Each intent produces expected CLI output
- [ ] Timeout handles IPC hang gracefully (exit 124)

## References

- `references/integration-patterns.md` — read when planning how to integrate Obsidian into dev workflow
- `references/troubleshooting.md` — read when preflight fails or commands time out

## Examples

```bash
# First-time setup: check readiness and set default vault
/obsidian-cli --check
/obsidian-cli --vault "Dev Notes"

# During development: search for related notes
/obsidian-cli context --query "rate limiting implementation"

# After making a decision: capture it
/obsidian-cli capture --file "decisions/2026-02-28-rate-limit.md" --text "Decided to use sliding window..."

# End of session: log what was done
/obsidian-cli daily --text "- Completed rate limiting feature for API gateway"
```
