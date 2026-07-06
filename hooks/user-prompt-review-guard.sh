#!/usr/bin/env bash
# UserPromptSubmit Hook: Inject pending review reminder before Claude processes prompt
# stdout is injected into Claude's context (UserPromptSubmit stdout injection).
# Always exit 0 (non-blocking). Only outputs when pending review AND cooldown expired.
# Read-only: never writes to .claude_review_state.json (write authority = post-tool-review-state.sh).

set -euo pipefail

# === Plugin-defers-to-local arbitration ===
_SELF_NAME="$(basename "$0")"
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]] \
   && [[ ! -f "${CLAUDE_PROJECT_DIR}/hooks/hooks.json" ]] \
   && [[ -x "${CLAUDE_PROJECT_DIR}/.claude/hooks/${_SELF_NAME}" ]]; then
  _SETTINGS_MATCH=false
  for _sf in "${CLAUDE_PROJECT_DIR}/.claude/settings.json" \
             "${CLAUDE_PROJECT_DIR}/.claude/settings.local.json"; do
    if [[ -f "$_sf" ]]; then
      if command -v jq &>/dev/null; then
        jq -e '.hooks // {} | .. | strings | select(contains(".claude/hooks/'"${_SELF_NAME}"'"))' "$_sf" >/dev/null 2>&1 \
          && _SETTINGS_MATCH=true && break
      else
        grep -q "\.claude/hooks/${_SELF_NAME}" "$_sf" 2>/dev/null \
          && _SETTINGS_MATCH=true && break
      fi
    fi
  done
  if [[ "$_SETTINGS_MATCH" == "true" ]]; then
    exit 0  # Defer to local hook
  fi
fi

STATE_FILE=".claude_review_state.json"

# Graceful degradation: no jq = silent
if ! command -v jq &>/dev/null; then
  exit 0
fi

# Graceful degradation: no state file = silent
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# --- Read state (read-only) ---
HAS_CODE=$(jq -r '.has_code_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
HAS_DOC=$(jq -r '.has_doc_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
CODE_PASSED=$(jq -r '.code_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
DOC_PASSED=$(jq -r '.doc_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
PRE_PASSED=$(jq -r '.precommit.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")

# === Sidecar fail-closed marker ===
if [[ -f "${STATE_FILE}.blocked" ]]; then
  CODE_PASSED="false"
  DOC_PASSED="false"
  PRE_PASSED="false"
  # Fail-closed: if no change flags set, sidecar means state write failed — assume changes exist
  [[ "$HAS_CODE" != "true" && "$HAS_DOC" != "true" ]] && { HAS_CODE="true"; HAS_DOC="true"; }
fi

# Early exit: no changes tracked = nothing to remind
if [[ "$HAS_CODE" != "true" && "$HAS_DOC" != "true" ]]; then
  exit 0
fi

# --- Stale-state reconciliation (one-way: true→false only) ---
# Only run git status when state has pending changes (performance optimization)
# Include ALL untracked files (-uall, even inside newly-created dirs) to avoid false
# downgrade when only new files exist (plain -unormal misses files inside new untracked dirs)
# Skip when sidecar present — would undo fail-closed HAS_* forcing
if [[ -f "${STATE_FILE}.blocked" ]]; then
  GIT_PORCELAIN="__GIT_UNAVAILABLE__"
elif command -v timeout &>/dev/null; then
  GIT_PORCELAIN=$(timeout 3 git status --porcelain -uall 2>/dev/null) || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
elif command -v gtimeout &>/dev/null; then
  GIT_PORCELAIN=$(gtimeout 3 git status --porcelain -uall 2>/dev/null) || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
else
  # No timeout helper → cannot bound the -uall walk → skip (fail-closed: trust state flags)
  GIT_PORCELAIN="__GIT_UNAVAILABLE__"
fi
if [[ "$GIT_PORCELAIN" != "__GIT_UNAVAILABLE__" ]]; then
  # here-string (not echo | grep): grep -q's early-exit on match would SIGPIPE the
  # writer under `set -o pipefail`, flipping the pipeline non-zero and falsely
  # downgrading the flag on large -uall output.
  if [[ "$HAS_CODE" == "true" ]]; then
    if ! grep -qE '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)($|[[:space:]]|")' <<< "$GIT_PORCELAIN"; then
      HAS_CODE="false"
    fi
  fi
  if [[ "$HAS_DOC" == "true" ]]; then
    if ! grep -qE '\.(md|mdx)($|[[:space:]]|")' <<< "$GIT_PORCELAIN"; then
      HAS_DOC="false"
    fi
  fi
fi

# --- Derive next required command ---
NEXT=""
if [[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]]; then
  NEXT="/codex-review-fast"
elif [[ "$HAS_CODE" == "true" && "$CODE_PASSED" == "true" && "$PRE_PASSED" != "true" ]]; then
  NEXT="/precommit"
elif [[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]]; then
  NEXT="/codex-review-doc"
fi

# No pending step = silent
if [[ -z "$NEXT" ]]; then
  exit 0
fi

# --- Cooldown check (avoid message fatigue) ---
# Use temp file keyed by working directory hash (session-scoped, survives across prompts)
# REVIEW_GUARD_COOLDOWN_FILE env var allows tests to override the path
if [[ -n "${REVIEW_GUARD_COOLDOWN_FILE:-}" ]]; then
  COOLDOWN_FILE="$REVIEW_GUARD_COOLDOWN_FILE"
else
  _PWD_HASH=$(echo -n "$PWD" | md5sum 2>/dev/null | cut -d' ' -f1 || md5 -q -s "$PWD" 2>/dev/null || echo "default")
  COOLDOWN_FILE="${TMPDIR:-/tmp}/.claude_review_inject_${_PWD_HASH}"
fi
COOLDOWN_SECONDS="${REVIEW_GUARD_COOLDOWN:-300}"  # Default 5 minutes, configurable

if [[ -f "$COOLDOWN_FILE" ]]; then
  LAST_INJECT=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo "0")
  NOW=$(date +%s 2>/dev/null || echo "0")
  ELAPSED=$((NOW - LAST_INJECT))
  if [[ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]] 2>/dev/null; then
    exit 0  # Cooldown active, stay silent
  fi
fi

# --- Inject reminder ---
echo "[PENDING_REVIEW] Uncommitted changes require: ${NEXT}. Execute it before proceeding to other tasks. (Auto-loop rule: fix → re-review → pass → next step)"

# Update cooldown timestamp (atomic write, reject symlinks)
_COOLDOWN_TMP="${COOLDOWN_FILE}.$$"
(umask 077; date +%s > "$_COOLDOWN_TMP" 2>/dev/null && mv "$_COOLDOWN_TMP" "$COOLDOWN_FILE" 2>/dev/null) || true

exit 0
