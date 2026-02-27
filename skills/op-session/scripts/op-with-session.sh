#!/usr/bin/env bash
# op-with-session.sh — Secure wrapper for op CLI with session token
# Usage: bash op-with-session.sh <op-subcommand> [args...]
# Example: bash op-with-session.sh read "op://vault/item/field"
set -euo pipefail

SESSION_FILE="${HOME}/.op-claude-session"

die()  { echo "ERROR: $*" >&2; exit 1; }

# ---------- Secure token extraction (no source) ----------
load_session() {
  [ -f "$SESSION_FILE" ] || die "No session file. Run /op-session first."

  # Strict extraction: only accept OP_SESSION='...' pattern
  OP_SESSION=$(grep -o "^export OP_SESSION='[^']*'" "$SESSION_FILE" 2>/dev/null \
    | sed "s/^export OP_SESSION='//;s/'$//" || true)
  [ -n "$OP_SESSION" ] || die "Invalid session file format. Run /op-session to reinitialize."

  # Optional: extract OP_ACCOUNT if present
  OP_ACCOUNT=$(grep -o "^export OP_ACCOUNT='[^']*'" "$SESSION_FILE" 2>/dev/null \
    | sed "s/^export OP_ACCOUNT='//;s/'$//" || true)
}

# ---------- Validate session ----------
validate_session() {
  if ! op whoami --session "$OP_SESSION" >/dev/null 2>&1; then
    die "Session expired. Run /op-session to refresh."
  fi
}

# ---------- Main ----------
[ $# -ge 1 ] || die "Usage: bash op-with-session.sh <op-subcommand> [args...]"

load_session
validate_session

# Build command with session flag + optional account
exec op --session "$OP_SESSION" ${OP_ACCOUNT:+--account "$OP_ACCOUNT"} "$@"
