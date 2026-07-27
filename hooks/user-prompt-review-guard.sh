#!/usr/bin/env bash
# UserPromptSubmit Hook: Inject pending review reminder before Claude processes prompt
# stdout is injected into Claude's context (UserPromptSubmit stdout injection).
# Always exit 0 (non-blocking). Only outputs when pending review AND cooldown expired.
# Read-only: never writes to .claude_review_state.json (write authority = post-tool-review-state.sh).

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

# === [AUTO_LOOP_STATE] fact emitter ===
# BYTE-FOR-BYTE identical across all six emitter hooks; `test/hooks/auto-loop-state.test.js` pins
# that. They share no sourced lib because `.claude/hooks/` is a FLAT install — a `lib/` subdirectory
# would be absent on every install predating it, and the signal would vanish silently for exactly
# those users. See docs/features/auto-loop-autonomy/requests/2026-07-26-factual-hook-signals-r2.md.
_alf_read_tier() {
  local rf val
  for rf in "rules/auto-loop-project.md" ".claude/rules/auto-loop-project.md"; do
    [[ -f "$rf" ]] || continue
    val=$(awk '
      /^## / { s = ($0 ~ /^## Tier[[:space:]]*$/) ? 1 : 0; next }
      s && /<!--/ { c = 1 }
      s && !c && /^[[:space:]]*(fast|standard|thorough)[[:space:]]*$/ { gsub(/[[:space:]]/, ""); print; exit }
      s && /-->/ { c = 0 }
    ' "$rf" 2>/dev/null) || val=""
    case "$val" in fast|standard|thorough) printf '%s' "$val"; return 0 ;; esac
  done
  printf 'standard'
}
# Values that come from outside this hook — a `file_path` out of tool input, a string field out of
# the state file — are encoded, not merely trimmed. The record is whitespace-delimited `key=value`,
# so a legal filename is enough to forge structure: `a.ts` with an embedded newline starts a second
# fact line, and `a.ts pending=none` inserts a second `pending=` token into the first. Both are
# reachable by naming a file. Percent-encoding is reversible, so nothing is silently lost.
_alf_val() {
  # Byte-wise, or the encoding is neither valid nor host-independent: under a UTF-8 locale
  # `${s:i:1}` yields a CHARACTER, and `'一` gives its wide value, so `檔.ts` encodes to the
  # 4-hex-digit `%6A94.ts` on one host and `%E6%AA%94.ts` on another. No safety difference — every
  # structure-forging byte is ASCII — but a percent-encoding that cannot be decoded is not one.
  local LC_ALL=C
  local s="$1" out="" i c hex
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [A-Za-z0-9._/@:,+-]) out+="$c" ;;
      *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}
