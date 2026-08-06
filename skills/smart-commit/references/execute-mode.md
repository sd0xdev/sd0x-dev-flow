# Execute Mode — Runtime Validation & Post-commit Detection

`--execute` runs a checked-in script, `skills/smart-commit/scripts/smart-commit-execute.sh`. This
file explains what it does and why; it deliberately carries **no copy of the procedure**.

All three bundled scripts carry the skill name in their basename, and that is not decoration:
`/install-scripts` flattens every skill's `scripts/*` into one `.claude/scripts/` directory, so a
future skill shipping its own `execute.sh` would silently overwrite this one. Overwriting the
policy enforcer with a different skill's script is the same failure class as pointing a variable at
a permissive guard — which is the thing this whole file exists to prevent.

## How the skill drives it

`$EXECUTE` is resolved repo-relative, installed copy first — `$REPO_ROOT/.claude/scripts/smart-commit-execute.sh`,
then `$REPO_ROOT/skills/smart-commit/scripts/smart-commit-execute.sh` — the same order and the
same reason as the guard: **no variable may name the thing that enforces policy**. Not found is
a hard stop pointing at `/install-scripts`, never a fallback to assembling the procedure inline.

```bash
/bin/bash -p -- "$EXECUTE" alloc
# → prints a path; write the Step 5b message into it with the Write tool
/bin/bash -p -- "$EXECUTE" commit <msg-file> [--ai-co-author] [--sign|--no-sign]
/bin/bash -p -- "$EXECUTE" verify-last [<commit-ish>] [--ai-co-author]
```

Each of those is a separate tool call and therefore a **separate shell**, so `$EXECUTE` does not
survive from one to the next — the Write tool sits between the first two. Every fence repeats the
locator, or substitutes the absolute path the locator produced. `"$EXECUTE"` in a shell that never
assigned it runs `bash` with an empty script path, or with whatever the caller happened to export.

### Why the entrypoint is spelled `/bin/bash -p --`

Both halves are load-bearing, and they defend different things.

`-p` defends *what runs after the process starts*. Handing a script to bash as an argument bypasses
its `#!/bin/bash -p` shebang, and `$BASH_ENV` is sourced before the script's first line — before any
hardening the script performs on its own behalf. Measured: with `BASH_ENV` pointing at a file
containing `exit 0`, the invocation returned status **0 having executed nothing**, which the caller
reads as a successful commit. `-p` makes bash ignore `BASH_ENV` outright.

The **absolute path** defends *which program starts at all*, and `-p` cannot help there, because it
only takes effect once the intended bash is already running. A bare `bash` is resolved by the
caller's shell. Measured, both of these answered the entire command with status 0 while the policy
script never started:

| Shadowing vector | Result |
|------------------|--------|
| A `bash` shim earlier on `PATH` | status 0, `SHIM-RAN`, nothing allocated |
| An exported `bash` shell function | status 0, `FUNC-RAN`, nothing allocated |

Neither is exotic — either could equally have run `git commit -F <msg-file>` itself with an
attribution-bearing message, which is precisely the anchor this script exists to hold.
`skills/create-pr/SKILL.md` pins its own entrypoints for the identical reason; this file did not,
and that was the gap.

The script is **not** reached through `scripts/run-skill.sh`: it establishes privileged mode itself
and needs nothing from the runner but a path, and every layer that can be removed from a policy
entrypoint is one fewer place for a bypass to live.

There is no `env -u` prefix here, and that is not an omission — the script unsets the same list
process-wide at its own first lines, so prefixing would apply one policy twice rather than add a
second.

### Subcommands, exit statuses, and who owns the message file

`commit` validates, commits, **verifies the history its own commit added**, and removes the message file. Not "everything it recorded" — see § What this cannot do for what that traversal does and does not bound. Ownership
of that file starts when the file starts being consumed: a usage error (unknown flag, both sign
flags, missing file) returns before that and deliberately leaves it, so the caller can fix the call
and retry without re-allocating. From that point on removal is *attempted* on every path, including a
signal — cleanup is an `EXIT` trap, because SIGINT during the guard or during `git commit` would
otherwise leave the full commit message on disk.

