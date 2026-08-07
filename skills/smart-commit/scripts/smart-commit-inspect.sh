#!/bin/bash -p
# smart-commit-inspect.sh - the read-only diagnostics /smart-commit runs before it plans
# anything: commit style, identity, signing, the AI guard, and the change set.
#
#   /bin/bash -p -- <path-to-this-script> <subcommand> [args...]
#
# The caller resolves that path repo-relative, installed copy first
# ($REPO_ROOT/.claude/scripts/, then $REPO_ROOT/skills/smart-commit/scripts/) — the same
# two-step locator smart-commit-execute.sh is reached by, and for the same reason: no
# variable may name the thing that answers a policy question.
#
# WHY THIS IS A SCRIPT AND NOT A FENCE: every command below must run with the inherited
# GIT_* environment stripped, or a diagnostic answers about a different repository than
# the one the commit targets. Written out in Markdown that policy is a 496-byte prefix
# repeated at every call site; established here it is one `unset` block the whole file
# inherits, and one a test can assert. Same move `--execute` made first.
#
# Policy derivation and the exact variable list:
# skills/smart-commit/references/git-environment.md § 1.
# It is NOT reached through scripts/run-skill.sh: in a consuming project the runner resolves
# its plugin root from its own location, where this script does not live.

# Privileged mode, ESTABLISHED rather than detected — the shebang above does not cover the
# documented launch path. Threat model, measurement and why the shebang is not enough:
# docs/features/smart-commit-hardening/4-implementation.md § 8. Oracle: `P18`.
case "${SD0X_PRIV_REEXEC:-}" in
  '')
    exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV 'SD0X_PRIV_REEXEC=1' \
      /bin/bash -p -- "${BASH_SOURCE[0]:-$0}" "$@"
    SD0X_PRIV_GUARD=''
    : "${SD0X_PRIV_GUARD:?smart-commit/inspect: privileged re-exec did not take}"
    ;;
  *)
    # The sentinel is non-empty, meaning we skipped the exec above — the ONLY place that strips
    # SHELLOPTS/BASHOPTS. A legitimately re-exec'd child can never see either AS ENVIRONMENT
    # variables: `env -u` removes them before the child starts, and bash always redefines both
    # internally regardless (they reflect the shell's OWN current options), so checking mere
    # presence (`${SHELLOPTS+x}`) cannot tell the two apart — every bash process has them set.
    # What differs is the EXPORT attribute: bash marks a name `-x` only when it actually came
    # from the process environment, never for its own internal reflection (measured on both
    # bash 3.2 and 5.3: plain `declare -p SHELLOPTS` → `-r`; `env SHELLOPTS=... bash` → `-rx`).
    # An exported SHELLOPTS/BASHOPTS here means the sentinel was forged rather than earned:
    # `SHELLOPTS=privileged` at invocation sets a REAL lowercase `p` in `$-` (`set -o privileged`
    # is a settable option, not exclusive to launch-time `-p`) without ever passing `-p` on a
    # command line — indistinguishable from genuine privileged mode by the `$-` check below
    # alone. Round 19 review, P0.
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
          : "${SD0X_PRIV_GUARD:?smart-commit/inspect: cannot establish privileged mode}"
          ;;
      esac
    done
    unset -v SD0X_V SD0X_D SD0X_F
    ;;
esac
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?smart-commit/inspect: cannot establish privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?smart-commit/inspect: cannot establish privileged mode}" ;;
esac
# Cleared once the guards have passed, exactly as smart-commit-execute.sh and run-skill.sh do.
# Left exported it reaches every process git launches, and a descendant sd0x script started
# without `-p` inherits it, skips its own re-exec and then aborts on its own guard — a denial
# of service on a legitimate setup, not a security gain. Oracle: `P18c`.
unset SD0X_PRIV_REEXEC
# An inherited xtrace writes every expansion to stderr, config/identity values included —
# same prelude line as smart-commit-execute.sh, kept symmetric for the reason § "WHY THIS IS
# A SCRIPT" above gives for the rest of this preamble. Round 18 review, Nit.
set +x
set +v

set -u

# The policy, as a process-wide unset rather than a per-command prefix. This list and the
# `env -u` list in references/git-environment.md § 1 are the same set by construction -
# test/scripts/smart-commit-inspect.test.js `P1` pins them equal and fails on either
# drifting. (The sibling claim for smart-commit-execute.sh is `F1i`, in smart-commit.test.js.)
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
      GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE GIT_CEILING_DIRECTORIES \
      GIT_GLOB_PATHSPECS GIT_ICASE_PATHSPECS GIT_NOGLOB_PATHSPECS \
      GIT_LITERAL_PATHSPECS GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_CONFIG_NOSYSTEM \
      GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM \
      GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE GIT_SHALLOW_FILE GIT_PREFIX \
      GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE GIT_EXTERNAL_DIFF ALLOW_AI_COAUTHOR
