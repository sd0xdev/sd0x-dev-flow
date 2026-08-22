---
name: epic-merge
description: "Sequential squash-merge of stacked PR chains into an epic branch. Handles dependency-ordered rebase, collision-safe backup tags, CI monitoring (delegates to /watch-ci), and post-merge verification. Use when: merging a chain of stacked PRs into an epic branch, collapsing a linear PR stack into per-PR squash commits, preparing an epic branch for final review. Triggers on: 'merge PRs into epic', 'squash chain', 'collapse PR stack', 'epic merge', or when user has a linear PR dependency chain (PR A -> B -> C) targeting an epic branch. Not for: single PR merge (use /create-pr + GitHub UI), simple rebase (use /smart-rebase), pre-merge analysis (use /merge-prep). Output: chain analysis table + backup tag manifest + per-iteration AskUserQuestion gate + verification log."
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*), Read, Grep, Glob, AskUserQuestion, Skill
---

# Epic Merge — Stacked PR Chain Squash-Merge

Sequentially squash-merge a chain of stacked PRs into an epic branch, producing one squash commit per PR for clean per-PR review on the epic. Every destructive iteration is gated by `AskUserQuestion` to keep the operator in control.

## When NOT to Use

- Single PR merge — use `/create-pr` + GitHub UI
- Simple rebase without stacked dependencies — use `/smart-rebase`
- Pre-merge conflict / impact analysis only — use `/merge-prep`
- Diamond / parallel merge chains — this skill handles **linear chains only**
- Repos that use merge-commit or rebase-merge — this skill assumes squash-merge only

## Permissions

This skill is one of the explicit exceptions in `@rules/git-workflow.md` allowed to execute `git rebase --onto`, `git push --force-with-lease`, and `gh pr merge --squash`. Every destructive step is gated by `AskUserQuestion`.

| Phase | Operation | Mutates | Approval |
|-------|-----------|---------|----------|
| Phase 0 step 0 refresh | bounded `git fetch` (§ Phase 0 step 0) | `refs/remotes/origin/*` + `.git/FETCH_HEAD` | No (local, bounded, recoverable) |
| Phase 1 backup | `git tag -f` | local refs only | No (no remote / non-recoverable mutation) |
| Phase 2 iteration | rebase + force-push + `gh pr merge` | local + remote | **Yes** — single bundled gate per iteration (or per-step with `--per-step`) |
| Phase 3 verify | `git log` | none | No (read-only) |

**`--dry-run` outputs the plan and performs exactly one bounded local *operation*** — enumerated
rather than implied, because every earlier phrasing was a promise the flag did not keep. "Skips all
destructive steps" let Phase 1 run unconditionally, so a dry run force-updated every `backup/pr-*`
tag and left a manifest per PR in the working tree. The repair overcorrected: it said the run
"writes nothing" while still running `git fetch origin`, which is not a read and is not confined to
`origin/*` — see § Phase 0 step 0. And "one bounded **write**" was still too strong: a refspec
bounds which *refs* a fetch may update, not what else fetching does.

| Under `--dry-run` | Behaviour |
|-------------------|-----------|
| Phase 0 step 0 refresh | **Runs.** The one mutating operation a dry run keeps: the bounded fetch of § Phase 0 step 0, whose **ref updates** are bounded to `refs/remotes/origin/*` plus `.git/FETCH_HEAD` — its other writes are not, see § `--dry-run` residue below. Skipping it would print a plan derived from stale refs, and a wrong plan is worse than a refreshed `origin/*` |
| Phase 0 analysis | Runs — read-only, over the refs step 0 has just refreshed |
| Phase 1 `git tag -f "backup/pr-*"` | **Skipped.** Printed as a command, not executed |
| Phase 1 manifest files | **Skipped.** The `git log` runs, but its output goes to the report instead of `$(git rev-parse --git-path epic-merge)/expected-pr-*.manifest`, so no file is created and none of a previous run's are overwritten |
| Phase 2 iteration | **Skipped entirely** — no gate is asked, no rebase, no push, no merge. The commands are printed |
| Phase 3 verification | Skipped — there is nothing to verify |

The residue, stated because a dry run that leaves a trace should say where. **Refs**:
`refs/remotes/origin/*` and `.git/FETCH_HEAD` — that set is what the explicit refspec bounds.
**Objects and metadata**: a fetch that finds new commits downloads them into the object database,
and depending on configuration git may run auto-maintenance or rewrite the commit-graph on its way
out; in a shallow clone it may update the shallow metadata too. None of that is destructive and
none of it is bounded by a refspec, which is why the promise above is "one bounded operation" and
not "one bounded write". Pass `--no-auto-maintenance --no-write-commit-graph` to suppress the
maintenance half; the downloaded objects are inherent to fetching and remain. **Nothing changes on
the remote.**

## Core Concept

After squash-merging PR N, the original commits are replaced by a single squash commit on epic. PR N+1 still contains N's original commits as its base — these must be cut via `git rebase --onto` before merging N+1. The cut point is the original tip of PR N's branch, captured in Phase 1 as a backup tag.

```
epic:    E ─── S_N (squash of PR N)
PR N+1:  E ─ A1 ─ A2 ─ ... ─ B1 ─ B2
              └── drop (in S_N) ──┘ └─ keep ─┘

After: git rebase --onto origin/epic backup/pr-<N> PR_N+1
epic:    E ─── S_N ─── B1' ─ B2'
```

## Names in commands

**A PR head branch name is not display text.** It arrives from GitHub, and `git check-ref-format`
accepts far more than the names people type: measured, `refs/heads/feat/x$(printf${IFS}PWNED>&2)`
and `refs/heads/--all` both pass, `git update-ref` creates both, and `git clone` carries both to
every copy of the repository. `git switch -C` refuses to *create* such a name, which is why they
look impossible — creation is not how they arrive.

Two separate readers, and each needs its own answer:

| Reader | What a hostile name does | The answer |
|--------|--------------------------|------------|
| The **shell** | A name pasted into a command as literal text is *evaluated*: `case "feat/x$(printf${IFS}PWNED>&2)" in` runs `printf` before the guard decides anything, and the guard then passes the branch as unprotected | **Bind once to a variable** (`head=<quoted head>`), then use `"$head"`. Expanding a variable does not re-scan for `$( )` — measured both ways |
| git's **option parser** | Quotes are consumed by the shell, so git still sees `--all` as a flag. Measured: pushing such a branch without a separator answers `Everything up-to-date` — git took the flag and pushed **every** branch, none of them the one the operator approved | The **separator**, before the ref operand |

Every `<…>` slot bound above is written `<quoted …>`: substitute a **shell-quoted** value,
single-quoted with each `'` rendered as `'\''`.

**And the separator ends option parsing, not refspec parsing — a third reader with its own
answer.** After `--`, git reads the operand as a *refspec*, where a leading `+` means "force" and a
`:` splits source from destination. `git check-ref-format refs/heads/+main` exits 0, so `+main` is a
legal branch name that the protected-head guards below compare against `main` and pass as
unprotected. Measured, with a local `main` rewound behind the remote:

```
$ git push origin -- "+main"                      # no force flag anywhere on this line
 + affcbe7...ad7e970  main -> main (forced update)   # exit 0 — a protected branch, force-updated
```

It is not only a bypass, it is the wrong branch: with a real `+main` branch present, that form
pushed `main` and never created `refs/heads/+main` on the remote, while
`refs/heads/+main:refs/heads/+main` created it correctly and left `main` untouched. So both pushes
below name a **full `src:dst` refspec**, whose first character cannot be read as `+`. Write
`${head}` in braces — `$head:refs` is a modifier expansion in zsh and silently eats the `:refs`.

**Bind at the first use, not at the first destructive one.** Phase 0 reads the names and already
puts them on a command line, so a binding that started at Phase 2 would leave the whole analysis
step evaluating them. Every fenced block below that names a ref binds it at the top of that block —
each fence is its own shell, so nothing carries over between them.

**Which separator a command takes is measured, not assumed — and for one command neither works.**
Measured on git 2.55.0:

Subcommand names below are written **without** the `git ` prefix, so that naming a command in this
table is not mistaken for issuing it:

| Subcommand | Separator | Measured |
|------------|-----------|----------|
| `push`, `fetch`, `merge-base` | `--` and `--end-of-options` | **Both accepted, equivalent.** `--` here is a convention, not a correctness requirement |
| `branch -D` | `--` | `git branch -D -- --all` deletes the branch actually named `--all`; without the separator git answers `fatal: branch name required` |
| **`rev-parse`** | **neither** | `git rev-parse -- main` prints `--` and `main` back verbatim; `git rev-parse --end-of-options main` prints `--end-of-options` **and then** the SHA — two lines. Either way the captured value is not a SHA, and Step 7 would hand it to `/watch-ci` |

`rev-parse` is therefore solved by **`--verify --quiet` with a fully-qualified ref**, never by a
separator — Step 7 below uses that form.

**The `+` refspec hazard above applies to `git fetch` too**, and it is why the epic refresh in
Steps 9 and the Iteration-1 tail names a full `src:dst` refspec rather than `"$epic"`: measured,
`git fetch origin -- '+main'` reads the `+` as the force modifier and fetches **`main`**, so an epic
literally named `+main` would leave `origin/+main` stale and every later rebase would cut against
the wrong tip.

A **rev range** takes `--` too, and for a different reason than the option one. It cannot begin with
`-`, so binding does settle the *option* question — but not the revision-versus-path one. When the
range names a ref that does not resolve, git falls back to reading the whole argument as a
**pathspec**, and if a matching path happens to exist the command **succeeds**:

```
$ git log --oneline "origin/main..origin/feat"      # ref missing, path ./origin/main..origin/feat exists
f0fb083 two                                          # exit 0 — read as a path, answered about the wrong thing
$ git log --oneline "origin/main..origin/feat" --
fatal: bad revision 'origin/main..origin/feat'       # exit 128 — the failure that should have happened
```

Measured — and the same fallback catches a **single** unresolvable ref, not just a range:
`git log --oneline "origin/gone"` answers about a path and exits 0 where `… --` fatals
`bad revision`. A wrong answer with a zero exit is worse than an error here: the manifests below
are built from these arguments and then compared, so an unreadable one degrades into a mismatch
that reads as "the rebase went wrong". **Every revision argument in this document — range or
single ref — carries the separator.**

**What this section does not close**: `git switch -C "$head" "refs/remotes/origin/$head"`. No separator form
applies — git refuses an option-shaped branch name outright there, so such a head ends the run with
git's own error and no explanation from this skill. That is a failure, not an exploit, and it is not
a handled case either. Tracked in
`docs/features/ref-name-hardening/requests/2026-08-20-ref-name-hardening-r1.md`, which owns this
defect class across the ref-handling skills.

Until that redesign lands, the Phase 0 validation gate below **detects** it rather than letting it
surface mid-run: abort if any PR head begins with `-`. That is not the redesign — it neither
fully-qualifies nor escapes anything — it only moves an opaque failure to the point before backup
tags and per-iteration approvals are created, where it costs nothing to recover from. A head
beginning with `-` is legal to git (`git check-ref-format refs/heads/-x` exits 0) but unusable
here, so refusing it loses no working case.

## Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant E as /epic-merge
    participant W as /watch-ci
    participant GH as GitHub
    E->>E: Phase 0 — analyze chain (linear?)
    E->>GH: Phase 1 — fetch + create backup tags
    Note over E,GH: Iteration 1 — direct squash (no rebase needed)
    E->>U: AskUserQuestion (bundled gate)
    U-->>E: Proceed / Dry-run / Abort
    E->>GH: gh pr merge --squash
    E->>GH: fetch updated epic
    Note over E,GH: Iteration 2..N — rebase + force-push + CI + merge
    loop For each remaining PR
        E->>U: AskUserQuestion (bundled gate)
        U-->>E: Proceed / Per-step / Dry-run / Abort
        E->>E: rebase --onto epic backup/pr-<prev>
        E->>E: verify manifest (subject + count)
        E->>GH: push --force-with-lease
        E->>GH: gh pr edit --base epic
        E->>W: /watch-ci --sha <sha> --branch <head> --timeout <ci-timeout>
        W-->>E: PASS / FAIL verdict
        E->>GH: gh pr merge --squash
        E->>GH: fetch updated epic
    end
    E->>E: Phase 3 — verify final epic log
