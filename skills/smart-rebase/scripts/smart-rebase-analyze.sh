#!/bin/bash
# smart-rebase-analyze.sh — Analyze branch rebase plan
#
# Usage:
#   smart-rebase-analyze.sh [--target <ref>] [--base <commit-or-branch>]
#
# Options:
#   --target <ref>     Rebase target (default: origin/main)
#   --base <ref>       Cut point — commits after this are "keep", before are "drop"
#
# Without --base, uses git cherry to auto-detect and lists all commits for review.
#
# Output: JSON analysis report

set -euo pipefail

TARGET="origin/main"
BASE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target) TARGET="$2"; shift 2 ;;
    --base)   BASE="$2";   shift 2 ;;
    *)        echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

CURRENT=$(git branch --show-current 2>/dev/null || echo "HEAD")

# Fetch target branch
TARGET_BRANCH=$(echo "$TARGET" | sed 's|^origin/||')
git fetch origin "$TARGET_BRANCH" --quiet 2>/dev/null || true

# Verify target exists
if ! git rev-parse --verify "$TARGET" >/dev/null 2>&1; then
  echo '{"error":"Target ref '"$TARGET"' not found"}' | python3 -m json.tool 2>/dev/null || cat
  exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$TARGET" 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
  echo '{"error":"No common ancestor between HEAD and '"$TARGET"'"}' | python3 -m json.tool 2>/dev/null || cat
  exit 1
fi

MERGE_BASE_SHORT=$(git rev-parse --short "$MERGE_BASE")
TARGET_HEAD=$(git rev-parse --short "$TARGET")

