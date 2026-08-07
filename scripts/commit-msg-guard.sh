#!/bin/bash -p
# commit-msg-guard.sh - Reject commits containing AI co-author trailers
# Install as git commit-msg hook: cp scripts/commit-msg-guard.sh .git/hooks/commit-msg
# Narrow opt-in: ALLOW_AI_COAUTHOR=1 git commit ...
#   Removes ONLY the exact line the project's attribution anchor names; every
#   other pattern still applies. It is NOT a bypass and NOT a way through a
#   false positive. See the block above the whitelist for what it cannot do.

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
# docs/features/create-pr-stacked/2-tech-spec.md §3.4 items 23, 27, 31, 33, 38.
case "${SD0X_PRIV_REEXEC:-}" in
  '')
    exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV 'SD0X_PRIV_REEXEC=1' \
      /bin/bash -p -- "${BASH_SOURCE[0]:-$0}" "$@"
    # `exec` is a builtin and therefore shadowable: an imported `exec` function
    # returns success without launching anything, and the script would otherwise
    # fall through with every hostile function still in place.
    SD0X_PRIV_GUARD=''
    : "${SD0X_PRIV_GUARD:?commit-msg-guard: privileged re-exec did not take}"
    ;;
esac
# Second pass. Neither check can fire on a legitimate setting: our own re-exec
# always yields `p`, and it strips BASH_ENV — which bash never sets itself.
# Reaching either line means the marker was forged.
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?commit-msg-guard: cannot establish bash privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?commit-msg-guard: cannot establish bash privileged mode}" ;;
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

# The shebang carries `-p` for the same reason, and it covers what the block
# above cannot: `$BASH_ENV` is sourced by non-interactive bash BEFORE line one,
# so a startup file containing `exit 0` ends the run successfully with no script
# line ever executed. Nothing inside a script can pre-empt that — `-p` not
# processing $BASH_ENV is the only defence, and it applies when this file is
# executed directly (which is how git runs a hook). Residual, stated plainly:
# `bash commit-msg-guard.sh …` bypasses the shebang, and in that form a hostile
# $BASH_ENV still wins. Invoke it as `/bin/bash -p …` or let the shebang run it.

# Tracing is disabled before anything reads the message. With xtrace inherited —
# an exported SHELLOPTS, or an invocation like `bash -px` — bash writes every
# expansion to stderr, including the whole matching line captured below. That
# defeats the withholding this script does deliberately (rules/security.md,
# Anchor Register #2): a commit message can carry a pasted credential, and hook
# stderr reaches the terminal and any CI log. `set +v` covers the verbose form.
# Already privileged means no re-exec happened, so this is the only thing that
# turns tracing off on that path.
set +x
set +v

# Pinned, not inherited — privileged mode stops imported functions and does
# nothing about these values. Measured on this repo's own grep: `GREP_OPTIONS=-x`
# alone makes this hook exit 0 on a message carrying a real
# `Co-Authored-By: Claude <noreply@anthropic.com>` trailer, because BSD grep
# still honours the variable and `-x` demands a whole-line match. A hostile PATH
# does the same by selecting a `grep` that answers "no match". Both are complete
# fail-opens of the only check this hook performs. Same block, same reasoning, as
# skills/create-pr/scripts/sanitize-pr-content.sh — grep is the sole utility here
# and it lives in /usr/bin on macOS and Linux alike.
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH
GREP_OPTIONS=''
export GREP_OPTIONS
IFS=$' \t\n'

set -euo pipefail

# Exit codes — callers branch on these, so they are a contract, not a habit:
#   0  clean message
#   1  policy violation (AI attribution found, or a duplicated whitelist trailer)
#   3  the policy could NOT be evaluated (missing file, mktemp/grep failure) —
#      an environment problem, not a verdict about the message
# As a commit-msg hook any nonzero still rejects the commit; the split exists
# for programmatic callers (smart-commit-execute.sh), which must not report an
# environment failure as "AI content detected". Residual: the privileged-mode
# `${x:?}` aborts above and the `${1:?}` usage abort below expand to status 1 —
# bash fixes that value, so those aborts are indistinguishable from a violation
# by status alone; read stderr before concluding the message carried a trailer.
EXIT_ENV=3

MSG_FILE="${1:?Usage: commit-msg-guard.sh <commit-msg-file>}"

if [ ! -f "$MSG_FILE" ]; then
  echo "commit-msg-guard: file not found: $MSG_FILE" >&2
  exit "$EXIT_ENV"
fi