```

### Phase 0: Analyze PR Chain

**Step 0 — the bounded refresh, before anything reads a ref.** Every count and validation below
is computed from `refs/remotes/origin/*`, so a refresh that runs afterwards refreshes nothing the
operator was shown. It used to sit in Phase 1, one whole approval gate too late.

`git fetch origin` is the wrong command for it, and not marginally: git applies the repository's
configured `remote.origin.fetch` refspecs, and those may write anywhere. Measured — one extra
`git config --add remote.origin.fetch '+refs/heads/feat/a:refs/heads/victim'`, then a plain
`git fetch origin`, printed `+ 425e2ea...0a77df9 feat/a -> victim (forced update)` and destroyed
a local branch. Default tag following and submodule recursion are two more write paths on the same
command. So the refresh is spelled out rather than left to configuration:

Before that, one refusal — and it precedes the refresh rather than following it, because the
refresh is itself a transport operation *that writes refs*: redirected, it does not merely
misreport the chain, it fills `refs/remotes/origin/*` from another repository, and every count,
backup tag, rebase destination and lease below is computed from exactly those refs.

```bash
# ── Step 0a: the interpreter, before anything else ────────────────────────────
# First, because every check below is only as good as the shell running it. A non-interactive bash
# SOURCES `$BASH_ENV` before line 1 of this fence; zsh does the same with `$ENV` under sh
# emulation. A sourced file may define a function whose name contains a slash — bash refuses to
# IMPORT such a name from the environment, which is why the prefix is spelled absolutely, but it
# does not refuse to DEFINE one. Measured 2026-08-22, bash 3.2.57 and zsh 5.9: with
# `function /usr/bin/env { …; }` defined, the word `/usr/bin/env` resolved to the function and the
# child never ran. Every reading this phase prints, and every attestation the iteration gates
# collect, would then be whatever that function chose to say.
#
# **This block contains no command word, and that is the design.** Two `[[ ]]` tests (a keyword the
# parser resolves — a function cannot outrank it), three assignments (syntax, not commands), one
# expansion. Round 65 rewrote it after measuring the two ways the first version failed:
#   * it read its sentinel without resetting it, so an exported `SD0X_EPIC_MERGE_REFUSED=1` satisfied
#     the expansion and the fence continued with status 0 — the refusal printed and nothing stopped;
#   * it used `${!name+set}`, bash indirect expansion, which zsh rejects as `bad substitution`
#     even under `--emulate sh` — so on macOS's default shell it aborted at the first iteration
#     whether or not anything was set, and the `ENV` refusal it documents never ran.
# Assign, THEN expand: `:?` fires on null **or** unset, so assigning empty one line above makes it
# fire unconditionally. Set-ness, not emptiness, for what is DETECTED (`${BASH_ENV+set}` — an
# exported empty value is still a file the parent named); names never values (Anchor Register #2).
#
# What this does NOT close, stated because the comment that used to stand here over-claimed: a
# startup file that defines the function and then unsets the variable leaves nothing to detect. That
# residue has no owner downstream — the `pre-push` hook is opt-in, so where it is absent the
# in-session approval is the whole credential (`rules/git-workflow.md` § Push safety).
SHELL_STARTUP_INHERITED=
[[ -n "${BASH_ENV+set}" ]] && SHELL_STARTUP_INHERITED=BASH_ENV
[[ -n "${ENV+set}" ]] && SHELL_STARTUP_INHERITED="${SHELL_STARTUP_INHERITED:+${SHELL_STARTUP_INHERITED}, }ENV"
if [[ -n "$SHELL_STARTUP_INHERITED" ]]; then
  # No apostrophe anywhere in the word: inside `${var:?word}` bash reads one as an opening quote
  # even within double quotes, and that is a PARSE error — it would take the whole fence down on
  # every run, refusing and ordinary alike. Measured 2026-08-22.
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — ${SHELL_STARTUP_INHERITED} is set in this environment.
   That startup file is sourced before line 1 of this fence and can redefine the commands below,
   including the absolute /usr/bin/env prefix (measured). Nothing this phase reports could then be
   relied on, and the in-session approval is the only credential where the opt-in pre-push hook is
   not installed. Unset it and re-run. Nothing is planned and nothing is pushed.}"
fi

# Transport variables decide WHERE git’s traffic goes — which repository is read from and
# written to — so nothing is planned while any of them is set. Four names, each measured 2026-08-22 on git 2.55.0 / OpenSSH 10.3p1: `GIT_SSH_COMMAND`,
# `GIT_SSH` and `GIT_PROXY_COMMAND` are run BY git AS the connection, handed the host and the
# remote command as arguments they are free to ignore; `GIT_SSH_VARIANT` names no executable at
# all but changes the argv git BUILDS — under `=plink` a URL's `:2222` is emitted as OpenSSH's
# `-P`, which takes a *tag* rather than a port (`ssh` usage: `[-P tag]`), so the connection
# silently falls back to 22.
#
# Refusing here, rather than relying on the `-u` clearing every command below carries, is this
# step's whole point. Clearing is not a neutral act: an operator's own
# `GIT_SSH_COMMAND='ssh -p 2222'` encodes part of the destination, and dropping it moves the push
# to port 22 — which SUCCEEDS silently wherever that host serves the same path there too. Set or
# cleared, the URL and digests this phase prints would then describe a destination the push does
# not reach, which is the one thing this phase exists to prevent. The `-u` list stays as defence
# in depth, for any caller that arrives at a later phase without passing through here.
#
# Set-ness, not emptiness, is the test — measured: an exported-empty `GIT_SSH_COMMAND` is not
# treated as unset, git runs `''` as the command (`run_command: GIT_PROTOCOL=version=2 '' -G …`).
# `${VAR+set}` — the direct form, one literal test per name — is what delivers it below; the
# indirect `${!_n+set}` a loop would need is bash-only and is why the loop is gone (next
# paragraph). Names are printed and values never are: a transport
# command line routinely carries a key path (Anchor Register #2).
# Four literal tests rather than a loop over `${!_n+set}`. That is **bash** indirect expansion and
# zsh 5.9 rejects it outright — `bad substitution`, rc=1, even under `--emulate sh` — so on the
# platform's default shell the loop aborted at its FIRST iteration whether or not anything was set:
# this refusal never ran, and neither did anything below it. Measured 2026-08-22. Round 65 took the
# same construction out of step 0a and left this copy, one block away, standing.
TRANSPORT_PRESENT=
[[ -n "${GIT_SSH_COMMAND+set}" ]] && TRANSPORT_PRESENT=GIT_SSH_COMMAND
[[ -n "${GIT_SSH+set}" ]] && TRANSPORT_PRESENT="${TRANSPORT_PRESENT:+${TRANSPORT_PRESENT}, }GIT_SSH"
[[ -n "${GIT_PROXY_COMMAND+set}" ]] && TRANSPORT_PRESENT="${TRANSPORT_PRESENT:+${TRANSPORT_PRESENT}, }GIT_PROXY_COMMAND"
[[ -n "${GIT_SSH_VARIANT+set}" ]] && TRANSPORT_PRESENT="${TRANSPORT_PRESENT:+${TRANSPORT_PRESENT}, }GIT_SSH_VARIANT"
if [[ -n "$TRANSPORT_PRESENT" ]]; then
  echo "⛔ transport variables set in this environment: ${TRANSPORT_PRESENT}" >&2
  echo "   Each one decides where a push lands, so neither honouring nor clearing them lets this" >&2
  echo "   phase describe the destination that would be reached." >&2
  echo "   Move the setting to ~/.ssh/config or 'git config core.sshCommand' — per-host, durable," >&2
  echo "   and visible to 'git config' — then re-run. Nothing is planned or pushed until then." >&2
  # Terminated the way step 0a is, and for the same measured reason: `exit` is a builtin, and an
  # imported `BASH_FUNC_exit%%` that returns leaves the refusal printed and the phase running.
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — transport variables set in this environment}"
fi
```

```bash
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git fetch --refmap= --no-tags --no-recurse-submodules --upload-pack=git-upload-pack origin \
  '+refs/heads/*:refs/remotes/origin/*' || {
  echo "⛔ cannot refresh origin — the chain table below would be computed from stale refs" >&2
  # Not `exit`. This document's own operating model is that an exported `BASH_FUNC_exit%%`
  # outranks the builtin (§ Names in commands), and the startup guard checks `BASH_ENV`/`ENV`
  # only — an imported function is not a variable it can see. Measured 2026-08-22 under bash 3.2:
  # with `exit() { return 0; }` imported, this arm printed its refusal and the group returned 0,
  # so every step below ran against stale remote-tracking refs. Assign-then-expand, as in the
  # `PHASE1_OK` / `ITER1_OK` / `PUSH_BLOCKED` blocks that already do this.
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — origin could not be refreshed; the chain table would be stale}"
}
```

`--refmap=` discards the configured refmap so only the refspec written here applies; `--no-tags`
and `--no-recurse-submodules` close the other two. `--upload-pack=git-upload-pack` closes a
fourth, and it is the one that decides *which repository answers*: `remote.origin.uploadpack`
names the program run at the far end, so a configured value serves refs from wherever it likes
while the URL still reads as `origin`. Measured — with `remote.x.url` pointing at a path that
does not exist and `remote.x.uploadpack` pointing at this repository, `git ls-remote x HEAD`
printed this repository's refs and exited 0; with `--upload-pack=git-upload-pack` on the
command line the same call failed 128. It is pinned on every fetch and `ls-remote` in this
document and in `/push-ci`, symmetrically with `--receive-pack=git-receive-pack` on the pushes:
a measurement and the push that acts on it must reach the same repository, and the read is the
half that had no pin. Measured against the same hostile
configuration, `victim` was left untouched. What still gets written is `.git/FETCH_HEAD` — which
is why § Arguments calls a dry run bounded rather than read-only.

```bash
# For each PR, get head/base branch and unique commit count.
# `gh pr view` reports the names; bind them before any of them reaches a command line
# (§ Names in commands). This is the FIRST place a PR head is used, so binding only at
# Step 0 of Phase 2 would leave this line evaluating whatever the name contains.
# Its status is guarded HERE. It is the only evidence the PR was read at all, and every line
# below derives head, base and the commit count from what it printed — so a later command
# overwriting `$?` lets this fence exit 0 having read nothing and report a chain it invented.
if ! /usr/bin/env -u BASH_ENV -u ENV gh pr view <N> --json number,headRefName,baseRefName,title,state; then
  echo "⛔ Phase 0: the PR could not be read — the view command exited nonzero. head, base and" >&2
  echo "   the commit count below all derive from its output, and there is none. STOP." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the PR could not be read}"
fi
head=<quoted head>
base=<quoted base>
# `--` closes revision-vs-path ambiguity: without it a range naming a ref that does not
# exist locally can be read as a pathspec instead. And the count is taken in two steps,
# never as `git log … | wc -l`: a pipeline exits with `wc`'s status, so a `git log` that
# fataled reports **0 unique commits** and the chain table shows a PR as empty when it was
# actually unreadable. Measured — the failing pipeline exits 0.
# Fully qualified, never the `origin/<name>` shorthand. That shorthand is DWIM, and git
# resolves `refs/tags/<name>` BEFORE `refs/remotes/<name>`: a tag literally named
# `origin/feat/a` is a legal ref name (`git check-ref-format refs/tags/origin/feat/a` exits 0)
# and wins. Measured — with such a tag present, `git rev-parse origin/feat/a` warns
# "refname is ambiguous" and prints the TAG's commit, while `refs/remotes/origin/feat/a`
# prints the branch's. A warning on stderr is not a refusal, so the range is silently wrong
# and every count, backup and rebase destination derived from it is wrong with it.
range=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git log "refs/remotes/origin/$base..refs/remotes/origin/$head" --oneline --) || {
  echo "⛔ cannot read refs/remotes/origin/$base..refs/remotes/origin/$head — run step 0, or the PR refs are missing" >&2
  # Not `exit`, for the reason the refresh arm above gives: the builtin is outranked by an
  # imported `BASH_FUNC_exit%%`, and this arm sets no flag a later guard could read, so a
  # shadowed `exit` turns an unreadable range into a reported zero-commit PR.
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the PR revision range could not be read}"
}
# A legitimate empty range is a count, not a failure — `grep -c` would exit 1 on it and a
# caller running under `set -e` would abort on a PR that simply has no unique commits.
# Absolute paths for the same reason as the classifier report below: this line's stdout **is** the
# commit count every later step derives from, and both `echo` and `printf` are builtins a caller's
# exported function outranks. **`wc` being external does not help**: shell function lookup comes
# before PATH as well as before the builtins, so a bare `wc` is claimable by exactly the same
# import. Measured 2026-08-22 — an imported `wc() { echo 999; }` made this pipeline print `999`
# and still exit 0, forging the count in the chain table. Both words are absolute, so the whole
# value leaves through names no `BASH_FUNC_*` can claim: bash refuses to import a function whose
# name contains a slash.
if [[ -z "$range" ]]; then /usr/bin/printf '%s\n' 0; else /usr/bin/printf '%s\n' "$range" | /usr/bin/wc -l; fi
```

Output a chain table:

| Order | PR | Head Branch | Base Branch | Unique Commits | State |
|-------|-----|-------------|-------------|----------------|-------|
| 1 | #100 | `feat/A` | `epic/xxx` | N | OPEN |
| 2 | #101 | `feat/B` | `feat/A` | N | OPEN |
| ... | ... | ... | ... | ... | ... |

**Validation gate** — abort if any of:
- **The first PR's base is not `<epic-branch>`** — the linearity check below only relates each PR
  to the one before it, so PR 1 has nothing to be checked against and its base would go
  unverified. That is not a cosmetic gap: iteration 1 runs `gh pr merge <first-PR> --squash`,
  which merges into **that PR's own base**, whatever it is. A chain whose first base drifted to
  some other branch would therefore mutate that branch, and every later step would proceed on the
  false premise that `<epic-branch>` had received the commits. Compare
  `gh pr view "$first" --json baseRefName -q .baseRefName` against the requested epic branch and
  hard-abort on mismatch — before Phase 1 backups, so nothing is written first
- **Any PR's head branch name begins with `-`** — option-shaped and unusable at
  `git switch -C` (see § above); refuse before anything is written, not mid-run
- A PR's base is not the previous PR's head (chain not linear)
- Any PR is not OPEN
- Any PR has uncommitted local changes on its head branch
- Working tree is dirty (`git status --porcelain` non-empty)
- **Any PR's head branch is protected** (`main`, `master`, `develop`, `release/*`) — a PR
  head is not inherently unprotected (a PR can be opened *from* `main`), Step 5 force-pushes
  every head, and force push to shared branches is prohibited (`rules/git-workflow.md`
  § Prohibited). Exact match only: `feat/main-menu` and `release-notes` are not protected.
  Step 5 and Rollback re-assert this guard, so a chain that slipped past Phase 0 still
  cannot rewrite a **protected** branch. **That is not the same as "cannot rewrite a shared
  branch"**, and the difference is not pedantry: `rules/git-workflow.md` § Prohibited forbids
  force-pushing *shared* branches, and shared is a fact about who else holds the branch — not
  something any ref inspection can decide. A two-person `feat/*` head is shared and this guard
  passes it — but Step 5 no longer reaches the push unchallenged. The protected list is the
  decidable half of the shared set, chosen as the conservative side of a judgment; the
  undecidable half was an open authorization question, and it was **settled on 2026-08-21 as
  option A** in
  `docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`:
  `pre-push-gate.sh` refuses a push that rewrites history unless the operator attests the
  rewritten refs are unshared (`ALLOW_FORCE_UNSHARED=1`, or `yes` at its `/dev/tty` prompt).
  The one exclusion is a ref the protected prompt already covers, so **no single ref is asked
  about twice**. That is the claim; "one push never asks twice" was the earlier wording and it
  overstates it — a push carrying a protected fast-forward *and* an unprotected rewrite fires both
  prompts, one per ref. This skill cannot produce such a push (it pushes one refspec per iteration),
  but the scoping argument has to be stated at the strength it actually holds, because that is the
  wording the hook’s own comment was corrected to.
  **This skill must never set that variable, and Step 5 clears it** — it is the operator’s answer,
  not the skill’s, and this workflow pushes in a loop, which is the shape session caching makes
  unsafe. Setting it answers the hook’s question; passing an ambient one through lets the shell
  answer it; only clearing it guarantees the operator is asked. Where the hook is **not** installed
  nothing at `/dev/tty` asks anything, so the per-iteration AskUserQuestion is the only attestation
  there will be — which is why the gate table asks the unshared question **by name** and first,
  rather than folding it into the force-form approval. Option A requires this skill to refuse
  without the evidence, and a question that never mentions sharedness collects approval, not
  evidence

#### On a gated repo with no controlling terminal, this skill cannot proceed — **and cannot roll back**

Every push this skill makes is a rewrite by construction (Step 5 pushes a rebased head; Rollback
rewinds one), so on a repo with the gate installed both reach `/dev/tty`. One exception, and it
falls the safe way: an iteration whose head is already based on the target rebases to a no-op, local
and remote OIDs match, git sends no ref, and the hook exits 0 without prompting — nothing was
rewritten, so nothing needed asking. "Every" is the rule for every push that changes anything.

The same `-u GIT_EXEC_PATH` that leads both push forms is not cosmetic here either: git prepends its
exec-path to PATH before running a hook, so an ambient `GIT_EXEC_PATH` chooses the `git` the gate
asks about ancestry — and a gate that mis-answers ancestry sees a rebased head as a fast-forward.
Measured on 2026-08-21: a forced update landed with exit 0 and no prompt. From an agent shell there
is no terminal to reach, and the gate refuses with `Cannot open /dev/tty …` and exit 1.

The `GIT_*` names that follow it answer the same question about **configuration and ancestry**. Three
were measured the same day: `GIT_CONFIG_COUNT` carrying `core.hooksPath=/dev/null` removes the gate
outright, the same channel carrying `url.<host>.insteadOf` sends the approved refspec to another
server, and `GIT_GRAFT_FILE` leaves the gate installed while making its `merge-base --is-ancestor`
answer "fast-forward" for a rewrite. This skill pushes in a loop, which is where an ambient one is
most dangerous: it is set once and answers every iteration.

`GIT_GRAFT_FILE=/dev/null` and `GIT_NO_REPLACE_OBJECTS=1` are **set** rather than unset — the only
two names in the prefix that work that way, and for the same reason. Unsetting `GIT_GRAFT_FILE`
restores its *default* path, `$GIT_DIR/info/grafts`, a file inside the repository that no `-u` can
reach, so the strip closes one channel by opening another (measured 2026-08-21). Unsetting the
other restores git's *default* of honouring `refs/replace/*`, so a
`git replace --graft L R` sitting in the repository makes that same ancestry oracle answer
"fast-forward" for a rewrite — while the transfer publishes the real, unrelated L, because pack
transfer ignores replacements. The gate is asked a question whose answer the push then disregards,
and that asymmetry belongs to pushing alone. Measured 2026-08-21: honest 1, grafted 0, guarded 1.

`GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_PROXY_COMMAND` are stripped for a third reason, distinct from
both above: each names an executable git runs **in place of the connection**, so it decides *where
the bytes go*, not how they are authenticated. Measured 2026-08-22 on git 2.55.0 — the wrapper is
invoked as `<host> "git-receive-pack '/team/a.git'"` and is free to ignore both arguments. This skill
pushes in a loop, which is where an inherited one is worst: set once, it redirects every iteration
while Phase 0's digest, the operator's approval and the hook all still describe `origin`.
`GIT_ASKPASS` is left alone, and the distinction is measurable rather than stylistic: it is handed a
prompt and returns a credential, so it cannot choose a destination. The strip closes the
**environment** channel only — `core.sshCommand` and `url.*.insteadOf` in the repository's own config
still apply, which is both deliberate (that config is the operator's) and what keeps their key
selection working here.

The half worth stating plainly is the second one: **the recovery path is refused on exactly the same
grounds as the path that failed.** A chain interrupted mid-iteration therefore cannot be unwound from
here — the backup tag exists, and the push that would restore it is the one being refused. Do not
read the rollback failure as a second, worse fault; it is the first one seen twice.

What to do, in order:

1. **Stop the loop and report which iteration it stopped at**, plus the backup tag
   (`backup/pr-<N>`). Nothing is lost — the tag is local and the remote is untouched, because the
   refused push never happened.
2. **Point the operator at the command already written here** — Step 5's for resuming the
   iteration, Rollback's for unwinding it — to run in their own terminal, where the gate can ask
   them. **Do not restate either command in the report.** This document contains exactly two push
   commands and `test/skills/epic-merge.test.js` pins that pair by equality; a third copy written
   for a recovery note is a second source of truth for the most dangerous line in the skill, and
   the one that drifts is always the copy nobody re-reads. Name the step, quote nothing.
3. **Never set `ALLOW_FORCE_UNSHARED` or `ALLOW_PUSH_PROTECTED` to get past it** (§ Prohibited) —
   including on the rollback, where the temptation is strongest because the push looks like a repair.
   It is still a rewrite of a ref somebody else may hold, which is precisely the question nobody is
   present to answer.
4. **Never push without the full `/usr/bin/env -u` prefix, and never let one of its names
   through.** The absolute path is load-bearing: a bare `env` is shadowed by an imported
   `BASH_FUNC_env%%` function, which ignores every `-u` (measured), and `command env` is shadowed
   too because functions outrank builtins. A word containing `/` closes the **import** vector —
   bash refuses to import a function whose name contains one — but does not make the word immune:
   measured 2026-08-22, a `$BASH_ENV` file defining `function /usr/bin/env` is sourced before the
   fence's first line and intercepts the prefix in the fence's own shell (`bash -p` refuses the
   sourcing; a markdown fence cannot ask for `-p`). A shell already running attacker-chosen code
   forges `git` just as easily, which is why the terminal credential is the hook under `-p`, not
   this prefix. The
   `BASH_ENV`/`ENV` half, `GIT_EXEC_PATH`, and the `GIT_*` configuration and ancestry names. Each
   answers, from the caller's shell, a question the gate is supposed to ask now: which interpreter
   reads the hook, which `git` it consults, which configuration that `git` resolves (including
   whether the hook exists at all), and what ancestry it reports. Measured 2026-08-21 — dropping the
   configuration half alone force-updated a protected `main` at exit 0 with no gate. `GIT_SSH_COMMAND`,
   `GIT_SSH` and `GIT_PROXY_COMMAND` are in the prefix for a related but distinct reason — git runs
   each as the connection itself, so they choose *where the bytes go* (see above). `GIT_ASKPASS` is
   deliberately **not** in the prefix and must not be added: it is handed a prompt and returns a
   credential, so it cannot select a remote, and stripping it breaks the operator's credential
   helper on a push that is otherwise exactly what was approved.

### Phase 1: Pre-flight Backup

Creates safety nets. Original branch tips and PR-level commit fingerprints persist as git tags + manifest files so they survive shell session loss.

No fetch here — § Phase 0 step 0 already refreshed `refs/remotes/origin/*`, bounded. A second
fetch at this point would re-open the write paths step 0 closed and would refresh refs the
operator has already been shown a plan for, which is the reordering defect, not a safety net.

Every ref below is **fully qualified**, for the reason § Phase 0 step 0 measures: `origin/<name>`
resolves a same-named tag first, so a backup taken through the shorthand can tag the wrong commit
— and a backup of the wrong commit is worse than none, because the rollback path trusts it.

```bash
# Collision-safe backup tags keyed by PR number (NOT branch basename)
# PHASE1_OK is this fence's verdict, and it is an ASSIGNMENT for the same reason `PUSH_BLOCKED`
# is one: a refusal spelled `exit` is a refusal an imported function can swallow. `break` is an
# optimisation, never the guard — the flag is set once, cleared by any failure, and never set
# again, so the last line below states the verdict whatever the loop did after the failure.
PHASE1_OK=1
for pr in <PR-numbers>; do
  head_branch=$(/usr/bin/env -u BASH_ENV -u ENV gh pr view "$pr" --json headRefName -q .headRefName) || { echo "⛔ PR ${pr}: head branch unreadable — no backup tag exists for it" >&2; PHASE1_OK=; break; }
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git tag -f "backup/pr-${pr}" "refs/remotes/origin/${head_branch}" || { echo "⛔ PR ${pr}: backup tag not created — the rollback point Phase 2 promises does not exist" >&2; PHASE1_OK=; break; }
done

# Stable manifest per PR (subject-only — survives SHA rewrite during rebase).
# Written inside the git directory, NEVER the worktree: at the repo root these are
# untracked files, `git status --porcelain` lists them as `??`, and the rollback in
# § Recovery refuses on any nonempty porcelain output — so writing them beside the
# working files would make the recovery path unreachable in exactly the runs that
# create them. Measured: `?? .epic-merge-pr-100.manifest` at the root vs empty
# porcelain under `.git/epic-merge/`.
MANIFEST_DIR=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --git-path epic-merge) || { echo "⛔ the git directory could not be resolved — there is nowhere to write the manifests" >&2; PHASE1_OK=; }
/bin/mkdir -p "$MANIFEST_DIR" || { echo "⛔ the manifest directory could not be created — Step 4 would compare against a file that was never written" >&2; PHASE1_OK=; }

[[ -n "$PHASE1_OK" ]] && for pr in <PR-numbers>; do
  head=$(/usr/bin/env -u BASH_ENV -u ENV gh pr view "$pr" --json headRefName -q .headRefName) || { echo "⛔ PR ${pr}: head branch unreadable — no expected manifest exists for it" >&2; PHASE1_OK=; break; }
  base=$(/usr/bin/env -u BASH_ENV -u ENV gh pr view "$pr" --json baseRefName -q .baseRefName) || { echo "⛔ PR ${pr}: base branch unreadable — no expected manifest exists for it" >&2; PHASE1_OK=; break; }
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git log "refs/remotes/origin/${base}..refs/remotes/origin/${head}" --pretty=format:'%s' -- > "${MANIFEST_DIR}/expected-pr-${pr}.manifest" || { echo "⛔ PR ${pr}: expected manifest not written — Step 4 would compare against nothing" >&2; PHASE1_OK=; break; }
done

# The fence's exit status. Zero only if every backup tag and every expected manifest exists —
# a `for` loop reports its LAST iteration, so without this line a failure on the first PR is
# erased by a success on the second, and Phase 2 force-pushes with no rollback point.
[[ -n "$PHASE1_OK" ]]
```

**Why `backup/pr-<N>`**: branch basenames collide (`feat/foo` vs `fix/foo` both become `foo`). PR numbers are globally unique within the repo.
**Why subject-only manifest**: rebase rewrites SHAs; commit subjects are stable across rebases (assuming no `--squash`/`--fixup` mid-rebase), so subject + count is the invariant that survives the operation. **What it verifies, precisely**: that no subject went missing, got duplicated, or changed order. It says nothing about *content* — a conflict resolution, or any amend that keeps the subject, changes the tree while the `diff` stays green. So this is a **structural** check, and it is weakest exactly where it is needed most: right after manual conflict resolution. Before calling a rebased branch verified, compare the patches as well — `git range-diff "refs/tags/backup/pr-<N>...$head"` — and read the resolved hunks; on any PR whose rebase hit a conflict, CI is the evidence, not the manifest.
**Why origin refs**: local branches drift; `origin/*` is SSOT.
**Why tags**: shell variables die on session interruption; tags persist in `.git/refs/tags/`.

### Phase 2: Sequential Merge Loop (gated)

#### Iteration 1 (First PR) — direct squash, no rebase

```bash
# AskUserQuestion gate (see Iteration Gate Design below)
# On Proceed:
ITER1_OK=1
/usr/bin/env -u BASH_ENV -u ENV gh pr merge <first-PR> --squash || { echo "⛔ PR <first-PR>: the squash merge failed — the epic branch is unchanged, and iteration 2 must not proceed as though PR 1 had merged" >&2; ITER1_OK=; }
epic=<quoted epic>
# The refresh is not bookkeeping: iteration 2 rebases onto `refs/remotes/origin/${epic}`, so a
# fetch that fails leaves that ref at the pre-merge tip. Its status is therefore read, not assumed.
ITER1_REFRESHED=
if [[ -n "$ITER1_OK" ]]; then
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git fetch --upload-pack=git-upload-pack origin -- "+refs/heads/${epic}:refs/remotes/origin/${epic}"; then
    ITER1_REFRESHED=1
  else
    echo "⛔ PR <first-PR> merged, but refreshing refs/remotes/origin/${epic} failed. The merge" >&2
    echo "   stands and must not be repeated; the RUN must stop, because iteration 2 would rebase" >&2
    echo "   onto the pre-merge tip and force-push history without PR <first-PR> in it." >&2
    echo "   Re-run the fetch by hand, confirm origin/${epic} moved, then resume (§ Recovery)." >&2
  fi
fi

# The fence's exit status. Without the first conjunct a failed squash merge is erased by the fetch
# that follows it, and the run continues into iteration 2 with PR 1 silently unmerged. Without the
# second, a failed FETCH is erased the same way — PR 1 merged, `origin/${epic}` stale, and the
# iteration that reads that ref never told anything went wrong.
[[ -n "$ITER1_OK" ]] && [[ -n "$ITER1_REFRESHED" ]]
```

#### Iteration 2..N — gate first, then rebase + force-push + CI + merge

For each subsequent PR (PR `<N>` with head branch `<head>`, previous PR was `<prev>`):

```bash
# PUSH_BLOCKED is this fence's own refusal record, and it exists because `exit` cannot be trusted
# to end the fence. `exit` is a builtin, so an imported `BASH_FUNC_exit%%` function outranks it —
# measured on bash 3.2.57: a refusal printed in full and the force-push then ran, exit status 0. No
# keyword terminates a shell (`return` is a builtin too), so the fix is not a better terminator: a
# refusal RECORDS itself in an assignment, and the push below is reached only through `[[ ]]`,
# which the parser resolves before any name is looked up.
# The record is FROZEN, not merely written — this paragraph used to say an assignment is something
# "nothing outranks", which confuses the command with the value. The command cannot be outranked;
# the value it wrote can be erased by whatever runs next, and under this vector that is the hostile
# function itself: `BASH_FUNC_exit%%='() { PUSH_BLOCKED=; return 0; }'` cleared the flag and the
# push ran at status 0 (measured 2026-08-22, bash 3.2.57 and 5.3.15). `readonly` at every pre-push
# refusal site below closes it — the erasing assignment, `unset` and `declare -g` each fail against
# a readonly name and the refusal held on both shells. The post-push sites that only accumulate a
# status stay plain assignments: no `exit` runs between them and the guard, so the vector needs a
# terminator it never gets. What none of this closes is injection — an environment that can define
# `exit` can define `git`, measured the same day intercepting a whole push. The record defends the
# case where the terminator alone was trusted; it was never a fence against imported functions.
# `exit 1` stays —
# in an ordinary shell it is still right, and it is no longer the only thing standing between a
# refusal and a force-push. Cleared here rather than defaulted, so an exported value of the same
# name cannot pre-approve anything either.
#
# The guard sits on its own physical line, ending in `&& \`, so the push line's own bytes stay
# out of it: everything after the `push` subcommand on that line is read as this push's argv,
# by the byte pin and by the forbidden-flag scan alike, and a guard written INTO the line would
# put words there that git never sees.
# This paragraph used to say the two force-pushes are byte-identical by design. They are not,
# and have not been since round 60 gave Step 5 an explicit `--force-with-lease=<ref>:<expect>`
# and dropped `--force-if-includes` from it — measured on git 2.55.0, the flag is a silent no-op
# once the lease carries a value. Round 75 put the rollback push on the same shape, so what
# separates them now is one variable name: `$FINAL_TIP` here, `$RB_TIP` there. What the two share
# is the refspec — an object ID on the left, under the same name, so neither publishes something
# later than what it classified — and now the lease as well, each bound to the tip its own fence
# measured. Both are
# pinned; the pins are what make the difference visible in a diff rather than something a reader
# has to notice.
PUSH_BLOCKED=

# Step 1: AskUserQuestion BEFORE any destructive op (see Gate Design)
#   On Proceed: continue Steps 2-9 atomically
#   On Per-step: re-prompt before push (Step 5) and merge (Step 8)
#   On Dry-run: print Steps 2-9 commands, do not execute
#   On Abort: stop, leave backup tags in place

# Step 0: Bind the names ONCE — see § Names in commands. Substituting a branch name
# into the lines below as literal text runs whatever it contains; a variable does not.
head=<quoted head>
epic=<quoted epic>
# Re-derived here, not inherited: this fence is a separate shell from Phase 1's, so the
# `MANIFEST_DIR` set there is gone. Unset, `"${MANIFEST_DIR}/actual-pr-<N>.manifest"`
# expands to `/actual-pr-<N>.manifest` and Step 4 writes at the filesystem root.
# Checked, and checked HERE rather than at the write: the two commands below rewrite the branch,
# so a failure discovered at Step 4 is discovered after the damage. An empty `MANIFEST_DIR`
# expands `"${MANIFEST_DIR}/actual-pr-<N>.manifest"` to `/actual-pr-<N>.manifest` — the
# filesystem root — which is the same class § 4.36 records for cleanup, reached one step later.
MANIFEST_DIR=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --git-path epic-merge) || MANIFEST_DIR=
if [[ -z "$MANIFEST_DIR" ]]; then
  echo "⛔ the manifest directory could not be derived — Step 4 would compare against a file" >&2
  echo "   written at the filesystem root, and the checkout and rebase below would already have" >&2
  echo "   happened. Nothing is checked out and nothing is pushed." >&2
  readonly PUSH_BLOCKED=1
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the manifest directory could not be derived}"
fi

# Step 2: Checkout fresh from remote. Fully qualified — a tag named `origin/<head>` outranks
# the remote-tracking ref in DWIM resolution (§ Phase 0 step 0), and this is the start point
# every later step is measured against.
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git switch -C "$head" "refs/remotes/origin/$head"; then
  echo "⛔ could not check out refs/remotes/origin/$head for PR <N> — the start point every later" >&2
  echo "   step is measured against does not exist here. STOP; nothing after this means anything." >&2
  readonly PUSH_BLOCKED=1; exit 1
fi

# Step 3: Rebase — cut already-squashed commits, replay unique ones onto epic
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --onto "refs/remotes/origin/$epic" "refs/tags/backup/pr-<prev>" -- "$head"; then
  echo "⛔ the rebase did not complete for PR <N>. A rebase is probably still in progress and the" >&2
  echo "   working tree holds a partial replay — pushing it would publish a branch nobody approved." >&2
  echo "   STOP. Resolve and continue, or abort and restore from the backup tag:" >&2
  echo "     git rebase --abort" >&2
  echo "     git switch -C \"$head\" refs/tags/backup/pr-<N>" >&2
  echo "   No abort is issued here: it would discard conflict resolution the operator may have done." >&2
  readonly PUSH_BLOCKED=1; exit 1
fi

# Step 4: Verify manifest (subject + count, NOT SHA) — see the guarantee's limits below.
# Named per PR, not one shared `actual` file: the loop visits each PR in turn, and a
# single shared name is also what two concurrent runs would fight over.
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git log "refs/remotes/origin/$epic..$head" --pretty=format:'%s' -- > "${MANIFEST_DIR}/actual-pr-<N>.manifest"; then
  echo "⛔ could not write the actual manifest for PR <N> — there is nothing to compare, so the" >&2
  echo "   verification did not happen. Nothing is pushed. STOP." >&2
  readonly PUSH_BLOCKED=1; exit 1
fi
if ! /usr/bin/diff "${MANIFEST_DIR}/expected-pr-<N>.manifest" "${MANIFEST_DIR}/actual-pr-<N>.manifest"; then
  echo "⛔ manifest mismatch for PR <N>: the rebased branch is not the branch that was approved." >&2
  echo "   Nothing is pushed. Restoring the branch from its backup tag:" >&2
  if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git switch -C "$head" "refs/tags/backup/pr-<N>"; then
    echo "⛔ and the restore FAILED — the working tree is in neither state. Do not push." >&2
    echo "   git status, then: git rebase --abort (if one is in progress) and re-run the switch." >&2
  fi
  readonly PUSH_BLOCKED=1; exit 1
fi

# Step 5: Force-push (--force-with-lease, NEVER --force) — and never to a protected
# branch: re-assert the Phase 0 check right before the push, exact match only
case "$head" in
  main|master|develop|release/*)
    echo "⛔ PR head '$head' is a protected branch — force push to shared branches is prohibited" >&2
    readonly PUSH_BLOCKED=1; exit 1
    ;;
esac
# The rebase above makes this push non-fast-forward by construction, and the opt-in
# pre-push hook refuses that outright (`exit 1`, no prompt) unless the caller declares
# the lease form — so without this prefix the skill cannot complete on a gated repo.
# ALLOW_PUSH_PROTECTED is *cleared*, never set: the guard above already refused every
# protected head, and inheriting a `1` would silently disarm the hook's own check.
# …and never to a different repository than the approval named. Same divergence as the probe
# above, one step later: re-resolve the push destination here and compare it against the redacted
# destination the approval **named in its own question text** — every bundled, per-step and
# rollback gate carries `<PUSH_URLS_SAFE>`, because a fence comparing against a value the
# operator was never shown detects a later config change while authorizing nothing. A config
# change between the question and the push would otherwise redirect an approved history rewrite
# to another repository, silently.
# `PUSH_URL` — the single destination — is derived HERE, in the same conditional that reads
# the list, because the post-push verification at the end of this fence looks the ref up over
# it. A fence that consumes a value it never derives reads empty in a fresh shell and stale in
# a reused one, and both of those look like a working step: the empty one blocks every
# iteration, the stale one verifies a destination this iteration never resolved.
if PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git remote get-url --push --all origin); then
  PUSH_URL=${PUSH_URLS%%$'\n'*}
else
  PUSH_URLS=; PUSH_URL=
fi
# A push URL can carry credentials — `https://user:token@host/repo.git`, returned verbatim by
# the command above (measured 2026-08-21). The raw value never leaves this shell: everything the
# operator sees, and everything compared against an approval, is the redacted form. Three
# credential-bearing components are masked whole: userinfo — split at the LAST `@` inside the
# authority, because git parses it that way and the first `@` leaves the tail of a password
# behind — plus query and fragment, since `?access_token=` is a credential no userinfo mask
# reaches. Comparing redacted forms costs this: two destinations differing inside a masked
# component read alike. For userinfo that merges two credentials for one repository, never two
# repositories. For query and fragment the loss is real where a host identifies the repository by
# parameter, and round 54 stopped accepting it — `https://gw.example/push?repo=A&token=one` and
# `…?repo=B&token=two` redact to one string (measured), so a guard on the redaction alone binds
# an approval to a host and a path rather than to a repository. Identity is therefore compared on
# a one-way digest of the RAW list and the redaction is only displayed; the alternative that was
# rejected — printing the token — is still rejected. Scheme, host and path are never
# masked, so a redirect to a different repository is still caught even before the digest. `scripts/pre-push-gate.sh`
# applies the same transformation to its prompts; keep them in step.
PUSH_URLS_SAFE=
while IFS= read -r U; do
  case "$U" in
    *://*)
      REST=${U#*://}; AUTH=${REST%%/*}; AUTH=${AUTH%%\?*}; AUTH=${AUTH%%\#*}
      case "$AUTH" in
        *@*) U="${U%%://*}://<redacted>@${AUTH##*@}${REST#"$AUTH"}" ;;
      esac
      case "$U" in
        *\?*) U="${U%%\?*}?<redacted>" ;;
        *\#*) U="${U%%\#*}#<redacted>" ;;
      esac
      ;;
    *:*)
      # scp-like `[user@]host:path`. No scheme, so the arm above cannot reach it — until
      # 2026-08-22 every scp-like user printed verbatim, on the reasoning that it is always `git`.
      # It is not: `<token>@host:path` is legal, and this value goes into an approval transcript.
      # The `*/*` guard is the two readings of `:` — git treats one as scp-like only when no `/`
      # precedes it, so a local path keeps its `@`. Same as `scripts/pre-push-gate.sh`; keep in step.
      _pre=${U%%:*}
      case "$_pre" in
        */*) ;;
        *@*) U="<redacted>@${_pre##*@}:${U#*:}" ;;
      esac
      ;;
  esac
  PUSH_URLS_SAFE=${PUSH_URLS_SAFE:+$PUSH_URLS_SAFE$'\n'}$U
done <<SAFE_EOF
$PUSH_URLS
SAFE_EOF
# Round 54: identity is the DIGEST, not the redaction. Two destinations differing only in the
# query redact to one string (measured), so comparing the redaction alone binds this approval to a
# host and a path — and a `.git/config` edit between the question and the push then redirects an
# approved history rewrite to another repository with this guard still passing. The digest is
# one-way and carries no credential; `git hash-object` needs no repository. An EMPTY digest
# refuses rather than matching an empty expectation.
# One digest per push URL, SHA-256, space separated — a SET, because git invokes the pre-push hook
# ONCE PER PUSH URL with that single URL in `$2` (measured 2026-08-22). A digest of the whole list
# matches no single call, so it refused every fan-out the operator had configured and approved.
# SHA-256 rather than `git hash-object`: `rules/security.md` prohibits SHA-1 where a digest carries
# a security decision, and that prohibition is what makes the change mandatory. `hash-object` also
# follows the *repository's* object format — measured 2026-08-22, the same URL digests to
# `b354136a…` by default and `7524f1f0…` under `--object-format=sha256`, and back to the SHA-1
# value outside a repository. Round 59 corrects how much that carries: it does NOT by itself make
# the two sides disagree, since the plan side and the hook run for the same repository and read
# the same format. It is a reason not to build a cross-process binding on a tool whose algorithm
# is chosen by ambient state, and it bites where one side runs outside the repository at all.
# A URL that will not hash empties the WHOLE value rather than shortening the set: a partial set
# approves fewer destinations than the plan showed, and looks like a successful derivation.
# Round 60: SELECT the digest tool, THEN feed it. A `||` chain over a pipeline let the FIRST
# command consume stdin and then fail, after which the fallback hashed EOF. Measured 2026-08-22:
# `https://gw.example/push?repo=A&token=one` and `…?repo=B&token=two` BOTH digested to
# e3b0c442…b855 — the SHA-256 of the empty string — so two different destinations compared EQUAL
# and the destination guard passed on a destination that had changed. `command -v` does not read
# stdin, so doing the selection with it feeds the input exactly once, to exactly one tool. Same
# shape as `scripts/pre-push-gate.sh` § sha256_raw, deliberately: one algorithm, stated once.
sha256_raw() {   # reads stdin, writes the selected tool's own output line; nonzero only if none exists
  # Invoked through `/usr/bin/env`, never as a bare word. `command -v` reports an imported shell
  # function as a perfectly good command, and the known-answer test below only rejects a tool that
  # answers one CONSTANT. An ADAPTIVE function passes both vectors and then returns one fixed
  # digest for every real URL, so two different destinations compare EQUAL and the approval is
  # bound to nothing. `env` resolves PATH only, and bash refuses to import a function whose name
  # contains a slash, so a function-only match makes `env` fail and the test below correctly
  # empties the digest. `scripts/pre-push-gate.sh` needs no such spelling and is not inconsistent
  # with this: its `#!/usr/bin/env -S bash -p` shebang refuses to import functions at all, while
  # these fences have no shebang of their own. The defence differs because the channel does.
  if command -v sha256sum >/dev/null 2>&1; then /usr/bin/env sha256sum
  elif command -v shasum >/dev/null 2>&1; then /usr/bin/env shasum -a 256
  elif command -v openssl >/dev/null 2>&1; then /usr/bin/env openssl dgst -sha256
  else return 1
  fi
}
sha256_hex() {   # the bare hex the tool produced — NO shape check, the KAT below needs the raw answer
  _H=$(/usr/bin/printf '%s' "$1" | sha256_raw 2>/dev/null) || _H=
  _H=${_H##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _H=${_H%% *}      # sha256sum / shasum: `<hex>  -`
  /usr/bin/printf '%s' "$_H"
}
# Known-answer test, two vectors. A tool that answers one constant whatever it is fed makes every
# destination compare equal to every approval — and a constant is well-shaped, so the shape check
# in the loop cannot see it. The empty vector is precisely the answer the defect above produced.
DIGEST_TOOL_OK=
if [[ "$(sha256_hex '')" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] \
&& [[ "$(sha256_hex abc)" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]]; then
  DIGEST_TOOL_OK=yes
fi
PUSH_URLS_DIGEST=
while IFS= read -r U; do
  [[ -n "$U" ]] || continue
  D=
  if [[ -n "$DIGEST_TOOL_OK" ]]; then D=$(sha256_hex "$U"); fi
  case "$D" in *[!0-9a-f]*|'') D= ;; *) [[ ${#D} -eq 64 ]] || D= ;; esac
  if [[ -z "$D" ]]; then PUSH_URLS_DIGEST=; break; fi
  PUSH_URLS_DIGEST=${PUSH_URLS_DIGEST:+$PUSH_URLS_DIGEST }$D
done <<< "$PUSH_URLS"
# `remote.<name>.receivepack` names the program that receives the objects on the far side, and a
# program is free to ignore the repository the URL named. Measured 2026-08-22: with one configured,
# an ordinary branch push printed `To <the approved URL>  * [new branch] main -> main` while every
# object landed in a DIFFERENT repository and the named one stayed empty. No digest of the URL can
# see that, so with one configured the destination is not established and this skill does not push.
# The gate refuses it too where the binding reaches it; this line is what covers the projects that
# never installed the gate, and `git-workflow.md` § Push safety is why the absent gate moves the
# question here rather than deleting it. This read is best-effort and its boundary is measured:
# git runs the pre-push hook only after the ref advertisement, so a wrapper that clears its own
# config key before serving redirects the objects while every reader here sees nothing (measured
# 2026-08-22 — the hook saw `<unset>`, git reported success against the named URL, and the objects
# landed elsewhere). What closes that is the push line itself, which spells
# `--receive-pack=git-receive-pack`: a command-line value overrides the configured one, while
# `-c remote.<name>.receivepack=` does not (git keeps the config value and says "more than one
# receivepack given, using the first"). This read still earns its place — it refuses BEFORE the
# operator is asked to approve a destination that was never going to receive the objects.
PUSH_RECEIVEPACK=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config --get remote.origin.receivepack 2>/dev/null) || PUSH_RECEIVEPACK=
if [[ -n "$PUSH_RECEIVEPACK" ]] || [[ -z "$PUSH_URLS" ]] || [[ -z "$PUSH_URLS_DIGEST" ]] \
   || [[ "$PUSH_URLS_DIGEST" != "<the PUSH_URLS_DIGEST value the classifier fence printed for this iteration, written literally and quoted>" ]] \
   || [[ "$PUSH_URLS_SAFE" != "<the redacted destination this iteration's approval named — the PUSH_URLS_SAFE value the question showed>" ]]; then
  echo "⛔ push destination '${PUSH_URLS_SAFE:-unresolvable}' is not the one approved — refusing" >&2
  echo "   (identity is a digest of the raw destination, so a change the redaction hides still refuses)" >&2
  if [[ -n "$PUSH_RECEIVEPACK" ]]; then
    echo "   (remote.origin.receivepack is configured, so the URL does not decide where the objects land; read it with: git config --get remote.origin.receivepack)" >&2
  fi
  readonly PUSH_BLOCKED=1; exit 1
fi
# ⚠️ Why this is a comparison and not a push to the validated URL — the measurement, recorded so the
# swap is not proposed a third time. Round 54 declined it because a URL destination defeats
# `--set-upstream`, which does not apply here (nothing in this skill passes `-u`), and that made the
# refusal look like an accident inherited from `/push-ci`. It is not. Measured 2026-08-22: with
# `url.<B>.insteadOf=<A>` configured, a push whose destination argument was the literal URL `<A>`
# — no remote name anywhere on the line — put the ref in **B**. git
# applies the rewrite layer to a command-line URL exactly as to a remote name, so addressing the URL
# relocates the re-resolution and pins nothing. The same run shows the check is honest —
# `git remote get-url --push --all origin` reports the POST-rewrite URL, so the digest above covers
# the destination git would really use. What is left cannot be closed **by naming a destination**:
# git resolves it inside its own process, from configuration this shell cannot freeze, and every
# construct that names one goes through the same rewrite layer. The comparison sits in the SAME
# fence as the push with no question in between, so the window it narrows is the real one (the
# approval is iterations away). It was written here as "irreducible client-side", and that was
# wrong — corrected 2026-08-22: git hands the resolved destination to `pre-push-gate.sh` as `$2`,
# inside the pushing process, and `SD0X_PUSH_DEST_DIGEST` below binds against it.
# `SD0X_PUSH_DEST_DIGEST` is the other half of the destination check above, and the half that is
# not a race. The comparison a few lines up re-reads the destination in THIS shell; the push is a
# different process, so a `.git/config` edit or a `url.<x>.pushInsteadOf` landing in between still
# redirects it. git closes that window itself and hands the answer to the pre-push hook as `$2` —
# the destination it is about to reach, resolved inside the pushing process, after every rewrite.
# Measured 2026-08-22 (git 2.55.0): under `url.<B>.pushInsteadOf=<A>` a push naming `origin` gives
# `$1=origin` and `$2=<B>`, and the digest of `$2` equals the digest of `git remote get-url --push
# --all origin` byte for byte, with the rewrite and without it. Wired end to end: the rewrite was
# refused and nothing reached B; the same push carrying B's own digest went through.
#
# **This is not an ALLOW_* variable and the Prohibited list does not cover it.** Those are
# developer attestations, which is why this skill must never set them and must clear the ones it
# inherits. This one is the opposite direction: it is a constraint the skill imposes on its own
# push, it can only ever cause a refusal, and setting it inline is what stops an inherited value
# from deciding. Where the hook is not installed it does nothing at all — monotone, like
# the lease binding below (round 60): this fence no longer carries `--force-if-includes`.

# ── Step 5 topology re-check: measured AFTER the rebase, in both modes (round 59) ──────────────
# **Bundled mode decided whether an unshared attestation was owed before Step 2, and then Steps 2
# and 3 changed the very topology it predicted.** The prediction reads the remote-tracking ref;
# Step 2 checks that ref out and Step 3 rebases it. Between the prediction and the push, a
# collaborator can force-update the PR head and any background fetch can move
# `refs/remotes/origin/<head>` — after which Step 2 checks the new tip out, Step 3 drops or
# re-parents it, `--force-with-lease` sees the tip it just fetched, and `--force-if-includes`
# passes because Step 2 put that tip in this branch's reflog. § Safety already records that exact
# outcome: "a collaborator commit checked out locally and then dropped by a rewrite is overwritten
# with exit 0." A prediction is not a measurement, and the only place a measurement is possible is
# here — after the commit that will be pushed exists.
#
# This is not a second approval in the common case. It re-derives the reading and STOPS only when
# the prediction was falsified; a bundled iteration that predicted `no-rewrite` and still rewrites
# nothing passes through it silently, so the gate count in § Gate Moments is unchanged for every
# run whose prediction held.
#
# **Round 60 corrects what "falsified" means here.** The first version refused every measured
# rewrite unconditionally — including the one this iteration had ALREADY collected an unshared
# attestation for, which is the ordinary path of this whole skill: rebase, rewrite, force-push.
# It therefore stopped every normal iteration and its own advice ("re-run Step 5 on a yes") looped
# straight back into the same refusal, because the rerun measures the same rewrite. What the check
# is for is the case where the reading and the attestation DISAGREE, so it has to be able to see
# the attestation.
#
# `UNSHARED_ATTESTED` is that attestation, and it is written **literally into this fence** by the
# model from the operator's answer, exactly like `PUSH_URLS_DIGEST` below. Three properties, none
# optional: it is **never read from the environment**, so an exported value cannot answer a
# question nobody was asked (that is the whole hazard `ALLOW_FORCE_UNSHARED` carries, which is why
# this skill clears that one and does not imitate it); it is assigned **unconditionally** here, so
# an inherited value cannot survive to the test; and its default is **empty**, so a model that
# forgets to fill it in refuses the push rather than authorizing it.
# It names the REF, because that is what the operator was asked about: an attestation about
# `<head>` says nothing about any other branch, and comparing the ref is what stops it carrying.
#
# Fill it in ONLY when THIS iteration asked the unshared question by name and the operator
# answered "Nobody else works on <head>": replace the empty value below with the literal,
# quoted string "refs/heads/<head>". Every other case leaves it empty — no question asked,
# "Someone else might", an attestation collected in an earlier iteration, or one given about
# another ref. Empty refuses.
UNSHARED_ATTESTED=
# The remote tip the iteration gate PRINTED as `REMOTE_TIP=[...]` before the rebase — the commit
# the operator was shown as the thing this push would overwrite — written literally and quoted by
# the model, on the same three properties as the attestation above. The rebase moves the LOCAL
# side, so this fact is still the destination's; re-reading it here would ask the question again
# instead of remembering the answer, which is the failure the field closes. Empty refuses,
# because the `rewrite` arm compares it against a `$FINAL_TIP` that is non-empty by construction.
APPROVED_TIP=
PUSHED=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --verify --quiet "refs/heads/${head}") || PUSHED=
# Anything but exactly one destination is fail-closed, the same test the two classifier fences
# below apply: this lookup asks ONE url what it holds, so an empty or plural list leaves it no
# single destination to ask about. `$(...)` strips trailing newlines, so one URL leaves none
# and "$PUSH_URLS" != "$PUSH_URL" is precisely "more than one" — expansion, no command to shadow.
if [[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then
  FINAL_TIP=; FINAL_LOOKUP_FAILED=1
# Round 76: `$PUSH_URL` has already been through one `url.*.insteadOf` pass, and handing that
# string to another git command applies a SECOND. Measured 2026-08-22 (git 2.55.0) with
# `url.<B>.insteadOf=<A>` and `url.<C>.insteadOf=<B>`: the resolved push URL is B and the push
# lands in B, while `git ls-remote -- <B>` answers **C's** tip — so the lease would carry a value
# measured from a repository this push never contacts. No repair is available from a URL string
# (anything handed back to git is rewritten again), so the reading becomes `unknown` and the arm
# below refuses. The detector is purely local: `--get-url` expands the URL and exits.
elif ! FINAL_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URL") || [[ "$FINAL_REPROBE" != "$PUSH_URL" ]]; then
  echo "⛔ url.*.insteadOf rewrites the resolved push destination a SECOND time — the push" >&2
  echo "   goes to the once-rewritten URL while a probe of that URL reads the twice-" >&2
  echo "   rewritten one, so nothing here can measure the destination. STOP." >&2
  FINAL_TIP=; FINAL_LOOKUP_FAILED=1
elif FINAL_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URL" "refs/heads/${head}"); then
  FINAL_TIP=${FINAL_LS%%$'\t'*}; FINAL_LOOKUP_FAILED=
else
  FINAL_TIP=; FINAL_LOOKUP_FAILED=1
fi
# Same ordering discipline as the classifier: the fail-closed rows are tested FIRST, because a
# failed lookup also leaves the tip empty and testing emptiness first would read every unreachable
# remote as a creation.
if [[ -z "$PUSHED" ]] || [[ "$FINAL_LOOKUP_FAILED" = 1 ]]; then
  FINAL_ANCESTRY=; FINAL_READING=unknown
elif [[ -z "$FINAL_TIP" ]]; then
  FINAL_ANCESTRY=; FINAL_READING=creation
elif [[ "$FINAL_TIP" = "$PUSHED" ]]; then
  FINAL_ANCESTRY=; FINAL_READING=up-to-date
else
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$FINAL_TIP" "$PUSHED"; then FINAL_ANCESTRY=0; else FINAL_ANCESTRY=$?; fi
  # captured immediately — three readings, never two
  case "$FINAL_ANCESTRY" in
    0) FINAL_READING=fast-forward ;;
    1) FINAL_READING=rewrite ;;
    *) FINAL_READING=unknown ;;
  esac
