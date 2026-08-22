---
name: push-ci
description: "Push to remote and monitor CI. Validates branch safety, executes git push WITH explicit user approval, then monitors CI run status via gh CLI. Use when: user says 'push', 'push and watch CI', 'ship it', 'push-ci'. Not for: committing (use /smart-commit), creating PRs (use /create-pr), merging (use /merge-prep)."
disable-model-invocation: true
allowed-tools: Bash(git:*), Bash(gh:*), Bash(bash:*), Bash(/bin/bash:*), Read, Grep, Glob, AskUserQuestion
---

# Push & CI Monitor

Push to remote with user approval, then monitor CI run until completion.

## Authorization

```
⚠️ This skill is one of two authorized paths for Claude to execute `git push`.
⚠️ The other is /epic-merge (--force-with-lease for stacked PR chains, per-iteration AskUserQuestion gate).
⚠️ This skill may also use --force-with-lease, but only when the caller passes the flag — and NEVER onto a protected branch; bare --force is forbidden everywhere.
⚠️ All other skills and rules MUST output push commands only (not execute).
⚠️ Push REQUIRES explicit user approval via AskUserQuestion — no exceptions.
```

| Rule | This Skill | `/epic-merge` | All Other Skills |
|------|-----------|---------------|------------------|
| `git push` | Execute (after user approval) | Forbidden (uses `--force-with-lease` only) | Forbidden (output only) |
| `git push --force` | Forbidden | Forbidden | Forbidden |
| `git push --force-with-lease` | Execute — **only** when `--force-with-lease` is explicitly passed, after user approval naming the force form; **never onto a protected branch** (Phase 0 hard-aborts, Phase 2 re-asserts) | Execute (after per-iteration AskUserQuestion) | Forbidden |
| Push to protected branches (main/master/develop/release/*) | Warn + pre-approval via AskUserQuestion (final gate is the terminal hook when installed, otherwise this approval); with `--force-with-lease` → **hard abort**, no question asked | Protected PR heads rejected — Phase 0 validation, re-asserted before Step 5 and Rollback (a PR head is not inherently unprotected) | Forbidden |

## Defense in Depth: Push Safety

| Layer | Mechanism | Scope | Reliability |
|-------|-----------|-------|-------------|
| **L1: git pre-push hook** (opt-in) | `pre-push-gate.sh` reads `/dev/tty` for terminal confirmation | **Two classes reach the prompt** (since 2026-08-21): a **protected branch** with `ALLOW_PUSH_PROTECTED` unset, and a **history-rewriting push** whose rewritten refs are not already covered by that first prompt, with `ALLOW_FORCE_UNSHARED` unset. Non-fast-forward is an earlier, orthogonal refusal — this hook's own `exit 1` only when git hands it the ref (the force form); otherwise git refuses first and this hook never sees it (§ below). Skipped by `ALLOW_FORCE_WITH_LEASE=1`, after which the push falls through to the **unshared attestation first** and the protected check second — not straight to the protected check (`scripts/pre-push-gate.sh`: the refusal at the force-form check, then the rewrite gate, then the protected gate) | Immune to Claude Code permission caching — **when installed**, and only for the classes it prompts on |
| **L2: AskUserQuestion** | In-session prompt before push | All pushes | May be auto-approved by session caching |
| **L3: git-workflow rules** | Claude forbidden from raw `git push` | All contexts | Behavioral enforcement |

**Which layer authorizes depends on whether L1 is installed.** The `pre-push` hook is opt-in (`/codex-setup init --with-push-gate`, or `sync --with-push-gate` on an existing project). `/install-scripts` copies `pre-push-gate.sh` into `.claude/scripts/` and never wires up a hook, so having run it is not evidence the gate exists.

**L1 prompts for two classes of push, and they are different questions.** The **protected** prompt asks *may this branch be pushed to at all*; it fires when the ref set includes a protected branch and `ALLOW_PUSH_PROTECTED` is unset. The **unshared attestation** asks *is anybody else working on the refs this push rewrites*; it fires when the push **rewrites a ref** and `ALLOW_FORCE_UNSHARED` is unset, over the rewritten refs the protected prompt will not already cover. **Rewrite is read per ref class, because ancestry is the *branch* rule**: a branch update is a rewrite when the remote tip is not provably an ancestor of what replaces it, while **every update to an existing tag is one** — git requires force semantics for any change to an existing `refs/tags/*` ref, forward moves included, because a tag names one commit rather than a line of history (`scripts/pre-push-gate.sh` § `is_tag_ref`, and the hook prints a separate line for tags precisely because a forced tag update can be a textbook fast-forward). A tag *creation* has no history to overwrite and is not asked about, and neither is a **deletion** of any ref class — the gate's rewrite test needs a non-null OID on both sides, so removing an existing tag or branch reaches no prompt (`rules/git-workflow.md` § Push safety states the boundary; the maintainer decided on 2026-08-22 to leave it there). Reading the class as "non-fast-forward" alone would wave through exactly the moves git itself classifies as forced — which is every rewritten ref when `ALLOW_PUSH_PROTECTED=1` has silenced that prompt. Neither variable clears the other. Every push the hook **permits** without meeting either condition exits 0 (`scripts/pre-push-gate.sh`). A push the hook *refuses* is a third outcome and not a row below: it never happens, so nothing authorized it. So the gate is chosen by **both** axes, and an installed hook never demotes L2 for a push the hook does not prompt on:

| Push (one the hook permits) | L1 installed | L1 not installed |
|------|--------------|------------------|
| Protected branch, `ALLOW_PUSH_PROTECTED` unset | **L1 authorizes** — `/dev/tty` confirmation, immune to permission caching. L2 stays required but advisory | **L2 authorizes** — the AskUserQuestion in Phase 0/1 |
| History-rewriting push — a **branch** update that is **not provably a fast-forward**, read fail-closed (the gate negates `merge-base --is-ancestor`, so an ancestry test that *errors* lands here exactly as one that answers no), **or any update to an existing tag** (forward moves included) — with `ALLOW_FORCE_UNSHARED` unset | **L1 authorizes** — the `/dev/tty` unshared attestation. L2 stays required but advisory | **L2 authorizes** — and Phase 1 must put the unshared question to the user itself (below), because without the hook nothing else will |
| Every other permitted push, an ordinary fast-forward included | **L2 authorizes** — L1 exits without prompting, so there is no terminal confirmation to defer to | **L2 authorizes** |

**The tag half of that second row is a hook-level fact, not a `/push-ci` one.** This skill only ever
builds a branch refspec, so a tag update cannot arise through it. The row states it anyway because
this table describes `pre-push-gate.sh` for whoever invokes it — a developer pushing a tag by hand
meets the same gate — and because a class stated as "non-fast-forward" would be read as a complete
definition by exactly the reader who then pushes a tag from the shell.

**Non-fast-forward is an orthogonal refusal, not a third row.** It is decided *before* the protected check and never produces a confirmation of its own: without `ALLOW_FORCE_WITH_LEASE=1` the push is refused outright (`exit 1`) — by the hook when it is given the ref, by git before that when no force flag was passed, and a refusal either way is not an authorization: nothing was approved, the push simply did not happen. With the variable set the hook's refusal is skipped entirely and the push falls through to the **same** protected-branch decision as any other. So it lands in whichever row its branch puts it in. Measured, all five shapes — **these are hook-level facts, describing `pre-push-gate.sh` for whoever invokes it**:

| Push | `ALLOW_FORCE_WITH_LEASE` | Result | Reachable via `/push-ci`? |
|------|--------------------------|--------|---------------------------|
| Unprotected, non-fast-forward, **no force flag** | unset or empty | **git** rejects the ref client-side; the hook runs with an **empty ref list** and exits 0 having never seen the branch | **Yes** — a flagless `/push-ci` on a diverged branch. The gate refused nothing here |
| Unprotected, non-fast-forward, `--force-with-lease` | unset | `exit 1` — the hook's own refusal, before the protected check, no prompt | **No** — Phase 2 sets the variable in the same branch that passes the flag. Only a manual force push reaches this cell |
| Unprotected, non-fast-forward, `--force-with-lease` | `1` | Reaches `/dev/tty` for the **unshared attestation** — the force row above, L1 authorizes. `exit 0` only once attested (or with `ALLOW_FORCE_UNSHARED=1`); no terminal ⇒ `exit 1` | **Yes** — this is the one force path this skill has |
| **Protected**, non-fast-forward, `--force-with-lease` | `1` | Reaches `/dev/tty` once — the protected prompt; the attestation excludes refs that prompt covers | **No** — Phase 0 hard-aborts protected × `--force-with-lease` before any question, and Phase 2 re-asserts it. Only a manual `git push --force-with-lease` reaches this cell |
| **Protected**, non-fast-forward, `--force-with-lease`, **`ALLOW_PUSH_PROTECTED=1`** | `1` | Reaches `/dev/tty` for the **unshared attestation** — the protected prompt is silenced, so the rewritten ref is no longer excluded from it | **No** — this skill never sets `ALLOW_PUSH_PROTECTED`. Only a manual push reaches this cell, and it is the combination that used to pass in total silence |

**Row 1 exists because git does not hand the hook a ref it has already rejected.** Measured on git 2.55.0 with a hook that dumps its stdin: a flagless push of a diverged branch runs the hook with **zero** ref lines — so `pre-push-gate.sh` finds no branches, detects no non-fast-forward, prompts on nothing and exits 0 — and the `! [rejected] … (non-fast-forward)` that stops the push is git's. Add `--force-with-lease` to the same push and the hook receives the ref line and its own refusal fires. Two consequences: the hook's non-fast-forward `exit 1` is reachable **only** on a push carrying a force flag, and a flagless `/push-ci` that fails on a diverged branch was stopped by git, not by the gate. Reading row 1 as a gate refusal would credit a credential to an operation no gate ever saw — the same error in the same direction as reading an absent hook as "no approval needed".

**The last column is the part a reader of this skill needs, and it is why the table is not just the hook's.** Three of the five shapes cannot happen through `/push-ci` at all: describing them as this skill's paths would promise a terminal confirmation on a route the skill refuses to take. The hook-level facts stay documented because the developer who pushes by hand still meets them.

The trap in both directions: grouping non-fast-forward *with* protected pushes claims a terminal credential for a push that is merely refused, and grouping it *against* them denies one for the third shape, where the terminal prompt genuinely happens — for a manual caller.

Reading "the hook is installed" as "something stronger will always ask" is the error this table exists to prevent — and **the table cannot supply its own counter-example**, because every cell in it either refuses the push or reaches `/dev/tty`. Rows 1 and 2 are refusals: the push does not happen, so nothing authorized anything. Rows 3–5 all prompt, so with the hook installed L1 is the credential there. The pushes whose **only** credential is the in-session approval are precisely the ones this table does not contain: every permitted push in neither prompting class — the row above it — and every push at all when the hook is not installed. Generalizing "installed ⇒ prompted" from these five rows is getting the wrong rule from the one table where it happens to hold.

**And the "L1 installed" column is a state of the world, not something Phase 0 can establish.** What Phase 0 reads is whether an executable hook *references* the gate — `PUSH_GATE=referenced`, never `installed` — and reference cannot prove invocation: a script that merely names the gate in a live command satisfies the same test. So the demotion in the top-left cell is earned by the operator **seeing the `/dev/tty` prompt**, never by the detection predicting one: if the approval is given and no prompt appears, that in-session approval was the only approval, whatever `PUSH_GATE` reported. This is why the approval is unconditionally required rather than skipped when L1 looks present — the check is allowed to be wrong in the unsafe direction precisely because nothing is skipped on its word.

**Why AskUserQuestion is the weaker of the two**: session permission caching can auto-approve AskUserQuestion calls in long-running sessions, especially with `-c` continue mode (GitHub Issue #15400). That weakness is the reason L1 is worth installing — it is **not** a licence to push without approval when L1 is absent. An uninstalled gate lowers the strength of the authorization; it never removes the requirement for one.

## Workflow

```mermaid
sequenceDiagram
    participant C as Claude
    participant U as User
    participant GH as GitHub

    C->>C: Phase 0: Preflight
    alt Protected branch + --force-with-lease
        C->>U: ⛔ Hard abort — prohibited combination, no question asked, no push
    else Permitted combination
        opt Protected branch (plain push)
            C->>U: ⚠️ Warning + ask pre-approval
            U->>C: Continue / Abort
        end
        C->>U: Phase 1: Show push plan + ask approval
        U->>C: Approve / Reject
        alt Approved
            C->>C: Phase 2: Protected×lease guard + command assembly
            C->>GH: Execute git push
            C->>GH: Phase 3: Delegate to /watch-ci
            GH-->>C: CI verdict
        else Rejected
            C->>U: Abort (no push)
        end
    end
```

### Phase 0: Preflight

Run all checks. Hard-abort on infrastructure failures; warn-and-confirm on protected branches — except protected branch × `--force-with-lease`, which hard-aborts (prohibited combination, see step 0 below).

```bash
# 0. Bind the two flag variables from THIS invocation, before anything reads them.
# Write the literal value on each line: `true` only when that flag appeared in the
# /push-ci invocation, `false` otherwise. Both lines are always written, always in
# this order, and never guarded by `:=`, `-z` or `[ -n … ]` — a guard would let an
# inherited environment value survive, which is the entire defect this step closes.
# Measured: with these two unbound and an ambient `FORCE_WITH_LEASE=true` exported,
# the Phase 2 assembly below runs `git push --force-with-lease=refs/heads/<b>:<tip>`
# for an invocation that passed no flag and a plan that showed a plain push. The
# approval must name the force form (`rules/git-workflow.md` § Exception), so the
# form has to come from the arguments and from nothing else.
FORCE_WITH_LEASE=false   # `true` only if the invocation contained --force-with-lease
SET_UPSTREAM=false       # `true` only if the invocation contained --set-upstream
# ── Step 0a: the interpreter, before anything else ────────────────────────────
# First, because every check below is only as good as the shell running it. A non-interactive bash
# SOURCES `$BASH_ENV` before line 1 of this fence; zsh does the same with `$ENV` under sh
# emulation. A sourced file may define a function whose name contains a slash — bash refuses to
# IMPORT such a name from the environment, which is why the prefix is spelled absolutely, but it
# does not refuse to DEFINE one. Measured 2026-08-22, bash 3.2.57 and zsh 5.9: with
# `function /usr/bin/env { …; }` defined, the word `/usr/bin/env` resolved to the function and the
# child never ran. Every reading this phase prints, and the destination this phase digests for
# the approval, would then be whatever that function chose to say.
#
# **This block contains no command word, and that is the design.** Two `[[ ]]` tests (a keyword the
# parser resolves — a function cannot outrank it), three assignments (syntax, not commands), one
# expansion. Round 65 rewrote it after measuring the two ways the first version failed:
#   * it read its sentinel without resetting it, so an exported `SD0X_PUSH_CI_REFUSED=1` satisfied
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
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — ${SHELL_STARTUP_INHERITED} is set in this environment.
   That startup file is sourced before line 1 of this fence and can redefine the commands below,
   including the absolute /usr/bin/env prefix (measured). Nothing this phase reports could then be
   relied on, and the in-session approval is the only credential where the opt-in pre-push hook is
   not installed. Unset it and re-run. Nothing is planned and nothing is pushed.}"
fi

# 0b. Transport variables decide WHERE git’s traffic goes — which repository is read from and
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
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — transport variables set in this environment}"
fi

# 1. Current branch
BRANCH=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --abbrev-ref HEAD)

# 1b. Detached HEAD, **or no branch name at all** — hard-abort. On a detached HEAD the command
# above returns the literal string `HEAD`, which is not a branch name; when it *fails* it returns
# nothing, which is not one either, and the empty case was the one this check could not see.
# Every later step treats $BRANCH as a branch name: the protected-branch match below compares it
# against main/master/develop, the upstream probe builds `origin/$BRANCH`, and the push builds a
# branch refspec — so an empty one silently compares against nothing and builds `origin/`. The
# same refusal is already carried in Phase 1; Phase 0 is where the plan is built, so it belongs
# here first.
if [[ -z "$BRANCH" ]] || [[ "$BRANCH" = "HEAD" ]]; then
  echo "⛔ Phase 0: no branch name here — detached HEAD, or rev-parse failed. /push-ci pushes a" >&2
  echo "   named branch, and every check below names it. Nothing is planned and nothing is pushed." >&2
  # Not `exit`: a builtin is outranked by an imported `BASH_FUNC_exit%%`, and this arm sets no
  # flag a later step reads, so a shadowed `exit` would leave the whole phase running on a
  # branch name that is not one.
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — no branch name could be derived in Phase 0}"
fi

# 2. Protected branch detection
# If main, master, develop, or release/* → warn + AskUserQuestion pre-approval
# (do NOT hard-abort; let user decide) — EXCEPT when --force-with-lease was passed:
# that combination hard-aborts, because force push to shared branches is prohibited
# (rules/git-workflow.md § Prohibited) and no approval can authorize it

# 3. Remote exists. The status is CAPTURED and acted on, not discarded: this line used to
# run bare with `>/dev/null 2>&1`, so a failing `ls-remote` left `$?` for the next command
# to overwrite and the fence reported a normal-looking preflight for a remote that does not
# resolve. The table below calls this an Abort, and an abort a later step cannot see is a
# table row nothing implements.
# No `--exit-code`, and that is the whole question this check asks. Measured 2026-08-22
# against a local bare repo: `--exit-code` returns 2 for a remote that answered and simply
# has no refs yet, 128 for one that could not be reached — one status for "reachable and
# empty", another for "not there", and the flag conflates the first with a failure. An
# empty remote is the first push of a new repository, which is a case /push-ci exists for.
# Without the flag the two separate: 0 reachable (refs or not), 128 unreachable.
if ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack origin >/dev/null 2>&1; then
  echo "⛔ remote 'origin' did not answer — check the remote, or that you can reach it" >&2
  # Same terminator class as step 1b: no flag is set here, so `exit` alone is the whole refusal.
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — remote 'origin' did not answer}"
fi

# 4. Working tree status. The status is checked, not merely printed: Phase 0's contract is to
# hard-abort on infrastructure failure, and a `git status` that fails prints nothing — which
# reads exactly like a clean tree to whoever is about to approve a push plan built from it.
/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git status --short || {
  echo "⛔ Phase 0: the working tree could not be read. The plan below would describe a tree" >&2
  echo "   nobody looked at. Nothing is planned and nothing is pushed." >&2
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — the working tree could not be read}"
}

# 5. Commits ahead of remote. Two steps, never `… 2>/dev/null || echo "new branch"`: that form
# cannot tell "there is no remote-tracking ref" from a `rev-list` that fataled on a corrupt or
# unreadable object — it discards the diagnostic, prints the reassuring reading and exits 0, in a
# phase whose stated contract is to hard-abort on infrastructure failure. Existence is asked
# first, and only a ref that exists but cannot be counted is an error. Fully qualified for the
# reason § Names in commands gives: `origin/<name>` is DWIM and git resolves `refs/tags/` before
# `refs/remotes/`, so a tag named `origin/feat/x` would answer this range in place of the branch.
# The status is CAPTURED and switched on, never negated. `git rev-parse --verify --quiet` exits
# 1 for a ref that is absent and 128 for a repository or lookup failure, and `if !` collapses
# the two into one branch — so an unreadable repository prints "new branch" and this phase
# continues, in a phase whose stated contract is to hard-abort on infrastructure failure. It is
# the same fail-open shape the note above rejects one level out, pointing the same way: the
# collapsed reading is the reassuring one, which is why nobody notices it.
# `if` rather than a following `VERIFY_STATUS=$?` line: under an inherited `errexit` the shell
# aborts AT the lookup, so exit 1 — the ref genuinely is not there, which is this phase's
# ordinary new-branch case — would never reach the arm below that reports it. A command whose
# status the `if` consumes is not one `set -e` acts on.
if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null; then
  VERIFY_STATUS=0
else
  VERIFY_STATUS=$?
fi
case "$VERIFY_STATUS" in
  1)
    echo "new branch (no refs/remotes/origin/${BRANCH})"
    ;;
  0)
    if COMMITS_AHEAD=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-list --count "refs/remotes/origin/${BRANCH}..HEAD" --); then
      echo "${COMMITS_AHEAD}"
    else
      echo "⛔ Phase 0: refs/remotes/origin/${BRANCH} exists but the commits-ahead count could" >&2
      echo "   not be read. That is a repository failure, not a new branch, and the two need" >&2
      echo "   opposite responses. Nothing is planned and nothing is pushed." >&2
      SD0X_PUSH_CI_REFUSED=
      : "${SD0X_PUSH_CI_REFUSED:?refusing — the commits-ahead count could not be read}"
    fi
    ;;
  *)
    echo "⛔ Phase 0: refs/remotes/origin/${BRANCH} could not be looked up — git exited" >&2
    echo "   ${VERIFY_STATUS}, which is a repository or lookup failure and not an absent ref." >&2
    echo "   Reading it as a new branch would plan a push against a repository nothing read." >&2
    SD0X_PUSH_CI_REFUSED=
    : "${SD0X_PUSH_CI_REFUSED:?refusing — the remote-tracking ref could not be looked up}"
    ;;
esac

# 5b. --set-upstream auto-detect. This may only ever turn SET_UPSTREAM ON: `-u` on a
# branch that already has an upstream is a no-op, while dropping a requested `-u`
# would silently change what the plan promised. It runs after step 1b, so a detached
# HEAD has already aborted rather than reaching an `@{u}` probe that cannot mean
# anything there.
if [[ "$SET_UPSTREAM" != "true" ]] &&
   ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  SET_UPSTREAM=true
fi

# 6. Local HEAD SHA (for CI run matching later). Checked for the same reason as step 4, and with
# a sharper consequence: this value is what the approval names and what `/watch-ci` is later sent
# after. A failed lookup makes it empty, and an empty `HEAD_SHA` in the plan is a plan the
# operator cannot approve meaningfully. Phase 2 re-derives and compares, so this is not a route to
# an unsafe push — it is an approval collected for a plan that was never valid.
HEAD_SHA=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse HEAD) || HEAD_SHA=
if [[ -z "$HEAD_SHA" ]]; then
  echo "⛔ Phase 0: HEAD could not be resolved. The push plan names the commit being pushed;" >&2
  echo "   an empty one is not a plan. Nothing is planned and nothing is pushed." >&2
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — HEAD could not be resolved}"
fi

# 7. pre-push gate detection — reports whether a hook referencing the gate exists.
# It informs how the push plan describes the credential; it never decides one, for
# the reason spelled out below: reference is not invocation.
# --git-path resolves core.hooksPath (and therefore Husky, which sets it), so a
# hook installed in any of the modes /codex-setup supports is found here.
# Existence is not enough: an unrelated pre-push hook (lint, test runner, a Husky
# shim that never sources the gate) is executable too, and reporting it as the
# terminal credential would promise a /dev/tty prompt that never comes.
# Comment lines are excluded before matching, because a disabled gate keeps its
# name in the file — `# pre-push-gate disabled during migration` followed by
# `exit 0` is executable, mentions the gate, and prompts for nothing.
# What this predicate establishes is *reference*, not invocation — and no static
# check of a shell script can establish invocation. `printf pre-push-gate >/dev/null`
# satisfies it and runs nothing. So the result is evidence, never proof, and the
# consequence is bounded below: an approval is required in every case, and L2 is
# demoted to advisory by the operator SEEING the terminal prompt, not by this check
# predicting one (see the note under the push-class table).
# This detection reads only THIS file and does not follow indirection:
# a Husky shim that execs a second script naming the gate reads as `absent`. That
# is the safe direction and the reason the whole check is written to fail toward
# it — an under-claimed credential costs one extra confirmation, an over-claimed
# one manufactures an approval nobody gave.
# Wrapped in an ABSOLUTE `/bin/bash -c` so the compound command matches this skill's
# allowed-tools (`Bash(/bin/bash:*)`, granted alongside `Bash(bash:*)` for this line); a bare
# `grep` here is outside the grant (see the Footguns table in CLAUDE.md). The absolute spelling
# is not cosmetic. The body below already runs `/usr/bin/grep` and `/bin/echo` for exactly one
# reason — every bare word is claimable by an imported function — and a bare `bash` wrapping
# them is that same hole one level up, where it swallows the whole probe rather than one word
# of it: an imported `BASH_FUNC_bash%%` never runs the body at all and prints what it likes.
# `PUSH_GATE=referenced` forged that way makes the push plan promise the operator a `/dev/tty`
# prompt that no hook is going to show.
PUSH_GATE=$(/bin/bash -c '
  hook="$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --git-path hooks)/pre-push"
  # Absolute paths, and `echo` included: the stdout of this subshell IS `PUSH_GATE`, and every
  # word here is claimable by an imported function — `grep` and `echo` alike, since function
  # lookup precedes both the builtins and PATH. The probe selects no credential, but it decides
  # what the push plan tells the operator to expect. (No apostrophes in this block: it is the
  # body of a single-quoted `bash -c`, so one would close the string.)
  if [[ -x "$hook" ]] && /usr/bin/grep -v "^[[:space:]]*#" "$hook" 2>/dev/null | /usr/bin/grep -q "pre-push-gate"; then
    /bin/echo referenced
  else
    /bin/echo absent
  fi
')

# 8. The effective push destination. `origin` is a name, not a destination: it can
# carry one URL for fetching and another for pushing, and `pushurl` is multi-valued,
# so the push may fan out. Derived HERE, in the same shell as the steps above and
# before the first question is asked — the protected-branch pre-approval below and
# the Phase 1 plan both name it, and Phase 2 refuses when it no longer matches.
# Until round 49 the only pre-approval derivation lived inside Phase 1's
# `--force-with-lease` branch, so an ordinary push reached that comparison with a
# value no approval had shown; round 50 moved it in here, because a value assigned
# in a fence of its own dies with that fence (see Phase 2 on separate shells).
if PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git remote get-url --push --all origin); then
  PUSH_URL=${PUSH_URLS%%$'\n'*}
else
  PUSH_URLS=; PUSH_URL=
fi
# 7c. `--force-with-lease` × a fan-out destination: refuse HERE, before any question is asked.
# A `url.<x>.pushInsteadOf` rewrite is NOT a way in, and the earlier draft said it was: git applies
# the single longest matching prefix, so a rewrite maps one URL to one URL, and where an explicit
# `remote.<name>.pushurl` exists `pushInsteadOf` is not consulted for that remote at all.
# `"$PUSH_URLS" != "$PUSH_URL"` is this document's own idiom for "more than one" (the two lines
# below say why it is exact). A FAILED derivation leaves both empty and equal, so it is not this
# row — that one is fail-closed downstream, where the destination guard compares the digest.
if [[ "$FORCE_WITH_LEASE" == "true" ]] && [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then
  echo "⛔ --force-with-lease with more than one push destination — refusing before asking." >&2
  echo "   'origin' resolves to a fan-out: remote.origin.pushurl is multi-valued, or — with no" >&2
  echo "   pushurl configured — remote.origin.url is. A lease is measured against ONE" >&2
  echo "   remote tip, so the topology re-check before the push cannot say what each destination" >&2
  echo "   would be rewritten from — it reads 'unknown' and refuses. That refusal is correct;" >&2
  echo "   asking you to approve the push first is not." >&2
  echo "   Push the rewrite one destination at a time, naming each URL explicitly, so each one" >&2
  echo "   gets its own lease and its own answer to who else holds ${BRANCH}." >&2
  # Not `exit 1`: measured 2026-08-22, an imported `BASH_FUNC_exit%%` that returns leaves the
  # refusal printed and execution continuing into the report and the approval. Assign-then-expand,
  # as in step 0a — syntax and an expansion, nothing a function can outrank. The `echo`s above are
  # shadowable too; that costs the message, not the refusal, which is the right way round.
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — --force-with-lease with more than one push destination}"
fi

# Anything but exactly one URL is the fail-closed row, not a benign one. $(...) strips trailing
# newlines, so one URL leaves none and "$PUSH_URLS" != "$PUSH_URL" is precisely "more than one".
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
# 9. Report everything above. Each fence is a separate shell, so a value assigned here and
# not printed here reaches nobody — not the Phase 1 plan, not the questions, not Phase 2's
# re-derivation check. Until round 52 this block printed `PUSH_URLS_SAFE` alone, and every
# other line above was a value only this fence ever saw: the plan then named a branch, an
# upstream decision, a HEAD and a gate state that the model had to supply from somewhere
# else, which is the same failure as deriving them in a fence of their own. One field per
# line, name first, value bracketed — brackets so an empty value is visible as `[]` rather
# than as a line that looks truncated.
# 8b. The binding key, round 54. `PUSH_URLS_SAFE` is what a HUMAN reads, and redaction is lossy
# by design — it deletes the whole query and fragment. Two different repositories therefore
# redact to one string: `https://gw.example/push?repo=A&token=one` and `…?repo=B&token=two` both
# become `https://gw.example/push?<redacted>` (measured). Comparing THAT in Phase 2 binds the
# approval to a host and a path, not to a destination, so a `.git/config` edit between approval
# and push moves the push to another repository and the guard passes.
# So identity travels as a digest of each RAW URL, and the redaction is what a human reads. The
# digest IS printed — on the line below, in the plan, and by the gate when it refuses — so the
# honest claim is not "nothing is displayed" but that a SHA-256 preimage is not recoverable from
# it. What it does leak is equality: two transcripts carrying the same digest pushed to the same
# destination, and a guessable URL can be confirmed offline. Both are accepted; neither is a
# reason to show the raw URL instead, which would leak the credential itself.
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
/usr/bin/printf 'BRANCH=[%s]\nSET_UPSTREAM=[%s]\nFORCE_WITH_LEASE=[%s]\nHEAD_SHA=[%s]\nPUSH_GATE=[%s]\nPUSH_URLS_SAFE=[%s]\nPUSH_URLS_DIGEST=[%s]\nPUSH_RECEIVEPACK_SET=[%s]\n' \
  "$BRANCH" "$SET_UPSTREAM" "$FORCE_WITH_LEASE" "$HEAD_SHA" "$PUSH_GATE" "$PUSH_URLS_SAFE" "$PUSH_URLS_DIGEST" \
    "$PUSH_RECEIVEPACK_SET"
```

| Check | Pass | Fail |
|-------|------|------|
| Branch is not protected | Continue | With `--force-with-lease` → **Abort** (prohibited combination); otherwise **Warn + AskUserQuestion** (see below) |
| Remote exists | Continue | Abort: "No remote 'origin' configured" |
| Has commits ahead | Continue | Abort: "Nothing to push (0 commits ahead)" |
| `--force-with-lease` resolves to exactly one push destination | Continue | **Abort** (step 7c), before the plan and before any question. A lease is measured against one remote tip, so the topology re-check in Phase 2 can only read a fan-out as `unknown` and refuse. Refusing here changes which push is possible not at all — it changes *when the operator finds out*, and stops an approval being collected for a push that was never going to run |
| `PUSH_RECEIVEPACK_SET` is `no` | Continue | **Abort**: "remote.origin.receivepack is configured — the destination this plan shows is not the one the objects reach". Measured 2026-08-22: a configured receivepack sent every object into a different repository while git printed `To <the approved URL>`. The report says only whether it is set, never the value: it is a command line, so it can carry a token, and `rules/security.md` forbids logging those. Read it with `git config --get remote.origin.receivepack` |
| `pre-push` hook references the gate | Note `PUSH_GATE=referenced` — a hook referencing the gate was found; for protected-branch pushes and for history-rewriting pushes (the two classes it prompts on) expect a terminal confirmation, and treat its **absence at push time** as evidence the detection over-claimed | Note `PUSH_GATE=absent` — **not an abort**, and **not a finding that no gate exists**: the probe reads one file and does not follow indirection, so a Husky shim that execs the gate reads `absent` while the gate is installed |

`PUSH_GATE` is reported to the user, never acted on silently, and **it never selects the credential**
(`@rules/git-workflow.md` § Push safety). Report the observed fact and let the push decide:
`absent` means *no direct reference was found in this file*, not *no terminal credential exists*. For
a protected-branch push, say so in both directions — if a `/dev/tty` prompt appears, that prompt is
the terminal authorization and this in-session approval was advisory; if none appears, this approval
was the only one there will be. Either way the approval is required first. Detection is a **read**, and this skill never installs the hook — installing is `/codex-setup`'s opt-in, and a push flow that quietly armed a gate would be making that choice for the developer mid-push.

`PUSH_URLS_SAFE` is the redacted destination every later step reads. The brackets bound it because
more than one line inside them means the push fans out to several repositories — say so wherever it
is shown. Empty brackets mean the destination could not be resolved, which is not a reason to
proceed quietly: say that too, and let Phase 2's comparison refuse rather than inventing a value.
A push URL may carry `user:token@`, so the raw value never leaves the shell — see § Redaction.

**Protected branch pre-approval flow** — advisory where the terminal hook is installed, and the authorization itself where it is not:

When branch is `main`, `master`, `develop`, or `release/*`:

0. **`--force-with-lease` hard-aborts here — no question is asked.** Force push to
   shared branches is prohibited (`rules/git-workflow.md` § Prohibited), and this
   skill reads the **protected set as the decidable part of the shared set** — a
   deliberate reading, not a definition the rules supply. No rule enumerates "shared":
   it is a fact about who else has the branch, which nothing here can observe. The
   protected names are the branches that are shared *by construction*, and they are
   the only ones a preflight can decide from the ref alone, so refusing there is the
   conservative half of an undecidable question.

   **What that used to leave open, and what now closes it** (2026-08-21, option A): a
   feature branch two people are working on is shared too, and no preflight can decide
   that from the ref. It is decided by asking. `pre-push-gate.sh` refuses any force-form
   push whose targets include a non-protected branch unless the operator attests they are
   unshared — `ALLOW_FORCE_UNSHARED=1`, or `yes` at its `/dev/tty` prompt. **This skill must
   never set that variable** (see § Prohibited), so where the hook is installed the
   attestation is the operator's and is immune to session caching; where it is not, the
   Phase 1 AskUserQuestion is the only approval there will be and must name the force form.
   The residual hazard is what an attestation cannot reach — the operator answering `yes`
   about a branch someone else does hold — and the lease is weaker than it looks:

   - **Overwrite** — narrowed, not closed, and it is worth being exact about which
     slice the flags cover. `--force-with-lease` with no `=<refname>:<expect>` value
     takes the local remote-tracking ref as its expectation, and `git-push(1)` is
     explicit that this form "interacts very badly" with anything running `git fetch`
     in the background and that the protection is "trivially defeated" when those refs
     are updated. Measured: a collaborator's commit fetched but never seen locally is
     **overwritten with exit 0** under the bare form, and rejected with exit 1 once
     `--force-if-includes` is present — which is why Phase 2 passed both until round 75.

     But `--force-if-includes` asks whether the remote tip is reachable from **any
     reflog entry of the local branch**, not whether the history being pushed still
     contains it. Measured on the same remote: fetch the collaborator's commit, move
     the local branch onto it, then rewrite to a history that drops it — the reflog
     still holds it, the check passes, and the push **overwrites it with exit 0**.
     `/push-ci` runs after whatever rewrite the operator just performed, so that is not
     a theoretical ordering. **What the pair closed was the fetch race** — and only the
     half of it where the operator had never held the fetched commit.

     **Round 75 replaced the pair with a lease carrying a value.** The defect the pair
     left open is not an exotic one: the fence a few hundred lines below *measures* the
     remote tip and classifies the push against it, and the bare lease then expresses a
     **different** expectation, resolved later, from a ref anything may move. Measured
     end to end (git 2.55.0) — classifier reads `C`, a collaborator publishes divergent
     `D`, a background fetch moves the tracking ref to `D`, and `D` sits in the branch
     reflog because the operator once committed `D` on this branch and reset it away
     (committing writes the branch's **own** reflog, which is the one the flag reads;
     a plain checkout of a branch that does not move writes only HEAD's):
     the shipped pair published
     over `D` with exit 0 while the only topology anyone saw said `fast-forward`. The
     same tree with `--force-with-lease=refs/heads/<b>:<C>` was rejected `(stale info)`.
     So Phase 2 now passes the classified tip as the lease value and drops
     `--force-if-includes`, which git documents as a no-op beside one (measured: the
     combination succeeds exactly where the value alone refuses). What still cannot be
     proved on the push side is that the outgoing history *preserves* the remote tip —
     the lease binds the destination, not the shape of what replaces it.
   - **Disruption** — not addressed, by any flag. Rewriting history under someone with
     that branch checked out is unaffected by any lease form, and no push-side check
     can see it.

   **Why adding that flag was not an Anchor change.** The first reading here was that
   Register #4 names the form `git push --force-with-lease`, so any other flag needs a
   fresh grant. That inverts the anchor. What #4 freezes is its *exception list* —
   which workflows may push, and the attribution whitelist — not every flag on an
   authorized command; the grant already runs with `-u`, `--`, a remote and a ref.
   `--force-if-includes` adds only a rejection condition, so it strictly narrows what
   the granted command can do. Refusing it on anchor grounds would use a rule that
   exists to prevent unsafe pushes as the reason to keep one.

   So what remains open on a shared feature branch is disruption in full, plus the
   slice of overwrite the reflog check cannot see. Their controls are what they always
   were, and they are both human: the operator passing the flag per invocation, and an
   approval that names the force form.

   An AskUserQuestion approval cannot authorize a prohibited action, so none is
   offered: abort with
   `⛔ --force-with-lease targets protected branch <branch> — force push to shared branches is prohibited`
   and suggest landing the rewrite on a feature branch instead (`/epic-merge` owns the
   one lawful lease-force flow — and it, too, rejects protected PR heads before every
   push, because "PR head" is not proof of "not protected"). Phase 2's
   command assembly re-asserts this refusal, so a flow that skipped preflight still
   cannot execute the combination.
1. Show warning with branch name and commit count, and state what the hook detection found — a referencing hook, or none — rather than promising which gate will run
2. Use AskUserQuestion with options:
   - "Continue — push to `<branch>`" — proceed to Phase 1
   - "Abort" — stop immediately
3. If user aborts → stop. If user continues → proceed to Phase 1 (push approval asked separately). Where the `pre-push` hook is installed, it will still require terminal confirmation via `/dev/tty` as the final authorization gate — a claim that holds **here specifically** because this whole flow is scoped to protected branches — **one of the two** classes the hook prompts on, the other being a push that is **not provably a fast-forward** with `ALLOW_FORCE_UNSHARED` unset — read fail-closed and per ref class, so an ancestry test that *errors* lands there exactly as one that answers no, every update to an existing tag lands there whatever ancestry says, and creations, deletions and unchanged refs land in neither prompt at all (`rules/git-workflow.md` § Push safety) — and because Phase 2 clears `ALLOW_PUSH_PROTECTED` so the bypass cannot be inherited; where it is not installed, this approval and the Phase 1 approval are the only ones there will be — which is a reason to present them accurately, not a reason to skip them.

### Phase 1: Push Plan + User Approval

Present push summary and **ask user for explicit approval** using AskUserQuestion:

```markdown
## Push Plan

- Branch: `<branch>`
- Remote: `origin` → `<the effective push destination — the `PUSH_URLS_SAFE` value Phase 0 step 8 derived and printed, never the raw one: a push URL may carry `user:token@` and this line goes into the approval transcript>`. Show the destination, not just the remote name: `origin` can name a different URL for fetching than for pushing (an explicit `remote.origin.pushurl`, or a `url.<x>.pushInsteadOf` rewrite), and the name alone cannot tell the approver which repository is about to change. More than one URL means the push fans out to all of them — say so
- Commits: <N> ahead
- HEAD: `<the full object ID from Phase 0 step 6 — whatever width `git rev-parse HEAD` returned, not an abbreviation>`. Phase 2 re-derives it and refuses the push if it no longer matches, so this line is what that comparison is made against: shown short, it would either compare short (and pass on a prefix collision) or compare against a value the user never saw
- Overwrites: `<on a `--force-with-lease` push whose Phase 0 step 8 reading is `rewrite`: the full `REMOTE_TIP` object ID that step printed — the commit on the remote this push replaces. On every other reading: `nothing (<the ASK_REASON word>)`>`. **This line is why the plan can be reused as a comparison at all.** Phase 2 re-measures the remote and refuses when the answer differs from what is written here, exactly as it does for `HEAD:` above — and without the line there is nothing to compare against, so an approval given for destroying one commit would silently carry to a push destroying another. Full object ID, for the same reason `HEAD:` is: a prefix can collide, and a value shown short is not the value compared. `nothing` is a measurement too, not a blank — a reading of `rewrite` that appears only at Phase 2 is a topology change the approval never described, and it is refused there
- Push gate: state the **probe result and its limits**, never a credential verdict — `pre-push` hook found referencing the gate / **no direct reference found in the hook file (the probe does not follow indirection, so a gate reached through a shim would read this way too)**. Then, for a protected-branch push: if a `/dev/tty` prompt appears it is the terminal authorization and this approval was advisory; if none appears, **this approval is the only one there will be**

Command to execute: `<the exact command Phase 2 will run, flags included>`

When `--force-with-lease` was passed, the plan **must** show it, the `Overwrites:` line **must**
carry the measured tip, and the approval option **must** say so.
Two steps, and the second is the one this round added: approving `git push origin feat/x` is not approval of a history rewrite,
and approving a history rewrite in the abstract is not approval of destroying the particular commit
that is there.
```

**Gate**: Use AskUserQuestion with options:
- "Approve push" (or "Approve **force**-with-lease push to `<branch>`" when the flag is set) — proceed to execute
- "Abort" — stop, do not push

**When `--force-with-lease` was passed, ask a second and separate question first — the unshared
attestation** (2026-08-21, option A of
`docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`):

**First establish whether this push rewrites anything at all.** `rules/git-workflow.md` § Push
safety measures the **topology, not the declared flag** — "a `--force-with-lease` that turns out to
be an ordinary fast-forward rewrites nothing and is not asked about" — and that is the same test the
hook applies at `/dev/tty`. A prompt that asserts a rewrite the push does not perform trains the
operator to answer past a question that is usually wrong, which is how the one that matters gets
answered the same way:

```bash
# Bound HERE, not inherited. Phase 0 says every fence is a separate shell, and this one reached
# `"refs/heads/$BRANCH"` with nothing binding `BRANCH` in it. Unset, that refspec is
# `refs/heads/` — the exact-ref lookup returns no line, `REMOTE_TIP` is empty, and the classifier
# below reads `ASK_REASON=creation`: a push that rewrites `feat/x` skips the unshared question
# entirely. The failure is silent in the only direction that matters, because "creation" is also
# the honest answer for a genuinely new branch.
BRANCH=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --abbrev-ref HEAD)
if [[ -z "$BRANCH" ]] || [[ "$BRANCH" == HEAD ]]; then
  echo "⛔ Phase 1: the branch name could not be derived here (detached HEAD, or rev-parse failed)." >&2
  echo "   Every classification below names refs/heads/\${BRANCH}; an empty one asks about" >&2
  echo "   refs/heads/ and answers 'creation'. Nothing is planned and nothing is pushed." >&2
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — the branch name could not be derived in this fence}"
fi
# No pipe, and no `awk`. Both are deliberate, and each closes a defect this block shipped with for
# one round: a pipeline reports the status of its LAST command, so `git ls-remote … | awk …`
# exits 0 when `ls-remote` fails — measured `rc=0 tip=<>` against a nonexistent remote — which is
# byte-for-byte the "branch does not exist" reading below, and the fail-closed row underneath it
# became unreachable. A bare `awk` is a second hole in the same line: this classifier decides
# whether an attestation is collected, and an imported `BASH_FUNC_awk%%` answering it emits an
# empty tip from real output. `${x%%<tab>*}` is a parameter expansion — no command, nothing to
# shadow — and the exact `refs/heads/` refspec means at most one line comes back.
# And it probes the **push destination**, not `origin`. A remote can name two different URLs, and
# the push uses the one a probe of `origin` does not read. Measured, both mechanisms:
#
#   remote.origin.pushurl set          ls-remote --get-url origin -> FETCH url; push contacts pushurl
#   url.<x>.pushInsteadOf, no pushurl  ls-remote --get-url origin -> FETCH url; push contacts rewrite
#
# In both, `git remote get-url --push --all origin` returned exactly what the push contacted, so it
# is the oracle and `origin` is not. A probe reading the fetch URL classifies repository A as a
# creation or a fast-forward and the push then rewrites repository B — with no attestation ever
# collected for the repository that actually changed. L1 is opt-in, so that skipped question can
# be the only attestation layer there was.
#
# `--all`, never the singular form: `pushurl` is multi-valued and git pushes to every one of them,
# while `get-url --push` returns only the first — the reading that makes a fan-out look like a
# single destination. Anything other than exactly one URL is the fail-closed row, not a benign one.
# The count is a parameter expansion for the same reason the field split is: `$(...)` strips
# trailing newlines, so one URL leaves no newline and PUSH_URLS != PUSH_URL is exactly "more than
# one" — no `wc`, no `grep`, nothing an imported function can answer.
if PUSH_URLS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git remote get-url --push --all origin); then
  PUSH_URL=${PUSH_URLS%%$'\n'*}
else
  PUSH_URLS=
  PUSH_URL=
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
if [[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then
  REMOTE_TIP=
  LOOKUP_FAILED=1
# Round 76, the same detector Phase 2 carries and for the same measurement: `$PUSH_URL` has already
# been through one `url.*.insteadOf` pass, and handing it to another git command applies a second.
# Where a chain exists the probe reads a repository the push never contacts, so the reading is not
# about the destination. `unknown-lookup` is the honest classification and it fails closed — the
# unshared question gets asked rather than skipped. Detector is local: `--get-url` expands and exits.
elif ! REMOTE_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URL") || [[ "$REMOTE_REPROBE" != "$PUSH_URL" ]]; then
  REMOTE_TIP=
  LOOKUP_FAILED=1
elif REMOTE_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URL" "refs/heads/$BRANCH"); then
  REMOTE_TIP=${REMOTE_LS%%$'\t'*}
  LOOKUP_FAILED=
else
  REMOTE_TIP=
  LOOKUP_FAILED=1
fi
# The classifier the table below documents — executable, because a table is a reading and a
# reading cannot lose an exit status. Each arm is one expression, and `merge-base`'s status is
# captured IMMEDIATELY into its own variable: exit 1 is its answer "not contained", anything
# above it is the ABSENCE of an answer, and `if ! git merge-base …` collapses the two into
# the SAME asking branch — so an errored ancestry is reported as a *measured* rewrite. The bit
# survives; the reason does not, and the reason is what the question states.
# ASK_REASON is carried because "unknown" and "measured rewrite" are different claims and the
# question below states which one the operator is answering.
if [[ -n "$LOOKUP_FAILED" ]]; then
  ASK=1; ASK_REASON=unknown-lookup
elif [[ -z "$REMOTE_TIP" ]]; then
  ASK=; ASK_REASON=creation
elif ! /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git cat-file -e "${REMOTE_TIP}^{commit}" 2>/dev/null; then
  ASK=1; ASK_REASON=unknown-tip
else
  if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$REMOTE_TIP" HEAD; then ANCESTRY=0; else ANCESTRY=$?; fi
  # 0 contained · 1 not contained · >1 merge-base ERRORED — three readings, never two
  # `case`, not `[ … -eq … ]` and not `[[ … -eq … ]]`. `[` is a builtin, so an imported
  # `BASH_FUNC_[%%` function outranks it and answers every one of these tests for the caller
  # (measured 2026-08-22: `[ a = a ]` returns the forged status). `[[` is a keyword and immune to
  # that, but its `-eq` is arithmetic, and arithmetic is the wrong tool twice over: an empty
  # operand reads as 0, so `[[ "" -eq 0 ]]` is TRUE where `[ ]` errors to false — fail-closed
  # inverted — and bash evaluates arithmetic operands recursively, so a non-numeric one is
  # dereferenced as a variable name. `case` is a keyword that does neither.
  case "$ANCESTRY" in
    0) ASK=; ASK_REASON=fast-forward ;;
    1) ASK=1; ASK_REASON=rewrite ;;
    *) ASK=1; ASK_REASON=unknown-ancestry ;;
  esac
fi
# Report what was measured, for the reason Phase 0 step 9 gives: this fence is a shell of its
# own, and the next thing to run is a question whose wording depends on every field below.
# `ASK` alone would not be enough even if it were printed — the table's seven rows collapse to
# two values of it, and "unknown-lookup" and "rewrite" ask the operator different questions
# while agreeing that one must be asked.
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
/usr/bin/printf 'ASK=[%s]\nASK_REASON=[%s]\nREMOTE_TIP=[%s]\nLOOKUP_FAILED=[%s]\n' \
  "$ASK" "$ASK_REASON" "$REMOTE_TIP" "$LOOKUP_FAILED"
```

**Every git command here carries the canonical prefix**, for the reason the push itself does: a
bare `git` acts on whatever repository an ambient `GIT_DIR` names, and `GIT_GRAFT_FILE` /
replacement refs change the ancestry answer outright. A probe reading a different repository — or
a different ancestry — from the push it authorizes would classify one push and permit another. The
same prefix therefore leads `cat-file` and `merge-base` below.

`<prefix>` in the table stands for that whole leader **including `GIT_GRAFT_FILE=/dev/null
GIT_NO_REPLACE_OBJECTS=1`**, not the `-u` list alone. The distinction is the finding, not pedantry,
and it holds twice over. `-u GIT_REPLACE_REF_BASE` only unsets an override of where replacement
refs live — it does not disable them. `-u GIT_GRAFT_FILE` is worse than inert: unsetting it hands
the lookup back to the path it defaults to, `$GIT_DIR/info/grafts`, which lives in the repository
where no `-u` reaches. Either way a probe carrying the `-u` list and nothing else reads a forged
graph while the push sends the real one. Measured 2026-08-21: with a repository grafts file in
place, `env -u GIT_GRAFT_FILE GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor` answers 0 and
the same command with `GIT_GRAFT_FILE=/dev/null` answers 1.

| Result | Reading | Ask? |
|--------|---------|------|
| `LOOKUP_FAILED=1` | The push destination did not resolve to exactly one URL, or `ls-remote` against it failed. The topology is **unknown, not benign** (`ASK_REASON=unknown-lookup`) | **Yes** — fail closed, and this row is checked FIRST |
| `REMOTE_TIP` empty with `LOOKUP_FAILED` empty | The branch does not exist on the remote — a **creation**. There is no history to overwrite (`ASK_REASON=creation`) | No |
| a sha, and `<prefix>git cat-file -e "$REMOTE_TIP^{commit}"` then `<prefix>git merge-base --is-ancestor "$REMOTE_TIP" HEAD` both succeed | The remote tip is an ancestor of what replaces it — an ordinary **fast-forward** whatever flag was passed (`ASK_REASON=fast-forward`) | No |
| a sha, `cat-file` succeeds, `--is-ancestor` exits 1 | The remote tip is **not** reached by the new one — this push **rewrites** history (`ASK_REASON=rewrite`) | **Yes** |
| a sha, `cat-file` succeeds, `--is-ancestor` exits **greater than 1** | `merge-base` **errored** rather than answering. Exit 1 is its answer "no"; anything above it — a corrupt or incomplete commit graph, an unreadable object — is the absence of an answer, and reading a generic nonzero as "no rewrite" is how an indeterminate topology becomes an unasked question (`ASK_REASON=unknown-ancestry`) | **Yes** — fail closed |
| a sha `cat-file` cannot find locally | Unknown again — an unfetched or unreachable tip answers nothing (`ASK_REASON=unknown-tip`) | **Yes** — fail closed |

Never infer "no rewrite" from the flag's absence in the other direction either: this whole
determination runs only because `--force-with-lease` was passed, and a plain push that would rewrite
history is refused by git before any of it (§ Push safety, "an authorization of nothing").

When the table says ask, ask this — and say which of the two readings produced it, because
"unknown" and "measured rewrite" are different claims and the operator is entitled to know which
one they are answering:

| | |
|---|---|
| `question` (measured rewrite) | `"This push rewrites the remote history of <branch>: the remote tip <REMOTE_TIP> is not an ancestor of the commit replacing it. Is anybody else working on <branch>?"` |
| `question` (topology unknown) | `"<why it could not be determined — ls-remote failed / tip <sha> is not present locally>, so whether this push rewrites <branch>'s history could not be established. Is anybody else working on <branch>?"` |
| options | `"Nobody else works on <branch>"` → continue to the push approval · `"Someone else might"` → **abort, do not push** |

Three properties, none optional:

1. **It is a separate question, asked first.** `rules/git-workflow.md` forbids force-pushing a
   *shared* branch outright. An answer of "someone else might" is therefore not a decision to be
   weighed against convenience — it is the prohibited case, and the skill refuses rather than
   asking the user to approve anyway.
2. **It never becomes `ALLOW_FORCE_UNSHARED=1`.** Phase 2 clears that variable unconditionally. The
   answer here is an in-session one and may be auto-approved by permission caching; converting it
   into the hook's bypass would let a cached answer silence the terminal gate, which inverts the
   whole point. Where the hook is installed the operator answers again at `/dev/tty`, and that
   second answer is the one that authorizes.
3. **Where it is owed, it is asked whether or not the hook is installed.** The topology table above
   decides *whether* the question is owed; the hook's presence never does. The hook is opt-in, so this question is the
   only attestation that exists in the un-hooked configuration — the one where option A would
   otherwise be a property of a file nobody has.

**If user rejects → stop immediately. Do NOT retry or persuade.**

### Phase 2: Execute Push

After user approval:

**Command assembly** (deterministic):

```bash
# Build and execute push command (ONLY after explicit approval)
# PUSH_BLOCKED is this fence's own refusal record, and it exists because `exit` cannot be trusted to
# end the fence. `exit` is a builtin, so an imported `BASH_FUNC_exit%%` function outranks it —
# measured on bash 3.2.57: the refusal printed in full and the push then ran, exit status 0. No
# keyword terminates a shell (`return` is a builtin too), so the fix is not a better terminator:
# a refusal RECORDS itself in an assignment, and the push sits inside a branch `[[ ]]` selects.
# The record is FROZEN, not merely written — this paragraph used to say an assignment is something
# "nothing outranks", which confuses the command with the value. The command cannot be outranked;
# the value it wrote can be erased by whatever runs next, and under this vector that is the hostile
# function itself: `BASH_FUNC_exit%%='() { PUSH_BLOCKED=; return 0; }'` cleared the flag and the
# push ran at status 0 (measured 2026-08-22, bash 3.2.57 and 5.3.15). `readonly` at every refusal
# site below closes it — the erasing assignment, `unset` and `declare -g` each fail against a
# readonly name and the refusal held on both shells. What it does NOT close is injection: an
# environment that can define `exit` can define `git`, measured the same day intercepting a whole
# push. The record defends the case where the terminator alone was trusted — a stubbed, swallowed
# or subshell-confined `exit`; it was never a fence against arbitrary imported functions.
# `exit 1` stays — in an ordinary shell it is still right, and it is no
# longer the only thing standing between a refusal and a force-push. Cleared here rather than
# defaulted, so an exported value of the same name cannot pre-approve anything either.
PUSH_BLOCKED=
# Re-bind both flag variables here, with the same literal values Phase 0 step 0 was
# written with. This is not redundancy: every fenced block in this skill is a separate
# shell, so nothing Phase 0 assigned survives into this one — what survives is the
# EXPORTED environment, and reading it is precisely how a plain push becomes a
# lease-force. Re-binding at the top of the fence that consumes them means the branch
# taken below is a function of the invocation alone, whatever the environment holds.
# The two lines must state the same values as Phase 0; if they cannot, the push plan
# and the push have diverged and the run stops instead of choosing between them.
FORCE_WITH_LEASE=false   # `true` only if the invocation contained --force-with-lease
SET_UPSTREAM=false       # `true` if --set-upstream was passed, or Phase 0 step 5b set it
# $BRANCH gets both treatments, because it is the one value git can still answer for
# itself: the approved name is written literally, the live name is re-derived, and the
# push proceeds only if they agree. An inherited `BRANCH` would aim the push at a name
# the plan never showed and leave the protected-branch re-assertion below judging the
# wrong one; a bare re-derivation would silently follow a checkout made after the
# approval. Disagreement is not repaired here — the approval covered one branch, so
# the run stops and asks again. Detached HEAD lands here too: `HEAD` matches no
# approved branch name, so the same comparison catches it.
# The prefix is on THIS command too, and that is the whole point of the round-39 fix. Normalizing
# only the push made the approval and the push describe different repositories: with an ambient
# GIT_DIR, a bare re-derivation returned branch `main` at 4d01381e while the normalized push
# resolved `main` to 2692ede5 — same name, different commit, comparison green. A branch-name guard
# is only a guard if both names come from the same repository.
PLAN_BRANCH=<the branch name the Phase 1 plan showed, written literally and quoted>
BRANCH=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "$PLAN_BRANCH" ]]; then
  echo "⛔ HEAD is on '${BRANCH:-nothing}' but the approval covered '$PLAN_BRANCH' — aborting" >&2
  readonly PUSH_BLOCKED=1; exit 1
fi
# ⛔ Protected × force-with-lease is prohibited (rules/git-workflow.md: force push to
# shared branches). Phase 0 already hard-aborted this combination; re-assert it here
# so no approval path — cached, mis-run, or otherwise — can reach a prohibited push.
case "$BRANCH" in
  main|master|develop|release/*)
    if [[ "$FORCE_WITH_LEASE" == "true" ]]; then
      echo "⛔ --force-with-lease targets protected branch '$BRANCH' — force push to shared branches is prohibited" >&2
      readonly PUSH_BLOCKED=1; exit 1
    fi
    ;;
esac
# The PLAN_BRANCH comparison answers "which branch", not "which commit" — and once the approval
# and the push are separated in time those are different questions. A commit made on the same branch
# between Phase 1 and here passes the name comparison unchanged, and the push then publishes work
# the plan never showed. Same treatment for the same reason: the approved SHA is written
# literally, the live one is re-derived through the same normalized prefix, and disagreement stops
# the run instead of choosing a side. It is the full object ID, not an abbreviation — an
# abbreviated pair can agree on a prefix and name different commits. Full means whatever width
# `git rev-parse HEAD` printed: 40 hex under SHA-1, 64 under SHA-256. Naming one width here would
# make every push in a SHA-256 repository abort as though HEAD had moved — `pre-push-gate.sh`
# already accepts both, and a skill that does not disagrees with the gate it defers to.
# Declined, recorded so it is not re-proposed: pushing `refs/heads/${BRANCH}` could be replaced by
# a SHA source (`${PLAN_HEAD_SHA}:refs/heads/${BRANCH}`), pinning the commit in the refspec itself.
# The push below now uses BOTH, and the comparison is no longer the whole binding: it is what makes
# the literal in the refspec provably the current HEAD, while the refspec is what makes the pushed
# object provably the compared one. Either alone leaves a gap — a comparison whose result the push
# then re-resolves by name, or a literal nothing checked against the tree.
# Round 63 kept only the comparison because a SHA source silently defeats `--set-upstream`
# (measured 2026-08-21, re-measured 2026-08-22 on git 2.55.0). That measurement stands; what was
# wrong was the conclusion drawn from it, since `-u` is recoverable and the binding is not. The
# recovery, and the second measurement it rests on, are written out at the write itself below.
# It sits AFTER the protected × force-with-lease refusal, not before: that refusal is a
# prohibition and decides on the branch name alone, so making it wait on a second read would
# widen what a prohibited push depends on for no gain.
PLAN_HEAD_SHA=<the full HEAD object ID the Phase 1 plan showed, at its printed width, written literally and quoted>
HEAD_SHA=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rev-parse HEAD)
# Emptiness first, because the comparison cannot see it: `"" != ""` is FALSE, so two empty values
# pass this gate as though HEAD were exactly where the approval left it. Both sides can be empty
# for ordinary reasons — `git rev-parse HEAD` on an unborn branch prints nothing and exits 128,
# and with `errexit` not inherited the assignment simply succeeds; `PLAN_HEAD_SHA` is a literal
# the model writes, so a rendering that dropped it is empty too. What makes this a refusal rather
# than a warning is what the push below does with it: since round 72 the refspec source is that
# literal, and an empty left side makes it `":refs/heads/${BRANCH}"` — git's spelling for DELETE
# that branch. `pre-push-gate.sh` is no backstop here: its rewrite test requires a non-null OID on
# BOTH sides, so a deletion reaches neither of its prompts by design. Same guard, same reason, as
# the `[[ -n "$PUSHED" ]]` on the `epic-merge` pushes — that one was added and this one was not.
if [[ -z "$PLAN_HEAD_SHA" ]] || [[ -z "$HEAD_SHA" ]]; then
  echo "⛔ the approved commit is '${PLAN_HEAD_SHA:-empty}' and HEAD reads '${HEAD_SHA:-empty}' —" >&2
  echo "   one of them is empty, so nothing was compared. Re-run Phase 1 and push nothing." >&2
  readonly PUSH_BLOCKED=1; exit 1
fi
if [[ "$HEAD_SHA" != "$PLAN_HEAD_SHA" ]]; then
  echo "⛔ HEAD is at '${HEAD_SHA:-nothing}' but the approval covered '$PLAN_HEAD_SHA' — aborting" >&2
  readonly PUSH_BLOCKED=1; exit 1
fi
# Branch and commit are two of the three things the approval fixed; the third is **where**. The
# push below goes to the name `origin`, and that name resolves at push time — `remote.origin.pushurl`
# or `url.<x>.pushInsteadOf` changing between the approval and here would redirect the approved
# commits to a different repository with every assertion above still true. The Phase 0 topology
# probe already resolved the destination and the plan printed it; this re-resolves it with the
# same oracle, in THIS fence, with no question asked in between — so what the comparison closes is
# the window that actually existed: Phase 0 and the approval are minutes and several tool calls
# away, this read is microseconds away.
# Declined, with the measurement, so it is not re-proposed a third time: "push to the validated URL
# instead of the mutable name `origin`" does **not** close this. Measured 2026-08-22 — with
# `url.<B>.insteadOf=<A>` configured, `git push <A> HEAD:refs/heads/x` landed the ref in **B**, not
# A. git applies the rewrite layer to a command-line URL exactly as it applies it to a remote name,
# so addressing the URL moves the re-resolution from one config key to another and pins nothing.
# (The same measurement also shows the check is honest: `git remote get-url --push --all origin`
# reports the POST-rewrite URL, so what Phase 0 hashed is the destination git would really use.)
# # What remains after the comparison is not closable **by naming a destination**: git resolves it
# inside its own process, from configuration this shell cannot freeze, and every construct that
# names one — a remote, a URL, a SHA refspec — goes through the same rewrite layer. This block
# therefore narrows the window; it does not pin the destination.
#
# It was written here as "irreducible client-side", and that was wrong — corrected 2026-08-22.
# The resolution happens client-side, but it does not happen *unobservably*: git computes the
# real destination and then hands it to the pre-push hook as `$2`, inside the pushing process,
# after every rewrite. `SD0X_PUSH_DEST_DIGEST` on the push line below is what turns that into a
# binding — see the block above it. The claim mattered because it told a reader to stop looking
# for a layer that was already there and simply unread: `scripts/pre-push-gate.sh` had `$2`
# commented `unused`.
#
# Two values are carried across, and the second is the one that binds. `PLAN_PUSH_URLS` is the
# redacted string the human approved and is compared so the refusal can NAME what changed;
# `PLAN_PUSH_DIGEST` is the Phase 0 digest of the raw list and is what makes the comparison an
# identity check at all. Redaction deletes the whole query, so two destinations differing only
# there compare equal (measured, round 54) — a guard on the redaction alone binds the approval to
# a host and a path, and a `.git/config` edit in between redirects the push while it passes.
PLAN_PUSH_URLS=<the redacted destination the Phase 1 plan showed, written literally and quoted>
PLAN_PUSH_DIGEST=<the PUSH_URLS_DIGEST value Phase 0 step 8b printed, written literally and quoted>
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
# An empty digest is a refusal, not a match: `[ "" = "" ]` would pass for a destination that did
# not resolve on either side, which is the shape every fail-closed row in this skill exists to
# refuse. The digest is compared FIRST because it is the identity; the redaction is compared after
# so the message can say what the operator saw.
if [[ -n "$PUSH_RECEIVEPACK" ]] || [[ -z "$PUSH_URLS" ]] || [[ -z "$PUSH_URLS_DIGEST" ]] || [[ "$PUSH_URLS_DIGEST" != "$PLAN_PUSH_DIGEST" ]] \
   || [[ "$PUSH_URLS_SAFE" != "$PLAN_PUSH_URLS" ]]; then
  echo "⛔ push destination is '${PUSH_URLS_SAFE:-unresolvable}' but the approval covered '$PLAN_PUSH_URLS' — aborting" >&2
  echo "   (identity is compared on a digest of the raw destination, so a change the redaction hides still refuses here)" >&2
  if [[ -n "$PUSH_RECEIVEPACK" ]]; then
    echo "   (remote.origin.receivepack is configured, so the URL does not decide where the objects land; read it with: git config --get remote.origin.receivepack)" >&2
  fi
  readonly PUSH_BLOCKED=1; exit 1
fi
# ── Final topology re-check, in the fence that pushes (round 60) ──────────────────────────────
# Phase 1 classified the topology and decided from it whether the unshared question was owed. By
# the time this fence runs that classification is a **prediction**: a different shell, after an
# approval, with everything a remote can do in between. `/epic-merge` § Safety records what a stale
# one costs. So re-measure here and refuse when the reading and the attestation disagree — the
# reviewer's phrase for the class is the right one: a prediction is not a measurement.
#
# Only the lease path can rewrite anything. Without `--force-with-lease` git refuses a
# non-fast-forward client-side, before the hook is ever invoked (§ Defense in Depth, row 1), so a
# plain push has no topology to re-check and this whole block is skipped for it.
if [[ "$FORCE_WITH_LEASE" == "true" ]]; then
  # The attestation Phase 1 collected, written **literally into this fence** by the model. Fill it
  # in ONLY when the unshared question was put to the operator by name and answered "nobody else":
  # replace the empty value with the literal, quoted string "refs/heads/<BRANCH>". It is never read
  # from the environment and it is assigned unconditionally right here — an exported value would
  # answer a question nobody was asked, which is exactly the hazard `ALLOW_FORCE_UNSHARED` carries
  # and why this skill clears that one instead of imitating it. Empty refuses.
  UNSHARED_ATTESTED=
  # The remote tip Phase 0 step 8 PRINTED as `REMOTE_TIP=[...]` — the commit the plan named as the
  # thing this push would overwrite — written literally and quoted by the model, exactly like the
  # two `PLAN_PUSH_*` fields above and for the same reason. Not re-derived: re-reading it here
  # would ask the question again instead of remembering the answer, which is the whole failure
  # this field exists to close. Empty is not a free pass — the `rewrite` arm below compares it
  # against a non-empty `$FINAL_TIP`, so a field left unfilled refuses.
  PLAN_REMOTE_TIP=
  # One destination or none: the digest guard above already refused a fan-out that no longer
  # matches the plan, and a multi-URL push has no single tip to classify.
  if [[ -z "$PUSH_URLS" ]] || [[ "$PUSH_URLS" == *$'\n'* ]]; then
    FINAL_TIP=; FINAL_LOOKUP_FAILED=1
  # Round 76: a rewrite CHAIN resolves twice across two commands, and this fence spans two.
  # `git remote get-url --push --all origin` already applied one pass; handing that string to
  # `git ls-remote` applies another. Measured 2026-08-22 (git 2.55.0) with
  # `url.<B>.insteadOf=<A>` and `url.<C>.insteadOf=<B>`: the resolved push URL is B, `git push`
  # lands in B, and `git ls-remote -- <B>` answers **C's** tip. The lease would then be bound to a
  # tip measured from a repository the push never contacts — the classification and the credential
  # would both be about the wrong remote. There is no repair available from a URL string, because
  # any string handed back to git gets rewritten again; so this is a REFUSAL. `--get-url` is the
  # detector and it is purely local — it expands and exits, contacting nothing.
  elif ! FINAL_REPROBE=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --get-url -- "$PUSH_URLS") || [[ "$FINAL_REPROBE" != "$PUSH_URLS" ]]; then
    echo "⛔ url.*.insteadOf rewrites the resolved push destination a SECOND time, so this fence" >&2
    echo "   cannot measure the repository the push will contact: the push goes to the once-" >&2
    echo "   rewritten URL, a probe of that URL reads the twice-rewritten one. Remove the chained" >&2
    echo "   rewrite rule, or push without --force-with-lease." >&2
    FINAL_TIP=; FINAL_LOOKUP_FAILED=1
  elif FINAL_LS=$(/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git ls-remote --upload-pack=git-upload-pack -- "$PUSH_URLS" "refs/heads/${BRANCH}"); then
    FINAL_TIP=${FINAL_LS%%$'\t'*}; FINAL_LOOKUP_FAILED=
  else
    FINAL_TIP=; FINAL_LOOKUP_FAILED=1
  fi
  # The object this push PUBLISHES, not a re-resolution of the branch NAME. Until round 74 this
  # line read `git rev-parse --verify --quiet "refs/heads/${BRANCH}"`, so a branch that moved
  # between the Phase 2 comparison and here was CLASSIFIED while `$PLAN_HEAD_SHA` was PUSHED: the
  # fence could read `fast-forward` about commit B, skip the unshared question on that basis, and
  # let git overwrite the remote with commit A — with the tracking ref and reflog updated by the
  # same movement, the lease and `--force-if-includes` both passed — the form this fence carried
  # until round 75, and the bind below is now the second half of the same fix. That is § 4.50's defect one
  # fence later. The approval is bound to a commit, so every check that AUTHORIZES the push must
  # be bound to the same commit; `/epic-merge` Step 5 classifies against `$PUSHED` for this exact
  # reason. An assignment, not a capture: `$PLAN_HEAD_SHA` is already in this fence and already
  # guarded for emptiness above, and re-reading it through git would reintroduce the gap.
  FINAL_LOCAL=$PLAN_HEAD_SHA
  # Fail-closed rows FIRST: a failed lookup also leaves the tip empty, and testing emptiness first
  # would read every unreachable remote as a creation.
  if [[ -z "$FINAL_LOCAL" ]] || [[ "$FINAL_LOOKUP_FAILED" = 1 ]]; then
    FINAL_ANCESTRY=; FINAL_READING=unknown
  elif [[ -z "$FINAL_TIP" ]]; then
    FINAL_ANCESTRY=; FINAL_READING=creation
  elif [[ "$FINAL_TIP" = "$FINAL_LOCAL" ]]; then
    FINAL_ANCESTRY=; FINAL_READING=up-to-date
  else
    if /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 git merge-base --is-ancestor "$FINAL_TIP" "$FINAL_LOCAL"; then FINAL_ANCESTRY=0; else FINAL_ANCESTRY=$?; fi
    # captured immediately — three readings, never two
    case "$FINAL_ANCESTRY" in
      0) FINAL_READING=fast-forward ;;
      1) FINAL_READING=rewrite ;;
      *) FINAL_READING=unknown ;;
    esac
  fi
  /usr/bin/printf 'FINAL_READING=[%s]\nFINAL_TIP=[%s]\nFINAL_LOOKUP_FAILED=[%s]\nUNSHARED_ATTESTED=[%s]\n' \
    "$FINAL_READING" "$FINAL_TIP" "$FINAL_LOOKUP_FAILED" "$UNSHARED_ATTESTED"
  # A `case` over the WORD with a `*` catch-all, not a negated list: a reading this fence has never
  # heard of lands in the refusing arm by construction. `unknown` refuses whatever was attested —
  # the attestation answers "is this ref shared", `unknown` says the measurement failed, and no
  # answer to the first is evidence about the second.
  case "$FINAL_READING" in
    creation|up-to-date|fast-forward) ;;
    rewrite)
      if [[ "$UNSHARED_ATTESTED" != "refs/heads/${BRANCH}" ]]; then
        echo "⛔ this push rewrites refs/heads/${BRANCH} and no unshared attestation covers it." >&2
        echo "   Phase 1 classified the topology before the approval; it reads 'rewrite' now." >&2
        echo "   STOP. Two things are owed, and the ORDER is the contract (git-workflow.md" >&2
        echo "   § Push safety: the unshared question comes BY NAME and BEFORE the force approval):" >&2
        echo "   1) put the unshared question to the operator by name;" >&2
        echo "   2) on a yes, return to Phase 1 for a FRESH push approval whose plan states that" >&2
        echo "      this push rewrites the ref and shows the lease it will carry. The approval you" >&2
        echo "      hold described a topology that no longer applies, and an attestation about" >&2
        echo "      sharedness is not an approval of a rewrite." >&2
        echo "   Only then re-run this fence with UNSHARED_ATTESTED=refs/heads/${BRANCH}." >&2
        echo "   Never set ALLOW_FORCE_UNSHARED." >&2
        readonly PUSH_BLOCKED=1; exit 1
      fi
      # The attestation is a credential; this is a FACT, and they are not interchangeable. The two
      # checks above bind the local side to the approval (`FINAL_LOCAL=$PLAN_HEAD_SHA`) and the
      # destination to it (the digest guard); the object this push DESTROYS was never bound to
      # anything. So a tip that moved between the classification and here means the operator
      # approved overwriting one commit and this fence is about to overwrite a different one —
      # and the lease, carrying `$FINAL_TIP`, expects the NEW value and sails through. The
      # movement is also evidence AGAINST the attestation it would otherwise proceed on: a ref
      # nobody else holds does not acquire commits nobody here published. Fail-closed on an
      # unfilled field, per the declaration above.
      if [[ "$FINAL_TIP" != "$PLAN_REMOTE_TIP" ]]; then
        echo "⛔ refs/heads/${BRANCH} points at '${FINAL_TIP:-<none>}' but the approval covered" >&2
        echo "   overwriting '${PLAN_REMOTE_TIP:-<none>}' — a different commit would be destroyed." >&2
        echo "   The attestation you hold says this ref is not shared; the tip moving since the" >&2
        echo "   classification is evidence against it, so it cannot carry this push. STOP." >&2
        echo "   1) put the unshared question to the operator by name, for the tip as it reads NOW;" >&2
        echo "   2) on a yes, return to Phase 1 for a FRESH push approval whose plan names that tip." >&2
        echo "   Never set ALLOW_FORCE_UNSHARED." >&2
        readonly PUSH_BLOCKED=1; exit 1
      fi ;;
    *)
      echo "⛔ the destination topology for refs/heads/${BRANCH} reads '${FINAL_READING}' — the" >&2
      echo "   measurement did not answer, so nothing here knows what this push would overwrite," >&2
      echo "   and an attestation about sharedness cannot supply it. STOP." >&2
      readonly PUSH_BLOCKED=1; exit 1 ;;
  esac
fi
# ⚠️ Always unset ALLOW_PUSH_PROTECTED **and ALLOW_FORCE_UNSHARED** to prevent env
# inheritance bypassing the hook. Both are developer-set attestations; a value exported
# earlier in the shell would answer the hook's question without anybody being asked now,
# and 'must never set it' is not the same guarantee as 'must never let it through'.
# Clearing is the guarantee.
# Only set ALLOW_FORCE_WITH_LEASE when --force-with-lease is explicitly requested.
# ⚠️ `--` before the ref is load-bearing, and quoting does not replace it: the quotes are
# consumed by the shell, so git still sees an option-shaped branch name as an option.
# `git check-ref-format refs/heads/--all` exits 0, and `git push origin "--all"` on such a
# branch reports "Everything up-to-date" — git took `--all` as the flag and pushed every
# branch, none of which the plan above showed or the approval covered. With `--` the same
# argument is a refspec ("src refspec --all does not match any"). Measured in all four
# forms below, `-u` and `--force-with-lease` included.
# ⚠️ And `--` ends OPTION parsing, not REFSPEC parsing — which is why the ref is written as a
# full `src:dst` refspec rather than a bare branch name. `+` leads a force refspec, and
# `git check-ref-format refs/heads/+main` exits 0, so `+main` is a legal branch name that the
# protected-branch guard above reads as unprotected. Measured: with a local `main` rewound
# behind the remote, `git push origin -- "+main"` — no force flag anywhere on the line —
# reported `+ affcbe7...ad7e970 main -> main (forced update)` and exit 0. It is also simply
# the wrong branch: with a real `+main` branch present, that form pushed `main` and never
# created `refs/heads/+main` on the remote, while `refs/heads/+main:refs/heads/+main` created
# it correctly. So the explicit refspec closes a silent force-push of a protected branch and
# fixes which branch is pushed at the same time. Write `${BRANCH}` in braces: `$BRANCH:refs`
# is a modifier expansion in zsh and silently eats the `:refs`.
# ⚠️ **The lease carries the tip the fence above measured** —
# `--force-with-lease=refs/heads/<b>:$FINAL_TIP` — and `--force-if-includes` is gone with the bare
# form it was compensating for (round 75; Step 5 of `/epic-merge` has been on this shape since
# round 60). The bare lease resolves `refs/remotes/origin/<b>` *inside the pushing process*, so it
# expresses a different expectation than the classification the operator was shown, and the pair
# closed only part of the gap: `--force-if-includes` asks whether the remote tip is reachable from
# **any reflog entry** of the local branch, which a branch that once held that commit satisfies by
# construction. Measured end to end 2026-08-22 (git 2.55.0), and this is the whole finding:
# classifier reads remote `C`; a collaborator publishes divergent `D`; a background fetch moves
# the tracking ref to `D`; `D` is in the branch reflog because the operator had it checked out
# earlier and reset away. The shipped `--force-with-lease --force-if-includes` publishing the
# approved `A` reported `+ 30b0ccd...2f05240 feat/x -> feat/x (forced update)` and exit 0 — `D`
# overwritten, no attestation, and the only topology the operator ever saw said `fast-forward`.
# The same tree with `--force-with-lease="refs/heads/feat/x:<C>"` was rejected: `! [rejected] …
# (stale info)`, remote unchanged. An empty `$FINAL_TIP` is not a hole but the `creation` reading's
# own expectation — measured: `--force-with-lease=refs/heads/<new>:` creates the ref and the same
# form against an existing ref is rejected `(stale info)`. `unknown` never reaches here; the `case`
# above refuses it.
# The two flags are **not** combined: measured on the same git, an explicit lease value plus
# `--force-if-includes` succeeded (exit 0) where the value alone refuses — git documents the flag
# as a no-op beside a lease value, and a silently-inert safety flag reads as protection nobody has.
# Requires git >= 2.30 for the valued form as well; on an older git the push fails with an
# unknown-option error, which is the correct direction — falling back to the bare form would
# restore the hazard silently.
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
# Read once, here, rather than inside the arms: with `-u` gone the two arms are one command each,
# and the only thing `SET_UPSTREAM` still decides is whether the write below happens. Deciding it
# before the push also means an ambient value cannot be read for the first time after the push has
# already gone out.
UPSTREAM_OWED=
if [[ "$SET_UPSTREAM" == "true" ]]; then UPSTREAM_OWED=1; fi
if [[ -n "$PUSH_BLOCKED" ]] || [[ -z "$PLAN_HEAD_SHA" ]]; then
  echo "⛔ a guard above refused this push, or the approved commit is empty — nothing is pushed" >&2
  # …and the fence must SAY so, not merely print it. `echo` succeeds, so an arm ending on one
  # reports **success** for a refusal: Phase 2 reads as complete, and the caller goes on to
  # dispatch `/watch-ci` for a push that never happened. This arm is reachable at all only when a
  # guard's own `exit 1` was answered by an imported `BASH_FUNC_exit%%` that returns — the case
  # this document anticipates everywhere else — so terminating it with another `exit` would be
  # the same defect twice. Assign-then-expand, as in step 0a: the reset is a syntax assignment no
  # function can shadow, and `:?` on a null value exits non-zero.
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — a guard above refused this push, or the approved commit is empty; nothing was pushed}"
elif [[ "$FORCE_WITH_LEASE" == "true" ]]; then
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ALLOW_PUSH_PROTECTED= ALLOW_FORCE_UNSHARED= SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease="refs/heads/${BRANCH}:${FINAL_TIP}" --receive-pack=git-receive-pack origin -- "${PLAN_HEAD_SHA}:refs/heads/${BRANCH}"
else
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ALLOW_PUSH_PROTECTED= ALLOW_FORCE_UNSHARED= SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE= git push --receive-pack=git-receive-pack origin -- "${PLAN_HEAD_SHA}:refs/heads/${BRANCH}"
fi
# `$?` on its own line, and this is deliberately NOT the shape § 4.46 removed. There, what a
# following capture line lost under an inherited `errexit` was a DIAGNOSTIC that had to survive
# the failure it described. Here what follows is a WRITE that must not happen on one: under
# `errexit` the shell dies at the failing push and never reaches it, which is precisely the
# outcome the guard below produces explicitly when `errexit` is off. Both paths refuse; only one
# of them is a line of shell.
PUSH_STATUS=$?
# `-u` is gone from both forms, and the upstream is written here instead. The `-u` was what forced
# the mutable `refs/heads/${BRANCH}` source above: measured 2026-08-21 and again 2026-08-22 on git
# 2.55.0, `git push -u origin "<sha>:refs/heads/feat/x"` succeeds and `@{u}` still reports "no
# upstream configured", with no warning on either stream. Round 63 read that as "the SHA source is
# unavailable" and kept the comparison alone — but a comparison of `HEAD` followed by a push of
# `refs/heads/${BRANCH}` names two different things, and git resolves the second one, inside its own
# process, after the comparison has passed. The approval is bound to a commit; the push has to be
# bound to the same one, and a refspec whose left side is an object ID is the only construct that
# does it — the ID cannot be moved by anything between here and git's own resolution.
# The same measurement, continued 2026-08-22, is what makes that affordable: the SHA-source push
# still updates `refs/remotes/origin/<branch>` (git's default fetch refspec applies to it), so the
# two keys `-u` would have written can be written directly, with no fetch — `@{u}` and
# `git status -sb` both resolve afterwards. Pinning the source costs two config writes, not the
# upstream. These are the same two keys `-u` wrote, to the same values, so nothing about the
# repository ends up in a state the old form could not also produce.
# Gated on the push having SUCCEEDED: an upstream pointing at a branch the push never published is
# a worse state than no upstream at all — `git status` would then report the local branch as ahead
# of a ref that does not exist.
# `|| VAR=$?` rather than a following `STATUS=$?` line, for the reason § 4.46 records: under an
# inherited `errexit` the shell dies AT a failing command and a following capture line never runs,
# while a `||` list suppresses `errexit` for its left side by definition. Both writes assign into
# the SAME variable deliberately — either failing leaves the upstream unusable, and the second
# failing after the first succeeded is the half-written state, which is not better than neither.
UPSTREAM_STATUS=0
if [[ "$UPSTREAM_OWED" = 1 ]] && [[ "$PUSH_STATUS" = 0 ]]; then
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config "branch.${BRANCH}.remote" origin || UPSTREAM_STATUS=$?
  /usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git config "branch.${BRANCH}.merge" "refs/heads/${BRANCH}" || UPSTREAM_STATUS=$?
fi
# The fence's own exit status must stay the PUSH's. Without this arm and the one below it, the
# `if` above is the last command of Phase 2, and a FALSE condition is exactly what a failed push
# produces — so the fence would exit 0, Phase 2 would read as complete, and the caller would go on to dispatch
# `/watch-ci` for a push that was rejected. That is the same defect as an arm ending on `echo`,
# caught here by the test that asserts a rejected push fails the fence rather than by a reader.
# Spelled as the refusal at the top of the block is spelled, and for the same reason: `exit` is a
# builtin an imported `BASH_FUNC_exit%%` outranks, while a null-value `:?` expansion is the
# shell's own error and ends a non-interactive shell with nothing to shadow. The status itself is
# reported in the message, since `:?` cannot carry it.
if [[ "$PUSH_STATUS" != 0 ]]; then
  echo "⛔ the push exited ${PUSH_STATUS} — nothing was published; Phase 3 must not run" >&2
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — the push exited non-zero; nothing was published}"
fi
# The other half of the promise. The push succeeding is not the whole of what Phase 2 was
# approved to do when `--set-upstream` was in the plan: `-u` used to fail or succeed WITH the
# push, and moving the upstream into two commands after it split one outcome into two — so a
# fence that reads only the push status now reports success for a state the old form could not
# produce. It is a DIFFERENT sentence from the one above because it is a different state: the
# commits really are on the remote, and telling the operator "nothing was published" here would
# send them to re-push something that is already there.
if [[ "$PUSH_STATUS" = 0 ]] && [[ "$UPSTREAM_STATUS" != 0 ]]; then
  echo "⛔ the push published ${BRANCH}, but the upstream write exited ${UPSTREAM_STATUS} —" >&2
  echo "   branch.${BRANCH}.remote / .merge may be unset or half-written. The COMMITS ARE PUSHED;" >&2
  echo "   do not push again. Set the upstream by hand, then continue:" >&2
  echo "     git config branch.${BRANCH}.remote origin" >&2
  echo "     git config branch.${BRANCH}.merge refs/heads/${BRANCH}" >&2
  SD0X_PUSH_CI_REFUSED=
  : "${SD0X_PUSH_CI_REFUSED:?refusing — the push landed but the upstream write did not}"
fi
# ⚠️ The prefix is spelled `/usr/bin/env`, absolutely, and that is not style. A bare `env` is a
# command word without a slash, so bash resolves an imported `BASH_FUNC_env%%` function first and
# the forged function ignores every `-u`: measured, a child behind `env -u GIT_DIR` still received
# `GIT_DIR=/attacker/repo.git`. `command env` does not fix it either — `command` is a builtin, and
# functions outrank builtins. A word containing `/` closes the IMPORT vector — bash refuses to
# import a function whose name contains one ("error importing function definition for
# '/usr/bin/env'"). It does **not** make the word immune, and round 54 wrote it as though it did.
# Measured 2026-08-22: a `$BASH_ENV` file containing `function /usr/bin/env { ...; }` is sourced
# before line 1 of this fence, defines that exact name in THIS shell, and intercepts the prefix —
# the child printed HIJACKED. Only `bash -p` refuses the sourcing (measured SAFE), and a markdown
# fence cannot choose its interpreter's flags. So the honest boundary: `-u BASH_ENV` below protects
# every CHILD this fence starts, the slash protects against a function arriving through the
# environment, and neither protects this shell from a `$BASH_ENV` its own parent set — in which
# case `git` itself is equally forgeable and the fence has no integrity left to defend.
# What **Phase 0 step 0a** closes is the DETECTABLE half — not the reachable one, and the difference
# is the whole honesty of this comment. It refuses on the set-ness of `BASH_ENV`/`ENV` before any ref
# is read, and terminates through an expansion failure over a sentinel it resets one line above,
# rather than through `exit`: `exit` is a builtin a function outranks, and `:?` fires on null OR
# unset, so without that reset one exported `SD0X_PUSH_CI_REFUSED=1` satisfied it (measured, round
# 65). What it does NOT close: a startup file that defines the function and then unsets the variable,
# which is exactly as reachable as the case that is caught and merely invisible to a check that reads
# variables.
# That residue has no owner downstream. Saying "`pre-push-gate.sh` re-execs under `bash -p`, so L1
# is where the authorization lands" — as this comment did until round 64 — is only true where L1 is
# INSTALLED, and it is opt-in: `rules/git-workflow.md` § Push safety makes the in-session approval
# the whole credential wherever the hook is absent, so there is no stronger mechanism to defer to.
# ⚠️ `-u BASH_ENV -u ENV` leads every form and is not decoration. A non-interactive bash
# sources $BASH_ENV before line 1 of the pre-push hook, so an exported `ALLOW_FORCE_UNSHARED=1`
# assigned there restores exactly what the assignments to its right just cleared — measured, and
# a BASH_ENV that simply runs `exit 0` disables the hook outright. Neither is reachable from
# inside the hook: by the time its first line runs, that file has already been sourced. The hook
# re-execs itself under `bash -p` to shut the door on exported-function injection, which this
# prefix cannot name; this prefix shuts the one the re-exec cannot. Both, or neither works.
# `-u GIT_EXEC_PATH` closes a third, and it is the one the hook provably cannot close itself:
# git PREPENDS its exec-path to PATH before running a hook, so that variable — not a bare PATH —
# chooses which `git` the gate asks about ancestry. Measured end to end on 2026-08-21: with a
# git-core that delegates everything except `merge-base --is-ancestor`, a rewrite of an
# unprotected branch was pushed with exit 0 and no prompt, where the same push without the
# variable was refused with exit 1. Adding `-u GIT_EXEC_PATH` restores the refusal, and does not
# disturb an ordinary create or fast-forward (both still exit 0). The hook has no oracle for
# "which git is real" — every candidate is answered by the git in question — so this belongs
# here. Residual, stated rather than implied: a push made outside this skill is not covered.
# The GIT_* list after it is the same question one layer out: `GIT_CONFIG_COUNT`/`_PARAMETERS`/
# `_GLOBAL` choose the config THIS push resolves against, and two keys there are fatal —
# `url.<host>.insteadOf` sends the approved refspec to another server, `core.hooksPath=/dev/null`
# removes the gate outright. `GIT_GRAFT_FILE` is a third shape: it leaves the gate installed and
# poisons its ancestry oracle instead. All three measured on 2026-08-21 (§ 4.3).
# `GIT_GRAFT_FILE=/dev/null` and `GIT_NO_REPLACE_OBJECTS=1` are SET, not unset — the two names
# here whose safe value is a value, and each spent a round on the strip list with the sense exactly
# inverted. Unsetting `GIT_GRAFT_FILE` restores its DEFAULT path, `$GIT_DIR/info/grafts`, so the
# strip closes the environment channel by opening the repository one (measured 2026-08-21: the
# stripped form answers 0, the `/dev/null` form 1). For the other: unsetting it
# restores git's DEFAULT of honouring `refs/replace/*`, so a `git replace --graft L R` in the
# repository makes the gate's `merge-base --is-ancestor R L` answer 0 and the rewrite reads as a
# fast-forward — while the push publishes the real, unrelated L, because pack transfer ignores
# replacements. That asymmetry is what makes this a PUSH problem and not a general one: nothing
# else here is asked a question whose answer the transfer then disregards, which is why
# `skills/smart-commit` strips the same name and is right to. Measured: honest ancestry 1,
# grafted 0, guarded 1. The last three are the transport itself. `GIT_SSH_COMMAND`, `GIT_SSH` and
# `GIT_PROXY_COMMAND` each name an executable git runs IN PLACE OF the connection, handed the host
# and the remote command as mere arguments — measured 2026-08-22 on git 2.55.0, a wrapper is invoked
# as `<host> "git-receive-pack '/team/a.git'"` and may ignore both and speak to anything. That is the
# same redirection `url.<host>.insteadOf` performs, and closing one channel while leaving the other
# open protected nothing: Phase 0 hashes the approved URL, the operator approves it, the hook checks
# its digest, and the lease-force lands somewhere else. `GIT_ASKPASS` is NOT stripped and the
# difference is measurable, not stylistic — it is handed a prompt and returns a credential, so it
# cannot choose a destination. What this closes is the ENVIRONMENT channel only: `core.sshCommand`
# and `url.*.insteadOf` in the repository's own config still apply, deliberately — that config is
# the operator's, and it is also what keeps their key selection working after this strip
# (`~/.gitconfig`, `~/.ssh/config`). An operator who exported `GIT_SSH_COMMAND` ad hoc for this
# shell loses it here, and that loss is loud ONLY where the fallback cannot connect. On the case
# that matters it is silent: one host, two ports, two repositories, one key — the ad-hoc `-p 2222`
# is dropped, the push succeeds against the WRONG repository, and every control reports success.
# So the strip is not the answer on its own, and Phase 0 step 0b REFUSES a set transport variable
# rather than relying on this line (`docs/features/push-gate-optin/4-implementation.md` § 4.18).
# If push fails (non-zero exit) → stop immediately, report error, do NOT proceed to CI
```

**`--set-upstream` auto-detect** runs in **Phase 0 step 5b**, not here: if `git rev-parse --abbrev-ref --symbolic-full-name @{u}` fails (no upstream), `SET_UPSTREAM` becomes `true` there. It has to happen before Phase 1 — the plan the user approves names what will happen, and an upstream decided after the approval is one nobody was shown. The assembly above only reads the value.

Since round 72 that value no longer selects a **flag**. `-u` cannot bind an object-ID source (measured, git 2.55.0: the push succeeds and `@{u}` still reports no upstream), so both push forms drop it and the upstream is written afterwards, by `git config branch.<name>.remote` + `.merge`, gated on the push having exited 0. The two forms are therefore the same command with and without the lease — and what the plan must still name is the **upstream**, not a flag that is no longer on the line.

### Phase 3: Monitor CI (delegation)

After successful push, invoke `/watch-ci` to monitor CI runs:

- Pass `--sha <HEAD_SHA>` and `--branch <BRANCH>` — the pair Phase 2 **verified** against the plan, not the Phase 0 readings on their own. Phase 0 produces them and Phase 2 re-derives and compares both; monitoring a value that never passed that comparison would report CI for a commit the approval did not cover
- Pass `--timeout` from arguments (default 10)
- `/watch-ci` runs in Monitor streaming mode (default) — Claude receives progress notifications and reports verdict on completion
- `/watch-ci` handles run discovery, quick-check, monitoring, retry logic, and verdict reporting

This delegation keeps push authorization logic separate from read-only CI monitoring. See `@skills/watch-ci/SKILL.md` for CI monitoring details.

### When the push runs where nobody can answer

On a repo with the gate installed, a push in either prompting class — a protected branch, or one
that is not provably a fast-forward, read fail-closed and per ref class (§ Push safety) — opens `/dev/tty`. **Two different things happen from there, and
telling them apart is this section's whole job**, because only one of them ends.

**No controlling terminal → refused, exit 1.** This is the detached case: a `setsid` child, most CI
runners, an agent shell that was never attached to a terminal. The open fails and the gate says so —
in the class's own words, which differ:

```
pre-push-gate: Cannot open /dev/tty — no interactive terminal in this environment.
A force-form push needs an attestation that these refs are not shared.   # rewrite class
Push to protected branches requires interactive confirmation.            # protected class
```

**The push does not happen, and exit is 1.** State that outcome to the user rather than retrying:
this is the gate working, not an infrastructure failure, and the two look identical from the exit
code alone.

**A controlling terminal that nobody is watching → it hangs.** `nohup` does **not** remove the
controlling terminal — it ignores `SIGHUP` and redirects stdout — and neither does a plain `&`.
Measured under a real pty: direct, `nohup`, `nohup &` and `&` all still open `/dev/tty`; only
`setsid` does not. An earlier version of this section listed `nohup` in the refusing group, which
got the outcome exactly backwards. What actually happens is worse than a refusal: the gate opens the
terminal, prints its prompt to **stderr** — which `nohup` has already redirected into `nohup.out` —
and blocks on `read` with nothing on screen. No exit code ever arrives, so the instruction above has
nothing to act on. Never background a push on a gated repo; run it in the foreground and let the
operator see the prompt.

Either way the meaning is the same: the one person who could answer was not reachable. The recovery
route puts the question where they are, never removes it:

| Route | What it costs | When |
|-------|---------------|------|
| The operator re-runs the same push **in the foreground, from their own terminal** | One round-trip | The normal route. The gate prompts, they answer, done |
| The operator exports `ALLOW_FORCE_UNSHARED=1` **in their own shell** and pushes | Nothing, but the attestation is now theirs alone | Only for the **rewrite** class. They have already decided the refs are unshared |
| The operator exports `ALLOW_PUSH_PROTECTED=1` **in their own shell** and pushes | Same | Only for the **protected** class — and it does **not** clear a rewrite refusal. The two variables answer different questions and neither substitutes for the other (`rules/git-workflow.md` § Push safety): a rewrite of `main` with both `ALLOW_PUSH_PROTECTED=1` and `ALLOW_FORCE_WITH_LEASE=1` set **still requires the unshared attestation**. Which way that lands depends on where the push runs, and both halves are measured: in a foreground terminal the gate asks about the rewritten refs and the operator can answer `yes`; with no terminal the push is refused unless they also supply `ALLOW_FORCE_UNSHARED=1`. "Refused" alone was this line's earlier wording, and it read the terminal-less half as the whole rule. An earlier version of this table offered it as an alternative to the row above, which would have sent the operator round the loop twice and then reached for `--no-verify` |
| This skill sets either variable | — | **Never.** § Prohibited. Setting it answers the hook's own question on the operator's behalf, which is the thing the gate exists to prevent |

There is no fifth mechanism to fall back to, and looking for one is the failure mode: an absent
terminal moves the question, it does not delete it (`rules/git-workflow.md` § Push safety).

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--timeout <min>` | CI watch timeout in minutes | 10 |
| `--force-with-lease` | Use `--force-with-lease` instead of regular push | off |
| `--set-upstream` | Set the branch upstream (first push of new branch). Written as two `git config` keys after a successful push, not as `-u` on the push — see Phase 2 | auto-detect |

**`--force` is NOT supported.** Force push is always forbidden.

## Prohibited

```
- Executing git push WITHOUT prior user approval via AskUserQuestion
- Suggesting or executing git push --force (ever)
- Executing or offering to approve git push --force-with-lease onto a protected branch (main/master/develop/release/*) — hard abort in Phase 0, re-asserted in Phase 2
- Pushing to protected branches WITHOUT explicit user pre-approval via AskUserQuestion
- Setting ALLOW_PUSH_PROTECTED=1 (this skill must NEVER set this env var; it is reserved for manual developer use only)
- Pushing without `-u GIT_EXEC_PATH` in the `env -u` prefix, or letting an inherited `GIT_EXEC_PATH` through. It selects the `git` the pre-push gate itself runs — git prepends its exec-path to PATH for hooks — so an ambient one lets the caller answer the gate's ancestry question with a binary of their choosing. Measured: a forced update past both gates, exit 0, no prompt
- Pushing without the `GIT_*` half of the `env -u` prefix, or letting any of those through. They select the configuration and the ancestry this push resolves against, and the gate resolves the same ones: `GIT_CONFIG_COUNT` + `core.hooksPath=/dev/null` deletes the gate, `url.<host>.insteadOf` redirects the approved refspec to another server, and `GIT_GRAFT_FILE` leaves the gate running while making a rewrite answer "fast-forward". Measured: `main` force-updated with exit 0 and no prompt under the first; the same push refused under the prefix
- Executing any push form without the `env -u BASH_ENV -u ENV` prefix (it is what stops a startup file from re-setting, inside the hook's own interpreter, the bypass variables the line just cleared)
- Setting ALLOW_FORCE_UNSHARED=1, **or letting an inherited one through** (same rule, same reason: it attests that a branch is not shared, which is a fact only the operator has. A skill setting it would be answering its own question; a skill passing an ambient one along lets a shell answer it. Phase 2 clears both bypass variables on every push form)
- Pushing when `remote.origin.receivepack` is configured, or emitting `--exec` / any `--receive-pack=` value other than the exact literal `git-receive-pack`. The flag names the program that receives the objects, and a program can ignore the repository the URL named — so a *chosen* value makes the destination digest true and meaningless at the same time. The canonical value is the opposite: it pins git's own default onto the command line, where it overrides configuration, which is what closes the window between the check above and the push (measured 2026-08-22 — `-c remote.<name>.receivepack=` does not override; the flag does)
- Printing the value of `remote.origin.receivepack` anywhere. It is a command line and may carry a token; report only whether it is set
- Pushing without `SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST"` on the push line. The direction is the opposite of the two ALLOW_* rules above and the contrast is the point: those attest a fact only the operator has, so this skill must never set them; this one is a constraint the skill puts on its own push — it names the destination the approval covered and can only cause a refusal, never an authorization. Omitting it leaves the destination checked in one process and pushed in another, which is a window, not a check. Setting it inline is also what stops an inherited value from deciding
- Auto-triggering this skill (disable-model-invocation: true)
- Skipping preflight checks
- Skipping `/watch-ci` delegation after successful push
```

## Verification

- [ ] Preflight passed (branch + remote + commits + `pre-push` gate detection)
- [ ] Push plan stated the **conditional** credential rule and the probe's limits — never a credential verdict (§ Phase 0: the probe reports `PUSH_GATE=referenced`, and reference is not invocation; which credential actually authorized is known only from whether the `/dev/tty` prompt appeared)
- [ ] User approved push via AskUserQuestion
- [ ] Push executed successfully
- [ ] CI monitoring delegated to `/watch-ci` with correct SHA + branch

## Examples

**These examples name which branch of the Phase 2 assembly runs. They do not restate the command,
and nothing here is copy-pasteable.** An example that spells out a push is a second copy of the
command, and a second copy drifts: measured — after Phase 2 gained `--force-if-includes`, the
option separator and the full refspec, the example below still read
`git push --force-with-lease origin feat/rebase-cleanup`, which is the bare-lease overwrite path
Phase 2 exists to close. The digest pin did not catch it, because a digest proves the bytes were
reviewed, not which of two conflicting instructions the reader follows. Phase 2 is the only place
in this file where a push is written out; `test/skills/push-ci.test.js` pins that.

**Every example below reads its credential off the matrix above — it does not restate the rule.**
**Two** of these four are row 2, where the approval in this session is the only approval there will
be, whether or not `PUSH_GATE` reported `referenced`. The third is the force row — the one cell
where an installed hook does prompt on an unprotected branch — and the fourth is row 1. Counting
them is not bookkeeping: an example mislabelled row 2 is an example that tells its reader no
terminal prompt is coming, which is how the force example below came to contradict the matrix it
sits under.

```
Input: /push-ci
Phase 0: Preflight — branch feat/auth, 3 commits ahead, remote OK, PUSH_GATE=referenced
Phase 1: Show plan — row 2, so L2 authorizes: an installed hook exits without prompting on an
         unprotected push, leaving nothing stronger to defer to → user approves
Phase 2: Phase 2 assembly — non-force branch, upstream already set
Phase 3: /watch-ci --sha <HEAD> --branch feat/auth (Monitor streaming — receive progress notifications)
```

```
Input: /push-ci --timeout 15
Phase 0-1: Same as above, same row and same credential
Phase 2: Phase 2 assembly — non-force branch, upstream written by the auto-detect after the push
Phase 3: /watch-ci --sha <HEAD> --branch <branch> --timeout 15
```

```
Input: /push-ci --force-with-lease
Phase 0: Preflight — feat/rebase-cleanup is not protected → continue (a protected branch hard-aborts here)
Phase 1: Show plan naming the force form — the FORCE row, not row 2: `ALLOW_FORCE_WITH_LEASE=1`
         clears the non-fast-forward refusal but not the unshared attestation, so the hook reaches
         /dev/tty and asks whether anybody else works on feat/rebase-cleanup. With the hook
         installed that terminal answer is the authorization and this approval is advisory;
         without it, this approval is the whole of it → ask the unshared question here (Phase 1),
         then user approves
Phase 2: Phase 2 assembly — lease branch, so both lease flags and ALLOW_FORCE_WITH_LEASE=1
Phase 3: CI monitoring
```

```
Input: /push-ci (on main branch)
Phase 0: Preflight — ⚠️ "main is a protected branch" → AskUserQuestion pre-approval
User: Continue → proceed
Phase 1: Show plan → user approves push. This is the one row-1 example, so the credential depends
         on a fact Phase 0 cannot establish: if the hook really runs, /dev/tty decides and this
         approval was advisory; if `PUSH_GATE=referenced` was a script that only names the gate,
         no prompt appears and this approval was the whole of it
Phase 2: Phase 2 assembly — non-force branch
Phase 3: /watch-ci (Monitor streaming — receive progress notifications)
```
