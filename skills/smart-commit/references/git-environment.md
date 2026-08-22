# Git Environment Policy

Two rules, one question: **which repository, tree, index, ancestry and configuration does this
command act on?** The first governs what `/smart-commit` executes; the second governs what it
prints for the user to execute. They are separate because they run in separate shells, at
separate moments.

The list below is wider than "the variables that repoint the repository", because a variable does
not have to repoint the repository to make an answer untrustworthy: `GIT_CONFIG_PARAMETERS`
leaves every path alone and still overrides `user.email`, `core.hooksPath` (where the
AI-attribution guard lives) and `diff.external`; `GIT_GRAFT_FILE` and `GIT_SHALLOW_FILE` are the
ancestry equivalent. The earlier, narrower framing and how it was wrong:
[../../../docs/features/smart-commit-hardening/4-implementation.md](../../../docs/features/smart-commit-hardening/4-implementation.md) § 1.

## 1. What the skill executes

Every git command the skill runs itself — read or write, either mode — resolves against the same
stripped environment. **Where the stripping happens depends on the callee**, per the table below:
a fence running `git` inline carries the prefix, and so does a delegation to a helper that does
not strip for itself; a helper that strips the same list internally is **not** prefixed. The
prefix, written out **literally**:

```bash
/usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR
```

Test IDs below live in two suites with separate namespaces: `F*` in
`test/scripts/smart-commit.test.js`, `P*` in `test/scripts/smart-commit-inspect.test.js`.

**Spelled `/usr/bin/env`, absolutely.** A bare `env` contains no slash, so bash resolves an
imported `BASH_FUNC_env%%` function before `/usr/bin/env` — and a forged function ignores every
`-u`, which is the whole prefix. `command env` is no better: `command` is a builtin and functions
outrank builtins. A word containing `/` cannot be **imported** as a function name — bash refuses,
with `error importing function definition for '/usr/bin/env'` — so the absolute path is the only
spelling that survives a function arriving through the *environment*.

That is the boundary, and it is not immunity. Measured 2026-08-22: a `$BASH_ENV` file containing
`function /usr/bin/env { … }` is sourced before the first line of a non-interactive shell, defines
that exact name in **that** shell, and intercepts the prefix — the child printed `HIJACKED`. Only
`bash -p` refuses the sourcing (measured `SAFE`), and a fence in a skill document cannot choose its
interpreter's flags. The residual is bounded rather than alarming: a shell already sourcing
attacker-chosen code forges `git` at the same cost, so nothing a fence asserts survives that world
anyway. What the prefix buys is the vector an unrelated parent process can reach — which is the one
that actually gets reached.

**Literally, and never through a variable.** `GIT_ENV="env -u …"` followed by `$GIT_ENV git …` <!-- retired-form-ok -->
reads better and does not work: zsh does not split an unquoted expansion into words, so the whole
string is looked up as one command name and the fence dies at its first line. Writing the list out
has a second effect worth keeping: there is no variable left for a caller to have exported.
Measurements across four shells: 4-implementation.md § 2.1.

**The supported shells are bash and zsh.** `dash` is not one: the sentinel strip below uses
`${REPO_ROOT%$'\n'}`, and ANSI-C quoting is a bash/zsh extension dash does not implement, so
`REPO_ROOT` keeps its trailing newline. As the fences are written today that fails **closed** — in
the thirteen locator fences the root derivation itself succeeds, then both locator arms name a
path that does not exist and the fence refuses before running any of the git commands the
diagnostic is *for*; the fourteenth has no locator and exits 127. All fourteen print nothing to
stdout. That is a property of the current shape, not a guarantee of the design: the previous shape
failed *open* under dash, returning a wrong signing verdict at exit 0. So it is re-measured rather
than remembered — `F1l` (bash and zsh: the fences work) and `F1p` (dash: every fence fails loudly
and prints no answer) in `test/scripts/smart-commit.test.js`. `/bin/sh` proves nothing on its own;
it is bash on some systems and dash on others. The measurements, the flip, and the POSIX strip
that would lift the limit but is deliberately not used: 4-implementation.md § 2.