fi
# The refusal is written as a `case` over the WORD, not as a negated list of the benign ones: a
# reading this fence has never heard of must land in the refusing arm, and `*` does that by
# construction. `creation`, `up-to-date` and `fast-forward` are the three that rewrite nothing,
# so they need no attestation. `rewrite` needs one, and holds it on the ordinary path. `unknown`
# and every unheard-of word refuse whatever the operator attested, and that is not an oversight:
# the attestation answers "is this ref shared", while `unknown` says the MEASUREMENT failed, and
# no answer to the first question is evidence about the second. It also keeps the lease honest —
# the push below binds itself to `$FINAL_TIP`, and the only readings that reach it are the ones
# where that tip was actually read.
case "$FINAL_READING" in
  creation|up-to-date|fast-forward) ;;
  rewrite)
    if [[ "$UNSHARED_ATTESTED" != "refs/heads/${head}" ]]; then
      echo "⛔ the post-rebase topology is a rewrite of refs/heads/${head} and this iteration holds" >&2
      echo "   no unshared attestation for that ref. The gate before Step 2 was answered about a" >&2
      echo "   topology the rebase has since changed, so it does not cover this push." >&2
      echo "   STOP. Two things are owed, and the ORDER is the contract (git-workflow.md" >&2
      echo "   § Push safety: the unshared question comes BY NAME and BEFORE the force approval):" >&2
      echo "   1) put the unshared question to the operator by name;" >&2
      echo "   2) on a yes, ask the per-iteration force approval AGAIN, with a plan that states" >&2
      echo "      this push rewrites the ref and shows the lease it will carry. The approval this" >&2
      echo "      iteration holds was given for a topology the rebase has since changed." >&2
      echo "   Only then re-run this fence with UNSHARED_ATTESTED=refs/heads/${head}." >&2
      echo "   Do not set ALLOW_FORCE_UNSHARED." >&2
      readonly PUSH_BLOCKED=1; exit 1
    fi
    # The attestation is a credential; this is a FACT, and one cannot stand in for the other. The
    # check above binds the ref name to the approval and the lease below binds itself to
    # `$FINAL_TIP` — but the commit this push DESTROYS was bound to nothing. A tip that moved
    # between the iteration gate and here means the operator approved overwriting one commit while
    # this fence overwrites a different one, and the lease, carrying the NEW value, sails through.
    # The movement is also evidence AGAINST the attestation: a ref nobody else holds does not
    # acquire commits nobody here published.
    if [[ "$FINAL_TIP" != "$APPROVED_TIP" ]]; then
      echo "⛔ refs/heads/${head} points at '${FINAL_TIP:-<none>}' but this iteration's approval" >&2
      echo "   covered overwriting '${APPROVED_TIP:-<none>}' — a different commit would be destroyed." >&2
      echo "   The attestation you hold says this ref is not shared; the tip moving since the" >&2
      echo "   iteration gate is evidence against it, so it cannot carry this push. STOP." >&2
      echo "   1) put the unshared question to the operator by name, for the tip as it reads NOW;" >&2
      echo "   2) on a yes, ask the per-iteration force approval AGAIN, with a plan naming that tip." >&2
      echo "   Do not set ALLOW_FORCE_UNSHARED." >&2
      readonly PUSH_BLOCKED=1; exit 1
    fi ;;
  *)
    echo "⛔ post-rebase topology reads '${FINAL_READING}' for refs/heads/${head} — the measurement" >&2
    echo "   did not answer, so nothing here knows what this push would overwrite and no" >&2
    echo "   attestation about sharedness can supply it. STOP; re-run once the destination reads." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
