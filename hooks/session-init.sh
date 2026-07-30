#!/usr/bin/env bash
# session-init.sh — SessionStart hook: reset review state on new session (D-2)
# Preserves total_rounds_session and strategic_reset_fired for strategic reset logic.
set -euo pipefail

STATE_FILE=".claude_review_state.json"
INPUT=$(cat)

# Require jq
if ! command -v jq &> /dev/null; then exit 0; fi

# True (exit 0) when the working tree has any dirty/untracked code or doc file.
# A .blocked sidecar means "a code/doc edit happened but the state write failed"
# — a fail-closed marker. On a new session we reset has_code_change=false, and
# reconciliation elsewhere is one-way (true→false only), so if we ALSO delete the
# sidecar while reviewable files are still dirty we erase every trace and let an
# unreviewed edit from the crashed session stop unchecked. So the sidecar is only
# cleared when the tree is genuinely clean (a true orphan). The two alternations
# below are the exact code/doc extension lists used by the other gate hooks.
#
# Tri-state fail-closed contract (caller deletes the sidecar only on "clean"):
#   - Not a git repo         → return 1 ("clean"): no working tree can be dirty,
#                              so a sidecar here is a true orphan — safe to delete.
#   - git repo, status FAILS → return 0 ("dirty"): we cannot prove the tree is
#                              clean, so fail closed and preserve the sidecar.
#   - git repo, status OK     → grep the porcelain; dirty reviewable → 0, else 1.
_tree_has_dirty_reviewable() {
  git rev-parse --git-dir &>/dev/null || return 1
  local porcelain
  # -uall so new untracked directories expand to individual files: plain
  # -unormal collapses `newdir/app.js` to `?? newdir/`, which neither extension
  # grep matches, so a wholly-new-directory edit would be judged "clean" and the
  # fail-closed sidecar wrongly deleted. Matches the sibling gate hooks
  # (stop-guard, post-compact-auto-loop, post-skill-auto-loop, user-prompt-review-guard).
  # Scope note: --ignored is deliberately NOT added. A gitignored file is not
  # "reviewable" in the gate's sense (the user excluded it from the repo), so a sidecar
  # left only by a gitignored edit is a true orphan. It would also WEDGE the sidecar in
  # any repo that gitignores code/doc files (e.g. .claude/**/*.js|*.md here): --ignored
  # would always match a code/doc extension → the marker could never be cleared. Git
  # failure below still fails closed (return 0), and non-git returns 1 per the tri-state.
  # -uall recursively enumerates every untracked file and can stall on a huge tree, so
  # bound it with timeout/gtimeout exactly like the sibling reconciliation hooks
  # (stop-guard, post-compact-auto-loop). On a timeout, a missing helper, or any git
  # failure we cannot prove the tree clean → fail closed (return 0 = "dirty", preserve
  # the .blocked sidecar). Callers already skip this scan entirely when no sidecar exists.
  # Capture stderr per branch: `git status` exits 0 even when it could not open an UNREADABLE
  # directory — it only WARNS on stderr and OMITS that subtree. If the sole dirty reviewable file
  # lives under such a dir, a stderr-discarding scan sees empty porcelain → "clean" → the caller
  # deletes the sole .blocked fail-closed marker (fail-OPEN, Codex iter-19 P2). We redirect stderr
  # to a temp file, then treat a directory-omission warning as unverifiable → dirty (return 0).
  # LC_ALL=C pins git's warning text to the untranslated English form the grep below matches — under
  # a non-English locale (e.g. this project's zh-TW hosts) git localizes it ("警告: 無法開啟目錄…"),
  # the English-only regex misses it, and the sidecar is wrongly deleted (locale-dependent fail-OPEN).
  local _serr _redir _rc=0 _omitted=0
  _serr="$(mktemp 2>/dev/null || echo '')"
  if [[ -z "$_serr" ]]; then
    # mktemp failed (e.g. unwritable TMPDIR) → cannot capture stderr → cannot detect a directory
    # omission → cannot prove the tree clean. Fail closed (return 0 = dirty, preserve the .blocked
    # sidecar), mirroring stop-guard's mktemp-failure branch. The prior `_redir="${_serr:-/dev/null}"`
    # silently routed stderr to /dev/null here, so an omission went unseen and the caller could delete
    # the sole fail-closed marker (silent fail-OPEN, iter-20 P2).
    return 0
  fi
  _redir="$_serr"
  if command -v timeout &>/dev/null; then
    porcelain=$(LC_ALL=C timeout 5 git status --porcelain -uall 2>"$_redir") || _rc=$?
  elif command -v gtimeout &>/dev/null; then
    porcelain=$(LC_ALL=C gtimeout 5 git status --porcelain -uall 2>"$_redir") || _rc=$?
  elif command -v perl &>/dev/null; then
    # No timeout/gtimeout (e.g. stock macOS without coreutils). Do NOT run -uall UNBOUNDED:
    # a pathological/huge untracked tree could hang SessionStart. Bound it with a perl alarm+exec
    # wrapper (perl ships on macOS/Linux) — the alarm timer survives exec and SIGALRM's default
    # action terminates the exec'd git, so on timeout perl exits non-zero → _rc set → fail-closed
    # below (dirty, preserve the sidecar), identical to a real timeout.
    porcelain=$(LC_ALL=C perl -e 'alarm 5; exec @ARGV or exit 127' git status --porcelain -uall 2>"$_redir") || _rc=$?
  else
    # Neither timeout/gtimeout NOR perl (extremely rare) → run UNBOUNDED rather than assume dirty.
    # Assuming dirty here would wedge the .blocked sidecar forever on every such host, breaking the
    # clean-tree orphan cleanup. A missing perl is far rarer than a missing coreutils timeout, and
    # the caller's sidecar-existence gate keeps this last-resort path rare.
    porcelain=$(LC_ALL=C git status --porcelain -uall 2>"$_redir") || _rc=$?
  fi
  # An unreadable directory git could not open → the same "open directory" signal run-verify.js
  # rejects. Any such omission means the scan is INCOMPLETE, so we cannot prove the tree clean.
  # (_serr is guaranteed non-empty here — the mktemp-failure branch returned early above.)
  grep -qiE '(could not|cannot|unable to) open directory|warning:[^'\'']*open directory' "$_serr" && _omitted=1
  rm -f "$_serr"
  # Timeout / git failure (_rc != 0) OR an unverifiable directory omission → cannot prove clean → fail
  # closed (return 0 = "dirty", preserve the .blocked sidecar).
  if [[ "$_rc" -ne 0 || "$_omitted" -eq 1 ]]; then
    return 0
  fi
  if grep -qE '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)($|[[:space:]]|")' <<< "$porcelain"; then
    return 0
  fi
  if grep -qE '\.(md|mdx)($|[[:space:]]|")' <<< "$porcelain"; then
    return 0
  fi
  return 1
}