Every fence derives the root once and pins each command to it:

```bash
REPO_ROOT=$(/usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
/usr/bin/env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u ALLOW_AI_COAUTHOR git -C "$REPO_ROOT" <subcommand> …
```

so planning, staging, diff reading, validation, the commit and the post-commit read-back all name
**the repository containing the current directory** and resolve every relative pathspec against
**its root**; a caller wanting another repository changes directory.

| Detail | Why it is not optional |
|--------|------------------------|
| Written out in **every** fenced block that uses it, and `REPO_ROOT` re-derived there | Each block is a separate shell, so nothing carries over. The literal form is what makes the first half self-evident — there is no name left to be unset, or to be whatever the caller exported. The second half is still a live hazard: an underived `REPO_ROOT` makes `-C ""` mean "wherever I happen to be" (or aborts under `nounset`) |
| `-C "$REPO_ROOT"` on **every** command, not just the ones that print | The single exception is the `rev-parse --show-toplevel` that derives it. Paths collected root-relative and then consumed by a command running elsewhere is the same defect as printing them unanchored — it just fails inside the skill instead of in the user's shell |
| The prefix goes on the **delegation** when the helper does not strip for itself | `git-profile.sh` runs its own git commands under the caller's environment; stripping at the boundary is what makes it and the fallback answer about the same repository |
| …and is **omitted** when the helper strips the same list itself | `smart-commit-inspect.sh` and `smart-commit-execute.sh` open with an `unset` of this exact list, each pinned **identical** to it by its own test — `P1` in `smart-commit-inspect.test.js` for the inspector, `F1i` in `smart-commit.test.js` for the executor. Prefixing them too would state one policy in two places, and the second is the one nobody maintains. Which kind a call site is depends on the **callee**, never on the call site |
| Applied to **all** of them, never some | Partial application replaces "the policy source was repointed" with "the policy source and the thing it protects are two different repositories" — see `create-pr-stacked/2-tech-spec/1-core-logic.md` items 36–37 |

Each rule below states what to do; the measurement it was derived from is one table in
[4-implementation.md § 7](../../../docs/features/smart-commit-hardening/4-implementation.md).

**The derivation carries a sentinel because `$( )` strips every trailing newline.** `git rev-parse
--show-toplevel` prints one pathname plus one record terminator and has no `-z` form, so a
repository root whose last component *ends* in a newline comes back truncated and every later
`git -C "$REPO_ROOT"` names a path that does not exist — or, worse, a different one that does.
Appending `printf .` inside the substitution, then removing the `.` and exactly **one** newline,
deletes the terminator and nothing else.

**The sentinel is joined with `&&`, never `;`, and the `||` belongs on the substitution itself.**
A substitution reports the status of its *last* command, so `git …; printf .` hands back
`printf`'s exit 0 whatever git did: the failure disappears, `REPO_ROOT` becomes empty, and every
later `git -C ""` quietly acts on the current directory. The two trailing parameter strips always
succeed, so a guard written after them never fires. Test `F1h`, with the `;` form as its control.

**The prefix contains only `-u`, never an assignment.** `env` stops parsing options at the first
`VAR=value`, so a `-u` written after one is taken as the *command to run* and the call dies with
exit 127. That is why `-u ALLOW_AI_COAUTHOR` lives in the prefix — every call strips it by
default — and the `--ai-co-author` opt-in re-adds `ALLOW_AI_COAUTHOR=1` **after** the prefix,
where an assignment following `-u` flags is legal and wins.