esac
# `if` rather than `cmd` followed by `STEP5_STATUS=$?`: an inherited `errexit` aborts the shell
# AT the failing push, before a following capture line could run, and the `case` below — the
# arm that says the PR still points at its pre-rebase commit and Steps 6-9 must not run — would
# never be reached. A command whose status the `if` itself consumes is not a command `set -e`
# acts on, so the classification survives the very failure it exists to classify.
# `then` sits on its own line and the command is unindented: everything after the `push`
# subcommand on that line is read as its own argv — by the byte pin, and by the forbidden-flag
# scan that decides over tokens. A trailing `; then` would put two words there that git never sees.
# `$PUSHED`, not `refs/heads/${head}`, on the left of the refspec below — and the same in the
# rollback push. Every classification above is about the object `$PUSHED` holds;
# `refs/heads/${head}` is a NAME git resolves again, inside its own process, after each of
# those decisions has been taken. Between the `rev-parse` that filled `$PUSHED` and that
# resolution the branch can move — a rebase finishing in another worktree, a second agent
# session, an editor. The lease binds the DESTINATION (`--force-with-lease=<ref>:<expect>`
# refuses if the remote moved) and nothing bound the source, so a `fast-forward` reading —
# the arm that needs no unshared attestation — could publish an object nothing classified.
# An object ID on the left cannot be moved by anything between here and git's resolution.
# `[[ -n "$PUSHED" ]]` is not redundant with the classification. An empty left side makes the
# refspec `":refs/heads/${head}"`, which is git's spelling for DELETE that branch. Reaching
# the push with `$PUSHED` empty already requires the `unknown` arm's `exit 1` to have been
# answered by an imported `BASH_FUNC_exit%%` that returns — the case this document anticipates
# everywhere else — and closing it costs one `[[ ]]`.
if [[ -z "$PUSH_BLOCKED" ]] && [[ -n "$PUSHED" ]] && \
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ALLOW_PUSH_PROTECTED= ALLOW_FORCE_UNSHARED= SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease="refs/heads/${head}:${FINAL_TIP}" --receive-pack=git-receive-pack "origin" -- "${PUSHED}:refs/heads/${head}"
then
  STEP5_STATUS=0
else
  STEP5_STATUS=$?
fi
# The push is the last thing above that can fail into a mutation of the PR. `$?` here is the
# whole AND-list: nonzero when the push failed AND when a guard above refused it, and both must
# stop. `case` rather than `[[ … -eq … ]]` for the reason used everywhere else in this document —
# it is a keyword the parser resolves, and it compares text rather than evaluating arithmetic on
# an operand that could be empty.
case "$STEP5_STATUS" in
  0) ;;
  *) echo "⛔ Step 5 did not publish refs/heads/${head} (status ${STEP5_STATUS}) — the PR still" >&2
     echo "   points at its pre-rebase commit. Steps 6-9 must not run: retargeting and merging it" >&2
     echo "   now would merge a diff nobody approved. Nothing has been merged." >&2
     PUSH_BLOCKED=1 ;;
esac

# Step 6: Update PR base so CI runs against correct diff
if [[ -z "$PUSH_BLOCKED" ]]; then
  /usr/bin/env -u BASH_ENV -u ENV gh pr edit "<N>" --base "$epic" || {
    echo "⛔ Step 6: PR <N> could not be retargeted onto ${epic} — CI would then run against the" >&2
    echo "   wrong base diff, so its verdict would not be about this change. STOP." >&2
    PUSH_BLOCKED=1
  }
fi

# Step 7: resolve the commit CI must be asked about, then hand off
# `--verify --quiet` + fully-qualified ref: the only form that yields exactly one SHA.
# A separator does NOT work here — see § the separator table above.
if [[ -z "$PUSH_BLOCKED" ]]; then
  sha=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --verify --quiet "refs/heads/${head}") || {
    echo "⛔ cannot resolve PR head '${head}' to a single commit — STOP" >&2
    PUSH_BLOCKED=1
  }
  # Absolute path, like every other report in this document. This one is a cross-fence handoff:
  # Step 8 writes the value back literally and merges with `--match-head-commit`, so a forged SHA
  # here sends `/watch-ci` to the wrong commit while the fence still exits 0. `printf` is a
  # builtin and an imported function outranks it (measured under bash 3.2, the PATH bash, and zsh).
  /usr/bin/printf 'PR_HEAD_SHA=%s\n' "$sha"
  # `$?` on the next line, and this is the shape § 4.46 removed elsewhere — safe here for the
  # same reason Phase 2 of `/push-ci` is: what § 4.46 forbids is a following capture whose
  # purpose is to REACH a classification the dying shell will skip. Under an inherited
  # `errexit` a failing `printf` kills the shell, and a non-zero fence is exactly the outcome
  # this arm exists to produce — so the line being skipped costs nothing. With `errexit` off
  # it runs, and it is the only thing that notices. Kept on its own line rather than in a
  # `|| { … }` so the report keeps the exact bytes two tests pin it by.
  REPORT_STATUS=$?
  if [[ "$REPORT_STATUS" != 0 ]]; then
    echo "⛔ the PR head SHA could not be reported (printf exited ${REPORT_STATUS}) — Step 8" >&2
    echo "   has nothing to write back, and /watch-ci would be dispatched against an absent" >&2
    echo "   or stale commit. STOP." >&2
    PUSH_BLOCKED=1
  fi
fi
# The fence's exit status, and the last line it has: zero only if the push landed, the base was
# retargeted, the SHA resolved **and the handoff was actually written**. That last clause is the
# one this comment claimed before anything checked it: `printf` writing to a closed or full
# stdout fails, and with `errexit` not inherited the failure was invisible here — `PUSH_BLOCKED`
# stayed empty and the fence reported the success of a handoff that produced no value. Step 8
# then merges with `--match-head-commit` against whatever the caller believed the SHA to be.
[[ -z "$PUSH_BLOCKED" ]]
```

Only if that fence exited zero, dispatch CI with the SHA it printed:

```
/watch-ci --sha <the PR_HEAD_SHA value the fence printed> --branch <head> --timeout <--ci-timeout value (default 15)>
```

**Why the fence ends there.** `/watch-ci` is a skill dispatch, not a shell command. Written as a
`#` comment inside a running fence it is a line the shell skips — and every line after it then
executes regardless of what CI said, which is how a squash merge could happen with no `PASS`
verdict on a fence that reads as though it waited. The gate is the **fence boundary**: Step 8 is a
separate fence, entered only on `PASS`. On `FAIL`, on a timeout, or on any verdict that is not
`PASS` — STOP and restore from backup (§ Recovery). Fences do not share a shell, so the one below
re-establishes what it uses; that is what makes the separation mechanical rather than a promise.

```bash
# Step 8: Squash merge — reached ONLY on a PASS verdict from the dispatch above
MERGE_BLOCKED=
epic=<quoted epic>
# The SHA `/watch-ci` returned PASS for, written literally by the model from the PR_HEAD_SHA the
# previous fence printed. Not read from the environment and not re-derived: re-deriving it here
# would resolve the head as it stands NOW, which is exactly the value the check exists to distrust.
CI_PASSED_SHA=<the PR_HEAD_SHA value the previous fence printed, quoted>
# A PASS verdict is about a commit and a base, not about a PR number. Both can move while
# `/watch-ci` waits and after it returns, so both are bound before the merge.
BASE_NOW=$(/usr/bin/env -u BASH_ENV -u ENV gh pr view "<N>" --json baseRefName --template '{{.baseRefName}}') || BASE_NOW=
if [[ -z "$CI_PASSED_SHA" ]] || [[ "$BASE_NOW" != "$epic" ]]; then
  echo "⛔ Step 8: the PASS verdict cannot be tied to this merge." >&2
  echo "   tested commit: ${CI_PASSED_SHA:-<none carried into this fence>}" >&2
  echo "   PR base now:   ${BASE_NOW:-<unreadable>}   expected: ${epic}" >&2
  echo "   Merging now would merge a diff that verdict was not about. STOP." >&2
  MERGE_BLOCKED=1
fi
# `--match-head-commit` is checked by GitHub at merge time, which is the only place it can be
# checked without a race: a local comparison would read the head, then merge, and the head may move
# between the two. The base has no such flag — the read above is a best-effort narrowing, and the
# window between it and the merge is real. Say so; do not let the code imply otherwise.
if [[ -z "$MERGE_BLOCKED" ]]; then
  # Absolute, via `env`, like every other command word in this document that decides something.
  # `gh` is an external program, and that is not protection: shell function lookup precedes PATH,
  # so an exported `BASH_FUNC_gh%%` claims the word. Measured 2026-08-22 — an imported `gh()`
  # that recorded its arguments and returned 0 left `MERGE_BLOCKED` empty, let the fetch below
  # succeed against an unchanged epic branch, and reported the iteration merged. The existing
  # tests place a fake `gh` on PATH, which proves exit-status propagation and says nothing about
  # function precedence — a real executable is never consulted when a function has the name.
  /usr/bin/env -u BASH_ENV -u ENV gh pr merge "<N>" --squash --match-head-commit "$CI_PASSED_SHA" || {
    echo "⛔ Step 8: PR <N> was not merged — either the head no longer matches the commit CI" >&2
    echo "   passed, or the merge itself failed. Either way the epic branch is unchanged, so the" >&2
    echo "   next iteration must not rebase onto it as though it had moved. STOP." >&2
    MERGE_BLOCKED=1
  }
fi

# Step 9: Refresh epic — its status is read for the same reason Step 8's is. The NEXT iteration
# rebases onto `refs/remotes/origin/${epic}`; a fetch that fails leaves that ref at the pre-merge
# tip, so the iteration after this one would rebase and force-push history missing this PR. From
# here on `MERGE_BLOCKED` means "this iteration did not complete", which is what the exit status
# below is for — the messages say which half failed, and they are not the same repair.
if [[ -z "$MERGE_BLOCKED" ]]; then
  if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git fetch --upload-pack=git-upload-pack "origin" -- "+refs/heads/${epic}:refs/remotes/origin/${epic}"; then
    echo "⛔ Step 9: PR <N> merged, but refreshing refs/remotes/origin/${epic} failed. The merge" >&2
    echo "   stands and must not be repeated; the RUN must stop — the next iteration would rebase" >&2
    echo "   onto the pre-merge tip and force-push history without PR <N> in it." >&2
    MERGE_BLOCKED=1
  fi
fi
[[ -z "$MERGE_BLOCKED" ]]
```

### Iteration Gate Design

Default for iterations 2..N: **the unshared question, then one bundled gate** — two in total, as the
table's first row says, and one when the topology test below says the iteration rewrites nothing.
Iteration 1 has the `Proceed` question and nothing else. Operator can opt into finer control with
`--per-step`.

| Mode | Gate count per iteration (2..N) | Gate moments | When to use |
|------|--------------------------|--------------|-------------|
| Bundled (default) | 2 (1 when nothing is rewritten) | The unshared question, then one bundled gate before Step 2 (covering Steps 2-9 — every step of the iteration, including the closing epic refresh) | Trusted chain, fast iteration |
| `--per-step` | 4 (3 when nothing is rewritten) | Before Step 3 (rebase), the unshared question, Step 5 (push), Step 8 (merge) | First-time use, untrusted diff, recovery from prior failure |

**The unshared question is owed only where the iteration actually rewrites something.** § Phase 2
already records the exception — an iteration whose head is already based on the target rebases to a
no-op, local and remote OIDs match, git sends no ref and the hook exits 0 without prompting — and a
gate table that asks unconditionally contradicts it, putting a rewrite to the operator that this
iteration will not perform. `rules/git-workflow.md` § Push safety measures **topology, not the
declared flag**; so does the hook. Determine it before asking, and fail closed:

| Mode | What is measurable at the moment the question is due |
|------|------------------------------------------------------|
| `--per-step` | The rebase has already run, so the outcome is observable directly: the remote tip against the rebased `HEAD` |
| Bundled (default) | The gate precedes Step 2, so the outcome must be **predicted**: does the head already sit on the target, making the rebase the no-op above |

The tests are written out rather than quoted in a table cell, and that is not presentation. The
`test/skills/epic-merge.test.js` guard that requires the canonical prefix on every git command
**deliberately does not judge table cells** — it asserts so explicitly — so a command living in a
cell is a command nobody checks. These decide whether an attestation is collected; they belong
where the guard can see them:

```bash
# Step 0's bindings are gone — this is a separate shell (§ Names in commands), and both names below
# reach a command line. Unset, `"refs/heads/${head}"` is `refs/heads/` and
# `"refs/remotes/origin/${epic}"` is `refs/remotes/origin/`: the per-step classifier reads the
# empty remote answer as a branch creation, the bundled one degrades to `unknown` because its local
# refs will not resolve, and either verdict is about an empty name rather than about the iteration
# the operator is being asked to approve.
head=<quoted head>
epic=<quoted epic>
if [[ -z "$head" ]] || [[ -z "$epic" ]]; then
  echo "⛔ iteration gate: head or epic is unbound in this fence. Every ref below would name" >&2
  echo "   refs/heads/ or refs/remotes/origin/, and the answer would be about neither branch." >&2
  echo "   Bind both from the chain table (§ Names in commands) and re-run. Nothing is pushed." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — head or epic unbound in the iteration-gate fence}"
fi
# --per-step: after Step 3, before the push question.
# Fully qualified refs on BOTH sides. `origin/<name>` is shorthand git resolves through
# refs/tags/ before refs/remotes/, and § Backup already forbids it for exactly this reason —
# `git check-ref-format refs/tags/origin/feat-x` exits 0, so a tag of that name is legal and would
# answer this ancestry question in place of the branch.
# No pipe and no `awk`: a pipeline reports its LAST command's status, so `ls-remote | awk` exits 0
# when ls-remote fails (measured `rc=0` against a nonexistent remote) and the fail-closed reading
# below becomes unreachable; and a bare `awk` is shadowable by an imported function, which would
# emit an empty tip from real output. `${x%%<tab>*}` is expansion — no command to shadow.
# `origin` is two destinations, not one: `git ls-remote origin` reads the FETCH url, while
# pushing to that same name contacts the PUSH url — `remote.origin.pushurl`, or `url.<x>.pushInsteadOf`
# with no explicit pushurl, moves them apart (both measured, git 2.55.0). Probing one and
# rewriting the other classifies repository A and force-pushes repository B. `--push --all` is
# the oracle that matched what push actually contacted in both cases; `--all` because pushurl is
# multi-valued and the singular form reports a fan-out as a single destination.
if PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git remote get-url --push --all origin); then
  PUSH_URL=${PUSH_URLS%%$'\n'*}
else
  PUSH_URLS=; PUSH_URL=
fi
# Redacted destination — the same derivation, and the same reason, as its first use above.
PUSH_URLS_SAFE=
while IFS= read -r U; do
  case "$U" in
    *://*)
      REST=${U#*://}; AUTH=${REST%%/*}; AUTH=${AUTH%%\?*}; AUTH=${AUTH%%\#*}
      case "$AUTH" in
        *@*) U="${U%%://*}://<redacted>@${AUTH##*@}${REST#"$AUTH"}" ;;
      esac
      case "$U" in
        *\?*) U="${U%%\?*}?<redacted>" ;;
        *\#*) U="${U%%\#*}#<redacted>" ;;
      esac
      ;;
    *:*)
      # scp-like `[user@]host:path`. No scheme, so the arm above cannot reach it — until
      # 2026-08-22 every scp-like user printed verbatim, on the reasoning that it is always `git`.
      # It is not: `<token>@host:path` is legal, and this value goes into an approval transcript.
      # The `*/*` guard is the two readings of `:` — git treats one as scp-like only when no `/`
      # precedes it, so a local path keeps its `@`. Same as `scripts/pre-push-gate.sh`; keep in step.
      _pre=${U%%:*}
      case "$_pre" in
        */*) ;;
        *@*) U="<redacted>@${_pre##*@}:${U#*:}" ;;
      esac
      ;;
  esac
  PUSH_URLS_SAFE=${PUSH_URLS_SAFE:+$PUSH_URLS_SAFE$'\n'}$U
