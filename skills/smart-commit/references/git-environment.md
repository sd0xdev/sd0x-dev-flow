# Git Environment Policy

Two rules, one question: **which repository, tree, index, ancestry and configuration does this
command act on?** The first governs what `/smart-commit` executes; the second governs what it
prints for the user to execute. They are separate because they run in separate shells, at
separate moments.

The question used to stop at "repository, tree and index", and that framing is what kept the
list short enough to be wrong. A variable does not have to repoint the *repository* to make an
answer untrustworthy: `GIT_CONFIG_PARAMETERS` leaves every path alone and still overrides
`user.email`, so Step 1c's identity diagnostic reports one author while the commit records
another — and the same channel reaches `core.hooksPath` (which is where the AI-attribution guard
lives) and `diff.external`. `GIT_GRAFT_FILE` and `GIT_SHALLOW_FILE` are the ancestry equivalent:
the repository is the right one, the history it reports is not.

## 1. What the skill executes

Every git command the skill runs itself — read or write, either mode, **including ones it
delegates to a helper script** — carries the same prefix:

```bash
GIT_ENV="env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE -u ALLOW_AI_COAUTHOR"
```

and every fence derives the root once and pins each command to it:

```bash
REPO_ROOT=$($GIT_ENV git rev-parse --show-toplevel && printf .) || { echo "⚠️ could not resolve the repository root — aborting" >&2; exit 1; }
REPO_ROOT=${REPO_ROOT%.}; REPO_ROOT=${REPO_ROOT%$'\n'}
$GIT_ENV git -C "$REPO_ROOT" <subcommand> …
```

so planning, staging, diff reading, validation, the commit and the post-commit read-back all name
**the repository containing the current directory** and resolve every relative pathspec against
**its root**; a caller wanting another repository changes directory.

| Detail | Why it is not optional |
|--------|------------------------|
| Re-assigned in **every** fenced block that uses it | Each block is a separate shell. An unassigned `GIT_ENV` is not "empty by default", it is whatever the caller exported — and an underived `REPO_ROOT` makes `-C ""` mean "wherever I happen to be" (or aborts under `nounset`) |
| `-C "$REPO_ROOT"` on **every** command, not just the ones that print | The single exception is the `rev-parse --show-toplevel` that derives it. Paths collected root-relative and then consumed by a command running elsewhere is the same defect as printing them unanchored — it just fails inside the skill instead of in the user's shell |
| The prefix goes on the **delegation**, not inside the helper | `git-profile.sh` runs its own git commands; stripping at the boundary is what makes it and the inline fallback answer about the same repository |
| Applied to **all** of them, never some | Partial application replaces "the policy source was repointed" with "the policy source and the thing it protects are two different repositories" — see `create-pr-stacked/2-tech-spec.md` items 36–37 |

**The derivation carries a sentinel because `$( )` strips every trailing newline.** `git rev-parse
--show-toplevel` prints one pathname plus one record terminator, and it has no `-z` form — so a
repository root whose last component *ends* in a newline comes back truncated, and every later
`git -C "$REPO_ROOT"` then names a path that does not exist (or, worse, a different one that does).
Appending `printf .` inside the substitution, then removing the `.` and exactly **one** newline,
deletes the terminator and nothing else. Measured both ways against a real repository named
`repo<newline>`: the direct form yields a non-existent path, the sentinel form the real one. A
newline in the *middle* of a component always survived; only the trailing one was ever at risk.

**The sentinel is joined with `&&`, never `;`.** A substitution reports the status of its *last*
command, so `git …; printf .` hands back `printf`'s exit 0 whatever git did — the failure
disappears, `REPO_ROOT` becomes the empty string, and every later `git -C ""` quietly acts on the
current directory instead. Worse, the `|| { … }` clauses below are then attached to something that
cannot fail. `&&` skips `printf` when git fails, so the status is git's; the success path emits
exactly the same bytes. The `||` belongs on the substitution itself — the two trailing parameter
strips always succeed, so a guard written after them never fires. Test: `F1h` in
`test/scripts/smart-commit.test.js`, with the `;` form as its control.

