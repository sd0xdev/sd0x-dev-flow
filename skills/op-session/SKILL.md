---
name: op-session
description: "Initialize 1Password CLI session for Claude Code. Use when: starting a session that needs 1Password secrets, op CLI keeps prompting biometric auth, setting up OP_SESSION token. Solves: Claude Code's no-TTY subprocess model triggers 1Password biometric auth on every op call. Supports both token-based and App Integration auth modes — auto-detects which mode to use."
allowed-tools: Bash(bash:*)
---

# 1Password Session for Claude Code

## Problem

Claude Code executes each Bash tool call in a new subprocess without TTY. 1Password CLI's app integration binds auth to the terminal session, so every `op` call triggers a biometric prompt.

## Solution

Auto-detect the auth mode and configure accordingly:

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Token** | `op signin --raw` returns a token | Cache token in `~/.op-claude-session`; wrapper passes `--session` flag |
| **App Integration** | `op signin --raw` returns empty + `op whoami` succeeds | Record mode in session file; wrapper calls `op` directly (IPC with desktop app) |

## Workflow

```
/op-session [--account <name>]
     │
     ▼
 op signin --raw
     │
     ├─ token non-empty ──► Token mode
     │                       Verify → write session file → done
     │
     └─ token empty ──► op whoami succeeds?
                          ├─ YES → App Integration mode
                          │        Write session file (no token) → done
                          └─ NO  → ERROR: signin failed
```

## Usage

### Initialize Session

```bash
bash skills/op-session/scripts/op-session-init.sh
# or with specific account
bash skills/op-session/scripts/op-session-init.sh --account my-team
```

### List Available Accounts

```bash
bash skills/op-session/scripts/op-session-init.sh --list
```

### Check Session Status

```bash
bash skills/op-session/scripts/op-session-init.sh --check
```

### Clear Session

```bash
bash skills/op-session/scripts/op-session-init.sh --clear
```

### Subsequent `op` Calls (Recommended)

Use the secure helper script — it handles mode detection, token loading, validation, and expiry:

```bash
bash skills/op-session/scripts/op-with-session.sh read "op://vault/item/field"
bash skills/op-session/scripts/op-with-session.sh item list --vault Production
bash skills/op-session/scripts/op-with-session.sh whoami
```

The helper:
- Auto-detects auth mode from session file (`OP_AUTH_MODE`)
- Token mode: passes `--session` and `--account` flags
- App mode: passes only `--account` flag (auth via desktop app IPC)
- Validates session before each call
- Returns clear error if session is missing, expired, or app is locked

## Session Lifecycle

| Event | Token Mode | App Integration Mode |
|-------|-----------|---------------------|
| Idle timeout | 30 min → expires | 10 min → expires (auto-refresh on use) |
| Each `op` call | Resets idle timer | Resets idle timer |
| Hard limit | 12hr | 12hr |
| 1Password app locks | Does NOT revoke token | Next `op` call fails until unlocked |
| `/op-session --clear` | Removes session file | Removes session file |

## Session File Format

```bash
# Token mode
export OP_AUTH_MODE='token'
export OP_SESSION='<session-token>'
export OP_ACCOUNT='<account-id>'

# App Integration mode
export OP_AUTH_MODE='app'
export OP_SESSION=''
export OP_ACCOUNT='<account-id>'
```

Legacy session files (without `OP_AUTH_MODE`) are auto-detected as token mode if `OP_SESSION` is non-empty.

## Security

| Aspect | Token Mode | App Integration Mode |
|--------|-----------|---------------------|
| Token at rest | `~/.op-claude-session` (owner-only via `umask 077`) | No token stored |
| Process args | `--session $TOKEN` visible to same-user processes | No `--session` flag |
| Auth control | Token possession = access | Desktop app biometric |
| Scope | All vaults you can access | All vaults you can access |
| Risk level | Moderate (token on disk) | Lower (no token on disk) |
| Mitigation | Short-lived token, `--clear` when done | App auto-manages session |

## Known Limitations

| Limitation | Cause | Workaround |
|-----------|-------|------------|
| `ls` on home-dir paths blocked in `!` context checks | Claude Code sandbox may restrict `ls`/`find` to working directory in command template expansion | Use `test -f` via `bash -c` wrapper; see `commands/op-session.md` |
| `allowed-tools` cannot be narrowed to specific script paths | `${CLAUDE_PLUGIN_ROOT}` unavailable in command markdown ([#9354](https://github.com/anthropics/claude-code/issues/9354)) | Keep `Bash(bash:*)` until upstream fix |
| Context check is best-effort UI | Sandbox policy may tighten | Authoritative status via `bash skills/op-session/scripts/op-session-init.sh --check` |
| App mode fails when desktop app is locked | CLI cannot IPC with locked app | Unlock 1Password app, or run `/op-session` to reinitialize |

## Prerequisites

- 1Password CLI (`op`) installed and configured
- 1Password desktop app running (for initial biometric auth)
- Account signed in to 1Password app
