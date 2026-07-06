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

# === Plugin-defers-to-local arbitration ===
# When running as a plugin hook, detect if identical local hook is installed
# and registered in project settings — if so, exit 0 to avoid double-fire.
# Dev-mode bypass: hooks/hooks.json at project root = plugin source repo (skip arbitration).
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

# === Portable mkdir locking (shared protocol with post-tool-review-state.sh) ===
LOCKDIR="${STATE_FILE}.lockdir"
LOCK_TIMEOUT=5
LOCK_TTL=30
HAVE_LOCK=0

_lock() {
  local start end
  start=$(date +%s)
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge $LOCK_TIMEOUT ]; then
      local lock_pid lock_ts now
      lock_pid=$(cat "$LOCKDIR/pid" 2>/dev/null || echo 0)
      lock_ts=$(cat "$LOCKDIR/ts" 2>/dev/null || echo 0)
      now=$(date +%s)
      # Stale recovery: TTL expired OR owner PID dead
      if [ $((now - lock_ts)) -ge $LOCK_TTL ] || ! kill -0 "$lock_pid" 2>/dev/null; then
        rm -rf "$LOCKDIR" 2>/dev/null
        mkdir "$LOCKDIR" 2>/dev/null && break
      fi
      return 1  # lock failure triggers fail-closed sidecar marker in caller
    fi
    sleep 0.1
  done
  echo "$$" > "$LOCKDIR/pid"
  date +%s > "$LOCKDIR/ts"
  HAVE_LOCK=1
}

_unlock() {
  [ "$HAVE_LOCK" -eq 1 ] && rm -rf "$LOCKDIR" 2>/dev/null
  HAVE_LOCK=0
}

trap '_unlock' EXIT

INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  exit 0
fi

# Use printf to avoid echo interpretation issues
# NotebookEdit matches the Edit|Write hook matcher but carries notebook_path,
# not file_path — without the fallback, notebook edits silently bypass all
# change tracking and review gates.
file_path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || true)

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
    # Require an installed prettier binary. Config files alone used to route
    # through `npx prettier`, which on a config-only repo downloads prettier
    # from the network on every single edit (no timeout, one fetch per file).
    # Local node_modules binary = project opted in via dependency; a global
    # binary still needs a config file as the opt-in signal.
    prettier_bin=""
    if [[ -x "node_modules/.bin/prettier" ]]; then
      prettier_bin="node_modules/.bin/prettier"
    elif command -v prettier >/dev/null 2>&1 && {
        [[ -f ".prettierrc" ]] || [[ -f ".prettierrc.json" ]] || [[ -f ".prettierrc.js" ]] || \
        [[ -f "prettier.config.js" ]] || [[ -f "prettier.config.mjs" ]]; }; then
      prettier_bin="prettier"
    fi

    if [[ -n "$prettier_bin" ]]; then
      "$prettier_bin" --write "$file_path" 2>/dev/null || true
    fi
  fi
fi

# === Track file changes in state file ===

# Initialize state file if it doesn't exist
init_state_file() {
  if [[ ! -f "$STATE_FILE" ]]; then
    # R6: read project max_rounds override for initial value (fallback 10)
    local _mr
    _mr=$(_read_project_max_rounds 10)
    cat > "$STATE_FILE" << EOF
{
  "session_id": "",
  "updated_at": "",
  "review_mode": "single",
  "has_code_change": false,
  "has_doc_change": false,
  "code_review": {"executed": false, "passed": false, "last_run": ""},
  "doc_review": {"executed": false, "passed": false, "last_run": ""},
  "precommit": {"executed": false, "passed": false, "last_run": ""},
  "aggregate_gate": {"executed": false, "gate": null, "source": null, "reason": null, "last_run": ""},
  "schema_version": 2,
  "iteration_history": {"current_round": 0, "max_rounds": ${_mr}, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}
}
EOF
  fi
}

