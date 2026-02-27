#!/usr/bin/env bash
# op-session-init.sh — Initialize 1Password CLI session for Claude Code
# Usage: bash op-session-init.sh [--account <shorthand>] [--check] [--clear] [--list]
set -euo pipefail

SESSION_FILE="${HOME}/.op-claude-session"

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "$*"; }

# ---------- subcommands ----------
cmd_check() {
  # Verify op CLI available + session file valid
  command -v op >/dev/null 2>&1 || die "op CLI not found. Install: https://developer.1password.com/docs/cli/get-started/"

  if [ ! -f "$SESSION_FILE" ]; then
    info "STATUS=no_session"
    info "No active session. Run /op-session to initialize."
    exit 0
  fi

  # Secure extraction (no source)
  local token
  token=$(grep -o "^export OP_SESSION='[^']*'" "$SESSION_FILE" 2>/dev/null \
    | sed "s/^export OP_SESSION='//;s/'$//" || true)
  [ -n "$token" ] || { info "STATUS=invalid"; exit 1; }

  if op whoami --session "$token" >/dev/null 2>&1; then
    ACCOUNT_INFO=$(op whoami --session "$token" --format json 2>/dev/null || echo '{}')
    info "STATUS=active"
    info "ACCOUNT=$ACCOUNT_INFO"
  else
    info "STATUS=expired"
    info "Session expired. Run /op-session to refresh."
  fi
  exit 0
}

cmd_list() {
  command -v op >/dev/null 2>&1 || die "op CLI not found. Install: https://developer.1password.com/docs/cli/get-started/"
  info "Available 1Password accounts:"
  op account list 2>&1 || die "Failed to list accounts. Is the 1Password app running?"
  exit 0
}

cmd_clear() {
  if [ -f "$SESSION_FILE" ]; then
    rm -f "$SESSION_FILE"
    info "Session file removed: $SESSION_FILE"
  else
    info "No session file to remove."
  fi
  exit 0
}

cmd_init() {
  local account_flag=""
  local account_name=""

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --account) account_flag="--account $2"; account_name="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  # Preflight
  command -v op >/dev/null 2>&1 || die "op CLI not found. Install: https://developer.1password.com/docs/cli/get-started/"

  # Sign in and get token (this triggers ONE biometric prompt)
  info "Signing in to 1Password CLI..."
  # shellcheck disable=SC2086
  TOKEN=$(op signin --raw $account_flag) || die "op signin failed. Check your 1Password app and account."

  # Resolve account shorthand from whoami if not provided
  if [ -z "$account_name" ]; then
    account_name=$(op whoami --session "$TOKEN" --format json 2>/dev/null \
      | grep -o '"account_uuid":"[^"]*"' | head -1 \
      | sed 's/"account_uuid":"//;s/"//' || true)
  fi

  # Write session file with restricted permissions (secure format)
  (umask 077; cat > "$SESSION_FILE" <<EOF
export OP_SESSION='$TOKEN'
export OP_ACCOUNT='$account_name'
EOF
  )

  # Verify
  if op whoami --session "$TOKEN" >/dev/null 2>&1; then
    ACCOUNT_EMAIL=$(op whoami --session "$TOKEN" --format json 2>/dev/null | grep -o '"email":"[^"]*"' | head -1 || echo "")
    info "SESSION_FILE=$SESSION_FILE"
    info "ACCOUNT=$ACCOUNT_EMAIL"
    info "ACCOUNT_ID=$account_name"
    info "EXPIRES=30min idle / 12hr hard limit"
    info "STATUS=active"
  else
    die "Session created but verification failed."
  fi
}

# ---------- dispatch ----------
case "${1:-}" in
  --check) cmd_check ;;
  --list)  cmd_list ;;
  --clear) cmd_clear ;;
  *)       cmd_init "$@" ;;
esac
