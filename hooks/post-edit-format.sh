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

# Use printf to avoid echo interpretation issues
file_path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Security: Reject paths with shell metacharacters that could enable injection
# Block: ; & | ` $()
# Note: $ alone is NOT blocked as it's valid in some filenames
# Note: Null bytes cannot be reliably detected in bash (variables truncate at \0)
if [[ "$file_path" =~ [\;\&\|\`] ]] || [[ "$file_path" =~ \$\( ]]; then
  echo "[Edit Hook] Rejected suspicious file path: contains shell metacharacters" >&2
  exit 0
fi

# === Skip vendor/generated paths (no formatting or change tracking) ===
# Normalize to repo-relative path so we only match root-level vendor dirs
# (avoids false positives like src/build/helpers.ts matching "build/")
rel_path="$file_path"
if [[ "$file_path" = /* ]]; then
  local_prefix="${PWD%/}/"
  if [[ "$file_path" = "$local_prefix"* ]]; then
    rel_path="${file_path#"$local_prefix"}"
  fi
fi
if echo "$rel_path" | grep -Eq '^(node_modules|vendor|dist|build|out|target|\.next|\.nuxt|__pycache__|\.pytest_cache|venv|\.venv|\.git)/'; then
  exit 0
fi

# === Auto-format supported file types ===
if [[ "${HOOK_NO_FORMAT:-}" != "1" ]]; then
  if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|json|md|mdx|yaml|yml)$'; then
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

# Invalidate a review's passed flag (preserves executed + last_run)
invalidate_review() {
  local key="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    return
  fi
  local tmp
  tmp=$(mktemp)
  jq --arg key "$key" \
     '.[$key].passed = false' \
     "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
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

# Track code changes (all recognized code extensions)
if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs)$'; then
  update_change_flag "has_code_change"
  invalidate_review "code_review"
  invalidate_review "precommit"
  echo "[Edit Hook] Code change detected: $file_path" >&2
  echo "[Edit Hook] Invalidated code_review + precommit passed" >&2
fi

# Track doc changes (.md, .mdx)
if echo "$file_path" | grep -Eq '\.(md|mdx)$'; then
  update_change_flag "has_doc_change"
  invalidate_review "doc_review"
  echo "[Edit Hook] Doc change detected: $file_path" >&2
  echo "[Edit Hook] Invalidated doc_review passed" >&2
fi

exit 0
