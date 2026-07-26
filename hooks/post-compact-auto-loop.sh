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
if [[ ( "$HAS_CODE" == "true" || "$HAS_DOC" == "true" ) ]] && ! _sidecar_any; then
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
#
# DIGIT-VALIDATED before any arithmetic use. `.claude_review_state.json` is an ordinary working-tree
# file, so its values are untrusted input, and bash arithmetic — both `$(( ))` and the `-gt`/`-ge`
# operands of `[[ ]]` — expands COMMAND SUBSTITUTION inside an array subscript. `THRESHOLD=$((
# ${ITER_MAX:-10} - 3 ))` below is a direct arithmetic context, so a crafted
# `"max_rounds": "a[$(...)]"` executed arbitrary commands from this hook. Falling back to the
# schema defaults keeps this ADVISORY hook advisory: it only decides whether to print an
# `[ITERATION_STATE]` / `[STRATEGIC_RESET]` hint, and the enforcing decision (the hard cap) lives in
# stop-guard.sh, which fails closed on the same input rather than defaulting.
ITER_ROUND=$(jq -r '.iteration_history.current_round // 0' "$STATE_FILE" 2>/dev/null || echo 0)
ITER_MAX=$(jq -r '.iteration_history.max_rounds // 10' "$STATE_FILE" 2>/dev/null || echo 10)
[[ "$ITER_ROUND" =~ ^[0-9]+$ ]] || ITER_ROUND=0
[[ "$ITER_MAX" =~ ^[0-9]+$ ]] || ITER_MAX=10

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
    # Same digit guard as ITER_ROUND/ITER_MAX above — TOTAL_SESSION reaches `[[ -ge ]]` directly.
    [[ "$TOTAL_SESSION" =~ ^[0-9]+$ ]] || TOTAL_SESSION=0
    THRESHOLD=$(( ITER_MAX - 3 ))
    [[ "$THRESHOLD" -lt 1 ]] && THRESHOLD=1
    if [[ "$TOTAL_SESSION" -ge "$THRESHOLD" ]] && [[ "$RESET_FIRED" != "true" ]]; then
      THINK_HARDER="[STRATEGIC_RESET] Approaching iteration cap (${TOTAL_SESSION}/${ITER_MAX}). Before escalating:
1) Re-read original error/requirement from conversation start
2) Challenge current assumption — what if the opposite is true?
3) Search for similar patterns: grep -r \"keyword\" --include=\"*.ts\" -l
4) Try fundamentally different approach (not incremental fix)
5) If still blocked after reset, escalate at max_rounds"
      # Mark as fired (write to state file). Same-dir mktemp + size guard + cleanup, matching the
      # writers in post-tool-review-state.sh: a FIXED `${STATE_FILE}.tmp` name collides when two
      # sessions compact at once (one truncates the other's partial write, then both rename), and
      # without `-s` a jq that exits 0 having written nothing renames an EMPTY file over the state,
      # which every downstream jq reader — stop-guard included — then treats as corrupt.
      #
      # The jq READ must happen inside the lock, not just the rename: the mtime-ordered `mv` is a
      # whole-file replace, so anything committed by another writer after this read is discarded.
      # Taking the lock first is what makes read+replace a single transaction. Lock unavailable →
      # skip the mark entirely (see the header: re-firing the checklist is the safe direction).
      if _lock; then
        _srf_tmp=$(mktemp "${STATE_FILE}.XXXXXX" 2>/dev/null) || _srf_tmp=""
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
            _own_lock && mv "$_srf_tmp" "$STATE_FILE" 2>/dev/null || rm -f "$_srf_tmp"
          else
            rm -f "$_srf_tmp"
          fi
        fi
        _unlock
      fi
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
