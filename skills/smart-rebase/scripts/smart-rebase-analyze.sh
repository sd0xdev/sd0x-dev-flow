#!/bin/bash
# smart-rebase-analyze.sh — Analyze branch rebase plan
#
# Usage:
#   smart-rebase-analyze.sh [--target <ref>] [--base <commit-or-branch>]
#
# Options:
#   --target <ref>     Rebase target (default: origin/main)
#   --base <ref>       Cut point — commits after this are "keep", before are "drop"
#
# Without --base, uses git cherry to auto-detect and lists all commits for review.
#
# Output: JSON analysis report

set -euo pipefail

# **Byte semantics for every text tool below, deliberately.** A commit subject is not guaranteed to
# be valid UTF-8 — git accepts one that is not — and under a UTF-8 locale `cut` refuses it outright
# (`cut: stdin: Illegal byte sequence`), which under `set -e` aborts the whole run and reports no
# plan at all for a branch that rebases perfectly well. Every use of `cut`/`awk` here splits on
# ASCII spaces and counts leading bytes of a hash, so byte semantics are what they wanted anyway.
# Character-level handling happens in exactly one place, `utf8_sanitize`, which sets its own.
export LC_ALL=C

# ── Output helpers ───────────────────────────────────────────────────────────
# **Everything this script writes to stdout is JSON**, and every string in it comes from git:
# branch names, ref arguments, commit subjects. `feat/"x` is a ref name git accepts, and a commit
# subject may contain a backslash — both produce invalid JSON when interpolated raw, and the caller
# then reasons about partially-parsed text instead of a plan.
#
# **The contract, stated because it is not pure fidelity.** Bytes JSON gives a short escape to are
# preserved exactly and round-trip. Every *other* C0 control byte and DEL is replaced by U+FFFD —
# a substitution, not a deletion, and the difference is the point twice over:
#   • deleting collapses two distinct subjects into one identical plan (`A<ESC>B` and `AB`), so the
#     caller cannot tell them apart; U+FFFD keeps them distinct and visibly marked
#   • the faithful alternative, ``, round-trips a terminal escape sequence into whatever
#     prints the plan. A commit subject is attacker-influenceable text; this is deliberately the
#     one place fidelity loses to safety, the same call `smart-commit-inspect.sh` makes.
# **A byte >= 0x80 is not automatically UTF-8, and JSON has to be.** Git accepts a commit message
# containing invalid UTF-8 — round 18 built a valid commit object whose subject carried a raw 0xff —
# and the escaping below passes every high byte through untouched, so `A<0xff>B` left this function
# as a byte stream no strict decoder accepts. "Everything on stdout is JSON" was then false for
# exactly the inputs an attacker controls.
#
# The remedy is the same substitution the C0 class gets, applied to malformed sequences, and which
# tool does it decides only how precisely: `perl` replaces the offending sequence and leaves valid
# multibyte characters in the same string intact; `iconv` can only say valid-or-not, so an invalid
# string loses all of its high bytes; with neither, every high byte is replaced, because a mangled
# subject is recoverable and a malformed document is not. Resolved once, at startup, so the choice
# is a fact of the run rather than a fork per string.
if command -v perl >/dev/null 2>&1; then UTF8_TOOL=perl
elif command -v iconv >/dev/null 2>&1; then UTF8_TOOL=iconv
else UTF8_TOOL=none
fi

utf8_sanitize() {
  case $UTF8_TOOL in
    perl)
      perl -MEncode -e 'binmode(STDIN); binmode(STDOUT); local $/; my $s = <STDIN>;
                        $s = "" unless defined $s; print encode("UTF-8", decode("UTF-8", $s));' ;;
    iconv)
      local buf; buf=$(cat)
      if printf '%s' "$buf" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1; then printf '%s' "$buf"
      else printf '%s' "$buf" | LC_ALL=C sed $'s/[\200-\377]/\357\277\275/g'; fi ;;
    *)
      LC_ALL=C sed $'s/[\200-\377]/\357\277\275/g' ;;
  esac
}