# Inert here — this script never runs `cd` — and kept as a template invariant shared with
# smart-commit-execute.sh, so the two preludes stay diffable. Drop it only together.
CDPATH=''

# `$( )` strips every trailing newline and `--show-toplevel` has no -z form, so a root
# whose last component ends in one would be silently truncated and every later `-C` would
# name a path that does not exist. The `printf .` sentinel makes exactly one terminator
# removable. `&&` rather than `;` so git's exit status is what the `||` sees.
REPO_ROOT=$(git rev-parse --show-toplevel && printf .) || {
  printf '%s\n' '⚠️ could not resolve the repository root — aborting' >&2
  exit 1
}
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
# `-C ""` is a no-op in modern git — it means "wherever I happen to be", not "abort" — so an
# empty REPO_ROOT would silently diagnose whatever repo the caller's cwd is in rather than
# refusing. `set -u` cannot catch this: the variable IS set, just empty. Same guard
# smart-commit-execute.sh's `repo_root()` already has. Round 18 review, Nit.
[ -n "$REPO_ROOT" ] || {
  printf '%s\n' '⚠️ could not resolve the repository root — aborting' >&2
  exit 1
}

sub=${1:-}
[ "$#" -gt 0 ] && shift

# Extra operands are a usage error for EVERY subcommand, not just the two that take paths.
# `… branch --version` silently discarding its operand and exiting 0 is the same defect class
# as verify-last's second commit-ish: a diagnostic that answers something other than what it
# was handed is worse than one that refuses.
no_operands() {
  [ "$#" -eq 0 ] || {
    # $sub is only ever a literal case pattern by the time any caller reaches here — unreachable
    # today, but escaped anyway so a future subcommand added without updating this function
    # cannot reopen the same channel the `*)` unknown-subcommand arm below already closes.
    # Round 19 review, P2.
    esc "$sub"
    printf '%s: takes no operands, got %s\n' "$ESC" "$#" >&2
    exit 2
  }
}

# The C0-control/DEL byte set `esc()` escapes as `\xHH`, built ONCE here rather than inside
# `esc()`: the set is a script-wide constant, and rebuilding it per call forked 58 subshells
# (`$(printf ...)` twice per byte) for a table that never changes — measured 160x slower than
# the `printf -v` form below, which writes into the array without forking. Round 18 review, P2.
SD0X_CTRL_CH=() SD0X_CTRL_ESC=()
for i in 1 2 3 4 5 6 7 8 11 12 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 127; do
  printf -v hex '%02x' "$i"
  printf -v ch '%b' "\\x$hex"
  SD0X_CTRL_CH+=("$ch")
  SD0X_CTRL_ESC+=("\\x$hex")
done
unset i hex ch