**Pathspec literality is per-operand, not environmental.** Every path operand is written
`':(literal)<path>'`, and the four `*_PATHSPECS` variables are stripped so that magic is honoured.
An exported `GIT_LITERAL_PATHSPECS=1` would have been the shorter fix and the wrong one — it
reaches the repository's own hooks. `:(literal)` binds to the operand and stops there.

**Scope of the claim.** The list has two parts. The first is **everything
`git rev-parse --local-env-vars` names** — derived by asking git rather than hand-picked, and
pinned against git's own output by `F1j`, so it cannot fall behind a git upgrade. The second is a
short, **explicitly listed** set that git's own list omits: the four `*_PATHSPECS` variables,
`GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL`,
`GIT_CONFIG_SYSTEM`, `GIT_EXTERNAL_DIFF` and the `ALLOW_AI_COAUTHOR` opt-in. Adding to the second part is a deliberate
edit; the first maintains itself.

**`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` are all stripped** (round 17
review, P2; round 19, P2; round 20, P0 — all three repoint or gate config resolution the same way
`GIT_CONFIG_PARAMETERS` does, so the question is why any of the three would be left alone).
`GIT_CONFIG_NOSYSTEM=1` is a pure downgrade — it can only make git see LESS config than it
otherwise would — and nothing in this skill has a legitimate reason to run with system config
silently disabled, so stripping it is the same call as `GIT_CONFIG_PARAMETERS`.

`GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` **repoint** config resolution rather than merely
downgrading it, and round 19 treated them asymmetrically on the theory that only `GLOBAL` has an
env-reachable fallback worth worrying about: git's own documented way to say "no global config" /
"no system config" is to point the variable at `/dev/null`, not to leave it unset — unsetting
either does not disable anything, it just falls back to the default lookup path (global:
`$HOME/.gitconfig`, then `$XDG_CONFIG_HOME/git/config`; system: the path git was compiled with).
Round 19 reasoned that `GIT_CONFIG_GLOBAL`'s default fallback (`HOME`/`XDG_CONFIG_HOME`) was a
path this skill's own environment already controls, so stripping the variable closed the "point
it at an attacker-chosen file" channel — a test can point `HOME` at an empty fixture directory and
the fallback resolves to nothing. `GIT_CONFIG_SYSTEM`'s default fallback has no such env-reachable
escape hatch, and round 19 reasoned from that asymmetry to leave it unstripped: the argument was
that an attacker could at most trigger the operator's own compiled-in system config, not redirect
to a file of their choosing. **That "own environment already controls" framing does not survive
round 21 — see below.**

**That argument mistook the fallback path for the attack.** Round 20 review (fallback
`strict-reviewer`) pointed out the actual attack does not go through the fallback at all — an
env-only attacker simply **sets `GIT_CONFIG_SYSTEM` directly**, the same way `GIT_CONFIG_GLOBAL`
was already known to be attacked, and the re-exec'd `-p` shell applies whatever `core.hooksPath` or
`core.fsmonitor` the attacker's file sets to every git command this script runs — reproduced as
arbitrary command execution via `core.fsmonitor` under `collect`/`status`, and, sharper still, as
a forged `guard:installed` verdict for a commit-msg hook the repository does not actually have
(`core.hooksPath`), inverting the Anchor-level AI-attribution control `guard` exists to report on.
The "no escape hatch" property is real but irrelevant: it describes what happens if the variable is
*unset and falls through to the default*, not what happens when an attacker sets it, which is the
actual channel. `GIT_CONFIG_SYSTEM` is now stripped for the same reason `GIT_CONFIG_GLOBAL` is.

