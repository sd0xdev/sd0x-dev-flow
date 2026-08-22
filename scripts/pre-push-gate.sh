#!/usr/bin/env -S bash -p
# pre-push-gate.sh - Terminal confirmation gate for protected-branch pushes AND for ref updates
# that rewrite history — two independent classes, asking two different questions. The second
# covers unprotected branches and existing tags, so "protected branch gate" understates it.
# Installed as the git pre-push hook by /codex-setup. /install-scripts only copies
# this file into .claude/scripts/; it never wires up a hook. Manual install:
#   cp scripts/pre-push-gate.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push
#
# Bypass env vars (ALLOW_PUSH_PROTECTED, ALLOW_FORCE_WITH_LEASE, ALLOW_FORCE_UNSHARED), which
# push each authorizes, and why the last is developer-set only: rules/git-workflow.md
# § Push safety — the authority, not a copy of it.
#
# git hands the hook <remote-name> <remote-url> on argv, and one line per pushed ref on stdin:
#   <local-ref> <local-sha> <remote-ref> <remote-sha>
# ── Re-exec in privileged mode ────────────────────────────────────
# NOTHING may run above this block, `set -euo pipefail` included. Every decision here is a
# `case` (reserved word) and every abort a `${x:?}` (fails during expansion, before command
# lookup), because `[`, `builtin`, `command`, `exec`, `exit`, `set` and `test` can each be
# answered by a function imported from the environment.
# $BASH_ENV is sourced before line 1, so nothing in this file is early enough to disarm it —
# hence `-p` on the shebang, the only place it CAN be carried, and `-S` so it fits there at all.
# The credential is the ARGUMENT COUNT, never the env marker.
# Executed, never sourced — a refusal, not a defence, and it does not stop a forged `$0`.
# All of it: docs/features/push-gate-optin/4-implementation.md §§ 4.2, 4.3.
case "${BASH_SOURCE[0]:-$0}" in
  "$0") ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?pre-push-gate: must be executed, not sourced}" ;;
esac
case "$#:${SD0X_PRIV_REEXEC:-}" in
  0:*|1:*|2:*|*:)
    # Three sentinels, so one hop reaches `>= 3` from any starting count — git gives 2; 0 and 1
    # are only reachable by hand, and appending (never prepending) leaves $1 where it was.
    # Started as an ordinary command, NOT through `exec`. `exec` is a builtin, a builtin is
    # shadowed by a function imported from the environment, and that environment is the channel
    # this very block exists to close — so the one command that establishes the credential was
    # the one command an attacker could stand in front of. A shadow that RETURNS lands on the
    # fuse below; one that EXITS ends the hook successfully before a single ref is read, and no
    # code placed after `exec` can catch that. Measured 2026-08-21: with
    # `BASH_FUNC_exec%%='() { exit 0; }'` in the environment, a protected-branch push the gate
    # refuses with exit 1 was accepted with exit 0 and no output at all. Nothing can stand in
    # front of the line below within THIS shell, because bash refuses to import a function
    # whose name contains a slash (measured) — the remaining channel is a BASH_ENV file, which
    # may define one, and the shebang's `-p` is what closes it. The cost is one extra live
    # process.
    /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV -u ENV 'SD0X_PRIV_REEXEC=1' \
      "${BASH:-/bin/bash}" -p -- "${BASH_SOURCE[0]:-$0}" "$@" \
      --sd0x-privileged --sd0x-privileged --sd0x-privileged
    # The privileged pass has now run to completion, and its status is the hook's answer —
    # delivered by ENDING HERE rather than by a terminator. There is no `exit $?` on this line
    # because `exit` is a builtin like every other, and the fix for `exec` two paragraphs up
    # was the same defect one command later: measured 2026-08-22, `BASH_FUNC_exit%%='() {
    # builtin exit 0; }'` made the parent return 0 while the child printed its refusal, so the
    # push git saw was approved by a hook whose own output says it refused. Falling off the end
    # of the script needs no command at all: bash exits with the status of the last one it ran,
    # which is the child. The whole rest of the file therefore lives in the OTHER branch below,
    # unreachable from here, so this branch's last executed command is the launch above.
    ;;
  *)
# Second pass, reached only via the exec above. Neither check can fire on a legitimate setting:
# our own re-exec always yields `p`, and it strips BASH_ENV — which bash never sets itself.
# They are the residual assurance that the exec took, not the credential; the count is.
case "$-" in
  *p*) ;;
  *) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?pre-push-gate: cannot establish bash privileged mode}" ;;
