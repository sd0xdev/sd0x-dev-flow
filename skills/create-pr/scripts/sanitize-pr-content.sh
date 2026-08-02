#!/bin/bash -p
# sanitize-pr-content.sh - Apply the AI-attribution policy to PR title/body files.
#
# Why this is a script and not prose: PR title/body sanitization is a security
# criterion, and a criterion whose only implementation is a paragraph cannot be
# tested — a test would have to re-implement it and would then be checking its
# own copy. Every mode below is what /create-pr Step 4b and Step 7b invoke.
#
# The patterns are NOT defined here. commit-msg-guard.sh owns them, and they are
# read out of it at runtime so the two can never drift. There is deliberately no
# environment override for that path: a variable that swaps the policy for a
# weaker one is, at runtime, indistinguishable from an attack.
#
# Usage:
#   /bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh <mode> <file>
#     title         exit 0 clean, 3 if attribution found; never rewrites
#     body          sanitized body to stdout, removals to stderr
#     body-inplace  sanitize <file> and replace it atomically
#     scan          exit 0 clean, 4 if attribution found (published content)
#
# Exit codes: 0 clean · 2 usage/environment failure (fail closed) · 3 title
# rejected · 4 published leak detected. The privileged-mode abort below is the
# one path that exits 1 instead of 2 — it must not depend on `exit`.

# Privileged mode, ESTABLISHED rather than detected, before anything else runs.
#
# Trust boundary first: the protected entrypoints are this file's `#!/bin/bash -p`
# shebang and the documented `/bin/bash -p <file>` invocation. The block below
# RE-ESTABLISHES `-p` for a plain `bash <file>` start; it cannot widen that.
#
# Every decision below is a `case` — a reserved WORD, resolved by the grammar.
# That is load-bearing, not style. `[` is an ordinary command, so an imported
# `[` function answers it: measured, such a function made the `if [ -z ... ]`
# this block used to open with skip the re-exec outright. `case` cannot be
# shadowed, and `${x:?}` fails during EXPANSION — before any command lookup —
# so the aborts cannot be intercepted either.
#
# The re-exec does not ENUMERATE or CLASSIFY the environment — the precise claim,
# since `env -u` obviously carries the rest of it forward and the two checks below
# read shell state that the environment produced. It strips the three named
# variables unconditionally, and `-p` makes the new shell ignore exported
# functions altogether (measured, bash 3.2). An earlier version instead SCANNED
# via `$(/usr/bin/env)`; that could not separate a real variable from those names
# appearing inside another value, and was itself answerable by a function named
# `/usr/bin/env`.
#
# Residual: a caller who controls the invoking shell so that, at line one, the
# marker is already set AND privileged mode is already on. Exporting
# SHELLOPTS=privileged is one spelling; a startup file that turns `-p` on, sets
# the marker and unsets BASH_ENV is another. Both skip the exec and satisfy both
# second-pass checks. Derivation:
# docs/features/create-pr-stacked/2-tech-spec.md §3.4 items 23, 27, 31, 33.
case "${SD0X_PRIV_REEXEC:-}" in
  '')
    exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV 'SD0X_PRIV_REEXEC=1' \
      /bin/bash -p -- "${BASH_SOURCE[0]:-$0}" "$@"
    # `exec` is a builtin and therefore shadowable: an imported `exec` function
    # returns success without launching anything, and the script would otherwise
    # fall through with every hostile function still in place.
    SD0X_PRIV_GUARD=''
    : "${SD0X_PRIV_GUARD:?sanitize-pr-content: privileged re-exec did not take}"
    ;;
esac
# Second pass. Neither check can fire on a legitimate setting: our own re-exec
# always yields `p`, and it strips BASH_ENV — which bash never sets itself.
# Reaching either line means the marker was forged.
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?sanitize-pr-content: cannot establish bash privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?sanitize-pr-content: cannot establish bash privileged mode}" ;;
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

