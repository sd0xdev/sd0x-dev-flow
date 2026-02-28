#!/usr/bin/env bash
# obsidian-preflight.sh — Doctor + vault resolve + config for Obsidian CLI
# Usage: bash obsidian-preflight.sh [--check] [--vault <name>] [--print-env]
set -euo pipefail

CONFIG_DIR="${HOME}/.sd0x"
CONFIG_FILE="${CONFIG_DIR}/obsidian-cli.env"
TIMEOUT_SEC=5

# ---------- helpers ----------
die()  { echo "STATUS=error"; echo "ERROR=$*" >&2; exit 1; }
info() { echo "$*"; }

# ---------- portable timeout ----------
# macOS lacks coreutils `timeout` by default; try gtimeout then perl fallback
_timeout_cmd=""
find_timeout() {
  if command -v timeout >/dev/null 2>&1; then _timeout_cmd="timeout"; return 0; fi
  if command -v gtimeout >/dev/null 2>&1; then _timeout_cmd="gtimeout"; return 0; fi
  if command -v perl >/dev/null 2>&1; then _timeout_cmd="__perl"; return 0; fi
  return 1
}
find_timeout || die "No timeout command found. Install coreutils: brew install coreutils"

run_with_timeout() {
  local secs="$1"; shift
  if [ "$_timeout_cmd" = "__perl" ]; then
    perl -e '$s = shift @ARGV; $p = fork // die "fork: $!"; if (!$p) { exec @ARGV or die "exec: $!" } $SIG{ALRM} = sub { kill 9, $p; waitpid($p,0); exit 124 }; alarm $s; waitpid($p, 0); exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)' "$secs" "$@"
  else
    "$_timeout_cmd" "$secs" "$@"
  fi
}

# ---------- locate obsidian CLI ----------
find_obsidian() {
  if command -v obsidian >/dev/null 2>&1; then
    echo "obsidian"
    return 0
  fi
  # macOS fallback
  local app_bin="/Applications/Obsidian.app/Contents/MacOS/obsidian"
  if [ -x "$app_bin" ]; then
    echo "$app_bin"
    return 0
  fi
  return 1
}

# ---------- resolve vault ----------
# Precedence: --vault arg > OBSIDIAN_VAULT env > config file > CLI default
resolve_vault() {
  local explicit="${1:-}"

  # 1. Explicit argument
  if [ -n "$explicit" ]; then
    echo "$explicit"
    return 0
  fi

  # 2. Environment variable
  if [ -n "${OBSIDIAN_VAULT:-}" ]; then
    echo "$OBSIDIAN_VAULT"
    return 0
  fi

  # 3. Persisted config
  if [ -f "$CONFIG_FILE" ]; then
    local saved
    saved=$(grep "^OBSIDIAN_VAULT=" "$CONFIG_FILE" 2>/dev/null \
      | sed "s/^OBSIDIAN_VAULT=//" | head -1 || true)
    if [ -n "$saved" ]; then
      echo "$saved"
      return 0
    fi
  fi

  # 4. CLI-discovered default (timeout-protected)
  local cli_vault
  cli_vault=$(run_with_timeout "$TIMEOUT_SEC" "$OBSIDIAN_BIN" vault 2>/dev/null | head -1 || true)
  if [ -n "$cli_vault" ]; then
    echo "$cli_vault"
    return 0
  fi

  return 1
}

# ---------- persist vault config ----------
persist_vault() {
  local vault="$1"
  mkdir -p "$CONFIG_DIR"
  # Store unquoted — one key per line, read with sed strip prefix
  (umask 077; printf "OBSIDIAN_VAULT=%s\n" "$vault" > "$CONFIG_FILE")
  info "Vault persisted: $vault"
}

# ---------- doctor check ----------
cmd_check() {
  # CLI exists?
  OBSIDIAN_BIN=$(find_obsidian) || die "Obsidian CLI not found. Enable in Settings > General > CLI, then add to PATH."

  # Version check (timeout-protected)
  local version rc=0
  version=$(run_with_timeout "$TIMEOUT_SEC" "$OBSIDIAN_BIN" version 2>/dev/null) || rc=$?
  if [ $rc -eq 124 ]; then
    die "Obsidian CLI timed out after ${TIMEOUT_SEC}s. Is the desktop app running?"
  elif [ -z "$version" ]; then
    die "Obsidian CLI returned no version (exit $rc). Is the desktop app running?"
  fi

  # Vault resolution
  local vault
  vault=$(resolve_vault "${VAULT_ARG:-}") || die "No vault found. Set with --vault <name> or OBSIDIAN_VAULT env."

  info "STATUS=ok"
  info "VAULT=$vault"
  info "OBSIDIAN_VERSION=$version"
}

# ---------- main ----------
VAULT_ARG=""
ACTION="check"

while [ $# -gt 0 ]; do
  case "$1" in
    --check)     ACTION="check"; shift ;;
    --vault)     ACTION="vault"; VAULT_ARG="${2:-}"; [ -n "$VAULT_ARG" ] || die "--vault requires a name"; shift 2 ;;
    --print-env) ACTION="print-env"; shift ;;
    *)           die "Unknown option: $1" ;;
  esac
done

OBSIDIAN_BIN=$(find_obsidian) || die "Obsidian CLI not found. Enable in Settings > General > CLI, then add to PATH."

case "$ACTION" in
  check)
    cmd_check
    ;;
  vault)
    persist_vault "$VAULT_ARG"
    # Also run check to confirm
    cmd_check
    ;;
  print-env)
    info "OBSIDIAN_BIN=$OBSIDIAN_BIN"
    info "CONFIG_FILE=$CONFIG_FILE"
    if [ -f "$CONFIG_FILE" ]; then
      cat "$CONFIG_FILE"
    else
      info "(no config file)"
    fi
    ;;
esac