# Collect unique commits (not in target)
mapfile -t COMMITS < <(git log --oneline --reverse "$MERGE_BASE..HEAD" 2>/dev/null)
TOTAL=${#COMMITS[@]}

if [ "$TOTAL" -eq 0 ]; then
  echo '{"status":"up-to-date","message":"No commits to rebase","current_branch":"'"$CURRENT"'","target":"'"$TARGET"'"}'
  exit 0
fi

# ── Mode 1: --base provided → deterministic cut ──
if [ -n "$BASE" ]; then
  # Resolve base to a commit hash
  BASE_HASH=$(git rev-parse --short "$BASE" 2>/dev/null || echo "")
  if [ -z "$BASE_HASH" ]; then
    # Try as remote branch name
    BASE_HASH=$(git rev-parse --short "origin/$BASE" 2>/dev/null || echo "")
  fi
  if [ -z "$BASE_HASH" ]; then
    echo '{"error":"Cannot resolve --base '"$BASE"'"}' | python3 -m json.tool 2>/dev/null || cat
    exit 1
  fi

  KEEP=()
  DROP=()
  FOUND_CUT=0

  for line in "${COMMITS[@]}"; do
    hash=$(echo "$line" | awk '{print $1}')
    if [ "$FOUND_CUT" -eq 0 ]; then
      full_hash=$(git rev-parse "$hash" 2>/dev/null)
      base_full=$(git rev-parse "$BASE_HASH" 2>/dev/null)
      DROP+=("$line")
      if [ "$full_hash" = "$base_full" ]; then
        FOUND_CUT=1
      fi
    else
      KEEP+=("$line")
    fi
  done

  if [ "$FOUND_CUT" -eq 0 ]; then
    echo '{"error":"Cut point '"$BASE"' ('"$BASE_HASH"') not found in commit history","hint":"Run without --base to see all commits"}'
    exit 1
  fi

  # Build JSON output
  KEEP_JSON="["
  for i in "${!KEEP[@]}"; do
    hash=$(echo "${KEEP[$i]}" | awk '{print $1}')
    msg=$(echo "${KEEP[$i]}" | cut -d' ' -f2-)
    [ "$i" -gt 0 ] && KEEP_JSON+=","
    KEEP_JSON+='{"hash":"'"$hash"'","message":"'"$(echo "$msg" | sed 's/"/\\"/g')"'"}'
  done
  KEEP_JSON+="]"

  DROP_JSON="["
  for i in "${!DROP[@]}"; do
    hash=$(echo "${DROP[$i]}" | awk '{print $1}')
    msg=$(echo "${DROP[$i]}" | cut -d' ' -f2-)
    [ "$i" -gt 0 ] && DROP_JSON+=","
    DROP_JSON+='{"hash":"'"$hash"'","message":"'"$(echo "$msg" | sed 's/"/\\"/g')"'"}'
  done
  DROP_JSON+="]"

  CUT_POINT_HASH=$(echo "${DROP[-1]}" | awk '{print $1}')

  cat <<ENDJSON
{
  "status": "ready",
  "mode": "explicit-base",
  "current_branch": "$CURRENT",
  "target": "$TARGET",
  "target_head": "$TARGET_HEAD",
  "merge_base": "$MERGE_BASE_SHORT",
  "total_commits": $TOTAL,
  "keep_count": ${#KEEP[@]},
  "drop_count": ${#DROP[@]},
  "cut_point": "$CUT_POINT_HASH",
  "keep": $KEEP_JSON,
  "drop": $DROP_JSON,
  "rebase_command": "git rebase --onto $TARGET $CUT_POINT_HASH $CURRENT"
}
ENDJSON
  exit 0
fi

# ── Mode 2: Auto-detect with git cherry ──
# git cherry marks commits already in target with "-", unique with "+"
mapfile -t CHERRY < <(git cherry -v "$TARGET" HEAD 2>/dev/null)

AUTO_KEEP=()
AUTO_DROP=()

for line in "${CHERRY[@]}"; do
  marker=$(echo "$line" | cut -c1)
  hash=$(echo "$line" | awk '{print $2}' | cut -c1-8)
  msg=$(echo "$line" | cut -d' ' -f3-)

  if [ "$marker" = "-" ]; then
    AUTO_DROP+=("$hash $msg")
  else
    AUTO_KEEP+=("$hash $msg")
  fi
done

# Check for new commits on target since merge-base (potential squash merges)
mapfile -t TARGET_NEW < <(git log --oneline "$MERGE_BASE..$TARGET" 2>/dev/null)
TARGET_NEW_COUNT=${#TARGET_NEW[@]}

# Build all-commits JSON for display
ALL_JSON="["
for i in "${!COMMITS[@]}"; do
  hash=$(echo "${COMMITS[$i]}" | awk '{print $1}')
  msg=$(echo "${COMMITS[$i]}" | cut -d' ' -f2-)

  # Check cherry status
  cherry_status="unique"
  for d in "${AUTO_DROP[@]}"; do
    dhash=$(echo "$d" | awk '{print $1}')
    if [ "$dhash" = "$hash" ]; then
      cherry_status="already-in-target"
      break
    fi
  done

  [ "$i" -gt 0 ] && ALL_JSON+=","
  ALL_JSON+='{"hash":"'"$hash"'","message":"'"$(echo "$msg" | sed 's/"/\\"/g')"'","cherry":"'"$cherry_status"'"}'
done
ALL_JSON+="]"

# Target new commits JSON
TARGET_JSON="["
for i in "${!TARGET_NEW[@]}"; do
  hash=$(echo "${TARGET_NEW[$i]}" | awk '{print $1}')
  msg=$(echo "${TARGET_NEW[$i]}" | cut -d' ' -f2-)
  [ "$i" -gt 0 ] && TARGET_JSON+=","
  TARGET_JSON+='{"hash":"'"$hash"'","message":"'"$(echo "$msg" | sed 's/"/\\"/g')"'"}'
done
TARGET_JSON+="]"

cat <<ENDJSON
{
  "status": "analysis",
  "mode": "auto-detect",
  "current_branch": "$CURRENT",
  "target": "$TARGET",
  "target_head": "$TARGET_HEAD",
  "merge_base": "$MERGE_BASE_SHORT",
  "total_commits": $TOTAL,
  "cherry_unique": ${#AUTO_KEEP[@]},
  "cherry_dropped": ${#AUTO_DROP[@]},
  "target_new_commits": $TARGET_NEW_COUNT,
  "commits": $ALL_JSON,
  "target_new": $TARGET_JSON,
  "hint": "If git cherry missed squash-merged commits, re-run with --base <last-merged-commit-hash>"
}
ENDJSON