# The environment the utilities run in, pinned rather than inherited. Privileged
# mode stops imported *functions*; it does nothing about the values below, and
# each one of these was measured to produce a clean verdict on content that
# actually violates the policy:
#
#   PATH        every utility here is invoked by bare name. A caller-controlled
#               PATH selects the `grep` that answers "no match" and the `sed`
#               that emits three patterns that match nothing. Pinned to the
#               system directories — all 14 utilities this script uses resolve
#               inside /usr/bin or /bin on both macOS and Linux.
#   GREP_OPTIONS  BSD grep still honours it. `GREP_OPTIONS=-x` alone made `scan`
#               exit 0 and `body` echo a real `Co-Authored-By: Claude` trailer
#               through untouched; `-m0` did the same to `scan`. LC_ALL=C fixes
#               how bytes are interpreted and does nothing about this.
#   IFS         word splitting on captured output.
#   umask       the run directory and the in-place temp are created here.
#
# This is a departure from an earlier note in this file which argued PATH was
# the caller's problem. That reasoning does not survive the threat model the
# rest of the file is written to: if an imported function is worth `bash -p`,
# then the same substitution through PATH is worth pinning.
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH
GREP_OPTIONS=''
export GREP_OPTIONS
IFS=$' \t\n'
umask 077
#
# `$BASH_ENV` is the one channel the block above cannot reach: non-interactive
# bash sources it BEFORE line one, so a startup file containing `exit 0` ends
# the run successfully having executed no script line at all. `-p` does not
# process it, which is why the shebang carries `-p` and why the documented
# invocation is `/bin/bash -p scripts/run-skill.sh …`. Residual, stated plainly:
# `bash sanitize-pr-content.sh …` bypasses the shebang, and in that form a
# hostile $BASH_ENV still wins.
set -euo pipefail

# Tracing is disabled before anything reads the file, and this is a security
# control rather than tidiness: with `xtrace` inherited (an exported SHELLOPTS,
# or a caller that turned it on), bash writes every expansion to stderr —
# including the whole matching line held in `out`. That defeats the redaction in
# report(), which exists precisely because a PR body can carry a token
# (rules/security.md, Anchor Register #2). `set +v` covers the verbose variant.
set +x
set +v

MODE="${1:?Usage: sanitize-pr-content.sh <title|body|body-inplace|scan> <file>}"
FILE="${2:?Usage: sanitize-pr-content.sh <title|body|body-inplace|scan> <file>}"

die() { echo "sanitize-pr-content: $1" >&2; exit 2; }

# The policy source is resolved from this file's own location — after symlink
# resolution — and from nothing else. `PLUGIN_ROOT` is deliberately not
# consulted even though run-skill.sh exports it: it is an environment variable,
# so honouring it would let a caller point the enforcement point at a guard
# declaring three never-matching patterns and get exit 0 on a real trailer.
# run-skill.sh sets it to exactly the directory computed here, so the documented
# entrypoint resolves identically — what is removed is the ability to make it
# resolve differently.
#
# The boundary, stated exactly: what no self-location scheme can defend against
# is any invocation whose path is not this file's real location — a copy, a
# hardlink, or any tree the caller planted. "A different file" is the wrong line
# to draw: a hardlink is the SAME file, `[ -L ]` is false for it, and it selects
# the guard beside it just as a copy does. There is no portable way for a shell
# script to reach its own inode-truth, so this is residual by construction, not
# an omission. The control that does hold is the documented entrypoint:
# `scripts/run-skill.sh` builds an absolute `TARGET` after resolving its OWN
# symlink chain physically, so a caller going through it cannot aim this script
# at a planted tree in the first place. The resolution is load-bearing rather
# than incidental: unresolved, a symlink to the wrapper dropped at
# <planted>/scripts/run-skill.sh selected <planted>/skills/…/the attacker's copy.
# The test harness relies on exactly the residual case.
# `$0` is the path the CALLER used, not where this file lives, and bash does not
# resolve symlinks in it — so a symlink (or a relative `$0` from inside a
# crafted tree) would still let the caller choose which guard the policy comes
# from. Resolve the link chain first, and use `cd -P`/`pwd -P` so a symlinked
# parent directory cannot reintroduce the same choice.
SELF="${BASH_SOURCE[0]:-$0}"
# The cap is defensive: a symlink cycle makes the kernel fail the `exec` with
# ELOOP before this script runs, so the loop is not reachable in a cycle today.
# It costs one line and removes the need to re-derive that each time.
HOPS=0
while [ -L "$SELF" ]; do
  HOPS=$((HOPS + 1))
  [ "$HOPS" -le 40 ] || die "too many symbolic links resolving the script's own path"
  link="$(readlink -- "$SELF")" || die "could not resolve the script's own path at $SELF"
  # `${link#/}` differs from `$link` exactly when the link target is absolute.
  # Written as a parameter expansion rather than `case "$link" in /*)` because a
  # line-initial `/*` is read as a C block-comment opener by
  # scripts/check-comment-blocks.js, which then counts the rest of the file as
  # one comment block. The construct is legal shell; the checker is what cannot
  # tell them apart — see the note in the r2 request doc.
  if [ "${link#/}" != "$link" ]; then
    SELF="$link"
  else
    SELF="$(dirname -- "$SELF")/$link"
  fi