# Whole-line backstop for anything that reached the emitter without going through `_alf_val`.
# One event must produce exactly one physical line even when a field was assembled elsewhere.
_alf_flatten() {
  local s="$1"
  s="${s//$'\n'/\\n}"
  printf '%s' "${s//$'\r'/\\r}"
}
_alf_emit() {
  printf '[AUTO_LOOP_STATE] %s\n' "$(_alf_flatten "$*")"
}
# Defaulting belongs HERE, not in the jq filter. On a zero-byte state file `jq -r '.x // "d"'`
# prints nothing and exits 0 — so neither the filter default nor a `|| echo` fallback fires, and the
# field renders empty. A truncated write leaves exactly that file, which is when an accurate signal
# matters most. `${out:-...}` catches empty output and a failed/absent jq through one path.
_alf_field() {
  local out
  out=$(jq -r "$1" "$STATE_FILE" 2>/dev/null) || out=""
  _alf_val "${out:-${2:-unknown}}"
}
# Reads a receipt back from the state file AFTER a write, because `update_state` returns 0 on its
# mktemp, empty-output and lock-contention failures alike (post-tool-review-state.sh — see the
# `_verdict_write_failed` calls). Emitting the verdict that was REQUESTED would assert a durable
# state that may never have been committed, which is the one thing this signal must not do.
#
# THREE-VALUED on purpose. Collapsing "no state to read" into `false` is what made read-back weaker
# than a write result: a lost BLOCKING verdict then reads old=false, observed=false, want=false, and
# nothing marks it degraded even though no receipt was persisted at all. `unknown` keeps the
# unreadable case distinguishable from a recorded `false`, and it is never equal to a requested
# verdict, so it always leaves the plane pending.
#
# TYPE-TESTED, not defaulted. jq's `//` selects its right operand for `false` as well as `null`, so
# `.x.passed // "__absent__"` reported every ordinary RECORDED blocking verdict as unreadable, and
# accepted a string `"false"` as a valid one — both backwards. A non-object parent makes jq exit
# non-zero, which `_alf_field` already turns into `unknown`.
_alf_receipt() {
  case "$(_alf_field ".${1}.passed | if type == \"boolean\" then tostring else \"__absent__\" end" __absent__)" in
    true) printf 'true' ;;
    false) printf 'false' ;;
    *) printf 'unknown' ;;
  esac
}
# The three fields every emitter carries identically. Degrades to `unknown`/schema defaults rather
# than aborting a hook that runs under `set -euo pipefail`, where an abort is read as no objection.
_alf_common() {
  printf 'phase=%s round=%s/%s tier=%s' \
    "$(_alf_field '.review_phase // "unknown"' unknown)" \
    "$(_alf_field '.iteration_history.current_round // 0' 0)" \
    "$(_alf_field '.iteration_history.max_rounds // 30' 30)" \
    "$(_alf_read_tier)"
}

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

# Reads the sidecar bodies directly — these hooks have no `_SIDECAR_RAW`. Same two reasons and the
# same whole-line rule as stop-guard's `_agg_marker_in`; a substring test would let a longer reason
# name containing one of these count as it.
# See docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md.
_alf_agg_marker() {
  local p body
  for p in "${STATE_FILE}.blocked" "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$p" || continue
    body=$'\n'"$(cat "$p" 2>/dev/null || true)"$'\n'
    [[ "$body" == *$'\n'aggregate_write_failed$'\n'* || "$body" == *$'\n'lock_failure$'\n'* ]] && return 0
  done
  return 1
}

# Graceful degradation: no jq = silent
if ! command -v jq &>/dev/null; then
  exit 0
fi

# Graceful degradation: no state file = silent
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# --- Read state (read-only) ---
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

# Early exit: no changes tracked = nothing to remind
if [[ "$HAS_CODE" != "true" && "$HAS_DOC" != "true" ]]; then
  exit 0
fi

# --- Stale-state reconciliation (one-way: true→false only) ---
# Only run git status when state has pending changes (performance optimization)
# Include ALL untracked files (-uall, even inside newly-created dirs) to avoid false
# downgrade when only new files exist (plain -unormal misses files inside new untracked dirs)
# Skip when sidecar present — would undo fail-closed HAS_* forcing
if _sidecar_any; then
  GIT_PORCELAIN="__GIT_UNAVAILABLE__"