# Escape every DATA field before printing it, result in $ESC. After this no data can contain a
# character that ends a line or starts a field, which is what keeps the key and kind columns
# unforgeable. Backslash first, or the escape stops being injective. Applies to config values,
# to the origin path (a config file may legitimately be named with a tab in it) and to the
# GIT_AUTHOR_*/GIT_COMMITTER_* values, which are attacker-reachable in exactly the same way.
esc() {
  ESC=$1
  ESC=${ESC//\\/\\\\}; ESC=${ESC//$'\n'/\\n}
  ESC=${ESC//$'\t'/\\t}; ESC=${ESC//$'\r'/\\r}
  # Every OTHER C0 control byte, plus DEL, is escaped too — ESC (0x1b) chief among them, since a
  # raw one in an identity/config field can carry an ANSI/terminal escape sequence straight into
  # a record a human or a downstream reader later prints (the field-separator threat this
  # function exists for is about STRUCTURE; this half is about what a terminal DOES with the
  # bytes once printed). 0x00 is skipped: bash strings cannot hold a NUL byte, so it can never
  # reach here. Round 17 review, P2. Oracle: `P8v`.
  local i
  for ((i = 0; i < ${#SD0X_CTRL_CH[@]}; i++)); do
    ESC=${ESC//${SD0X_CTRL_CH[i]}/${SD0X_CTRL_ESC[i]}}
  done
}

# Print one line per configured value of $1: `<key><TAB><kind>[<TAB><scope><TAB><origin>[<TAB>
# <value>]]`, where the kind is `value`, `empty` or `unset` and is written here, never read out
# of the config. Any further arguments are passed to `git config` — the one use is `--type=bool`,
# and a flag that changes the record SHAPE would break every caller. Records are read
# NUL-delimited because a value may contain a newline, and they
# arrive in git's own precedence order — the LAST line for a key is the value git would use, so
# a reader must key on that rather than on any line's presence. Lines are buffered until the
# read's status is known: a truncated read prints nothing rather than a well-formed lie. Exit 1
# means the config could not be READ, which is never the same answer as "not set".
# Shape, escape table, trailing status record and the measurements:
# docs/features/smart-commit-hardening/4-implementation.md § 10.
emit_config_records() {
  local key=$1; shift
  local rc= out= line scope origin value
  while IFS= read -r -d '' scope; do
    if IFS= read -r -d '' origin && IFS= read -r -d '' value; then
      # Scope is a fixed enum git writes, so escaping it is belt-and-braces and deleting it
      # reddens nothing — it is here so the three data fields are handled by one rule.
      esc "$scope";  scope=$ESC
      esc "$origin"; origin=$ESC
      esc "$value";  value=$ESC
      if [ -n "$value" ]; then
        printf -v line '%s\tvalue\t%s\t%s\t%s\n' "$key" "$scope" "$origin" "$value"
      else
        # git exits 0 for a key set to the empty string. Whether that is an anomaly depends on
        # whether it is the LAST record for the key — Step 1c decides that, not this function.
        printf -v line '%s\tempty\t%s\t%s\n' "$key" "$scope" "$origin"
      fi
      out=$out$line
    else
      # The only record with no two records after it: the status the subshell appends.
      rc=${scope#rc=}
    fi
  done < <(git -C "$REPO_ROOT" config -z --show-origin --show-scope "$@" --get-all "$key"
           printf 'rc=%s\0' "$?")
  case "$rc" in
    0) printf '%s' "$out" ;;
    # git uses exit 1 for "not set". Any other status — including an empty `rc`, meaning the
    # stream ended before the status record — means the config could not be read, and reporting
    # that as `unset` would send the caller to setup guidance for a repository whose problem is
    # not a missing key.
    1) printf '%s\tunset\n' "$key" ;;
    *) esc "$sub"
       printf '%s: could not read %s — aborting\n' "$ESC" "$key" >&2
       exit 1 ;;
  esac
}

# Report one identity env var in the same key/kind shape as a config record, for the same reason
# the `empty` kind exists there: exported-and-empty is NOT "not set". git refuses to commit at all
# on an empty NAME (`fatal: empty ident name`) and silently records `<>` for an empty EMAIL, so
# collapsing the two into one blank line hid both a halt and an attribution loss behind a line
# byte-identical to the benign case. `${!name+set}` is the test that separates them — `${VAR:-}`,
# which this replaced, cannot. Measurements: 4-implementation.md § 10.4. Oracles: `P8l`, `P8m`.
emit_env_record() {
  local name=$1 present val
  present=${!name+set}
  val=${!name:-}
  if [ -z "$present" ]; then
    printf '%s\tunset\n' "$name"
  elif [ -z "$val" ]; then
    printf '%s\tempty\n' "$name"
  else
    esc "$val"
    printf '%s\tvalue\t%s\n' "$name" "$ESC"
  fi
}

# What the commit would ACTUALLY be attributed to — asked of git, not reconstructed from the
# records above. `git var` applies the whole fallback chain (`GIT_<role>_*` → `user.*` → `EMAIL`
# → an OS guess), runs git's ident parser (which strips whitespace and `<`/`>` and can reduce a
# NON-empty value to nothing), and refuses in exactly the cases `git commit` refuses. Rebuilding
# that in a decision table is what rounds 12–14 kept getting wrong one channel at a time, so the
# table now reads this line and uses the records above only to say *where* a problem is.
# Measurements: 4-implementation.md § 10.6. Oracles: `P8o`–`P8q`.
emit_effective() {
  local role=$1 var=$2 ident
  if ident=$(git -C "$REPO_ROOT" var "$var" 2>/dev/null); then
    # `git var` always appends ` <unix-seconds> <tz>`; the answer is who, not when, and a
    # record that changes every second cannot be compared between two runs. Stripping from
    # the RIGHT is what makes a name containing spaces survive it. If the shape is ever not
    # that, the pattern simply does not match and the raw ident is printed.
    ident=${ident% * *}
    esc "$ident"
    printf 'effective\t%s\tvalue\t%s\n' "$role" "$ESC"
  else
    # Not a read failure: git answered, and the answer is that this repository cannot commit.
    # The message is deliberately not captured — a second call to fetch it could see different
    # config, and Step 1c tells the operator the one command that prints it.
    printf 'effective\t%s\tunresolvable\n' "$role"
  fi
}

# Round 15 review: `effective` says WHAT git resolved but not WHETHER that came from something
# the operator set for this repository, or fell through to $EMAIL / an OS guess — and that
# split cannot be re-derived from the records above without reproducing git's fallback order a
# FOURTH time (§ 10.6 already names three). `user.useConfigOnly=true` is git's own switch for
# refusing exactly the fallback half of resolution — asked, not modelled. Measured: it answers
# 0 for user.*/author.*/committer.* config AND for an exported GIT_<role>_*, 128 for $EMAIL and
# for a bare OS guess alike. Grouping $EMAIL with the guess is not a gap: from the operator's
# view neither is a value set for THIS repository, and `git config --local` fixes both the same
# way. Oracles: `P8r`, `P8s`.
emit_configured() {
  local role=$1 var=$2
  if git -C "$REPO_ROOT" -c user.useConfigOnly=true var "$var" >/dev/null 2>&1; then
    printf 'configured\t%s\tyes\n' "$role"
  else
    printf 'configured\t%s\tno\n' "$role"
  fi
}

# Populates GPG_OVERRIDE for the `signature` subcommand's git-log call below — the same
# channel and same fix as smart-commit-execute.sh's resolve_gpg_override (round 23
# review, P0): `gpg.program` (every format), `gpg.<format>.program`, and
# `gpg.ssh.defaultKeyCommand` all name a binary git executes, reachable from a non-local
# scope including HOME. `signature`'s own `%G?` format specifier requests verification
# regardless of `--no-show-signature` (round 24 review, P0 — measured: the flag only
# suppresses the printed banner; `%G?` still runs `gpg.program`). A real local/worktree
# override (the repository's own committed choice of gpg wrapper) still runs; anything
# from a scope this process does not control is replaced with git's own built-in default.
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
    scope_line=$(git -C "$REPO_ROOT" config --show-scope --get "$name" 2>/dev/null)
    scope_rc=$?
    scope_word=${scope_line%%$'\t'*}
    case "$scope_word" in
      local|worktree) continue ;;
    esac
    [ "$scope_rc" -eq 1 ] && continue
    GPG_OVERRIDE+=(-c)
    GPG_OVERRIDE+=("$name=$default")
  done
}

# True (and prints the refusal to stderr) when $1's effective scope is neither
# local/worktree nor genuinely unset (`--get`'s documented exit 1) — the same
# fail-closed rule `guard` above applies to core.hooksPath.
untrusted_driver_key() {
  local key=$1 scope_line scope_word scope_rc
  scope_line=$(git -C "$REPO_ROOT" config --show-scope --get "$key" 2>/dev/null)
  scope_rc=$?
  scope_word=${scope_line%%$'\t'*}
  case "$scope_word" in local|worktree) return 1 ;; esac
  [ "$scope_rc" -eq 1 ] && return 1
  printf '%s is configured outside this repository/worktree (reachable through HOME) but is\n' "$key" >&2
  printf "named by this repository's own .gitattributes — refusing rather than running it.\n" >&2
  return 0
}

# Refuses (non-zero, message on stderr) when the WHOLE tracked+untracked tree's
# gitattributes name a filter/diff/merge driver whose actual command comes from a scope
# this process does not control. Takes no pathspec, even from `scope`/`diff` (round 24
# re-review, P1): `git status`/`git diff` refresh racily-clean index entries across the
# whole tree regardless of the pathspec they are given, so scoping the CHECK to a
# caller's pathspec would leave an out-of-scope driver assignment free to run while this
# function reported the tree as clean.
# `core.attributesFile=/dev/null` on every call below only blocks an ATTACKER-NAMED
# driver assignment; a driver the repository's OWN tracked .gitattributes opts into
# (e.g. `* filter=lfs`, the git-lfs shape) still resolves its command through ordinary
# config lookup, and status/diff run the clean filter — and, for diff, textconv by
# default — exactly like `git commit` does (round 23 review, P0: reproduced against
# `filter.<name>.clean` on both `status` and `diff`). Kept checking all three of
# filter/diff/merge, unlike smart-commit-execute.sh's copy (round 24 review, P1
# narrowed THAT one to filter-only because `git commit` never runs the other two) —
# this file's `diff`/`status`/`collect`/`scope` subcommands genuinely can invoke
# textconv, so dropping the check here would reopen the exact channel round 23 closed.
#
# NUL-delimited (round 24 review, P0 — was text-format `check-attr` with a
# `*": filter: "*`-style substring match): a path whose NAME itself contained another
# attribute's marker text (e.g. a file literally named `a: filter: b.txt`) made that
# pattern match FIRST regardless of which attribute the line actually reported, so a
# real `diff=`/`merge=` assignment on such a path went undetected entirely. `-z` on
# both pipeline stages plus the `read -r -d ''` triple loop removes line-oriented
# parsing altogether — there is no line, and no substring, left to confuse. The
# execute-side copy already used this shape; this file now matches it.
refuse_on_untrusted_content_drivers() {
  local attrfile ppath ptype pvalue key seen
  local -a rc
  # The docstring above says "takes no pathspec" — enforced here, not just described, so a
  # future `scope`/`diff` call site cannot reopen the round 24 re-review P1 by quietly
  # passing one back in (round 24 re-review, P2: the contract was stated in prose while the
  # pipeline below still forwarded "$@" to `ls-files`, which was harmless only because every
  # current caller happens to pass nothing).
  [ "$#" -eq 0 ] || {
    printf 'internal: refuse_on_untrusted_content_drivers takes no pathspec\n' >&2
    return 1
  }
  attrfile=$(mktemp -- "${TMPDIR:-/tmp}/smart-commit-attr.XXXXXX") || {
    printf 'could not allocate a scratch file for the attribute check\n' >&2
    return 1
  }
  # Every explicit return path below already `rm -f`s this file, but a signal arriving in
  # the window between the mktemp above and one of those removals would otherwise leak it.
  # This is the only mktemp in this script (round 24 re-review, P2), so a trap scoped to
  # this one call is exactly as narrow as the resource it protects. INT/TERM/HUP call
  # `exit` explicitly, mirroring smart-commit-execute.sh's OWNED/sweep_owned traps, because
  # bash does not reliably run an EXIT trap on an untrapped fatal signal otherwise. `rm -f`
  # on an already-removed file is a no-op, so this trap surviving past this function's own
  # return (nothing here unsets it) costs the rest of the run nothing.
  trap "rm -f -- $(printf '%q' "$attrfile")" EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  # Same `core.fsmonitor`/`core.attributesFile` pins every status/diff call below carries:
  # this function's OWN reads are the identical shape, and an unpinned `check-attr` would
  # also pick up the ATTACKER's `core.attributesFile` (if any) as if it were the
  # repository's own — a false refusal for a channel the status/diff pins already close.
  # Stage 1 (`ls-files`) carries only `core.fsmonitor=false`: it does not read blob content
  # (`--cached --others --exclude-standard` is filename enumeration), so `attributesFile`
  # has nothing to affect there — pinned on stage 2, where `check-attr` actually resolves
  # gitattributes, matching the comment this replaces which had wrongly claimed both.
  git -c core.fsmonitor=false -C "$REPO_ROOT" ls-files -z --cached --others --exclude-standard \
    | git -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" \
        check-attr --all -z --stdin >"$attrfile" 2>/dev/null
  # Both pipeline stages checked (round 24 review, P1): the `if ! cmd1 | cmd2; then` this
  # replaced read only cmd2's exit status, so a failing `ls-files` (an unreadable path
  # argument, a corrupt index) left an EMPTY scratch file and this function returned 0 —
  # "no drivers found" — when the real answer was "could not tell". Reproduced: a failing
  # first stage previously let the caller proceed as if the tree were clean. The stderr
  # redirect stays only on stage 2 (check-attr's own "no such attribute" chatter is not
  # actionable); stage 1's real errors now surface instead of being discarded.
  rc=("${PIPESTATUS[@]}")
  if [ "${rc[0]}" -ne 0 ] || [ "${rc[1]}" -ne 0 ]; then
    rm -f -- "$attrfile"
    printf 'could not resolve gitattributes for the requested paths\n' >&2
    return 1
  fi
  seen=$'\n'
  while IFS= read -r -d '' ppath && IFS= read -r -d '' ptype && IFS= read -r -d '' pvalue; do
    case "$ptype" in
      filter) ;;
      diff) ;;
      merge) ;;
      *) continue ;;
    esac
    # `--all` emits a record for `unset`/`unspecified` too, not only for attributes
    # actually assigned a value — the comment this replaced said otherwise and was wrong
    # (round 24 review, P2: measured against git 2.54.0, `-filter`/no assignment both
    # produce a record here). Left unskipped, an attacker with HOME access could set
    # e.g. `filter.unset.clean` and turn every unrelated unassigned path into a
    # permanent false refusal.
    case "$pvalue" in
      '') continue ;;
      unset) continue ;;
      unspecified) continue ;;
    esac
    case "$seen" in *$'\n'"$ptype:$pvalue"$'\n'*) continue ;; esac
    seen="$seen$ptype:$pvalue"$'\n'
    # `diff.<name>.textconv` only, not `diff.<name>.command` — the same `diff=<name>`
    # .gitattributes assignment resolves both, but `.command` (the EXTERNAL diff tool) is
    # exactly what `--no-ext-diff` on every diff/status call below already refuses to
    # invoke, so checking it here would just be a second refusal for a channel that call
    # site already closes. `.textconv` is different: it survives `--no-ext-diff` (it is
    # content conversion, not diff-tool delegation — round 23 review, P0, measured), which
    # is why only it needs the same untrusted-scope check filter/merge get.
    case "$ptype" in
      filter)
        for key in "filter.$pvalue.clean" "filter.$pvalue.smudge" "filter.$pvalue.process"; do
          if untrusted_driver_key "$key"; then rm -f -- "$attrfile"; return 1; fi
        done ;;
      diff)  if untrusted_driver_key "diff.$pvalue.textconv"; then rm -f -- "$attrfile"; return 1; fi ;;
      merge) if untrusted_driver_key "merge.$pvalue.driver"; then rm -f -- "$attrfile"; return 1; fi ;;
    esac
  done < "$attrfile"
  rm -f -- "$attrfile"
  return 0
}

