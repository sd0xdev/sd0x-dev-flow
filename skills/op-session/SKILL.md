---
name: op-session
description: "Initialize 1Password CLI session for Claude Code. Use when: starting a session that needs 1Password secrets, op CLI keeps prompting biometric auth, setting up OP_SESSION token. Solves: Claude Code's no-TTY subprocess model triggers 1Password biometric auth on every op call. After running once, all subsequent op commands use the cached session token."
allowed-tools: Bash(bash:*)
---

# 1Password Session for Claude Code

## Problem

Claude Code executes each Bash tool call in a new subprocess without TTY. 1Password CLI's app integration binds auth to the terminal session, so every `op` call triggers a biometric prompt.

## Solution

Use `op signin --raw` to get a session token once, store it in `~/.op-claude-session`. Use the secure helper script `op-with-session.sh` for all subsequent `op` calls.

## Workflow

```
/op-session [--account <name>]
     │
     ▼
 op signin --raw  ← ONE biometric prompt
     │
     ▼
 ~/.op-claude-session  ← token + account (mode 600)
     │
     ▼
 bash scripts/op-with-session.sh read "op://vault/item/field"
```

## Usage

### Initialize Session

```bash
bash scripts/op-session-init.sh
# or with specific account
bash scripts/op-session-init.sh --account my-team
```

### List Available Accounts

```bash
bash scripts/op-session-init.sh --list
```

### Check Session Status

```bash
bash scripts/op-session-init.sh --check
```

### Clear Session

```bash
bash scripts/op-session-init.sh --clear
```

### Subsequent `op` Calls (Recommended)

Use the secure helper script — it handles token loading, validation, and expiry detection:

```bash
bash scripts/op-with-session.sh read "op://vault/item/field"
bash scripts/op-with-session.sh item list --vault Production
bash scripts/op-with-session.sh whoami
```

The helper:
- Extracts token via strict parsing (no `source` — prevents shell injection)
- Validates session before each call
- Passes `--session` and `--account` flags automatically
- Returns clear error if session is missing or expired

## Token Lifecycle

| Event | Behavior |
|-------|----------|
| Idle > 30 min | Token expires, re-run `/op-session` |
| Each `op` call | Resets idle timer |
| Hard limit 12hr | Token expires regardless |
| 1Password app locks | Does NOT revoke OP_SESSION tokens |
| `/op-session --clear` | Removes session file |

## Security

| Aspect | Detail |
|--------|--------|
| Token storage | `~/.op-claude-session` with mode `600` (owner read/write only) |
| Token parsing | Strict `grep`+`sed` extraction, never `source` |
| Token scope | Same as your 1Password account — all vaults you can access |
| Risk | Any process running as your user can read the file |
| Mitigation | Short-lived token (30min idle), `--clear` when done |

## Prerequisites

- 1Password CLI (`op`) installed and configured
- 1Password desktop app running (for initial biometric auth)
- Account signed in to 1Password app
