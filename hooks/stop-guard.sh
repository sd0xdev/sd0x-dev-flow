#!/usr/bin/env bash
# Stop Guard Hook - Check for missing required steps + review status
# Exit 0 = allow stop, Exit 2 = block stop and require action
#
# Modes:
# - Default (warn): Log missing steps but allow stop
# - Strict (block): Block stop until all steps complete
#
# Set STOP_GUARD_MODE=strict to enable blocking (opt-in)

set -euo pipefail

# === Environment Variables ===
# STOP_GUARD_MODE=strict - Block stop on missing steps (default: warn)
# HOOK_BYPASS=1          - Skip all checks (emergency escape hatch)
# HOOK_DEBUG=1           - Output debug info

GUARD_MODE="${STOP_GUARD_MODE:-warn}"

if [[ "${HOOK_BYPASS:-}" == "1" ]]; then
  echo "[Stop Guard] BYPASS mode, skipping checks" >&2
  echo '{"ok":true,"reason":"BYPASS mode"}'
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  echo "[Stop Guard] jq not installed, allowing stop" >&2
  echo '{"ok":true,"reason":"jq not installed"}'
  exit 0
fi

# Extract transcript_path
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  echo "[Stop Guard] Cannot read transcript, allowing stop" >&2
  echo '{"ok":true,"reason":"no transcript"}'
  exit 0
fi

# === Prefer reading state file ===
STATE_FILE=".claude_review_state.json"
USE_STATE_FILE=false

if [[ -f "$STATE_FILE" ]]; then
  USE_STATE_FILE=true
  STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "{}")

  CODE_REVIEW_PASSED=$(echo "$STATE" | jq -r '.code_review.passed // false')
  DOC_REVIEW_PASSED=$(echo "$STATE" | jq -r '.doc_review.passed // false')
  PRECOMMIT_PASSED=$(echo "$STATE" | jq -r '.precommit.passed // false')
  HAS_CODE_CHANGE=$(echo "$STATE" | jq -r '.has_code_change // false')
  HAS_DOC_CHANGE=$(echo "$STATE" | jq -r '.has_doc_change // false')

  if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
    echo "[Debug] Using state file mode" >&2
    echo "[Debug] CODE_REVIEW_PASSED=$CODE_REVIEW_PASSED" >&2
    echo "[Debug] PRECOMMIT_PASSED=$PRECOMMIT_PASSED" >&2
  fi

  # === Stale-state git check (with cross-platform timeout) ===
  if command -v timeout &>/dev/null; then
    GIT_PORCELAIN=$(timeout 5 git status --porcelain -uall 2>/dev/null || echo "__GIT_UNAVAILABLE__")
  elif command -v gtimeout &>/dev/null; then
    GIT_PORCELAIN=$(gtimeout 5 git status --porcelain -uall 2>/dev/null || echo "__GIT_UNAVAILABLE__")
  else
    GIT_PORCELAIN=$(git status --porcelain -uall 2>/dev/null || echo "__GIT_UNAVAILABLE__")
  fi
  if [[ "$GIT_PORCELAIN" != "__GIT_UNAVAILABLE__" ]]; then
    # Strip porcelain quoting (git quotes filenames with spaces/unicode)
    GIT_PORCELAIN_CLEAN=$(echo "$GIT_PORCELAIN" | sed 's/^.. "//; s/"$//')
    # Stale-state reconciliation is ONE-WAY: only true→false.
    # We can safely override has_*_change from true to false when git status
    # shows no matching files — the state file was set in a prior edit that
    # has since been reverted or committed.
    # The reverse (false→true) is NOT done because it would cause false
    # positives: a file might exist in the worktree but was never edited by
    # the current session (e.g., pre-existing untracked files). The state
    # file's false→true transition is handled by post-tool-review-state.sh
    # at edit time, which has the correct session context.
    if [[ "$HAS_CODE_CHANGE" == "true" ]]; then
      if ! echo "$GIT_PORCELAIN_CLEAN" | grep -qE '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs)($|\s|")'; then
        HAS_CODE_CHANGE="false"
        if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
          echo "[Debug] Stale has_code_change overridden to false (no code in git status)" >&2
        fi
      fi
    fi
    # Override stale has_doc_change if no doc files in worktree
    if [[ "$HAS_DOC_CHANGE" == "true" ]]; then
      if ! echo "$GIT_PORCELAIN_CLEAN" | grep -qE '\.(md|mdx)($|\s|")'; then
        HAS_DOC_CHANGE="false"
        if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
          echo "[Debug] Stale has_doc_change overridden to false (no docs in git status)" >&2
        fi
      fi
    fi
  fi
  # If git unavailable → fail-open, trust state file
fi