The real-system-gitconfig portability concern that motivated round 19's decision was real but
solvable without leaving the strip incomplete: this project's own development machine has a real
system gitconfig at `/opt/homebrew/etc/gitconfig` (`credential.helper=osxkeychain`), and once the
script strips `GIT_CONFIG_SYSTEM`, a test's own env var no longer reaches the script's git calls —
same as the `GIT_CONFIG_GLOBAL` strip already did for `HOME`/`XDG_CONFIG_HOME`-style isolation.
The fix is not an env var but a PATH shim: replace `git` itself with a wrapper that sets
`GIT_CONFIG_SYSTEM` in its *own* environment one process layer downstream of the script's `unset`,
which the strip cannot reach because it only clears the *script's* environment, never a child
process's. `test/scripts/smart-commit-inspect.test.js`'s `gitShim` helper already existed for an
unrelated purpose (simulating config-read failures) and gained an `inject-sysconfig` mode for this.

**Round 21 found the identical attack one level down, through a variable that cannot be
stripped, and round 22 found the scope check's own failure mode plus a channel neither round had
pinned on the commit path.** `$HOME/.gitconfig` is read at *global* scope exactly the way a
`GIT_CONFIG_GLOBAL`-redirected file is — so an attacker who can set `HOME` reaches
`core.hooksPath`, `core.fsmonitor` and `core.attributesFile` the same way round 20's
`GIT_CONFIG_SYSTEM` redirect did, without ever touching a `GIT_CONFIG_*` variable at all
(`P8z`/`P8z2`/`P8z3`/`P8z4`/`P8z5`, `test/scripts/smart-commit-inspect.test.js`; the execute-side
`core.fsmonitor`/`core.attributesFile`/`core.hooksPath` cases, `test/scripts/smart-commit-execute.test.js`).
Unlike every variable above, `HOME` is not a candidate for the strip list: `identity` (Step 1c) reads
`$HOME/.gitconfig` as genuine, load-bearing diagnostic input — an operator's real global identity is
exactly what that step exists to report — so stripping `HOME` would break the feature to close the
hole. The fix is therefore not another name in the `unset` block; it is scoped to the operations
HOME can actually turn into a security defect, closed at the point of use instead of at the
environment boundary:

- **`guard`** no longer trusts `core.hooksPath` from *every* scope `--git-path` would honour. It
  first asks git the setting's scope (`git config --show-scope --get core.hooksPath`) and trusts
  only `local`/`worktree` — the repository's own committed choice (e.g. husky) — reporting
  `guard:missing` directly for anything else, exactly as if hooksPath were unset. This closes the
  channel for *every* non-local scope, not just the one HOME happens to reach — a
  `GIT_CONFIG_COUNT`-forged scope would be rejected the same way. Round 22 found and fixed two gaps
  in that check: the scope read's own exit code was discarded, so a failure that was *not* git's
  "key not found" code (old git rejecting `--show-scope` outright, for one) read as trusted-unset
  exactly like the genuine case — now only exit 1 counts, anything else fails closed. And the
  untrusted branch used to fall back to checking a computed `<git-common-dir>/hooks/commit-msg`
  file, which is not what git would actually run once a non-local hooksPath is configured — a
  legitimate non-local setting read back as a false `guard:installed`; the untrusted branch now
  answers `guard:missing` with no fallback file check at all.
- **`core.fsmonitor`**, which a status-touching git command can be made to run as an arbitrary
  shell command (empirically confirmed: a local `core.fsmonitor = touch marker; true` fires on
  plain `git status`, and on plain `git commit` even without `-a`), is pinned `false` on every
  `status`/`diff` call `smart-commit-inspect.sh` makes and every `commit` call
  `smart-commit-execute.sh` makes — `-c core.fsmonitor=false` on the command line always outranks
  a lower-scoped value, closing the channel regardless of which scope carried it. Round 22 found
  the same reach through `core.attributesFile` plus a `filter.<name>.clean` command, which fires on
  the identical set of operations (empirically confirmed on `status`, `diff`, and a plain `commit`);
  `-c core.attributesFile=/dev/null` is now pinned alongside `core.fsmonitor=false` at every one of
  those call sites.
