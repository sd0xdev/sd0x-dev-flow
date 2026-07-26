#!/usr/bin/env bash
# PostToolUse (Skill) Hook: Inject auto-loop directive after Skill completion
# When a skill like /deep-analyze creates docs, this hook reads the state file
# and outputs a directive to stdout (presented to model via PostToolUse output).
# This prevents the model from asking "要執行嗎？" after doc-producing skills.
#
# Defense-in-depth: Primary fixes are behavioral (SKILL.md + auto-loop rule).
# This hook reinforces the directive via hook infrastructure.
#
# Only outputs when there are pending review steps. Silent otherwise.

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

# Sidecar evidence lives in TWO places: the shared `.blocked` file and per-event emergency markers
# named `.blocked.event.*` ALONGSIDE it. The second plane exists because clearers rewrite the shared
# file wholesale,
# which raced the setter's unserialized last-resort append; per-event markers are created and
# retired under disjoint names so nothing can erase them. See `_sidecar_emergency_mark` in
# hooks/post-edit-format.sh. A bare `-f "${STATE_FILE}.blocked"` therefore no longer answers "is
# there evidence" — and in its NEGATIVE form it gates reminder injection, so missing a marker is
# fail-open.
SIDECAR_EVENT_PREFIX="${STATE_FILE}.blocked.event."

# `-f` follows symlinks; a link planted at a marker name would otherwise count as evidence of a
# lost verdict. See the long note in post-tool-review-state.sh for why these are sibling FILES
# rather than entries in a `.blocked.d/` directory (that layout was a path-traversal delete).
_sidecar_is_marker() {
  [[ -f "$1" && ! -L "$1" ]]
}
_sidecar_any() {
  _sidecar_is_marker "${STATE_FILE}.blocked" && return 0
  local f
  # An unmatched glob leaves the literal pattern, which the regular-file test rejects — no
  # `nullglob` dependency. A symlink at a marker name is not evidence either; see _sidecar_is_marker.
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && return 0
  done
  return 1
}

# Consume stdin (required by hook protocol)
cat > /dev/null

# Graceful degradation
if ! command -v jq &>/dev/null; then exit 0; fi
if [[ ! -f "$STATE_FILE" ]]; then exit 0; fi

# Read state
HAS_CODE=$(jq -r '.has_code_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
HAS_DOC=$(jq -r '.has_doc_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
CODE_PASSED=$(jq -r '.code_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
DOC_PASSED=$(jq -r '.doc_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
PRE_PASSED=$(jq -r '.precommit.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")

# === Sidecar fail-closed marker ===
if _sidecar_any; then
  CODE_PASSED="false"
  DOC_PASSED="false"
  PRE_PASSED="false"
  # Fail-closed: if no change flags set, sidecar means state write failed — assume changes exist
  [[ "$HAS_CODE" != "true" && "$HAS_DOC" != "true" ]] && { HAS_CODE="true"; HAS_DOC="true"; }
fi

# Stale-state reconciliation (one-way: true→false only, same as stop-guard/post-compact)
# Use -uall (include ALL untracked, even inside new dirs) to avoid false downgrade
# of newly-created untracked code/doc files (the prior -uno hid them).
# Only reconcile when a change flag is set (nothing to downgrade otherwise) — this also
# avoids walking a large untracked tree on every skill completion when no review is pending.
# Bound git with timeout/gtimeout (cross-platform); -uall can be costly on big trees.
# Skip when sidecar present — would undo fail-closed HAS_* forcing.
if [[ ( "$HAS_CODE" == "true" || "$HAS_DOC" == "true" ) ]] && ! _sidecar_any; then
  if command -v timeout &>/dev/null || command -v gtimeout &>/dev/null || command -v perl &>/dev/null; then
    # Capture stderr + force LC_ALL=C: `git status` exits 0 but only WARNS on stderr and OMITS a
    # subtree it could not open (unreadable dir). A stderr-discarding, ambient-locale probe would miss
    # a reviewable file under such a dir and wrongly downgrade the flag (fail-open, iter-20 P1 class).
    # On any directory-omission warning (or mktemp failure) mark UNAVAILABLE → skip downgrade → hold.
    _psa_err="$(mktemp 2>/dev/null || echo '')"
    if [[ -z "$_psa_err" ]]; then
      GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    else
      if command -v timeout &>/dev/null; then
        GIT_PORCELAIN=$(LC_ALL=C timeout 5 git status --porcelain -uall 2>"$_psa_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      elif command -v gtimeout &>/dev/null; then
        GIT_PORCELAIN=$(LC_ALL=C gtimeout 5 git status --porcelain -uall 2>"$_psa_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      else
        # Stock macOS ships neither timeout nor gtimeout. perl's alarm+exec bounds the -uall walk
        # identically (the timer survives exec; SIGALRM's default action kills git → non-zero exit
        # → UNAVAILABLE), mirroring session-init.sh's _capture_baseline. Without this tier the
        # reconciliation NEVER ran on such hosts, so a stale has_*_change flag survived a revert or
        # an external commit and kept re-requesting a review with nothing left to review.
        GIT_PORCELAIN=$(LC_ALL=C perl -e 'alarm 5; exec @ARGV or exit 127' git status --porcelain -uall 2>"$_psa_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      fi
      grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_psa_err" && GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      rm -f "$_psa_err"
    fi
  else
    # No timeout helper → cannot bound the -uall walk → skip (fail-closed: trust state flags)
    GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  fi
else
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

# Determine next required step
NEXT=""
if [[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]]; then
  NEXT="/codex-review-fast"
elif [[ "$HAS_CODE" == "true" && "$CODE_PASSED" == "true" && "$PRE_PASSED" != "true" ]]; then
  NEXT="/precommit"
elif [[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]]; then
  NEXT="/codex-review-doc"
fi

# Only output when there is a pending step
if [[ -n "$NEXT" ]]; then
  cat <<EOF
[AUTO_LOOP] Review state has pending step after skill completion.
Required: ${NEXT}
Do not ask "要執行嗎？" — execute ${NEXT} now per auto-loop rules.
EOF
fi

exit 0
