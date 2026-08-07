#!/bin/bash -p
# smart-commit-execute.sh - runtime validation and read-back verification for
# /smart-commit --execute. This file IS the implementation; the reference doc
# describes it rather than carrying a second copy. The basename is namespaced
# because /install-scripts flattens every skill's scripts/ into one directory.
#
# Launch it as `/bin/bash -p -- <path>`. Both halves are load-bearing; why is
# execute-mode.md § "Why the entrypoint is spelled /bin/bash -p --".
#
# Subcommands, in the order the skill runs them:
#   alloc                                                  -> prints a fresh 0600 file
#   commit <msg-file> [--ai-co-author] [--sign|--no-sign]  -> commits AND verifies
#   verify-last [<commit-ish>] [--ai-co-author]            -> secondary check
#
# Exit status: 0 ok | 2 usage | 3 guard not found | 4 AI content or leak | 5 git commit
#              failed | 6 root/hooks unresolvable | 7 unverifiable | 8 (commit only) guard
#              could not evaluate — full table: execute-mode.md § How the skill drives it
#
# Rationale and threat model for every defence below:
# skills/smart-commit/references/execute-mode.md

# Privileged mode, ESTABLISHED rather than detected, before anything else runs. Same
# construction and the same reasons as scripts/run-skill.sh lines 5-70, where the
# derivation is written out: `case` is a reserved word and cannot be shadowed,
# `${x:?}` fails during expansion, and `-p` makes bash ignore imported functions.
case "${SD0X_PRIV_REEXEC:-}" in
  '')
    exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV 'SD0X_PRIV_REEXEC=1' \
      /bin/bash -p -- "${BASH_SOURCE[0]:-$0}" "$@"
    SD0X_PRIV_GUARD=''
    : "${SD0X_PRIV_GUARD:?smart-commit/execute: privileged re-exec did not take}"
    ;;
  *)
    # The sentinel is non-empty, meaning we skipped the exec above — the ONLY place that
    # strips SHELLOPTS/BASHOPTS. An EXPORTED SHELLOPTS/BASHOPTS here means the sentinel was
    # forged rather than earned, not merely re-exec'd: `SHELLOPTS=privileged` at invocation
    # sets a real lowercase `p` in `$-` without ever passing `-p`, indistinguishable from
    # genuine privileged mode by the `$-` check below alone — and bash imports an exported
    # function from that same forged environment. `smart-commit-inspect.sh` carried this
    # guard as its own round-19 P0; this file did not, and round 24 re-review reproduced the
    # identical bypass here (an exported function ran unchecked) while the same attack
    # against smart-commit-inspect.sh was refused. Full derivation: that file's preamble.
    #
    # The check itself must not call an external command: `grep` is PATH-resolved, and in
    # exactly the scenario this guard exists to catch (the re-exec above did NOT run, so
    # function-import-from-environment is still active) an attacker able to forge the
    # sentinel can equally export `PATH` or a `BASH_FUNC_grep%%` shell function and make the
    # pipe answer whatever they want (round 24 re-review, P0, reproduced against both files:
    # PATH-shadowed grep and an imported grep function both defeated the pipe). `builtin`
    # forces the `declare` call to the real builtin even if a `BASH_FUNC_declare%%` was
    # imported; `case` is a reserved word and untouchable by either vector.
    for SD0X_V in SHELLOPTS BASHOPTS; do
      SD0X_D=$(builtin declare -p "$SD0X_V" 2>/dev/null)
      SD0X_F=${SD0X_D#declare -}
      SD0X_F=${SD0X_F%% *}
      case $SD0X_F in
        *x*)
          SD0X_PRIV_GUARD=''
          : "${SD0X_PRIV_GUARD:?smart-commit/execute: cannot establish privileged mode}"
          ;;
      esac
    done
    unset -v SD0X_V SD0X_D SD0X_F
    ;;
esac
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?smart-commit/execute: cannot establish privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?smart-commit/execute: cannot establish privileged mode}" ;;
esac
unset SD0X_PRIV_REEXEC
# An inherited xtrace writes every expansion to stderr, commit message included.
set +x
set +v

set -u

# ONE environment policy for the whole process, applied once. As fenced bash this was
# a prefix each block re-derived, and splitting it is what made the validator and the
# commit disagree: strip these for `rev-parse` alone and the guard is resolved from
# the repository containing the current directory while the commit lands in whichever
# repository the variables select. Neither "always honour" nor "always strip" is
# unsafe on its own - the defect was answering the question twice. Being one process
# is what makes that structurally impossible now. `--execute` therefore operates on
# the repository containing the current directory; a caller who wants a different one
# changes directory. `GIT_INDEX_FILE` alone stages a different tree, which is why the
# list covers the index and object store and not just the root. ALLOW_AI_COAUTHOR is
# caller-settable, so it is stripped too and re-added only on the opt-in path.
# Not a claim of immunity to the environment at large - see git-environment.md § 1.
#
# THE LIST IS NOT HAND-PICKED. Everything `git rev-parse --local-env-vars` reports is in
# it, because hand-picking is what left the holes: an earlier version covered the root,
# index and object store and still missed GIT_GRAFT_FILE (redirects ancestry to an
# arbitrary file, so the info/grafts refusal below sees a clean repository while
# `rev-list` traverses rewritten parentage - measured: 2 new commits become 1) and
# GIT_CONFIG_PARAMETERS (injects arbitrary config for the whole process - measured:
# `git config user.email` returned an attacker-chosen address, which also reaches
# core.hooksPath and commit.gpgsign). A test asserts this list still covers everything
# that command names, so a future Git adding one fails loudly instead of silently.
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE GIT_CEILING_DIRECTORIES \
      GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS GIT_NOGLOB_PATHSPECS \
      GIT_LITERAL_PATHSPECS GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_CONFIG_NOSYSTEM \
      GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM \
      GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE GIT_SHALLOW_FILE GIT_PREFIX \
      GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE GIT_EXTERNAL_DIFF ALLOW_AI_COAUTHOR
CDPATH=''

