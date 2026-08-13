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

# === Configuration ===
# Mode priority: env STOP_GUARD_MODE > settings.local env.STOP_GUARD_MODE (or legacy hooks_config)
#                > settings.json env.STOP_GUARD_MODE (or legacy hooks_config) > default "warn"
# HOOK_BYPASS=1  - Skip all checks (emergency escape hatch)
# HOOK_DEBUG=1   - Output debug info

# === Mode resolution (env > legacy settings hooks_config > default) ===
_resolve_guard_mode() {
  # Priority 1: Environment variable
  if [[ -n "${STOP_GUARD_MODE:-}" ]]; then echo "$STOP_GUARD_MODE"; return; fi
  # Priority 2-3: Settings files (jq required)
  if command -v jq &>/dev/null; then
    local _m
    for _sf in "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json" \
               "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
      # Try env.STOP_GUARD_MODE first (canonical), then legacy hooks_config
      _m=$(jq -r '.env.STOP_GUARD_MODE // .hooks_config.stop_guard_mode // empty' "$_sf" 2>/dev/null) || true
      if [[ -n "$_m" ]]; then echo "$_m"; return; fi
    done
  else
    # jq-free fallback: a missing jq must NOT silently downgrade a settings-configured strict
    # mode to warn — that would let the jq-unavailable branch below allow stop. Best-effort grep
    # of the same settings files; bias to strict when both appear (fail-closed). The env var
    # (priority 1) is already handled above and needs no jq.
    for _sf in "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.local.json" \
               "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
      [[ -f "$_sf" ]] || continue
      # Collapse newlines so a key/value split across physical lines (valid JSON, e.g. a
      # hand-formatted settings file) is still matched. A line-oriented grep would miss it and
      # fall through to warn — under the jq-unavailable branch below that is a fail-OPEN. The
      # `[[:space:]]*` between colon and value absorbs the leftover indentation after newline
      # removal. Newline strip is a bash builtin (parameter expansion); only `cat` is external,
      # which the rest of this hook already depends on (jq is the sole tool we treat as optional).
      # Note: `$(< file)` is NOT used — adding `2>/dev/null` to it disables bash's read-file
      # special form and yields empty output.
      local _raw _flat
      _raw=$(cat "$_sf" 2>/dev/null) || _raw=""
      _flat=${_raw//$'\n'/}
      _flat=${_flat//$'\r'/}
      if grep -Eq '"(STOP_GUARD_MODE|stop_guard_mode)"[[:space:]]*:[[:space:]]*"strict"' <<< "$_flat"; then
        echo "strict"; return
      fi
      if grep -Eq '"(STOP_GUARD_MODE|stop_guard_mode)"[[:space:]]*:[[:space:]]*"warn"' <<< "$_flat"; then
        echo "warn"; return
      fi
    done
  fi
  # Priority 4: default
  echo "warn"
}
GUARD_MODE=$(_resolve_guard_mode)
# Validate mode value
if [[ "$GUARD_MODE" != "strict" && "$GUARD_MODE" != "warn" ]]; then
  echo "[Stop Guard] Invalid GUARD_MODE='$GUARD_MODE', falling back to warn" >&2
  GUARD_MODE="warn"
fi

if [[ "${HOOK_BYPASS:-}" == "1" ]]; then
  echo "[Stop Guard] BYPASS mode, skipping checks" >&2
  echo '{"ok":true,"reason":"BYPASS mode"}'
  exit 0
fi

# Read JSON input from stdin
INPUT=$(cat)

# Recursion guard: prevent infinite loop in strict mode (D-1)
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null || echo "false")
if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then exit 0; fi

# State file path (needed by the jq-unavailable fail-closed check below)
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

# --- Sidecar readers (both planes) --------------------------------------------------------------
#
# The writers keep a SHARED `.blocked` file plus per-event emergency markers named
# `.blocked.event.*` alongside it (SIBLING FILES, never a `.blocked.d/` directory — see below).
# The second plane exists because a clearer rewrites the shared file WHOLESALE, which raced the
# setter's unserialized last-resort append; per-event markers are created and retired under disjoint
# names, so nothing can erase them. See `_sidecar_emergency_mark` in hooks/post-edit-format.sh.
#
# This file is the ENFORCER, so a reader here that consulted only the shared file would let an
# emergency marker pass unseen — fail-OPEN, and a marker exists only because a blocking verdict was
# already lost. Every sidecar check below therefore goes through these two helpers, never a bare
# `-f "${STATE_FILE}.blocked"`.
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
  # `nullglob` needed. A symlink at a marker name is not evidence either; see _sidecar_is_marker.
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && return 0
  done
  return 1
}

# The event plane alone. Separate from `_sidecar_any` because presence HERE decides whether any
# command can discharge what the marker implies: every writer's clear is hard-coded to the shared
# file, so only SessionStart's clean-tree sweep retires one of these. Callers use it to choose
# between an actionable instruction and a non-retry one — never to decide whether to block.
_sidecar_event_any() {
  local f
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && return 0
  done
  return 1
}

# One string for every site that has to explain an unretireable obligation — the jq-free early
# exits below and both renderers at the end of the file. Kept free of `"` and `\` by construction
# so the early exits, which run before `_json_safe` is defined, can interpolate it directly;
# `test/hooks/stop-guard.test.js` pins that property.
# Stated as facts only (R6): the sentence is reused verbatim by the BLOCKED renderer, which the
# cap path routes through, so it must carry no imperative. The branches that ARE allowed an
# imperative (the early sidecar exits and the MISSING branch — R2's degraded-path messaging)
# add their own "Do NOT auto-retry:" prefix around it.
SIDECAR_EVENT_NORETRY="a per-event sidecar marker is present. No review, precommit or edit retires it; the objection remains until a later session whose SessionStart finds no dirty code or doc file."