**Attempted, not guaranteed**, and the difference is stated because the earlier wording claimed the
guarantee: if `rm` itself fails, the sweep reports the path on stderr and returns non-zero. What it
does *not* do is change the run's exit status. A commit that succeeded did succeed, and reporting
failure because a temp file survived would be the larger lie — so the leftover is announced by name
and left actionable rather than converted into a false verdict about the commit.

A path is dropped from the sweep set the moment it is genuinely removed. `rm -f` is idempotent about
a *missing* path but not about pathname **reuse**: between the explicit removal and the `EXIT` sweep,
another process can create a new file at that name, and a second unlink deletes theirs. A path is
retained only when removal *failed*, which is exactly when the trap should retry it.

`verify-last` is a **secondary** check for the skill's convergence pass; the primary one runs inside
`commit`. See § Verifying what was recorded.

| Status | Meaning | What the skill does |
|--------|---------|---------------------|
| 0 | Committed / verified clean | Continue to the next group |
| 2 | Usage error (bad flag, missing message file, two commit-ish operands) | Fix the call — nothing was consumed |
| 3 | `commit-msg-guard.sh` not found | Stop. Run `/install-scripts commit-msg-guard` |
| 4 | AI content refused, or leaked into the commit | **Stop all remaining groups**; see amend guidance below |
| 5 | `git commit` itself failed | Report git's output; do not retry blind |
| 6 | Repository root unresolvable | Stop |
| 7 | **Unverifiable**: message unreadable/empty on read-back, ref space unreadable, a **graft or shallow** file present, or a commit that appeared during the window carrying attribution that **no reflog entry ties to this invocation** | Stop — the commit is **UNVERIFIED** |

Statuses 3, 6 and 7 are fail-closed by design: unresolvable means unverified, never "probably
fine". An empty read-back is treated as unverified for the same reason — the guard reads an
empty file as a clean message, so the check would otherwise report on a commit it never read.

**Replace refs are not in that list, and the difference is worth being exact about.** Grafts and
shallow are *refused* — the script cannot verify through them, so it stops. Replace refs are
**neutralized**: every verification read goes through `git --no-replace-objects`, so the overlay
simply does not apply and the underlying object is what gets read. A repository holding a
perfectly ordinary replace ref therefore commits and verifies normally (status 0), and one where
a replace ref was masking an attribution-bearing commit returns **4** — the leak is seen, which
is the whole point of the flag. Listing replace alongside graft and shallow as a status-7 cause
was wrong in the direction that matters: it describes a refusal the script does not perform, on
a construct it already handles better than refusing would.

## Why this is a script

It used to be bash fenced in this file, which Claude translated into tool calls. Two classes of
defect came out of that shape, and neither was reachable by fixing the text:

| Property of the fenced form | Consequence |
|-----------------------------|-------------|
| Each fence is a separate tool call, so a separate **shell** | Every block re-derived the environment policy and the repository root. Answering that question twice is what let the validator and the commit disagree about which repository they meant |
| The artifact under review was **Markdown prose** | The only available check was a static analyser for bash embedded in a document — which cannot converge, because command resolution in bash is mutable at runtime (`hash -p`, `enable -n`, an exported function) and subshell scope belongs to an enclosing grammar the text does not expose |

As a script both disappear. One process means the environment policy is applied **once**, at the
top, as an `unset` — so "two answers" is structurally impossible rather than merely discouraged.
And the artifact is executable, so it is checked by **running** it: `test/scripts/smart-commit-execute.test.js`
drives real commits in throwaway repositories and asserts exit statuses, HEAD movement and
whether the message file survived.

The re-exec also strips `SHELLOPTS`, so an inherited `set -e` cannot reach the script at all —
the defence the fenced version needed against `errexit` exiting before a cleanup ran is now a
property of the entrypoint rather than a rule every block had to remember.

## The dispatcher

Every external command goes through `sd_run`, defined in `scripts/smart-commit-dispatch.sh`, which
permits exactly four names:

```
bash git mktemp rm
```

