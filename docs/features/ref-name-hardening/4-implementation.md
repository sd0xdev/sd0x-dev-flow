# Ref-Name Hardening — Implementation Notes

Implementation record for the `/smart-rebase` ref-name and fetch-safety fixes. This document owns
the design arguments that are too long to live as code comments (`@rules/docs-writing.md`
§ Code Comments); `skills/smart-rebase/SKILL.md` and
`skills/smart-rebase/scripts/smart-rebase-analyze.sh` carry pointers into the sections below.

**Size disposition (re-measured 2026-08-21, after the `--base` ambiguity addition to § 1.1).**
`wc -l docs/features/ref-name-hardening/4-implementation.md` measures **569** lines, against the 508
the round-16 disposition recorded. The growth is dated corrections and one new measured defect, not
new design. The re-measurement is this document's own "re-measure at the next substantive edit"
instruction being followed, and the judgment below is reconfirmed against the current shape rather
than carried forward: `grep -n '^## '` returns exactly one heading, `## 1.` at line 48, and no
`## 2.`, so § 1 runs to EOF and is **522 of them** (91.7%) — still short of the ~600 threshold this
disposition set for itself below. (Two earlier passes recorded 564 and 566; both were taken while
the edit was still in progress and were stale by the time the round closed. **Measure after the last
edit of the round, not during it** — a self-reported count is a claim like any other, and a reviewer
re-running `wc -l` is exactly what catches it.) A split would not divide
this document into two
comparable halves — it would carve § 1 itself apart, and § 1's subsections are the single argument
described below. `resolve-review-profile.js`
classifies this file as **current authority**, not a record, so the record exemption in
`@rules/docs-numbering.md` § Size Limit does not cover it and the >500 rule applies. **Judgment: keep
whole**, and the reason is the one that section allows — this is a single argument, not an
accumulation. Every subsection of § 1 exists to support one claim: *modelling git's ref handling
fails, so ask git*. §§ 1.1–1.6 are the six measured ways the modelling breaks, and § 1.7 is what they
jointly imply; cutting between them would put the evidence in one file and its conclusion in another,
which is exactly the "split landing mid-argument" that section warns is worse than the long file.
Prune and merge were tried first and found nothing to remove: each subsection measures a different
git behaviour, so nothing duplicates. The one block headed **⚠️ Superseded** in § 1.2 is **not** dead
text and is not offered as evidence that nothing is — it is a live limitation notice on a defect
that is still open (the r1 ticket's AC 1 is unchecked), so remedy 1 does not reach it. Re-measure
with `wc -l` at the next substantive edit; if § 1 grows past ~600 the natural cut is §§ 1.1–1.6 into
a sub-file with § 1.7 kept in the main document.

**Provenance.** These fixes were made during the `push-gate-optin` change and were recorded in that
feature's `4-implementation.md` until 2026-08-20, when doc review found the ownership mismatch: the
section was 82% of a document about push-gate authorization. It was moved here with its section and
sub-section numbers unchanged, so every inbound pointer needed only its path repointed, not its
section number. ("Unchanged" is a claim about the numbering, which is still checkable — § 1 and
§ 1.1–§ 1.7 are here and are gone from the source. It is not a claim of byte identity: both files
are untracked, so no pre-move artifact exists to diff against. See the r1 correction note dated
2026-08-20.) The redesign these findings argue for is
[`requests/2026-08-20-ref-name-hardening-r1.md`](./requests/2026-08-20-ref-name-hardening-r1.md);
what § 1 below records is the set of fixes **implemented in the current working tree** — they are
uncommitted, so "shipped" would overstate them.

## 1. `/smart-rebase` analysis fetch safety

Scope note: `skills/smart-rebase/` entered the `push-gate-optin` task through an explicit scope
expansion (`@rules/scope-discipline.md` § Closed-Set Options, option 1), which is why these findings
were first recorded inside `docs/features/push-gate-optin/4-implementation.md` rather than in a
feature directory of their own. They are no longer there: on 2026-08-20 the class was diagnosed as
`ARCHITECTURE` and extracted into this directory.

`skills/smart-rebase/scripts/smart-rebase-analyze.sh` advertises itself as a **read**: it produces a
rebase plan and prints the command for the developer to run. Successive review rounds found seven
ways it could nonetheless **write**, or tell the developer to write. Most run through the single
`git fetch` the script performs — but not all: § 1.5 is a write the *developer's* shell does when it
pastes an unquoted name, and § 1.6's `--base` defect produces a confident plan without fetching at
all. Naming the fetch as the single choke point was itself one of the wrong answers this section
records.

### 1.1 The argument is a refspec, not a branch name

`git fetch origin <value>` treats `+main:refs/heads/main` as an instruction to force-overwrite the
local `main`. Measured against a real repository: `git fetch . '+HEAD:refs/heads/victim'` moved
`victim` off its own tip — during analysis, with no approval covering it.

Closed by validating `--target` with `git check-ref-format --allow-onelevel`, which is git's own
answer rather than a pattern list assembled by hand: it rejects `:`, `~`, `^`, `?`, `*`, `[`, `\`,
**ASCII** whitespace, control bytes, a leading `-`, `..`, `@{` and a trailing `.lock`, and it stays
in step with git by being git. `--allow-onelevel` because `main` and a bare SHA are both legitimate
targets and both are single-level names.

**What it does *not* reject, measured, because a control built on the wrong assumption reports
legitimate work.** `]` is legal (`refs/heads/feat/a]b` is accepted), and so is non-ASCII whitespace —
NBSP, U+2028 and U+3000 all pass. So are `;`, backticks and `$( )`: a ref name is an *identity*, and
git has no reason to care that a shell would read it as syntax. § 1.4 is where that last fact
becomes a defect if the name is ever printed unquoted.

**One value it cannot check at all**: a `--target` beginning with `-`. `check-ref-format` reads the
leading dash as its own option; `--` does not help it and it has no `--end-of-options` — measured.
So that one call is skipped for an option-shaped target, and the value is instead required to
resolve to a ref, which is a stronger answer than a name-shape check: § 1.6.

Every string validated is a string **used**, not one value checked several times. `$TARGET_REF` is
what the read commands resolve (`rev-parse`, `merge-base`, `log`, `cherry`) — the fully-qualified
form of what the caller named, per § 1.6. The caller's own spelling is checked first **when it can
be**: an option-shaped value takes the paragraph above instead, and is answered by resolution rather
than by a name-shape check. When the target turns out to be remote-tracking (§ 1.4), the two refs the
refspec interpolates — `refs/heads/<branch>` and `refs/remotes/<remote>/<branch>` — are checked too.
The **remote name is not** refused for being option-shaped: `--` makes it an operand (§ 1.6), so a
remote named `-evil` is fetched from rather than reported as hostile. A check belongs on the value it
protects, and only where it can answer.

`--base` is deliberately exempt from the **name-shape** check: it is documented as a
commit-or-branch, reaches only `git rev-parse`, and revision expressions like `HEAD~3` or `:/.` are
legitimate there and would fail `check-ref-format`.

**The exemption is per axis, not blanket, and reading it as blanket left two real defects standing.**
Shape is one question; what the value *resolves to* is another, and the second is checked:

| Axis | `--base` | Where |
|------|----------|-------|
| Name shape (`check-ref-format`) | Exempt — the paragraph above | — |
| Option-shaped value reaching `rev-parse` as an option | **Checked** — `--end-of-options` on every read | § 1.6 |
| Short name denoting two different exact refs | **Checked** — refused before the cut point is resolved | below |

The ambiguity check counts exact refs (`git show-ref --verify --quiet --`) across the five prefixes
git itself searches — `refs/<n>`, `refs/tags/<n>`, `refs/heads/<n>`, `refs/remotes/<n>`,
`refs/remotes/<n>/HEAD` — and refuses when two or more exist. It turns on **resolution**, which is
what keeps the shape exemption intact: a revision expression matches none of the five, so the
refusal is unreachable for `HEAD~3`, `:/.` or a raw commit id, and only a name that really is a ref
can reach it. Without it, `--base shared` naming both a tag and a branch resolved silently to one of
them — the resolution discards stderr — and the whole plan was computed from the wrong cut point
with no error anywhere. Pinned by `test/skills/smart-rebase.test.js`
('--base when the short name is ambiguous → refused, while revision expressions still resolve'),
which carries both directions: the collision must be refused, and the three legitimate forms must
still return `"status": "ready"`.

One trap the implementation had to survive: `git rev-parse --verify --symbolic-full-name
--end-of-options <ambiguous>` **exits 0** while printing nothing to stdout, so the check reads the
printed value and never `$?` — a `||` on that command clears exactly the case it was added to catch.

### 1.2 Validating the source does not decide the destination

The sharpest finding of the loop, because **nothing is injected**. `git fetch origin <src>` also
applies `remote.origin.fetch`, so where the fetched ref lands is chosen by configuration, not by the
argument. Measured: with `remote.origin.fetch = +refs/heads/main:refs/heads/victim` configured, the
entirely ordinary `git fetch origin main` moved `victim` onto main's tip. A perfectly valid
`--target` is enough. Validating `--target` closed § 1.1 and never touched this.

Two changes close it, and both are needed:

| Change | What it stops |
|--------|---------------|
| `--refmap=` | git ignores the configured refspecs and uses only what is on the command line — otherwise the opportunistic remote-tracking update applies whatever config asks for |
| A fully-qualified, script-built refspec | The destination is a string this script constructed inside `refs/remotes/<remote>/`, never one a repository supplied |

The fully-qualified **source** is also what makes a branch literally named `+main` work: a bare
`+main` reads as the force modifier plus `main` (which is why an earlier round refused it outright),
while `refs/heads/+main` is unambiguous. The refusal is gone because the ambiguity is — refusing a
legal ref name was the wrong half of that fix. The same argument retired the refusal of `origin/-evil`
and `origin/--upload-pack=id`: `check-ref-format` accepts `refs/heads/-evil`, and the bare token is
never passed alone any more.

### 1.3 `--refmap=` governs branch mappings and nothing else

Two further write paths are not reached through the refspec, so constructing it closed neither:

- `git fetch` stores tags pointing into the fetched history by default, and
  `remote.<name>.tagOpt = --tags` widens that to every tag on the remote → `--no-tags`
- `fetch.recurseSubmodules` fetches into populated submodule repositories →
  `--no-recurse-submodules`

If the claim is one controlled ref update, it has to be one.

### 1.4 A failed refresh is an error, not a fallback

`|| true` used to swallow the failure, and the analysis then ran against whatever stale
`origin/<branch>` happened to be on disk — emitting a confident keep/drop plan and exit 0 built on
history the remote no longer has. Measured by pointing `remote.origin.url` at a path that does not
exist: status 0, a plan, and a `target_head` that was days old. Offline, behind a broken `insteadOf`
rewrite, or on an auth failure, that plan looks exactly like a good one.

So a remote-tracking target now requires the fetch to succeed, and a **local target is not fetched at
all** — which is what `skills/smart-rebase/SKILL.md` § Step 5 has always documented ("Fetch only if
target is a remote-tracking ref … skip if target is local"). The script was the half that disagreed.

**And "is it remote-tracking" is a question for git, not for the spelling.** The first fix asked
`case $TARGET in origin/*)`, which is wrong in three directions at once: `refs/remotes/origin/main`
is a remote-tracking ref the pattern calls local — so it skipped the refresh, reaching the very
staleness this section is about, by spelling the same ref its other way — `upstream/main` likewise,
and a local branch literally named `origin/foo` was called remote. The target is now resolved with
`git rev-parse --symbolic-full-name`, and `refs/remotes/<remote>/<branch>` is decomposed into the
remote and branch the fetch actually uses. That also handles `origin/HEAD`, which resolves through
its symbolic ref to the branch it points at — something the string form could not do, and which had
made the script construct an unfetchable `refs/heads/HEAD`.

One case git cannot answer: a remote-tracking ref that has **never been fetched** does not resolve,
and fetching it is exactly what the caller wants. `<name>/<rest>` is treated as remote-tracking when
`<name>` is a name in `git remote` output — still an answer from the repository, not from the shape
of the argument.

**Except for one `<rest>`, and it is the one that looks most ordinary.** `<remote>/HEAD` names the
remote's default branch, and only the fetched symref says which branch that is. `git clone` records
it; `git remote add` + `git fetch` does not — so on most added remotes the probe fails and the
decomposition leaves the literal branch `HEAD`, making the refspec ask for `refs/heads/HEAD`. On the
usual repository the refresh then fails with a message about the wrong thing; on one that happens to
carry such a branch, it analyses history nobody asked for. Neither is the default branch the caller
named, so an unresolved `<remote>/HEAD` is refused.

The recovery it names is `git remote set-head <remote> -a` — **but only where git would run it**.
That subcommand has no `--end-of-options`, and no `--` placement makes a dash-named remote an
operand: every ordering measured exits 129 with `unknown switch 'e'`. For the one remote spelling
this script goes out of its way to support, a correctly quoted recovery line would still be a command
git refuses, so the message keeps only the advice that works (`--target` with the branch name). A
pasteable line that cannot run is § 1.5's failure wearing its other face.

**The remote is a name the repository owns, not the first path segment.** `${_rest%%/*}` was the
first spelling, and it is wrong on a legal repository: `git remote add team/origin <url>` is accepted
and honoured, so `refs/remotes/team/origin/main` decomposes as remote `team`, branch `origin/main`,
and the fetch then names a remote that does not exist. Matching against `git remote` output answers it
without a rule about slashes: the remote is a name the repository owns, not a path segment.

**And where two configured remotes both match, the script refuses rather than picks.** With `team`
and `team/origin` both configured, `refs/remotes/team/origin/main` is remote `team` branch
`origin/main` *or* remote `team/origin` branch `main`; both are legal, both can be configured to
write that same tracking namespace, and the path carries no evidence of which one put the ref there.
Any tie-break would be deterministic but not grounded — it would force-update the tracking ref
from a repository that may not be its source, which is the § 1.2 defect (a destination chosen by
something other than the caller) arriving through the remote instead of the refspec. Ambiguity is a
refusal naming both candidates.

**A name prefix is only one of the two ways a remote can own that path**, and reading only the name
is how the second owner stays invisible. `remote.<name>.fetch` decides where a remote writes, and
nothing requires the destination to sit under its own name: with
`remote.up.fetch = +refs/heads/*:refs/remotes/origin/*` configured, `git fetch up` writes
`refs/remotes/origin/main` — measured. So the ambiguity check counts the union of both ownership
sources, and the dedup between them is load-bearing rather than tidy: every clone has
`remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*`, so origin is found by both scans on
every ordinary target, and counting that twice would refuse the default configuration of every
repository there is. A claim that arrives **only** through a refspec is not decomposed into a
destination branch — it names the owner and refuses.

**A refspec has two sides, and reading only the destination is wrong in both directions.**

*Discarding the source* fabricates the branch to refresh from. `refs/remotes/origin/stable` under
`remote.origin.fetch = +refs/heads/main:refs/remotes/origin/stable` **is** the remote's `main` — that
is what the ref means — so refreshing it from a branch called `stable` replaces it with history the
caller never named and then plans against that. Measured against real git: before the fix the run
left `origin/stable` holding the remote's own `stable`; after it, main's tip, untouched. The source
is therefore derived by inverting the refspec that covers the path (`refs/remotes/origin/*` matching
with capture `stable` gives `refs/heads/stable`; a literal destination gives its literal source), and
`refs/heads/<tail>` survives only as the fallback for a path no configured refspec covers. Two
refspecs of one remote covering the path from **different** sources is not a tie to break: the
repository has not said what that ref means, and it is refused.

**An inverter is only as good as the refspec forms it accepts, and two legal ones read as
unremarkable until they are measured.** A wildcard capture may be **empty**:
`+refs/heads/main*:refs/remotes/origin/stable*` maps `main` to `origin/stable`, and a matcher
requiring at least one captured character skips it and falls through to the fabricated
`refs/heads/stable`. A source need not be fully qualified either: `main:refs/remotes/origin/stable`
is accepted, git resolving the short name on the remote — so requiring the source to start with
`refs/` discards a mapping that exists. Both were measured against real git, and in both the fixed
run leaves `origin/stable` at main's tip where the unfixed one overwrote it with the remote's own
`stable`.

**A third form reads as a mapping and is not one: the unpaired wildcard.** git allows a `*` on one
side of a refspec only if it is on both, so `+refs/heads/main:refs/remotes/origin/*` is rejected
wholesale — measured, `git fetch --dry-run` answers `fatal: invalid refspec`, and the paired and
literal forms beside it both succeed. The inverter matched the wildcard destination and took the
literal source anyway, which is worse than accepting a bad config: `--target origin/victim` matched
that destination and was refreshed from `main`, so the plan described history the caller never named.
Accepting a broader grammar than git's is how an invalid configuration became permission to choose
another branch; the literal-source-under-wildcard case is now refused exactly as its mirror is.

**And a short source cannot be validated in the spelling it arrives in.** `check-ref-format` honours
neither `--` nor `--end-of-options` — measured, it rejects every argument after them, the legal name
`main` included — so a configured source literally named `-evil` was read as an option, exited 129,
and a legal mapping was refused. The check is therefore asked under a `refs/heads/` prefix, which is
the one spelling git will judge for a dash-leading name and is the same question the gate exists to
ask. **The prefix stops at the check**: the refspec keeps the configured spelling, because git
resolves a short source across the remote's whole ref namespace — a tag is a legal source — and
re-spelling it `refs/heads/<name>` would narrow a mapping the repository configured, which is this
section's own defect arriving from the other side.

What remains after those two is a source the script genuinely cannot invert — a literal destination
whose source carries a wildcard, or one that inverts to something that is not a single ref. That is
reported, never dropped: dropping it falls through to the same fabricated `refs/heads/<tail>` this
whole derivation exists to prevent. The sentinel is `:`, a byte `check-ref-format` rejects inside a
ref name, so it cannot collide with a real answer. The reachable case is a `--target` shaped as a
refspec; the config shape that would produce it is **not** reachable, and the measurement says why:
with `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/stable`, git rejects the refspec
wholesale — `git remote` itself prints `fatal: invalid refspec …` and lists nothing. A configuration
git will not read is not a mapping this script has to invert.

**A name that is not valid UTF-8 cannot be written into a JSON report without altering it, and an
altered name is a different ref.** The remote, the derived source and the branch are each checked
before the fetch is built, and a failure is refused rather than transliterated.

*Ignoring the negative refspecs* invents an owner. `^refs/heads/main` removes a source from what a
remote fetches and has no destination at all, so a destination-only scan cannot see it and counts
`up` as able to write `refs/remotes/origin/main` when it provably cannot — refusing a configuration
that is legal and unambiguous. A positive claim is now checked against the same remote's negatives
before it counts. Measured both directions: the exclusion present analyses, the exclusion removed
refuses.

**And the negative is matched against the same canonical form git uses, not the raw source string.**
Measured: git canonicalizes the *positive* source to a full `refs/heads/<x>` before testing an
exclusion, but does **not** DWIM the negative — `^main` excludes nothing, only `^refs/heads/main`
excludes. Comparing the raw inverted source against the raw negative was wrong in both directions at
once: `^main` matched nothing so a claim git actually keeps was left standing (correct), yet a short
positive source `main` failed to match a real `^refs/heads/main` and a dropped claim was counted as
kept — and symmetrically a full positive against a short `^main` over-excluded a claim git keeps,
falling through to the fabricated `refs/heads/<tail>`.

> **⚠️ Superseded — this fix is incomplete, and the ticket that owns the remainder is open.** What
> follows canonicalizes a short source to `refs/heads/<x>`, which assumes every short source names a
> **branch**. git does not: it resolves a short source against the remote's actual refs, so a source
> that names a **tag** canonicalizes to `refs/tags/<x>`. Measured — with
> `+v0.0.1:refs/remotes/probe/stable` and `^refs/tags/v0.0.1` configured, git's own fetch correctly
> excludes the tag while the refspec built here fetches `[new tag] v0.0.1 -> probe/stable`, bypassing
> the configured exclusion
> (`requests/2026-08-20-ref-name-hardening-r1.md` finding 2). The remedy is not a better inversion but
> **asking git instead of modelling it** (`git ls-remote` + an ambiguity-aware probe +
> `git fetch --dry-run`) — that ticket's AC 1. Read the paragraph below as the state of the fix as
> made, not as a closed property.

The source is canonicalized to its full
`refs/heads/` form (the uninvertible sentinel excepted) before the exclusion test, so both sides are
compared in the one spelling git matches on.

A ref whose remote is no longer configured resolves perfectly and can never be refreshed, so it is
an error rather than a plan built on unrefreshable history — the same staleness § 1.4 opens with,
reached by a different route. **`git remote remove` is not how that state arises** — git-remote(1)
specifies that it deletes the remote-tracking branches along with the configuration, and the
measurement agrees (git 2.55.0, 2026-08-21): a scratch repo with `refs/remotes/up/HEAD` and
`refs/remotes/up/main` had zero refs under `refs/remotes/` after `git remote remove up`. What does
produce it is editing the configuration without going through the porcelain — `git config
--remove-section remote.up` on the same scratch repo left **both** refs in place with `git remote`
listing nothing, and `git rev-parse --verify --quiet refs/remotes/up/main` still printing a SHA.
Hand-created refs under `refs/remotes/` reach the same state by construction. The reason the
handling has to cover it is that the resolution succeeds either way; how the orphan was made is not
observable from the ref.

The trap in that resolution, measured: **`git rev-parse --symbolic-full-name` prints its input on
stdout and exits 128 when it cannot resolve.** `TARGET_FULL=$(… 2>/dev/null || printf '')` therefore
holds `origin/main`, not the empty string it appears to produce, and every unfetched target silently
took the "already resolved" path. Read the exit status, and require the answer to start with
`refs/`.

### 1.5 A ref name printed into a shell instruction must be shell-quoted

The failure message names the command to run by hand, and it interpolated the branch. Since
`check-ref-format` accepts `;`, backticks and `$( )` (§ 1.1), a branch named
`feat/x;printf${IFS}PWN` produced a recovery line that runs a second command when pasted. The plan's
`rebase_command` was already `sh_quote`d for this exact reason; the error path was the half that was
not. JSON escaping does not make a string shell-safe — the two encodings answer different
questions.

**And a quoted value nested inside a fixed pair of quotes is not quoted.** `'--base=<quoted
branch-or-commit>'` reads as the careful form and is the injectable one: substituting
`feat/x;printf${IFS}PWN` yields `'--base='feat/x;printf${IFS}PWN''`, which bash splits into an
analysis call and a second command — measured — while a name containing `'` makes it a syntax error
instead. The slot carries its own quotes, so the fixed prefix beside it must be bare. A marker
reading "quoted" is checkable only against the context it sits in, which is why the test tracks
quote state rather than the marker alone.

**The skill document was the third place a name reached a shell, and the one nobody was checking.**
`skills/smart-rebase/SKILL.md` is read by a model that then writes commands for a human to paste, so
its `<…>` slots are executable advice, not display text — and a remote named `evil;printf${IFS}PWN`
or a branch containing `'` substitutes straight through them. Every slot in a command block is now
written `<quoted …>`, and the rule sits in a section of its own (§ Names in commands) rather than
inside the step that first needed it: a rule written in Step 5 does not reach the templates in
Steps 2 and 6, which is exactly how those stayed bare through a round that was about quoting.

**Shell quoting stops the shell, and git has its own parser behind it.** The quoting rule above was
stated, followed, and closed nothing here: quotes are consumed before git runs, so a branch named
`--all` arrives as an option. Measured — `git check-ref-format refs/heads/--all` exits 0, so the name
is legal, and `git push --force-with-lease origin '--all'` pushed *every* branch in the repository.
The mechanism the templates carry is the **`--` / `--end-of-options` separator** placed before the
ref operand (`--` for `git push` and `git rebase`, `--end-of-options` for `git merge-base`) — **not**
fully-qualifying the ref.

That distinction was the round-30 correction, and it turns on one operand. The obvious rule —
"substitute a `refs/heads/…` ref, which cannot begin with `-`" — is right for an operand git only
*reads* (`--onto <newbase>`, a `--not <target>`), but wrong for the `git rebase` **branch** operand,
which git *moves*. Measured: `git rebase --onto A B refs/heads/work` lands on a **detached HEAD** and
never updates `work`, defeating the command; `git rebase --onto A B -- work` both stops the option
parser and moves the branch. And the vulnerability it closes is real code execution, not a mangled
argument — measured, `git rebase --onto main <base> '--exec=touch PWNED'` ran the payload (a branch
named `--exec=…` is legal and `git update-ref`/`fetch` create it though `git branch` refuses the
spelling); the same line with `--` before the operand treats it as a branch name and runs nothing.
So the emitted `rebase_command` places `--` before the current-branch operand and keeps it short.
It is § 1.6's fact arriving in the document rather than the script — git acts on the operand it is
handed past the separator, never on the spelling that was typed.

**The rule reached the slots and missed the two templates that had none.** Round 30 rewrote every
`<…>` slot in the document and every guard behind them, and round 31 found the defect sitting in the
gaps between slots: Step 1 read `smart-rebase-analyze.sh [--target origin/main]` — a literal ref
where a value belongs, with no slot to mark up — and Step 6 read
`git log --oneline HEAD --not <quoted target>`, correctly quoted and still injectable. Both measured
against real git, both directions:

| Template | Following it with | Measured |
|----------|-------------------|----------|
| `[--target origin/main]` | `origin/main;touch${IFS}/tmp/pwn` — a name `check-ref-format` accepts | the analysis ran, then the second command; the joined `--target='…'` form creates no file |
| `--not <quoted target>` | `--output=/tmp/pwn` | the file was **created** — git consumed the quoted operand as its own `--output`; with `--end-of-options` the same line exits 128 and writes nothing |

So the separator rule gains its third command (`--end-of-options` for `git log --not`) and the
`--target`/`--base` values gain the **joined** `=<quoted …>` form the script's own argument parser
already required — split `--target <value>` cannot be told from `--target` followed by a mistyped
option. What made these survivable is that a slot scan cannot see an operand nobody marked up; § 1.7
records what the guard had to become.

git's stderr is deliberately **not** copied into the error payload: a remote URL can carry a token,
and `@rules/logging.md` puts credentials on the never-log list (Anchor Register #2). The developer
re-runs the fetch by hand and sees the real message somewhere that is not a machine-readable report.

### 1.6 An option-shaped ref reaches every read as an option

A remote may legitimately be named `-evil`: git config accepts it, `git remote` lists it, and
`git fetch -- -evil <refspec>` fetches from it — all measured. So `--target -evil/main` names a real
ref, and refusing the shape (the previous round's fix) reported a correctly configured repository as
hostile. What is true is narrower: the *spelling* cannot be passed as an argument, because git reads
a leading `-` as an option at `check-ref-format`, at `rev-parse`, at `merge-base`, at `cherry`, and
in the command the developer eventually pastes.

Three pieces resolve it, and each is a consequence of that one sentence:

| Piece | Why |
|-------|-----|
| `--` before the operands in the fetch | After the separator git reads the word as a remote, not a flag. `--quiet` must sit **before** it — after `--`, git reads the flag as a refspec (`fatal: couldn't find remote ref --quiet`) |
| Every read uses `$TARGET_REF` — `refs/remotes/<remote>/<branch>`, the ref that was refreshed | The same ref by definition, and the one spelling no git command reads as an option. Not a substitution: it is the fully-qualified name of what the caller asked for |
| An option-shaped target that resolves to **nothing** is refused | There is no fully-qualified form to fall back to, and nothing may proceed on the raw string. It is the resolution that decides, not the ownership: `git update-ref refs/heads/-weird HEAD` creates a local branch `git branch` will not (it reads the name as an option), and the probe resolves it — so it is analysed through `refs/heads/-weird` like any other target |

**The probe that classifies the target is made safe rather than skipped, and that difference is what
makes behaviour independent of the spelling.** Bare `rev-parse` does not refuse a malformed argument,
it answers a different question — measured: `--symbolic-full-name -evil/main` exits 0 echoing the
input, `--symbolic-full-name --git-dir` exits 0 printing `.git`, and adding `--end-of-options` alone
makes it print that flag as an extra output line. `--verify --symbolic-full-name --end-of-options`
returns exactly one revision or exits 128, and nothing else.

Skipping the probe instead — the first shape of this fix — made `origin/HEAD` resolve through its
symbolic ref while `-evil/HEAD` was decomposed literally and fetched a `refs/heads/HEAD` that does
not exist. It also inverted git's own precedence, which puts `refs/heads/` ahead of `refs/remotes/`.
Asking git safely gets both back for free: the same question, the same answer, whatever the remote
is called.

**The other argument reaches `rev-parse` too, and it had the same hole.** `--base` is documented as a
commit-or-branch and deliberately not run through `check-ref-format` (§ 1.1), but without
`--end-of-options` an option-shaped value is *resolved as a query*: measured,
`--base=--glob=refs/heads/*` produced a `ready` plan with `drop_count: 4` and a `git rebase --onto`
command whose cut point came from a glob expansion the caller never named as a commit. A plan that
confident, built from an argument that is not a commit, is § 1.4's failure reached through the other
half of the interface. `--verify --end-of-options` closes it while every legitimate rev expression
(`HEAD~3`, `HEAD^{commit}`, `:/text`) still resolves — measured.

The joined `--target=<value>` form exists for the same reason: `--target -evil/main` cannot be told
from `--target` followed by a mistyped option, and guessing either way is wrong in one direction, so
the split form refuses an option-shaped value and names the spelling that works.

### 1.7 How the constraint is enforced in tests

`test/skills/smart-rebase.test.js` does not scan the script for dangerous-looking text — four rounds
proved that unclosable in both directions. It runs the script against a recording `git` and asserts
the **whole argv shape** of every call against a template list, one entry per call site the script
actually contains. A call the script does not make cannot match a template, whatever its tokens look
like. Slot semantics are per call site: the `check-ref-format` argument is the **unvalidated** value
under test and may be anything, while every other interpolated slot holds a ref that has already
been validated or built here, and so must refuse a leading `-`.

Two things this list does **not** establish, both of which earlier drafts of this section claimed.
It is not a proof that the script makes no other call — three reach-around forms (an absolute path,
an inline `alias` value, any non-`git` binary) are invisible to the recorder, and `SCRIPT_DIGEST` is
what covers those. And a template is a *shape*, not an identity: a different call with the same argv
shape matches the same entry. What the list closes is the space of shapes, which is what a deny-list
of tokens could not do. **`SCRIPT_DIGEST` does not close the file either** — earlier drafts said it
did, and that overstates what a digest can do. A digest detects *change*; it proves nothing about the
bytes it currently pins. The three reach-around forms above are invisible to the recorder both before
and after a digest bump, so what the digest actually buys is that no one can introduce one **without a
human reading the diff**. That is a review trigger, not a closure proof, and the distinction matters
precisely because a bumped digest looks like a passed check.

The `fetch` entry is not a slot list but a **whole-call predicate**, because its safety is a
relationship *between* arguments: the destination must live under the remote that same argv names.
A per-slot rule cannot see across slots, so `fetch … upstream +refs/heads/main:refs/remotes/origin/main`
would satisfy every slot individually while writing into a namespace the call never named.

The destination is **built from the remote this argv names and compared**, not matched with a
capture: a remote name may contain `/` (§ 1.4), so a `[^/]+` capture on the destination mis-splits a
legal remote and reports the fetch it was written to permit. The remote slot does **not** refuse a
leading `-`, and `--` is what earns that: the separator is asserted in the same predicate, so an
option-shaped remote is an operand by construction rather than by hope.

What it deliberately stopped asserting is that the source is `refs/heads/<destination tail>`. That
equality held for every identity mapping and was never a safety property — under a non-identity
refspec it reports the *correct* fetch as unauthorized and lets the wrong one through, because which
source is right is a question about configuration, not about argv shape. The predicate now bounds the
destination (confined under the remote this argv names) and requires the source to **name a single
ref** — the `+` force marker, then a non-empty token containing no `*` and no `:`. It does **not**
require a full ref, and demanding one was itself a regression: a **short** source is legal after the
`+`, because git resolves it on the remote, so `remote.origin.fetch = main:refs/remotes/origin/stable`
builds a call the script must be able to make (`test/skills/smart-rebase.test.js`, the fetch predicate
and its comment on short sources). A leading `-` is not refused there either, for the reason stated in
the same place: the token is a refspec beginning with `+`, so git's option parser never sees an
option-shaped argument. Which source is correct is asserted per case, against a fixture whose
configuration says so.

Its character class is `[^:*]` and deliberately no tighter. An earlier version also excluded `]` and
JavaScript's `\s`, and by § 1.1 those are legal ref bytes — so the control reported a legitimate
fetch of a legitimate branch as an unauthorized call. `:` and `*` are the two bytes that change what
a refspec *is*; everything else about the name is git's judgment, asked for in the script.

**A control scoped more narrowly than the class it guards reports one instance and passes.** The
placeholder scanner above landed reading Step 5 alone, went green, and left the bare slots in
Steps 2 and 6 untouched — the defect it was written for, in the same file, two sections away. It now
reads every shell block in the document, and its negative control carries one fixture per block that
has ever held a bare slot rather than the single one that prompted it.

**Quote state belongs to the command, not to the line.** The nested-quote scanner read each line
from a clean slate, so a template continued with a trailing backslash — or one whose quote simply had
not closed yet — had its second half read as unquoted, which is the permissive direction: it reports
nothing and passes. It also treated `\'` as a delimiter, inverting the state for the whole rest of a
command over a byte that is a literal apostrophe. Both are now handled, and both are checked against
the scanner directly with synthetic fixtures, because the document contains neither shape today and a
guard that only ever sees today's document is green by accident rather than by construction.

**Two scanners reading the same text with different rules is a seam, so there is now one walker.**
The placeholder scan and the nested-quote scan each re-implemented "where does a command slot sit,
and what is quoted here" — and drifted, which is how one learned line-continuations while the other
did not. Round 30 collapsed them into a single shell-aware `scanCommandSlots(text, visit)` that both
now call through thin wrappers, so the two can no longer disagree about the same byte. Unifying them
surfaced two holes neither had closed, each carrying its own direct control:

| Hole | Why it read wrong | Control |
|------|-------------------|---------|
| An unquoted `#` at a word boundary begins a shell comment | The rest of that line is not command text, so a slot after it is not a real slot — counting it reports a phantom | A `#`-comment fixture whose trailing text holds a slot-shaped token |
| Backslash escaping is context-sensitive | Outside quotes a `\` escapes the next byte; inside double quotes only `$ " \` and backtick are escaped, so `\<` is a literal backslash and the slot after it is still live — skipping the next byte unconditionally hid it | A `\<`-in-double-quotes fixture, plus a continuation whose next line *starts* with `git` |

Line-continuation state — a trailing `\` or an unclosed quote carrying into the next line even when
that line opens with `git` — is the walker's single source of truth, so the continuation controls
now exercise one code path rather than two that could drift again.

**A scan over slots cannot see a defect that has no slot.** Every guard here read `<…>` placeholders,
so Step 1's literal `[--target origin/main]` was invisible to all of them — not missed, *unreachable*.
The walker now also yields each complete command region (continuations joined, comment tails
removed), and a second check reads those regions for **`--target` and `--base` specifically** —
`bareRefOptionOperands()` matches that pair by name — requiring the joined `=<quoted …>` form. It is
not a general scan over "ref-valued options": a future option taking a ref is invisible to it until
its name is added, which is the same class of blindness this paragraph is about, one level up. The lesson generalizes past this file: a guard that reads only the markup can
only ever find defects in things somebody already marked up.

**Three controls in this file passed while guarding nothing, each for a different reason** — the
failure mode worth naming, because all three were green and none was load-bearing:

| Control | Why it proved nothing | Now |
|---------|----------------------|-----|
| `a refspec whose destination names a different branch` | Written in the pre-`--` argv order, so the predicate rejected it on *shape* long before reaching the destination | Rewritten production-shaped, exercising the one destination relationship argv can decide: the write lands under the remote the same argv names |
| The `--base` revival fixture | `String.replace` edits the **first** occurrence, and `--base=<quoted …>` appears earlier in *prose* than in any command — so the fixture broke a sentence the scanner never reads | Anchored to the script name, which occurs only in the command |
| The separator assertions | Named `git push` and `git merge-base` only, so Step 6's `git log --not` regressed with the guard green beside it | One assertion and one negative control per template |

**Where the allow-list stops is now stated rather than assumed.** `FETCH_CALL` bounds the destination
under the remote its own argv names and goes no further: which *branch* was asked for is not
recoverable from argv, and round 24 measured that demanding `source == destination tail` reports the
correct fetch as unauthorized under any non-identity refspec. So a sibling-ref write satisfies the
predicate by design, the per-case equality carries that property instead, and a mutant redirecting
the destination proves the equality has teeth. The predicate also stopped refusing a source whose
first byte is `-`: it had hard-coded the § 1.2 regression above, and the position cannot be reached
anyway — the token always begins with the `+` force marker, so git never sees an option there.

**The recording `git` must reproduce failure shapes, not just failure codes.** The shim used to exit
non-zero with no output where real git prints the unresolved name and exits 128 — under that shim
the § 1.4 stdout-versus-status bug passed its own new regression test. A fixture that is wrong in the
same direction as the code proves nothing.

The same rule governs what the shim *knows*: it answers `git config --get-regexp remote.*.fetch` with
the default refspec of every remote it reports, because a claimant scan tested against a repository
with no configured refspecs is a scan tested against nothing. And a fixture that blanks `git remote`
must blank the config too — `git remote remove` drops both, so blanking one describes a state git
cannot produce and lets a scan answer from a remote the repository no longer has.

The redesign these findings point at — stop modelling git's ref handling in three skills, ask git —
is **not** in this change. It was extracted on the `ARCHITECTURE` diagnosis (fixing A kept breaking
B, measured) and lives at `docs/features/ref-name-hardening/requests/2026-08-20-ref-name-hardening-r1.md`.
What § 1 records is the set of fixes made here — uncommitted, per the Provenance note at the top of
this file; that ticket is what remains.

### 1.8 Negative refspecs and short sources

`_claiming_remotes` in `smart-rebase-analyze.sh` answers one question offline: does some configured
refspec already claim the tracking ref the caller named? A wrong **no** is the expensive answer — it
falls through to a fabricated `refs/heads/<tail>` and refreshes the tracking ref from a ref the
repository never designated, silently.

Negative refspecs are where that answer went wrong twice. Measured 2026-08-22 (git 2.55.0) against a
bare remote holding a tag `tagx`, a branch `main` and a branch `stable`, with a single positive
mapping configured onto `refs/remotes/origin/stable`:

| Positive source | Negative | `origin/stable` after `git fetch origin` |
|---|---|---|
| `tagx` (resolves to `refs/tags/tagx`) | `^refs/tags/tagx` | not created — **cancelled** |
| `tagx` | `^refs/heads/tagx` | created from the tag — **claim stands** |
| `tagx` | `^tagx` | claim stands |
| `main` (resolves to `refs/heads/main`) | `^refs/heads/main` | not created — **cancelled** |
| `main` | `^refs/tags/main` | claim stands |
| `main` | `^main` | claim stands |

Two rules fall out, and only together do they describe git. A negative is **never DWIM-ed** — `^main`
excludes nothing — while a positive's short source **is** resolved, across the remote's whole
namespace, and only the negative spelled in the namespace it landed in cancels the mapping. Which
namespace that was is a fact about the remote, so nothing local can decide it.

Round 55 fixed the first rule by qualifying the short source to `refs/heads/<x>` before comparing.
That is right for a branch source and wrong for a tag source, and the wrong half is the expensive
one: it drops a claim git keeps and fabricates a source. Round 57 stopped guessing — a source not
already spelled `refs/...` is **not matched against negatives at all**, so an unmatched source means
*not provably excluded* rather than *matches nothing*. The claim stands, no source is fabricated, and
the cost is a refresh that may transfer nothing rather than a wrong write.

The other half of the round-55 fix bounds where that cost lands: the explicit `--target` refresh
carries the remote's configured negatives **on its own command line**, because a CLI refspec does not
inherit them (measured — the mapping fired anyway until the negative was passed explicitly). So git
applies its own matching at the point the write happens, and no ref is written from a source the
repository never designated.

**What that costs is not an error, and round 58 corrected this paragraph on that point.** An earlier
version claimed such a fetch "ends as a `fatal:` from git". Measured 2026-08-22 (git 2.55.0): a fetch
whose every positive refspec is cancelled by a negative on the same line exits **0**, prints nothing,
and leaves the tracking ref at exactly the value it already held. The failure mode is therefore the
silent one the whole section is about — a plan built from stale history, indistinguishable from a
correct plan — arriving through a success rather than a failure.

Making it loud needs a local observable, and `FETCH_HEAD` is it: git truncates the file at the start
of every fetch and writes one line per ref actually considered, so it is 0 bytes after an
all-excluded fetch and non-empty after a real update, an already-up-to-date ref, and an irrelevant
negative alike (66 bytes in all three of those cases). `git fetch --porcelain` cannot substitute —
"already up to date" and "excluded" both print nothing. `smart-rebase-analyze.sh` reads it through
`git rev-parse --git-path FETCH_HEAD`, which is worktree-correct, and aborts with the command to
re-run by hand; `test/skills/smart-rebase.test.js` pins both directions.
