#!/usr/bin/env bash
# PostToolUse hook: Auto-format edited files + Track file changes
# This eliminates the "last 10%" CI failures due to formatting issues.
#
# How it works:
# - Claude pipes tool_input JSON to stdin
# - We extract file_path and run prettier if it's a supported file type
# - We update .claude_review_state.json to track code/doc changes
#
# Safety:
# - Only runs prettier if the project has it installed (package.json or .prettierrc)
# - Skips gracefully if prettier is not available
# - Set HOOK_NO_FORMAT=1 to disable auto-formatting

set -euo pipefail

STATE_FILE=".claude_review_state.json"

INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  exit 0
fi

file_path=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# P0 fix: Validate file_path — reject paths with shell metacharacters or null bytes
if [[ "$file_path" =~ [\;\&\|\$\`\(] ]] || [[ "$file_path" == *$'\0'* ]]; then
  echo "[Edit Hook] Rejected suspicious file path" >&2
  exit 0
fi

# === Auto-format supported file types ===
if [[ "${HOOK_NO_FORMAT:-}" != "1" ]]; then
  if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|json|md|mdx)$'; then
    has_prettier=false
    # Only run if project has prettier configured
    if [[ -f "node_modules/.bin/prettier" ]] || \
       [[ -f ".prettierrc" ]] || [[ -f ".prettierrc.json" ]] || [[ -f ".prettierrc.js" ]] || \
       [[ -f "prettier.config.js" ]] || [[ -f "prettier.config.mjs" ]]; then
      has_prettier=true
    fi

    if [[ "$has_prettier" == "true" ]]; then
      npx prettier --write "$file_path" 2>/dev/null || true
    fi
  fi
fi

# === Track file changes in state file ===

# Initialize state file if it doesn't exist
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

# Update state file for change tracking
update_change_flag() {
  local flag="$1"

  init_state_file

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local tmp
  tmp=$(mktemp)
  jq --arg flag "$flag" --arg now "$now" \
     '.[$flag] = true | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Track code changes (.ts, .tsx, .js, .jsx)
if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx)$'; then
  update_change_flag "has_code_change"
  echo "[Edit Hook] Code change detected: $file_path" >&2
fi

# Track doc changes (.md, .mdx)
if echo "$file_path" | grep -Eq '\.(md|mdx)$'; then
  update_change_flag "has_doc_change"
  echo "[Edit Hook] Doc change detected: $file_path" >&2
fi

exit 0
