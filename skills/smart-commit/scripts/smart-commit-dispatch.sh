#!/bin/bash -p
# smart-commit-dispatch.sh - the single external-execution entry point for
# /smart-commit --execute.
#
#   . "${BASH_SOURCE[0]%/*}/smart-commit-dispatch.sh"   then   sd_run <name> [args...]
#   /bin/bash -p smart-commit-dispatch.sh --allowlist        # print the allowlist
#   /bin/bash -p smart-commit-dispatch.sh <name> [args...]   # standalone, for tests
#
# The sourcing form uses BASH_SOURCE, not `dirname "$0"`: inside a sourced file `$0` is
# still the CALLER's path, so `dirname "$0"` resolves the wrong directory whenever the
# caller lives elsewhere.
#
# WHAT THIS IS: dependency routing. One function means the set of external programs the
# script can name is a runtime refusal a test can assert - `sd_run curl` exits 127 and
# says why - instead of a claim a reader must re-derive by reading every call site.
#
# WHAT THIS IS NOT: a sandbox. The allowlist matches the FIRST TOKEN only, so an
# allowlisted interpreter reaches anything it likes: `sd_run bash -c 'curl ...'` runs
# curl, and `git` alone can run arbitrary code through its own config. Anything that
# treats this as a containment boundary is misreading it. Threat model:
# skills/smart-commit/references/execute-mode.md § The dispatcher.

# The allowlist, as a function so it cannot be pre-set from the environment the way a
# variable can. `env` is deliberately absent: the only `env` in the flow is the
# privileged re-exec at the top of smart-commit-execute.sh, which names /usr/bin/env by
# absolute path and necessarily runs before this file is sourced. Listing it would have
# widened the first-token surface for a call site that does not exist.
sd_allowlist() {
  printf '%s\n' bash git mktemp rm
}

sd_run() {
  if [ "$#" -eq 0 ]; then
    printf 'sd_run: no command given\n' >&2
    return 2
  fi
  local cmd=$1 name found=''
  shift
  # `[ "$name" = "$cmd" ]` is a string comparison, not a pattern match, so a $cmd of
  # `*` compares as the literal asterisk rather than matching every entry.
  for name in $(sd_allowlist); do
    if [ "$name" = "$cmd" ]; then found=1; break; fi
  done
  if [ -z "$found" ]; then
    # Rendered with a parameter expansion, not `tr`: formatting the refusal must not
    # itself reach for a command outside the allowlist it is refusing on behalf of.
    local list; list=$(sd_allowlist); list=${list//$'\n'/ }
    printf 'sd_run: refusing `%s` - not in the allowlist (%s)\n' "$cmd" "$list" >&2
    return 127
  fi
  # `bash` launches the policy script itself, so it is named by ABSOLUTE path: a bare
  # `bash` resolves through the caller's PATH, and launching the caller's bash defeats
  # the `-p` it is launched with. The rest deliberately resolve through the caller's
  # PATH - pinning them would override a homebrew/asdf `git` the developer chose, and
  # a caller who controls PATH already controls their own `git commit`.
  case "$cmd" in bash) cmd=/bin/bash ;; esac
  command -- "$cmd" "$@"
}

# Executed rather than sourced: act as a thin CLI so the allowlist and the refusal are
# both observable from outside.
case "${BASH_SOURCE[0]}" in
  "$0")
    case "${1:-}" in
      --allowlist) sd_allowlist; exit 0 ;;
    esac
    sd_run "$@"
    exit $?
    ;;
esac