# Ownership evidence for the post-commit check. `git commit` writes GIT_REFLOG_ACTION as the
# reflog entry's prefix, so a commit made by THIS invocation is identifiable afterwards - and
# one made by a concurrent process on the same branch is not, which is the whole point. Round
# 82 asserted no such evidence existed inside a single process and classified ownership by
# reachability from the observed HEAD; that was wrong, and it misattributed a concurrent
# branch advance as this operation's commit. Hooks INHERIT the marker, which is correct
# rather than a leak: a commit a hook makes because of this one belongs to this operation.
#
# Built from $$ and $RANDOM instead of /dev/urandom or a uuid command because the allowlist is
# `bash git mktemp rm` and widening it to generate a nonce would cost more than it buys.
# Unpredictability is not the property needed: forging this marker makes a foreign commit be
# reported as a leak (abort), and failing to match it makes a real leak be reported as
# UNVERIFIED (also abort). Both directions stop; only uniqueness matters, and PID plus three
# draws gives that. See execute-mode.md § Verifying what was recorded.
RUN_MARKER="sd0x-exec-$$-$RANDOM$RANDOM$RANDOM"

# Locate the dispatcher beside this file, without `dirname` - resolving the path must not
# reach for a command outside the allowlist that is about to be established. A symlinked
# start is refused rather than followed: the link names OUR file, but the sibling lookup
# below would then read the DISPATCHER out of the link's directory, which is someone
# else's. Resolving the chain instead would need `readlink`, widening the allowlist to
# close a hole that failing closed already closes.
SELF=${BASH_SOURCE[0]:-$0}
if [ -L "$SELF" ]; then
  printf 'smart-commit/execute: reached through a symlink - invoke the real path %s\n' \
    '(.claude/scripts/ or skills/smart-commit/scripts/)' >&2
  exit 2
