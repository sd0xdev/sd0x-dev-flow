#!/usr/bin/env bash
# session-init.sh — SessionStart hook: reset review state on new session (D-2)
# Preserves total_rounds_session and strategic_reset_fired for strategic reset logic.
set -euo pipefail

STATE_FILE=".claude_review_state.json"
INPUT=$(cat)

# Require jq
if ! command -v jq &> /dev/null; then exit 0; fi

# Capture baseline dirty files for session commit scope (D-5)
# Uses git status --porcelain -z for NUL-safe filename parsing (handles spaces, quotes, renames)
_capture_baseline() {
  if ! git rev-parse --git-dir &>/dev/null; then
    echo "null"  # Non-git repo → null baseline
    return 0
  fi
  # Pipe directly to perl — shell variables cannot hold NUL bytes
  git status --porcelain -z 2>/dev/null | perl -e '
    use strict;
    local $/;
    my $input = <STDIN>;
    my @paths;
    my $i = 0;
    while ($i < length($input)) {
      my $nul = index($input, "\0", $i);
      last if $nul < 0;
      my $entry = substr($input, $i, $nul - $i);
      $i = $nul + 1;
      my $xy = substr($entry, 0, 2);
      my $path = substr($entry, 3);  # skip "XY "
      if ($xy =~ /[RC]/) {
        # Rename/Copy in either column (index or worktree): next NUL field is src path — skip it
        my $nul2 = index($input, "\0", $i);
        $i = ($nul2 >= 0) ? $nul2 + 1 : length($input);
      }
      push @paths, $path if length($path);
    }
    print "$_\n" for @paths;
  ' | jq -R . | jq -s 'unique'
}

NEW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [[ -z "$NEW_SESSION_ID" ]]; then exit 0; fi

if [[ -f "$STATE_FILE" ]]; then
  OLD_SESSION_ID=$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null)
  if [[ "$OLD_SESSION_ID" != "$NEW_SESSION_ID" ]]; then
    # Different session (including empty→new) — reset review state, preserve cumulative fields
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    TMP=$(mktemp)
    jq --arg sid "$NEW_SESSION_ID" --arg now "$NOW" '
      .session_id = $sid | .updated_at = $now |
      .has_code_change = false | .has_doc_change = false |
      .code_review = {"executed":false,"passed":false} |
      .doc_review = {"executed":false,"passed":false} |
      .precommit = {"executed":false,"passed":false} |
      .aggregate_gate = {"executed":false} |
      .iteration_history.current_round = 0 |
      .iteration_history.findings_by_round = []
    ' "$STATE_FILE" > "$TMP" && mv "$TMP" "$STATE_FILE"
    # A .blocked sidecar left by a crashed previous session has no other
    # removal path (stop-guard only escalates on it; update_state clears it
    # only after a successful locked review write). The reset above already
    # puts every gate at executed=false — fail-closed — so the stale
    # escalation marker must not outlive its session.
    rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
    # Initialize session commit scope with baseline (D-5)
    BASELINE=$(_capture_baseline)
    TMP_SCOPE=$(mktemp)
    if jq --argjson bl "$BASELINE" --arg sid "$NEW_SESSION_ID" --arg now "$NOW" '
      .session_commit_scope = {
        "session_id": $sid,
        "baseline_dirty_files": $bl,
        "touched_files": [],
        "updated_at": $now
      }
    ' "$STATE_FILE" > "$TMP_SCOPE" 2>/dev/null && [[ -s "$TMP_SCOPE" ]]; then
      mv "$TMP_SCOPE" "$STATE_FILE"
    else
      rm -f "$TMP_SCOPE" 2>/dev/null
    fi
  fi
else
  # No state file — create with baseline (D-5)
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  BASELINE=$(_capture_baseline)
  jq -n --arg sid "$NEW_SESSION_ID" --arg now "$NOW" --argjson bl "$BASELINE" '{
    "schema_version": 2,
    "session_id": $sid,
    "session_commit_scope": {
      "session_id": $sid,
      "baseline_dirty_files": $bl,
      "touched_files": [],
      "updated_at": $now
    }
  }' > "$STATE_FILE"
  # Same rationale as the reset branch: a sidecar without its state file is
  # an orphan from a deleted/crashed session — clear it with the fresh start.
  rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
fi