# Check if jq is available
if ! command -v jq &> /dev/null; then
  # jq is the review-state parser. Without it we cannot read .claude_review_state.json, so a
  # missing dependency must NOT silently bypass the gate. Fail CLOSED in strict mode whenever a
  # state file (or its fail-closed sidecar) exists. The recursion guard here is jq-free: the
  # guard at the top falls back to "false" when jq is absent, so grep the raw stdin for
  # stop_hook_active:true to avoid an infinite block loop. Collapse newlines first (same builtin
  # parameter-expansion approach as the settings fallback in _resolve_guard_mode) so a
  # stop_hook_active key/value split across physical lines is still matched. A miss here is
  # fail-closed (the strict branch below would still block), but collapsing keeps the recursion
  # guard reliable and the two jq-free greps consistent.
  _input_flat=${INPUT//$'\n'/}
  _input_flat=${_input_flat//$'\r'/}
  if grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true' <<< "$_input_flat"; then
    echo '{"ok":true,"reason":"jq not installed (recursion guard)"}'
    exit 0
  fi
  # Sidecar is the race-safe fail-closed marker; the jq-available path forces strict on it
  # (a file-existence check, no jq needed). A missing jq must NOT let it downgrade to warn —
  # block unconditionally, matching the sidecar handler in the state-file block below.
  if _sidecar_any; then
    echo "[Stop Guard] jq unavailable + blocked sidecar — failing closed" >&2
    # Same block either way; only the instruction differs. Without jq we cannot read state, but the
    # plane is a filesystem fact, so the one thing still knowable is whether a retry could ever help.
    if _sidecar_event_any; then
      echo "[Stop Guard] Do NOT auto-retry: ${SIDECAR_EVENT_NORETRY}" >&2
      printf '{"ok":false,"reason":"jq unavailable + blocked sidecar — failing closed","description":"Do not auto-retry: %s"}\n' "${SIDECAR_EVENT_NORETRY}"
    else
      echo '{"ok":false,"reason":"jq unavailable + blocked sidecar — failing closed","description":"Resolve the pending review/precommit, then re-run; do not stop with unverified state"}'
    fi
    exit 2
  fi
  if [[ -f "$STATE_FILE" ]]; then
    # review_mode=dual forces strict wherever jq is available, so it must not downgrade to warn
    # here either. Detect it jq-free (newline-collapsed, same approach as the recursion guard)
    # and fail closed; a single-mode pending state keeps the warn/strict behavior.
    # Read inside the `if` condition so `set -e` does not abort on a read failure (which would
    # exit 1 — a non-blocking hook error → fail-OPEN). A present-but-unreadable state file with
    # jq also missing is fully unverifiable, so fail closed (block) rather than guess.
    if ! _state_flat=$(cat "$STATE_FILE" 2>/dev/null); then
      echo "[Stop Guard] jq unavailable + unreadable review state — failing closed" >&2
      echo '{"ok":false,"reason":"jq unavailable + unreadable review state — failing closed","description":"Restore read access to the review state (and install jq), then re-run the pending review/precommit; do not stop with unverified state"}'
      exit 2
    fi
    _state_flat=${_state_flat//$'\n'/}
    _state_flat=${_state_flat//$'\r'/}
    if [[ "$GUARD_MODE" == "strict" ]] || grep -Eq '"review_mode"[[:space:]]*:[[:space:]]*"dual"' <<< "$_state_flat"; then
      echo "[Stop Guard] jq unavailable but review state exists (strict or dual) — failing closed" >&2
      echo '{"ok":false,"reason":"jq unavailable; cannot verify review state — failing closed","description":"Install jq (the review-gate parser), then re-run the pending review/precommit; do not stop with unverified state"}'
      exit 2
    fi
    echo "[Stop Guard] WARN: jq unavailable but review state exists (set STOP_GUARD_MODE=strict to block)" >&2
    echo '{"ok":true,"reason":"jq unavailable; review state unverified (warn mode)"}'
    exit 0
  fi
  echo "[Stop Guard] jq not installed, no review state — allowing stop (review gates are UNENFORCED: without jq the state writer never creates a state file, so nothing here can ever block; install jq to enable enforcement)" >&2
  echo '{"ok":true,"reason":"jq not installed; no review state"}'
  exit 0
fi

# Sidecar present but main state file missing → state is unverifiable. The sidecar is the
# race-safe fail-closed marker (written before best-effort JSON recovery in the writer hooks),
# so it must fail closed regardless of whether the transcript is readable. Hoisted above the
# transcript handling so a READABLE transcript cannot route a sidecar-only state into the legacy
# transcript-parsing allow path (USE_STATE_FILE=false). When the state file IS present, the
# sidecar handler in the state-file block below takes over.
if [[ ! -f "$STATE_FILE" ]] && _sidecar_any; then
  echo "[Stop Guard] Blocked sidecar without state file — failing closed" >&2
  # Production-reachable, not hypothetical: `update_aggregate_gate` raises `aggregate_write_failed`
  # when state INITIALIZATION fails, and `_set_own_sidecar` diverts that evidence to the event plane
  # exactly when it could not serialize on the shared one. State absent + event marker is that case.
  if _sidecar_event_any; then
    echo "[Stop Guard] Do NOT auto-retry: ${SIDECAR_EVENT_NORETRY}" >&2
    printf '{"ok":false,"reason":"blocked sidecar present without state file — failing closed","description":"Do not auto-retry: %s"}\n' "${SIDECAR_EVENT_NORETRY}"
  else
    echo '{"ok":false,"reason":"blocked sidecar present without state file — failing closed","description":"Resolve the pending review/precommit, then re-run; do not stop with unverified state"}'
  fi
  exit 2
fi

# Extract transcript_path
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

if [[ -z "$TRANSCRIPT" || ! -f "$TRANSCRIPT" ]]; then
  # A missing/unreadable transcript must NOT bypass the review-state gate (fail-closed).
  # The state file is the PRIMARY enforcement source and needs no transcript; only the
  # legacy fallback scan (USE_STATE_FILE=false branch) reads the transcript. This used to
  # early-allow when the state file was ALSO missing — but the check-time derivation and its
  # git probe need no transcript either (round-2 P1): deleting both the state file and the
  # transcript path must not skip them. So no early exit: fall through with TRANSCRIPT=""
  # (the sweep and the legacy scan skip themselves on an empty path), let the derivation
  # answer, and let the promotion block decide. A host where nothing can answer — no state,
  # no derivation, not a repo — reaches the legacy scan with an empty conversation and still
  # allows, exactly the case the old early exit was for.
  if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
    echo "[Stop Guard] Transcript missing; deferring to state/derivation enforcement" >&2
  fi
  TRANSCRIPT=""
fi

# === WB4: final pairing sweep (check-time writer) ===
# A backgrounded review can complete without ever firing a PostToolUse event;
# its verdict then exists only in the transcript. Sweeping HERE — before any
# gate value is read — binds and settles it under the producer lock, so the
# derivation below judges a log that already holds everything the transcript
# can prove. Advisory: a failed sweep only leaves the gate open (fail-closed),
# never blocks the stop decision itself. CLI resolution matches
# session-init.sh: the scripts ship beside this hook in both layouts.
_GD_SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd -P)" || _GD_SELF_DIR=""
_GD_CLI="${_GD_SELF_DIR%/hooks}/scripts/dispatch-cli.js"
_GD_DERIVE="${_GD_SELF_DIR%/hooks}/scripts/lib/gate-derive.js"
_GD_SOURCE="mirror"
_GD_OBLIGATION_DERIVED=false
_GD_TREE_UNVERIFIABLE=false
_GD_FALLBACK_PLANES=""
# Full GIT_* env fence, shared by EVERY direct git this gate logic runs (the WB5c fallback
# probe, the corrupt-state probe, the stale-git reconciliation): repository resolution must
# match tree-digest.js cleanGitEnv — strip the whole namespace dynamically (a fixed list could
# not enumerate future names) and pin each call with `git -C "$PWD"`. Round-2 P1: fencing only
# the fallback probe left the reconciliation redirectable by ambient GIT_DIR/GIT_WORK_TREE,
# which could downgrade a mirror-held obligation against some OTHER, cleaner repository.
# `+`-guarded expansion at each use keeps bash 3.2's `set -u` from aborting on an empty array.
_GD_GIT_FENCE=()
while IFS='=' read -r _gd_fence_k _; do
  [[ "$_gd_fence_k" == GIT_* ]] && _GD_GIT_FENCE+=(-u "$_gd_fence_k")
done < <(env)
# Containment-proved stderr capture, shared by the sweep and the two git probes (resolved
# paths BOTH sides, /tmp fallback subject to the same check): a TMPDIR inside (or symlinked
# into) the repo would otherwise let the capture file itself dirty the porcelain a probe is
# reading — self-inflicted, repeating on every Stop (round-2 P2). The boundary is the physical
# WORKTREE ROOT, not $PWD (round-3 P2): with the hook cwd below the root, a repo-local TMPDIR
# outside that subdirectory passed a $PWD-based test and still planted the capture inside the
# tree. Outside any repository the boundary falls back to the physical cwd; a worktree whose
# root cannot be resolved physically — or a rev-parse refusal with a `.git` ancestor proving a
# tree exists — yields NO capture path, and callers keep their fail-closed disposition.
# Prints the created path; prints nothing when no candidate proves out.
_gd_safe_tmpfile() {
  local _pfx="$1" _bound _cand _res _f _walk _next
  _bound=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || _bound=""
  if [[ -n "$_bound" ]]; then
    _bound=$(cd "$_bound" 2>/dev/null && pwd -P) || return 1
    [[ -n "$_bound" ]] || return 1
  else
    # rev-parse named no root. Any `.git` ancestor still proves a worktree we cannot bound —
    # no capture path (fail-closed). A genuinely repo-free cwd bounds at its physical self.
    _walk="$PWD"
    while :; do
      [[ -e "$_walk/.git" || -L "$_walk/.git" ]] && return 1
      _next="${_walk%/*}"
      [[ -z "$_next" ]] && _next="/"
      [[ "$_next" == "$_walk" ]] && break
      _walk="$_next"
    done
    _bound=$(pwd -P 2>/dev/null) || _bound="$PWD"
  fi
  # A bound of `/` contains every absolute path, but the case pattern below
  # ("$_bound"/* → //*) matches none of them — so a worktree rooted at / would
  # accept /tmp while it sits inside the tree (round-4 P2). No candidate can
  # escape a root bound: no capture path, callers stay fail-closed.
  [[ "$_bound" == "/" ]] && return 1
  for _cand in "${TMPDIR:-/tmp}" /tmp; do
    case "$_cand" in /*) ;; *) continue ;; esac
    _res=$(cd "$_cand" 2>/dev/null && pwd -P) || continue
    [[ -n "$_res" ]] || continue
    case "$_res" in "$_bound" | "$_bound"/*) continue ;; esac
    _f=$(mktemp "${_res}/${_pfx}.XXXXXX" 2>/dev/null) || continue
    printf '%s' "$_f"
    return 0
  done
  return 1
}
if [[ -n "$TRANSCRIPT" && -n "$_GD_SELF_DIR" && -f "$_GD_CLI" ]] && command -v node &>/dev/null; then
  # The CLI reports a refused-but-handled sweep as exit 0 with ok:false in the
  # JSON (its reports ride stderr) — reading exit status alone would swallow
  # exactly the runs whose reviews stayed unsettled. Capture both streams and
  # judge ok on the JSON.
  _GD_SWEEP_OUT=""
  _GD_SWEEP_ERR=""
  _GD_SWEEP_STATUS=0
  # The stderr capture file must never land inside the tree under review: a
  # relative TMPDIR (or one pointing into the repo) would add an untracked
  # code-plane file mid-sweep, shifting the digest the endpoint revalidates
  # against and settling a genuine PASS as no-verdict. Same posture as the
  # receipt/tombstone resolver: EVERY candidate — the /tmp fallback included —
  # passes the same resolution + containment proof (R4-2: a repo rooted at
  # /tmp, or at macOS's physical /private/tmp, would otherwise re-admit the
  # unproven fallback the containment check just rejected), on RESOLVED paths
  # (`pwd -P` both sides, R3-3) — a lexical compare would accept /tmp/x
  # symlinked into the repo. Round-3 P2 moved the proof into the shared
  # _gd_safe_tmpfile above, which also fixed its boundary: the WORKTREE ROOT,
  # not $PWD, so a subdirectory cwd cannot re-admit a repo-local TMPDIR. No
  # candidate proves out → capture is skipped entirely rather than trusted.
  _GD_SWEEP_ERRFILE="$(_gd_safe_tmpfile sg-sweep-err)" || _GD_SWEEP_ERRFILE=""
  if [[ -n "$_GD_SWEEP_ERRFILE" ]]; then
    _GD_SWEEP_OUT=$(printf '%s' "$INPUT" | node "$_GD_CLI" sweep 2>"$_GD_SWEEP_ERRFILE") || _GD_SWEEP_STATUS=$?
    _GD_SWEEP_ERR=$(cat "$_GD_SWEEP_ERRFILE" 2>/dev/null || true)
    # Guarded: an unremovable temp file must never abort the hook under
    # `set -e` — a non-0/2 exit here is read as "no objection" (fail-open).
    rm -f "$_GD_SWEEP_ERRFILE" 2>/dev/null || true
  else
    # No capture file (no proven temp dir, or mktemp failed): let the CLI's
    # stderr flow straight through to the hook's — discarding it here would
    # reintroduce the swallowed-diagnostics defect (R2-5) on exactly the path
    # where the operator most needs the reason (R5-1).
    _GD_SWEEP_OUT=$(printf '%s' "$INPUT" | node "$_GD_CLI" sweep) || _GD_SWEEP_STATUS=$?
  fi
  _GD_SWEEP_OK=$(jq -r '.ok // false' <<< "$_GD_SWEEP_OUT" 2>/dev/null || echo false)
  if [[ "$_GD_SWEEP_STATUS" -ne 0 || "$_GD_SWEEP_OK" != "true" ]]; then
    echo "[Stop Guard] final pairing sweep did not settle (exit=${_GD_SWEEP_STATUS} ok=${_GD_SWEEP_OK})${_GD_SWEEP_ERR:+ — ${_GD_SWEEP_ERR}} — unsettled background reviews stay open (fail-closed)" >&2
  fi
fi

# === Prefer reading state file === (STATE_FILE defined above for the jq-unavailable check)
USE_STATE_FILE=false

# Initialized here, unconditionally, because the fact emitter at the terminal output block reads all
# of them and the transcript-fallback path never enters the branch that assigns them. Under
# `set -euo pipefail` an unset read there aborts the hook: no JSON reaches the harness, which reads
# the silence as "no objection" and lets the stop through — fail-OPEN, on the one path where an
# unproven verdict is least affordable. `${x:-}` at each use would stop the abort but not the other
# half: an inherited environment value of any of these names would be believed. Same reasoning as
# `_SIDECAR_EVENT_PRESENT` below.
HAS_CODE_CHANGE=false
HAS_DOC_CHANGE=false
CODE_REVIEW_PASSED=false
CODE_RECEIPT_PERSISTED=false
DOC_REVIEW_PASSED=false
PRECOMMIT_PASSED=false
_AGG_OBLIGATION=false
_AGG_OUTSTANDING=false
# WB5c P1 fix additions to the same contract. _GD_ANSWERED records whether the derivation (or
# its git probe) positively answered this stop — it decides the promotion past the transcript
# fallback below, so an inherited environment value would fabricate that promotion (or veto it).
# The rest are read after the state branch on paths the promotion newly makes reachable:
# PRECOMMIT_MODE is read UNGUARDED at the REQUIRE_FULL re-check, and the sidecar/dual trio kept
# their fail-safe meaning only because the state branch always assigned them before use.
_GD_ANSWERED=false
PRECOMMIT_MODE=""
REVIEW_MODE=""
REVIEW_PHASE=""
DUAL_GATE_PASSED=""
SIDECAR_ESCALATE=false
_SIDECAR_RAW=""
_SIDECAR_EVENT_PRESENT=false

if [[ -f "$STATE_FILE" ]]; then
  USE_STATE_FILE=true
  # A present-but-UNREADABLE state file (e.g. chmod 000) must NOT be mapped to "{}" — that
  # would pass the shape guard below and let every read default false → gate never engages →
  # fail-OPEN. On any cat failure, leave STATE empty so the empty/whitespace branch of the
  # corrupt guard forces strict, exactly like a zero-byte file.
  STATE=$(cat "$STATE_FILE" 2>/dev/null) || STATE=""

  # A readable but EMPTY, UNPARSEABLE, or NON-OBJECT state file must fail CLOSED. Holes:
  #   1. Unparseable non-empty JSON — the jq reads below run under `set -euo pipefail`;
  #      a parse error makes jq exit >0 and aborts the hook with a non-0/2 status, which
  #      Claude Code treats as a NON-blocking hook error → a pending strict/dual gate
  #      would let the session stop UNREVIEWED (fail-OPEN).
  #   2. Empty / whitespace-only file — `jq empty` treats empty input as zero JSON values
  #      and exits 0 (NOT an error), so it would slip past a parse-only check; every
  #      `.field // false` read then yields "" (no output), leaving HAS_CODE_CHANGE="" so
  #      the gate never engages → fail-OPEN in warn mode (the project default). A zero-byte
  #      file shouldn't occur (write-side size guards), but the fail-closed guarantee must
  #      not depend on that.
  #   3. Valid but NON-OBJECT JSON (`false`, `123`, `[]`, `"str"`) — this PARSES (so `jq
  #      empty` would pass it), but the very next read `.code_review.passed` then errors
  #      ("Cannot index boolean/number/array with string", exit 5) and, under `set -e`,
  #      aborts the hook with a non-0/2 status → same fail-OPEN as case 1. (`null` reads
  #      safely via `// false`, but is still meaningless as a review state, so we treat it
  #      as corrupt too.)
  #   4. A multi-value JSON STREAM (`{...}\n{...}` — what a concurrent double-write or an
  #      interrupted `mv` leaves behind). Each top-level value is a legal object, so an
  #      UNSLURPED `jq -e 'type == "object"'` sets its exit status from the LAST value only
  #      and PASSES it (verified). Every read below then emits ONE LINE PER VALUE, so
  #      `HAS_CODE_CHANGE` becomes the literal "true\nfalse" and `[[ ... == "true" ]]` is
  #      FALSE — the gate never engages and an unreviewed edit stops the session (fail-OPEN).
  #      `-s` slurps the stream into an array so `length == 1` rejects both 0 values (empty
  #      input, already caught above) and 2+; `.[0]|type` then applies the object check to
  #      the single remaining value. Strictly stronger than the unslurped form.
  #      All four cases → force strict + assume changes exist, exactly like the .blocked
  #      sidecar. `${STATE//[[:space:]]/}` strips all whitespace; empty result ⇒ empty.
  STATE_CORRUPT=false
  if [[ -z "${STATE//[[:space:]]/}" ]] || ! jq -e -s 'length == 1 and (.[0]|type) == "object"' <<< "$STATE" >/dev/null 2>&1; then
    STATE_CORRUPT=true
    echo "[Stop Guard] Empty, unparseable, non-object, or multi-value review state — failing closed (strict)" >&2
    STATE="{}"
  fi

  # Beyond the top-level object guard: a VALID object can still carry malformed SCALAR fields that
  # the `// false` / `-r` reads below silently coerce, opening two fail-OPEN holes (Codex iter-14 P2).
  # (1) has_code_change:[] (or any non-boolean) → `jq -r '.has_code_change // false'` yields a
  # non-"true" string → reads as "no change" → the review-required path is skipped → the session STOPS
  # UNREVIEWED despite a real edit. (2) code_review.passed:"true" as a STRING → `jq -r` erases the
  # string/boolean distinction (both print "true") → a crafted string fakes a passed gate. Neither is
  # caught by the object guard above or the nested-parent guard below. So strictly TYPE-CHECK the
  # scalar fields: boolean for has_*_change and *.passed, string for review_phase; null/absent is fine
  # (the normal default). The `if (parent|type)=="object"` clauses mean a non-object nested parent
  # (code_review:"oops") is NOT re-flagged here — it stays fail-closed via the `2>/dev/null || echo
  # false` reads below — so this adds NO behavior change for that case, only closes the malformed-
  # scalar holes. Any mismatch → STATE_CORRUPT → the same strict + assume-changes posture as the
  # object guard. jq exits non-zero on mismatch (false under -e) OR on any runtime error → both are
  # inverted by `! jq -e` into fail-closed.
  # The DUAL-mode fields are validated the same way (Codex iter-15 P2): review_mode must be a string
  # (a corrupt `["dual"]` would downgrade dual→single via `.review_mode // "single"` and skip the
  # dual strict-force → fail-OPEN), and aggregate_gate.executed must be boolean with .gate a string —
  # a STRING `aggregate_gate.executed:"true"` otherwise reads through `jq -r ... // false` as executed
  # and, with gate "READY", fakes a passed dual gate → the unreviewed code change stops. Same
  # object-parent guard so a non-object aggregate_gate stays fail-closed via its own `|| echo` reads.
  if [[ "$STATE_CORRUPT" != "true" ]] && ! jq -e 'def _tv(t): (.==null) or (type==t); (.has_code_change|_tv("boolean")) and (.has_doc_change|_tv("boolean")) and (.review_phase|_tv("string")) and (.review_mode|_tv("string")) and (if (.code_review|type)=="object" then (.code_review.passed|_tv("boolean")) else true end) and (if (.doc_review|type)=="object" then (.doc_review.passed|_tv("boolean")) else true end) and (if (.precommit|type)=="object" then ((.precommit.passed|_tv("boolean")) and (.precommit.mode|_tv("string"))) else true end) and (if (.aggregate_gate|type)=="object" then ((.aggregate_gate.executed|_tv("boolean")) and (.aggregate_gate.gate|_tv("string"))) else true end)' <<< "$STATE" >/dev/null 2>&1; then
    STATE_CORRUPT=true
    echo "[Stop Guard] Review state has malformed field types (non-boolean has_*_change / *.passed / aggregate_gate.executed, or non-string review_phase / review_mode / aggregate_gate.gate) — failing closed (strict)" >&2
    STATE="{}"
  fi

  # NESTED reads (.code_review.passed etc.) fail closed on a type mismatch: the
  # top-level guard above only proves STATE is an object, so a crafted/corrupt
  # `{"code_review":"oops"}` (parent is a STRING) makes jq raise "Cannot index string
  # with \"passed\"" → exit 5. `// false` does NOT catch a runtime index error, and
  # under `set -euo pipefail` a bare `VAR=$(... )` assignment aborts the whole hook with
  # exit 5 — a non-0/2 status Claude Code treats as a NON-blocking error, so in strict
  # mode the session stops UNREVIEWED (fail-OPEN) — the exact class the corrupt guard
  # exists to close. `2>/dev/null || echo false` mirrors the plan_review read below
  # (line ~311): on any jq error the substitution yields "false" (exit 0), so the read
  # degrades to the safe default instead of killing the hook. The three top-level reads
  # (.has_code_change/.has_doc_change/.review_phase) index the guaranteed-object STATE
  # directly, so they cannot raise an index error and need no guard.
  CODE_REVIEW_PASSED=$(echo "$STATE" | jq -r '.code_review.passed // false' 2>/dev/null || echo false)
  # Snapshotted because dual mode overwrites CODE_REVIEW_PASSED with the AGGREGATE result below
  # (`CODE_REVIEW_PASSED="$DUAL_GATE_PASSED"`). That substitution is right for the gate decision and
  # wrong for the fact block: reporting `code_review:false` when the code review demonstrably passed
  # and only aggregation is outstanding points the reader at a review that is already done. The
  # receipt reports what was recorded; `pending` carries the aggregate obligation.
  CODE_RECEIPT_PERSISTED="$CODE_REVIEW_PASSED"
  DOC_REVIEW_PASSED=$(echo "$STATE" | jq -r '.doc_review.passed // false' 2>/dev/null || echo false)
  PRECOMMIT_PASSED=$(echo "$STATE" | jq -r '.precommit.passed // false' 2>/dev/null || echo false)
  # Which precommit variant produced that verdict. The writer only ever emits the closed enum
  # `full` / `fast` / `unknown`, so anything else in the file is tampered or corrupt: normalize it
  # to the empty string, which the opt-in gate below treats as unrecorded (fail-closed) and which
  # cannot carry characters that would break the JSON output.
  PRECOMMIT_MODE=$(echo "$STATE" | jq -r '.precommit.mode // ""' 2>/dev/null || echo "")
  case "$PRECOMMIT_MODE" in
    full|fast|unknown) ;;
    *) PRECOMMIT_MODE="" ;;
  esac
  HAS_CODE_CHANGE=$(echo "$STATE" | jq -r '.has_code_change // false')
  HAS_DOC_CHANGE=$(echo "$STATE" | jq -r '.has_doc_change // false')
  REVIEW_PHASE=$(echo "$STATE" | jq -r '.review_phase // "idle"')

  # Corrupt state → force strict + assume changes, BEFORE the sidecar/dual logic consumes
  # these values, so a garbage state cannot read as "all passed, nothing to review, stop-OK".
  # STATE="{}" already made the reads return safe defaults; this pins the fail-closed posture.
  #
  # DELIBERATE ASYMMETRY vs the sidecar: the git reconciliation below is NOT skipped for the
  # corrupt case (only the sidecar skips it). So on a genuinely CLEAN working tree the forced
  # HAS_*=true is relaxed back to false and the session may stop. That is correct — a clean
  # tree has nothing to review, and blocking it would WEDGE the session (nothing to fix, yet
  # cannot stop). The sidecar means a write definitely FAILED (an edit happened but went
  # unrecorded), so it DOES skip reconciliation and blocks even on a clean tree. Corrupt-state
  # only knows "the state is unreadable"; once git proves the tree clean there is genuinely
  # nothing to gate. On a DIRTY tree the forced flags survive reconciliation and the gate holds.
  if [[ "$STATE_CORRUPT" == "true" ]]; then
    GUARD_MODE="strict"
    CODE_REVIEW_PASSED="false"
    DOC_REVIEW_PASSED="false"
    PRECOMMIT_PASSED="false"
    DUAL_GATE_PASSED="false"
    # Force change flags true so a corrupt state cannot read as "nothing to review". The
    # timeout-bounded -uall reconciliation below relaxes these on a clean tree — but that path is
    # SKIPPED when neither timeout nor gtimeout exists (stock macOS ships neither). Leaving both
    # flags forced-true there would WEDGE a clean-tree session in strict mode forever: nothing to
    # fix yet unable to stop, and the corrupt file cannot self-heal (writers see it exists and
    # their jq updates fail). So when no timeout helper is available, probe cleanliness HERE with a
    # DEFAULT-mode porcelain — it does NOT do the -uall untracked recursion, so it is bounded
    # without a timeout helper (the very walk the invariant guards against is -uall's, not this).
    # CRITICAL: distinguish a SUCCESSFUL-but-empty status (provably clean → relax) from a FAILED
    # status (corrupt .git/config, not a repo, transient error → empty stdout that is NOT proof of
    # clean). A bare `[[ -n "$(git status ...)" ]]` conflates the two: a failed status yields "" →
    # reads as clean → the strict guard releases an unreviewed edit on an unverifiable tree
    # (fail-OPEN). So gate on the git EXIT STATUS: only a zero-exit empty output relaxes the flags;
    # a non-zero exit keeps them forced-true (fail closed). When a timeout helper DOES exist, defer
    # to the richer -uall reconciliation instead.
    if command -v timeout &>/dev/null || command -v gtimeout &>/dev/null; then
      HAS_CODE_CHANGE="true"
      HAS_DOC_CHANGE="true"
    else
      # No timeout helper (stock macOS ships neither). Probe with a DEFAULT-mode porcelain — it does
      # NOT do the -uall untracked recursion, so it is bounded without a timeout helper.
      # CRITICAL: `git status` exits 0 even when it could not open an UNREADABLE directory — it only
      # WARNS on stderr and OMITS that subtree. If the sole dirty reviewable file lives under such a
      # dir, a stderr-discarding probe sees empty stdout → reads "clean" → the strict guard would
      # release an unreviewed edit (fail-OPEN, Codex iter-19 P2). So capture stderr and treat a
      # directory-omission warning as unverifiable → hold (fail closed), the same "open directory"
      # signal run-verify.js rejects. Only a zero-exit, empty-stdout, warning-free probe relaxes.
      # LC_ALL=C pins the warning to git's untranslated English form the grep below matches — under a
      # non-English locale (e.g. this project's zh-TW hosts) git localizes it ("警告: 無法開啟目錄…"),
      # the English-only regex misses it, and an unreviewed edit is released (locale-dependent fail-OPEN).
      _probe_err="$(_gd_safe_tmpfile sg-probe-err)" || _probe_err=""
      if [[ -n "$_probe_err" ]] && _probe=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} LC_ALL=C git -C "$PWD" status --porcelain 2>"$_probe_err"); then
        if [[ -n "$_probe" ]] || grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_probe_err"; then
          HAS_CODE_CHANGE="true"
          HAS_DOC_CHANGE="true"
        else
          HAS_CODE_CHANGE="false"
          HAS_DOC_CHANGE="false"
        fi
      else
        # mktemp failed OR git status FAILED — the empty substitution is indistinguishable from a
        # clean tree, so we cannot prove clean → keep the forced flags true (fail closed).
        HAS_CODE_CHANGE="true"
        HAS_DOC_CHANGE="true"
      fi
      # Same P2 class as the derivation probe: an rm abort is a non-0/2 exit → fail-open.
      rm -f "$_probe_err" 2>/dev/null || true
    fi
  fi
fi

# WB5c P1 fix (Codex round-1): the state branch CLOSES here so the derivation below runs
# UNCONDITIONALLY. With the whole digest path nested inside `[[ -f "$STATE_FILE" ]]`, deleting
# (or never creating) the state file skipped the derivation entirely and dropped this stop to
# the 500-line transcript scan — the weakest reader in the file — which is exactly the trade a
# tampered or lost state file must not be able to buy. The state-only blocks (sidecar, dual,
# plan advisory, stale-git reconciliation) re-open under USE_STATE_FILE below, and a derived
# answer with no state file promotes itself past the transcript fallback after they close.
# The block keeps its original two-space indent; bash does not care and the diff stays readable.

  # === WB4/WB5c: check-time derivation (digest path authoritative) ===
  # deriveGates (§3.5) answers obligation from the dirty set and validity from
  # the newest verdict-bearing record for (plane, plane_digest). A derived
  # obligation replaces the stored has_*_change flags (both directions — the
  # dirty set IS the obligation, session provenance no longer scopes it), a
  # digest-closed gate marks its receipt passed, and an unresolved tombstone
  # forces its pair open whatever the mirror says (§4 — the veto is absolute).
  # WB5c closed the dual-read window: on a derivable tree a plane the digest
  # path cannot positively close is OPEN — the mirror is consulted for validity
  # only where no tree exists for a receipt to bind to (not-a-repo/unreadable
  # classification). Ordering is load-bearing: the SIDECAR and DUAL blocks below
  # run AFTER this one, so a write-failure marker still forces its plane open
  # over digest evidence (fail-closed) and the dual-mode aggregate branch stays
  # untouched. The no-state-file transcript fallback keeps its legacy scan.
  _GD_JSON=""
  if [[ -n "$_GD_SELF_DIR" && -f "$_GD_DERIVE" ]] && command -v node &>/dev/null; then
    _GD_JSON=$(node "$_GD_DERIVE" "$PWD" 2>/dev/null) || _GD_JSON=""
  fi
  if [[ -n "$_GD_JSON" ]] && jq -e '.v == 1 and (.planes | type == "object")' <<< "$_GD_JSON" >/dev/null 2>&1; then
    _GD_SOURCE="digest"
    while IFS= read -r _gd_report; do
      [[ -n "$_gd_report" ]] && echo "[Stop Guard] gate-derive: ${_gd_report}" >&2
    done < <(jq -r '.reports[]?' <<< "$_GD_JSON" 2>/dev/null || true)
    _GD_CODE_OWED=$(jq -r '.planes.code_review.owed' <<< "$_GD_JSON" 2>/dev/null || echo null)
    _GD_DOC_OWED=$(jq -r '.planes.doc_review.owed' <<< "$_GD_JSON" 2>/dev/null || echo null)
    if [[ ( "$_GD_CODE_OWED" == "true" || "$_GD_CODE_OWED" == "false" ) \
       && ( "$_GD_DOC_OWED" == "true" || "$_GD_DOC_OWED" == "false" ) ]]; then
      HAS_CODE_CHANGE="$_GD_CODE_OWED"
      HAS_DOC_CHANGE="$_GD_DOC_OWED"
      _GD_OBLIGATION_DERIVED=true
      _GD_ANSWERED=true
    else
      # Two underivable states with opposite dispositions (gate-derive P0-3):
      # outside a repo there is no tree this derivation could speak for — the
      # mirror keeps its authority. An 'unverifiable' tree EXISTS but could not
      # be read (warn-and-omit subtree, git error): it must not read as clean,
      # so both obligations are forced ON, fail-closed. The force fires only on
      # the EXPLICIT classifier value: gate-derive always emits one of
      # ok/not-a-repo/unverifiable, so any other reading here means the jq
      # layer, not git, degraded — that is dual-read infrastructure absence,
      # and the mirror (whose own reconciliation probes are fail-closed)
      # retains authority, said out loud.
      _GD_TREE=$(jq -r '.treeState // empty' <<< "$_GD_JSON" 2>/dev/null || echo "")
      if [[ "$_GD_TREE" == "unverifiable" ]]; then
        HAS_CODE_CHANGE="true"
        HAS_DOC_CHANGE="true"
        _GD_OBLIGATION_DERIVED=true
        _GD_ANSWERED=true
        # Obligation alone is not enough (R2-1): an unverifiable tree has
        # partial digests, so every validity branch below would fall back to
        # the stored *.passed values — and a stale mirror PASS describes a tree
        # this stop cannot prove is still the one that was reviewed. Invalidate
        # every receipt too, and pin the dual aggregate (sidecar precedent) so
        # the recompute cannot restore it.
        CODE_REVIEW_PASSED="false"
        CODE_RECEIPT_PERSISTED="false"
        DOC_REVIEW_PASSED="false"
        PRECOMMIT_PASSED="false"
        DUAL_GATE_PASSED="false"
        _GD_TREE_UNVERIFIABLE=true
        echo "[Stop Guard] gate-derive: tree unverifiable — obligations forced on and every receipt invalidated for this stop (fail-closed)" >&2
      elif [[ "$_GD_TREE" == "not-a-repo" ]]; then
        echo "[Stop Guard] gate-derive: obligation underivable (not a git repository) — stored change flags retained (dual-read)" >&2
      else
        echo "[Stop Guard] gate-derive: obligation unreadable (treeState='${_GD_TREE}') — stored change flags retained (dual-read)" >&2
      fi
    fi
    _GD_VETO=$(jq -r '.planes.code_review.veto' <<< "$_GD_JSON" 2>/dev/null || echo true)
    _GD_CLOSED=$(jq -r '.planes.code_review.closedByDigest' <<< "$_GD_JSON" 2>/dev/null || echo false)
    _GD_AFAIL=$(jq -r '.planes.code_review.authoritativeFail' <<< "$_GD_JSON" 2>/dev/null || echo false)
    if [[ "$_GD_VETO" == "true" || "$_GD_AFAIL" == "true" ]]; then
      CODE_REVIEW_PASSED="false"
      CODE_RECEIPT_PERSISTED="false"
      # Pin the dual aggregate too (sidecar precedent): the dual recompute
      # below skips when DUAL_GATE_PASSED is already "false", so without this
      # pin a READY aggregate would overwrite the forced-open gate value.
      DUAL_GATE_PASSED="false"
      if [[ "$_GD_VETO" == "true" ]]; then
        echo "[Stop Guard] gate-derive: unresolved tombstone stands against code_review — gate forced open (§4 veto, absolute)" >&2
      else
        echo "[Stop Guard] gate-derive: authoritative digest negative for code_review — gate forced open, mirror not consulted" >&2
      fi
    elif [[ "$_GD_CLOSED" == "true" ]]; then
      CODE_REVIEW_PASSED="true"
      CODE_RECEIPT_PERSISTED="true"
    elif [[ "$_GD_OBLIGATION_DERIVED" == "true" && "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      # WB5c (§3.6): the dual-read window is closed. On a derivable tree a plane the digest path
      # cannot positively close is OPEN — the mirror is advisory and is not consulted for
      # validity. (An unverifiable tree already invalidated every receipt above; not-a-repo
      # keeps the mirror below, since no tree exists for a digest receipt to bind to.)
      CODE_REVIEW_PASSED="false"
      CODE_RECEIPT_PERSISTED="false"
      [[ "$HAS_CODE_CHANGE" == "true" ]] \
        && echo "[Stop Guard] gate-derive: no digest receipt closes code_review at the current tree — gate open (mirror retired)" >&2
    elif [[ "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      # not-a-repo / unreadable classifier: the mirror keeps its legacy authority, said in the
      # fact line via mirror_planes.
      _GD_FALLBACK_PLANES="code_review"
    fi
    _GD_VETO=$(jq -r '.planes.doc_review.veto' <<< "$_GD_JSON" 2>/dev/null || echo true)
    _GD_CLOSED=$(jq -r '.planes.doc_review.closedByDigest' <<< "$_GD_JSON" 2>/dev/null || echo false)
    _GD_AFAIL=$(jq -r '.planes.doc_review.authoritativeFail' <<< "$_GD_JSON" 2>/dev/null || echo false)
    if [[ "$_GD_VETO" == "true" || "$_GD_AFAIL" == "true" ]]; then
      DOC_REVIEW_PASSED="false"
      if [[ "$_GD_VETO" == "true" ]]; then
        echo "[Stop Guard] gate-derive: unresolved tombstone stands against doc_review — gate forced open (§4 veto, absolute)" >&2
      else
        echo "[Stop Guard] gate-derive: authoritative digest negative for doc_review — gate forced open, mirror not consulted" >&2
      fi
    elif [[ "$_GD_CLOSED" == "true" ]]; then
      DOC_REVIEW_PASSED="true"
    elif [[ "$_GD_OBLIGATION_DERIVED" == "true" && "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      DOC_REVIEW_PASSED="false"
      [[ "$HAS_DOC_CHANGE" == "true" ]] \
        && echo "[Stop Guard] gate-derive: no digest receipt closes doc_review at the current tree — gate open (mirror retired)" >&2
    elif [[ "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      _GD_FALLBACK_PLANES="${_GD_FALLBACK_PLANES}${_GD_FALLBACK_PLANES:+,}doc_review"
    fi
    _GD_VETO=$(jq -r '.planes.precommit.veto' <<< "$_GD_JSON" 2>/dev/null || echo true)
    _GD_CLOSED=$(jq -r '.planes.precommit.closedByDigest' <<< "$_GD_JSON" 2>/dev/null || echo false)
    _GD_AFAIL=$(jq -r '.planes.precommit.authoritativeFail' <<< "$_GD_JSON" 2>/dev/null || echo false)
    if [[ "$_GD_VETO" == "true" || "$_GD_AFAIL" == "true" ]]; then
      PRECOMMIT_PASSED="false"
      if [[ "$_GD_VETO" == "true" ]]; then
        echo "[Stop Guard] gate-derive: unresolved tombstone stands against precommit — gate forced open (§4 veto, absolute)" >&2
      else
        echo "[Stop Guard] gate-derive: authoritative digest negative for precommit — gate forced open, mirror not consulted" >&2
      fi
    elif [[ "$_GD_CLOSED" == "true" ]]; then
      PRECOMMIT_PASSED="true"
      # gate-derive already enforced mode_ok (incl. PRECOMMIT_REQUIRE_FULL), so
      # the derived mode replaces the mirror's — otherwise the REQUIRE_FULL
      # re-check below would judge digest evidence by the mirror's stale mode.
      _GD_PC_MODE=$(jq -r '.planes.precommit.mode // ""' <<< "$_GD_JSON" 2>/dev/null || echo "")
      case "$_GD_PC_MODE" in
        full|fast) PRECOMMIT_MODE="$_GD_PC_MODE" ;;
      esac
    elif [[ "$_GD_OBLIGATION_DERIVED" == "true" && "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      PRECOMMIT_PASSED="false"
      [[ "$HAS_CODE_CHANGE" == "true" ]] \
        && echo "[Stop Guard] gate-derive: no digest receipt closes precommit at the current tree — gate open (mirror retired)" >&2
    elif [[ "$_GD_TREE_UNVERIFIABLE" != "true" ]]; then
      _GD_FALLBACK_PLANES="${_GD_FALLBACK_PLANES}${_GD_FALLBACK_PLANES:+,}precommit"
    fi
  else
    # WB5c (§3.6): the dual-read window is closed — the mirror no longer stands in for an
    # unavailable derivation. WB5b retired the stored change flags, so in this branch the mirror
    # reads false-everything and "mirror only" would silently allow every stop: the exact
    # fail-open window this flip exists to close. git itself can still answer the obligation
    # half without node: a dirty (or unverifiable) tree forces every gate open with receipts
    # invalidated, exactly like treeState=unverifiable; only a provably clean tree — or no
    # repository at all, where no tree exists to gate — leaves nothing owed. Same probe
    # discipline as the corrupt-state branch above: zero-exit + empty stdout + no omitted-dir
    # warning is the only reading accepted as clean (LC_ALL=C pins the warning's English form).
    # P1 fix (Codex round-1): the probe must resolve THE SAME repository the digest path would
    # have — tree-digest.js strips the whole GIT_* namespace (cleanGitEnv) and pins every call
    # with `-C repoRoot`. Without that fence an ambient GIT_DIR/GIT_WORK_TREE redirect points
    # this probe at some other, cleaner repository and a dirty workspace reads as provably
    # clean (measured: exit 0, empty porcelain, the real dirty entries invisible). The shared
    # _GD_GIT_FENCE above carries the namespace strip; round-2 hoisted it so the corrupt-state
    # probe and the stale-git reconciliation run under the exact same posture.
    # Exit status alone is NOT the repo test: `--is-inside-work-tree` prints `false` and exits 0
    # from inside a .git directory (and under some redirects), so require stdout exactly `true`.
    _gd_fb_inwt=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} git -C "$PWD" rev-parse --is-inside-work-tree 2>/dev/null) || _gd_fb_inwt=""
    if [[ "$_gd_fb_inwt" == "true" ]]; then
      # Only the probe branch is marked 'unavailable': its answers come from git, not the state
      # file, and the fact line must say so. The proven-no-repo branch below keeps
      # _GD_SOURCE="mirror" because there the state file genuinely is the authority —
      # source=state_file stays honest.
      _GD_SOURCE="unavailable"
      _GD_ANSWERED=true
      # The probe OWNS the obligation answer, same as the derivation (P1 fix, second half):
      # without this the stale-git reconciliation below — an UNFENCED `git status -uall` —
      # would re-read the redirected repository and downgrade the fail-closed flags to false.
      _GD_OBLIGATION_DERIVED=true
      _gd_fb_err="$(_gd_safe_tmpfile sg-probe-err)" || _gd_fb_err=""
      _gd_fb_dirty="unknown"
      if [[ -n "$_gd_fb_err" ]] && _gd_fb=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} LC_ALL=C git -C "$PWD" status --porcelain 2>"$_gd_fb_err"); then
        if [[ -z "$_gd_fb" ]] \
           && ! grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_gd_fb_err"; then
          _gd_fb_dirty="false"
        else
          _gd_fb_dirty="true"
        fi
      fi
      # `|| true` (P2 fix): a plain `rm -f` abort here would kill the hook under `set -e` with a
      # non-0/2 status the harness reads as "no objection" — fail-open on the fail-closed branch.
      rm -f "$_gd_fb_err" 2>/dev/null || true
      if [[ "$_gd_fb_dirty" == "false" ]]; then
        HAS_CODE_CHANGE="false"
        HAS_DOC_CHANGE="false"
        echo "[Stop Guard] gate derivation unavailable — tree provably clean, nothing owed this stop (run /install-scripts if scripts/lib/gate-derive.js is missing)" >&2
      else
        HAS_CODE_CHANGE="true"
        HAS_DOC_CHANGE="true"
        CODE_REVIEW_PASSED="false"
        CODE_RECEIPT_PERSISTED="false"
        DOC_REVIEW_PASSED="false"
        PRECOMMIT_PASSED="false"
        DUAL_GATE_PASSED="false"
        echo "[Stop Guard] gate derivation unavailable on a tree that is not provably clean — obligations forced on and receipts invalidated (fail-closed; mirror retired; run /install-scripts if scripts/lib/gate-derive.js is missing)" >&2
      fi
    else
      # rev-parse refused, or answered anything but `true`. Positive-evidence classification,
      # mirroring gate-derive.js's not-a-repo test (error message + lstat ENOENT on .git): only
      # a PROVEN absence of any `.git` entry from $PWD up to / keeps the mirror's authority. A
      # corrupt repository, a broken git binary, or a cwd inside a .git directory all leave a
      # tree that may carry unreviewed edits — unverifiable is not clean (fail-closed, exactly
      # like treeState=unverifiable). `-e || -L` keeps a broken .git symlink counted as present,
      # matching the classifier's lstat semantics.
      # Parameter expansion, not `dirname` — the file's standing rule: a fail-closed path must
      # not abort at 127 on a host (or curated test PATH) without the helper binary.
      _gd_fb_gitdir="false"
      _gd_fb_walk="$PWD"
      while :; do
        if [[ -e "$_gd_fb_walk/.git" || -L "$_gd_fb_walk/.git" ]]; then
          _gd_fb_gitdir="true"
          break
        fi
        _gd_fb_next="${_gd_fb_walk%/*}"
        [[ -z "$_gd_fb_next" ]] && _gd_fb_next="/"
        [[ "$_gd_fb_next" == "$_gd_fb_walk" ]] && break
        _gd_fb_walk="$_gd_fb_next"
      done
      if [[ "$_gd_fb_gitdir" == "true" ]]; then
        _GD_SOURCE="unavailable"
        _GD_ANSWERED=true
        _GD_OBLIGATION_DERIVED=true
        HAS_CODE_CHANGE="true"
        HAS_DOC_CHANGE="true"
        CODE_REVIEW_PASSED="false"
        CODE_RECEIPT_PERSISTED="false"
        DOC_REVIEW_PASSED="false"
        PRECOMMIT_PASSED="false"
        DUAL_GATE_PASSED="false"
        echo "[Stop Guard] gate derivation unavailable and git cannot read the tree a .git entry proves exists — obligations forced on and receipts invalidated (fail-closed)" >&2
      else
        # Same disposition as the derivation's own not-a-repo classification: outside a
        # repository there is no tree for a digest receipt to bind to, so the mirror keeps its
        # legacy authority — here that authority is whatever the state file still says.
        echo "[Stop Guard] gate derivation unavailable outside a git repository — mirror keeps its legacy authority (no tree to gate)" >&2
      fi
    fi
  fi

# === State-file-only blocks re-open here (sidecar / dual / plan advisory / stale-git) ===
# They consume the mirror's own records and sidecar markers, which only exist when a state file
# does; for the no-state case the derivation above has already spoken, and the promotion block
# after this region decides whether its answer or the transcript fallback governs.
if [[ "$USE_STATE_FILE" == "true" ]]; then
  # === Sidecar fail-closed marker (race-safe lock-failure signal) ===
  # The fail-closed GATE VALUES below always apply — a sidecar means this update did not land, so
  # no verdict in the JSON can be trusted. Whether it also ESCALATES the user's guard mode depends
  # on the reason: the transient allowlist below is a CLOSED, default-deny set. Classification
  # rationale, per-marker ownership, and retirement:
  # docs/features/auto-loop-evolution/4-implementation.md §3.5–§3.6.
  SIDECAR_ESCALATE=false
  # Reset OUTSIDE the conditional. With no sidecar the block below never runs, and an inherited
  # environment value of either name would then reach the routing block and fabricate an obligation
  # out of nothing. `${x:-}` prevents the `set -u` abort but not this.
  _SIDECAR_RAW=""
  _SIDECAR_EVENT_PRESENT=false
  if _sidecar_any; then
    # The marker file holds a SET of reasons, one per LINE — writers append their own, so classify
    # transient only when EVERY line is transient. Why the reads use `cat` (a shell redirection
    # aborts the hook under `set -euo pipefail` and fails OPEN at the worst moment) and why they
    # bypass `_sidecar_read_all`: see docs/features/auto-loop-evolution/4-implementation.md §3.8.
    _SIDECAR_READABLE=true
    # `_sidecar_is_marker`, not a bare `-f`, and the same test `_sidecar_any` uses to decide there
    # is anything here at all. A bare `-f` follows symlinks, so the two would disagree exactly when
    # it matters: `_sidecar_any` rejects a planted link and reports "no sidecar", while this loop
    # would follow it and splice an arbitrary file's bytes into the reason set.
    if _sidecar_is_marker "${STATE_FILE}.blocked"; then
      _sc_part=$(cat -- "${STATE_FILE}.blocked" 2>/dev/null) || { _SIDECAR_READABLE=false; _sc_part=""; }
      _SIDECAR_RAW="$_sc_part"
    fi
    # Reasons merge into one set (they classify identically); PRESENCE on this plane is tracked
    # separately because retirement is a property of the PLANE, not of the reason. Every writer's
    # clear is hard-coded to the shared file, so any `.blocked.event.*` marker — whatever it says,
    # even if empty or unreadable — is retired only by session-init's orphan sweep. Hence the flag
    # is raised before the read can fail: an unreadable marker is no more dischargeable than a
    # legible one. See post-tool-review-state.sh § "Retirement is deliberately coarse".
    for _sc_f in "${SIDECAR_EVENT_PREFIX}"*; do
      _sidecar_is_marker "$_sc_f" || continue
      _SIDECAR_EVENT_PRESENT=true
      _sc_part=$(cat -- "$_sc_f" 2>/dev/null) || { _SIDECAR_READABLE=false; continue; }
      _SIDECAR_RAW="${_SIDECAR_RAW}${_SIDECAR_RAW:+$'\n'}${_sc_part}"
    done
    # Parameter expansion, NOT `tr | sed` — same reasoning as `_json_safe` below: this whole
    # branch exists BECAUSE a blocking verdict was lost, and under `set -euo pipefail` a host
    # whose PATH lacks either helper would abort the hook at 127 with no JSON, which the harness
    # reads as "no objection". The most fail-closed branch in the file must not depend on an
    # external binary to render a diagnostic string. Semantics are preserved exactly: replace
    # every newline, then strip at most ONE trailing comma (what `s/,$//` does).
    SIDECAR_REASON="${_SIDECAR_RAW//$'\n'/,}"
    SIDECAR_REASON="${SIDECAR_REASON%,}"
    [[ -n "$SIDECAR_REASON" ]] || SIDECAR_REASON="unknown"
    _SIDECAR_ALL_TRANSIENT=true
    # Seen-counter, NOT just the flag. The loop below can only DEMOTE `_SIDECAR_ALL_TRANSIENT`, so
    # a marker with zero readable reasons — a zero-byte file, a newline-only file, or one this
    # process cannot read — would leave the flag at its `true` initializer and take the *transient*
    # branch. That is the exact opposite of the rule the comment block above states: an empty or
    # unreadable marker is `unknown`, and unknown must default-deny. The window is real, not
    # theoretical: `_set_own_sidecar` appends with `>>`, so a writer that creates the file and is
    # interrupted (or hits ENOSPC) before its reason lands leaves precisely a zero-byte marker —
    # written *because* a verdict was lost, then classified as the mildest possible state.
    _SIDECAR_LINES_SEEN=0
    # `|| [[ -n "$_sc_line" ]]`: a sidecar written without a trailing newline (every pre-set
    # single-reason file, and any hand-written one) leaves `read` returning non-zero on the LAST
    # line, which would drop the only reason present and classify the marker as all-transient.
    while IFS= read -r _sc_line || [[ -n "$_sc_line" ]]; do
      [[ -n "$_sc_line" ]] || continue
      _SIDECAR_LINES_SEEN=$((_SIDECAR_LINES_SEEN + 1))
      case "$_sc_line" in
        # Keyed by the plane that wrote it (post-edit-format.sh `_EDIT_PLANE`). A BARE
        # `edit_lock_contention` carries no plane, so this version cannot tell which gate it
        # stands for — it falls through to `*)` and escalates, consistent with the
        # unknown-marker rule rather than being grandfathered into the mild branch.
        edit_lock_contention:code|edit_lock_contention:doc|lock_failure) ;;
        *) _SIDECAR_ALL_TRANSIENT=false ;;
      esac
    done <<< "$_SIDECAR_RAW"
    # Zero readable reasons — empty file, newline-only file, or one this process cannot open — is
    # `unknown`, and unknown default-denies. `_SIDECAR_READABLE` is checked as well as the counter
    # because they are different facts: an unreadable file yields zero lines here, but so does an
    # empty one, and only the counter would be left to distinguish "nothing was written" from
    # "something was written and we cannot see it". Both escalate, and saying so twice costs
    # nothing next to the one that does not.
    if [[ "$_SIDECAR_LINES_SEEN" -eq 0 || "$_SIDECAR_READABLE" != "true" ]]; then
      _SIDECAR_ALL_TRANSIENT=false
    fi
    if [[ "$_SIDECAR_ALL_TRANSIENT" == "true" ]]; then
      echo "[Stop Guard] Sidecar blocked marker found (reason: $SIDECAR_REASON) — transient, fail-closed gates in ${GUARD_MODE} mode" >&2
    else
      SIDECAR_ESCALATE=true
      GUARD_MODE="strict"
      echo "[Stop Guard] Sidecar blocked marker found (reason: $SIDECAR_REASON) — unverifiable state, escalating to strict" >&2
    fi
    # Force EVERY gate to BLOCKED regardless of JSON state — the same four the STATE_CORRUPT branch
    # forces, for the same reason.
    #
    # Forcing only the aggregate and doc gates was not merely incomplete; it demanded the WRONG gate
    # and then made the demand unsatisfiable. A `verdict_write_failed:precommit` marker is written
    # exactly when a blocking precommit FAIL was lost over a stale `passed=true`, yet precommit was
    # left standing, so the hook reported "Missing steps: /codex-review-fast". And
    # `_clear_own_sidecar` (post-tool-review-state.sh) is keyed per gate: only a successful
    # `precommit` write retires a `:precommit` marker. Running the demanded code review therefore
    # cleared nothing and the hook re-demanded it on the next Stop — a livelock the user could only
    # escape by independently guessing that `/precommit` was the gate actually at issue.
    #
    # This direction is fail-CLOSED either way; the bug was in WHICH gate it closed.
    CODE_REVIEW_PASSED="false"
    DOC_REVIEW_PASSED="false"
    PRECOMMIT_PASSED="false"
    DUAL_GATE_PASSED="false"
    # Fail-closed: sidecar means state may be corrupted, assume changes exist
    [[ "$HAS_CODE_CHANGE" != "true" && "$HAS_DOC_CHANGE" != "true" ]] && { HAS_CODE_CHANGE="true"; HAS_DOC_CHANGE="true"; }
  fi

  # === Dual mode: prefer aggregate_gate + force strict blocking ===
  # An UNRECOGNIZED review_mode is not a typo to be shrugged off — `"duel"` fails every
  # `== "dual"` test below, so it silently downgrades dual→single: no strict escalation, and the
  # aggregate BLOCKED verdict stops being consulted. The type guard above only proved it is a
  # string. Treat any non-enum value as the SAFE member (dual) rather than the lax default, and
  # say so, so a corrupted or hand-edited field cannot buy a weaker gate.
  REVIEW_MODE=$(echo "$STATE" | jq -r '.review_mode // "single"')
  if [[ "$REVIEW_MODE" != "single" && "$REVIEW_MODE" != "dual" ]]; then
    echo "[Stop Guard] Unrecognized review_mode ($REVIEW_MODE) — treating as dual (fail-closed)" >&2
    REVIEW_MODE="dual"
  fi
  # Mode policy is INDEPENDENT of gate computation: opting into dual review opts into strict
  # blocking, full stop. Hoisted out of the recompute branch below because that branch is
  # skipped when the sidecar has already pinned DUAL_GATE_PASSED=false — which used to drop
  # the dual-mode strict policy on exactly the sessions that most needed it.
  [[ "$REVIEW_MODE" == "dual" ]] && GUARD_MODE="strict"
  # Skip recompute if sidecar already set DUAL_GATE_PASSED (sidecar is authoritative)
  if [[ "$REVIEW_MODE" == "dual" && "${DUAL_GATE_PASSED:-}" != "false" ]]; then
    # Same nested-read fail-closed guard as the .code_review.passed reads above: a
    # crafted `.aggregate_gate` of a non-object type would exit-5 the hook (fail-OPEN)
    # without the `2>/dev/null || echo …` fallback. On error AGG_EXECUTED→false and
    # AGG_GATE→"" (empty ≠ READY) → DUAL_GATE_PASSED stays false (fail-closed).
    AGG_EXECUTED=$(echo "$STATE" | jq -r '.aggregate_gate.executed // false' 2>/dev/null || echo false)
    AGG_GATE=$(echo "$STATE" | jq -r '.aggregate_gate.gate // empty' 2>/dev/null || echo "")
    if [[ "$AGG_EXECUTED" == "true" ]]; then
      DUAL_GATE_PASSED=$([[ "$AGG_GATE" == "READY" ]] && echo "true" || echo "false")
    else
      DUAL_GATE_PASSED="false"  # fail-closed: aggregation incomplete
    fi
    # In dual mode, aggregate_gate overrides individual code_review
    CODE_REVIEW_PASSED="$DUAL_GATE_PASSED"
    if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
      echo "[Debug] Dual mode: AGG_EXECUTED=$AGG_EXECUTED, AGG_GATE=$AGG_GATE, DUAL_GATE_PASSED=$DUAL_GATE_PASSED" >&2
    fi
  elif [[ "${DUAL_GATE_PASSED:-}" == "false" ]]; then
    # Sidecar-forced BLOCKED: propagate to CODE_REVIEW_PASSED. The gate value is always
    # forced (the sidecar proves the verdict is untrustworthy); the MODE escalation reuses
    # the reason classification decided in the sidecar block above, so a transient lock race
    # cannot re-escalate here after being classified transient there.
    [[ "${SIDECAR_ESCALATE:-false}" == "true" ]] && GUARD_MODE="strict"
    CODE_REVIEW_PASSED="false"
    if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
      echo "[Debug] Sidecar override: DUAL_GATE_PASSED=false (sidecar authoritative)" >&2
    fi
  fi

  if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
    echo "[Debug] Using state file mode" >&2
    echo "[Debug] REVIEW_MODE=$REVIEW_MODE" >&2
    echo "[Debug] CODE_REVIEW_PASSED=$CODE_REVIEW_PASSED" >&2
    echo "[Debug] PRECOMMIT_PASSED=$PRECOMMIT_PASSED" >&2
  fi

  # === Plan-review pending advisory (T4 — warn-only, isolated) ===
  # plan_review is an analysis-only, skill-driven pre-ExitPlanMode flow, NOT a
  # precommit-style hard gate: a pending plan review warns on stderr but never
  # joins MISSING/BLOCKED_REASON and never feeds the code/doc aggregate decision.
  # status_reason "needs-human" marks the NEEDS_HUMAN terminal outcome (user is
  # already arbitrating) — excluded so it is not misread as an in-progress review.
  PLAN_PENDING=$(echo "$STATE" | jq -r 'if ((.plan_review.executed // false) == true) and ((.plan_review.passed // false) != true) and ((.plan_review.degraded // false) != true) and ((.plan_review.skipped // false) != true) and ((.plan_review.status_reason // "") != "needs-human") then "true" else "false" end' 2>/dev/null) || PLAN_PENDING="false"
  if [[ "$PLAN_PENDING" == "true" ]]; then
    echo "[Stop Guard] Plan review in progress (warn-only; isolated from code/doc gates)" >&2
  fi

  # === Stale-state git check (with cross-platform timeout) ===
  # Reconciliation is ONE-WAY (true→false) so it only matters when a flag is true; skip the
  # git call entirely otherwise. -uall walks the full untracked tree and can be costly, so it
  # MUST be bounded: run only under timeout/gtimeout. When neither helper exists we cannot
  # bound the walk, so we skip (fail-closed: keep flags → gate stays engaged) rather than risk
  # an unbounded hang. Sidecar present → also skip (would undo the fail-closed HAS_* forcing).
  if [[ "$HAS_CODE_CHANGE" != "true" && "$HAS_DOC_CHANGE" != "true" ]]; then
    GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  elif _sidecar_any; then
    # Sidecar present → skip stale-state reconciliation (would undo fail-closed HAS_* forcing)
    GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  elif command -v timeout &>/dev/null || command -v gtimeout &>/dev/null || command -v perl &>/dev/null; then
    # Bounded -uall reconciliation. This is the PRIMARY gate path (runs on every recorded edit), so it
    # must not fail open on an incomplete listing. `git status` exits 0 even when it could not open an
    # UNREADABLE dir — it only WARNS on stderr and OMITS that subtree. If the sole dirty reviewable file
    # lives under it, GIT_PORCELAIN misses it and the ONE-WAY downgrade below clears HAS_*_CHANGE → an
    # unreviewed edit is released in strict mode (fail-OPEN, iter-20 P1). Capture stderr and, on a
    # directory-omission warning, mark the listing UNAVAILABLE so the downgrade is skipped (flags
    # preserved → fail closed). LC_ALL=C pins the warning to git's untranslated English form the regex
    # matches — a zh-TW host emits "警告: 無法開啟目錄…", which an ambient-locale probe would miss. If
    # mktemp itself fails we cannot capture stderr → also hold (unverifiable ≠ clean).
    # Round-2 P1: every arm runs under the shared _GD_GIT_FENCE with `-C "$PWD"` — an ambient
    # GIT_DIR redirect must not let a listing from some OTHER repo downgrade a held obligation
    # (fenced, a non-repo cwd makes git FAIL → __GIT_UNAVAILABLE__ → flags kept, fail-closed).
    _recon_err="$(_gd_safe_tmpfile sg-recon-err)" || _recon_err=""
    if [[ -z "$_recon_err" ]]; then
      GIT_PORCELAIN="__GIT_UNAVAILABLE__"
    else
      if command -v timeout &>/dev/null; then
        GIT_PORCELAIN=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} LC_ALL=C timeout 5 git -C "$PWD" status --porcelain -uall 2>"$_recon_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      elif command -v gtimeout &>/dev/null; then
        GIT_PORCELAIN=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} LC_ALL=C gtimeout 5 git -C "$PWD" status --porcelain -uall 2>"$_recon_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      else
        # Stock macOS ships neither timeout nor gtimeout. perl's alarm+exec bounds the -uall walk
        # identically (the timer survives exec; SIGALRM's default action kills git → non-zero exit
        # → UNAVAILABLE), mirroring session-init.sh's _capture_baseline. Without this tier the
        # PRIMARY reconciliation path never ran on such hosts: a stale has_*_change survived a
        # revert or external commit and kept the stop gate demanding a review of nothing.
        GIT_PORCELAIN=$(env ${_GD_GIT_FENCE[@]+"${_GD_GIT_FENCE[@]}"} LC_ALL=C perl -e 'alarm 5; exec @ARGV or exit 127' git -C "$PWD" status --porcelain -uall 2>"$_recon_err") || GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      fi
      if grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_recon_err"; then
        GIT_PORCELAIN="__GIT_UNAVAILABLE__"
      fi
      rm -f "$_recon_err" 2>/dev/null || true
    fi
  else
    # No timeout helper → cannot bound the -uall walk → skip (fail-closed: trust state flags)
    GIT_PORCELAIN="__GIT_UNAVAILABLE__"
  fi
  if [[ "$GIT_PORCELAIN" != "__GIT_UNAVAILABLE__" ]]; then
    # Strip porcelain quoting (git quotes filenames with spaces/unicode).
    #
    # Parameter expansion, NOT `sed` — and here the fail-open is worse than the one `_json_safe`
    # guards against, because it does not need the hook to die to happen. `|| true` on a missing
    # `sed` yields an EMPTY clean list, which this reconciliation reads as "git sees no matching
    # files" and uses to downgrade has_code_change true→false: the gate would be cleared by the
    # absence of a binary. Under bare `set -e` the 127 kills the hook instead — no JSON, stop
    # allowed. Both directions are fail-open, so the dependency is removed rather than handled.
    # Semantics preserved exactly: per line, drop a leading `XX "` (2 status chars, space, quote)
    # when present, then strip at most one trailing quote — unconditionally, as `s/"$//` does.
    GIT_PORCELAIN_CLEAN=""
    while IFS= read -r _pline; do
      if [[ "$_pline" == ??\ \"* ]]; then
        _pline="${_pline:4}"
      fi
      _pline="${_pline%\"}"
      GIT_PORCELAIN_CLEAN="${GIT_PORCELAIN_CLEAN}${GIT_PORCELAIN_CLEAN:+$'\n'}${_pline}"
    done <<< "$GIT_PORCELAIN"
    # Stale-state reconciliation is ONE-WAY: only true→false.
    # NOTE: git status above uses -uall (all untracked, incl. files inside newly-created
    # dirs) so a brand-new untracked code/doc file is NOT falsely downgraded true→false.
    # The prior -uno hid untracked files, silently clearing the gate for new files.
    # We can safely override has_*_change from true to false when git status
    # shows no matching files — the state file was set in a prior edit that
    # has since been reverted or committed.
    # The reverse (false→true) is NOT done because it would cause false
    # positives: a file might exist in the worktree but was never edited by
    # the current session (e.g., pre-existing untracked files). The state
    # file's false→true transition is handled by post-tool-review-state.sh
    # at edit time, which has the correct session context.
    # WB4: skipped entirely when the derivation above already answered
    # obligation — its planeOf() classification is the §3.5 contract (every
    # non-.md/.mdx file is code), while the extension lists below miss e.g. a
    # dirty package.json and would downgrade a derived true back to false.
    if [[ "$HAS_CODE_CHANGE" == "true" && "$_GD_OBLIGATION_DERIVED" != "true" ]]; then
      # Use a here-string (not echo | grep) so grep -q's early-exit on match cannot
      # SIGPIPE the writer: under `set -o pipefail`, a large -uall output piped into
      # `grep -q` lets grep close the pipe early, killing echo (exit 141), which would
      # flip the pipeline non-zero and falsely downgrade HAS_CODE_CHANGE.
      if ! grep -qE '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)($|[[:space:]]|")' <<< "$GIT_PORCELAIN_CLEAN"; then
        HAS_CODE_CHANGE="false"
        if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
          echo "[Debug] Stale has_code_change overridden to false (no code in git status)" >&2
        fi
      fi
    fi
    # Override stale has_doc_change if no doc files in worktree
    if [[ "$HAS_DOC_CHANGE" == "true" && "$_GD_OBLIGATION_DERIVED" != "true" ]]; then
      if ! grep -qE '\.(md|mdx)($|[[:space:]]|")' <<< "$GIT_PORCELAIN_CLEAN"; then
        HAS_DOC_CHANGE="false"
        if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
          echo "[Debug] Stale has_doc_change overridden to false (no docs in git status)" >&2
        fi
      fi
    fi
  fi
  # If git unavailable → fail-open, trust state file
fi

# === WB5c P1 fix: a derived answer outranks the transcript fallback ===
# The legacy scan below exists for hosts with NO state file and NO derivation — grep inference
# over a 500-line window. When the derivation (or its git probe) positively answered this stop,
# that answer must govern: falling through would let deleting the state file trade digest
# evidence for the weakest reader in the file. Promotion, not a third branch, so the MISSING
# evaluation and fact emitter read the derived values through the exact code path the
# state-file case already exercises; the fact line stays honest because _GD_SOURCE is always
# digest or git_probe whenever _GD_ANSWERED is true. not-a-repo and jq-layer degradation leave
# _GD_ANSWERED false and keep the legacy transcript scan.
if [[ "$USE_STATE_FILE" == "false" && "$_GD_ANSWERED" == "true" ]]; then
  USE_STATE_FILE=true
  STATE="{}"
  echo "[Stop Guard] no state file, but the gate derivation answered this stop — evaluating derived receipts instead of the transcript fallback" >&2
fi

# === Fallback: Read transcript content (limited scan range) ===
if [[ "$USE_STATE_FILE" == "false" ]]; then
  # Only read last 500 lines to avoid performance issues
  CONVERSATION=$(tail -500 "$TRANSCRIPT" 2>/dev/null || echo "")

  # Check change types
  HAS_CODE_CHANGE=$(echo "$CONVERSATION" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)"' | grep -E '"(Edit|Write|NotebookEdit)"' | head -1 || true)
  HAS_DOC_CHANGE=$(echo "$CONVERSATION" | grep -E '\.(md|mdx)"' | grep -E '"(Edit|Write)"' | head -1 || true)

  # Check if required commands were executed
  #
  # The trailing boundary is "not a command-name character", NOT whitespace. `$CONVERSATION` is a
  # JSONL transcript, where an invocation that is the whole message renders as `"/precommit"` and a
  # expanded one as `<command-name>/precommit</command-name>` — in both, the next byte is `"` or
  # `<`, so the old `($|[[:space:]])` matched neither and the fallback concluded the command had
  # never run. Nothing detected the invocation, MISSING stayed populated, and strict mode wedged on
  # a session that had in fact passed every gate. The class still excludes `-` and alphanumerics, so
  # `/codex-review-doc` continues NOT to satisfy the code-review check (see the dedicated test).
  HAS_CODEX_REVIEW=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?codex-review(-fast|-branch)?($|[^A-Za-z0-9_-])' | tail -1 || true)
  HAS_PRECOMMIT=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?precommit(-fast)?($|[^A-Za-z0-9_-])' | tail -1 || true)
  HAS_REVIEW_DOC=$(echo "$CONVERSATION" | grep -oE '/(sd0x-dev-flow:)?codex-review-doc($|[^A-Za-z0-9_-])|/(sd0x-dev-flow:)?review-spec($|[^A-Za-z0-9_-])' | tail -1 || true)

  # Check review results (standard sentinel — includes doc review sentinels ✅ Mergeable / ✅ Ready)
  # Plan-review isolation (T4): plan sentinel SUBSTRINGS are stripped FIRST so that
  # `⛔ Plan Blocked` cannot satisfy the `⛔.*Block` pattern (it would otherwise be
  # misread as a code/doc FAIL and block an unrelated Stop), and `✅ Plan Ready`
  # neither satisfies nor blocks the code/doc gate. Substring stripping (not whole-line
  # grep -v): transcript is JSONL — one line packs a whole message, so dropping any
  # line containing "Plan Review" would also drop a genuine code/doc gate verdict
  # that happens to mention plan review in prose (false allow). Plan review has its
  # own plan_review.* state and is warn-only by design.
  _strip_plan_sentinels() {
    sed -e 's/## Plan Review//g' -e 's/✅ Plan Ready//g' -e 's/⛔ Plan Blocked//g' -e 's/⚠️ Plan Needs Human//g'
  }
  # BYTE offset of the LAST match of $1 on stdin, or empty.
  #
  # Byte offsets, not line numbers. `$CONVERSATION` is JSONL: one line packs an entire message,
  # so a line number cannot order two things that share a message — and a slash-command
  # invocation and the gate its predecessor emitted routinely do. That is not a corner case, it is
  # the ordinary shape of an auto-loop turn, where the model reports the previous verdict and
  # announces the next command in one breath. Line granularity therefore had to accept equality
  # (`>=`), and accepting equality is what let a `/precommit-fast` PASS be credited to a later,
  # different `/precommit`. Offsets order everything within the stream, so the comparison below
  # can be strict.
  _offset_of() {
    local n
    n=$(grep -boE "$1" | tail -1 | cut -d: -f1) || true
    printf '%s' "$n"
  }
  # True when a verdict at byte $1 can belong to the invocation at byte $2.
  #
  # Strict `>`: a verdict a command produced starts strictly after the command name that produced
  # it. Equality is unreachable here anyway — the command patterns start with `/` and every
  # verdict pattern with `#`, `✅` or `⛔`, so no two matches can begin at the same byte — but
  # writing it strictly keeps the invariant readable instead of leaving `>=` to be re-litigated.
  _verdict_paired() {
    [[ -n "$1" && -n "$2" ]] || return 1
    (( $1 > $2 )) || return 1
    return 0
  }
  # `✅ All Pass` is NOT in this pattern, nor in LAST_REVIEW below. rules/auto-loop.md documents it
  # as behavior-layer prose for "every gate passed" that no hook reads — and that claim has to be
  # true everywhere, not just in the per-plane scans. In LAST_REVIEW it was load-bearing in the
  # wrong direction: `tail -1` takes the LAST matching line, so a message ending in that phrase
  # out-ranked an earlier `⛔ Blocked` and cleared the coarse BLOCKED_REASON. The additive
  # per-plane scans below still caught that particular case, so it was not a live bypass — but a
  # prose phrase the model emits freely should not be able to out-rank a real verdict at all, and
  # a doc that says "no hook reads it" while two greps do is the kind of gap that is only ever
  # noticed after it matters. Dropping it can only make a block MORE likely (fail-closed).
  REVIEW_PASSED=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '## Gate: ✅|✅ Mergeable|✅ Ready|Gate.*PASS' | tail -1 || true)
  REVIEW_BLOCKED=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '## Gate: ⛔|⛔.*Block|⛔ Needs revision|⛔ Must fix|Gate.*FAIL' | tail -1 || true)

  # PRESENCE of a verdict, per plane, of EITHER polarity. The MISSING evaluation below used to ask
  # only "does the command TEXT appear?" — and the command text appears for reasons that prove
  # nothing ran to completion: a plan or TODO listing the step, a message quoting the workflow
  # table from CLAUDE.md, or an invocation that errored out before emitting its gate. In all three
  # the gate was reported SATISFIED, because the separate verdict check only ever sets
  # BLOCKED_REASON on an explicit ⛔ and an ABSENT verdict is not a ⛔. "Invoked" is not "passed";
  # unproven must read as missing, exactly as the state-file branch already treats an absent
  # `code_review.passed`.
  #
  # Split PER PLANE. The shared REVIEW_PASSED/REVIEW_BLOCKED pair was used for both gates, so ANY
  # verdict satisfied EITHER "invoked, no verdict" test: a doc review ending `✅ Mergeable` proved
  # the CODE review had reported, and vice versa. Concretely — code changed, `/codex-review-fast`
  # appears in the transcript but errored before emitting anything, a doc review then passes: the
  # code branch sees a non-empty REVIEW_PASSED (the doc's), emits no MISSING, and the per-plane
  # BLOCKED scan below finds no code sentinel to block on. The stop is allowed with no code verdict
  # at all.
  #
  # Each plane therefore matches only its OWN sentinels, and the two patterns are kept IDENTICAL to
  # the per-plane LAST_CODE_VERDICT / LAST_DOC_VERDICT scans further down — the "did it report?"
  # test and the "what did it report?" test must agree on plane membership, or a verdict could
  # satisfy one and be invisible to the other.
  #   code → `## Gate: ✅|⛔`, `✅ Ready`, `⛔ Blocked`, `⛔ Must fix`
  #   doc  → `✅ Mergeable`, `⛔ Needs revision`
  # `✅ All Pass` is deliberately in NEITHER: rules/auto-loop.md lists it under Advisory exits as
  # behavior-layer prose for "every gate passed", not a plane verdict, so letting it stand in for a
  # missing per-plane report is the same conflation one step removed. Unattributable reads as
  # missing — the fail-closed direction. It is excluded from the coarse plane-agnostic scans as
  # well (see REVIEW_PASSED above); no scan in this hook matches it.
  CODE_VERDICT_SEEN=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '## Gate: (✅|⛔)|✅ Ready|⛔ Blocked|⛔ Must fix' | tail -1 || true)
  DOC_VERDICT_SEEN=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '✅ Mergeable|⛔ Needs revision' | tail -1 || true)
  #
  # Precommit does need its own, because its sentinel is a different line entirely. Same three
  # accepted terminators as the LAST_PRECOMMIT scan below (see its comment); hoisted so the MISSING
  # evaluation can tell "precommit never reported" from "precommit reported FAIL".
  # Both boundaries are required. The trailing group alone still accepted a narration that ENDS
  # with the sentinel ("...I'll report ## Overall: ✅ PASS"), which `tail -1` then let override an
  # earlier real ⛔ FAIL. The leading group demands the sentinel START its line: column 0 in a
  # plain-text fixture, immediately after a JSON-encoded newline `\n`, or immediately after the
  # opening `"` of the JSON string — the three shapes a genuine emitted sentinel actually takes.
  # Prose mentions are preceded by a space or a backtick and no longer match either way round.
  # Trailing group is `[[:space:]]*` followed by ANY of the three terminators, not `[[:space:]]*$`
  # OR the other two: a JSON-encoded sentinel with a space before the escape
  # (`"## Overall: ✅ PASS \n done"`) matched none of the old alternatives. Fail-closed (it read as
  # "invoked, no verdict"), but the comment above claims to enumerate the shapes a real sentinel
  # takes, and that was a fourth.
  _PRECOMMIT_VERDICT_RE='(^|\\n|")## Overall: (✅ PASS|⛔ FAIL|❌ FAIL)([[:space:]]*($|\\n|"))'
  PRECOMMIT_VERDICT_SEEN=$(echo "$CONVERSATION" | grep -E "$_PRECOMMIT_VERDICT_RE" | tail -1 || true)
  # Deliberately NOT paired — see the blocking check far below. Pairing answers "did THIS invocation
  # report?", which is the right question for MISSING and the wrong one for "was anything ever
  # reported as FAILING". `PRECOMMIT_VERDICT_SEEN` is blanked when pairing fails, and reusing it for
  # the blocking check made a real `⛔ FAIL` disappear whenever the model narrated the next
  # `/precommit` after it — the ordinary shape of a failing auto-loop round. The code and doc planes
  # never had this because their blocking checks re-scan; precommit is kept in step by capturing the
  # unpaired reading here rather than by re-scanning there, so both readings come from one grep.
  PRECOMMIT_VERDICT_ANY="$PRECOMMIT_VERDICT_SEEN"

  # === Pair each verdict with the invocation it belongs to ===
  #
  # The scans above are position-blind: "does a verdict appear anywhere" and "does the command
  # appear anywhere" were never related in time. So a transcript reading
  #   /precommit-fast … ## Overall: ✅ PASS … /precommit
  # satisfied the gate for the LAST invocation using the FIRST one's verdict — including the
  # PRECOMMIT_REQUIRE_FULL branch, which reads the variant off that same last invocation. The newer
  # run, which may have errored before emitting anything or never run at all, inherited an older
  # run's result. The code and doc planes had the identical shape.
  #
  # A verdict now counts only if it is NOT OLDER than the invocation it is being credited to. Each
  # `-n` scan MUST use the same pattern as its `-o`/`-E` counterpart above; a divergence would pair
  # a verdict against an invocation neither scan agrees exists.
  _CODE_CMD_RE='/(sd0x-dev-flow:)?codex-review(-fast|-branch)?($|[^A-Za-z0-9_-])'
  _PRECOMMIT_CMD_RE='/(sd0x-dev-flow:)?precommit(-fast)?($|[^A-Za-z0-9_-])'
  _DOC_CMD_RE='/(sd0x-dev-flow:)?codex-review-doc($|[^A-Za-z0-9_-])|/(sd0x-dev-flow:)?review-spec($|[^A-Za-z0-9_-])'

  # ONE canonical byte stream for all six scans. Offsets are only comparable within a single
  # stream: `_strip_plan_sentinels` DELETES bytes, so an offset measured on the stripped text and
  # one measured on `$CONVERSATION` are read off different rulers, and the discrepancy grows with
  # every plan sentinel the session emitted — a verdict would drift "earlier" than the command that
  # produced it purely because a plan review happened upstream. The command patterns are indifferent
  # to the stripping (no plan sentinel contains a slash-command name), so putting them on the
  # stripped stream too costs nothing and makes every offset below mutually comparable.
  # `|| _PAIR_STREAM=""` — the ONE unguarded consumer of `_strip_plan_sentinels` among eight.
  # That helper is backed by `sed`, so on a host whose PATH lacks it the pipeline exits 127 and,
  # under `set -euo pipefail`, a bare assignment aborts the hook with no JSON on stdout — which
  # the harness reads as "no objection" and lets an unreviewed session stop (fail-OPEN). The
  # other seven call sites already absorb it with `|| true`; this one did not, purely because it
  # ends in the helper rather than in a `grep … | tail -1`. Empty is the fail-CLOSED value here:
  # every `_offset_of` below then yields "", `_verdict_paired` rejects empty operands, so each
  # gate reads as (invoked, no verdict) and blocks. Detection of the edits themselves scans
  # `$CONVERSATION`, not this stream, so the requirement to review does not vanish with it.
  _PAIR_STREAM=$(echo "$CONVERSATION" | _strip_plan_sentinels) || _PAIR_STREAM=""

  _CODE_CMD_AT=$(_offset_of "$_CODE_CMD_RE" <<< "$_PAIR_STREAM")
  _PRECOMMIT_CMD_AT=$(_offset_of "$_PRECOMMIT_CMD_RE" <<< "$_PAIR_STREAM")
  _DOC_CMD_AT=$(_offset_of "$_DOC_CMD_RE" <<< "$_PAIR_STREAM")
  _CODE_VERDICT_AT=$(_offset_of '## Gate: (✅|⛔)|✅ Ready|⛔ Blocked|⛔ Must fix' <<< "$_PAIR_STREAM")
  _DOC_VERDICT_AT=$(_offset_of '✅ Mergeable|⛔ Needs revision' <<< "$_PAIR_STREAM")
  _PRECOMMIT_VERDICT_AT=$(_offset_of "$_PRECOMMIT_VERDICT_RE" <<< "$_PAIR_STREAM")

  # Blank the verdict rather than adding a parallel flag, so every downstream `-z` test inherits
  # the pairing without restating it. An unpaired verdict is indistinguishable from no verdict —
  # which is exactly what it proves about the invocation being judged.
  _verdict_paired "$_CODE_VERDICT_AT" "$_CODE_CMD_AT" || CODE_VERDICT_SEEN=""
  _verdict_paired "$_DOC_VERDICT_AT" "$_DOC_CMD_AT" || DOC_VERDICT_SEEN=""
  _verdict_paired "$_PRECOMMIT_VERDICT_AT" "$_PRECOMMIT_CMD_AT" || PRECOMMIT_VERDICT_SEEN=""

  # Known over-block (deliberate, fail-closed): the command detectors match PROSE as well as real
  # invocations, so `/precommit` written in a summary AFTER a passing run moves the invocation line
  # past the verdict and re-opens the gate. That weakness already existed for mentions BEFORE any
  # verdict — the "(invoked, no verdict)" branch has always fired on them — so this extends an
  # accepted rule rather than introducing a new one, and it errs toward re-asking for a review that
  # already passed instead of skipping one that never ran. Transcript mode is the degraded path
  # taken only when no state file is readable; the state-file branch pairs by construction, because
  # a verdict is written into the gate's own subtree by the hook that observed it.

  if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
    echo "[Debug] Using transcript parsing mode" >&2
    echo "[Debug] HAS_CODE_CHANGE=${HAS_CODE_CHANGE:0:50}" >&2
    echo "[Debug] HAS_CODEX_REVIEW=$HAS_CODEX_REVIEW" >&2
    echo "[Debug] REVIEW_PASSED=${REVIEW_PASSED:0:50}" >&2
    # Both polarities, deliberately. `REVIEW_BLOCKED` had no reader at all — it ran a full grep
    # over the transcript and its result was discarded — which is not merely waste: printing only
    # the passing side is what makes a SPURIOUS pass invisible while debugging. When a stop is
    # allowed that should not have been, the useful question is whether a blocking verdict was
    # ALSO matched and out-ranked, and that is unanswerable from the passing scan alone.
    echo "[Debug] REVIEW_BLOCKED=${REVIEW_BLOCKED:0:50}" >&2
  fi
fi

# === Logic evaluation ===
MISSING="${MISSING:-}"
BLOCKED_REASON="${BLOCKED_REASON:-}"
# Unconditional, not `${x:-}`: this one decides whether the model is told to retry, so an inherited
# environment value must never be able to suppress the retry instruction.
UNRETIREABLE_REASON=""
# Same reasoning: an inherited value must not be able to invent an obligation the state does not hold.
AGG_OBLIGATION_NOTE=""
# Keyed on the PLANE, not on which gate is missing. A per-event marker invalidates its gates on
# every Stop and no writer clears it, so whatever ends up in MISSING, running it cannot make this
# Stop stop objecting. Ordering a retry would be an instruction with no terminating state.
# Reuses the early exits' string so the recovery story is identical wherever the model reads it.
if [[ "$USE_STATE_FILE" == "true" && "${_SIDECAR_EVENT_PRESENT:-false}" == "true" ]]; then
  UNRETIREABLE_REASON="$SIDECAR_EVENT_NORETRY"
fi

if [[ "$USE_STATE_FILE" == "true" ]]; then
  # State file mode
  if [[ "$HAS_CODE_CHANGE" == "true" ]]; then
    # Which entry point can actually discharge the code plane. Two facts decide it, and neither is
    # DUAL_GATE_PASSED: that variable is the generic "invalidate the code gate" signal, which the
    # corrupt-state and sidecar blocks above raise in SINGLE mode too.
    #
    # Persisted mode alone is also insufficient. `update_aggregate_gate PENDING` sets
    # `review_mode=dual` in the SAME jq as the aggregate fields, so a failed write leaves an
    # aggregate-plane marker raised over a mode that still reads single. Routing that state to
    # `/codex-review-fast` is unsatisfiable by construction — the same deadlock this branch exists
    # to remove, entered through a different door. A SHARED marker is retired by any committed
    # transaction that owns the aggregate plane (the aggregate write itself,
    # post-tool-review-state.sh:2329; a code or doc edit, post-edit-format.sh:1186 / :1249) or by
    # the clean-tree SessionStart sweep. A code review is none of those.
    # See docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md.
    #
    # Whole-line matching in pure bash throughout. No grep: this branch is reached precisely when
    # state is unverifiable, and the file's standing rule (see _json_safe and SIDECAR_REASON above)
    # is that a fail-closed path must not abort at 127 on a host with a thin PATH.
    _agg_marker_in() {
      local _p=$'\n'"${1:-}"$'\n'
      [[ "$_p" == *$'\n'aggregate_write_failed$'\n'* || "$_p" == *$'\n'lock_failure$'\n'* ]]
    }
    _AGG_OBLIGATION=false
    if [[ "${REVIEW_MODE:-}" == "dual" ]]; then
      _AGG_OBLIGATION=true
    elif _agg_marker_in "${_SIDECAR_RAW:-}"; then
      _AGG_OBLIGATION=true
    fi
    if [[ "${DUAL_GATE_PASSED:-}" == "false" ]]; then
      if [[ "$_AGG_OBLIGATION" == "true" ]]; then
        # Bare command, annotation on its own line. The file's `/precommit(mode=fast, …)` convention
        # attaches the note to a command NAME, where stripping at `(` still leaves something
        # runnable; attaching it to a FLAG does not, and the space inside the parenthetical splits
        # into junk tokens under whitespace parsing. A signal that names the only entry point able
        # to discharge this gate must not name it in a form that cannot be run.
        MISSING="$MISSING /codex-review-branch --dual"
        AGG_OBLIGATION_NOTE="aggregate_gate is pending. Only the final emitter of /codex-review-branch --dual writes that plane, so no other review discharges it."
        # Set HERE rather than from `_AGG_OBLIGATION` alone, which is true for the whole of dual mode
        # including after the gate reads READY. Deriving the fact block from the raw flag made this
        # hook contradict itself: `pending=aggregate_gate` beside a MISSING list that had already
        # dropped the demand. Same guard, one source of truth.
        _AGG_OUTSTANDING=true
      else
        MISSING="$MISSING /codex-review-fast"
      fi
    elif [[ -z "${DUAL_GATE_PASSED:-}" && "$CODE_REVIEW_PASSED" != "true" ]]; then
      MISSING="$MISSING /codex-review-fast"
    fi
    if [[ "$PRECOMMIT_PASSED" != "true" ]]; then
      MISSING="$MISSING /precommit"
    elif [[ "${PRECOMMIT_REQUIRE_FULL:-}" == "1" && "$PRECOMMIT_MODE" != "full" ]]; then
      # Opt-in: `/precommit-fast` SKIPS the build/typecheck step (precommit-runner.js:167), so on a
      # project whose required check is the full gate a passing `fast` run is not equivalent — it
      # banks precommit.passed=true with the typecheck never executed. Off by default NOT because of
      # this repo's own untracked `.claude/CLAUDE.md` (that only binds local developers) but because
      # the flag ships to arbitrary host projects, where the fast gate is a documented, supported
      # choice — defaulting to full-only would block those projects with nothing to configure.
      # Projects requiring the full gate set PRECOMMIT_REQUIRE_FULL=1. An absent/`unknown` mode (legacy state written before the field
      # existed, or an unrecognized invocation) also fails here — unproven is not proven.
      # LIMIT OF THIS CHECK: `mode` records the COMMAND VARIANT, not the stages that ran. A repo with
      # no build script (the runner logs `⏭️ build (skipped: script missing)`) and any non-Node
      # ecosystem (which bypasses the runner entirely) both record `full` with no typecheck behind
      # it. So this gate rejects the reduced variant; it does not certify that a typecheck executed.
      # post-tool-review-state.sh warns on stderr when it records exactly that divergence.
      MISSING="$MISSING /precommit(full; last run mode=${PRECOMMIT_MODE:-unrecorded})"
    fi
  fi
  if [[ "$HAS_DOC_CHANGE" == "true" && "$DOC_REVIEW_PASSED" != "true" ]]; then
    MISSING="$MISSING /codex-review-doc"
  fi
  # D-4: Phase-aware hint (supplements, does not replace, existing MISSING logic)
  if [[ -n "$MISSING" && -n "${REVIEW_PHASE:-}" && "$REVIEW_PHASE" != "idle" ]]; then
    MISSING="$MISSING (phase:$REVIEW_PHASE)"
  fi
else
  # Transcript parsing mode
  if [[ -n "$HAS_CODE_CHANGE" ]]; then
    if [[ -z "$HAS_CODEX_REVIEW" ]]; then
      MISSING="$MISSING /codex-review-fast"
    elif [[ -z "$CODE_VERDICT_SEEN" ]]; then
      MISSING="$MISSING /codex-review-fast(invoked, no verdict)"
    fi
    if [[ -z "$HAS_PRECOMMIT" ]]; then
      MISSING="$MISSING /precommit"
    elif [[ -z "$PRECOMMIT_VERDICT_SEEN" ]]; then
      MISSING="$MISSING /precommit(invoked, no verdict)"
    elif [[ "${PRECOMMIT_REQUIRE_FULL:-}" == "1" && "$HAS_PRECOMMIT" == *-fast* ]]; then
      # The flag was honoured ONLY in state-file mode, so a project that required the full gate got
      # it enforced with a state file and silently not enforced without one — the fallback is
      # exactly the degraded path where an unproven verdict is least affordable. The variant is
      # recoverable here because the detector CAPTURES its match (`/precommit` vs `/precommit-fast`)
      # and `tail -1` keeps it recency-correct, same rule as the state-file branch's `mode` field.
      MISSING="$MISSING /precommit(mode=fast, full required)"
    fi
  fi
  if [[ -n "$HAS_DOC_CHANGE" ]]; then
    if [[ -z "$HAS_REVIEW_DOC" ]]; then
      MISSING="$MISSING /codex-review-doc"
    elif [[ -z "$DOC_VERDICT_SEEN" ]]; then
      MISSING="$MISSING /codex-review-doc(invoked, no verdict)"
    fi
  fi

  # Check if review passed — use last verdict for recency-correct detection
  # (handles fail→pass→fail re-runs: the LAST verdict wins)
  if [[ -n "$HAS_CODEX_REVIEW" || -n "$HAS_REVIEW_DOC" ]]; then
    # Same plan-sentinel strip as REVIEW_PASSED/REVIEW_BLOCKED above (T4 isolation)
    # `✅ All Pass` excluded here too — see the REVIEW_PASSED comment above for why.
    LAST_REVIEW=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '## Gate: (✅|⛔)|✅ (Mergeable|Ready)|⛔.*(Block|Needs revision|Must fix)|Gate.*(PASS|FAIL)' | tail -1 || true)
    if [[ -n "$LAST_REVIEW" ]] && grep -qE '⛔|FAIL' <<< "$LAST_REVIEW"; then
      BLOCKED_REASON="Review not passed (Blocked)"
    fi
  fi

  # Per-plane recency. LAST_REVIEW above answers "what was the most recent verdict of ANY kind",
  # which CONFLATES the two planes: a code review ending `⛔ Blocked` followed by a doc review
  # ending `✅ Mergeable` left LAST_REVIEW passing, and since the MISSING test only asks whether
  # *a* verdict exists (of either polarity, either plane), the failed code review vanished
  # entirely — Stop was allowed over a blocked code review.
  #
  # These two scans are strictly ADDITIVE: they can only RAISE BLOCKED_REASON, never clear one, so
  # every currently-blocking case still blocks. Each plane matches only its OWN sentinels, so a
  # later verdict on the other plane cannot supersede it.
  #
  # Known over-block (deliberate, fail-closed): `$CONVERSATION` is JSONL, so one line can pack a
  # whole message carrying BOTH planes' sentinels. Such a line reads as blocking for both. Erring
  # toward a spurious ⚠️ in a degraded no-state path is the correct direction.
  if [[ -z "$BLOCKED_REASON" && -n "$HAS_CODEX_REVIEW" ]]; then
    LAST_CODE_VERDICT=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '## Gate: (✅|⛔)|✅ Ready|⛔ Blocked|⛔ Must fix' | tail -1 || true)
    if [[ -n "$LAST_CODE_VERDICT" ]] && grep -qE '⛔' <<< "$LAST_CODE_VERDICT"; then
      BLOCKED_REASON="Code review not passed (Blocked)"
    fi
  fi
  if [[ -z "$BLOCKED_REASON" && -n "$HAS_REVIEW_DOC" ]]; then
    LAST_DOC_VERDICT=$(echo "$CONVERSATION" | _strip_plan_sentinels | grep -E '✅ Mergeable|⛔ Needs revision' | tail -1 || true)
    if [[ -n "$LAST_DOC_VERDICT" ]] && grep -qE '⛔' <<< "$LAST_DOC_VERDICT"; then
      BLOCKED_REASON="Doc review not passed (Needs revision)"
    fi
  fi

  # D2: Check precommit result (not just execution) — scan for last ## Overall sentinel
  # Use the LAST ## Overall line to determine pass/fail (handles PASS→FAIL re-runs correctly)
  #
  # The sentinel must be TERMINATED, not merely present. Without the trailing-delimiter group, a
  # narration line such as "I'll print `## Overall: ✅ PASS` once it's green" matched, and because
  # it carries no FAIL marker it read as a passing precommit — so a prose mention emitted AFTER a
  # real `⛔ FAIL` silently unblocked the gate (`tail -1` takes the later line).
  #
  # The state writer anchors its copy of this sentinel to a whole line at column 0, but that parser
  # CANNOT be reused here: `$CONVERSATION` is `tail -500` of a JSONL transcript, so a genuine
  # sentinel lives inside a JSON string on a line beginning with `{`. `^`/`$` would therefore match
  # nothing in production while still passing the plain-text fixtures below — dead code that looks
  # tested. The three accepted terminators cover both shapes: end-of-line (plain text), a literal
  # `\n` escape (JSON-encoded newline), and `"` (sentinel ends the JSON string).
  if [[ -n "$HAS_PRECOMMIT" && -z "$BLOCKED_REASON" ]]; then
    # UNPAIRED, matching the two per-plane scans above. Blocking detection must be ADDITIVE: a
    # `⛔ FAIL` anywhere in the window is evidence the gate failed, and no later invocation —
    # announced, mentioned in a summary, or genuinely re-run without output — retires it. Pairing
    # belongs to the MISSING branch, which asks a different question.
    LAST_PRECOMMIT="$PRECOMMIT_VERDICT_ANY"
    if [[ -n "$LAST_PRECOMMIT" ]] && grep -qE '(⛔|❌) FAIL' <<< "$LAST_PRECOMMIT"; then
      BLOCKED_REASON="Precommit not passed (FAIL)"
    fi
  fi

  # Normalize into the variables the fact renderer reads. This branch stores GREP MATCHES and tests
  # them for non-emptiness; the state-file branch stores booleans and compares against `"true"`. The
  # renderer inherited the second convention, so on this path it emitted `change=none pending=none`
  # beside a populated MISSING — the fact contradicting the decision it accompanies, on the one path
  # where it is the only signal there is. `true`/empty rather than `true`/`false`, so every `-n` test
  # above keeps its meaning unchanged.
  HAS_CODE_CHANGE=$([[ -n "$HAS_CODE_CHANGE" ]] && echo true || echo "")
  HAS_DOC_CHANGE=$([[ -n "$HAS_DOC_CHANGE" ]] && echo true || echo "")
  # A plane counts as passed only when it was invoked, a verdict was paired to it, and nothing in
  # the window blocked. `BLOCKED_REASON` is shared across planes, so a doc block also withholds the
  # code receipt: it under-claims rather than over-claims, which is the correct direction on a
  # degraded path. These are transcript INFERENCES, not receipts — `source=transcript` on the line
  # says so, and no `->` pair is emitted here because there was no write to observe.
  _fb_receipt() { [[ -n "$1" && -n "$2" && -z "${BLOCKED_REASON:-}" ]] && echo true || echo false; }
  CODE_RECEIPT_PERSISTED=$(_fb_receipt "${HAS_CODEX_REVIEW:-}" "${CODE_VERDICT_SEEN:-}")
  DOC_REVIEW_PASSED=$(_fb_receipt "${HAS_REVIEW_DOC:-}" "${DOC_VERDICT_SEEN:-}")
  PRECOMMIT_PASSED=$(_fb_receipt "${HAS_PRECOMMIT:-}" "${PRECOMMIT_VERDICT_SEEN:-}")
fi

# === Iteration hard cap check (schema v2) — takes priority over MISSING ===
#
# Both operands are DIGIT-VALIDATED before the numeric compare. `[[ x -ge y ]]` evaluates its
# operands as ARITHMETIC EXPRESSIONS, and arithmetic evaluation performs both variable expansion
# and COMMAND SUBSTITUTION inside an array subscript. `.claude_review_state.json` is an ordinary
# file in the working tree — written by hooks, but writable by anything, including a fanout worker
# — so a crafted `"current_round": "MISSING[$(...)]"` executed arbitrary commands inside this Stop
# hook (reproduced: the payload's `touch` ran, then evaluation continued normally and printed the
# LT branch, leaving no trace). Any variable name that exists in this scope works as the array base.
# The same string form ALSO disarms the cap silently: `"12abc"` makes `[[ ]]` abort with
# "value too great for base", which `2>/dev/null` swallows and the failed test reads as "under the
# cap" — an unbounded review loop, the exact failure the hard cap exists to stop.
# Non-numeric therefore routes to ⚠️ Need Human rather than to a default: the counters cannot be
# trusted, so we cannot prove the budget is unspent.
if [[ "$USE_STATE_FILE" == "true" && -f "$STATE_FILE" ]]; then
  # Validate INSIDE jq, as bounded JSON integers, before any value reaches bash arithmetic.
  # A bash-side `=~ ^[0-9]+$` guard is necessary but NOT sufficient:
  #   • a non-object `iteration_history` (string / array / number) makes the per-field reads raise
  #     a jq index error, which `|| echo 0` / `|| echo 10` turned into a clean "round 0 of 10" —
  #     a corrupt parent silently reading as an unspent budget, so the cap never fires;
  #   • a digit-only value beyond Bash's signed 64-bit range WRAPS in `[[ -ge ]]` and can compare
  #     as below the cap;
  #   • a digit-only value with a leading zero is parsed as OCTAL (`010` = 8, `08` = an error).
  # jq emits numbers canonically, so a value that survives the checks below cannot carry leading
  # zeros, a fractional part, a sign, or a magnitude bash cannot represent. Anything else is
  # `corrupt` → ⚠️ Need Human, never a default: untrusted counters cannot prove the budget unspent.
  # NOTE the deliberate absence of `//` here. jq's alternative operator treats **false** as
  # "missing", so `(.iteration_history.current_round // 0)` mapped `current_round: false` to 0 —
  # verified against real jq: `{"current_round":false,"max_rounds":false}` produced `0` and the
  # full default cap, i.e. a FULLY UNSPENT budget, silently refunding the only enforced convergence
  # exit. The type checks below could never catch it because the false was already gone. Same for
  # `(.iteration_history // {})`, which laundered `iteration_history: false` into an empty object.
  # So: null/absent → documented defaults; anything else non-numeric, INCLUDING false → corrupt.
  ITER_PARSED=$(jq -r '
    .iteration_history as $ih
    | if $ih == null then "0 30"
      elif ($ih | type) != "object" then "corrupt"
      else
        (if ($ih | has("current_round")) and ($ih.current_round != null) then $ih.current_round else 0 end) as $r
        | (if ($ih | has("max_rounds")) and ($ih.max_rounds != null) then $ih.max_rounds else 30 end) as $m
        | if ($r | type) != "number" or ($m | type) != "number" then "corrupt"
          elif ($r | floor) != $r or ($m | floor) != $m then "corrupt"
          elif $r < 0 or $r > 100000 or $m < 1 or $m > 100000 then "corrupt"
          # CLAMP the cap, do not accept it as written. The only producer of this field
          # (`_read_project_int_setting` in post-tool-review-state.sh) admits 3..50 and otherwise
          # falls back to the default 30, so a persisted 100000 cannot have come from the
          # documented path. `.claude_review_state.json` is an ordinary writable file, and an
          # out-of-contract cap is exactly how the convergence hard cap — the ONLY exit stop-guard
          # actually enforces — gets disarmed: `current_round: 51` under `max_rounds: 100000` reads
          # as a comfortably unspent budget forever. Clamping rather than declaring "corrupt" keeps
          # a merely stale or hand-edited file usable in warn mode instead of forcing that user
          # into strict, while still capping the budget at the contract maximum.
          else "\($r) \(if $m < 3 then 3 elif $m > 50 then 50 else $m end)"
          end
      end' <<< "$STATE" 2>/dev/null) || ITER_PARSED="corrupt"
  if [[ "$ITER_PARSED" =~ ^([0-9]+)[[:space:]]([0-9]+)$ ]]; then
    ITER_ROUND="${BASH_REMATCH[1]}"
    ITER_MAX="${BASH_REMATCH[2]}"
  else
    ITER_ROUND="corrupt"
    ITER_MAX="corrupt"
  fi
  if [[ "$ITER_ROUND" == "corrupt" ]]; then
    MISSING=""
    BLOCKED_REASON="Iteration counters are not valid bounded integers — state file corrupt or tampered, needs human intervention"
    if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
      echo "[Debug] Iteration counters rejected (jq validation: ${ITER_PARSED:0:32})" >&2
    fi
  elif [[ "$ITER_ROUND" -ge "$ITER_MAX" ]]; then
    # Hard cap: override MISSING — the cap outranks the per-gate list. The message is a NEUTRAL
    # FACT (R6): the hook cannot tell a first cap-hit from a second, nor a routine change from a
    # security one (only ITER_ROUND/ITER_MAX are in scope here), so the first-hit-diagnose /
    # second-hit-escalate split lives entirely in rules/auto-loop.md § Cap Diagnostic Protocol.
    # A conditional imperative here would need state this branch does not have — and would
    # reinstate the command-style signal R2 removed from the emitters.
    MISSING=""
    BLOCKED_REASON="Review round cap reached ($ITER_ROUND/$ITER_MAX)"
    if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
      echo "[Debug] Iteration hard cap: round=$ITER_ROUND, max=$ITER_MAX" >&2
    fi
  fi
fi

# === Output result ===
#
# Both MISSING and BLOCKED_REASON carry STATE-DERIVED text (`review_phase`, `precommit.mode`, the
# rejected counter values), and `.claude_review_state.json` is an ordinary file in the working tree
# that any process can write. Interpolating such a value straight into the printf JSON template
# lets a `"` or `\` or newline produce MALFORMED output, which the harness cannot parse — turning a
# blocking verdict into no verdict at all. Strip the three characters that can break a JSON string
# (control chars, quote, backslash) rather than trying to escape them: these fields are diagnostic
# prose, so losing a stray quote costs nothing and guarantees well-formed output.
#
# Implemented with bash parameter expansion, NOT `tr`: this runs on the fail-closed path, and a
# host whose PATH lacks the helper would make the pipeline exit 127 under `set -e` — killing the
# hook before any JSON is printed, which the harness reads as "no objection" (fail-open). A
# built-in cannot be missing. `LC_ALL=C` keeps `[[:cntrl:]]` byte-scoped rather than locale-scoped.
_json_safe() {
  local s="${1:-}"
  local LC_ALL=C
  s="${s//[[:cntrl:]]/ }"
  s="${s//\\/}"
  s="${s//\"/}"
  printf '%s' "$s"
}

if [[ -n "${MISSING:-}" ]]; then
  MISSING_JSON=$(_json_safe "$MISSING")
  # Why the obligation gets its own line rather than riding inside MISSING: MISSING is read as a
  # list of runnable steps, so anything spliced into it has to stay runnable. Printed before the
  # mode branches so it appears whichever instruction follows.
  if [[ -n "$AGG_OBLIGATION_NOTE" ]]; then
    echo "[Stop Guard] ${AGG_OBLIGATION_NOTE}" >&2
  fi
  # Facts first, in the shape every other emitter uses. `pending` names PLANES, derived from the
  # same receipts that built MISSING rather than parsed back out of it — MISSING carries commands
  # because a human reads that line, and re-deriving planes from command text would break the
  # moment a command is renamed.
  _ALF_CHANGE="none"
  [[ "$HAS_CODE_CHANGE" == "true" ]] && _ALF_CHANGE="code"
  [[ "$HAS_DOC_CHANGE" == "true" ]] && _ALF_CHANGE="doc"
  [[ "$HAS_CODE_CHANGE" == "true" && "$HAS_DOC_CHANGE" == "true" ]] && _ALF_CHANGE="code,doc"
  _ALF_PENDING=""
  [[ "$_AGG_OUTSTANDING" == "true" ]] && _ALF_PENDING="aggregate_gate"
  # `CODE_RECEIPT_PERSISTED`, not `CODE_REVIEW_PASSED`: in dual mode the latter has been replaced by
  # the aggregate verdict, so it would name the code review as outstanding when the aggregate plane
  # is the only thing left. The aggregate obligation is already carried by the entry above.
  [[ "$HAS_CODE_CHANGE" == "true" && "$CODE_RECEIPT_PERSISTED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}code_review"
  [[ "$HAS_DOC_CHANGE" == "true" && "$DOC_REVIEW_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}doc_review"
  [[ "$HAS_CODE_CHANGE" == "true" && "$PRECOMMIT_PASSED" != "true" ]] && _ALF_PENDING="${_ALF_PENDING}${_ALF_PENDING:+,}precommit"
  # Which branch produced these values changes how much they are worth: the state file holds
  # recorded receipts, the transcript holds inferences drawn from a 500-line window. Saying so is
  # cheaper than having the reader guess, and it is the same disclosure the degraded paths make.
  if [[ "$USE_STATE_FILE" == "true" ]]; then
    # Observability (§3.5, WB5c): digest = the derivation drove these values; mirror_planes
    # names any plane whose validity still came from the stored receipts (post-flip that is
    # only the not-a-repo/unreadable classification). git_probe = the derivation was
    # unavailable and a direct git status probe answered instead (fail-closed unless provably
    # clean). state_file = the mirror kept its legacy authority — derivation unavailable
    # outside a git repository.
    if [[ "${_GD_SOURCE:-mirror}" == "digest" ]]; then
      _ALF_SOURCE="source=digest${_GD_FALLBACK_PLANES:+ mirror_planes=${_GD_FALLBACK_PLANES}}"
    elif [[ "${_GD_SOURCE:-mirror}" == "unavailable" ]]; then
      _ALF_SOURCE="source=git_probe degraded=derive_unavailable"
    else
      _ALF_SOURCE="source=state_file"
    fi
  else
    _ALF_SOURCE="source=transcript degraded=no_state_file"
  fi
  _alf_emit "event=stop_attempt change=${_ALF_CHANGE} mode=${GUARD_MODE} ${_ALF_SOURCE}" \
    "receipts=code_review:${CODE_RECEIPT_PERSISTED},doc_review:${DOC_REVIEW_PASSED},precommit:${PRECOMMIT_PASSED}" \
    "$(_alf_common)" "pending=${_ALF_PENDING:-none}" >&2
  # WB5b (§3.6): the state-file advisory note about backgrounded reviews is retired with its
  # writer. A backgrounded review (issue #10) is task-owned in the dispatch log (WB3), and the
  # pairing sweep reports an unsettled dispatch from evidence that survives compaction —
  # request-side markers in the state file no longer exist to report from.
  if [[ "$GUARD_MODE" == "strict" ]]; then
    # On exit 2 only stderr reaches the model (stdout JSON is test-consumed),
    # so the actionable instruction must be here, not just in the JSON.
    echo "[Stop Guard] STRICT: Missing steps:${MISSING}" >&2
    if [[ -n "$UNRETIREABLE_REASON" ]]; then
      # Still exit 2 — the gate is genuinely shut and fail-closed is the point. What changes is the
      # instruction: "invoke the command now" against an obligation nothing retires is a loop with
      # no terminating state. The BLOCKED_REASON renderer below carries the same fact in neutral
      # phrasing (R6) because the cap path routes through it; here the imperative is R2-sanctioned
      # degraded-path messaging and stays.
      UNRETIREABLE_JSON=$(_json_safe "$UNRETIREABLE_REASON")
      echo "[Stop Guard] Do NOT auto-retry: ${UNRETIREABLE_REASON}" >&2
      printf '{"ok":false,"reason":"Blocked on an obligation no command retires","description":"Do not auto-retry: %s"}\n' "${UNRETIREABLE_JSON}"
    else
      echo "[Stop Guard] Obligations open:${MISSING} — the gate stays shut until each is discharged." >&2
      printf '{"ok":false,"reason":"Missing required steps","description":"Open obligations:%s"}\n' "${MISSING_JSON}"
    fi
    exit 2
  else
    echo "[Stop Guard] WARN: Missing steps:${MISSING} (set STOP_GUARD_MODE=strict to block)" >&2
    if [[ -n "$UNRETIREABLE_REASON" ]]; then
      # Also in the JSON, not only on stderr: a consumer that reads stdout alone would otherwise see
      # ordinary missing steps and lose the one fact that changes what to do about them.
      echo "[Stop Guard] Do NOT auto-retry: ${UNRETIREABLE_REASON}" >&2
      printf '{"ok":true,"reason":"Missing steps (warn mode):%s","description":"Do not auto-retry: %s"}\n' "${MISSING_JSON}" "${UNRETIREABLE_REASON}"
    else
      printf '{"ok":true,"reason":"Missing steps (warn mode):%s"}\n' "${MISSING_JSON}"
    fi
    exit 0
  fi
elif [[ -n "${BLOCKED_REASON:-}" ]]; then
  # Use cap-specific description when the round cap is reached. Neutral fact only (R6) — the
  # disposition (diagnose vs escalate) is rules/auto-loop.md's call, not this hook's.
  BLOCK_DESC="Findings are outstanding; the review gate has not passed"
  if grep -q "Review round cap reached" <<< "${BLOCKED_REASON}"; then
    BLOCK_DESC="Review round cap reached; see the round/cap values in the reason"
  fi
  # Reachable with an event marker: corrupt iteration counters CLEAR `MISSING` and set
  # `BLOCKED_REASON` instead (see the ITER_ROUND branch above), so this renderer inherits the same
  # obligation the other one just learned to describe honestly. Checked last — an unretireable
  # obligation outranks both descriptions above, since neither retry nor escalation ends it.
  # Neutral phrasing (R6): the cap path routes through THIS renderer, so an imperative here would
  # re-introduce a disposition on cap-hits. The sentence already states the facts — marker present,
  # nothing retires it, how it eventually clears; what to do about it is rules/auto-loop.md's call.
  if [[ -n "$UNRETIREABLE_REASON" ]]; then
    BLOCK_DESC="Unretireable obligation: ${UNRETIREABLE_REASON}"
  fi
  BLOCKED_JSON=$(_json_safe "$BLOCKED_REASON")
  if [[ "$GUARD_MODE" == "strict" ]]; then
    # Same as the MISSING branch: the model only sees stderr on exit 2.
    echo "[Stop Guard] STRICT: ${BLOCKED_REASON}" >&2
    echo "[Stop Guard] ${BLOCK_DESC}" >&2
    printf '{"ok":false,"reason":"%s","description":"%s"}\n' "${BLOCKED_JSON}" "${BLOCK_DESC}"
    exit 2
  else
    echo "[Stop Guard] WARN: ${BLOCKED_REASON} (set STOP_GUARD_MODE=strict to block)" >&2
    # Warn mode lets the stop through, so there is no loop to break here — this is for symmetry with
    # the MISSING warn branch, and for the JSON-only consumer that would otherwise see a plain
    # blocked reason and try to work it off.
    if [[ -n "$UNRETIREABLE_REASON" ]]; then
      echo "[Stop Guard] Unretireable obligation: ${UNRETIREABLE_REASON}" >&2
      printf '{"ok":true,"reason":"%s (warn mode)","description":"Unretireable obligation: %s"}\n' "${BLOCKED_JSON}" "${UNRETIREABLE_REASON}"
    else
      printf '{"ok":true,"reason":"%s (warn mode)"}\n' "${BLOCKED_JSON}"
    fi
    exit 0
  fi
else
  echo "[Stop Guard] Check passed" >&2
  echo '{"ok":true,"reason":"All steps completed"}'
  exit 0
fi
