#!/usr/bin/env bash
# PreToolUse hook: Guard against editing sensitive files
# Exit code 2 = reject the tool call
#
# Protected paths (always):
# - .env files (secrets)
# - .git/ directory (git internals)
#
# Custom protected paths (optional):
# Set GUARD_EXTRA_PATTERNS to add project-specific patterns (pipe-separated regex)
# Example: GUARD_EXTRA_PATTERNS="src/locales/.*\.json$|generated/.*"
# WARNING: This env var is used as a grep regex. Only set by trusted project admin.

set -euo pipefail

# Read stdin once and store it
stdin_data=$(cat)

# Read file_path from stdin JSON (use printf to avoid echo interpretation issues)
file_path=$(printf '%s' "$stdin_data" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Security: Reject paths with shell metacharacters that could enable injection
# Block: ; & | ` $()
# Note: $ alone is NOT blocked as it's valid in some filenames
# Note: Null bytes cannot be reliably detected in bash (variables truncate at \0)
if [[ "$file_path" =~ [\;\&\|\`] ]] || [[ "$file_path" =~ \$\( ]]; then
  echo "[Edit Guard] Rejected suspicious file path: contains shell metacharacters" >&2
  exit 2
fi

# Block sensitive paths (universal, always safe to block)
if echo "$file_path" | grep -Eq '(\.env|\.git/)'; then
  echo "[Edit Guard] Blocked sensitive file: $file_path" >&2
  exit 2
fi

# Block custom paths (project-specific, opt-in via env var)
# P0 fix: Validate regex pattern before use
if [[ -n "${GUARD_EXTRA_PATTERNS:-}" ]]; then
  # Test that the pattern is valid regex before using it
  if echo "" | grep -Eq "$GUARD_EXTRA_PATTERNS" 2>/dev/null || [[ $? -le 1 ]]; then
    if echo "$file_path" | grep -Eq "$GUARD_EXTRA_PATTERNS"; then
      echo "[Edit Guard] Blocked by custom pattern: $file_path" >&2
      exit 2
    fi
  else
    echo "[Edit Guard] Invalid GUARD_EXTRA_PATTERNS regex, skipping" >&2
  fi
fi

exit 0