# WHAT THIS OPT-IN CANNOT DO, stated first because the wording used to imply
# otherwise: the anchor grants the exception "via /smart-commit --ai-co-author",
# and a commit-msg hook has no way to know which workflow invoked git. Any caller
# can set this variable. So what is enforced here is the exception's CONTENT
# (exactly one permitted line), never its PROVENANCE. The workflow half is
# enforced, if at all, by /smart-commit's own runtime validation — see
# skills/smart-commit/references/execute-mode.md. Read this as a narrowed policy,
# not as an authorization check.
#
# The opt-in narrows the policy; it does not switch it off. rules/discretion.md
# § Anchor Register #4 grants ONE exception to the attribution anchor, and names
# it exactly: the literal line below, via `/smart-commit --ai-co-author`. This
# hook used to `exit 0` here without reading the message at all, which let
# `Generated by Claude`, a 🤖 tag, and every Co-Authored-By variant through on a
# flag any caller can set — the anchor's whole exception list, widened by an
# environment variable. What it does now is remove exactly the permitted line and
# hold the remainder to the full policy, so the opt-in buys the one trailer the
# anchor names and nothing else.
#
# Note this is enforcement of the existing exception, not a new one: the
# whitelist string is unchanged, and `/smart-commit --ai-co-author` still passes.
ALLOWED_TRAILER='Co-Authored-By: Claude <noreply@anthropic.com>'
SCAN_FILE="$MSG_FILE"
CLEANUP_FILE=''
# Two failure shapes, and they need opposite treatment.
#
# The `return 0` is defensive, and the earlier comment here overstated it as
# "load-bearing". Measured on the bash this runs under: a trap whose last command
# merely returns nonzero does NOT set the exit status, and an `if` with no branch
# taken returns 0 anyway — so removing `return 0` from the shape below changes
# nothing. The regression it commemorates was real but belonged to a DIFFERENT
# shape: a bare `[ -n "$CLEANUP_FILE" ]` as the trap body, under `set -e`, does
# exit 1 and turned every clean commit message into a rejection. Keeping the
# explicit return means a future edit back to that shape stays harmless; the
# test pins the reproducing shape, not this one.
#
# A failing `rm`, though, must not be swallowed by that same `return 0`. The
# scratch file holds the WHOLE commit message; leaving it in TMPDIR while
# reporting success is a silent disclosure of exactly the text this hook exists
# to inspect. It does not change the verdict — a cleanup problem is no reason to
# reject a compliant commit — but it is said out loud, with the path, so the
# developer can remove it. The path is safe to print; the content is not, and is
# not printed.
# shellcheck disable=SC2317  # invoked via trap
cleanup() {
  if [ -n "$CLEANUP_FILE" ]; then
    if ! rm -f -- "$CLEANUP_FILE"; then
      echo "commit-msg-guard: WARNING — could not remove the scratch copy of your" >&2
      echo "commit message. It is still on disk and holds the full message text:" >&2
      echo "  $CLEANUP_FILE" >&2
      echo "Remove it yourself. The commit verdict above is unaffected." >&2
    fi
  fi
  return 0
}
trap cleanup EXIT

if [ "${ALLOW_AI_COAUTHOR:-}" = "1" ]; then
  # Exactly one copy is what the anchor grants, counted on the ORIGINAL message
  # BEFORE the strip below: `grep -Fxv` removes EVERY byte-identical copy, so
  # without this count a message carrying the trailer twice would sail through
  # the scan and the commit would record both — "adds exactly one trailer"
  # (skills/smart-commit/SKILL.md) defeated by its own whitelist. Zero copies is
  # fine; the opt-in is permission, not an obligation.
  set +e
  trailer_count=$(LC_ALL=C grep -Fxc -e "$ALLOWED_TRAILER" -- "$MSG_FILE")
  count_status=$?
  set -e
  if [ "$count_status" -gt 1 ]; then
    echo "commit-msg-guard: could not count the whitelisted trailer (status $count_status)" >&2
    echo "The policy could not be enforced in full, so the commit is rejected." >&2
    exit "$EXIT_ENV"
  fi
  # Non-numeric output would make the -gt below a swallowed error inside an
  # `if` — a fail-open on the duplicate check. Same guard shape as the lineno
  # parse in the pattern loop.
  case "$trailer_count" in
    ''|*[!0-9]*)
      echo "commit-msg-guard: the trailer count is not a number; refusing to skip the check" >&2
      exit "$EXIT_ENV"
      ;;
  esac
  if [ "$trailer_count" -gt 1 ]; then
    echo "commit-msg-guard: the permitted trailer appears $trailer_count times." >&2
    echo "ALLOW_AI_COAUTHOR=1 permits exactly ONE copy of:" >&2
    echo "  $ALLOWED_TRAILER" >&2
    echo "Remove the duplicates; the whitelist is not a multiplier." >&2
    exit 1
  fi
  CLEANUP_FILE="$(mktemp -t commit-msg-guard.XXXXXX)" \
    || { echo "commit-msg-guard: could not create a temporary file; refusing to skip the check" >&2; exit "$EXIT_ENV"; }
  # -F -x -v: drop lines byte-identical to the permitted trailer, keep the rest.
  # A message that is nothing BUT permitted trailers leaves grep with no output
  # and status 1, which is success here — hence the explicit status handling
  # rather than letting `set -e` read "no lines left" as a failure.
  set +e
  LC_ALL=C grep -Fxv -e "$ALLOWED_TRAILER" -- "$MSG_FILE" > "$CLEANUP_FILE"
  strip_status=$?
  set -e
  if [ "$strip_status" -gt 1 ]; then
    echo "commit-msg-guard: could not apply the --ai-co-author whitelist (status $strip_status)" >&2
    echo "The policy could not be enforced in full, so the commit is rejected." >&2
    exit "$EXIT_ENV"
  fi
  SCAN_FILE="$CLEANUP_FILE"