done
SCRIPT_DIR="$(CDPATH='' cd -P -- "$(dirname -- "$SELF")" && pwd -P)" || die "could not resolve the script's own directory from $SELF"
ROOT="$(CDPATH='' cd -P -- "$SCRIPT_DIR/../../.." && pwd -P)" || die "could not resolve the plugin root from $SCRIPT_DIR"
GUARD="$ROOT/scripts/commit-msg-guard.sh"

[ -f "$FILE" ]  || die "file not found: $FILE"
[ -r "$FILE" ]  || die "file not readable: $FILE"
[ -f "$GUARD" ] || die "canonical pattern source not found: $GUARD"

# Read the canonical PATTERNS array without executing the guard (it runs its
# check on invocation and would need a commit-message argument).
BLOCK="$(sed -n '/^PATTERNS=(/,/^)/p' "$GUARD")" || die "could not read the pattern block from $GUARD"

# Every line inside the array — not just the ones this parser happens to
# recognize. A future entry written as "double quoted", $'ANSI-C', or with
# different indentation is a VALID bash array element that this parser would
# skip; counting only recognized lines would let parsed and declared agree
# while a pattern silently stopped being enforced. Anything between the
# delimiters that is not a recognized entry is therefore an error, not a
# comment to ignore.
# Split a string into SPLIT_LINES[] on newlines, in THIS shell.
#
# Why none of the three obvious constructs: process substitution is a PARSE
# error under POSIXLY_CORRECT, a here-string needs a writable TMPDIR on the
# bash 3.2 macOS ships, and a pipeline runs the loop in a subshell where `die`
# and the loops' variables are lost. Each was measured, and each broke
# something real — see docs/features/create-pr-stacked/2-tech-spec.md §3.4
# item 20 for the measurements and the two denials they caused.
#
# `set -f` is mandatory, not tidiness: the unquoted expansion that DOES the
# split would otherwise glob, and the patterns being split contain `*`.
# Read back as ${SPLIT_LINES[@]+"${SPLIT_LINES[@]}"}, never bare: under `set -u`
# bash 3.2 treats "${arr[@]}" of an EMPTY array as unbound and aborts with
# status 1 — a status this script has already given a different meaning.
SPLIT_LINES=()
sd0x_split_lines() {
  local sd0x_ifs=$IFS sd0x_glob=''
  case "$-" in *f*) sd0x_glob=on ;; esac
  IFS=$'\n'
  set -f
  # Unquoted on purpose: this expansion IS the split.
  # shellcheck disable=SC2206
  SPLIT_LINES=($1)
  [ -n "$sd0x_glob" ] || set +f
  IFS=$sd0x_ifs
}

