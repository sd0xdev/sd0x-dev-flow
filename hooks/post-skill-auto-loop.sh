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
# Identity, not filename: `basename "$0"` says WHICH hook this is, never WHICH COPY. Without the
# comparison below the local copy satisfies every condition and defers to ITSELF — both copies
# exit 0 and the hook never runs at all (zero-fire, the opposite of the double-fire this block
# exists to prevent; issue #9). An unresolvable side leaves the guard false and does NOT defer:
# double-fire is visible, zero-fire is silent.
#
# Deferral is decided by ORIGIN, not by path identity. `hooks/hooks.json` registers the plugin copy
# under `${CLAUDE_PLUGIN_ROOT}` while settings register the local one under `$CLAUDE_PROJECT_DIR`,
# so the invoking spelling is what separates them — and it stays separate when `.claude/hooks` is a
# SYMLINK to the plugin's own hooks dir, the case where both copies are one file and a path
# comparison says "I am local" for both, so neither defers and the ledger counts every round twice.
#
# The origin test is deliberately LEXICAL. `pwd -P` on that symlinked layout resolves the local
# copy INTO the plugin directory, which would make it look like the plugin's and restore the exact
# zero-fire this block was written to fix. The resolved comparison stays as the fallback for hosts
# that do not export CLAUDE_PLUGIN_ROOT, and an invocation matching neither runs rather than defers.
#
# It matches the plugin hooks directory EXACTLY, never a descendant of the plugin root. Every
# `hooks/hooks.json` entry is spelled `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh`, so that one
# directory IS the registered surface, while a `${CLAUDE_PLUGIN_ROOT}/*` prefix also swallows a
# project nested under the plugin root — calling the LOCAL copy the plugin's and deferring it to
# itself, which is zero-fire again. Layouts and failure directions: the request doc, issue #9.
_SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || _SELF_DIR=""
_LOCAL_DIR="$(cd "${CLAUDE_PROJECT_DIR:-/nonexistent}/.claude/hooks" 2>/dev/null && pwd -P)" || _LOCAL_DIR=""
_IS_PLUGIN_COPY=false
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
  case "$(dirname "$0")/" in "${CLAUDE_PLUGIN_ROOT%/}"/hooks/) _IS_PLUGIN_COPY=true ;; esac
elif [[ -n "$_SELF_DIR" && -n "$_LOCAL_DIR" && "$_SELF_DIR" != "$_LOCAL_DIR" ]]; then
  _IS_PLUGIN_COPY=true
fi
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]] \
   && [[ ! -f "${CLAUDE_PROJECT_DIR}/hooks/hooks.json" ]] \
   && [[ "$_IS_PLUGIN_COPY" == "true" ]] \
   && [[ -x "${_LOCAL_DIR}/${_SELF_NAME}" ]]; then
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
# mktemp, empty-output and lock-contention failures alike (see its degraded paths). Emitting the
# verdict that was REQUESTED would assert a durable
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
# No state file is not an exit (WB5c): the mirror reads below just come back
# false-everything, and the derivation answers obligations from tree content
# without it. With neither available, the generic no-changes exit below stays
# silent — advisory hooks degrade silently; stop-guard carries the enforcement.