fi

# Forbidden patterns (case-insensitive ERE). Only `AI` needs a \b word boundary:
# under -i it false-positives inside ordinary words ("maintainer"/"domain"/
# "detailed"/"explain" all contain "ai"). `GPT` stays UNbounded on purpose — no
# ordinary word contains "gpt", and the unbounded form is what catches ChatGPT,
# GPT-4 and GPT4 (a \b after "GPT" would miss all three). OpenAI/ChatGPT-family
# strings are the most common AI trailers, so every pattern also lists OpenAI
# and relies on unbounded GPT to cover ChatGPT. Verified on BSD and GNU grep;
# POSIX [[:<:]] is not portable.
PATTERNS=(
  'Co-Authored-By:.*(Claude|Anthropic|\bAI\b|GPT|OpenAI|Copilot|Codex|Gemini|noreply@anthropic)'
  'Generated[ -](by|with).*(Claude|Anthropic|\bAI\b|GPT|OpenAI|Copilot|Codex|Gemini)'
  '🤖.*(Claude|Anthropic|\bAI\b|GPT|OpenAI|Copilot|Codex|Gemini)'
)

FOUND=""
PAT_INDEX=0
for pat in "${PATTERNS[@]}"; do
  PAT_INDEX=$((PAT_INDEX + 1))
  # Two fail-open shapes closed here, both measured on this repo's own default
  # environment (`/usr/bin/grep`, LANG=en_US.UTF-8):
  #   1. `LC_ALL=C` — in a UTF-8 locale BSD grep reports a line carrying a byte
  #      that is not valid UTF-8 as non-matching and exits 1. One latin-1 byte
  #      on the trailer line let `Co-Authored-By: Claude` through. The policy is
  #      a byte-level ERE, so byte-wise matching is also what it means.
  #   2. status > 1 is fatal, and stderr is no longer discarded — an invalid
  #      ERE or an I/O error is "could not answer", and the old `if grep -Eqi …
  #      2>/dev/null` read every nonzero status as "clean", silently and with
  #      the diagnostic thrown away.
  set +e
  MATCH="$(LC_ALL=C grep -Ein -m1 -e "$pat" -- "$SCAN_FILE")"
  status=$?
  set -e
  case "$status" in
    0)
      # Location only, never the line. A commit message is ordinary prose that
      # routinely carries pasted output, so the matching line can hold a token —
      # and this text goes to the developer's terminal AND to any CI log that
      # runs the hook. rules/security.md (Anchor Register #2) forbids writing one
      # there. The sibling enforcement point already withholds it; printing it
      # here made the same policy leak at one of its two ends. `-n` gives
      # `<lineno>:<text>`, and the line number is enough to find it in the editor.
      lineno="${MATCH%%:*}"
      case "$lineno" in
        ''|*[!0-9]*)
          echo "commit-msg-guard: grep answered in an unparseable format on pattern $PAT_INDEX" >&2
          echo "The message DID match the pattern - only the location is unreportable." >&2
          echo "ALLOW_AI_COAUTHOR=1 does NOT help here: it removes one permitted" >&2
          echo "line and then runs this same check, which will fail again." >&2
          # Exit 1, not EXIT_ENV: this branch is inside `case 0)` — grep DID
          # report a match, so this IS a content verdict; only the line-number
          # reporting failed. Calling it an environment failure would make the
          # executor tell the developer no leak happened when one did.
          exit 1
          ;;
      esac
      FOUND="${FOUND}
  line $lineno matched pattern $PAT_INDEX (content withheld — it may carry a secret)"
      ;;
    1) ;;
    *)
      echo "commit-msg-guard: grep could not evaluate pattern $PAT_INDEX (status $status)" >&2
      echo "The policy could not be enforced in full, so the commit is rejected." >&2
      # No opt-in is offered on this path, and that is deliberate. The
      # whitelist is applied ABOVE the loop and the loop then runs unchanged,
      # so ALLOW_AI_COAUTHOR=1 reaches this same failure — the earlier text
      # advertised it as a way out and it never was. A developer whose grep
      # cannot evaluate the policy has an environment problem, not a message
      # problem; `--no-verify` remains their (deliberately blunt) escape.
      echo "This is an environment failure, not a message problem — fix grep." >&2
      exit "$EXIT_ENV"
      ;;
  esac
done

if [ -n "$FOUND" ]; then
  echo "" >&2
  echo "commit-msg-guard: AI attribution detected in commit message:" >&2
  printf '%s\n' "$FOUND" >&2
  echo "" >&2
  echo "Developer owns the commit. AI trailers are not allowed by default." >&2
  echo "ALLOW_AI_COAUTHOR=1 permits exactly one line and nothing else:" >&2
  echo "  $ALLOWED_TRAILER" >&2
  echo "Any other match above stays rejected with it set." >&2
  echo "" >&2
  exit 1
fi

exit 0
