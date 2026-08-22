---
name: smart-rebase
description: "Smart partial rebase for squash-merge repositories. Auto-detect which commits to keep/drop when base branch was squash-merged into target. Use when: user says 'rebase', 'partial rebase', 'base already merged', 'smart rebase', or /smart-rebase. Not for: simple git rebase (the developer runs it — Claude never executes rebase), merge conflict resolution (use /merge-prep), branch switching (the developer runs git checkout). Output: rebase plan table + a shell-quoted git rebase --onto command for the developer to run after the ambiguity check in Step 5."
allowed-tools: Bash(git:*), Bash(bash:*), Read, Grep, Glob
---

# Smart Rebase — Partial Rebase for Squash-Merge Repos

Analyze branch history → identify squash-merged commits → generate precise `git rebase --onto` command.

## When NOT to Use

- Simple `git rebase` without squash-merge complexity — **the developer runs it**; Claude never
  executes `rebase`, here or anywhere else (§ Permissions). "Use git directly" is an instruction to
  the human, and this list is read by the dispatcher before § Permissions loads, so it says so here
- Merge conflict resolution (use `/merge-prep`)
- Branch management or switching — the developer runs the git command
- Cherry-picking specific commits (use `git cherry-pick`)

## Core Problem

In squash-merge repositories, when a feature branch is based on another branch that was already squash-merged:

```
main:    A ─── S (squash merge of B1+B2+B3) ─── ...
              ↑
feature: A ─ B1 ─ B2 ─ B3 ─ F1 ─ F2 ─ F3
              ↑ drop (in S)   ↑ keep (unique)
```

Need: `git rebase --onto main B3 feature` to keep only F1-F3.

## Permissions

Claude **must not** execute `git rebase` — **there is no authorization that lifts this**. `rebase` is
a destructive operation under Anchor Register #4 (`@rules/discretion.md`), whose enumerated
approval workflows are a closed set: `/push-ci` (push), `/smart-commit --execute` (add + commit) and
`/epic-merge` (rebase --onto, force-with-lease, squash-merge). This skill is not on that list, so
user approval here cannot create the exception — adding a workflow to the list is itself an
Anchor-level change. This skill **outputs** the rebase command; the developer runs it.

