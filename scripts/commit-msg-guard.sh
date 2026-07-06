#!/usr/bin/env bash
# commit-msg-guard.sh - Reject commits containing AI co-author trailers
# Install as git commit-msg hook: cp scripts/commit-msg-guard.sh .git/hooks/commit-msg
# Bypass: ALLOW_AI_COAUTHOR=1 git commit ...
set -euo pipefail

MSG_FILE="${1:?Usage: commit-msg-guard.sh <commit-msg-file>}"

if [ ! -f "$MSG_FILE" ]; then
  echo "commit-msg-guard: file not found: $MSG_FILE" >&2
  exit 1
fi

# Allow AI co-author when explicitly opted in
if [ "${ALLOW_AI_COAUTHOR:-}" = "1" ]; then
  exit 0
fi

# Forbidden patterns (case-insensitive ERE with \b word boundaries — verified
# on both BSD and GNU grep; POSIX [[:<:]] is not portable).
# Bare `AI`/`GPT` without boundaries false-positived on ordinary words under
# -i: "maintainer"/"domain"/"detailed" all contain "ai".
PATTERNS=(
  'Co-Authored-By:.*(Claude|Anthropic|\bGPT\b|OpenAI|Copilot|noreply@anthropic)'
  'Generated (by|with).*(Claude|\bAI\b|\bGPT\b|Copilot)'
  '🤖.*(Claude|\bAI\b|\bGPT\b)'
)

FOUND=""
for pat in "${PATTERNS[@]}"; do
  if grep -Eqi "$pat" "$MSG_FILE" 2>/dev/null; then
    MATCH=$(grep -Ei "$pat" "$MSG_FILE" | head -1)
    FOUND="${FOUND}\n  ${MATCH}"
  fi
done

if [ -n "$FOUND" ]; then
  echo "" >&2
  echo "commit-msg-guard: AI attribution detected in commit message:" >&2
  echo -e "$FOUND" >&2
  echo "" >&2
  echo "Developer owns the commit. AI trailers are not allowed by default." >&2
  echo "To allow: ALLOW_AI_COAUTHOR=1 git commit ..." >&2
  echo "" >&2
  exit 1
fi

exit 0