esac
case "${BASH_ENV+x}" in
  x) SD0X_PRIV_GUARD=''
     : "${SD0X_PRIV_GUARD:?pre-push-gate: cannot establish bash privileged mode}" ;;
esac
# Left exported, the marker is a denial of service on a legitimate setup: a descendant started
# as an ordinary `bash <script>` inherits it, skips its own re-exec, has no `p`, and aborts on
# the check above. Safe here for the reason it looks safe — our own re-exec ran, so no function
# was imported and `unset` is the builtin.
unset SD0X_PRIV_REEXEC

# Safe here and only here: `bash -p` imported no functions, so this is the builtin.
set -euo pipefail

# The gate asks git one question about topology — is the remote tip contained in what replaces
# it — and git answers it against a *rewritten* graph if the environment or the repository says
# to. Three channels, three different closers, and **unset is the wrong instrument for two of
# them**: `unset GIT_GRAFT_FILE` restores git's *default* graft path, `$GIT_DIR/info/grafts`,
# closing the environment channel by opening the repository one, and `GIT_NO_REPLACE_OBJECTS`
# unset restores git's default of *honouring* replacements (r5 records a round spent enabling
# that by accident). Only a positive value closes either.
#
#   GIT_GRAFT_FILE  ·  $GIT_DIR/info/grafts  -> GIT_GRAFT_FILE=/dev/null (one closer, both)
#   refs/replace/*                           -> GIT_NO_REPLACE_OBJECTS=1
#
# The end-to-end measurement behind those two lines — real bare remote, this hook wired, a
# `.git/info/grafts` that walks `main` past both gates, and why `ALLOW_PUSH_PROTECTED=1` is part
# of it rather than incidental — is recorded once, in
# `docs/features/push-gate-optin/4-implementation.md` § 4.3.
#
# Four names are deliberately NOT normalized here — two that can only make ancestry unprovable
# (the fail-closed side of the `!` below), and the transport variables, which decide the
# destination outright yet cannot reach any verdict this script computes. Why, measured:
# `docs/features/push-gate-optin/4-implementation.md` § 4.22.
export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1
unset GIT_REPLACE_REF_BASE

REMOTE="${1:-origin}"
# `$2` is the destination git resolved for THIS push, and the binding block below is what reads it.
# It sat here commented `unused` until 2026-08-22, which is what made the destination race look
# irreducible from inside the client — it is not; git hands the answer over.

