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

# === Shared state lock (same protocol as post-edit-format.sh / post-tool-review-state.sh) ===
#
# This hook performs ONE read-modify-replace of the state file (the `strategic_reset_fired` mark
# below). It used to do so unlocked, and a whole-file `mv` is not a field-scoped update: a
# concurrent PostToolUse writer that committed a verdict between this hook's `jq` read and its
# `mv` had that verdict silently reverted. Losing a PASS is harmless (the gate is simply
# re-requested), but losing a `⛔` is fail-OPEN — the stale `passed=true` it restores is exactly
# the state the blocking verdict was meant to overwrite. A lock only some writers take excludes
# nothing, so the directory name, TTL, timeout override, and stale-recovery rule must match the
# other two copies byte for byte.
#
# On lock failure this hook SKIPS the mark rather than writing anyway. It is advisory — the only
# consequence is that the `[STRATEGIC_RESET]` checklist may be injected again on the next
# compaction, which is the harmless direction; no sidecar marker is warranted for it.
LOCKDIR="${STATE_FILE}.lockdir"
LOCK_TIMEOUT="${REVIEW_STATE_LOCK_TIMEOUT:-5}"
[[ "$LOCK_TIMEOUT" =~ ^[0-9]+$ ]] || LOCK_TIMEOUT=5
LOCK_TTL=30
HAVE_LOCK=0
# Ownership token — see post-tool-review-state.sh for why the HAVE_LOCK flag alone is not proof.
# Built from shell builtins only. An earlier revision spliced in `$(date +%s)`, which runs at
# LOAD time — before the `command -v jq` degradation check — so on a PATH without coreutils the
# hook died with 127 instead of degrading. `$$` plus three 15-bit draws is ample here: the token
# only has to distinguish concurrent hook processes on one machine.
LOCK_TOKEN="$$-${RANDOM}${RANDOM}${RANDOM}"

_lockdir_mtime() {
  stat -f %m "$LOCKDIR" 2>/dev/null || stat -c %Y "$LOCKDIR" 2>/dev/null || echo 0
}

_lock() {
  local start end _takeovers
  start=$(date +%s)
  # Bounded, because a lost takeover retries instead of returning. Without a cap, a lock directory
  # that can be inspected but not replaced (an unwritable parent, say) combined with
  # REVIEW_STATE_LOCK_TIMEOUT=0 — which the hook suites set — would spin the stale branch with no
  # sleep between attempts. Three is enough to lose a couple of genuine races and still converge.
  _takeovers=0
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge $LOCK_TIMEOUT ]; then
      local lock_pid lock_ts now
      lock_pid=$(cat "$LOCKDIR/pid" 2>/dev/null || echo 0)
      lock_ts=$(cat "$LOCKDIR/ts" 2>/dev/null || echo 0)
      # Digit-validate both before the arithmetic: `$(( ))` performs command substitution inside an
      # array subscript, so a crafted `ts` is an execution vector. See post-edit-format.sh for why
      # the TTL arm alone carries the stale recovery (`kill -0 0` succeeds).
      [[ "$lock_pid" =~ ^[0-9]+$ ]] || lock_pid=0
      if [[ ! -f "$LOCKDIR/ts" ]]; then
        lock_ts=$(_lockdir_mtime)
      fi
      [[ "$lock_ts" =~ ^[0-9]+$ ]] || lock_ts=0
      now=$(date +%s)
      if [ $((now - lock_ts)) -ge $LOCK_TTL ] || ! kill -0 "$lock_pid" 2>/dev/null; then
        # Atomic rename-aside takeover — see post-tool-review-state.sh for why `rm -rf` + `mkdir`
        # let two contenders both enter.
        local _tomb="${LOCKDIR}.stale.$$.${RANDOM}"
        if mv "$LOCKDIR" "$_tomb" 2>/dev/null; then
          rm -rf "$_tomb" 2>/dev/null || true
          mkdir "$LOCKDIR" 2>/dev/null && break
        fi
        _takeovers=$((_takeovers + 1))
        [ "$_takeovers" -ge 3 ] && return 1
        start=$(date +%s)
        continue
      fi
      return 1
    fi
    sleep 0.1
  done
  echo "$$" > "$LOCKDIR/pid" 2>/dev/null || true
  date +%s > "$LOCKDIR/ts" 2>/dev/null || true
  printf '%s' "$LOCK_TOKEN" > "$LOCKDIR/owner" 2>/dev/null || true
  HAVE_LOCK=1
}

