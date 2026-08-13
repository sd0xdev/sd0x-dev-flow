#!/usr/bin/env bash
# PostToolUse hook: Auto-format edited files + Track file changes
# This eliminates the "last 10%" CI failures due to formatting issues.
#
# How it works:
# - Claude pipes tool_input JSON to stdin
# - We extract file_path and run prettier if it's a supported file type
# - We update .claude_review_state.json to track code/doc changes
#
# Safety:
# - Only runs prettier if the project has it installed (package.json or .prettierrc)
# - Skips gracefully if prettier is not available
# - Set HOOK_NO_FORMAT=1 to disable auto-formatting

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

# === Sensitive-path advisory hint (R4) ===
# FILE-LOCAL — deliberately OUTSIDE the shared [AUTO_LOOP_STATE] emitter block above, which is
# byte-identical-pinned across six hooks; only this hook classifies edit paths, so widening the
# shared block for it would force five no-op copies. ADVISORY ONLY: the output is extra key=value
# tokens on the code_edit fact line. It never writes review_mode, tier, or any enforcement state —
# the model reads the hint and decides; see
# docs/features/auto-loop-autonomy/requests/2026-07-26-sensitive-path-advisory-hints-r4.md.
#
# Matching is anchored path-SEGMENT matching on the root-relative path: entry `auth` matches
# `auth`, `auth/login.ts`, `src/auth/login.ts` but not `author/index.ts`. Multi-segment entries
# (`config/secrets`) match that exact segment run. Exclude wins over include; first rule wins.
# Config missing or invalid → `sensitivity=unknown` (fail-loud, distinguishable from a clean
# miss `sensitivity=none` — collapsing them would make a deleted config read as "nothing
# sensitive here", the inverse of what the reader needs).
_alf_sensitivity() {
  local fp="$1" cfg="" c root out
  root="${CLAUDE_PROJECT_DIR:-$PWD}"
  fp="${fp#"${root}/"}"
  for c in ".claude/scripts/config/sensitive-paths.json" "scripts/config/sensitive-paths.json"; do
    [[ -f "$c" ]] && { cfg="$c"; break; }
  done
  if [[ -z "$cfg" ]]; then
    printf 'sensitivity=unknown'
    return 0
  fi
  # Single jq call: first line is the validity verdict, remaining lines one TSV row per rule.
  # Validation is ALL-OR-NOTHING: one schema-invalid rule invalidates the whole config
  # (→ `sensitivity=unknown`). Dropping just the bad rule would let a typo'd config emit
  # `sensitivity=none` — the fail-open reading the ticket explicitly prohibits, since `none`
  # asserts "checked and clean" while the config was never fully honored.
  # Segments must also survive the transport encoding below: `,` joins the segment list (a
  # comma inside a segment would split it into two rules), `-` is the empty-field
  # placeholder (tab is IFS *whitespace* to bash `read`, so a genuinely empty column would
  # shift every field after it), and tab/newline/CR/backslash are characters `@tsv` escapes
  # but the bash reader never decodes — any of these in a value is rejected as invalid
  # rather than silently mis-decoded. Optional fields are checked by PRESENCE (`has`), not
  # by `//` defaulting: jq `//` selects its right operand for `false` as well as `null`, so
  # `exclude:false` would otherwise default to `[]` and validate — the same trap
  # `_alf_receipt` documents above. Two values are reserved by the line protocol itself and
  # rejected everywhere: `VALID` (the verdict line, which the row parser skips by name) and
  # `-` (the empty-field placeholder decoded back to empty).
  out=$(jq -r '
    def tsv_ok: (contains("\t") or contains("\n") or contains("\r") or contains("\\")) | not;
    def seg_ok: type == "string" and length > 0
      and tsv_ok and (contains(",") | not) and . != "-";
    def str_ok: type == "string" and tsv_ok and . != "-" and . != "VALID";
    def opt_arr(k): (has(k) | not) or (.[k] | type == "array" and all(seg_ok));
    def opt_str(k): (has(k) | not) or (.[k] | str_ok);
    def rule_ok: type == "object"
      and (.name | str_ok and length > 0)
      and has("include") and (.include | type == "array" and length > 0 and all(seg_ok))
      and opt_arr("exclude") and opt_str("suggested_tier") and opt_str("suggested_route");
    def nz: if . == "" then "-" else . end;
    if (.version == 1) and ((.rules // null) | type == "array") and (.rules | all(rule_ok)) then
      "VALID",
      (.rules[]
        | [.name,
           (.include | join(",")),
           ((.exclude // []) | join(",") | nz),
           ((.suggested_tier // "") | nz), ((.suggested_route // "") | nz)]
        | @tsv)
    else "INVALID" end
  ' "$cfg" 2>/dev/null) || out="INVALID"
  if [[ "${out%%$'\n'*}" != "VALID" ]]; then
    printf 'sensitivity=unknown'
    return 0
  fi
  local wrapped="/${fp}/" line name inc exc tier route seg _hit
  while IFS=$'\t' read -r name inc exc tier route; do
    [[ -n "$name" && "$name" != "VALID" ]] || continue
    # Decode the `-` empty-field placeholder (see the jq `nz` note above).
    [[ "$inc" == "-" ]] && inc=""
    [[ "$exc" == "-" ]] && exc=""
    [[ "$tier" == "-" ]] && tier=""
    [[ "$route" == "-" ]] && route=""
    _hit=""
    # `IFS=',' read -ra` scopes the IFS change to the read builtin; the outer TSV read is untouched.
    if [[ -n "$inc" ]]; then
      local _segs
      IFS=',' read -ra _segs <<< "$inc"
      for seg in "${_segs[@]}"; do
        [[ -n "$seg" && "$wrapped" == *"/${seg}/"* ]] && { _hit=1; break; }
      done
    fi
    [[ -n "$_hit" ]] || continue
    if [[ -n "$exc" ]]; then
      local _xsegs
      IFS=',' read -ra _xsegs <<< "$exc"
      for seg in "${_xsegs[@]}"; do
        [[ -n "$seg" && "$wrapped" == *"/${seg}/"* ]] && { _hit=""; break; }
      done
    fi
    [[ -n "$_hit" ]] || continue
    printf 'sensitivity_hint=high rule=%s suggested_tier=%s suggested_route=%s' \
      "$(_alf_val "$name")" \
      "$(_alf_val "${tier:-thorough}")" \
      "$(_alf_val "${route:-/codex-review-branch}")"
    return 0
  done <<< "$out"
  printf 'sensitivity=none'
}

# === Portable mkdir locking (shared protocol with post-tool-review-state.sh) ===
LOCKDIR="${STATE_FILE}.lockdir"
# Honor REVIEW_STATE_LOCK_TIMEOUT so both writers of this shared lock protocol read
# the same env override (post-tool-review-state.sh already does); a hardcoded 5 here
# would silently diverge if the timeout is tuned.
LOCK_TIMEOUT="${REVIEW_STATE_LOCK_TIMEOUT:-5}"
# Guard: `:-5` only fills an UNSET var, not a malformed one. A non-integer override
# (e.g. "5s") makes the `-ge $LOCK_TIMEOUT` test in _lock error "integer expected"
# every iteration, so the timeout/stale-recovery branch never fires and the hook hangs
# under contention (leaving a completed edit with a stale review verdict). Reject any
# non-digit value → fall back to the default before it feeds the arithmetic.
[[ "$LOCK_TIMEOUT" =~ ^[0-9]+$ ]] || LOCK_TIMEOUT=5
LOCK_TTL=30
HAVE_LOCK=0
# Ownership token — see post-tool-review-state.sh for why the HAVE_LOCK flag alone is not proof.
# Built from shell builtins only. An earlier revision spliced in `$(date +%s)`, which runs at
# LOAD time — before the `command -v jq` degradation check — so on a PATH without coreutils the
# hook died with 127 instead of degrading. `$$` plus three 15-bit draws is ample here: the token
# only has to distinguish concurrent hook processes on one machine.
LOCK_TOKEN="$$-${RANDOM}${RANDOM}${RANDOM}"

# See post-tool-review-state.sh for why a missing owner record falls back to the lock directory's
# own mtime rather than to 0: both files implement the SAME protocol against the SAME directory, so
# a permissive reading in either one is enough to let two writers into the critical section.
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
      if [[ ! -f "$LOCKDIR/ts" ]]; then
        lock_ts=$(_lockdir_mtime)
      fi
      [[ "$lock_ts" =~ ^[0-9]+$ ]] || lock_ts=0
      now=$(date +%s)
      # Stale recovery: TTL expired OR owner PID dead
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
      return 1  # lock failure triggers fail-closed sidecar marker in caller
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

# See post-tool-review-state.sh — ownership is proven by token, not by the HAVE_LOCK flag.
_own_lock() {
  [ "$HAVE_LOCK" -eq 1 ] || return 1
  [ "$(cat "$LOCKDIR/owner" 2>/dev/null || echo)" = "$LOCK_TOKEN" ]
}

_unlock() {
  if _own_lock; then rm -rf "$LOCKDIR" 2>/dev/null || true; fi
  HAVE_LOCK=0
}

# Where a state rewrite is staged, and whether the caller still owns the lock when it commits.
#
# Both halves are the same defect the other two hooks already closed. `mktemp "$STATE_FILE.XXXXXX"`
# stages BESIDE the state file, so the temp survives losing the lock and the later `mv` lands on
# top of whatever the new owner committed in the meantime. That is not theoretical here: stale
# recovery evicts on AGE, not liveness, so a code edit can build a snapshot carrying
# `doc_review.passed = true`, be descheduled past the TTL, and then restore that stale pass over a
# newer BLOCKING doc verdict. The newer write succeeded, so no sidecar was raised — nothing records
# that a verdict was lost, and the gate reads as satisfied. Fail-OPEN, and invisible.
#
# Staging inside $LOCKDIR makes it structural: the takeover renames the whole directory aside, so a
# displaced writer's temp goes with it and the commit can no longer resolve its own source. The
# explicit `_own_lock` in every commit condition is the belt to that braces — it also covers the
# window where the lock was reacquired by us-then-someone-else without a rename.
#
# The DEGRADED path (lock contention) must keep staging beside the state file: $LOCKDIR is someone
# else's there, and writing into it would be the very intrusion this guards against. Those writes
# are already best-effort and already accompanied by a `.blocked` marker.
_EDIT_HOLDS_LOCK=0
_state_staging_file() {
  if [[ "$_EDIT_HOLDS_LOCK" == "1" ]]; then
    # Refuse to stage inside a lock directory that is no longer ours. After a takeover $LOCKDIR
    # belongs to the contender, and the commit would be declined by _may_commit_state anyway —
    # failing HERE routes the caller straight to its own `_edit_write_failed` arm, so the marker is
    # raised one step earlier and the contender's critical section is never written into.
    _own_lock || return 1
    mktemp "$LOCKDIR/state.XXXXXX" 2>/dev/null
  else
    # UNLOCKED-WRITER: this branch is reached only when `_lock` FAILED, so `$LOCKDIR` is the
    # contender's and staging inside it is the intrusion the placement rule exists to prevent.
    # Beside the state file is correct here; the write is best-effort and carries a `.blocked`
    # marker. The declaration is what `test/hooks/state-commit-ownership.test.js` reads to tell
    # this deliberate exception from the drift it hunts — the paragraph above the function says
    # the same thing in prose, which no test can check.
    mktemp "${STATE_FILE}.XXXXXX" 2>/dev/null
  fi
}
# True when this process may still commit a staged rewrite: either it never held the lock (degraded
# path, best-effort by construction) or it holds it right now.
_may_commit_state() {
  [[ "$_EDIT_HOLDS_LOCK" != "1" ]] || _own_lock
}

trap '_unlock' EXIT

INPUT=$(cat)

# Check if jq is available
if ! command -v jq &> /dev/null; then
  exit 0
fi

# Use printf to avoid echo interpretation issues
# NotebookEdit matches the Edit|Write hook matcher but carries notebook_path,
# not file_path — without the fallback, notebook edits silently bypass all
# change tracking and review gates.
file_path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || true)

if [[ -z "$file_path" ]]; then
  exit 0
fi

# Security: Reject paths with shell metacharacters that could enable injection
# Block: ; & | ` $()
# Note: $ alone is NOT blocked as it's valid in some filenames
# Note: Null bytes cannot be reliably detected in bash (variables truncate at \0)
if [[ "$file_path" =~ [\;\&\|\`] ]] || [[ "$file_path" =~ \$\( ]]; then
  echo "[Edit Hook] Rejected suspicious file path: contains shell metacharacters" >&2
  exit 0
fi

# === Edit plane: which review gate this edit invalidates ===
# Every fail-closed marker this hook writes is keyed by it. Without the key all three edit-plane
# reasons (`edit_lock_contention`, `state_init_failed`, `state_write_failed`) were a single shared
# name that BOTH branches listed as superseded, so a successful edit in one plane retired evidence
# belonging to the other. Concretely: a doc edit loses the lock, its best-effort write is dropped,
# and the marker is the only record that `doc_review.passed` is stale; a later code edit — which
# invalidates code_review and precommit, and says nothing whatever about docs — cleared it, and
# once the code gates passed the stop was allowed over an unreviewed doc edit.
#
# The split mirrors the two tracking branches below exactly (md/mdx → doc, everything else → code),
# so the key a marker is written under is always the key its own branch clears. A path in neither
# set never reaches a tracking branch, so it never writes one of these markers at all.
if echo "$file_path" | grep -Eq '\.(md|mdx)$'; then
  _EDIT_PLANE="doc"
else
  _EDIT_PLANE="code"
fi

# === Skip vendor/generated paths (no formatting or change tracking) ===
# Normalize to repo-relative path so we only match root-level vendor dirs
# (avoids false positives like src/build/helpers.ts matching "build/")
rel_path="$file_path"
if [[ "$file_path" = /* ]]; then
  local_prefix="${PWD%/}/"
  if [[ "$file_path" = "$local_prefix"* ]]; then
    rel_path="${file_path#"$local_prefix"}"
  fi
fi
if echo "$rel_path" | grep -Eq '^(node_modules|vendor|dist|build|out|target|\.next|\.nuxt|__pycache__|\.pytest_cache|venv|\.venv|\.git)/'; then
  exit 0
fi

# === Auto-format supported file types ===
if [[ "${HOOK_NO_FORMAT:-}" != "1" ]]; then
  if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|json|md|mdx|yaml|yml)$'; then
    # Require an installed prettier binary. Config files alone used to route
    # through `npx prettier`, which on a config-only repo downloads prettier
    # from the network on every single edit (no timeout, one fetch per file).
    # Local node_modules binary = project opted in via dependency; a global
    # binary still needs a config file as the opt-in signal.
    prettier_bin=""
    if [[ -x "node_modules/.bin/prettier" ]]; then
      prettier_bin="node_modules/.bin/prettier"
    elif command -v prettier >/dev/null 2>&1 && {
        [[ -f ".prettierrc" ]] || [[ -f ".prettierrc.json" ]] || [[ -f ".prettierrc.js" ]] || \
        [[ -f "prettier.config.js" ]] || [[ -f "prettier.config.mjs" ]]; }; then
      prettier_bin="prettier"
    fi

    if [[ -n "$prettier_bin" ]]; then
      "$prettier_bin" --write "$file_path" 2>/dev/null || true
    fi
  fi
fi

# === Track file changes in state file ===

# Best-effort fail-CLOSED marker for init failure. This write can ITSELF fail under the exact
# condition it guards (ENOSPC / unwritable dir) — no marker can be written on a full disk. So
# rather than swallow that silently (which would leave NEITHER state NOR sidecar → stop-guard's
# no-state path ALLOWS the unreviewed edit, a silent fail-OPEN), surface a CRITICAL stderr
# diagnostic so the operator sees the degraded state instead of a silent gap (strict iter-12 P2).
# Always returns 0 so the CALLER's own `return 1` — not this best-effort write — drives control
# flow under `set -e`.
# Add THIS plane's reason to the sidecar without disturbing anyone else's.
#
# The marker file holds a SET of reasons, one per line (see post-tool-review-state.sh
# `_set_own_sidecar` for the fail-open a single-value, last-writer-wins file produced). Appending
# keeps every plane's evidence, and stop-guard treats the sidecar as transient only when EVERY line
# is transient — so severity is preserved rather than decided by write order.
#
# Serialization. Kept protocol-identical to post-tool-review-state.sh's copy — SAME lock directory
# name, same TTL, same asymmetric fallback — because the two hooks mutate the SAME sidecar and a
# lock only one of them takes excludes nothing. See that file for the losing interleaving (a
# clearer's `rm -f` deleting a line a setter appended after the clearer's read).
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
      echo "[Edit Hook] sidecar lock unavailable — recorded '$reason' as a per-event emergency marker (unretirable by a racing clearer)" >&2
      return 0
    fi
    echo "[Edit Hook] CRITICAL: sidecar lock unavailable AND the per-event marker could not be written ('$reason') — this evidence is now only in the log" >&2
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
  # only a sibling filename — would have succeeded right beside it. The marker was dropped anyway.
  # The two rc values still differ in what they mean (2 = must not be attempted here, 1 = was
  # attempted and failed), so they keep separate diagnostics; they no longer differ in whether the
  # evidence is preserved.
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
      echo "[Edit Hook] $_why; recorded '$reason' as a per-event marker instead" >&2
      return 0
    fi
    echo "[Edit Hook] CRITICAL: $_why AND the per-event marker could not be written ('$reason') — this evidence is now only in the log" >&2
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

# Clear the shared `.blocked` sidecar only when THIS transaction actually supersedes the marker
# that is there.
#
# The two clear sites below used to be a blind `rm -f "${STATE_FILE}.blocked"`, which is wrong for
# a marker four different planes write. The concrete fail-OPEN: post-tool-review-state.sh raises
# `verdict_write_failed:code_review` when a BLOCKING code verdict could not be written — meaning
# `code_review.passed` is still the `true` from the previous round. A `.md` edit then ran the DOC
# branch, which invalidates `doc_review` and nothing else, and its blind `rm -f` deleted that
# marker. Result: `code_review.passed=true`, no sidecar, blocking verdict gone.
#
# So each branch passes the exact set of markers its own jq writes supersede:
#   • its own edit-plane markers (this file is their only writer, and any committed edit
#     transaction re-arms the gate they stood in for);
#   • `verdict_write_failed:<gate>` only for the gates that branch sets back to `passed=false`;
#   • the aggregate-plane markers, because both branches reset `aggregate_gate` to
#     executed=false/gate=null — the same fail-closed value the lost transition would have left.
# Anything else is retained and reported, matching _clear_own_sidecar in post-tool-review-state.sh.
#
# Over-retention is the safe direction: a marker this branch declines to clear is cleared by the
# next committing write of the gate that owns it, so nothing latches.
_clear_superseded_sidecar() {
  local sidecar="${STATE_FILE}.blocked"
  # Not `-f`: that follows a symlink, and the retain-branch below prints the file it read to
  # stderr. A link planted here would have disclosed an arbitrary file into the hook log.
  _sidecar_is_marker "$sidecar" || return 0
  # Decline rather than race — same asymmetry as the setter above, inverted: retaining a marker is
  # noise, deleting one that a concurrent setter just wrote is the fail-open.
  if ! _sidecar_lock; then
    echo "[Edit Hook] sidecar lock unavailable — retaining markers rather than clearing on a possibly stale read" >&2
    return 0
  fi
  # Re-read inside the lock; the caller's `-f` probe predates it.
  if ! _sidecar_is_marker "$sidecar"; then
    _sidecar_unlock
    return 0
  fi
  # Line-wise: the file is a SET of reasons, so removing "the marker" would remove other planes'
  # evidence along with our own. Build the keep-list from the lines NOT in this transaction's
  # superseded set, and delete the file only when nothing is left.
  # Snapshot the bytes the keep-list is about to be derived from; every destructive step below
  # re-reads and declines if they moved (see `_sidecar_snapshot`).
  local _sc_before
  _sc_before=$(_sidecar_snapshot)
  local rest
  # `|| true` here was a fail-OPEN, and an unusually expensive one: an EMPTY keep-list is the
  # signal to DELETE the whole sidecar, and grep reports "no lines selected" (rc 1) and "I could
  # not run" (rc >1: unreadable file, bad -f operand, missing binary) through the same non-zero
  # channel. Flattening both to `rest=""` meant any grep FAILURE deleted every marker in the file
  # — including the other plane's, and including markers standing in for verdicts that really
  # were lost. Only rc 1 legitimately means "everything here is superseded".
  local _grep_rc=0
  rest=$(grep -vxF -f <(printf '%s\n' "$@") "$sidecar" 2>/dev/null) || _grep_rc=$?
  if [[ "$_grep_rc" -gt 1 ]]; then
    echo "[Edit Hook] sidecar filter failed (grep rc=$_grep_rc) — retaining the full marker set rather than deleting on a keep-list that was never computed" >&2
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
      # Optimistic concurrency, because holding the lock does not mean nobody wrote. This used to
      # be load-bearing against TWO unserialized setters. One timed out and appended to the SHARED
      # file anyway; it now creates a private `.blocked.event.*` sibling instead, a name no clearer
      # enumerates. The other acquired the lock, was displaced mid-transaction, and appended without
      # re-reading the owner token; `_set_own_sidecar_locked` now re-checks ownership before its
      # first mutating statement. With both gone the shared file has no unserialized writers left.
      # The comparison is kept as defence in depth: it is what makes this snapshot argument
      # SUFFICIENT rather than merely narrow, and it still catches a displaced-owner write in the
      # residual window. Declining on a changed set keeps evidence of a lost verdict.
      echo "[sidecar] clear abandoned — the marker set changed after the keep-list was computed; retaining it" >&2
    else
      rm -f "$sidecar" 2>/dev/null || true
    fi
  else
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
        echo "[Edit Hook] sidecar rewrite abandoned — lock was taken over mid-section; retaining full marker set" >&2
      elif [[ -n "$_sc_tmp" ]] && [[ "$(_sidecar_snapshot)" != "$_sc_before" ]]; then
        echo "[Edit Hook] sidecar rewrite abandoned — the marker set changed after the keep-list was computed; retaining full marker set" >&2
      else
        echo "[Edit Hook] sidecar rewrite unavailable — retaining full marker set" >&2
      fi
      _sidecar_unlock
      return 0
    fi
    # Parameter expansion, not `tr`: this is a diagnostic on a fail-closed branch, and under
    # `set -euo pipefail` a host without `tr` would abort the hook AT THIS ECHO — after the
    # rewrite committed but before `_sidecar_unlock` below, leaking the sidecar lock for a full
    # TTL and wedging every subsequent marker write. A built-in cannot be missing.
    local _rest_joined="${rest//$'\n'/,}"
    echo "[Edit Hook] sidecar retained (${_rest_joined}) — this edit does not supersede those markers" >&2
  fi
  _sidecar_unlock
  return 0
}

# Did any write in this edit's state transaction fail?
#
# The transaction is several jq+rename steps (flag set, code_review invalidation, precommit
# invalidation, aggregate reset). Each used to be a bare `jq … && mv` with NO failure handling:
# on an mktemp/jq/mv failure `set -e` aborted the hook mid-transaction, leaving the PREVIOUS
# review/precommit passes intact and writing no sidecar at all — stop-guard then saw a fully
# passed state with no marker and allowed the stop, so the edit shipped unreviewed (fail-OPEN).
# The reconciliation in the advisory hooks cannot rescue it either: it is one-way (true→false)
# and never re-raises a flag that was never written.
#
# So each write now reports its own failure here instead of aborting, the marker is written
# immediately (fail-CLOSED), and the end-of-transaction sidecar CLEAR is suppressed — otherwise
# a later successful step in the same transaction would erase the marker its failed sibling set.
_EDIT_WRITE_FAILED=0
_edit_write_failed() {
  _EDIT_WRITE_FAILED=1
  _set_own_sidecar "state_write_failed:${_EDIT_PLANE}" \
    || echo "[Edit Hook] CRITICAL: state write failed ($1) AND the .blocked sidecar could not be written — the review gate may FAIL-OPEN for this edit" >&2
  echo "[Edit Hook] state write failed ($1) — sidecar set, gate held closed" >&2
  return 0
}

# Reset aggregate_gate on edit (invalidates dual-review results)
invalidate_aggregate_gate() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  # Only reset if aggregate_gate exists in the state file
  local has_agg
  has_agg=$(jq 'has("aggregate_gate")' "$STATE_FILE" 2>/dev/null || echo "false")
  if [[ "$has_agg" == "true" ]]; then
    local tmp
    tmp=$(_state_staging_file) || { _edit_write_failed "invalidate_aggregate_gate"; return 0; }
    if jq '.aggregate_gate.executed = false | .aggregate_gate.gate = null | .aggregate_gate.reason = null' \
       "$STATE_FILE" > "$tmp" 2>/dev/null && [[ -s "$tmp" ]] && _may_commit_state && mv "$tmp" "$STATE_FILE" 2>/dev/null; then
      return 0
    fi
    rm -f "$tmp" 2>/dev/null || true
    _edit_write_failed "invalidate_aggregate_gate"
  fi
  return 0
}

# Track individual changed files for delta review (D-3)
# Graceful: no-op if jq doesn't support the filter (e.g., stub jq in tests)
_track_changed_file() {
  local file_path="$1"
  [[ ! -f "$STATE_FILE" ]] && return 0
  local tmp _before_size _after_size
  _before_size=$(wc -c < "$STATE_FILE" 2>/dev/null || echo 0)
  # `|| return 0` is load-bearing, not defensive noise. Under `set -euo pipefail` a failing
  # command substitution ABORTS the hook, and this function is called from the doc branch WITHOUT
  # a `|| true` guard and BEFORE that branch decides whether to set or clear the `.blocked`
  # sidecar. So an unavailable temp (ENOSPC / unwritable dir) killed the hook after a real edit but
  # before `_edit_write_failed` ran: no marker, a stale `doc_review.passed: true` left in place, and
  # the lock released by the EXIT trap — a silent fail-OPEN produced by a NON-critical bookkeeping
  # append. Making the guard intrinsic means the safety no longer depends on how each caller
  # happens to invoke it. Skipping the append itself is harmless: `changed_files_since_review` is
  # advisory, and no gate is computed from it.
  tmp=$(_state_staging_file) || return 0
  if jq --arg f "$file_path" \
    '.changed_files_since_review = ((.changed_files_since_review // []) + [$f] | unique)' \
    "$STATE_FILE" > "$tmp" 2>/dev/null; then
    _after_size=$(wc -c < "$tmp" 2>/dev/null || echo 0)
    if [[ "$_after_size" -ge "$_before_size" ]] && _may_commit_state; then
      mv "$tmp" "$STATE_FILE"
    else
      rm -f "$tmp" 2>/dev/null
    fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}

# Track file for session commit scope (D-5)
# Stores repo-relative paths; never reset on review pass (independent lifecycle).
_track_session_touched_file() {
  local file_path="$1"
  [[ ! -f "$STATE_FILE" ]] && return 0

  # Guard: only append when session_commit_scope is valid
  local scope_valid
  scope_valid=$(jq -r '
    if (.session_commit_scope.session_id == .session_id) and
       (.session_commit_scope.baseline_dirty_files != null)
    then "yes" else "no" end
  ' "$STATE_FILE" 2>/dev/null) || return 0
  [[ "$scope_valid" != "yes" ]] && return 0

  # Normalize to repo-relative path
  local rel_path="$file_path"
  if [[ "$file_path" = /* ]]; then
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
    repo_root="${repo_root%/}/"
    if [[ "$file_path" = "$repo_root"* ]]; then
      rel_path="${file_path#"$repo_root"}"
    else
      return 0  # Outside repo — ignore
    fi
  fi

  local tmp _before_size _after_size
  _before_size=$(wc -c < "$STATE_FILE" 2>/dev/null || echo 0)
  # Same intrinsic guard as _track_changed_file: an unavailable temp must skip this advisory
  # append, never abort the hook mid-transaction.
  tmp=$(_state_staging_file) || return 0
  if jq --arg f "$rel_path" '
    .session_commit_scope.touched_files = (
      (.session_commit_scope.touched_files // []) + [$f] | unique
    )
  ' "$STATE_FILE" > "$tmp" 2>/dev/null; then
    _after_size=$(wc -c < "$tmp" 2>/dev/null || echo 0)
    if [[ "$_after_size" -ge "$_before_size" ]] && _may_commit_state; then
      mv "$tmp" "$STATE_FILE"
    else
      rm -f "$tmp" 2>/dev/null
    fi
  else
    rm -f "$tmp" 2>/dev/null
  fi
  return 0
}

# Track code changes (all recognized code extensions, incl. shell scripts: sh/bash/zsh —
# this repo's own hooks are .sh, so shell edits must engage the review gate)
#
# WB5b: the gate-state writes this branch used to perform — `has_code_change = true`,
# `code_review/precommit.passed = false`, edit epochs, background_reviews sweeps — are RETIRED.
# The obligation is now derived at check time from tree content vs receipts
# (scripts/lib/gate-derive.js; tech spec §3.5–§3.6), so an edit re-opens its gates structurally,
# with no stored flag to raise or verdict to reset. What this branch still owns:
#   • advisory tracking (changed_files_since_review, session_commit_scope — no gate reads them);
#   • the aggregate_gate mirror reset — the dual-mode aggregate branch in stop-guard reads that
#     mirror directly (§3.6 Stays column, ❓Q1), and a mirror kept alive without its edit-reset
#     would fail OPEN in dual mode after an edit;
#   • the fact line, whose `pending=` claim is structural truth (an edit owes its plane's gates),
#     not a read-back of state this branch no longer writes — hence no `receipts=` token.
if echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb)$'; then
  if _lock; then
    _EDIT_HOLDS_LOCK=1
    _track_changed_file "$file_path" || true
    _track_session_touched_file "$file_path" || true
    invalidate_aggregate_gate
    # Clear any stale sidecar ONLY if EVERY write in this transaction landed, and only under
    # ownership (`_own_lock`): clearing a marker is the one FAIL-OPEN action here, and a
    # stale-recovery takeover mid-transaction can clobber writes that returned success.
    if [[ "$_EDIT_WRITE_FAILED" -eq 0 ]] && _own_lock; then
      # `:code` only — the doc-plane copies stand for a lost DOC transaction this one cannot
      # supersede. `lock_failure` / `aggregate_write_failed` are aggregate-plane markers and DO
      # belong here: this transaction resets `aggregate_gate` outright, which is exactly the
      # committed transition those two were standing in for.
      _clear_superseded_sidecar \
        edit_lock_contention:code state_write_failed:code \
        lock_failure aggregate_write_failed
    fi
    _unlock
    _EDIT_HOLDS_LOCK=0
    echo "[Edit Hook] Code change detected: $file_path" >&2
    echo "[Edit Hook] code_review + precommit re-open by derivation; aggregate_gate mirror reset" >&2
    # The round is NOT reset by an edit (it counts convergence, not keystrokes — the reset lives
    # in post-tool-review-state.sh's update_state, gated on `current_round < max_rounds`).
    _alf_emit "event=code_edit change=code file=$(_alf_val "${file_path}")" \
      "$(_alf_common)" \
      "pending=code_review,precommit $(_alf_sensitivity "${file_path}")" >&2
  else
    # Fail-closed: sidecar marker (atomic). The aggregate mirror reset cannot run without the
    # lock, but the marker alone holds every gate — stop-guard force-pins all gates (dual
    # included) closed while any sidecar reason stands, and the next committed edit transaction
    # performs the reset before clearing it.
    _set_own_sidecar "edit_lock_contention:${_EDIT_PLANE}" || true
    echo "[Edit Hook] Code change detected (degraded — lock contention, sidecar marker set): $file_path" >&2
    # The degraded branch owes a fact more than the committed one does: silence here reads as
    # "no edit happened" — the inverse of the truth.
    _alf_emit "event=code_edit change=code file=$(_alf_val "${file_path}")" \
      "$(_alf_common)" \
      "pending=code_review,precommit degraded=edit_lock_contention $(_alf_sensitivity "${file_path}")" >&2
  fi
fi

# Track doc changes (.md, .mdx)
#
# WB5b: same retirement as the code branch above — `has_doc_change`, `doc_review.passed = false`,
# the edit-epoch stamp and the background_reviews sweep are gone; the doc gate re-opens by
# derivation. What remains is the advisory tracking and the aggregate_gate mirror reset, which
# `invalidate_aggregate_gate` performs only when the mirror object exists — so this branch no
# longer creates the state file just to record an edit nothing reads.
if echo "$file_path" | grep -Eq '\.(md|mdx)$'; then
  if _lock; then
    _EDIT_HOLDS_LOCK=1
    _track_changed_file "$file_path" || true
    _track_session_touched_file "$file_path" || true
    invalidate_aggregate_gate
    # Same clear discipline as the code branch: only a fully-landed transaction, under ownership.
    if [[ "$_EDIT_WRITE_FAILED" -eq 0 ]] && _own_lock; then
      # `:doc` only — the code-plane copies stand for a lost CODE transaction this one cannot
      # supersede. The aggregate-plane markers belong here for the same reason as in the code
      # branch: this transaction resets `aggregate_gate` outright.
      _clear_superseded_sidecar \
        edit_lock_contention:doc state_write_failed:doc \
        lock_failure aggregate_write_failed
    fi
    _unlock
    _EDIT_HOLDS_LOCK=0
    echo "[Edit Hook] Doc change detected: $file_path" >&2
    echo "[Edit Hook] doc_review re-opens by derivation; aggregate_gate mirror reset" >&2
    # A doc edit does not touch the code plane, so `pending` names only its own gate.
    _alf_emit "event=doc_edit change=doc file=$(_alf_val "${file_path}")" \
      "$(_alf_common)" \
      "pending=doc_review" >&2
  else
    # Fail-closed: sidecar marker (atomic) — same contract as the code branch's degraded arm.
    _set_own_sidecar "edit_lock_contention:${_EDIT_PLANE}" || true
    echo "[Edit Hook] Doc change detected (degraded — lock contention, sidecar marker set): $file_path" >&2
    _alf_emit "event=doc_edit change=doc file=$(_alf_val "${file_path}")" \
      "$(_alf_common)" \
      "pending=doc_review degraded=edit_lock_contention" >&2
  fi
fi

# Track non-code/non-doc files for session commit scope (D-5)
# Covers .json, .yml, .toml, lockfiles etc. that aren't in the code/doc branches above.
# (Shell scripts sh/bash/zsh are now classified as code above, so they're excluded here.)
if ! echo "$file_path" | grep -Eq '\.(ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb|md|mdx)$'; then
  _track_session_touched_file "$file_path" || true
fi

exit 0