# State-file serialization — the SAME `${STATE_FILE}.lockdir` the three writing hooks take.
#
# This hook rewrites the WHOLE state file on a session change, and it did so UNLOCKED while
# post-tool-review-state.sh, post-edit-format.sh and post-compact-auto-loop.sh all coordinated on
# that lock. A verdict committed between this hook's `jq` read and its `mv` was therefore silently
# clobbered by the reset — and a clobbered BLOCKING verdict is the fail-open direction, since the
# reset writes `passed:false` over it and stop-guard then simply re-requests the gate rather than
# refusing. A lock only some writers take excludes nothing.
#
# Protocol is the canonical one; see post-tool-review-state.sh for the reasoning behind each arm.
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
  _takeovers=0
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    end=$(date +%s)
    if [ $((end - start)) -ge $LOCK_TIMEOUT ]; then
      local lock_pid lock_ts now
      lock_pid=$(cat "$LOCKDIR/pid" 2>/dev/null || echo 0)
      lock_ts=$(cat "$LOCKDIR/ts" 2>/dev/null || echo 0)
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
      return 1  # fail-closed
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

# Sidecar serialization — the same protocol in each of the three copies of this helper
# (post-edit-format.sh, post-tool-review-state.sh, and here): SAME lock directory name, SAME TTL,
# same steal-on-stale fallback. Those two hooks and this one mutate the SAME `.blocked` file, and a
# lock only some of them take excludes nothing.
#
# It is deliberately NOT the same protocol as the state lock above, in two respects: staleness is
# TTL-only (no `pid` file, so no `kill -0` dead-owner arm — a writer killed mid-section wedges
# every sidecar mutation for the full TTL rather than being reclaimed by the next contender), and
# the retry budget is a fixed 20 spins (~2 s) rather than the `REVIEW_STATE_LOCK_TIMEOUT`-
# configurable seconds-based wait, so the `=0` the hook suites set to keep contention tests fast
# has no effect on this path.
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