`sd_run curl …` exits 127 and says so. That matters because the allowlist stops being a claim a
reader has to verify by reading the whole caller and becomes a **runtime refusal a test can
assert directly** — plus one the test derives from the artifact
(`smart-commit-dispatch.sh --allowlist`) rather than restating, since a restated copy is exactly
what drifted last time.

**This is dependency routing, not a sandbox.** The allowlist matches the **first token only**, so
an allowlisted interpreter reaches anything it likes: `sd_run bash -c 'curl …'` runs `curl`, and
`git` alone can execute arbitrary code through its own config. What the list bounds is the set of
external programs the script *names*, which is what makes a new dependency visible in review. Any
reading of it as a containment boundary is a misreading.

`env` was on this list and has been removed. It was justified by the privileged re-exec at the top
of `smart-commit-execute.sh` — but that re-exec names `/usr/bin/env` by **absolute path** and runs
*before* the dispatcher is sourced, so no `sd_run env` call site ever existed. Listing it widened
the first-token surface (`sd_run env /bin/sh -c …` succeeded) for nothing.

`bash` is named by absolute path (`/bin/bash`) because it launches the policy script itself, and
launching the caller's `bash` would defeat the `-p` it is launched with. The rest resolve through
the caller's `PATH` deliberately: pinning them would override a homebrew or asdf `git` the
developer chose, and a caller who controls `PATH` already controls their own `git commit`.

### What the tests can and cannot see

Four oracles, each covering what the others structurally cannot:

| Oracle | Sees | Blind to |
|--------|------|----------|
| `sd_run` refusal tests | A non-allowlisted **name** reaching the dispatcher | A call site that never reaches `sd_run` at all |
| Execution trace | Which commands the flow **actually runs**, via `PATH` shims | Anything invoked by absolute path — `PATH` is not consulted |
| Absolute-path check | Every absolute path in **command position** in both scripts | Runtime-computed paths |
| Routing check | An allowlisted name invoked **without** `sd_run` in front | Runtime-computed command names |

The trace runs the whole flow with `PATH` containing nothing but shims for the four names, and
asserts the observed set is **exactly** the commands the flow needs. Equality matters: a filter for
"names outside the allowlist" would be vacuous, because only allowlisted shims exist to write to
the log in the first place. Its negative control removes `git` from the shim set and requires the
run to break — without that, the trace would pass just as happily for a script that invokes nothing.

The absolute-path check closes the trace's blind spot. Two absolute paths are legitimate and
enumerated: `/usr/bin/env` and `/bin/bash`, both in the bootstrap re-exec, which by construction
runs before the dispatcher exists. Any third is a finding. It keys on **command position**, not on
a list of blessed directories — an earlier version matched only `bin`/`sbin` layouts, so `/tmp/curl`
and `/usr/libexec/helper` walked straight past it while bypassing `PATH` just as effectively. All
three are mutation controls now.

The routing check exists because the other three share a blind spot: replacing `sd_run git` with a
bare `git` produces an **identical** trace (the shim logs the same name either way), introduces no
absolute path, and never reaches the dispatcher to be refused. Nothing else can see it, and it is
the exact mutation that would quietly retire the allowlist. Its control is that mutation.

The general rule this keeps re-teaching: for every assertion, name the change to the artifact that
would make it fail. If no such change exists, the assertion is decoration — and it is *worse* than
nothing, because it reads as coverage.

## Why the guard is invoked rather than re-implemented

An earlier version re-implemented the attribution patterns here as a `validate_msg()` function.
Three defects came from that one decision, and all three were found by review rather than by use:

| Defect | Consequence |
|--------|-------------|
| `grep … && return 1` per check | grep exit status **2** (execution error, missing file, bad `GREP_OPTIONS`) read as *clean* — fail-open |
| Whitelist stripped with `grep -Eiv` | `co-authored-by: claude <NOREPLY@ANTHROPIC.COM>` counted as the permitted line here, while the hook's byte-exact `grep -Fxv` counted it as attribution |
| A second copy of the pattern table | Drift between this file and `scripts/commit-msg-guard.sh` was invisible — the tests re-implemented the copy instead of reading it |