- **`core.hooksPath` on `commit`** was still open after round 21: the fsmonitor pin closed only that
  one knob, and a non-local `core.hooksPath` reachable through `HOME` still named the
  pre-commit/prepare-commit-msg/post-commit hooks a real `git commit` runs. `smart-commit-execute.sh`
  now runs the same scope check `guard` does before committing and, only when the scope is
  untrusted, overrides `core.hooksPath` to the repository's own hooks directory — a trusted
  (local/worktree) setting is left alone, so a real local `core.hooksPath` (husky) still fires.

All three are "pin the security-relevant setting at the call site" moves, the same shape the
`--no-pager -c color.ui=false -c color.status=false -c color.diff=false` prefix and `diff
--no-ext-diff` already use for `diff.external` — not a new pattern, the pattern this file's other
channels already follow, applied to the settings HOME can reach that actually matter. Reads that are
genuinely not security-relevant — `identity` — are left alone: HOME/`XDG_CONFIG_HOME` reaching that
is the feature working as designed, not a residual gap.

Signing diagnostics were **not** on that "left alone" list, and round 24 review found that stated
here was itself the gap: `log.showSignature=true` reachable through HOME makes plain `git log`/
`git reflog` invoke `gpg.program` even on a format that requests no signature text — measured
against `verify-last`'s read-back (`marked_oids`, `verify_one`) and `smart-commit-inspect.sh`'s own
`git log`-family calls, including `style`'s `git log --oneline` — and inspect.sh's `signature`
subcommand's `%G?` format invokes it too, regardless of `--no-show-signature` (that flag only
suppresses the banner, not the verification call `%G?` itself). Every git_verify and inspect.sh
log-family call now carries `--no-show-signature` (`P20`, style's own case among them), and
`signature` now runs the same scope-checked substitution `run_commit` uses (`resolve_gpg_override`,
ported into `smart-commit-inspect.sh`, armed-control proof `P14b`). Measurements and the fix:
4-implementation.md § 10.16.

What is **still active** — measured rather than assumed, the measurements themselves in § 7 of the
implementation doc linked above, except `GIT_CONFIG_NOSYSTEM`'s row, whose measurement (`P8w`) is
in that doc's § 10.9 instead — added after § 7 was written, so it was never folded in (round 18
review, Nit). `GIT_CONFIG_GLOBAL`'s and `GIT_CONFIG_SYSTEM`'s rows (`P8x`, `P8y`) were folded into
§ 7 when each was added (round 19 review, P2; round 20 review, P0), and also keep their fuller
rationale at § 10.11/§ 10.12 respectively. `HOME`/`XDG_CONFIG_HOME`'s row was added round 21
(review P1) and extended round 22; its fuller rationale, the empirical `core.fsmonitor`/
`core.attributesFile` measurements, and the `guard` scope-check design are at § 10.13/§ 10.14:

| Channel | Under the prefix | Note |
|---------|------------------|------|
| `PATH` | resolves `git` | authority the caller already holds over their own shell |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | apply | Step 1c diagnoses and reports these separately |
| `GIT_CONFIG` / `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_COUNT` / `GIT_CONFIG_NOSYSTEM` / `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` | **stripped** | the first three in git's local-env list; the last three added explicitly (`P8w`, `P8x`, `P8y`) |
| `HOME` / `XDG_CONFIG_HOME` | **must not be stripped**: accepted-risk boundary | `identity` needs `$HOME/.gitconfig` as genuine load-bearing input (round 21). Six security-relevant operations it can otherwise reach — (1) `guard`'s hooksPath resolution; (2) `core.fsmonitor`/`core.attributesFile` on any status/diff/commit call; (3) `core.hooksPath` on any commit; (4) the `gpg.program` family on any signing commit; (5) the `gpg.program` family again on `verify-last`'s/`marked_oids`'s log/reflog read-back and on `signature`'s explicit `%G?` query; and (6) a filter/diff/merge driver COMMAND named by the repository's own tracked `.gitattributes` on any status/diff/commit/collect/scope call — are defended at the call site instead: a scope check (`P8z`, `P8z3`) and, depending on whether a safe default substitute exists, either a command-line pin/override/suppression (`P8z2`, `P8z4`, `P8z5` for 1–4; `--no-show-signature` at the flag-suppressible read-back sites and the full scope-checked substitution at `%G?` itself for 5, `P20`/`P21` pin the flag, `P14b`'s plumbing-forged-signature armed control proves the substitution live; execute-side cases in `smart-commit-execute.test.js` for `core.fsmonitor`, `core.attributesFile`, `core.hooksPath` and `gpg.program`) or an outright refusal when none does (`P8z6` for 6; execute-side content-driver case in `smart-commit-execute.test.js`). Rationale and measurements for 5–6: 4-implementation.md § 10.15/§ 10.16 |

