# Smart Commit Hardening — Implementation Archaeology

`skills/smart-commit/references/git-environment.md` is an **instruction surface**: it is loaded
whole every time the skill consults the policy, so everything in it is paid for on every read.
This file is where the reasoning that produced that policy lives instead — the measurements, the
wrong turns, and the defects each rule was written against. Nothing here is needed to *apply* the
policy; it is needed to *change* it safely.

Cross-references run both ways. Each section below names the place that points at it — for §§ 1–4
and 7 that is `git-environment.md`; for §§ 5, 6, 8, 9 and 10 it is `SKILL.md` or the script itself;
§ 11 answers to `2-tech-spec.md`. The design record for the decisions themselves stays in
[2-tech-spec.md](./2-tech-spec.md).

**On this file's own length**: it has been past `@rules/docs-numbering.md`'s 500-line signal since
round 11. The split is deliberately deferred, not exempt from the rule — the full reasoning (why,
the cost of moving now, and the current line count) lives in one place, `2-tech-spec.md` row **D2**,
so the count has a single source of truth instead of drifting here every time this file grows.

---

## 1. Why the stripped list is wider than "which repository"

*(git-environment.md preamble)*

The list started as "the variables that repoint which repository, tree or index", and that framing
is what kept it short enough to be wrong. A variable does not have to repoint the repository to
make an answer untrustworthy:

| Variable | Repoints the repo? | What it still does |
|----------|--------------------|--------------------|
| `GIT_CONFIG_PARAMETERS` | No | Overrides `user.email`, so Step 1c's identity diagnostic reports one author while the commit records another. The same channel reaches `core.hooksPath` — where the AI-attribution guard lives — and `diff.external` |
| `GIT_GRAFT_FILE`, `GIT_SHALLOW_FILE` | No | The repository is the right one; the ancestry it reports is not |

An earlier version of the § Scope paragraph said the list was "exactly the variables that repoint
which repository/tree/index" **and** that `GIT_CONFIG_*` still applied. Both were wrong once the
list was widened, and the second was wrong in the reassuring direction — it described a hole that
had already been closed as though it were still open, which is the failure mode that makes a
security note worse than no note.

The list now has two parts, and the distinction is the point: everything
`git rev-parse --local-env-vars` names is **derived** — `F1j` pins it against git's own output, so
it cannot silently fall behind a git upgrade — while the four `*_PATHSPECS` variables,
`GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_NOSYSTEM` and the `ALLOW_AI_COAUTHOR`
opt-in are a short, **explicitly listed** set that git's own list omits (measured on git 2.54.0:
`git rev-parse --local-env-vars` names 15 variables and `GIT_CONFIG_NOSYSTEM` is not one of them —
round 18 review caught this row omitting it while § 10.9 below and `git-environment.md` § 1 already
had it right). Calling the whole thing "derived" would be the same over-claim in a new spelling:
nobody maintains the second part, and adding to it is a deliberate edit. `F1i` and `P1` pin the two
scripts' `unset` blocks equal to the result.

## 2. Shell support: what was measured, and what changed underneath it

*(git-environment.md § 1, "The supported shells are bash and zsh")*

### 2.1 Why the prefix is written out literally

`GIT_ENV="env -u …"` followed by `$GIT_ENV git …` reads better and does not work. Splitting an
unquoted parameter expansion into words is POSIX behaviour that **zsh does not perform**, so the
whole string is looked up as a single command name and the fence dies at its first line with
`command not found`.

Measured across four shells: **zsh is the only one that does not split.** zsh has been the default
login shell on macOS since Catalina, so the skill was unusable on the platform most of its users
run while passing every test in the suite — the tests all executed the fences under `sh`.

### 2.2 The dash limit

`dash` is not a supported shell, and the cause predates the prefix. The sentinel strip uses
`${REPO_ROOT%$'\n'}`, and ANSI-C quoting is a bash/zsh extension dash does not implement:

```
R=$(printf 'a\n.'); R=${R%.}; R=${R%$'\n'}
  sh / bash / zsh  →  a
  dash             →  a + the newline
```

After which `git -C "$REPO_ROOT"` names a path that does not exist.

**How it fails matters more than that it fails**, because "unsupported" reads as "it will be
obvious" and it was not always. Two shapes, measured months apart:

| Shape | Behaviour under dash | Consequence |
|-------|----------------------|-------------|
| Fences run `git` inline (before the extraction) | **Exit 0, wrong answer.** The signing diagnostic reported `unset / unset / gpg` in a repository where signing *is* configured with a key | Step 1d's table reads that as "signing not configured" and steers `--execute` toward an unsigned commit in a repository that requires one |
| Fences delegate to a checked-in script (current) | **Exit non-zero, no answer** — all fourteen, measured | Fails closed |