The fix is not a better copy. **Runtime validation runs the canonical enforcement point itself** —
the same `scripts/commit-msg-guard.sh` the commit-msg hook runs, which already establishes bash
privileged mode, pins `PATH`, clears `GREP_OPTIONS`, forces `LC_ALL=C`, and aborts on any grep
status other than 0/1.

**No environment variable names the validator.** Note the exact scope of that claim: no variable
*is* the path, and the `GIT_*` variables that could repoint the repository, tree, index or object
store out from under it are unset process-wide at the top of the script (see
`git-environment.md` § 1 for the list and the exact scope of the claim). What remains is `git`
and any other utility resolved through the caller's `PATH` — authority they already hold over
their own shell, and over `git commit` too, so it buys nothing here. An earlier draft was weaker
than that: it searched `${CLAUDE_PLUGIN_ROOT}/scripts/commit-msg-guard.sh` before the in-repo
paths. That is an environment-selected policy source — `CLAUDE_PLUGIN_ROOT=/attacker` with a
two-line `exit 0` script there passes every message, at both checks, with no other blocker when
the hook is not installed. It is the same mistake `sanitize-pr-content.sh` refuses by design:
"a variable that swaps the policy for a weaker one is, at runtime, indistinguishable from an
attack". Resolution is therefore repo-relative only, `.claude/scripts/` before `scripts/`.

## The narrow whitelist

`ALLOW_AI_COAUTHOR=1` is **not** a bypass: the guard removes only the exact line
`Co-Authored-By: Claude <noreply@anthropic.com>` (byte-exact, `grep -Fxv`) and applies every
other pattern to what remains. It enforces the whitelist's *content*; a plain environment
variable cannot prove the exception's *provenance*, which is why the variable is stripped by
default rather than merely left unset.

The opt-in is re-added **inside a subshell, per call** — around the guard, and around the
`git commit` — and only when the flag was passed. It is never exported process-wide, so on the
default path nothing this script runs ever sees it.

`git commit` must be one of those calls. The recommended installation puts the canonical guard in
as the repository's `commit-msg` hook, and that hook reads `ALLOW_AI_COAUTHOR` to permit the one
whitelisted line. An earlier version withheld the variable from `git commit` on the theory that
narrower is safer; the effect was that **`--ai-co-author` did not work at all** wherever the
recommended hook was installed — the hook rejected the exact line the flag exists to allow and the
commit failed with status 5. Narrower was not safer, it was broken, and the test that asserted the
hook saw `unset` was pinning the breakage in place.

Three directions are pinned by tests, and the third is the one that was missing: an inherited
`ALLOW_AI_COAUTHOR=1` does not turn the opt-in on; without the flag no hook sees the variable; and
with the flag, against the **real guard installed as the hook**, the whitelisted line commits while
`Generated by Claude` in the same fixture is still refused.

## Message file handling

`alloc` uses `mktemp` with `--`, so the template can never be read as an option: `TMPDIR` is
inherited input and its expansion sits at the front of the word, so `TMPDIR=-d` would otherwise
make the argument `-d/smart-commit-msg.XXXXXX`. The file is created atomically, unpredictably
named, mode 0600.

A fixed path such as `/tmp/smart-commit-msg-1.txt` would collide between concurrent runs, could
be pre-created as a symlink so the Write step overwrites the link target, and could be
pre-created world-readable so the whole commit message leaks. A heredoc is worse still: a fixed
`<<'EOF'` delimiter is injectable, because a message containing a line that is exactly `EOF`
ends the heredoc and the remainder is read as shell.

There is a residual window between the guard's read and git's; it is stated in § What this cannot
do rather than claimed away here.

## Verifying what was recorded

`commit` validates a **file**; only reading the commit back verifies the **commit**. Those are not
the same object, and a `commit-msg` hook sits between them with the ability to rewrite the message
after validation. That is not hypothetical — a hook appending `Co-Authored-By: Claude` produces a
commit carrying attribution that every file-level check passed.

So `commit` verifies in-process. It examines **everything that became newly reachable** across
the ref space — not a line from the old HEAD to the new one — and then splits that set by whether
the new HEAD reaches it, because *newly reachable* and *made by this operation* are different
questions:

```
before_tips = every ref, + HEAD          → refuse if the ref space is unreadable
                                        (empty in an unborn repository, which is not an error)
git commit …
refuse again if info/grafts now exists  → post-commit ran in between
after       = HEAD                      → refuse if unreadable, or if after == before
after_tips  = every ref, + HEAD          → refuse if unreadable
for each oid in rev-list <after_tips> --not <before_tips>:
    run the guard against `git log -1 --format=%B <oid>`
```

Anchoring on the ref space rather than on HEAD is what makes the check independent of *where*
a hook decided to leave things, and the reason is that two different attacks defeat a
HEAD-anchored range. Both were reproduced:

| What the hook does | Why `before..after` misses it |
|--------------------|-------------------------------|
| **Stacking** — commit the leaking message, then commit a clean one on top | The leaking commit is no longer HEAD, so a `log -1` check reads the clean one. Measured against a `commit-msg` hook injecting the trailer plus a `post-commit` hook adding a clean commit: HEAD-only returns **0** with the trailer sitting in history, the ref-space range returns **4** naming the OID |
| **Diversion** — park the leaking commit at `refs/keep/x`, build a clean commit on its *parent*, move the branch there | `before..after` contains only the clean commit, while the leaking one stays reachable from `refs/keep/x` |

Snapshotting all refs catches both. It does **not** establish that nothing else was created — see
§ What this cannot do, which corrects an earlier version of this document that claimed it did.

**Newly reachable is not the same question as "made by this operation", and the verdict depends on
which one is being answered.** A `git fetch` — from a hook, or from another terminal mid-operation —
makes a teammate's commits newly reachable. Blaming those on the developer produced a status 4 on
their own clean commit, reporting a leak that never happened; and refusing valid work with a false
accusation is how a check gets switched off. Excluding `refs/remotes/` by name was the first attempt
and it was on the wrong axis: a fetch **auto-follows tags**, so the new `refs/tags/` tip carries the
same history straight back in. No namespace filter survives that.

Ownership is therefore decided by a **per-run reflog marker** — evidence of what this invocation
actually created, rather than an inference from what the resulting history happens to reach. The
mechanism, its measurements and the full verdict table are in § What this cannot do, under
*Ownership is decided by a per-run reflog marker*.

Every one of those reads goes through a single helper that pins `--no-replace-objects`, so no
verification path can forget it. Git's object reads are **replace-aware by default**: a
`post-commit` hook can build a clean commit object and run `git replace <recorded-oid> <clean-oid>`,
after which `git log <recorded-oid>` returns the *substitute* while the attribution-bearing commit is
what actually gets pushed — the replacement ref is local and does not travel. Reproduced: without
the flag the read returns `feat: clean` for a commit whose real message carries the trailer. A flag
rather than `GIT_NO_REPLACE_OBJECTS` on purpose — this script's whole contract is that no
environment variable decides what policy sees.

`after == before` is its own refusal (status 7, UNVERIFIED). `git commit` reporting success while
HEAD did not move means the commit went somewhere this process cannot see, and "cannot see" is
never resolved as "clean".

`verify-last [<commit-ish>]` remains, as a secondary check for the skill's own convergence pass and
for inspecting a commit by hand. It is no longer the last line of defence, because a check that
runs after the fact can always be outrun by a hook that runs during it.

It takes **at most one** commit-ish. A second operand is a usage error (exit 2), not a silent
decision: extra operands used to overwrite each other, so `verify-last <leaking-oid> <clean-oid>`
returned 0 having checked only the clean one. A verifier that quietly checks something other than
what it was handed is worse than one that refuses.

## What this cannot do

Stated plainly, because the failure mode of a security doc is a reader who believes it covers
more than it does.

**A hook runs with the user's full authority, and this script cannot contain that.** It can
verify what exists in the repository at the moment it looks. It cannot stop a hook that
`git push`es before verification runs, or that schedules work for after this process exits, or
that modifies a *different* repository. Anything in that class is outside what a
verify-after-commit design can reach at all — the answer there is the `commit-msg` hook itself,
which runs *before* the object is written, and `/install-scripts commit-msg-guard` is why it is
recommended rather than optional.

