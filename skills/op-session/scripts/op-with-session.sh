#!/usr/bin/env bash
# op-with-session.sh — Secure wrapper for op CLI with session management
# Usage: bash op-with-session.sh <op-subcommand> [args...]
# Example: bash op-with-session.sh read "op://vault/item/field"
# Supports both token-based and App Integration auth modes.
set -euo pipefail

SESSION_FILE="${HOME}/.op-claude-session"

die()  { echo "ERROR: $*" >&2; exit 1; }

# Extract a field value from session file: extract_field "OP_SESSION"
extract_field() {
  grep -o "^export $1='[^']*'" "$SESSION_FILE" 2>/dev/null \
    | sed "s/^export $1='//;s/'$//" || true
}

# ---------- Secure session loading (no source) ----------
load_session() {
  [ -f "$SESSION_FILE" ] || die "No session file. Run /op-session first."

  OP_AUTH_MODE=$(extract_field "OP_AUTH_MODE")
  OP_SESSION=$(extract_field "OP_SESSION")
  OP_ACCOUNT=$(extract_field "OP_ACCOUNT")

  # Legacy inference: no OP_AUTH_MODE but OP_SESSION present → token mode
  if [ -z "$OP_AUTH_MODE" ] && [ -n "$OP_SESSION" ]; then
    OP_AUTH_MODE="token"
  fi

  [ -n "$OP_AUTH_MODE" ] || die "Invalid session file format. Run /op-session to reinitialize."
}

# ---------- Validate session ----------
validate_session() {
  case "$OP_AUTH_MODE" in
    token)
      op whoami --session "$OP_SESSION" >/dev/null 2>&1 \
        || die "Session expired. Run /op-session to refresh."
      ;;
    app)
      op whoami ${OP_ACCOUNT:+--account "$OP_ACCOUNT"} >/dev/null 2>&1 \
        || die "1Password app may be locked. Run /op-session to reinitialize."
      ;;
    *)
      die "Unknown auth mode '$OP_AUTH_MODE'. Run /op-session to reinitialize."
      ;;
  esac
}

# ---------- Main ----------
[ $# -ge 1 ] || die "Usage: bash op-with-session.sh <op-subcommand> [args...]"

load_session
validate_session

# Execute op with mode-appropriate flags
case "$OP_AUTH_MODE" in
  token)
    exec op --session "$OP_SESSION" ${OP_ACCOUNT:+--account "$OP_ACCOUNT"} "$@"
    ;;
  app)
    exec op ${OP_ACCOUNT:+--account "$OP_ACCOUNT"} "$@"
    ;;
esac
