#!/usr/bin/env bash
# PostToolUse Hook: Parse review command output, update state file
# Trigger condition: Bash tool executes review/precommit commands

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
# PostToolUse input: official Claude Code v2.1.x spec uses `tool_response`;
# `tool_output` is kept as fallback for backward-compat with older replays.
# Bash returns structured `{stdout, stderr, interrupted, isImage}`; MCP returns
# `{content: string | [{type:"text", text}]}`; legacy replays may be plain string.
# Normalize all three shapes into a single text payload here.
TOOL_OUTPUT=$(echo "$INPUT" | jq -r '
  (.tool_response // .tool_output) as $r
  | if ($r | type) == "object" then
      if ($r.stdout | type) == "string" then $r.stdout
      elif ($r.content | type) == "string" then $r.content
      elif ($r.content | type) == "array" then [$r.content[] | select(.type == "text") | .text] | join("\n")
      else ($r | tostring)
      end
    elif ($r | type) == "string" then $r
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

# Only process Bash, MCP Codex, and Skill tools
if [[ "$TOOL_NAME" != "Bash" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex" ]] && \
   [[ "$TOOL_NAME" != "mcp__codex__codex-reply" ]] && \
   [[ "$TOOL_NAME" != "Skill" ]]; then
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
# UNLOCKED-WRITER: creation path. It runs BEFORE any lock is taken (callers invoke it to make the
# file exist so they have something to lock around), so there is no ownership to re-check and no
# $LOCKDIR to stage inside. Its commit is create-if-absent, not a rewrite over a committed verdict.
init_state_file() {
  if [[ ! -f "$STATE_FILE" ]]; then
    # R6: read project max_rounds override for initial value (fallback 10)
    local _mr _pmr
    _mr=$(_read_project_max_rounds 10)
    _pmr=$(_read_project_plan_max_rounds 5)
    # Atomic create: write to a same-dir temp then rename, so a crash mid-write never
    # leaves a truncated state file that the jq readers (stop-guard etc.) would treat
    # as corrupt. mktemp co-locates the temp with the target so `mv` is a same-fs
    # rename, not a cross-device copy. The write AND its size-guard live in a single `if`
    # CONDITION so `set -euo pipefail` is suppressed for them: a bare `cat > tmp << EOF`
    # that fails (ENOSPC) would otherwise abort the hook BEFORE the guard runs, leaking an
    # orphan temp; here a failed cat (or an empty result) falls to `else` and is cleaned up
    # (fail-closed: no file rather than an empty one). Mirrors session-init.sh's writer.
    local _tmp
    _tmp=$(mktemp "${STATE_FILE}.XXXXXX") || return 1
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
      mv "$_tmp" "$STATE_FILE"
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
  _read_project_int_setting "Max Rounds" "${1:-10}"
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
# `## Max Rounds` override was silently replaced by stop-guard's hardcoded `// 10` fallback.
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
    mr=$(_read_project_max_rounds 10)
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
# owning operation actually committed. The previous behavior — `rm -f` after any successful locked
# write — let a REVIEW VERDICT erase an EDIT-plane marker, and a verdict proves nothing about that
# edit: the review may have started before it. Concretely: edit → lock contention → sidecar +
# best-effort UNLOCKED change-flag/invalidations that may be lost → an in-flight reviewer's
# `✅ Ready` lands → verdict recorded, sidecar deleted → the unrecorded edit is now invisible.
#
# Ownership table:
#   edit_lock_contention  — EDIT plane. Never cleared from this file. `has_*_change == true` was
#   state_init_failed       tried as proof that the degraded write landed, but those booleans
#   state_write_failed      routinely PREDATE the edit in question (they stay true across a whole
#                           review cycle), so they cannot distinguish "this edit was recorded" from
#                           "some earlier edit was". Recovery is a successful edit-plane
#                           transaction (post-edit-format.sh, which clears its own marker) or
#                           session-init.sh's clean-tree check at the next session.
#   lock_failure          — AGGREGATE-GATE plane: written by update_aggregate_blocked when the
#   aggregate_write_failed  lock was lost during an aggregate transition, or by
#                           update_aggregate_gate when no branch committed. Only a COMMITTED
#                           aggregate transition supersedes either, so both are cleared from
#                           update_aggregate_gate alone — an unrelated single-review write must
#                           not erase the evidence of a lost dual-gate transition.
#   verdict_write_failed  — VERDICT plane, KEYED by the gate that was lost:
#   :<gate>                 `verdict_write_failed:code_review`, `:doc_review`, `:precommit`. The
#                           key is not decoration — the other writer of this sidecar
#                           (post-edit-format.sh) invalidates DIFFERENT gates in its code branch
#                           (code_review + precommit) than in its doc branch (doc_review), so
#                           without the key neither branch can tell whether its own transaction
#                           actually supersedes the lost verdict. An unkeyed marker made a DOC edit
#                           erase the evidence of a lost blocking CODE verdict while leaving
#                           `code_review.passed=true` untouched — a fail-OPEN. Cleared by the next
#                           committing write of the SAME gate, which is exactly what supersedes it.
#
# $1 = the marker reason this caller is entitled to clear.
# The sidecar holds a SET of reasons, one per line, not a single value.
#
# It used to hold one, and every writer overwrote it. That silently destroyed evidence across
# planes: with `edit_lock_contention` on file (a lost edit, and the only thing holding the gate,
# since `has_code_change` never got written), a failed verdict write replaced it with
# `verdict_write_failed:code_review` — and the NEXT verdict write that succeeded cleared that
# marker as its own. Net result: an edit-plane marker deleted from this file, which the ownership
# table above explicitly forbids, and a Stop allowed in STRICT mode over an unrecorded edit
# (reproduced end-to-end: two lock races in one session, `{"ok":true}` exit 0).
#
# Accumulating fixes it without weakening anything: each writer adds only its own reason, each
# clearer removes only its own, and the file disappears when the last one is retired. Severity also
# survives — stop-guard classifies the sidecar as transient only when EVERY line is transient, so a
# `verdict_write_failed:*` line still escalates even while an `edit_lock_contention` line is
# present.
#
# Serialization. The accumulate/retire pair is a read-modify-write on a shared file, and the MAIN
# state lock cannot order it: setters run precisely BECAUSE they lost that lock, while clearers run
# holding it, so the two classes are never mutually excluded by it. The losing interleaving is
# specific and destructive — a clearer computes an empty remainder, a setter appends a new reason,
# and the clearer's `rm -f` then deletes a marker it never read:
#
#   clearer: rest=$(grep -vxF verdict_write_failed:code_review …)   → ""
#   setter :                        echo "edit_lock_contention:doc" >> sidecar
#   clearer: rm -f sidecar                                          → the doc marker is gone
#
# If that edit's own best-effort JSON write was also lost — the reason its marker existed — strict
# Stop then sees a passing state and no marker, and allows the unreviewed edit.
#
# Hence a dedicated lock covering BOTH operations, with a deliberately asymmetric fallback:
#   - a setter that cannot take the lock still records the reason, but to a PRIVATE per-event file
#     rather than to the shared one (a MISSING marker is the fail-open this whole file exists to
#     prevent; it appended to the shared file until that append was found to be erasable)
#   - a clearer that cannot take the lock does nothing (a retained marker is merely noisy)
# The clearer also re-reads under the lock and commits via temp+rename, so a concurrent reader
# never observes a partially rewritten set.
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
#
# `.blocked` is a SHARED file, and clearers rewrite or remove it WHOLESALE while holding the lock.
# That is only sound if every writer is serialized too — and the setter's last-resort path once was
# deliberately not. It APPENDED when its lock wait expired (past tense throughout this paragraph),
# because dropping a marker is worse than duplicating one, and a marker exists only because a
# blocking verdict was already lost.
#
# A whole-file rewrite therefore raced an unserialized append, and re-reading cannot close it: the
# clearer's final `_sidecar_snapshot` is a subprocess, so an append landing between that read
# returning and the `rm`/`mv` is invisible to it and is then erased. Successive rounds narrowed
# that window without removing it, which is what check-then-act always does.
#
# So the last-resort path stops writing to the shared file. It creates its OWN file, under a name no
# other writer will ever choose. Creation and retirement then act on DISJOINT names and cannot
# destroy one another — there is no window left to narrow.
#
# That closed the TIMEOUT writer. It did not, on its own, make the shared file free of unserialized
# writers, and the claim stood here for a while while it was false: a setter that ACQUIRED the lock
# and was then displaced (age-based reclamation, and setters run inside the state lock with the same
# 30s TTL) appended without re-reading the owner token. `_set_own_sidecar_locked` now re-checks
# ownership immediately before its first mutating statement and returns rc=3, which the caller
# diverts to one of these same markers. With BOTH gone the shared `.blocked` file has no
# unserialized writers, which is what finally makes the clearers' snapshot comparison sufficient
# rather than merely narrow.
#
# Those markers are SIBLING FILES (`<state>.blocked.event.<stem>`), not entries in a marker
# DIRECTORY. The distinction is a security boundary, not a layout preference. `rm -f "$dir"/x`
# resolves THROUGH a symlink at `$dir` and unlinks the TARGET's file, so a symlink planted at
# `.blocked.d` turned session-init's orphan clear into "delete every regular file in an arbitrary
# directory". Git stores symlinks and `.claude_review_state.json.*` is ignored, so cloning a repo
# was enough to arm it; reproduced end-to-end before this change. `rm -f` on a symlink FILE unlinks
# the link itself and never its target, so the same accident against a sibling name destroys
# nothing. An `lstat` guard on the directory could not have offered that — it is check-then-act,
# and the sibling layout has no window to lose.
#
# Retirement is deliberately coarse. Per-event markers are cleared only by session-init's orphan
# sweep, which fires when a NEW session finds no dirty reviewable file — the one precondition under
# which every marker, whatever plane wrote it, is an orphan by definition. They are rare (each needs
# ~2s of lock contention — 20 spins x 0.1s, the setter budget since it came back down from 70), so
# holding one until the next clean session over-blocks briefly and in the safe direction.
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
       --argjson executed "$executed" \
       --argjson passed "$passed" \
       --arg mode "$mode" \
       --arg now "$now" \
       '.[$key].executed = $executed | .[$key].passed = $passed | .[$key].last_run = $now | .updated_at = $now
        | if $mode != "" then .[$key].mode = $mode else . end
        | (if ($passed == true and $key == "precommit" and (.iteration_history | type) == "object")
           then .iteration_history else null end) as $ih
        | if $ih == null then .
          else
            (if ($ih | has("current_round")) and ($ih.current_round != null) then $ih.current_round else 0 end) as $r
            | (if ($ih | has("max_rounds")) and ($ih.max_rounds != null) then $ih.max_rounds else 10 end) as $m
            | if ($r | type) == "number" and ($m | type) == "number"
                 and ($r | tostring | test("^[0-9]+$"))
                 and ((if $m < 3 then 3 elif $m > 50 then 50 else $m end) | tostring | test("^[0-9]+$"))
                 and ($r | floor) == $r and ($m | floor) == $m
                 and $r >= 0 and $r <= 100000 and $m >= 1 and $m <= 100000
                 and ($r < (if $m < 3 then 3 elif $m > 50 then 50 else $m end))
              then .iteration_history.current_round = 0 | .iteration_history.findings_by_round = []
              else . end
          end' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _own_lock && mv "$tmp" "$STATE_FILE"; then
      # ^ The reset guard MIRRORS stop-guard.sh's `ITER_PARSED` validation field for field. It has
      # to: this writer runs BEFORE the reader, so anything the writer is willing to launder is
      # gone by the time the reader would have refused it. Two concrete escapes closed here, both
      # of which the reader catches and the old guard did not:
      #
      #   • `{current_round: 51, max_rounds: 100000}` — the old guard compared against the RAW cap
      #     (51 < 100000 → reset). The reader CLAMPS the cap to the producer contract 3..50, so it
      #     reads the same state as 51/50 = budget EXHAUSTED → ⚠️ Need Human. The writer therefore
      #     refunded, from under the reader, the only convergence exit actually enforced today.
      #   • `{current_round: 3.5}` — jq has no integer type, so `type == "number"` admits it. The
      #     reader rejects a fractional counter as `corrupt` (bash arithmetic would mis-parse it).
      #     Resetting it to a clean `0` destroyed the very corruption the reader fails closed on.
      #
      # A third escape, subtler than either: jq PRESERVES THE LITERAL NUMBER REPRESENTATION from the
      # input (jq 1.8: `1e1` round-trips as `1E+1`, `-0` stays `-0`). The reader's final gate is a
      # BASH regex over the emitted pair — `^([0-9]+)[[:space:]]([0-9]+)$` — so `1E+1` and `-0` are
      # `corrupt` to it while every numeric test here passed them. The `tostring | test("^[0-9]+$")`
      # clauses below are that bash regex, expressed in jq. Without them the two filters disagreed
      # on inputs that no object-literal fixture can even express, which is why the differential
      # test feeds RAW JSON TEXT rather than JSON.stringify'd objects.
      #
      # CRITICALLY, the two operands are canonicality-tested at DIFFERENT points, because the reader
      # emits them at different points. `$r` reaches the bash regex verbatim, so its RAW literal is
      # what must be digits-only. `$m` does NOT: the reader clamps it to 3..50 first, and only the
      # clamp's OUTPUT is interpolated. Testing the raw `$m` — the first version of this clause —
      # reintroduced the very divergence it was added to close, just pointed the other way:
      # `{current_round: 4, max_rounds: 1e2}` reads to the reader as a perfectly valid `4 50`
      # (unspent budget, no warning), while the writer refused to reset on the raw `1E+2` — so the
      # loop walked to the clamped cap and latched on ⚠️ Need Human with no user-visible cause.
      # A literal inside 3..50 (`4e1` → `4E+1`) survives the clamp unchanged and IS rejected by both,
      # which is correct; testing the clamped value gets both cases right, testing the raw one does not.
      #
      # Hence the full mirror: object-typed parent, null→documented default, number, canonical
      # digits-only literal, integral, in range, and below the CLAMPED cap. `// ` is still deliberately absent — jq's alternative
      # operator treats BOTH `null` and `false` as "missing", so `(.current_round // 0)` mapped a
      # `current_round: false` to 0 and one passing `/precommit` rewrote it to a clean `0`. An
      # invalid counter now simply does not qualify for the reset, so it survives for stop-guard to
      # keep flagging — fail-closed, and self-healing only through a deliberate human edit.
      #
      # Kept as an inline mirror rather than a shared extraction because the two run in different
      # hooks with different failure modes (reader: classify → warn/block; writer: qualify → reset).
      # `test/hooks/jq-filter-fidelity.test.js` pins them to the same answers with REAL jq.
      #
      # Clears exactly ONE marker: the `verdict_write_failed` this plane sets below. The edit-plane
      # markers belong to post-edit-format.sh and `lock_failure` belongs to the aggregate
      # transition, and neither is superseded by a verdict write. See _clear_own_sidecar.
      _clear_own_sidecar "verdict_write_failed:$key"
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

  local now tmp
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Acquire lock for state file write (consistent with update_state)
  if _lock; then
    _migrate_state_v2 "$state_file"
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
       --argjson nit "$nit_count" --arg now "$now" \
       '.iteration_history.current_round += 1 |
        .iteration_history.total_rounds_session = ((.iteration_history.total_rounds_session // 0) + 1) |
        .iteration_history.findings_by_round += [{"round": (.iteration_history.current_round), "total": $total, "p0": $p0, "p1": $p1, "p2": $p2, "nit": $nit, "timestamp": $now}] |
        .iteration_history.findings_by_round |= (if length > 50 then .[-50:] else . end) |
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

# True ONLY when the ENTIRE Bash command is a standalone precommit-runner.js invocation:
# optional `HOOK_*=val` env prefixes, then `node <trusted>/precommit-runner.js`, then only
# plain option ARGUMENTS — anchored ^...$ with NO embedded newline. This is the sole form the
# /precommit skill emits (`node .claude/scripts/precommit-runner.js --mode full --tail 80`).
#
# Why anchor the WHOLE command instead of matching a command-position substring: a raw-text
# regex can never prove the runner EXECUTED, only that its text appears. Anchoring ^...$ is
# what defeats fabrication — the runner text cannot hide inside a quoted
# `printf '...node .../precommit-runner.js ... ## Overall: ✅ PASS ...'`, a never-run
# `false && node ...; printf '## Overall: PASS'` branch, or a trailing
# `node ...; printf '## Overall: PASS'` chain: in every such case the command is NOT SOLELY
# the runner, so the match fails and no verdict is recorded. Fail-closed: /precommit re-runs
# the runner cleanly. The multiline guard closes the newline-separated variant.
#
# CRITICAL — four defenses. Defenses 1-3 (the structural grep) close TEXT fabrication a looser
# matcher would admit; defense 4 (the mode allowlist, in the function body below) closes a
# SEMANTIC bypass where a structurally-valid invocation skips the build yet still emits PASS:
#   1. PATH BINDING: the script operand is pinned to the trusted install roots
#      `.claude/scripts/` or `.sd0x/scripts/` (optional `./`). A basename-only match
#      (`<anypath>/precommit-runner.js`) would let a worker drop `/tmp/precommit-runner.js`
#      that prints `## Overall: ✅ PASS` and have the hook record a pass the real checks never ran.
#   2. ENV ALLOWLIST: only `HOOK_*=<word>` prefixes (this project's own debug vars, e.g.
#      HOOK_DEBUG=1) are accepted. A general `VAR=val` prefix would admit execution-affecting
#      overrides — `PATH=/tmp` (shadow `node`), `NODE_OPTIONS=--require=/tmp/evil.js`,
#      `LD_PRELOAD=...` — that run attacker code before/instead of the runner. The value is
#      `[A-Za-z0-9_]` only (no `/` `.` `=` `-`), so even a HOOK_* name cannot smuggle a payload.
#   3. METACHARACTER-FREE ARGS: the arg tokens are a RESTRICTIVE allowlist, not `[^;|&]`.
#      A `[^;|&]*` suffix still accepts redirection/process-sub: e.g.
#      `node .../precommit-runner.js > >(printf '## Overall: ✅ PASS')` has no `;`/`|`/`&`, so the
#      runner's real stdout is redirected away while `printf` supplies a fake PASS. The arg
#      charset cannot form a redirection (`<`/`>`), substitution (`$(`/backtick/`>(`), glob/brace,
#      or quote. `--mode full`, `--tail 80`, `--mode=full` all pass the STRUCTURAL grep; any
#      metacharacter fails-closed (verdict dropped → /precommit re-runs cleanly).
#   4. MODE ALLOWLIST (function body): the structural grep accepts any metachar-free arg, so
#      `--mode bogus` passes it — but precommit-runner.js runs the BUILD only when mode === 'full',
#      so an unknown/typo mode skips build while lint+test can still print `## Overall: ✅ PASS`.
#      Recording that as passed=true bypasses a required failing build. So an explicit `--mode` must
#      be present and EVERY operand exactly `full` or `fast`; anything else drops the verdict.
#
# RESIDUAL (accepted, documented): the three defenses close TEXT-LEVEL fabrication — a
# command string engineered to look like a clean runner run without executing the real
# checks. They do NOT prove the FILE at `.claude/scripts/precommit-runner.js` is the genuine
# runner: an in-place replacement or a symlink repointed to a stub that prints `## Overall:
# ✅ PASS` would still be trusted by this lexical match. This is out of scope by design, not
# an oversight:
#   • Shared trust root — the runner lives under `.claude/`, the SAME tree as this hook. An
#     attacker who can rewrite the runner can equally rewrite the hook (or stop-guard), so
#     runner-identity verification adds no security margin the hook does not already assume.
#   • No exit-code corroboration — the PostToolUse payload is `{stdout,stderr,interrupted}`
#     with no process exit code, so the hook cannot confirm the runner actually ran and
#     exited 0; it can only inspect the command text and stdout it is handed.
#   • No out-of-repo anchor — a manifest-hash check of the runner would itself live in
#     `.claude/`, sharing the same trust root, so it merely moves the problem, not closes it.
# Threat model here is COOPERATIVE (Claude's own auto-loop discipline; trust root = `.claude/`
# integrity), unlike run-verify.js which is ADVERSARIAL (a fanout worker mutating the repo).
# Under the cooperative model, closing text fabrication is the right boundary.
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
    update_state "code_review" "true" "$passed"
    [[ "$passed" == "true" ]] && { _reset_changed_files || true; }
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated: passed=$passed" >&2
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
    update_state "doc_review" "true" "$passed"
    echo "[Review State] doc_review updated: passed=$passed" >&2
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
    update_state "precommit" "true" "false" "$_precommit_mode"
    echo "[Review State] precommit: response interrupted — recording passed=false (fail-closed)" >&2
  else
    # FAIL-precedence: the precommit verdict is the LAST `## Overall:` line, NOT the first
    # PASS anywhere (check_passed) — a PASS embedded in the runner's test/build tail would
    # otherwise mask a real final FAIL and record a passing gate. See
    # _precommit_last_overall_is_pass.
    if _precommit_last_overall_is_pass "$TOOL_OUTPUT"; then passed="true"; else passed="false"; fi
    # Two independent locks (update_state + _set_phase_idle) — deferred by design
    # for the same reason as the code_review branch above: independent fail-closed
    # semantics over a human-cadence command, not worth merging.
    update_state "precommit" "true" "$passed" "$_precommit_mode"
    if [[ "$passed" == "true" ]]; then
      _set_phase_idle || true
    fi
    echo "[Review State] precommit updated: passed=$passed mode=$_precommit_mode" >&2
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
    else
      _mcp_doc_verdict=$(_mcp_doc_review_passed "$TOOL_OUTPUT")
      if [[ -n "$_mcp_doc_verdict" ]]; then
        update_state "doc_review" "true" "$_mcp_doc_verdict"
        echo "[Review State] doc_review updated (MCP): passed=$_mcp_doc_verdict" >&2
      else
        echo "[Review State] MCP doc review carries no verdict sentinel — no state recorded" >&2
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
      exit 0
    fi
    passed=$(_mcp_code_review_passed "$TOOL_OUTPUT")
    update_state "code_review" "true" "$passed"
    [[ "$passed" == "true" ]] && { _reset_changed_files || true; }
    _update_iteration "$TOOL_OUTPUT" "$STATE_FILE"
    echo "[Review State] code_review updated (MCP): passed=$passed" >&2
  fi
  # Priority 3 (MCP `^## Overall:` → precommit verdict) REMOVED — MCP is not a precommit
  # producer, so every sentinel reaching this path is QUOTED text, never a run.
  #
  # The doc / plan / code branches above are namespace-gated but legitimate: codex MCP really
  # IS the reviewer that produces those verdicts, so `## Document Review` + `✅ Mergeable`
  # attests to work codex performed. Precommit has no such producer. `skills/precommit/SKILL.md:4`
  # declares `allowed-tools: Bash(node:*), …` and `:37` runs
  # `node .claude/scripts/precommit-runner.js` — precommit executes over Bash (or the Skill's own
  # final output), never over an MCP call. A verdict line inside an MCP response can therefore
  # only be codex QUOTING output: reviewing precommit-runner.js, reading a build log, or echoing
  # `skills/precommit/SKILL.md:86` (`## Overall: ✅ PASS / ❌ FAIL / ⚠️ NO CHECKS RUN`).
  #
  # That made the branch a live gate bypass, proven end-to-end against the real hooks with a
  # dirty unreviewed tree: feed one mcp__codex__codex response quoting that SKILL.md line and
  # stop-guard flips from `Execute immediately: /precommit` to `All steps completed` without
  # /precommit ever running. A namespace guard (requiring runner section headers like `## Steps`)
  # does NOT fix it — those headers are exactly what codex reproduces when asked to analyze a
  # precommit log, so the guard cannot distinguish "ran it" from "quoted it".
  #
  # Dropping the branch is fail-CLOSED in both directions: a passing precommit is simply not
  # recorded from MCP (precommit.passed stays false → stop-guard re-requests /precommit, which
  # the Bash/Skill path then records correctly), and a quoted FAIL can no longer spuriously
  # revoke a genuine Bash-recorded pass. Verdicts belong to their producer.
  #
  # Priority 4 (generic `✅ All Pass` → code_review pass) REMOVED. `✅ All Pass` is the
  # PRECOMMIT sentinel (rules/auto-loop.md "Gate Sentinels"), not a code-review
  # verdict. Routing it to code_review conflated two independent gates: any precommit
  # output reaching MCP could bank a code_review pass AND reset changed_files, clearing
  # the very tracking the code gate depends on. Precommit verdicts are recorded ONLY by the
  # Bash/Skill path (see Priority 3 above); code verdicts by the namespace-gated branch.
  # Bare ## Gate: ✅/⛔ alone → skip (ambiguity rule)
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

exit 0