**Ref reachability is not an object-creation boundary, and the snapshot must not be read as
one.** "A commit that can be pushed is reachable from some ref" was asserted here and in the
script, and it is false. Measured: reset a branch so a commit is reachable from no ref and
absent from `rev-list --all`, and `git push . <oid>:refs/heads/probe` still succeeds. So a
`post-commit` hook can keep the leaking commit alive out of band — `ORIG_HEAD`, a reflog entry,
a gitlink, a plain file holding the hex — build a clean commit on the old parent, and this
traversal sees only the clean one. Also outside the snapshot: pseudorefs, other worktrees, and
anything created *after* `after_tips` is taken. The observation is not atomic.

That gap is not closable from here, and the reason matters more than the gap. Reaching it takes
an adversary already executing arbitrary code in the repository — and such an adversary can push
the leaking commit directly, before this process is ever scheduled again. No check that runs
after the commit can contain something that does not wait for it. Closing it properly would mean
constraining the commit to a trusted hook set (`core.hooksPath`), which would also disable the
developer's own `pre-commit` hooks — a contract change, not a patch, and not one to make
silently. **What this design defends against is accidental and incidental attribution leakage —
a generated trailer, a message-rewriting hook, a stale template — plus the specific masking
mechanisms named below. It is not a containment boundary against hostile local code.**

**Ownership is decided by a per-run reflog marker, not by reachability from HEAD.** Before
committing, the script generates `RUN_MARKER` and exports it as `GIT_REFLOG_ACTION` on — and only
on — the `git commit` call. Git writes that string as the prefix of the reflog entry for the
commit it creates, so afterwards `git reflog` distinguishes *what this invocation made* from
*what merely appeared*. Measured: a marked entry reads `sd0x-exec-…: <subject>` while a
concurrent commit reads `commit: <subject>`, and the discrimination holds for an initial commit
on an unborn branch, for a detached HEAD, and with `-F`.

This replaced HEAD-reachability, which was wrong in the direction that costs the most. If another
process advances the checked-out branch between this script's `git commit` and its
`rev-parse --verify HEAD`, that commit *is* reachable from the HEAD actually observed and *is*
absent from `before_tips` — so reachability reported it as a leak by this commit: a status 4
naming a stranger's work, whose recovery guidance is "amend it". An earlier revision of this
document asserted that no evidence to separate the two existed inside a single process. That was
wrong, and the marker is the counter-example.

| Case | Verdict | Why |
|------|---------|-----|
| Commit `git commit` made, carries a trailer | **4** — leak | its reflog entry carries this run's marker |
| Commit a **hook** made with `git commit`, carries a trailer | **4** — leak | the hook inherits the marker, and a commit it makes because of this one belongs to this operation |
| Commit a hook made **without moving this HEAD** — `commit-tree` + `update-ref`, or a commit in another worktree | **7** — UNVERIFIED | neither writes an entry to *this* HEAD reflog, so the marker never appears however the commit was caused |
| Concurrent commit on the branch | **7** — UNVERIFIED | no entry ties it to this invocation |
| Fetched commit or tag | **7** — UNVERIFIED | made in another repository; no local entry at all |
| A **trailer-bearing** commit, when the reflog cannot be read | **7** — UNVERIFIED | ownership unestablished fails closed |
| A **clean** commit, when the reflog cannot be read | **0** | nothing to attribute: the read is only ever consulted to decide *whose* leak it is |

Both failure directions still stop the run; only the wording and the guidance differ, and that
difference is the point — status 4 says "your commit leaked", status 7 says "inspect this OID".
The residue is stated rather than claimed away: a status 4 does **not** imply the offending
commit is at HEAD (a hook can park it on a side ref), so amend guidance is correct only when the
named OID *is* HEAD. And if `logs/HEAD` does not exist at all — a repository whose reflog was
never created — nothing is provably ours and every trailer-bearing commit reports 7. An existing
reflog keeps recording even under `core.logAllRefUpdates=false`, which was measured, so that
window is narrower than the config alone suggests.