elif command -v timeout &>/dev/null || command -v gtimeout &>/dev/null || command -v perl &>/dev/null; then
  # Capture stderr + force LC_ALL=C: `git status` exits 0 but only WARNS on stderr and OMITS a
  # subtree it could not open (unreadable dir). A stderr-discarding, ambient-locale probe would miss
  # a reviewable file under such a dir and wrongly downgrade the flag (fail-open, iter-20 P1 class).
  # On any directory-omission warning (or mktemp failure) mark UNAVAILABLE → skip downgrade → hold.
  _upg_err="$(mktemp 2>/dev/null || echo '')"
  if [[ -z "$_upg_err" ]]; then
    GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  else
    if command -v timeout &>/dev/null; then
      GIT_PORCELAIN=$(LC_ALL=C timeout 3 git status --porcelain -uall 2>"$_upg_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    elif command -v gtimeout &>/dev/null; then
      GIT_PORCELAIN=$(LC_ALL=C gtimeout 3 git status --porcelain -uall 2>"$_upg_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    else
      # Stock macOS ships neither timeout nor gtimeout. perl's alarm+exec bounds the -uall walk
      # identically (the timer survives exec; SIGALRM's default action kills git → non-zero exit
      # → UNAVAILABLE), mirroring session-init.sh's _capture_baseline. Without this tier the
      # reconciliation NEVER ran on such hosts, so a stale has_*_change flag survived a revert or
      # an external commit and kept re-requesting a review with nothing left to review.
      GIT_PORCELAIN=$(LC_ALL=C perl -e 'alarm 3; exec @ARGV or exit 127' git status --porcelain -uall 2>"$_upg_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    fi
    grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_upg_err" && GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    rm -f "$_upg_err"
  fi
else
  # No timeout helper → cannot bound the -uall walk → skip (fail-closed: trust state flags)
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

# Dual mode adds a plane no code receipt can describe — same derivation and same reason as
# post-skill-auto-loop.sh; see the comment there and
# docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md.
AGG_OUTSTANDING=false
# Gated on an actual code change, and covering the marker case where the mode never persisted —
# same derivation and same reasoning as post-skill-auto-loop.sh; see the comment there.
if [[ "$HAS_CODE" == "true" ]]; then
  # Same closed enum and same fail-closed default as stop-guard (hooks/stop-guard.sh, "Unrecognized
  # review_mode"). A typo like `duel` fails every `== "dual"` test, and testing equality alone
  # silently downgrades dual->single HERE while Stop still treats it as dual — the two then name
  # different recovery commands for one state, which is the contradiction R1 removed.
  _REVIEW_MODE=$(jq -r '.review_mode // "single"' "$STATE_FILE" 2>/dev/null || echo single)
  # A zero-byte state file makes jq exit 0 with NO output, so neither the filter default nor the
  # `|| echo` fires and the value arrives empty. Empty is not an unrecognized mode — Stop replaces a
  # corrupt snapshot with `{}` and reads `single` from it, so falling to dual here would put the two
  # hooks back on different recovery commands for one state, which is the divergence just closed.
  _REVIEW_MODE="${_REVIEW_MODE:-single}"
  [[ "$_REVIEW_MODE" == "single" || "$_REVIEW_MODE" == "dual" ]] || _REVIEW_MODE="dual"
  if [[ "$_REVIEW_MODE" == "dual" ]]; then
    _agg_exec=$(jq -r '.aggregate_gate.executed // false' "$STATE_FILE" 2>/dev/null || echo false)
    _agg_gate=$(jq -r '.aggregate_gate.gate // ""' "$STATE_FILE" 2>/dev/null || echo "")
    [[ "$_agg_exec" == "true" && "$_agg_gate" == "READY" ]] || AGG_OUTSTANDING=true
  elif _alf_agg_marker; then
    AGG_OUTSTANDING=true
  fi
fi

# --- Derive next required command ---
NEXT=""
if [[ "$AGG_OUTSTANDING" == "true" ]]; then
  NEXT="/codex-review-branch --dual"
elif [[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]]; then
  NEXT="/codex-review-fast"
elif [[ "$HAS_CODE" == "true" && "$CODE_PASSED" == "true" && "$PRE_PASSED" != "true" ]]; then
  NEXT="/precommit"
elif [[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]]; then
  NEXT="/codex-review-doc"
fi

# No pending step = silent
if [[ -z "$NEXT" ]]; then
  exit 0
fi

# --- Cooldown check (avoid message fatigue) ---
# Use temp file keyed by working directory hash (session-scoped, survives across prompts)
# REVIEW_GUARD_COOLDOWN_FILE env var allows tests to override the path
if [[ -n "${REVIEW_GUARD_COOLDOWN_FILE:-}" ]]; then
  COOLDOWN_FILE="$REVIEW_GUARD_COOLDOWN_FILE"
else
  _PWD_HASH=$(echo -n "$PWD" | md5sum 2>/dev/null | cut -d' ' -f1 || md5 -q -s "$PWD" 2>/dev/null || echo "default")
  COOLDOWN_FILE="${TMPDIR:-/tmp}/.claude_review_inject_${_PWD_HASH}"
fi
COOLDOWN_SECONDS="${REVIEW_GUARD_COOLDOWN:-300}"  # Default 5 minutes, configurable
# Digit-validate before the arithmetic below. Bash arithmetic — `$(( ))` and the `-lt` operands of
# `[[ ]]` alike — expands COMMAND SUBSTITUTION inside an array subscript, so any non-numeric operand
# is an execution vector, not merely a wrong number. COOLDOWN_FILE lives under `${TMPDIR:-/tmp}`,
# which on a shared host is world-writable: another user can plant `a[$(...)]` in it and have this
# hook run it on the next prompt. REVIEW_GUARD_COOLDOWN is environment-supplied and gets the same
# treatment. Falling back to the default is right for this hook — it only decides whether to inject
# a reminder, so an unparseable cooldown should behave like a fresh one, not abort the prompt.
[[ "$COOLDOWN_SECONDS" =~ ^[0-9]+$ ]] || COOLDOWN_SECONDS=300

if [[ -f "$COOLDOWN_FILE" ]]; then
  LAST_INJECT=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo "0")
  [[ "$LAST_INJECT" =~ ^[0-9]+$ ]] || LAST_INJECT=0
  NOW=$(date +%s 2>/dev/null || echo "0")
  [[ "$NOW" =~ ^[0-9]+$ ]] || NOW=0
  ELAPSED=$((NOW - LAST_INJECT))
  if [[ "$ELAPSED" -lt "$COOLDOWN_SECONDS" ]]; then
    exit 0  # Cooldown active, stay silent
  fi
fi

# --- Inject reminder ---
_ALF_CHANGE="none"
[[ "$HAS_CODE" == "true" ]] && _ALF_CHANGE="code"
[[ "$HAS_DOC" == "true" ]] && _ALF_CHANGE="doc"
[[ "$HAS_CODE" == "true" && "$HAS_DOC" == "true" ]] && _ALF_CHANGE="code,doc"
_ALF_PENDING=""
[[ "$AGG_OUTSTANDING" == "true" ]] && _ALF_PENDING="aggregate_gate"
[[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}code_review"
[[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}doc_review"
[[ "$HAS_CODE" == "true" && "$PRE_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}precommit"
_ALF_DEGRADED=""
[[ "$GIT_PORCELAIN" == "__GIT_UNAVAILABLE__" ]] && _ALF_DEGRADED=" degraded=change_flags_unreconciled"
# Fires on a NEW user prompt, so the fact worth leading with is that these obligations predate it —
# the state is carried in, not created by whatever was just asked.
_alf_emit "event=user_prompt change=${_ALF_CHANGE}" \
  "receipts=code_review:${CODE_PASSED},doc_review:${DOC_PASSED},precommit:${PRE_PASSED}" \
  "$(_alf_common)" \
  "pending=${_ALF_PENDING:-none} suggested=${NEXT}${_ALF_DEGRADED}"

# Update cooldown timestamp — atomic write via a staging file that CANNOT be a pre-planted symlink.
#
# The old form was `_COOLDOWN_TMP="${COOLDOWN_FILE}.$$"` under a comment claiming it rejected
# symlinks; nothing did. `$$` is guessable and PIDs recycle, so a symlink planted at that exact name
# is followed by `>`, truncating whatever it points at. `umask 077` constrains the MODE of a file
# this shell creates — it has no bearing on whether the open follows a link.
#
# `mktemp` fixes both halves at once: the name is random, and the file is created with O_EXCL, so an
# existing entry (symlink or not) makes it pick another name rather than open through it. The final
# `mv` replaces COOLDOWN_FILE itself even when that path is a symlink, so the rename cannot be
# redirected either.
_COOLDOWN_TMP=$( (umask 077; mktemp "$(dirname "$COOLDOWN_FILE")/.cooldown.XXXXXX") 2>/dev/null ) || _COOLDOWN_TMP=""
if [[ -n "$_COOLDOWN_TMP" ]]; then
  if ! (umask 077; date +%s > "$_COOLDOWN_TMP" 2>/dev/null && mv "$_COOLDOWN_TMP" "$COOLDOWN_FILE" 2>/dev/null); then
    rm -f "$_COOLDOWN_TMP" 2>/dev/null || true   # never leave the staging file behind
  fi
fi

exit 0