**The prefix contains only `-u`, never an assignment.** `env` stops parsing options at the first
`VAR=value`, so a `-u` written after one is taken as the *command to run* and the call dies with
exit 127 — measured, not inferred. That is why `-u ALLOW_AI_COAUTHOR` lives in the prefix (every
call strips it by default) and the `--ai-co-author` opt-in re-adds it **after** the prefix, as
`$GIT_ENV ALLOW_AI_COAUTHOR=1 git …`: an assignment following `-u` flags is legal and wins.

**Pathspec literality is per-operand, not environmental.** Every path operand is written
`':(literal)<path>'`, and the four `*_PATHSPECS` variables are stripped so that magic is honoured.
A variable would have been the shorter fix and the wrong one: `git` exports its environment to
everything it launches, so an exported `GIT_LITERAL_PATHSPECS=1` reaches the repository's own
hooks, where a legitimate `git diff --cached -- '*.js'` would silently match nothing and skip its
checks. `:(literal)` binds to the operand and stops there.

**Scope of the claim.** The list is **everything `git rev-parse --local-env-vars` names**, plus
four `*_PATHSPECS` variables, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES` and the
`ALLOW_AI_COAUTHOR` opt-in. The first part is derived by asking git, not hand-picked; the second
is a short, explicitly-listed set that git's own list omits. An earlier version of this paragraph
said the list was "exactly the variables that repoint which repository/tree/index" and that
`GIT_CONFIG_*` still applied — both were wrong once the list was widened, and the second was
wrong in the reassuring direction.

What is **still active**, measured rather than assumed:

| Channel | Under the prefix | Note |
|---------|------------------|------|
| `PATH` | resolves `git` | authority the caller already holds over their own shell |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | apply — `git var GIT_AUTHOR_IDENT` returned the injected name | Step 1c diagnoses and reports these separately |
| `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` | apply — both returned an injected `user.email` in a repo with none set locally | outside git's local-env list |
| `GIT_CONFIG` / `GIT_CONFIG_PARAMETERS` / `GIT_CONFIG_COUNT` | **stripped** | in git's local-env list |

So this is not immunity to the environment. The property it does buy is worth naming precisely,
because the round-83 defect was a failure of exactly this and not of the wider thing: **the
skill's diagnostics and the commit they describe must strip the same set.** A variable left in
both places is visible to Step 1c and reported; a variable stripped in one place and not the
other makes the plan and the commit disagree silently. When the executor's list was re-derived
from git and this prefix was not, `GIT_CONFIG_PARAMETERS` reached the diagnostic but not the
commit — the plan named one author, the commit recorded another. Test `F1i` now pins the two
lists as equal, and `F1j` pins both against git's own.

## 2. What the skill prints (manual mode)

A printed command runs later, in the user's shell, possibly from another directory. It must
therefore be **self-contained**:

```
<PREFIX> git -C '<REPO_ROOT>' <subcommand> … -- ':(literal)<path>' …
```

`<PREFIX>` is the same `env -u` list written out **literally** — the user's shell has no
`$GIT_ENV`, so a variable reference expands to nothing and silently removes the protection.
`<REPO_ROOT>` is the absolute path from `$GIT_ENV git rev-parse --show-toplevel`, shown in the
plan.

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

**Unconditional.** An earlier version made the prefix conditional on those variables being set
*at planning time* — the wrong shell and the wrong moment, since the condition is evaluated in
the skill's shell and the command runs in the user's, later. See
`create-pr-stacked/2-tech-spec.md` item 40.

Authority is not the question here — the user does own their shell — but a plan and an action
that disagree about which repository, ancestry or identity they mean is a defect on either side
of that line. That is why § 2 reuses § 1's list verbatim instead of keeping a shorter one of its
own: the printed commit must strip what the diagnostic that produced the plan stripped.
