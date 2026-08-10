#!/usr/bin/env bash
# PostToolUse Hook: Parse review command output, update state file
# Trigger condition: Bash tool executes review/precommit commands

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

# Transition emitters live in this file only, so this helper stays out of the byte-identical block
# above. It renders R2's "收據新舊" pair: the receipt as it stood before the write, then the receipt
# READ BACK afterwards. `update_state` returns 0 on its mktemp, empty-output and lock-contention
# failures alike, so the fact that it returned proves nothing about what was committed — emitting
# the requested verdict would assert a durable state that may not exist. When the two disagree the
# write was dropped and a sidecar is holding the gate shut; say so rather than advancing the loop.
# Takes the read-back value rather than re-reading, so the receipt reported and the `pending` derived
# from it come from one observation of the file. Reasons ACCUMULATE into a single `degraded=` key:
# two keys in one whitespace-delimited record leave precedence to whichever parser reads it, which
# is not a property a "structured fact" may have. `$5` carries a reason the caller already knows
# (an interrupted response), so it joins the same key rather than adding a second.
#
# Read-back has one blind spot: when the receipt ALREADY held the requested value, a dropped write
# renders `false->false` exactly like a successful no-op. `_verdict_write_failed` leaves a marker
# keyed `verdict_write_failed:<plane>` for the dangerous half of that — a lost BLOCKING verdict —
# so the pair of snapshots below closes it. Reading a marker is read-side work; AC5's prohibition
# is on the write path.
_alf_sidecar_has() {
  local want="$1" p body
  for p in "${STATE_FILE}.blocked" "${SIDECAR_EVENT_PREFIX}"*; do
    [[ -f "$p" && ! -L "$p" ]] || continue
    body=$'\n'"$(cat "$p" 2>/dev/null || true)"$'\n'
    [[ "$body" == *$'\n'"$want"$'\n'* ]] && return 0
  done
  return 1
}
# Call before `update_state`; `_alf_transition` reads what it leaves behind. Snapshotting BEFORE is
# what separates "this write was lost" from "an earlier loss on this plane is still unretired" —
# `post-edit-format.sh` retires these markers, so a standing one is not evidence about this call.
_alf_begin() {
  _alf_old=$(_alf_receipt "$1")
  _alf_lost0=$(_alf_sidecar_has "verdict_write_failed:$1" && printf 1 || printf 0)
}
#
# Round-25 finding #4: read-back confirmation for callers that must decide whether THIS call's
# `update_state` write actually landed before treating its bundled epoch/marker retirement as
# settled — `update_state` returns 0 on every one of its documented failure paths too (see the
# `_alf_receipt` comment above), so the return code alone cannot answer that. Two checks, both
# required: the receipt now reads what THIS call requested (`$want`), and no fresh
# `verdict_write_failed:$plane` sidecar appeared. Confirms a lost PASS only via the receipt check
# — `_verdict_write_failed` deliberately sets no marker for a lost pass (see its own comment: "the
# gate is already unsatisfied, so a marker would block on nothing"), so the marker check is a
# no-op, never a false confirmation, for `$want=true`.
#
# Round-26 findings #1/#2 tried to patch the receipt/marker read-back with staleness sensitivity;
# round-27 finding #1 found that patch still racy — both the receipt and the marker it compares are
# PLANE-GLOBAL, so a CONCURRENT (not stale) dispatch on the same plane can mutate either between
# this call's commit and this function's read of it, flipping the verdict wrongly in both
# directions. `_us_committed` (round-26 #2) is not a proxy for that question — it IS the answer,
# set by `update_state` itself at the exact `mv` that atomically commits `$want` (and any bundled
# epoch/marker retirement, same jq transaction). Nothing else runs between that `mv` and this check
# within one hook invocation, so it cannot be raced from inside this process, and every path that
# never reaches the `mv` leaves it `0`. The receipt/marker read-back this replaced answered a
# weaker, racy version of the same question; trust the operation-local fact instead of re-deriving
# it from global state a concurrent writer can change.
_alf_write_confirmed() {
  [[ "${_us_committed:-0}" == "1" ]]
}
_alf_transition() {
  local plane="$1" old="$2" now="$3" want="$4" reasons="${5:-}"
  local lost0="${_alf_lost0:-0}" lost1
  lost1=$(_alf_sidecar_has "verdict_write_failed:${plane}" && printf 1 || printf 0)
  printf 'receipts=%s:%s->%s' "$plane" "$old" "$now"
  # `unknown` means the read found no receipt to describe — distinct from finding a recorded
  # `false`, and the distinction the two-valued version destroyed.
  [[ "$now" == "unknown" ]] && reasons="${reasons:+${reasons};}receipt_unreadable"
  [[ "$now" == "$want" ]] || reasons="${reasons:+${reasons};}verdict_not_recorded"
  [[ "$lost1" == 1 && "$lost0" == 0 && "$reasons" != *verdict_not_recorded* ]] \
    && reasons="${reasons:+${reasons};}verdict_not_recorded"
  [[ -n "$reasons" ]] && printf ' degraded=%s' "$reasons"
  return 0
}

# === Portable mkdir locking (macOS has no flock) ===
LOCKDIR="${STATE_FILE}.lockdir"
# Env-overridable so contention tests don't pay the full wait per lock site.
LOCK_TIMEOUT="${REVIEW_STATE_LOCK_TIMEOUT:-5}"
# Guard: `:-5` only fills an UNSET var, not a malformed one. A non-integer override
# (e.g. "5s") makes the `-ge $LOCK_TIMEOUT` test in _lock error "integer expected"
# every iteration, so the timeout/stale-recovery branch never fires and the hook hangs
# under contention. Reject any non-digit value → fall back to the default.
[[ "$LOCK_TIMEOUT" =~ ^[0-9]+$ ]] || LOCK_TIMEOUT=5
LOCK_TTL=30
HAVE_LOCK=0
# Unique per invocation, and the ONLY proof of ownership that survives a takeover.
# `HAVE_LOCK` records "I acquired the lock at some point", which stops being true the moment
# another contender's stale-recovery renames it out from under us — and an unconditional release
# keyed on that flag then deleted the NEW owner's lock, putting a third writer straight into the
# critical section. `$` alone is not enough: PIDs are reused, and a reused PID is exactly the
# case where a takeover must not be mistaken for continued ownership.
# Built from shell builtins only. An earlier revision spliced in `$(date +%s)`, which runs at
# LOAD time — before the `command -v jq` degradation check — so on a PATH without coreutils the
# hook died with 127 instead of degrading. `$$` plus three 15-bit draws is ample here: the token
# only has to distinguish concurrent hook processes on one machine.
LOCK_TOKEN="$$-${RANDOM}${RANDOM}${RANDOM}"

# Creation time of the lock DIRECTORY, as an age proxy for a lock whose owner record is not there
# yet. BSD (`-f %m`) and GNU (`-c %Y`) disagree on the flag, so try both; 0 on failure preserves the
# old "treat as ancient" reading rather than inventing a fresh lock.
_lockdir_mtime() {
  stat -f %m "$LOCKDIR" 2>/dev/null || stat -c %Y "$LOCKDIR" 2>/dev/null || echo 0
}

_lock() {
  local start end _takeovers
  # Optional 1st arg: override LOCK_TIMEOUT for this call only. Round-25 findings #2/#3: a
  # best-effort COMPENSATING release (one that exists only because an earlier write already
  # failed) has nothing left to fall back to if it also gives up at the default 5s — the reference
  # it was trying to close leaks with zero durable trace. A caller in that position passes a
  # longer budget so it keeps polling toward LOCK_TTL's own 30s stale-reclaim horizon instead of
  # giving up at an arbitrary fraction of it; ordinary (non-compensating) callers pass nothing and
  # keep the original 5s default — this is not a general slowdown of the lock.
  local timeout="${1:-$LOCK_TIMEOUT}"
  [[ "$timeout" =~ ^[0-9]+$ ]] || timeout="$LOCK_TIMEOUT"
  start=$(date +%s)
  # Bounded, because a lost takeover retries instead of returning. Without a cap, a lock directory
  # that can be inspected but not replaced (an unwritable parent, say) combined with
  # REVIEW_STATE_LOCK_TIMEOUT=0 — which the hook suites set — would spin the stale branch with no
  # sleep between attempts. Three is enough to lose a couple of genuine races and still converge.
  _takeovers=0
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge $timeout ]; then
      local lock_pid lock_ts now
      lock_pid=$(cat "$LOCKDIR/pid" 2>/dev/null || echo 0)
      lock_ts=$(cat "$LOCKDIR/ts" 2>/dev/null || echo 0)
      # Digit-validate BOTH before the arithmetic/kill below. `$(( ))` performs COMMAND
      # SUBSTITUTION inside an array subscript, so `ts` containing `a[$(...)]` is an EXECUTION
      # vector, not merely a wrong number — and `$LOCKDIR` is an ordinary directory in the working
      # tree that any process (a fanout worker, another tool) can create and populate. A
      # non-numeric value also silently aborts `[ ]` under `2>/dev/null`, which reads as "not
      # stale" and wedges the lock forever. Falling back to 0 is the safe reading: `now - 0`
      # is a huge age, so the TTL arm of the staleness test below fires and the lock is
      # reclaimed. Note it is the TTL arm ALONE that saves us here — `kill -0 0` SUCCEEDS
      # (signal 0 to PID 0 targets the caller's whole process group), so the PID arm reports
      # the bogus owner as ALIVE. Do not "simplify" this to rely on the PID check.
      [[ "$lock_pid" =~ ^[0-9]+$ ]] || lock_pid=0
      # ABSENT `ts` is not the same as CORRUPT `ts`, and conflating them was a live double-entry
      # race. `mkdir` returns before `pid`/`ts` are written, so a contender arriving inside that
      # window finds no `ts`, and the `|| echo 0` fallback made `now - 0` an age far past LOCK_TTL
      # — so it deleted a lock that had just been legitimately acquired and entered the critical
      # section alongside the owner. Two writers, one state file. With `REVIEW_STATE_LOCK_TIMEOUT=0`
      # the stale branch is reached on the FIRST failed mkdir, so the window was always open.
      # A missing `ts` therefore falls back to the lock DIRECTORY's own mtime: ~now for a lock
      # mid-acquisition (not stale), genuinely old for an owner that died between the two steps
      # (still reclaimable after the TTL, so nothing wedges). A `ts` file that EXISTS but is
      # non-numeric keeps the old 0 reading — that one really is corrupt.
      if [[ ! -f "$LOCKDIR/ts" ]]; then
        lock_ts=$(_lockdir_mtime)
      fi
      [[ "$lock_ts" =~ ^[0-9]+$ ]] || lock_ts=0
      now=$(date +%s)
      # Stale recovery: TTL expired OR owner PID dead
      if [ $((now - lock_ts)) -ge $LOCK_TTL ] || ! kill -0 "$lock_pid" 2>/dev/null; then
        # Take the stale lock over by RENAMING it aside, never by deleting it in place.
        # `rm -rf` followed by `mkdir` is two steps with a gap between them: two contenders that
        # both judged the lock stale would both delete — the second erasing the first's freshly
        # created lock — and both `mkdir` successfully, putting two writers in the critical
        # section at once. A rename to a process-unique tombstone is a single atomic operation,
        # so exactly one contender can win it; the losers get ENOENT and fall back into the
        # normal contention loop instead of forcing their way in.
        local _tomb="${LOCKDIR}.stale.$$.${RANDOM}"
        if mv "$LOCKDIR" "$_tomb" 2>/dev/null; then
          rm -rf "$_tomb" 2>/dev/null || true
          mkdir "$LOCKDIR" 2>/dev/null && break
        fi
        # Lost the takeover race, or a winner already recreated the lock. Retry from the top
        # rather than returning: a contender that lost by microseconds has not been refused, it
        # has simply met a live lock, and the next iteration re-reads it as exactly that.
        _takeovers=$((_takeovers + 1))
        [ "$_takeovers" -ge 3 ] && return 1
        start=$(date +%s)
        continue
      fi
      return 1  # fail-closed
    fi
    sleep 0.1
  done
  # `2>/dev/null || true`, matching _nit_lock. Under `set -euo pipefail` a failed redirect
  # here aborts AFTER mkdir succeeded but BEFORE HAVE_LOCK=1, so the EXIT trap's _unlock is a
  # no-op (it is guarded on HAVE_LOCK) and the lock directory is orphaned until another
  # process's 30s TTL reclaims it — every writer in between degrades to its fallback path.
  echo "$$" > "$LOCKDIR/pid" 2>/dev/null || true
  date +%s > "$LOCKDIR/ts" 2>/dev/null || true
  printf '%s' "$LOCK_TOKEN" > "$LOCKDIR/owner" 2>/dev/null || true
  HAVE_LOCK=1
}

# True only when the lock directory ON DISK right now is the one THIS process acquired.
# Every destructive or committing action keyed on "I hold the lock" must ask this, not HAVE_LOCK.
_own_lock() {
  [ "$HAVE_LOCK" -eq 1 ] || return 1
  [ "$(cat "$LOCKDIR/owner" 2>/dev/null || echo)" = "$LOCK_TOKEN" ]
}

_unlock() {
  # Ownership-checked. This used to `rm -rf` whatever lock happened to be present, so a process
  # whose lock had already been taken over deleted its successor's lock on the way out — a third
  # writer then walked straight in. Releasing nothing is the safe failure: an orphaned lock is
  # reclaimed by the next contender via the TTL, a wrongly-released one is not recoverable.
  if _own_lock; then rm -rf "$LOCKDIR" 2>/dev/null || true; fi
  HAVE_LOCK=0
}

trap '_unlock' EXIT

# Stage a state rewrite INSIDE the lock directory, so that committing it is bound to still holding
# the lock by RENAME SEMANTICS rather than by a check.
#
# The problem this solves: `_own_lock` proves the lock was ours at the instant it ran, and stale
# recovery fires on AGE ALONE (the TTL arm never consults liveness), so a contender can displace a
# slow-but-alive owner mid-section. The displaced writer would then `mv` its staged file over the
# state while the new owner is inside its own critical section — one of the two verdicts is lost,
# and a lost BLOCKING verdict leaves the previous round's ✅ standing with no marker, which
# stop-guard reads as a satisfied gate. Re-checking ownership immediately before the `mv` only
# narrows that window; it is the same check-then-act shape as the lock itself.
#
# Staging inside `$LOCKDIR` closes it instead of narrowing it. Takeover is `mv "$LOCKDIR" "$_tomb"`
# — a single rename that carries the staged file away with the directory. The displaced writer's
# path no longer resolves, so its `[[ -s "$tmp" ]]` / `mv` fails with ENOENT and it takes the
# fail-closed branch (sidecar marker) instead of committing. There is no interval in which the file
# is both reachable and unowned, because the same atomic operation that transfers the lock also
# removes the only name the loser could commit through.
#
# `$LOCKDIR` is `${STATE_FILE}.lockdir`, a sibling of the state file, so the commit stays a same-
# filesystem rename. Cleanup is unchanged: `_unlock` removes the directory and anything left in it.
_lock_staging_file() {
  mktemp "$LOCKDIR/state.XXXXXX" 2>/dev/null
}

# Staging for `init_state_file`, whose correct placement depends on the CALLER, not on the function:
# five of its six call sites are inside the critical section and one (`update_aggregate_blocked`) is
# reached precisely BECAUSE `_lock` failed. Mirrors `_state_staging_file` in post-edit-format.sh.
_init_staging_file() {
  if [ "$HAVE_LOCK" -eq 1 ]; then
    # We took the lock, so the temp belongs inside it — a takeover then carries the temp away with
    # the lock directory and the later `mv` has nothing to rename, which is the whole placement
    # argument. `_own_lock` first so we never write into a critical section that is already the
    # contender's; failing here routes the caller to its own init-failed arm one step earlier.
    _own_lock || return 1
    _lock_staging_file
  else
    # UNLOCKED-WRITER: reached only when `_lock` FAILED, so `$LOCKDIR` is the contender's and
    # staging inside it is the intrusion the placement rule exists to prevent. Beside the state
    # file is correct here; the write is best-effort and the durable record is the `.blocked`
    # sidecar. Landing it can still discard the holder's transaction — a separate, pre-existing
    # defect deferred in
    # docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md.
    mktemp "${STATE_FILE}.XXXXXX" 2>/dev/null
  fi
}

# May this process rename onto $STATE_FILE? It owns the lock, or it never took one — the declared
# unlocked callers, whose write is best-effort by contract. Named rather than inlined so the commit
# stays a one-line `… && mv`, which is the shape both ownership tests anchor on; the same role
# `_may_commit_state` plays in post-edit-format.sh.
_may_init_commit() {
  [ "$HAVE_LOCK" -ne 1 ] || _own_lock
}

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
# Every hook event carries this, and stop-guard has always read it. It is read here for exactly one
# purpose — recovering the verdict of a review that was moved to the background (issue #10), whose
# report is delivered into the transcript and nowhere else. See § Backgrounded MCP review.
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
# This script is registered for BOTH PreToolUse and PostToolUse. The Pre branch exists only to pin
# the tree state at dispatch (§ Backgrounded MCP review); everything else in the file is Post-only,
# so the branch is taken late, after the function definitions it needs. Absent on replays of older
# fixtures, which is why it defaults to the Post behaviour rather than to an error.
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)
# PostToolUse input: official Claude Code v2.1.x spec uses `tool_response`;
# `tool_output` is kept as fallback for backward-compat with older replays.
# Bash returns structured `{stdout, stderr, interrupted, isImage}`; MCP returns
# `{content: string | [{type:"text", text}]}`; legacy replays may be plain string.
# Normalize all four shapes into a single text payload here.
#
# The fourth is a string that is itself a serialized JSON object — the shape the host actually
# sends for some synchronous MCP completions (issue #11). Left unparsed it stays one line
# beginning with `{`, its newlines still literal `\n`, so every start-of-line-anchored review
# matcher misses and the receipt is silently dropped. Unwrapping is deliberately conditional on
# the parsed object carrying a payload field we recognize: a review report that merely happens to
# begin with `{` parses to nothing (or to something without those fields) and passes through
# unchanged, so this can only add receipts, never reroute an output that already worked.
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '
  def unwrap:
    if (.stdout | type) == "string" then .stdout
    elif (.content | type) == "string" then .content
    elif (.content | type) == "array" then [.content[] | select(.type == "text") | .text] | join("\n")
    else tostring
    end;
  def has_payload:
    ((.stdout | type) == "string") or ((.content | type) == "string") or ((.content | type) == "array");
  (.tool_response // .tool_output) as $r
  | if ($r | type) == "object" then ($r | unwrap)
    # A BARE array of content blocks, with no wrapping object. Measured against a live handoff:
    # this is what the host actually sends — `[{"type":"text","text":"MCP tool …"}]`. Without this
    # branch such a payload falls through to `empty`, TOOL_OUTPUT is blank, and every branch below
    # is unreachable. That is how the issue #10 handling first shipped inert: it was verified
    # against `{content:[…]}` and the real shape was wrongly written off as a bad fixture.
    # `select(type == "object")` comes first because indexing a string element with `.type` is a jq
    # ERROR rather than a non-match, and a single stray element would void the whole payload.
    elif ($r | type) == "array" then
      ([$r[] | select((type) == "object" and .type == "text") | .text] | join("\n"))
    elif ($r | type) == "string" then
      (($r | try fromjson catch null) as $p
       | if ($p | type) == "object" then
           (if ($p | has_payload) then ($p | unwrap) else $r end)
         else $r
         end)
    else empty
    end // empty' 2>/dev/null)

# Bash `interrupted:true` = the command was killed/timed out before completing; its stdout may
# hold only a PARTIAL tail (e.g. a test's `## Overall: ✅ PASS` printed before the runner's own
# final summary). Parse it once here so the precommit branch can fail closed rather than record a
# truncated PASS as a passing gate. Absent field / non-object response → "false".
# The "false" fallback here only governs the VALID-JSON path (absent field / non-object response →
# false). On an INVALID-JSON INPUT it is never reached: under `set -euo pipefail` the FIRST jq
# assignment above (TOOL_NAME) is a bare `var=$(echo|jq)` whose failing pipeline is non-zero
# (pipefail), so set -e has already exited the hook (verified: exit 5) before this line — no verdict
# is recorded because the hook is gone, not because a downstream condition "failed to match" (strict
# iter-21 Nit corrects the earlier iter-12 rationale). The last-`## Overall:` FAIL-precedence remains
# the primary guard on the valid-JSON path.
TOOL_INTERRUPTED=$(echo "$INPUT" | jq -r '((.tool_response // .tool_output) | if type=="object" then (.interrupted == true) else false end)' 2>/dev/null)
[[ "$TOOL_INTERRUPTED" == "true" ]] || TOOL_INTERRUPTED="false"

# Only process Bash, MCP Codex, Skill — and TaskOutput, which is a recovery TRIGGER rather than a
# fourth content channel. It is listed here solely so it survives to the recovery call further down;
# the branch immediately after that call sends it straight back out, so it never reaches the routing
# below. Registering it in `hooks.json` without adding it here made the whole trigger inert, and
# invisibly: every recovery test drove the hook with `tool_name: "Bash"`.
if [[ "$TOOL_NAME" != "Bash" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex-reply" ]] && \
   [[ "$TOOL_NAME" != "Skill" ]] && \
   [[ "$TOOL_NAME" != "TaskOutput" ]]; then
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
# The function asserts no ownership of its own; it inherits the caller's. Five of six callers hold
# the shared lock — `update_state`, the three plan paths (`update_plan_state`,
# `_update_plan_iteration`, `update_plan_verdict`) and `update_aggregate_gate` ("call within lock")
# — and the sixth, `update_aggregate_blocked`, is reached precisely BECAUSE `_lock` failed. So both
# staging and commit branch on `$HAVE_LOCK` rather than picking one placement for both: see
# `_init_staging_file`, whose unlocked branch carries the `# UNLOCKED-WRITER:` declaration that
# test/hooks/state-commit-ownership.test.js reads.
#
# It is create-if-absent in INTENT only. temp + rename is crash-atomic REPLACEMENT — a reader never
# sees a truncated file — but `[[ ! -f ]]` followed by an overwriting `mv` is not atomic creation:
# two processes can both observe an absent file, and the loser's rename replaces whatever the winner
# has since written with the default document. Recorded, with the fix (hard-link publication treating
# EEXIST as success, or restricting this to locked callers), in
# docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md.
init_state_file() {
  if [[ ! -f "$STATE_FILE" ]]; then
    # R6: read project max_rounds override for initial value (fallback 30)
    local _mr _pmr
    _mr=$(_read_project_max_rounds 30)
    _pmr=$(_read_project_plan_max_rounds 5)
    # Crash-atomic replacement (NOT atomic create — see above): same-dir temp then rename, so a crash mid-write never
    # leaves a truncated state file that the jq readers (stop-guard etc.) would treat
    # as corrupt. mktemp co-locates the temp with the target so `mv` is a same-fs
    # rename, not a cross-device copy. The write AND its size-guard live in a single `if`
    # CONDITION so `set -euo pipefail` is suppressed for them: a bare `cat > tmp << EOF`
    # that fails (ENOSPC) would otherwise abort the hook BEFORE the guard runs, leaking an
    # orphan temp; here a failed cat (or an empty result) falls to `else` and is cleaned up
    # (fail-closed: no file rather than an empty one). Mirrors session-init.sh's writer.
    local _tmp
    _tmp=$(_init_staging_file) || return 1
    if cat > "$_tmp" << EOF && [[ -s "$_tmp" ]]; then
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
      # Ownership re-proved AT the rename, not at staging time: a locked caller can lose the lock to
      # a stale-recovery takeover in between, and this `mv` would then land the all-default document
      # over the new owner's initialized-and-updated state — every receipt, `has_code_change` and
      # `iteration_history` reset. The `|| { … }` arm is reached by BOTH a refused commit and a
      # failed rename (`mv` returns 0 or 1 and nothing else, so the usual `a && b || c` ambiguity
      # does not arise here), and both mean the same thing to the caller: no state file.
      _may_init_commit && mv "$_tmp" "$STATE_FILE" || {
        rm -f "$_tmp" 2>/dev/null || true
        return 1
      }
    else
      rm -f "$_tmp" 2>/dev/null || true
      return 1
    fi
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
  _read_project_int_setting "Max Rounds" "${1:-30}"
}

# Read plan-review max_rounds override (plan-review-loop OQ-10, default 5)
_read_project_plan_max_rounds() {
  _read_project_int_setting "Plan Review Max Rounds" "${1:-5}"
}

# Migrate state file to schema v2 (add iteration_history if missing).
# CONTENT-gated, not version-gated: a `ver < 2` guard alone cannot repair a state that already
# CLAIMS v2+ but was written without the subtree — which is exactly what session-init.sh emits
# (schema_version 2 carrying only session_commit_scope). Such a state slipped past this
# migration AND past the v3 plan migration (which delegates here first and then only adds
# plan_review), so iteration_history stayed absent for the entire session and the project
# `## Max Rounds` override was silently replaced by stop-guard's hardcoded `// 30` fallback.
_migrate_state_v2() {
  local state_file="${1:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0
  local ver has_iter
  ver=$(jq -r '.schema_version // 1' "$state_file" 2>/dev/null || echo 1)
  # Non-numeric schema_version → treat as v1 so the arithmetic compare below cannot abort the
  # hook under `set -e` (the v3 migration rejects such states separately).
  [[ "$ver" =~ ^[0-9]+$ ]] || ver=1
  # Read failure → "true" (assume present) so a transient jq error cannot trigger a rewrite.
  has_iter=$(jq -r 'has("iteration_history")' "$state_file" 2>/dev/null || echo "true")
  if [[ "$ver" -lt 2 || "$has_iter" != "true" ]]; then
    local tmp mr target
  # Every temp-file write in this hook must DEGRADE, never abort. Under `set -euo pipefail` a
  # failing `$(mktemp)` — ENOSPC, an unwritable dir, a `noexec`/missing coreutils PATH — takes the
  # WHOLE hook down mid-transaction. Reproduced with a stubbed failing mktemp: the hook exited 1
  # from here, so `_update_iteration` never ran and a completed review round went UNCOUNTED, which
  # starves the `current_round >= max_rounds` hard cap — row 1 of the convergence table and the
  # only enforced loop exit today. In other orderings the same abort skips a fail-closed sidecar
  # write. Both are silent: an aborted PostToolUse hook is not a gate the user sees fail.
    tmp=$(_lock_staging_file) || { echo "[Review State] _migrate_state_v2 skipped (mktemp unavailable)" >&2; return 0; }
    mr=$(_read_project_max_rounds 30)
    # Never DOWNGRADE: a v3 state that merely lacked the subtree keeps its version. The prior
    # unconditional `.schema_version = 2` would have rewound it and re-run the v3 migration.
    target=2
    [[ "$ver" -gt 2 ]] && target="$ver"
    # Size-guard + temp cleanup, matching every other writer in this file. Without the `-s` check
    # a jq that exits 0 having written nothing (or a truncated write on ENOSPC) renames an EMPTY
    # file over the state, which the jq readers — stop-guard included — then treat as corrupt.
    # Without the `rm -f` a failed jq leaks its temp beside the state file on every hook
    # invocation. This matters more now that the gate is CONTENT-based (`has_iter != true`), not
    # just `ver < 2`: it fires on every state session-init.sh creates, so the path is hot.
    if jq --argjson mr "$mr" --argjson sv "$target" '.schema_version = $sv
      | .iteration_history //= {"current_round": 0, "max_rounds": $mr, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}' \
      "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      _own_lock && mv "$tmp" "$state_file"
    else
      rm -f "$tmp"
    fi
  fi
}

# Keep `iteration_history.max_rounds` equal to what the project config resolves to.
#
# `_migrate_state_v2` only FILLS a missing `iteration_history` (`//=`), so a state that already
# has one keeps whatever cap it was born with — forever, across upgrades, because session-init.sh
# resets `current_round` but preserves `max_rounds`. Raising the shipped default therefore reached
# new installs only; every existing one stayed at the old value. Observed on this repo: a
# schema-v3 state still holding `max_rounds: 10` after the default moved to 30.
#
# The rule is that the project config is the source of truth and the state file caches it, so a
# divergence in either direction is corrected. That does mean a hand-edited budget in
# `.claude_review_state.json` does not survive — deliberate, and consistent with how the rest of
# the system treats that file (stop-guard clamps its cap to 3..50 rather than trusting it).
# `## Max Rounds` is the supported way to choose a cap.
#
# Two call sites, both inside an already-held lock. `update_state` calls it before its reset
# filter, which INTERPRETS the cap — and because this function's exit status is 0 unconditionally,
# that filter re-derives the resolved cap and resets only when the PERSISTED one already equals it.
# `_update_iteration` only increments counters, so it never interprets the cap and needs no such
# gate; it reconciles opportunistically because it already holds the lock. The plan-review plane
# deliberately has no call site: NFR-7 forbids a plan write from touching the root subtree, and
# `current_round` counts code-review rounds only.
_reconcile_max_rounds() {
  local state_file="${1:-$STATE_FILE}"
  [[ ! -f "$state_file" ]] && return 0
  local cur want tmp
  # EXACT congruence with stop-guard's accept/corrupt partition — both directions, neither is the
  # "safe" side. Repairing what it calls corrupt launders a fail-closed signal before the reader
  # sees it; refusing what it ACCEPTS leaves the cap stale and stop-guard then honours the stale
  # value. Both were live bugs.
  #
  # Congruence is not a jq-only property: stop-guard decides in TWO stages, jq emitting a pair and
  # a Bash `^[0-9]+[[:space:]][0-9]+$` regex judging it. So the SPELLING test below is applied to
  # stop-guard's CLAMPED value (<3 → 3, >50 → 50), which is what that regex actually sees — `1e2`
  # clamps to 50 and is accepted, while `4e1` and `30.0` keep their own spelling and are rejected.
  #
  # But what it EMITS is the raw cap, because three values are in play and only two are equal by
  # luck: persisted, clamped-effective, and configured. Emitting the clamped value made persisted
  # 100 compare equal to a configured 50 and suppressed its own repair, and `update_state()`'s
  # reset gate then compares the RAW persisted value — so round debt survived a precommit.
  # Pinned shape by shape against the extracted stop-guard filter in jq-filter-fidelity.test.js.
  cur=$(jq -r 'if (.iteration_history | type) == "null" then "absent"
    elif (.iteration_history | type) != "object" then "corrupt"
    elif (.iteration_history.max_rounds == null) then "absent"
    else ((.iteration_history.max_rounds | numbers
    | select((floor == .) and . >= 1 and . <= 100000)
    | select((if . < 3 then 3 elif . > 50 then 50 else . end) | tostring | test("^[0-9]+$"))
    | floor) // "corrupt")
    end' "$state_file" 2>/dev/null || echo "corrupt")
  # absent  — parent null/missing, or present but capless. Materialised below. Migration cannot
  #           reach these: it gates on has("iteration_history"), true for an explicit null, and its
  #           //= fills only a MISSING subtree. Left unwritten, stop-guard substitutes its own
  #           default and an explicit LOWER `## Max Rounds` silently buys a bigger budget than the
  #           config grants (reproduced: cap 5 read as 5/30, and as 5/50 via a `1e2` literal).
  # corrupt — exactly what stop-guard rejects, across both its stages.
  # integer — the PERSISTED cap, canonicalised (`1e2` → 100). Compared against the configured cap,
  #           so a persisted value stop-guard would clamp still gets rewritten to the real setting.
  case "$cur" in
    absent) ;;
    ''|corrupt|*[!0-9]*) return 0 ;;
  esac
  want=$(_read_project_max_rounds 30)
  # "absent" never equals a numeric $want, so the repair path always reaches the write below.
  [[ "$want" == "$cur" ]] && return 0
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] _reconcile_max_rounds skipped (mktemp unavailable)" >&2; return 0; }
  # `_own_lock && mv` on ONE line: an ownership check in the `if` condition proves ownership at
  # that moment, not at the `mv`. Enforced structurally by the "EVERY locked state rewrite" test.
  # `//` materialises the subtree when the parent is null or missing, then sets the cap; on an
  # existing object the `//` is a no-op and every sibling counter survives untouched.
  if jq --argjson mr "$want" '.iteration_history = ((.iteration_history // {"current_round": 0, "findings_by_round": [], "total_rounds_session": 0, "strategic_reset_fired": false}) | .max_rounds = $mr)' \
    "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$state_file" 2>/dev/null; then
    :
  else
    rm -f "$tmp" 2>/dev/null || true
  fi
  # UNCONDITIONAL success. This is a cache refresh, not a verdict: a failed one costs a stale cap
  # until the next invocation, whereas a nonzero return from a BARE call under `set -euo pipefail`
  # aborts the whole hook — in `_update_iteration`'s case after the lock is taken and before the
  # round is counted, which silently starves the hard cap. Callers must not have to remember
  # `|| true`; the contract lives here.
  return 0
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
  # DELIBERATELY no _reconcile_max_rounds here, in either arm. NFR-7 forbids a plan-plane write
  # from touching the ROOT iteration_history, and `current_round` counts code-review rounds only
  # (rules/auto-loop.md § Exit Conditions), so a plan-only session has no reader for the root cap
  # to be stale for. The code-review and precommit planes reconcile it on their own paths.
  if [[ "$ver" -eq 3 ]]; then return 0; fi
  if [[ "$ver" -gt 3 ]]; then
    echo "[Review State] plan migration skipped: schema_version=$ver is newer than this hook supports" >&2
    return 1
  fi
  # Ensure v2 invariants (iteration_history) exist before the v3 additive step
  _migrate_state_v2 "$state_file"
  local pmr tmp
  pmr=$(_read_project_plan_max_rounds 5)
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] _migrate_state_plan_review skipped (mktemp unavailable)" >&2; return 0; }
  if jq --argjson pmr "$pmr" '. + {plan_review: (.plan_review // {"executed": false, "passed": false, "degraded": false, "skipped": false, "status_reason": null, "tier": null, "last_run": "", "iteration_history": {"current_round": 0, "max_rounds": $pmr, "findings_by_round": [], "total_rounds_session": 0}, "history": []})}
      | .schema_version = 3' \
    "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$state_file"
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Review State] plan migration failed (jq write)" >&2
  fi
}

