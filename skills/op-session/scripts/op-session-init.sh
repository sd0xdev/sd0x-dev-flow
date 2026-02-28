#!/usr/bin/env bash
# op-session-init.sh — Initialize 1Password CLI session for Claude Code
# Usage: bash op-session-init.sh [--account <shorthand>] [--check] [--clear] [--list]
# Supports both token-based and App Integration auth modes.
set -euo pipefail

SESSION_FILE="${HOME}/.op-claude-session"

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "$*"; }

# Extract a field value from session file: extract_field "OP_SESSION"
extract_field() {
  grep -o "^export $1='[^']*'" "$SESSION_FILE" 2>/dev/null \
    | sed "s/^export $1='//;s/'$//" || true
}

# Write session file with restricted permissions
write_session() {
  local mode="$1" token="$2" account="$3"
  (umask 077; cat > "$SESSION_FILE" <<EOF
export OP_AUTH_MODE='$mode'
export OP_SESSION='$token'
export OP_ACCOUNT='$account'
EOF
  )
}

# ---------- subcommands ----------
cmd_check() {
  command -v op >/dev/null 2>&1 || die "op CLI not found. Install: https://developer.1password.com/docs/cli/get-started/"

  if [ ! -f "$SESSION_FILE" ]; then
    info "STATUS=no_session"
    info "MODE=none"
    info "No active session. Run /op-session to initialize."
    exit 0
  fi

  local mode token account
  mode=$(extract_field "OP_AUTH_MODE")
  token=$(extract_field "OP_SESSION")
  account=$(extract_field "OP_ACCOUNT")

  # Legacy inference: no OP_AUTH_MODE but OP_SESSION present → token mode
  if [ -z "$mode" ] && [ -n "$token" ]; then mode="token"; fi

  case "$mode" in
    token)
      [ -n "$token" ] || { info "STATUS=invalid"; info "MODE=token"; exit 1; }
      if op whoami --session "$token" >/dev/null 2>&1; then
        ACCOUNT_INFO=$(op whoami --session "$token" --format json 2>/dev/null || echo '{}')
        info "STATUS=active"
        info "MODE=token"
        info "ACCOUNT=$ACCOUNT_INFO"
      else
        info "STATUS=expired"
        info "MODE=token"
        info "Session expired. Run /op-session to refresh."
      fi
      ;;
    app)
      if op whoami ${account:+--account "$account"} >/dev/null 2>&1; then
        ACCOUNT_INFO=$(op whoami ${account:+--account "$account"} --format json 2>/dev/null || echo '{}')
        info "STATUS=active"
        info "MODE=app"
        info "ACCOUNT=$ACCOUNT_INFO"
      else
        info "STATUS=locked"
        info "MODE=app"
        info "1Password app may be locked. Unlock and retry, or run /op-session to reinitialize."
      fi
      ;;
    *)
      info "STATUS=invalid"
      info "MODE=unknown"
      info "Invalid session file. Run /op-session to reinitialize."
      exit 1
      ;;
  esac
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
  local account_name=""
  local account_args=()

  # Parse args
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --account) [[ $# -ge 2 ]] || die "--account requires a value"; account_name="$2"; account_args=(--account "$2"); shift 2 ;;
      *) shift ;;
    esac
  done

  # Preflight
  command -v op >/dev/null 2>&1 || die "op CLI not found. Install: https://developer.1password.com/docs/cli/get-started/"

  # Sign in and get token (triggers ONE biometric prompt in token mode)
  info "Signing in to 1Password CLI..."
  local TOKEN
  TOKEN=$(op signin --raw "${account_args[@]}" 2>/dev/null) || true

  if [ -n "$TOKEN" ]; then
    # ---------- Token mode ----------
    # Verify before writing
    op whoami --session "$TOKEN" >/dev/null 2>&1 \
      || die "op signin returned a token but verification failed. Check your 1Password account."

    # Resolve account if not provided
    if [ -z "$account_name" ]; then
      account_name=$(op whoami --session "$TOKEN" --format json 2>/dev/null \
        | grep -o '"account_uuid":"[^"]*"' | head -1 \
        | sed 's/"account_uuid":"//;s/"//' || true)
    fi

    write_session "token" "$TOKEN" "$account_name"

    ACCOUNT_EMAIL=$(op whoami --session "$TOKEN" --format json 2>/dev/null \
      | grep -o '"email":"[^"]*"' | head -1 || echo "")
    info "SESSION_FILE=$SESSION_FILE"
    info "ACCOUNT=$ACCOUNT_EMAIL"
    info "ACCOUNT_ID=$account_name"
    info "MODE=token"
    info "EXPIRES=30min idle / 12hr hard limit"
    info "STATUS=active"
  else
    # ---------- App Integration mode ----------
    # op signin --raw returned empty; check if app integration auth works
    if op whoami "${account_args[@]}" >/dev/null 2>&1; then
      # Resolve account if not provided
      if [ -z "$account_name" ]; then
        account_name=$(op whoami --format json 2>/dev/null \
          | grep -o '"account_uuid":"[^"]*"' | head -1 \
          | sed 's/"account_uuid":"//;s/"//' || true)
      fi

      write_session "app" "" "$account_name"

      ACCOUNT_EMAIL=$(op whoami ${account_name:+--account "$account_name"} --format json 2>/dev/null \
        | grep -o '"email":"[^"]*"' | head -1 || echo "")
      info "SESSION_FILE=$SESSION_FILE"
      info "ACCOUNT=$ACCOUNT_EMAIL"
      info "ACCOUNT_ID=$account_name"
      info "MODE=app"
      info "EXPIRES=10min idle (auto-refresh) / 12hr hard limit (managed by 1Password app)"
      info "STATUS=active"
    else
      die "op signin returned empty token and op whoami failed. Check your 1Password app is running and unlocked."
    fi
  fi
}

# ---------- dispatch ----------
case "${1:-}" in
  --check) cmd_check ;;
  --list)  cmd_list ;;
  --clear) cmd_clear ;;
  *)       cmd_init "$@" ;;
esac