# git passes the destination *location* as $1 when the push names no remote, so $1 is the URL
# itself — credentials included. Both prompts below print it, and a prompt is exactly where a token
# must not appear (`rules/security.md`, Anchor Register #2). Redact once; print only the redaction.
# Three credential-bearing components, each masked whole: userinfo — split at the LAST `@` inside
# the authority, because git parses it that way and the first `@` leaves the tail of a password
# behind — plus query and fragment. The second arm below covers the scp-like form, which also has a
# user field; a remote *name* matches neither arm and passes through untouched.
# What redaction costs: two destinations differing only inside a masked component read alike. For
# userinfo that merges two credentials for one repository, never two repositories. For query and
# fragment the loss is real where a host identifies the repository by parameter — accepted, since
# the alternative is printing the token. Scheme, host and path are never masked, so a redirect to a
# different repository stays visible. Same transformation as the `PUSH_URLS_SAFE` blocks in
# `skills/push-ci/SKILL.md` and `skills/epic-merge/SKILL.md`; keep the three in step.
# A function and not an inline block, because `$2` needs the identical treatment for the binding
# message below. Two copies of a redactor is how one of them ends up a version behind, and this one
# is the copy the other two files are told to stay in step with.
redact_dest() {   # reads $1, writes REDACTED
  local REST AUTH _pre
  REDACTED=$1
  case "$REDACTED" in
  *://*)
    REST=${REDACTED#*://}; AUTH=${REST%%/*}; AUTH=${AUTH%%\?*}; AUTH=${AUTH%%\#*}
    case "$AUTH" in
      *@*) REDACTED="${REDACTED%%://*}://<redacted>@${AUTH##*@}${REST#"$AUTH"}" ;;
    esac
    case "$REDACTED" in
      *\?*) REDACTED="${REDACTED%%\?*}?<redacted>" ;;
      *\#*) REDACTED="${REDACTED%%\#*}#<redacted>" ;;
    esac
    ;;
  *:*)
    # scp-like `[user@]host:path`. git reads a destination this way when the first `:` precedes any
    # `/`, and that syntax has a user field too. The `*://*` arm above cannot reach it — no scheme —
    # so before this arm existed every scp-like user printed verbatim. `git@` is not a secret; the
    # *field* is not the convention, and `<token>@code.example:team/repo.git` is a legal destination
    # whose user is a credential (`rules/security.md`, Anchor Register #2). Masking is therefore
    # unconditional: a rule that guessed which users look secret would be wrong the first time
    # somebody used a host this convention does not cover.
    # The `*/*` guard is what separates the two readings of `:` — git treats a `:` as scp-like only
    # when no `/` comes first, so `./rel/a@b/c.git` and `/local/path:name` are paths, not hosts, and
    # fall through unchanged. `C:/win/repo.git` is likewise untouched: its prefix `C` has no `@`.
    # Nothing identifying is lost — the user field never names the repository, and host and path stay
    # visible, which is the property the paragraph above turns on.
    _pre=${REDACTED%%:*}
    case "$_pre" in
      */*) ;;
      *@*) REDACTED="<redacted>@${_pre##*@}:${REDACTED#*:}" ;;
    esac
    ;;
  esac
}
redact_dest "$REMOTE"; REMOTE_SAFE=$REDACTED

# ── Destination binding ────────────────────────────────────────────
# The race this closes: an approval names a destination, and between the naming and the push a
# `.git/config` edit or a `url.<x>.pushInsteadOf` rewrite sends the objects elsewhere. The two
# authorized skills re-read the destination immediately before pushing and compare, which narrows
# the window to that fence — it cannot close it, because their re-read is a different process from
# the push. The claim that this is therefore irreducible client-side was wrong, and this block is
# the correction: git resolves the destination INSIDE the pushing process and hands it here as `$2`.
#
#
# The variable carries a SET — one SHA-256 per approved destination, whitespace separated — and
# membership is the test. Three properties hold, none optional: monotone (unset ⇒ nothing happens),
# fail-closed (set but unverifiable ⇒ refuse), and not an attestation (it never substitutes for a
# `/dev/tty` prompt).
#
# **What this block assumes, stated because the block below defends the function channel and not
# this one**: that PATH resolves to genuine `git` and a genuine digest tool. Every check in this
# file runs a PATH-resolved binary — `git merge-base` decides the force class too — so a PATH shim
# defeats the whole gate, not this binding in particular, and `bash -p` closes the imported-function
# channel only. The known-answer test below therefore raises the floor rather than closing a hole.
#
# The measurements behind each of those — `$1` vs `$2` under a rewrite, one hook call per push URL,
# why SHA-256 rather than `git hash-object`, what the receivepack check below does and does not
# catch, and why the two authorized skills now spell `--receive-pack=git-receive-pack`: see
# docs/features/push-gate-optin/4-implementation.md § 4.6.
sha256_raw() {   # reads stdin, writes one line containing the hex digest; nonzero if unavailable
  if command -v sha256sum >/dev/null 2>&1; then sha256sum
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256
  else return 1
  fi
}
sha256_hex() {  # reads $1, writes the bare hex the selected tool produced (no shape check)
  local _h=
  _h=$(printf '%s' "$1" | sha256_raw 2>/dev/null) || _h=
  _h=${_h##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _h=${_h%% *}      # sha256sum / shasum: `<hex>  -`
  printf '%s' "$_h"
}
# Known-answer test. A tool that answers with one constant whatever it is fed makes every
# destination compare equal to every approval, which is the failure mode a shape check cannot see:
# a constant is well-shaped. Two vectors, one empty and one not, because `digest_of` returns early
# on empty input and a tool could differ on the two paths.
#
# What this does NOT do is defeat an input-aware shim: the vectors are in this file, so a shim that
# special-cases them passes. It moves the attack from "return a constant" to "impersonate SHA-256
# for these inputs", and the PATH precondition above is what actually carries that weight.
sha256_kat() {
  [ "$(sha256_hex '')" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ] \
    && [ "$(sha256_hex abc)" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]
}
DIGEST_TOOL_OK=
digest_of() {   # reads $1, writes DIGEST — 64 lowercase hex characters, or empty
  local _d=
  DIGEST=
  [ -n "${1:-}" ] || return 0
  # Run the known-answer test once and remember the answer, so a refusal can say WHICH failure it
  # is. Folding a lying tool into the same "unresolvable" as a missing one would report the least
  # alarming of two very different causes.
  if [ -z "$DIGEST_TOOL_OK" ]; then
    if sha256_kat; then DIGEST_TOOL_OK=yes; else DIGEST_TOOL_OK=no; fi
  fi
  [ "$DIGEST_TOOL_OK" = yes ] || return 0
  _d=$(printf '%s' "$1" | sha256_raw 2>/dev/null) || _d=
  _d=${_d##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _d=${_d%% *}      # sha256sum / shasum: `<hex>  -`
  # The shape check is the fail-closed step, not a tidy-up: a present-but-broken tool (a `shasum`
  # whose perl is missing its digest module) exits nonzero with diagnostics on stdout, and without
  # this the diagnostic itself would become the digest and simply never match.
  case "$_d" in
    *[!0-9a-f]*|'') _d= ;;
    *) [ ${#_d} -eq 64 ] || _d= ;;
  esac
  DIGEST=$_d
}
if [ -n "${SD0X_PUSH_DEST_DIGEST:-}" ]; then
  # `$2` is git's, not ours — the re-exec above appends its sentinels AFTER `"$@"`, so a two-argument
  # invocation keeps them at `$3`..`$5`. A caller that passed only a remote name would leave `$2`
  # holding the first sentinel, and hashing that would report `--sd0x-privileged` as the destination
  # git is about to reach. Excluding it by name keeps the refusal honest about WHY it refused;
  # the outcome was already fail-closed, the message was not.
  DEST_URL=${2:-}
  case "$DEST_URL" in --sd0x-privileged) DEST_URL= ;; esac
  digest_of "$DEST_URL"; DEST_DIGEST=$DIGEST
  # Measured 2026-08-22: with `remote.origin.receivepack` pointing at a program that execs
  # `git-receive-pack` on a DIFFERENT repository, `git push origin main` reported
  # `To <A> * [new branch] main -> main` while every object landed in `<B>` and `<A>` stayed empty.
  # `$2` is `<A>` throughout, so the URL digest matches and says nothing about where the objects go.
  #
  # **This check is best-effort, and the boundary is measurable.** git runs this hook only after the
  # ref advertisement, so the transport — receive-pack included — is already selected and running by
  # the time the config is read here. Measured 2026-08-22: a wrapper that runs
  # `git config --unset remote.origin.receivepack` and then execs `git-receive-pack <B>` left this
  # read seeing nothing, git reporting success against `<A>`, and every object in `<B>`. What closes
  # that for the two authorized skills is not this read but their push line, which spells
  # `--receive-pack=git-receive-pack` — a command-line value overrides the configured one (measured;
  # `-c remote.<name>.receivepack=` does NOT, git keeps the config value and says "more than one
  # receivepack given, using the first"). This read remains worth doing for the pushes those skills
  # do not issue, where the static case is the whole of what is there.
  #
  # A remote name is the only case with config to read; a URL argument has none. Deciding which
  # `$1` is was done by SYNTAX until round 58, and that was wrong: `git remote add foo/bar <url>`
  # is accepted and `remote.foo/bar.receivepack` is honoured (measured 2026-08-22), so treating
  # every value containing `/` as a path skipped the config lookup for a perfectly ordinary remote.
  # Ask git instead of pattern-matching — `git remote` lists exactly the names that have config.
  DEST_REMOTE_NAME=
  case "$REMOTE" in
    ''|--sd0x-privileged) ;;
    *)
      _remotes=$(git remote 2>/dev/null) || _remotes=
      while IFS= read -r _rn; do
        [ "$_rn" = "$REMOTE" ] || continue
        DEST_REMOTE_NAME=$REMOTE
        break
      done <<SD0X_REMOTES
$_remotes
SD0X_REMOTES
      ;;
  esac
  DEST_RP=
  case "$DEST_REMOTE_NAME" in
    '') ;;
    *) DEST_RP=$(git config --get "remote.$DEST_REMOTE_NAME.receivepack" 2>/dev/null) || DEST_RP= ;;
  esac
  DEST_OK=no
  if [ -n "$DEST_DIGEST" ]; then
    for _approved in $SD0X_PUSH_DEST_DIGEST; do
      if [ "$_approved" = "$DEST_DIGEST" ]; then DEST_OK=yes; break; fi
    done
  fi
  if [ -n "$DEST_RP" ]; then
    # The value is NOT printed. It is a command line, and a command line carries `--token=`,
    # `--password=` and their kind; `rules/security.md` forbids logging those, and a refusal
    # diagnostic lands in stderr and in agent transcripts alike. The key name is what the operator
    # needs, and reading the value is one command they run themselves.
    echo "pre-push-gate: remote.$DEST_REMOTE_NAME.receivepack is configured, so the URL the" >&2
    echo "approval covered does not decide where the objects land." >&2
    echo "  read it with: git config --get remote.$DEST_REMOTE_NAME.receivepack" >&2
    echo "Refusing. Unset it, or push without the destination binding." >&2
    exit 1
  fi
  if [ "$DEST_OK" != yes ]; then
    redact_dest "$DEST_URL"
    echo "pre-push-gate: git is about to push to a destination the approval did not cover." >&2
    echo "  approved: $SD0X_PUSH_DEST_DIGEST" >&2
    echo "  actual:   ${DEST_DIGEST:-unresolvable}  (${REDACTED:-<destination not supplied>})" >&2
    if [ "${DIGEST_TOOL_OK:-}" = no ]; then
      echo "  the SHA-256 tool resolved from PATH failed a known-answer test, so no digest computed" >&2
      echo "  here can be trusted — this is a refusal about the tool, not about the destination." >&2
    fi
    echo "Refusing. Re-run the approval against the destination configured now." >&2
    exit 1
  fi
fi

# ── Protected branch patterns ──────────────────────────────────────
PROTECTED_EXACT=("main" "master" "develop")
# release/* matched separately via prefix

is_protected() {
  local branch="$1"
  for p in "${PROTECTED_EXACT[@]}"; do
    if [ "$branch" = "$p" ]; then
      return 0
    fi
  done
  if [[ "$branch" == release/* ]]; then
    return 0
  fi
  return 1
}

# ── Read stdin for ref info ───────────────────────────────────────
BRANCHES_PUSHING=()
# Which refs are actually being rewritten, not merely whether any is. A push-wide
# boolean is enough to decide "refuse this push", which is all the non-fast-forward
# check below needs; it is not enough to name the refs an attestation is about. Asking
# an operator to vouch for a branch this push only creates or fast-forwards teaches
# them to answer without reading, which is the failure the prompt exists to avoid.
FORCE_REFS=()
# The tags among FORCE_REFS, kept apart for one reason only: the refusal message. A tag can
# be refused while being a textbook fast-forward, and the headline says "non-fast-forward".
FORCE_TAGS=()
HAS_FORCE_PUSH=false

# Git's null OID is all zeros at the repository's own hash width: 40 for SHA-1, 64 for
# SHA-256 (`git init --object-format=sha256`). A hard-coded 40-zero literal therefore
# reads a SHA-256 creation's 64-zero side as a real OID, and the ancestry test below
# fails on an object that does not exist — so the gate refused a brand-new branch as a
# force-push. Measured on git 2.55.0. Width-independent test: nonempty, nothing but zeros.
is_null_oid() {
  case "$1" in
    "") return 1 ;;
    *[!0]*) return 1 ;;
    *) return 0 ;;
  esac
}

# A branch update is a rewrite when the remote tip is not an ancestor of the local one.
# A tag is not a branch, and ancestry is the wrong question for it: git refuses ANY update
# to an existing refs/tags/* ref without --force, moving it *forward* included, because a
# tag names one commit rather than a line of history. Judging a tag by ancestry therefore
# waves through exactly the moves git itself classifies as forced.
is_tag_ref() {
  case "$1" in
    refs/tags/*) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS= read -r line; do
  # Skip empty lines
  [ -z "$line" ] && continue

  # Parse ref info: <local-ref> <local-sha> <remote-ref> <remote-sha>
  read -r local_ref local_sha remote_ref remote_sha <<< "$line"

  # Skip malformed lines (need at least remote_ref)
  [ -z "$remote_ref" ] && continue

  # Extract branch name from refs/heads/xxx
  branch="${remote_ref#refs/heads/}"

  BRANCHES_PUSHING+=("$branch")

  # Detect a ref rewrite. Creation and deletion are excluded by the null-OID tests (there is
  # no history to overwrite either way), and an unchanged ref by the equality test — git does
  # not normally list one, and flagging it would ask for an attestation about nothing.
  if [ -n "$remote_sha" ] && ! is_null_oid "$remote_sha" && \
     [ -n "$local_sha" ] && ! is_null_oid "$local_sha" && \
     [ "$remote_sha" != "$local_sha" ]; then
    if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null || is_tag_ref "$remote_ref"; then
      HAS_FORCE_PUSH=true
      # `$branch` is `$remote_ref` with a `refs/heads/` prefix stripped if it had one;
      # a tag or a note keeps its full ref name here, which is why the messages below
      # say "ref" rather than "branch". A forced tag update is still a rewrite of
      # something other people have.
      FORCE_REFS+=("$branch")
      if is_tag_ref "$remote_ref"; then
        FORCE_TAGS+=("$branch")
      fi
    fi
  fi
done

# ── Non-fast-forward push check ───────────────────────────────────
# Git hooks cannot distinguish --force from --force-with-lease (same ref data).
# Callers (e.g. /push-ci) set ALLOW_FORCE_WITH_LEASE=1 only when --force-with-lease
# is explicitly requested. Bare --force enforcement is at the caller level.
if [ "$HAS_FORCE_PUSH" = true ] && [ "${ALLOW_FORCE_WITH_LEASE:-}" != "1" ]; then
  echo "" >&2
  echo "pre-push-gate: Non-fast-forward push detected and blocked." >&2
  # A tag can land here while being a textbook fast-forward, so the headline above would
  # send its operator looking for a divergence that does not exist. The extra line is
  # printed only when a tag is actually in the set — the headline keeps its exact wording
  # for every other refusal, which is what the tests pin it by.
  if [ ${#FORCE_TAGS[@]} -gt 0 ]; then
    TAG_LIST=$(printf ", %s" "${FORCE_TAGS[@]}")
    # "force semantics", not the bare flag: `--force`, a satisfied `--force-with-lease`, and a
    # leading `+` in the refspec all update an existing tag, and the next line recommends the
    # second of them. Naming `--force` here would print a flag `rules/git-workflow.md` forbids.
    echo "  (${TAG_LIST:2}: git requires force semantics for ANY tag update, forward moves included.)" >&2
  fi
  echo "If using --force-with-lease: ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease ..." >&2
  echo "" >&2
  exit 1
fi

# ── Shared-branch attestation for force-form pushes ───────────────
# `rules/git-workflow.md` prohibits force-pushing a *shared* branch, but the protected
# set (main/master/develop/release/*) is only the part of "shared" a name can decide.
# A two-person `feat/*` head is shared and no name says so — and git cannot tell us:
# nothing in a ref line, an ancestry test or a lease check reports who else has the
# branch. So the class is defined by **attestation, not inference**: the operator says
# it, at the terminal, about the branch named back to them. That is the same primitive
# the protected gate uses and the reason it exists — /dev/tty is immune to the session
# permission caching that can auto-approve an in-session prompt.
#
# Placed after the non-fast-forward refusal and before the protected bypass. It asks
# only about the refs this push actually rewrites (FORCE_REFS), and only about the ones
# the protected gate below will not already ask about — so no single REF is asked about
# twice. That is the claim; "one push, one prompt" was the earlier wording and it was
# false: a push carrying a protected fast-forward AND an unprotected rewrite fires this
# prompt for the rewritten ref and then the protected one for the other, measured under a
# pty. Neither authorized skill can produce such a push — both push one refspec — but a
# manual push can, and a comment that overstates the property is how fd 3 and fd 4 came to
# be justified by a scoping argument that did not hold.
#
# That exclusion is conditional, and the condition is the whole of its justification:
# it holds because the protected gate reaches /dev/tty, and ALLOW_PUSH_PROTECTED=1
# makes that gate `exit 0` without asking anything. Under it, a protected force target
# has no other prompt to fall through to, so it belongs here. Writing the exclusion
# unconditionally left exactly that hole — ALLOW_PUSH_PROTECTED=1 together with
# ALLOW_FORCE_WITH_LEASE=1 force-pushed `main` past both gates in silence. The two
# variables answer different questions and neither may answer the other's.
if [ ${#FORCE_REFS[@]} -gt 0 ] && [ "${ALLOW_FORCE_UNSHARED:-}" != "1" ]; then
  UNSHARED_TARGETS=()
  for ref_name in "${FORCE_REFS[@]}"; do
    if [ "${ALLOW_PUSH_PROTECTED:-}" != "1" ] && is_protected "$ref_name"; then
      continue
    fi
    UNSHARED_TARGETS+=("$ref_name")
  done

  if [ ${#UNSHARED_TARGETS[@]} -gt 0 ]; then
    FORCE_LIST=$(printf ", %s" "${UNSHARED_TARGETS[@]}")
    FORCE_LIST="${FORCE_LIST:2}"

    echo "" >&2
    echo "pre-push-gate: Force-form push rewriting ref(s): ${FORCE_LIST}" >&2
    echo "Remote: ${REMOTE_SAFE}" >&2
    echo "Force-pushing a ref someone else also works on rewrites their history." >&2
    echo "" >&2

    if ! { exec 4</dev/tty; } 2>/dev/null; then
      echo "pre-push-gate: Cannot open /dev/tty — no interactive terminal in this environment." >&2
      echo "A force-form push needs an attestation that these refs are not shared." >&2
      # Both variables, because they are two gates and this one is the SECOND. Reaching this
      # message means ALLOW_FORCE_WITH_LEASE=1 was set on the invocation that printed it — but the
      # operator copies this line into a NEW command, where it is gone, and the earlier refusal at
      # § Non-fast-forward fires instead. A recovery hint that does not recover is worse than none.
      echo "To attest non-interactively: ALLOW_FORCE_WITH_LEASE=1 ALLOW_FORCE_UNSHARED=1 git push --force-with-lease ..." >&2
      echo "" >&2
      exit 1
    fi

    printf "Type 'yes' if nobody else works on %s: " "$FORCE_LIST" >&2
    ATTEST=""
    read -r ATTEST <&4 || true
    exec 4<&-

    if [ "$ATTEST" != "yes" ]; then
      echo "" >&2
      echo "pre-push-gate: Force push aborted — ref not attested as unshared." >&2
      exit 1
    fi
  fi
fi

# ── Protected branch gate ─────────────────────────────────────────
# Skip if bypass is set (scoped to protected branch confirmation only)
if [ "${ALLOW_PUSH_PROTECTED:-}" = "1" ]; then
  exit 0
fi

PROTECTED_TARGETS=()
# The count guard is not decoration. Under `set -u`, bash 3.2 — which is /bin/bash on every
# macOS — treats "${arr[@]}" on an EMPTY array as an unbound variable and aborts, so a push
# git listed no refs for (`git push` with nothing to send) would exit 1 here instead of the
# documented 0. bash 4.4+ made the empty expansion legal, which is why a test suite running
# a Homebrew bash sees none of this.
if [ ${#BRANCHES_PUSHING[@]} -gt 0 ]; then
  for branch in "${BRANCHES_PUSHING[@]}"; do
    if is_protected "$branch"; then
      PROTECTED_TARGETS+=("$branch")
    fi
  done
fi

# No protected branches in this push → allow
if [ ${#PROTECTED_TARGETS[@]} -eq 0 ]; then
  exit 0
fi

# ── Terminal confirmation ─────────────────────────────────────────
# Read from /dev/tty for terminal-level confirmation
# This is immune to Claude Code permission caching
BRANCH_LIST=$(printf ", %s" "${PROTECTED_TARGETS[@]}")
BRANCH_LIST="${BRANCH_LIST:2}" # strip leading ", "

echo "" >&2
echo "pre-push-gate: Pushing to protected branch(es): ${BRANCH_LIST}" >&2
echo "Remote: ${REMOTE_SAFE}" >&2
# A rewritten protected ref is excluded from the attestation prompt above on the grounds
# that it "already reaches /dev/tty" — but until this line existed, what it reached was a
# prompt byte-identical to the one an ordinary fast-forward to main produces. Measured side
# by side, the two transcripts differed in nothing. So the operator who types `yes` a dozen
# times a week for routine pushes to a protected branch was being asked, in the same words,
# to authorize a history rewrite. The exclusion is deliberate and stays; what was missing is
# that the surviving prompt say WHICH question it is asking. Printed only when the ref set
# actually contains a rewrite, so every other refusal keeps the wording its tests pin.
# Round 40: printing the warning was not enough, and the gap it left is the one this whole
# second gate exists to close. A warning is something the operator READS; the credential is what
# they ANSWER. `Type 'yes' to confirm push to main:` is a push confirmation, and a `yes` to it is
# evidence about the push, never about who else holds the branch — which is precisely the
# distinction `rules/git-workflow.md` § Push safety draws when it says the two classes "ask
# different questions". Excluding a protected rewrite from the attestation prompt on the grounds
# that this one will ask about it is only sound if this one actually ASKS the other question.
# So the surviving prompt now carries both, and the exclusion is sound again — one prompt, two
# credentials, rather than one prompt standing in for a question nobody put.
PROT_REWRITE_LIST=""
if [ ${#FORCE_REFS[@]} -gt 0 ]; then
  PROT_REWRITES=()
  for prot_ref in "${FORCE_REFS[@]}"; do
    if is_protected "$prot_ref"; then
      PROT_REWRITES+=("$prot_ref")
    fi
  done
  if [ ${#PROT_REWRITES[@]} -gt 0 ]; then
    REWRITE_LIST=$(printf ", %s" "${PROT_REWRITES[@]}")
    PROT_REWRITE_LIST="${REWRITE_LIST:2}"
    echo "  (${PROT_REWRITE_LIST}: this REWRITES history — the remote tip is not an ancestor of what replaces it.)" >&2
  fi
fi
# Round 53. The line above is INFORMATION and prints whenever the topology says rewrite: an
# operator deciding about a protected branch wants to know that, whatever else they have already
# answered. What follows is a CREDENTIAL, and it is owed only when the unshared question is still
# open. `ALLOW_FORCE_UNSHARED=1` answered it — that is what the variable is — so folding the
# attestation into this prompt anyway asks a question whose answer is already on record, and makes
# the credential ineffective at suppressing its own question on exactly the cross-product where
# both gates fire. The gate at § the force block reads the same variable the same way (`!= "1"`),
# and these two readings must not drift: one decides whether to ask, the other whether to fold.
PROT_ATTEST_LIST=""
if [ "${ALLOW_FORCE_UNSHARED:-}" != "1" ]; then
  PROT_ATTEST_LIST="$PROT_REWRITE_LIST"
fi
echo "" >&2

# Probe the terminal by actually opening it, not by testing the device node.
# `[ -c /dev/tty ]` is true whenever the node exists, including in contexts where
# opening it fails (no controlling terminal: background jobs, detached sessions,
# most CI). There the read below returns nothing and the empty answer is
# indistinguishable from a declined confirmation — the push is still blocked, but
# the operator is told they aborted it when the real cause was the environment.
# The brace group carries the stderr redirect because `exec 3</dev/tty 2>/dev/null`
# applies redirections left to right: the open fails before stderr is silenced.
if ! { exec 3</dev/tty; } 2>/dev/null; then
  echo "pre-push-gate: Cannot open /dev/tty — no interactive terminal in this environment." >&2
  echo "Push to protected branches requires interactive confirmation." >&2
  echo "To bypass: ALLOW_PUSH_PROTECTED=1 git push ..." >&2
  # That hint alone would send a rewriting push round a loop: ALLOW_PUSH_PROTECTED=1 silences
  # THIS gate, which returns the rewritten refs to the attestation prompt above — and that one
  # needs the same terminal this one could not open. A recovery route that lands on a second
  # unreachable prompt is the failure the § Recovery table was rewritten to stop repeating.
  if [ -n "$PROT_ATTEST_LIST" ]; then
    echo "This push also REWRITES ${PROT_ATTEST_LIST}. ALLOW_PUSH_PROTECTED=1 alone moves the" >&2
    echo "question to the unshared prompt, which needs a terminal too — from a terminal-less" >&2
    echo "context both credentials are needed: ALLOW_PUSH_PROTECTED=1 ALLOW_FORCE_UNSHARED=1." >&2
  fi
  echo "" >&2
  exit 1
fi

if [ -n "$PROT_ATTEST_LIST" ]; then
  # One `yes`, two credentials, and the wording says so. Naming the refs a second time is not
  # redundancy: the push may carry ordinary creations alongside the rewrite, and the operator is
  # attesting about the rewritten ones only.
  printf "Type 'yes' to confirm push to %s AND attest that nobody else works on %s: " \
    "$BRANCH_LIST" "$PROT_ATTEST_LIST" >&2
else
  printf "Type 'yes' to confirm push to %s: " "$BRANCH_LIST" >&2
fi
CONFIRM=""
read -r CONFIRM <&3 || true
exec 3<&-

if [ "$CONFIRM" != "yes" ]; then
  echo "" >&2
  echo "pre-push-gate: Push aborted by user." >&2
  exit 1
fi

exit 0
    ;;
esac
# The `case` opened at the top of the file closes here, and the second branch is everything
# above this line from the first `$-` check onward. Two properties come out of that shape:
# the first pass cannot reach the gate logic, and the second pass cannot re-enter the launch.
# `exit` is the builtin again in this branch — reaching it at all proves the privileged pass
# took, and `-p` means no function was imported into it.