# The predicate behind the fail-closed ref check below. Same three-tool cascade, same order, so a
# machine cannot answer "valid" here and degrade differently there. With no tool at all the answer
# for any high byte is "cannot verify" — reported as invalid, because the alternative is emitting a
# command whose target may not be the branch that was analysed.
utf8_ok() {
  case $UTF8_TOOL in
    perl)  printf '%s' "$1" | perl -MEncode -e 'binmode(STDIN); local $/; my $s = <STDIN>;
             $s = "" unless defined $s;
             eval { decode("UTF-8", $s, Encode::FB_CROAK); 1 } or exit 1; exit 0' ;;
    iconv) printf '%s' "$1" | iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1 ;;
    *)     ! printf '%s' "$1" | LC_ALL=C grep -q $'[\200-\377]' ;;
  esac
}

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\b'/\\b}
  s=${s//$'\t'/\\t}
  s=${s//$'\n'/\\n}
  s=${s//$'\f'/\\f}
  s=${s//$'\r'/\\r}
  # The five above are now two-character escapes and are not matched here. What remains is
  # 0x01–0x07, 0x0b, 0x0e–0x1f and 0x7f — no JSON short escape, no meaning in a ref or a subject.
  # `LC_ALL=C` so the class is byte-wise.
  #
  # **`utf8_sanitize` runs FIRST, and the order is load-bearing.** The C0 stage *emits* U+FFFD, whose
  # three bytes are all >= 0x80 — and the tool-less branch of `utf8_sanitize` replaces every high
  # byte individually. Run the other way round, one control byte became three replacement characters
  # on a machine with neither `perl` nor `iconv`: measured in round 21 as `41 ef bf bd ef bf bd ef bf
  # bd 42` where the contract says one byte becomes one U+FFFD. Sanitizing first means each stage
  # only ever sees bytes that came from the producer, never bytes the other stage just wrote — and
  # the malformed-byte case is unaffected, since U+FFFD contains no C0 byte for the second stage to
  # match (`41 ef bf bd 42`, both orders).
  printf '%s' "$s" | utf8_sanitize | LC_ALL=C sed $'s/[\001-\007\013\016-\037\177]/\357\277\275/g'
}

# **JSON-escaping is not shell-quoting, and `rebase_command` needs both.** That field is advertised
# as ready to copy-paste (`SKILL.md` § Output), so it is executed by a human in a shell — while the
# escaping above only makes it survive `JSON.parse`. `git check-ref-format` accepts a branch named
# `feat/x;printf${IFS}PWN`, and every byte in it is JSON-innocent: the field parses cleanly and then
# runs a second command when pasted. Measured in review round 18 against a real
# `git check-ref-format` and a harmless fake `git`.
#
# Single quotes are the whole answer: inside them the shell expands nothing, so `;`, `$(…)`,
# backticks and whitespace are literal. The one byte that cannot appear inside them is the single
# quote itself, closed and re-opened as `'\''`. Ref names cannot contain a NUL or a newline, which
# are the other two bytes this form could not carry.
sh_quote() {
  local s=$1
  s=${s//\'/\'\\\'\'}
  printf "'%s'" "$s"
}

# One error shape, printed directly. The old form piped through `python3 -m json.tool` with `|| cat`
# as the fallback, which loses the message entirely when python3 is absent: the echo's output has
# already gone into the failed pipe, and `cat` then reads an empty stdin.
json_error() {
  printf '{"error":"%s"}\n' "$(json_escape "$1")"
}

# Read a command's stdout into READ_LINES, and fail loudly when the producer fails.
# `while read … done < <(cmd)` cannot do this: `set -euo pipefail` does not propagate a process
# substitution's exit status, so a git that dies leaves the array EMPTY and the script reports
# `{"status":"up-to-date"}` with exit 0 — a wrong answer, not a failure. Measured in review round 16
# against a `git log` that exits 42. Command substitution puts the status back in reach.
READ_LINES=()
read_lines_or_die() {
  local what=$1; shift
  local out
  READ_LINES=()
  # **A NUL never reaches `json_escape`, so the substitution contract cannot be kept by it alone.**
  # The contract above says every C0 byte becomes U+FFFD *and is not deleted*, precisely so that
  # `A<NUL>B` and `AB` stay distinguishable. But command substitution is what puts producer output
  # into a shell variable, and a Bash variable cannot hold a NUL: under this script's own
  # interpreter, `x=$(printf 'A\000B')` yields the two bytes `AB`. The byte is gone one stage before
  # the function that promised to replace it.
  #
  # `tr` runs inside the substitution, before that loss, and maps the one byte Bash cannot carry to
  # one it can. 0x01 is itself in the C0 class `json_escape` replaces, so the byte still becomes
  # U+FFFD — presence preserved, which is the whole of what the contract promises. Collapsing
  # distinct C0 bytes onto one U+FFFD is already how that contract works (`<ESC>` and `<BEL>` are
  # equally indistinguishable in the output); silently *dropping* one is what it forbids.
  #
  # Round 20 also measured that git will not create such a commit — `git commit-tree` answers
  # `a NUL byte in commit log message not allowed` and `git hash-object` refuses with fsck
  # `nulInCommit` — so no producer here is expected to emit one. That is a reason the guard is cheap,
  # not a reason to drop it: the contract is stated unconditionally, and it should hold because of
  # this line rather than because of what a producer three layers away currently refuses to do.
  # `pipefail` is set, so a failing producer still fails the assignment.
  if ! out=$("$@" | LC_ALL=C tr '\000' '\001'); then
    json_error "$what failed — refusing to report a rebase plan derived from incomplete history"
    exit 1
  fi
  # A trailing newline yields one empty field; `git log --oneline` never emits an empty record.
  while IFS= read -r line; do
    if [ -n "$line" ]; then READ_LINES+=("$line"); fi
  done <<< "$out"
}

TARGET="origin/main"
BASE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    # `--opt=value` first: it is the **unambiguous** spelling, and there is a legal target it is the
    # only way to pass. Round 23 measured that `check-ref-format` accepts `refs/heads/-evil`, and
    # round 25 that a remote may be named `-evil` — so `-evil/main` is a real ref this script can
    # analyse, while a bare `--target -evil` is indistinguishable from a missing value followed by
    # an option. The separated form keeps its guard; the joined form is how you say what it refuses.
    # Ordered before the two patterns below, which would otherwise swallow them: an empty joined
    # value is not a value. The separated form already refuses a missing one, and its message
    # sends you to `--base=<value>` — so `--base=$UNSET` must refuse too, or following that
    # advice with an empty variable silently swaps the requested base for auto-detect and plans
    # against a different merge-base. Measured: `--base=` exited 0 in auto-detect mode.
    --target=|--base=)
      json_error "Option ${1%=} requires a value — $1 passes an empty one" >&2
      exit 1 ;;
    --target=*) TARGET=${1#--target=}; shift ;;
    --base=*)   BASE=${1#--base=};     shift ;;
    # Two ways a value goes missing, and only one of them used to be visible. `--target` at the end
    # of argv was an unbound-variable abort under `set -u`; `--target --base` silently consumed the
    # next OPTION as the value and surfaced three steps later as "Target ref --base not found",
    # which names the wrong thing.
    --target|--base)
      if [ $# -lt 2 ] || case "$2" in -*) true ;; *) false ;; esac; then
        json_error "Option $1 requires a value. A value beginning with - cannot be told apart from an option here — pass it as $1=<value>" >&2
        exit 1
      fi
      # An empty argument IS supplied, so the test above lets it through — and `BASE=""` is then
      # indistinguishable from `--base` never being given, which is auto-detect. Same defect as the
      # joined `--base=` form above, one spelling apart. Fixing one spelling and leaving the other
      # is how a guard ends up green on the day it lands and false-negative afterwards.
      if [ -z "$2" ]; then
        json_error "Option $1 requires a value — an empty one was supplied" >&2
        exit 1
      fi
      if [ "$1" = "--target" ]; then TARGET="$2"; else BASE="$2"; fi
      shift 2 ;;
    # Every usage error uses the same protocol as every other error this script emits. The raw
    # `echo` here used to be the one path that did not — so a caller parsing JSON got a bare line,
    # and an option containing an ESC byte was printed straight through to the terminal.
    *)
      json_error "Unknown option: $1" >&2
      exit 1 ;;
  esac
done

CURRENT=$(git branch --show-current 2>/dev/null || echo "HEAD")

# **`--target` reaches `git fetch` as a refspec, and a refspec writes.** `+main:refs/heads/main` is
# not a branch name; measured, `git fetch . '+HEAD:refs/heads/victim'` moved `victim` off its own
# tip during what this skill advertises as a read. The gate is `git check-ref-format` — git's own
# answer, not a pattern list assembled here, so it stays in step with git by being git.
#
# `--base` is not checked with `check-ref-format` — it is a commit-or-branch, and `HEAD~3` or `:/.`
# are legitimate there and would fail that check. It is guarded instead where it is used, with
# `--verify --end-of-options` on every `rev-parse` it reaches: **an option is not a commit, and
# without that flag `rev-parse` answers it as a query.** Measured — `--base=--glob=refs/heads/*`
# produced a `ready` plan with `drop_count: 4` and a `git rebase --onto` command whose cut point
# came from a `--glob` expansion the caller never named as a commit. A confident plan built from an
# option is exactly the class §1.4 is about, reached through the other argument.
# What check-ref-format does and does not reject:
# docs/features/ref-name-hardening/4-implementation.md §1.1.
# A value beginning with `-` cannot be validated here at all: `check-ref-format` reads it as an
# option and has no `--end-of-options` to stop it (measured). It is not refused outright, because a
# remote may legitimately be named `-evil` — it is accepted only if it resolves to a remote-tracking
# ref, and the fully-qualified form is what the reads then use (`$TARGET_REF`).
case $TARGET in
  -*) TARGET_OPTION_SHAPED=yes ;;
  *)
    TARGET_OPTION_SHAPED=no
    if ! git check-ref-format --allow-onelevel "$TARGET" >/dev/null 2>&1; then
      json_error "--target must name a ref, and git check-ref-format rejects $TARGET. A value carrying : is a refspec, not a branch, and it would make this analysis write to the repository"
      exit 1
    fi ;;
esac