The marker is generated per run rather than fixed, and that is load-bearing rather than tidy: a
constant would make every past and concurrent run of this same script indistinguishable from this
one, so one run would claim another's commit — the same misattribution, one level up. It is built
from `$$` and `$RANDOM` because the dispatcher allowlist is `bash git mktemp rm` and widening it
to generate a nonce would cost more than it buys. Unpredictability is not the property needed:
forging the marker makes a foreign commit report as a leak (abort), and failing to match it makes
a real leak report as UNVERIFIED (also abort) — both stop, so only uniqueness matters.

**Ancestry and configuration can also be redirected through the environment, and the scrub list
is no longer hand-picked.** An earlier list covered the repository root, index and object store and
still missed two channels. `GIT_GRAFT_FILE` points ancestry at an arbitrary file, so the
`info/grafts` refusal below sees a clean repository while `rev-list` walks rewritten parentage —
measured: two new commits become one, hiding the leaking one. `GIT_CONFIG_PARAMETERS` injects
arbitrary config process-wide — measured: `git config user.email` returned an attacker-chosen
address, and the same channel reaches `core.hooksPath` and `commit.gpgsign`. Everything
`git rev-parse --local-env-vars` names is now scrubbed, and a test asserts that coverage against
git itself, so a future Git adding a variable fails loudly rather than silently. `GIT_SHALLOW_FILE`
is scrubbed with them, and on the strength of a demonstrated attack: an earlier revision of this
document claimed a non-shallow repository ignores `.git/shallow`, and that claim was wrong. It was
reached by writing the commit's *parent* into the file and seeing nothing change. Writing the
commit **itself** is what bites, because every OID listed there becomes a traversal ROOT rather
than a boundary below it — measured, `git rev-parse HEAD > .git/shallow` then
`git rev-list --count HEAD` drops from 3 to 1. A leaking parent is then never walked.

**Three local ancestry overlays are handled, and they are handled differently.** Replacement
objects are neutralized (`--no-replace-objects` on every read-back). The two file-based
overlays — `info/grafts` and `shallow` — are **refused** by `refuse_on_ancestry_overlays`,
because each changes what `rev-list` treats as already reachable and `--no-replace-objects`
covers neither: grafts rewrite parentage outright, and `shallow` turns every OID it lists into a
traversal root (measured above). Either file being non-empty aborts with
exit 7 rather than producing a verdict, because a verdict computed over rewritten ancestry is
not a verdict. For `shallow` the refusal is deliberately unconditional rather than "refuse only
if we did not clone shallow": a genuine shallow clone cannot be verified by this script either,
so the honest answer there is also "commit from a full clone", not a narrower traversal.

The refusal runs **twice** — before `git commit` and again immediately before the traversal —
because `post-commit` runs between them and can install either masking file in that window;
checking only on the way in left it open, and that was reproduced for both, not theorised. Two
checks narrow the window; they do not make it atomic. A failure to even *resolve* one of the
paths is status 7, not "no overlay".

Both paths go through `resolve_git_path`, which exists for a reason worth stating: `git rev-parse
--git-path` returns a **repository-relative** path (`.git/shallow`), and a relative path is
resolved by the shell against the *caller's* current directory. Launch the executor from a
subdirectory and a bare `[ -s "$(git rev-parse --git-path info/grafts)" ]` tests a file that does
not exist — the check passes while the graft sits there working. `resolve_git_path` anchors any
relative answer to `$ROOT` and passes an absolute one through untouched.

**`ALLOW_AI_COAUTHOR=1`, when the opt-in is used, is inherited by everything that
`git commit` launches** — not only `commit-msg`, but every hook and subprocess in that call.
That is required for the canonical hook to honour the exception, and nothing else in this
project reads the variable, so it is currently inert elsewhere. It is written down here because
"scoped to the guard" would be the natural assumption and it is not true.

**The message file has a residual window.** The guard and `git` each open it, so a same-user
process could swap the contents in between. `mktemp`'s unpredictable name and 0600 mode make
that impractical, not impossible; the read-back is what catches it if it happens.

## On a leak

Status 4 means a leak reached the commit — from `commit`'s own verification, or from
`verify-last`. The run stops there:

