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

# Dual mode adds a plane no code receipt can describe. `review_mode=dual` makes the AGGREGATE verdict
# the gate, and only the final emitter of `/codex-review-branch --dual` writes that plane — so a
# session with `code_review.passed=true` and no committed aggregate transition still owes an
# obligation that neither `/precommit` nor `/codex-review-fast` can discharge. Deriving the next step
# from the code receipt alone pointed the model at work that cannot end the objection: the same
# deadlock stop-guard already learned to avoid, reached through this hook instead.
# See docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md.
AGG_OUTSTANDING=false
# Gated on an actual code change. SessionStart resets the change flags and `aggregate_gate.executed`
# but deliberately PRESERVES `review_mode` (hooks/session-init.sh), so a clean session inherited from
# a dual run would otherwise be told to run the most expensive entry point in the plugin against no
# changes at all.
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
    # Both halves, because `executed` without `gate == READY` is an aggregation that ran and did not
    # pass — still outstanding. An unreadable field falls back to outstanding: fail-closed.
    _agg_exec=$(jq -r '.aggregate_gate.executed // false' "$STATE_FILE" 2>/dev/null || echo false)
    _agg_gate=$(jq -r '.aggregate_gate.gate // ""' "$STATE_FILE" 2>/dev/null || echo "")
    [[ "$_agg_exec" == "true" && "$_agg_gate" == "READY" ]] || AGG_OUTSTANDING=true
  elif _alf_agg_marker; then
    # The inverse leak: a transition that failed BEFORE persisting `review_mode=dual` leaves the
    # marker with the mode still reading `single`. stop-guard classifies that as an aggregate
    # obligation; reading the mode alone made these hooks name /codex-review-fast, which cannot
    # discharge it. Same deadlock, opposite door.
    AGG_OUTSTANDING=true
  fi
fi

# Determine next required step
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

# Only output when there is a pending step
if [[ -n "$NEXT" ]]; then
  # Obligations are named as PLANES, never as commands — the command rides in `suggested` and is
  # advisory. Which entry point discharges a plane, and whether now is the right moment, is the
  # model's call; the hook's job is to say what the state holds.
  _ALF_CHANGE="none"
  [[ "$HAS_CODE" == "true" ]] && _ALF_CHANGE="code"
  [[ "$HAS_DOC" == "true" ]] && _ALF_CHANGE="doc"
  [[ "$HAS_CODE" == "true" && "$HAS_DOC" == "true" ]] && _ALF_CHANGE="code,doc"
  _ALF_PENDING=""
  [[ "$AGG_OUTSTANDING" == "true" ]] && _ALF_PENDING="aggregate_gate"
  [[ "$HAS_CODE" == "true" && "$CODE_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}code_review"
  [[ "$HAS_DOC" == "true" && "$DOC_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}doc_review"
  [[ "$HAS_CODE" == "true" && "$PRE_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}precommit"
  # `git status` could not be bounded, so the change flags were never reconciled against the tree.
  # Saying so is the point: an unreconciled flag is a weaker claim than a reconciled one.
  _ALF_DEGRADED=""
  [[ "$GIT_PORCELAIN" == "__GIT_UNAVAILABLE__" ]] && _ALF_DEGRADED=" degraded=change_flags_unreconciled"
  _alf_emit "event=skill_complete change=${_ALF_CHANGE}" \
    "receipts=code_review:${CODE_PASSED},doc_review:${DOC_PASSED},precommit:${PRE_PASSED}" \
    "$(_alf_common)" \
    "pending=${_ALF_PENDING:-none} suggested=${NEXT}${_ALF_DEGRADED}"
fi

exit 0