done <<SAFE_EOF
$PUSH_URLS
SAFE_EOF
# Anything but exactly one URL is fail-closed. $(...) strips trailing newlines, so one URL leaves
# none and "$PUSH_URLS" != "$PUSH_URL" is precisely "more than one" — expansion, no command to shadow.
if [[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then
  REMOTE_TIP=; LOOKUP_FAILED=1
# Round 76, the same detector the Step 5 and rollback fences carry. `$PUSH_URL` has already
# been through one `url.*.insteadOf` pass, and handing it to another git command applies a
# SECOND. Where a chain exists this lookup reads a repository the push never contacts, so its
# tip is not about the destination and the ancestry test below would classify the wrong
# history. `LOOKUP_FAILED=1` is the honest reading and it fails closed — the classification
# becomes `unknown` and the unshared question gets asked rather than skipped. The detector is
# purely local: `--get-url` expands the URL through the rewrite table and exits.
elif ! REMOTE_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URL") || [[ "$REMOTE_REPROBE" != "$PUSH_URL" ]]; then
  echo "⛔ url.*.insteadOf rewrites the resolved push destination a SECOND time — this" >&2
  echo "   lookup would read a repository the push never contacts. Topology unknown." >&2
  REMOTE_TIP=; LOOKUP_FAILED=1
elif REMOTE_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URL" "refs/heads/${head}"); then
  REMOTE_TIP=${REMOTE_LS%%$'\t'*}; LOOKUP_FAILED=
else
  REMOTE_TIP=; LOOKUP_FAILED=1
fi
NEW_HEAD=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse HEAD)
# Round 53. The ancestry test is GUARDED, and the guard is the classification rather than a
# precaution taken before it. `merge-base --is-ancestor "" "$NEW_HEAD"` exits 128 — measured — so
# running it unconditionally made an empty `REMOTE_TIP` match two table rows that contradict each
# other: "merge-base exited above 1, topology unknown, ask" and "REMOTE_TIP empty, this is a
# creation, do not ask". Both were true of the same run, and which one the agent applied was left
# to whoever read the table. A creation would then be asked the unshared question about a branch
# the remote does not have, which is not a stricter reading — it is a question with no subject, and
# an operator who learns the question is sometimes meaningless is the failure the attestation
# contract cannot survive.
#
# So the fence derives ONE word, in an order where nothing overlaps. `LOOKUP_FAILED` is tested
# FIRST and that position is load-bearing, not stylistic: a failed lookup also leaves `REMOTE_TIP`
# empty, so testing emptiness first would read every unreachable remote as a creation and silence
# the fail-closed row entirely — the exact inversion of what fail-closed means.
if [[ "$LOOKUP_FAILED" = 1 ]]; then
  ITER_ANCESTRY=; ITER_READING=unknown        # the lookup never answered — ask, fail closed
elif [[ -z "$REMOTE_TIP" ]]; then
  ITER_ANCESTRY=; ITER_READING=creation       # answered, and the branch is not there yet
elif [[ "$REMOTE_TIP" = "$NEW_HEAD" ]]; then
  ITER_ANCESTRY=; ITER_READING=up-to-date     # the remote already holds this commit
else
  # Two real object names, so the test has a subject and its three exits mean three things.
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$REMOTE_TIP" "$NEW_HEAD"; then ITER_ANCESTRY=0; else ITER_ANCESTRY=$?; fi
  # 0 contained · 1 not contained · >1 merge-base ERRORED — three readings, never two
  case "$ITER_ANCESTRY" in
    0) ITER_READING=fast-forward ;;
    1) ITER_READING=rewrite ;;
    *) ITER_READING=unknown ;;                # errored rather than answered — never read as "no"
  esac
fi

# Bundled: before Step 2, predicting from the not-yet-rebased refs. BOTH tests must pass before
# "no rewrite" may be read; either one alone is unsound. Ancestry says the head already contains
# the epic tip, but the operation is `rebase --onto "refs/remotes/origin/${epic}" "backup/pr-<prev>" "${head}"`,
# which replays `backup/pr-<prev>..${head}`. Those commits keep their OIDs only when they are
# already parented on the destination — i.e. when the cut point IS the destination. With a cut
# point behind it, the replay re-parents commits and mints new OIDs while ancestry still reads
# "contained", which predicts no rewrite for a push that rewrites.
if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "refs/remotes/origin/${epic}" "refs/remotes/origin/${head}"; then BUNDLED_ANCESTRY=0; else BUNDLED_ANCESTRY=$?; fi
# captured IMMEDIATELY: every command below overwrites $?, and a fence whose
# final status is the `test` alone reports success for ANCESTRY=1 (a measured
# rewrite) and for ANCESTRY=128 (an error) whenever CUT happens to equal DEST.
# Measured both. That is the same status-loss defect the `| awk` pipeline had.
CUT=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify "backup/pr-<prev>^{commit}") || CUT=
DEST=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify "refs/remotes/origin/${epic}^{commit}") || DEST=
# Unresolvable either side is unknown, not benign — the table below reads it as fail-closed.
# "No rewrite" requires ALL FOUR, and is written as one expression so no later command can
# silently become the answer.
#
# `LOOKUP_FAILED` is one of the four, added in round 54 because leaving it out was a real hole
# rather than a tidiness point. Everything else this fence measures is LOCAL — `refs/remotes/*`
# and `backup/pr-*`, all read from the local object store — so all four other predicates can
# succeed while the push DESTINATION never resolved. `no-rewrite` would then be published for a
# push whose remote tip nobody looked at, and the attestation would be skipped on the strength of
# a prediction about a repository the fence could not reach. Measured: with `LOOKUP_FAILED=1
# BUNDLED_ANCESTRY=0 CUT=aaaa DEST=aaaa` the previous expression printed `no-rewrite`, while the
# reading table classified the same run as `unknown` — the code and the table disagreed, and the
# code is the one that ran.
# The exit status becomes a WORD before it is composed with anything, because the two ways to
# compare it as a number are both wrong here (round 54, measured 2026-08-22). `[ … -eq … ]` calls
# the `[` builtin, which an imported `BASH_FUNC_[%%` function outranks — the caller then answers
# every predicate in this fence. `[[ … -eq … ]]` is keyword-immune but arithmetic, and arithmetic
# reads an EMPTY operand as 0: `[[ "" -eq 0 ]]` is true, so an unset ancestry would publish
# `no-rewrite` and skip the attestation. `case` is a keyword and does no arithmetic, so `*` catches
# the empty string with everything else and lands it in `errored` — fail-closed by construction
# rather than by a predicate somebody has to remember to write.
case "$BUNDLED_ANCESTRY" in
  0) BUNDLED_ANCESTRY_READING=contained ;;
  1) BUNDLED_ANCESTRY_READING=not-contained ;;
  *) BUNDLED_ANCESTRY_READING=errored ;;
esac
if [[ "$LOOKUP_FAILED" != 1 ]] && [[ "$BUNDLED_ANCESTRY_READING" = contained ]] && [[ -n "$CUT" ]] && [[ -n "$DEST" ]] && [[ "$CUT" = "$DEST" ]]; then
  BUNDLED_READING=no-rewrite
elif [[ "$LOOKUP_FAILED" = 1 ]] || [[ "$BUNDLED_ANCESTRY_READING" = errored ]] || [[ -z "$CUT" ]] || [[ -z "$DEST" ]]; then
  BUNDLED_READING=unknown        # ask, fail closed — and say "unknown", never "measured rewrite"
else
  BUNDLED_READING=rewrite        # ancestry said no, or the cut point is behind the destination
fi
# Every value above dies with this fence: the table below is read by the agent, in a later step,
# in a separate shell. Print them. A reading that is only assigned forces whoever needs it to
# derive it a second time, and a second derivation is free to disagree with the one measured here.
# Round 52 added the last three. `BUNDLED_READING` is derived from `BUNDLED_ANCESTRY`, and the
# derivation collapses "ancestry errored" into the same word as "cut point is behind the
# destination" — printing only the conclusion loses which of the two was measured.
# **`NEW_HEAD` is the per-step arm's subject, and round 59 corrected this sentence.** It used to
# read "what the force approval is about", which is true only where this fence runs after Step 3:
# it is `git rev-parse HEAD` of whatever is checked out *now*. In bundled mode the fence runs
# BEFORE Step 2, so `HEAD` is the ambient checkout — possibly the epic branch, possibly an
# unrelated one — and the commit that will actually be pushed does not exist yet, because Step 3
# has not minted it. Reading the bundled report's `NEW_HEAD` as the approved commit therefore names
# the wrong object, which is why the bundled questions do not quote it and why the commit the push
# rewrites is established by the Step 5 re-check instead. `PUSH_URLS_SAFE` is where it lands, and
# an approval naming no destination is an approval of a push the operator cannot identify.
# The binding key the push fence compares (round 54). Redaction is lossy on purpose, so the
# redacted string cannot serve as an identity; this digest can, and it discloses nothing.
# One digest per push URL, SHA-256, space separated — a SET, because git invokes the pre-push hook
# ONCE PER PUSH URL with that single URL in `$2` (measured 2026-08-22). A digest of the whole list
# matches no single call, so it refused every fan-out the operator had configured and approved.
# SHA-256 rather than `git hash-object`: `rules/security.md` prohibits SHA-1 where a digest carries
# a security decision, and that prohibition is what makes the change mandatory. `hash-object` also
# follows the *repository's* object format — measured 2026-08-22, the same URL digests to
# `b354136a…` by default and `7524f1f0…` under `--object-format=sha256`, and back to the SHA-1
# value outside a repository. Round 59 corrects how much that carries: it does NOT by itself make
# the two sides disagree, since the plan side and the hook run for the same repository and read
# the same format. It is a reason not to build a cross-process binding on a tool whose algorithm
# is chosen by ambient state, and it bites where one side runs outside the repository at all.
# A URL that will not hash empties the WHOLE value rather than shortening the set: a partial set
# approves fewer destinations than the plan showed, and looks like a successful derivation.
# Round 60: SELECT the digest tool, THEN feed it. A `||` chain over a pipeline let the FIRST
# command consume stdin and then fail, after which the fallback hashed EOF. Measured 2026-08-22:
# `https://gw.example/push?repo=A&token=one` and `…?repo=B&token=two` BOTH digested to
# e3b0c442…b855 — the SHA-256 of the empty string — so two different destinations compared EQUAL
# and the destination guard passed on a destination that had changed. `command -v` does not read
# stdin, so doing the selection with it feeds the input exactly once, to exactly one tool. Same
# shape as `scripts/pre-push-gate.sh` § sha256_raw, deliberately: one algorithm, stated once.
sha256_raw() {   # reads stdin, writes the selected tool's own output line; nonzero only if none exists
  # Invoked through `/usr/bin/env`, never as a bare word. `command -v` reports an imported shell
  # function as a perfectly good command, and the known-answer test below only rejects a tool that
  # answers one CONSTANT. An ADAPTIVE function passes both vectors and then returns one fixed
  # digest for every real URL, so two different destinations compare EQUAL and the approval is
  # bound to nothing. `env` resolves PATH only, and bash refuses to import a function whose name
  # contains a slash, so a function-only match makes `env` fail and the test below correctly
  # empties the digest. `scripts/pre-push-gate.sh` needs no such spelling and is not inconsistent
  # with this: its `#!/usr/bin/env -S bash -p` shebang refuses to import functions at all, while
  # these fences have no shebang of their own. The defence differs because the channel does.
  if command -v sha256sum >/dev/null 2>&1; then /usr/bin/env sha256sum
  elif command -v shasum >/dev/null 2>&1; then /usr/bin/env shasum -a 256
  elif command -v openssl >/dev/null 2>&1; then /usr/bin/env openssl dgst -sha256
  else return 1
  fi
}
sha256_hex() {   # the bare hex the tool produced — NO shape check, the KAT below needs the raw answer
  _H=$(/usr/bin/printf '%s' "$1" | sha256_raw 2>/dev/null) || _H=
  _H=${_H##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _H=${_H%% *}      # sha256sum / shasum: `<hex>  -`
  /usr/bin/printf '%s' "$_H"
}
# Known-answer test, two vectors. A tool that answers one constant whatever it is fed makes every
# destination compare equal to every approval — and a constant is well-shaped, so the shape check
# in the loop cannot see it. The empty vector is precisely the answer the defect above produced.
DIGEST_TOOL_OK=
if [[ "$(sha256_hex '')" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] \
&& [[ "$(sha256_hex abc)" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]]; then
  DIGEST_TOOL_OK=yes
fi
PUSH_URLS_DIGEST=
while IFS= read -r U; do
  [[ -n "$U" ]] || continue
  D=
  if [[ -n "$DIGEST_TOOL_OK" ]]; then D=$(sha256_hex "$U"); fi
  case "$D" in *[!0-9a-f]*|'') D= ;; *) [[ ${#D} -eq 64 ]] || D= ;; esac
  if [[ -z "$D" ]]; then PUSH_URLS_DIGEST=; break; fi
  PUSH_URLS_DIGEST=${PUSH_URLS_DIGEST:+$PUSH_URLS_DIGEST }$D
done <<< "$PUSH_URLS"
# `remote.<name>.receivepack` names the program that receives the objects on the far side, and a
# program is free to ignore the repository the URL named. Measured 2026-08-22: with one configured,
# an ordinary branch push printed `To <the approved URL>  * [new branch] main -> main` while every
# object landed in a DIFFERENT repository and the named one stayed empty. No digest of the URL can
# see that, so with one configured the destination is not established and this skill does not push.
# The gate refuses it too where the binding reaches it; this line is what covers the projects that
# never installed the gate, and `git-workflow.md` § Push safety is why the absent gate moves the
# question here rather than deleting it. This read is best-effort and its boundary is measured:
# git runs the pre-push hook only after the ref advertisement, so a wrapper that clears its own
# config key before serving redirects the objects while every reader here sees nothing (measured
# 2026-08-22 — the hook saw `<unset>`, git reported success against the named URL, and the objects
# landed elsewhere). What closes that is the push line itself, which spells
# `--receive-pack=git-receive-pack`: a command-line value overrides the configured one, while
# `-c remote.<name>.receivepack=` does not (git keeps the config value and says "more than one
# receivepack given, using the first"). This read still earns its place — it refuses BEFORE the
# operator is asked to approve a destination that was never going to receive the objects.
PUSH_RECEIVEPACK=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config --get remote.origin.receivepack 2>/dev/null) || PUSH_RECEIVEPACK=
PUSH_RECEIVEPACK_SET=no
if [[ -n "$PUSH_RECEIVEPACK" ]]; then PUSH_RECEIVEPACK_SET=yes; fi
# **The report is as security-sensitive as the readings above, and until round 59 it was the one
# construct here that a caller could answer.** `printf` is a regular builtin, and in bash a
# function outranks a builtin, so an exported `BASH_FUNC_printf%%` replaces this line wholesale:
# measured 2026-08-22, a fence whose real variables were `ASK=1 ASK_REASON=rewrite` printed
# `ASK=[] ASK_REASON=[fast-forward]` to the agent. Every `case` and `[[` above is immune and it
# bought nothing, because the verdict left through a channel the caller owned. An ABSOLUTE path is
# immune for the reason the Husky stanza already relies on — bash refuses to import a function
# whose name contains a slash (`error importing function definition for '/usr/bin/printf'`,
# measured). If `/usr/bin/printf` is missing the fence prints no report at all, and that is the
# correct failure: **a run with no report line is `unknown`, and unknown asks.**
/usr/bin/printf 'REMOTE_TIP=[%s]\nLOOKUP_FAILED=[%s]\nITER_READING=[%s]\nITER_ANCESTRY=[%s]\nBUNDLED_READING=[%s]\nCUT=[%s]\nDEST=[%s]\nBUNDLED_ANCESTRY=[%s]\nNEW_HEAD=[%s]\nPUSH_URLS_SAFE=[%s]\nPUSH_URLS_DIGEST=[%s]\nPUSH_RECEIVEPACK_SET=[%s]\n' \
  "$REMOTE_TIP" "$LOOKUP_FAILED" "$ITER_READING" "$ITER_ANCESTRY" "$BUNDLED_READING" "$CUT" "$DEST" \
  "$BUNDLED_ANCESTRY" "$NEW_HEAD" "$PUSH_URLS_SAFE" "$PUSH_URLS_DIGEST" "$PUSH_RECEIVEPACK_SET"
```

| Mode | Result | Reading | Ask? |
|------|--------|---------|------|
| `--per-step` | `ITER_READING=unknown` | The lookup did not answer, or `merge-base` errored rather than answering. Topology **unknown, not benign** | **Yes** — fail closed |
| `--per-step` | `ITER_READING=creation` | The lookup answered and the branch is not on the remote yet — there is no history to overwrite | No |
| `--per-step` | `ITER_READING=up-to-date` | `REMOTE_TIP` = `NEW_HEAD`; nothing to push | No |
| `--per-step` | `ITER_READING=fast-forward` | The remote's tip is contained in what replaces it — no rewrite | No |
| `--per-step` | `ITER_READING=rewrite` | `--is-ancestor` answered no | **Yes** |
| Bundled | `BUNDLED_READING=unknown` | `LOOKUP_FAILED=1` (the push destination never resolved, so every other predicate here describes only local refs), `merge-base` exited **above 1** (it errored rather than answered), or `$CUT` or `$DEST` did not resolve. Topology **unknown, not benign** | **Yes** — fail closed |
| Bundled | `BUNDLED_READING=no-rewrite` | Ancestry succeeded **and** `$CUT` = `$DEST`: the replay is parented where it already sits, so the rebase mints no new OIDs and nothing is rewritten | No |
| Bundled | `BUNDLED_READING=rewrite` | Either ancestry answered no, or it succeeded with the cut point behind the destination — the head contains the epic tip but the replay re-parents commits. **Both are treated as a rewrite** | **Yes** |

**Ask on every row whose `Ask?` column says Yes** — that is the rule; the positions are not. This
sentence used to read "ask on the first and last rows, do not ask on the middle two", which
described a four-row table and survived the split above into a seven-row one, silently dropping two
rows that DO ask: per-step ancestry exit 1, and bundled ancestry success with an unequal cut point.
A positional instruction over an editable table is a defect waiting for the next row. The four
no-ask readings are exactly: `creation`, `up-to-date`, `fast-forward`, and bundled `no-rewrite`.

**Every row above is a partition, and the fence produces the key** (round 53). Each names one value
of `ITER_READING` or `BUNDLED_READING`, the fence assigns exactly one of each, and no run matches
two rows in its own mode — which is the property the table lacked while the rows named overlapping
*conditions* instead of a derived word. The bundled rows were the last to be converted, and they
show why the shape matters rather than merely being tidier: with `BUNDLED_ANCESTRY=0`, an
unresolved `$CUT` and a resolved `$DEST`, the old wording matched both "a ref did not resolve →
unknown" and "ancestry succeeded, `$CUT` ≠ `$DEST` → rewrite" — one state, two rows, opposite
descriptions of what was measured. The fence had always normalized that state to `unknown`; only
the table disagreed with it. Reading the rows in order is therefore not required; the previous
shape needed a precedence to be safe, and stated it only in the rollback table, where it governed a
different one. Record that reading in the
iteration's report instead, so a transcript with no unshared question is distinguishable from one
where it was skipped. The prediction in bundled mode is the weaker of the two by construction — that is the cost of
gating before Step 2. It fails toward asking **only because both of its tests are required**: until
2026-08-21 it ran the ancestry test alone, and that version failed away from asking, which is the
opposite of what this paragraph claimed. A head already containing the epic tip whose cut point sat
behind the destination read as "no rewrite", the unshared question was skipped, and the rebase then
re-parented every replayed commit. Ancestry answers *is the destination contained*; it never
answered *will the replay keep its OIDs*, and only the second question is the one being asked here.

**Iteration 1 asks neither force question.** It squash-merges the first PR directly — no rebase, no
force-push (§ Phase 2, *Iteration 1 (First PR)*) — so its gate is the `Proceed` question alone.
Asking there whether anybody else works on the head would collect an attestation for a history
rewrite that will not happen, and a per-use approval transcript is worth only what its questions
are true about. The counts above and the fields below are for iterations 2..N.

**AskUserQuestion fields (bundled mode):**

Bundled means *one gate over Steps 2-9*, and it never meant *one question*. The unshared question
is separate and asked **first**, in this mode exactly as in `--per-step`: option A obliges the
skill to refuse a force-push it has no unshared evidence for, and evidence is what a question about
sharedness collects — the `Proceed` question below collects approval, which is a different thing.
Folding the two together would also make `--per-step` the only mode that satisfies the obligation,
leaving the **default** path as the one that does not.

| # | Field | Value |
|---|-------|-------|
| 1 | `question` | `"Is anybody else working on <head>? This iteration force-pushes it to <PUSH_URLS_SAFE><basis>."` — `<basis>` is `, rewriting its remote history` on a **measured rewrite**, and `, and its topology could not be verified — treated fail-closed` on an **unknown** row. The attestation is owed either way; the factual claim is not. Telling an operator a rewrite was measured when the command that would have measured it failed asks them to authorize under a false premise, and an operator who learns the warning is often false is the one who reads past the true one |
| 1 | `options` | `Nobody else works on <head>` → continue to gate 2; `Someone else might` → **abort this PR's iteration**, do not fall through |
| 2 | `question` | `"Proceed with PR #<N> ('<title>')? Will rebase onto epic, force-push <head> to <PUSH_URLS_SAFE> with --force-with-lease<rewrite-clause>, wait for CI, then squash-merge."` — `<rewrite-clause>` is ` (a history rewrite)` on the rows above that ask, and ` (measured: no rewrite — the replay is already parented on the epic tip)` on the row that does not. A fixed clause is false for exactly the states the table just classified as harmless, and an operator taught that the warning is usually wrong reads past the one time it is not |
| 2 | `options` | `Proceed`, `Per-step approval`, `Dry-run only`, `Abort and rollback` |
| 2 | `description` per option | Show diff stats (`+X -Y across F files`), backup tag SHA, expected unique-commit count from manifest |

**AskUserQuestion fields (per-step mode):**

| Step | question (short) |
|------|------------------|
| Before rebase | `"Run: git rebase --onto origin/<epic> backup/pr-<prev> <head> ?"` |
| Before push (**asked first**) | `"Is anybody else working on <head>, which this pushes to <PUSH_URLS_SAFE>?<basis>"` — ` Force-with-lease rewrites its remote history.` on a measured rewrite; ` Its topology could not be verified, so this is treated fail-closed.` on an unknown row — `"Nobody else works on <head>"` continues to the question below; `"Someone else might"` **aborts this PR's iteration** rather than falling through to it |
| Before push | `"Manifest verified (N commits). Force-push <head> to <PUSH_URLS_SAFE> with --force-with-lease?<rewrite-clause>"` — ` This rewrites remote history, replacing <REMOTE_TIP>.` where the reading above says rewrite, with the **full object ID** the classifier fence printed; ` Measured: no rewrite — the remote tip is an ancestor of what replaces it.` where it does not. Same reason as bundled gate 2: the sentence is a measurement, not decoration — and naming the tip is what makes the approval reusable as a comparison, since Step 5 re-measures and refuses when the answer differs (`APPROVED_TIP`). Without the object ID the answer is "yes, rewrite something", which carries to a rewrite of anything |
| Before merge | `"CI passed for #<N>. Squash-merge into <epic>?"` |

### Cut Point Reference

Each iteration uses the **previous PR's backup tag** as the rebase cut point:

| Iteration | PR | Branch | Cut Point (--base of rebase) |
|-----------|-----|--------|------------------------------|
| 2 | #101 | `feat/B` | `backup/pr-100` |
| 3 | #102 | `feat/C` | `backup/pr-101` |
| ... | ... | ... | ... |

### Phase 3: Verification

```bash
epic=<quoted epic>
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git log "refs/remotes/origin/$epic" --oneline -<N+5> --
```

Expect N squash commits (newest first), each with PR number suffix `(#NNN)`:

```
<sha> feat: ... (#103)
<sha> feat: ... (#102)
<sha> feat: ... (#101)
<sha> feat: ... (#100)
<sha> <previous epic commits>
```

Final report:

| Item | Value |
|------|-------|
| Epic branch | `epic/xxx` |
| PRs merged | 4 (#100, #101, #102, #103) |
| Backup tags | `backup/pr-100`, `backup/pr-101`, ... (kept for safety) |
| CI status | All PASS (verdicts via `/watch-ci`) |
| Manifests | `$(git rev-parse --git-path epic-merge)/{expected,actual}-pr-*.manifest` (kept until --cleanup) |
| Gate transcripts | All AskUserQuestion answers logged in conversation |

## Safety Rules

| Rule | Rationale |
|------|-----------|
| One lease form on both pushes, never bare `--force` — **`--force-with-lease=refs/heads/<head>:<the tip that fence just measured>`**, `$FINAL_TIP` on the iteration push and `$RB_TIP` on the rollback push (round 60 and round 75 respectively) | Binds the credential to the object the classification was made about. The **bare** lease expects whatever `refs/remotes/origin/<head>` holds when git resolves it, so a background fetch (IDE, cron) landing a collaborator's commit there makes the lease compare against that fresh ref and the force-push **succeeds over it with exit 0** — neither the backup tag nor the manifest contains that commit, so nothing downstream notices. `--force-if-includes` used to be the answer to that, and it is not one here: it asks whether the remote tip is reachable from **any reflog entry** of the local branch, not whether the pushed history still contains it, and both of this skill's paths put that tip into the reflog themselves — Step 2 by checking it out, rollback by `git switch -C`. Measured: a collaborator's commit checked out locally and then dropped by a rewrite is overwritten with exit 0. Measured end to end 2026-08-22 on git 2.55.0 (the equivalent `/push-ci` fence, same shapes): classifier reads `C`; divergent `D` is published; a background fetch moves the tracking ref to `D`; `D` is in the branch reflog because it was committed on this branch and reset away (committing writes the branch's **own** reflog — the one the flag reads; a plain checkout of a branch that does not move writes only HEAD's) — the bare lease plus `--force-if-includes` published over `D` with exit 0, and the same tree with the classified tip as the lease value was rejected `(stale info)`. The two are **not** combined: on the same git a push carrying an explicit lease value **and** `--force-if-includes` succeeded (exit 0) exactly where the value alone refuses — git documents the flag as a no-op beside a lease value, and this is that no-op arriving silently. Requires git ≥ 2.30. What the lease still does **not** prove is that the outgoing history *preserves* the remote tip; it binds the destination, not the shape of what replaces it |
| Protected head branches rejected — Phase 0, re-asserted at Step 5 and Rollback | A PR opened from `main`/`master`/`develop`/`release/*` would make the force-push rewrite a shared branch, which `rules/git-workflow.md` prohibits; "PR head" is not proof of "not protected" |
| Backup tags from `origin/*` | Remote is SSOT; local refs may be stale |
| Tags keyed by PR number | Avoids namespace collisions across branch prefixes |
| Manifest = subject + count (not SHA) | Survives SHA rewrite during rebase |
| Mismatch → STOP + restore | Backup tags enable instant rollback. **Round 60 made this executable**: it was a `#` comment under a bare `diff`, so a mismatch printed its diff and the fence pushed anyway — and `diff` is a command word an imported `BASH_FUNC_diff%%` outranks, so a forged exit 0 was equally unread. It is now `if ! /usr/bin/diff …; then` — restore, then `exit 1`, with a second message if the restore itself fails. Steps 2 and 3 gained the same treatment: a failed checkout or an interrupted rebase used to reach the push |
| CI must PASS before merge | Rebase can introduce conflicts; CI catches them |
| Update PR base before CI | CI must run against the correct epic diff |
| AskUserQuestion before destructive ops | Per `@rules/git-workflow.md` exception model |
| `/watch-ci` for CI delegation | Reuses tested timeout/verdict logic; avoids inline `gh run watch` divergence |

## Rollback

If any step fails or user aborts:

**The rollback push carries its own AskUserQuestion — it is never covered by an earlier one.**
Register #4 grants this skill `git push --force-with-lease` "after explicit per-use user approval",
and the Step 5 question (`"Manifest verified (N commits). Force-push <head> with --force-with-lease? This rewrites remote history."`) authorized *that*
push, with that content. A rollback rewrites the same remote ref to different content, and it can
be reached before any push question was asked at all — a Step 3 failure enters here directly. So
before the push below, ask:

**Whether the rollback push rewrites anything is a measurement, not a given.** A Step 3 failure is
reached before Step 5 pushed anything, so the remote may still hold exactly what the backup tag
names — restoring it then sends no ref and overwrites no history. Compare, do not assume:

```bash
# Step 0's bindings are gone — this is a separate shell (§ Names in commands), and both names
# below reach a command line. Unset, `"refs/heads/${head}"` is `refs/heads/`, a lookup about no
# branch whose empty answer this fence reads as a **deleted head**; and `"backup/pr-${N}^{commit}"`
# is `backup/pr-^{commit}`, which resolves nothing, so `BACKUP` empties and every valid rollback
# is classified `unknown`. Both verdicts are about an empty name rather than about the rollback
# the operator is being asked to approve, and `unknown` routes even a no-op recovery through the
# rewrite authorization path. Under an inherited `set -u` the fence aborts on `${head}` before
# classifying anything at all. This is the iteration gate's binding, in the iteration gate's
# shape, for the one classifier fence that was left without it.
head=<quoted head>
N=<quoted PR number>
if [[ -z "$head" ]] || [[ -z "$N" ]]; then
  echo "⛔ rollback gate: head or N is unbound in this fence. The remote lookup would name" >&2
  echo "   refs/heads/ and the backup would be read as backup/pr-, so the classification below" >&2
  echo "   would be about neither the branch nor the tag. Bind both from the chain table" >&2
  echo "   (§ Names in commands) and re-run. Nothing is pushed." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — head or N unbound in the rollback-classifier fence}"
fi
# No pipe, no `awk` — for the reason spelled out at the iteration gate above: a pipeline reports
# its LAST command's status, so `ls-remote | awk` exits 0 on a failed lookup (measured `rc=0`
# against a nonexistent remote) and the fail-closed row below became unreachable; and a bare
# `awk` deciding whether an attestation is collected is shadowable by an imported function.
# `origin` is two destinations, not one: `git ls-remote origin` reads the FETCH url, while
# pushing to that same name contacts the PUSH url — `remote.origin.pushurl`, or `url.<x>.pushInsteadOf`
# with no explicit pushurl, moves them apart (both measured, git 2.55.0). Probing one and
# rewriting the other classifies repository A and force-pushes repository B. `--push --all` is
# the oracle that matched what push actually contacted in both cases; `--all` because pushurl is
# multi-valued and the singular form reports a fan-out as a single destination.
if PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git remote get-url --push --all origin); then
  PUSH_URL=${PUSH_URLS%%$'\n'*}
else
  PUSH_URLS=; PUSH_URL=
fi
# Redacted destination — the same derivation, and the same reason, as its first use above.
PUSH_URLS_SAFE=
while IFS= read -r U; do
  case "$U" in
    *://*)
      REST=${U#*://}; AUTH=${REST%%/*}; AUTH=${AUTH%%\?*}; AUTH=${AUTH%%\#*}
      case "$AUTH" in
        *@*) U="${U%%://*}://<redacted>@${AUTH##*@}${REST#"$AUTH"}" ;;
      esac
      case "$U" in
        *\?*) U="${U%%\?*}?<redacted>" ;;
        *\#*) U="${U%%\#*}#<redacted>" ;;
      esac
      ;;
    *:*)
      # scp-like `[user@]host:path`. No scheme, so the arm above cannot reach it — until
      # 2026-08-22 every scp-like user printed verbatim, on the reasoning that it is always `git`.
      # It is not: `<token>@host:path` is legal, and this value goes into an approval transcript.
      # The `*/*` guard is the two readings of `:` — git treats one as scp-like only when no `/`
      # precedes it, so a local path keeps its `@`. Same as `scripts/pre-push-gate.sh`; keep in step.
      _pre=${U%%:*}
      case "$_pre" in
        */*) ;;
        *@*) U="<redacted>@${_pre##*@}:${U#*:}" ;;
      esac
      ;;
  esac
  PUSH_URLS_SAFE=${PUSH_URLS_SAFE:+$PUSH_URLS_SAFE$'\n'}$U
done <<SAFE_EOF
$PUSH_URLS
SAFE_EOF
# Anything but exactly one URL is fail-closed. $(...) strips trailing newlines, so one URL leaves
# none and "$PUSH_URLS" != "$PUSH_URL" is precisely "more than one" — expansion, no command to shadow.
if [[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then
  REMOTE_TIP=; LOOKUP_FAILED=1
# Round 76, the same detector the Step 5 and rollback fences carry. `$PUSH_URL` has already
# been through one `url.*.insteadOf` pass, and handing it to another git command applies a
# SECOND. Where a chain exists this lookup reads a repository the push never contacts, so its
# tip is not about the destination and the ancestry test below would classify the wrong
# history. `LOOKUP_FAILED=1` is the honest reading and it fails closed — the classification
# becomes `unknown` and the unshared question gets asked rather than skipped. The detector is
# purely local: `--get-url` expands the URL through the rewrite table and exits.
elif ! REMOTE_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URL") || [[ "$REMOTE_REPROBE" != "$PUSH_URL" ]]; then
  echo "⛔ url.*.insteadOf rewrites the resolved push destination a SECOND time — this" >&2
  echo "   lookup would read a repository the push never contacts. Topology unknown." >&2
  REMOTE_TIP=; LOOKUP_FAILED=1
elif REMOTE_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URL" "refs/heads/${head}"); then
  REMOTE_TIP=${REMOTE_LS%%$'\t'*}; LOOKUP_FAILED=
else
  REMOTE_TIP=; LOOKUP_FAILED=1
fi
# `--verify … ^{commit}`, and the `|| BACKUP=` is not defensive dressing. A bare `git rev-parse
# "backup/pr-3"` on a ref that does not exist prints the ARGUMENT on stdout and exits 128, so
# `BACKUP` came to hold the string `backup/pr-3` — a ref name reported in a field the operator
# reads as an object name, and passed to `merge-base` as if it were one. `--verify` prints nothing
# on failure, and the fallback makes "did not resolve" an empty value the classifier below can see.
BACKUP=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --verify "backup/pr-${N}^{commit}") || BACKUP=

# Inequality is not a rewrite. Restoring an older remote tip to a descendant of itself is an
# ordinary fast-forward, and `rules/git-workflow.md` § Push safety defines the class by ancestry,
# not by difference. This is the test that separates them.
#
# Round 53, and it is the iteration classifier's defect in the same shape: the ancestry test ran
# unconditionally, so an empty `REMOTE_TIP` — from a failed lookup OR from a head the remote no
# longer has — made `merge-base` exit 128, and the table's first and third rows then described the
# same run in opposite terms. That table said "checked first" to settle it, which is a precedence
# stated in prose next to rows that overlap, not a decision anything executes. The ORDER below is
# the decision, `LOOKUP_FAILED` first for the same reason as above: a failed lookup also empties
# `REMOTE_TIP`, and reading that as a deleted head would report a benign creation for a remote
# nobody could reach.
if [[ "$LOOKUP_FAILED" = 1 ]] || [[ -z "$BACKUP" ]]; then
  ROLLBACK_ANCESTRY=; ROLLBACK_READING=unknown      # no answer, or no backup to restore
elif [[ -z "$REMOTE_TIP" ]]; then
  ROLLBACK_ANCESTRY=; ROLLBACK_READING=head-deleted # answered: the head is gone from the remote
elif [[ "$REMOTE_TIP" = "$BACKUP" ]]; then
  ROLLBACK_ANCESTRY=; ROLLBACK_READING=no-op        # the remote already holds the backup
else
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$REMOTE_TIP" "$BACKUP"; then ROLLBACK_ANCESTRY=0; else ROLLBACK_ANCESTRY=$?; fi
  # same three readings; >1 is "did not answer", never "answered no"
  case "$ROLLBACK_ANCESTRY" in
    0) ROLLBACK_READING=fast-forward ;;
    1) ROLLBACK_READING=rewrite ;;
    *) ROLLBACK_READING=unknown ;;
  esac