> **Note on `allowed-tools`**: `Bash(git:*)` is granted because Steps 1–3 read history (`git log`,
> `git rev-parse`, `git branch --show-current`), and `Bash(bash:*)` to run the analysis script —
> the latter cannot be narrowed to specific script paths until
> [#9354](https://github.com/anthropics/claude-code/issues/9354) is resolved. **A tool grant is not
> an authorization**: what may be executed is decided by the rule above, not by what the permission
> string happens to permit.

## Prerequisites

Before starting, validate:

| Check | Command | Fail action |
|-------|---------|-------------|
| Not on a protected branch | `git branch --show-current` must not match the **complete** protected set defined in `@rules/git-workflow.md` § Prohibited (which lists the complete protected set): `main`, `master`, `develop`, `release/*`. Do not re-spell a shorter list here — a partial copy is how `master` and `release/*` reached the force-push suggestion below | Abort with warning |
| Clean working tree | `git status --porcelain` must be empty | Abort: "stash or commit changes first" |
| Not detached HEAD | `git symbolic-ref HEAD` succeeds | Abort: "checkout a branch first" |

## Names in commands

Every command this skill outputs carries ref names, and **a ref name is not display text**:
`git check-ref-format` accepts `;`, backticks, `$( )` and `'` inside one — all measured. A name
substituted into a command as a bare word runs whatever it contains, and a fixed pair of single
quotes is broken by a name containing `'`.

So every `<…>` slot in a command block below is written `<quoted …>`: substitute a **shell-quoted**
value, single-quoted with each `'` rendered as `'\''`.

**Shell-quoting is only half of it, and the other half is git's own option parser.** Quotes are
consumed by the shell; git never sees them, so a branch named `--all` is still an option when it
arrives. Measured: `git check-ref-format refs/heads/--all` exits 0, and
`git push --force-with-lease origin '--all'` pushed **every** branch in the repository, not the one
named. The mechanism the templates below rely on is the **`--` / `--end-of-options` separator**,
placed before the ref operand — not fully-qualifying it. That distinction is load-bearing for one
operand in particular: a `git rebase` **branch** operand written `refs/heads/<branch>` is measured
to land on a **detached HEAD** and never move the branch, which is the whole point of the command,
whereas the same short name after `--` stops the option parser and — **when the short name resolves
unambiguously** — updates the ref. That qualification is not hypothetical and the separator does not
supply it: with a branch `refs/heads/tags/v0.0.1` and a tag `v0.0.1` both present,
`git rebase --onto main main -- 'tags/v0.0.1'` **exits 0 and leaves the branch unmoved** (measured —
`docs/features/ref-name-hardening/requests/2026-08-20-ref-name-hardening-r1.md` finding 1). Until the
ambiguity probe that closes this lands (that ticket's AC 1), **the emitted `rebase_command` is not
safe to run verbatim on a repository where the current branch name could also name a tag** — check
`git rev-parse --verify` for an `is ambiguous` warning on the operand before running it. So the
separator, carried in the template, is the rule — `--` for `git push` and `git rebase`,
`--end-of-options` for `git merge-base` and for `git log --not` (Step 6); a `<quoted branch>` after
it stays a short name on purpose. **Which spelling matters, and where, is measured — not a blanket
rule.** Measured on git 2.55.0 in this repository:

| Command | `--` | `--end-of-options` | Consequence |
|---------|------|--------------------|-------------|
| `git push`, `git fetch`, `git merge-base` | accepted | accepted | **Interchangeable.** Picking one is a convention, not a correctness requirement |
| `git log … --not <name>` | forces `<name>` to a **pathspec** — a name that is neither ref nor file yields nothing at exit 0 | keeps rev/path disambiguation — the same name exits **128** with `ambiguous argument` | **Not interchangeable.** `--end-of-options` fails closed; `--` fails silently. Step 6 uses `--end-of-options` for this reason |
| `git rev-parse` | — | **echoes the separator literally**, then resolves | Neither separator helps. Use `git rev-parse --verify --quiet refs/heads/<name>` |
| `git check-ref-format --branch` | rejected (exit 129) | rejected (exit 129) | Honours neither, so the script validates a source by its full `refs/heads/…` form instead |

The separator terminates **option** parsing, never **refspec** parsing: `git push origin -- '+main'`
still reads the leading `+` as the force modifier, and `git check-ref-format --branch '+main'` exits
0, so a lexical protected-branch check passes a branch literally named `+main`. Emit fully-qualified
refspecs (`'refs/heads/<n>:refs/heads/<n>'`) rather than short names wherever a `+` could appear.
This is the same fact § Step 5 states about the analysis script: the resolved operand is what git
acts on, never the spelling that was typed.

The slot also **brings its own quotes** —
never wrap one in a further fixed pair. `'--base=<quoted branch-or-commit>'` reads as safe and is
not: substituting `feat/x;printf${IFS}PWN` yields `'--base='feat/x;printf${IFS}PWN''`, which the
shell splits into an analysis call and a second command (measured), and a name containing `'` turns
it into a syntax error. Write the fixed prefix unquoted, adjacent to the slot:
`--base=<quoted branch-or-commit>`. Where the analysis script has already
produced the string — its `rebase_command` field, and the `git fetch …` line in its failure
message — copy that string rather than rebuilding it; `sh_quote` in the script is the same rule,
already applied. Reasons in full: `docs/features/ref-name-hardening/4-implementation.md` § 1.

## Workflow

```
Step 1: Analyze → run script to detect commits
Step 2: Identify → determine keep/drop boundary (cut point)
Step 3: Display → output rebase plan
Step 4: Confirm → user reviews
Step 5: Output → print the rebase command for the developer to run
Step 6: Verify → confirm history is correct
```

### Step 1: Analyze

**Diagnose first — this analyzer writes refs, and a configured negative refspec changes what its
refresh can reach.** Round 59 corrected this paragraph: it used to call that an *open defect* and
tell the operator not to run the analyzer at all. The write defect is closed (§ Names in commands
has the shipped behaviour), so what the check below buys is a *reason* — it names the configuration
that will make a refresh transfer nothing, before the analyzer refuses and the operator has to work
out why. Run it for each remote the analyze step will probe:

```bash
# Capture, status-check, THEN match — a pipeline exits with `grep`'s status, so a `git config`
# that fataled would report an ordinary no-match. Measured on git 2.55.0:
# `GIT_CONFIG_COUNT=1 git config --get-all remote.origin.fetch` exits 128, and the same command
# piped into `grep -q '^\^'` exits 1 — the exact status a valid config with no negative refspec
# produces. Exit 1 from git itself means the key is simply unset, which is a real answer;
# anything else means the configuration could not be read at all.
remote=<quoted remote>   # the remote the analyzer will probe — `origin` unless --target names another
if refspecs=$(git config --get-all "remote.${remote}.fetch"); then rc=0; else rc=$?; fi
if [[ "$rc" -ne 0 && "$rc" -ne 1 ]]; then
  echo "⛔ cannot read remote.${remote}.fetch (git exited $rc) — do not run the analyzer" >&2
elif printf '%s\n' "$refspecs" | grep -q '^\^'; then
  echo "⚠️ NEGATIVE REFSPEC CONFIGURED on $remote — if the analyzer aborts on an empty transfer, this is why" >&2
fi
[[ "$rc" -eq 0 || "$rc" -eq 1 ]]   # the fence's exit status IS this line — see below
```

**`remote` is bound, and the exit status answers exactly one question.** Both were wrong in the
first version of this gate and wrong in the same direction. `${remote}` was left unbound, so running
the fence verbatim queried `remote..fetch` — a key that is never set, so the gate reported nothing
about the remote it was supposed to guard. And the block ended at an `echo` on both refusal paths
while the safe path fell out of a failed `grep`, so `$?` read **1 for the one case that may proceed
and 0 for both cases that may not** — exactly inverted for any wrapper.

The status is now a trailing `[[ ]]` rather than a `true` / `false` terminator, and that is a
correctness fix rather than a style one. Round 61 measured what the change's own threat model
(`docs/features/push-gate-optin/4-implementation.md` § 4.7) already implies: bash imports functions
from the environment, and a function outranks a builtin, so `true`, `false` **and** `exit` all
return whatever an imported `BASH_FUNC_true%%` says — measured on git 2.55.0 / bash 3.2, each
returned 7 under a shadow declaring `return 7`. `[[` is a shell **keyword**, resolved by the parser
before any name lookup, so it is the one form here that cannot be replaced. The line therefore says
the verdict directly instead of delegating it to a word.

Two consequences worth stating rather than discovering. The `echo`s can still be shadowed, so a
caller may see no message; the **status** is the contract. And the terminators are deliberately not
`exit`, both because the fence may be sourced and because `exit` is shadowable in exactly the same
way.

**What the `[[ ]]` does and does not buy — round 62 narrowed this.** An earlier wording here called
the status "the part that cannot be forged", which claims more than the keyword delivers. What
cannot be replaced is the **verdict form**: no imported function can invert the last line, so the
inversion this gate shipped with in its first version is now structurally impossible. The verdict's
**input** is another matter — `$rc` comes from a bare `git`, a command word like any other, and
under `BASH_FUNC_git%%='() { return 0; }'` an unreadable configuration reports `rc=0` and the fence
exits 0. That residue has no fix at this layer and no pretence of one: the push fences answer it by
re-executing under `bash -p`, which discards function imports outright, and a markdown fence run in
the operator's own shell cannot ask for `-p` (`docs/features/push-gate-optin/4-implementation.md`
§ 4.3 records the same limit for the caller side of the push gate). The backstop is elsewhere and is
independent: the analyzer performs the refresh itself and aborts on an empty transfer, so a forged
clean read here buys a run that still stops — which is the same division of labour as the `⚠️`
above, where this block labels and the analyzer decides.

The question the status answers is **"could the configuration be read?"**, and nothing more. Round
60 narrowed it: a hit used to return `false` as well, which put the gate in the business of
predicting an outcome it cannot see. A negative refspec only empties the transfer when it cancels
**every** positive mapping on the refresh line — `^refs/heads/wip/*` beside
`+refs/heads/*:refs/remotes/origin/*` cancels one prefix and leaves the rest reachable — and this
block reads the configured spelling, not the intersection. Refusing on any hit therefore stopped
runs that would have worked, and the operator's only route past it was to ignore the gate, which is
how a check stops being read at all.

So a hit is a **label, not a verdict**: it prints `⚠️` and Step 1 proceeds. The analyzer is the one
that can answer, because it is the one that performs the refresh — its explicit refresh carries that
remote's negatives on its own command line, so git applies its own matching where the write happens
and no ref is refreshed from a source the configuration excluded; and when every positive on that
line *is* cancelled, the refresh transfers nothing and the analyzer aborts rather than planning from
stale history. That abort is the refusal, and the `⚠️` line above it is what saves the operator from
having to work out why. Resolve the target by hand, or run against a remote with no negative
refspec, if you need a plan anyway. The one case that still refuses here is the `⛔` branch: the
configuration could not be read, so the block has no answer to give, and treating that as a clean
no-hit is what would let an unreadable configuration read as a clean bill of health.

```bash
# --target is optional; omit it to auto-detect against origin/main.
bash skills/smart-rebase/scripts/smart-rebase-analyze.sh --target=<quoted target>
```

The `--target` value is a ref name and follows § Names in commands: the **joined**
`--target=<quoted target>` form, never a bare `--target <value>` — a target named
`origin/main;printf${IFS}PWN` is a legal ref (`check-ref-format` accepts it) and a bare, unquoted
operand would run the second command when the line is pasted.

Auto-detect mode uses `git cherry` to find commits already cherry-picked to target. Squash merges cannot be detected by `git cherry` — proceed to Step 2.

### Step 2: Identify Cut Point

**Case A — User provides base branch or commit**

```bash
# Resolve the common ancestor as cut candidate
git merge-base --end-of-options <quoted base-branch> HEAD
# Or specify the cut point commit directly
bash skills/smart-rebase/scripts/smart-rebase-analyze.sh --base=<quoted branch-or-commit>
```

**Case B — Inference needed**

1. Check `target_new` squash merge commit messages
2. Compare with `commits` messages in current branch
3. Identify which commits are covered by the squash merge
4. Confirm cut point and re-run with `--base`

**Case C — `git cherry` detected all**

When `cherry_dropped > 0`, detected commits can be dropped. Verify cut point is contiguous (all drops must precede all keeps).

### Step 3: Display Plan

```markdown
## Rebase Plan

| Item           | Value                                   |
| -------------- | --------------------------------------- |
| Current branch | feat/my-feature                         |
| Target         | origin/main (dd21265c)                  |
| Cut point      | 06a7fae6                                |
| Keep           | 3 commits                               |
| Drop           | 15 commits (already in main via squash) |

### Commits to Keep

1. `57d7898a` feat: Add error classification framework
2. `05c11119` docs: Document classification rules
3. `da987681` fix: Correct classification accuracy

### Commits to Drop (already in main)

1. `f76209f4` docs: Add RPC optimization design
   ...
```

### Step 4: User Confirmation

Display plan and wait for user confirmation before proceeding.

### Step 5: Output the command

**One command is output, and the script already wrote it.** A successful analysis emits
`rebase_command`, with every name shell-quoted — copy that field verbatim rather than rebuilding it
(§ Names in commands). **Verbatim means "do not re-quote it", not "run it unchecked."** Until the
ambiguity probe lands (see the warning above), first confirm the operand is unambiguous:

```bash
# Bind once, then use the variable — § Names in commands. The slot brings its own quotes,
# so it may sit alone on the right of `=`, but it must NEVER be nested inside a further
# fixed pair: `"refs/heads/<quoted branch>"` renders as `"refs/heads/'main'"`, where the
# single quotes are literal ref-name characters. Measured: that pattern matches 0 refs for
# an ordinary unique branch, so the guard below would refuse every legitimate rebase.
branch=<quoted branch>
ok=1
git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null ||
  { echo "⛔ not a branch"; ok=0; }
# Exact refs, one --verify each. NOT `for-each-ref <pattern>`: its patterns match a
# refname *prefix* at a path boundary, so `refs/codex` matches `refs/codex/turn-diffs/x`
# and an ordinary branch named `codex` counts 2 and is refused. Measured in this very
# repository, which carries such a subtree (`git for-each-ref refs/codex` prints it while
# `git show-ref --verify refs/codex` fails) — a false refusal, on a legal branch name.
n=0
for r in "refs/$branch" "refs/tags/$branch" "refs/heads/$branch" \
         "refs/remotes/$branch" "refs/remotes/$branch/HEAD"; do
  git show-ref --verify --quiet -- "$r" && n=$((n+1))
done
case "$n" in
  1) ;;
  *) echo "⛔ short name matches $n refs — do not run"; ok=0 ;;
esac
short=$(git rev-parse --verify --quiet "$branch")
head=$(git rev-parse --verify --quiet "refs/heads/$branch")
if [[ -z "$head" || "$short" != "$head" ]]; then
  echo "⛔ short name resolves to ${short:-nothing}, not the branch ${head:-nothing} — do not run"; ok=0
fi
# OID equality is not ref identity, and the gap is reachable. A branch literally named
# `FETCH_HEAD` sits under the pseudo-ref of the same name, which wins resolution — but if
# both currently point at the same commit, the count is 1 and `$short` = `$head`, so the two
# checks above clear an operand that still denotes the pseudo-ref. Measured in a scratch repo:
# count=1, OIDs equal, guard PASSES, while git itself calls the name ambiguous. So ask git what
# the name *is*, not only what it points at.
sym=$(git rev-parse --verify --quiet --symbolic-full-name --end-of-options "$branch" 2>/dev/null)
if [[ "$sym" != "refs/heads/$branch" ]]; then
  echo "⛔ short name denotes ${sym:-an ambiguous or non-branch ref}, not refs/heads/$branch — do not run"; ok=0
fi
# Read the VALUE, never `$?`: on the ambiguous name git printed `error: refname … is ambiguous`
# to stderr, wrote nothing to stdout, and still **exited 0**. A `|| { ... }` on this command
# would have cleared exactly the case it was added to catch.
[[ "$ok" -eq 1 ]]   # ← the block's exit status. Zero ⇔ every check passed
```

**The last line is the point, not a formality.** Each check above reports and keeps going, so the
developer sees *every* reason at once rather than the first — but a block that only prints exits 0
whatever it found, and anything reading `$?` (a wrapper script, a `&&` chain, a copy pasted into a
runner) reads "clear to rebase" off a block that just refused three times. `[ "$ok" -eq 1 ]` as the
final command makes the block's own status the verdict. It is deliberately **not** `exit 1`: this
snippet is meant to be pasted, and `exit` in an interactive shell closes the terminal.

**And the verdict is stated by keywords, not by `[`.** Round 63. `[` is a *builtin*, so an imported
`BASH_FUNC_[%%` function outranks it and answers every test in the block — including the last one —
for the caller. Measured on bash 3.2.57: under that shadow, a name deliberately colliding with a tag
*and* resolving to a non-branch produced no refusal message and exit status 0. `[[` and `case` are
**keywords**, resolved by the parser before any name is looked up, so no imported function can reach
them; that is the whole reason the four tests above are written the way they are, and `case` rather
than `[[ … -eq … ]]` for the count because `-eq` inside `[[ ]]` is arithmetic — an empty operand
would read as 0 and a non-numeric one would be dereferenced as a variable name.

The same narrowing as the Step 1 gate applies here, and for the same reason: what cannot be replaced
is the **verdict form**. The verdict's **inputs** are bare `git` invocations, and a shadowed `git`
forges those exactly as it forges Step 1's read. There is no fix for that at this layer — a fence
pasted into the operator's own shell cannot ask for `bash -p` — and claiming otherwise is the error
round 62 corrected once already.

**The second check counts refs; it must never read git's message, and must never read only its
exit status.** Both of the obvious shortcuts are measured failures on git 2.55.0, in a repository
holding both a branch and a tag named `dup`:

| Shortcut | Measured | Why it fails |
|----------|----------|--------------|
| `git rev-parse --verify dup 2>&1 \| grep -q 'is ambiguous'` | matches **today** | Git marks that string for translation. It survived `LC_ALL=zh_CN.UTF-8` here only because that catalogue leaves the clause untranslated — a locale that does translate it turns this guard silently green |
| `git rev-parse --verify --quiet dup; [ $? -ne 0 ]` | **exit 0** | Git treats a branch/tag collision as a `warning:` it recovers from, resolving to one of them and printing a sha. Reading the status alone therefore **fails open on the very case the check exists for** — strictly worse than the string match |

**The five names are checked as exact refs, and that is a correctness requirement rather than a
style choice.** `for-each-ref`'s pattern argument matches a **prefix at a path boundary**: the
pattern `refs/codex` matches `refs/codex/turn-diffs/…` as readily as an exact `refs/codex`. Custom
ref namespaces under `refs/<something>/` are ordinary — this repository carries one — so the
pattern form counts an unrelated subtree as a second hit and refuses a legal branch. Measured here:

| Command | Result |
|---------|--------|
| `git for-each-ref --format='%(refname)' refs/codex` | prints `refs/codex/turn-diffs/…` |
| `git show-ref --verify refs/codex` | `fatal: 'refs/codex' - not a valid ref` |
| pattern count, with a branch `codex` present | **2** → refused |
| exact `show-ref --verify` count, same repository | **1** → proceeds |

The direction of the error decides the fix: refusing a legitimate rebase is loud and recoverable,
but it teaches the operator to work around the guard, and a guard routinely worked around stops
guarding the case it was written for. Exact verification costs the same five commands.

**The five names are not git's whole DWIM set, which is why a third check exists.** Git resolves
`$GIT_DIR/<name>` pseudo-refs — `HEAD`, `FETCH_HEAD`, `ORIG_HEAD`, `MERGE_HEAD` and their siblings —
**before** it looks in `refs/**` at all, and `for-each-ref` iterates the ref store, so it
structurally cannot see them. Measured on git 2.55.0, in a repository holding a branch named
`FETCH_HEAD` at commit *B* and an ordinary `.git/FETCH_HEAD` naming commit *A*:

| Check | Result | Reading |
|-------|--------|---------|
| `git check-ref-format --branch FETCH_HEAD` | exit 0 | A legal branch name — this is not a hypothetical |
| `git rev-parse --verify --quiet FETCH_HEAD` | *A* | The pseudo-ref wins; the branch is invisible |
| the five-name exact-ref count | **1** | "Unique — proceed." The count fails open here |
| `short` vs `refs/heads/$branch` | *A* ≠ *B* | The collision, stated as the fact that matters |

So the count answers "how many refs bear this name" and the third check answers "does the name
git will actually use point at the branch you meant" — neither subsumes the other. A branch and a
tag sitting on the same commit pass the third check while the count refuses (the collision is real
even though today's shas agree); a pseudo-ref passes the count while the third check refuses. Both
lines stay.

**Why not test whether `$(git rev-parse --git-path "$branch")` exists** — the obvious way to spot a
pseudo-ref. Measured in the same repository: `git rev-parse --git-path config` returns `.git/config`,
which exists in every repository, so that test refuses a perfectly ordinary branch named `config`
(a legal name — `git check-ref-format --branch config` exits 0). Comparing resolutions costs the
same and refuses nothing it must accept.

`0` from the count is unreachable here — line 1 already proved `refs/heads/<branch>` exists — so
anything but `1` is a genuine collision, and this is the shape the document warns can exit 0 while
leaving the intended branch unmoved.

If either line reports, hand the developer the plan table **without** the command and say why:

```
rebase_command  →  git rebase --onto 'refs/remotes/origin/main' '2692ede' -- 'feat/x'
```

**There is no fetch command to output.** When the target is remote-tracking, the analysis performs
the refresh itself before building the plan; the developer has nothing left to fetch. A `git fetch`
string appears in exactly one place — inside the error payload when that refresh *fails*, already
shell-quoted — and in that case there is no plan and this step is not reached. Show that string
only when relaying such a failure, and copy it rather than rebuilding it.

For reading, that internal fetch is:

```bash
git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- <quoted remote> <quoted refspec> <quoted negatives>...
```

Every part of it is load-bearing: a bare branch argument is a **refspec**, so the configured
`remote.<name>.fetch` decides where the fetched ref lands and a value like `+main:refs/heads/main`
overwrites a local branch. `--refmap=` ignores that configuration, the fully-qualified refspec names
a destination under `refs/remotes/`, `--no-tags --no-recurse-submodules` close the two write paths
the refspec does not govern, and `--` (after `--quiet`, never before it) makes a remote named
`-evil` an operand instead of a flag. Reasons in full:
`docs/features/ref-name-hardening/4-implementation.md` § 1.

**Configured negatives are carried on the command line, not re-implemented.** `--refmap=` discards
`remote.<name>.fetch`, so the positive mapping is rebuilt here — and a negative rebuilt the same way
would be wrong, because git normalizes a short *positive* source but does not DWIM a *negative* one.
So the negatives are not rebuilt: the selected remote's configured `^…` entries are appended to this
exact command, and git does its own matching at the point the write happens. Two consequences the
plan depends on:

| Situation | What happens |
|-----------|--------------|
| A negative cancels the mapping | The fetch **exits 0 and transfers nothing** — measured: FETCH_HEAD is written at 0 bytes, where a real update, an already-up-to-date fetch and an irrelevant negative all write 66. The analyzer reads that postcondition and **aborts** rather than planning from whatever the ref held before |
| A **short** target source | It is never matched against the negatives at all — git resolves a short source across the remote's whole namespace, and only a negative spelled in the namespace it lands in cancels it, which nothing local can decide. So a short source is treated as *not provably excluded*, never as *matches nothing* |

The error payload for the empty-transfer case names the negatives it passed, so the developer can
re-run the same command by hand. What is still open in `docs/features/ref-name-hardening/` r1 AC 1
is the *redesign* — replacing the positive reconstruction with git-mediated resolution
(`git ls-remote` + an ambiguity-aware probe + `git fetch --dry-run`) — not this write path.

Output the command for the developer to run. Claude does not execute it — see § Permissions;
no confirmation the user gives in this skill changes that.

### Step 6: Verify

```bash
# Confirm history is correct
git log --oneline -10

# Confirm commit count — in TWO steps, never as `git log … | wc -l`. A pipeline exits with
# `wc`'s status, so a `git log` that fataled on an unreadable target still reports success
# and a plausible **0**. Measured here: an unknown target prints `fatal: ambiguous argument`,
# the pipeline exits 0, and the count reads 0 — the guard fails open on exactly the input
# `--end-of-options` was added to catch, and the next step recommends a force push.
# Same shape as `skills/epic-merge/SKILL.md` § Phase 0.
range=$(git log --oneline HEAD --not --end-of-options <quoted target>) || {
  echo "⛔ cannot read HEAD --not <target> — do not push" >&2
  exit 1
}
# An empty range is a count, not a failure: `grep -c` would exit 1 on it and abort a
# caller running under `set -e` on a branch that simply has no unique commits.
if [ -z "$range" ]; then echo 0; else printf '%s\n' "$range" | wc -l; fi
```

On success, suggest the force push. **Prefer routing it through `/push-ci --force-with-lease`** — that
is the authorized workflow (Anchor Register #4), and its Phase 0 hard-aborts a protected branch paired
with a force form, which a hand-typed command does not.

For a developer pushing by hand, the suggested command carries **both** guards:

```bash
git push --force-with-lease --force-if-includes origin -- <quoted refspec>
```

`<quoted refspec>` is `refs/heads/<branch>:refs/heads/<branch>` — **both halves spelled out**, the
whole operand shell-quoted as one unit. It is one slot rather than a `refs/heads/` prefix wrapped
around `<quoted branch>`, because a slot in this document already carries its own quotes and
nesting a second pair around it is exactly what the quoting rule above forbids.

**Why the full source:destination form, and not the bare branch name.** `--` ends *option* parsing,
not *refspec* parsing — after it, git still reads the operand as a refspec, where a leading `+`
means force and `:` splits source from destination. `git check-ref-format refs/heads/+main` exits 0,
so `+main` is a legal branch name; written bare after `--` it is read as "force-push `main`", which
rewrites the protected branch while the name the developer approved was `+main`. The protected-name
comparison misses it too, because it compares `+main` against `main`. Spelling both halves removes
the reading: `refs/heads/+main:refs/heads/+main` pushes the branch that was actually named.
`/push-ci` and `/epic-merge` render the same shape for the same reason — `skills/epic-merge/SKILL.md`
§ Names in commands carries the measurement on a real remote.

`--force-with-lease` alone is not sufficient: it checks the remote against your last *fetched* ref, so
a collaborator commit already pulled by any background fetch satisfies the lease and is overwritten
with exit 0 (measured — `git-push(1)` says this form "interacts very badly with anything that runs
`git fetch` in the background").

**What the pair closes, stated narrowly, because the wider claim is false.** `--force-if-includes`
asks whether the remote tip is reachable from **any reflog entry of the local branch** — not whether
the history you are about to push still contains it. Measured on a real remote: fetch the
collaborator's commit, check it out (the reflog now holds it), then rewrite to a history that drops
it, and the push still **overwrites it with exit 0**. `/smart-rebase` runs immediately before exactly
such a rewrite, so that ordering is the normal case here, not a contrived one.

So the pair closes **one** window — the collaborator commit brought in by a background fetch that the
operator never touched — and leaves the reflog-reachability path open. Neither flag addresses a
collaborator who has the branch checked out while its history is rewritten; nothing on the push side
can see that. Full measurements:
`docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`.

## Conflict Handling

| Scenario                | Action                                        |
| ----------------------- | --------------------------------------------- |
| Already squash-merged   | `git rebase --skip` (dropped commit)           |
| Real content conflict   | Manual resolve → `git rebase --continue`       |
| Cannot resolve          | `git rebase --abort` to restore original state |

## Prohibited

- **Claude never executes `git rebase`** — not with user approval, not with a confirmed plan.
  Anchor Register #4's workflow list is closed and this skill is not on it
- No rebase on a protected branch — the full set is `@rules/git-workflow.md` § Prohibited
  (`main`, `master`, `develop`, `release/*`), never a shorter list restated here
- No force push to a protected branch, same set
- No command output before the plan has been displayed and the user has reviewed it (Step 4)
- Never suggest a **bare** `--force-with-lease`. It compares the remote ref against your last
  *fetched* value, not against what you have integrated, so a collaborator commit that any
  background `git fetch` already pulled satisfies the lease and is overwritten with exit 0 —
  measured, see `docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`.
  `--force-if-includes` closes **that one window** and no more — it tests reachability from any
  reflog entry, not from the history being pushed, so a commit you checked out and then dropped is
  still overwritten with exit 0 (measured, same ticket). Suggest both flags and state the residual;
  bare `--force` stays forbidden outright

## Output

Rebase plan table with keep/drop commits:
- **With `--base`**: includes the shell-quoted `git rebase --onto` command — for the developer to run **after** Step 5's ambiguity check, and withheld when that check reports
- **Auto-detect**: analysis report with cherry status per commit; may require `--base` follow-up

## Verification

- [ ] Prerequisites validated (not a protected branch per `@rules/git-workflow.md`, clean tree, not detached)
- [ ] Script output parsed and displayed as plan table
- [ ] The rebase command was **output**, never executed by Claude
- [ ] Post-rebase commit count matches expected keep count
- [ ] **Both** `--force-with-lease` **and** `--force-if-includes` used (never `--force`, never the
  bare lease — a checklist that accepts the lease alone green-lights exactly what § Prohibited bans)

## Examples

```bash
# Auto-detect (cherry-pick scenarios)
/smart-rebase

# Specify base branch (squash-merge scenarios)
/smart-rebase --base fix/feature-xyz

# Specify non-main target
/smart-rebase --target origin/develop --base fix/hotfix-123
```

## References

| File | Purpose | When to Read |
|------|---------|-------------|
| [smart-rebase-analyze.sh](scripts/smart-rebase-analyze.sh) | Analysis script | Step 1 |
