#!/usr/bin/env bash
# pre-push-gate.sh - Terminal-level confirmation gate for protected branch pushes
# Install as git pre-push hook via /install-scripts, or manually:
#   cp scripts/pre-push-gate.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
#
# Bypass env vars:
#   ALLOW_PUSH_PROTECTED=1  — skip protected branch confirmation (does NOT skip force push check)
#   ALLOW_FORCE_WITH_LEASE=1 — allow non-fast-forward pushes (for --force-with-lease workflows)
#
# Git pre-push hook receives: <remote-name> <remote-url> on argv
# and ref info on stdin (one line per ref being pushed):
#   <local-ref> <local-sha> <remote-ref> <remote-sha>
set -euo pipefail

REMOTE="${1:-origin}"
# $2 is remote URL (unused)

# ── Protected branch patterns ──────────────────────────────────────
PROTECTED_EXACT=("main" "master" "develop")
# release/* matched separately via prefix

is_protected() {
  local branch="$1"
  for p in "${PROTECTED_EXACT[@]}"; do
    if [ "$branch" = "$p" ]; then
      return 0
    fi
  done
  if [[ "$branch" == release/* ]]; then
    return 0
  fi
  return 1
}

# ── Read stdin for ref info ───────────────────────────────────────
BRANCHES_PUSHING=()
HAS_FORCE_PUSH=false

while IFS= read -r line; do
  # Skip empty lines
  [ -z "$line" ] && continue

  # Parse ref info: <local-ref> <local-sha> <remote-ref> <remote-sha>
  read -r local_ref local_sha remote_ref remote_sha <<< "$line"

  # Skip malformed lines (need at least remote_ref)
  [ -z "$remote_ref" ] && continue

  # Extract branch name from refs/heads/xxx
  branch="${remote_ref#refs/heads/}"

  BRANCHES_PUSHING+=("$branch")

  # Detect non-fast-forward push
  if [ -n "$remote_sha" ] && \
     [ "$remote_sha" != "0000000000000000000000000000000000000000" ] && \
     [ -n "$local_sha" ] && \
     [ "$local_sha" != "0000000000000000000000000000000000000000" ]; then
    if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
      HAS_FORCE_PUSH=true
    fi
  fi
done

# ── Non-fast-forward push check ───────────────────────────────────
# Git hooks cannot distinguish --force from --force-with-lease (same ref data).
# Callers (e.g. /push-ci) set ALLOW_FORCE_WITH_LEASE=1 only when --force-with-lease
# is explicitly requested. Bare --force enforcement is at the caller level.
if [ "$HAS_FORCE_PUSH" = true ] && [ "${ALLOW_FORCE_WITH_LEASE:-}" != "1" ]; then
  echo "" >&2
  echo "pre-push-gate: Non-fast-forward push detected and blocked." >&2
  echo "If using --force-with-lease: ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease ..." >&2
  echo "" >&2
  exit 1
fi

# ── Protected branch gate ─────────────────────────────────────────
# Skip if bypass is set (scoped to protected branch confirmation only)
if [ "${ALLOW_PUSH_PROTECTED:-}" = "1" ]; then
  exit 0
fi

PROTECTED_TARGETS=()
for branch in "${BRANCHES_PUSHING[@]}"; do
  if is_protected "$branch"; then
    PROTECTED_TARGETS+=("$branch")
  fi
done

# No protected branches in this push → allow
if [ ${#PROTECTED_TARGETS[@]} -eq 0 ]; then
  exit 0
fi

# ── Terminal confirmation ─────────────────────────────────────────
# Read from /dev/tty for terminal-level confirmation
# This is immune to Claude Code permission caching
BRANCH_LIST=$(printf ", %s" "${PROTECTED_TARGETS[@]}")
BRANCH_LIST="${BRANCH_LIST:2}" # strip leading ", "

echo "" >&2
echo "pre-push-gate: Pushing to protected branch(es): ${BRANCH_LIST}" >&2
echo "Remote: ${REMOTE}" >&2
echo "" >&2

# Check if /dev/tty is available (not available in non-interactive contexts like CI)
if [ ! -c /dev/tty ]; then
  echo "pre-push-gate: No terminal available for confirmation." >&2
  echo "Push to protected branches requires interactive confirmation." >&2
  echo "To bypass: ALLOW_PUSH_PROTECTED=1 git push ..." >&2
  echo "" >&2
  exit 1
fi

printf "Type 'yes' to confirm push to %s: " "$BRANCH_LIST" >&2
CONFIRM=""
read -r CONFIRM < /dev/tty 2>/dev/null || true

if [ "$CONFIRM" != "yes" ]; then
  echo "" >&2
  echo "pre-push-gate: Push aborted by user." >&2
  exit 1
fi

exit 0