# Read max_rounds override from project config (R6)
# Scans from "## Max Rounds" heading until next "## " heading, picking first bare integer line.
# Tracks multi-line HTML comment state so integers inside <!-- ... --> blocks are not picked up.
_read_project_max_rounds() {
  local default_val="${1:-10}"
  local rf val
  for rf in "rules/auto-loop-project.md" ".claude/rules/auto-loop-project.md"; do
    [[ ! -f "$rf" ]] && continue
    val=$(awk '
      function strip_comments(line,    out, op, cp) {
        out = ""
        while (length(line) > 0) {
          if (in_comment) {
            cp = index(line, "-->")
            if (cp == 0) { return out }
            in_comment = 0
            line = substr(line, cp + 3)
          } else {
            op = index(line, "<!--")
            if (op == 0) { out = out line; break }
            out = out substr(line, 1, op - 1)
            line = substr(line, op + 4)
            in_comment = 1
          }
        }
        return out
      }
      /^## Max Rounds[[:space:]]*$/ { in_section = 1; next }
      /^## / && in_section { exit }
      in_section {
        processed = strip_comments($0)
        gsub(/[[:space:]]/, "", processed)
        if (processed ~ /^[0-9]+$/) { print processed; exit }
      }
    ' "$rf" 2>/dev/null) || val=""
    if [[ "$val" =~ ^[0-9]+$ && "$val" -ge 3 && "$val" -le 50 ]]; then
      echo "$val"; return
    fi
  done
  echo "$default_val"
}

# Migrate state file to schema v2 (add iteration_history if missing)
_migrate_state_v2() {
  local state_file="${1:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0
  local ver
  ver=$(jq -r '.schema_version // 1' "$state_file" 2>/dev/null || echo 1)
  if [[ "$ver" -lt 2 ]]; then
    local mr tmp
    mr=$(_read_project_max_rounds 10)
    tmp=$(mktemp)
    jq --argjson mr "$mr" '.schema_version = 2
      | .iteration_history //= {"current_round": 0, "max_rounds": $mr, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}' \
      "$state_file" > "$tmp" && mv "$tmp" "$state_file"
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

# Reset aggregate_gate on edit (invalidates dual-review results)
invalidate_aggregate_gate() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return
  fi
  # Only reset if aggregate_gate exists in the state file
  local has_agg
  has_agg=$(jq 'has("aggregate_gate")' "$STATE_FILE" 2>/dev/null || echo "false")
  if [[ "$has_agg" == "true" ]]; then
    local tmp
    tmp=$(mktemp)
    jq '.aggregate_gate.executed = false | .aggregate_gate.gate = null | .aggregate_gate.reason = null' \
       "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
  fi
}

# Update state file for change tracking
update_change_flag() {
  local flag="$1"

  init_state_file
  # R6: apply project max_rounds override on fresh state file (no-op when schema_version >= 2)
  _migrate_state_v2 "$STATE_FILE" || true

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local tmp
  tmp=$(mktemp)
  jq --arg flag "$flag" --arg now "$now" \
     '.[$flag] = true | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Track individual changed files for delta review (D-3)
# Graceful: no-op if jq doesn't support the filter (e.g., stub jq in tests)
_track_changed_file() {
  local file_path="$1"
  [[ ! -f "$STATE_FILE" ]] && return 0
  local tmp _before_size _after_size
  _before_size=$(wc -c < "$STATE_FILE" 2>/dev/null || echo 0)
  tmp=$(mktemp)
  if jq --arg f "$file_path" \
    '.changed_files_since_review = ((.changed_files_since_review // []) + [$f] | unique)' \
    "$STATE_FILE" > "$tmp" 2>/dev/null; then
    _after_size=$(wc -c < "$tmp" 2>/dev/null || echo 0)
    if [[ "$_after_size" -ge "$_before_size" ]]; then
      mv "$tmp" "$STATE_FILE"
    else
      rm -f "$tmp" 2>/dev/null
    fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}

# Track file for session commit scope (D-5)
# Stores repo-relative paths; never reset on review pass (independent lifecycle).
_track_session_touched_file() {
  local file_path="$1"
  [[ ! -f "$STATE_FILE" ]] && return 0

  # Guard: only append when session_commit_scope is valid
  local scope_valid
  scope_valid=$(jq -r '
    if (.session_commit_scope.session_id == .session_id) and
       (.session_commit_scope.baseline_dirty_files != null)
    then "yes" else "no" end
  ' "$STATE_FILE" 2>/dev/null) || return 0
  [[ "$scope_valid" != "yes" ]] && return 0

  # Normalize to repo-relative path
  local rel_path="$file_path"
  if [[ "$file_path" = /* ]]; then
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
    repo_root="${repo_root%/}/"
    if [[ "$file_path" = "$repo_root"* ]]; then
      rel_path="${file_path#"$repo_root"}"
    else
      return 0  # Outside repo — ignore
    fi
  fi

  local tmp _before_size _after_size
  _before_size=$(wc -c < "$STATE_FILE" 2>/dev/null || echo 0)
  tmp=$(mktemp)
  if jq --arg f "$rel_path" '
    .session_commit_scope.touched_files = (
      (.session_commit_scope.touched_files // []) + [$f] | unique
    )
  ' "$STATE_FILE" > "$tmp" 2>/dev/null; then
    _after_size=$(wc -c < "$tmp" 2>/dev/null || echo 0)
    if [[ "$_after_size" -ge "$_before_size" ]]; then
      mv "$tmp" "$STATE_FILE"
    else
      rm -f "$tmp" 2>/dev/null
    fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}

# Track code changes (all recognized code extensions, incl. shell scripts: sh/bash/zsh —
# this repo's own hooks are .sh, so shell edits must engage the review gate)
if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)$'; then
  if _lock; then
    update_change_flag "has_code_change"
    _track_changed_file "$file_path" || true
    _track_session_touched_file "$file_path" || true
    # Set review phase to pending (D-4) — graceful on jq failure
    (
      _phase_tmp=$(mktemp)
      if jq '.review_phase = "pending_review"' "$STATE_FILE" > "$_phase_tmp" 2>/dev/null && [[ -s "$_phase_tmp" ]]; then
        mv "$_phase_tmp" "$STATE_FILE"
      else
        rm -f "$_phase_tmp" 2>/dev/null
      fi
    ) 2>/dev/null || true
    invalidate_review "code_review"
    invalidate_review "precommit"
    invalidate_aggregate_gate
    # Reset iteration counter on code edit (new review cycle, graceful if schema v1)
    if jq -e 'has("iteration_history")' "$STATE_FILE" >/dev/null 2>&1; then
      _iter_tmp=$(mktemp)
      if jq '.iteration_history.current_round = 0 | .iteration_history.findings_by_round = []' \
        "$STATE_FILE" > "$_iter_tmp" 2>/dev/null && [[ -s "$_iter_tmp" ]]; then
        mv "$_iter_tmp" "$STATE_FILE"
      else
        rm -f "$_iter_tmp" 2>/dev/null
      fi
    fi
    # Clear any stale sidecar marker (successful locked write supersedes prior lock-failure markers)
    rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
    _unlock
    echo "[Edit Hook] Code change detected: $file_path" >&2
    echo "[Edit Hook] Invalidated code_review + precommit + aggregate_gate + iteration reset" >&2
  else
    # Fail-closed: sidecar marker (atomic) + best-effort unlocked writes
    echo "edit_lock_contention" > "${STATE_FILE}.blocked" 2>/dev/null || true
    update_change_flag "has_code_change" 2>/dev/null || true
    invalidate_review "code_review" 2>/dev/null || true
    invalidate_review "precommit" 2>/dev/null || true
    invalidate_aggregate_gate 2>/dev/null || true
    echo "[Edit Hook] Code change detected (degraded — lock contention, sidecar marker set): $file_path" >&2
  fi
fi

# Track doc changes (.md, .mdx)
if echo "$file_path" | grep -Eq '\.(md|mdx)$'; then
  if _lock; then
    # Atomic: merge flag set + review invalidation + aggregate gate reset (3 ops → 1 jq call)
    init_state_file
    _doc_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    _doc_has_agg=$(jq 'has("aggregate_gate")' "$STATE_FILE" 2>/dev/null || echo "false")
    _doc_tmp=$(mktemp)
    _doc_write_ok=false
    if [[ "$_doc_has_agg" == "true" ]]; then
      jq --arg now "$_doc_now" '
        .has_doc_change = true
        | .updated_at = $now
        | .doc_review.passed = false
        | .aggregate_gate.executed = false
        | .aggregate_gate.gate = null
        | .aggregate_gate.reason = null
      ' "$STATE_FILE" > "$_doc_tmp" && mv "$_doc_tmp" "$STATE_FILE" && _doc_write_ok=true
    else
      jq --arg now "$_doc_now" '
        .has_doc_change = true
        | .updated_at = $now
        | .doc_review.passed = false
      ' "$STATE_FILE" > "$_doc_tmp" && mv "$_doc_tmp" "$STATE_FILE" && _doc_write_ok=true
    fi
    # Non-critical array appends (graceful, own size guards)
    _track_changed_file "$file_path"
    _track_session_touched_file "$file_path" || true
    # Clear sidecar only on successful write (fail-closed: preserve sidecar if write failed)
    if [[ "$_doc_write_ok" == "true" ]]; then
      rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
    fi
    _unlock
    echo "[Edit Hook] Doc change detected: $file_path" >&2
    echo "[Edit Hook] Invalidated doc_review + aggregate_gate" >&2
  else
    # Fail-closed: sidecar marker (atomic) + best-effort single unlocked jq write
    echo "edit_lock_contention" > "${STATE_FILE}.blocked" 2>/dev/null || true
    init_state_file
    _doc_now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    _doc_has_agg=$(jq 'has("aggregate_gate")' "$STATE_FILE" 2>/dev/null || echo "false")
    _doc_tmp=$(mktemp)
    if [[ "$_doc_has_agg" == "true" ]]; then
      jq --arg now "$_doc_now" '
        .has_doc_change = true
        | .updated_at = $now
        | .doc_review.passed = false
        | .aggregate_gate.executed = false
        | .aggregate_gate.gate = null
        | .aggregate_gate.reason = null
      ' "$STATE_FILE" > "$_doc_tmp" 2>/dev/null && mv "$_doc_tmp" "$STATE_FILE" 2>/dev/null || rm -f "$_doc_tmp" 2>/dev/null
    else
      jq --arg now "$_doc_now" '
        .has_doc_change = true
        | .updated_at = $now
        | .doc_review.passed = false
      ' "$STATE_FILE" > "$_doc_tmp" 2>/dev/null && mv "$_doc_tmp" "$STATE_FILE" 2>/dev/null || rm -f "$_doc_tmp" 2>/dev/null
    fi
    echo "[Edit Hook] Doc change detected (degraded — lock contention, sidecar marker set): $file_path" >&2
  fi
fi

# Track non-code/non-doc files for session commit scope (D-5)
# Covers .json, .yml, .toml, lockfiles etc. that aren't in the code/doc branches above.
# (Shell scripts sh/bash/zsh are now classified as code above, so they're excluded here.)
if ! echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb|md|mdx)$'; then
  _track_session_touched_file "$file_path" || true
fi

exit 0