case "$sub" in
  style)
    no_operands "$@"
    # Subject lines are attacker-controlled (anyone who authored a commit on this repo chose
    # them) and this is stdout a caller may print straight to a terminal — an OSC 52 sequence
    # (clipboard write on iTerm2/xterm/kitty/wezterm) or other raw escape reaches the reader
    # unless routed through the same `esc()` every other field in this script uses. The `rc=`
    # sentinel (same shape as `emit_config_records` above) is what lets this arm keep git's own
    # exit status — SKILL.md Step 1b's "empty repo" vs "could not be read" distinction depends
    # on it, and a bare loop over process substitution would lose it. Round 19 review, P1.
    # Oracles: `P22`, `P22b`.
    rc=
    while IFS= read -r line; do
      case "$line" in
        rc=*) rc=${line#rc=} ;;
        *) esc "$line"; printf '%s\n' "$ESC" ;;
      esac
    done < <(git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -C "$REPO_ROOT" log --oneline --no-show-signature -15
             printf 'rc=%s\n' "$?")
    exit "${rc:-1}"
    ;;

  identity)
    no_operands "$@"
    # Read by key and kind, never by line number, and take the LAST line for a key as the one
    # git would use. Contract and the forgeries it closes: 4-implementation.md § 10, § 10.1.
    # Oracles: `P8`, `P8b`–`P8j`.
    # author.*/committer.* outrank user.* for their respective role (git >= 2.31) and git
    # commits by them when set — reading only user.* left the "locating the cause" table
    # pointing at the wrong file whenever they were the actual source. Measured: `P8k5`.
    for key in user.name user.email author.name author.email committer.name committer.email; do
      emit_config_records "$key"
    done
    # GIT_AUTHOR_*/GIT_COMMITTER_* are deliberately NOT in the unset block above: they are
    # what the commit would actually use, so reporting them is the whole point of the step.
    # They are escaped for the same reason config values are — a newline in one of them
    # otherwise writes a second line that is shaped exactly like a config record (`P8i`).
    for name in GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL; do
      emit_env_record "$name"
    done
    # SKILL.md Step 1c's decision table has a HALT row for "multi-value conflict + CI=true" —
    # a record this loop must produce, or that row has no way to ever fire. `emit_env_record`
    # already reports unset/empty/value uniformly; CI is not a git identity var, but the same
    # shape is what the table reads. Oracle: `P8t2`.
    emit_env_record CI
    emit_effective author    GIT_AUTHOR_IDENT
    emit_effective committer GIT_COMMITTER_IDENT
    emit_configured author    GIT_AUTHOR_IDENT
    emit_configured committer GIT_COMMITTER_IDENT
    ;;

  signing)
    no_operands "$@"
    # Same shape as `identity`, and for the same reason: the previous form read three keys
    # positionally and printed `unset` for a config it could not READ. A multi-line value in
    # any of the three shifted every later line, so Step 1d read `gpg.format` off the wrong
    # one — measured in 4-implementation.md § 10.2. An unset `gpg.format` answers `unset`
    # here; the `gpg` default it used to print is git's, and applying a default is the
    # caller's job. Oracles: `P9`, `P9b`, `P9c`.
    #
    # `commit.gpgsign` is asked for as a BOOLEAN, not as the string in the file. git reads a
    # valueless `gpgsign` as true and `gpgsign =` as false, and both emit the byte-identical
    # `empty` record — the distinction is gone before Step 1d can see it, so no decision row
    # could recover it. `--type=bool` makes git do the conversion (`1`/`yes`/`on`/`True` all
    # normalise to `true`), makes `empty` unreachable for this key, and fails closed on a
    # non-boolean — which is not stricter than git, whose own `--bool` read exits 128 there
    # too. Measurements: 4-implementation.md § 10.3. Oracles: `P9d`–`P9f`.
    emit_config_records commit.gpgsign --type=bool
    for key in user.signingkey gpg.format; do
      emit_config_records "$key"
    done
    ;;

  signature)
    no_operands "$@"
    # One character, git's own `%G?` alphabet. The legend and what each letter means for
    # a commit plan live in SKILL.md Step 1d, which is what reads this. An unborn repo has
    # no commit to ask about: git exits 128 with an empty stdout, and that is a fourth
    # state, not a signature verdict. Oracle: `P11b`.
    #
    # `resolve_gpg_override` first (round 24 review, P0): `%G?` runs `gpg.program`
    # regardless of `--no-show-signature`, so this call needs the same scope-checked
    # substitution `run_commit` uses in smart-commit-execute.sh, not just the banner
    # suppression the other log-family calls in this file rely on.
    resolve_gpg_override
    # Warn on override, matching smart-commit-execute.sh's run_commit (round 24 re-review,
    # P2): a silently substituted signer means this subcommand's `%G?` verdict — the exact
    # value SKILL.md Step 1d reads to plan signing — can differ from what `git log` outside
    # this script would report, with nothing on stderr to explain why.
    if [ "${#GPG_OVERRIDE[@]}" -gt 0 ]; then
      gpg_kv=; gpg_name=; gpg_default=
      for gpg_kv in "${GPG_OVERRIDE[@]}"; do
        case "$gpg_kv" in -c) continue ;; esac
        gpg_name=${gpg_kv%%=*}
        gpg_default=${gpg_kv#*=}
        printf '%s is configured outside this repository/worktree — ignoring it.\n' "$gpg_name" >&2
        if [ -n "$gpg_default" ]; then
          printf '  Using %s instead.\n' "$gpg_default" >&2
        else
          printf '  Clearing it (no safe default exists) instead.\n' >&2
        fi
      done
    fi
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false ${GPG_OVERRIDE[@]+"${GPG_OVERRIDE[@]}"} -C "$REPO_ROOT" log -1 --no-show-signature --format='%G?'
    ;;

  guard)
    no_operands "$@"
    # `--git-path hooks/…` honours core.hooksPath from ANY scope, including one reachable
    # through HOME ($HOME/.gitconfig), which this script cannot strip — `identity` needs it
    # as genuine load-bearing input. Trusts the setting only when git itself reports its
    # scope as local/worktree (the repository's own committed choice, e.g. husky); the
    # untrusted arm answers `guard:missing` directly, with no fallback file to mis-describe.
    # Full history (rounds 20-22: GIT_CONFIG_SYSTEM, the HOME channel, the scope-read's own
    # exit code, and the false-positive fallback this replaced) and derivation:
    # git-environment.md § 1, its "still active" table, and § 10.13/§ 10.14 of
    # 4-implementation.md.
    scope_line=$(git -C "$REPO_ROOT" config --show-scope --get core.hooksPath 2>/dev/null)
    scope_rc=$?
    # Compared as a plain word, not the tab-delimited scope-and-value pair matched directly in
    # a case pattern — behaviourally identical (git's --show-scope output is always the scope
    # name, a tab, then the value), but keeps the pattern free of an ANSI-C-quoted delimiter
    # glued to a bare word.
    scope_word=${scope_line%%$'\t'*}
    trusted=''
    case "$scope_word" in
      local|worktree) trusted=1 ;;
      *) [ "$scope_rc" -eq 1 ] && trusted=1 ;;
    esac
    if [ -n "$trusted" ]; then
      hook=$(git -C "$REPO_ROOT" rev-parse --git-path hooks/commit-msg && printf .) || {
        printf 'guard: could not resolve the hooks path — aborting\n' >&2
        exit 1
      }
      # The `printf .` sentinel above is DEFENSIVE, not load-bearing, and the difference is
      # measured: the capture always ends in a fixed suffix (`commit-msg`), so the only
      # trailing newline is git's own terminator and `$( )` stripping it is correct. Kept so
      # every `$( )` capture in this file follows one rule. Measurement:
      # 4-implementation.md § 10.7.
      hook=${hook%.}; hook=${hook%$'\n'}
      case "$hook" in
        ''|/*) ;;
        *) hook="$REPO_ROOT/$hook" ;;
      esac
      if   [ -f "$hook" ] && [ -x "$hook" ]; then printf 'guard:installed\n'
      elif [ -f "$hook" ]; then printf 'guard:not-executable\n'
      else                      printf 'guard:missing\n'; fi
    else
      printf 'guard:missing\n'
    fi
    ;;

  collect)
    no_operands "$@"
    # Root-relative by construction: `git status --short` reports paths relative to the
    # CURRENT directory, so collecting from a subdirectory would emit pathspecs that a
    # later `-C "$REPO_ROOT"` resolves against the wrong base.
    #
    # Status is accumulated across all three commands rather than left to the last one's
    # exit code, so a failing `status --short` cannot be masked by the two diffstats
    # succeeding and misread as a clean tree with a staged file still sitting in the index.
    #
    # `--untracked-files=all` is pinned rather than inherited, and `all` rather than git's
    # default `normal` — a collapsed directory hides filenames SKILL.md's exclusion list
    # matches on. Rationale, cost, oracles: 4-implementation.md § 9 (`P17`–`P17c`).
    #
    # `-c core.fsmonitor=false -c core.attributesFile=/dev/null`: both close a HOME-reachable
    # arbitrary-command channel (`core.fsmonitor` itself, and `filter.<name>.clean` via
    # `core.attributesFile`) that a status-touching git call can trigger from any config
    # scope. Rationale, measurements, oracles: 4-implementation.md § 10.13, § 10.14. The
    # command half of that same channel — a driver this repository's OWN .gitattributes
    # opts into — is refuse_on_untrusted_content_drivers, just above; § 10.14 also covers it.
    refuse_on_untrusted_content_drivers || exit 1
    rc=0
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" status --short --no-branch --untracked-files=all || rc=$?
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" diff --no-ext-diff --stat || rc=$?
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" diff --no-ext-diff --cached --stat || rc=$?
    exit "$rc"
    ;;

  status)
    no_operands "$@"
    refuse_on_untrusted_content_drivers || exit 1
    # `--untracked-files=all` pinned for the reason given under `collect`.
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" status --short --no-branch --untracked-files=all
    ;;

  scope)
    [ "$#" -eq 1 ] || {
      printf 'scope: exactly one path is required\n' >&2
      exit 2
    }
    # An empty operand is not a path. `:(literal)` prefixed to "" is a pathspec that matches
    # EVERY file, so `scope ''` answers about the whole repository while the caller believes
    # it scoped the commit - and in --execute that set is what gets staged. The shipped fence
    # no longer reaches this (it writes the path out literally), so the guard stands for every
    # OTHER caller: the installed copy is a plain script anyone may invoke.
    [ -n "$1" ] || {
      printf 'scope: the path must not be empty\n' >&2
      exit 2
    }
    # Checked tree-wide, NOT scoped to "$1" (round 24 re-review, P1): `git status` refreshes
    # racily-clean index entries across the WHOLE tree regardless of the pathspec it is given,
    # so a driver assignment outside "$1" can still run even though this call only reported on
    # "$1" — reproduced 6/10 runs against an out-of-scope `filter.f.clean`. Narrowing the CHECK
    # to the caller's pathspec would have re-opened exactly the channel this function exists to
    # close; only the status output below is scoped, not the refusal.
    refuse_on_untrusted_content_drivers || exit 1
    # `--scope` takes a PATH, never a glob. Applying the magic here rather than asking the
    # caller to type it is the point: `*.ts` matches a file literally named `*.ts`.
    # `--untracked-files=all` pinned for the reason given under `collect`.
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" status --short --no-branch --untracked-files=all -- ":(literal)$1"
    ;;

  diff)
    [ "$#" -ge 1 ] || {
      printf 'diff: at least one path is required\n' >&2
      exit 2
    }
    # Same reason as scope, per operand: one empty operand widens the whole diff to everything.
    for p in "$@"; do
      [ -n "$p" ] || {
        printf 'diff: no path may be empty\n' >&2
        exit 2
      }
    done
    # :(literal) applied per operand, HERE, so no call site can forget it: reading
    # `report1.md` while the commit stages `report[1].md` would describe one file and
    # commit another. Per-operand because the magic is not environmental.
    specs=()
    for p in "$@"; do specs+=( ":(literal)$p" ); done
    # Checked tree-wide, not scoped to "${specs[@]}" — same reason as `scope` above: `git diff`
    # refreshes the whole index regardless of the pathspec it is given, so the refusal must
    # cover the whole tree even though the diff output itself stays scoped to "${specs[@]}".
    refuse_on_untrusted_content_drivers || exit 1
    # Accumulated for the same reason as `collect`: an unstaged diff that fails while the
    # cached one succeeds must not exit 0 and read as "this path has no changes".
    rc=0
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" diff --no-ext-diff -- "${specs[@]}" || rc=$?
    git --no-pager -c color.ui=false -c color.status=false -c color.diff=false -c core.fsmonitor=false -c core.attributesFile=/dev/null -C "$REPO_ROOT" diff --no-ext-diff --cached -- "${specs[@]}" || rc=$?
    exit "$rc"
    ;;

  branch)
    no_operands "$@"
    git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD
    ;;

  ''|--help|-h)
    # `--help subcommand` is misuse like any other extra operand: it reads as a request for
    # help ABOUT that subcommand, and answering with the general usage would be answering a
    # question that was not asked — so the operand check runs BEFORE the usage line prints,
    # not after. Round 20 review, Nit: the printf used to run first, printing (and thus
    # answering) the question this comment says must not be answered.
    no_operands "$@"
    printf 'usage: smart-commit-inspect.sh <%s> [args...]\n' \
      'style|identity|signing|signature|guard|collect|status|scope|diff|branch' >&2
    [ -z "$sub" ] && exit 2
    exit 0
    ;;

  *)
    # $sub is caller-controlled argv, same as any config value — escaped for the same reason
    # as `esc()` itself (above): unescaped it is the one data channel in this file that could
    # carry a raw terminal-escape byte straight to stderr. Round 18 review, Nit.
    esc "$sub"
    printf 'smart-commit-inspect: unknown subcommand `%s`\n' "$ESC" >&2
    exit 2
    ;;
esac