ENTRIES=0
UNPARSED=''
sd0x_split_lines "$BLOCK"
for line in ${SPLIT_LINES[@]+"${SPLIT_LINES[@]}"}; do
  case "$line" in
    'PATTERNS=('|')'|'') continue ;;
  esac
  # A trailing comment line inside the array is the one benign form.
  case "$line" in
    '#'*|'  #'*) continue ;;
  esac
  ENTRIES=$((ENTRIES + 1))
  case "$line" in
    # Shape alone is not enough: `  'A' 'B'` is a legal bash array line
    # declaring TWO elements, and it satisfies every check below — the shape
    # matches, ENTRIES counts 1, and the extraction yields the single mangled
    # regex `A' 'B`. Both real patterns then stop being enforced while parsed
    # and declared agree. So an entry line carrying more than the two quotes of
    # a single element is unparseable here, not a pattern. The cost is that a
    # regex legitimately containing a quote (`'don'\''t.*GPT'`) is rejected too,
    # with a message that says "unrecognized entry" rather than "this parser
    # cannot express quotes" — but the extraction below would have mangled that
    # entry anyway, so aborting is the correct disposition, not a regression.
    "  '"*"'"*"'"*) UNPARSED="$UNPARSED
    $line" ;;
    "  '"*"'") ;;
    *) UNPARSED="$UNPARSED
    $line" ;;
  esac
done

[ -z "$UNPARSED" ] || die "unrecognized entry in $GUARD PATTERNS — refusing to enforce a policy it cannot fully read:$UNPARSED"

# The extraction is materialized through an assignment, so the pipeline's exit
# status is checked before anything reads its output. Feeding a loop straight
# from the producer — `while … done < <(cmd)`, whatever the loop construct —
# discards that status entirely, so `set -euo pipefail` cannot see a failing
# `sed`. A
# `sed` that emits weakened patterns and *then* fails would satisfy every count
# check below while the enforced policy is no longer the guard's — output
# validation cannot stand in for exit-status validation.
EXTRACTED="$(printf '%s\n' "$BLOCK" | sed -n "s/^  '\(.*\)'\$/\1/p")" \
  || die "could not extract the pattern entries from $GUARD — refusing to enforce a policy it could not read"

PATTERNS=()
sd0x_split_lines "$EXTRACTED"
for pat in ${SPLIT_LINES[@]+"${SPLIT_LINES[@]}"}; do
  [ -n "$pat" ] && PATTERNS+=("$pat")
done

# Two further ways the policy could silently shrink: reading nothing at all,
# and reading fewer entries than the array contains. Both fail closed —
# enforcing a subset looks exactly like enforcing the whole set to the caller.
[ "${#PATTERNS[@]}" -ge 3 ] \
  || die "expected at least 3 patterns in $GUARD, parsed ${#PATTERNS[@]} — refusing to pass content unchecked"
[ "${#PATTERNS[@]}" -eq "$ENTRIES" ] \
  || die "parsed ${#PATTERNS[@]} of $ENTRIES entries in $GUARD — refusing to enforce a subset"