# Read state
HAS_CODE=$(jq -r '.has_code_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
HAS_DOC=$(jq -r '.has_doc_change // false' "$STATE_FILE" 2>/dev/null || echo "false")
CODE_PASSED=$(jq -r '.code_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
DOC_PASSED=$(jq -r '.doc_review.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")
PRE_PASSED=$(jq -r '.precommit.passed // false' "$STATE_FILE" 2>/dev/null || echo "false")

# === WB5a: derived reads (dual-read merge — one shared resolver) ===
# Obligation and receipt validity now come from tree content (tech spec §3.5):
# resolveAdvisory() in scripts/lib/gate-derive.js applies the merge policy in
# exactly one place — derived owed replaces the change flags in both
# directions, treeState 'unverifiable' forces everything open, a digest
# closure/negative outranks the mirror, and only an UNDERIVABLE tree
# (not-a-repo/unreadable) keeps the mirror value read above — on a derivable
# tree a plane the digest cannot close reads false (WB5c, window closed). The
# sidecar override below stays AFTER this merge — same ordering as stop-guard,
# so a write-failure marker still forces its plane open over digest evidence.
_ADV_OK="false"
_ADV_MIRROR_PLANES=""
_ADV_SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || _ADV_SELF_DIR=""
_ADV_DERIVE="${_ADV_SELF_DIR%/hooks}/scripts/lib/gate-derive.js"
if [[ -n "$_ADV_SELF_DIR" && -f "$_ADV_DERIVE" ]] && command -v node &>/dev/null; then
  # Bounded: the derivation walks the index and hashes dirty/untracked content,
  # which is unbounded on pathological trees (huge untracked artifacts) — and
  # this hook runs synchronously on interactive events. A timeout kill lands in
  # the derivation-unavailable fallback below (partial JSON fails the
  # all-or-none parse) — advisory-only now that WB5c closed the dual-read
  # window, and a disclosed degradation is never a wrong answer.
  _ADV_TIMEOUT="${AUTO_LOOP_DERIVE_TIMEOUT:-10}"
  # Validated strictly positive: `timeout 0` means NO timeout, and the perl
  # fallback's `alarm 0`/non-numeric input disables the alarm — either would
  # let a configuration value silently remove the bound this block exists for.
  if ! [[ "$_ADV_TIMEOUT" =~ ^[0-9]+$ ]] || ((10#$_ADV_TIMEOUT == 0)); then
    _ADV_TIMEOUT=10
  fi
  if command -v timeout &>/dev/null; then
    _ADV_JSON=$(timeout "$_ADV_TIMEOUT" node "$_ADV_DERIVE" "$PWD" --advisory "$STATE_FILE" 2>/dev/null) || _ADV_JSON=""
  elif command -v gtimeout &>/dev/null; then
    _ADV_JSON=$(gtimeout "$_ADV_TIMEOUT" node "$_ADV_DERIVE" "$PWD" --advisory "$STATE_FILE" 2>/dev/null) || _ADV_JSON=""
  elif command -v perl &>/dev/null; then
    _ADV_JSON=$(perl -e 'alarm shift; exec @ARGV or exit 127' "$_ADV_TIMEOUT" node "$_ADV_DERIVE" "$PWD" --advisory "$STATE_FILE" 2>/dev/null) || _ADV_JSON=""
  else
    _ADV_JSON=$(node "$_ADV_DERIVE" "$PWD" --advisory "$STATE_FILE" 2>/dev/null) || _ADV_JSON=""
  fi
  if [[ -n "$_ADV_JSON" ]]; then
    _adv_bool() {
      local v
      v=$(jq -r --arg k "$1" '.[$k] | if type == "boolean" then tostring else "" end' <<<"$_ADV_JSON" 2>/dev/null) || v=""
      case "$v" in true | false) printf '%s' "$v" ;; esac
    }
    _ADV_HC=$(_adv_bool has_code_change)
    _ADV_HD=$(_adv_bool has_doc_change)
    _ADV_CR=$(_adv_bool code_review_passed)
    _ADV_DR=$(_adv_bool doc_review_passed)
    _ADV_PC=$(_adv_bool precommit_passed)
    # All five or none: a partially-parsed answer must not mix policies.
    if [[ -n "$_ADV_HC" && -n "$_ADV_HD" && -n "$_ADV_CR" && -n "$_ADV_DR" && -n "$_ADV_PC" ]]; then
      HAS_CODE="$_ADV_HC"; HAS_DOC="$_ADV_HD"
      CODE_PASSED="$_ADV_CR"; DOC_PASSED="$_ADV_DR"; PRE_PASSED="$_ADV_PC"
      _ADV_OK="true"
      _ADV_MIRROR_PLANES=$(jq -r '(.mirror_planes // []) | join(",")' <<<"$_ADV_JSON" 2>/dev/null) || _ADV_MIRROR_PLANES=""
    fi
  fi
fi

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
# Skip when derived reads succeeded — the derivation already re-read the tree
# (and sees through ignore=all, unreadable dirs, and hidden submodules the
# porcelain probe cannot); a second git-status downgrade could only undo that
# (fail-open, R4-1 class). __ADV_DERIVED__ ≠ __GIT_UNAVAILABLE__ keeps the
# degraded token honest.
if [[ "$_ADV_OK" == "true" ]]; then
  GIT_PORCELAIN="__ADV_DERIVED__"
elif [[ ( "$HAS_CODE" == "true" || "$HAS_DOC" == "true" ) ]] && ! _sidecar_any; then
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
if [[ "$GIT_PORCELAIN" != "__GIT_UNAVAILABLE__" && "$GIT_PORCELAIN" != "__ADV_DERIVED__" ]]; then
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
  _ALF_SOURCE="source=state_file"
  [[ "$_ADV_OK" == "true" ]] && _ALF_SOURCE="source=digest${_ADV_MIRROR_PLANES:+ mirror_planes=${_ADV_MIRROR_PLANES}}"
  _alf_emit "event=skill_complete change=${_ALF_CHANGE}" \
    "receipts=code_review:${CODE_PASSED},doc_review:${DOC_PASSED},precommit:${PRE_PASSED}" \
    "$(_alf_common)" \
    "${_ALF_SOURCE} pending=${_ALF_PENDING:-none} suggested=${NEXT}${_ALF_DEGRADED}"
fi

exit 0
