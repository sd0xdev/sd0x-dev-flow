#!/bin/bash -p
# Resolve plugin root from this script's location, then invoke a skill script.
# Usage: /bin/bash -p scripts/run-skill.sh <skill-name> <script-name> [args...]

# Privileged mode, ESTABLISHED rather than detected, before anything else runs.
# The trust boundary is this file's `#!/bin/bash -p` shebang and the documented
# `/bin/bash -p <file>` invocation; the block below RE-ESTABLISHES `-p` for a
# plain `bash <file>` start and cannot widen that. Every decision here is a
# `case` (a reserved word, resolved by the grammar) and every abort is `${x:?}`
# (fails during expansion, before command lookup) — so neither an imported
# function nor a shadowed builtin can answer them, which `[` and `exec` both
# could. Why each construct is the one that survived measurement, what defeated
# the earlier `$-` and environment-scan designs, and the residual still open
# (marker pre-set AND privileged mode already on): see
# docs/features/create-pr-stacked/2-tech-spec/1-core-logic.md (§ 3.4) items 23, 27, 31, 33, 38.
case "${SD0X_PRIV_REEXEC:-}" in
  '')
    exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV 'SD0X_PRIV_REEXEC=1' \
      /bin/bash -p -- "${BASH_SOURCE[0]:-$0}" "$@"
    # `exec` is a builtin and therefore shadowable: an imported `exec` function
    # returns success without launching anything, and the script would otherwise
    # fall through with every hostile function still in place.
    SD0X_PRIV_GUARD=''
    : "${SD0X_PRIV_GUARD:?run-skill: privileged re-exec did not take}"
    ;;
esac
# Second pass. Neither check can fire on a legitimate setting: our own re-exec
# always yields `p`, and it strips BASH_ENV — which bash never sets itself.
# Reaching either line means the marker was forged.
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?run-skill: cannot establish bash privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?run-skill: cannot establish bash privileged mode}" ;;
esac
# The marker has done its job. Left exported it becomes a denial of service on a
# legitimate setup: a descendant started as an ordinary `bash <script>` inherits
# it, skips its own re-exec, has no `p`, and aborts on the check above.
#
# On the normal path this line is safe for the reason it looks safe: our own
# re-exec ran, so no function was imported and `unset` is the builtin. It is NOT
# safe on the residual path above — passing both checks proves privileged mode is
# on NOW, not that bash STARTED with -p, and a shell that enabled it afterwards
# did import functions. A shadowed `unset` there leaves the marker set and the
# nested-invocation denial with it. That path is already past the trust boundary,
# so this is a limit of the cleanup, not a second way in.
unset SD0X_PRIV_REEXEC
# An inherited xtrace writes every expansion to stderr, including arguments a
# skill script would otherwise withhold. Same control as the sanitizer's.
set +x
set +v

# Trusted directories in front of PATH for the RESOLUTION phase only. `readlink`
# and `dirname` decide which policy script gets launched, so they must not be the
# caller's choice; but leaving the prepend in place for the dispatch would pick
# /usr/bin/node over a deliberately selected nvm/asdf/homebrew one and silently
# change the runtime a `.js` skill script runs under. CALLER_PATH is restored
# before dispatch for exactly that reason.
# `cd` is a BUILTIN, so pinning PATH does nothing for it: an inherited CDPATH
# whose entries contain a directory named `scripts` sends `cd -P "$(dirname …)"`
# somewhere else entirely and contaminates the command substitution with the
# path `cd` prints. Measured: a legitimate developer CDPATH turned wrapper
# resolution into `No such file or directory` (a denial, and with the right tree
# a redirection). The sanitizer already prefixes `CDPATH=''` on its own `cd`;
# clearing it once here covers every resolution `cd` below.
CDPATH=''

CALLER_PATH="$PATH"
PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH

# POSIX mode is a parse-time property, so a script that fails to parse under it
# cannot fix itself: an exported POSIXLY_CORRECT=1 — a legitimate setting — made
# the sanitizer a syntax error and took the whole create-PR sanitization path
# down with it (fail-closed, but a complete denial). The targets are written to
# parse in POSIX mode as well; this removes the setting from what they inherit so
# neither defence stands alone.
unset POSIXLY_CORRECT

# Resolve this file's own symlink chain PHYSICALLY before deriving the root —
# unresolved, a symlink to this wrapper planted in an attacker's tree dispatches
# that tree's copy of the policy script. Why that is reachable in this repo, and
# the rest of the threat model these blocks implement: see
# docs/features/create-pr-stacked/2-tech-spec/1-core-logic.md (§ 3.4) items 14, 15 and 18.
SELF="${BASH_SOURCE[0]:-$0}"
HOPS=0
while [ -L "$SELF" ]; do
  HOPS=$((HOPS + 1))
  if [ "$HOPS" -gt 40 ]; then
    echo "Error: run-skill: symlink chain too deep (loop?)" >&2
    exit 1
  fi
  SELF_DIR=$(cd -P "$(dirname "$SELF")" && pwd) || exit 1
  SELF=$(readlink "$SELF") || exit 1
  # `${SELF#/}` differs from `$SELF` exactly when the target is absolute — a POSIX
  # absoluteness test that needs no `case` pattern. It began as a workaround for a
  # checker defect (a line-initial `/*` read as a C block-comment opener); that
  # defect is fixed — check-comment-blocks.js resolves comment syntax per language,
  # so `.sh` counts only `#` — and the expansion now stays on its own merits.
  if [ "${SELF#/}" = "$SELF" ]; then
    SELF="$SELF_DIR/$SELF"
  fi
done
SCRIPT_DIR=$(cd -P "$(dirname "$SELF")" && pwd) || exit 1
PLUGIN_ROOT=$(cd -P "$SCRIPT_DIR/.." && pwd) || exit 1
export PLUGIN_ROOT
SKILL_NAME="$1"; SCRIPT_NAME="$2"; shift 2

# Validate inputs: reject path traversal (../) and path separators (/)
if [[ "$SKILL_NAME" =~ \.\.|\/ ]] || [[ "$SCRIPT_NAME" =~ \.\.|\/ ]]; then
  echo "Error: invalid skill or script name (path traversal not allowed)" >&2
  exit 1
fi

TARGET="$PLUGIN_ROOT/skills/$SKILL_NAME/scripts/$SCRIPT_NAME"
# `-p` is passed on rather than left to the target's shebang: the target may be
# invoked here as an argument to bash, which bypasses its shebang entirely, and
# $BASH_ENV would then run in the target's own startup before its first line.
# The interpreter is named by ABSOLUTE PATH, because a bare `bash` is resolved
# through PATH and PATH is only partly ours here — the whole point of launching
# the target with `-p` is lost if the thing launched is the caller's `bash`.
# Residual, stated rather than papered over: `node` is deliberately resolved
# through the CALLER's PATH — pinning it would override an nvm/asdf runtime the
# developer chose — so a caller who controls PATH controls the interpreter for
# `.js` skill scripts. That is the same authority they already have over their
# own shell. The two policy enforcement points are both `.sh`, launched through
# an absolute interpreter, and both re-assert `-p` from their shebang.
# Resolution is done; the caller's PATH goes back so `node` is the one they
# selected. The `.sh` dispatch below names its interpreter absolutely and so does
# not depend on PATH at all.
PATH="$CALLER_PATH"
export PATH
case "$SCRIPT_NAME" in
  *.js)  exec node "$TARGET" "$@" ;;
  *.sh)  exec /bin/bash -p "$TARGET" "$@" ;;
  *)     exec "$TARGET" "$@" ;;
esac