# Match one pattern at a time so a failure can be attributed to it, and so a
# single invalid ERE cannot silently disable the whole set.
#   0 = matched · 1 = clean · anything else = grep could not answer
# Treating "could not answer" as "clean" is the fail-open this guards against.
# Emits "<line-number> <pattern-index>" per hit; never the matching text.
matched_lines() {
  local pattern_index=1 out status found=1
  for pat in "${PATTERNS[@]}"; do
    set +e
    # `-a`: without it a NUL byte anywhere in the body makes grep print
    # "Binary file <path> matches" instead of "<n>:<line>". The location parse
    # below then yields `Binary`, awk's skip set gets a key that matches no
    # FNR, and body/body-inplace emit the content UNCHANGED while logging
    # [AI_STRIPPED] and exiting 0 — the removal modes are exactly the ones
    # `gh pr edit --body-file` consumes.
    #
    # `LC_ALL=C`: in a UTF-8 locale BSD grep (`/usr/bin/grep`, the macOS
    # default) treats a line carrying a byte that is not valid UTF-8 as
    # non-matching and returns 1 — the CLEAN branch, not the "could not
    # answer" one. Measured: a body whose trailer line reads
    # `Caf\xe9 Co-Authored-By: Claude <…>` scans exit 0 under LANG=en_US.UTF-8
    # and exit 4 under LC_ALL=C. A latin-1 byte in a commit message is
    # ordinary, and PR bodies are generated from commit messages, so this is
    # a reachable total bypass rather than a theoretical one. The policy is a
    # byte-level ERE; matching it byte-wise is also the semantics it wants.
    out="$(LC_ALL=C grep -Eina -e "$pat" -- "$FILE")"
    status=$?
    set -e
    case "$status" in
      0)
        found=0
        # Every hit must be `<line-number>:<text>`. A location that is not a
        # line number means grep answered in a format this function cannot
        # use — and taking it anyway is how a non-numeric key reached awk's
        # skip set, stripping nothing while reporting [AI_STRIPPED].
        #
        # Validated inside this loop rather than by a separate `… | grep -q`
        # pass: `grep -q` exits at its first match, `printf` then takes EPIPE,
        # and under `pipefail` the pipeline reports printf's status — so the
        # `&&` never fires and the check silently does nothing once grep's
        # output exceeds the pipe buffer. This shape reads every line. It
        # splits into an array first, so the loop runs in this function's own
        # shell and `die` is not swallowed by a subshell. The offending token
        # is not echoed: in the binary-file form it is a path.
        sd0x_split_lines "$out"
        for hit in ${SPLIT_LINES[@]+"${SPLIT_LINES[@]}"}; do
          [ -n "$hit" ] || continue
          case "${hit%%:*}" in
            ''|*[!0-9]*) die "grep answered in an unparseable format on pattern $pattern_index — refusing to report content as clean" ;;
          esac
          echo "${hit%%:*} $pattern_index"
        done
        ;;
      1) ;;
      *) die "grep failed with status $status on pattern $pattern_index — refusing to report content as clean" ;;
    esac
    pattern_index=$((pattern_index + 1))
  done
  return "$found"
}

# Diagnostics name the location and the pattern, never the line. A matching
# line is attacker-influenced and can carry a token — rules/security.md forbids
# logging one, and the line number is enough to find it in the file.
report() {
  local tag="$1" status
  # Same 0/1/>1 split as sanitized_body: "clean" must not look like a failure
  # to set -e, and a failed scan must not look like "nothing to report".
  set +e
  matched_lines | while read -r lineno index; do
    echo "[$tag] line $lineno matched pattern $index (content withheld — it may carry a secret)" >&2
  done
  status=$?
  set -e
  # Defence in depth, and deliberately not load-bearing: every mode reaches
  # matched_lines or sanitized_body first, and both already abort on a failed
  # scan, so no test can distinguish this check's removal. It stays so the
  # function is safe on its own terms rather than by call-order coincidence.
  [ "$status" -le 1 ] || die "pattern matching failed with status $status — refusing to report content as clean"
}

