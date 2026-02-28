#!/usr/bin/env bash
# obsidian-exec.sh — Safe exec wrapper for Obsidian CLI intents
# Usage: bash obsidian-exec.sh <intent> [args...]
# Intents: context, capture, daily, task
set -euo pipefail

TIMEOUT_SEC=15
CONFIG_FILE="${HOME}/.sd0x/obsidian-cli.env"

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }

# ---------- portable timeout ----------
# macOS lacks coreutils `timeout` by default; try gtimeout then perl fallback
_timeout_cmd=""
find_timeout() {
  if command -v timeout >/dev/null 2>&1; then _timeout_cmd="timeout"; return 0; fi
  if command -v gtimeout >/dev/null 2>&1; then _timeout_cmd="gtimeout"; return 0; fi
  # perl fallback
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
  local app_bin="/Applications/Obsidian.app/Contents/MacOS/obsidian"
  if [ -x "$app_bin" ]; then
    echo "$app_bin"
    return 0
  fi
  return 1
}

OBSIDIAN_BIN=$(find_obsidian) || die "Obsidian CLI not found. Run /obsidian-cli --check first."

# ---------- resolve vault ----------
resolve_vault() {
  if [ -n "${OBSIDIAN_VAULT:-}" ]; then
    echo "$OBSIDIAN_VAULT"
    return 0
  fi
  if [ -f "$CONFIG_FILE" ]; then
    local saved
    saved=$(grep "^OBSIDIAN_VAULT=" "$CONFIG_FILE" 2>/dev/null \
      | sed "s/^OBSIDIAN_VAULT=//" | head -1 || true)
    if [ -n "$saved" ]; then
      echo "$saved"
      return 0
    fi
  fi
  # Fallback: let CLI use its default
  echo ""
  return 0
}

# ---------- safe exec with timeout ----------
safe_exec() {
  local vault
  vault=$(resolve_vault)

  # Build command as array (no eval, prevents injection)
  local cmd=("$OBSIDIAN_BIN")
  if [ -n "$vault" ]; then
    cmd+=(--vault "$vault")
  fi
  cmd+=("$@")

  local rc=0
  run_with_timeout "$TIMEOUT_SEC" "${cmd[@]}" 2>&1 || rc=$?
  if [ $rc -eq 124 ]; then
    die "Command timed out after ${TIMEOUT_SEC}s. Is Obsidian app responsive?"
  fi
  return $rc
}

# ---------- intent: context ----------
intent_context() {
  local query="" limit=10
  while [ $# -gt 0 ]; do
    case "$1" in
      --query) query="${2:-}"; [ -n "$query" ] || die "--query requires a value"; shift 2 ;;
      --limit) limit="${2:-}"; [ -n "$limit" ] || die "--limit requires a value"; shift 2 ;;
      *) die "context: unknown arg: $1" ;;
    esac
  done
  [ -n "$query" ] || die "context: --query is required"
  safe_exec search query="$query" limit="$limit"
}

# ---------- intent: capture ----------
intent_capture() {
  local file="" text=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --file) file="${2:-}"; [ -n "$file" ] || die "--file requires a path"; shift 2 ;;
      --text) text="${2:-}"; [ -n "$text" ] || die "--text requires content"; shift 2 ;;
      *) die "capture: unknown arg: $1" ;;
    esac
  done
  [ -n "$file" ] || die "capture: --file is required"
  [ -n "$text" ] || die "capture: --text is required"

  # Check if file exists — append or create
  if safe_exec files:read path="$file" >/dev/null 2>&1; then
    safe_exec files:append path="$file" content="$text"
  else
    safe_exec files:create path="$file" content="$text"
  fi
}

# ---------- intent: daily ----------
intent_daily() {
  local text=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --text) text="${2:-}"; [ -n "$text" ] || die "--text requires content"; shift 2 ;;
      *) die "daily: unknown arg: $1" ;;
    esac
  done
  [ -n "$text" ] || die "daily: --text is required"
  safe_exec daily:append content="$text"
}

# ---------- intent: task ----------
intent_task() {
  local action="" text=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --add)  action="add"; text="${2:-}"; [ -n "$text" ] || die "--add requires text"; shift 2 ;;
      --list) action="list"; shift ;;
      *) die "task: unknown arg: $1" ;;
    esac
  done
  [ -n "$action" ] || die "task: specify --add or --list"

  case "$action" in
    add)  safe_exec daily:append content="- [ ] $text" ;;
    list) safe_exec tasks daily ;;
  esac
}

# ---------- main: dispatch intent ----------
[ $# -ge 1 ] || die "Usage: obsidian-exec.sh <intent> [args...]
Intents: context, capture, daily, task"

INTENT="$1"; shift

case "$INTENT" in
  context) intent_context "$@" ;;
  capture) intent_capture "$@" ;;
  daily)   intent_daily "$@" ;;
  task)    intent_task "$@" ;;
  *)       die "Unknown intent: $INTENT. Allowed: context, capture, daily, task" ;;
esac