So this is not immunity to the environment. The property it does buy is narrower and worth naming
precisely: **the skill's diagnostics and the commit they describe must strip the same set.** A
variable left in both places is visible to Step 1c and reported; a variable stripped in one place
and not the other makes the plan and the commit disagree silently. `F1i` pins the two lists as
equal. The defect that produced this rule: 4-implementation.md § 3.

## 2. What the skill prints (manual mode)

A printed command runs later, in the user's shell, possibly from another directory. It must
therefore be **self-contained**:

```
<PREFIX> git -C '<REPO_ROOT>' <subcommand> … -- ':(literal)<path>' …
```

`<PREFIX>` is § 1's list, byte for byte, so a printed command can be checked against an executed
one by comparing bytes rather than sets. `<REPO_ROOT>` is the absolute path from the § 1
derivation, shown in the plan. Why the two sections converged on the same spelling from different
directions: 4-implementation.md § 4.

| Element | What breaks without it |
|---------|------------------------|
| `-C '<REPO_ROOT>'` | The command acts wherever the user happens to be standing |
| `env -u …` | `-C` overrides none of those variables — an inherited `GIT_DIR` or `GIT_INDEX_FILE` still redirects the repository or stages a different tree |
| Pathspecs relative to `<REPO_ROOT>` | `git status --short` reports paths relative to the **current** directory, so paths collected from a subdirectory resolve against the wrong base once `-C` is applied. Collect them root-relative (`git -C "$REPO_ROOT" status --short`) rather than rewriting them later |
| Single quotes + `--` before pathspecs | Spaces and option-like filenames otherwise turn one pathspec into several, or into flags |
| `:(literal)` on each operand | Quoting is a **shell** protection; it does not stop git from reading the surviving operand as a pathspec *pattern*. `docs/report[1].md` would otherwise match `docs/report1.md` instead of itself, and a name starting with `:` would be read as pathspec magic |

**Two layers, two jobs.** The shell layer decides *what one word is*; the pathspec layer decides
*what that word matches*. Neither substitutes for the other, so a printed path needs both:

| Layer | Mechanism | Rule when emitting |
|-------|-----------|--------------------|
| Shell | `'…'` + `--` | Wrap in single quotes; a literal `'` inside the path (or inside `<REPO_ROOT>`) is written `'\''` — closing the quote, escaping one apostrophe, reopening. A path containing `'` that is merely wrapped is a **broken command**, not a quoted one |
| Git | `':(literal)<path>'` + the four `-u …_PATHSPECS` | Every operand is an exact path, and the magic is scoped to that operand — nothing is exported into hooks or other children git launches. The cost is deliberate: `--scope` takes a path, never a glob |

**Unconditional.** The prefix is never made conditional on those variables being set at planning
time — the wrong shell and the wrong moment. See `create-pr-stacked/2-tech-spec/1-core-logic.md` item 40.

Authority is not the question here — the user does own their shell — but a plan and an action that
disagree about which repository, ancestry or identity they mean is a defect on either side of that
line. That is why § 2 reuses § 1's list verbatim instead of keeping a shorter one of its own.
