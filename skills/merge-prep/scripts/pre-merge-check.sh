#!/usr/bin/env bash
# pre-merge-check.sh — Pre-merge analysis script
# Usage: bash pre-merge-check.sh <source-branch> [target-branch]
#        target-branch defaults to main

set -euo pipefail

SOURCE="${1:?Usage: pre-merge-check.sh <source-branch> [target-branch]}"
TARGET="${2:-main}"

# Validate branches exist
if ! git rev-parse --verify "$SOURCE" >/dev/null 2>&1; then
  echo "{\"error\":\"source branch '$SOURCE' not found\"}" >&2
  exit 1
fi
if ! git rev-parse --verify "$TARGET" >/dev/null 2>&1; then
  echo "{\"error\":\"target branch '$TARGET' not found\"}" >&2
  exit 1
fi

# 1. Merge base
MERGE_BASE=$(git merge-base "$TARGET" "$SOURCE" 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
  echo "{\"error\":\"no common ancestor between '$SOURCE' and '$TARGET'\"}" >&2
  exit 1
fi
MERGE_BASE_SHORT=$(git rev-parse --short "$MERGE_BASE")

# 2. Commit stats
SOURCE_COMMITS=$(git log --oneline "$TARGET".."$SOURCE" 2>/dev/null | wc -l | tr -d ' ')
TARGET_COMMITS=$(git log --oneline "$SOURCE".."$TARGET" 2>/dev/null | wc -l | tr -d ' ')

# 3. File stats
FILE_STATS=$(git diff --stat "$MERGE_BASE".."$SOURCE" | tail -1 | sed 's/^ *//')
FILES_CHANGED=$(git diff --name-only "$MERGE_BASE".."$SOURCE" | wc -l | tr -d ' ')

# 4. Conflict detection (dry-run merge)
CONFLICT_FILES="[]"
HAS_CONFLICTS="false"

# Use merge-tree to detect conflicts (Git 2.38+)
MERGE_OUTPUT=$(git merge-tree --write-tree "$TARGET" "$SOURCE" 2>&1) && MERGE_EXIT=0 || MERGE_EXIT=$?

if [ "$MERGE_EXIT" -eq 0 ]; then
  HAS_CONFLICTS="false"
  CONFLICT_FILES="[]"
elif echo "$MERGE_OUTPUT" | grep -q "^CONFLICT"; then
  # Non-zero exit + CONFLICT lines → real conflicts
  HAS_CONFLICTS="true"

  # Parse conflict file names from merge-tree output
  # Format: "CONFLICT (content): Merge conflict in <file>"
  CONFLICTS=$(echo "$MERGE_OUTPUT" | sed -n 's/^CONFLICT .* in //p' || true)
  if [ -z "$CONFLICTS" ]; then
    # Fallback: take last token from each CONFLICT line
    CONFLICTS=$(echo "$MERGE_OUTPUT" | grep -E "^CONFLICT" | grep -oE '[^ ]+$' || true)
  fi

  # Convert to JSON array
  if [ -n "$CONFLICTS" ]; then
    CONFLICT_FILES=$(echo "$CONFLICTS" | sort -u | awk '
      BEGIN { printf "[" }
      NR>1 { printf "," }
      { gsub(/"/, "\\\""); printf "\"%s\"", $0 }
      END { printf "]" }
    ')
  fi
else
  # Non-zero exit without CONFLICT lines → command error
  echo "{\"error\":\"git merge-tree failed: $(echo "$MERGE_OUTPUT" | head -1)\"}" >&2
  exit 1
fi

# Count conflict files
if [ "$CONFLICT_FILES" = "[]" ]; then
  CONFLICT_COUNT=0
else
  CONFLICT_COUNT=$(echo "$CONFLICT_FILES" | tr ',' '\n' | wc -l | tr -d ' ')
fi

# 5. Source branch recent commits (max 20)
SOURCE_LOG=$(git log --oneline --no-decorate -20 "$TARGET".."$SOURCE" 2>/dev/null | awk '
  BEGIN { printf "[" }
  NR>1 { printf "," }
  {
    hash=$1
    $1=""
    sub(/^ /, "")
    gsub(/"/, "\\\"")
    printf "{\"hash\":\"%s\",\"message\":\"%s\"}", hash, $0
  }
  END { printf "]" }
')

# 6. Output JSON
cat <<ENDJSON
{
  "source": "$SOURCE",
  "target": "$TARGET",
  "merge_base": "$MERGE_BASE_SHORT",
  "source_commits": $SOURCE_COMMITS,
  "target_commits": $TARGET_COMMITS,
  "files_changed": $FILES_CHANGED,
  "file_stats": "$FILE_STATS",
  "has_conflicts": $HAS_CONFLICTS,
  "conflict_count": $CONFLICT_COUNT,
  "conflict_files": $CONFLICT_FILES,
  "recent_commits": $SOURCE_LOG
}
ENDJSON