# Clear the `.blocked` fail-closed marker ONLY from the plane that OWNS it, and only when the
# owning operation actually committed. Ownership table, set semantics, and the clearer/setter
# serialization protocol (dedicated sidecar lock, asymmetric fallback): see
# docs/features/auto-loop-evolution/4-implementation.md §3.1, §3.6, §3.7.
#
# $1 = the marker reason this caller is entitled to clear.
# The sidecar holds a SET of reasons, one per line, not a single value.
SIDECAR_LOCKDIR="${STATE_FILE}.blocked.lockdir"
SIDECAR_LOCK_TTL=30
# Process-wide CUMULATIVE spin budget, spent across every `_sidecar_lock` call this hook makes.
#
# The per-call budget below bounds ONE wait; nothing bounded the SUM, and the sum is what gets spent
# against the STATE lock's `LOCK_TTL` — setters call the sidecar lock from inside it. That is not a
# hypothetical: a transaction with four failing writes at the old 70-spin budget measured 29.95s
# against `LOCK_TTL=30`, ran itself to its own takeover threshold, and manufactured the displacement
# the ownership checks then have to defend against. Cutting the per-call budget to 20 made that
# transaction cheap but left the shape intact — N calls x 20 spins is still unbounded in N, and N is
# decided by how many sidecar mutations a transaction happens to make. A lock-contended edit with
# four failing writes reaches this five times today.
#
# Capping the TOTAL makes "a transaction cannot spin itself to its own lock's TTL" true by
# CONSTRUCTION rather than by a measurement over whichever transactions someone thought to enumerate.
# Exhausting it costs nothing that is not already safe: a caller that gets zero spins takes the same
# fallback it takes on any timeout — clearers DECLINE (retaining the marker set), setters write a
# private per-event marker. Both are fail-closed. An UNCONTENDED acquisition is unaffected at any
# budget, including zero, because the loop attempts `mkdir` before it ever spins.
SIDECAR_TOTAL_SPINS=100
_SIDECAR_SPENT_SPINS=0
# Per-process capability token, minted exactly as the state lock mints its own — `$` alone is
# not enough (PIDs recycle), and this token is what turns the unlock below from "delete whatever
# lock is here" into "delete the lock only if it is still mine".
#
# SHELL BUILTINS ONLY, deliberately. This line runs at LOAD time, before the `command -v jq`
# degradation check, so a `$(date +%s)` here would kill the hook with 127 on a PATH without
# coreutils instead of letting it degrade — the same trap the state lock's LOCK_TOKEN comment
# records having already fallen into once.
SIDECAR_LOCK_TOKEN="$$-${RANDOM}${RANDOM}${RANDOM}"
_sidecar_own_lock() {
  [ "$(cat "$SIDECAR_LOCKDIR/owner" 2>/dev/null || echo)" = "$SIDECAR_LOCK_TOKEN" ]
}
# The exact bytes a keep-list was computed from, so the destructive step below can decline when
# they have moved. Holding the lock is NOT the same as "nobody is writing", and there were TWO
# unserialized setters, not one. The first could not take the lock and appended anyway; on timeout it
# now creates a private `.blocked.event.*` sibling instead (see `_set_own_sidecar`). The second is
# subtler and outlived the first fix: a setter that DID acquire the lock and was then displaced —
# `_sidecar_lock` reclaims on age alone, and setters run inside the state lock, whose TTL is the same
# 30s — went on to append without ever re-reading the owner token. `_set_own_sidecar_locked` now
# re-checks ownership immediately before its first mutating statement and returns rc=3 to divert.
# With both gone the shared file has no unserialized writers left, and this comparison is what makes
# that argument SUFFICIENT rather than merely narrow. It still catches a displaced owner in the
# residual window between that check and the write, which is why it is kept rather than retired.
# Command substitution strips trailing newlines from both the snapshot and the re-read, so the
# comparison is on the same normalization at both ends.
_sidecar_snapshot() {
  cat "${STATE_FILE}.blocked" 2>/dev/null || true
}
_sidecar_lock() {
  # Optional spin budget (default 20 × 0.1s ≈ 2s). EVERY caller now uses that budget. Setters
  # briefly passed 70 to out-wait session-init's `timeout 5` tree scan, because their timeout used
  # to mean an UNSERIALIZED append to the shared file — the one window in which a clearer could
  # compute a keep-list, miss the append, and commit over it. That trade no longer exists: the
  # last-resort path writes a per-event marker instead, which no clearer can retire without naming
  # it (see `_sidecar_emergency_mark`). Timing out is now harmless, so waiting longer buys nothing.
  #
  # The long budget was not merely unnecessary, it was a hazard. Setters call this INSIDE the state
  # lock, whose `LOCK_TTL` is 30s; a transaction with four failing writes waited 4 x 7s, measured at
  # 29.95s — running itself to its own takeover threshold and manufacturing the displacement the
  # ownership checks then have to defend against. That relationship between the three constants is
  # derived, not restated, in test/hooks/post-edit-format.test.js.
  #
  # Clearers keep this budget for the reason they always did: on timeout they DECLINE, which is
  # already the safe answer, and waiting longer only delays a session start with nothing to gain.
  local _sc_max_spins="${1:-20}"
  # Clamp this call's budget to what is left of the process-wide total. Deliberately clamps rather
  # than refuses: the `mkdir` below still runs, so an uncontended lock is still acquired once the
  # budget is gone — only the WAITING is capped.
  local _sc_left=$(( SIDECAR_TOTAL_SPINS - _SIDECAR_SPENT_SPINS ))
  [ "$_sc_left" -lt 0 ] && _sc_left=0
  [ "$_sc_max_spins" -gt "$_sc_left" ] && _sc_max_spins="$_sc_left"
  local i=0 lock_ts now _tomb
  while ! mkdir "$SIDECAR_LOCKDIR" 2>/dev/null; do
    # Stale reclamation, same protocol as the main lock: an absent `ts` means a holder is
    # mid-acquisition (it writes the stamp AFTER mkdir returns), so fall back to the directory's
    # own mtime rather than to 0 — reading a just-acquired lock as infinitely old would let a
    # contender take it out from under its owner.
    if [[ ! -f "$SIDECAR_LOCKDIR/ts" ]]; then
      lock_ts=$(stat -f %m "$SIDECAR_LOCKDIR" 2>/dev/null || stat -c %Y "$SIDECAR_LOCKDIR" 2>/dev/null || echo 0)
    else
      lock_ts=$(cat "$SIDECAR_LOCKDIR/ts" 2>/dev/null || echo 0)
    fi
    [[ "$lock_ts" =~ ^[0-9]+$ ]] || lock_ts=0
    now=$(date +%s)
    if [ $((now - lock_ts)) -ge $SIDECAR_LOCK_TTL ]; then
      # Take the stale lock over by RENAMING it aside, never by deleting it in place — the main
      # state lock learned this first and the sidecar lock was left behind on the old shape.
      # `rm -rf` then `mkdir` is two steps with a gap: two contenders that both judged the lock
      # stale both delete (the second erasing the first's freshly created lock) and both `mkdir`
      # successfully, putting two writers in the section at once. That is not academic here — the
      # section it guards is what decides whether a lost-verdict marker survives. A rename to a
      # process-unique tombstone is a single atomic operation, so exactly one contender wins it and
      # the losers fall back into the ordinary contention loop.
      _tomb="${SIDECAR_LOCKDIR}.stale.$$.${RANDOM}"
      if mv "$SIDECAR_LOCKDIR" "$_tomb" 2>/dev/null; then
        rm -rf "$_tomb" 2>/dev/null || true
        if mkdir "$SIDECAR_LOCKDIR" 2>/dev/null; then
          date +%s > "$SIDECAR_LOCKDIR/ts" 2>/dev/null || true
          printf '%s' "$SIDECAR_LOCK_TOKEN" > "$SIDECAR_LOCKDIR/owner" 2>/dev/null || true
          return 0
        fi
      fi
    fi
    i=$((i + 1))
    # Bounded spin, no `date` arithmetic. The default budget assumes the section is two greps and a
    # rename; a caller whose contender may hold the lock across something slower passes its own.
    # Exceeding the budget means the holder is wedged or slower than advertised, and the caller's
    # fallback — decline, or write a private per-event marker — is safe in exactly that case.
    [ "$i" -ge "$_sc_max_spins" ] && return 1
    # Charged against the process total BEFORE sleeping, so the counter reflects time actually
    # about to be spent. NOT `local` — it is the shared counter. A `_sidecar_lock` reached from
    # inside a command substitution would spend from a subshell copy and lose the charge; no caller
    # does that today, and the failure direction if one appears is under-counting (more total
    # waiting), which the structural bound below is sized to absorb rather than to forbid.
    _SIDECAR_SPENT_SPINS=$(( _SIDECAR_SPENT_SPINS + 1 ))
    sleep 0.1
  done
  date +%s > "$SIDECAR_LOCKDIR/ts" 2>/dev/null || true
  printf '%s' "$SIDECAR_LOCK_TOKEN" > "$SIDECAR_LOCKDIR/owner" 2>/dev/null || true
  return 0
}
_sidecar_unlock() {
  # Ownership-checked, mirroring `_unlock`. A blind `rm -rf` meant a process whose lock had
  # already been taken over deleted its SUCCESSOR's lock on the way out, and a third writer then
  # walked straight in — the takeover fix above would have been undone by the release path.
  # Releasing nothing is the safe failure: an orphaned lock is reclaimed by the next contender via
  # the TTL, a wrongly released one is not recoverable.
  if _sidecar_own_lock; then rm -rf "$SIDECAR_LOCKDIR" 2>/dev/null || true; fi
}

# --- Per-event emergency markers ---------------------------------------------------------------
# Sibling files `<state>.blocked.event.<stem>`, written when the shared `.blocked` file cannot be
# safely appended (lock timeout, displaced owner, unwritable path). Why the private-name design,
# the symlink security boundary of sibling-files-not-a-directory, and the coarse
# session-init-only retirement: see docs/features/auto-loop-evolution/4-implementation.md §3.1–§3.4.
SIDECAR_EVENT_PREFIX="${STATE_FILE}.blocked.event."

# Is this path a marker THIS plane could have written?
#
# `-f` alone follows symlinks, which is wrong in both directions: a planted link would have its
# target's bytes read into the marker set (a disclosure, and a wrong reason string), and it would
# count as evidence of a lost verdict that never happened. `! -L` rejects it. Such a link is then
# inert rather than removed — unlinking something this hook did not create is not its business, and
# leaving it costs nothing because it never counts.
_sidecar_is_marker() {
  [[ -f "$1" && ! -L "$1" ]]
}

# Record a marker WITHOUT touching the shared file. Staged under a DIFFERENT suffix and renamed into
# place: the readers below glob `.blocked.event.*`, which the staging name does not match, so a
# half-written marker is never observable. A torn line would classify as an unknown reason and
# escalate — safe, but it would report the wrong cause, and "the marker says something we do not
# recognise" is the hardest state to debug. Returns non-zero so the caller can fall back to its own
# CRITICAL log.
_sidecar_emergency_mark() {
  local reason="$1"
  local stem="$$-${RANDOM}${RANDOM}${RANDOM}"
  local tmp="${STATE_FILE}.blocked.staging.${stem}"
  printf '%s\n' "$reason" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null || true; return 1; }
  mv "$tmp" "${SIDECAR_EVENT_PREFIX}${stem}" 2>/dev/null || { rm -f "$tmp" 2>/dev/null || true; return 1; }
  return 0
}

# Round-26 finding #5: claims and removes ONE per-event marker whose body is exactly `$1` — same
# rename-wins-once claim `_lock`'s stale-takeover uses (a specific source path can only be `mv`'d
# away by one caller; a second `mv` on an already-moved name fails ENOENT), so concurrent
# consumers cannot double-claim the same marker. Returns 0 only when a marker was actually
# claimed. Lock-free by construction, matching `_sidecar_emergency_mark` — a caller using this has
# typically already failed to get the state lock once.
_sidecar_consume_marker() {
  local want="$1" f body tomb
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" || continue
    body=$(cat -- "$f" 2>/dev/null || true)
    [[ "$body" == "$want" ]] || continue
    # Round-27 finding #5: the old tombstone (`${f}.consumed.…`) still started with
    # `SIDECAR_EVENT_PREFIX`, so it stayed inside the very glob this loop (and every reader) scans —
    # a second concurrent consumer could claim the tombstone itself before `rm -f` ran, and both
    # callers would believe they exclusively consumed the same logical marker. `.blocked.staging.`
    # is this file's own established out-of-namespace prefix (see `_sidecar_emergency_mark`); landing
    # the tombstone there removes it from every glob a reader or consumer uses.
    tomb="${STATE_FILE}.blocked.staging.consumed.$$-${RANDOM}${RANDOM}"
    mv "$f" "$tomb" 2>/dev/null || continue
    rm -f "$tomb" 2>/dev/null || true
    return 0
  done
  return 1
}

# Read-only counterpart to `_sidecar_consume_marker`: for every marker whose body is
# `${prefix}<digits>`, prints `<path><TAB><count>`, one per line — never removes anything. Round-30
# finding #1: `_clear_dispatch_epoch` used to DESTROY existing markers to learn their count before
# knowing whether it could re-represent that value anywhere — a call that drained, then failed BOTH
# the state transaction and its own replacement write, permanently lost a credit nothing else on
# disk recorded. Peeking instead lets the caller leave every marker untouched until the transaction
# it feeds has positively committed, so a total failure of the transaction or the write has nothing
# to lose: the untouched markers are still there for the next attempt. `^(0|[1-9][0-9]{0,14})$`
# bounds accepted counts to 15 digits (round-30 finding #2): unbounded-length digit strings reach
# bash's signed 64-bit `$(( ))` and can wrap to negative — 15 digits is orders of magnitude beyond
# any real dispatch count while staying far below where summing several such values could overflow.
_sidecar_peek_counted_markers() {
  local prefix="$1" f body cnt
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" || continue
    body=$(cat -- "$f" 2>/dev/null || true)
    case "$body" in
      "${prefix}"*) cnt="${body#"$prefix"}" ;;
      *) continue ;;
    esac
    [[ "$cnt" =~ ^(0|[1-9][0-9]{0,14})$ ]] || continue
    printf '%s\t%s\n' "$f" "$cnt"
  done
  return 0
}

# Consumes an EXACT marker path already validated by `_sidecar_peek_counted_markers` — used only
# once the value it represented has been folded into a successfully committed transaction. Same
# tombstone-rename mechanics as `_sidecar_consume_marker`.
_sidecar_consume_marker_path() {
  local f="$1" tomb
  _sidecar_is_marker "$f" || return 1
  tomb="${STATE_FILE}.blocked.staging.consumed.$$-${RANDOM}${RANDOM}"
  mv "$f" "$tomb" 2>/dev/null || return 1
  rm -f "$tomb" 2>/dev/null || true
  return 0
}

# Every sidecar line, shared file and per-event markers alike. A reader that consults only the
# shared file cannot see an emergency marker, and missing one is fail-OPEN — the single direction
# this whole plane exists to prevent.
_sidecar_read_all() {
  _sidecar_is_marker "${STATE_FILE}.blocked" && { cat -- "${STATE_FILE}.blocked" 2>/dev/null || true; }
  local f
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && { cat -- "$f" 2>/dev/null || true; }
  done
  return 0
}

# Presence across both planes. An unmatched glob leaves the literal pattern, which fails the
# regular-file test — so no `nullglob` dependency is introduced.
_sidecar_any() {
  _sidecar_is_marker "${STATE_FILE}.blocked" && return 0
  local f
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && return 0
  done
  return 1
}

# The per-event marker files, in the shell's sorted glob order, collected into the global array
# `_SIDECAR_MARKER_FILES`. Retirement is BY NAME from this list, never by a wildcard sweep: a
# marker created after the enumeration has a name the retiring loop never saw and survives by
# construction. A `rm -rf` of a containing directory would have reintroduced exactly the
# create-vs-destroy race these markers exist to remove, one level up — and, as the comment above
# records, a far worse one through a symlink.
#
# An ARRAY, never a newline-delimited string, and that is a security boundary rather than a style
# choice. A filename may legally contain a newline; serialized one-per-line and re-parsed with
# `read`, a single marker named `...blocked.event.x<newline>package.json` became TWO deletion
# targets — the second an arbitrary repository-relative path. The glob matched such a name, the
# clear unlinked `package.json` from the repository root, and the crafted marker survived to fire
# again next session. Same shape as the `.blocked.d/` symlink before it: the danger was never the
# delete, it was the parsing step that decided WHAT to delete. An array carries each name as one
# value from glob to `rm`, so there is no parsing step left to subvert.
#
# A global rather than a return value because bash cannot return an array and `local -n` is 4.3+ —
# these hooks run on the stock macOS bash 3.2, which has neither.
_SIDECAR_MARKER_FILES=()
_sidecar_marker_files() {
  _SIDECAR_MARKER_FILES=()
  local f
  for f in "${SIDECAR_EVENT_PREFIX}"*; do
    _sidecar_is_marker "$f" && _SIDECAR_MARKER_FILES+=("$f")
  done
  return 0
}

_set_own_sidecar() {
  local reason="$1"
  local sidecar="${STATE_FILE}.blocked"
  local _have_sc_lock=0
  # 20 spins (~2s), back down from 70. The long budget was bought to AVOID timing out: the
  # last-resort path used to append to the shared file unserialized, where a clearer that had
  # already read past that point erased it, so out-waiting session-init's `timeout 5` tree scan was
  # the only way to keep the marker. That is no longer the trade. The last-resort path now writes a
  # per-event marker, which no clearer can retire without naming it, so a timeout costs nothing and
  # waiting buys nothing.
  #
  # Reverting it is not merely tidy — 70 spins was actively harmful. This call runs INSIDE the state
  # lock, and a transaction with four failing writes waited 4 x 7s: measured at 29.95s against a
  # `LOCK_TTL` of 30, i.e. the transaction ran itself to the takeover threshold and manufactured the
  # displacement that the ownership checks then have to defend against. At 20 spins the same
  # transaction is bounded near 8s.
  _sidecar_lock 20 && _have_sc_lock=1
  if [[ "$_have_sc_lock" -eq 0 ]]; then
    # LAST RESORT — and deliberately NOT an append to the shared file any more. An unserialized
    # append is what the clearers' whole-file rewrite could erase: their final snapshot is a
    # subprocess, so a line landing after it returns and before the `rm`/`mv` was invisible and
    # then destroyed. A per-event marker cannot be, because retirement never names it. See
    # `_sidecar_emergency_mark`. Returning early also leaves the shared file with NO unserialized
    # writers at all, which is what makes the clearers' snapshot comparison sufficient.
    if _sidecar_emergency_mark "$reason"; then
      echo "[Review State] sidecar lock unavailable — recorded '$reason' as a per-event emergency marker (unretirable by a racing clearer)" >&2
      return 0
    fi
    echo "[Review State] CRITICAL: sidecar lock unavailable AND the per-event marker could not be written ('$reason') — this evidence is now only in the log" >&2
    return 1
  fi
  # Condition context, not a bare call: under `set -e` a bare `_set_own_sidecar_locked` returning
  # 1 (the ENOSPC path this function exists to report) would abort the hook HERE — skipping
  # `_sidecar_unlock` and leaking the lock directory for a full TTL, during which every other
  # sidecar mutation degrades to its unserialized fallback.
  local rc=0
  _set_own_sidecar_locked "$reason" "$sidecar" || rc=$?
  if [[ "$_have_sc_lock" -eq 1 ]]; then
    _sidecar_unlock
  fi
  # ANY nonzero rc — DIVERT, do not drop. A marker exists only because a blocking verdict was
  # already lost, and the per-event path lands under a name this process created, so diverting
  # costs nothing.
  #
  # Divert on rc=1 too, not just on the rc=2 symlink refusal. Treating only rc=2 as divertible read
  # as "an ordinary write failure means nothing can be written here", and that inference does not
  # hold: the shared file has one fixed name, so a DIRECTORY at that path makes `>>` fail with
  # EISDIR and return 1 while `_sidecar_emergency_mark` — which needs neither `mktemp` nor a lock,
  # only a sibling filename — would have succeeded right beside it. The marker was dropped anyway,
  # and the aggregate caller then read that as total persistence loss and escalated to `exit 2`
  # over a condition that was recoverable. The two rc values still differ in what they mean
  # (2 = must not be attempted here, 1 = was attempted and failed), so they keep separate
  # diagnostics; they no longer differ in whether the evidence is preserved.
  #
  # Diverting after the unlock is deliberate — `_sidecar_emergency_mark` takes no lock, and holding
  # one across it would only widen the window the last-resort path exists to avoid.
  if [[ "$rc" -ne 0 ]]; then
    local _why="shared sidecar write failed (rc=$rc)"
    if [[ "$rc" -eq 2 ]]; then
      _why="shared sidecar is a symlink — refused to append through it"
    elif [[ "$rc" -eq 3 ]]; then
      _why="sidecar lock was taken over before the append — refused to write the shared file unserialized"
    fi
    if _sidecar_emergency_mark "$reason"; then
      echo "[Review State] $_why; recorded '$reason' as a per-event marker instead" >&2
      return 0
    fi
    echo "[Review State] CRITICAL: $_why AND the per-event marker could not be written ('$reason') — this evidence is now only in the log" >&2
    return 1
  fi
  return 0
}