# **A remote-tracking ref is what git resolves it to, not what it is spelled like.** `origin/*` was
# the test until round 24, and it was wrong in three directions at once: `refs/remotes/origin/main`
# is a remote-tracking ref the pattern calls local (so it skipped the refresh — the exact staleness
# the refresh requirement exists to prevent), `upstream/main` likewise, and a local branch literally
# named `origin/foo` was called remote.
#
# **And the remote is not "everything before the first slash".** Round 25: git accepts a remote named
# `team/origin`, and `git remote` lists it — so splitting `refs/remotes/team/origin/main` at the
# first `/` picks remote `team` and branch `origin/main`, which with both remotes configured fetches
# the wrong repository's history into the ref that was asked for. The remote is resolved by matching
# against the names git itself reports, so a name containing `/` is matched whole rather than split.
#
# **A prefix match is deterministic; it is not evidence of ownership.** With both `team` and
# `team/origin` configured, `refs/remotes/team/origin/main` is remote `team` branch `origin/main`
# *or* remote `team/origin` branch `main` — both are legal, both can be configured to write that
# same tracking namespace, and nothing in the path says which one put the ref there. Picking the
# longer name would force-update the ref from a repository that may not be the one it came from.
# So a genuinely ambiguous path is refused: `_resolve_remote` prints every configured remote that is
# a prefix, one per line, and the caller fails closed on more than one — no length rule picks a
# winner here, because there is nothing for it to be right about.
_resolve_remote() {
  local rest=$1 name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case $rest in
      "$name"/?*) printf '%s\n' "$name" ;;
    esac
  done <<EOF
$(git remote 2>/dev/null)
EOF
}

# **A name prefix is not the only way to own a tracking path**, and reading only the name is how a
# second owner stays invisible. `remote.<name>.fetch` decides where that remote writes, and nothing
# requires the destination to sit under its own name: with
# `remote.up.fetch = +refs/heads/*:refs/remotes/origin/*` configured, `git fetch up` writes
# `refs/remotes/origin/main` — so a `--target origin/main` refreshed from `origin` may be reading a
# ref that `up` put there, and the plan describes the wrong repository's history.
#
# This prints every remote whose configured refspec can write the path, **and the source ref that
# refspec maps it from** — `<source> <name>`, source first because a remote name may contain spaces.
# The source is the half that a name-only scan discards, and discarding it is a defect rather than a
# simplification: `remote.origin.fetch = +refs/heads/main:refs/remotes/origin/stable` means
# `origin/stable` *is* the remote's `main`, so refreshing it from a branch called `stable` replaces
# the ref with history the caller never named — § 1.2's defect arriving through the source instead of
# the destination.
#
# A **negative** refspec (`^refs/heads/main`) removes a source from what the remote fetches. It has no
# destination, so a scan reading destinations alone cannot see it and reports an owner that provably
# cannot write the ref — refusing a configuration that is legal and unambiguous.
# A source no inversion can produce. `:` cannot appear in a ref name (`check-ref-format` rejects it),
# so this cannot collide with a real answer — and it must be *reported*, never quietly dropped: a
# dropped claim falls through to the fabricated `refs/heads/<tail>`, which is the defect this whole
# function exists to close.
UNINVERTIBLE=':'