# See post-tool-review-state.sh — ownership is proven by token, not by the HAVE_LOCK flag.
_own_lock() {
  [ "$HAVE_LOCK" -eq 1 ] || return 1
  [ "$(cat "$LOCKDIR/owner" 2>/dev/null || echo)" = "$LOCK_TOKEN" ]
}

_unlock() {
  if _own_lock; then rm -rf "$LOCKDIR" 2>/dev/null || true; fi
  HAVE_LOCK=0
}

trap '_unlock' EXIT

# Graceful degradation: no jq = no output
if ! command -v jq &>/dev/null; then
  exit 0
fi

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

# Stale-state reconciliation (one-way: true→false only, same as stop-guard)
# Use -uall (include ALL untracked, even inside new dirs) to avoid false downgrade
# of newly-created untracked code/doc files (the prior -uno hid them).
# Only reconcile when a change flag is set (nothing to downgrade otherwise) — this also
# avoids walking a large untracked tree on every compaction when no review is pending.
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
    _pca_err="$(mktemp 2>/dev/null || echo '')"
    if [[ -z "$_pca_err" ]]; then
      GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    else
      if command -v timeout &>/dev/null; then
        GIT_PORCELAIN=$(LC_ALL=C timeout 5 git status --porcelain -uall 2>"$_pca_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      elif command -v gtimeout &>/dev/null; then
        GIT_PORCELAIN=$(LC_ALL=C gtimeout 5 git status --porcelain -uall 2>"$_pca_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      else
        # Stock macOS ships neither timeout nor gtimeout. perl's alarm+exec bounds the -uall walk
        # identically (the timer survives exec; SIGALRM's default action kills git → non-zero exit
        # → UNAVAILABLE), mirroring session-init.sh's _capture_baseline. Without this tier the
        # reconciliation NEVER ran on such hosts, so a stale has_*_change flag survived a revert or
        # an external commit and kept re-requesting a review with nothing left to review.
        GIT_PORCELAIN=$(LC_ALL=C perl -e 'alarm 5; exec @ARGV or exit 127' git status --porcelain -uall 2>"$_pca_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      fi
      grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_pca_err" && GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      rm -f "$_pca_err"
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

# Derive next required command
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

# Read iteration state (schema v2)
#
# DIGIT-VALIDATED before any arithmetic use. `.claude_review_state.json` is an ordinary working-tree
# file, so its values are untrusted input, and bash arithmetic — both `$(( ))` and the `-gt`/`-ge`
# operands of `[[ ]]` — expands COMMAND SUBSTITUTION inside an array subscript. The threshold below
# is a direct arithmetic context, so before the digit check was added a crafted
# `"max_rounds": "a[$(...)]"` executed arbitrary commands from this hook. The two lines below now
# read with a jq default and then RE-VALIDATE the result as digits-only, so a non-numeric value
# reaches the arithmetic as the schema default rather than as itself. Falling back to the
# schema defaults keeps this ADVISORY hook advisory: it only decides whether to print an
# `[ITERATION_STATE]` / `[STRATEGIC_RESET]` hint, and the enforcing decision (the hard cap) lives in
# stop-guard.sh, which fails closed on the same input rather than defaulting.
ITER_ROUND=$(jq -r '.iteration_history.current_round // 0' "$STATE_FILE" 2>/dev/null || echo 0)
ITER_MAX=$(jq -r '.iteration_history.max_rounds // 30' "$STATE_FILE" 2>/dev/null || echo 30)
[[ "$ITER_ROUND" =~ ^[0-9]+$ ]] || ITER_ROUND=0
[[ "$ITER_MAX" =~ ^[0-9]+$ ]] || ITER_MAX=30

# Only inject if there is a pending step
if [[ -n "$NEXT" ]]; then
  ITER_LINE=""
  if [[ "$ITER_ROUND" -gt 0 ]] 2>/dev/null; then
    ITER_LINE="[ITERATION_STATE] round=${ITER_ROUND}/${ITER_MAX}"
  fi

  # R10: Cap Diagnostic Protocol — AUXILIARY injection channel (opt-in).
  #
  # The PRIMARY checkpoint is not here and needs no switch: post-tool-review-state.sh emits
  # `[STRATEGIC_RESET]` the round `current_round` first crosses the threshold. Both channels share
  # `strategic_reset_fired`, so whichever fires first silences the other — that is the anti-loop
  # cap ("1 diagnosis per change", rules/auto-loop.md § Cap Diagnostic Protocol) expressed in
  # state rather than restated in two places.
  #
  # Reads `current_round` (this change's rounds), not the `total_rounds_session` near-cap form it
  # replaced: that one could not fire at a fixed round at all, and on a long session it fired on
  # effort already spent on changes that had since passed their gates.
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
    # Same digit guard as ITER_ROUND/ITER_MAX above — CKPT reaches `[[ -ge ]]` directly, and the
    # env is untrusted input.
    CKPT="${AUTO_LOOP_CHECKPOINT_ROUNDS:-10}"
    [[ "$CKPT" =~ ^[0-9]+$ ]] && [[ "$CKPT" -ge 1 ]] || CKPT=10

    # LOCK FIRST, then read. The eligibility inputs (round, flag) are re-read inside the lock and
    # deliberately NOT taken from ITER_ROUND / the pre-lock read this block used to do, because a
    # decision made outside the lock is stale by the time it is acted on, and both directions of
    # staleness are wrong in a way that is invisible afterwards:
    #   - the primary channel crosses the threshold in between → both channels emit for one change,
    #     breaking "1 diagnosis per change";
    #   - a passing precommit resets the flag in between → this blind `= true` marks the FRESH
    #     cycle as already fired, silently disabling the checkpoint for the whole next change.
    # `mv` is a whole-file replace, so read + rewrite + commit has to be one transaction; the lock
    # is what makes it one. Lock unavailable → skip entirely (see the header: re-firing the
    # checklist is the safe direction, marking the wrong cycle is not).
    if _lock; then
      _CKPT_ROUND=$(jq -r '.iteration_history.current_round // 0' "$STATE_FILE" 2>/dev/null) || _CKPT_ROUND=0
      [[ "$_CKPT_ROUND" =~ ^[0-9]+$ ]] || _CKPT_ROUND=0
      _CKPT_MAX=$(jq -r '.iteration_history.max_rounds // 30' "$STATE_FILE" 2>/dev/null) || _CKPT_MAX=30
      [[ "$_CKPT_MAX" =~ ^[0-9]+$ ]] || _CKPT_MAX=30
      # Fail-CLOSED on an unreadable flag, unlike the round/max reads above: those degrade to a
      # value that only affects display, whereas an unreadable flag means the state file is not
      # parseable — and the response to that is to leave it alone, not to rewrite it.
      RESET_FIRED=$(jq -r '.iteration_history.strategic_reset_fired // false' "$STATE_FILE" 2>/dev/null) || RESET_FIRED=true

      if [[ "$_CKPT_ROUND" -ge "$CKPT" ]] && [[ "$RESET_FIRED" != "true" ]]; then
        # Staged INSIDE `$LOCKDIR`, matching `_lock_staging_file` in post-tool-review-state.sh, and
        # this placement is a correctness property rather than tidiness. Staging beside the state
        # file leaves the temp reachable after a takeover, which re-opens the whole window the lock
        # exists to close: this writer holds the lock past its TTL and stages a temp; a contender
        # judges the lock stale, renames it aside, acquires the successor and commits a verdict;
        # this writer resumes and renames its still-reachable temp over that verdict. The
        # `_own_lock` check before `mv` does not save it — the check can pass and the process be
        # descheduled before the rename. Inside `$LOCKDIR` the takeover carries the temp away with
        # the lock directory, so the displaced owner's `mv` has nothing to rename and fails, which
        # is the outcome that was wanted all along.
        #
        # The rest matches the same writers: a FIXED `${STATE_FILE}.tmp` name collides when two
        # sessions compact at once (one truncates the other's partial write, then both rename), and
        # without `-s` a jq that exits 0 having written nothing renames an EMPTY file over the
        # state, which every downstream jq reader — stop-guard included — then treats as corrupt.
        _srf_tmp=$(mktemp "${LOCKDIR}/state.XXXXXX" 2>/dev/null) || _srf_tmp=""
        if [[ -n "$_srf_tmp" ]] && _own_lock; then
          if jq '.iteration_history.strategic_reset_fired = true' "$STATE_FILE" > "$_srf_tmp" 2>/dev/null \
             && [[ -s "$_srf_tmp" ]]; then
            # Ownership is re-checked AT the commit, not only at line ~303 before the jq. The
            # jq above reads and rewrites the whole state file and can take real time on a large
            # one, which is exactly the window in which a contender that judged this lock stale
            # takes it over — and this `mv` is a whole-file replace, so committing after a
            # takeover discards whatever the new owner wrote. Every other commit site across the
            # four hooks already guards the rename itself (13 of them); this was the lone
            # exception. Losing the mark is harmless by design: the strategic-reset checklist
            # re-fires, which the header documents as the safe direction.
            #
            # THINK_HARDER is set here and nowhere else: the reminder belongs to the process that
            # actually performed the false→true transition. Constructing it before the write is
            # what let a loser of the race emit a checklist it did not earn.
            if _own_lock && mv "$_srf_tmp" "$STATE_FILE" 2>/dev/null; then
              THINK_HARDER="[STRATEGIC_RESET] Review round ${_CKPT_ROUND}/${_CKPT_MAX} on this change. Diagnose the stall — one class from the closed set (rules/auto-loop.md § Cap Diagnostic Protocol):
ARCHITECTURE: same defect recurs across files, fixing A breaks B -> stop patching, back to design
DOC_TOO_LONG: target over the docs-numbering limit, repeated inconsistency findings -> split or shrink first
ATTENTION_DIFFUSION: fixes introduce new defects -> shrink the batch, verify per item
UNVERIFIED_CLAIM: blockers cluster on unmeasured claims -> measure first, record the command
TIER_MISMATCH: findings persistently below the blocking threshold -> converge per tier, next gate
REQUIREMENT_AMBIGUITY: reviewer and implementer disagree on correct -> ask the human
Then ONE bounded adjustment, then back to the loop. Disposition — including every exception and the anti-loop cap — is defined by rules/auto-loop.md § Cap Diagnostic Protocol; this reminder adjudicates nothing."
            else
              rm -f "$_srf_tmp"
            fi
          else
            rm -f "$_srf_tmp"
          fi
        fi
      fi
      _unlock
    fi
  fi

  # Keeps its own `[AUTO_LOOP_RESUME]` header — the field set is isomorphic with `[AUTO_LOOP_STATE]`
  # so one parser reads both, but the tag has to stay distinguishable: this one fires on compaction,
  # where the useful fact is that the state was re-read from disk rather than carried through a
  # summary that may have dropped it.
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
  _ALF_SOURCE="source=state_file"
  [[ "$_ADV_OK" == "true" ]] && _ALF_SOURCE="source=digest${_ADV_MIRROR_PLANES:+ mirror_planes=${_ADV_MIRROR_PLANES}}"
  cat <<EOF
[AUTO_LOOP_RESUME] event=compaction change=${_ALF_CHANGE} receipts=code_review:${CODE_PASSED},doc_review:${DOC_PASSED},precommit:${PRE_PASSED} $(_alf_common) ${_ALF_SOURCE} pending=${_ALF_PENDING:-none} suggested=${NEXT}${_ALF_DEGRADED}
Context was compacted. The state above was re-read at compaction time — its provenance is the source= token (digest: tree content + receipts, mirror only for the disclosed fallback planes; state_file: stored mirror alone) — not recovered from the summary.
${ITER_LINE:+${ITER_LINE}
}${THINK_HARDER:+${THINK_HARDER}
}
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