# Delete a `.blocked` sidecar left orphaned by a dead session — but only under the shared lock,
# and only after re-proving the tree clean INSIDE it.
#
# Both call sites used to be a bare `[[ -f sidecar ]] && ! _tree_has_dirty_reviewable && rm -f`,
# with no lock at any point. `_tree_has_dirty_reviewable` shells out to `git status -uall`, which
# on a large tree runs for seconds — a wide window in which a concurrent post-edit-format.sh or
# post-tool-review-state.sh appends a fresh `state_write_failed:*` / `verdict_write_failed:*`
# marker for an edit this scan never saw. The unlink then erased evidence of a LOST BLOCKING
# VERDICT, whose gate is still sitting at the previous round's `passed=true`: fail-OPEN, and
# exactly the asymmetry the ownership rework in post-edit-format.sh was built to prevent.
#
# Taking the lock BEFORE the scan (not merely around the unlink) is the load-bearing part: a
# writer can then only land wholly before the scan — where the scan's own git call sees the dirty
# file and we decline — or wholly after the unlink, where its marker survives.
#
# A full-file delete (rather than post-edit-format.sh's ownership-aware set rewrite) is correct
# HERE and only here: the precondition is a genuinely clean tree, and on a clean tree every
# marker, whatever plane wrote it, is by definition an orphan — no dirty file remains for any of
# them to be standing in for.
#
# Lock unavailable → decline. Retaining an orphan costs one stale strict-mode session that the
# next clean-tree start clears; deleting a live marker costs the gate.
_clear_orphan_sidecar() {
  local sidecar="${STATE_FILE}.blocked"
  # Both planes: an emergency marker with no shared file behind it is still evidence, and the
  # `-f "$sidecar"` test alone returned early and left it to accumulate forever.
  _sidecar_any || return 0
  if ! _sidecar_lock; then
    echo "[Session Init] sidecar lock unavailable — retaining .blocked rather than clearing on a possibly stale scan" >&2
    return 0
  fi
  # Re-probe inside the lock; the caller's `-f` test predates it. Snapshot at the same moment: the
  # scan below is the LONGEST protected region any of the three hooks has, so it is also the widest
  # window for a concurrent append to land in.
  # Snapshot BOTH planes, and enumerate the per-event markers by name at the same instant: those
  # names are what this transaction is allowed to retire, and nothing else.
  local _sc_before
  _sc_before=$(_sidecar_read_all)
  # Populates the global array `_SIDECAR_MARKER_FILES` — deliberately not captured into a string.
  # See `_sidecar_marker_files` for why a newline-delimited round trip was a repository-file delete.
  _sidecar_marker_files
  if _sidecar_any && ! _tree_has_dirty_reviewable; then
    # Ownership re-checked at the destructive step. This is the LONGEST protected region any of
    # the three hooks holds — `_tree_has_dirty_reviewable` runs a `git status -uall` — but it is a
    # BOUNDED one on every ordinary host: the `timeout`, `gtimeout` and perl-alarm paths all cap
    # that scan at 5s, comfortably inside the 30s TTL. An earlier version of this comment claimed
    # the region "routinely outlives the 30s TTL"; that holds only on the rare host with none of
    # the three, where the scan deliberately runs unbounded. The re-check stays either way — a
    # bounded region is not an atomic one (SIGSTOP, a descheduled process, a backwards clock),
    # and deleting the sidecar after being displaced destroys the successor's evidence.
    if ! _sidecar_own_lock; then
      echo "[sidecar] clear abandoned — lock was taken over mid-section; marker retained" >&2
    elif [[ "$(_sidecar_read_all)" != "$_sc_before" ]]; then
      # The precondition for deleting here is "the tree is clean, so every marker is an orphan".
      # A marker that lands DURING the scan breaks exactly that precondition: something dirtied a
      # reviewable file and lost a write for it. Deleting on the pre-scan reading would retire the
      # one record of it.
      echo "[sidecar] clear abandoned — the marker set changed during the tree scan; retaining it" >&2
    else
      rm -f -- "$sidecar" 2>/dev/null || true
      # Per-event markers are retired ONLY here, and only the ones enumerated above. This is the
      # single place in the system that clears them, which is why it can afford to be coarse: its
      # precondition is a NEW session over a tree with no dirty reviewable file, and under that
      # precondition every marker is an orphan by definition, whatever plane wrote it.
      #
      # Iterated over the ARRAY: each name reaches `rm` as exactly the one value the glob produced,
      # so a newline inside a filename is data rather than a separator. The count guard is not
      # decoration — under `set -u` bash 3.2 treats `"${arr[@]}"` on an empty array as unbound.
      # `--` because the only thing standing between a marker name and an `rm` option is the
      # prefix, and the prefix is not something this loop verifies.
      if [ ${#_SIDECAR_MARKER_FILES[@]} -gt 0 ]; then
        for _sc_f in "${_SIDECAR_MARKER_FILES[@]}"; do
          rm -f -- "$_sc_f" 2>/dev/null || true
        done
      fi
      # There is deliberately nothing to remove after the loop. Markers are SIBLING FILES, so the
      # enumerated list is the whole of what this clear may retire; a marker created after the
      # enumeration simply has a name the loop never saw and survives by construction. The earlier
      # layout put them in a `.blocked.d/` directory and finished with an `rmdir`, which is where
      # the real hazard lived: `rm -f "$dir"/x` resolves THROUGH a symlink at `$dir`, so a link
      # planted at `.blocked.d` turned this clear — whose precondition is a CLEAN tree, hence the
      # one that runs unprompted on a fresh clone — into "delete every regular file in an arbitrary
      # directory". Reproduced end-to-end before the layout changed.
    fi
  fi
  _sidecar_unlock
  return 0
}

# Capture baseline dirty files for session commit scope (D-5)
# Uses git status --porcelain -z for NUL-safe filename parsing (handles spaces, quotes, renames)
_capture_baseline() {
  if ! git rev-parse --git-dir &>/dev/null; then
    echo "null"  # Non-git repo → null baseline
    return 0
  fi
  # Pipe directly to perl — shell variables cannot hold NUL bytes
  git status --porcelain -z 2>/dev/null | perl -e '
    use strict;
    local $/;
    my $input = <STDIN>;
    my @paths;
    my $i = 0;
    while ($i < length($input)) {
      my $nul = index($input, "\0", $i);
      last if $nul < 0;
      my $entry = substr($input, $i, $nul - $i);
      $i = $nul + 1;
      my $xy = substr($entry, 0, 2);
      my $path = substr($entry, 3);  # skip "XY "
      if ($xy =~ /[RC]/) {
        # Rename/Copy in either column (index or worktree): next NUL field is src path — skip it
        my $nul2 = index($input, "\0", $i);
        $i = ($nul2 >= 0) ? $nul2 + 1 : length($input);
      }
      push @paths, $path if length($path);
    }
    print "$_\n" for @paths;
  ' | jq -R . | jq -s 'unique'
}

NEW_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
if [[ -z "$NEW_SESSION_ID" ]]; then exit 0; fi

if [[ -f "$STATE_FILE" ]]; then
  # `|| OLD_SESSION_ID=""` — a bare assignment here aborts the whole hook under `set -euo
  # pipefail` whenever jq cannot parse the file (exit 2 on malformed JSON, 5 on a type error),
  # and a corrupt state file is precisely the case this reset exists to clean up. The damage was
  # not the missed reset but what sits BELOW it: `_clear_orphan_sidecar` (~573 and ~617) is the
  # ONLY retirement path for per-event `.blocked.event.*` markers, so one unparseable byte in the
  # state file made every such marker immortal and every subsequent session permanently blocked.
  # Empty is the right degraded value: it cannot equal a real session id, so the reset branch
  # runs and rewrites the unparseable file — the outcome a corrupt state should produce anyway.
  OLD_SESSION_ID=$(jq -r '.session_id // empty' "$STATE_FILE" 2>/dev/null) || OLD_SESSION_ID=""
  if [[ "$OLD_SESSION_ID" != "$NEW_SESSION_ID" ]]; then
    # Different session (including empty→new) — reset review state, preserve cumulative fields
    NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    # Temp co-located with STATE_FILE (repo root), NOT $TMPDIR: on Linux where /tmp is a
    # separate tmpfs mount, `mv` across filesystems is a non-atomic copy+unlink, so a
    # reader could catch a partial file mid-copy. Same-dir temp → mv is a true atomic
    # rename. Mirrors post-tool-review-state.sh / post-edit-format.sh.
    # Under the shared lock, or not at all. On contention the reset is SKIPPED and the previous
    # session's state is retained — which is safe here specifically: the stale gate values only
    # matter once something is edited, and the edit hook invalidates code_review/precommit/
    # aggregate_gate before any of them can be read as satisfied. Writing unlocked instead would
    # clobber whatever verdict the contending writer is committing right now, which is not safe.
    # Captured BEFORE the lock. `_capture_baseline` shells out to git and can take real time on a
    # large tree; doing it inside the critical section would push the hold toward the 30s TTL and
    # invite the very takeover the commit condition has to defend against. It only READS the work
    # tree, so it needs no serialization of its own.
    BASELINE=$(_capture_baseline)
    if ! _lock; then
      echo "[Session Init] session reset skipped (state lock contention) — previous session's review state retained; the first edit re-invalidates it" >&2
      exit 0
    fi
    # Staged INSIDE the lock directory, so the rename that transfers the lock to a contender also
    # carries this file away and the commit below can no longer resolve it. Same mechanism as
    # post-tool-review-state.sh's `_lock_staging_file`; see the long comment there.
    TMP=$(mktemp "${LOCKDIR}/state.XXXXXX") || exit 0  # temp-file infra failure → best-effort skip, never block session start
    # Gate the mv on both jq success AND a non-empty temp ([[ -s ]]), matching the two
    # create branches below. A bare `&& mv || rm` would rename a truncated/empty file if
    # jq partially wrote before failing; the size guard makes a failed rewrite leave the
    # OLD state intact (the new stop-guard then fails closed on it) instead of clobbering.
    # ONE transaction for the reset AND the session_commit_scope initialization.
    #
    # These used to be two writes with `_unlock` between them, and the second was unlocked
    # outright: it re-read `$STATE_FILE`, set one key, and renamed the whole document back. Any
    # write that landed in between — most consequentially `post-edit-format.sh` raising
    # `has_code_change=true` for an edit made moments after session start — was read before the
    # change and clobbered by the rename after it. The reset had just set that flag to false, so
    # the lost update was precisely the one that re-arms the gate, and nothing downstream re-raises
    # it: reconciliation only relaxes flags, it never sets them.
    #
    # Merging them removes the window rather than narrowing it. There is no interval in which the
    # state is half-reset, and the whole session-start mutation is a single atomic rename.
    if jq --arg sid "$NEW_SESSION_ID" --arg now "$NOW" --argjson bl "$BASELINE" '
      .session_id = $sid | .updated_at = $now |
      .has_code_change = false | .has_doc_change = false |
      .code_review = {"executed":false,"passed":false} |
      .doc_review = {"executed":false,"passed":false} |
      .precommit = {"executed":false,"passed":false} |
      .aggregate_gate = {"executed":false} |
      .iteration_history.current_round = 0 |
      .iteration_history.findings_by_round = [] |
      .session_commit_scope = {
        "session_id": $sid,
        "baseline_dirty_files": $bl,
        "touched_files": [],
        "updated_at": $now
      }
    ' "$STATE_FILE" > "$TMP" 2>/dev/null && [[ -s "$TMP" ]] && _own_lock; then
      mv "$TMP" "$STATE_FILE"
    else
      # `_own_lock` sits in the commit CONDITION, not in a separate check above it: stale recovery
      # fires on age alone, so a slow jq run can outlive our claim on the lock and the rename would
      # then land on top of a contender that is mid-transaction.
      rm -f "$TMP" 2>/dev/null
    fi
    _unlock
    # Clear a stale .blocked sidecar ONLY when the tree has no dirty reviewable
    # files. Otherwise the marker may flag a real unreviewed edit from the
    # crashed session; since the reset just set has_code_change=false and
    # reconciliation never re-raises it, keeping the sidecar is the only thing
    # that re-engages the gate (downstream hooks force HAS_CODE=true on it).
    # Only run the (potentially costly -uall) scan when a sidecar actually exists —
    # with no sidecar there is nothing to clear, so the scan would be pure waste.
    # Serialization and the inside-the-lock re-scan live in _clear_orphan_sidecar.
    _clear_orphan_sidecar
  fi
else
  # No state file — create with baseline (D-5)
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  BASELINE=$(_capture_baseline)
  # Atomic create: write to temp then rename (mirrors the reset branch above) so a
  # crash mid-write never leaves a truncated state file for the jq readers to choke on.
  # Temp co-located with STATE_FILE (same-dir mktemp) so the rename is atomic even when
  # $TMPDIR is a different filesystem (Linux tmpfs /tmp) — a bare mktemp would make the
  # mv a non-atomic cross-fs copy, defeating the very guarantee this comment claims.
  # Under the lock, like the reset branch. "The state file does not exist" is a RACE, not a fact:
  # another hook can be creating it at this instant (`init_state_file` in post-tool-review-state.sh
  # does exactly that), and this branch builds a document from scratch with `jq -n` — so an
  # unlocked rename here does not merely lose a field, it replaces the contender's whole file with
  # one that has every gate absent. On contention the creation is SKIPPED: the first hook that
  # needs the file creates it, so there is nothing to lose by declining.
  if ! _lock; then
    echo "[Session Init] state file creation skipped (state lock contention) — another hook is initializing it" >&2
    exit 0
  fi
  # Staged inside the lock directory for the same reason as the reset branch.
  TMP_INIT=$(mktemp "${LOCKDIR}/state.XXXXXX") || exit 0  # temp-file infra failure → best-effort skip, never block session start
  if jq -n --arg sid "$NEW_SESSION_ID" --arg now "$NOW" --argjson bl "$BASELINE" '{
    "schema_version": 2,
    "session_id": $sid,
    "session_commit_scope": {
      "session_id": $sid,
      "baseline_dirty_files": $bl,
      "touched_files": [],
      "updated_at": $now
    }
  }' > "$TMP_INIT" 2>/dev/null && [[ -s "$TMP_INIT" ]] && _own_lock; then
    mv "$TMP_INIT" "$STATE_FILE"
  else
    # `_own_lock` in the commit condition, matching the reset branch: a takeover during the jq run
    # must not be followed by a rename onto the new owner's file.
    rm -f "$TMP_INIT" 2>/dev/null || true
  fi
  _unlock
  # Same rationale as the reset branch: a sidecar without its state file is an
  # orphan from a deleted/crashed session — but only clear it when the tree has
  # no dirty reviewable files, so a real unreviewed edit still holds the gate.
  # Gate the scan on sidecar existence — no sidecar → nothing to clear → skip the walk.
  _clear_orphan_sidecar
fi