sanitized_body() {
  local raw drop kept status
  # The scan's status is captured on its own, BEFORE any transform touches its
  # output. Status 1 is "clean", which is ordinary; anything above it is "grep
  # could not answer", and a blanket `|| true` would collapse the two.
  #
  # Reading that status off the end of `matched_lines | cut | sort | paste`
  # cannot work, and this is the shape that was here: under `pipefail` a
  # pipeline reports the LAST nonzero component, so a `cut` failing with 1
  # masks a scan that died with 2 — and 1 is "clean" to the check below.
  # Measured: with `cut` exiting 1 the hostile body was emitted UNCHANGED at
  # exit 0 while [AI_STRIPPED] was logged, on the mode `gh pr edit --body-file`
  # consumes. Splitting the capture from the transforms is what fixes it.
  set +e
  raw="$(matched_lines)"
  status=$?
  set -e
  [ "$status" -le 1 ] || die "pattern matching failed with status $status — refusing to emit a body reported as clean"
  # The transforms are now their own pipeline, with nothing to launder: any of
  # cut/sort/paste failing aborts here instead of yielding an empty strip set.
  drop="$(printf '%s\n' "$raw" | cut -d' ' -f1 | sort -n -u | paste -sd, -)" \
    || die "could not build the list of lines to strip from $FILE"
  # Every failure below is reported as 2. `set -e` would already abort here, but
  # with awk's or cat's own status — and 1 is "title rejected"'s neighbour, not
  # a usage failure. The caller's contract is that anything other than the
  # documented verdicts (0/3/4) is 2, so the utilities are normalized onto it.
  if [ -n "$drop" ]; then
    kept="$(awk -v drop="$drop" '
      BEGIN { n = split(drop, a, ","); for (i = 1; i <= n; i++) skip[a[i]] = 1 }
      !(FNR in skip)
    ' "$FILE")" || die "could not strip the matched lines from $FILE"
  else
    kept="$(cat -- "$FILE")" || die "could not read $FILE"
  fi
  # If stripping removed every line that carried content, keep the template
  # structure rather than publishing an empty body. The emptiness test runs
  # through its own variable: inside `[ -z "$(… | tr …)" ]` a failing `tr`
  # produces no output, which reads as "empty" — so a missing or broken `tr`
  # would silently replace a perfectly good body with the bare skeleton and
  # exit 0, and in body-inplace that result is what overwrites the file.
  local body
  # LC_ALL=C so a byte that is not valid in the caller's locale (a latin-1
  # `Café` in the body) is treated as a byte rather than aborting the run with
  # "Illegal byte sequence" — fail-closed, but it turns an encoding quirk into a
  # /create-pr abort on a body the skill is otherwise happy with.
  body="$(printf '%s' "$kept" | LC_ALL=C tr -d '[:space:]#')" || die "could not test the sanitized body for emptiness"
  if [ -z "$body" ]; then
    printf '## Summary\n\n## Test plan\n'
  else
    printf '%s\n' "$kept"
  fi
}

case "$MODE" in
  title|scan)
    # Detection only. A title is regenerated or the run is aborted by the
    # caller; published content that still matches is a leak, not something to
    # silently rewrite.
    if matched_lines >/dev/null; then
      report AI_DETECTED
      [ "$MODE" = title ] && exit 3
      exit 4
    fi
    exit 0
    ;;
  body)
    report AI_STRIPPED
    sanitized_body
    exit 0
    ;;
  body-inplace)
    # The safe persist step, and the reason it exists: `... body file > file`
    # truncates the input before the sanitizer reads it, so the caller would
    # publish an empty body. The replacement goes through a sibling temp file
    # and an atomic rename instead.
    report AI_STRIPPED
    tmp="$(mktemp -- "${FILE}.sanitized.XXXXXX")" || die "could not allocate a temp file beside $FILE"
    # INT/TERM/HUP as well as EXIT: the temp file holds the same private body
    # as the original, so an interrupted run must not leave a copy of it
    # behind. The signal handlers exit rather than falling through — otherwise
    # execution resumes, writes into a deleted fd, and the run ends on
    # whatever `mv` happens to report.
    trap 'rm -f -- "$tmp"' EXIT
    trap 'rm -f -- "$tmp"; exit 130' INT
    trap 'rm -f -- "$tmp"; exit 143' TERM
    trap 'rm -f -- "$tmp"; exit 129' HUP
    sanitized_body > "$tmp" || die "could not write the sanitized body beside $FILE"
    mv -- "$tmp" "$FILE" || die "could not replace $FILE with the sanitized body"
    trap - EXIT INT TERM HUP
    exit 0
    ;;
  *)
    die "unknown mode '$MODE' (expected title, body, body-inplace or scan)"
    ;;
esac
