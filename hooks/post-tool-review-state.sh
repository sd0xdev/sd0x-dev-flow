#!/usr/bin/env bash
# PostToolUse Hook: Parse review command output, update state file
# Trigger condition: Bash tool executes review/precommit commands

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

# === Portable mkdir locking (macOS has no flock) ===
LOCKDIR="${STATE_FILE}.lockdir"
# Env-overridable so contention tests don't pay the full wait per lock site.
LOCK_TIMEOUT="${REVIEW_STATE_LOCK_TIMEOUT:-5}"
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
      return 1  # fail-closed
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

# Read JSON input from stdin
INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  # Without jq no state is ever written, so every downstream gate silently
  # fails open — surface the degradation instead of exiting mutely.
  echo "[Review State] jq not found — review-state tracking disabled (gates unenforced)" >&2
  exit 0
fi

# Extract tool info
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | jq -r '.tool_input // empty' 2>/dev/null)
# PostToolUse input: official Claude Code v2.1.x spec uses `tool_response`;
# `tool_output` is kept as fallback for backward-compat with older replays.
# Bash returns structured `{stdout, stderr, interrupted, isImage}`; MCP returns
# `{content: string | [{type:"text", text}]}`; legacy replays may be plain string.
# Normalize all three shapes into a single text payload here.
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '
  (.tool_response // .tool_output) as $r
  | if ($r | type) == "object" then
      if ($r.stdout | type) == "string" then $r.stdout
      elif ($r.content | type) == "string" then $r.content
      elif ($r.content | type) == "array" then [$r.content[] | select(.type == "text") | .text] | join("\n")
      else ($r | tostring)
      end
    elif ($r | type) == "string" then $r
    else empty
    end // empty' 2>/dev/null)

# Only process Bash, MCP Codex, and Skill tools
if [[ "$TOOL_NAME" != "Bash" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex-reply" ]] && \
   [[ "$TOOL_NAME" != "Skill" ]]; then
  exit 0
fi

# Extract command (Bash), skill name (Skill), or output (MCP)
if [[ "$TOOL_NAME" == "Bash" ]]; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty' 2>/dev/null)
elif [[ "$TOOL_NAME" == "Skill" ]]; then
  # Skill tool — extract skill name as command, tool_response/tool_output is the skill's text output
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.skill // empty' 2>/dev/null)
else
  # MCP tool — TOOL_OUTPUT already normalized at the unified parse above.
  COMMAND=""
fi

# Fail-loud diagnostic when normalized output is empty for a tool we care about.
# Emits structural info only (TOOL_NAME, field presence/type) — NEVER raw payload.
if [[ -z "$TOOL_OUTPUT" ]]; then
  _HAS_RESP=$(echo "$INPUT" | jq -r 'if has("tool_response") then (.tool_response | type) else "absent" end' 2>/dev/null)
  _HAS_OUT=$(echo "$INPUT" | jq -r 'if has("tool_output") then (.tool_output | type) else "absent" end' 2>/dev/null)
  echo "[post-tool-review-state] empty output: tool=${TOOL_NAME} tool_response=${_HAS_RESP:-absent} tool_output=${_HAS_OUT:-absent}" >&2
fi

# Initialize state file (if not exists)
init_state_file() {
  if [[ ! -f "$STATE_FILE" ]]; then
    # R6: read project max_rounds override for initial value (fallback 10)
    local _mr _pmr
    _mr=$(_read_project_max_rounds 10)
    _pmr=$(_read_project_plan_max_rounds 5)
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
  "plan_review": {"executed": false, "passed": false, "degraded": false, "skipped": false, "status_reason": null, "tier": null, "last_run": "", "iteration_history": {"current_round": 0, "max_rounds": ${_pmr}, "findings_by_round": [], "total_rounds_session": 0}, "history": []},
  "schema_version": 3,
  "iteration_history": {"current_round": 0, "max_rounds": ${_mr}, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}
}
EOF
  fi
}

# Read an integer setting from a "## <Heading>" section of auto-loop-project.md
# Scans from the heading until next "## " heading, picking first bare integer line.
# Tracks multi-line HTML comment state so integers inside <!-- ... --> blocks are not picked up.
# Heading is matched literally and anchored (^## <heading>$), so "Max Rounds" cannot
# accidentally match the longer "Plan Review Max Rounds" section.
_read_project_int_setting() {
  local heading="$1"
  local default_val="$2"
  local rf val
  for rf in "rules/auto-loop-project.md" ".claude/rules/auto-loop-project.md"; do
    [[ ! -f "$rf" ]] && continue
    val=$(awk -v heading="$heading" '
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
      {
        # Literal heading match (no regex metacharacters expected in headings)
        stripped = $0
        sub(/[[:space:]]+$/, "", stripped)
        if (stripped == "## " heading) { in_section = 1; next }
      }
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

# Read max_rounds override from project config (R6)
_read_project_max_rounds() {
  _read_project_int_setting "Max Rounds" "${1:-10}"
}

# Read plan-review max_rounds override (plan-review-loop OQ-10, default 5)
_read_project_plan_max_rounds() {
  _read_project_int_setting "Plan Review Max Rounds" "${1:-5}"
}

# Migrate state file to schema v2 (add iteration_history if missing)
_migrate_state_v2() {
  local state_file="${1:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0
  local ver
  ver=$(jq -r '.schema_version // 1' "$state_file" 2>/dev/null || echo 1)
  if [[ "$ver" -lt 2 ]]; then
    local tmp
    tmp=$(mktemp)
    local mr
    mr=$(_read_project_max_rounds 10)
    jq --argjson mr "$mr" '.schema_version = 2
      | .iteration_history //= {"current_round": 0, "max_rounds": $mr, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}' \
      "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  fi
}

# Migrate state file to schema v3 (additive: inject plan_review subtree).
# `. +` merge preserves ALL existing top-level fields verbatim; the only deliberate
# change besides the injected subtree is schema_version 2→3 (plan-review-loop spec §3.2).
# Returns 1 for UNSUPPORTED schemas (non-numeric or newer than v3): callers must
# skip their plan write entirely — a "warn-skip" must not be followed by a partial
# plan_review mutation on a schema this hook does not understand.
_migrate_state_plan_review() {
  local state_file="${1:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0
  local ver
  ver=$(jq -r '.schema_version // 1' "$state_file" 2>/dev/null || echo 1)
  if ! [[ "$ver" =~ ^[0-9]+$ ]]; then
    echo "[Review State] plan migration skipped: non-numeric schema_version='$ver'" >&2
    return 1
  fi
  if [[ "$ver" -eq 3 ]]; then return 0; fi
  if [[ "$ver" -gt 3 ]]; then
    echo "[Review State] plan migration skipped: schema_version=$ver is newer than this hook supports" >&2
    return 1
  fi
  # Ensure v2 invariants (iteration_history) exist before the v3 additive step
  _migrate_state_v2 "$state_file"
  local pmr tmp
  pmr=$(_read_project_plan_max_rounds 5)
  tmp=$(mktemp)
  if jq --argjson pmr "$pmr" '. + {plan_review: (.plan_review // {"executed": false, "passed": false, "degraded": false, "skipped": false, "status_reason": null, "tier": null, "last_run": "", "iteration_history": {"current_round": 0, "max_rounds": $pmr, "findings_by_round": [], "total_rounds_session": 0}, "history": []})}
      | .schema_version = 3' \
    "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$state_file"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Review State] plan migration failed (jq write)" >&2
  fi
}

# Update state file (acquires lock for consistency with aggregate_gate writes)
update_state() {
  local key="$1"
  local executed="$2"
  local passed="$3"

  if _lock; then
    init_state_file

    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Update using jq
    local tmp
    tmp=$(mktemp)
    if jq --arg key "$key" \
       --argjson executed "$executed" \
       --argjson passed "$passed" \
       --arg now "$now" \
       '.[$key].executed = $executed | .[$key].passed = $passed | .[$key].last_run = $now | .updated_at = $now' \
       "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"; then
      # Successful locked write → state is consistent, clear stale sidecar
      rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
    fi
    _unlock
  else
    # Lock contention: skip rather than fall back to an unlocked
    # read-modify-write — the unlocked mv could clobber a concurrent locked
    # writer (worst case reverting an aggregate BLOCKED) with stale content.
    # Skipping is fail-closed: an unrecorded review stays "not executed" and
    # the stop gate keeps asking for it.
    echo "[Review State] ${key} update skipped (lock contention)" >&2
  fi
}

# Update iteration history (extract finding counts from review output)
_update_iteration() {
  local tool_output="$1"
  local state_file="${2:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0

  local p0_count p1_count p2_count nit_count total

  # Dual-format parsing: tag-based [P0] AND section-based #### P0
  # grep -c exits 1 on no match but still outputs "0"; use subshell to isolate
  p0_count=$(echo "$tool_output" | grep -cE '^\- \[P0\]|^#### P0' 2>/dev/null) || p0_count=0
  p1_count=$(echo "$tool_output" | grep -cE '^\- \[P1\]|^#### P1' 2>/dev/null) || p1_count=0
  p2_count=$(echo "$tool_output" | grep -cE '^\- \[P2\]|^#### P2' 2>/dev/null) || p2_count=0
  nit_count=$(echo "$tool_output" | grep -cE '^\- \[Nit\]|^#### Nit' 2>/dev/null) || nit_count=0
  total=$((p0_count + p1_count + p2_count + nit_count))

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Acquire lock for state file write (consistent with update_state)
  if _lock; then
    _migrate_state_v2 "$state_file"
    tmp=$(mktemp)
    if jq --argjson total "$total" --argjson p0 "$p0_count" \
       --argjson p1 "$p1_count" --argjson p2 "$p2_count" \
       --argjson nit "$nit_count" --arg now "$now" \
       '.iteration_history.current_round += 1 |
        .iteration_history.total_rounds_session = ((.iteration_history.total_rounds_session // 0) + 1) |
        .iteration_history.findings_by_round += [{"round": (.iteration_history.current_round), "total": $total, "p0": $p0, "p1": $p1, "p2": $p2, "nit": $nit, "timestamp": $now}] |
        .updated_at = $now' \
       "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      mv "$tmp" "$state_file"
      if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
        echo "[Review State] Iteration updated: total=$total (p0=$p0_count p1=$p1_count p2=$p2_count nit=$nit_count)" >&2
      fi
    else
      rm -f "$tmp" 2>/dev/null
      echo "[Review State] Iteration update skipped (jq write failed)" >&2
    fi
    _unlock
  else
    echo "[Review State] Iteration update skipped (lock contention)" >&2
  fi
}

# Update plan_review state (plan-review-loop T3 gate semantics).
# Mirrors update_state() but writes ONLY the plan_review subtree — never review_mode,
# aggregate_gate, code/doc fields, or root iteration_history (NFR-7 isolation).
# Deliberately does NOT clear the .blocked sidecar: that marker belongs to the
# code/doc/aggregate fail-closed plane and a plan write must not relax it.
update_plan_state() {
  local gate="$1"
  local reason="${2:-}"
  local tier="${3:-}"
  # append (default) | no-history — MCP token routing passes no-history: terminal
  # history[] is owned by the emit-plan-gate Bash path (the skill always runs
  # emit-plan-gate.sh after the token), so appending here too would double-write.
  local history_mode="${4:-append}"

  if ! _lock; then
    # Plan gate is warn-only/advisory: skip on contention rather than risk an
    # unlocked read-modify-write racing the critical code/doc/aggregate writers.
    echo "[Review State] plan_review update skipped (lock contention)" >&2
    return 0
  fi
  init_state_file
  if ! _migrate_state_plan_review "$STATE_FILE"; then
    _unlock
    echo "[Review State] plan_review update skipped (unsupported schema)" >&2
    return 0
  fi

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  tmp=$(mktemp)
  # Gate semantics (spec §3.3 T3): PENDING resets the per-plan cycle (OQ-6),
  # READY is the only passed=true outcome, DEGRADED/SKIPPED set their flag +
  # status_reason, terminal gates append a trail entry to history[] (last 5, FIFO).
  # NEEDS_HUMAN additionally stamps status_reason="needs-human" so stop-guard can
  # distinguish this terminal outcome from a pending (in-progress) review.
  if jq --arg gate "$gate" --arg reason "$reason" --arg tier "$tier" --arg now "$now" --arg history "$history_mode" '
    .plan_review.executed = true
    | .plan_review.last_run = $now
    | .updated_at = $now
    | .plan_review.passed = ($gate == "READY")
    | (if $gate == "PENDING" then
         .plan_review.degraded = false
         | .plan_review.skipped = false
         | .plan_review.status_reason = null
         | (if $tier != "" then .plan_review.tier = $tier else . end)
         | .plan_review.iteration_history.current_round = 0
         | .plan_review.iteration_history.findings_by_round = []
       elif $gate == "DEGRADED" then
         .plan_review.degraded = true
         | .plan_review.status_reason = (if $reason != "" then $reason else (.plan_review.status_reason // "reviewer-unavailable") end)
       elif $gate == "SKIPPED" then
         .plan_review.skipped = true
         | .plan_review.status_reason = "user-skip"
       elif $gate == "NEEDS_HUMAN" then
         .plan_review.status_reason = "needs-human"
       else . end)
    | (if ($gate == "READY" or $gate == "DEGRADED" or $gate == "SKIPPED" or $gate == "NEEDS_HUMAN") and $history == "append" then
         .plan_review.history = (((.plan_review.history // []) + [{
           "ts": $now,
           "tier": .plan_review.tier,
           "rounds": (.plan_review.iteration_history.current_round // 0),
           "findings_total": ((.plan_review.iteration_history.findings_by_round // []) | map(.total) | add // 0),
           "outcome": ($gate | ascii_downcase)
         }]) | .[-5:])
       else . end)
  ' "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Review State] plan_review update failed (jq write)" >&2
  fi
  _unlock
}

# Update plan_review iteration history from reviewer output (mirror of _update_iteration;
# writes plan_review.iteration_history only — never root iteration_history).
_update_plan_iteration() {
  local tool_output="$1"
  local state_file="${2:-$STATE_FILE}"

  local p0_count p1_count p2_count nit_count total
  p0_count=$(echo "$tool_output" | grep -cE '^\- \[P0\]|^#### P0' 2>/dev/null) || p0_count=0
  p1_count=$(echo "$tool_output" | grep -cE '^\- \[P1\]|^#### P1' 2>/dev/null) || p1_count=0
  p2_count=$(echo "$tool_output" | grep -cE '^\- \[P2\]|^#### P2' 2>/dev/null) || p2_count=0
  nit_count=$(echo "$tool_output" | grep -cE '^\- \[Nit\]|^#### Nit' 2>/dev/null) || nit_count=0
  total=$((p0_count + p1_count + p2_count + nit_count))

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if _lock; then
    # MCP routing calls this BEFORE update_plan_verdict — on a fresh session the
    # state file may not exist yet. Bailing here would silently drop the round
    # (current_round stuck at 0, findings lost from the later history snapshot).
    init_state_file
    if [[ ! -f "$state_file" ]]; then
      # Reserved for future non-default-path callers: init_state_file only manages
      # $STATE_FILE. All current callers pass $STATE_FILE (this branch is unreachable
      # today) — kept so a future caller cannot hit jq against a missing file.
      _unlock
      return 0
    fi
    if ! _migrate_state_plan_review "$state_file"; then
      _unlock
      echo "[Review State] plan iteration skipped (unsupported schema)" >&2
      return 0
    fi
    tmp=$(mktemp)
    if jq --argjson total "$total" --argjson p0 "$p0_count" \
       --argjson p1 "$p1_count" --argjson p2 "$p2_count" \
       --argjson nit "$nit_count" --arg now "$now" \
       '.plan_review.iteration_history.current_round += 1 |
        .plan_review.iteration_history.total_rounds_session = ((.plan_review.iteration_history.total_rounds_session // 0) + 1) |
        .plan_review.iteration_history.findings_by_round += [{"round": (.plan_review.iteration_history.current_round), "total": $total, "p0": $p0, "p1": $p1, "p2": $p2, "nit": $nit, "timestamp": $now}] |
        .updated_at = $now' \
       "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      mv "$tmp" "$state_file"
      if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
        echo "[Review State] Plan iteration updated: total=$total (p0=$p0_count p1=$p1_count p2=$p2_count nit=$nit_count)" >&2
      fi
    else
      rm -f "$tmp" 2>/dev/null
      echo "[Review State] Plan iteration update skipped (jq write failed)" >&2
    fi
    _unlock
  else
    echo "[Review State] Plan iteration update skipped (lock contention)" >&2
  fi
}

# Lightweight plan verdict write for MCP routing (no history append).
# Terminal history ownership belongs to the emit-plan-gate Bash path: the skill
# always runs emit-plan-gate.sh after the reviewer verdict, so writing history
# here too would double-append — and with stale rounds/findings_total, since the
# iteration update for the final round lands right before this call.
update_plan_verdict() {
  local passed="$1"
  if ! _lock; then
    echo "[Review State] plan_review verdict skipped (lock contention)" >&2
    return 0
  fi
  init_state_file
  if ! _migrate_state_plan_review "$STATE_FILE"; then
    _unlock
    echo "[Review State] plan_review verdict skipped (unsupported schema)" >&2
    return 0
  fi
  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  tmp=$(mktemp)
  if jq --argjson passed "$passed" --arg now "$now" \
     '.plan_review.passed = $passed | .plan_review.executed = true | .plan_review.last_run = $now | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Review State] plan_review verdict failed (jq write)" >&2
  fi
  _unlock
}

# Reset changed files array on review pass (D-3).
# Locked: an unlocked mv here can revert a concurrent locked write (e.g. an
# aggregate BLOCKED) with stale pre-write content. On contention, skip —
# keeping stale changed_files is fail-closed (review stays invalidated).
_reset_changed_files() {
  [[ ! -f "$STATE_FILE" ]] && return 0
  if ! _lock; then
    echo "[Review State] changed_files reset skipped (lock contention)" >&2
    return 0
  fi
  local tmp
  tmp=$(mktemp)
  if jq '.changed_files_since_review = []' "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp" 2>/dev/null
  fi
  _unlock
  return 0
}

# Set review_phase=idle after a passing precommit. Locked for the same reason
# as _reset_changed_files; on contention, skip — the phase transition retries
# on the next passing precommit.
_set_phase_idle() {
  [[ ! -f "$STATE_FILE" ]] && return 0
  if ! _lock; then
    echo "[Review State] phase reset skipped (lock contention)" >&2
    return 0
  fi
  local tmp
  tmp=$(mktemp)
  if jq '.review_phase = "idle"' "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp" 2>/dev/null
  fi
  _unlock
  return 0
}

# === Nit History Persistence (R4) ===
NIT_HISTORY_FILE=".claude_nit_history.json"
NIT_LOCKDIR="${NIT_HISTORY_FILE}.lockdir"
NIT_HAVE_LOCK=0

_nit_lock() {
  local start end
  start=$(date +%s)
  while ! mkdir "$NIT_LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge 3 ]; then
      # Stale recovery
      local lock_ts
      lock_ts=$(cat "$NIT_LOCKDIR/ts" 2>/dev/null || echo 0)
      local now
      now=$(date +%s)
      if [ $((now - lock_ts)) -ge 10 ]; then
        rm -rf "$NIT_LOCKDIR" 2>/dev/null
        mkdir "$NIT_LOCKDIR" 2>/dev/null && break
      fi
      return 1
    fi
    sleep 0.1
  done
  echo "$$" > "$NIT_LOCKDIR/pid" 2>/dev/null
  date +%s > "$NIT_LOCKDIR/ts" 2>/dev/null
  NIT_HAVE_LOCK=1
}

_nit_unlock() {
  [ "$NIT_HAVE_LOCK" -eq 1 ] && rm -rf "$NIT_LOCKDIR" 2>/dev/null
  NIT_HAVE_LOCK=0
}

_canonicalize_issue() {
  local issue="$1"
  printf '%s' "$issue" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[[:space:]]+/ /g' \
    | sed -E 's/line [0-9]+//gi' \
    | sed -E 's/[0-9]+/N/g' \
    | sed -E 's/\*\*//g; s/`//g; s/#//g; s/>//g; s/\|//g' \
    | cut -c1-120 \
    | sed 's/[[:space:]]*$//'
}

_compute_hash() {
  local file="$1" issue="$2"
  local canonical
  canonical=$(_canonicalize_issue "$issue")
  local key="${file}|${canonical}"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$key" | shasum -a 256 | cut -c1-16
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$key" | sha256sum | cut -c1-16
  else
    # Fallback: use cksum-based pseudo-hash (less ideal but functional)
    printf '%s' "$key" | od -A n -t x1 | tr -d ' \n' | cut -c1-16
  fi
}

_init_nit_history() {
  local nit_file="${1:-$NIT_HISTORY_FILE}"
  if [[ ! -f "$nit_file" ]]; then
    printf '{"schema_version":1,"deferred":[],"dismissed_via_verdict":[]}\n' > "$nit_file"
  fi
  # Validate JSON; recreate if corrupted
  if ! jq empty "$nit_file" 2>/dev/null; then
    echo "[Nit History] Corrupted file, recreating" >&2
    printf '{"schema_version":1,"deferred":[],"dismissed_via_verdict":[]}\n' > "$nit_file"
  fi
}

_gc_nit_history() {
  local nit_file="${1:-$NIT_HISTORY_FILE}"
  [[ ! -f "$nit_file" ]] && return 0
  local now_epoch tmp
  now_epoch=$(date +%s)
  tmp=$(mktemp)
  if jq --argjson now "$now_epoch" '
    .deferred |= [.[] | select(
      ((.last_seen | sub("\\.[0-9]+Z$"; "Z") | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) + (.ttl_days * 86400)) > $now
    )] |
    .dismissed_via_verdict |= [.[] | select(
      ((.timestamp | sub("\\.[0-9]+Z$"; "Z") | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) + (.ttl_days * 86400)) > $now
    )]
  ' "$nit_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$nit_file"
  else
    rm -f "$tmp" 2>/dev/null
  fi
}

_upsert_nit_deferred() {
  local sentinel_line="$1"
  local nit_file="${2:-$NIT_HISTORY_FILE}"

  # Parse: [NIT_DEFERRED] file:line | issue | reason: <reason> | <timestamp>
  local file_with_line issue reason
  file_with_line=$(printf '%s' "$sentinel_line" | sed -E 's/^\[NIT_DEFERRED\][[:space:]]*//' | cut -d'|' -f1 | sed 's/[[:space:]]*$//')
  issue=$(printf '%s' "$sentinel_line" | cut -d'|' -f2 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  reason=$(printf '%s' "$sentinel_line" | cut -d'|' -f3 | sed 's/^[[:space:]]*reason:[[:space:]]*//; s/[[:space:]]*$//')

  # Strip :line from file path
  local file_path
  file_path=$(printf '%s' "$file_with_line" | sed -E 's/:[0-9]+$//')

  # Security: reject paths with shell metacharacters
  if printf '%s' "$file_path" | grep -qE '[;&|`]' || printf '%s' "$file_path" | grep -qE '\$\('; then
    echo "[Nit History] Rejected suspicious file path" >&2
    return 0
  fi
  if printf '%s' "$issue" | grep -qE '[;&`]' || printf '%s' "$issue" | grep -qE '\$\('; then
    echo "[Nit History] Rejected suspicious issue text" >&2
    return 0
  fi

  [[ -z "$file_path" || -z "$issue" ]] && return 0

  local hash
  hash=$(_compute_hash "$file_path" "$issue")
  [[ -z "$hash" ]] && return 0

  _init_nit_history "$nit_file"

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local tmp
  tmp=$(mktemp)
  if jq --arg hash "$hash" --arg file "$file_path" --arg issue "$(_canonicalize_issue "$issue")" \
     --arg reason "${reason:-unknown}" --arg now "$now" '
    if (.deferred | map(.hash) | index($hash)) then
      .deferred |= map(if .hash == $hash then .defer_count += 1 | .last_seen = $now else . end)
    else
      .deferred += [{
        "hash": $hash,
        "file": $file,
        "severity": "Nit",
        "canonical_issue": $issue,
        "reason": $reason,
        "defer_count": 1,
        "first_seen": $now,
        "last_seen": $now,
        "ttl_days": 14
      }]
    end
  ' "$nit_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$nit_file"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Nit History] Upsert failed (jq error)" >&2
    return 0
  fi

  _gc_nit_history "$nit_file"
  echo "[Nit History] Deferred: hash=$hash file=$file_path" >&2
}

_upsert_dismiss_verdict() {
  local sentinel_line="$1"
  local nit_file="${2:-$NIT_HISTORY_FILE}"

  # Parse key=value pairs from [DISMISS_VERDICT] line
  # Key format: key=file|issue — contains | which is also the field delimiter (space-pipe-space)
  # Parse key= up to " | severity=" boundary to preserve the file|issue structure
  local key_field severity verdict confidence timestamp
  key_field=$(printf '%s' "$sentinel_line" | sed -E 's/.*key=([^|]+\|[^|]+) \| severity=.*/\1/' | sed 's/[[:space:]]*$//')
  severity=$(printf '%s' "$sentinel_line" | grep -oE 'severity=[^|]+' | sed 's/^severity=//' | sed 's/[[:space:]]*$//')
  verdict=$(printf '%s' "$sentinel_line" | grep -oE 'verdict=[^|]+' | sed 's/^verdict=//' | sed 's/[[:space:]]*$//')
  confidence=$(printf '%s' "$sentinel_line" | grep -oE 'confidence=[^|]+' | sed 's/^confidence=//' | sed 's/[[:space:]]*$//')
  timestamp=$(printf '%s' "$sentinel_line" | grep -oE 'timestamp=[^|]+' | sed 's/^timestamp=//' | sed 's/[[:space:]]*$//')

  # Extract file from key (format: file|issue)
  local file_path issue_text
  file_path=$(printf '%s' "$key_field" | cut -d'|' -f1 | sed 's/[[:space:]]*$//')
  issue_text=$(printf '%s' "$key_field" | cut -d'|' -f2- | sed 's/^[[:space:]]*//')

  [[ -z "$file_path" || -z "$verdict" ]] && return 0

  local hash
  hash=$(_compute_hash "$file_path" "$issue_text")
  [[ -z "$hash" ]] && return 0

  _init_nit_history "$nit_file"

  local now
  now="${timestamp:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

  local tmp
  tmp=$(mktemp)
  if jq --arg hash "$hash" --arg file "$file_path" --arg severity "${severity:-unknown}" \
     --arg verdict "$verdict" --arg confidence "${confidence:-0}" --arg now "$now" '
    if (.dismissed_via_verdict | map(.hash) | index($hash)) then
      .dismissed_via_verdict |= map(if .hash == $hash then .verdict = $verdict | .confidence = ($confidence | tonumber) | .timestamp = $now else . end)
    else
      .dismissed_via_verdict += [{
        "hash": $hash,
        "file": $file,
        "severity": $severity,
        "verdict": $verdict,
        "confidence": ($confidence | tonumber),
        "timestamp": $now,
        "ttl_days": 30
      }]
    end
  ' "$nit_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    mv "$tmp" "$nit_file"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Nit History] Dismiss verdict upsert failed (jq error)" >&2
    return 0
  fi

  _gc_nit_history "$nit_file"
  echo "[Nit History] Dismissed: hash=$hash verdict=$verdict" >&2
}

_parse_nit_sentinels() {
  local tool_output="$1"
  local nit_file="${2:-$NIT_HISTORY_FILE}"

  # Acquire nit history lock for batch write
  if ! _nit_lock; then
    echo "[Nit History] Lock contention, skipping sentinel parse" >&2
    return 0
  fi

  # Parse [NIT_DEFERRED] sentinels
  while IFS= read -r line; do
    [[ -n "$line" ]] && _upsert_nit_deferred "$line" "$nit_file"
  done < <(printf '%s' "$tool_output" | grep '^\[NIT_DEFERRED\]' 2>/dev/null || true)

  # Parse [DISMISS_VERDICT] sentinels
  while IFS= read -r line; do
    [[ -n "$line" ]] && _upsert_dismiss_verdict "$line" "$nit_file"
  done < <(printf '%s' "$tool_output" | grep '^\[DISMISS_VERDICT\]' 2>/dev/null || true)

  _nit_unlock
}

# Check for pass markers (anchored to line start to avoid false positives in error messages)
check_passed() {
  local output="$1"
  # Primary: anchored markers (most reliable)
  if echo "$output" | grep -qE '^## Gate: ✅|^✅ All Pass|^## Overall: ✅ PASS'; then
    echo "true"
  # Fallback: unanchored but only if no error/fail context on same line
  elif echo "$output" | grep -E '## Gate: ✅|✅ All Pass' | grep -qvE 'Error|Failed|FAIL'; then
    echo "true"
  else
    echo "false"
  fi
}

# Skill tool_response is a launch acknowledgement ("Launching skill: <name>"),
# not the review verdict — the verdict arrives later via the MCP or Bash
# routes. Only treat Skill output as a verdict when it carries an explicit
# gate/verdict marker; recording the placeholder would both double-count the
# review round (once here, once on the MCP verdict) and transiently flip
# passed=false on a passing review.
_skill_output_has_verdict() {
  printf '%s' "$1" | grep -qE '## Gate:|"gate"[[:space:]]*:|## Overall:|✅ All Pass|✅ Mergeable|⛔'
}

# D-5: Parse review gate with JSON-first, text sentinel fallback
# Conflict policy: JSON READY + text BLOCKED → fail-closed BLOCKED
_parse_review_gate() {
  local output="$1"
  local json_gate text_gate

  # Scan every {"gate":"..."} occurrence in the output. The previous
  # single-range sed extraction (`/```json/,/```/p`) broke when the output
  # carried 2+ ```json fences: the range reopened on the second fence, inner
  # fence lines survived, jq failed, and the authoritative gate was silently
  # dropped — falling open to the text sentinel. Scanning all occurrences
  # with BLOCKED-wins keeps stray example blocks fail-closed: noise can only
  # tighten the gate, never relax it.
  json_gate=""
  local all_gates
  all_gates=$(printf '%s\n' "$output" | grep -oE '"gate"[[:space:]]*:[[:space:]]*"(READY|BLOCKED)"' | grep -oE 'READY|BLOCKED' || true)
  if [[ -n "$all_gates" ]]; then
    if printf '%s\n' "$all_gates" | grep -qx 'BLOCKED'; then
      json_gate="BLOCKED"
    else
      json_gate="READY"
    fi
  fi

  # Text sentinel
  text_gate=$(check_passed "$output")

  if [[ -n "$json_gate" ]]; then
    local json_result="false"
    [[ "$json_gate" == "READY" ]] && json_result="true"
    # Conflict resolution: if JSON says READY but text says BLOCKED → fail-closed
    if [[ "$json_result" == "true" && "$text_gate" == "false" ]]; then
      echo "false"  # fail-closed
    else
      echo "$json_result"
    fi
  else
    echo "$text_gate"  # fallback to text sentinel
  fi
}

# Update aggregate_gate in state file (call within lock)
update_aggregate_gate() {
  local gate_value="$1"

  init_state_file

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local tmp
  tmp=$(mktemp)
  case "$gate_value" in
    PENDING)
      jq --arg now "$now" \
         '.review_mode = "dual" | .aggregate_gate.executed = false | .aggregate_gate.gate = null | .aggregate_gate.source = null | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "pending_review"' \
         "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
      ;;
    READY)
      jq --arg gate "$gate_value" --arg now "$now" \
         '.aggregate_gate.executed = true | .aggregate_gate.gate = $gate | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "precommit_pending"' \
         "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
      ;;
    BLOCKED)
      jq --arg gate "$gate_value" --arg now "$now" \
         '.aggregate_gate.executed = true | .aggregate_gate.gate = $gate | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "addressing_findings"' \
         "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
      ;;
  esac
  # Clear sidecar marker on successful locked write (supersedes any prior lock-failure marker)
  rm -f "${STATE_FILE}.blocked" 2>/dev/null || true
}

# Best-effort blocked write (used when lock fails — no lock held)
# Uses both: (1) unlocked JSON write (best-effort) + (2) atomic sidecar marker (race-safe)
update_aggregate_blocked() {
  local reason="${1:-unknown}"
  # Atomic sidecar marker: stop-guard checks this file as fail-closed fallback
  echo "$reason" > "${STATE_FILE}.blocked" 2>/dev/null || true
  # Best-effort JSON write (may race, but sidecar guarantees fail-closed)
  init_state_file
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local tmp
  tmp=$(mktemp)
  jq --arg reason "$reason" --arg now "$now" \
     '.review_mode = "dual" | .aggregate_gate.executed = true | .aggregate_gate.gate = "BLOCKED" | .aggregate_gate.reason = $reason | .aggregate_gate.last_run = $now | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE" 2>/dev/null || true
}

# === Process different commands ===

# === emit-review-gate parse branch ===
if [[ "$TOOL_NAME" == "Bash" ]] && echo "$COMMAND" | grep -qE 'emit-review-gate'; then
  GATE_VALUE=$(echo "$TOOL_OUTPUT" | grep -oE '^REVIEW_GATE=(PENDING|READY|BLOCKED)' | tail -1 | cut -d= -f2) || GATE_VALUE=""
  if [[ -n "$GATE_VALUE" ]]; then
    _lock || { update_aggregate_blocked "lock_failure"; echo "[Review State] Lock failed, fail-closed BLOCKED (reason: lock_failure)" >&2; exit 0; }
    update_aggregate_gate "$GATE_VALUE"
    _unlock
    echo "[Review State] aggregate_gate updated: gate=$GATE_VALUE" >&2
  fi
fi

# === emit-plan-gate parse branch (plan namespace — mirror of emit-review-gate above) ===
# grep -F: command match is a literal token; 'emit-plan-gate' never matches the
# 'emit-review-gate' branch above and vice versa (distinct literals).
if [[ "$TOOL_NAME" == "Bash" ]] && echo "$COMMAND" | grep -qF 'emit-plan-gate'; then
  PLAN_GATE=$(echo "$TOOL_OUTPUT" | grep -oE '^PLAN_REVIEW_GATE=(PENDING|READY|BLOCKED|DEGRADED|NEEDS_HUMAN|SKIPPED)' | tail -1 | cut -d= -f2) || PLAN_GATE=""
  if [[ -n "$PLAN_GATE" ]]; then
    # Reason set mirrors emit-plan-gate.sh exactly: REASON is only emitted for
    # DEGRADED (reviewer-unavailable|secret-detected). SKIPPED never emits a
    # REASON line — update_plan_state hardcodes status_reason="user-skip".
    PLAN_REASON=$(echo "$TOOL_OUTPUT" | grep -oE '^PLAN_REVIEW_REASON=(reviewer-unavailable|secret-detected)' | tail -1 | cut -d= -f2) || PLAN_REASON=""
    PLAN_TIER=$(echo "$TOOL_OUTPUT" | grep -oE '^PLAN_REVIEW_TIER=(quick|standard|deep)' | tail -1 | cut -d= -f2) || PLAN_TIER=""
    update_plan_state "$PLAN_GATE" "$PLAN_REASON" "$PLAN_TIER"
    echo "[Review State] plan_review updated: gate=$PLAN_GATE" >&2
  fi
fi

# /codex-review-fast or /codex-review (also matches Skill name: sd0x-dev-flow:codex-review-fast)
if echo "$COMMAND" | grep -qE '/?(sd0x-dev-flow:)?codex-review(-fast)?($|\s)'; then
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no code_review verdict to record" >&2
  else
    passed=$(_parse_review_gate "$TOOL_OUTPUT")
    update_state "code_review" "true" "$passed"
    [[ "$passed" == "true" ]] && { _reset_changed_files || true; }
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated: passed=$passed" >&2
  fi
fi

# /codex-review-doc or /review-spec (also matches Skill name form)
if echo "$COMMAND" | grep -qE '/?(sd0x-dev-flow:)?codex-review-doc($|[[:space:]])|/?(sd0x-dev-flow:)?review-spec($|[[:space:]])'; then
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no doc_review verdict to record" >&2
  else
    passed=$(check_passed "$TOOL_OUTPUT")
    update_state "doc_review" "true" "$passed"
    echo "[Review State] doc_review updated: passed=$passed" >&2
  fi
fi

# /precommit or /precommit-fast (also matches Skill name form)
if echo "$COMMAND" | grep -qE '/?(sd0x-dev-flow:)?precommit(-fast)?($|\s)'; then
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no precommit verdict to record" >&2
  else
    passed=$(check_passed "$TOOL_OUTPUT")
    update_state "precommit" "true" "$passed"
    if [[ "$passed" == "true" ]]; then
      _set_phase_idle || true
    fi
    echo "[Review State] precommit updated: passed=$passed" >&2
  fi
fi

# === MCP sentinel routing (no command to parse) ===
if [[ "$TOOL_NAME" == "mcp__codex__codex" || "$TOOL_NAME" == "mcp__codex__codex-reply" ]]; then
  # Priority 1: doc-specific (require ## Document Review section header to avoid collision with security reviews)
  if echo "$TOOL_OUTPUT" | grep -qE '## Document Review' && echo "$TOOL_OUTPUT" | grep -qE '✅ Mergeable'; then
    update_state "doc_review" "true" "true"
    echo "[Review State] doc_review updated (MCP): passed=true" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '## Document Review' && echo "$TOOL_OUTPUT" | grep -qE '⛔ Needs revision'; then
    update_state "doc_review" "true" "false"
    echo "[Review State] doc_review updated (MCP): passed=false" >&2
  # Priority 1.5: plan-specific (## Plan Review discriminator — isolated namespace).
  # Token markers use grep -qF: [PLAN_REVIEW_*] contains [ ] which grep -E would treat
  # as a character class (matching any single char inside), a guaranteed false positive.
  # `## Plan Review` + `⚠️ Plan Needs Human` (no token) deliberately matches NO branch:
  # NEEDS_HUMAN is recorded via the emit-plan-gate Bash path, not MCP routing.
  # Branch precedence: machine tokens (DEGRADED/SKIPPED) FIRST — degraded/skipped
  # output may quote a verdict marker in prose/verbose context, and routing such
  # output as a verdict would lose the degraded/skipped flags + status_reason.
  # Then BLOCKED before READY (fail-closed): ambiguous reviewer output containing
  # both verdict markers must route to blocked, never to ready.
  # All MCP writes skip history (verdict path via update_plan_verdict, token path
  # via no-history mode): terminal history is owned by the emit-plan-gate Bash
  # path, and iteration runs before verdict so the final round's counts are
  # recorded before any later history snapshot reads them. Iteration + verdict
  # lock/unlock separately (non-atomic window between the two writes) — acceptable
  # while the plan plane is single-producer (only the plan-review skill writes
  # plan_review.*); fold into one locked write if plan review ever runs concurrently.
  elif echo "$TOOL_OUTPUT" | grep -qE '## Plan Review' && echo "$TOOL_OUTPUT" | grep -qF '[PLAN_REVIEW_DEGRADED]'; then
    # No reason arg → status_reason defaults to "reviewer-unavailable". This is by
    # design: secret-detected degradation never reaches MCP routing — the skill
    # detects secrets BEFORE any reviewer send (fail-closed, Step 2) and records
    # the reason via the Bash emit-plan-gate path. A degraded token inside MCP
    # output can therefore only mean the reviewer plane itself failed.
    update_plan_state "DEGRADED" "" "" "no-history"
    echo "[Review State] plan_review updated (MCP): degraded=true" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '## Plan Review' && echo "$TOOL_OUTPUT" | grep -qF '[PLAN_REVIEW_SKIPPED]'; then
    update_plan_state "SKIPPED" "" "" "no-history"
    echo "[Review State] plan_review updated (MCP): skipped=true" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '## Plan Review' && echo "$TOOL_OUTPUT" | grep -qE '⛔ Plan Blocked'; then
    _update_plan_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    update_plan_verdict "false"
    echo "[Review State] plan_review updated (MCP): passed=false" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '## Plan Review' && echo "$TOOL_OUTPUT" | grep -qE '✅ Plan Ready'; then
    _update_plan_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    update_plan_verdict "true"
    echo "[Review State] plan_review updated (MCP): passed=true" >&2
  # Priority 2: code-specific
  elif echo "$TOOL_OUTPUT" | grep -qE '✅ Ready'; then
    update_state "code_review" "true" "true"
    _reset_changed_files || true
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated (MCP): passed=true" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '⛔ Blocked'; then
    update_state "code_review" "true" "false"
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated (MCP): passed=false" >&2
  # Priority 3: precommit
  elif echo "$TOOL_OUTPUT" | grep -qE '## Overall: ✅ PASS'; then
    update_state "precommit" "true" "true"
    _set_phase_idle || true
    echo "[Review State] precommit updated (MCP): passed=true" >&2
  elif echo "$TOOL_OUTPUT" | grep -qE '## Overall: (⛔ FAIL|❌ FAIL)'; then
    update_state "precommit" "true" "false"
    echo "[Review State] precommit updated (MCP): passed=false" >&2
  # Priority 4: generic
  elif echo "$TOOL_OUTPUT" | grep -qE '✅ All Pass'; then
    update_state "code_review" "true" "true"
    _reset_changed_files || true
    echo "[Review State] code_review updated (MCP): passed=true" >&2
  fi
  # Bare ## Gate: ✅/⛔ alone → skip (ambiguity rule)
fi

# === Nit sentinel routing ===
# [NIT_DEFERRED] and [DISMISS_VERDICT] appear in code review and seek-verdict output.
# Restrict to known producers to avoid pollution from template/doc content.
_NIT_ELIGIBLE=false
if [[ "$TOOL_NAME" == "mcp__codex__codex" || "$TOOL_NAME" == "mcp__codex__codex-reply" ]]; then
  _NIT_ELIGIBLE=true
elif [[ "$TOOL_NAME" == "Skill" ]] && echo "$COMMAND" | grep -qE '(codex-review|seek-verdict|codex-cli-review)'; then
  # Skill tool: restrict to known nit sentinel producers
  _NIT_ELIGIBLE=true
elif [[ "$TOOL_NAME" == "Bash" ]] && echo "$COMMAND" | grep -qE '/(sd0x-dev-flow:)?(codex-review|seek-verdict|codex-cli-review)'; then
  _NIT_ELIGIBLE=true
fi
if [[ "$_NIT_ELIGIBLE" == "true" ]] && printf '%s' "$TOOL_OUTPUT" | grep -qE '^\[NIT_DEFERRED\]|^\[DISMISS_VERDICT\]' 2>/dev/null; then
  _parse_nit_sentinels "$TOOL_OUTPUT"
fi

exit 0