_claiming_remotes() {
  local path=$1 cfg line key val name src dst pre suf cap out excluded neg nname nval
  cfg=$(git config --get-regexp '^remote\..*\.fetch$' 2>/dev/null)
  while IFS= read -r line; do
    # A refspec value carries no space, so the LAST space is the key/value boundary — splitting on
    # the first one drops every remote whose name contains a space, which is exactly the remote a
    # prefix scan already struggles with.
    case $line in *" "*) ;; *) continue ;; esac
    key=${line% *}
    val=${line##* }
    case $key in remote.*.fetch) ;; *) continue ;; esac
    name=${key#remote.}
    name=${name%.fetch}
    [ -n "$name" ] || continue
    case $val in ^*) continue ;; esac
    case $val in *:*) ;; *) continue ;; esac
    src=${val%%:*}
    src=${src#+}
    dst=${val#*:}
    case $dst in refs/*) ;; *) continue ;; esac
    # Unquoted expansions on purpose below: a refspec side is a glob, and matching it is the whole
    # question. git allows at most one `*` per side, so splitting at the first one is the whole rule.
    # shellcheck disable=SC2254
    case $dst in
      *"*"*)
        pre=${dst%%\**}
        suf=${dst#*\*}
        case $path in
          "$pre"*"$suf") cap=${path#"$pre"}; cap=${cap%"$suf"} ;;
          *) continue ;;
        esac
        # **The capture may legally be empty**, and rejecting that fetches the wrong branch rather
        # than none: git accepts `+refs/heads/main*:refs/remotes/origin/stable*` and maps `main` to
        # `origin/stable` — verified with `git fetch --dry-run`. Treating the empty capture as "no
        # match" fell through to the fabricated `refs/heads/stable`.
        case $src in
          *"*"*) out="${src%%\**}$cap${src#*\*}" ;;
          # A literal source under a **wildcard** destination is unpaired, and git allows a `*` on
          # one side only if it is on both — so it rejects the whole refspec (`fatal: invalid
          # refspec`, measured). Inverting it anyway substituted the literal source for a
          # destination the caller named, refreshing e.g. `bad/victim` from `main`. It is not a
          # mapping to invert — it is a repository to report, exactly as the symmetric case below.
          *)     out=$UNINVERTIBLE ;;
        esac ;;
      *)
        [ "$dst" = "$path" ] || continue
        case $src in
          # A glob source with a literal destination has nothing to substitute into. git rejects the
          # refspec outright, so this is not a mapping to invert — it is a repository to report.
          *"*"*) out=$UNINVERTIBLE ;;
          *)     out=$src ;;
        esac ;;
    esac
    # **A source is not required to start with `refs/`**: `main:refs/remotes/origin/stable` is legal
    # and git resolves the short name on the remote, so demanding a full ref discarded the mapping
    # and fell back to the fabricated source again. What the value must not do is carry a second
    # refspec or an unexpanded glob — and whether it names a ref at all is decided downstream by
    # `check-ref-format`, which is git's own answer rather than a second one written here.
    if [ "$out" != "$UNINVERTIBLE" ]; then
      case $out in ''|*:*|*"*"*) out=$UNINVERTIBLE ;; esac
    fi
    # **A SHORT source is not matched against negatives at all**, and an empty `out_full` therefore
    # means "not provably excluded", never "matches nothing". git does not DWIM a negative, and it
    # resolves a short positive source across the remote's whole namespace — so only the negative
    # spelled in the namespace the name actually landed in cancels the mapping, and nothing local
    # knows which that was. Qualifying to `refs/heads/` was a guess whose wrong half fabricates
    # `refs/heads/<tail>` and refreshes the tracking ref from a different ref, silently; leaving the
    # claim standing costs at most a refused refresh, because the fetch carries the configured
    # negatives on its own command line (the `NEG_REFSPECS` block at the `--target` refresh), git
    # does its own matching where the write happens, and the FETCH_HEAD postcondition beside that
    # fetch is what makes an all-excluded fetch an error rather than a silent stale plan.
    #
    # The measurement table both halves come from:
    # docs/features/ref-name-hardening/4-implementation.md § Negative refspecs and short sources.
    if [ "$out" = "$UNINVERTIBLE" ]; then
      out_full=$out
    else
      case $out in refs/*) out_full=$out ;; *) out_full= ;; esac
    fi
    excluded=no
    [ -n "$out_full" ] || { printf '%s %s\n' "$out" "$name"; continue; }
    while IFS= read -r neg; do
      case $neg in *" "*) ;; *) continue ;; esac
      nname=${neg% *}
      nval=${neg##* }
      case $nname in remote.*.fetch) ;; *) continue ;; esac
      nname=${nname#remote.}
      nname=${nname%.fetch}
      [ "$nname" = "$name" ] || continue
      case $nval in ^?*) nval=${nval#^} ;; *) continue ;; esac
      # shellcheck disable=SC2254
      case $nval in
        *"*"*) case $out_full in ${nval%%\**}*${nval#*\*}) excluded=yes ;; esac ;;
        *)     [ "$nval" = "$out_full" ] && excluded=yes ;;
      esac
    done <<INNER
$cfg
INNER
    [ "$excluded" = no ] || continue
    printf '%s %s\n' "$out" "$name"
  done <<EOF
$cfg
EOF
}

# **`rev-parse` prints its input and exits 128 when it cannot resolve**, so `$(… || printf '')` keeps
# the unresolved name rather than the empty string it looks like it produces — measured: with no
# `refs/remotes/origin/main` on disk, `rev-parse --symbolic-full-name origin/main` writes
# `origin/main` to stdout and fails. Reading only the exit status, and requiring the answer to be a
# full ref, is what separates "git resolved this" from "git echoed it back".
#
# **`--verify` and `--end-of-options` are what make this probe answer the question it was asked.**
# Measured, and each flag closes a different way the bare form silently answers something else:
#
#   `rev-parse --symbolic-full-name -evil/main`               → exit 0, echoes the input
#   `rev-parse --symbolic-full-name --git-dir`                → exit 0, prints `.git`
#   `rev-parse --symbolic-full-name --end-of-options X`       → exit 0, prints `--end-of-options` too
#   `rev-parse --verify --symbolic-full-name --end-of-options` → one revision or exit 128, nothing else
#
# So the option-shaped target is not skipped here; it is asked about safely, and git answers with its
# own precedence — `refs/heads/` before `refs/remotes/`, and `<remote>/HEAD` followed through its
# symbolic ref. Skipping the probe (the round-25 shape) made behaviour depend on the spelling of the
# remote name: `origin/HEAD` resolved to its branch while `-evil/HEAD` was decomposed literally and
# fetched a `refs/heads/HEAD` that does not exist.
if TARGET_FULL=$(git rev-parse --verify --symbolic-full-name --end-of-options "$TARGET" 2>/dev/null); then
  case $TARGET_FULL in refs/*) ;; *) TARGET_FULL="" ;; esac
else
  TARGET_FULL=""
fi

# The same ambiguity refusal `--base` carries below, and for the same reason — the probe above
# cannot report it. Measured 2026-08-21 on a repo holding both `refs/heads/feat-x` and
# `refs/tags/feat-x`: `rev-parse --verify --symbolic-full-name` exits **0** and prints **nothing**,
# so `TARGET_FULL` lands empty and `TARGET_REF` falls back to the caller's bare spelling — which
# git then resolves to the TAG. The plan, and the copy-pasteable command printed with it, name a
# different commit than the caller meant, silently. Empty on its own is not the signal: a
# remote-tracking ref that was never fetched resolves to nothing too, and refreshing it is the
# whole point of passing it. So the question asked is "how many exact refs does this name?", the
# same one `--base` asks, and a revision expression matches none of them.
target_exact=0
for r in "refs/$TARGET" "refs/tags/$TARGET" "refs/heads/$TARGET" \
         "refs/remotes/$TARGET" "refs/remotes/$TARGET/HEAD"; do
  git show-ref --verify --quiet -- "$r" && target_exact=$((target_exact+1))
done
# Two exact refs, and nothing else. `--base` additionally refuses "one exact ref, empty symbolic
# resolution"; copying that here would have been the mirror-image mistake this whole file is
# about — for a TARGET an empty resolution is a legitimate, expected state (a remote-tracking ref
# that was never fetched cannot resolve, and fetching it is why it was passed), so that disjunct
# refuses the case the feature exists to serve. Measured: it broke five such tests at once.
if [ "$target_exact" -gt 1 ]; then
  json_error "--target $TARGET is ambiguous ($target_exact exact refs) — pass a fully qualified ref (refs/heads/... or refs/tags/...)"
  exit 1
fi

# The unresolved branch is not an error case — a remote-tracking ref that has **never been fetched**
# cannot resolve, and fetching it is exactly what the caller wants. Both spellings are accepted
# there, because `refs/remotes/origin/new` is as legitimate a way to name it as `origin/new`.
REMOTE=""
TARGET_BRANCH=""
TARGET_SRC=""
_rest=""
case $TARGET_FULL in
  refs/remotes/*) _rest=${TARGET_FULL#refs/remotes/} ;;
  refs/*)         _rest="" ;;
  *)
    case $TARGET in
      refs/remotes/*) _rest=${TARGET#refs/remotes/} ;;
      refs/*)         _rest="" ;;
      */*)            _rest=$TARGET ;;
    esac ;;
esac
if [ -n "$_rest" ]; then
  # Counted in the shell, not with `wc`/`tr`: this script already carries a PATH-degradation story
  # for its UTF-8 backends, and a classifier that needs two more external binaries would fail
  # closed on the same stripped PATH — which the suite exercises, and which caught exactly this.
  _n=0
  _names=""
  _list=""
  while IFS= read -r _name; do
    [ -n "$_name" ] || continue
    _n=$((_n + 1))
    _names="$_names $_name"
    _list="$_list$_name
"
    REMOTE=$_name
  done <<EOF
$(_resolve_remote "$_rest")
EOF
  # Then the refspec claimers, minus anything the prefix scan already counted — the ordinary
  # `remote.origin.fetch` names its own tracking namespace, so origin claims `origin/main` twice and
  # counting that as two owners would refuse every default configuration there is.
  _claims=$(_claiming_remotes "refs/remotes/$_rest")
  while IFS= read -r _claim; do
    [ -n "$_claim" ] || continue
    _name=${_claim#* }
    _dup=no
    while IFS= read -r _known; do
      [ "$_known" = "$_name" ] && _dup=yes
    done <<INNER
$_list
INNER
    [ "$_dup" = no ] || continue
    _list="$_list$_name
"
    _n=$((_n + 1))
    _names="$_names $_name"
  done <<EOF
$_claims
EOF
  if [ "$_n" -gt 1 ]; then
    json_error "$TARGET is owned by more than one configured remote (${_names# }), and the ref path does not say which one — refreshing it from the wrong one would analyse another repository's branch. Check remote.<name>.fetch for each of them, or pass --target with a local ref to analyse without a refresh"
    exit 1
  fi
  if [ "$_n" -eq 1 ] && [ -z "$REMOTE" ]; then
    # Sole owner, reached only through a refspec destination: the path is not that remote's name, so
    # nothing here says which branch on it to fetch. Naming the owner is the useful half of the
    # answer; guessing the other half is what this whole section refuses to do.
    json_error "$TARGET is written by remote ${_names# } through its configured remote.<name>.fetch, not by a remote whose name the ref path carries — so this script cannot tell which branch on it to refresh. Pass --target=refs/remotes/${_names# }/<branch> as that remote spells it, or a local ref to analyse without a refresh"
    exit 1
  fi
  if [ -n "$REMOTE" ]; then
    TARGET_BRANCH=${_rest#"$REMOTE"/}
    # **The source is the configured one where a configuration says so.** Falling back to
    # `refs/heads/<tail>` is right only for the identity mapping every clone has; under
    # `+refs/heads/main:refs/remotes/origin/stable` the tail is the *destination's* name and the
    # source is `main`. Two refspecs of the same remote covering the path with different sources is
    # not a tie to break — it is a repository that has to say which it means.
    TARGET_SRC=""
    _srcn=0
    while IFS= read -r _claim; do
      [ -n "$_claim" ] || continue
      [ "${_claim#* }" = "$REMOTE" ] || continue
      _csrc=${_claim%% *}
      if [ "$_csrc" != "$TARGET_SRC" ]; then _srcn=$((_srcn + 1)); TARGET_SRC=$_csrc; fi
    done <<EOF
$_claims
EOF
    if [ "$TARGET_SRC" = "$UNINVERTIBLE" ]; then
      json_error "$TARGET is written by a fetch refspec on $REMOTE that this script cannot invert, so it cannot tell which branch to refresh from. Check remote.$REMOTE.fetch, or pass --target with a local ref to analyse without a refresh"
      exit 1
    fi
    if [ "$_srcn" -gt 1 ]; then
      json_error "$TARGET is mapped from more than one source by the fetch refspecs configured on $REMOTE, so refreshing it would have to pick one — and the ref does not say which. Reduce remote.$REMOTE.fetch to one refspec covering this ref, or pass --target with a local ref to analyse without a refresh"
      exit 1
    fi
    # **`<remote>/HEAD` is the remote's default branch, and only a fetched symref says which one.**
    # The probe above follows it when `refs/remotes/<remote>/HEAD` exists; when it does not, the
    # decomposition leaves the literal branch `HEAD`, and `+refs/heads/HEAD:...` asks the remote for a
    # branch called HEAD — a ref that almost never exists, so the refresh fails with a message about
    # the wrong thing, and on a repository that does have one it analyses a branch nobody asked for.
    if [ -z "$TARGET_FULL" ] && [ "$TARGET_BRANCH" = HEAD ]; then
      # The recovery command is emitted only where it runs. `git remote set-head` has no
      # `--end-of-options` and no `--` placement that makes a dash-named remote an operand — measured,
      # every ordering exits 129 — and a pasteable line git refuses is worse than none, which is the
      # § 1.5 argument reaching the other kind of unusable string.
      _hint="pass --target with the branch name"
      if [ "${REMOTE#-}" = "$REMOTE" ]; then
        _hint="run git remote set-head $(sh_quote "$REMOTE") -a to record it, or $_hint"
      fi
      json_error "$TARGET names the default branch of $REMOTE, and nothing on disk says which branch that is — refs/remotes/$REMOTE/HEAD has not been fetched. To fix it, $_hint"
      exit 1
    fi
  elif [ -n "$TARGET_FULL" ]; then
    # A `refs/remotes/` ref whose remote is no longer configured cannot be refreshed, and analysing
    # it anyway is the silent staleness §1.4 exists to prevent — there is no remote left to ask.
    json_error "$TARGET is a remote-tracking ref, but no configured remote owns it, so it cannot be refreshed. Run git remote to see what is configured, or pass --target with a local ref to analyse without a refresh"
    exit 1
  fi
fi

# **Read from the ref that was refreshed, not from the string the caller typed.** They are the same
# ref by definition, but only one of them is guaranteed not to be read as an option — which is what
# makes a remote named `-evil` analysable instead of refused.
if [ -n "$REMOTE" ]; then
  TARGET_REF="refs/remotes/$REMOTE/$TARGET_BRANCH"
elif [ -n "$TARGET_FULL" ]; then
  # git already resolved the caller's spelling to a full ref, and a `refs/...` string cannot be read
  # as an option — so the refusal below is not owed here. It was, before: an option-shaped local
  # branch was refused even though the probe had answered, which turned a supported target into an
  # error for no reason a caller could act on.
  TARGET_REF=$TARGET_FULL
elif [ "$TARGET_OPTION_SHAPED" = yes ]; then
  json_error "--target $TARGET begins with -, so git reads it as an option everywhere this script would use it. That spelling works only when git can resolve it to a ref this script can use instead, and here it resolves to nothing; pass the ref in full, as --target=refs/heads/<branch> or --target=refs/remotes/<remote>/<branch>"
  exit 1
else
  TARGET_REF=$TARGET
fi

# What the *printed* command names. The developer's `git` reads a leading `-` as an option just as
# this script's does, and shell-quoting does not change that — so the one spelling that cannot be
# pasted is replaced by the resolved ref. Every ordinary target keeps the spelling the caller used.
# Decided here rather than beside the command, so the UTF-8 fail-closed check guards this string.
TARGET_CMD=$TARGET
if [ "$TARGET_OPTION_SHAPED" = yes ]; then TARGET_CMD=$TARGET_REF; fi

# **This analysis is a read, and the one write path it has is this fetch.** Six separate ways it
# could write, mislead, or tell the developer to write were found and closed: a refspec-shaped
# `--target`, a hostile `remote.<name>.fetch` choosing the destination, tag and submodule fetching
# that `--refmap=` does not govern, a failed refresh silently producing a plan from stale history, a
# recovery instruction that pasted an unquoted branch name into the reader's shell, and a recovery
# instruction that was quoted but reproduced the *unguarded* fetch.
#
# Each measurement, and why the flags are the ones they are:
# docs/features/ref-name-hardening/4-implementation.md §1.2, §1.3, §1.4, §1.5.
if [ -n "$REMOTE" ]; then
  # Reached only when **no** configured refspec covers the path — a remote fetching a narrower set
  # than it tracks, say. There is no configured meaning to honour there, so the identity mapping is
  # this script's own convention and is stated as such rather than presented as git's answer.
  [ -n "$TARGET_SRC" ] || TARGET_SRC="refs/heads/$TARGET_BRANCH"
  # **The recovery command below names these three, and `json_escape` is lossy by design.** A ref
  # carrying a raw 0xff passes `check-ref-format` and survives `sh_quote`, and then becomes U+FFFD in
  # the JSON — so the pasted command refreshes a *different* ref. Same argument as the plan's ref
  # check further down; it applies here because the source may now come from configuration.
  for _role in remote:"$REMOTE" source:"$TARGET_SRC" branch:"$TARGET_BRANCH"; do
    if ! utf8_ok "${_role#*:}"; then
      json_error "The ${_role%%:*} name is not valid UTF-8, so it cannot be written into this report without altering it — and an altered name identifies a different ref. Rename it, or fetch by hand"
      exit 1
    fi
  done
  # **A short source cannot be validated as a bare word: `check-ref-format` honours neither `--`
  # nor `--end-of-options`** (measured — it rejects every argument after them, the legal name `main`
  # included), so a configured source literally named `-evil` was read as an option, exited 129, and
  # a legal mapping was refused. Ask the question under a `refs/heads/` prefix instead: that is the
  # one spelling git will answer for a dash-leading name, and it is the same question this gate
  # exists to ask — is this a well-formed ref *name* (no `:`, no `..`, no control bytes)?
  #
  # **The prefix is for the check only; the refspec keeps the configured spelling.** git resolves a
  # short source across the remote's whole ref namespace, so a tag is a legal source too — emitting
  # `refs/heads/<name>` would silently narrow a mapping the repository configured, which is the same
  # class of defect as fabricating one. A source already under `refs/` is checked as it stands.
  case $TARGET_SRC in
    refs/*) _src_check=$TARGET_SRC ;;
    *)      _src_check="refs/heads/$TARGET_SRC" ;;
  esac
  for _ref in "$_src_check" "refs/remotes/$REMOTE/$TARGET_BRANCH"; do
    # `--allow-onelevel` is kept for the shared call shape, not because these need it: both values
    # here are fully qualified by construction, and the flag only ever widens what a ONE-level name
    # may be. It is the same call this script makes for a bare `--target`, and spelling it two ways
    # would be two shapes to authorize for one question.
    if ! git check-ref-format --allow-onelevel "$_ref" >/dev/null 2>&1; then
      json_error "--target must name a ref, and git check-ref-format rejects $_ref. A value carrying : is a refspec, not a branch, and it would make this analysis write to the repository"
      exit 1
    fi
  done
  # `--` separates options from operands, so a remote legitimately named `-evil` is addressable
  # rather than refused (measured — but `--quiet` must come *before* it, or git reads the flag as a
  # refspec). The recovery line names this same guarded command: telling the developer to run a bare
  # `git fetch origin <branch>` would hand back every hole this line closes — the configured refspec
  # would apply again, and a branch named `+main` would be read as a force marker plus `main`.
  # It is shell-quoted because `check-ref-format` accepts `;`, backticks and `$( )` — measured.
  # **A refspec given on the command line does not inherit the remote's configured negatives.**
  # Measured 2026-08-22: with `remote.origin.fetch = tagx:refs/remotes/origin/stable` *and*
  # `^refs/tags/tagx` both configured, `git fetch --refmap= --no-tags -- origin
  # '+tagx:refs/remotes/origin/stable'` created the ref anyway — a short source resolves across the
  # remote's whole namespace, so `tagx` found `refs/tags/tagx`, the very ref the configuration
  # excludes. An ordinary `git fetch origin` leaves it absent. Passing `^refs/tags/tagx` on the same
  # command line blocked it (`fatal: Needed a single revision`, ref absent) while an unrelated
  # `^refs/tags/other` did not, so CLI negatives apply, and precisely.
  #
  # Carrying them is what keeps this line from writing what the repository configured itself not to
  # have. `_claiming_remotes` decides exclusion by qualifying a short source to `refs/heads/<x>`,
  # which the paragraph above deliberately refuses to do here — git resolves a short source across
  # the whole namespace, tags included — so that qualification is a *guess about the namespace*, and
  # when it guesses wrong the claim survives and this fetch is what lands the excluded ref. Handing
  # the negatives to git removes the guess from the write path: git does its own matching, and an
  # excluded source therefore never arrives on disk. What it does NOT do is announce itself — see
  # the postcondition below, which is what turns the silence into an error.
  NEG_REFSPECS=()
  _neg_cfg=$(git config --get-regexp '^remote\..*\.fetch$' 2>/dev/null || printf '')
  while IFS= read -r _neg_line; do
    case $_neg_line in *" "*) ;; *) continue ;; esac
    _neg_key=${_neg_line% *}
    _neg_val=${_neg_line##* }
    case $_neg_key in remote.*.fetch) ;; *) continue ;; esac
    _neg_key=${_neg_key#remote.}
    _neg_key=${_neg_key%.fetch}
    [ "$_neg_key" = "$REMOTE" ] || continue
    case $_neg_val in ^?*) NEG_REFSPECS[${#NEG_REFSPECS[@]}]=$_neg_val ;; esac
  done <<NEG_EOF
$_neg_cfg
NEG_EOF
  # `${A[@]+"${A[@]}"}` and not `"${A[@]}"`: the shebang selects macOS's Bash 3.2, where expanding
  # an empty array under `set -u` is an error — the same footgun `${DROP[-1]}` carries below.
  _refspec="+$TARGET_SRC:refs/remotes/$REMOTE/$TARGET_BRANCH"
  _neg_quoted=
  for _neg_val in ${NEG_REFSPECS[@]+"${NEG_REFSPECS[@]}"}; do
    _neg_quoted="$_neg_quoted $(sh_quote "$_neg_val")"
  done
  # The postcondition, and the sentence above it was wrong until round 58 said so. "An excluded
  # source now fails here" is false: measured 2026-08-22 (git 2.55.0), a fetch whose only positive
  # is cancelled by a negative on the same command line **exits 0 and transfers nothing**, leaving
  # whatever the tracking ref already held. So the wrong-namespace guess did not become a loud
  # error — it became a plan built from stale history, silently, which is the exact failure the
  # whole paragraph claims to avoid.
  #
  # `FETCH_HEAD` is the local, network-free discriminator: git truncates it at the start of every
  # fetch and writes one line per ref it actually considered. Measured on the same run — a real
  # update wrote 66 bytes, an already-up-to-date fetch also wrote 66 (so "nothing to transfer" is
  # NOT a false positive), an irrelevant negative wrote 66, and only the genuinely-excluded fetches
  # left it empty. `--git-path` rather than `.git/FETCH_HEAD`: a linked worktree keeps its own.
  if ! git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- "$REMOTE" "$_refspec" ${NEG_REFSPECS[@]+"${NEG_REFSPECS[@]}"} 2>/dev/null; then
    json_error "Could not refresh $TARGET from $REMOTE, so any plan built now would describe history the remote may no longer have. Run git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- $(sh_quote "$REMOTE") $(sh_quote "$_refspec")$_neg_quoted by hand to see why, or pass --target with a local ref to analyse without the remote"
    exit 1
  fi
  _fetch_head=$(git rev-parse --git-path FETCH_HEAD 2>/dev/null) || _fetch_head=
  if [ -z "$_fetch_head" ] || [ ! -s "$_fetch_head" ]; then
    json_error "The refresh of $TARGET from $REMOTE transferred nothing, so $TARGET still holds whatever it held before and a plan built now would describe stale history. A configured negative refspec on $REMOTE cancels this mapping: git resolves a short source across the remote's whole namespace, and only a negative spelled in the namespace it landed in cancels it, which nothing local can decide. Run git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- $(sh_quote "$REMOTE") $(sh_quote "$_refspec")$_neg_quoted by hand to see what it matches, or pass --target with a local ref to analyse without the remote"
    exit 1
  fi
fi

# Verify target exists
if ! git rev-parse --verify --end-of-options "$TARGET_REF" >/dev/null 2>&1; then
  json_error "Target ref $TARGET not found"
  exit 1
fi

MERGE_BASE=$(git merge-base HEAD "$TARGET_REF" 2>/dev/null || echo "")
if [ -z "$MERGE_BASE" ]; then
  json_error "No common ancestor between HEAD and $TARGET"
  exit 1
fi

MERGE_BASE_SHORT=$(git rev-parse --short "$MERGE_BASE")
TARGET_HEAD=$(git rev-parse --short "$TARGET_REF")

# Collect unique commits (not in target).
# while-read over a captured string, not `mapfile` and not process substitution. `mapfile` is Bash 4
# and the shebang selects macOS's Bash 3.2, where it fails as `command not found` on discarded
# stderr; process substitution hides the producer's exit status. Both end the same way — an empty
# array reported as `{"status":"up-to-date"}`. `read_lines_or_die` closes both.
read_lines_or_die "git log ($MERGE_BASE..HEAD)" git log --oneline --reverse "$MERGE_BASE..HEAD"
# Copied through an `if`, not `("${READ_LINES[@]:-}")`: under Bash 3.2 + `set -u` an empty array
# expansion is an error, and the `:-` workaround produces a one-element array holding "" — which
# would make TOTAL 1 on an empty history and send an up-to-date branch down the rebase path.
COMMITS=()
if [ ${#READ_LINES[@]} -gt 0 ]; then COMMITS=("${READ_LINES[@]}"); fi
TOTAL=${#COMMITS[@]}

if [ "$TOTAL" -eq 0 ]; then
  printf '{"status":"up-to-date","message":"No commits to rebase","current_branch":"%s","target":"%s"}\n' \
    "$(json_escape "$CURRENT")" "$(json_escape "$TARGET")"
  exit 0
fi

# ── Mode 1: --base provided → deterministic cut ──
if [ -n "$BASE" ]; then
  # `--base` is deliberately not name-shape checked (see
  # docs/features/ref-name-hardening/4-implementation.md § 1.1): `HEAD~3` and `:/.` are
  # legitimate here and check-ref-format would refuse them. That reason does not cover
  # AMBIGUITY, which is a different failure — the resolution below discards stderr, so a
  # base naming both a tag and a branch silently selects one and the whole plan is computed
  # from the wrong cut point. Decided by resolution, never by shape: a revision expression
  # matches none of these exact refs, so it never reaches the refusal.
  base_exact=0
  for r in "refs/$BASE" "refs/tags/$BASE" "refs/heads/$BASE" \
           "refs/remotes/$BASE" "refs/remotes/$BASE/HEAD"; do
    git show-ref --verify --quiet -- "$r" && base_exact=$((base_exact+1))
  done
  if [ "$base_exact" -gt 0 ]; then
    # Read the VALUE, not `$?`: on an ambiguous name git prints its error to stderr, writes
    # nothing to stdout and still exits 0, so a `||` on this command clears the very case it
    # was added to catch.
    base_sym=$(git rev-parse --verify --symbolic-full-name --end-of-options "$BASE" 2>/dev/null)
    if [ "$base_exact" -gt 1 ] || [ -z "$base_sym" ]; then
      json_error "--base $BASE is ambiguous ($base_exact exact refs) — pass a fully qualified ref (refs/heads/...) or a commit id"
      exit 1
    fi
  fi

  # Resolve base to a commit hash
  BASE_HASH=$(git rev-parse --verify --short --end-of-options "$BASE" 2>/dev/null || echo "")
  if [ -z "$BASE_HASH" ]; then
    # Try as remote branch name
    BASE_HASH=$(git rev-parse --verify --short --end-of-options "origin/$BASE" 2>/dev/null || echo "")
  fi
  if [ -z "$BASE_HASH" ]; then
    json_error "Cannot resolve --base $BASE"
    exit 1
  fi

  KEEP=()
  DROP=()
  FOUND_CUT=0

  for line in "${COMMITS[@]}"; do
    hash=$(echo "$line" | awk '{print $1}')
    if [ "$FOUND_CUT" -eq 0 ]; then
      full_hash=$(git rev-parse "$hash" 2>/dev/null)
      base_full=$(git rev-parse "$BASE_HASH" 2>/dev/null)
      DROP+=("$line")
      if [ "$full_hash" = "$base_full" ]; then
        FOUND_CUT=1
      fi
    else
      KEEP+=("$line")
    fi
  done

  if [ "$FOUND_CUT" -eq 0 ]; then
    printf '{"error":"Cut point %s (%s) not found in commit history","hint":"Run without --base to see all commits"}\n' \
      "$(json_escape "$BASE")" "$(json_escape "$BASE_HASH")"
    exit 1
  fi

  # Build JSON output. `sed 's/"/\\"/g'` used to be the whole escape, which left every backslash in
  # a commit subject producing an invalid JSON escape sequence; `json_escape` handles the full set.
  KEEP_JSON="["
  for i in "${!KEEP[@]}"; do
    hash=$(echo "${KEEP[$i]}" | awk '{print $1}')
    msg=$(echo "${KEEP[$i]}" | cut -d' ' -f2-)
    [ "$i" -gt 0 ] && KEEP_JSON+=","
    KEEP_JSON+='{"hash":"'"$(json_escape "$hash")"'","message":"'"$(json_escape "$msg")"'"}'
  done
  KEEP_JSON+="]"

  DROP_JSON="["
  for i in "${!DROP[@]}"; do
    hash=$(echo "${DROP[$i]}" | awk '{print $1}')
    msg=$(echo "${DROP[$i]}" | cut -d' ' -f2-)
    [ "$i" -gt 0 ] && DROP_JSON+=","
    DROP_JSON+='{"hash":"'"$(json_escape "$hash")"'","message":"'"$(json_escape "$msg")"'"}'
  done
  DROP_JSON+="]"

  # `${DROP[-1]}` is a Bash 4.2+ negative subscript; the shebang is `#!/bin/bash`, which on macOS
  # is 3.2, where it is a `bad array subscript` and — under `set -u` — aborts the whole `--base`
  # mode, the one the skill documents as producing the copy-pasteable command.
  CUT_POINT_HASH=$(echo "${DROP[$((${#DROP[@]} - 1))]}" | awk '{print $1}')

  # Escaped once, into locals, because `rebase_command` embeds three of them inside a JSON string —
  # a ref name containing a quote would otherwise terminate the field and leave the rest as syntax.
  E_CURRENT=$(json_escape "$CURRENT")
  E_TARGET=$(json_escape "$TARGET")
  E_TARGET_HEAD=$(json_escape "$TARGET_HEAD")
  E_MERGE_BASE=$(json_escape "$MERGE_BASE_SHORT")
  E_CUT=$(json_escape "$CUT_POINT_HASH")
  # **A ref is an identity, not a display string, and the sanitizer above is lossy by design.**
  # `git check-ref-format` accepts a branch whose name carries a raw 0xff; `sh_quote` preserves that
  # byte, and then `json_escape` replaces it with U+FFFD — so the advertised command names a
  # *different* ref than the one analysed. It either fails, or, if a branch by the substituted name
  # also exists, rebases the wrong one. Substitution is right for a commit subject, which is read;
  # it is wrong for a ref, which is resolved.
  #
  # So this fails closed. A ref that cannot be carried through a JSON document byte-for-byte gets
  # an error naming it, not a plan with a command that lies about its target. (Only this mode is
  # affected: auto-detect emits no command, and its display fields stay sanitized.)
  for _role in target:"$TARGET_CMD" cut-point:"$CUT_POINT_HASH" branch:"$CURRENT"; do
    if ! utf8_ok "${_role#*:}"; then
      json_error "The ${_role%%:*} ref is not valid UTF-8, so it cannot be written into a JSON plan without altering it — and an altered ref name identifies a different branch. Rename it, or run git rebase --onto by hand"
      exit 1
    fi
  done

  # Shell-quoted first, then JSON-escaped — the order matters: quoting after escaping would quote
  # the escape sequences instead of the ref, and the pasted command would rebase onto a literal `\"`.
  #
  # `--` precedes the branch operand, and it is not interchangeable with fully-qualifying it. Shell
  # quoting stops the shell, not git's own option parser: a branch legitimately named
  # `--exec=touch${IFS}PWNED` (git update-ref/fetch create it though `git branch` refuses the
  # spelling) reaches `git rebase` as its `--exec` option and the pasted command runs the payload —
  # measured. The obvious fix, spelling it `refs/heads/<branch>`, is wrong *here specifically*:
  # measured, a fully-qualified branch operand makes rebase land on a **detached HEAD** and never
  # moves the branch ref, which is the whole point of the command. `--` is the one form that both
  # stops the option parser and keeps the short name that updates the ref.
  E_REBASE_CMD=$(json_escape "git rebase --onto $(sh_quote "$TARGET_CMD") $(sh_quote "$CUT_POINT_HASH") -- $(sh_quote "$CURRENT")")

  cat <<ENDJSON
{
  "status": "ready",
  "mode": "explicit-base",
  "current_branch": "$E_CURRENT",
  "target": "$E_TARGET",
  "target_head": "$E_TARGET_HEAD",
  "merge_base": "$E_MERGE_BASE",
  "total_commits": $TOTAL,
  "keep_count": ${#KEEP[@]},
  "drop_count": ${#DROP[@]},
  "cut_point": "$E_CUT",
  "keep": $KEEP_JSON,
  "drop": $DROP_JSON,
  "rebase_command": "$E_REBASE_CMD"
}
ENDJSON
  exit 0
fi

# ── Mode 2: Auto-detect with git cherry ──
# git cherry marks commits already in target with "-", unique with "+"
read_lines_or_die "git cherry ($TARGET..HEAD)" git cherry -v "$TARGET_REF" HEAD
CHERRY=()
if [ ${#READ_LINES[@]} -gt 0 ]; then CHERRY=("${READ_LINES[@]}"); fi

AUTO_KEEP=()
AUTO_DROP=()

# `"${arr[@]}"` on an empty array is an unbound-variable error under Bash 3.2 + `set -u`, so every
# iteration over one of these arrays is guarded by its own length check.
if [ ${#CHERRY[@]} -gt 0 ]; then
for line in "${CHERRY[@]}"; do
  marker=$(echo "$line" | cut -c1)
  # NOT truncated. `git cherry -v` prints the full 40-hex OID while `git log --oneline` prints
  # `core.abbrev` — 7 by default. Truncating this side to a fixed 8 made the equality test below
  # compare 8 characters against 7, which can never hold, so every commit reported
  # `"cherry":"unique"` however git cherry had marked it and the per-commit list contradicted
  # `cherry_dropped`. Nothing displays these hashes — they are compared and counted only — so the
  # full OID costs nothing here.
  hash=$(echo "$line" | awk '{print $2}')
  msg=$(echo "$line" | cut -d' ' -f3-)

  if [ "$marker" = "-" ]; then
    AUTO_DROP+=("$hash $msg")
  else
    AUTO_KEEP+=("$hash $msg")
  fi
done
fi

# Check for new commits on target since merge-base (potential squash merges)
read_lines_or_die "git log ($MERGE_BASE..$TARGET)" git log --oneline "$MERGE_BASE..$TARGET_REF"
TARGET_NEW=()
if [ ${#READ_LINES[@]} -gt 0 ]; then TARGET_NEW=("${READ_LINES[@]}"); fi
TARGET_NEW_COUNT=${#TARGET_NEW[@]}

# Build all-commits JSON for display
ALL_JSON="["
for i in "${!COMMITS[@]}"; do
  hash=$(echo "${COMMITS[$i]}" | awk '{print $1}')
  msg=$(echo "${COMMITS[$i]}" | cut -d' ' -f2-)

  # Check cherry status
  cherry_status="unique"
  if [ ${#AUTO_DROP[@]} -gt 0 ]; then
  for d in "${AUTO_DROP[@]}"; do
    dhash=$(echo "$d" | awk '{print $1}')
    # A PREFIX test, not string equality: `$hash` is an abbreviation from `git log --oneline`
    # (`core.abbrev` wide) and `$dhash` is the full OID from `git cherry -v`. Git's own
    # abbreviations are prefixes of the OID and are unique within the repository, so this is the
    # same comparison git makes — and it holds for any `core.abbrev`, which fixed-width truncation
    # on either side does not. `$hash` is hex, so it carries no `case` pattern metacharacter.
    case "$dhash" in
      "$hash"*)
        cherry_status="already-in-target"
        break ;;
    esac
  done
  fi

  [ "$i" -gt 0 ] && ALL_JSON+=","
  ALL_JSON+='{"hash":"'"$(json_escape "$hash")"'","message":"'"$(json_escape "$msg")"'","cherry":"'"$cherry_status"'"}'
done
ALL_JSON+="]"

# Target new commits JSON
TARGET_JSON="["
for i in "${!TARGET_NEW[@]}"; do
  hash=$(echo "${TARGET_NEW[$i]}" | awk '{print $1}')
  msg=$(echo "${TARGET_NEW[$i]}" | cut -d' ' -f2-)
  [ "$i" -gt 0 ] && TARGET_JSON+=","
  TARGET_JSON+='{"hash":"'"$(json_escape "$hash")"'","message":"'"$(json_escape "$msg")"'"}'
done
TARGET_JSON+="]"

cat <<ENDJSON
{
  "status": "analysis",
  "mode": "auto-detect",
  "current_branch": "$(json_escape "$CURRENT")",
  "target": "$(json_escape "$TARGET")",
  "target_head": "$(json_escape "$TARGET_HEAD")",
  "merge_base": "$(json_escape "$MERGE_BASE_SHORT")",
  "total_commits": $TOTAL,
  "cherry_unique": ${#AUTO_KEEP[@]},
  "cherry_dropped": ${#AUTO_DROP[@]},
  "target_new_commits": $TARGET_NEW_COUNT,
  "commits": $ALL_JSON,
  "target_new": $TARGET_JSON,
  "hint": "If git cherry missed squash-merged commits, re-run with --base <last-merged-commit-hash>"
}
ENDJSON