fi
# Printed for the same reason as the iteration classifier above: the table below picks its row
# from these values, and it is read in a later step, in a shell that never saw them.
# The binding key the push fence compares (round 54). Redaction is lossy on purpose, so the
# redacted string cannot serve as an identity; this digest can, and it discloses nothing.
# One digest per push URL, SHA-256, space separated — a SET, because git invokes the pre-push hook
# ONCE PER PUSH URL with that single URL in `$2` (measured 2026-08-22). A digest of the whole list
# matches no single call, so it refused every fan-out the operator had configured and approved.
# SHA-256 rather than `git hash-object`: `rules/security.md` prohibits SHA-1 where a digest carries
# a security decision, and that prohibition is what makes the change mandatory. `hash-object` also
# follows the *repository's* object format — measured 2026-08-22, the same URL digests to
# `b354136a…` by default and `7524f1f0…` under `--object-format=sha256`, and back to the SHA-1
# value outside a repository. Round 59 corrects how much that carries: it does NOT by itself make
# the two sides disagree, since the plan side and the hook run for the same repository and read
# the same format. It is a reason not to build a cross-process binding on a tool whose algorithm
# is chosen by ambient state, and it bites where one side runs outside the repository at all.
# A URL that will not hash empties the WHOLE value rather than shortening the set: a partial set
# approves fewer destinations than the plan showed, and looks like a successful derivation.
# Round 60: SELECT the digest tool, THEN feed it. A `||` chain over a pipeline let the FIRST
# command consume stdin and then fail, after which the fallback hashed EOF. Measured 2026-08-22:
# `https://gw.example/push?repo=A&token=one` and `…?repo=B&token=two` BOTH digested to
# e3b0c442…b855 — the SHA-256 of the empty string — so two different destinations compared EQUAL
# and the destination guard passed on a destination that had changed. `command -v` does not read
# stdin, so doing the selection with it feeds the input exactly once, to exactly one tool. Same
# shape as `scripts/pre-push-gate.sh` § sha256_raw, deliberately: one algorithm, stated once.
sha256_raw() {   # reads stdin, writes the selected tool's own output line; nonzero only if none exists
  # Invoked through `/usr/bin/env`, never as a bare word. `command -v` reports an imported shell
  # function as a perfectly good command, and the known-answer test below only rejects a tool that
  # answers one CONSTANT. An ADAPTIVE function passes both vectors and then returns one fixed
  # digest for every real URL, so two different destinations compare EQUAL and the approval is
  # bound to nothing. `env` resolves PATH only, and bash refuses to import a function whose name
  # contains a slash, so a function-only match makes `env` fail and the test below correctly
  # empties the digest. `scripts/pre-push-gate.sh` needs no such spelling and is not inconsistent
  # with this: its `#!/usr/bin/env -S bash -p` shebang refuses to import functions at all, while
  # these fences have no shebang of their own. The defence differs because the channel does.
  if command -v sha256sum >/dev/null 2>&1; then /usr/bin/env sha256sum
  elif command -v shasum >/dev/null 2>&1; then /usr/bin/env shasum -a 256
  elif command -v openssl >/dev/null 2>&1; then /usr/bin/env openssl dgst -sha256
  else return 1
  fi
}
sha256_hex() {   # the bare hex the tool produced — NO shape check, the KAT below needs the raw answer
  _H=$(/usr/bin/printf '%s' "$1" | sha256_raw 2>/dev/null) || _H=
  _H=${_H##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _H=${_H%% *}      # sha256sum / shasum: `<hex>  -`
  /usr/bin/printf '%s' "$_H"
}
# Known-answer test, two vectors. A tool that answers one constant whatever it is fed makes every
# destination compare equal to every approval — and a constant is well-shaped, so the shape check
# in the loop cannot see it. The empty vector is precisely the answer the defect above produced.
DIGEST_TOOL_OK=
if [[ "$(sha256_hex '')" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] \
&& [[ "$(sha256_hex abc)" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]]; then
  DIGEST_TOOL_OK=yes
fi
PUSH_URLS_DIGEST=
while IFS= read -r U; do
  [[ -n "$U" ]] || continue
  D=
  if [[ -n "$DIGEST_TOOL_OK" ]]; then D=$(sha256_hex "$U"); fi
  case "$D" in *[!0-9a-f]*|'') D= ;; *) [[ ${#D} -eq 64 ]] || D= ;; esac
  if [[ -z "$D" ]]; then PUSH_URLS_DIGEST=; break; fi
  PUSH_URLS_DIGEST=${PUSH_URLS_DIGEST:+$PUSH_URLS_DIGEST }$D
done <<< "$PUSH_URLS"
# `remote.<name>.receivepack` names the program that receives the objects on the far side, and a
# program is free to ignore the repository the URL named. Measured 2026-08-22: with one configured,
# an ordinary branch push printed `To <the approved URL>  * [new branch] main -> main` while every
# object landed in a DIFFERENT repository and the named one stayed empty. No digest of the URL can
# see that, so with one configured the destination is not established and this skill does not push.
# The gate refuses it too where the binding reaches it; this line is what covers the projects that
# never installed the gate, and `git-workflow.md` § Push safety is why the absent gate moves the
# question here rather than deleting it. This read is best-effort and its boundary is measured:
# git runs the pre-push hook only after the ref advertisement, so a wrapper that clears its own
# config key before serving redirects the objects while every reader here sees nothing (measured
# 2026-08-22 — the hook saw `<unset>`, git reported success against the named URL, and the objects
# landed elsewhere). What closes that is the push line itself, which spells
# `--receive-pack=git-receive-pack`: a command-line value overrides the configured one, while
# `-c remote.<name>.receivepack=` does not (git keeps the config value and says "more than one
# receivepack given, using the first"). This read still earns its place — it refuses BEFORE the
# operator is asked to approve a destination that was never going to receive the objects.
PUSH_RECEIVEPACK=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config --get remote.origin.receivepack 2>/dev/null) || PUSH_RECEIVEPACK=
PUSH_RECEIVEPACK_SET=no
if [[ -n "$PUSH_RECEIVEPACK" ]]; then PUSH_RECEIVEPACK_SET=yes; fi
# **The report is as security-sensitive as the readings above, and until round 59 it was the one
# construct here that a caller could answer.** `printf` is a regular builtin, and in bash a
# function outranks a builtin, so an exported `BASH_FUNC_printf%%` replaces this line wholesale:
# measured 2026-08-22, a fence whose real variables were `ASK=1 ASK_REASON=rewrite` printed
# `ASK=[] ASK_REASON=[fast-forward]` to the agent. Every `case` and `[[` above is immune and it
# bought nothing, because the verdict left through a channel the caller owned. An ABSOLUTE path is
# immune for the reason the Husky stanza already relies on — bash refuses to import a function
# whose name contains a slash (`error importing function definition for '/usr/bin/printf'`,
# measured). If `/usr/bin/printf` is missing the fence prints no report at all, and that is the
# correct failure: **a run with no report line is `unknown`, and unknown asks.**
/usr/bin/printf 'PUSH_URLS_SAFE=[%s]\nPUSH_URLS_DIGEST=[%s]\nPUSH_RECEIVEPACK_SET=[%s]\nREMOTE_TIP=[%s]\nLOOKUP_FAILED=[%s]\nBACKUP=[%s]\nROLLBACK_READING=[%s]\nROLLBACK_ANCESTRY=[%s]\n' \
  "$PUSH_URLS_SAFE" "$PUSH_URLS_DIGEST" "$PUSH_RECEIVEPACK_SET" "$REMOTE_TIP" "$LOOKUP_FAILED" "$BACKUP" "$ROLLBACK_READING" "$ROLLBACK_ANCESTRY"
```

| Result | Reading | Ask the unshared question? |
|--------|---------|---------------------------|
| `ROLLBACK_READING=unknown` | The lookup did not answer, `backup/pr-<N>` did not resolve, or `merge-base` **errored** rather than answering — a corrupt or incomplete graph, an unreadable object. Exit 1 is the answer "no"; anything above it is the absence of an answer, and the iteration table and `/push-ci` both separate the two | **Yes** — fail closed, as *unknown*, not as a measured rewrite |
| `ROLLBACK_READING=no-op` | `REMOTE_TIP` = `BACKUP`: the remote already holds the backup. Nothing is rewritten | No — and say so in the report rather than pushing |
| `ROLLBACK_READING=head-deleted` | The lookup answered and the head no longer exists on the remote. Restoring it would be a **creation**, not a rewrite | No — and do not push: report and hand back, exactly as the row above. The push below leases against the tracking ref, which still holds the pre-deletion OID, so git refuses it with `stale info` (measured 2026-08-21); the form that would work is not on the Anchor grant, and somebody else deleted this branch |
| `ROLLBACK_READING=fast-forward` | The backup is a descendant of what the remote holds — an ordinary **fast-forward**. Different OIDs, no rewrite: inequality alone never was the test | No |
| `ROLLBACK_READING=rewrite` | The backup does not reach what the remote holds — the restore **rewrites** it | **Yes** |

These five are a partition, produced by the fence, exactly as the iteration table's are (round 53).
The first row used to say "**checked first**", which is what a table needs when its rows can both
match — and they could: a failed lookup and a deleted head both left `REMOTE_TIP` empty and both
made `merge-base` exit 128. Precedence now lives in the `if` chain that assigns the word, so no
reader has to apply it and no row can be reached by two different runs.

Where it is owed, the unshared question comes first here too, and the reason is sharper on this path
than on the others. Not because no gate has run — one has: bundled mode gates before Step 2 and
`--per-step` before Step 3, so a Step 3 failure is always downstream of at least one. It is that
none of them asked about **this** push. The Step 5 question authorized a rebased head; the bundled
`Proceed` covered Steps 2-9 of the iteration; an unshared attestation given for either was given
about a different rewrite of the ref, to different content. An attestation from an earlier iteration
carries even less. So a gate having run is not evidence for this push, and where the table above
says ask, there is no earlier answer to lean on.

| # | Field | Value |
|---|-------|-------|
| 1 | `question` | `"Is anybody else working on <head>? The rollback force-pushes it to <PUSH_URLS_SAFE> over <REMOTE_TIP><basis>."` — `<basis>` is `, rewriting its remote history` only when `ROLLBACK_READING=rewrite`; on `unknown` it is `, and its topology could not be verified — treated fail-closed`, and `<REMOTE_TIP>` is `an unknown tip` when the lookup itself failed rather than the empty string, which reads as a ref named nothing |
| 1 | `options` | `Nobody else works on <head>` → continue to gate 2; `Someone else might` → **stop; leave the remote as it is** |
| 2 | `question` | `"Rollback: force-push <head> to <PUSH_URLS_SAFE> back to backup/pr-<N> with --force-with-lease?<effect>"` — `<effect>` states what the classifier above measured, never one fixed sentence: ` This rewrites remote history, replacing <REMOTE_TIP>.` — with the **full object ID** the classifier fence printed — only when `ROLLBACK_READING=rewrite`; ` Its topology could not be verified — treated fail-closed as a rewrite.` on `unknown`; ` The remote's tip is contained in the backup, so this is a fast-forward, not a rewrite.` on `fast-forward`. The unconditional sentence this replaced was false on exactly the rows the classifier exists to identify, and a warning the operator learns is sometimes false is the one the attestation contract cannot afford. The object ID belongs in **this** question and not only in row 1: row 1 is the attestation, and the rollback fence compares `APPROVED_TIP` against what the *approval* covered — an approval that says only "this rewrites remote history" authorizes rewriting whatever happens to be there when the push runs |
| 2 | `options` | `Restore from backup`, `Stop and leave the remote as it is` |
| 2 | `description` | Name the failed step, the backup tag SHA, and the SHA the remote currently holds |

If the operator declines, stop and report the state — but **report it, do not assert it**. Declining
stops *before* the block below, and that block is where the local restore happens (`git switch -C`
from the backup tag), so at this point neither side has been restored. An earlier version of this
line read "the local branch is restored, the remote is not", which describes a state the decline
path never reaches and would send the developer looking for a repair that was never made.

Report three measured values, each re-derived through the same normalized prefix the block below
uses, and name them as what they are:

| Value | Command | Why it is the one that matters |
|-------|---------|-------------------------------|
| Local head | `git rev-parse HEAD` | Where the working branch actually sits — mid-rebase, restored, or untouched |
| Backup tag | `git rev-parse backup/pr-<N>` | The commit a later restore would return to. A missing tag is itself the finding |
| Remote head | `git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URL" refs/heads/<head>` | What everyone else sees **at the repository this push will reach**. Read from the remote, never from `origin/<head>`, which is only as fresh as the last fetch — and never from the name `origin`, which resolves to the *fetch* URL here and the *push* URL at the push |

Do not push, and do not restore. The developer decides with those three in front of them.

**Steps 1 and 2 of the block below run on every row that reaches rollback; step 3 does not.** The
clean-tree check and the local `git switch -C` restore touch nothing anybody else holds, so they
are owed even on the two rows that push nothing — `REMOTE_TIP` = `BACKUP` and a head the remote no
longer has. Those rows are exactly the ones where rollback was invoked because the *local* branch
is mid-rebase, and reading the block's prerequisite as covering all three steps would leave them
with no defined recovery at all.

```bash
# PUSH_BLOCKED is this fence's own refusal record, and it exists because `exit` cannot be trusted
# to end the fence. `exit` is a builtin, so an imported `BASH_FUNC_exit%%` function outranks it —
# measured on bash 3.2.57: a refusal printed in full and the force-push then ran, exit status 0. No
# keyword terminates a shell (`return` is a builtin too), so the fix is not a better terminator: a
# refusal RECORDS itself in an assignment, and the push below is reached only through `[[ ]]`,
# which the parser resolves before any name is looked up.
# The record is FROZEN, not merely written — this paragraph used to say an assignment is something
# "nothing outranks", which confuses the command with the value. The command cannot be outranked;
# the value it wrote can be erased by whatever runs next, and under this vector that is the hostile
# function itself: `BASH_FUNC_exit%%='() { PUSH_BLOCKED=; return 0; }'` cleared the flag and the
# push ran at status 0 (measured 2026-08-22, bash 3.2.57 and 5.3.15). `readonly` at every pre-push
# refusal site below closes it — the erasing assignment, `unset` and `declare -g` each fail against
# a readonly name and the refusal held on both shells. The post-push sites that only accumulate a
# status stay plain assignments: no `exit` runs between them and the guard, so the vector needs a
# terminator it never gets. What none of this closes is injection — an environment that can define
# `exit` can define `git`, measured the same day intercepting a whole push. The record defends the
# case where the terminator alone was trusted; it was never a fence against imported functions.
# `exit 1` stays —
# in an ordinary shell it is still right, and it is no longer the only thing standing between a
# refusal and a force-push. Cleared here rather than defaulted, so an exported value of the same
# name cannot pre-approve anything either.
#
# The guard sits on its own physical line, ending in `&& \`, so the push line's own bytes stay
# out of it: everything after the `push` subcommand on that line is read as this push's argv,
# by the byte pin and by the forbidden-flag scan alike, and a guard written INTO the line would
# put words there that git never sees.
# This paragraph used to say the two force-pushes are byte-identical by design. They are not,
# and have not been since round 60 gave Step 5 an explicit `--force-with-lease=<ref>:<expect>`
# and dropped `--force-if-includes` from it — measured on git 2.55.0, the flag is a silent no-op
# once the lease carries a value. Round 75 put the rollback push on the same shape, so what
# separates them now is one variable name: `$FINAL_TIP` here, `$RB_TIP` there. What the two share
# is the refspec — an object ID on the left, under the same name, so neither publishes something
# later than what it classified — and now the lease as well, each bound to the tip its own fence
# measured. Both are
# pinned; the pins are what make the difference visible in a diff rather than something a reader
# has to notice.
PUSH_BLOCKED=

# 1. Working tree must be clean — enforced, not observed. A trailing comment refuses
# nothing: the command exits 0 on a dirty tree, so the restore below runs anyway and
# `git switch -C` overwrites the branch with uncommitted work still in the tree. This
# is the recovery path, which is exactly where losing changes is least recoverable.
# Status and output are captured SEPARATELY, because `$( )` reports neither on its own: a
# `git status` that fails prints nothing, the substitution yields the empty string, and
# `[[ -n "" ]]` reads it as **clean**. Measured 2026-08-22 outside a repository — exit 128, zero
# bytes, and both bash 3.2 and zsh 5.9 fell through to the restore. That is the worst place in the
# document for a fail-open: `git switch -C` below overwrites the branch, and this is the recovery
# path, where losing uncommitted work is least recoverable. Three states, not two: could not look,
# looked and dirty, looked and clean — and only the third may continue.
WT_STATUS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git status --porcelain) || {
  echo "⛔ the working tree could not be read (git status failed) — that is not the same as clean," >&2
  echo "   and the restore below overwrites the branch. Nothing is restored and nothing is pushed." >&2
  readonly PUSH_BLOCKED=1
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the working tree could not be read}"
}
if [[ -n "$WT_STATUS" ]]; then
  echo "⛔ working tree is not clean — commit or stash before restoring from backup" >&2
  readonly PUSH_BLOCKED=1
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the working tree is not clean}"
fi

# 2. Restore branch from backup tag — the rollback force-pushes <head> too, so the
#    same protected-branch guard applies; a protected head means manual recovery
head=<quoted head>   # bind once, as in Step 0 — § Names in commands
case "$head" in
  main|master|develop|release/*)
    echo "⛔ PR head '$head' is a protected branch — rollback push refused, recover manually" >&2
    readonly PUSH_BLOCKED=1; exit 1
    ;;
esac
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git switch -C "$head" "refs/tags/backup/pr-<N>"; then
  echo "⛔ the local restore from refs/tags/backup/pr-<N> did not happen — refs/heads/${head}" >&2
  echo "   still holds whatever the rollback was called to replace. Pushing it now would" >&2
  echo "   rewrite the remote TO the broken state, under an approval whose question named the" >&2
  echo "   backup tag. Nothing is pushed. STOP; recover manually." >&2
  readonly PUSH_BLOCKED=1; exit 1
fi
# The object the restore produced, read once and pushed by ID — same reason as Step 5, and the
# same name so the two pushes keep saying the same thing. The check above proves the branch now
# holds the backup; without this, what the push publishes is whatever `refs/heads/${head}` holds
# when git resolves it, which is a different question asked later.
# Measured 2026-08-22 (git 2.55.0) when this fence still carried `--force-if-includes`, because at
# the time the rollback push was believed to be the one path where that flag was live: with the
# lease deliberately satisfied, a SHA-source push carrying both flags was rejected `(remote ref
# updated since checkout)` exactly as the branch-source form was, exit 1 both times; the same
# SHA-source push with the lease alone succeeded. The measurement stands — the flag does survive
# an object-ID source — but its premise did not: `switch -C` puts the branch's previous OID into
# the reflog the flag certifies against, so on *this* path it certified something the path itself
# had arranged. Round 75 replaced the pair here with a lease bound to the tip part (b) measures.
PUSHED=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --verify --quiet "refs/heads/${head}") || PUSHED=
# 3. Push the restored head. Reached on the three rows the classifier sends here: a measured
#    rewrite, a topology it could not verify (fail-closed), and an ordinary fast-forward. Gate 2
#    ("Restore from backup") is required on all three; gate 1 — the unshared attestation — only on
#    the two the table marks **Yes**, because asking whether anybody else holds a branch this push
#    is about to rewrite is not a question about a fast-forward. Either gate answered otherwise
#    means this line does not run. "BOTH questions, always" is what this replaced, and it was
#    wrong in both directions at once: it demanded an attestation the fast-forward row is not
#    owed, and it read as the prerequisite of the local restore above, which no row is exempt from.
# Same lease declaration as Step 5, and for the same reason — restoring a backup rewinds
# the remote ref, which is non-fast-forward too. ALLOW_PUSH_PROTECTED stays cleared.
# …and never to a different repository than the approval named. Same divergence as the probe
# above, one step later: re-resolve the push destination here and compare it against the redacted
# destination the approval **named in its own question text** — every bundled, per-step and
# rollback gate carries `<PUSH_URLS_SAFE>`, because a fence comparing against a value the
# operator was never shown detects a later config change while authorizing nothing. A config
# change between the question and the push would otherwise redirect an approved history rewrite
# to another repository, silently.
PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git remote get-url --push --all origin) || PUSH_URLS=
# Redacted destination — the same derivation, and the same reason, as its first use above.
PUSH_URLS_SAFE=
while IFS= read -r U; do
  case "$U" in
    *://*)
      REST=${U#*://}; AUTH=${REST%%/*}; AUTH=${AUTH%%\?*}; AUTH=${AUTH%%\#*}
      case "$AUTH" in
        *@*) U="${U%%://*}://<redacted>@${AUTH##*@}${REST#"$AUTH"}" ;;
      esac
      case "$U" in
        *\?*) U="${U%%\?*}?<redacted>" ;;
        *\#*) U="${U%%\#*}#<redacted>" ;;
      esac
      ;;
    *:*)
      # scp-like `[user@]host:path`. No scheme, so the arm above cannot reach it — until
      # 2026-08-22 every scp-like user printed verbatim, on the reasoning that it is always `git`.
      # It is not: `<token>@host:path` is legal, and this value goes into an approval transcript.
      # The `*/*` guard is the two readings of `:` — git treats one as scp-like only when no `/`
      # precedes it, so a local path keeps its `@`. Same as `scripts/pre-push-gate.sh`; keep in step.
      _pre=${U%%:*}
      case "$_pre" in
        */*) ;;
        *@*) U="<redacted>@${_pre##*@}:${U#*:}" ;;
      esac
      ;;
  esac
  PUSH_URLS_SAFE=${PUSH_URLS_SAFE:+$PUSH_URLS_SAFE$'\n'}$U
done <<SAFE_EOF
$PUSH_URLS
SAFE_EOF
# Round 54: identity is the DIGEST, not the redaction. Two destinations differing only in the
# query redact to one string (measured), so comparing the redaction alone binds this approval to a
# host and a path — and a `.git/config` edit between the question and the push then redirects an
# approved history rewrite to another repository with this guard still passing. The digest is
# one-way and carries no credential; `git hash-object` needs no repository. An EMPTY digest
# refuses rather than matching an empty expectation.
# One digest per push URL, SHA-256, space separated — a SET, because git invokes the pre-push hook
# ONCE PER PUSH URL with that single URL in `$2` (measured 2026-08-22). A digest of the whole list
# matches no single call, so it refused every fan-out the operator had configured and approved.
# SHA-256 rather than `git hash-object`: `rules/security.md` prohibits SHA-1 where a digest carries
# a security decision, and that prohibition is what makes the change mandatory. `hash-object` also
# follows the *repository's* object format — measured 2026-08-22, the same URL digests to
# `b354136a…` by default and `7524f1f0…` under `--object-format=sha256`, and back to the SHA-1
# value outside a repository. Round 59 corrects how much that carries: it does NOT by itself make
# the two sides disagree, since the plan side and the hook run for the same repository and read
# the same format. It is a reason not to build a cross-process binding on a tool whose algorithm
# is chosen by ambient state, and it bites where one side runs outside the repository at all.
# A URL that will not hash empties the WHOLE value rather than shortening the set: a partial set
# approves fewer destinations than the plan showed, and looks like a successful derivation.
# Round 60: SELECT the digest tool, THEN feed it. A `||` chain over a pipeline let the FIRST
# command consume stdin and then fail, after which the fallback hashed EOF. Measured 2026-08-22:
# `https://gw.example/push?repo=A&token=one` and `…?repo=B&token=two` BOTH digested to
# e3b0c442…b855 — the SHA-256 of the empty string — so two different destinations compared EQUAL
# and the destination guard passed on a destination that had changed. `command -v` does not read
# stdin, so doing the selection with it feeds the input exactly once, to exactly one tool. Same
# shape as `scripts/pre-push-gate.sh` § sha256_raw, deliberately: one algorithm, stated once.
sha256_raw() {   # reads stdin, writes the selected tool's own output line; nonzero only if none exists
  # Invoked through `/usr/bin/env`, never as a bare word. `command -v` reports an imported shell
  # function as a perfectly good command, and the known-answer test below only rejects a tool that
  # answers one CONSTANT. An ADAPTIVE function passes both vectors and then returns one fixed
  # digest for every real URL, so two different destinations compare EQUAL and the approval is
  # bound to nothing. `env` resolves PATH only, and bash refuses to import a function whose name
  # contains a slash, so a function-only match makes `env` fail and the test below correctly
  # empties the digest. `scripts/pre-push-gate.sh` needs no such spelling and is not inconsistent
  # with this: its `#!/usr/bin/env -S bash -p` shebang refuses to import functions at all, while
  # these fences have no shebang of their own. The defence differs because the channel does.
  if command -v sha256sum >/dev/null 2>&1; then /usr/bin/env sha256sum
  elif command -v shasum >/dev/null 2>&1; then /usr/bin/env shasum -a 256
  elif command -v openssl >/dev/null 2>&1; then /usr/bin/env openssl dgst -sha256
  else return 1
  fi
}
sha256_hex() {   # the bare hex the tool produced — NO shape check, the KAT below needs the raw answer
  _H=$(/usr/bin/printf '%s' "$1" | sha256_raw 2>/dev/null) || _H=
  _H=${_H##*= }     # openssl: `SHA2-256(stdin)= <hex>`
  _H=${_H%% *}      # sha256sum / shasum: `<hex>  -`
  /usr/bin/printf '%s' "$_H"
}
# Known-answer test, two vectors. A tool that answers one constant whatever it is fed makes every
# destination compare equal to every approval — and a constant is well-shaped, so the shape check
# in the loop cannot see it. The empty vector is precisely the answer the defect above produced.
DIGEST_TOOL_OK=
if [[ "$(sha256_hex '')" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] \
&& [[ "$(sha256_hex abc)" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]]; then
  DIGEST_TOOL_OK=yes
fi
PUSH_URLS_DIGEST=
while IFS= read -r U; do
  [[ -n "$U" ]] || continue
  D=
  if [[ -n "$DIGEST_TOOL_OK" ]]; then D=$(sha256_hex "$U"); fi
  case "$D" in *[!0-9a-f]*|'') D= ;; *) [[ ${#D} -eq 64 ]] || D= ;; esac
  if [[ -z "$D" ]]; then PUSH_URLS_DIGEST=; break; fi
  PUSH_URLS_DIGEST=${PUSH_URLS_DIGEST:+$PUSH_URLS_DIGEST }$D
done <<< "$PUSH_URLS"
# `remote.<name>.receivepack` names the program that receives the objects on the far side, and a
# program is free to ignore the repository the URL named. Measured 2026-08-22: with one configured,
# an ordinary branch push printed `To <the approved URL>  * [new branch] main -> main` while every
# object landed in a DIFFERENT repository and the named one stayed empty. No digest of the URL can
# see that, so with one configured the destination is not established and this skill does not push.
# The gate refuses it too where the binding reaches it; this line is what covers the projects that
# never installed the gate, and `git-workflow.md` § Push safety is why the absent gate moves the
# question here rather than deleting it. This read is best-effort and its boundary is measured:
# git runs the pre-push hook only after the ref advertisement, so a wrapper that clears its own
# config key before serving redirects the objects while every reader here sees nothing (measured
# 2026-08-22 — the hook saw `<unset>`, git reported success against the named URL, and the objects
# landed elsewhere). What closes that is the push line itself, which spells
# `--receive-pack=git-receive-pack`: a command-line value overrides the configured one, while
# `-c remote.<name>.receivepack=` does not (git keeps the config value and says "more than one
# receivepack given, using the first"). This read still earns its place — it refuses BEFORE the
# operator is asked to approve a destination that was never going to receive the objects.
PUSH_RECEIVEPACK=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config --get remote.origin.receivepack 2>/dev/null) || PUSH_RECEIVEPACK=
if [[ -n "$PUSH_RECEIVEPACK" ]] || [[ -z "$PUSH_URLS" ]] || [[ -z "$PUSH_URLS_DIGEST" ]] \
   || [[ "$PUSH_URLS_DIGEST" != "<the PUSH_URLS_DIGEST value the classifier fence printed for this iteration, written literally and quoted>" ]] \
   || [[ "$PUSH_URLS_SAFE" != "<the redacted destination this iteration's approval named — the PUSH_URLS_SAFE value the question showed>" ]]; then
  echo "⛔ push destination '${PUSH_URLS_SAFE:-unresolvable}' is not the one approved — refusing" >&2
  echo "   (identity is a digest of the raw destination, so a change the redaction hides still refuses)" >&2
  if [[ -n "$PUSH_RECEIVEPACK" ]]; then
    echo "   (remote.origin.receivepack is configured, so the URL does not decide where the objects land; read it with: git config --get remote.origin.receivepack)" >&2
  fi
  readonly PUSH_BLOCKED=1; exit 1
fi
# ── Round 74. Two things the rollback push was missing that the Step 5 push has had since round
# 60, both of which decided nothing here because neither value existed in this fence.
#
# (a) The classifier's own verdict. The table above sends `no-op` and `head-deleted` through the
# LOCAL restore and says, in both rows, do not push. Nothing in this fence read that: the only
# push predicates were an empty `PUSH_BLOCKED` and a non-empty `PUSHED`, and both are true on
# those rows. So a `head-deleted` reading — somebody else deleted this branch — reached a
# force-push that can recreate it, and `no-op` reached one that publishes what the remote already
# holds. Bound the way `PUSH_URLS_DIGEST` is bound just above, because a fence is a separate
# shell and a value the classifier printed is not in it (§ 4.52, § 4.54: the harness supplying
# what the fence should bind is how the same class survived a whole round of tests).
ROLLBACK_READING=<the ROLLBACK_READING value the classifier fence printed for this iteration, written literally and quoted>
UNSHARED_ATTESTED=<empty unless the operator answered YES to the unshared question for this rollback; then the literal string refs/heads/ followed by the head branch name, written literally and quoted>
# The remote tip the pre-restore classifier PRINTED as `REMOTE_TIP=[...]` — bound here for the
# same reason as the two fields above, and it earns its place more plainly in this fence than in
# Step 5's: `rewrite` is the ORDINARY reading for a rollback, because the backup by construction
# does not contain the head this skill just pushed. So the reading alone cannot tell "undoing our
# own push" from "somebody else published on top of it", and the tip is what separates them.
APPROVED_TIP=<the REMOTE_TIP value the pre-restore classifier fence printed for this iteration, written literally and quoted>
# `case` over the WORD with a `*` catch-all, never a negated list: a reading this fence has not
# heard of must land in the refusing arm by construction — including the empty string, which is
# what an unsubstituted field leaves behind.
case "$ROLLBACK_READING" in
  rewrite|unknown|fast-forward) ;;
  no-op)
    echo "⛔ the classifier read 'no-op': the remote already holds backup/pr-<N>. The local" >&2
    echo "   restore is done; there is nothing to publish. Report and hand back." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
  head-deleted)
    echo "⛔ the classifier read 'head-deleted': refs/heads/${head} no longer exists on the" >&2
    echo "   remote — somebody else deleted it. The local restore is done. Recreating the branch" >&2
    echo "   is not what this approval asked for; report and hand back." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
  *)
    echo "⛔ ROLLBACK_READING is '${ROLLBACK_READING:-unbound}' — this fence did not receive the" >&2
    echo "   classifier's verdict, so it cannot tell a rewrite from a deletion. Nothing is pushed." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
esac

# (b) A topology measurement taken AFTER the restore, in this fence. The classifier ran in an
# earlier fence, before the approval and before `git switch -C` produced the object being pushed;
# Step 5 re-measures for exactly that reason and rollback did not. The gap is not theoretical:
# `switch -C` puts the branch's previous OID into its reflog, which is what `--force-if-includes`
# certifies against, and the bare lease reads the tracking ref rather than the remote — so a
# remote that changed after the classifier ran can be overwritten while both flags pass and the
# only classification the operator saw said `fast-forward`. Measured against `$PUSHED`, the object
# on the left of the refspec, never against `refs/heads/${head}`, which git resolves again later.
if [[ -z "$PUSH_URLS" ]] || [[ "$PUSH_URLS" == *$'\n'* ]]; then
  RB_TIP=; RB_LOOKUP_FAILED=1
# Round 76: the same second-rewrite detector Step 5 and `/push-ci` carry, for the same measurement
# — `$PUSH_URLS` has already been through one `url.*.insteadOf` pass, and handing it to another git
# command applies another. Where a chain exists the probe reads a repository this push never
# contacts, so both the reading and the lease value would be about the wrong remote. `unknown` is
# the honest classification and the arm below refuses it whatever was attested.
elif ! RB_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URLS") || [[ "$RB_REPROBE" != "$PUSH_URLS" ]]; then
  echo "⛔ url.*.insteadOf rewrites the resolved push destination a SECOND time — the push goes to" >&2
  echo "   the once-rewritten URL while a probe of that URL reads the twice-rewritten one, so this" >&2
  echo "   fence cannot measure what the rollback would overwrite. STOP." >&2
  RB_TIP=; RB_LOOKUP_FAILED=1
elif RB_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URLS" "refs/heads/${head}"); then
  RB_TIP=${RB_LS%%$'\t'*}; RB_LOOKUP_FAILED=
else
  RB_TIP=; RB_LOOKUP_FAILED=1
fi
# Fail-closed rows FIRST — a failed lookup also leaves the tip empty, and testing emptiness first
# would read every unreachable remote as a creation. Same ordering discipline as Step 5.
if [[ -z "$PUSHED" ]] || [[ "$RB_LOOKUP_FAILED" = 1 ]]; then
  RB_ANCESTRY=; RB_READING=unknown
elif [[ -z "$RB_TIP" ]]; then
  RB_ANCESTRY=; RB_READING=creation
elif [[ "$RB_TIP" = "$PUSHED" ]]; then
  RB_ANCESTRY=; RB_READING=up-to-date
else
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$RB_TIP" "$PUSHED"; then RB_ANCESTRY=0; else RB_ANCESTRY=$?; fi
  case "$RB_ANCESTRY" in
    0) RB_READING=fast-forward ;;
    1) RB_READING=rewrite ;;
    *) RB_READING=unknown ;;
  esac
fi
/usr/bin/printf 'RB_READING=[%s]\nRB_TIP=[%s]\nRB_LOOKUP_FAILED=[%s]\nUNSHARED_ATTESTED=[%s]\n' \
  "$RB_READING" "$RB_TIP" "$RB_LOOKUP_FAILED" "$UNSHARED_ATTESTED"
case "$RB_READING" in
  up-to-date|fast-forward) ;;
  creation)
    # Round 75. This row sat in the arm above until now, while the comment below the `case` and the
    # contract table at § the rollback reading table both said the opposite — "do not push: report
    # and hand back". Two documents describing a refusal, and an executable that published. The
    # pre-restore classifier's `head-deleted` row cannot cover this: it answers about the remote as
    # it was BEFORE the local restore, and a branch somebody else deletes in between arrives here
    # instead. Nor is the value-less lease a substitute for the arm — it refuses only while a
    # tracking ref still holds the pre-deletion OID, so a `fetch --prune` in the same window
    # removes the very anchor the refusal was resting on.
    echo "⛔ refs/heads/${head} no longer exists on the remote — somebody deleted it after this" >&2
    echo "   rollback was classified. Restoring it would be a CREATION, not the rewrite this" >&2
    echo "   rollback was approved to undo. STOP: report and hand back to the developer." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
  rewrite)
    if [[ "$UNSHARED_ATTESTED" != "refs/heads/${head}" ]]; then
      echo "⛔ the remote moved since the rollback was classified: refs/heads/${head} now reads" >&2
      echo "   '${RB_TIP}', which backup/pr-<N> does not contain, and no unshared attestation" >&2
      echo "   covers this ref. STOP. Two things are owed, and the ORDER is the contract" >&2
      echo "   (git-workflow.md § Push safety: the question comes BY NAME and BEFORE the approval):" >&2
      echo "   1) put the unshared question to the operator by name;" >&2
      echo "   2) on a yes, ask the rollback force approval AGAIN, with a plan that states this" >&2
      echo "      push rewrites the ref and shows the lease it will carry. The approval you hold" >&2
      echo "      described this rollback as undoing a rewrite, not as performing one over a tip" >&2
      echo "      that appeared afterwards." >&2
      echo "   Only then re-run this fence with UNSHARED_ATTESTED=refs/heads/${head}." >&2
      echo "   Do not set ALLOW_FORCE_UNSHARED — that variable is the developer's, not this skill's." >&2
      readonly PUSH_BLOCKED=1; exit 1
    fi
    # And the attestation, being a credential, says nothing about WHICH commit is destroyed. The
    # arm above passes on the ordinary rollback — the remote holds what this skill pushed, which
    # the backup does not contain — and on the hazardous one alike. This is the test that tells
    # them apart, and it reads the movement as evidence against the attestation it would otherwise
    # proceed on: a ref nobody else holds does not acquire commits nobody here published.
    if [[ "$RB_TIP" != "$APPROVED_TIP" ]]; then
      echo "⛔ refs/heads/${head} points at '${RB_TIP:-<none>}' but this rollback was classified" >&2
      echo "   against '${APPROVED_TIP:-<none>}' — the commit it would destroy is not the one the" >&2
      echo "   approval covered, and the lease, carrying the new tip, would not refuse it." >&2
      echo "   The attestation you hold says this ref is not shared; the tip moving since the" >&2
      echo "   classification is evidence against it. STOP." >&2
      echo "   1) put the unshared question to the operator by name, for the tip as it reads NOW;" >&2
      echo "   2) on a yes, ask the rollback force approval AGAIN, with a plan naming that tip." >&2
      echo "   Do not set ALLOW_FORCE_UNSHARED — that variable is the developer's, not this skill's." >&2
      readonly PUSH_BLOCKED=1; exit 1
    fi ;;
  *)
    echo "⛔ post-restore topology reads '${RB_READING}' for refs/heads/${head} — the measurement" >&2
    echo "   did not answer, so nothing here knows what this push would overwrite. An attestation" >&2
    echo "   answers whether the ref is shared; it is not evidence that the measurement worked." >&2
    readonly PUSH_BLOCKED=1; exit 1 ;;
esac

# Comparison rather than a push to the validated URL, for the reason and the 2026-08-22 measurement
# recorded at the Step 5 push above — `insteadOf` rewrites a command-line URL too, so the swap pins
# nothing. Stated once there; do not restate it here, only one of the two copies would be re-read.
# **Round 75: the lease now carries the tip part (b) measured**, the shape Step 5 has had since
# round 60, and `--force-if-includes` goes with the bare form it was compensating for. The
# previous wording called the value-less lease the stronger anchor, on the grounds that it leases
# against `refs/remotes/origin/<head>` — the tip the last fetch saw — and so refuses anything
# pushed since. That premise is only as good as "nothing re-fetches": a background fetch moves
# that ref, after which the lease expects the collaborator's commit and the push overwrites it,
# and `--force-if-includes` does not stop it because `switch -C` put the branch's previous OID in
# the reflog it certifies against. Measured end to end 2026-08-22 (git 2.55.0) on the equivalent
# `/push-ci` fence: the bare pair published over a divergent `D` with exit 0 while the only
# classification anybody saw said `fast-forward`; the same tree with the classified tip as the
# lease value was rejected `(stale info)`. Binding to `$RB_TIP` also makes the credential and the
# classification name **one** object — the property this whole file keeps asserting elsewhere.
# The user's 2026-08-22 ruling settles the authorization question the old wording deferred to:
# `--force-with-lease=<ref>:<expect>` is the granted flag in its value-bearing form, not a
# separate grant. What is **not** reopened by that ruling is the creation row: re-publishing a
# branch somebody else deleted is not the rewrite rollback was asked to undo, so it is refused in
# the `case` above on that ground alone. Exactly three rows reach this line: `up-to-date` and
# `fast-forward` unconditionally, and `rewrite` once `UNSHARED_ATTESTED` names this ref. On all
# three the remote still holds <head>, so `$RB_TIP` is non-empty and the lease value can never
# collapse into the "this ref must not exist yet" form by accident.
# `SD0X_PUSH_DEST_DIGEST` is the other half of the destination check above, and the half that is
# not a race. The comparison a few lines up re-reads the destination in THIS shell; the push is a
# different process, so a `.git/config` edit or a `url.<x>.pushInsteadOf` landing in between still
# redirects it. git closes that window itself and hands the answer to the pre-push hook as `$2` —
# the destination it is about to reach, resolved inside the pushing process, after every rewrite.
# Measured 2026-08-22 (git 2.55.0): under `url.<B>.pushInsteadOf=<A>` a push naming `origin` gives
# `$1=origin` and `$2=<B>`, and the digest of `$2` equals the digest of `git remote get-url --push
# --all origin` byte for byte, with the rewrite and without it. Wired end to end: the rewrite was
# refused and nothing reached B; the same push carrying B's own digest went through.
#
# **This is not an ALLOW_* variable and the Prohibited list does not cover it.** Those are
# developer attestations, which is why this skill must never set them and must clear the ones it
# inherits. This one is the opposite direction: it is a constraint the skill imposes on its own
# push, it can only ever cause a refusal, and setting it inline is what stops an inherited value
# from deciding. Where the hook is not installed it does nothing at all — monotone, the same
# property the lease value above has: both can only ever turn a push into a refusal.
[[ -z "$PUSH_BLOCKED" ]] && [[ -n "$PUSHED" ]] && \
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ALLOW_PUSH_PROTECTED= ALLOW_FORCE_UNSHARED= SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease="refs/heads/${head}:${RB_TIP}" --receive-pack=git-receive-pack "origin" -- "${PUSHED}:refs/heads/${head}"

# 3. If a merge already happened, manually revert via GitHub UI
#    (no scripted revert — too dangerous for stacked chain)
```

## Conflict Handling

**A conflict ends Claude's execution of the chain.** The Anchor grant in `@rules/git-workflow.md`
is the exact form `git rebase --onto` — `--continue`, `--abort` and `--skip` are not on it, and a
grant for one rebase form is not a grant for the family. So the skill stops with the repository
mid-rebase, prints the commands below, and the developer runs them:

```bash
# resolve the conflicted paths, then:
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --continue     # never --skip — commits must not be lost
# or, if it cannot be resolved:
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --abort        # then restore from the Phase 1 backup tag
```

Re-verify the manifest after the developer reports the rebase finished (subject set must match)
before offering to continue the chain. Resuming without that check merges an unverified tree.

## Resume / Checkpoint (long chains)

For chains of 10+ PRs, mid-failure recovery without restart:

1. Determine where the chain stopped — the binding and its use go in **one** block, because two
   inline spans are two shells and the second would expand an unset (or ambient) `$epic`
   (§ Names in commands):

   ```bash
   if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git tag -l 'backup/pr-*'; then
     echo "⛔ resume: the backup tags could not be listed. They are the cut points this whole" >&2
     echo "   step reads, so an empty listing and an unreadable one mean opposite things. STOP." >&2
     SD0X_EPIC_MERGE_REFUSED=
     : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the backup tags could not be listed}"
   fi
   epic=<quoted epic>
   # Captured, then filtered — never `git log … | grep …`. A pipeline exits with its LAST
   # stage's status, and `grep` is a bare word an imported function can claim, so a forged
   # merged-PR list returns 0 over a `git log` that fataled. Read the two statuses apart:
   # grep exit 1 is "no match", a valid empty answer here; anything above 1 is grep failing.
   if ! EPIC_LOG=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git log "refs/remotes/origin/$epic" --oneline --); then
     echo "⛔ resume: refs/remotes/origin/${epic} could not be read. An epic with no merged" >&2
     echo "   PRs and an epic nobody could read need opposite responses. STOP." >&2
     SD0X_EPIC_MERGE_REFUSED=
     : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the epic log could not be read}"
   fi
   # The `if` carries the status for the reason Step 5 above states: under an inherited
   # `errexit` a following capture line never runs, and grep exit 1 — no merged PRs yet — is
   # the ordinary first resume rather than a failure.
   if MERGED_PRS=$(/usr/bin/grep -E '\(#[0-9]+\)' <<< "$EPIC_LOG"); then GREP_STATUS=0; else GREP_STATUS=$?; fi
   if [[ $GREP_STATUS -gt 1 ]]; then
     echo "⛔ resume: the merged-PR filter itself failed (exit ${GREP_STATUS}). STOP." >&2
     SD0X_EPIC_MERGE_REFUSED=
     : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the merged-PR filter failed}"
   fi
   /usr/bin/printf '%s\n' "$MERGED_PRS"
   ```

2. **Cut the first remaining PR over to the epic yourself — Phase 0 will not do it, and will abort
   until you have.** There is no already-merged detection anywhere in this skill: Phase 0 aborts on
   any PR that is not OPEN, and separately requires the **first** listed PR's base to equal
   `<epic-branch>`. After an interruption the first still-open PR is based on the *previous* PR's
   head, so a bare re-invocation hits that second abort. Worse, if you retarget the base and stop
   there, Phase 0 accepts the chain and Iteration 1 runs a **direct squash with no rebase** — the
   already-merged commits of the previous PR would land on the epic a second time. So do both, in
   this order, before re-invoking:

   ```bash
   epic=<quoted epic>; head=<quoted first-remaining-head>; prev=<quoted previous-merged-PR-number>
   # a. Refresh the epic's remote-tracking ref, THEN rebase off the previous PR's backup tag —
   #    that tag IS the cut point. The destination must be the remote epic: step 1 above says the
   #    previous PR was squash-merged into `origin/$epic`, so that is where the new tip lives.
   RESUME_OK=1
   if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git fetch --upload-pack=git-upload-pack "origin" -- "+refs/heads/${epic}:refs/remotes/origin/${epic}"; then
     echo "⛔ resume: refreshing refs/remotes/origin/${epic} failed. The rebase below would use" >&2
     echo "   the stale tip and the force-push would write it out. Fix the fetch first. STOP." >&2
     RESUME_OK=
   fi
   if [[ -n "$RESUME_OK" ]] && ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --onto "refs/remotes/origin/${epic}" "refs/tags/backup/pr-${prev}" -- "$head"; then
     echo "⛔ resume: the rebase failed. Do NOT force-push and do NOT retarget the base — the" >&2
     echo "   branch is mid-rebase or unchanged, and neither is what step b assumes." >&2
     RESUME_OK=
   fi
   # then, ONLY while $RESUME_OK is still set, force-push ${head} with the Step 5 command
   # verbatim (§ Iteration 2..N). It is
   # referenced rather than copied: this document carries exactly the two push sites the
   # skill executes, and a third literal would read as one more place authorization lives
   # b. Only now retarget the base, so Phase 0's first-base check passes on a rebased branch
   [[ -n "$RESUME_OK" ]] && /usr/bin/env -u BASH_ENV -u ENV gh pr edit "<first-remaining-PR>" --base "$epic"
   ```

   > **`refs/heads/$epic` is not `origin/$epic`, and resume is where that bites.** An earlier
   > version of step 2a rebased onto the **local** branch. Nothing in steps 1–2 creates or
   > refreshes it, so it is stale whenever the developer has not pulled since the last merge, and
   > **absent** whenever they never checked the epic out at all — resume commonly runs in a fresh
   > clone after an interruption. Measured in this repository, the two refs differ right now:
   > `git rev-list --left-right --count refs/heads/main...refs/remotes/origin/main` → `1  0`.
   > The manifest check in § Iteration Step 4 does not catch it: `origin/$epic..$head` can hold
   > exactly the expected subjects while `$head` sits on a stale ancestor, so the force-push and
   > squash that follow would publish the wrong tree with every gate green. The ordinary iteration
   > never had this defect — it rebases onto `origin/$epic` and refreshes that ref at Step 9.

3. Re-invoke `/epic-merge <epic> <remaining-PRs>`, listing **only the still-open PRs**. Iteration 1's
   direct squash is now correct, because step 2 already performed the rebase it does not do.
4. Backup tags from prior session remain valid as long as the corresponding branches have not been
   re-pushed — step 2a re-pushes the first remaining head, so re-tag it if you interrupt again.

> **This is a manual procedure, not an implemented resume.** A real resume would identify the merged
> PR numbers from the epic log, keep the last merged PR's backup tag as the cut point, and route the
> first remaining PR through the Iteration 2 rebase path automatically. None of that exists here; the
> steps above are what a person must do instead.

## Post-Merge Cleanup (--cleanup flag)

```bash
# Remove local merged branches — one per invocation, each name bound and separated.
# Deleting is destructive, so an option-shaped name reaching git as a flag is worse here
# than anywhere else in this document; `--` after `-D` makes the name an operand.
branch=<quoted branch>
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git branch -D -- "$branch"; then
  echo "⛔ cleanup: git branch -D failed. The backup tags below are the recovery state" >&2
  echo "   for exactly this case, so they are NOT touched. STOP." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the local branch could not be deleted}"
fi

# Inspect backup tags (kept by default)
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git tag -l 'backup/pr-*'; then
  echo "⛔ cleanup: the backup tags could not be listed. The deletion below is gated on" >&2
  echo "   confirming what they are, and there is nothing to confirm. STOP." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the backup tags could not be listed}"
fi

# Remove backup tags only after confirming nothing went wrong
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git tag -d backup/pr-100 backup/pr-101 ...; then
  echo "⛔ cleanup: git tag -d failed. Some tags may be gone and some may remain, so the" >&2
  echo "   run-owned manifests below are left in place as the record. STOP." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the backup tags could not be deleted}"
fi

# Remove manifest files — the whole run-owned directory, expected and actual alike.
# The earlier per-glob removal named only the expected manifests and left the actual
# ones behind, so "cleanup" left state on disk that the next run then read as its own.
# The path is derived FIRST, with its own status checked, because `rm -rf "$(…)"` cannot fail
# here: a `rev-parse` that fails prints nothing, `rm -rf ""` returns 0 on both bash 3.2 and
# zsh 5.9 (measured 2026-08-22), and this is the fence's last command — so the manifests survive
# and cleanup reports success. The next run then reads them as its own.
MANIFEST_DIR=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --git-path epic-merge) || MANIFEST_DIR=
if [[ -z "$MANIFEST_DIR" ]]; then
  echo "⛔ the manifest directory could not be derived — nothing was removed, and the next run" >&2
  echo "   would read this run's manifests as its own. Resolve it and re-run cleanup." >&2
  SD0X_EPIC_MERGE_REFUSED=
  : "${SD0X_EPIC_MERGE_REFUSED:?refusing — the manifest directory could not be derived}"
fi
# Absolute, like every other word in this document that decides something: `rm` is claimable by
# an imported function exactly as `wc` is (§ 4.35), and this is the fence's last command, so a
# shadowed `rm` that returns 0 removes nothing and makes cleanup report success.
/bin/rm -rf "$MANIFEST_DIR"
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<epic-branch>` | Target epic branch name | Required |
| `<PR-list>` | Comma-separated PR numbers | Auto-detect from chain |
| `--dry-run` | Show plan + commands; performs one bounded local fetch — remote unchanged, but see § `--dry-run` for the local residue (objects, `FETCH_HEAD`, possible auto-maintenance) | off |
| `--per-step` | Four gates per iteration **2..N** (rebase / unshared question / push / merge); iteration 1 is unaffected — it has no rebase and no force-push | off (the unshared question plus one bundled gate) |
| `--cleanup` | Delete local branches + manifests after success | off |
| `--keep-backup-tags` | Keep backup tags even with --cleanup | off |
| `--ci-timeout <min>` | Timeout passed to `/watch-ci` | 15 |

## Examples

```bash
# Auto-detect chain into epic branch (iteration 1: one gate; iterations 2..N: unshared question + bundled gate)
/epic-merge epic/gas-account-OK-49808

# Dry-run to see plan first
/epic-merge epic/feature-xxx --dry-run

# Explicit PR list with finer per-step gates (first-time use)
/epic-merge epic/feature-xxx 100,101,102,103 --per-step

# Full cleanup after success
/epic-merge epic/feature-xxx --cleanup
```

## Prerequisites

- `gh` CLI authenticated (`gh auth status`)
- Repository uses squash-merge only (GitHub repo setting)
- All PRs in the chain are OPEN and CI passing on their current base
- Working tree clean (`git status --porcelain` empty)
- Backup tag namespace `backup/pr-*` not already in use for unrelated purposes

## Limitations

- Linear chains only (no diamond / parallel merges)
- Squash-merge repos only
- One epic branch per invocation
- CI delegation requires `/watch-ci` to be available

## Verification

- [ ] Phase 0: Chain validated as linear, all PRs OPEN, working tree clean
- [ ] Phase 1: Backup tags created from `origin/*` refs, keyed by PR number
- [ ] Phase 1: Per-PR subject-only manifests written
- [ ] Phase 2: AskUserQuestion answer recorded BEFORE the first destructive op of each iteration
- [ ] Phase 2: no push command contains the bare `--force` flag (token-level check, not substring — `--force-with-lease` is allowed); the **iteration** push carries `--force-with-lease=refs/heads/<head>:$FINAL_TIP` and no `--force-if-includes` (the flag is a documented no-op beside a lease value — § Safety), the **rollback** push carries `--force-with-lease=refs/heads/<head>:$RB_TIP` and no `--force-if-includes` either (round 75 — same reason, and § Safety records why the flag was never live on that path)
- [ ] Phase 2: `/watch-ci` invoked with `--sha <sha> --branch <head>`; PASS verdict received before `gh pr merge`
- [ ] Phase 2: Manifest `diff` exits 0 after each rebase
- [ ] Phase 3: Final epic log shows N squash commits with `(#NNN)` suffix in expected order
- [ ] No commit/push performed without an AskUserQuestion answer in the conversation transcript

## References

| File | Purpose | When to Read |
|------|---------|--------------|
| `@rules/git-workflow.md` | Push/rebase exception model (this skill is one of three exceptions) | Before any destructive op |
| `skills/smart-rebase/SKILL.md` | Single-PR squash-merge rebase pattern | Phase 2 rebase logic |
| `skills/merge-prep/SKILL.md` | Pre-merge analysis primitives | Phase 0 chain analysis |
| `skills/watch-ci/SKILL.md` | CI verdict polling — argument contract | Phase 2 Step 7 delegation |
| `skills/push-ci/SKILL.md` | AskUserQuestion gate pattern for git push | Iteration Gate Design |