# === Fallback: Read transcript content (limited scan range) ===
if [[ "$USE_STATE_FILE" == "false" ]]; then
  # Only read last 500 lines to avoid performance issues
  CONVERSATION=$(tail -500 "$TRANSCRIPT" 2>/dev/null || echo "")

  # Check change types
  HAS_CODE_CHANGE=$(echo "$CONVERSATION" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs)"' | grep -E '"(Edit|Write)"' | head -1 || true)
  HAS_DOC_CHANGE=$(echo "$CONVERSATION" | grep -E '\.(md|mdx)"' | grep -E '"(Edit|Write)"' | head -1 || true)

  # Check if required commands were executed
  HAS_CODEX_REVIEW=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?codex-review(-fast|-branch)?($|[[:space:]])' | tail -1 || true)
  HAS_PRECOMMIT=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?precommit(-fast)?($|[[:space:]])' | tail -1 || true)
  HAS_REVIEW_DOC=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?codex-review-doc($|[[:space:]])|/(sd0x-dev-flow:)?review-spec($|[[:space:]])' | tail -1 || true)

  # Check review results (standard sentinel — includes doc review sentinels ✅ Mergeable / ✅ Ready)
  REVIEW_PASSED=$(echo "$CONVERSATION" | grep -E '## Gate: ✅|✅ All Pass|✅ Mergeable|✅ Ready|Gate.*PASS' | tail -1 || true)
  REVIEW_BLOCKED=$(echo "$CONVERSATION" | grep -E '## Gate: ⛔|⛔.*Block|⛔ Needs revision|⛔ Must fix|Gate.*FAIL' | tail -1 || true)

  if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
    echo "[Debug] Using transcript parsing mode" >&2
    echo "[Debug] HAS_CODE_CHANGE=${HAS_CODE_CHANGE:0:50}" >&2
    echo "[Debug] HAS_CODEX_REVIEW=$HAS_CODEX_REVIEW" >&2
    echo "[Debug] REVIEW_PASSED=${REVIEW_PASSED:0:50}" >&2
  fi
fi

# === Logic evaluation ===
MISSING="${MISSING:-}"
BLOCKED_REASON="${BLOCKED_REASON:-}"

if [[ "$USE_STATE_FILE" == "true" ]]; then
  # State file mode
  if [[ "$HAS_CODE_CHANGE" == "true" ]]; then
    if [[ "$CODE_REVIEW_PASSED" != "true" ]]; then
      MISSING="$MISSING /codex-review-fast"
    fi
    if [[ "$PRECOMMIT_PASSED" != "true" ]]; then
      MISSING="$MISSING /precommit"
    fi
  fi
  if [[ "$HAS_DOC_CHANGE" == "true" && "$DOC_REVIEW_PASSED" != "true" ]]; then
    MISSING="$MISSING /codex-review-doc"
  fi
else
  # Transcript parsing mode
  if [[ -n "$HAS_CODE_CHANGE" ]]; then
    if [[ -z "$HAS_CODEX_REVIEW" ]]; then
      MISSING="$MISSING /codex-review-fast"
    fi
    if [[ -z "$HAS_PRECOMMIT" ]]; then
      MISSING="$MISSING /precommit"
    fi
  fi
  if [[ -n "$HAS_DOC_CHANGE" && -z "$HAS_REVIEW_DOC" ]]; then
    MISSING="$MISSING /codex-review-doc"
  fi

  # Check if review passed — use last verdict for recency-correct detection
  # (handles fail→pass→fail re-runs: the LAST verdict wins)
  if [[ -n "$HAS_CODEX_REVIEW" || -n "$HAS_REVIEW_DOC" ]]; then
    LAST_REVIEW=$(echo "$CONVERSATION" | grep -E '## Gate: (✅|⛔)|✅ (All Pass|Mergeable|Ready)|⛔.*(Block|Needs revision|Must fix)|Gate.*(PASS|FAIL)' | tail -1 || true)
    if [[ -n "$LAST_REVIEW" ]] && echo "$LAST_REVIEW" | grep -qE '⛔|FAIL'; then
      BLOCKED_REASON="Review not passed (Blocked)"
    fi
  fi

  # D2: Check precommit result (not just execution) — scan for last ## Overall sentinel
  # Use the LAST ## Overall line to determine pass/fail (handles PASS→FAIL re-runs correctly)
  if [[ -n "$HAS_PRECOMMIT" && -z "$BLOCKED_REASON" ]]; then
    LAST_PRECOMMIT=$(echo "$CONVERSATION" | grep -E '## Overall: (✅ PASS|⛔ FAIL|❌ FAIL)' | tail -1 || true)
    if [[ -n "$LAST_PRECOMMIT" ]] && echo "$LAST_PRECOMMIT" | grep -qE '(⛔|❌) FAIL'; then
      BLOCKED_REASON="Precommit not passed (FAIL)"
    fi
  fi
fi

# === Output result ===
if [[ -n "${MISSING:-}" ]]; then
  if [[ "$GUARD_MODE" == "strict" ]]; then
    echo "[Stop Guard] STRICT: Missing steps:${MISSING}" >&2
    printf '{"ok":false,"reason":"Missing required steps","description":"Execute immediately:%s, do not ask user"}\n' "${MISSING}"
    exit 2
  else
    echo "[Stop Guard] WARN: Missing steps:${MISSING} (set STOP_GUARD_MODE=strict to block)" >&2
    printf '{"ok":true,"reason":"Missing steps (warn mode):%s"}\n' "${MISSING}"
    exit 0
  fi
elif [[ -n "${BLOCKED_REASON:-}" ]]; then
  if [[ "$GUARD_MODE" == "strict" ]]; then
    echo "[Stop Guard] STRICT: ${BLOCKED_REASON}" >&2
    printf '{"ok":false,"reason":"%s","description":"Fix issues and re-run review immediately, do not stop"}\n' "${BLOCKED_REASON}"
    exit 2
  else
    echo "[Stop Guard] WARN: ${BLOCKED_REASON} (set STOP_GUARD_MODE=strict to block)" >&2
    printf '{"ok":true,"reason":"%s (warn mode)"}\n' "${BLOCKED_REASON}"
    exit 0
  fi
else
  echo "[Stop Guard] Check passed" >&2
  echo '{"ok":true,"reason":"All steps completed"}'
  exit 0
fi
