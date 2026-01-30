#!/usr/bin/env bash
# PostToolUse Hook: Parse review command output, update state file
# Trigger condition: Bash tool executes review/precommit commands

set -euo pipefail

STATE_FILE=".claude_review_state.json"

# Read JSON input from stdin
INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  exit 0
fi

# Extract tool info
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty' 2>/dev/null)
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty' 2>/dev/null)

# Only process Bash tool
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Extract command
COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)

# Initialize state file (if not exists)
init_state_file() {
  if [[ ! -f "$STATE_FILE" ]]; then
    cat > "$STATE_FILE" << 'EOF'
{
  "session_id": "",
  "updated_at": "",
  "has_code_change": false,
  "has_doc_change": false,
  "code_review": {"executed": false, "passed": false, "last_run": ""},
  "doc_review": {"executed": false, "passed": false, "last_run": ""},
  "precommit": {"executed": false, "passed": false, "last_run": ""}
}
EOF
  fi
}

# Update state file
update_state() {
  local key="$1"
  local executed="$2"
  local passed="$3"

  init_state_file

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Update using jq
  local tmp
  tmp=$(mktemp)
  jq --arg key "$key" \
     --argjson executed "$executed" \
     --argjson passed "$passed" \
     --arg now "$now" \
     '.[$key].executed = $executed | .[$key].passed = $passed | .[$key].last_run = $now | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Check for pass markers (anchored to line start to avoid false positives in error messages)
check_passed() {
  local output="$1"
  # Primary: anchored markers (most reliable)
  if echo "$output" | grep -qE '^## Gate: ✅|^✅ All Pass|^## Overall: ✅ PASS'; then
    echo "true"
  # Fallback: unanchored but only if no error/fail context on same line
  elif echo "$output" | grep -E '## Gate: ✅|✅ All Pass' | grep -qvE 'Error|Failed|FAIL'; then
    echo "true"
  else
    echo "false"
  fi
}

# === Process different commands ===

# /codex-review-fast or /codex-review
if echo "$COMMAND" | grep -qE '/codex-review(-fast)?($|\s)'; then
  passed=$(check_passed "$TOOL_OUTPUT")
  update_state "code_review" "true" "$passed"
  echo "[Review State] code_review updated: passed=$passed" >&2
fi

# /codex-review-doc or /review-spec
if echo "$COMMAND" | grep -qE '/codex-review-doc|/review-spec'; then
  passed=$(check_passed "$TOOL_OUTPUT")
  update_state "doc_review" "true" "$passed"
  echo "[Review State] doc_review updated: passed=$passed" >&2
fi

# /precommit or /precommit-fast
if echo "$COMMAND" | grep -qE '/precommit(-fast)?($|\s)'; then
  passed=$(check_passed "$TOOL_OUTPUT")
  update_state "precommit" "true" "$passed"
  echo "[Review State] precommit updated: passed=$passed" >&2
fi

exit 0