1. **Immediately stop** all remaining commit groups (do NOT continue to the next group)
2. **Read the OID the diagnostic named, and compare it with HEAD, before saying anything about
   amending.** `git commit --amend` rewrites **HEAD** — it does not rewrite the commit named in
   the message. The two are frequently not the same one: a `post-commit` hook that builds
   another commit and moves the branch leaves the leaking commit off to the side, and the
   executor reports *that* OID because that is the one carrying the trailer. Test
   `a graft installed by the POST-commit hook is refused, not traversed through` and its
   parked-commit sibling are exactly this shape. Offering `--amend` there rewrites an innocent
   commit and leaves the leak untouched — with the message now claiming it was handled.

3. **Every command involved carries the § 2 form** — the literal `env -u …` prefix and
   `-C '<REPO_ROOT>'`. This is not decoration on a diagnostic: the comparison *decides* whether
   amend guidance is offered at all, so an inherited `GIT_DIR` would let the executor commit
   repository A and then answer "is it HEAD?" from repository B — and offer `--amend` against
   the wrong repository's HEAD. A command that decides something has to be at least as
   repository-safe as the one it is deciding about. `<PREFIX>` below is
   `git-environment.md` § 1's list, written out literally — which is now how that list is
   written everywhere, executed or printed.

| `<sha>` vs `<PREFIX> git -C '<REPO_ROOT>' rev-parse HEAD` | What to output |
|--------------------------------|----------------|
| Equal | Amend guidance below |
| Different | **No amend guidance.** Show where the commit actually lives, and say the leak is not at HEAD |

When, and only when, they are equal:

```
❌ AI attribution leaked in commit <sha> (= HEAD). Remaining commit groups ABORTED.
   The guard reported the offending line numbers above (content withheld).
   To fix (manual): run [amend] from § Recovery commands.
   To prevent: /install-scripts commit-msg-guard, then cp .claude/scripts/commit-msg-guard.sh <hooks-path>/commit-msg
```

When they differ:

```
❌ AI attribution leaked in commit <sha>, which is NOT HEAD. Remaining commit groups ABORTED.
   Amending would rewrite a different commit and leave this one as it is.
   Where it lives: run [where-1] and [where-2] from § Recovery commands.
   Inspect it first; the correct repair depends on what references it.
```

### Recovery commands

**Every paste-ready recovery git command is a line of the block below. The one git command
outside it is the pinned HEAD comparison in the decision table above — and there are no others.**
That is the whole contract, exceptions included, because an exception left out of the sentence is
how the previous two versions of it came to be false. The output templates name commands by
label, and only this block spells them out. It exists because the earlier arrangement mixed
commands into the templates, so the test guarding them had to guess which lines were commands,
and it guessed by looking for the prefix — which meant a command written *without* the prefix was
never in scope.

The contract is about **git**, and deliberately so: what an inherited `GIT_DIR` redirects is git,
which is why every git invocation here carries the prefix and the `-C` pin. The prevention line in
the templates above (`/install-scripts …`, then `cp …`) is not git, does not run against the
repository under repair, and is not covered by this block. Every git mention anywhere in this
section is enumerated in `test/scripts/smart-commit.test.js` (F1r) — adding one fails the test
until it is listed there, so a new git command cannot be introduced without a decision about it.

Each line: `<PREFIX> git -C '<REPO_ROOT>' … # [label]`. The prefix and the `-C` pin are not
decoration on a diagnostic — see point 3 above. The label is a **trailing shell comment**, and
that placement is the point: a leading `[amend]` is a command word, so `[amend] git …` is not
paste-ready at all — it exits 127 before git runs. A line that says "paste this" must survive
being pasted.

```
<PREFIX> git -C '<REPO_ROOT>' commit --amend                       # [amend]
<PREFIX> git -C '<REPO_ROOT>' branch -a --contains <sha>           # [where-1]
<PREFIX> git -C '<REPO_ROOT>' for-each-ref --contains <sha>        # [where-2]
```

`<PREFIX>` is:

```bash
env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR
```

**Do NOT auto-amend.** Amending is a destructive git operation reserved for the developer.