The fourteen are every fence in `SKILL.md` that reaches a helper, outside the ````markdown`
illustration blocks — including the two nested under a numbered list item, which a column-0
fence pattern silently skips:

| Count | Fences | Under dash |
|-------|--------|------------|
| 10 | `"$INSPECT"` | exit 1, `⚠️ smart-commit-inspect.sh not found — run /install-scripts` |
| 3 | `"$EXECUTE"` | exit 1, `❌ smart-commit-execute.sh not found — run /install-scripts --skill smart-commit, then retry` |
| 1 | `run-skill.sh` delegation | exit 127 |

Every one of the fourteen prints **nothing to stdout**, which is the property that matters: a
caller cannot mistake the result for an answer.

The mechanism for the thirteen locator fences: `git rev-parse --show-toplevel` runs and succeeds,
dash leaves the trailing newline on `REPO_ROOT`, so *both* locator arms name a path that does not
exist, `[ -r ]` fails twice, and the fence takes its own refusal branch before running any of the
git commands the diagnostic is *for*. The fourteenth has no locator — it invokes `run-skill.sh`
through a path built the same broken way, and `/bin/bash` reports 127 for a script file it cannot open — not command lookup, which never happens because the path is spelled out.

`F1p` asserts the fence **count** exactly — so a fence added without one of these shapes fails the
test rather than quietly joining an inequality — and, per fence, only *non-zero status with empty
stdout*. The specific exit codes and messages in the table above are **measured, not pinned**: a
change that turned the 13 refusals into a different non-zero code with a different message would
keep `F1p` green and make this table stale. Re-measure it rather than trusting it.

**The locator converted a silent wrong answer into a loud refusal, and it was not designed to.**
That is the reason this is re-measured rather than remembered — it is a property of the current
shape, not a guarantee of the design, and it flipped once already without anyone noticing. The
paragraph in `git-environment.md` made a claim about dash that no test had ever checked, and it
went stale the moment the fences changed shape. `F1p` exists so the next flip is caught.

`/bin/sh` proves nothing on its own: it is bash on some systems and dash on others, so what it is
has to be checked rather than assumed.

### 2.3 The POSIX strip that is deliberately not used

```sh
NL=$(printf '\nx'); NL=${NL%x}; REPO_ROOT=${REPO_ROOT%"$NL"}
```

Measured to yield `a` in all four shells, so it would lift the dash limit outright. It is not
adopted because it changes **what the fences compute**, not how the prefix is spelled — a
correctness change wearing a portability change's clothes, landed in the middle of a security
refactor. It belongs in its own change with its own review.

## 3. The round-83 defect: two lists that must be one

*(git-environment.md § 1, "the skill's diagnostics and the commit they describe must strip the
same set")*

The prefix does not buy immunity from the environment, and saying so plainly matters because the
defect it was written against was narrower than "the environment can lie":

- The **executor's** `unset` list was re-derived from `git rev-parse --local-env-vars`.
- The **prefix** in the fences was not.
- `GIT_CONFIG_PARAMETERS` therefore reached the diagnostic but not the commit.
- The plan named one author. The commit recorded another. Neither printed a warning.

A variable left in *both* places is visible to Step 1c and reported. A variable stripped in one
place and not the other makes the plan and the commit disagree **silently** — and silence is the
whole defect. `F1i` now pins the two lists as equal; `F1j` pins both against git's own.

## 4. Why § 2 reuses § 1's list verbatim

*(git-environment.md § 2)*

§ 2 (what the skill *prints*) was originally the only section written literally, for a reason
specific to it: the user's shell has no variable the skill assigned, so a reference would expand
to nothing and silently remove the protection. § 1 arrived at the same form from a different
direction — zsh not splitting an unquoted expansion at all (§ 2.1 above).

The agreement is worth naming because of what it enables: a printed command can be checked against
an executed one **by comparing bytes**. Two lists that are merely "the same set" cannot be.

An earlier version made the prefix conditional on those variables being set *at planning time* —
the wrong shell and the wrong moment, since the condition is evaluated in the skill's shell and
the command runs in the user's, later. Recorded as `create-pr-stacked/2-tech-spec.md` item 40;
partial application is items 36–37 of the same file.

## 5. Why the fallback must not resolve the way the preferred path does

*(SKILL.md Step 1c, "**Fallback** — the claim is narrow")*

A fallback is only worth its lines if it survives what takes out the path it backs up. An earlier
revision routed **both** through `scripts/run-skill.sh`:

| | Preferred path | Fallback (earlier) | Fallback (now) |
|---|---|---|---|
| Resolution | `run-skill.sh git-profile git-profile.sh` | `run-skill.sh …` | by path — installed copy first, then the plugin checkout |
| Survives a missing/broken runner? | No | **No** | Yes |

`not found` is the fallback's own **primary trigger**, so the earlier shape had the single most
likely cause of falling back also destroying the thing being fallen back to. The two still share
the root derivation, `git` and `/bin/bash` — the claim in SKILL.md is deliberately narrow rather
than "the fallback always works", because a wider claim would be false and would stop anyone
looking for the real failure.

## 6. `run-skill.sh` cannot locate skill scripts in a consuming project

*(SKILL.md Step 1c, "**Known limitation.**")*

**Architecture-level; out of scope for the smart-commit hardening work. Logged, not fixed.**

`/install-scripts` flattens everything into one directory (`skills/install-scripts/SKILL.md:51-53`):

```
plugin checkout          consuming project
skills/<name>/scripts/…  →  .claude/scripts/…        (flattened)
scripts/run-skill.sh     →  .claude/scripts/run-skill.sh
```

There are **two** defects stacked here, and the first is the one that actually fires:

1. **The fence names a path the consuming project does not have.** Step 1c spells the delegation
   `"$REPO_ROOT/scripts/run-skill.sh"`, and `$REPO_ROOT` is the *consuming project's* root — where
   `/install-scripts` put the runner at `.claude/scripts/`, not `scripts/`. `bash` cannot open the
   file and exits 127; the runner never starts, so nothing below is reached. The other ten skills
   spell it cwd-relative and fail the same way for the same reason. Within `skills/**` this fence
   is the only `$REPO_ROOT/`-prefixed one — the string does appear in `test/scripts/`
   and two `create-pr-stacked` review logs, but those are *about* it, not instances of it.
   Derivation, so these are not another unreproducible count:

   ```bash
   grep -rho 'scripts/run-skill\.sh'              --include='*.md' skills/ | wc -l  # 37 total
   grep -rho '\$REPO_ROOT/scripts/run-skill\.sh'  --include='*.md' skills/ | wc -l  #  1 prefixed
   grep -rho 'scripts/run-skill\.sh' --include='*.md' skills/ \
     --exclude-dir=smart-commit | wc -l                                            # 34 elsewhere
   ```

2. **Reached at its installed location, the runner still misresolves.** `SCRIPT_DIR` is derived
   from its own location (`scripts/run-skill.sh:107-108`), so `.claude/scripts/run-skill.sh` gives
   `PLUGIN_ROOT=.claude/` and `TARGET=.claude/skills/<name>/scripts/<script>` (`:118`) — which
   `/install-scripts` never creates. This bites anyone invoking the installed runner directly.

Defect 1 is fixable **in this skill alone**, with the same two-step locator the ten `$INSPECT`
fences already use. Defect 2 is not: it is the runner's own contract.

**Scope: 11 skills, 35 delegating call sites** (registry: `docs/skill-catalog.yml`) — 37
occurrences less the two that are *about* the runner rather than calls to it: `SKILL.md`'s
"*resolution* — the preferred path goes **through** `scripts/run-skill.sh`" and
`references/execute-mode.md`'s "The script is **not** reached through `scripts/run-skill.sh`".
That leaves 34 elsewhere plus the one here.

They are **call sites**, not fences, and the split between the two is measured rather than
characterised: of the 34, **20 sit inside fenced blocks and 14 are inline code spans** in list
items and table cells. `skills/obsidian-cli/SKILL.md` alone carries **9** — 2 inline table cells
plus two separate ` ```bash ` blocks of 3 and 4, the largest single block in the file. § 2.2 draws
the fence/invocation distinction two sections earlier, and "call site" is the term that survives
it — a fence can hold several, and an inline span is one without being a fence.

```bash
# occurrences, and the fenced/inline split, tracking fence state per file
grep -rn 'scripts/run-skill\.sh' --include='*.md' skills/ | grep -vc '^skills/smart-commit/'   # 34
python3 - <<'PY'
import re, subprocess
hits = [h for h in subprocess.run(['grep','-rn','scripts/run-skill\.sh','--include=*.md','skills/'],
        capture_output=True, text=True).stdout.splitlines() if not h.startswith('skills/smart-commit/')]
by = {}
for h in hits:
    f, n, _ = h.split(':', 2); by.setdefault(f, []).append(int(n))
fenced = inline = 0
for f, nums in by.items():
    inside, marked = False, set()
    for i, l in enumerate(open(f, encoding='utf-8').read().split('\n'), 1):
        if re.match(r'^\s*```', l): inside = not inside; continue
        if inside: marked.add(i)
    for n in nums: fenced += n in marked; inline += n not in marked
print(fenced, inline)   # 20 14
PY
```

Line-number anchors are deliberately absent from that paragraph: an earlier revision cited
`SKILL.md:120` for the first of the two, and the real line was `:126`. § 7 of this document already
records why — round 10 inserted three lines into that file and every `:NN` anchor written here went
stale at once — so quoting the sentence is the form that survives an edit. Both defects are
shared by all of them. Fixing defect 1 here only, while the other ten keep the broken spelling,
would diverge one skill from a project-wide convention as a side effect of a security refactor: an
architecture decision made unilaterally under cover of unrelated work, and one that would still
leave defect 2 in place. Per `rules/fix-all-issues.md` § Exceptions ("Beyond current scope — needs
architecture-level change: report and log it, do not silently drop it"), both are recorded here and
the consequence is stated in SKILL.md, so a fallback in a consuming project is not misread as a
broken installation.

Two-step locators (`.claude/scripts/` first, then `skills/<name>/scripts/`) are the pattern that
*does* work across both layouts — which is why `smart-commit-inspect.sh` and
`smart-commit-execute.sh` use one and are unaffected.

## 7. Measurements behind the individual mechanics

*(git-environment.md § 1 — the four mechanics paragraphs led by "**The derivation carries a
sentinel…**", "**The sentinel is joined with `&&`…**", "**The prefix contains only `-u`…**" and
"**Pathspec literality is per-operand…**", plus the "What is **still active**" table. Those five
kept the rule and sent the evidence here; this section is where "measured" cashes out.)*

Cited by lead-in rather than by line number, deliberately: round 10 inserted three lines into that
file and every `:NN` anchor written here in the same round went stale at once. § 10 below is an
argument against reading a file by position; this section was the one place still doing it.

| Rule | Measurement |
|------|-------------|
| `printf .` sentinel | Against a real repository named `repo<newline>`: the direct `$( )` form yields a non-existent path, the sentinel form the real one. A newline in the *middle* of a path component always survived; only the trailing one was ever at risk, because `$( )` strips every trailing newline and `--show-toplevel` has no `-z` form |
| `&&` not `;` before the sentinel | A substitution reports its *last* command's status, so `git …; printf .` hands back `printf`'s exit 0 whatever git did. `REPO_ROOT` becomes empty, every later `git -C ""` acts on the current directory, and the `\|\| { … }` guard is attached to something that cannot fail. `&&` skips `printf` when git fails, so the status is git's — **and on the success path it emits exactly the same bytes**, which is why the change is safe as well as correct. Test `F1h`, with the `;` form as its control |
| `\|\|` on the substitution, not after the strips | The two trailing parameter strips always succeed, so a guard written after them never fires |
| Prefix contains only `-u`, never an assignment | `env` stops parsing options at the first `VAR=value`, so a `-u` written after one is taken as the *command to run* and the call dies with exit 127 — measured, not inferred. This is why `-u ALLOW_AI_COAUTHOR` lives in the prefix and `--ai-co-author` re-adds `ALLOW_AI_COAUTHOR=1` **after** it |
| `:(literal)` per operand, not `GIT_LITERAL_PATHSPECS` | The variable would have been the shorter fix and the wrong one: `git` exports its environment to everything it launches, so an exported `GIT_LITERAL_PATHSPECS=1` reaches the repository's own hooks, where a legitimate `git diff --cached -- '*.js'` would silently match nothing and skip its checks |
| `GIT_CONFIG_GLOBAL` now stripped (round 19) | Originally measured as "still applies": returned an injected `user.email` in a repository with none set locally, outside git's local-env list. Round 19 found `GIT_CONFIG_GLOBAL`'s fallback (`$HOME/.gitconfig`, then `$XDG_CONFIG_HOME/git/config`) is reachable through `HOME`/`XDG_CONFIG_HOME`, which the script never strips, so an attacker-controlled `GIT_CONFIG_GLOBAL` could redirect global config to an arbitrary file. Added to both scripts' `unset` blocks and the canonical prefix. Oracle: `P8x` (§ 10.11) |
| `GIT_CONFIG_SYSTEM` now stripped (round 20) | Same original measurement, and round 19 kept it unstripped on the theory its fallback has no `HOME`-shaped env-reachable escape hatch — true, but irrelevant to the actual attack, which sets the variable directly rather than routing through the fallback. Round 20 found this redirects `core.hooksPath`/`core.fsmonitor` the same way `GIT_CONFIG_GLOBAL` does, forging the AI-guard verdict and running arbitrary commands. Rationale and the concrete real-system-gitconfig evidence: `git-environment.md` § 1, § 10.12. Oracle: `P8y` (§ 10.12) |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` still apply | `git var GIT_AUTHOR_IDENT` returned the injected name under the prefix. Step 1c diagnoses and reports these separately rather than stripping them |
| `HOME` / `XDG_CONFIG_HOME` still apply, closed at the point of use (round 21/22) | `$HOME/.gitconfig`-forged `core.hooksPath` read back as `guard:installed` before the fix; `core.fsmonitor`/`core.attributesFile` set to a shell command via the same file fired on `status`, `diff`, **and** a plain `git commit`. A scope check (`guard` trusts only `local`/`worktree`) and command-line pins (`-c core.fsmonitor=false -c core.attributesFile=/dev/null` on every status/diff/commit call) close both, without stripping `HOME` itself — `identity` still needs it. Oracles: `P8z`/`P8z2`/`P8z3`/`P8z4`/`P8z5` (`smart-commit-inspect.test.js`, § 10.13/§ 10.14) and the execute-side `core.fsmonitor`/`core.attributesFile`/`core.hooksPath` cases in `smart-commit-execute.test.js` |

## 8. Why `smart-commit-inspect.sh` establishes privileged mode itself

*(smart-commit-inspect.sh, the `SD0X_PRIV_REEXEC` block)*

The file opens `#!/bin/bash -p`, and on the documented launch path that line **never executes**:

```
/bin/bash -p -- <path-to-this-script> <subcommand>
```

Passing a script as an argument bypasses its shebang entirely, so `-p` is whatever the caller
typed — the shebang is decoration on the path the skill actually takes. The same reasoning is
written out in `smart-commit-execute.sh` and `scripts/run-skill.sh` lines 5-54, and this script
now mirrors it rather than relying on the caller — **including the cleanup**: `SD0X_PRIV_REEXEC`
is `unset` once the guards have passed, as both siblings do. Left exported it reaches every
process git launches, and a descendant sd0x script started as a plain `bash <script>` inherits it,
skips its own re-exec, has no `p`, and aborts on its own guard — a denial of service on a
legitimate setup rather than a security gain. Round 9 review found this missing while the sentence
above already claimed the mirroring; `P18c` now pins it, using `diff.external` as the shortest
real path from a subcommand to an arbitrary child process.

**Why the caller's `-p` is not sufficient**, even though the ten shipped fences do pass it (pinned
by `F1o`): `/install-scripts` puts a copy at `.claude/scripts/smart-commit-inspect.sh`, where it is
an ordinary script any caller may invoke. And what it answers is not incidental — identity, signing
and AI-guard readiness are the inputs to the author a commit records, which is CLAUDE.md rule 3
(Anchor) territory.

Measured, with a file defining `git() { printf 'branch-ATTACKER\n'; }`:

| Launch | Before | After |
|--------|--------|-------|
| `BASH_ENV=shim /bin/bash -p -- inspect.sh branch` (shipped) | real branch | real branch |
| `BASH_ENV=shim /bin/bash -- inspect.sh branch` (any other caller) | **`branch-ATTACKER`** | real branch |

`P18` is the oracle, and it carries its own negative control — it first proves the shim really
does shadow `git` under a shell that does not re-exec. Without that control a passing assertion
would only show the fixture was inert.

### 8.1 The two `case` guards are not redundant

`SD0X_PRIV_REEXEC` is an ordinary environment variable. It is **not** in the `unset` block — it
cannot be, since it is read before that block to decide whether the re-exec has already happened —
and it is therefore **attacker-settable**. Anyone may claim the re-exec already ran:

```
SD0X_PRIV_REEXEC=1 /bin/bash -- inspect.sh branch
```

Read alone, the sentinel makes the two `case` blocks that follow look like belt-and-braces around
a decision already made. They are the opposite: they are the only thing standing between that
line and an unprivileged run.

| Guard | Catches | Measured against a mutant with the guard deleted |
|-------|---------|--------------------------------------------------|
| `case "$-" in *p*)` | The sentinel set on a non-privileged shell | `env 'BASH_FUNC_git%%=() { … }' SD0X_PRIV_REEXEC=1 /bin/bash -- inspect.sh branch` → **forged branch at exit 0**. Oracle: `P18b` |
| `case "${BASH_ENV+x}"` | `BASH_ENV` surviving into a shell that is otherwise privileged | Deleting this guard does **not** forge an answer at this layer: real `-p` already ignores `BASH_ENV` for its own startup, so a shim exported through it is never sourced into the script itself — measured directly, `SD0X_PRIV_REEXEC=1 BASH_ENV=shim /bin/bash -p -- inspect.sh branch` with the guard deleted and `shim` exporting a `git` shell function still answers the *real* branch at exit 0. What the guard buys is depth against where `BASH_ENV` actually is read: it reaches any **bash** child a git subcommand spawns without its own `-p` (measured with `diff.external` pointed at a `#!/bin/bash` script: it sources the shim; the identical setup with a `#!/bin/sh` script does not — `sh` never reads `BASH_ENV` at all, on this platform). Oracle: `P18e` asserts the guard halts (non-zero exit, the guard's own message) rather than asserting a forged answer, which this layer cannot produce |

Both fail **closed**, and the mechanism is `${SD0X_PRIV_GUARD:?…}` alone — **not** `set -u`, which
sits after all three guard blocks (`:26-42`), and has not executed when they run. Measured, so the
two are not confused again:

| Construct | Null value | Unset |
|-----------|-----------|-------|
| `${X:?word}`, no `set -u` | **aborts**, non-zero, nothing after it runs | **aborts** |
| `set -u` alone, `X=""` | runs clean | aborts |

`:?` is what aborts, during expansion, rather than relying on a branch being taken. The
`SD0X_PRIV_GUARD=''` assignment in front of it is not decoration either: `:?` is satisfied by any
non-empty value, so an attacker who exports `SD0X_PRIV_GUARD=x` would walk straight through a bare
`${SD0X_PRIV_GUARD:?…}`. Nulling it first makes the abort unconditional. The one combination that
skips the re-exec and still answers is the sentinel plus a genuinely privileged shell with no
`BASH_ENV` — acceptable, because `-p` already supplies exactly what the re-exec exists to
establish.

Deleting either block used to leave the suite green — before `P18b` for the first, and before
`P18e` for the second. That is why each exists.

## 9. `--untracked-files=all`: a security fix with a measured cost

*(SKILL.md Step 3; smart-commit-inspect.sh `collect`/`status`/`scope`)*

Two separate defects, found one round apart, both about the same flag.

### 9.1 Not inherited — `showUntrackedFiles=no` fakes a clean tree

`status.showUntrackedFiles=no` is a **legal** setting; people use it on repositories with noisy
build output. Under it `git status --short` drops every `??` line and exits **0**. The status
accumulator added for `collect` cannot catch that, because nothing failed — the answer is empty
*and successful*, which SKILL.md Step 3 documents as "No uncommitted changes" and Step 6 reports
as "All clear". Measured: a brand-new file, `status` → empty, rc 0. Pinning the flag removes the
config from the decision. Oracle: `P17`, parameterized over all three readers.

### 9.2 The value: `all`, not git's default `normal`

The first fix pinned `normal` — git's own default — on the reasoning that a fix should not change
behaviour. **That reasoning was wrong**, and the counter-argument is what the value turns on: the
*consumer* of this output is SKILL.md Step 3's exclusion list, which matches **filenames**
(`.env*`, `*.pem`, `id_rsa*`, `credentials.json`, …).

```
$ mkdir secrets && echo "PRIVATE KEY" > secrets/id_rsa && echo cert > secrets/app.pem
$ inspect collect            # -u normal → ?? secrets/          (no filename to match)
                             # -u all    → ?? secrets/app.pem
                             #             ?? secrets/id_rsa
```

Under `normal` the exclusion list has nothing to fire on, and the only operand Step 5c.2 can stage
is `secrets/` — which commits the private key. `rules/git-workflow.md` § Prohibited "Commit
containing secrets" is Anchor Register #2, so the value is not a preference. Oracle: `P17b`.

### 9.3 The cost, stated because the first version of this note hid it

The original comment said only that `all` "still honours .gitignore, so an ignored node_modules/
does not enumerate" — true, and an answer to the case that was never the risk. The case that is:

| Untracked tree | `-u normal` | `-u all` |
|----------------|-------------|----------|
| gitignored `node_modules/` | 0 lines | 0 lines |
| **not** gitignored, 500 files | 1 line | **500 lines** — one per file, by construction |

The line count is exact and needs no fixture. The **byte** count does not follow from it: every
line is `??` plus the path, so the size is dominated by path depth, not file count. Measured over
500 empty files, varying only the directory they sit in:

```bash
# in a scratch repo with one commit:
d=probe/some-package/lib; mkdir -p "$d"
i=1; while [ $i -le 500 ]; do : > "$d/module-$i.js"; i=$((i+1)); done
git status --short --untracked-files=all | wc -l   # 500
git status --short --untracked-files=all | wc -c   # bytes, below
```

| Path shape | Bytes |
|------------|-------|
| `probe/module-N.js` | 11,392 |
| `probe/a/b/c/d/module-N.js` | 15,392 |
| `probe/some-package/lib/module-N.js` | 19,892 |

Quote a range, never one number: a `node_modules`-shaped tree is about **75% more** than a flat one (19,892 / 11,392 = 1.75x).
Every one of those lines enters the model's context, and SKILL.md's 15-file group cap turns 500
files into ~34 commit groups. The security property is worth it; a note that mentions only the
reassuring half is how the next maintainer reverts it — the same "wrong in the reassuring
direction" failure recorded in § 1. (The figure this table replaced, "504 lines, ~13 KB", was
measured in a fixture that already had four dirty files and never had its command recorded — an
unreproducible number in the row that states the cost is that same failure pointed the other way.)

### 9.4 Two directories stay collapsed even under `all`

`all` does not mean "every path is enumerated". git will not traverse:

| Kind | Reported as | Stages as | Content committed |
|------|-------------|-----------|-------------------|
| Embedded repository (`dir/.git` exists) | `?? embedded/` | gitlink `160000` | none |
| Symlink to a directory | `?? linkdir` | symlink `120000` | none |

Measured. The exclusion argument in § 9.2 is unaffected — neither form carries file content into
the commit — but the invariant must be stated with these exceptions, because the security claim
rests on it and an unqualified version is simply false.

Pinned by `P17c`, which asserts both collapsed forms **and** an ordinary nested directory that must
still enumerate. Without that third arm the case would keep passing if `all` were lost altogether,
which is the exact regression § 9.2 exists to prevent.

## 10. `identity` output is keyed, not positional

*(SKILL.md Step 1c, "**Read the output by key and kind, never by line number.**"; smart-commit-inspect.sh, the
`identity` subcommand)*

The extracted script initially reproduced the fences verbatim — two bare `git config
--show-origin --show-scope --get-all` reads — and `P8` pinned the result by **position**
(`lines[0]` is the name, `lines[1]` is the email). Neither the fences nor the pin were safe, and
the extraction made it worse by turning a shape into a documented output contract plus a test that
taught the unsafe reading.

`--get-all` prints **one line per configured value, and nothing at all when the key is unset**.
Both departures from "one line per key" are exactly the cases Step 1c branches on, so a positional
reader is correct only when it does not matter and wrong whenever it does. Measured in a hermetic
fixture (`GIT_CONFIG_GLOBAL=/dev/null`), reading the pre-fix output positionally:

| Repository state | Line 1 | Positional reading | The branch that never fires |
|---|---|---|---|
| `user.name` unset, `user.email` set | the **email** row | name = `dev@example.com` | `user.name` empty → **HALT** |
| `user.name` twice, `user.email` once | first name row | name = `Alice`, email = `Bob` | multiple values → **AskUserQuestion** |

Both outcomes are an unintended author on the commit — CLAUDE.md rule 3, Anchor Register #4. The
first is the worse one: a repository with no `user.name` at all is precisely when the HALT exists,
and the positional reader sails past it with a plausible-looking string.

The first fix copied `signing`, which *looked* like it had solved the same problem already
(three keys → three lines, `|| printf 'unset\n'`, pinned by `P9`): prefix every line with its key,
and let an unset key emit `<key><TAB>unset`. That closed the positional misreads and opened a worse
hole, because it made a *config value* able to write the sentinel — § 10.1. And the model it was
copied from had not solved anything: `signing` carried both defects untouched, which § 10.2 records
rather than leaving this paragraph's earlier claim standing.

This was a **pre-existing** defect, inherited from the fences. It is fixed here rather than logged
because `rules/fix-all-issues.md` names "pre-existing" as an excuse the rule exists to ban, and
because this change is what made it a contract.

### 10.1 The sentinel has to be unforgeable, not merely present

*(round 90, P1 + two P2 from review)*

Prefixing each line with its key is not enough, because `--get-all` splits a **multi-line value**
across lines and the continuation lines carry no scope/origin. The prefixing loop stamped the key
onto each of them, so a value of `Real Person`⏎`unset` produced, verbatim:

```
user.name local file:.git/config Real Person
user.name unset
```

The second line **is** the HALT sentinel, forged out of repository content. Step 1c then halted
with "run `git config --local user.name`" on a repository where `git commit` succeeds — and the
same input also fired the AskUserQuestion row, offering fragments of one value as candidate
profiles. Two claims elsewhere were false while this held: SKILL.md's `<key><TAB><scope>…` line
shape, and this section's own "one line per configured value".

Five properties now hold, and each is what a specific attack needs:

| Property | How | Without it | Oracle |
|---|---|---|---|
| Field 2 is a **kind** the script writes (`value` / `empty` / `unset`) | Never read out of config | Any sentinel is forgeable by a value that spells it | `P8d`, `P8k` |
| One record is exactly **one line** | Records read NUL-delimited (`git config -z`), then escaped | A newline in a value writes a second line | `P8d` |
| Field **count** is fixed per kind | The tab and CR escapes | A tab splits the value field in two | `P8h` |
| **Every data field** is escaped, not just the value | `esc` applied to value, origin **and** the four env values | Round 11 measured both holes: a config file named with a tab in it broke the field count for an ordinary value, and a newline in `GIT_AUTHOR_NAME` forged a whole `user.email` record | `P8i`, `P8j` |
| A failed read answers **nothing for the key that failed** | Each key's lines buffered until its status is known | A truncated stream printed a well-formed but bogus record before aborting | `P8g` |

The scope of the last row is exactly one key: keys are read in sequence, so a failure on the
second leaves the first key's records already flushed. `P8f`/`P8g`/`P9c` all break the **first**
key, which is why their `assert.equal(r.stdout, '')` holds — a fact about those fixtures, not a
guarantee the contract makes. What is guaranteed is that no *partial* answer for the failing key
reaches stdout, and that the exit status is non-zero whatever was printed before it.

The fourth row is the one worth dwelling on. "No **config value** can forge a record" was true as
written and still the wrong invariant: the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` lines are the one
data channel the script deliberately keeps, and they were printed raw. The claim has to be about
*data*, not about one source of it. Round 92 found the same lesson a second time from the other
end: the round-11 fix had landed on only **three** of the four — `GIT_COMMITTER_EMAIL` was still
printed raw, and the forgery reproduced through it verbatim. The oracle pinned one variable, so a
one-of-four fix read as complete. `P8i` now loops all four, and the loop *is* the assertion.

**Records arrive in git's own precedence order, and the last one for a key is what git would use.**
That fact is load-bearing and was missing from the first version of this contract, which produced a
defect of its own: the `empty` kind was introduced with a decision row reading "`<key><TAB>empty` →
HALT", so an empty `user.name` in `~/.gitconfig` overridden by a real one in `.git/config` emitted
both an `empty` and a `value` line and halted a repository that commits perfectly well. The mirror
case — a global value overridden by a local empty, where git genuinely refuses — matched the
*silent continue* row. Measured in both directions; Step 1c now evaluates the **last** record per
key, and the earlier rows are what an unordered reading of an ordered stream costs.

The claim is load-bearing in two documents now, so it is derived rather than asserted. Four
layerings, `git config --get` agreeing with the last record every time:

| Layering | Records, in order (scope → value) | `--get` |
|---|---|---|
| system + global + local | SYSTEM, GLOBAL, LOCAL | LOCAL |
| two `--add`s in one file | GLOBAL, LOCAL, LOCAL2 | LOCAL2 |
| `include.path` placed **after** the local value | …, local BASE, local INCLUDED | INCLUDED |
| `include.path` placed **before** the local value | …, local INCLUDED, local BASE | **BASE** |

The fourth row is the one that earns the table: the rule is genuinely *last record wins* and not
*most specific scope wins* — an include can be overridden by a value below it in the same file. A
reader who assumed scope precedence would get that case backwards. `--file` and `command` scope
cannot appear at all: `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` are in the
unset block, and `emit_config_records` itself — the function this claim is about — passes no `-c`
(round 18 review, Nit: rounds 17–18 added `-c color.ui=false` and friends to the `status`/`log`/
`diff` call sites elsewhere in the script, which narrows the scope of this sentence to the config
reader specifically rather than the script as a whole).

The record format was measured rather than assumed: `-z --show-origin --show-scope --get-all`
emits `<scope>NUL<origin>NUL<value>NUL` per value — three NUL-terminated fields, with any embedded
newline staying inside the value field (`od -c`). NUL is also why the value can no longer be
captured with `$( )`: bash drops NUL bytes from command substitution — silently on the documented
`/bin/bash` 3.2, and with `warning: command substitution: ignored null byte in input` on bash ≥ 4.4;
either way the bytes are gone, which is what matters here. The loop therefore
reads from a process substitution — which runs the loop body in the *current* shell, so the status
can be carried out of it — and the subshell appends its own exit status as a final `rc=N` record.
That record is identifiable by structure, not by content: it is the only one with no two records
following it, because git always emits complete triples. That last invariant is the load-bearing
one, so it is measured rather than assumed: the worst case is a key with no value at all
(`[user]` then a bare `name`), and `-z` still emits `<scope>NUL<origin>NUL NUL` — a complete triple
whose value happens to be empty.

An empty `rc` — the stream ended before the status record — falls into the same abort branch as any
non-1 status. It is reachable, not theoretical: a git that dies part-way through a value's three
fields leaves the `rc=N` record to be consumed as that value's third field, so `rc` is never
assigned. Before the buffering above, that path **printed** a bogus `value` line to stdout and only
then aborted — a line indistinguishable from a real identity, reaching a reader that would have to
know to discard it. It now prints nothing at all and aborts with exit 1 and the stderr message.
`P8g` is the oracle, and it exists because this branch had none.

**The empty value** (P2) was the second fail-open: `git config user.name ""` exits 0 and yielded a
four-field line indistinguishable from a real identity, so Step 1c continued silently. What happens
next depends on which key it is, and round 13 measured both: an empty `user.name` makes `git commit`
refuse outright with `Author identity unknown`, which is precisely the failure Step 1c exists to
pre-empt; an empty `user.email` is **accepted**, landing a commit attributed to `Dev <>`. The HALT
is right for both, but for two different reasons — see § 10.4. It now answers `<key><TAB>empty<TAB><scope><TAB><origin>`.

**The read-failure branch** (P2) had no oracle: replacing its abort with the fail-open
`<key><TAB>unset` it was written to prevent left the suite fully green. Its premise was also
unevidenced — every config-read failure constructible from the repository itself is caught earlier
by the root guard, measured here:

| Attempted trigger | `rev-parse` | `git config --get-all` | Reaches the branch? |
|---|---|---|---|
| `chmod 000 .git/config` | **128** | 128 | No — the `REPO_ROOT` guard aborts first |
| `include.path` → missing file | 0 | 0 | No — git ignores a missing include |
| `include.path` → unreadable file | **128** | 128 | No — root guard again |
| `include.path` → malformed file | **128** | 128 | No — root guard again |
| `git` that fails only on `config` | 0 | **128** | **Yes** |

The last row is the oracle (`P8f`, a PATH shim, with a negative control proving the abort comes
from the config read and not from the shim breaking git at all), and it is not merely synthetic:
git < 2.26 rejects `--show-scope` as an unknown option and exits non-zero on exactly this call
while `rev-parse` still succeeds.

Oracles: `P8` (keyed and kinded, both keys present), `P8b` (multi-valued), `P8c` (unset key, with
the control that no line may be readable as a name merely by arriving first), `P8d` (a newline in
a value cannot forge the sentinel), `P8e` (empty value, with the control that a non-empty value in
the same run still reads `value`), `P8f` (read failure never reported as unset), `P8g`
(truncated read answers nothing), `P8h` (tab and CR), `P8i` (env forgery), `P8j` (origin escape),
`P8k` (every kind the script emits has a row in Step 1c — the oracle whose absence let the `empty`
row above ship green), `P8k2` (the same check for Step 1d, per key **and** per kind) and `P8k4`
(the same check again for `effective`'s two kinds, `value`/`unresolvable`).

Each is mutation-verified, and the mutation is named so the claim is checkable rather than
asserted:

| Mutation | Reddens |
|---|---|
| Drop the newline escape | `P8d`, `P8i`, `P9b` |
| Drop the tab escape | `P8h`, `P8i`, `P8j` |
| Drop the CR escape | `P8h` |
| `if true` in place of the empty-value check | `P8e` |
| Print the env values unescaped | `P8i` |
| Drop the origin escape | `P8j` |
| Rename a kind (`empty` → `blank`) | `P8e`, `P8k` |
| Print each record instead of buffering | `P8g` |
| Fail open on a read error | `P8f`, `P8g`, `P9c` |
| Drop `-z` | `P8`, `P8b`, `P8c`, `P8d`, `P8e`, `P8h`, `P8i`, `P8j`, `P9`, `P9b` |
| Print `GIT_COMMITTER_EMAIL` unescaped (the one the round-11 fix missed) | `P8i` |
| Drop `--type=bool` from the `commit.gpgsign` read | `P9d`, `P9e`, `P9f` |
| Delete Step 1d's `commit.gpgsign<TAB>unset` row | `P8k2` |
| Emit a kind as `printf -v line '%s\tnewkind\n'` | `P8e`, `P8k`, `P8k2` |
| Collapse exported-empty into unset (the `${VAR:-}` semantics) | `P8l` |
| Drop the backslash escape | `P8n` |
| Delete Step 1c's exported-empty NAME row | `P8k3` |
| Rename `effective`'s `unresolvable` kind | `P8k4` |

`P8m` is deliberately **not** in this table, and the omission is the point: it pins *git's*
behaviour, not this script's, so no mutation of this repository can redden it. Measured — deleting
the entire `emit_env_record` call reddens `P8`, `P8i`, `P8l` and `P8n` and leaves `P8m` green. It is
a fact-pin, and its job is to fail the day git changes what an empty ident does, which is the day
four rows of Step 1c stop being true. Calling it a regression guard would overstate it.

Three of the first ten rows said something narrower until round 12 re-measured them, and the reason
is worth keeping: they were written **before** § 10.2 moved `signing` onto the same reader, and were
not re-run afterwards. Sharing a reader means a mutation to it reddens `signing`'s oracles too —
which is the property § 10.2 was for, showing up as a correction to the table that claimed to
verify it. Re-run them rather than trusting them; that is the whole point of writing them down.

The last row is the one that pays for the format of this table. `P8k` derives the kinds from the
emitter by regex, and its two original patterns matched `…\t<kind>\t` and `…\t<kind>\n` in two
*different* printf spellings — so a kind written in the third combination was invisible to the
coverage oracle. One pattern covers both spellings and both terminators now.

### 10.2 `signing` had the same two defects, untouched

Round 11 measured what § 10 had assumed. `signing` read three keys with `--get` and printed three
bare lines, so **position** was its whole contract — the defect `identity` had just been rewritten
away from, in the file's own sibling subcommand. Both halves were reachable:

| Defect | Trigger | Consequence |
|---|---|---|
| Positional | `user.signingkey` = `AAAA`⏎`unset` | Output becomes four lines; Step 1d reads line 3 as `gpg.format` and gets `unset`, losing a configured `gpg.format=ssh` — it then reports the wrong signing format for a repository that signs |
| Fail-open | `2>/dev/null \|\| printf 'unset\n'` | A config that cannot be READ is reported as a key that is not SET — the exact conflation the `identity` rewrite closed |

`signing` now shares `emit_config_records` with `identity`, so the two **readers** cannot drift
again: one reader, one escape table, one fail-closed split. That is a narrower claim than it first
read as — the decision tables in Step 1c and Step 1d are still two documents that can drift from
the reader and from each other, which is what `P8k`/`P8k2` exist to catch, and § 10.3 is the drift
they caught. The visible change is that an unset `gpg.format`
answers `gpg.format<TAB>unset` rather than git's `gpg` default — the script reports the fact and
Step 1d applies the default, because a script that answers with a default is indistinguishable from
one that answers with a measurement. Oracles: `P9` (keyed), `P9b` (the line shift), `P9c` (the
fail-open), `P9d`–`P9f` (§ 10.3).

### 10.3 Sharing a reader shared a representation, and one key could not use it

Round 12. The shared reader reports the **raw** config string, which is exactly right for
`user.name` and lossy for `commit.gpgsign`, because git reads that key as a boolean and the string
does not carry the boolean. Measured with local config only:

| `.git/config` | `git config --bool` reads | record the shared reader emitted |
|---|---|---|
| `[commit]`⏎`gpgsign` | **true** | `commit.gpgsign⇥empty⇥local⇥file:.git/config` |
| `[commit]`⏎`gpgsign =` | **false** | `commit.gpgsign⇥empty⇥local⇥file:.git/config` |
| `gpgsign = 1` | true | `commit.gpgsign⇥value⇥…⇥1` |
| `gpgsign = false` | false | `commit.gpgsign⇥value⇥…⇥false` |

Rows 1 and 2 are byte-identical and mean the opposite, so **no decision row could have fixed
this** — the distinction is gone before Step 1d sees the output. Rows 3 and 4 matched no row
either: Step 1d keyed on a literal `…true`, so `1`/`yes`/`on`/`True` (all true to git) and `false`
(the project's own fixture) left the reader with no instruction at all.

The failure was end-to-end, not theoretical: a valueless `[commit] gpgsign` with `user.signingkey`
unset makes `git commit` abort with `gpg failed to sign the data / No secret key`. That is precisely
the case Step 1d's ⚠️ warning exists to catch pre-flight, and in `--execute` mode it could not fire.

The fix is to ask git for the boolean rather than parse one: `emit_config_records` takes optional
extra `git config` arguments, and `commit.gpgsign` alone is read with `--type=bool`. git normalises
every true spelling to the literal `true`, `empty` becomes unreachable for the key, and a
non-boolean exits 128 straight into the existing fail-closed branch. That last part is **not**
stricter than git, which is the objection worth pre-empting: `git config --bool --get` exits 128 on
the same config, and `git commit` refuses it too (both measured; `P9f` pins the git half so the
claim cannot rot). Step 1d gained rows for `value…false` and for the now-unreachable `empty`, and
`P8k2` is what will notice next time a key's reachable kinds and its decision table disagree.

### 10.4 The same lesson, a third time: the env channel had no kinds either

Round 13. `identity` printed the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` values as
`GIT_AUTHOR_NAME=<value>` using `${VAR:-}`, which collapses **exported-and-empty** into
**not-exported** — the same conflation the `empty` kind was introduced to close for config values
(§ 10.1) and that `--type=bool` closed for `commit.gpgsign` (§ 10.3). Two rounds had already paid
for this lesson on other channels; this one shipped with a test that pinned the blank line as
correct — since replaced. `P8` now asserts the opposite quoted sentence, "an absent one is
\`unset\`, which is not the same answer as exported-and-empty" — the stale `:324` line-number
form this sentence used to carry is exactly what § 7 warns against; a quoted assertion string
cannot go stale the way a line number does.

Empty is not a benign state, and git splits it two ways. Measured, one variable at a time, in a
repository whose config identity is valid (`P8m` pins both halves so the rows citing them cannot
rot):

| Exported empty | `git commit` | Recorded |
|---|---|---|
| `GIT_AUTHOR_NAME` | **rc 128** `fatal: empty ident name (for <d@x.test>) not allowed` | — |
| `GIT_COMMITTER_NAME` | **rc 128**, same | — |
| `GIT_AUTHOR_EMAIL` | rc 0 | `Dev <>` / `Dev <d@x.test>` |
| `GIT_COMMITTER_EMAIL` | rc 0 | `Dev <d@x.test>` / `Dev <>` |

So the collapsed line hid a hard halt behind one row and a silent loss of attribution behind
another — the second being exactly what CLAUDE.md rule 3 exists to prevent. The four are now
emitted with the config record's key/kind shape minus scope and origin, `${!name+set}` doing the
work `${VAR:-}` could not. Oracles: `P8l` (the kinds), `P8m` (git's two behaviours).

**The table was also non-total in the other direction.** Round 13 measured a repository with no
config identity and all four variables exported: `git commit` succeeds as `CI Bot <ci@x.test>`,
while Step 1c's `unset` row fired **HALT** and printed `git config --local user.name "…"` — advice
the environment would then shadow anyway. That is the round-90 defect ("halted with setup guidance
on a repository where `git commit` succeeds") returning through table incompleteness rather than
through a forged sentinel, which is why `P8k3` now checks the env kinds against Step 1c's rows the
way `P8k`/`P8k2` check the config ones. Step 1c resolves the four **roles** first — git takes each
`GIT_*` variable when exported and falls back to `user.name`/`user.email` only when it is not — and
only then judges.

Two related claims in that table were wrong and are now measured rather than asserted:

| Claim as written | Measured |
|---|---|
| an empty config value: "`git commit` refuses this outright (`Author identity unknown`)" | True for `user.name`. **False for `user.email`** — it commits as `Dev <>`. The HALT stands, on attribution grounds, not because git refuses |
| an unset config identity implicitly refuses | **False** — git guesses from the OS and commits (`yuhao <user@hostname.local>`). It refuses on its own only under `user.useConfigOnly=true`. The HALT is policy: a guessed identity is the misattribution the halt exists to prevent |

Both were the kind of claim that reads as a fact and functions as a justification, so the next
maintainer relaxes the row on a premise nobody re-ran.

**And the backslash escape had no oracle.** Deleting `ESC=${ESC//\\/\\\\}` left 94/94 green,
though the code comment calls it load-bearing ("Backslash first, or the escape stops being
injective") — 94/94 was the two suites' size at that moment; they are **132** now (80 + 52,
`node --test`'s own count — round 18 review, P2: this figure previously read 115/63+52, stale by
one round; re-derive with `node --test test/scripts/smart-commit-inspect.test.js
test/scripts/smart-commit.test.js 2>&1 | grep -E '^# (tests|pass)'`; 122 by a static `^test(` scan,
which does not see the parameterized `P17`/`P19`/`P19d` loops), and the mutation
reddens `P8n` alone and `SKILL.md` publishes `\\` in the escape table, so a reader decodes it. Without the
encoder rule, a value containing the two literal characters `\` `n` decodes at the reader into a
newline — the `P8i` forgery one layer up, through a channel every other escape was tested on.
`P8n` closes it, on both the config and the env channel.

### 10.5 Enumerating the channels, instead of waiting for the next round to find one

Rounds 11, 12 and 13 each closed a real defect, and each defect was the **same contract failing on
a channel the previous round had not looked at**: config values and origin paths, then a boolean
key whose raw string could not carry git's semantics, then the four environment variables and the
escape rule that keeps the escaping injective. Three rounds is enough to name the pattern — the
contract was being applied channel by channel, so the loop's cost was one round per channel and it
would keep converging one channel at a time.

So the channels are enumerated here as a closed list, each checked against the contract now rather
than when a reviewer reaches it. "Safe by construction" is stated only where it was measured, and
it is a different guarantee from "guarded" — the distinction matters, because a future edit can
remove a construction guarantee without touching anything that looks like a safeguard.

| # | Channel | Who controls the bytes | How it is safe | Oracle |
|---|---|---|---|---|
| 1 | Config value | User / attacker | `esc` — `\\` first, then `\n`, `\t`, `\r`, then every other C0 control byte and DEL as `\xHH` (round 17) | `P8d`, `P8e`, `P8h`, `P8n`, `P8v` |
| 2 | Config origin path | Filesystem | `esc`, same table (including the `\xHH` half) | `P8j`, `P8v` |
| 3 | Config scope | git (fixed enum) | `esc` — belt-and-braces; deleting it reddens nothing, and the script says so | — |
| 4 | Config key name | Script literal | Written here, never read from config | `P8`, `P8c` |
| 5 | Kind | Script literal | Written here; this is what makes the sentinel unforgeable | `P8d`, `P8k`, `P8k2`, `P8k3` |
| 6 | Identity env values | Environment | `esc` **and** a kind, since exported-empty ≠ unset — same `\xHH` half as row 1 | `P8i`, `P8l`, `P8n`, `P8v` |
| 7 | `commit.gpgsign` | Config | git normalises via `--type=bool`; the raw string could not | `P9d`–`P9f` |
| 8 | `status --short` paths in `collect` / `status` / `scope` | Filesystem | **git's** quoting, not ours: `status --short` quotes a control character, and `core.quotePath=false` does not disable that (it governs non-ASCII only). Both measured. Pinned against forced ANSI by `-c color.ui=false -c color.status=false -c color.diff=false` and `--no-pager` (rounds 17–18: `color.status`/`color.diff` are more specific than `color.ui` and were not covered by the round-17 fix alone; `status` pages under `pager.status=true`, a legal value `pager.status=false`'s default status does not cover) | `P10b`, `P19`, `P19d`, `P20` |
| 8b | `diff --stat` paths — `collect`'s other two commands | Filesystem | Same guarantee, separately measured: `diff --stat` also quotes a control character in a path and also ignores `core.quotePath=false`. Same `color.status`/`color.diff` pin as row 8 |  `P10b` (status half only), `P19d` |
| 8c | `diff` subcommand — patch text | File contents | **The contract does not apply**: this is not a record stream. Its paths are quoted like 8b (`diff --git "a/ev\nil.txt"`, measured), but its body is arbitrary file bytes and nothing downstream parses it into keyed records — Step 5 reads it to write a message | — |
| 9 | `guard` verdict | Script literals | One of three fixed strings; the resolved hooks path never reaches stdout | `P16` |
| 10 | `signature` | git | One character from `%G?`'s fixed alphabet — but `%G?` is not the whole answer git prints: `--no-show-signature` suppresses the multi-line verification banner `log.showSignature=true` otherwise splices ahead of it (measured: the first character becomes the banner's `G` from "Good", not the real verdict). The call site also carries the same `-c color.ui=false -c color.status=false -c color.diff=false` pin as row 8, for structural consistency with the other call sites, but round 19 mutation-testing found this does no live work here: `--no-show-signature` suppresses the banner regardless of any color config, so no ANSI escape ever reaches it for the color flags to strip. Correction: § 10.11 | `P14`, `P19c`, `P21` |
| 11 | `branch` | git ref name | git refuses a newline in a branch name outright (`is not a valid branch name`, measured) | `P10` |
| 12 | `style` | Commit subjects | `log --oneline` emits the subject only — a multi-line message's body is dropped, one commit is one line (measured). `log --oneline`'s hash is coloured via `color.diff.commit`, which the same `color.ui`/`color.status`/`color.diff` triple-pin covers | `P10`, `P19b`, `P19d` |
| 13 | `effective` — git's own ident-resolution answer | git (mix of env/config, git decides which) | `esc` — `\n` is already stripped by git's own ident parser, but `\t`/`\r` survive into the answer verbatim and must be escaped the same way every other channel is, including the `\xHH` half | `P8t`, `P8v` |
| 14 | `configured` | Script literal (`yes`/`no`), chosen by the probe's exit code | Never git's raw text — the probe's own stdout/stderr are suppressed (`>/dev/null 2>&1`) so nothing it prints can reach the record stream; that redirect is the whole guarantee, not escaping | `P8u` |

Rows 8b, 8c, 13 and 14 were missed by earlier passes of this enumeration — 8b/8c found by the
round-14 reviewer, 13/14 by round 16 (added alongside `effective`/`configured` themselves, § 10.8,
and initially left off this table exactly the way 8b/8c were) — an enumeration that stops updating
itself when the emitter grows is not a closed list. Row 8c is the one that had to be reasoned about
rather than measured into place: it carries user file content and no escaping would be appropriate,
because its consumer does not treat it as records. Stating *why* a channel needs no guarantee is
part of closing the list; leaving it out is what made the list look complete when it was not.

Row 8 is the one this enumeration was worth doing for. It had no oracle, it is safe for a reason
that lives in git rather than in this file, and the plausible edit that breaks it is one this
codebase would find *attractive*: adding `-z` to `status --short` "for consistency with the config
reader" emits raw NUL-separated paths and reopens the `P8d` forgery in a subcommand nobody thinks
of as parsing identity. Measured: that edit reddens `P10b` and five of the `P17` family.

Rows 3, 8, 8b, 10, 11 and 12 are safe **by construction**, and only row 3 is additionally guarded. That
asymmetry is the reason to write the table down rather than to add defensive escaping everywhere:
escaping a channel git has already made safe would be unfalsifiable code, and unfalsifiable code is
what row 3 is honest about being.

### 10.6 The fourth round of the same lesson, answered by asking git instead

Round 14 raised two findings that look unrelated and are not:

| Finding | The gap |
|---|---|
| P2-B | A `value` record cannot express an ident git will **refuse**. `user.name = "   "` reports `user.name<TAB>value<TAB>local<TAB>file:.git/config<TAB>` while `git commit` fatals `name consists only of disallowed characters` |
| P2-C | `EMAIL` sits in git's chain between `user.email` and the OS guess. With `user.email` unset it decides the commit's address, and **no** channel in § 10.5 reports it — it is not a git config, so no `--get-all` sees it |

Both are the same defect § 10.3 already fixed once for `commit.gpgsign`: the script was **modelling
git's semantics** in a decision table instead of asking the party that owns them. The boolean case
was answered with `--type=bool`; this one is answered with `git var GIT_AUTHOR_IDENT` /
`GIT_COMMITTER_IDENT`, emitted as two `effective` lines.

`git var` applies the whole chain (`GIT_<role>_*` when exported → `user.*` → `EMAIL` → an OS
guess), runs git's ident parser, and fails in exactly the cases `git commit` fails. Measured:

| Input | `git var GIT_AUTHOR_IDENT` |
|---|---|
| normal | rc 0 — `Dev <d@x.test> 1786015609 +0800` |
| `user.name = "   "` | rc 128 — `fatal: name consists only of disallowed characters` |
| `GIT_AUTHOR_NAME=''` | rc 128 — `fatal: empty ident name (for <d@x.test>) not allowed` |
| `GIT_AUTHOR_EMAIL=''` | rc 0 — `Dev <>`, the attribution loss made visible |
| `GIT_AUTHOR_NAME=' Alice <evil@x> '` | rc 0 — `Alice evil@x <d@x.test>`: the parser's transform, which the raw record cannot show |
| `user.email` unset, `EMAIL` exported | rc 0 — the `EMAIL` value |
| no identity config at all | rc 0 — the OS guess |
| unborn repo | rc 0 — works before the first commit |

The trailing `<unix-seconds> <tz>` is stripped (`${ident% * *}`, from the right, so a name with
spaces survives): the question is who, not when, and a record that changes every second cannot be
compared between two runs. Oracles: `P8o` (refusal + agreement with a real `git commit`), `P8p`
(the `EMAIL` fallback, with a negative control), `P8q` (determinism and the spaces case).

**The payoff is that Step 1c got smaller.** Its decision table stopped enumerating combinations of
config and env kinds and now reads the two `effective` lines; the records demoted to a "locating
the cause" table, which is what they were always good for. Rebuilding git's resolution order in
Markdown is what rounds 12, 13 and 14 each got wrong on a different input — the fix was to stop.

One case still needs the records, and it is the reason they are not merely diagnostic: git's OS
guess resolves *successfully*, so `effective` alone cannot distinguish a configured identity from
a guessed one. Round 14 answered this by reading env `unset` **and** config `unset`/`empty` for a
role directly off the records — round 15 replaced that heuristic with a third git-native channel;
§ 10.8.

### 10.7 A finding that did not reproduce, and what was kept anyway

Round 14 also raised, as a Nit, that `hook=$(git … --git-path hooks/commit-msg)` lacked the
`printf .` sentinel `REPO_ROOT` carries, with the stated consequence of a false `guard:missing`.

It does not reproduce, and the measurement says why: this command's answer always ends in
`commit-msg`, so its only trailing newline is git's own terminator — which is exactly what `$( )`
should strip. Probed with `core.hooksPath` defaulted, ending in a newline, containing one in the
middle, and as `~/hk`; all four end `commit-msg\n`.

The sentinel was added anyway and the comment says which of the two it is: a template invariant so
both `$( )` captures in the file follow one rule, not a fix for a reachable defect. `REPO_ROOT`'s
is the one that matters, because `--show-toplevel` **can** end in a newline.

What replaced it as the oracle is the case that *is* reachable: `P7b` puts the newline in the
middle of `core.hooksPath`, where any line-splitting read of git's answer tests a path that does
not exist. That mutation is killed; reverting the sentinel is not, and recording which is which is
the point of this subsection. Writing a passing test for an unreachable defect would have been the
worse outcome — it reads as coverage and pins nothing.

### 10.8 The fifth round of the same lesson: provenance, asked rather than reconstructed

Round 15 raised two findings that are the same defect at two different keys:

| Finding | The gap |
|---|---|
| P1 | § 10.6's provenance row reconstructs "configured vs. guessed" from the env/config records, and that reconstruction is ambiguous in both directions: a genuinely-configured identity can read as unconfigured (before P2-1, `author.name`/`author.email` alone were invisible to a loop that only read `user.name`/`user.email`, so the same "no record present" signature a bare OS guess produces), and a genuinely-unconfigured one can read as configured (`user.email` unset with `EMAIL` exported meets the same "env unset, config unset" test as a bare OS guess, even though `effective` resolves from `EMAIL`, not a guess) — and the fix for both happens to be the same `git config --local`, which is why the ambiguity had gone unnoticed rather than because it was harmless |
| P2-1 | The `identity` config-key loop read only `user.name`/`user.email`. `author.*`/`committer.*` outrank `user.*` for their own role (git ≥ 2.31) and a commit made under them was invisible to Step 1c's "locating the cause" table |

The fix is the same move § 10.6 made for the verdict itself, applied one layer deeper: `git -c
user.useConfigOnly=true var GIT_<ROLE>_IDENT` refuses exactly the fallback half of resolution
(`EMAIL`, the OS guess) and succeeds only for a value the operator set for *this* repository or
invocation. Asked once per role, printed as `configured\t<role>\tyes|no`, it is what Step 1c's
provenance row now keys on directly instead of re-deriving. P2-1's config-key loop grew from two
keys to six (`user.name`, `user.email`, `author.name`, `author.email`, `committer.name`,
`committer.email`); the read shape (`emit_config_records`) did not change. Oracles: `P8r` (`$EMAIL`
and the OS guess both read `no`; local config and an exported `GIT_<role>_*` both read `yes`),
`P8s`, `P8k5`.

**A measured git behaviour the fix surfaced rather than caused.** `configured` reporting `no` for a
role is not always paired with `effective` resolving successfully — the two can diverge in a
direction narrower than "guessed". A repository with only `author.name`/`author.email` set and
`committer.*`/`user.*` untouched does not fall through to the OS guess for the committer role the
way a repository with *no* identity config at all does; `git var GIT_COMMITTER_IDENT` refuses
outright (`fatal: empty ident name (for <>) not allowed`), symmetric for the reverse (only
`committer.*` set, author untouched). This is git 2.54.0's own behaviour, not something this script
introduces or can route around — and it needs no new row, because the existing `unresolvable` row
already halts on it. It is pinned as a fact rather than assumed: `P8s`'s armed control confirms a
repository with zero identity config guesses successfully for the committer role, then shows the
same repository, with only `author.*` added, turning that same role `unresolvable`.

Two findings the round also raised were addressed without a new mechanism: `esc "$ident"` inside
`emit_effective` had no oracle proving it was load-bearing for that specific channel — `P8t` pins
that a tab or CR git's ident parser leaves intact (unlike `\n`, which the parser strips from a name
outright) cannot turn one `effective` record into a fifth field. And the `${BASH_ENV+x}` guard at
the top of the script — the third of the three privileged-mode checks, the one neither `P18` (the
re-exec route) nor `P18b` (the `$-` flag route) reaches — had no oracle either; `P18e` reaches it
specifically, by combining real `-p` with a preset sentinel and a surviving `BASH_ENV`, the one
combination that skips both earlier checks.

### 10.9 Round 17: raw terminal channels, two unreachable rows, and one env var left off the list

Round 16's fixes closed the *structural* forgery channels (§§ 10.1–10.8: fields, kinds, keys,
provenance). Round 17 found a different family: config the operator's own repository can set that
changes what a *terminal* does with the script's output, plus two decision-table rows nothing in
either diagnostic path could ever produce.

| Finding | The gap |
|---|---|
| P1 | `color.ui`/`color.status`/`color.diff=always` forces ANSI escapes into `status`, `diff` and `log` output alike — `git status` has no `--no-color` flag at all, so a per-subcommand fix could not be uniform |
| P2 | `log.showSignature=true` splices a multi-line "Good signature…" (or GPG warning) banner ahead of `%G?`'s resolved character, breaking `signature`'s documented one-character contract |
| P2 | `core.pager` runs when the script is invoked from a real terminal — `log` and `diff` page by default there even with `-1 --format=...` or `--stat`; `status` measured not to |
| P2 | The `printf .` sentinel on `REPO_ROOT` (§ 7) had no oracle: deleting `&& printf .` left every test green |
| P2 | SKILL.md's identity table names a HALT row for "conflict + `CI=true`", but neither `git-profile.sh`'s `doctor` nor this script's inline fallback ever reported `CI` — the row could not fire |
| P2 | `esc()` escaped `\\ \n \t \r` only. A raw ESC byte (0x1b) in an identity/config value survives into a `value` record and can carry an ANSI/terminal escape sequence into whatever prints it later |
| P2 | `GIT_CONFIG_NOSYSTEM=1` repoints config resolution the same way `GIT_CONFIG_PARAMETERS` does (already stripped), yet was absent from both the script's `unset` block and the canonical prefix |

**Color.** `-c color.ui=false` was measured to override any of the three forcing configs
identically for `status`, `diff` and `log` — chosen over mixing conventions (`-c` for `status`,
`--no-color` for `diff`/`log`) specifically because `status` has no `--no-color` form to mix with.
Oracles: `P19` (parameterized over `collect`/`status`/`scope`), `P19b` (`style`/`diff`).

**Signature.** `--no-show-signature` suppresses only the extra printed banner lines; `%G?`'s own
resolution is unaffected; measured directly rather than assumed. `P11c`'s literal regex was
broadened (`/log -1 (?:--\S+ )*--format='%G\?'/`) to tolerate the new flag without losing what it
actually pins. The hermetic fixture needed to arm this oracle at all — a genuinely-signed commit,
since git only invokes its verifier (and only then prints the extra banner) when the commit object
carries a real signature — is `makeSignedRepo`: an ephemeral SSH signing key via `ssh-keygen`, with
`gpg.ssh.program` set **explicitly** (git's own default for that key is empty, which fails commit
creation outright rather than falling back to PATH). Oracle: `P19c`.

**Pager.** Measured with `script -q /dev/null` (pty emulation — a pipe never pages, so `spawnSync`
alone cannot distinguish the fixed from the broken form): `pager.status=false` is git's own
default, but `log` and `diff` page once connected to a real tty. `--no-pager` was added to exactly
the six call sites that need it, not defensively everywhere. The oracle, `P20`, is structural
rather than behavioural — the same shape `P1` uses for the env-strip block — because the pty
behaviour itself needs infrastructure this suite does not portably have.

**The sentinel.** `P7c` fixtures a repository path ending in a literal newline (permitted on this
filesystem; confirmed empirically). `--show-toplevel`'s answer for such a path is the path's own
trailing newline plus git's terminator — two in a row — and `$( )` strips every trailing newline it
finds, so the naive form (`REPO_ROOT=$(git rev-parse --show-toplevel)`) loses the real one along
with git's own. `printf .` gives command substitution a non-newline character to stop at, so both
survive for the script's two explicit strips (one `.`, then exactly one `\n`) to remove precisely.
Mutation-killed by deleting `&& printf .`.

**The CI record.** `emit_env_record CI`, added to the same loop that already reports
`GIT_AUTHOR_*`/`GIT_COMMITTER_*`, gives the inline-fallback path a record to read the HALT row
against — the row itself is a decision Step 1c applies while reading the script's output, not
logic the script encodes. `git-profile.sh`'s `doctor --json` path was left as-is: its
`MULTI_VALUE_NAME`/`MULTI_VALUE_EMAIL` issues stay `warn`, never escalate to `halt` on `CI`, which
is a separate design surface with its own JSON schema and consumers — extending it was out of this
finding's stated scope (the inline-fallback path). Oracle: `P8t2`.

**Escaping.** `esc()` now escapes every remaining C0 control byte plus DEL to a literal `\xHH`,
alongside the pre-existing `\\ \n \t \r`. 0x00 is not in the loop: bash strings cannot hold a NUL
byte, so it can never reach the function. Oracle `P8v` arms a raw ESC and DEL byte inside
`GIT_AUTHOR_NAME`, confirms git's ident parser leaves both intact (unlike `\n`), and asserts
neither reaches stdout unescaped.

**`GIT_CONFIG_NOSYSTEM`.** Added to the canonical prefix and both scripts' `unset` blocks — **33**
literal occurrences: `grep -o -- "-u GIT_CONFIG_NOSYSTEM" SKILL.md references/git-environment.md
references/execute-mode.md ../../docs/features/smart-commit-hardening/2-tech-spec.md | wc -l` (run
from `skills/smart-commit/`) gives 31 across `SKILL.md` (21), `git-environment.md` (3),
`execute-mode.md` (1) and `2-tech-spec.md` (6, historical `GIT_ENV="…"` form, still in scope for
byte-for-byte matching even though that file is exempt from the retired-form sweep), plus one bare
`GIT_CONFIG_NOSYSTEM` in each script's `unset` block (`grep -c GIT_CONFIG_NOSYSTEM
scripts/smart-commit-inspect.sh scripts/smart-commit-execute.sh`) = 33. Round 18 review, P2:
this paragraph previously said 27 with no derivation command published, which is what let the
figure go stale by 6 unnoticed. At round 17, `GIT_CONFIG_GLOBAL`
and `GIT_CONFIG_SYSTEM` were **not** added, on the reasoning that git's own documented way to say
"no global config" / "no system config" is to point the variable at `/dev/null`, not to leave it
unset — unsetting it falls back to the default path, which disables nothing — and that this
skill's own test suite depended on exactly that redirect (`hermetic()` set both to `/dev/null` for
fixture isolation), so stripping them would have defeated that isolation the next time the
script's own `unset` block ran ahead of a test's git calls. **That reasoning did not survive**:
round 19 added `GIT_CONFIG_GLOBAL` (§ 10.11) and round 20 added `GIT_CONFIG_SYSTEM` (§ 10.12) once
each was shown to be attacker-reachable directly, not just through its default fallback — and test
isolation moved from an env var the script's own strip would otherwise defeat to a `gitShim`-based
fixture one process layer downstream of the strip, which the strip cannot reach. `GIT_CONFIG_NOSYSTEM`
alone has no analogous legitimate persistent use and is a pure downgrade, so it stays stripped the
same way `GIT_CONFIG_PARAMETERS` already was. Full rationale: `git-environment.md` § 1. Oracle:
`P8w` — fixtures a `GIT_CONFIG_SYSTEM`-redirected file via `gitShim`'s `inject-sysconfig` mode (a
direct env var no longer reaches the script's own git calls once round 20 stripped it too — see
§ 10.12), confirms `GIT_CONFIG_NOSYSTEM=1` unstripped really does hide it (armed control, via a
direct env var since that call bypasses the script), then confirms the script's `unset` block
neutralizes it so the system-scoped record surfaces instead.

**Folded-in Nits.** Step 1c's escape enumeration now names the `effective` ident as a fifth escaped
channel (`P8t` already covered it; only the prose had not caught up). The `<key><TAB>unset` row in
"locating the cause" now names both measured outcomes for a role with no record at all — resolved
from `EMAIL`/the OS guess, **or** `unresolvable` when the *other* role's config alone disables the
guess (§ 10.8, `P8s`) — where it previously named only the first. `STEP_1C_ANCHOR` in the test file
was declared after its first use across four tests; moved above `P8k3`, its first consumer. One Nit
was deferred rather than fixed: `emit_effective`/`emit_configured`'s comments describe git's ident
probe as answering "128" uniformly, which collapses a distinction between exit codes worth
reproducing exactly rather than approximating in a comment; logged as sub-threshold per its own
stated mild consequence.

### 10.10 Round 18: the specific key beats the general one, and a fork loop nobody had measured

Round 17 closed `color.ui`, `--no-show-signature`, and `--no-pager` on `log`/`diff`. Round 18 found
that two of those three fixes were narrower than they looked, plus a performance defect in the
round-17 escaping fix itself and three small consistency gaps — this time from a fallback review
(Codex quota exhausted for the session; `strict-reviewer` substituted, findings advisory).

| Finding | The gap |
|---|---|
| P1 | `-c color.ui=false` does not override `color.status`/`color.diff` when either is set directly — git resolves the more specific key first, so a repository with `color.status=always` in its own config is untouched by a flag that only ever sets `color.ui` |
| P1 | `P19`/`P19b`'s fixtures only ever armed `color.ui`, never `color.status`/`color.diff` — the two keys the P1 above is about had no oracle at all |
| P2 | `esc()` rebuilt its 29-byte C0/DEL escape table on every call via `$(printf ...)` — two command substitutions per byte, 58 forks per call, measured 160x slower than building it once |
| P2 | `status` (in `collect`, `status`, `scope`) had no `--no-pager`; round 17 reasoned from `pager.status=false` being git's own *default*, not from what `pager.status` can be *set to* — the same reasoning gap `status.showUntrackedFiles`/`status.branch` (`P17`/`P17d`) had already been fixed for elsewhere in this file |
| Nit | `smart-commit-inspect.sh`'s prelude had no `set +x`/`set +v`, unlike its sibling `smart-commit-execute.sh` — an inherited xtrace from a launch command line (not just the ambient environment guard 1 already strips) reaches stderr with config/identity values in the expansion |
| Nit | The unknown-subcommand branch printed `$sub` (caller argv) raw — the one data channel in the file not passed through `esc()` |
| Nit | `smart-commit-execute.sh`'s `repo_root()` checks `[ -n "$root" ]` after stripping the `printf .` sentinel; `smart-commit-inspect.sh`'s `REPO_ROOT` derivation did not — `set -u` cannot catch this, since the variable is set, just empty |

**Color, continued.** Git's config precedence resolves the specific key
(`color.status`, `color.diff`) before it ever falls through to `color.ui` — so a `-c color.ui=false`
flag, which only ever *sets* `color.ui`, leaves a repository-set `color.status=always` or
`color.diff=always` completely unaffected. Reproduced directly against the shipped script before
the fix: `git config color.status always; git config color.diff always` then `inspect status`
printed a raw `\x1b[31m` escape into the record stream, and `inspect style` (whose `log --oneline`
hash colouring runs through `color.diff.commit`, part of the `color.diff` family) did too. Fix:
every `-c color.ui=false` call site now also carries `-c color.status=false -c color.diff=false`.
Test oracle: `P19`/`P19b` (round 17, `color.ui` only) were joined by `P19d`, which arms
`color.status`/`color.diff` specifically, on their own, with `color.ui` left untouched — proving
the round-18 fix closes what the round-17 fix's own oracle could not see.

**`esc()` performance.** The 29-entry C0/DEL table (§ 10.9 above) was correct but rebuilt from
scratch inside `esc()` on every call — `hex=$(printf ...)` then `ch=$(printf ...)`, each a forked
subshell, 58 forks per call. Measured: 30 calls of the pre-fix form took 1.459s against 0.009s for
the post-fix form (byte-identical output) — roughly 160x. The table is a script-wide constant, so
it is now built once, into two parallel arrays (`SD0X_CTRL_CH`, `SD0X_CTRL_ESC`), using `printf -v`
(a builtin that writes into the array slot without forking) instead of command substitution; `esc()`
itself becomes a plain indexed loop over the two arrays. Correctness has the same oracle as before
the refactor (`P8v`) — a mutation dropping DEL (127) from the top-level table build still reddens
`P8v`, confirming the refactor did not silently change what gets escaped, only how the table gets
built.

**Pager, continued.** `pager.status=false` is git's own *default* — but a default is not a pin, and
`pager.status=true` is a legal value nothing about this script's contract forbids an operator from
setting. Measured with `script -q /dev/null` (pty emulation, same method as § 10.9's original
finding): under `pager.status=true` and a `core.pager` that announces itself, `git status` invokes
the pager and `git --no-pager status` does not. `status` now carries `--no-pager` at all three call
sites, matching `status.showUntrackedFiles`/`status.branch` (`P17`/`P17d`), which this file already
pins rather than inherits for the identical reason. `P20`'s sweep widened from `(log|diff)` to
`(log|diff|status)` and its assertion floor from 6 to 9 call sites.

**Folded-in Nits.** `set +x`/`set +v` were added to `smart-commit-inspect.sh`'s prelude,
symmetric with `smart-commit-execute.sh`'s (which already had them for the same stated reason).
Oracle `P18f`: launching with `bash -p -x -- script SD0X_PRIV_REEXEC=1` (the same attack shape
`P18e` uses for guard 3 — real `-p`, sentinel preset to skip the re-exec) still traces the
prelude's own control flow before `set +x` executes, but the `git rev-parse --abbrev-ref HEAD` call
`branch` makes afterward must not appear on stderr; mutation-verified by deleting the two `set`
lines and confirming the git invocation is traced again. The unknown-subcommand message now
escapes `$sub` before printing it — oracle `P11d`, a subcommand argv carrying a raw ESC byte,
asserting the escaped `\x1b` form reaches stderr and not the raw byte. `REPO_ROOT` gained the same
`[ -n "$REPO_ROOT" ]` guard `smart-commit-execute.sh`'s `repo_root()` already has; unlike the other
two Nits this one has no oracle — neither this review nor the round-18 reviewer could construct an
input where `git rev-parse --show-toplevel` succeeds with empty output, so the guard is defensive
against an unreachable condition, the same status this file already gives the `case "$hook" in
''|…` branch in § 10.7.

### 10.11 Round 19: an OSC channel in `style`, an asymmetric config strip, and a false claim caught by mutation testing

Fallback review again (Codex quota exhausted; `strict-reviewer`/`tech-spec-reviewer` substituted,
findings advisory). Four fixes plus one correction to a claim round 17 had left standing since.

| Finding | The gap |
|---|---|
| P1 | `style`'s `git log --oneline` piped straight to stdout, unlike every other channel — a commit subject (attacker-controlled: anyone who authored a commit on this repo chose it) could carry an OSC 52 sequence (clipboard write on iTerm2/xterm/kitty/wezterm) or other raw escape straight to a caller that prints stdout to a terminal |
| P2 | `GIT_CONFIG_GLOBAL` was in the "still applies, and that's fine" bucket with `GIT_CONFIG_SYSTEM` (§ 7) — but its fallback path (`$HOME/.gitconfig`, then `$XDG_CONFIG_HOME/git/config`) is reachable through `HOME`/`XDG_CONFIG_HOME`, neither of which the script strips, so an attacker-controlled `GIT_CONFIG_GLOBAL` could redirect global config to an arbitrary file |
| P2 | `BASHOPTS` guard-4 coverage (§ 8.1) had no test arming `BASHOPTS` alone, only `SHELLOPTS` — and the two are not equivalent: `SHELLOPTS=privileged` forges a genuine `p` flag into `$-`, `BASHOPTS` cannot forge `$-` at all |
| P2 | `no_operands()` printed `$sub` (the matched case-pattern) unescaped on its error path — unreachable today since `$sub` is always a literal by the time this function runs, but the channel the `*)` unknown-subcommand arm below already closes was still open here |

**Style/OSC.** Fixed by routing the `git log --oneline` loop through the same `esc()` every other
channel uses, reading lines from a process substitution. That conversion loses `git log`'s own exit
status unless deliberately preserved — the `rc=` sentinel (same shape `emit_config_records` already
used) appends `printf 'rc=%s\n' "$?"` inside the substitution and the loop's `case` peels it back
off before `exit "${rc:-1}"`. Oracles: `P22` (OSC/ESC bytes escaped to literal `\x1b`/`\x07` text),
`P22b` (exit status preserved — 128 for an empty repo matching raw `git log`'s own 128, 0 otherwise).

**`GIT_CONFIG_GLOBAL`.** The two look symmetric — both use git's `/dev/null`-idiom for "no config,"
both were in the same table row through round 18 — but round 19 reasoned that only one has an
env-reachable *fallback*. `GIT_CONFIG_GLOBAL`'s fallback is `HOME`/`XDG_CONFIG_HOME`, neither
stripped by this script, so it is both a real risk and independently testable (redirect
`HOME`/`XDG_CONFIG_HOME` to an empty fixture directory and confirm an attacker-set
`GIT_CONFIG_GLOBAL` no longer wins). Added to both scripts' `unset` blocks and the canonical prefix.
Oracle: `P8x` — fixtures an attacker-chosen `GIT_CONFIG_GLOBAL` pointing at a file with a forged
`user.name`, confirms raw git honours it (armed control), then confirms `inspect identity` does not
surface the forged name once the script's `unset` block has run.

Round 19 left `GIT_CONFIG_SYSTEM` unstripped on the strength of that same fallback argument: its
default path is compiled into the git binary, with no env-var override once `GIT_CONFIG_SYSTEM`/
`GIT_CONFIG_NOSYSTEM` are both stripped, and this repository's own development machine has a real
system gitconfig at `/opt/homebrew/etc/gitconfig` (`credential.helper=osxkeychain`) that stripping
would have made unreachable for test isolation. § 10.12 below is why that reasoning was wrong — not
because the fallback claim was false, but because the fallback was never the attack.

**`BASHOPTS`.** Measured rather than assumed which shell variable actually needs the test: on bash
3.2 (macOS system `/bin/bash`) `BASHOPTS` does not exist internally in a clean shell at all — an
attacker-exported `BASHOPTS=anything` is just an ordinary variable, no special meaning. On bash 5.3
(Homebrew) `BASHOPTS` is always present internally alongside `SHELLOPTS`. Guard 4's existing regex
already covers either being exported; what was missing was an oracle exercising `BASHOPTS` on its
own, since `SHELLOPTS=privileged` alone can already forge a real `p` flag into `$-` and no prior test
isolated the case where only `BASHOPTS` is set. Oracle: `P18h`, alongside `P18g`'s existing
`SHELLOPTS` negative control (both still pass independently — mutation-verified by narrowing guard
4's regex to `SHELLOPTS`-only, which reddens `P18h` while `P18g` stays green).

**`no_operands()`.** `$sub` is now routed through `esc()` before printing, matching every other
channel. No oracle: unreachable by the same reasoning `§ 10.7`'s `case "$hook" in ''|…` branch and
`§ 10.10`'s `REPO_ROOT` guard both already carry that status for — a future subcommand added without
updating this function is the only way to reach it, and the fix closes that channel before it can be
reopened.

**The `signature` correction.** Round 19's fix-verification pass for `style` prompted a fresh
mutation-testing sweep of every existing color-flag oracle, and it turned up a stale claim: § 10.9's
"Signature" paragraph and the channel table's row 10 (§ 10.5) both said the `-c color.ui=false -c
color.status=false -c color.diff=false` pin "covers a forced-ANSI variant" of the signature-banner
hazard. Removing those three flags from the `signature` call site and re-running its test left it
green — `--no-show-signature` suppresses the banner regardless of any color config, so no ANSI escape
ever reaches that call site for the color flags to strip. The color flags stay on the call site for
structural consistency with the other eight (harmless, and load-bearing again if `--no-show-signature`
is ever accidentally dropped), but no test claims they do live work there anymore. The pre-existing
test that made the claim (also mislabeled `P19d`, colliding with the unrelated `P19d` family covering
`status`/`scope`/`style`) is replaced by `P21`, which pins the actual mechanism structurally.
`P19c` was left as the behavioural oracle — its own control section already removes
`--no-show-signature` and shows raw git splicing a coloured banner in, which is the honest way to
prove the banner-suppression claim without smuggling in a color-flag claim beside it.

**Deferred (sub-threshold, logged rather than fixed).** Four Nits did not meet this round's blocking
threshold and were logged via `[NIT_DEFERRED]` rather than fixed on the spot: `esc()` still leaves
0x80–0x9f unescaped (the C0 set from round 17/18 covers 0x00–0x1f and DEL; the C1 set does not);
`diff`/`collect`'s raw file-content passthrough is unescaped by design and the boundary is
undocumented; `guard` reads an empty `--git-path hooks/commit-msg` answer as `guard:missing` rather
than aborting the way the `REPO_ROOT` check does; and `P20`/`P12b`'s call-site sweeps are line-based,
which would silently skip a backslash-continued git invocation (currently moot — every call site in
both scripts is single-line).

### 10.12 Round 20: the one config-repoint variable the strip list left standing

Fallback review again (Codex quota exhausted; `strict-reviewer` substituted, findings advisory —
but the underlying defect independently confirmed with an armed control and a mutation-tested
regression oracle, `P8y`, not taken on the reviewer's word).

| Finding | The gap |
|---|---|
| P0 | `GIT_CONFIG_SYSTEM`, the one config-repointing variable round 19 left unstripped, gives an env-only attacker arbitrary command execution (`core.fsmonitor`, reproduced under `collect`/`status`) and — sharper — lets them forge the AI-attribution guard's verdict (`core.hooksPath`, reproduced against `guard`), inverting an Anchor-level security control |
| Nit | `no_operands()`'s error path (a distinct call site from the one round 19 fixed) still printed `$sub` unescaped |
| Nit | `--help extra` printed the general usage message to stderr, then failed the operand check — the usage `printf` ran before `no_operands "$@"`, contradicting the comment beside it |
| Nit | An empty `--git-path hooks/…` answer falls through to `guard:missing` instead of the fail-closed abort the `REPO_ROOT` guard already uses for the equivalent case — flagged again (§ 10.10 folded-in Nits already named this one; still not fixed, still Nit, still logged rather than actioned) |

**`GIT_CONFIG_SYSTEM`.** § 10.11 above has the corrected rationale: round 19's "no env-reachable
fallback" argument was true but answered the wrong question, since the actual attack sets the
variable directly rather than routing through its default fallback. Fixed identically to
`GIT_CONFIG_GLOBAL` — added to both scripts' `unset` blocks and the canonical prefix
(`git-environment.md` § 1). Test isolation could no longer rely on `hermetic()`'s env var reaching
the script's own git calls once the script strips it, so the oracle needed a different mechanism
than `P8x` used: `gitShim` (`test/scripts/smart-commit-inspect.test.js`, pre-existing infrastructure
for simulating config-read failures under `P8f`/`P8g`) gained an `inject-sysconfig` mode — a `git`
wrapper on `PATH` that sets `GIT_CONFIG_SYSTEM` in its *own* environment before delegating to the
real git, one process layer downstream of the script's `unset`, which cannot reach into a child
process's environment. `P8w` (the pre-existing `GIT_CONFIG_NOSYSTEM` oracle, which also fixtured a
system config via the now-stripped env var) was ported to the same shim. Oracle: `P8y` — fixtures
an attacker `core.hooksPath` pointing at a directory with a forged `commit-msg` hook, confirms raw
git resolves to it (armed control: `rev-parse --git-path hooks/commit-msg` returns the attacker's
path), then confirms `inspect guard` answers `guard:missing` — not the forged `guard:installed` —
once the script's `unset` block has run. Mutation-verified: reverting the strip reddens `P8y` with
exactly the forged verdict (`guard:installed`) the finding describes, confirmed via `diff`-verified
mutation and restoration rather than a `grep`-based check (the class of false-positive mutation
result § 10.9's `P22b` verification already had to work around once).

**The three Nits.** `no_operands()`'s error-path `esc "$sub"` call now covers the site round 19's
otherwise-identical fix (§ 10.11) missed — the two call sites are structurally separate, not one
function shared by both. `--help extra`'s usage `printf` was moved below `no_operands "$@"`, so the
operand check runs first and the general-usage answer is never printed for a question that included
an operand it did not ask for. The `guard` empty-path Nit is logged again rather than fixed: no
review round (17 through 20) has yet constructed a real trigger for `--git-path hooks/…` succeeding
with empty stdout, so it remains defensive-against-unreachable, the same status § 10.7's
`case "$hook" in ''|…` branch already carries.

### 10.13 Round 21: the same P0, one level down, through a variable that cannot be stripped

Fallback review again (Codex quota exhausted; `strict-reviewer` substituted, findings advisory —
the underlying defect independently reproduced with an armed control and mutation-tested
regression oracles, `P8z`/`P8z2` and an execute-side case, not taken on the reviewer's word).

| Finding | The gap |
|---|---|
| P1 | Round 20's `GIT_CONFIG_SYSTEM` strip closed one attacker-reachable route to `core.hooksPath`/`core.fsmonitor` but not the underlying vulnerability: `$HOME/.gitconfig` is read at *global* scope exactly the way a `GIT_CONFIG_GLOBAL`-redirected file is, so an attacker who sets `HOME` reaches both settings without touching a `GIT_CONFIG_*` variable at all — reproducing the identical guard-forgery and `core.fsmonitor` RCE round 20 found, one level down |
| P2 | `smart-commit-inspect.test.js`'s header docstring still described the overturned round-19 `GIT_CONFIG_SYSTEM` rationale and an obsolete "three channels" count |
| P2 | `hermetic()`'s `GIT_CONFIG_SYSTEM: '/dev/null'` no longer isolates the script's own git calls from the real machine's system config (round 20 stripped the variable, the same way it made `GIT_CONFIG_GLOBAL: '/dev/null'` inert for `P8x`) — proven to flip `P8r`'s "bare OS guess" sub-case on a machine whose system gitconfig sets `user.*` |

**Why `HOME` cannot be handled the way `GIT_CONFIG_SYSTEM` was.** Every variable stripped through
round 20 shares one property: nothing legitimate this skill does needs to read it. `HOME` breaks
that pattern — Step 1c's `identity` diagnostic reads `$HOME/.gitconfig` as genuine, load-bearing
input, since reporting the operator's real global identity is the feature. Stripping `HOME` would
not close a hole, it would delete the diagnostic. So the fix is not one more name added to the
`unset` block (count it with `smart-commit-inspect.sh`'s own `unset` statement rather than here —
later rounds keep growing it, and a number written in prose is the same staleness this file has
already logged more than once elsewhere); it is scoped to the two operations `HOME` can actually
turn into a security defect, closed at the point of use:

- **`guard`** (`smart-commit-inspect.sh`) now asks git the scope of `core.hooksPath`
  (`git config --show-scope --get core.hooksPath`) before trusting it, and trusts only
  `local`/`worktree` — the repository's own committed choice — falling back to the built-in
  `<git-common-dir>/hooks` location for every other scope, exactly as if hooksPath were unset.
  Verified empirically before the fix was written: `git -c core.hooksPath= rev-parse --git-path
  hooks/commit-msg` does **not** fall back to the default (it resolves to `/commit-msg`, wrong),
  so the scope-check-then-fallback shape was chosen over trying to force git to ignore the setting
  via a command-line override.
- **`core.fsmonitor`** is pinned `false` on the command line everywhere a status-touching git call
  is made: all seven `status`/`diff` call sites in `smart-commit-inspect.sh` (alongside the
  existing `--no-pager -c color.ui=false -c color.status=false -c color.diff=false` prefix) and
  both `git commit` call sites in `smart-commit-execute.sh`. Empirically confirmed before and after:
  a local `core.fsmonitor = touch marker; true` fires on plain `git status` **and** on plain
  `git commit` (no `-a` needed), and `-c core.fsmonitor=false` suppresses it in both cases — a
  command-line `-c` always outranks a lower-scoped value, closing the channel regardless of which
  scope carried it.

Both are the same "pin the security-relevant setting at the call site" shape the color flags and
`diff --no-ext-diff` already use for `diff.external` — applied here to the two settings `HOME` can
reach that actually matter, while leaving `identity`, style learning and signing diagnostics free
to read `HOME`-sourced config, which is the feature working as designed.

**Oracles.** `P8z` (`smart-commit-inspect.test.js`) fixtures `$HOME/.gitconfig` with a
`core.hooksPath` pointing at a directory holding a forged `commit-msg` hook; an armed control
(raw `git rev-parse --git-path hooks/commit-msg`, with `hermetic()`'s own `GIT_CONFIG_GLOBAL`/
`GIT_CONFIG_SYSTEM='/dev/null'` defaults deleted so they cannot mask `$HOME/.gitconfig` from being
read at all) confirms the redirect is real before asserting `inspect guard` answers `guard:missing`.
`P8z2` does the same for `core.fsmonitor`, asserting no marker file is created. A third case in
`smart-commit-execute.test.js` drives `commit` end-to-end with a `HOME`-fixtured `core.fsmonitor`
and asserts the marker never appears. All three mutation-verified: reverting the guard scope-check
or any `-c core.fsmonitor=false` pin reddens its oracle for exactly the expected reason (`guard:
installed` instead of `guard:missing`; the marker file existing instead of not), confirmed via
`diff`-verified mutation and restoration.

**The two P2s.** The test-file header docstring (`smart-commit-inspect.test.js`) was rewritten to
match the actually-current state: `GIT_CONFIG_SYSTEM` is stripped (round 20), `HOME`/
`XDG_CONFIG_HOME` are what isolate the suite's fixtures now, and the two security-critical
operations `HOME` reaches are closed by the scope-check/pin above rather than by isolation.
`P8r`'s "bare OS guess" sub-case was routed through `gitShim`'s existing `inject-sysconfig` mode
(pointed at `/dev/null`, the same value the now-inert env var used to carry) rather than restructuring
`hermetic()` for every one of this file's ~90 tests — the narrower fix the round-21 reviewer offered
as an alternative to a suite-wide `hermetic()` rewrite, chosen because the exposure was concrete and
localized to this one sub-case rather than general.

Two Nits, logged rather than fixed on the spot: `PINNED_CODE_BEARING` in
`smart-commit-execute.test.js` needed the same `-c core.fsmonitor=false` argv addition on both
`git commit` pins — a required, not deferred, update (the pin exists precisely to force this); and
`P8y`'s comment claiming the `core.fsmonitor` half was "reproduced independently" was corrected to
point at `P8z2`, which is where that assertion actually lives now.

### 10.14 Round 22: the scope check's failure mode, a false-positive regression, and one more channel

Fallback review again (Codex quota exhausted; `strict-reviewer` for code, `tech-spec-reviewer` for
docs, findings advisory). Three findings from the reviewer and one found independently by empirical
testing against this project's own scripts, all in the same "the direct attack bypasses reasoning
that assumed only the fallback path was reachable" family round 19–21 already logged twice.

| Finding | The gap |
|---|---|
| P0 | `guard`'s `git config --show-scope --get core.hooksPath 2>/dev/null` discarded `$?`. Any failure — not just the genuinely-unset case (`config --get`'s documented exit 1) — left `$scope_line` empty, and the round-21 code read empty exactly like unset, trusting it. `git < 2.26` rejecting `--show-scope` outright (`P8f`, § 10, exit 129) is the concrete case: on such a git the round-21 fix silently did not apply |
| P1a | The untrusted-scope branch fell back to checking a computed `<git-common-dir>/hooks/commit-msg` and reported on THAT file — but when a non-local `core.hooksPath` is actually configured, git never runs `.git/hooks/` at all, so an executable file sitting there is not what git would invoke. A legitimate non-local `core.hooksPath` (set on purpose, not by an attacker) now read back as `guard:installed` from a file git would never run — a regression from the pre-round-21 `--git-path`-only answer |
| P1b | `run_commit()`'s round-21 fix pinned only `core.fsmonitor`; a non-local `core.hooksPath` reachable through `HOME` still named the pre-commit/prepare-commit-msg/post-commit hooks `git commit` actually runs — the "regardless of which scope carried it" claim in § 10.13 only ever covered the fsmonitor knob |
| P2 | Found independently, not by either reviewer: `core.attributesFile` + a `filter.<name>.clean` command reaches a plain `git commit` (no `-a`, content already staged) exactly as it reaches `status`/`diff` — `smart-commit-execute.sh`'s commit path had no `attributesFile` pin at all |

**The fixes, one per finding.** P0: `guard` now captures `scope_rc=$?` from the `--show-scope` call
and trusts unset only when `scope_rc -eq 1`; any other exit — the flag being rejected outright, or
any future failure mode — is untrusted. P1a: the untrusted branch no longer computes or checks a
fallback path at all; it answers `guard:missing` directly, which is also simpler than the code it
replaced (no `git-common-dir` computation, no file-existence check). P1b: a new
`resolve_hooks_override()` in `smart-commit-execute.sh` mirrors `guard`'s trust logic — trusted
scope leaves `HOOKS_OVERRIDE` empty and git resolves `core.hooksPath` unmodified (so a real local
`core.hooksPath`, e.g. husky, still runs); untrusted scope populates `HOOKS_OVERRIDE=(-c
core.hooksPath=<repo's own hooks dir>)`, spliced into both `git commit` invocations. P2: `-c
core.attributesFile=/dev/null` was added to `run_commit()`'s `git commit` calls, alongside the
existing `core.fsmonitor=false` pin — confirmed via `git check-attr` that `/dev/null` does not
disturb the repository's own tracked `.gitattributes`.

**Oracles.** `P8z3` (`smart-commit-inspect.test.js`) reuses `P8f`'s `gitShim` 'fail' mode (exit 128,
standing in for git < 2.26's exit 129) combined with `P8z`'s attacker-`HOME` hooksPath fixture: an
armed control confirms the shim fails with neither exit 0 nor exit 1, then asserts `guard` still
answers `guard:missing` — proving the P0 fix, not just the already-untrusted case exit 1 covered
before it. `P8z4` repeats `P8z2`'s shape for `core.attributesFile` against `status`. `P8z5` is a
source-text oracle over all seven `status`/`diff` call sites, asserting each carries both pins
together — the live-attack tests prove the pins stop something; this proves none of the other six
call sites silently lost one. The execute-side suite (`smart-commit-execute.test.js`) gained three
analogous cases: `core.fsmonitor`/`core.attributesFile` pins on `commit` (each with a raw-`git`
armed control proving the attack fixture is live), a `core.hooksPath` override case (armed control:
raw commit under the attacker `HOME` fires the forged `pre-commit` hook; the scripted commit
suppresses it while still landing the real commit), and a regression control proving a *local*
`core.hooksPath` (the husky case) is still honoured — the override must be scoped to untrusted
config only, not applied unconditionally.

**Static-oracle fallout, not a defect but a recurring cost.** Adding `resolve_hooks_override()`
touched three of `smart-commit-execute.test.js`'s own lexical scanners. `PINNED_DELIMITERS` and
`PINNED_CODE_BEARING` needed the new function's definition line and `sd_run` call sites added, in
file order; the dispatch-site oracle (`dynamicDispatchSites`) needed no list update but was the one
that actually caught the bug below. The harder one: `HOOKS_OVERRIDE=(-c "$hooks_cfg")` as a single array-literal statement
put two whitespace-separated words inside one array-literal segment, and the assignment-prefix peel
that correctly skips a single-word array literal (`OWNED+=("$1")`, already in the file) consumed
only the first word — leaving the second, `"$hooks_cfg"`, read as if it were a command in its own
right, tripping the dispatch-site oracle that exists to catch exactly `"$c" push --all`-shaped
dynamic dispatch. The fix was not to pin the false positive but to remove it: building the array in
two single-word statements (`HOOKS_OVERRIDE=(-c)` then `HOOKS_OVERRIDE+=("$hooks_cfg")`) keeps every
assignment free of internal whitespace, matching the shape the peel already handles correctly.

### 10.15 Round 23: the signer and the driver are separate lookups from the ones already pinned

Fallback review again (Codex quota exhausted; `strict-reviewer` for code, findings advisory). Every
finding is the same shape as round 22's P2: a channel HOME can reach that the existing pins do not
cover, because it is a genuinely different config lookup from `core.fsmonitor`/`core.attributesFile`/
`core.hooksPath`, not a variant of one of them.

| Finding | The gap |
|---|---|
| P0 | `commit.gpgsign=true` is ordinary, repository-local, trusted configuration — but WHICH BINARY signs is `gpg.program` (plus `gpg.openpgp.program`, `gpg.x509.program`, `gpg.ssh.program`, `gpg.ssh.defaultKeyCommand`), a separate lookup reachable through the identical HOME channel the other three pins already distrust, and left entirely open. Reproduced live against a plain signing commit |
| P0 | `core.attributesFile=/dev/null` (round 22, P2) only blocks an ATTACKER-NAMED `.gitattributes`. A `.gitattributes` the repository itself tracks and commits (the git-lfs shape: `* filter=lfs`) is legitimate, trusted input — but the COMMAND that filter name resolves to (`filter.<name>.clean`, `diff.<name>.textconv`, `merge.<name>.driver`) is an ordinary config lookup, reachable through the same channel, and nothing stopped it living in a non-local scope. Reproduced live against `filter.<name>.clean` on a plain commit with content already staged |
| P1 | `resolve_hooks_override()` (round 22) substitutes the repository's own hooks directory for an untrusted `core.hooksPath` with no announcement — a developer debugging "why didn't my hook run" has nothing to go on |
| P2 batch | `HOOKS_OVERRIDE`/`GPG_OVERRIDE` referenced under `set -u`-adjacent code without the safe-empty-array guard in one call site; `resolve_hooks_override`'s `common` could be empty and pass the `case` unmatched; `cmd_commit` mapped every `run_commit` failure to exit 5, losing the distinction `run_commit` itself already returns; the comment header exceeded the 25-line warning threshold (`@rules/docs-writing.md` § Code Comments); the two `diff --stat` calls in `smart-commit-inspect.sh` lacked `--no-ext-diff`, unlike every other diff call in the file; `P8z5` (`smart-commit-inspect.test.js`) located its seven call sites with a whole-line regex rather than word position, the class of locator round 22's own review comment (§ 10.14) already named as fragile |

**The fixes, one per finding.** The two P0s take different shapes, stated in each function's own
header comment: `resolve_gpg_override()` mirrors `resolve_hooks_override`'s scope check across all
five `gpg.*` keys and, for an untrusted scope, **overrides to the ordinary default program name**
(`gpg`, `gpgsm`, `ssh-keygen`, or empty for `gpg.ssh.defaultKeyCommand`) — there is a universal safe
substitute here, the same shape as the hooksPath override. `refuse_on_untrusted_content_drivers()`
(new in both `smart-commit-execute.sh` and `smart-commit-inspect.sh`) instead **refuses the
operation**: reads the repository's own staged/tracked `.gitattributes` via `git check-attr --all`,
collects every `filter`/`diff`/`merge` name it assigns, and for each of the config keys that name
resolves to, applies the same trust check — on the first untrusted one, it refuses rather than
proceeding. Unlike `gpg.program` there is no safe default substitute for an arbitrary filter/textconv/
merge command (git-lfs's clean filter IS the intended behaviour), so silently disabling one would
risk committing content the driver exists to transform — a data-integrity defect stacked on the
security one, which is why this channel refuses instead of overriding. The execute-side read (`git
diff --cached --name-only -z | git check-attr --all -z --stdin`) goes through a `mktemp` scratch
file rather than `$( )`: bash command substitution silently deletes embedded NUL bytes rather than
stopping at the first one, which would merge every path/attribute/value into one unparseable run — a
failure mode with no analogue in the file's other, newline-safe reads. `smart-commit-inspect.sh`
stays newline-based (matching the rest of that file's existing fidelity level) since it has no
adversarial NUL-byte input to defend against on its read-only paths. P1: `run_commit()` now warns on
stderr — `core.hooksPath is configured outside this repository/worktree - ignoring it.` followed by
the resolved replacement path — whenever `HOOKS_OVERRIDE` is non-empty. The P2 batch: the two arrays
are spliced with the `${ARR[@]+"${ARR[@]}"}` safe-empty-array idiom everywhere they are read; `common`
empty now hits an explicit refusal before the `case`; `cmd_commit` captures `run_commit`'s actual
`$?` and maps `0→0, 6→6, *→5` instead of collapsing everything to 5; the header comment was condensed
to a two-line pointer at `execute-mode.md`; both `smart-commit-inspect.sh` diff calls gained
`--no-ext-diff`; `P8z5` was rewritten around a small quote-aware `shellWords` splitter, matching a
call site by **word position** (`-C` immediately followed by the word `"$REPO_ROOT"` immediately
followed by `status`/`diff`) rather than a substring match against the raw line.

**Oracles.** Both P0 fixes gained an armed-control regression test in `smart-commit-execute.test.js`,
in the same shape as round 22's: a raw, unscripted git operation under the attacker `HOME` proves the
fixture is live (marker file created) before the scripted path is trusted to suppress it. The
gpg.program test does not assert the scripted commit's exit status — the override substitutes a real
binary NAME, and whether that binary can then actually produce a signature depends on a signing key
being present in the test environment, out of this test's scope (unlike the fsmonitor/attributesFile/
hooksPath overrides, whose replacement values — `false`, `/dev/null`, an empty hooks directory — are
environment-independent). The content-driver refusal test is instead asserted on exit status 7 (the
new dedicated code — see below) and on the commit landing no new object. `smart-commit-inspect.test.js`
gained the analogous `P8z6` against `status`, and `P8z5`'s existing seven-site count assertion still
passes unchanged after the structural rewrite (the count did not move; only how a site is located
did). The hooksPath override test (round 22) gained two more assertions for the P1 warning text,
including a check that the announced replacement path is the repository's own, never the attacker's.

**A new exit status, and the same "not a defect" scanner tax as round 22.** `cmd_commit`'s
`refuse_on_untrusted_content_drivers` refusal returns exit 7, distinct from `run_commit`'s failures
(5) and the pre-flight ancestry-overlay refusal it sits next to (also 7 — both are "unverified, stop
here before touching git's object store" refusals, sharing a status deliberately). Writing the new
functions' own test coverage surfaced two more constructs the static oracles in
`smart-commit-execute.test.js` cannot analyse, on top of the array-literal lesson round 22 already
paid for:

- A three-way `case "$ptype" in filter|diff|merge) ;; *) continue ;; esac` reads clean but defeats
  the word walk `commandTokens` performs: the FIRST alternative fuses onto the preceding `case … in`
  segment and the LAST is recognised via its attached `)`, but a MIDDLE alternative (`diff`, here) has
  neither marker, so the scanner reports it as a bare, unpinned command name. The same shape at
  `case "$pvalue" in ''|unset|unspecified) continue ;; esac` happened to pass only because `unset`
  was already permitted for an unrelated reason (a real `unset` builtin call elsewhere in the file) —
  coincidental, not evidence the construct is safe. Both were rewritten to one pattern per arm
  (`filter) ;; diff) ;; merge) ;; *) continue ;; esac`), the shape the file's existing two-way
  `local|worktree)` case already proved the scanner resolves correctly.
- `keys+=("filter.$pvalue.clean" "filter.$pvalue.smudge" "filter.$pvalue.process")` — three
  space-separated quoted words after a single `+=(` — repeats round 22's `HOOKS_OVERRIDE=(-c
  "$hooks_cfg")` lesson exactly: the assignment-prefix peel consumes only the FIRST word, so the
  second is read as a command in its own right. Split into three single-element `+=()` statements,
  matching `resolve_gpg_override`'s own `GPG_OVERRIDE+=(-c)` / `GPG_OVERRIDE+=("$name=$default")`
  shape, which was already whitespace-free per element and never tripped this.
- A separate, `smart-commit-inspect.sh`-side instance of round 22's own "the `-C` pin must be on the
  SAME line `git` is called on" lesson (`P12b`): the check-attr half of
  `refuse_on_untrusted_content_drivers`'s pipe was originally written with `-C "$REPO_ROOT"` wrapped
  onto a third continuation line, which `P12b`'s per-line scan reads as a `git` call with no `-C` on
  its own line. Fixed by keeping `-C "$REPO_ROOT"` on the same line as the `git` word, moving the
  wrap point after it instead.

None of the three is a defect in the shipped behaviour — each was caught by the project's own
regression suite before merge, which is what the suite is for. They are logged here because the
underlying lesson (round 22 § 10.14: "the fix is not to pin the false positive but to remove it") is
now a THIRD independent instance, not a second, and is worth a reader's attention the next time a new
function adds a `case` alternation or a multi-element array literal to either script.

### 10.16 Round 24: a text-parse bypass in the driver check, and a signature channel round 23 missed

Fallback review again (Codex quota exhausted; `strict-reviewer` for code, `tech-spec-reviewer` for
docs, both advisory). Two independent findings converged on the same function round 23 introduced
(`refuse_on_untrusted_content_drivers`), plus a new instance of round 23's own `gpg.program` finding
that its fix had not actually closed.

| Finding | The gap |
|---|---|
| P0 (`tech-spec-reviewer`) | Round 23's `resolve_gpg_override`/`--no-show-signature` treatment covered `run_commit` but not `smart-commit-execute.sh`'s own read-back (`marked_oids`'s `git reflog`, `verify_one`'s `git log -1`) or `smart-commit-inspect.sh`'s `signature` subcommand. `log.showSignature=true`, reachable through HOME, makes plain `git log`/`git reflog` invoke `gpg.program` even on a format requesting no signature text — reproduced against `verify-last` and `reflog` with a HOME-configured `gpg.program` that touched a marker file on every read. `--no-show-signature` suppresses this for those formats, but not for `%G?` (`signature`'s own format), which invokes real verification regardless — that call site needed the full scope-checked substitution, not the flag |
| P0 (`strict-reviewer`) | `refuse_on_untrusted_content_drivers`'s attribute parse in `smart-commit-inspect.sh` matched the driver name via a **last-occurrence substring test** rather than a genuine NUL-delimited field split, so a crafted pathname containing the driver-name text (e.g. embedding `filter: lfs` inside the path field itself) could shift which triple's `pvalue` field the parser read, defeating the check without touching `.gitattributes` at all |
| P1 | Both scripts' driver-check pipe into `check-attr … --stdin` (execute-side `diff --cached --name-only -z`, inspect-side `ls-files -z --cached --others --exclude-standard`) was guarded by `if ! pipeline; then …`, which under bash's default (non-`pipefail`) semantics reflects only the LAST stage's exit status — a failing first stage (`diff`/`ls-files` erroring) still let the pipeline "succeed" with truncated or empty output, read as "no drivers found" |
| P1 | `smart-commit-execute.sh`'s copy of the function checked `filter`/`diff`/`merge` drivers, but `git commit` never invokes `diff.<n>.textconv` or `merge.<n>.driver` — those run for `git diff` and for resolving a merge conflict, neither of which `commit` performs. Checking them there was a pure false-positive source: a global textconv-only config with no filter attribute in play blocked a commit that never touched it (measured) |
| P1 | `resolve_gpg_override` (round 23) substitutes silently, the same class of gap round 23 itself found and fixed for `resolve_hooks_override` — a developer whose own `$HOME` sets `gpg.program` sees git try a different signer with no indication why |
| P2 batch | `2-tech-spec.md` D1's `## Commit Plan` line reference had drifted by 4 lines from an earlier edit; D2 carried a "see version history" pointer with no version-history section to land in; `smart-commit-inspect.test.js`'s `P8z5` oracle (seven status/diff call sites) has no counterpart pinning the new ls-files/check-attr call sites `refuse_on_untrusted_content_drivers` added — those remain visible only to the armed-control live-attack tests, not to a structural oracle; two `rm -f` calls in the inspect-side rewrite lacked the `--` operand-end marker every other removal in the file uses |

**The fixes.** `--no-show-signature` was added to `marked_oids`'s `git_verify reflog`, `verify_one`'s
`git_verify log -1`, and (defense-in-depth, measured harmless either way since it has no `%`-format)
`verify_created`'s `git_verify rev-list`. `smart-commit-inspect.sh`'s `signature` case now calls
`resolve_gpg_override` (a new function in that file, ported from `smart-commit-execute.sh`'s
existing one) before its `git log -1 --no-show-signature --format='%G?'`, splicing `GPG_OVERRIDE`
into the invocation exactly as `run_commit` already does. The inspect-side content-driver parser was
rewritten around NUL-delimited `read -r -d ''` triples (matching git's own `check-attr -z` output
shape) instead of a line-oriented substring match, closing the pathname bypass structurally rather
than by patching the one crafted input found. Both scripts' driver-check pipeline now runs
unconditionally and checks `"${PIPESTATUS[@]}"` for both stages before trusting the output, rather
than gating on the pipeline's own combined exit status. `smart-commit-execute.sh`'s copy of the
function was narrowed to `filter` only — the one family `git commit`/`git commit -a` can actually
reach — leaving `smart-commit-inspect.sh`'s copy at all three (`filter`/`diff`/`merge`), since its
`diff`/`status`/`collect` subcommands genuinely can trigger textconv/merge drivers. This narrowing
does not fully remove the git-lfs-global-install friction the P1 finding named: `filter.lfs.*`
genuinely is what a prior `git add`/`commit -a` on the content could have reached, and stays
correctly refused when configured non-locally. Building a config surface to allowlist a specific
non-local filter command would be a new feature, not a bug fix, so the residual friction is recorded
here as an accepted trade-off rather than solved under this round. `run_commit` now warns on stderr
per overridden `gpg.*` key, the same shape `resolve_hooks_override`'s existing warning uses. The
P2 batch's two bare `rm -f` calls in the inspect-side rewrite were given the `--` operand-end
marker every other removal in the file already uses.

**Docs.** `2-tech-spec.md` D1's stale line reference was corrected; D2's dangling pointer was
replaced with the concrete reason inline. `git-environment.md`'s HOME/XDG row was extended from
"the `gpg.program` family on any signing commit" to also name `verify-last`'s and `marked_oids`'s
read-back and `signature`'s explicit query, and the paragraph that called signing diagnostics
"not security-relevant" (the very claim this round's P0 falsified) was corrected in place rather
than left standing next to its own refutation.

**Oracles.** `smart-commit-execute.test.js`'s `PINNED_CODE_BEARING`/`PINNED_DELIMITERS` literal-pin
arrays were regenerated against the live script (a small node script re-applying the test file's own
extraction functions to the shipped source, diffed against the previous pinned array, rather than
hand-transcribed — hand-transcription is what produced a stale pin in a prior round's prose-doc
edit, and the node-script method does not have that failure mode) to reflect the new
`--no-show-signature` operands, the narrowed `check-attr filter` operand, and the now-unconditional
pipeline segment losing its `if`/`!` prefix. Three new live-attack tests in `smart-commit-execute.test.js`
prove the fixes rather than only the source shape: a `gitShim('diff')`-based one asserts a failing
first pipeline stage now aborts the commit (exit 7) instead of reading as "no drivers found"; a new
LOCAL-scope control proves a repository-local `gpg.program` is still honoured — the override applies
to untrusted config only (the warning-text assertion mirroring `hooksPath`'s pair was added to round
23's existing `gpg.program`-override test, not a new one); and a third seeds a real `.gitattributes`
filter assignment with a global `diff`/`merge`-only decoy alongside it and asserts the commit now
succeeds, proving the `filter`-only narrowing actually stopped the over-refusal rather than merely
reading that way in the source.
`smart-commit-inspect.test.js` gained the mirror set: `P20` asserts every `log`/`diff`/`status` call
site in the file carries `--no-pager`; `P21` asserts `signature` specifically carries
`--no-show-signature`; `P14b` is `signature`'s own armed-control live-attack test against a
HOME-configured `gpg.program`, using a commit with a plumbing-forged `gpgsig` header — measured that
an ordinary unsigned commit never invokes `gpg.program` for `%G?` at all (nothing to verify), so the
control needs a real signature blob present to be live; `P8z7` is `ls-files`'s pipeline-fail-open
counterpart to execute.sh's `diff` test, shimmed the same way; `P8z8` seeds a real untrusted `filter`
assignment alongside a decoy file whose NAME itself reads like an attribute assignment line, and
asserts the decoy changes nothing — the concrete proof the NUL-delimited rewrite closed the
pathname-substring class structurally, not only for the one crafted string a reviewer happened to
try. `P8z5`'s seven-site oracle is unchanged in scope (it was never meant to cover the driver-check
call sites, only `core.fsmonitor`/`core.attributesFile` on status/diff) — those call sites are now
covered by the four armed-control live-attack tests above (`P8z4`, `P8z6`, `P8z7`, `P8z8`) rather
than by a structural oracle; building one analogous to `PINNED_CODE_BEARING` remains deferred, since
`smart-commit-inspect.sh` has no equivalent literal-pin infrastructure yet and building one is scoped
work of its own.

**A fourth scanner-defeat construct, same underlying lesson.** Wiring the `resolve_gpg_override`
warning's own test coverage found that a C-style arithmetic `for ((i = 1; i < N; i += 2)); do` loop's
counter variable is read by `smart-commit-execute.test.js`'s static oracle as a bare, unpinned
command-position token — the same failure MODE as round 22's `case A|B|C)` alternation and round 23's
multi-element `+=(a b c)` array literal (each construct reads as ordinary Bash and defeats the word
walk for its own structural reason), but a fourth distinct SYNTAX triggering it. Avoided rather than
patched: the warning loop was written as `for gpg_kv in "${GPG_OVERRIDE[@]}"; do case "$gpg_kv" in
-c) continue ;; esac; ...; done`, the file's already-established-safe idiom (`git_verify`'s `for name
in reflog log for-each-ref ...`; round 23's `for suffix in clean smudge process`), rather than adding
a fifth recognizer rule for C-style `((...))` loops to the oracle. No C-style for-loop was added to
`smart-commit-execute.sh` as a result — the idiom that avoids the class was already in that file,
this is simply its fourth application there. (`smart-commit-inspect.sh:158`'s `esc()` has used one
since round 17, predating this oracle; it is outside `PINNED_CODE_BEARING`'s scan, which covers only
`smart-commit-execute.sh`, so it is not a counterexample to that oracle — but "either script" above
was wrong to claim it does not exist there.)

### 10.17 Round 24 re-review: a driver-check enumeration gap, a pathspec-narrowed check, and a missing forgery guard

Fallback review of round 24's own fixes (Codex quota exhausted again; `strict-reviewer` for code,
`tech-spec-reviewer` for docs, both advisory). Both reviewers were told only the changed-file list
and told to research independently, per `@rules/codex-invocation.md`'s standard applied to the
fallback agents. The code-plane review found three real defects, one of them a P0 in the very
function round 24 had just rewritten; the doc-plane review found the usual drift in the tech-spec's
own line/byte references, which the fixes below re-measure one further time.

| Finding | The gap |
|---|---|
| P0 | `smart-commit-execute.sh`'s driver-check enumerated only STAGED paths (`git diff --cached --name-only -z`), but `git commit` refreshes racily-clean index entries across the WHOLE tracked tree as part of its normal operation, not only the files a caller staged this run. A `filter.<n>.clean` assignment on a tracked-but-unstaged path could run unrefused as long as *some other* file was staged — reproduced 10/10 with a plain git-lfs shape where only an unrelated file was staged and the LFS-tracked path itself was left alone |
| P1 | `smart-commit-inspect.sh`'s `scope`/`diff` subcommands passed their own pathspec argument down into the driver check, narrowing it to the caller-given path. But `git status`/`git diff` refresh the same racily-clean entries across the WHOLE tree internally regardless of what pathspec they are asked to *report on* — so a pathspec that happened to exclude the file carrying the untrusted driver left that driver free to run while the narrowed check reported "no drivers found." Reproduced 6/10 |
| P1 | `smart-commit-execute.sh`'s privileged-mode preamble had only the `''` (real re-exec) arm of the `case "${SD0X_PRIV_REEXEC:-}" in` block — the forged-sentinel guard (`declare -p SHELLOPTS BASHOPTS \| grep -qE '...x...'`) `smart-commit-inspect.sh` has carried since its own round-19 P0 was never ported to this file. Reproduced: an exported shell function combined with a forged `SD0X_PRIV_REEXEC=1` and a `SHELLOPTS=privileged`-forged `$-` flag ran unchecked here while the identical attack against `smart-commit-inspect.sh` was correctly refused |
| P2 batch (doc-plane) | `2-tech-spec.md` D1's round references had drifted to "round 23" where the line-reference fix actually landed in round 24; D2's own line/byte figures were stale from before this round's edits, twice over — fixing the first stale figure changed the file's own size, staling the figure again, which is the same recurring-staleness pattern D1 itself names |
| P2 batch (code-plane) | `execute.sh` had no `set -u` where `inspect.sh` has carried it since its own preamble was written, an asymmetry with no stated reason; `refuse_on_untrusted_content_drivers`'s scratch attribute file in `inspect.sh` was `rm -f`'d on every explicit return path but had no trap covering a signal landing in the window between `mktemp` and one of those removals; the driver-check comment explained why `diff`/`merge` drivers are checked but never said why `diff.<n>.command` specifically is not, leaving its `--no-ext-diff` dependency implicit; one assertion message in `smart-commit-execute.test.js`'s filter-driver test read "staged or not" for a test that in fact only covered the staged case; the pipeline's SECOND stage (`check-attr`) failing had no dedicated test in either script, only the first stage (`ls-files`/`diff`) did; `P8z8`'s decoy filename carried no embedded newline, so it could not by itself distinguish the NUL-delimited parser from a hypothetical line-oriented one |

**The fixes.** `smart-commit-execute.sh`'s enumeration moved from `git diff --cached --name-only -z`
to `git ls-files -z --cached` — the full tracked set, matching what `git commit` itself refreshes;
untracked paths stay correctly excluded (`--others` omitted) since they are outside the index a
commit touches. `smart-commit-inspect.sh`'s `scope`/`diff` subcommands now call
`refuse_on_untrusted_content_drivers` with no pathspec argument at all, matching `status`/`collect`;
the function's own docstring was rewritten to state the whole-tree requirement as the invariant
rather than a caller option. `smart-commit-execute.sh`'s preamble gained the `*)` arm ported
verbatim in mechanism from `smart-commit-inspect.sh`'s equivalent guard. `set -u` was added to
`smart-commit-execute.sh` (validated by re-running its full test suite before and after — no
latent unset-variable reference existed for it to trip on). `refuse_on_untrusted_content_drivers`
in `smart-commit-inspect.sh` now sets `trap "rm -f -- <path>" EXIT` plus `INT`/`TERM`/`HUP` traps
that `exit` explicitly (mirroring `smart-commit-execute.sh`'s `OWNED`/`sweep_owned` shape) right
after the `mktemp` succeeds — this is the only `mktemp` call in the file, so the trap is scoped to
exactly the resource it protects. The driver-check comment gained a line naming `diff.<n>.command`
by name and stating it is deliberately not checked because `--no-ext-diff` on every status/diff call
already refuses to invoke it — unlike `.textconv`, which survives that flag. The misleading test
assertion was reworded to name the staged-only scope it actually covers, pointing at the sibling
test for the unstaged case.

**Docs.** `2-tech-spec.md` D1's "round 23" references were corrected to "round 24"; D2 was
re-measured against the file as it stood after this round's own edits (not the figure recorded when
§ 10.16 was first written), including the `## 11.` table's `git-environment.md` row and its
derived total/percentage. That row and percentage were last actually moved by round 24 proper (its
own `git-environment.md` § 1/HOME edit, § 10.16) — this re-review's own fixes land entirely in the
two shell scripts, the two test files, and this doc, none of which § 11's table measures, so D2's
re-measurement here is a pure re-check, not a re-move (a distinction a follow-up fallback review
caught this file getting wrong the first time it was written — see § 10.18).

**Oracles.** `smart-commit-execute.test.js` gained: a regression test proving a tracked-but-unstaged
file carrying an untrusted filter assignment is now refused; `PINNED_CODE_BEARING`'s enumeration
entry updated to `ls-files -z --cached`; the pipeline-fail-open test retargeted from
`gitShim('diff')` to `gitShim('ls-files')` to match; `PERMITTED_TOKENS` extended with `declare` and
`grep` for the ported privileged-mode guard (the `grep` half was removed again in § 10.18, which
replaced the guard's own external-command call); a live-attack test proving a forged
`SD0X_PRIV_REEXEC`+`SHELLOPTS=privileged` sentinel is refused, with a mutation control proving the
same attack succeeds once the guard's pattern is defeated (retargeted in § 10.18 from the `grep`
pattern to the `case` pattern that replaced it); a `check-attr`-shimmed test proving
the pipeline's SECOND stage failing aborts the commit exactly as the first stage's test already
proved; and a `verify-last` armed-control test (mirroring `smart-commit-inspect.test.js`'s `P14b`)
proving a HOME-configured `gpg.program` cannot run during read-back verification even under a
plumbing-forged `gpgsig` header. `smart-commit-inspect.test.js` gained: `P8z9`, proving `scope`/`diff`
still refuse when their own pathspec argument names a file unrelated to the one carrying the driver
assignment; `P8z10`/`P8z10b`, an async SIGTERM-mid-check test proving the new trap actually fires
(with the guard-deletion mutation control the pattern above requires) and does not leak the scratch
file; `P8z7b`, the `check-attr`-stage counterpart to the existing `P8z7` (`ls-files`-stage) pipeline
test; and `P8z8` extended with a second decoy filename carrying a literal embedded newline, which a
line-oriented parser could misread as a record boundary and the NUL-delimited one must not.

### 10.18 A second fallback re-review of § 10.17's own fixes: the new guard was itself bypassable

§ 10.17 ported a forged-sentinel guard into `smart-commit-execute.sh` and hardened
`smart-commit-inspect.sh`'s pathspec/trap/gpg surface. Codex quota was still exhausted, so this
round used the same fallback pair as every prior round this session — `strict-reviewer` for the
two shell scripts and their tests, `tech-spec-reviewer` for this file and `2-tech-spec.md` — each
told to research independently rather than confirm a conclusion handed to it (advisory findings
only, per `rules/auto-loop.md`'s degradation matrix; the zero-tolerance fix obligation for
P0/P1/P2 still applied regardless).

| # | Severity | Finding | Reproduced |
|---|----------|---------|------------|
| 1 | P0 | Both scripts' new `declare -p SHELLOPTS BASHOPTS \| grep -qE '...x...'` guard piped through an external, PATH-resolved `grep` — in exactly the scenario the guard exists to catch (no real `-p` re-exec happened, so environment function import is still active), an attacker who can forge the sentinel can equally hijack `PATH` or export a `BASH_FUNC_grep%%` shell function and make the pipe answer whatever it wants | Yes — both a PATH-shadowed `grep` and an imported `grep()` function let a forged `SD0X_PRIV_REEXEC=1`+`SHELLOPTS=privileged` run reach `cmd_alloc` in `smart-commit-execute.sh`, and reach a live `git` call in `smart-commit-inspect.sh` |
| 2 | P0 (out of scope, logged not fixed) | `scripts/commit-msg-guard.sh`, `scripts/run-skill.sh`, and `skills/create-pr/scripts/sanitize-pr-content.sh` carry the same `SD0X_PRIV_REEXEC` re-exec preamble but never received the `*)` arm's forged-sentinel guard at all — reachable through the same `PATH`/`BASH_FUNC_*%%` vectors as #1 | Yes, end-to-end against `commit-msg-guard.sh` with a forged AI-attribution trailer: baseline refuses (rc 1), the same env plus an imported `grep()` accepts (rc 0) |
| 3 | P2 | `smart-commit-execute.sh`'s driver-check comment still claimed both pipeline stages carried the same `core.fsmonitor`/`core.attributesFile` pins; only stage 2 (`check-attr`) ever did — `smart-commit-inspect.sh`'s copy of the same comment had already been corrected, this file's had not | Static — comment vs. the two `git` call lines it describes |
| 4 | P2 | `smart-commit-inspect.sh`'s `refuse_on_untrusted_content_drivers` docstring stated "takes no pathspec" (§ 10.17's own P1 fix) but the function body still forwarded `-- "$@"` into `ls-files` — harmless only because every current call site passes nothing, and the exact re-entry point § 10.17 had just closed at the call sites | Static — no current caller exploits it, but nothing in the function itself would stop a future one |
| 5 | P2 | `smart-commit-inspect.sh`'s `signature` subcommand silently substitutes an untrusted `gpg.program` (via `resolve_gpg_override`, § 10.16) with no warning, unlike `smart-commit-execute.sh`'s `run_commit` (§ 10.16's own P1) | Yes — `signature`'s `%G?` verdict changes with a HOME-configured `gpg.program` and prints nothing to stderr about it |
| Nit | Nit | § 10.17's "Docs." paragraph and § 11's "Weight" paragraph both attributed that round's `## 11.` table re-measurement to "this round's fixes" moving the table, when the table's actual mover was round 24 proper (§ 10.16); a stray "round 23" phrase survived in `2-tech-spec.md` D1 despite the cell's own opening clause already having been corrected to "round 24" | Static — text vs. the file's own edit history |

**The fixes.** Both scripts' guard now reads `SHELLOPTS`/`BASHOPTS` via `builtin declare -p`
(forcing the real builtin even if a `BASH_FUNC_declare%%` were imported) into a variable, isolates
the flag cluster with parameter expansion (`${var#declare -}`, `${var%% *}`), and tests it with
`case … in *x*)` — a reserved word, not a command lookup target, so neither a hijacked `PATH` nor
an imported shell function can influence the verdict. Finding #2 is logged here rather than fixed:
`commit-msg-guard.sh`, `run-skill.sh`, and `sanitize-pr-content.sh` are outside this feature's file
set and were, at review time, concurrently modified by a different change on the same branch —
touching them here risked a conflicting edit on files this round does not own. Per
`rules/fix-all-issues.md`'s "beyond current scope" exception, it is recorded rather than silently
dropped; porting the same `builtin declare`/`case` guard into those three files, ideally from one
shared preamble instead of five independent copies, is the follow-up. Finding #3's comment was
reworded to match `smart-commit-inspect.sh`'s already-correct wording (stage 1 pins only
`fsmonitor`, stage 2 pins both). Finding #4's function now fails fast on `[ "$#" -eq 0 ]` before
doing anything else, and no longer forwards `"$@"` to `ls-files`. Finding #5's `signature` arm now
emits the same two-line warning shape `run_commit` does, naming the overridden key and the safe
default substituted. The Nit was fixed in place: § 10.17's "Docs." and § 11's "Weight" paragraphs
now say the table was last moved by round 24 proper, and `2-tech-spec.md` D1's stray "round 23"
denominator phrase was removed.

**Oracles.** `smart-commit-execute.test.js`: the guard-deletion mutation control retargeted from
the (now-removed) `grep` pattern to the `case $SD0X_F in *x*)` pattern; a new test proving the
guard is immune to both a PATH-shadowed `grep` and an imported `BASH_FUNC_grep%%` function;
`PERMITTED_TOKENS` for `smart-commit-execute.sh` had `grep` removed (`builtin` is a peeled prefix
the static command-token scanner does not itself report — verified empirically, not assumed).
`smart-commit-inspect.test.js`: `P18i`, the same PATH/`BASH_FUNC_grep%%` immunity proof against
`smart-commit-inspect.sh`; a static test asserting `refuse_on_untrusted_content_drivers` both
contains the `[ "$#" -eq 0 ]` fail-fast guard and no longer forwards `"$@"` to `ls-files` (static
rather than behavioural, because the parameter is not reachable from the CLI through any current
call site — there is no argv path left to drive a behavioural proof once the invariant holds
statically); and `P14b` extended to assert the new stderr warning on a HOME-configured
`gpg.program` override.

## 11. The stated goal, measured — and not met

*(2-tech-spec.md § 5 W14; the refactor was requested as "reduce this skill's weight and complexity")*

Recorded because § 9.3's own rule applies to the change as a whole: a note that states only the
reassuring half is how the next maintainer reverts it. Both round-10 reviewers reached this
independently, and so did the measurement below.

| Instruction surface (loaded whole on every read) | HEAD | now | Δ bytes |
|---|---|---|---|
| `skills/smart-commit/SKILL.md` | 579 L / 43,892 B | 787 L / 65,800 B | **+21,908** |
| `references/git-environment.md` | 139 L / 10,942 B | 270 L / 25,333 B | **+14,391** |
| `references/execute-mode.md` | 552 L / 38,625 B | 543 L / 38,066 B | −559 |
| **total** | **93,459 B** | **129,199 B** | **+35,740 (+38.2%)** |

Plus three new files: `smart-commit-inspect.sh`, `smart-commit-inspect.test.js`, and this one.

**Weight: not reduced — increased 38.2%** (up from 30.4% at round 20 — round 21's and round 24's
`git-environment.md` § 1 additions account for the whole movement since round 20; neither round
24's re-review (§ 10.17) nor its own re-review (§ 10.18) touched any file this table measures, so
the percentage has been unchanged since round 24 proper landed, and each subsequent doc pass here
is a re-check of that same figure, not evidence of a new move). The bytes went into prose, not
commands: SKILL.md's
fenced-bash surface fell **97 → 91** body lines while the surrounding explanation grew faster. Nor
did the specific duplication the extraction targeted disappear. The `env -u` prefix has grown to
**559 bytes** (round 17's `+23` for `GIT_CONFIG_NOSYSTEM` over the 473-byte baseline, then `+21`
each for `GIT_EXTERNAL_DIFF`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` added across rounds 18–20
— `473 + 23 + 21 + 21 + 21 = 559`) and appears **21 times in SKILL.md now against 20 at HEAD** —
11,739 bytes, 17.8% of the file (`11739 / 65800`).
Both figures are re-derivable; an earlier revision of this section carried a fence count that is
not, which is why the command is written down:

```bash
# fence body lines, excluding the ````markdown illustration block
git show HEAD:skills/smart-commit/SKILL.md > /tmp/head.md
for f in /tmp/head.md skills/smart-commit/SKILL.md; do python3 -c "
import re,sys
s = re.sub(r'^\`\`\`\`markdown[\s\S]*?^\`\`\`\`\$', '', open(sys.argv[1]).read(), flags=re.M)
print(sum(len(m.group(1).rstrip('\n').split('\n'))
          for m in re.finditer(r'^[ \t]*\`\`\`bash\n([\s\S]*?)^[ \t]*\`\`\`\$', s, flags=re.M)))" "$f"; done
grep -c 'env -u GIT_DIR' /tmp/head.md skills/smart-commit/SKILL.md
```

**Complexity: reduced, and that is the honest win** — but the reduction is not in how many times
the prefix is *written*, which is the figure above and which went up. It is in how many times the
policy is **applied**. The two are different counts, and an earlier revision of this table conflated
them badly enough to invert one column:

| | HEAD | now |
|---|---|---|
| Literal restatements of the 559-byte prefix in `SKILL.md` | 20 | **21** |
| — as a `GIT_ENV="…"` assignment, applied later via `$GIT_ENV` | 14 | 0 |
| — written at the point of use | 6 | 21 |
| **Points where the policy is applied to a command** | **39** | **21** |
| — deriving `REPO_ROOT` (structurally irreducible) | 14 | 14 |
| — reaching a command that does the actual work | **25** | **7** |

```bash
git show HEAD:skills/smart-commit/SKILL.md > /tmp/head.md
grep -c 'env -u GIT_DIR' /tmp/head.md                              # 20 literal restatements
grep -c 'GIT_ENV="env -u' /tmp/head.md                             # 14 of them are assignments
grep -c '\$GIT_ENV ' /tmp/head.md                                  # 33 applications via the variable
grep -c '\$GIT_ENV git rev-parse --show-toplevel' /tmp/head.md     # 14 of those derive REPO_ROOT
grep -c 'env -u GIT_DIR' skills/smart-commit/SKILL.md              # 21 literal restatements
grep -cF 'REPO_ROOT=$(env -u GIT_DIR' skills/smart-commit/SKILL.md #  14 derive REPO_ROOT
```

HEAD's 39 = 33 via `$GIT_ENV` (32 git, 1 bash) + 6 written literally; 39 − 14 derivations = 25.
The table this replaced read `20 → 7` against a HEAD row of `0` derivations, which was wrong twice:
HEAD derived `REPO_ROOT` fourteen times too — every one of them prefixed — so a cost that did not
change was presented as newly introduced, and the 20 it compared against counted assignments rather
than applications. The real movement is **25 → 7**, which is larger than the figure it replaced and
correctly based; the seven are four printed `git commit`/`add` commands, two lines of printed
checklist text, and one `bash -p --` delegation, so "on a git command" was never quite the label
either.

The 14 derivations cannot be factored out: one tool call is one shell, no variable survives between
fences, and deriving the root is itself a git command that must run stripped. Writing it through a
variable is the zsh defect in § 2.1. So the repetition was **re-pointed, not removed** — and the
header comment at `smart-commit-inspect.sh:12-16` should be read that way: the policy for the
*diagnostics* became one `unset` block with a test (`P1`), which is what the ten fences stopped
restating.

What the change actually bought, none of which is weight: fail-closed behaviour under dash where
the previous shape failed **open** at exit 0 with a wrong signing verdict (§ 2.2); one enforcement
point a test can pin, against a prefix that had already drifted from the executor's list (§ 3);
`:(literal)` applied per operand where no call site can forget it; `--untracked-files=all` (§ 9);
and the keyed, unforgeable `identity` contract (§ 10). The accurate summary is *"the policy got a
single enforcement point and a test, at +38.2% on the instruction surface"* — not "less weight".
That figure has now been restated five times as the rounds added rows to Step 1c and Step 1d, and
each restatement was meant to be a correction rather than a drift — except the fourth one wasn't:
it recorded 35 rows / 4,785 bytes for a segment that, run against the file at the time, was already
48 rows / 6,773 bytes. The derivation command was correct; its output was not re-run before being
pasted into the sentence describing it, which is the exact failure this note exists to name (§ 9.3).
The cost of the loop is visible here regardless of which figure is right — round after round of
contract fixes bought correctness, and the decision tables they grew are (as measured now) **7,432
bytes across 48 rows** — same row count as round 14 shipped, heavier because round 15 replaced two
rows' text rather than adding new ones (§ 10.8), and later rounds' rows grew further still without
adding new ones — derivable rather than estimated (round 18 review, P2: this paragraph previously
read 6,964 bytes, accurate as of round 15 but not re-run since):

```bash
python3 - <<'PY'
s = open('skills/smart-commit/SKILL.md', encoding='utf-8').read()
seg = s[s.index('**Read the output by key and kind'):s.index('**1e. AI Guard Readiness**')]
rows = [l for l in seg.split('\n') if l.startswith('| ')]
print(len(rows), sum(len(r.encode()) + 1 for r in rows))   # 48 7432
PY
```
