#!/usr/bin/env bash
# SessionStart (compact) Hook: Re-inject auto-loop rules after context compaction
# Registered as SessionStart with matcher "compact" — fires after compaction.
# stdout is injected into Claude's context (SessionStart stdout injection).
# Always exit 0 (non-blocking). Only outputs when there are pending review/precommit steps.

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

# Graceful degradation: no jq = no output
if ! command -v jq &>/dev/null; then
  exit 0
fi

# Graceful degradation: no state file = no output
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Read state
HAS_CODE=$(jq -r '.has_code_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
HAS_DOC=$(jq -r '.has_doc_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
CODE_PASSED=$(jq -r '.code_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
DOC_PASSED=$(jq -r '.doc_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
PRE_PASSED=$(jq -r '.precommit.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")

# === Sidecar fail-closed marker ===
if [[ -f "${STATE_FILE}.blocked" ]]; then
  CODE_PASSED="false"
  DOC_PASSED="false"
  PRE_PASSED="false"
  # Fail-closed: if no change flags set, sidecar means state write failed — assume changes exist
  [[ "$HAS_CODE" != "true" && "$HAS_DOC" != "true" ]] && { HAS_CODE="true"; HAS_DOC="true"; }
fi

# Stale-state reconciliation (one-way: true→false only, same as stop-guard)
# Use -uall (include ALL untracked, even inside new dirs) to avoid false downgrade
# of newly-created untracked code/doc files (the prior -uno hid them).
# Only reconcile when a change flag is set (nothing to downgrade otherwise) — this also
# avoids walking a large untracked tree on every compaction when no review is pending.
# Bound git with timeout/gtimeout (cross-platform); -uall can be costly on big trees.
# Skip when sidecar present — would undo fail-closed HAS_* forcing.
if [[ ( "$HAS_CODE" == "true" || "$HAS_DOC" == "true" ) && ! -f "${STATE_FILE}.blocked" ]]; then
  if command -v timeout &>/dev/null; then
    GIT_PORCELAIN=$(timeout 5 git status --porcelain -uall 2>/dev/null) || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  elif command -v gtimeout &>/dev/null; then
    GIT_PORCELAIN=$(gtimeout 5 git status --porcelain -uall 2>/dev/null) || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
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

# Derive next required command
NEXT=""
if [[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]]; then
  NEXT="/codex-review-fast"
elif [[ "$HAS_CODE" == "true" && "$CODE_PASSED" == "true" && "$PRE_PASSED" != "true" ]]; then
  NEXT="/precommit"
elif [[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]]; then
  NEXT="/codex-review-doc"
fi

# Read iteration state (schema v2)
ITER_ROUND=$(jq -r '.iteration_history.current_round // 0' "$STATE_FILE" 2>/dev/null || echo 0)
ITER_MAX=$(jq -r '.iteration_history.max_rounds // 10' "$STATE_FILE" 2>/dev/null || echo 10)

# Only inject if there is a pending step
if [[ -n "$NEXT" ]]; then
  ITER_LINE=""
  if [[ "$ITER_ROUND" -gt 0 ]] 2>/dev/null; then
    ITER_LINE="[ITERATION_STATE] round=${ITER_ROUND}/${ITER_MAX}"
  fi

  # R10: Think harder near-cap (opt-in)
  THINK_HARDER=""
  _PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
  _TH_ENABLED="false"
  for _rf in "${_PROJECT_DIR}/rules/auto-loop-project.md" \
             "${_PROJECT_DIR}/.claude/rules/auto-loop-project.md"; do
    if grep -v '<!--' "$_rf" 2>/dev/null | grep -q '## Think Harder: enabled'; then
      _TH_ENABLED="true"; break
    fi
  done

  if [[ "$_TH_ENABLED" == "true" ]]; then
    TOTAL_SESSION=$(jq -r '.iteration_history.total_rounds_session // 0' "$STATE_FILE" 2>/dev/null || echo 0)
    RESET_FIRED=$(jq -r '.iteration_history.strategic_reset_fired // false' "$STATE_FILE" 2>/dev/null || echo false)
    THRESHOLD=$(( ${ITER_MAX:-10} - 3 ))
    [[ "$THRESHOLD" -lt 1 ]] && THRESHOLD=1
    if [[ "$TOTAL_SESSION" -ge "$THRESHOLD" ]] && [[ "$RESET_FIRED" != "true" ]]; then
      THINK_HARDER="[STRATEGIC_RESET] Approaching iteration cap (${TOTAL_SESSION}/${ITER_MAX}). Before escalating:
1) Re-read original error/requirement from conversation start
2) Challenge current assumption — what if the opposite is true?
3) Search for similar patterns: grep -r \"keyword\" --include=\"*.ts\" -l
4) Try fundamentally different approach (not incremental fix)
5) If still blocked after reset, escalate at max_rounds"
      # Mark as fired (write to state file)
      jq '.iteration_history.strategic_reset_fired = true' "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null \
        && mv "${STATE_FILE}.tmp" "$STATE_FILE" 2>/dev/null || true
    fi
  fi

  cat <<EOF
[AUTO_LOOP_RESUME]
Context was compacted. Auto-loop state is still active.
${ITER_LINE:+${ITER_LINE}
}${THINK_HARDER:+${THINK_HARDER}
}Required next step: ${NEXT}
Core rules (re-injected):
1) Declaring != Executing: saying "need to run X" without invoking the tool is a violation
2) Summary != Completion: outputting a summary then stopping is a violation
3) Execute review in same reply after edit — do not stop, do not ask
Do not ask "should I continue" — execute ${NEXT} now.
EOF

  # R9: Git-as-memory injection (opt-in)
  _GIT_MEM_ENABLED="false"
  for _rf in "${_PROJECT_DIR}/rules/auto-loop-project.md" \
             "${_PROJECT_DIR}/.claude/rules/auto-loop-project.md"; do
    if grep -v '<!--' "$_rf" 2>/dev/null | grep -q '## Git Memory: enabled'; then
      _GIT_MEM_ENABLED="true"; break
    fi
  done

  if [[ "$_GIT_MEM_ENABLED" == "true" ]]; then
    _FILTER='grep -v -iE "\.(env|pem|key|secret)|credential|token"'
    _GL=$(git log --oneline --no-merges -5 2>/dev/null | eval "$_FILTER" | head -10) || true
    _GD=$(git diff --stat 2>/dev/null | eval "$_FILTER" | head -15) || true
    _GS=$(git status --short 2>/dev/null | eval "$_FILTER" | head -15) || true
    _GB=""
    [[ -n "$_GL" ]] && _GB+="Recent commits:\n${_GL}\n"
    [[ -n "$_GD" ]] && _GB+="Uncommitted changes:\n${_GD}\n"
    [[ -n "$_GS" ]] && _GB+="Working tree:\n${_GS}\n"
    if [[ -n "$_GB" ]]; then
      echo "[GIT_CONTEXT]"
      echo -e "$_GB" | head -40
    fi
  fi
fi

exit 0