_set_own_sidecar_locked() {
  local reason="$1"
  local sidecar="$2"
  # `>>` FOLLOWS a symlink and appends into its TARGET. The shared sidecar has a fixed, gitignored
  # name, so a link committed at that path is armed the moment a repo is cloned — the same shape as
  # the `.blocked.d/` traversal this layout replaced, pointed the other way (write, not delete).
  # Return 2 rather than 1: the caller must be able to tell "this write failed" from "this write
  # must not be attempted here", because the second one is divertible and the first is not.
  if [[ -L "$sidecar" ]]; then
    return 2
  fi
  if [[ -f "$sidecar" ]] && grep -qxF "$reason" "$sidecar" 2>/dev/null; then
    return 0
  fi
  # Ownership re-check at the LAST moment before the first mutating write. Acquiring the lock is not
  # the same as still holding it: `_sidecar_lock`'s stale-reclamation arm lets a contender that
  # judges the lock expired rename it aside and take it, and setters run INSIDE the state lock,
  # where a slow transaction can drift past the 30s TTL — a displacement the setter itself can
  # manufacture. Appending here while displaced makes this an UNSERIALIZED writer on the shared
  # file, which is exactly the writer whose removal is what makes the clearers' snapshot comparison
  # sufficient rather than merely narrow. Both mutating statements below (the terminator fixup and
  # the append) sit behind this one check, so the file is left byte-identical on this path.
  #
  # Return 3 so the caller can DIVERT rather than drop: a per-event marker lands under a name this
  # process created, which no clearer can retire without having enumerated it.
  #
  # Still check-then-act, and deliberately so. A takeover between this test and the `>>` is the same
  # residual the state lock's own pre-commit re-check carries; this narrows the window from "the
  # whole transaction" to two adjacent statements, it does not close it.
  if ! _sidecar_own_lock; then
    return 3
  fi
  # Normalize the terminator before appending. Every sidecar written before this file became
  # line-based — and every legacy one still on disk — was produced by `echo "$reason" >` with no
  # trailing newline, so a bare `>>` concatenated the two reasons into a single nonsense line
  # (`edit_lock_contentionverdict_write_failed:code_review`). That is worse than the overwrite it
  # replaced: NEITHER reason then matches `grep -xF`, so no plane can ever retire the marker and it
  # latches for the rest of the session. `$(tail -c 1)` strips a trailing newline, so a non-empty
  # result means the last byte was NOT one.
  if [[ -s "$sidecar" ]] && [[ -n "$(tail -c 1 "$sidecar" 2>/dev/null)" ]]; then
    printf '\n' 2>/dev/null >> "$sidecar" || return 1
  fi
  # `2>/dev/null` BEFORE the append, not after. Redirections are applied left to right, and the
  # failure this guards (a directory at the shared path — see `_set_own_sidecar`'s rc=1 divert)
  # happens while OPENING the file, i.e. before a trailing `2>/dev/null` is in effect. Written the
  # other way round the shell's own "Is a directory" diagnostic reached stderr raw, so the redirect
  # that was there to keep this path quiet did not actually cover the one case it exists for.
  echo "$reason" 2>/dev/null >> "$sidecar" || return 1
  return 0
}

_clear_own_sidecar() {
  local owned="$1"
  local sidecar="${STATE_FILE}.blocked"
  # Not `-f`: that follows a symlink, and the retain-branch below prints the file it read to
  # stderr. A link planted here would have disclosed an arbitrary file into the hook log.
  _sidecar_is_marker "$sidecar" || return 0
  # Decline rather than race. Every state this function can leave behind by doing nothing is
  # SAFER than the one it can leave behind by acting on a stale read.
  if ! _sidecar_lock; then
    echo "[Review State] sidecar lock unavailable — retaining marker rather than clearing on a possibly stale read" >&2
    return 0
  fi
  # Re-read INSIDE the lock: the membership test and the rewrite must see the same file, and the
  # caller's `-f` probe above happened before we held it.
  if ! _sidecar_is_marker "$sidecar"; then
    _sidecar_unlock
    return 0
  fi
  if ! grep -qxF "$owned" "$sidecar" 2>/dev/null; then
    echo "[Review State] sidecar retained ($(tr "\n" "," < "$sidecar" 2>/dev/null)) — not this plane's marker to clear" >&2
    _sidecar_unlock
    return 0
  fi
  # Snapshot the bytes the keep-list is about to be derived from; every destructive step below
  # re-reads and declines if they moved (see `_sidecar_snapshot`).
  local _sc_before
  _sc_before=$(_sidecar_snapshot)
  local rest
  # `|| true` here was a fail-OPEN, and an unusually expensive one: an EMPTY keep-list is the signal
  # to DELETE the whole sidecar, and grep reports "no lines selected" (rc 1) and "I could not run"
  # (rc >1: unreadable file, a broken PATH, a shim that exits 2) through the same non-zero channel.
  # Flattening both to `rest=""` meant any grep FAILURE deleted every marker in the file — including
  # the OTHER plane's, and including markers standing in for verdicts that really were lost. Only
  # rc 1 legitimately means "everything here is superseded". The twin in post-edit-format.sh was
  # repaired first; this copy kept the `|| true`, which is the failure mode a copied function has:
  # the fix travels only as far as someone remembers to carry it.
  local _grep_rc=0
  rest=$(grep -vxF "$owned" "$sidecar" 2>/dev/null) || _grep_rc=$?
  if [[ "$_grep_rc" -gt 1 ]]; then
    echo "[Review State] sidecar filter failed (grep rc=$_grep_rc) — retaining the full marker set rather than deleting on a keep-list that was never computed" >&2
    _sidecar_unlock
    return 0
  fi
  if [[ -z "$rest" ]]; then
    # Ownership re-checked at the destructive step. This section is short — a couple of greps and a
    # rename — but "short" is not "atomic": SIGSTOP, a descheduled process on a loaded box, a slow
    # network filesystem, or a backwards wall-clock adjustment (the TTL compares `date +%s`
    # stamps, so a clock jump can make a lock ten seconds old read as stale) all put a contender
    # inside while we are still here. Deleting the sidecar after being displaced would destroy the
    # successor's evidence of a lost verdict, so the delete declines instead.
    if ! _sidecar_own_lock; then
      echo "[sidecar] clear abandoned — lock was taken over mid-section; marker retained" >&2
    elif [[ "$(_sidecar_snapshot)" != "$_sc_before" ]]; then
      # Optimistic concurrency, because holding the lock does not mean nobody wrote. This guarded
      # two unserialized setters, both since removed: one that timed out and appended to the SHARED
      # file anyway (it now writes a private `.blocked.event.*` sibling), and one that acquired the
      # lock, was displaced, and appended without re-reading the owner token (`_set_own_sidecar_locked`
      # now re-checks). The comparison stays as defence in depth — it is what makes the "no
      # unserialized writers" argument SUFFICIENT rather than merely narrow, and it still catches a
      # displaced-owner write in the residual window. Declining keeps evidence of a lost verdict.
      echo "[sidecar] clear abandoned — the marker set changed after the keep-list was computed; retaining it" >&2
    else
      rm -f "$sidecar" 2>/dev/null || true
    fi
  else
    # temp+rename in the SAME directory, so a concurrent stop-guard read sees either the old set
    # or the new one — never a truncated file mid-rewrite, which would read as zero reasons and
    # (before the seen-counter in stop-guard) classify as transient.
    local _sc_tmp
    # Staged INSIDE the lock directory, so the rename that hands the lock to a contender carries
    # this file away and the commit below can no longer resolve it — the same structural binding
    # `_lock_staging_file` gives the state writes, rather than a check that can go stale.
    _sc_tmp=$(mktemp "${SIDECAR_LOCKDIR}/rewrite.XXXXXX" 2>/dev/null) || _sc_tmp=""
    if [[ -n "$_sc_tmp" ]] && printf '%s\n' "$rest" > "$_sc_tmp" 2>/dev/null && [[ -s "$_sc_tmp" ]] \
       && _sidecar_own_lock && [[ "$(_sidecar_snapshot)" == "$_sc_before" ]]; then
      mv "$_sc_tmp" "$sidecar" 2>/dev/null || rm -f "$_sc_tmp" 2>/dev/null || true
    else
      [[ -n "$_sc_tmp" ]] && rm -f "$_sc_tmp" 2>/dev/null || true
      # Two distinct failures land here and they are worth telling apart in the log: staging never
      # succeeded, or it did and the lock was taken over before the commit. Either way the full set
      # stays — retaining our own line too is the fail-closed choice, and a truncating in-place
      # `>` here could empty the file entirely.
      if [[ -n "$_sc_tmp" ]] && ! _sidecar_own_lock; then
        echo "[Review State] sidecar rewrite abandoned — lock was taken over mid-section; retaining full marker set" >&2
      elif [[ -n "$_sc_tmp" ]] && [[ "$(_sidecar_snapshot)" != "$_sc_before" ]]; then
        echo "[Review State] sidecar rewrite abandoned — the marker set changed after the keep-list was computed; retaining full marker set" >&2
      else
        echo "[Review State] sidecar rewrite unavailable — retaining full marker set" >&2
      fi
      _sidecar_unlock
      return 0
    fi
    echo "[Review State] sidecar retained ($(printf '%s' "$rest" | tr "\n" ",")) — other planes still hold markers" >&2
  fi
  _sidecar_unlock
  return 0
}

# A DROPPED verdict is only fail-closed in one direction.
#
# Skipping the write when the new verdict is a PASS is safe: the gate stays unsatisfied and keeps
# asking. Skipping it when the new verdict is BLOCKING is the opposite — the file keeps whatever
# was there before, and what is there before a ⛔ is very often the ✅ from the previous round (a
# late secondary reviewer, or a re-review after a fix, both write a blocking verdict over a passing
# one with no intervening edit, so the edit-plane invalidation never runs). stop-guard then reads
# `passed: true`, sees no marker, and allows the stop — the blocking verdict evaporated silently.
#
# So a lost BLOCKING verdict raises the fail-closed sidecar. A lost passing verdict does not: it is
# already fail-closed, and raising a marker there would block on nothing.
_verdict_write_failed() {
  local key="$1" passed="$2" why="$3"
  if [[ "$passed" != "false" ]]; then
    # No sidecar for a lost PASS — the gate is already unsatisfied, so a marker would block on
    # nothing. But say so. Callers print an unconditional `<key> updated: passed=…` line, so
    # without this the one case where a verdict silently failed to persist looked, in the log,
    # exactly like the case where it persisted — the same defect already fixed one function over
    # for the aggregate plane.
    echo "[Review State] ${key} verdict NOT recorded (${why}) — gate stays unsatisfied and will be re-requested" >&2
    return 0
  fi
  # Keyed by gate — see the ownership table above for why an unkeyed marker fails open.
  _set_own_sidecar "verdict_write_failed:${key}" \
    || echo "[Review State] CRITICAL: blocking ${key} verdict lost (${why}) AND its .blocked sidecar could not be written — the review gate may FAIL-OPEN" >&2
  echo "[Review State] blocking ${key} verdict not recorded (${why}) — sidecar set, gate held closed" >&2
  return 0
}