fi
case "$SELF" in
  */*) SELF_DIR=${SELF%/*} ;;
  *)   SELF_DIR=. ;;
esac
DISPATCH="$SELF_DIR/smart-commit-dispatch.sh"
if [ ! -f "$DISPATCH" ] || [ -L "$DISPATCH" ]; then
  printf 'smart-commit/execute: smart-commit-dispatch.sh missing or not a regular file at %s\n' \
    "$DISPATCH" >&2
  exit 2
fi
. "$DISPATCH"

warn() { printf '%s\n' "$*" >&2; }

# Ownership of a temp file starts when the file starts being consumed and must survive a
# signal: SIGINT during the guard or during `git commit` would otherwise leave the full
# commit message on disk. The EXIT trap sweeps; the signal traps exist only to reach it.
# A successfully scrubbed path is disowned, so it costs the sweep nothing at all; only paths
# whose removal FAILED are still owned when the trap runs, and those are exactly the retries.
OWNED=()
own() { OWNED+=("$1"); }
# A failed removal is REPORTED, not swallowed. This used to clear OWNED and return 0 whatever
# happened, so a run whose commit succeeded exited 0 with the commit message still on disk -
# and `scrub` retaining the path for the trap to retry bought nothing, because the trap is the
# last retry there is. The exit STATUS stays whatever the command produced: a successful commit
# that could not delete a temp file did commit, and reporting failure would be the larger lie.
# The path is named on stderr so the leftover is actionable.
sweep_owned() {
  local f rc=0
  for f in ${OWNED[@]+"${OWNED[@]}"}; do
    if [ -n "$f" ] && ! sd_run rm -f -- "$f"; then
      warn "⚠️ could not remove $f - it still holds the commit message"
      rc=1
    fi
  done
  OWNED=()
  return "$rc"
}
trap sweep_owned EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# `&& printf .` then strip: command substitution eats trailing newlines, and a path
# may legitimately end in one. The `||` belongs on the substitution - the two strips
# are assignments and always succeed, so a guard placed after them can never fire.
repo_root() {
  local root
  root=$(sd_run git rev-parse --show-toplevel && printf .) || return 1
  root=${root%.}; root=${root%$'\n'}
  [ -n "$root" ] || return 1
  printf '%s' "$root"
}

# Resolve the canonical validator REPO-RELATIVE, and fail closed when neither path
# exists. No environment variable names it: an earlier draft searched
# ${CLAUDE_PLUGIN_ROOT}/scripts/commit-msg-guard.sh first, and CLAUDE_PLUGIN_ROOT
# pointing at a two-line `exit 0` script passes every message at both checks.
find_guard() {
  local root=$1 cand
  for cand in "$root/.claude/scripts/commit-msg-guard.sh" \
              "$root/scripts/commit-msg-guard.sh"; do
    if [ -f "$cand" ]; then printf '%s' "$cand"; return 0; fi
  done
  return 1
}

# `-p` is passed explicitly because the guard is handed to bash as an ARGUMENT, which
# bypasses its own `#!/bin/bash -p` shebang and would let $BASH_ENV run in its
# startup. `--` ends bash's options so $GUARD is always a path: a value of `-c` would
# otherwise turn this into `bash -p -c "$MSG_FILE"`, executing the commit message.
# ALLOW_AI_COAUTHOR is re-added inside a SUBSHELL, per call, and only when the flag was
# passed - it is never exported process-wide, so nothing this script runs sees it by
# default. That per-call scoping is the whole mechanism: the variable is stripped at the
# top of the file, so an inherited one cannot turn the opt-in on.
run_guard() {
  if [ "$AI_CO_AUTHOR" = 1 ]; then
    ( export ALLOW_AI_COAUTHOR=1; sd_run bash -p -- "$GUARD" "$1" )
  else
    sd_run bash -p -- "$GUARD" "$1"
  fi
}

# Populates the global HOOKS_OVERRIDE array, consumed by run_commit immediately after.
# Empty when core.hooksPath's effective scope is trusted (local/worktree — the
# repository's own committed choice — or genuinely unset); otherwise
# `-c core.hooksPath=<repo's own hooks dir>`, so `git commit` runs pre-commit/
# prepare-commit-msg/post-commit from the repository's own location regardless of what a
# non-local scope (including one reachable through HOME) names. Mirrors
# smart-commit-inspect.sh's `guard` trust boundary exactly, including the same fail-closed
# rule for a `--show-scope` failure that is not "key unset" (its exit 1) — old git without
# `--show-scope` support must not be read as "unset". Round 22 review, P1: the original
# fsmonitor-only pin left every hook OTHER than fsmonitor's own shell command reachable
# through this identical channel, unpinned.
resolve_hooks_override() {
  HOOKS_OVERRIDE=()
  local scope_line scope_word scope_rc common hooks_cfg
  scope_line=$(sd_run git -C "$ROOT" config --show-scope --get core.hooksPath 2>/dev/null)
  scope_rc=$?
  # Compared as a plain word, not the tab-delimited scope-and-value pair matched directly in
  # a case pattern — behaviourally identical (git's --show-scope output is always the scope
  # name, a tab, then the value), but keeps the pattern itself free of an ANSI-C-quoted
  # delimiter glued to a bare word.
  scope_word=${scope_line%%$'\t'*}
  case "$scope_word" in
    local|worktree) return 0 ;;
  esac
  [ "$scope_rc" -eq 1 ] && return 0
  common=$(sd_run git -C "$ROOT" rev-parse --git-common-dir && printf .) || {
    warn '⚠️ could not resolve the hooks path - aborting'
    return 1
  }
  common=${common%.}; common=${common%$'\n'}
  # Empty is not "root-relative" - repo_root() above refuses it for the same reason
  # (round 23 review, P2): falling through would build `core.hooksPath=/hooks`, a
  # path with no relation to this repository at all.
  [ -n "$common" ] || {
    warn '⚠️ could not resolve the hooks path - aborting'
    return 1
  }
  case "$common" in
    /*) ;;
    *) common="$ROOT/$common" ;;
  esac
  hooks_cfg="core.hooksPath=$common/hooks"
  # Two statements, not one `(-c "$hooks_cfg")` literal: the scanner treats an array literal's
  # content as one unsplit word only while it carries no unquoted whitespace of its own (matching
  # `OWNED+=("$1")` elsewhere in this file) — a `-c value` pair inside a single literal reintroduces
  # a word boundary the assignment-prefix peel does not expect, and its second word reads as a
  # command in its own right. Building the array incrementally keeps every assignment single-word.
  HOOKS_OVERRIDE=(-c)
  HOOKS_OVERRIDE+=("$hooks_cfg")
}

# Populates the global GPG_OVERRIDE array. Signing pulls its executable name from
# `gpg.program` (every format), `gpg.<format>.program` (openpgp/x509/ssh), and
# `gpg.ssh.defaultKeyCommand` (ssh format, only consulted when user.signingkey is
# unset) — every one names a binary, and every one is reachable through a non-local
# scope including HOME, with no `--sign` flag required: `commit.gpgsign=true` alone,
# set globally, is enough to make git run whatever `gpg.program` also names (round 23
# review, P0, reproduced end-to-end). Each key is checked and overridden independently
# of whether signing is even requested this run, matching `core.fsmonitor`'s
# unconditional pin below: a real local/worktree override (an operator's own committed
# choice of gpg wrapper) still runs; anything from a scope this process does not
# control is replaced with git's own built-in default, so signing - if it happens -
# runs the binary the operator actually has, not one an attacker named.
resolve_gpg_override() {
  GPG_OVERRIDE=()
  local key name default scope_line scope_word scope_rc
  for key in \
    'gpg.program:gpg' \
    'gpg.openpgp.program:gpg' \
    'gpg.x509.program:gpgsm' \
    'gpg.ssh.program:ssh-keygen' \
    'gpg.ssh.defaultKeyCommand:'
  do
    name=${key%%:*}; default=${key#*:}
    scope_line=$(sd_run git -C "$ROOT" config --show-scope --get "$name" 2>/dev/null)
    scope_rc=$?
    scope_word=${scope_line%%$'\t'*}
    case "$scope_word" in
      local|worktree) continue ;;
    esac
    # Same fail-closed rule as resolve_hooks_override: only `--get`'s documented
    # "key not found" exit (1) counts as genuinely unset and trusted; any other
    # non-local/worktree outcome - including the flag itself failing on old git -
    # is untrusted and gets overridden.
    [ "$scope_rc" -eq 1 ] && continue
    GPG_OVERRIDE+=(-c)
    GPG_OVERRIDE+=("$name=$default")
  done
}

# `git commit` gets the SAME per-call scoping, and it must: the canonical guard is also
# installed as the repository's commit-msg hook, and that hook reads ALLOW_AI_COAUTHOR to
# permit the one whitelisted line. Withholding it from `git commit` made --ai-co-author
# unusable wherever the recommended hook was installed - the hook rejected the exact line
# the flag exists to allow, and the commit failed with status 5. The subshell is what keeps
# the default path unaffected: without the flag, no hook ever sees the variable.
run_commit() {
  local msg_file=$1
  shift
  resolve_hooks_override || return 6
  if [ "${#HOOKS_OVERRIDE[@]}" -gt 0 ]; then
    warn "⚠️ core.hooksPath is configured outside this repository/worktree - ignoring it."
    warn "   Running hooks from ${HOOKS_OVERRIDE[1]#core.hooksPath=} instead."
  fi
  resolve_gpg_override
  # Same warning shape as core.hooksPath just above, and for the same reason (round 24
  # review, P1): resolve_hooks_override warns when it overrides, resolve_gpg_override did
  # not, and a silently substituted signer is a surprise the next debugging session pays
  # for (a developer who set gpg.program in their own $HOME sees git suddenly try a
  # different binary with no indication why).
  if [ "${#GPG_OVERRIDE[@]}" -gt 0 ]; then
    local gpg_kv gpg_name gpg_default
    # A plain `for … in "${ARR[@]}"` walk, not a C-style `((…))` counting loop: the
    # latter reads its counter variable as a bare word to the static oracle in
    # test/scripts/smart-commit-execute.test.js the same way an unrecognised construct
    # anywhere else in this file would (measured while wiring this warning's own test
    # coverage). GPG_OVERRIDE alternates `-c`, `key=default`, `-c`, `key=default`, …;
    # skipping the flag word with a single-pattern `case` is the same shape sd_allowlist
    # and the case-arm fix above both already use.
    for gpg_kv in "${GPG_OVERRIDE[@]}"; do
      case "$gpg_kv" in
        -c) continue ;;
      esac
      gpg_name=${gpg_kv%%=*}
      gpg_default=${gpg_kv#*=}
      warn "⚠️ $gpg_name is configured outside this repository/worktree - ignoring it."
      if [ -n "$gpg_default" ]; then
        warn "   Using $gpg_default instead."
      else
        warn "   Clearing it (no safe default exists) instead."
      fi
    done
  fi
  # GIT_REFLOG_ACTION is set HERE and nowhere else, so the marker cannot end up on a read-back
  # command and be mistaken for evidence. Exported in a subshell, so the surrounding process
  # environment stays clean for every other git call.
  #
  # `-c core.fsmonitor=false`: `commit` (even without `-a`) can run a configured fsmonitor
  # hook — a shell command there is arbitrary command execution, empirically confirmed, and
  # reachable from any config scope this process does not control, including one through
  # HOME (round 21 review, P1). Pinning `false` on the command line always outranks a
  # lower-scoped value, closing that one knob regardless of which scope carried it.
  #
  # `-c core.attributesFile=/dev/null`: a SEPARATE knob the same HOME reaches (round 22
  # review) — closes the assignment half of the filter channel. The command half (what a
  # filter/textconv/merge driver named by the repository's OWN tracked `.gitattributes`
  # actually runs) is a distinct exposure the pin does not touch at all - see
  # refuse_on_untrusted_content_drivers, which cmd_commit runs before this function.
  #
  # "${HOOKS_OVERRIDE[@]}" / "${GPG_OVERRIDE[@]}": see resolve_hooks_override and
  # resolve_gpg_override above, both called just before this.
  if [ "$AI_CO_AUTHOR" = 1 ]; then
    ( export ALLOW_AI_COAUTHOR=1 GIT_REFLOG_ACTION="$RUN_MARKER"
      sd_run git -c core.fsmonitor=false -c core.attributesFile=/dev/null \
        ${HOOKS_OVERRIDE[@]+"${HOOKS_OVERRIDE[@]}"} ${GPG_OVERRIDE[@]+"${GPG_OVERRIDE[@]}"} \
        -C "$ROOT" commit "$@" -F "$msg_file" )
  else
    ( export GIT_REFLOG_ACTION="$RUN_MARKER"
      sd_run git -c core.fsmonitor=false -c core.attributesFile=/dev/null \
        ${HOOKS_OVERRIDE[@]+"${HOOKS_OVERRIDE[@]}"} ${GPG_OVERRIDE[@]+"${GPG_OVERRIDE[@]}"} \
        -C "$ROOT" commit "$@" -F "$msg_file" )
  fi
}

# Every OID this invocation created, newline-delimited. Evidence is the reflog entry git wrote
# when it made the commit, prefixed with our per-run marker.
#
#   0 - the reflog was read (an empty list is a legitimate answer)
#   2 - the reflog could not be read at all
#
# Read ONCE per verification, never once per commit. The per-commit form spawned a `git reflog`
# and rescanned every record for each newly reachable commit: with N commits introduced and R
# reflog records that is N subprocesses over N x R records, and the concurrent-fetch path this
# script deliberately supports can introduce thousands of commits at a time.
#
# `git reflog` reads HEAD's log, which `git commit` appends to whether the branch is checked out
# or HEAD is detached - measured for both, and for an initial commit on an unborn branch. It is
# NOT a record of everything a hook may create: a hook that builds an object with `commit-tree`
# and points a ref at it with `update-ref`, or that commits in another worktree, never touches
# this HEAD reflog. Such a commit is therefore unattributed and reported UNVERIFIED, not as a
# leak - the marker attributes what `git commit` recorded here, not everything a hook did.
marked_oids() {
  local log h msg
  # `--no-show-signature` (round 24 review, P0): `git reflog` is log-family and, with an
  # attacker-reachable `log.showSignature=true` (HOME), invokes `gpg.program` even though
  # this format requests neither `%G?` nor any signature text - reproduced end-to-end
  # against a HOME-configured gpg.program that touched a marker file on every reflog read.
  log=$(git_verify reflog --no-show-signature --format='%H %gs') || return 2
  while IFS=' ' read -r h msg; do
    case "$msg" in "$RUN_MARKER:"*) printf '%s\n' "$h" ;; esac
  done <<<"$log"
  return 0
}

# Every READ-BACK goes through here, so no verification path can forget the flag.
# `--no-replace-objects`: git's object reads are replace-aware by default, so a
# post-commit hook that builds a clean commit object and runs
# `git replace <recorded-oid> <clean-oid>` makes `git log <recorded-oid>` return the
# CLEAN message while the attribution-bearing commit is what actually gets pushed - the
# replacement ref is local and does not travel. Reproduced; without the flag the read
# returns the substitute. A flag rather than GIT_NO_REPLACE_OBJECTS on purpose: this
# script's whole contract is that no environment variable selects what policy sees.
# The verification reads are a CLOSED set, refused here at runtime rather than pinned in a
# test. `git_verify "$@"` forwarded anything, and git's GLOBAL options are the ones that
# carry executable configuration - `-c alias.x='!cmd'` runs a shell command - so an operand
# in first position decided what git did. Global options must precede the subcommand, so
# requiring a subcommand THERE removes the position they need. Same reasoning as sd_run's
# allowlist, and the same reason it is a refusal rather than a claim: a test can assert it.
# Written as a `for` over a word list rather than a `case` pattern list on purpose: an
# alternation arm (`reflog|log|...)`) puts each alternative where the segment recognizer reads
# a command position, so the subcommand names would arrive as command tokens and have to be
# admitted to the permitted set as if they were programs. Same shape as sd_allowlist, which is
# the function this one is modelled on anyway.
git_verify() {
  local sub=${1:-} name found=''
  for name in reflog log for-each-ref rev-parse symbolic-ref rev-list; do
    if [ "$name" = "$sub" ]; then found=1; break; fi
  done
  if [ -z "$found" ]; then
    warn "git_verify: refusing '$sub' - not a permitted verification read"
    return 127
  fi
  sd_run git --no-replace-objects -C "$ROOT" "$@"
}

# Drop a pathname from the sweep set once it is genuinely gone. Without this, every file
# is unlinked twice - once here, once by the EXIT trap - and `rm -f` is not idempotent
# with respect to pathname REUSE: between the two, another process can create a new file
# at the same path and the sweep deletes that one instead. A path is retained only when
# removal FAILED, which is exactly when the trap should retry it.
disown_path() {
  local keep=() f
  for f in ${OWNED[@]+"${OWNED[@]}"}; do
    [ "$f" = "$1" ] || keep+=("$f")
  done
  OWNED=(${keep[@]+"${keep[@]}"})
}

scrub() {
  if sd_run rm -f -- "$1"; then
    disown_path "$1"
  else
    warn "⚠️ could not remove $1 - it still holds the commit message"
  fi
}

# `mktemp` creates the file atomically, unpredictably named, mode 0600. `--` ends its
# options so the template can never be read as one: TMPDIR is inherited input and the
# expansion sits at the front of the word, so TMPDIR=-d would otherwise make the
# argument `-d/smart-commit-msg.XXXXXX`. A fixed path instead would collide between
# concurrent runs and could be pre-created as a symlink or world-readable.
cmd_alloc() {
  sd_run mktemp -- "${TMPDIR:-/tmp}/smart-commit-msg.XXXXXX"
}

# Verify what was RECORDED. `commit` validated a file; a commit-msg hook may rewrite the
# message afterwards, so the two are not the same artifact.
verify_one() {
  local target=$1 logfile
  logfile=$(sd_run mktemp -- "${TMPDIR:-/tmp}/smart-commit-log.XXXXXX") || return 7
  own "$logfile"
  # Both failures below leave an EMPTY file, which the guard reads as a clean message: the
  # check would then report on a commit it never actually read. A commit message is never
  # legitimately empty, so emptiness is treated as unverified.
  #
  # `--no-show-signature` (round 24 review, P0): same channel as marked_oids above - this
  # read-back asks only for `%B`, but a HOME-reachable `log.showSignature=true` makes plain
  # `git log` run `gpg.program` anyway. Reproduced against `verify-last`, which reaches this
  # function directly with no `git commit` in between.
  if ! git_verify log -1 --no-show-signature --format='%B' "$target" > "$logfile"; then
    scrub "$logfile"
    warn "❌ could not read the message of $target back - UNVERIFIED. Stop here."
    return 7
  fi
  if [ ! -s "$logfile" ]; then
    scrub "$logfile"
    warn "❌ message of $target read back empty - UNVERIFIED. Stop here."
    return 7
  fi
  # Same guard-status contract as cmd_commit: only its status 1 is a content
  # verdict. Anything else nonzero means the guard never answered, and this
  # function's own UNVERIFIED convention (7) already says exactly that.
  local guard_rc=0
  run_guard "$logfile" || guard_rc=$?
  scrub "$logfile"
  case "$guard_rc" in
    0) return 0 ;;
    1)
      warn "❌ AI attribution leaked in commit $target. Remaining commit groups ABORTED."
      return 4
      ;;
    *)
      warn "❌ the guard could not evaluate the policy on $target (status $guard_rc) - UNVERIFIED. Stop here."
      return 7
      ;;
  esac
}

# Every tip that can reach a commit: all refs, plus HEAD (detached HEAD is in no ref).
# Snapshotting the whole ref space rather than HEAD alone is what makes the check
# independent of WHERE a hook decided to leave things.
#
# FAILS LOUDLY. A degraded snapshot narrows silently to HEAD alone - precisely the blind
# spot the ref-space snapshot exists to close - so an unreadable ref space returns non-zero
# and aborts the caller. An unborn HEAD (a repository with no commits yet) is legitimate,
# and is told apart from an unreadable one by `symbolic-ref`, which is sufficient on its own -
# see the measurement recorded at the call site below.
#
# No namespace is excluded. An earlier version skipped refs/remotes/ to stop a concurrent
# `git fetch` being blamed on this commit; that filter was on the wrong axis, since a fetch
# auto-follows tags and the new refs/tags/ tip walks straight back in. Ownership is decided
# in verify_created by THIS RUN'S REFLOG MARKER, which does not depend on where a ref lives -
# nor on the commit still being reachable, which is what the earlier reachability wording said.
snapshot_tips() {
  local refs head ref oid out=''
  refs=$(git_verify for-each-ref --format='%(refname) %(objectname)') || return 1
  while IFS=' ' read -r ref oid; do
    [ -n "$oid" ] || continue
    out="$out$oid
"
  done <<<"$refs"
  if head=$(git_verify rev-parse --verify --quiet HEAD); then
    printf '%s%s\n' "$out" "$head"
    return 0
  fi
  # HEAD did not resolve. Legitimate ONLY in an unborn branch - a fresh repository, or
  # `checkout --orphan` in an established one, which is why "no refs at all" would be the
  # wrong test. `symbolic-ref` IS the discriminator here, and that is measured rather than
  # assumed: with HEAD pointing at a malformed ref it exits 128 (`fatal: No such ref: HEAD`),
  # while `for-each-ref` merely warns and exits 0 - so this line, not the ref listing, is what
  # refuses a corrupt repository. The neighbouring case needs no branch at all: a ref naming a
  # well-formed but MISSING object leaves HEAD resolving normally, so control never arrives
  # here and the traversal covers it. Checks were written for both and removed again once no
  # fixture could make either matter; defensive code that cannot be made to fire is not a
  # control, it is unverifiable surface.
  git_verify symbolic-ref -q HEAD >/dev/null || return 1
  printf '%s' "$out"
  return 0
}

# Two on-disk overlays rewrite what `rev-list` treats as already reachable, and neither is
# covered by `--no-replace-objects`:
#   info/grafts - rewrites parentage outright
#   shallow     - every OID listed becomes a traversal ROOT, so its ancestry is not walked
# Both are refused rather than trusted, on the way in AND again after `git commit`, because a
# post-commit hook runs in between and can install either in that window.
#
# The shallow half was nearly missed on a bad measurement: writing a commit's PARENT into
# .git/shallow changes nothing, which reads as "shallow is inert here". Writing the commit
# ITSELF is the masking move - `rev-list --count HEAD` drops from 3 to 1 - because the listed
# commit becomes a root and everything under it disappears. The first experiment tested the
# wrong OID, and the conclusion drawn from it was wrong.
#
# resolve_git_path exists because `--git-path` returns a path relative to the REPOSITORY, and
# `[ -s ... ]` resolves it against the SHELL's directory. Launched from repo/subdir, the check
# looked at repo/subdir/.git/info/grafts - a path that does not exist - and passed, while every
# traversal used the real one. Absent file, clean verdict, masked ancestry.
# Written with a prefix strip rather than `case "$p" in /*)` on purpose: a `/*` case pattern
# reads as an absolute command path to the static call-site oracle, and teaching that oracle
# about case patterns is more fragile than not writing one here.
resolve_git_path() {
  local p
  p=$(git_verify rev-parse --git-path "$1") || return 1
  if [ "${p#/}" != "$p" ]; then
    printf '%s\n' "$p"
  else
    printf '%s/%s\n' "$ROOT" "$p"
  fi
}

refuse_on_ancestry_overlays() {
  local graft shallow
  graft=$(resolve_git_path info/grafts) || {
    warn '❌ could not resolve the graft file path - UNVERIFIED. Stop here.'
    return 7
  }
  if [ -s "$graft" ]; then
    warn "❌ $graft exists - commit ancestry is overridden locally and verification cannot be trusted."
    warn '   Remove it (grafts are deprecated; replace refs are neutralized, grafts are refused) and retry.'
    return 7
  fi
  shallow=$(resolve_git_path shallow) || {
    warn '❌ could not resolve the shallow file path - UNVERIFIED. Stop here.'
    return 7
  }
  if [ -s "$shallow" ]; then
    warn "❌ $shallow is non-empty - every commit listed there is a traversal root, so ancestry"
    warn '   below it is not walked and a leaking parent would go unread. UNVERIFIED. Stop here.'
    warn '   A shallow clone cannot be verified by this script; commit from a full clone.'
    return 7
  fi
  return 0
}

# Refuses to commit when the repository's OWN tracked `.gitattributes` names a filter
# driver whose actual command comes from a scope this process does not control.
# `core.attributesFile=/dev/null` (run_commit) only blocks an ATTACKER-NAMED driver
# assignment; a driver the repository itself opts into (e.g. `* filter=lfs`, the
# git-lfs shape) still resolves its command through ordinary config lookup, and
# nothing stops that command living in a non-local scope reachable through HOME
# (round 23 review, P0 - reproduced against `filter.<name>.clean` on a plain commit
# with content already staged). This REFUSES rather than overrides: unlike
# core.hooksPath there is no universal safe substitute for a filter command - git-lfs's
# clean filter IS the intended behaviour - so silently disabling one risks committing
# content the driver exists to transform, a data-integrity defect stacked on the
# security one.
#
# `filter` only, not `diff`/`merge` (round 24 review, P1): `git commit` never invokes
# `diff.<n>.textconv` or `merge.<n>.driver` - those run for `git diff` and for resolving
# a merge conflict, neither of which `commit` performs - so checking them here only ever
# produced a false refusal (measured: a global textconv-only config with no filter
# attribute in play blocked a commit that never touched it). `filter.<n>.clean/smudge/
# process` is the one family a prior `git add`/`git commit -a` on this content could
# actually have reached, and is what stays checked. `smart-commit-inspect.sh`'s copy of
# this function keeps all three - its `diff`/`status`/`collect` subcommands can genuinely
# trigger textconv, unlike this one.
refuse_on_untrusted_content_drivers() {
  local attrfile ppath pattr pvalue seen key suffix scope_line scope_word scope_rc
  local -a rc
  attrfile=$(sd_run mktemp -- "${TMPDIR:-/tmp}/smart-commit-attr.XXXXXX") || {
    warn '⚠️ could not allocate a scratch file for the attribute check - aborting'
    return 1
  }
  own "$attrfile"
  # NUL-delimited throughout, and never through `$( )`: bash command substitution
  # silently deletes embedded NUL bytes rather than stopping at the first one, which
  # would merge every path/attribute/value into one unparseable run. The scratch file
  # is what lets the pipe's actual result be checked (`> "$attrfile"` fails loudly)
  # instead of masking a `check-attr` failure behind whatever partial bytes a pipe
  # into a `while read` loop happened to deliver.
  # Stage 1 (`ls-files`) carries only `core.fsmonitor=false`: it does not read blob content
  # (`--cached` is filename enumeration), so `attributesFile` has nothing to affect there.
  # Stage 2 (`check-attr`) carries both — it is what actually resolves gitattributes, and an
  # unpinned call here would also pick up the ATTACKER's `core.attributesFile` (if any) as if
  # it were the repository's own, reporting a false refusal for a channel `-c
  # core.attributesFile=/dev/null` on the real commit already closes (round 24 re-review, P2 —
  # this comment previously claimed both calls carried both pins, which stage 1's own line
  # below never did).
  # Enumerated via `ls-files --cached` (the FULL tracked set), not `diff --cached --name-only`
  # (round 24 review's own P0, found by re-review of this very round: `git commit` refreshes
  # every tracked index entry that needs it, not only the staged ones, so `filter.<n>.clean`
  # can run on a tracked path this commit never staged — reproduced 10/10 with a plain
  # git-lfs shape where only an unrelated file was staged). Untracked paths are outside the
  # index `git commit` touches, so `--others` is correctly omitted here (unlike
  # `smart-commit-inspect.sh`'s copy, whose `status`/`diff` subcommands can report on them).
  sd_run git -c core.fsmonitor=false -C "$ROOT" ls-files -z --cached |
    sd_run git -c core.fsmonitor=false -c core.attributesFile=/dev/null \
      -C "$ROOT" check-attr filter -z --stdin > "$attrfile" 2>/dev/null
  # Both pipeline stages checked (round 24 review, P1): `if ! cmd1 | cmd2; then` reads
  # only cmd2's exit status, so a failing `ls-files` (an unreadable index, a corrupt ref)
  # left an EMPTY scratch file and this function read that as "no drivers found" and
  # returned 0 — reproduced: a failing first stage let the commit through as if the tree
  # carried no attributes at all.
  rc=("${PIPESTATUS[@]}")
  if [ "${rc[0]}" -ne 0 ] || [ "${rc[1]}" -ne 0 ]; then
    scrub "$attrfile"
    warn '⚠️ could not resolve gitattributes for tracked paths - aborting'
    return 1
  fi
  seen=$'\n'
  while IFS= read -r -d '' ppath && IFS= read -r -d '' pattr && IFS= read -r -d '' pvalue; do
    case "$pvalue" in
      '') continue ;;
      unset) continue ;;
      unspecified) continue ;;
    esac
    case "$seen" in *$'\n'"$pvalue"$'\n'*) continue ;; esac
    seen="$seen$pvalue"$'\n'
    # `for suffix in …; do key=…` rather than building a `keys` array: the array-append
    # scanner defeat this file's own tests caught before (a single `+=(a b c)` line, or
    # even a plain `keys=(a b c)` assignment, reads its 2nd/3rd word as a bare command to
    # the static oracle - the array-assignment prefix is only recognised on the FIRST
    # word) has no foothold in a `for … in word list; do` loop, which git_verify above
    # already uses for the identical reason.
    for suffix in clean smudge process; do
      key="filter.$pvalue.$suffix"
      scope_line=$(sd_run git -C "$ROOT" config --show-scope --get "$key" 2>/dev/null)
      scope_rc=$?
      scope_word=${scope_line%%$'\t'*}
      case "$scope_word" in local|worktree) continue ;; esac
      [ "$scope_rc" -eq 1 ] && continue
      warn "❌ $key is configured outside this repository/worktree (reachable through HOME)"
      warn "   but is named by this repository's own .gitattributes - refusing to commit"
      warn '   rather than run it, or silently disable it and risk uncommitted transforms.'
      warn "   If legitimate, move it to local scope: git config --local $key <command>"
      scrub "$attrfile"
      return 1
    done
  done < "$attrfile"
  scrub "$attrfile"
  return 0
}

# Everything the operation made NEWLY REACHABLE across the ref space - not "the range from the
# old HEAD to the new one", and not "whatever is at the tip now": a post-commit hook can stack
# a clean commit on top of the leaking one, or park the leaking one on a side ref and rebuild
# the branch from its parent. Both were reproduced; both defeat a HEAD-anchored range.
#
# Newly reachable is NOT the same question as "made by this operation", and the split below is
# the whole point. It is decided by the REFLOG MARKER, not by reachability from the new HEAD:
# an earlier revision used reachability, and it is wrong in both directions - a hook can park
# this run's leaking commit off HEAD entirely, and a concurrent commit is reachable from HEAD
# without being ours. A trailer on a marked OID is a LEAK (4). A trailer on an unmarked one
# appeared in the window - a fetch, another terminal, a hook using commit-tree - and this
# process cannot say whose it is, so it is UNVERIFIED (7) naming the OID. Both fail closed;
# only 4 says "your commit leaked", and saying that when it is untrue is how a check gets
# switched off.
#
# What this does NOT bound is object CREATION - "pushable implies ref-reachable" is false, and
# an earlier version of this comment asserted it. Derivation, the measurements behind each
# claim, and the full boundary: execute-mode.md § Verifying what was recorded and
# § What this cannot do.
verify_created() {
  local before_tips=$1 after_tips=$2 head=$3 args=() all mine oid rc status=0
  # $head is a positive tip in its OWN right. It was read before the snapshot, and between
  # those two reads another process can move the branch to a new clean commit: the snapshot
  # then no longer mentions the commit just made, `all` is built without it, and it is never
  # read back at all - a status 0 for an OID this process had already seen. Carrying it
  # forward closes that interleaving. No "no tips" branch is needed here: the caller only
  # reaches this after `rev-parse --verify HEAD` succeeded, so this list is never empty, and
  # a guard that cannot fire is not a guard.
  args=("$head")
  for oid in $after_tips; do args+=("$oid"); done
  args+=(--not)
  for oid in $before_tips; do args+=("$oid"); done

  # `--no-show-signature` for the same reason as marked_oids/verify_one above, applied here
  # too as defense-in-depth: measured harmless either way (`rev-list` without a `%`-format
  # does not invoke gpg.program even under `log.showSignature=true`), but the flag costs
  # nothing and keeps every git_verify log-family call in this file under the same rule
  # rather than three call sites disagreeing on which ones need it.
  all=$(git_verify rev-list --no-show-signature "${args[@]}") || return 7
  if [ -z "$all" ]; then
    warn '❌ no commit was introduced - UNVERIFIED. Stop here.'
    return 7
  fi

  # Ownership is decided by the reflog marker, NOT by reachability from the observed HEAD.
  # Reachability was the round-82 answer and it is wrong in a way that matters: a process that
  # advances the checked-out branch between this script's `git commit` and its HEAD read
  # produces a commit that IS reachable from the HEAD actually observed and is absent from
  # before_tips, so reachability blamed this operation for someone else's commit - a status 4,
  # whose recovery guidance is "amend it", pointed at a commit that must not be amended.
  # Anything not provably ours falls through to UNVERIFIED, which is the fail-closed side:
  # a real leak still stops the run, it just stops as "inspect this OID" rather than as
  # "this commit leaked".
  #
  # One read, before the loop. `mine` is empty when the reflog is unreadable, which is the
  # fail-closed side: nothing is provably ours, so any trailer below reports UNVERIFIED rather
  # than asserting a leak. Said out loud, because a silent empty set and a genuinely quiet run
  # look identical in the output.
  mine=$(marked_oids) || {
    mine=''
    warn '⚠ the reflog could not be read - no commit can be attributed to this invocation.'
    warn '  A trailer found below is reported as UNVERIFIED rather than as a leak.'
  }

  for oid in $all; do
    # Full 40+ hex OIDs delimited by newlines: one cannot be a substring of another unless they
    # are equal, so plain containment is an exact set-membership test here.
    case "
$mine
" in
      *"
$oid
"*)
      verify_one "$oid" || return $? ;;
      *)
      # Output suppressed: verify_one's own wording is a leak verdict against THIS commit,
      # which is exactly the attribution not being claimed here.
      verify_one "$oid" >/dev/null 2>&1
      rc=$?
      case "$rc" in
        0) ;;
        4) warn "❌ $oid became reachable during this commit and carries AI attribution, but"
           warn '   no reflog entry ties it to THIS invocation - a concurrent commit on the'
           warn '   same branch, a fetch, and a hook parking a commit all look like this.'
           warn '   UNVERIFIED: inspect it before amending anything, then re-run verify-last.'
           status=7 ;;
        *) warn "❌ $oid became reachable during this commit and could not be read back."
           warn '   UNVERIFIED. Stop here.'
           status=7 ;;
      esac ;;
    esac
  done
  return "$status"
}

cmd_commit() {
  local msg_file=$1 arg
  shift
  AI_CO_AUTHOR=0
  local sign_args=() sign_seen=''
  for arg in "$@"; do
    case "$arg" in
      --ai-co-author) AI_CO_AUTHOR=1 ;;
      --sign)
        [ -z "$sign_seen" ] || { warn '--sign and --no-sign are mutually exclusive'; return 2; }
        sign_seen=1; sign_args=(-S) ;;
      --no-sign)
        [ -z "$sign_seen" ] || { warn '--sign and --no-sign are mutually exclusive'; return 2; }
        sign_seen=1; sign_args=(--no-gpg-sign) ;;
      *) warn "unknown option: $arg"; return 2 ;;
    esac
  done
  if [ ! -f "$msg_file" ]; then
    warn "❌ message file not found: $msg_file"
    return 2
  fi
  # Ownership starts HERE, not at the top: a usage error above returns before the file is
  # consumed and deliberately leaves it for the caller to reuse without re-allocating.
  own "$msg_file"

  # Cleanup FIRST on every abort, diagnostic second: what would be left behind here is
  # the full commit message on disk.
  ROOT=$(repo_root) || {
    scrub "$msg_file"
    warn '⚠️ could not resolve the repository root - aborting'
    return 6
  }
  GUARD=$(find_guard "$ROOT") || {
    scrub "$msg_file"
    warn '❌ commit-msg-guard.sh not found - cannot validate. Run /install-scripts commit-msg-guard'
    return 3
  }

  # The guard's exit codes are a contract (see its header): 1 is a content
  # verdict, 3 is "the policy could not be evaluated" — an environment problem.
  # Collapsing both into 4 made an unwritable TMPDIR read as an AI-content leak;
  # anything that is neither 0 nor 1 maps to 8 (UNVERIFIED), and unknown codes
  # land there too, because an unrecognized status is by definition not a verdict.
  local guard_rc=0
  run_guard "$msg_file" || guard_rc=$?
  if [ "$guard_rc" -eq 1 ]; then
    scrub "$msg_file"
    warn '❌ AI content detected after sanitization - aborting commit'
    return 4
  elif [ "$guard_rc" -ne 0 ]; then
    scrub "$msg_file"
    warn "❌ the guard could not evaluate the policy (status $guard_rc) - environment"
    warn '   failure, not a content verdict. Nothing was committed - UNVERIFIED.'
    return 8
  fi

  refuse_on_ancestry_overlays || { scrub "$msg_file"; return 7; }
  refuse_on_untrusted_content_drivers || { scrub "$msg_file"; return 7; }

  # The whole ref space before committing, plus HEAD. Empty in an unborn repository, which
  # is not an error - unreadable is, and both call sites test for it.
  local before_tips after_tips before after status commit_rc
  before_tips=$(snapshot_tips) || {
    scrub "$msg_file"
    warn '❌ could not read the ref space before committing - UNVERIFIED. Nothing was committed.'
    return 7
  }
  before=$(git_verify rev-parse --verify --quiet HEAD) || before=''
  run_commit "$msg_file" ${sign_args[@]+"${sign_args[@]}"}
  commit_rc=$?
  # 6 is run_commit's own signal that resolution failed BEFORE git ever ran (hooks path
  # unresolvable) - reusing the same code repo_root uses above for the same reason: no
  # commit was attempted, so reporting 5 ("git commit failed") would blame git for a
  # failure it never had the chance to have.
  case "$commit_rc" in
    0) status=0 ;;
    6) status=6 ;;
    *) status=5 ;;
  esac
  scrub "$msg_file"
  [ "$status" -eq 0 ] || return "$status"

  # Post-commit detection runs HERE, in the same process, against everything this call made
  # reachable. Deferring it to a later `verify-last` reads whatever is at the tip by then,
  # which a post-commit hook controls. Residual, stated rather than claimed away: the guard
  # and `git` each open the message file, so a same-user process could swap it in between -
  # mktemp's unpredictable name and 0600 mode make that impractical, and this check is what
  # catches it if it happens.
  after=$(git_verify rev-parse --verify HEAD) || {
    warn '❌ could not read HEAD back after committing - UNVERIFIED. Stop here.'
    return 7
  }
  if [ "$after" = "$before" ]; then
    warn '❌ git commit reported success but HEAD did not move - UNVERIFIED. Stop here.'
    return 7
  fi
  # The graft refusal AGAIN. The first one ran before `git commit`; the post-commit hook ran
  # in between and can install a graft that rewrites parentage under the traversal below,
  # masking the very commit it just made. Checking only on the way in leaves that window open.
  refuse_on_ancestry_overlays || return 7
  after_tips=$(snapshot_tips) || {
    warn '❌ could not read the ref space back after committing - UNVERIFIED. Stop here.'
    return 7
  }
  verify_created "$before_tips" "$after_tips" "$after"
}

# A SECONDARY check for the skill's Step 6 convergence pass. The commit path already
# verified what it created; this re-checks a nominated commit (HEAD by default), which is
# useful when something outside `--execute` may have touched history.
cmd_verify_last() {
  local arg target=HEAD target_seen=''
  AI_CO_AUTHOR=0
  for arg in "$@"; do
    case "$arg" in
      --ai-co-author) AI_CO_AUTHOR=1 ;;
      -*) warn "unknown option: $arg"; return 2 ;;
      # A second operand used to overwrite the first SILENTLY, so
      # `verify-last <leaking-oid> <clean-oid>` verified only the clean one and returned 0.
      # A verifier that quietly checks something other than what it was given is worse than
      # one that refuses.
      *)
        [ -z "$target_seen" ] || {
          warn "verify-last takes at most one commit-ish; got a second: $arg"
          return 2
        }
        target_seen=1; target=$arg ;;
    esac
  done

  ROOT=$(repo_root) || { warn '⚠️ could not resolve the repository root - aborting'; return 6; }
  GUARD=$(find_guard "$ROOT") || {
    warn '❌ commit-msg-guard.sh not found - the commit is UNVERIFIED. Stop here.'
    return 3
  }
  verify_one "$target"
}

usage() {
  warn 'usage: smart-commit-execute.sh alloc'
  warn '       smart-commit-execute.sh commit <msg-file> [--ai-co-author] [--sign|--no-sign]'
  warn '       smart-commit-execute.sh verify-last [<commit-ish>] [--ai-co-author]'
}

case "${1:-}" in
  # `alloc` takes no operands. Accepting them silently created the file and exited 0 for a
  # misspelled flag, so a caller who meant something else got an unconsumed temp file back
  # and no signal that their call was wrong.
  alloc)       shift; if [ "$#" -ne 0 ]; then usage; exit 2; fi; cmd_alloc ;;
  commit)
    shift
    if [ "$#" -lt 1 ]; then usage; exit 2; fi
    cmd_commit "$@"
    ;;
  verify-last) shift; cmd_verify_last "$@" ;;
  *)           usage; exit 2 ;;
esac