# Update state file (acquires lock for consistency with aggregate_gate writes)
update_state() {
  local key="$1"
  local executed="$2"
  local passed="$3"
  # Optional 4th arg: which variant of the gate produced this verdict (currently only
  # precommit uses it — "full" / "fast" / "unknown"). Written as `.<key>.mode` so the state
  # file records WHICH gate passed, not merely THAT one did. Empty = leave the field alone,
  # so every existing 3-arg caller is byte-identical to before.
  local mode="${4:-}"
  # Optional 5th/6th args: background-review markers to retire IN THIS SAME LOCK SECTION as the
  # receipt. Consuming under a separate lock and then writing was not enough — it only refused a
  # marker removed BEFORE the consume. The other ordering still lost a verdict: recovery consumes
  # marker A, a concurrent foreground review banks `⛔ Blocked`, recovery then writes A's older
  # `✅ Ready` over it, every write succeeding and no sidecar raised. One lock section makes the two
  # orderings the only outcomes — the foreground verdict either precedes the check (which then
  # fails) or follows the write (and correctly wins).
  #
  # A non-empty `$ct` retires a marker task-scoped — exactly the (task, plane) pair this call is
  # banking a verdict for (the recovery path). `$cp` alone (task empty) is the FOREGROUND path: it
  # sweeps every marker left on the whole plane, dedup-counted by task, plus `$release_self`, then
  # calls the shared `retire_dispatch_epoch($p; $n)` (defined by `_DISPATCH_EPOCH_RETIRE_DEF`,
  # prepended ahead of this whole jq program below — see its own comment for why a `def` rather than
  # a text splice).
  #
  # Round-23 finding P1#1: this used to be split across TWO locked transactions — this filter wrote
  # the receipt, then a SEPARATE call to the (now-deleted) `_clear_background_reviews` swept the
  # plane under its OWN lock right after. The gap between the two commits was a real window: a
  # foreground `⛔ Blocked` could commit here while a stray marker for the same plane still stood,
  # a concurrent recovery could then acquire the lock in that gap, see the marker, consume it, and
  # overwrite the fresh `⛔ Blocked` with its own older `✅ Ready` — every write succeeding, no
  # sidecar raised, the exact false-accept the 5th/6th-arg mechanism above was built to close for
  # the TASK-SCOPED case and had never closed for the PLANE-WIDE one. Folding the sweep into this
  # SAME jq program, under this SAME lock, closes it the same way: the foreground verdict and the
  # marker sweep it supersedes now either both land in this write or neither does.
  #
  # Round-25 finding #1: `$present` is re-derived FRESH inside this SAME jq read, not trusted from
  # the separate, earlier precondition check above — see
  # docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md § 4.2.6.
  local consume_task="${5:-}" consume_plane="${6:-}"
  # 7th arg: does THIS call's own resolving dispatch also owe a release, on top of whatever pending
  # background markers the plane-wide sweep removes? `true` only from the two MCP-foreground-verdict
  # sites (an MCP dispatch earns its own PreToolUse increment); `false` (the default) from the two
  # legacy Bash/Skill sites, which `hooks.json` never registers for PreToolUse tracking and so own
  # nothing to release. See the plane-wide branch below for why counting is dedup-by-task.
  local release_self="${7:-false}"
  local self_n=0
  [[ "$release_self" == "true" ]] && self_n=1

  # Round-26 finding #2: a GLOBAL (not `local`), reset on every call — the operation-local commit
  # signal `_alf_write_confirmed` now gates on. Every early-return path below leaves it `0`; only
  # the one `mv` that actually lands sets it `1`, right where `_clear_own_sidecar` already marks
  # that same commit. This is a fact about THIS invocation's write, not a value read back from the
  # file afterward — the two differ exactly when the receipt already held the requested value
  # before a silently-failed retry, the blind spot a read-back alone cannot see.
  _us_committed=0

  if _lock; then
    # `init_state_file` returns 1 when the state file is ABSENT and cannot be created (mktemp
    # unavailable, ENOSPC, unwritable dir). As a BARE statement under `set -euo pipefail` that
    # return aborted the hook right here — after the lock was taken, before any fail-closed marker
    # could be written. The EXIT trap released the lock and the blocking verdict vanished leaving
    # NEITHER state NOR sidecar, which is precisely the combination stop-guard's no-state path
    # reads as "nothing to enforce" and allows the stop. Degrade through the same handler every
    # other lost verdict uses.
    if ! init_state_file; then
      _unlock
      _verdict_write_failed "$key" "$passed" "state file absent and could not be created"
      return 0
    fi

    # The precondition, inside the lock. Return 2 rather than the fail-closed sidecar path: a marker
    # already gone means another writer resolved this dispatch, which is a reason NOT to write and
    # not a failure to write. Poisoning the gate here would report a defect that did not happen.
    # Keyed by `(task, plane)` for the reason `_consume_background_review` carries: one handoff can
    # write two markers under one task id, and matching on the id alone both passes the precondition
    # for the wrong plane and deletes the other plane's marker in the filter below.
    if [[ -n "$consume_task" ]] \
       && ! jq -e --arg t "$consume_task" --arg cp "$consume_plane" \
              '((.background_reviews // []) | map(select(.task == $t and .plane == $cp)) | length) > 0' \
              "$STATE_FILE" >/dev/null 2>&1; then
      _unlock
      return 2
    fi

    # Reconcile BEFORE the verdict filter below reads the cap. Deferring it to after the filter was
    # tried and is incoherent: stop-guard re-reads the FILE, so a state left at `10/30` is not
    # exhausted to the only consumer that matters — the deferral changed when the budget grew, not
    # whether it did, while the comment claimed the state "stays latched". Config is the source of
    # truth (see _reconcile_max_rounds); when the resolved cap genuinely rises, the budget genuinely
    # rises, and the reset that follows is correct rather than a refund. Exhaustion against a cap
    # the project no longer configures is not a signal worth preserving.
    _reconcile_max_rounds "$STATE_FILE"
    # …and then do NOT trust that it worked. Reconciliation is best-effort by contract (it must
    # never abort its caller), so a failed staging/jq/ownership/rename leaves the cached cap stale
    # while still returning 0. The reset below would then evaluate against that stale cap — and on a
    # cap DECREASE that is a fail-open: config 30→10 with `current_round=20, max_rounds=30` reads as
    # `20 < 30`, refunding a budget the resolved config says was exhausted at 10, and erasing the
    # only evidence of it. So the filter re-derives the resolved cap and resets only when the
    # PERSISTED cap already equals it. Success is thus proven by the state itself rather than by a
    # return code, and a failed reconciliation degrades to "no reset" instead of "wrong reset".
    local rmr
    rmr=$(_read_project_max_rounds 30)

    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Update using jq
    local tmp
    # An unavailable temp must reach the fail-closed handler below, not abort the hook under
    # `set -euo pipefail` — an abort would release the lock via the EXIT trap and drop the verdict
    # with no marker at all.
    if ! tmp=$(_lock_staging_file); then
      _unlock
      _verdict_write_failed "$key" "$passed" "mktemp"
      return 0
    fi
    # Do we STILL own the lock? `_lock` returning 0 above proves only that the lock WAS ours.
    # Stale recovery fires on age alone — the TTL arm does not consult liveness — so a contender
    # can displace a slow-but-alive owner mid-section, and the committing `mv` below would then
    # land while a second writer is inside its own critical section. One of the two verdicts is
    # lost, and a lost BLOCKING verdict leaves the previous round's ✅ in place with no marker,
    # which stop-guard reads as a satisfied gate.
    #
    # This check is now an EARLY, well-labelled exit rather than the containment itself — it turns
    # an already-lost race into a clear sidecar reason instead of an ENOENT. The containment is
    # structural: `$tmp` was staged inside `$LOCKDIR` (see `_lock_staging_file`), so the rename that
    # transfers the lock also removes the only path this writer could commit through. A takeover
    # between this check and the `mv` therefore fails the `[[ -s "$tmp" ]]` / `mv` and lands in the
    # fail-closed branch, rather than overwriting the new owner's verdict.
    if ! _own_lock; then
      rm -f "$tmp" 2>/dev/null || true
      _unlock
      _verdict_write_failed "$key" "$passed" "lock displaced by a stale-recovery takeover"
      return 0
    fi
    # Convergence reset: precommit/doc_review passing is the TERMINAL gate of its
    # path, i.e. the loop actually converged — that (not every intermediate edit)
    # is when a fresh round budget is warranted. Done in the same jq filter so it
    # is atomic with the gate write and stays inside the already-held lock.
    #
    # ONLY `precommit` resets the root `iteration_history`. `doc_review` used to reset it too, and
    # that was a CROSS-PLANE refund: `_update_iteration()` is called from the code-review branches
    # ONLY, so `current_round` is purely a CODE counter — a doc gate that never incremented it must
    # not zero it. Reproduced against this hook: state with `code_review.passed=false`,
    # `current_round=9`, `max_rounds=10` and one findings entry; feed a `## Document Review` +
    # `✅ Mergeable` MCP verdict → `current_round` became 0 and `findings_by_round` was emptied while
    # the code review was still failing. Row 1 of the convergence table is the ONLY enforced exit
    # today (fingerprint plateau detection is a V2 target), so repeatedly passing doc reviews kept
    # an unconverged code loop permanently under its cap — precisely the unbounded loop the hard cap
    # exists to stop. A doc-only session is unaffected either way: it never increments the counter,
    # so there was never anything for its reset to do.
    if jq --arg key "$key" \
       --argjson rmr "$rmr" \
       --argjson executed "$executed" \
       --argjson passed "$passed" \
       --arg mode "$mode" \
       --arg now "$now" \
       --arg ct "$consume_task" \
       --arg cp "$consume_plane" \
       --argjson self "$self_n" \
       "${_DISPATCH_EPOCH_RETIRE_DEF}"'.[$key].executed = $executed | .[$key].passed = $passed | .[$key].last_run = $now | .updated_at = $now
        | (if $cp != "" and $ct != "" then
             ((((.background_reviews // []) | map(select(.plane == $cp and .task == $ct)) | length) > 0) as $present
              | .background_reviews = ((.background_reviews // []) | map(select((.plane == $cp and .task == $ct) | not)))
              | retire_dispatch_epoch($cp; (if $present then 1 else 0 end)))
           elif $cp != "" then
             ($cp as $p
              | ((.background_reviews // []) | map(select(.plane == $p)) | map(.task) | unique | length) as $n0
              | ($n0 + $self) as $n
              | .background_reviews = ((.background_reviews // []) | map(select(.plane != $p)))
              | retire_dispatch_epoch($p; $n))
           else . end)
        | if $mode != "" then .[$key].mode = $mode else . end
        | (if ($passed == true and $key == "precommit" and (.iteration_history | type) == "object")
           then .iteration_history else null end) as $ih
        | if $ih == null then .
          else
            (if ($ih | has("current_round")) and ($ih.current_round != null) then $ih.current_round else 0 end) as $r
            | (if ($ih | has("max_rounds")) and ($ih.max_rounds != null) then $ih.max_rounds else 30 end) as $m
            | if ($r | type) == "number" and ($m | type) == "number"
                 and ($r | tostring | test("^[0-9]+$"))
                 and ((if $m < 3 then 3 elif $m > 50 then 50 else $m end) | tostring | test("^[0-9]+$"))
                 and ($r | floor) == $r and ($m | floor) == $m
                 and $r >= 0 and $r <= 100000 and $m >= 1 and $m <= 100000
                 and $m == $rmr
                 and ($r < (if $m < 3 then 3 elif $m > 50 then 50 else $m end))
              then .iteration_history.current_round = 0 | .iteration_history.findings_by_round = []
                   | .iteration_history.strategic_reset_fired = false
                   | .iteration_history.stall_streak = 0
                   | .iteration_history.stall_memory = []
              else . end
          end' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$STATE_FILE"; then
      # ^ The reset guard MIRRORS stop-guard.sh's `ITER_PARSED` validation field for field: this
      # writer runs BEFORE the reader, so anything it launders is gone before the reader could
      # refuse it. Why each clause exists (clamped-cap comparison, canonical-literal asymmetry,
      # integral check, the deliberate absence of `//`): see
      # docs/features/auto-loop-evolution/4-implementation.md §2.3.
      # `test/hooks/jq-filter-fidelity.test.js` pins both filters to the same answers with real jq.
      #
      # Clears exactly ONE marker: the `verdict_write_failed` this plane sets below. The edit-plane
      # markers belong to post-edit-format.sh and `lock_failure` belongs to the aggregate
      # transition, and neither is superseded by a verdict write. See _clear_own_sidecar.
      _clear_own_sidecar "verdict_write_failed:$key"
      _us_committed=1
    else
      # `jq` exits 0 having written NOTHING when its input is empty, so without the size guard
      # above an empty temp was renamed over the state on every write — the file then never
      # self-heals, stop-guard reads it as corrupt, forces strict mode even for warn-mode users,
      # and every attempt to satisfy the gate rewrites the empty file again. The `rm -f` also
      # stops a failed jq from leaking a temp beside the state on every hook invocation.
      rm -f "$tmp" 2>/dev/null || true
      echo "[Review State] $key verdict NOT recorded (state write produced no output)" >&2
      _unlock
      _verdict_write_failed "$key" "$passed" "state write produced no output"
      return 0
    fi
    _unlock
  else
    # Lock contention: skip rather than fall back to an unlocked
    # read-modify-write — the unlocked mv could clobber a concurrent locked
    # writer (worst case reverting an aggregate BLOCKED) with stale content.
    echo "[Review State] ${key} update skipped (lock contention)" >&2
    _verdict_write_failed "$key" "$passed" "lock contention"
  fi
}

# `comm` on two newline-delimited identity sets, counting the selected column. Blank lines are
# dropped first: `comm` treats an empty line as a member, so an empty set would otherwise count as
# one element and report a closure that never happened.
_id_set_count() {
  local mode="$1" a="$2" b="$3"
  # stderr is silenced because the callers already degrade to 0 on failure — an absent `comm` would
  # otherwise print "command not found" three times per round after the failure is fully handled.
  comm "$mode" \
    <(printf '%s\n' "$a" | sed '/^$/d' | sort -u) \
    <(printf '%s\n' "$b" | sed '/^$/d' | sort -u) 2>/dev/null \
    | sed '/^$/d' | wc -l | tr -d ' '
}

# The closed set of stall classes. Single source for the ingest validator below; the same six are
# the table in rules/auto-loop.md § Cap Diagnostic Protocol.
STALL_CLASSES="ARCHITECTURE DOC_TOO_LONG ATTENTION_DIFFUSION UNVERIFIED_CLAIM TIER_MISMATCH REQUIREMENT_AMBIGUITY"

# Read-back for rules/auto-loop.md § Stall Detection > Stall Memory: print what has already been
# tried on this change, beneath the signal that is about to ask for another diagnosis. Silent when
# nothing is recorded — an empty replay would read as "three attempts, none worth showing".
#
# The records are printed as INDENTED continuation lines under a single header. What makes the
# replay non-re-ingestible is not the indent but the split: the per-record lines carry no
# `[STALL_MEMORY]` marker at all, and the one line that does carries no `class=`. The ingest regex
# needs both on the same line, so neither half of the replay is a record — the memory cannot grow
# by being displayed. Keep the marker off the record lines; that is the whole guarantee.
#
# Contents were sanitized on the way in, but the state file is an ordinary file in the working tree
# that another writer or a hand-edit can reach, so strip control bytes on the way out as well — the
# input sanitizer is not the boundary that protects this terminal.
_replay_stall_memory() {
  local state_file="$1" lines
  lines=$(jq -r '.iteration_history.stall_memory // [] | .[] |
    "  class=\(.class) | tried=\(.tried) | outcome=\(.outcome) | \(.ts)"' \
    "$state_file" 2>/dev/null | tr -d '\000-\011\013-\037\177') || return 0
  [[ -n "$lines" ]] || return 0
  printf '[STALL_MEMORY] Already tried on this change (oldest first) — do not repeat a failed adjustment:\n%s\n' "$lines" >&2
}

# Ingest one `[STALL_MEMORY] class=<C> | tried=<t> | outcome=<o> | <ts>` line into the state file,
# FIFO-capped at 3 (rules/auto-loop.md § Stall Detection > Stall Memory; the bound is Reflexion's
# Ω=1–3 episodic buffer, arXiv:2303.11366).
#
# Unlike `[NIT_DEFERRED]`, whose text comes from the reviewer, this record is model-authored — but
# it is still untrusted-by-construction: it round-trips through the state file and back out through
# `_replay_stall_memory`, so a control byte here becomes a terminal escape sequence in a later
# session's output. Control bytes are stripped and both free-text fields are truncated rather than
# rejected, because a malformed record that is silently dropped looks exactly like a diagnosis that
# was never made — the failure this memory exists to prevent.
_upsert_stall_memory() {
  local line="$1" state_file="${2:-$STATE_FILE}"
  local body class tried outcome ts

  body=$(printf '%s' "$line" | sed -E 's/^\[STALL_MEMORY\][[:space:]]*//')
  class=$(printf '%s' "$body" | cut -d'|' -f1 | sed -E 's/^[[:space:]]*class=[[:space:]]*//; s/[[:space:]]*$//')
  tried=$(printf '%s' "$body" | cut -d'|' -f2 | sed -E 's/^[[:space:]]*tried=[[:space:]]*//; s/[[:space:]]*$//')
  outcome=$(printf '%s' "$body" | cut -d'|' -f3 | sed -E 's/^[[:space:]]*outcome=[[:space:]]*//; s/[[:space:]]*$//')
  ts=$(printf '%s' "$body" | cut -d'|' -f4 | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')

  # Fail closed on the class: it selects a row in a closed table, so an unrecognized one is a
  # malformed record and not a new category. Logged, never silently dropped.
  case " $STALL_CLASSES " in
    *" $class "*) ;;
    *) echo "[Review State] [STALL_MEMORY] skipped (class '${class:-<empty>}' is not one of: $STALL_CLASSES)" >&2; return 0 ;;
  esac

  tried=$(printf '%s' "$tried" | tr -d '\000-\037\177' | cut -c1-200)
  outcome=$(printf '%s' "$outcome" | tr -d '\000-\037\177' | cut -c1-200)
  ts=$(printf '%s' "$ts" | tr -d '\000-\037\177' | cut -c1-40)
  [[ -n "$tried" && -n "$outcome" ]] || {
    echo "[Review State] [STALL_MEMORY] skipped (tried= and outcome= are both required)" >&2
    return 0
  }
  [[ -n "$ts" ]] || ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  if ! _lock; then
    echo "[Review State] [STALL_MEMORY] skipped (lock contention) — the adjustment is not recorded" >&2
    return 0
  fi
  local tmp
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] [STALL_MEMORY] skipped (mktemp unavailable)" >&2; _unlock; return 0; }
  if jq --arg c "$class" --arg t "$tried" --arg o "$outcome" --arg ts "$ts" \
     '.iteration_history.stall_memory =
        (((.iteration_history.stall_memory // [])
          + [{"class": $c, "tried": $t, "outcome": $o, "ts": $ts}])
         | if length > 3 then .[-3:] else . end)' \
     "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$state_file"; then
    echo "[Review State] [STALL_MEMORY] recorded: class=$class" >&2
  else
    rm -f "$tmp" 2>/dev/null
    echo "[Review State] [STALL_MEMORY] skipped (write failed) — the adjustment is not recorded" >&2
  fi
  _unlock
}

# Update iteration history (extract finding counts from review output)
_update_iteration() {
  local tool_output="$1"
  local state_file="${2:-$STATE_FILE}"
  # No state file → nothing to increment. Reported rather than returned mutely: this and the
  # rename failure below were the two silent no-ops, and `rules/auto-loop.md` claims every
  # degradation path logs. A round that is not counted makes the row-1 hard cap arrive late.
  if [[ ! -f "$state_file" ]]; then
    echo "[Review State] Iteration update skipped (no state file) — round budget undercounts" >&2
    return 0
  fi

  local p0_count p1_count p2_count nit_count total

  # Dual-format parsing: tag-based [P0] AND section-based #### P0
  # grep -c exits 1 on no match but still outputs "0"; use subshell to isolate
  p0_count=$(echo "$tool_output" | grep -cE '^\- \[P0\]|^#### P0' 2>/dev/null) || p0_count=0
  p1_count=$(echo "$tool_output" | grep -cE '^\- \[P1\]|^#### P1' 2>/dev/null) || p1_count=0
  p2_count=$(echo "$tool_output" | grep -cE '^\- \[P2\]|^#### P2' 2>/dev/null) || p2_count=0
  nit_count=$(echo "$tool_output" | grep -cE '^\- \[Nit\]|^#### Nit' 2>/dev/null) || nit_count=0
  total=$((p0_count + p1_count + p2_count + nit_count))

  # Finding IDENTITIES, not just counts. Counts cannot tell "fixed one" from "fixed one and
  # introduced one" — both read 5 -> 5 — so a churning loop is indistinguishable from a converging
  # one. The identity is the finding's text with the severity tag stripped and its `file:line`
  # reduced to `file`, so a fix that shifts surrounding lines does not re-report every untouched
  # finding in that file as closed-and-reintroduced.
  #
  # The substitution LOOPS and is ANCHORED to the location token's trailing edge, so it reduces any
  # coordinate depth while leaving a colon inside a path intact. It only ever looks at the FIRST
  # token: a location the reviewer contract's space delimiter cannot bound — a path containing a
  # space, a `:12-14` range, a filename ending in `:digits` — keeps its line number and is accepted
  # as a residual rather than guessed at. Searching the rest of the line for something location-
  # shaped was tried and reverted: it read `timeout 30:5 seconds` as a location and collapsed that
  # finding onto a real `timeout 30 seconds`, which is a worse defect than the one it closed.
  #
  # The two earlier forms that failed, the residuals, and the measurement behind accepting them:
  # docs/features/auto-loop-autonomy/4-implementation.md §2.2. Behaviour is pinned case-by-case in
  # test/hooks/identity-normalization.test.js, which runs this exact program under real sed.
  #
  # Bounded (40 per round, 120 chars each) because this goes into the state file every round.
  local cur_ids prev_ids
  cur_ids=$(printf '%s\n' "$tool_output" \
    | grep -E '^- \[(P0|P1|P2|Nit)\]' 2>/dev/null \
    | sed -E 's/^- \[(P0|P1|P2|Nit)\][[:blank:]]*//; s/[[:blank:]]+/ /g; s/[[:blank:]]+$//' \
    | sed -E -e ':a' -e 's/^([^[:space:]]+):[0-9]+([[:space:]]|$)/\1\2/' -e 'ta' \
    | cut -c1-120 | sort -u | head -40) || true
  # `|| true`, NOT `|| cur_ids=""`. `head -40` closes the pipe on its 40th line, `sort` takes
  # SIGPIPE, and under `set -o pipefail` the whole substitution reports failure — on SUCCESS, once
  # the findings exceed roughly one pipe buffer of identity text. The old fallback then discarded
  # the 40 identities the substitution had already captured, so a large review round stored
  # `ids: []`. The next round reads that as "nothing carried over" and reports `closed=0` with
  # `persisted + new == findings`, which is exactly the shape § Cap Diagnostic Protocol's
  # `persisted + new < findings` caveat does NOT flag: the churn signal inverts silently.
  # The substitution has already assigned whatever was captured; `|| true` only stops `set -e`.

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Mid-loop diagnosis checkpoint. Digit-validated before it reaches jq for the same reason as
  # every other numeric read here — the env is untrusted input. Rationale for firing on
  # `current_round` at a fixed round rather than near the cap on `total_rounds_session`:
  # docs/features/auto-loop-autonomy/4-implementation.md §1.
  local ckpt="${AUTO_LOOP_CHECKPOINT_ROUNDS:-10}"
  [[ "$ckpt" =~ ^[0-9]+$ ]] && [[ "$ckpt" -ge 1 ]] || ckpt=10
  local fired_before

  # Stall streak threshold — rules/auto-loop.md § Stall Detection. Same digit validation and same
  # untrusted-env reasoning as `ckpt` above. 3 is Reflexion's repeat-action heuristic
  # (arXiv:2303.11366); the derivation is in docs/features/auto-loop-autonomy/4-implementation.md §3.
  # `^[1-9][0-9]*$`, not `^[0-9]+$`: bash reads a leading zero as octal, so `08` passes the looser
  # form and then makes `-ge` print "value too great for base" onto this hook's stderr — the stream
  # the model reads — before falling back anyway.
  local stall_t="${AUTO_LOOP_STALL_ROUNDS:-3}"
  [[ "$stall_t" =~ ^[1-9][0-9]*$ ]] && [[ "$stall_t" -ge 1 ]] || stall_t=3
  local streak_before

  # Acquire lock for state file write (consistent with update_state)
  if _lock; then
    # INSIDE the lock, with the write and the read-back, so the three are one transaction. Read
    # outside it, two sessions counting a round concurrently both observe `false`, both see `true`
    # afterwards, and both emit — the "1 diagnosis per change" cap broken by exactly the
    # concurrency the shared lock exists to serialize.
    fired_before=$(jq -r '.iteration_history.strategic_reset_fired // false' "$state_file" 2>/dev/null) || fired_before="unknown"
    # Same boundary, same reason: the previous round's identities must come from the file this
    # write is about to replace, not from whatever a concurrent writer left before the lock.
    prev_ids=$(jq -r '[.iteration_history.findings_by_round[]? | .ids? // empty] | last // [] | .[]' \
      "$state_file" 2>/dev/null | sort -u) || prev_ids=""
    # Same boundary again: the streak this write advances must be the one the file holds now.
    streak_before=$(jq -r '.iteration_history.stall_streak // 0' "$state_file" 2>/dev/null) || streak_before="unknown"
    [[ "$streak_before" =~ ^[0-9]+$ ]] || streak_before="unknown"

    # The three set differences move AHEAD of the write because jq needs them: the stall streak is
    # a function of `closed`, and a streak computed after the commit could only be written by a
    # second one. Each keeps its own `||` fallback — `_id_set_count` shells out to `comm`, which
    # this tree did not previously depend on, and a bare substitution would abort the hook under
    # `set -e`. What the placement changed is the blast radius of that abort, not its likelihood:
    # before the commit it costs the whole round (uncounted, which only ever undercounts), after
    # it the round landed but every downstream signal was skipped. The `||` is what makes both
    # moot, and is the reason this is safe to move at all.
    local _closed _persisted _new
    _closed=$(_id_set_count -23 "$prev_ids" "$cur_ids") || _closed=0
    _new=$(_id_set_count -13 "$prev_ids" "$cur_ids") || _new=0
    _persisted=$(_id_set_count -12 "$prev_ids" "$cur_ids") || _persisted=0
    [[ "$_closed" =~ ^[0-9]+$ ]] || _closed=0
    [[ "$_new" =~ ^[0-9]+$ ]] || _new=0
    [[ "$_persisted" =~ ^[0-9]+$ ]] || _persisted=0
    _migrate_state_v2 "$state_file"
    _reconcile_max_rounds "$state_file"
    # Degrade, never abort — see _migrate_state_v2.
    tmp=$(_lock_staging_file) || { echo "[Review State] _update_iteration skipped (mktemp unavailable)" >&2; _unlock; return 0; }
    # Ownership re-check before the commit — see update_state for why holding the lock once is not
    # proof of holding it now. A dropped round only ever UNDERCOUNTS (the hard cap arrives later,
    # never earlier), which is why this degrades with a log line instead of a sidecar marker.
    if ! _own_lock; then
      rm -f "$tmp" 2>/dev/null || true
      _unlock
      echo "[Review State] _update_iteration skipped (lock displaced by a stale-recovery takeover) — round not counted" >&2
      return 0
    fi
    if jq --argjson total "$total" --argjson p0 "$p0_count" \
       --argjson p1 "$p1_count" --argjson p2 "$p2_count" \
       --argjson nit "$nit_count" --arg now "$now" --argjson ckpt "$ckpt" --arg ids "$cur_ids" \
       --argjson closed "$_closed" --argjson persisted "$_persisted" --argjson newids "$_new" \
       '.iteration_history.current_round += 1 |
        .iteration_history.total_rounds_session = ((.iteration_history.total_rounds_session // 0) + 1) |
        .iteration_history.findings_by_round += [{"round": (.iteration_history.current_round), "total": $total, "p0": $p0, "p1": $p1, "p2": $p2, "nit": $nit, "timestamp": $now, "ids": ($ids | split("\n") | map(select(length > 0)))}] |
        .iteration_history.findings_by_round |= (if length > 50 then .[-50:] else . end) |
        .iteration_history.strategic_reset_fired =
          (((.iteration_history.strategic_reset_fired // false) == true)
           or ((.iteration_history.current_round | type) == "number"
               and .iteration_history.current_round >= $ckpt)) |
        .iteration_history.stall_streak =
          (((.iteration_history.stall_streak // 0) | if type == "number" and . >= 0 then . else 0 end) as $s
           | if ($persisted + $newids) < $total then $s
             elif $total > 0 and $closed == 0 then $s + 1
             else 0 end) |
        .updated_at = $now' \
       "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      # The `mv` was previously unchecked, and the HOOK_DEBUG line below then reported
      # "Iteration updated" for a rename that never happened — the one no-op with no diagnostic at
      # ANY verbosity. A skipped increment only ever undercounts, so this is a budget that silently
      # runs long, not a gate that opens; still, an untraceable no-op is exactly what makes a
      # never-firing hard cap impossible to diagnose from the logs.
      if _own_lock && mv "$tmp" "$state_file" 2>/dev/null; then
        if [[ "${HOOK_DEBUG:-}" == "1" ]]; then
          echo "[Review State] Iteration updated: total=$total (p0=$p0_count p1=$p1_count p2=$p2_count nit=$nit_count)" >&2
        fi
        # The progress ledger. Neutral counts only — this hook does not judge whether the round
        # was productive, it reports what changed so the behaviour layer can. `closed=0 new=0`
        # with findings outstanding is the churn signature the round cap alone cannot see.
        # Identities are never echoed: a finding's text is reviewer-controlled and this record is
        # whitespace-delimited, so only counts cross the boundary.
        #
        # `findings` counts BOTH report shapes (`- [P0]` lines and `#### P0` sections); identities
        # come only from the line shape, since a section header carries no per-finding text. So
        # `persisted + new < findings` means the ledger could not see this round's findings, and
        # its `closed`/`new` are not evidence of anything — read the discrepancy before reading
        # a `closed=0` as churn.
        # `_closed`, `_persisted` and `_new` are computed before the jq write now — the stall
        # streak is a function of `closed`, so the filter has to be able to read it. The
        # "degrade, never abort" reasoning that used to live here moved with them.
        local _round_now
        _round_now=$(jq -r '.iteration_history.current_round // 0' "$state_file" 2>/dev/null) || _round_now=0
        # `>&2`, like every other model-facing signal THIS hook emits — a `[LOOP_PROGRESS]` line
        # the model never reads is a ledger that does not exist. `_alf_emit` printf's to stdout and
        # each CALLER redirects, so the convention is invisible at the printf itself. Scoped to
        # this hook deliberately: it is not tree-wide and must not be. `user-prompt-review-guard.sh`
        # is a UserPromptSubmit hook, where stdout IS the injection channel, and
        # `post-skill-auto-loop.sh` records the same choice in its own header — both call
        # `_alf_emit` bare. That is exactly why the redirect lives at the caller.
        printf '[LOOP_PROGRESS] round=%s closed=%s persisted=%s new=%s findings=%s\n' \
          "${_round_now:-0}" "${_closed:-0}" "${_persisted:-0}" "${_new:-0}" "$total" >&2

        # Emit only on the FLIP, and read the flag back rather than re-deriving it from the round
        # we think we wrote: the checklist is once per change (rules/auto-loop.md § Cap Diagnostic
        # Protocol, "1 diagnosis per change"), and the flag in the file is the only record of
        # whether it already fired. `unknown` from an unreadable before-read suppresses the
        # emission — a checkpoint printed every round is noise the model learns to skip.
        local fired_after
        fired_after=$(jq -r '.iteration_history.strategic_reset_fired // false' "$state_file" 2>/dev/null) || fired_after="unknown"
        local _diag_signalled=false
        if [[ "$fired_before" == "false" && "$fired_after" == "true" ]]; then
          printf '[STRATEGIC_RESET] Review round %s reached on this change. Before the next round: diagnose the stall as exactly one class from rules/auto-loop.md § Cap Diagnostic Protocol (ARCHITECTURE / DOC_TOO_LONG / ATTENTION_DIFFUSION / UNVERIFIED_CLAIM / TIER_MISMATCH / REQUIREMENT_AMBIGUITY), state the class and its observed signals, make ONE bounded adjustment, then return to the loop. This is a checkpoint, not a cap — it adjudicates nothing.\n' "${_round_now:-0}" >&2
          _diag_signalled=true
        fi

        # Stall detection — rules/auto-loop.md § Stall Detection. The streak itself is computed in
        # the filter above; this is only the edge detector. Emitting on the CROSSING (below the
        # threshold before, at or above it after) and not on the level is what makes the signal
        # mean "this just became true": the streak resets to 0 on any round that closes a finding,
        # so progress re-arms it, and a fourth consecutive stall round says nothing new.
        #
        # `unknown` on either side suppresses the emission, matching `fired_before`/`fired_after`
        # above — an unreadable before-state cannot establish that a crossing happened, and
        # guessing one direction or the other either spams the signal or silences it for the rest
        # of the change. Neither is worth a fabricated edge.
        local streak_after
        streak_after=$(jq -r '.iteration_history.stall_streak // 0' "$state_file" 2>/dev/null) || streak_after="unknown"
        [[ "$streak_after" =~ ^[0-9]+$ ]] || streak_after="unknown"
        if [[ "$streak_before" != "unknown" && "$streak_after" != "unknown" ]] \
           && (( streak_before < stall_t )) && (( streak_after >= stall_t )); then
          printf '[LOOP_STALL] streak=%s threshold=%s round=%s — %s consecutive review rounds closed no finding while findings were outstanding. Run rules/auto-loop.md § Cap Diagnostic Protocol: classify the stall, make ONE bounded adjustment, record it with [STALL_MEMORY], then return to the loop. This is a fact, not a gate — nothing blocks.\n' \
            "$streak_after" "$stall_t" "${_round_now:-0}" "$streak_after" >&2
          _diag_signalled=true
        fi

        # One replay per round even when both signals fire: they are two routes into the same
        # protocol, and printing the same three records twice reads as six attempts.
        # `if`, not `[[ … ]] && …` — a false test as the last statement of this block is a
        # non-zero return, and this hook runs under `set -e`.
        if [[ "$_diag_signalled" == "true" ]]; then
          _replay_stall_memory "$state_file"
        fi
      else
        rm -f "$tmp" 2>/dev/null
        echo "[Review State] Iteration update skipped (rename failed) — round budget undercounts" >&2
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
  # Degrade, never abort (see update_state) — plan gate is advisory, so a missing state file
  # simply skips the update instead of taking the whole hook down with it.
  init_state_file || { _unlock; echo "[Review State] plan_review update skipped (state file unavailable)" >&2; return 0; }
  if ! _migrate_state_plan_review "$STATE_FILE"; then
    _unlock
    echo "[Review State] plan_review update skipped (unsupported schema)" >&2
    return 0
  fi

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] update_plan_state skipped (mktemp unavailable)" >&2; _unlock; return 0; }
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
    _own_lock && mv "$tmp" "$STATE_FILE"
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
    init_state_file || true
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
    # Degrade, never abort — see _migrate_state_v2.
    tmp=$(_lock_staging_file) || { echo "[Review State] _update_plan_iteration skipped (mktemp unavailable)" >&2; _unlock; return 0; }
    if jq --argjson total "$total" --argjson p0 "$p0_count" \
       --argjson p1 "$p1_count" --argjson p2 "$p2_count" \
       --argjson nit "$nit_count" --arg now "$now" \
       '.plan_review.iteration_history.current_round += 1 |
        .plan_review.iteration_history.total_rounds_session = ((.plan_review.iteration_history.total_rounds_session // 0) + 1) |
        .plan_review.iteration_history.findings_by_round += [{"round": (.plan_review.iteration_history.current_round), "total": $total, "p0": $p0, "p1": $p1, "p2": $p2, "nit": $nit, "timestamp": $now}] |
        .updated_at = $now' \
       "$state_file" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      _own_lock && mv "$tmp" "$state_file"
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
  init_state_file || { _unlock; echo "[Review State] plan_review verdict skipped (state file unavailable)" >&2; return 0; }
  if ! _migrate_state_plan_review "$STATE_FILE"; then
    _unlock
    echo "[Review State] plan_review verdict skipped (unsupported schema)" >&2
    return 0
  fi
  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] update_plan_verdict skipped (mktemp unavailable)" >&2; _unlock; return 0; }
  if jq --argjson passed "$passed" --arg now "$now" \
     '.plan_review.passed = $passed | .plan_review.executed = true | .plan_review.last_run = $now | .updated_at = $now' \
     "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE"
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
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] _reset_changed_files skipped (mktemp unavailable)" >&2; _unlock; return 0; }
  if jq '.changed_files_since_review = []' "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE"
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
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(_lock_staging_file) || { echo "[Review State] _set_phase_idle skipped (mktemp unavailable)" >&2; _unlock; return 0; }
  if jq '.review_phase = "idle"' "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE"
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

# Creation time of the nit lock DIRECTORY — the same age proxy `_lockdir_mtime` provides for the
# state lock, against NIT_LOCKDIR.
_nit_lockdir_mtime() {
  stat -f %m "$NIT_LOCKDIR" 2>/dev/null || stat -c %Y "$NIT_LOCKDIR" 2>/dev/null || echo 0
}

_nit_lock() {
  local start end
  start=$(date +%s)
  while ! mkdir "$NIT_LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge 3 ]; then
      # Stale recovery
      local lock_ts
      lock_ts=$(cat "$NIT_LOCKDIR/ts" 2>/dev/null || echo 0)
      # ABSENT vs CORRUPT, exactly as in _lock: `mkdir` returns before `pid`/`ts` are written, so a
      # missing `ts` means the owner is mid-acquisition, not that the lock is infinitely old.
      # Falling back to 0 there deleted a just-acquired lock and admitted a second writer.
      if [[ ! -f "$NIT_LOCKDIR/ts" ]]; then
        lock_ts=$(_nit_lockdir_mtime)
      fi
      # Same arithmetic-injection sanitization as _lock above — NIT_LOCKDIR is likewise an
      # ordinary in-tree directory, and `$((now - lock_ts))` would evaluate its contents.
      [[ "$lock_ts" =~ ^[0-9]+$ ]] || lock_ts=0
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
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(mktemp "$nit_file.XXXXXX" 2>/dev/null) || { echo "[Review State] _gc_nit_history skipped (mktemp unavailable)" >&2; return 0; }
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
  if grep -qE '[;&|`]' <<< "$file_path" || grep -qE '\$\(' <<< "$file_path"; then
    echo "[Nit History] Rejected suspicious file path" >&2
    return 0
  fi
  if grep -qE '[;&`]' <<< "$issue" || grep -qE '\$\(' <<< "$issue"; then
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
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(mktemp "$nit_file.XXXXXX" 2>/dev/null) || { echo "[Review State] _upsert_nit_deferred skipped (mktemp unavailable)" >&2; return 0; }
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
  # Degrade, never abort — see _migrate_state_v2.
  tmp=$(mktemp "$nit_file.XXXXXX" 2>/dev/null) || { echo "[Review State] _upsert_dismiss_verdict skipped (mktemp unavailable)" >&2; return 0; }
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

# Extract the REVIEW-plane gate lines from a reviewer's output.
#
# "Review plane" means code review (`✅ Ready` / `⛔ Blocked`) and doc review (`✅ Mergeable` /
# `⛔ Needs revision`), plus the structured `## Gate: <sentinel>` header both emit. It
# deliberately does NOT include the precommit plane's `## Overall:` line: that has its own
# whole-line, last-match parser (`_precommit_last_overall_is_pass`), and admitting it here was a
# fail-OPEN. The old primary regex `^## Gate: ✅|^✅ All Pass|^## Overall: ✅ PASS` is a PREFIX
# match, so the literal template line
#
#     ## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN
#
# — at column 0 in skills/precommit/SKILL.md, skills/precommit-fast/SKILL.md and
# skills/verify/SKILL.md — satisfied it. Any review whose output quoted one of those files
# returned "true" no matter what its OWN verdict said, and `_parse_review_gate` consumes that as
# `text_gate`, so a `## Merge Gate: ⛔ Blocked` review recorded `code_review.passed=true`. Same
# class of bug the precommit parser already spent ~15 lines hardening against; this plane never
# got the treatment.
#
# `✅ All Pass` is dropped outright. rules/auto-loop.md is explicit that it is behavior-layer
# prose for "every gate passed" and "is *not* the precommit sentinel and no hook reads it as one"
# — the hook was contradicting its own governing spec. The doc plane's real sentinels are
# `✅ Mergeable` / `## Gate: ✅` (skills/doc-review/references/review-loop-doc.md:34).
#
# Decoration is stripped rather than enumerated in one regex: real reviewer output wraps the
# sentinel in list bullets, blockquotes, bold, and headings (`- ⛔ Needs revision: Has 🔴 items.`
# is verbatim from a live Codex doc review). After stripping, the sentinel must START the
# remaining line, so PROSE that merely mentions one — `the gate says ✅ Ready when green` — no
# longer qualifies. That is the same "decoration yes, prose no" boundary
# `_mcp_output_is_code_review` draws.
_review_gate_lines() {
  printf '%s\n' "$1" \
    | sed -E 's/^[[:space:]]*//; s/^(([-*+]|>)[[:space:]]*)+//; s/^#{1,4}[[:space:]]+//; s/^\*\*//; s/[[:space:]]*$//' \
    | grep -E '^(Gate:[[:space:]]*(✅|⛔|❌)|(✅|⛔|❌)[[:space:]]*Gate|✅ (Ready|Mergeable)([^A-Za-z]|$)|⛔ (Blocked|Needs revision)([^A-Za-z]|$))' \
    || true
}

# Review-plane pass verdict. Fail-closed in three directions, matching _mcp_code_review_passed:
#   • no gate line at all            → false (a review that produced no verdict is not a pass)
#   • any gate line carries ⛔ / ❌   → false (BLOCKED-first across lines: reviewer output that
#                                      lists a blocking finding and then a passing tail must not
#                                      bank the tail)
#   • one gate line carries BOTH     → false, by the same test — which is exactly what catches a
#                                      quoted TEMPLATE alternation such as
#                                      `## Gate: ✅ All Pass / ⛔ N issues need fixing`
#                                      (skills/skill-health-check/SKILL.md:116).
#
# The old unanchored `loose` fallback is gone with the rest. It matched `## Gate: ✅` / `✅ All
# Pass` ANYWHERE on a line and then asked only whether some matching line lacked the words
# Error|Failed|FAIL — a heuristic that cannot distinguish a verdict from a sentence about one,
# and that a template line passes trivially.
check_passed() {
  local lines
  lines=$(_review_gate_lines "$1")
  if [[ -z "$lines" ]] || grep -qE '⛔|❌' <<< "$lines"; then
    echo "false"
  else
    echo "true"
  fi
}

# Skill tool_response is a launch acknowledgement ("Launching skill: <name>"),
# not the review verdict — the verdict arrives later via the MCP or Bash
# routes. Only treat Skill output as a verdict when it carries an explicit
# gate/verdict marker; recording the placeholder would both double-count the
# review round (once here, once on the MCP verdict) and transiently flip
# passed=false on a passing review.
#
# `✅ All Pass` appears in THIS pattern and nowhere else in this file, which reads as a
# contradiction of the "dropped outright" note above until the two roles are separated. This is a
# PRESENCE test — "is this output a verdict at all, or a launch placeholder" — and it decides only
# whether to parse further. The classification that follows never maps the phrase to a passing
# gate. Keeping it here is the conservative direction: recognising a verdict-shaped output and then
# finding no passing sentinel records a non-pass, whereas dropping it here would classify the same
# output as a placeholder and record nothing at all. See rules/auto-loop.md's precommit-anchoring
# note, which states the scope of "no hook reads it" in these terms.
_skill_output_has_verdict() {
  grep -qE '## Gate:|"gate"[[:space:]]*:|## Overall:|✅ All Pass|✅ Mergeable|⛔' <<< "$1"
}

# True ONLY when the ENTIRE Bash command is a standalone precommit-runner.js invocation — optional
# `HOOK_*=val` env prefixes, then `node <trusted-root>/precommit-runner.js`, then plain option
# arguments, anchored ^...$ with NO embedded newline (the sole form /precommit emits). Whole-command
# anchoring, the four defenses (path binding, env allowlist, metacharacter-free args, mode
# allowlist), and the accepted runner-identity residual are documented in
# docs/features/auto-loop-evolution/4-implementation.md §4.6.
_is_clean_runner_invocation() {
  local cmd="$1"
  [[ "$cmd" == *$'\n'* ]] && return 1
  # Defense 1-3: structural gate — only the runner, trusted path, env allowlist, metachar-free args.
  grep -qE '^[[:space:]]*(HOOK_[A-Z0-9_]+=[A-Za-z0-9_]*[[:space:]]+)*node[[:space:]]+(\./)?(\.claude|\.sd0x)/scripts/precommit-runner\.js([[:space:]]+[A-Za-z0-9_./=-]+)*$' <<< "$cmd" || return 1
  # Defense 4: MODE allowlist. precommit-runner.js runs the BUILD step only when args.mode === 'full'
  # (scripts/precommit-runner.js); `fast` skips it BY DESIGN, but an UNKNOWN/typo mode (`--mode bogus`,
  # `--mode fulll`) ALSO skips build while lint+test can still emit `## Overall: ✅ PASS`, which this
  # hook would then record as precommit.passed=true — a required failing build silently bypassed. So
  # trust the verdict ONLY when an explicit `--mode` is present and EVERY `--mode` operand is exactly
  # `full` or `fast` (both `--mode X` and `--mode=X` forms). An absent/dangling/unknown mode drops the
  # verdict (fail-closed → /precommit re-runs). The structural gate above guarantees metachar-free,
  # space/tab-delimited tokens; `read -ra` word-splits WITHOUT globbing (safer than `for t in $cmd`).
  # ONLY the spaced form `--mode <value>` counts, because that is the only form
  # precommit-runner.js parses (`if (k === '--mode' && v)`, scripts/precommit-runner.js:78).
  # An `--mode=X` operand is IGNORED by the runner, so treating it as a mode declaration made the
  # hook and the runner disagree: `--mode fast --mode=full` runs FAST (the runner sees only the
  # spaced operand) while the hook would have recorded `full`, handing full-gate enforcement a run
  # whose build/typecheck never executed. Any `--mode=` token therefore rejects the whole
  # invocation (fail-closed → /precommit re-runs), rather than being silently interpreted.
  # Duplicate spaced operands are likewise rejected: the runner's last-wins is not worth mirroring
  # for an invocation no skill emits.
  local -a _toks
  IFS=$' \t' read -ra _toks <<< "$cmd"
  local _i _n=${#_toks[@]} _seen_mode=0 _t _v
  for ((_i = 0; _i < _n; _i++)); do
    _t="${_toks[_i]}"
    if [[ "$_t" == "--mode" ]]; then
      _v="${_toks[_i + 1]:-}"
      [[ "$_v" == "full" || "$_v" == "fast" ]] || return 1
      [[ "$_seen_mode" -eq 0 ]] || return 1
      _seen_mode=1
    elif [[ "$_t" == "--mode="* ]]; then
      return 1
    fi
  done
  [[ "$_seen_mode" -eq 1 ]] || return 1
  return 0
}

# Echo which precommit gate actually produced the verdict: `full`, `fast`, or `unknown`.
#
# `/precommit` and `/precommit-fast` are NOT the same gate — precommit-runner.js runs the build
# (typecheck) step only when `args.mode === 'full'` (scripts/precommit-runner.js:167), and `fast`
# additionally picks a cheaper test target (:178). Recording both as an indistinguishable
# `precommit.passed = true` makes the state file claim the full gate passed when only the reduced
# one ran, so a project whose required check is `/precommit` is satisfied by the variant that
# skipped its typecheck. The mode is recorded here so the state is TRUTHFUL about which gate ran;
# enforcing full-only is stop-guard's opt-in `PRECOMMIT_REQUIRE_FULL=1`, off by default because the
# flag ships to host projects for which the fast gate is a supported choice — not because of this
# repo's own untracked `.claude/CLAUDE.md`. See precommit-tiering/2-tech-spec.md Q1.
#
# `-fast` is tested BEFORE the bare name because `precommit` is a prefix of `precommit-fast`.
# For the runner form, `_is_clean_runner_invocation` has already proven there is EXACTLY ONE
# spaced `--mode` operand and that it is `full` or `fast` — the same single form the runner's
# parseArgs reads (:78) — so reading it here cannot disagree with what the runner actually ran.
# Anything else (no recognizable form) → `unknown`, which fails the opt-in full check closed.
#
# SCOPE, precisely: this records which COMMAND VARIANT ran, not which STAGES executed. `full` means
# `/precommit` (or `--mode full`) was invoked; it does NOT prove a build/typecheck happened. The
# runner skips `build` when the repo has no build script, and a non-Node ecosystem bypasses the
# runner entirely — in both cases a `full` verdict is recorded with no typecheck behind it. So
# `PRECOMMIT_REQUIRE_FULL=1` means "the reduced variant may not satisfy the gate", NOT "a typecheck
# was verified". Closing that gap needs stage-level evidence in the state file (the runner already
# emits per-step lines); until then the divergence is reported on stderr at the recording site
# below rather than silently folded into the verdict.
_precommit_mode_of() {
  local cmd="$1"
  if grep -qE '^[[:space:]]*/?(sd0x-dev-flow:)?precommit-fast($|[[:space:]])' <<< "$cmd"; then
    echo "fast"; return 0
  fi
  if grep -qE '^[[:space:]]*/?(sd0x-dev-flow:)?precommit($|[[:space:]])' <<< "$cmd"; then
    echo "full"; return 0
  fi
  local -a _mtoks
  IFS=$' \t' read -ra _mtoks <<< "$cmd"
  local _i _n=${#_mtoks[@]} _m=""
  for ((_i = 0; _i < _n; _i++)); do
    if [[ "${_mtoks[_i]}" == "--mode" ]]; then
      _m="${_mtoks[_i + 1]:-}"
    fi
  done
  if [[ "$_m" == "full" || "$_m" == "fast" ]]; then
    echo "$_m"; return 0
  fi
  echo "unknown"
}

# Echo "true" ONLY when the precommit output's FINAL `## Overall:` line is `✅ PASS`.
# precommit-runner.js embeds the lint/build/TEST tails BEFORE its own summary line, and a
# test tail can legitimately (or maliciously) contain a `## Overall: ✅ PASS` line — e.g. a
# test that prints this hook's source, or a nested precommit log. check_passed does a
# FIRST-match anchored grep, so that stray PASS would win and mask the runner's real final
# `## Overall: ❌ FAIL`, recording precommit.passed=true on a FAILED gate. Taking the LAST
# `## Overall:` line (the runner writes its verdict last) with FAIL-precedence (anything that
# is not exactly the PASS sentinel → false) closes that gate-bypass. tail -n1 over the
# grepped Overall lines is the whole trick; a NO-CHECKS-RUN-only output never reaches here
# (its dedicated branch above intercepts it).
#
# The match is WHOLE-LINE, not a prefix. The prior `== '## Overall: ✅ PASS'*` glob accepted any
# line merely STARTING with the PASS sentinel — which the skill docs themselves emit verbatim:
# `skills/precommit/SKILL.md:86` and `skills/precommit-fast/SKILL.md:81` both contain
# `## Overall: ✅ PASS / ❌ FAIL / ...` at column 0 as the Output-format template. Any precommit
# run whose output quoted that template line (or any single line carrying BOTH verdicts) banked
# precommit.passed=true while the real verdict was FAIL — the exact fail-open this function was
# written to close, reintroduced one character later by the trailing `*`. precommit-runner.js
# emits the sentinel with NOTHING after it (`scripts/precommit-runner.js:330`
# `lines.push(\`## Overall: ${summary.overallPass ? '✅ PASS' : '❌ FAIL'}\`)`), so requiring
# end-of-line (trailing whitespace/CR tolerated) accepts every genuine pass and rejects every
# template quote. Trailing-content lines now fall through to FAIL — fail-closed, /precommit re-runs.
_PRECOMMIT_PASS_RE='^## Overall: ✅ PASS[[:space:]]*$'
_precommit_last_overall_is_pass() {
  local last
  last=$(printf '%s\n' "$1" | grep -E '^## Overall:' | tail -n 1)
  [[ "$last" =~ $_PRECOMMIT_PASS_RE ]]
}

# Extract every {"gate":"READY|BLOCKED"} that appears INSIDE a ```json fence.
# Scanning the whole output would let a gate string quoted in *prose* — a finding that
# discusses `{"gate":"BLOCKED"}`, or docs restating the contract — override a genuine
# verdict. awk tracks fence state and prints only lines inside ```json … ``` (every such
# block, so the multi-fence BLOCKED-wins guarantee holds: noise inside a json fence can
# only tighten the gate). Emits one gate word per line; empty when no fenced gate exists.
# Shared by _parse_review_gate (Bash/Skill path) and the MCP namespace helpers below so
# both paths agree on what counts as a machine gate.
_json_fenced_gates() {
  printf '%s\n' "$1" | awk '
    /^[[:space:]]*```[jJ][sS][oO][nN][[:space:]]*$/ { infence=1; next }
    /^[[:space:]]*```[[:space:]]*$/ { infence=0; next }
    infence { print }
  ' | grep -oE '"gate"[[:space:]]*:[[:space:]]*"(READY|BLOCKED)"' | grep -oE 'READY|BLOCKED' || true
}

# Positive proof that MCP output is a CODE REVIEW report rather than prose that merely
# quotes a sentinel. `✅ Ready` / `⛔ Blocked` are BEHAVIOR-LAYER text sentinels
# (references/review-common.md "Gate Sentinels" — the machine gate is `REVIEW_GATE=` via
# emit-review-gate.sh, handled anchored at the aggregate_gate branch). Accepting them bare
# let ANY codex MCP output that merely MENTIONS one bank a code_review verdict: a review OF
# the rules files, or an analysis EXPLAINING the sentinel contract, both of which contain the
# literal. That is not hypothetical — it was reproduced twice against a working tree with
# has_code_change=false.
#
# Proof = the `Merge Gate` section header every code-review prompt template mandates
# (references/codex-prompt-{fast,full,branch}.md "## Output Format"), OR a ```json-fenced
# machine gate (the structured summary those same templates request). Prose that merely
# mentions a sentinel carries neither. Mirrors the `## Document Review` / `## Plan Review`
# namespace guards that already protect the doc and plan planes.
#
# The header match tolerates DECORATION but not PROSE. An exactly-anchored
# `#{2,4} Merge Gate$` was too literal for real reviewer output — measured drop-outs:
# `### Merge Gate: ⛔ Blocked`, `**Merge Gate**`, and `## Merge Gate (final)` all recorded NO
# verdict at all. That is not a safe failure: the JSON fence is documented optional
# (references/codex-prompt-fast.md), so the header is usually the only proof, and a dropped
# verdict also skips _update_iteration — so `current_round` never advances and stop-guard's
# max-rounds escape hatch can never fire on exactly the long review loops that need it.
# So: allow a markdown heading OR bold emphasis, and allow trailing text, while still requiring
# the line to BEGIN with the marker. `Merge Gate` must be followed by a non-alphanumeric
# character or end-of-line, so `#### Merge Gateway` does not qualify, and a sentence like
# "the Merge Gate section says ✅ Ready" still fails (it does not start with `##` or `**`).
_mcp_output_is_code_review() {
  local output="$1"
  grep -qE '^[[:space:]]*(#{2,4}[[:space:]]+|\*\*)Merge Gate([^A-Za-z0-9]|$)' <<< "$output" && return 0
  [[ -n "$(_json_fenced_gates "$output")" ]] && return 0
  return 1
}

# Request-side half of the provenance check: did this MCP call ASK for a code review?
#
# `_mcp_output_is_code_review` inspects only the OUTPUT, and output is not evidence of what was
# asked — a codex call about anything else that happens to print a `## Merge Gate` header banked a
# `code_review.passed=true` plus a `changed_files_since_review` reset on a tree nobody reviewed.
#
# Every review dispatch carries the phrase in its REQUEST, by construction and in both directions
# of the loop: the initial prompt embeds the template's `### Merge Gate` Output-Format section
# (references/codex-prompt-{fast,full,branch}.md) and the `--continue` prompt embeds
# "3. Update Merge Gate status" (references/review-common.md). A call that never asked for a merge
# gate therefore cannot mint one, which is exactly the accidental case above.
#
# WHY THIS DOES NOT WEDGE — the failure mode that got the earlier prompt-side guard reverted. If a
# paraphrased prompt ever does drop the phrase, the verdict is skipped, NOT inverted, and the
# code-review skill independently runs `bash scripts/emit-review-gate.sh READY|BLOCKED` at its
# Step 214 (skills/codex-code-review/SKILL.md; "always emit both" — references/review-common.md).
# That path is anchored, writes `aggregate_gate`, and stop-guard prefers it over `code_review`
# whenever it is present. So the gate still has a producer, and the stderr line below names the
# exact phrase to restore.
#
# Scans the raw `tool_input` JSON rather than a named field, for two reasons: the two tools differ
# (`mcp__codex__codex` takes `prompt`, `mcp__codex__codex-reply` takes `prompt` + `threadId`), so a
# field rename would silently disable the check; and a plain `grep -F` needs no jq, which keeps
# this check honest under the hand-written jq stub the hook tests run against — a jq-based query
# here would have been answered by the stub rather than by jq's real semantics.
# The phrase is plain ASCII, so JSON string-escaping never splits it.
_mcp_request_asked_for_code_review() {
  [[ -n "$TOOL_INPUT" ]] || return 1
  grep -qF 'Merge Gate' <<< "$TOOL_INPUT"
}

# ---- Doc plane: the same two-sided provenance the code plane above has had all along ----
#
# Output side. Anchored exactly like `_mcp_output_is_code_review`: the `Document Review` section
# header the doc-review prompt template mandates (skills/doc-review/references/), allowing
# markdown heading or bold decoration and trailing text, but requiring the line to BEGIN with it.
# The unanchored predecessor matched the literal anywhere — including a table cell, a quoted
# heading, or this very comment — which is how reviewing this repo's own docs minted doc verdicts.
_mcp_output_is_doc_review() {
  grep -qE '^[[:space:]]*(#{2,4}[[:space:]]+|\*\*)Document Review([^A-Za-z0-9]|$)' <<< "$1"
}

# Request side. Same rationale, same residual, and the same non-wedging property as the code
# plane's twin: every doc-review dispatch embeds the template's `## Document Review` Output-Format
# section in its PROMPT, so a call that never asked for one cannot mint one. A paraphrased prompt
# that drops the phrase SKIPS the verdict rather than inverting it — the gate stays unsatisfied
# and the loop re-requests, which is the safe direction. Scans raw `tool_input` for the same two
# reasons documented above: the two MCP tools carry different field shapes, and a plain `grep -F`
# needs no jq, keeping the check honest under the hand-written jq stub the tests run against.
#
# ⚠️ Residual (identical to the code plane, and bounded the same way): this is provenance, not
# AUTHENTICATION. `Document Review` is repo text, so an engineered prompt still passes. Consistent
# with this hook's cooperative threat model (trust root = `.claude/` integrity).
_mcp_request_asked_for_doc_review() {
  [[ -n "$TOOL_INPUT" ]] || return 1
  grep -qF 'Document Review' <<< "$TOOL_INPUT"
}

# Doc verdict, BLOCKED-first (fail-closed) — matching `_mcp_code_review_passed` and the plan
# branch. The old chain tested `✅ Mergeable` FIRST, so a report that listed 🔴 items and then
# quoted the passing sentinel anywhere banked the pass. Emits "" (not "false") when neither
# sentinel is present, so the caller can distinguish "reviewed and failed" from "no verdict to
# record" — writing `passed=false` for the latter would fabricate a rejection nobody issued.
_mcp_doc_review_passed() {
  local output="$1"
  grep -qE '⛔ Needs revision' <<< "$output" && { echo "false"; return; }
  grep -qE '✅ Mergeable' <<< "$output" && { echo "true"; return; }
  echo ""
}

# ⚠️ RESIDUAL GAP (bounded, not closed): MCP code-review provenance is not AUTHENTICATED.
#
# The check above raises the bar from "the output mentions a gate" to "the request asked for one",
# which closes the accidental reproduction. It is not a forgery defense: `Merge Gate` is repo text.
# A prompt engineered to contain it still passes, so an ADVERSARIAL producer is out of reach here.
# That is consistent with this hook's stated threat model (cooperative; trust root = `.claude/`
# integrity), the same boundary `_is_clean_runner_invocation` draws for the precommit runner.
#
# An EARLIER prompt-side guard was tried and REVERTED. It failed on both counts the current one
# survives, and the difference is worth recording so it is not re-litigated:
#   - it matched `You are a senior Code Reviewer`, a phrase from `rules/codex-invocation.md` that
#     CLAUDE.md loads into every session — so it appeared in prompts that were not reviews at all,
#     making it weaker than the current marker rather than stronger;
#   - it had no fallback producer in mind. A dropped verdict also skips `_update_iteration()`, so
#     `current_round` stops advancing and the max-rounds escape hatch can never fire on exactly the
#     long loops that need it. `emit-review-gate.sh` is what makes that survivable now.
#
# FULL binding still requires a token the model cannot reproduce from repo content: a per-run nonce
# minted before dispatch (the `scripts/emit-review-gate.sh` pattern), placed in the review prompt,
# echoed back by the reviewer, and consumed on use. That is coordinated work across the review
# templates, this hook, and the state schema, tracked as its own item rather than approximated
# here. Residual exposure meanwhile is bounded by `precommit`, which has no MCP producer at all
# (see the Priority 3 note below) and still gates a full stop.

# Code-review verdict from MCP output, BLOCKED-first (fail-closed).
# Precedence mirrors the plan-review branch and _parse_review_gate's multi-fence rule:
# ambiguous output carrying BOTH markers must route to blocked, never to ready. The prior
# READY-first ordering let a report that listed a blocking finding and then a passing tail
# bank a false pass. Callers must gate on _mcp_output_is_code_review first; reaching here
# without a parseable verdict returns false (proven review context, unreadable gate).
_mcp_code_review_passed() {
  local output="$1" gates
  gates=$(_json_fenced_gates "$output")
  grep -qx 'BLOCKED' <<< "$gates" && { echo "false"; return; }
  grep -qE '⛔ Blocked' <<< "$output" && { echo "false"; return; }
  grep -qx 'READY' <<< "$gates" && { echo "true"; return; }
  grep -qE '✅ Ready' <<< "$output" && { echo "true"; return; }
  echo "false"
}

# === Backgrounded MCP review — issue #10 ===
# When an MCP call outlives the foreground timeout the harness *completes* the tool call with a
# handoff placeholder and delivers the real report later as a task notification — which is not a
# PostToolUse event and has no hook firing point anywhere. The verdict therefore exists and is
# simply unreachable from this process; no output-side predicate can be loosened to find it.
#
# What this must NOT do is discharge the gate. No verdict was observed, and manufacturing one is
# precisely the fail-open that the two-sided provenance design exists to prevent — the same class
# of defect as issue #9. It records only WHY the receipt is missing. `background_reviews` is an
# advisory breadcrumb: no consumer reads it as a receipt, and the gate stays shut.
#
# Measured against a real transcript, the placeholder arrives as a single-entry text-block array:
#   MCP tool "codex/codex" is still running after 120s. It was moved to the background as task
#   kimyfg23u and keeps running; … To stop it, use TaskStop with task_id "kimyfg23u".
# The normalizer above already flattens that shape, so matching TOOL_OUTPUT directly is enough.
#
# Matched on the FIRST non-empty line, and that precision is the whole point. An unanchored pair of
# substring matches is the exact defect the doc branch below documents: this repo's own issue #10
# write-ups quote both phrases, so reviewing them yields a report containing both — and since this
# branch sits ahead of every verdict branch and exits, that review's real verdict would be silently
# swallowed. A `^`-anchored grep is not enough either, because those quotes sit inside an indented
# code fence and `^` matches any line. Requiring the placeholder to BE the output removes the class:
# a report discussing backgrounding still opens with `## Document Review`, never with this sentence.
_mcp_output_is_background_handoff() {
  local first
  first=$(grep -m1 -v '^[[:space:]]*$' <<< "$1") || return 1
  [[ "$first" =~ ^MCP\ tool\ \"[^\"]*\"\ is\ still\ running\ after ]] \
    && grep -qF 'moved to the background as task' <<< "$1"
}

# The id appears twice under two spellings. The `task_id "<id>"` form is quoted and so cannot run
# on into following prose; it is tried first for that reason, not because it comes first.
_mcp_background_task_id() {
  local id
  id=$(sed -n 's/.*task_id "\([A-Za-z0-9_-]\{1,64\}\)".*/\1/p' <<< "$1" | head -1)
  if [[ -z "$id" ]]; then
    id=$(sed -n 's/.*moved to the background as task \([A-Za-z0-9_-]\{1,64\}\).*/\1/p' <<< "$1" | head -1)
  fi
  printf '%s' "${id:-unknown}"
}

# PreToolUse side: record WHEN the reviewer was dispatched, per plane, as a MONOTONIC SEQUENCE
# NUMBER rather than a wall clock. `.seq_counter` is one counter shared with every edit stamp
# (`post-edit-format.sh`), incremented under the same lock on every dispatch AND every edit, so
# "was this plane edited at or after it was dispatched" compares two draws from a single strictly
# increasing source — never two reads of a clock that is not guaranteed to move forward (leap
# seconds, NTP step, a suspended sandbox clock). See the request doc § Follow-up (4.2.1).
#
# **Set-if-absent for `dispatch_epoch[plane]`, but `dispatch_count[plane]` increments on EVERY
# call.** Two dispatches in flight on one plane cannot be told apart — the hook payload carries no
# `tool_use_id` — so keeping the EARLIEST in-flight instant still means any edit after any of them
# invalidates: every ambiguity resolves toward refusal. What set-if-absent alone could not promise is
# retirement: an epoch cleared the moment ONE dispatch resolves is free for a LATER, unrelated
# dispatch on the same plane to inherit, and that dispatch's still-in-flight review then reads a
# fresh instant as its own and passes staleness checks it should have failed. The count is what
# closes that: `dispatch_epoch[plane]` retires only once every dispatch that ever incremented the
# count has also resolved — see `_DISPATCH_EPOCH_RETIRE_JQ` below.
_record_dispatch_epoch() {
  local plane="$1" tmp _rde_ok=false
  # Round-25 finding #3: this is the PreToolUse increment — a silent give-up here means the
  # PostToolUse release side (driven by request-text predicates, not a per-dispatch token) cannot
  # tell "this dispatch never got a reference" from "it did", and can end up releasing an
  # unrelated, still-outstanding dispatch's count instead. A moderately longer budget than the 5s
  # default measurably shrinks how often that ambiguity is even reached.
  #
  # Round-26 finding #5: shrinking the window is not the same as closing it, and every failure
  # path below now also leaves a durable trace — a `dispatch_acquire_failed:$plane` per-event
  # marker via `_sidecar_emergency_mark`, lock-free by construction (this function has typically
  # already failed to get the lock at least once by the time it writes one). `_clear_dispatch_epoch`
  # consumes it before ever touching the real count — see its own comment and
  # docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md § 4.2.7.
  # Round-27 finding #4 / round-28 finding #2 (architecture-level residual risk, human-reviewed and
  # accepted — see
  # docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md § 4.2.9):
  # this marker is plane-scoped, not dispatch-scoped, so an unrelated concurrent dispatch on the same
  # plane can consume the WRONG failure marker. Round 27 read this as an over-conservative leak; round
  # 28 traced a path where it instead lets a genuinely STALE background-recovered verdict pass a
  # freshness check — not merely a leaked reference count. No exact per-dispatch fix exists without an
  # identity the hook payload does not carry; a fail-closed local mitigation exists but trades away
  # background-recovery availability on the affected plane. The human explicitly chose to accept this
  # residual risk rather than pay that availability cost — no further code change is planned here.
  if ! _lock 10; then
    _sidecar_emergency_mark "dispatch_acquire_failed:${plane}" || true
    return 0
  fi
  if ! init_state_file; then
    _unlock
    _sidecar_emergency_mark "dispatch_acquire_failed:${plane}" || true
    return 0
  fi
  tmp=$(_lock_staging_file) || {
    _unlock
    _sidecar_emergency_mark "dispatch_acquire_failed:${plane}" || true
    return 0
  }
  if jq --arg p "$plane" \
       '((.seq_counter // 0) + 1) as $newseq
        | .seq_counter = $newseq
        | .dispatch_count = ((.dispatch_count // {}) | .[$p] = ((.[$p] // 0) + 1))
        | .dispatch_epoch = ((.dispatch_epoch // {}) | (if has($p) then . else .[$p] = $newseq end))' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE" && _rde_ok=true
  fi
  if [[ "$_rde_ok" != "true" ]]; then
    rm -f "$tmp" 2>/dev/null
    _sidecar_emergency_mark "dispatch_acquire_failed:${plane}" || true
  fi
  _unlock
  return 0
}

# === Doc-plane instrumentation (advisory — never affects a gate) ===
# The doc plane has no round counter: `current_round` counts code-review rounds only, so the doc
# plane's *rate* — the thing the "dozens of rounds" complaint is about — is currently unmeasurable.
# These counters make it observable without giving the plane a cap, a stall detector, or any
# blocking behaviour. `dispatches - verdicts` is the loss metric (timeouts, lost background tasks);
# `no_verdict` isolates the subset where a report DID come back but carried no sentinel; `legacy`
# holds direct Bash/Skill verdicts, which never incremented `dispatches` and would otherwise read
# as loss. Field semantics and what the numbers are compared against:
# docs/features/doc-review-phasing/2-tech-spec.md § 4 Step 1.
#
# Deliberately NOT folded into `_record_dispatch_epoch` or `update_state`: those carry the receipt
# and reference-count invariants this file has spent thirty review rounds on, and a counter that is
# advisory by construction must never be able to fail one of their transactions. The price is that
# a counter can drift from a receipt when a bump loses the lock — acceptable for instrumentation,
# and why every call site ignores the return value and why this always returns 0.
_bump_doc_counter() {
  local tmp f jq_expr _bdc_ok=false
  [[ $# -gt 0 ]] || return 0
  jq_expr='.doc_iteration_history //= {"dispatches":0,"verdicts":0,"passes":0,"blocks":0,"no_verdict":0,"legacy":0}'
  for f in "$@"; do
    case "$f" in
      dispatches|verdicts|passes|blocks|no_verdict|legacy) ;;
      *) return 0 ;;  # unknown field: write nothing rather than inventing a key
    esac
    jq_expr+=" | .doc_iteration_history.${f} = ((.doc_iteration_history.${f} // 0) + 1)"
  done
  _lock 5 || return 0
  if ! init_state_file; then _unlock; return 0; fi
  tmp=$(_lock_staging_file) || { _unlock; return 0; }
  if jq "$jq_expr" "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE" && _bdc_ok=true
  fi
  [[ "$_bdc_ok" == "true" ]] || rm -f "$tmp" 2>/dev/null
  _unlock
  return 0
}

# Shared by every retirement site (`_clear_dispatch_epoch` below and `update_state`'s own plane-wide
# sweep): decrement `dispatch_count[plane]`, and only once it reaches zero clear `dispatch_epoch[plane]`
# and the count entry itself. One filter, not two copies — two independently-written unconditional
# `del`s is exactly how a leaked epoch went unnoticed by review of the other site. Decrementing an
# absent count is a no-op: `// 1` floors at zero rather than going negative.
# Takes `$n` — how many units to release for plane `$p` — as an input variable rather than a
# hardcoded 1 (round-22 finding #1/#3: a flat, always-1 decrement is only correct when the call
# retiring markers happens to be retiring exactly one dispatch's worth; a plane-wide sweep that
# clears N pending markers, or a legacy call that never incremented at all, each need a DIFFERENT
# release amount). `_clear_dispatch_epoch` runs this bare, as its own whole program (`$p`/`$n` bound
# via `--arg`/`--argjson`).
_DISPATCH_EPOCH_RETIRE_JQ='
  .dispatch_count = ((.dispatch_count // {}) | .[$p] = (((.[$p] // $n) - $n) as $newval | if $newval < 0 then 0 else $newval end))
  | (if ((.dispatch_count[$p] // 0) <= 0)
     then (.dispatch_epoch = ((.dispatch_epoch // {}) | del(.[$p])))
          | (.dispatch_count = ((.dispatch_count // {}) | del(.[$p])))
     else . end)
  | (if ((.dispatch_epoch // {}) | length) == 0 then del(.dispatch_epoch) else . end)
  | (if ((.dispatch_count // {}) | length) == 0 then del(.dispatch_count) else . end)
'

# The SAME body, wrapped as a jq `def` so `update_state`'s own jq program (below) can CALL it by name
# instead of splicing its TEXT inline. Splicing text into update_state's program would embed a
# literal `'` mid-string — that program is one big single-quoted bash literal, and an embedded quote
# both breaks bash's own parsing and defeats every tool that extracts the filter as one delimited
# string (`test/hooks/jq-filter-fidelity.test.js`'s `RESET_FILTER`, notably — round-23 review caught
# exactly this: the splice compiled under bash but produced a truncated, syntactically invalid jq
# program the moment anything tried to extract and re-run it). Prepended as its own bash-string PIECE
# immediately before update_state's literal opens (bash concatenates adjacent quoted strings with no
# operator needed) — never pasted mid-stream the way the removed `_CLEAR_PLANE_MARKERS_JQ` was.
_DISPATCH_EPOCH_RETIRE_DEF="def retire_dispatch_epoch(\$p; \$n): ${_DISPATCH_EPOCH_RETIRE_JQ} ;
"

# Retires a plane's dispatch epoch WITHOUT touching its markers (the two retire together, same
# transaction, only in `update_state`'s own plane-wide branch — see `_DISPATCH_EPOCH_RETIRE_DEF`).
# Reference-counted via `_DISPATCH_EPOCH_RETIRE_JQ`: `$n` is the release credit THIS call applies —
# a base unit (1 on this plane's first attempt in this hook invocation, 0 on a same-invocation
# retry whose base was already parked as a marker — `_cde_attempted_planes` tracks which) plus
# however many `dispatch_pending_release:$plane:<count>` markers this call PEEKS (never destroys
# until commit — `_sidecar_peek_counted_markers`, summed). Round-30 finding #1: the previous design
# destructively drained those markers BEFORE knowing whether the transaction they fed would land —
# a call that drained, then failed both the transaction and its own single-marker replacement
# write, permanently lost a credit nothing else recorded anywhere. Peeking removes the loss
# entirely: every marker this call did not write itself stays on disk untouched until the
# transaction actually commits (consumed then, by exact path, via `_sidecar_consume_marker_path`);
# on any failure this call ever marks at most its OWN `_base` (0 or 1) — bounded, one write, same
# as every pre-round-29 design — never the full `n`, so there is nothing borrowed from an earlier
# marker to lose. `$2` is a genuine per-call-site lock-timeout override. Return code is meaningful:
# 0 only on a confirmed release or nothing-to-do, 1 otherwise — the MCP routing chain's
# `_settled_doc`/`_settled_code` flags check it before marking settlement. Full derivation,
# round-by-round:
# docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md § 4.2.7-4.2.11.
_clear_dispatch_epoch() {
  local plane="$1" lock_timeout="${2:-}" tmp _retired=false n _drained=0 _base=1 _marked=true
  local -a _peek_paths=()
  local _pk_path _pk_cnt _pp
  _cde_attempted_planes="${_cde_attempted_planes:-}"
  [[ -f "$STATE_FILE" ]] || return 0
  # Round-26 finding #5: a durable `dispatch_acquire_failed:$plane` marker means the PreToolUse
  # increment this release exists to cancel never actually committed — consuming it (symmetric,
  # lock-free counterpart to `_record_dispatch_epoch`'s own write) cancels that phantom debit
  # instead of decrementing a real, unrelated dispatch's count. See that function's comment.
  _sidecar_consume_marker "dispatch_acquire_failed:${plane}" && return 0
  grep -qE '"dispatch_count"|"dispatch_epoch"' "$STATE_FILE" 2>/dev/null || return 0
  case " ${_cde_attempted_planes} " in
    *" ${plane} "*) _base=0 ;;
  esac
  # Round-28 finding #1: registering the plane here, unconditionally, meant a same-invocation
  # retry saw `_base=0` even when THIS call's own credit never landed anywhere — neither committed
  # to `dispatch_count` nor durably marked, because every `_sidecar_emergency_mark` call below is
  # best-effort (`|| true`). Registration now happens only once this call's own share is actually
  # accounted for — see the sites below that append to `_cde_attempted_planes`, guarded on
  # `_marked`/`_retired`, never unconditionally.
  #
  # Round-25 finding #2: every call site is ITSELF compensation for a write that already failed
  # (`_record_background_review`'s four failure branches) — there is no further fallback if this
  # lock attempt also gives up. Poll for longer than the 5s default, converging toward LOCK_TTL's
  # own 30s stale-reclaim horizon, since these call sites are rare and already degraded.
  if ! _lock "$lock_timeout"; then
    if [[ "$_base" -gt 0 ]]; then
      _sidecar_emergency_mark "dispatch_pending_release:${plane}:${_base}" || _marked=false
      [[ "$_marked" == "true" ]] && _cde_attempted_planes="${_cde_attempted_planes}${_cde_attempted_planes:+ }${plane}"
    fi
    return 1
  fi
  while IFS=$'\t' read -r _pk_path _pk_cnt; do
    [[ -n "$_pk_path" ]] || continue
    _peek_paths+=("$_pk_path")
    _drained=$((_drained + _pk_cnt))
  done < <(_sidecar_peek_counted_markers "dispatch_pending_release:${plane}:")
  n=$((_base + _drained))
  if [[ "$n" -eq 0 ]]; then
    # Nothing owed: this plane was already attempted once in this invocation (so its base was
    # charged there), and nothing is left to peek — an unrelated, different invocation already
    # consumed and applied it, or there was never anything to release on this retry.
    _unlock
    return 0
  fi
  tmp=$(_lock_staging_file) || {
    _unlock
    if [[ "$_base" -gt 0 ]]; then
      _sidecar_emergency_mark "dispatch_pending_release:${plane}:${_base}" || _marked=false
      [[ "$_marked" == "true" ]] && _cde_attempted_planes="${_cde_attempted_planes}${_cde_attempted_planes:+ }${plane}"
    fi
    return 1
  }
  if jq --arg p "$plane" --argjson n "$n" "$_DISPATCH_EPOCH_RETIRE_JQ" \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    if _own_lock && mv "$tmp" "$STATE_FILE"; then
      _retired=true
    else
      rm -f "$tmp" 2>/dev/null
    fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  # Only once the transaction has actually committed do the peeked markers stop being needed —
  # consuming them here, still under the lock, is what makes the peek safe against a concurrent
  # locked call: nothing else can be mid-peek on the same markers while this one holds the lock.
  if [[ "$_retired" == "true" ]]; then
    for _pp in "${_peek_paths[@]}"; do
      _sidecar_consume_marker_path "$_pp" || true
    done
  fi
  _unlock
  # A failed transaction leaves every peeked marker untouched — nothing to re-mark for them. Only
  # THIS call's own base contribution (bounded to at most 1) ever needed representing in the first
  # place, so only it is marked here.
  if [[ "$_retired" != "true" && "$_base" -gt 0 ]]; then
    _sidecar_emergency_mark "dispatch_pending_release:${plane}:${_base}" || _marked=false
  fi
  if [[ "$_base" -gt 0 && ( "$_retired" == "true" || "$_marked" == "true" ) ]]; then
    _cde_attempted_planes="${_cde_attempted_planes}${_cde_attempted_planes:+ }${plane}"
  fi
  [[ "$_retired" == "true" ]] && return 0
  return 1
}

# Round-24 P1#5: every failure branch below runs AFTER `_record_dispatch_epoch` has already
# incremented this task's reference at PreToolUse. A marker that never gets written can never be
# found by recovery — there is exactly one call site for this function (the PostToolUse handoff
# path), so nothing else will ever look this task up — and retaining the reference only makes a
# LATER, unrelated dispatch on this plane wait behind a count that no marker will ever explain.
# `_clear_dispatch_epoch` is the same best-effort releaser every other site already uses; each
# failure branch below calls it only after its own `_unlock`, so it takes a fresh lock rather than
# re-entering one this function still holds.
_record_background_review() {
  local plane="$1" task_id="$2" ts tmp _bg_write_ok=false
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if ! _lock; then
    echo "[Review State] background-review marker skipped (lock contention) — the fact above is the only record" >&2
    # Round-26 finding #3: a bare failing call here is a `set -euo pipefail` abort — `|| true`
    # matches this file's existing idiom (e.g. line ~3450's `_record_dispatch_epoch ... || true`).
    _clear_dispatch_epoch "$plane" 25 || true
    return 0
  fi
  # Create the file rather than bailing when it is absent. Bailing looks harmless and is not: the
  # first review of a session can be the one that times out, and that is exactly when losing the
  # explanation costs the most — the state would then read `executed:false` with nothing at all
  # saying why. Same degrade-never-abort contract as `update_state`.
  if ! init_state_file; then
    _unlock
    echo "[Review State] background-review marker skipped (state file absent and not creatable)" >&2
    _clear_dispatch_epoch "$plane" 25 || true
    return 0
  fi
  tmp=$(_lock_staging_file) || {
    echo "[Review State] background-review marker skipped (mktemp unavailable)" >&2
    _unlock
    _clear_dispatch_epoch "$plane" 25 || true
    return 0
  }
  # The marker carries the DISPATCH instant, not this one. The handoff fires ~120 s after the
  # request, so stamping "now" here would place the marker after any edit made while the reviewer
  # was reading — the fail-open this whole mechanism exists to close. `0` when no epoch was
  # recorded (a dispatch whose own PreToolUse never ran), and the reader refuses on `0`.
  #
  # The epoch is NOT consumed here. It is retired by the verdict that resolves the plane, and a
  # leaked one only makes the next recovery stricter — so unlike the fingerprint this replaced,
  # there is nothing an unprovable read could bank incorrectly.
  #
  # Newest last, most recent 5 kept: every hook re-reads this file, so an unbounded list would let
  # one slow session tax every subsequent read. The cap is on the shared array, not per-plane, so a
  # burst on one plane can evict the other's marker too — the eviction loop below handles either.
  #
  # Cap-eviction accounting (round-22 finding #2, refined round-23 P1#2 part 2, refined round-24
  # P1#3): the evicted prefix is computed BEFORE truncating, deduped to DISTINCT (plane, task) pairs,
  # then released through the shared retire_dispatch_epoch — see
  # docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md § 4.2.3
  # for why an undeduped per-row release over-credits. Deduping WITHIN the evicted set is not enough:
  # duplicate rows for one task can straddle the cap boundary — one evicted, one retained — and
  # crediting the evicted one released a task that is still tracked. `$evicted_pairs - $retained_pairs`
  # (jq array difference, by value) drops any evicted pair that still has a surviving row.
  if jq --arg p "$plane" --arg t "$task_id" --arg at "$ts" \
       "${_DISPATCH_EPOCH_RETIRE_DEF}"'((.dispatch_epoch[$p]) // 0) as $de
        | ((.background_reviews // []) + [{plane:$p, task:$t, at:$at, dispatch_epoch:$de}]) as $full
        | ($full | length) as $fulllen
        | (if $fulllen > 5 then $full[0:($fulllen - 5)] else [] end) as $evicted
        | ($full[-5:]) as $retained
        | .background_reviews = $retained
        | (($evicted | map({plane, task}) | unique) - ($retained | map({plane, task}) | unique)) as $released_pairs
        | ($released_pairs | group_by(.plane) | map({plane: .[0].plane, n: length})) as $released_by_plane
        | reduce $released_by_plane[] as $g (.; retire_dispatch_epoch($g.plane; $g.n))' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    _own_lock && mv "$tmp" "$STATE_FILE" && _bg_write_ok=true
  fi
  [[ "$_bg_write_ok" == "true" ]] || rm -f "$tmp" 2>/dev/null
  _unlock
  # `_own_lock` returning false here means the transaction above never landed (a stale-recovery
  # takeover mid-section, same hazard `update_state` guards against) — that failure mode falls
  # through to the same compensating release as every branch above, not just the two explicit ones.
  [[ "$_bg_write_ok" == "true" ]] || _clear_dispatch_epoch "$plane" 25 || true
  return 0
}

# --- Verdict recovery ---
#
# Consumes ONE marker, by `(task, plane)`. The task id alone does not identify a marker: one handoff
# whose prompt asks for both namespaces writes a `doc` AND a `code` marker under the SAME task id, so
# consuming by task deleted both. Concretely — the doc marker is visited first, its report turns out
# to be code-only, the plane-routing refusal consumes "the task", and the code iteration that follows
# finds no marker and refuses a verdict that was there to be recovered.
# `update_state`'s plane-wide sweep (its own `elif $cp != ""` branch) retires a whole plane, which is right
# when a foreground verdict lands and wrong here: up to five markers are kept, so recovering an older
# task's `✅ Ready` also deleted a newer task's marker and the replacement's `⛔ Blocked` had nothing
# left to attach to — a pass banked and a block lost, from one recovery.
#
# **Returns non-zero when the marker did not go away**, and every caller about to bank a verdict must
# consume FIRST and write only on success. Reversed, a banked receipt stays REPLAYABLE over a newer
# verdict, and every write in that sequence succeeds so no sidecar fires. Consuming first inverts the
# failure: the marker is gone before the verdict exists, so a failed write loses the verdict and
# leaves the gate shut. The A/B interleaving that makes it concrete:
# docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md
# § Follow-up (4.2.1) → "Consuming, not clearing".
_consume_background_review() {
  local task="$1" plane="$2" tmp rc=1
  [[ -n "$task" && -n "$plane" ]] || return 1
  [[ -f "$STATE_FILE" ]] || return 1
  _lock || return 1
  tmp=$(_lock_staging_file) || { _unlock; return 1; }
  # `empty` when the marker is not there, so jq writes nothing and the `-s` test below fails. A plain
  # filter would have succeeded on a marker that had ALREADY been retired, and "jq and mv succeeded"
  # is then not evidence that THIS call consumed anything: a concurrent foreground verdict that
  # cleared the plane and banked `⛔ Blocked` leaves this call reporting success, and the caller
  # overwrites that block with the recovered `✅ Ready`. Presence is the thing being claimed, so
  # presence is what has to be checked.
  #
  # Round-24 P1#2 (same fix as `update_state`'s task-scoped branch): the marker's removal is this
  # dispatch's terminal disposition, so releasing its reference (`retire_dispatch_epoch($p; 1)` — this
  # call always consumes exactly one distinct task's marker) happens in this SAME transaction, not a
  # separately-locked follow-up call a caller could fail to reach.
  if jq --arg t "$task" --arg p "$plane" --argjson n 1 \
       "${_DISPATCH_EPOCH_RETIRE_DEF}"'if ((.background_reviews // []) | map(select(.task == $t and .plane == $p)) | length) == 0 then empty
        else .background_reviews = ((.background_reviews // [])
               | map(select((.task == $t and .plane == $p) | not)))
             | retire_dispatch_epoch($p; $n) end' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    if _own_lock && mv "$tmp" "$STATE_FILE"; then rc=0; else rm -f "$tmp" 2>/dev/null; fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  _unlock
  return "$rc"
}

_bg_recovered_report() {
  local task="$1" lines="${AUTO_LOOP_BG_SCAN_LINES:-2000}"
  [[ -n "${TRANSCRIPT_PATH:-}" && -f "$TRANSCRIPT_PATH" ]] || return 0
  # `first(inputs)` streams and short-circuits: the transcript is routinely tens of MB, and a
  # duplicate delivery of the same task carries the same verdict, so stopping at the first match is
  # both cheaper and deterministic. A payload whose own text contains `</result>` truncates, then
  # fails `fromjson`, then fails `select(type == "object")` — three fail-closed steps, no verdict.
  #
  # **The id and status are matched in the ENVELOPE ONLY** — `$parts[0]`, everything before the first
  # `<result>` — never across the whole entry. Matching the whole entry meant a genuine notification
  # for task B whose report merely QUOTED `<task-id>task-A</task-id>` satisfied task A's marker and
  # banked B's verdict against A. Reports in this repository quote exactly that, so it was reachable,
  # not theoretical. It is also the same defect as #9 and #11 — a payload matched as though it were
  # metadata — which is why the three structural selects above are not enough on their own: they
  # authenticate the ENTRY, and this authenticates WHICH DISPATCH the entry answers.
  tail -n "$lines" "$TRANSCRIPT_PATH" 2>/dev/null | jq -rn --arg id "$task" '
    first(
      inputs
      | select(.type == "user")
      | select(has("toolUseResult") | not)
      | select((.origin.kind // "") == "task-notification")
      | select((.message.content | type) == "string")
      | .message.content
      | split("<result>")
      | select(length > 1)
      | select(.[0] | contains("<task-id>" + $id + "</task-id>"))
      | select(.[0] | contains("<status>completed</status>"))
      | .[1]
      | split("</result>") | .[0]
      | (try fromjson catch null)
      | select(type == "object")
      | .content
      | select(type == "string")
    )
  ' 2>/dev/null
}

# Staleness is decided by ORDERING, never by content and never by a wall clock. `invalidate_review`
# already drops a plane's markers on every Edit/Write, so a surviving marker proves no *tracked
# edit* has invalidated the plane since dispatch; the check below asks the question directly, using
# the same monotonic `seq_counter` both the dispatch and the edit stamp: did a tracked edit land at
# or after the instant the reviewer was dispatched. It does NOT close a Bash-tool mutation (`sed -i`,
# `git apply`, `lint:fix`) — nothing stamps an edit epoch for those, and that gap is inherent to this
# whole mechanism, not something this specific check alone happens to miss; see "What this does NOT
# catch" below, where the same fact is stated with its consequence.
#
# The wall-clock window this replaces was wrong in a way worth recording, because it looked right:
# it is the one mechanism in this class of problem that no authority recommends. GitHub keys a check
# to `head_sha`, Gerrit to a patch set, Zuul freezes the repo state, Bazel digests the input set —
# and clocks are not monotonic, so "the result arrived after the last edit" is not a fact the machine
# can establish. It also failed open twice concretely (Bash octal on `000128`, and an `at_epoch`
# sampled after lock contention) and its safe-looking direction — raising the window — silently
# disabled recovery. Sources and the full argument:
# docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md
# § Follow-up (4.2.1).
_recover_background_reviews() {
  [[ -n "${TRANSCRIPT_PATH:-}" && -f "$TRANSCRIPT_PATH" ]] || return 0
  [[ -f "$STATE_FILE" ]] || return 0
  # Cheap textual pre-filter before any jq parse or transcript read — markers are rare, and every
  # matched event would otherwise pay for both on the common case of nothing pending.
  grep -q '"background_reviews"' "$STATE_FILE" 2>/dev/null || return 0
  grep -q '"plane"' "$STATE_FILE" 2>/dev/null || return 0

  local markers plane task marker_de report verdict is_doc is_code _alf_new superseded _rec_guard
  local edited_at
  markers=$(jq -r '(.background_reviews // [])[]
      | select(.plane == "doc" or .plane == "code")
      | "\(.plane)\t\(.task)\t\(.dispatch_epoch // 0)"' "$STATE_FILE" 2>/dev/null) || return 0
  [[ -n "$markers" ]] || return 0

  while IFS=$'\t' read -r plane task marker_de; do
    [[ -n "$plane" && -n "$task" && "$task" != "unknown" ]] || continue
    # `marker_de` reaches two bash arithmetic `-ge` comparisons below, and `[[ ]]`'s arithmetic
    # operators recursively evaluate a variable-shaped operand — an unvalidated value crafted like
    # `a[$(cmd)]` would execute `cmd`. It is state-file content
    # (`.background_reviews[].dispatch_epoch`), not a value this hook produced itself, so it gets the
    # same treatment `edited_at` already does below: digits only, else the "no epoch recorded" case
    # both comparison sites already refuse on. Leading zeros are refused too, not just non-digits —
    # `^[0-9]+$` alone accepted "000128", which bash arithmetic then parses as octal (base 8, no
    # digit 8/9 valid) and errors "value too great for base" on the `-ge` below, silently evaluating
    # the comparison false and defeating the freshness check by a different route than the injection
    # this guard was written to close. `0` on its own is still accepted (the "no epoch recorded" case
    # every comparison site already treats as immediate refusal).
    [[ "$marker_de" =~ ^(0|[1-9][0-9]*)$ ]] || marker_de="0"

    # The report lookup comes first: deliveries arrive for a minority of handoffs (15–29 % across
    # three measured transcripts), so the common marker is one whose report never comes, and there is
    # no reason to read state for it. Both checks still have to pass.
    report=$(_bg_recovered_report "$task")
    [[ -n "$report" ]] || continue

    # Freshness, as an ORDERING rather than a description of the tree: was this plane edited at or
    # after the instant the reviewer was dispatched? `>=` and not `>` — an edit landing in the same
    # second as the dispatch is unordered with respect to it, and unordered resolves to refusal.
    #
    # `0` means no dispatch epoch was recorded (a marker written before this mechanism, or a dispatch
    # whose own PreToolUse never ran), and it refuses. So does an unreadable state read.
    #
    # What this does NOT catch is a mutation made through Bash — `sed -i`, `git apply`, `lint:fix` —
    # because nothing stamps an edit epoch for those. That hole is real and it is the SAME hole every
    # other gate in this repository has (`post-edit-format.sh` fires on Edit/Write/NotebookEdit
    # only); the receipt this writes is therefore exactly as trustworthy as a foreground one, which
    # is the bar it is held to. The content digest that used to close it for this path alone cost
    # 2.93 s per sample and a dispatch-attribution problem with no in-repo solution — see the request
    # doc § Follow-up (4.2.1).
    edited_at=$(jq -r --arg p "$plane" '(.last_edit_epoch_by_plane[$p]) // 0' "$STATE_FILE" 2>/dev/null) || edited_at=""
    # Same leading-zero refusal as `marker_de` above (round-22 finding #5): both feed the same
    # bash-arithmetic `-ge` comparison and both are read from the same state-file content, so a
    # leading-zero value here would hit the identical octal-parse false-negative if left permissive.
    [[ "$edited_at" =~ ^(0|[1-9][0-9]*)$ ]] || edited_at=""
    if [[ "$marker_de" == "0" || -z "$edited_at" || "$edited_at" -ge "$marker_de" ]]; then
      echo "[Review State] backgrounded ${plane} review (task ${task}) NOT recovered — the ${plane} plane was edited after the review was dispatched; the ${plane} gate stays shut" >&2
      # `_consume_background_review` releases the reference itself, in the same transaction as the
      # marker removal, only when THIS call is the one that actually found and removed the marker —
      # a marker another writer already removed means that writer's own resolution path already
      # released it, and calling again here would double-retire a dispatch still legitimately in
      # flight. `|| true`: nothing else here depends on which of the two happened.
      _consume_background_review "$task" "$plane" || true
      continue
    fi

    is_doc=false; is_code=false
    _mcp_output_is_doc_review "$report" && is_doc=true
    _mcp_output_is_code_review "$report" && is_code=true
    # Same fail-closed policy the foreground chain applies to a doubly-claimed output: recording
    # either plane is a guess, and a wrong guess writes a verdict for a plane nobody reviewed.
    if [[ "$is_doc" == "true" && "$is_code" == "true" ]]; then
      echo "[Review State] backgrounded review (task ${task}) recovered, but its report claims BOTH the doc and code namespaces — ambiguous provenance, no verdict recorded" >&2
      _consume_background_review "$task" "$plane" || true
      continue
    fi
    if { [[ "$plane" == "doc" ]] && [[ "$is_doc" != "true" ]]; } \
       || { [[ "$plane" == "code" ]] && [[ "$is_code" != "true" ]]; }; then
      echo "[Review State] backgrounded ${plane} review (task ${task}) recovered, but the report is not a ${plane} review — not routing to the ${plane} plane" >&2
      _consume_background_review "$task" "$plane" || true
      continue
    fi

    # The authorization (the ordering comparison above) and the receipt (below) take separate
    # locks, and the compensation for an edit landing between them is the post-write re-sample at the
    # end of this iteration. That converges to shut, but it converges LATE: a concurrent Stop hook
    # firing inside the window reads a passing receipt whose marker is already gone and lets the
    # session end. The sidecar spans exactly that window — raised before the write, cleared once the
    # re-sample has had its say — so a Stop arriving mid-recovery fails closed instead of reading a
    # verdict that is still provisional.
    # Unique per recovery, and verified to have landed in the SHARED file. The reason set is
    # de-duplicated, so a plane-wide string would be one line two concurrent recoveries share and
    # either could lower while the other's receipt is still provisional. And `_set_own_sidecar`
    # reports success for its emergency per-event marker too — which is deliberately unretirable, so
    # bracketing on one would strand it for the session. Neither condition met means the window
    # cannot be guarded, and an unguarded window is a reason not to write, not a reason to proceed.
    _rec_guard="recovery_in_progress:${plane}_review:$$-${EPOCHSECONDS:-0}-${RANDOM}${RANDOM}"
    if ! _set_own_sidecar "$_rec_guard" \
       || ! grep -qxF "$_rec_guard" "${STATE_FILE}.blocked" 2>/dev/null; then
      echo "[Review State] backgrounded ${plane} review (task ${task}) NOT recovered — the recovery window could not be guarded, so no verdict was recorded from it" >&2
      continue
    fi

    if [[ "$plane" == "doc" ]]; then
      verdict=$(_mcp_doc_review_passed "$report")
      if [[ -z "$verdict" ]]; then
        echo "[Review State] backgrounded doc review (task ${task}) carries no verdict sentinel — no state recorded" >&2
        _clear_own_sidecar "$_rec_guard"
        # A report that came back malformed is `no_verdict`, not a lost dispatch — the same call the
        # foreground MCP branch makes. Counted only when THIS call is the one that claimed the
        # marker: a replayed delivery or a concurrent writer that already consumed it would
        # otherwise count one returned report twice, and `dispatches - verdicts` is the figure this
        # instrumentation exists to make honest. `if` and not `&&` for what it says, not for
        # errexit — a failing left-hand command in an AND-list is exempt from `set -e`, so both
        # forms are safe here: the `if` states that counting is bound to marker OWNERSHIP, and
        # yields a harmless status when a competing writer wins the consume.
        if _consume_background_review "$task" "$plane"; then _bump_doc_counter no_verdict; fi
        continue
      fi
      # Marker retirement and receipt are ONE locked transaction — `update_state`'s 5th argument.
      # Anything less loses a verdict to an interleaved foreground review; the argument's comment
      # carries the two orderings.
      _alf_begin doc_review
      if ! update_state "doc_review" "true" "$verdict" "" "$task" "$plane"; then
        echo "[Review State] backgrounded doc review (task ${task}) recovered but its marker was already retired — another writer resolved this dispatch, so no verdict was recorded from it" >&2
        _clear_own_sidecar "$_rec_guard"
        continue
      fi
      # Round-24 P1#2: `update_state`'s task-scoped branch now retires the marker AND releases the
      # epoch/count in the SAME jq transaction — no separate `_clear_dispatch_epoch` call here. The
      # old split (marker removed by this call, epoch released by a second, separately-locked call)
      # permanently orphaned the count whenever the second lock acquisition failed; a second release
      # here now would double-retire the unit this call already closed.
      _bump_doc_counter verdicts "$([[ "$verdict" == "true" ]] && echo passes || echo blocks)"
      echo "[Review State] doc_review updated (task notification, background task ${task}): passed=$verdict" >&2
      _alf_new=$(_alf_receipt doc_review)
      _alf_emit "event=doc_review_verdict change=doc source=task_notification task=${task} $(_alf_transition doc_review "$_alf_old" "$_alf_new" "$verdict")" \
        "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo none || echo doc_review)" >&2
    else
      # `_mcp_code_review_passed` resolves BLOCKED-first and always answers, so there is no
      # empty-verdict arm here to mirror the doc branch's.
      verdict=$(_mcp_code_review_passed "$report")
      _alf_begin code_review
      if ! update_state "code_review" "true" "$verdict" "" "$task" "$plane"; then
        echo "[Review State] backgrounded code review (task ${task}) recovered but its marker was already retired — another writer resolved this dispatch, so no verdict was recorded from it" >&2
        _clear_own_sidecar "$_rec_guard"
        continue
      fi
      # Same reasoning as the doc branch above: `update_state` already released the epoch/count in
      # its own transaction — no separate `_clear_dispatch_epoch` call here.
      _update_iteration "$report" "$STATE_FILE"
      echo "[Review State] code_review updated (task notification, background task ${task}): passed=$verdict" >&2
      _alf_new=$(_alf_receipt code_review)
      _alf_emit "event=code_review_verdict change=code source=task_notification task=${task} $(_alf_transition code_review "$_alf_old" "$_alf_new" "$verdict")" \
        "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo precommit || echo code_review)" >&2
    fi
    # The checks above ran outside the state lock and `update_state` takes its own, so an edit can
    # land in between and have its invalidation overwritten by the receipt just written. Re-sampling
    # the SAME PLANE afterwards detects exactly that, and the compensation is to put the gate back
    # where the edit wanted it. Not atomic, and it does not claim to be — it converges to shut, which
    # is the direction that is safe to be late about. A single locked compare-and-consume would be
    # better and is the right shape if this ever needs to be exact.
    superseded=false
    edited_at=$(jq -r --arg p "$plane" '(.last_edit_epoch_by_plane[$p]) // 0' "$STATE_FILE" 2>/dev/null) || edited_at=""
    # Same leading-zero refusal as `marker_de` above (round-22 finding #5): both feed the same
    # bash-arithmetic `-ge` comparison and both are read from the same state-file content, so a
    # leading-zero value here would hit the identical octal-parse false-negative if left permissive.
    [[ "$edited_at" =~ ^(0|[1-9][0-9]*)$ ]] || edited_at=""
    # Re-read, not re-sample: an unreadable state file is itself a reason to withdraw, since the
    # authorization above rested on a number this cannot now confirm.
    if [[ -z "$edited_at" || "$edited_at" -ge "$marker_de" ]]; then
      superseded=true
      update_state "${plane}_review" "true" "false"
      echo "[Review State] ${plane}_review recovered verdict SUPERSEDED — the ${plane} plane was edited while the verdict was being recorded; the gate is shut again" >&2
    fi
    # The receipt now reflects the re-sample either way, so the window is over and the marker comes
    # down. Note what is deliberately NOT rolled back: `_update_iteration` above. A superseded
    # verdict is withdrawn, but the review round it counted genuinely ran and produced those
    # findings — the ledger records rounds, not verdicts, and un-counting one would make the stall
    # detector read a loop that moved as a loop that did not.
    _clear_own_sidecar "$_rec_guard"
    # Deferred until after the supersede check on purpose: this clears the list of files awaiting
    # review, and doing it before the check emptied it on a verdict that was then withdrawn — an
    # un-rolled-back side effect of a decision that did not stand.
    if [[ "$superseded" == "false" && "$plane" == "code" && "$verdict" == "true" ]]; then
      _reset_changed_files || true
    fi
  done <<< "$markers"
  return 0
}

# D-5: Parse review gate with JSON-first, text sentinel fallback
# Conflict policy: JSON READY + text BLOCKED → fail-closed BLOCKED
_parse_review_gate() {
  local output="$1"
  local json_gate text_gate

  json_gate=""
  local all_gates
  all_gates=$(_json_fenced_gates "$output")
  if [[ -n "$all_gates" ]]; then
    if grep -qx 'BLOCKED' <<< "$all_gates"; then
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

  # Same `set -e` abort as update_state's call — here it would skip the aggregate sidecar below,
  # so a lost dual-gate transition would leave no evidence at all.
  if ! init_state_file; then
    _set_own_sidecar "aggregate_write_failed" || true
    echo "[Review State] aggregate transition to ${gate_value} NOT recorded (state file absent and could not be created) — sidecar set, gate held closed" >&2
    return 1
  fi

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local tmp
  # Staged INSIDE $LOCKDIR (this function runs under the caller's `_lock` at the emit-review-gate
  # branch), so a stale-recovery takeover — which claims the lock by RENAMING the directory aside —
  # carries this temp away with it and the commits below can no longer resolve it. That binding is
  # structural rather than a check that can go stale between test and use, and it is why the same
  # treatment was given to `update_state` first.
  #
  # It was given to `update_state` ONLY, and this was the plane where the omission cost most:
  # staging beside the state file plus no ownership check anywhere meant a displaced writer's temp
  # landed on top of a committed BLOCKED aggregate gate, silently restoring READY. Reproduced end to
  # end — writer B's BLOCKED committed, writer A resumed and overwrote it, no sidecar was written,
  # and stop-guard then allowed the stop in strict mode. That defeats the "late secondary P0/P1
  # re-opens the loop" guarantee in rules/auto-loop.md.
  if ! tmp=$(_lock_staging_file); then
    _set_own_sidecar "aggregate_write_failed" || true
    echo "[Review State] aggregate transition to ${gate_value} NOT recorded (staging unavailable) — sidecar set, gate held closed" >&2
    return 1
  fi
  # Tracks whether a write actually landed. An unrecognized gate_value falls through `case` with
  # status 0 and NO write at all; clearing the fail-closed marker on that no-op would discard it
  # for free.
  local _agg_ok=false
  case "$gate_value" in
    PENDING)
      jq --arg now "$now" \
         '.review_mode = "dual" | .aggregate_gate.executed = false | .aggregate_gate.gate = null | .aggregate_gate.source = null | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "pending_review"' \
         "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$STATE_FILE" && _agg_ok=true
      ;;
    READY)
      jq --arg gate "$gate_value" --arg now "$now" \
         '.aggregate_gate.executed = true | .aggregate_gate.gate = $gate | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "precommit_pending"' \
         "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$STATE_FILE" && _agg_ok=true
      ;;
    BLOCKED)
      jq --arg gate "$gate_value" --arg now "$now" \
         '.aggregate_gate.executed = true | .aggregate_gate.gate = $gate | .aggregate_gate.reason = null | .aggregate_gate.last_run = $now | .updated_at = $now | .review_phase = "addressing_findings"' \
         "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$STATE_FILE" && _agg_ok=true
      ;;
  esac
  # A COMMITTED aggregate transition is exactly what a `lock_failure` marker was standing in for,
  # so this is the one caller entitled to clear it. Every other marker survives.
  if [[ "$_agg_ok" == "true" ]]; then
    _clear_own_sidecar "lock_failure"
    _clear_own_sidecar "aggregate_write_failed"
    return 0
  fi
  # No branch committed: an unrecognized gate_value, a jq that exited 0 having written an empty
  # temp (its behaviour on empty input), or — the case this path gained with the ownership guard —
  # a lock takeover between the jq and the rename, where `_own_lock` refuses to let a superseded
  # writer commit over its successor. All three land here, and landing here is what makes them
  # visible: the marker is raised and the caller reports a failure instead of logging a success.
  # Renaming an empty file over the state would
  # leave a 0-byte state no writer can repair — stop-guard then reads it as corrupt and forces
  # strict mode for every user. Drop the temp instead of leaking it beside the state file.
  rm -f "$tmp" 2>/dev/null || true
  # Raise the marker and REPORT the failure. Previously this path was silent and the caller logged
  # "aggregate_gate updated: gate=BLOCKED" unconditionally — so the one case where a BLOCKED gate
  # failed to persist was also the case that looked, in the log, exactly like success.
  _set_own_sidecar "aggregate_write_failed" || true
  echo "[Review State] aggregate transition to ${gate_value} NOT recorded (no write committed) — sidecar set, gate held closed" >&2
  return 1
}

# Best-effort blocked write (used when lock fails — no lock held)
# Uses both: (1) unlocked JSON write (best-effort) + (2) atomic sidecar marker (race-safe)
# UNLOCKED-WRITER: by definition — this is the path taken when `_lock` FAILED, so it cannot hold
# the lock it is standing in for. Its JSON write is explicitly best-effort; the fail-closed
# guarantee comes from the sidecar marker it sets first, not from this rewrite landing.
#
# "Best-effort" describes only what happens if the write is LOST. If it LANDS after the lock
# holder's commit it discards that commit wholesale — the rename is a whole-file replace, and the
# marker does not restore receipts or iteration history. Same defect as the degraded branch in
# post-edit-format.sh; recorded in
# docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md.
update_aggregate_blocked() {
  local reason="${1:-unknown}"
  # The return value reports whether the SIDECAR MARKER landed. Only the marker — the JSON write
  # below is diagnostic and deliberately does not count toward success.
  #
  # Two separate defects lived here. The first: this returned a flat 0 until 2026-07-26, every
  # failure path swallowed (`|| true`, or an early `return 0`), so a call in which NEITHER record
  # survived was indistinguishable from a fully successful one — in the degraded path whose entire
  # job is to leave evidence that a verdict was lost. The second, fixed with this comment: the
  # first fix counted `_json_ok` as durable, and it is not. This function is reached BECAUSE
  # `_lock` failed, i.e. because another process is inside its own transaction holding that lock.
  # That process read the state before our unlocked rewrite and will `mv` its own copy over it, so
  # an apparently successful JSON write is routinely erased milliseconds later with nothing left
  # behind. "The one durable record was lost, but an ephemeral one landed" was reported as success.
  local _sc_ok=0 _json_ok=0
  # Atomic sidecar marker: stop-guard checks this file as fail-closed fallback. Failures are
  # already logged in detail by `_set_own_sidecar` itself; here we only record whether it landed.
  _set_own_sidecar "$reason" && _sc_ok=1
  # Best-effort JSON write (may race, but the sidecar above is the fail-closed guarantee, so an
  # uncreatable state file must skip the write rather than abort past the caller's diagnostics).
  if ! init_state_file; then
    echo "[Review State] update_aggregate_blocked JSON write skipped (state file unavailable)" >&2
  else
    local now
    now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local tmp
    # Degrade, never abort — see _migrate_state_v2.
    if ! tmp=$(mktemp "$STATE_FILE.XXXXXX" 2>/dev/null); then
      echo "[Review State] update_aggregate_blocked JSON write skipped (mktemp unavailable)" >&2
    else
      if jq --arg reason "$reason" --arg now "$now" \
           '.review_mode = "dual" | .aggregate_gate.executed = true | .aggregate_gate.gate = "BLOCKED" | .aggregate_gate.reason = $reason | .aggregate_gate.last_run = $now | .updated_at = $now' \
           "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && mv "$tmp" "$STATE_FILE" 2>/dev/null; then
        _json_ok=1
      else
        rm -f "$tmp" 2>/dev/null || true
        echo "[Review State] update_aggregate_blocked JSON write failed (aggregate_gate not recorded in state)" >&2
      fi
    fi
  fi
  if [[ "$_sc_ok" -eq 0 ]]; then
    if [[ "$_json_ok" -eq 1 ]]; then
      # Distinguished from the total loss below because they need different responses from a human:
      # here the state file DOES currently read BLOCKED, so a reader that looks right now sees the
      # gate — it just cannot be relied on to still be there.
      echo "[Review State] CRITICAL: aggregate BLOCKED ('$reason') has NO durable record — the sidecar marker was lost, and the unlocked state write that did land can be overwritten at any moment by the lock holder this path exists because of" >&2
    else
      echo "[Review State] CRITICAL: aggregate BLOCKED ('$reason') was recorded NOWHERE — neither the sidecar marker nor the state file survived; stop-guard has no evidence of this lost verdict" >&2
    fi
    return 1
  fi
  return 0
}

# === Dispatch epoch (PreToolUse) ===
# The only branch this script takes on a Pre event, and it exits immediately after: nothing below
# applies to a tool that has not run yet, and falling through would parse an absent `tool_response`.
#
# One short lock and one jq, on a plane the request actually asks to review. No filesystem scan, no
# reservation protocol, and no EXIT trap to unwind — the reservation shape this replaced existed
# because the digest took 2.93 s and could not be taken under the shared lock; a scalar can.
if [[ "$HOOK_EVENT" == "PreToolUse" ]]; then
  _mcp_request_asked_for_doc_review && _record_dispatch_epoch doc || true
  # Advisory doc-plane counter, separate write on purpose — see `_bump_doc_counter`.
  _mcp_request_asked_for_doc_review && _bump_doc_counter dispatches || true
  _mcp_request_asked_for_code_review && _record_dispatch_epoch code || true
  exit 0
fi

# === Backgrounded verdict recovery (issue #10) ===
# The notification is delivered between events and belongs to no tool call of its own, so there is no
# event that IS the completion — recovery runs on the events this hook already receives and reads the
# transcript when a marker is pending. `hooks.json` decides which those are, and `TaskOutput` is in
# the list for a specific reason: it is the harness's own "is that task done yet" call, so it carries
# the completion in its `tool_input.task_id` and is the promptest trigger available. It is emphatically
# NOT every event — an earlier comment here claimed that, and the matcher never matched Edit, Write,
# Read or Agent.
#
# Ahead of the routing below so a recovered receipt is already in place for the `[AUTO_LOOP_STATE]`
# lines this run emits; where the current event carries its own verdict for the same plane, that
# verdict is written after and wins, which keeps the fresher evidence. Guarded down to two greps on a
# small file when no marker is pending.
_recover_background_reviews || true

# TaskOutput ends here. It is a trigger, not a content channel: measured, its `output` is `""` for an
# `mcp_task`, and its `tool_input` is `{task_id}` — so it carries neither review text nor the
# request-side provenance the routing below keys on. Exiting makes that true by CONSTRUCTION rather
# than leaving it to every branch below to decline a tool none of them was written for; the
# alternative is one normalizer change away from letting a background Bash task's stdout mint a
# verdict.
if [[ "$TOOL_NAME" == "TaskOutput" ]]; then
  exit 0
fi

# === Process different commands ===

# === emit-review-gate parse branch ===
# Echo the single gate argument ONLY when the ENTIRE command is a standalone
# emit-review-gate.sh invocation; empty otherwise. Same rationale as the precommit-runner
# anchor: a substring test proves the text APPEARS, never that the emitter RAN. The prior
# unanchored `grep -qE 'emit-review-gate'` let a comment, an `echo emit-review-gate`, a
# `grep -rn emit-review-gate .`, a never-taken `false && bash .../emit-review-gate.sh READY`,
# or a `...; printf 'REVIEW_GATE=READY'` chain mint an aggregate READY with neither reviewer
# having run — the aggregate gate is exactly what stop-guard trusts in dual mode.
# The charset excludes `(`, backtick, `;`, `|`, `&`, `<`, `>` and whitespace, so command
# substitution and chaining cannot hide inside the path; the newline reject closes the
# two-liner variant.
_EMIT_REVIEW_GATE_RE='^[[:space:]]*(bash[[:space:]]+|sh[[:space:]]+)?"?[A-Za-z0-9_./{}$-]*emit-review-gate\.sh"?[[:space:]]+(PENDING|READY|BLOCKED)[[:space:]]*$'
_emit_review_gate_arg() {
  local cmd="$1"
  [[ "$cmd" == *$'\n'* ]] && return 0
  [[ "$cmd" =~ $_EMIT_REVIEW_GATE_RE ]] && printf '%s' "${BASH_REMATCH[2]}"
  return 0
}

if [[ "$TOOL_NAME" == "Bash" ]]; then
  _ERG_ARG=$(_emit_review_gate_arg "$COMMAND")
  if [[ -n "$_ERG_ARG" ]]; then
    GATE_VALUE=$(echo "$TOOL_OUTPUT" | grep -oE '^REVIEW_GATE=(PENDING|READY|BLOCKED)' | tail -1 | cut -d= -f2) || GATE_VALUE=""
    # Correlate output with invocation: the emitter always prints the gate it was asked for,
    # so a mismatch means the REVIEW_GATE line did not come from this run. Fail closed.
    if [[ -n "$GATE_VALUE" && "$GATE_VALUE" != "$_ERG_ARG" ]]; then
      echo "[Review State] emit-review-gate output ($GATE_VALUE) disagrees with argument ($_ERG_ARG) — ignoring" >&2
      GATE_VALUE=""
    fi
    if [[ -n "$GATE_VALUE" ]]; then
      # Condition context, not a bare call. `update_aggregate_blocked` returns non-zero when NEITHER
      # of its durable records landed, and this `{ }` group is the LAST command of the `||` list, so
      # errexit applies inside it: a bare call would abort the hook at that exact line — losing the
      # diagnostic below, which is the one line a human reads to learn the gate failed closed.
      # Using the value also keeps it honest: it distinguishes "BLOCKED recorded" from "BLOCKED lost".
      _lock || {
        if update_aggregate_blocked "lock_failure"; then
          echo "[Review State] Lock failed, fail-closed BLOCKED (reason: lock_failure)" >&2
          exit 0
        fi
        # Exit 2, not 0. Reaching here means the aggregate BLOCKED has NO durable record, and
        # `_sc_ok=0` is a stronger statement than it looks: `_sidecar_emergency_mark` needs no
        # `mktemp` and no lock — a plain redirect plus a rename — so its failure means files cannot
        # be created beside the state file at all. That inference holds ONLY because
        # `_set_own_sidecar` diverts to the emergency marker on every nonzero rc; while the divert
        # was rc=2-only, `_sc_ok=0` also covered "the shared write failed and the emergency marker
        # was never attempted" — a DIRECTORY at the shared path returns 1 that way — and this branch
        # escalated a recoverable condition to a blocking error. There is consequently no on-disk
        # channel left to write, and the danger is not the missing BLOCKED but the value it failed
        # to displace: an
        # `aggregate_gate` left reading READY from an earlier round is exactly what stop-guard
        # trusts in dual mode, so exiting 0 hands the session a stale pass with the evidence of its
        # loss confined to a stderr line no gate reads.
        #
        # PostToolUse exit 2 routes stderr to the model as a blocking error — the same channel
        # stop-guard uses at :1168 to reach it — so the behaviour layer becomes the enforcement when
        # the state layer provably cannot be. The tool itself has already run; this reports on the
        # bookkeeping, it does not undo the command.
        #
        # RESIDUAL, stated because it cannot be closed here: a stale `aggregate_gate=READY` survives
        # on disk. Nothing can rewrite it — that is the premise of this branch — so stop-guard, which
        # reads the state file, will still see it if the session reaches a stop without the model
        # acting on this error. Clearing it is a human action (fix the permissions, start a session).
        echo "[Review State] Lock failed AND the fail-closed BLOCKED record was lost — see the CRITICAL line above. Nothing can be written beside the state file, so any earlier aggregate_gate=READY still stands and stop-guard cannot be told otherwise. Treat this session's aggregate gate as UNPROVEN." >&2
        exit 2
      }
      # `if !` rather than a bare call: under `set -e` a non-zero return would abort here and skip
      # the explicit _unlock (the EXIT trap would still fire, but the log would be lost).
      if update_aggregate_gate "$GATE_VALUE"; then
        _unlock
        echo "[Review State] aggregate_gate updated: gate=$GATE_VALUE" >&2
      else
        _unlock
      fi
    fi
  fi
fi

# === emit-plan-gate parse branch (plan namespace — mirror of emit-review-gate above) ===
# Anchored for the SAME reason as the review-gate branch, which this used to lag behind: the old
# `grep -qF 'emit-plan-gate'` proved only that the TEXT appeared, so
# `printf 'PLAN_REVIEW_GATE=READY\n' # emit-plan-gate` — which never executes the emitter — was
# eligible to mutate plan state, as were a comment, a `grep -rn emit-plan-gate .`, and a
# never-taken `false && bash .../emit-plan-gate.sh READY`. The literals stay distinct, so this
# branch and the review-gate branch still cannot match each other's commands.
# Second operand is emit-plan-gate.sh's optional `[tier|reason]` (scripts/emit-plan-gate.sh:14).
_EMIT_PLAN_GATE_RE='^[[:space:]]*(bash[[:space:]]+|sh[[:space:]]+)?"?[A-Za-z0-9_./{}$-]*emit-plan-gate\.sh"?[[:space:]]+(PENDING|READY|BLOCKED|DEGRADED|NEEDS_HUMAN|SKIPPED)([[:space:]]+[A-Za-z0-9_-]+)?[[:space:]]*$'
_emit_plan_gate_arg() {
  local cmd="$1"
  [[ "$cmd" == *$'\n'* ]] && return 0
  [[ "$cmd" =~ $_EMIT_PLAN_GATE_RE ]] && printf '%s' "${BASH_REMATCH[2]}"
  return 0
}

if [[ "$TOOL_NAME" == "Bash" ]] && [[ -n "$(_emit_plan_gate_arg "$COMMAND")" ]]; then
  _EPG_ARG=$(_emit_plan_gate_arg "$COMMAND")
  PLAN_GATE=$(echo "$TOOL_OUTPUT" | grep -oE '^PLAN_REVIEW_GATE=(PENDING|READY|BLOCKED|DEGRADED|NEEDS_HUMAN|SKIPPED)' | tail -1 | cut -d= -f2) || PLAN_GATE=""
  # Correlate output with invocation, exactly as the review-gate branch does: the emitter always
  # prints the gate it was asked for, so a mismatch means this PLAN_REVIEW_GATE line came from
  # somewhere other than this run. Fail closed by dropping it.
  if [[ -n "$PLAN_GATE" && "$PLAN_GATE" != "$_EPG_ARG" ]]; then
    echo "[Review State] emit-plan-gate output ($PLAN_GATE) disagrees with argument ($_EPG_ARG) — ignoring" >&2
    PLAN_GATE=""
  fi
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
# Anchored, mirroring the precommit detector below. The prior unanchored pattern matched the
# command name ANYWHERE, so a mention — `rg codex-review-fast .`, `grep -n codex-review src/` —
# was recorded as an EXECUTED review (a scan proves the text APPEARS, not that it RAN). Skill
# form matches the skill NAME from its start; Bash form requires a leading `/`, a full-line
# anchor, a metacharacter-free arg charset (no `;`/`|`/`&`/redirection/process-sub), and a hard
# newline reject so a two-liner cannot match line 1 and fabricate a verdict on line 2.
_code_review_matched=false
if [[ "$TOOL_NAME" == "Skill" ]]; then
  grep -qE '^/?(sd0x-dev-flow:)?codex-review(-fast)?($|[[:space:]])' <<< "$COMMAND" && _code_review_matched=true
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  if [[ "$COMMAND" != *$'\n'* ]] \
     && grep -qE '^[[:space:]]*/(sd0x-dev-flow:)?codex-review(-fast)?([[:space:]]+[A-Za-z0-9_./=-]+)*$' <<< "$COMMAND"; then
    _code_review_matched=true
  fi
fi
if [[ "$_code_review_matched" == "true" ]]; then
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no code_review verdict to record" >&2
  else
    passed=$(_parse_review_gate "$TOOL_OUTPUT")
    # These three mutations each take the state lock independently rather than
    # sharing one locked jq. This is deliberate, not an oversight: each is
    # independently fail-closed on contention (e.g. update_state can commit while
    # _reset_changed_files skips — leaving changed_files stale keeps the review
    # invalidated, the property pinned by the "held lock skips changed_files
    # reset" test). Merging them would forfeit that independence and require
    # folding the complex _update_iteration (finding parse, fingerprints,
    # convergence tracking) into the shared critical section. Review commands run
    # at human cadence, so the extra lock round-trips are uncontended and cheap;
    # the atomicity is not worth the state-machine risk. Deferred by design.
    _alf_begin code_review
    # This is a legacy Bash/Skill dispatch — `hooks.json` registers the PreToolUse
    # `_record_dispatch_epoch` tracking only for the MCP codex tools, so a command/Skill-triggered
    # review like this one never incremented `dispatch_count`. The 7th arg (`release_self`) is
    # therefore `false`: this call releases only whatever pending MCP background markers it sweeps
    # for the `code` plane (each of which DID earn its own increment at its own PreToolUse), never
    # an extra unit for itself. Passing `true` here was round-22 finding #3 — it let an unrelated
    # legacy verdict prematurely retire a still-in-flight MCP dispatch's reservation.
    update_state "code_review" "true" "$passed" "" "" "code" "false"
    [[ "$passed" == "true" ]] && { _reset_changed_files || true; }
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated: passed=$passed" >&2
    # `pending` follows the OBSERVED receipt, not the requested verdict: a PASS that was dropped
    # leaves the code plane outstanding, and saying `pending=precommit` there would walk the loop
    # past a gate that is still shut.
    _alf_new=$(_alf_receipt code_review)
    _alf_emit "event=code_review_verdict change=code $(_alf_transition code_review "$_alf_old" "$_alf_new" "$passed")" \
      "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo precommit || echo code_review)" >&2
  fi
fi

# /codex-review-doc or /review-spec (also matches Skill name form)
# Anchored for the same reason as the code-review detector above: the prior unanchored
# alternation matched a mention anywhere in the command, so `grep -rn review-spec docs/`
# recorded an executed doc review.
_doc_review_matched=false
if [[ "$TOOL_NAME" == "Skill" ]]; then
  grep -qE '^/?(sd0x-dev-flow:)?(codex-review-doc|review-spec)($|[[:space:]])' <<< "$COMMAND" && _doc_review_matched=true
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  if [[ "$COMMAND" != *$'\n'* ]] \
     && grep -qE '^[[:space:]]*/(sd0x-dev-flow:)?(codex-review-doc|review-spec)([[:space:]]+[A-Za-z0-9_./=-]+)*$' <<< "$COMMAND"; then
    _doc_review_matched=true
  fi
fi
if [[ "$_doc_review_matched" == "true" ]]; then
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no doc_review verdict to record" >&2
  else
    passed=$(check_passed "$TOOL_OUTPUT")
    _alf_begin doc_review
    # Legacy Bash/Skill dispatch — see the code-review block above for why `release_self` stays
    # `false` here too.
    update_state "doc_review" "true" "$passed" "" "" "doc" "false"
    # `legacy` only: this route never incremented `dispatches` (PreToolUse tracking covers the MCP
    # tools alone), so counting it as a verdict would make `dispatches - verdicts` go negative.
    _bump_doc_counter legacy
    echo "[Review State] doc_review updated: passed=$passed" >&2
    _alf_new=$(_alf_receipt doc_review)
    _alf_emit "event=doc_review_verdict change=doc $(_alf_transition doc_review "$_alf_old" "$_alf_new" "$passed")" \
      "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo none || echo doc_review)" >&2
  fi
fi

# /precommit or /precommit-fast — THREE distinct verdict sources, routed by TOOL_NAME so a
# raw-text scan can never fabricate a pass (a scan proves the text APPEARS, not that it RAN):
#
#   1. Skill event (TOOL_NAME=Skill): COMMAND is the skill NAME (`precommit` /
#      `precommit-fast` / `sd0x-dev-flow:precommit`). The launch itself is only a placeholder
#      (no verdict — filtered by _skill_output_has_verdict below); the fallback ecosystem path
#      (no runner script) emits its real `## Overall:` verdict as the SKILL'S OWN final output.
#      Anchored `^/?...precommit(-fast)?` so the name must START with precommit.
#   2. Bash event, legacy /precommit slash command: some harness versions deliver a slash
#      command as a Bash tool call (`command: "/precommit"`). Matched by a leading `/` REQUIRED,
#      anchored `^...$`, args restricted to a metacharacter-FREE charset, and a hard newline
#      reject. So `echo precommit` (no slash), `/precommit ; echo '## Overall: PASS'` (has `;`),
#      `/precommit > >(printf '## Overall: ✅ PASS')` (redirection/process-sub — the old
#      `[^;|&]*` suffix admitted this and let the process-sub emit a fake PASS), and a
#      `/precommit`+newline+`printf '## Overall: PASS'` two-liner (grep `^...$` matches the
#      first line alone) are ALL rejected.
#   3. Bash event, real runner: `node .../precommit-runner.js` runs as a separate Bash tool
#      call and emits the REAL PASS/FAIL. _is_clean_runner_invocation accepts ONLY a command
#      that is ENTIRELY a standalone runner invocation (anchored ^...$, no `;`/`&`/`|`, no
#      newline, optional `VAR=val` env prefixes, runner as node's immediate SCRIPT OPERAND),
#      so `false && node ...`, `printf '...node ...precommit-runner.js...'`, and
#      `node real.js ; echo PASS` fabrications are all rejected. Without recording the real
#      verdict, precommit.passed stays false and wedges stop-guard forever.
#
# Trade-off (unchanged): node FLAGS before the script or an absolute-path node binary are
# fail-CLOSED misses (verdict dropped, re-requested) — safe; all skills invoke bare
# `node .claude/scripts/precommit-runner.js` with the script as the immediate operand.
_precommit_matched=false
if [[ "$TOOL_NAME" == "Skill" ]]; then
  grep -qE '^/?(sd0x-dev-flow:)?precommit(-fast)?($|[[:space:]])' <<< "$COMMAND" && _precommit_matched=true
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  # Slash form: newline-reject first (grep ^...$ is per-line → a 2-liner would match line 1
  # alone and let a second-line printf fabricate a PASS), then anchored match with a
  # metacharacter-free arg charset (no redirection/process-sub). Runner form self-guards.
  if [[ "$COMMAND" != *$'\n'* ]] \
     && grep -qE '^[[:space:]]*/(sd0x-dev-flow:)?precommit(-fast)?([[:space:]]+[A-Za-z0-9_./=-]+)*$' <<< "$COMMAND"; then
    _precommit_matched=true
  elif _is_clean_runner_invocation "$COMMAND"; then
    _precommit_matched=true
  fi
fi
if [[ "$_precommit_matched" == "true" ]]; then
  _precommit_mode=$(_precommit_mode_of "$COMMAND")
  if [[ "$TOOL_NAME" == "Skill" ]] && ! _skill_output_has_verdict "$TOOL_OUTPUT"; then
    echo "[Review State] Skill launch placeholder — no precommit verdict to record" >&2
  elif grep -qE '^## Overall: ⚠️ NO CHECKS RUN' <<< "$TOOL_OUTPUT" \
       && ! grep -qE '^## Overall: (✅ PASS|❌ FAIL|⛔ FAIL)' <<< "$TOOL_OUTPUT"; then
    # precommit-runner's fail-closed third state: no runnable scripts, so it
    # emitted neither PASS nor FAIL. This is a NON-verdict — skills/precommit
    # Step 1 then falls through to ecosystem detection and emits the real
    # PASS/FAIL that a later hook fire records. Recording passed=false here would
    # wedge stop-guard (state precommit.passed=false → re-request /precommit
    # forever) on a genuinely check-less repo. Only skip when NO real Overall
    # sentinel accompanies it, so a runner→ecosystem run in one output still
    # records its real verdict below.
    echo "[Review State] precommit: no runnable checks (runner fallback) — no verdict recorded" >&2
  elif [[ "$TOOL_INTERRUPTED" == "true" ]]; then
    # Interrupted precommit run (Bash OR Skill; killed/timed out): its stdout may carry a
    # test-tail `## Overall: ✅ PASS` printed BEFORE the runner emitted its own final summary.
    # Recording that as a pass would let an aborted precommit satisfy the stop gate (fail-OPEN).
    # Fail-closed: mark executed=true / passed=false so the gate re-requests /precommit; a clean
    # re-run records the real verdict. Tool-name-agnostic (was Bash-only): a Skill-launched
    # precommit whose partial output DOES carry a verdict sentinel survives the placeholder skip
    # (_skill_output_has_verdict, above) and would otherwise fall through to the verdict recorder
    # below and bank a truncated PASS. TOOL_INTERRUPTED is parsed generically (.interrupted on
    # tool_response/tool_output), and only Skill/Bash precommit reaches this block, so gating on
    # the flag alone is exact.
    _alf_begin precommit
    update_state "precommit" "true" "false" "$_precommit_mode"
    echo "[Review State] precommit: response interrupted — recording passed=false (fail-closed)" >&2
    # This branch performs a real state transition, so it owes a fact like any other. Emitting
    # nothing here was worse than emitting a degraded one: the reader saw the loop go quiet after a
    # precommit and had no way to distinguish "interrupted, recorded false" from "hook never fired".
    _alf_emit "event=precommit_verdict change=code $(_alf_transition precommit "$_alf_old" "$(_alf_receipt precommit)" false response_interrupted)" \
      "mode=${_precommit_mode} $(_alf_common)" "pending=precommit" >&2
  else
    # FAIL-precedence: the precommit verdict is the LAST `## Overall:` line, NOT the first
    # PASS anywhere (check_passed) — a PASS embedded in the runner's test/build tail would
    # otherwise mask a real final FAIL and record a passing gate. See
    # _precommit_last_overall_is_pass.
    if _precommit_last_overall_is_pass "$TOOL_OUTPUT"; then passed="true"; else passed="false"; fi
    # Two independent locks (update_state + _set_phase_idle) — deferred by design
    # for the same reason as the code_review branch above: independent fail-closed
    # semantics over a human-cadence command, not worth merging.
    _alf_begin precommit
    update_state "precommit" "true" "$passed" "$_precommit_mode"
    if [[ "$passed" == "true" ]]; then
      _set_phase_idle || true
    fi
    echo "[Review State] precommit updated: passed=$passed mode=$_precommit_mode" >&2
    # `lint:fix` REWRITES the tree before the build and test steps observe it, so a verdict that
    # follows one describes source this run itself changed. The runner cannot tell us whether it
    # actually changed anything — its `## Changed files after lint:fix` list is a plain
    # `git diff --name-only`, i.e. the whole dirty tree — so the honest claim is only that a
    # mutating step ran. Closing that gap needs a content check — the same capability the
    # request doc's § What is still not done gives up on elsewhere in this file, since a Bash
    # mutation is invisible to the edit-epoch ordering design end to end. Not pursued here.
    _ALF_FRESH="unknown"
    if grep -q '^> finished lint_fix' <<< "$TOOL_OUTPUT"; then
      _ALF_FRESH="unverified-after-mutating-check"
    elif grep -q '^> skip lint_fix' <<< "$TOOL_OUTPUT"; then
      _ALF_FRESH="verified"
    fi
    _alf_new=$(_alf_receipt precommit)
    _alf_emit "event=precommit_verdict change=code $(_alf_transition precommit "$_alf_old" "$_alf_new" "$passed") mode=${_precommit_mode}" \
      "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo none || echo precommit)" \
      "freshness=${_ALF_FRESH}" >&2
    # `mode` records WHICH COMMAND ran, not which stages executed — the two can diverge, and
    # `PRECOMMIT_REQUIRE_FULL=1` gates on the former. precommit-runner.js emits
    # `- ⏭️ build (skipped: script missing)` when the repo has no build script, and a non-Node
    # ecosystem never reaches the runner at all (skills/precommit Step 1 falls through to
    # ecosystem detection), so a `full` verdict can legitimately carry no typecheck whatsoever.
    # Surface that on stderr rather than downgrading the verdict: a build-less repo is a normal
    # configuration, and failing its `full` gate closed would wedge it with nothing to fix.
    if [[ "$passed" == "true" && "$_precommit_mode" == "full" ]] \
       && grep -qF '⏭️ build (skipped:' <<< "$TOOL_OUTPUT"; then
      echo "[Review State] precommit mode=full but the build step was SKIPPED — PRECOMMIT_REQUIRE_FULL=1 is satisfied by the command name, not by a typecheck having run" >&2
    fi
  fi
fi

# === MCP sentinel routing (no command to parse) ===
if [[ "$TOOL_NAME" == "mcp__codex__codex" || "$TOOL_NAME" == "mcp__codex__codex-reply" ]]; then
  # Priority 0: the call never returned a report at all — it was handed off to the background.
  # Placed ahead of every namespace branch because the placeholder carries no review header and
  # would otherwise fall through the whole chain to the generic "no verdict sentinel" line, which
  # reads as "the reviewer said nothing useful" rather than "the reviewer is still running and its
  # answer can never reach this hook". Same facts, opposite instruction to the reader.
  #
  # Only the REQUEST side can be consulted here — there is no output to corroborate it — so this
  # deliberately proves less than a verdict branch does. That is sound only because it grants
  # nothing: the worst case is an advisory line about a plane that was not actually under review.
  if _mcp_output_is_background_handoff "$TOOL_OUTPUT"; then
    _bg_task=$(_mcp_background_task_id "$TOOL_OUTPUT")
    _bg_planes=()
    _mcp_request_asked_for_doc_review && _bg_planes+=("doc")
    _mcp_request_asked_for_code_review && _bg_planes+=("code")
    # The plan plane has no request-side predicate of its own (its branches are output-only), so
    # it is matched on the template's own heading, the same string those branches key on.
    grep -qF 'Plan Review' <<< "$TOOL_INPUT" && _bg_planes+=("plan")
    for _bg_plane in ${_bg_planes+"${_bg_planes[@]}"}; do
      # Persisted for the two planes stop-guard reads, and for those only. A marker exists to
      # explain an OPEN GATE at stop time; `plan_review` is warn-only and isolated from the
      # code/doc gates by design (stop-guard.sh § plan-review pending advisory), so a plan marker
      # would be state nothing ever reads — and nothing retires either, since every verdict path
      # that clears markers is code/doc. The in-session fact below is emitted for all three: it
      # costs no state, and the plan loop runs inside the session where it is read.
      [[ "$_bg_plane" == "plan" ]] || _record_background_review "$_bg_plane" "$_bg_task"
      # `receipts=` carries the receipt this event is ABOUT — still false, and now with a stated
      # reason. Every emitter spells the same five fields so one parser reads them all; the two
      # additions here (`reason=`, `task=`) are what make the line actionable rather than merely
      # another way of saying the gate is shut.
      _alf_emit "event=review_verdict_unrecordable change=${_bg_plane} reason=backgrounded task=${_bg_task}" \
        "receipts=${_bg_plane}_review:$(_alf_receipt "${_bg_plane}_review")" \
        "$(_alf_common)" "pending=${_bg_plane}_review" >&2
    done
    if [[ ${#_bg_planes[@]} -gt 0 ]]; then
      echo "[Review State] review moved to the background as task ${_bg_task} — its report arrives as a task notification, which fires no hook, so the ${_bg_planes[*]} gate(s) stay shut FOR NOW. The next hook event attempts to recover the verdict from that notification and record the receipt; recovery is refused if the ${_bg_planes[*]} side of the tree has changed since the review was DISPATCHED, or if the delivery cannot be read. Re-running from scratch is not the fix either way: a slower review hits the same timeout. If recovery is refused, read the report and continue the existing thread with the current diff. Issue #10" >&2
    fi
    exit 0
  fi

  # Priority 1: doc-specific — namespace-gated on BOTH halves of provenance, BLOCKED-first.
  #
  # This branch used to be `grep -qE '## Document Review' && grep -qE '✅ Mergeable'`: two
  # UNANCHORED substring matches that need not even be on the same line, with no request-side
  # check, sitting FIRST in the elif chain. Three separate failures compounded:
  #   1. Either literal matches inside a table cell or quoted prose. Seven shipped files in this
  #      repo contain both — skills/necessity-audit/SKILL.md and
  #      docs/features/plan-review-loop/2-tech-spec.md among them — so reviewing this project's
  #      own docs fabricated a doc verdict.
  #   2. Being first in the chain, such a match SWALLOWED a genuine code review's output: the
  #      code branch below never ran, so a `⛔ Blocked` was dropped over a prior `✅` with no
  #      sidecar raised (branch precedence bypasses _verdict_write_failed entirely).
  #   3. `✅ Mergeable` was tested before `⛔ Needs revision`, so output carrying both banked the
  #      pass — the inverse of the fail-closed precedence the code and plan branches use.
  #
  # The asymmetry with the code branch is what proves this was an oversight rather than a
  # judgement: that branch has required `_mcp_output_is_code_review` (anchored header) PLUS
  # `_mcp_request_asked_for_code_review` (request-side proof) since the same class of bug was
  # reproduced there, under a comment stating "output is not evidence of what was asked."
  # Ownership is decided BEFORE the chain, not inside it. Putting the request-side check in an
  # inner `if` reproduced the swallow in a new shape: a genuine code review that merely quotes a
  # `## Document Review` heading at line start entered this branch, failed provenance, and
  # returned — so the code branch below never ran and the `⛔ Blocked` was dropped anyway. A
  # namespace that does not OWN the output must fall THROUGH to the next one.
  _settled_doc=false
  _settled_code=false
  # Round-24 P1#4: which plane(s) THIS invocation actually settled — recorded as it happens, not
  # inferred from which branch fired. PreToolUse increments a plane's reference whenever the REQUEST
  # asks for it, independent of what the response turns out to look like; a response recognized as
  # ONE plane (or as a plan-shaped report matching neither) used to release only that plane, leaving
  # the other's reference permanently stranded whenever a dual-plane request's response didn't also
  # carry the other plane's header. The unconditional sweep after this whole chain (below) closes the
  # gap: it releases whatever the REQUEST acquired that these flags say was not settled here.
  _mcp_doc_owned=false
  if _mcp_output_is_doc_review "$TOOL_OUTPUT"; then
    if _mcp_request_asked_for_doc_review; then
      _mcp_doc_owned=true
    else
      echo "[Review State] MCP output carries a '## Document Review' header but the request never asked for a doc review — not routing to the doc plane (restore the phrase 'Document Review' in the prompt to re-arm)" >&2
    fi
  fi

  if [[ "$_mcp_doc_owned" == "true" ]]; then
    if _mcp_output_is_code_review "$TOOL_OUTPUT" && _mcp_request_asked_for_code_review; then
      # Both namespaces claim this output. Recording either one is a guess, and a wrong guess
      # writes a verdict for a plane that was never reviewed. Fail closed: record NOTHING, leave
      # both gates unsatisfied, and let the loop re-request. Silence here is a re-review; a wrong
      # write is a skipped one.
      echo "[Review State] MCP output claims BOTH the doc and code namespaces — ambiguous provenance, no verdict recorded" >&2
      # Round-25 finding #4: only mark settled on a CONFIRMED release — an unconfirmed attempt
      # left unmarked falls through to the unconditional sweep below, which retries the same
      # `_clear_dispatch_epoch` call rather than silently accepting a leak.
      _clear_dispatch_epoch doc && _settled_doc=true
      _clear_dispatch_epoch code && _settled_code=true
    else
      _mcp_doc_verdict=$(_mcp_doc_review_passed "$TOOL_OUTPUT")
      if [[ -n "$_mcp_doc_verdict" ]]; then
        _alf_begin doc_review
        # This IS an MCP dispatch — `hooks.json`'s PreToolUse tracking covers this tool, so this
        # verdict's own resolution earns a release on top of whatever pending background markers it
        # sweeps for the `doc` plane. The 7th arg `release_self=true` is what makes finding #1's
        # repro net to zero: two background markers plus this resolving dispatch (dispatch_count=3)
        # now releases 2 (markers) + 1 (self) = 3, retiring cleanly instead of leaking at 2.
        # Round-26 finding #5: unless THIS dispatch's own increment never committed — a durable
        # marker says so when that happened; consume it and skip the self-release instead of
        # releasing a unit this call never actually reserved.
        _mcp_doc_release_self="true"
        _sidecar_consume_marker "dispatch_acquire_failed:doc" && _mcp_doc_release_self="false"
        update_state "doc_review" "true" "$_mcp_doc_verdict" "" "" "doc" "$_mcp_doc_release_self"
        _alf_new=$(_alf_receipt doc_review)
        # Round-25 finding #4: `update_state` returns 0 on its degraded-failure paths too — settle
        # only when the read-back receipt proves THIS call's write (and its bundled epoch/marker
        # retirement, same transaction) actually landed.
        _alf_write_confirmed doc_review "$_mcp_doc_verdict" && _settled_doc=true
        _bump_doc_counter verdicts "$([[ "$_mcp_doc_verdict" == "true" ]] && echo passes || echo blocks)"
        echo "[Review State] doc_review updated (MCP): passed=$_mcp_doc_verdict" >&2
        _alf_emit "event=doc_review_verdict change=doc source=mcp $(_alf_transition doc_review "$_alf_old" "$_alf_new" "$_mcp_doc_verdict")" \
          "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo none || echo doc_review)" >&2
      else
        echo "[Review State] MCP doc review carries no verdict sentinel — no state recorded" >&2
        _bump_doc_counter no_verdict
        _clear_dispatch_epoch doc && _settled_doc=true
      fi
    fi
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
  elif grep -qE '## Plan Review' <<< "$TOOL_OUTPUT" && grep -qF '[PLAN_REVIEW_DEGRADED]' <<< "$TOOL_OUTPUT"; then
    # No reason arg → status_reason defaults to "reviewer-unavailable". This is by
    # design: secret-detected degradation never reaches MCP routing — the skill
    # detects secrets BEFORE any reviewer send (fail-closed, Step 2) and records
    # the reason via the Bash emit-plan-gate path. A degraded token inside MCP
    # output can therefore only mean the reviewer plane itself failed.
    update_plan_state "DEGRADED" "" "" "no-history"
    echo "[Review State] plan_review updated (MCP): degraded=true" >&2
  elif grep -qE '## Plan Review' <<< "$TOOL_OUTPUT" && grep -qF '[PLAN_REVIEW_SKIPPED]' <<< "$TOOL_OUTPUT"; then
    update_plan_state "SKIPPED" "" "" "no-history"
    echo "[Review State] plan_review updated (MCP): skipped=true" >&2
  elif grep -qE '## Plan Review' <<< "$TOOL_OUTPUT" && grep -qE '⛔ Plan Blocked' <<< "$TOOL_OUTPUT"; then
    _update_plan_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    update_plan_verdict "false"
    echo "[Review State] plan_review updated (MCP): passed=false" >&2
  elif grep -qE '## Plan Review' <<< "$TOOL_OUTPUT" && grep -qE '✅ Plan Ready' <<< "$TOOL_OUTPUT"; then
    _update_plan_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    update_plan_verdict "true"
    echo "[Review State] plan_review updated (MCP): passed=true" >&2
  # Priority 2: code-specific — namespace-gated, BLOCKED-first.
  # Requires positive proof the output IS a code review (see _mcp_output_is_code_review);
  # a bare `✅ Ready` / `⛔ Blocked` mention no longer reaches the state writer. Verdict
  # precedence is handled inside _mcp_code_review_passed so BOTH markers in one output
  # route to blocked, matching the plan-review branch above.
  elif _mcp_output_is_code_review "$TOOL_OUTPUT"; then
    # BOTH halves of provenance: the output must look like a review report AND the request must
    # have asked for one. Output alone let an unrelated codex call that merely printed a
    # `## Merge Gate` header bank a pass on a tree nobody reviewed.
    if ! _mcp_request_asked_for_code_review; then
      echo "[Review State] code_review verdict DROPPED — the MCP output looks like a review report but the request never asked for a Merge Gate; if this WAS a review, restore the template's 'Merge Gate' Output-Format section to the prompt (the aggregate gate from emit-review-gate.sh still applies)" >&2
      # Round-24 P1#4: this branch exits immediately, before the unconditional sweep below ever
      # runs — reaching here only proves `_mcp_doc_owned` was false (the OUTPUT had no doc header),
      # not that the REQUEST never asked for doc. A dual-plane request whose response is this
      # malformed still owes doc a release.
      # Round-26 finding #3: `|| true` — `_clear_dispatch_epoch` is now the last command in this
      # `&&` list, so its meaningful failure return would otherwise abort the hook under `set -e`
      # before `exit 0` below ever runs.
      _mcp_request_asked_for_doc_review && _clear_dispatch_epoch doc || true
      exit 0
    fi
    passed=$(_mcp_code_review_passed "$TOOL_OUTPUT")
    _alf_begin code_review
    # MCP dispatch — see the doc-review branch above for why `release_self=true`, and the round-26
    # finding #5 self-release guard, are both correct here.
    _mcp_code_release_self="true"
    _sidecar_consume_marker "dispatch_acquire_failed:code" && _mcp_code_release_self="false"
    update_state "code_review" "true" "$passed" "" "" "code" "$_mcp_code_release_self"
    _alf_new=$(_alf_receipt code_review)
    # Round-25 finding #4: settle only on confirmed read-back — see the doc-review branch above.
    _alf_write_confirmed code_review "$passed" && _settled_code=true
    [[ "$passed" == "true" ]] && { _reset_changed_files || true; }
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated (MCP): passed=$passed" >&2
    _alf_emit "event=code_review_verdict change=code source=mcp $(_alf_transition code_review "$_alf_old" "$_alf_new" "$passed")" \
      "$(_alf_common)" "pending=$([[ "$_alf_new" == "true" ]] && echo precommit || echo code_review)" >&2
  else
    # Priority 2.5 (fallback, round-22 finding #4): nothing above matched — not doc-owned, no plan
    # token/verdict, and `_mcp_output_is_code_review` false. Every branch above is gated on the
    # OUTPUT's shape, so an error response, malformed output, or a report simply missing its
    # expected header reaches none of them — yet this hook's PreToolUse counterpart incremented
    # `dispatch_count` unconditionally on the REQUEST, with no output-shape condition of its own.
    # Without this fallback that increment has no retirement path at all: it leaks permanently, and
    # every later successful dispatch on the plane pays for it by needing one extra unit before its
    # own count can ever reach zero.
    #
    # Request-side proof only, same asymmetry the background-handoff branch (Priority 0, above)
    # already accepts — there is no output to corroborate against, so this proves less than a
    # verdict branch does. That is sound only because it grants nothing: the worst case is an
    # advisory line about a plane that was not actually under review this call.
    _fb_planes=()
    _mcp_request_asked_for_doc_review && _fb_planes+=("doc")
    _mcp_request_asked_for_code_review && _fb_planes+=("code")
    for _fb_plane in ${_fb_planes+"${_fb_planes[@]}"}; do
      # Round-25 finding #4: settle only on a confirmed release — see the doc-review branch above.
      if _clear_dispatch_epoch "$_fb_plane"; then
        [[ "$_fb_plane" == "doc" ]] && _settled_doc=true
        [[ "$_fb_plane" == "code" ]] && _settled_code=true
      fi
    done
    if [[ ${#_fb_planes[@]} -gt 0 ]]; then
      echo "[Review State] MCP output matched no recognized review shape (doc/plan/code) — releasing the ${_fb_planes[*]} dispatch reservation so it cannot leak; no verdict recorded" >&2
    fi
  fi
  # Priority 3 (MCP `^## Overall:` → precommit verdict) and Priority 4 (generic `✅ All Pass` →
  # code_review pass) both REMOVED — MCP is not the producer of either verdict, and each removed
  # branch was a proven live gate bypass. Full account:
  # docs/features/auto-loop-evolution/4-implementation.md §4.7.
  # Bare ## Gate: ✅/⛔ alone → skip (ambiguity rule)

  # Round-24 P1#4 — unconditional sweep: release whichever plane(s) the REQUEST acquired that no
  # branch above actually settled (`_settled_doc`/`_settled_code`, set at every genuine settlement
  # point). This is the general case the priority-2.5 fallback above only covered for "no branch
  # matched at all" — a request asking for BOTH namespaces whose response is recognized as ONE of
  # them (doc owned but not a code review too, or vice versa), or as a plan-shaped report matching
  # neither, used to leave the other plane's PreToolUse increment permanently stranded. Every branch
  # that already released its plane(s) set the matching flag, so this never double-retires them.
  _post_planes=()
  [[ "$_settled_doc" == "true" ]] || { _mcp_request_asked_for_doc_review && _post_planes+=("doc"); }
  [[ "$_settled_code" == "true" ]] || { _mcp_request_asked_for_code_review && _post_planes+=("code"); }
  for _post_plane in ${_post_planes+"${_post_planes[@]}"}; do
    # Round-26 finding #3: `|| true` — a bare call whose meaningful failure return would otherwise
    # abort the hook under `set -e` mid-sweep, before the rest of this loop or the log line below run.
    _clear_dispatch_epoch "$_post_plane" || true
  done
  if [[ ${#_post_planes[@]} -gt 0 ]]; then
    echo "[Review State] request acquired the ${_post_planes[*]} plane(s) but this response settled neither a verdict nor an explicit release for it — releasing the dispatch reservation so it cannot leak; no verdict recorded" >&2
  fi
fi

# === Nit sentinel routing ===
# [NIT_DEFERRED] and [DISMISS_VERDICT] appear in code review and seek-verdict output.
# Restrict to known producers to avoid pollution from template/doc content.
_NIT_ELIGIBLE=false
if [[ "$TOOL_NAME" == "mcp__codex__codex" || "$TOOL_NAME" == "mcp__codex__codex-reply" ]]; then
  _NIT_ELIGIBLE=true
elif [[ "$TOOL_NAME" == "Skill" ]] && grep -qE '(codex-review|seek-verdict|codex-cli-review)' <<< "$COMMAND"; then
  # Skill tool: restrict to known nit sentinel producers
  _NIT_ELIGIBLE=true
elif [[ "$TOOL_NAME" == "Bash" ]] && grep -qE '/(sd0x-dev-flow:)?(codex-review|seek-verdict|codex-cli-review)' <<< "$COMMAND"; then
  _NIT_ELIGIBLE=true
fi
if [[ "$_NIT_ELIGIBLE" == "true" ]] && grep -qE '^\[NIT_DEFERRED\]|^\[DISMISS_VERDICT\]' <<< "$TOOL_OUTPUT" 2>/dev/null; then
  _parse_nit_sentinels "$TOOL_OUTPUT"
fi

# === Stall memory routing ===
# rules/auto-loop.md § Stall Detection > Stall Memory.
#
# Read from the COMMAND, not from TOOL_OUTPUT — the opposite of every other sentinel here, and the
# asymmetry is deliberate. `[NIT_DEFERRED]` is authored by the reviewer, so the reviewer's output is
# the only place it can come from and a producer allowlist keeps template text out. This record is
# authored by the MODEL, which has no output stream this hook can see; the command it types is the
# closest thing to one. Reading the output instead would make `cat rules/auto-loop.md` ingest the
# format example in that very section — a documented format that silently forges records when read
# is not a format worth shipping.
#
# The full `class= … | tried= … | outcome= …` shape is required, so a command that merely mentions
# the marker (`grep '\[STALL_MEMORY\]' rules/`) matches nothing. Emit one with, e.g.:
#   printf '%s\n' '[STALL_MEMORY] class=ATTENTION_DIFFUSION | tried=... | outcome=... | <ISO8601>'
#
# ONE regex for the gate and the extraction. They were two patterns, and the extractor's mandatory
# trailing `| <ts>` was absent from the gate: a record written without a timestamp passed the gate,
# extracted to nothing, and vanished — the silent drop `_upsert_stall_memory` is written to avoid,
# and the reason its own `ts` default was unreachable from here. The `ts` group is optional; the
# field bodies stop at a quote so the shell's closing `'` is not captured as data.
# Every field body is `*`, not `+`: with `+`, `tried=|outcome=x` (no space) failed to match at all
# and vanished, while `tried= |outcome=x` (one space) matched and was refused out loud. Same
# malformed record, two different fates, and the silent one is the failure this memory exists to
# prevent. Everything that names all three fields now reaches the validator, which fails closed on
# the class and says so.
_SM_RE='\[STALL_MEMORY\][[:space:]]*class=[^|]*\|[^|]*tried=[^|]*\|[^|]*outcome=[^|'\''"]*(\|[^'\''"]*)?'
if [[ "$TOOL_NAME" == "Bash" ]] && grep -qE "$_SM_RE" <<< "$COMMAND" 2>/dev/null; then
  while IFS= read -r _sm_line; do
    # `if`, not `[[ … ]] &&`: a false test as the loop body's last status aborts the hook under
    # `set -e` before the `exit 0` below.
    if [[ -n "$_sm_line" ]]; then _upsert_stall_memory "$_sm_line"; fi
  done < <(grep -oE "$_SM_RE" <<< "$COMMAND" 2>/dev/null || true)
fi

exit 0
