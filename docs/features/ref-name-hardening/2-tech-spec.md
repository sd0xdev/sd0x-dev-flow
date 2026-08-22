# Ref-Name Hardening Technical Spec

> **Doc class**: Lifecycle — Phase 2 tech spec (per `@rules/docs-numbering.md`)
> **Created**: 2026-08-21
> **Status**: Design — the redesign is specified in direction and constraints; § 7 lists what is still open
> **Request**: [requests/2026-08-20-ref-name-hardening-r1.md](./requests/2026-08-20-ref-name-hardening-r1.md)
>
> **What this document is, and what it is not.** § 2 is **measured git behaviour** — the constraint
> surface any design must satisfy — moved here from the request ticket, where a work record was
> carrying a design argument (`skills/create-request/SKILL.md` § Write-Time Budget: past ~150 lines
> a ticket is doing a tech spec's job). § 3 is the design **direction**, which is decided; the
> per-call-site design is not, and is listed as an open question rather than written as though it
> were. It is deliberately **not** a copy of [`4-implementation.md`](./4-implementation.md) § 1:
> that file records measured git behaviour and current defects, this one states what replaces them.

## 1. Requirement Summary

- **Problem**: three skills put ref names into commands — `/smart-rebase` emits a `git rebase --onto`
  for the developer to paste, `/epic-merge` rebases and force-pushes each PR head, `/push-ci` pushes
  the current branch. **A ref name is an influenced input**, and not only when a human types one: it
  arrives from the remote. Measured 2026-08-20:

  | Name | `check-ref-format` | `update-ref` creates | `clone` carries it |
  | ---- | ------------------ | -------------------- | ------------------ |
  | `refs/heads/--all` | ✅ exit 0 | ✅ | ✅ as `origin/--all` |
  | `refs/heads/feat/x$(printf${IFS}PWNED>&2)` | ✅ exit 0 | ✅ | ✅ |

  Only the first row is refused by `git switch -C` / `git branch` (`fatal: '--all' is not a valid
  branch name`). The second is created by the most ordinary path there is —
  `git check-ref-format --branch 'feat/x$(printf${IFS}PWNED>&2)'` exits 0 (measured 2026-08-21).
  And after `git symbolic-ref HEAD refs/heads/--all`, `git rev-parse --abbrev-ref HEAD` returns
  `--all`, which is exactly how `skills/push-ci/SKILL.md` obtains `$BRANCH`.

- **Goal**: stop the skills from **modelling** how git handles ref names, and make them **ask git**.
- **Non-goal**: the `push-gate-optin` authorization contract (r1–r4). The two do not block each other.

## 2. Existing Behaviour Analysis (measured)

### 2.1 Where the modelling happens, and what it misses

Two independent readers each need an answer, and the rules have too many exceptions for a model to
stay complete:

| Reader | Where it is modelled | The fact the model misses |
| ------ | -------------------- | ------------------------- |
| shell | the name is substituted into a command template as text | double quotes do **not** stop `$( )`; the name is evaluated before any guard sees it |
| git's option parser | quoting is assumed to be enough | the shell consumes the quotes; `--all` still reaches git as an option |
| — | negative-refspec comparison normalizes the source itself | git DWIMs a **positive** source and does **not** DWIM a negative one |
| — | normalization always prepends `refs/heads/` | git resolves a short name **across namespaces** — a tag is a legal source too |
| — | a short branch name is used as the rebase operand | a short name can be ambiguous (`refs/heads/tags/x` vs `refs/tags/x`) |
| — | remote ownership is inferred from the path prefix | `remote.<name>.fetch` may write outside its own namespace |
| — | separators are assumed interchangeable | only `git log --not` actually differs — see § 2.2 |

### 2.2 Separators — measured, git 2.55.0 (read-only in this repo, re-measured 2026-08-20 round 16)

> **There is no general rule of the form "command X requires separator Y."** `push` / `fetch` /
> `merge-base` accept both spellings with identical results. Two different questions have to be
> kept apart: **(a) is this spelling accepted**, and **(b) does it give the operand semantics you
> wanted**. Only `git log --not` differs; `rev-parse` is useless either way; `check-ref-format`
> refuses both.

| Command | `--` | `--end-of-options` | Differs? |
| ------- | ---- | ------------------ | -------- |
| `git push --dry-run . main` | exit 0 | exit 0 | **No** — interchangeable |
| `git fetch --dry-run . main` | exit 0 | exit 0 | **No** |
| `git merge-base … main HEAD` | exit 0, same merge base | exit 0, same | **No** |
| `git log … --not <option-shaped>` | exit 0 — **ends revision parsing**, treats what follows as a pathspec | exit 128 — stays in revision position and **fails closed** | **Yes, and this is the only row** |
| `git rev-parse <sep> main` | exit 0, echoes `--` and `main` verbatim (two lines, neither a SHA) | exit 0, echoes `--end-of-options` **then the resolved SHA** (two lines) | **Neither yields exactly one SHA** — `--` does not resolve at all; `--end-of-options` does resolve but emits an extra separator line, so a direct capture takes a non-SHA value. The separator is not the fix here: use the fully-qualified `--verify --quiet "refs/heads/<name>"` form |
| `git check-ref-format --branch <sep> main` | exit 129 | exit 129 | **Both refuse** (even the legal name `main`) |
| `git rebase` | **measured** — in a writable scratch repo, `git rebase --onto main main -- 'tags/v0.0.1'` **exits 0 with the branch not rebased** | **not measured** | Unknown: the `--` failure comes from operand ambiguity, not from the separator. Comparing needs another scratch-repo run |
| `git switch -C` | no applicable form | no applicable form | git refuses option-shaped names outright; the skill never gets to handle them |

Reproduce: `git push --dry-run -- . main` versus `git push --dry-run --end-of-options . main`, and
likewise per row. **Do not write push/fetch/merge-base as "only `--` is accepted"** — rows 1–3
measured the two spellings as equivalent.

> **Evidence for the `git rev-parse` row** (git 2.55.0, read-only in this repo, 2026-08-21):
>
> ```text
> $ git rev-parse -- main
> --
> main                                    # two lines, both echoed verbatim, status 0
>
> $ git rev-parse --end-of-options main
> --end-of-options
> 2692ede5270384d8fe34b4961ac775ffb22188df   # separator + the genuinely resolved SHA, status 0
> ```
>
> So `--end-of-options` **does** resolve `main`; it just prints one line too many, which is why it
> is unfit for capturing a scalar SHA. The reason to use the fully-qualified `--verify --quiet`
> form is therefore "neither produces exactly one SHA", not "neither resolves".

### 2.3 Ambiguity is a warning, not an error

Measured (git 2.55.0, scratch repo holding both a branch and a tag named `dup`):
`git rev-parse --verify --quiet dup` **exits 0** and prints a sha — git treats the collision as a
`warning:` it recovers from. Any guard built on the exit status alone therefore **fails open on
exactly the case it exists for**, and any guard built on matching `is ambiguous` depends on a
string git marks for translation. The design consequence is § 3.2.

## 3. Technical Solution

### 3.1 Direction: ask git, do not model git

Resolve every question by asking git for the answer rather than reimplementing its rules:

| Question | Ask git this way |
| -------- | ---------------- |
| what does this short source actually point at? | `git ls-remote` |
| is this name ambiguous? | count refs across git's DWIM namespaces (§ 3.2) |
| would this refspec be excluded by configuration? | `git fetch --dry-run` — let git adjudicate |

And **bind a name to a variable once**, then use the variable — never substitute the text at each
site. Textual substitution is what makes the shell a second reader in the first place.

### 3.2 Ambiguity: count refs, never read messages or exit status

Both shortcuts are measured failures (§ 2.3), so the check counts refs across git's DWIM
resolution order:

```bash
n=0
for r in "refs/<name>" "refs/tags/<name>" "refs/heads/<name>" \
         "refs/remotes/<name>" "refs/remotes/<name>/HEAD"; do
  git show-ref --verify --quiet -- "$r" && n=$((n+1))
done
[ "$n" -le 1 ] || echo "⛔ short name matches $n refs"
```

**`show-ref --verify`, not `for-each-ref <pattern>`, and the difference is a measured false
refusal** — this spec proposed the pattern form until 2026-08-21 and the implementations rejected
it. `for-each-ref`'s argument is a **prefix matched at a path boundary**, so the pattern
`refs/codex` matches `refs/codex/turn-diffs/…`; a repository carrying any custom ref namespace under
`refs/<something>/` — **this one does** — then counts an unrelated subtree as a second hit and
refuses an ordinary branch named `codex`. Measured here: `git for-each-ref refs/codex` prints the
subtree while `git show-ref --verify refs/codex` fails, so the pattern count is 2 and the exact
count is 1. The worked table is `skills/smart-rebase/SKILL.md` § Step 5.

**Why correcting the snippet is legitimate in a Design record.** This file is a Design record —
`node scripts/classify-docs-cli.js --feature ref-name-hardening` reports `role: "Design record"`,
and only `4-implementation.md` is `current_authority`. A record is not rewritten to mirror today's
code; that is not what happened here. The pattern form was never built: it was a proposal in a spec
written the same day as the implementation that rejected it, so replacing it is remedy 1 (prune what
describes a design that was never built, `@rules/docs-numbering.md` § Size Limit), not a
re-statement of history. What the record must keep — *that the pattern form was proposed and why it
was refused* — is stated above rather than deleted. An earlier version of this paragraph claimed the
file was current authority; that was wrong, and the correction changes the justification without
changing what the section now says.

The snippet uses a generic `<name>` placeholder; the **shipped** forms are
`skills/smart-rebase/SKILL.md` § Step 5 (on the rebase operand) and `smart-rebase-analyze.sh`
Mode 1 (on `--base`, before the cut point is resolved), both landed 2026-08-21, and those files are
authoritative if any of the three ever diverge.

**One counting primitive and one namespace list — but deliberately different acceptance rules**, and
conflating the two is how a later maintainer "synchronises" one site into breaking the other. What
is shared: `show-ref --verify --quiet --` over the same five namespaces. What differs, because the
operands have different domains:

| | Step 5 (rebase operand) | Mode 1 (`--base`) |
|---|---|---|
| Domain | must be a branch | any commit-ish: a ref, `HEAD~3`, `:/.`, a raw commit id |
| Zero exact refs | **refused** — a branch that does not exist | **allowed** — this is what a revision expression looks like, and it is the exemption § 1.1 of `4-implementation.md` protects |
| Two or more | refused | refused |
| Extra checks | short-name OID equals the branch's, and `--symbolic-full-name` returns exactly `refs/heads/$branch` | on an exact-ref match only: `--symbolic-full-name` must print something |

The namespace list is the part that must never diverge: it is git's DWIM order, and a form omitting
one of the five silently permits the collision it lives in. The acceptance rules must **not** be
unified — making `--base` demand exactly one ref would refuse `HEAD~3`, and letting Step 5 accept
zero would hand `git rebase` a branch name that denotes nothing.

Both are a **guard on the operand**, not the redesign: they stop a bad command being handed over
and a wrong cut point being computed; they do not make the analyzer resolve refs through git.

### 3.3 Mitigations already in the working tree (not the redesign)

| Site | What landed | What is still open |
| ---- | ----------- | ------------------ |
| `skills/epic-merge/SKILL.md` § Phase 0 | Validation gate — abort before any write when a PR head starts with `-` | The ref is still not git-mediated; § Names in commands' "not yet closed" paragraph stands |
| `skills/smart-rebase/SKILL.md` § Step 1 | Refuse to run the analyzer against a remote with a configured negative refspec | The analyzer still builds its own refspec |
| `skills/smart-rebase/SKILL.md` § Step 5 | The § 3.2 ambiguity count | The operand still originates from the analyzer's own normalization |
| `smart-rebase-analyze.sh` Mode 1 | The same count on `--base`, before the cut point is resolved (finding 9 of r1) | `--base` is still resolved by a bare `rev-parse` afterwards; the check bounds *which names* reach it, not *how* they are resolved |

Each turns an opaque failure into an early, explained one. **None of them is the redesign**, and
recording them as such is the specific misreading this table exists to prevent.

## 4. Risks and Dependencies

| Risk | Mitigation |
| ---- | ---------- |
| Asking git costs round-trips (`ls-remote`, `fetch --dry-run`) | Ask once per name, bind, reuse — the same discipline that removes textual substitution |
| `fetch --dry-run` still contacts the remote | It is the only adjudicator that honours the operator's configured exclusions; a local model is what got this wrong |
| The redesign changes the analyzer's output contract | `test/skills/smart-rebase.test.js` and the `SCRIPT_DIGEST` pin both re-open on any edit, by design |

## 5. Work Breakdown

| # | Item | Size |
| - | ---- | ---- |
| 1 | Short-source resolution via `git ls-remote`; drop the local normalization | M |
| 2 | Refspec exclusion via `fetch --dry-run`; drop the negative-refspec comparison | M |
| 3 | Ambiguity handling moved from the § 3.2 guard into the analyzer's resolution | S |
| 4 | `epic-merge` findings 7–8 redesign layer; then remove its "not yet closed" paragraph | M |
| 5 | Doc-scanner negative controls that run a real safety predicate | S |
| 6 | Bring `test/skills/smart-rebase.test.js` under version control | S |

## 6. Testing Strategy

Per `@rules/testing.md`. Two properties this feature's tests must have, because both have already
failed here once:

- **Negative controls must execute a safety predicate**, not merely assert that a string changed.
  A guard asserting only "the text is different" is green the day it lands and silent afterwards.
- **Ambiguity cases need a scratch repo**, since the failure only appears when a branch and a tag
  share a name. Restore the repo on signals, and assert the mutation actually applied — an
  unapplied setup looks exactly like a passing guard.

## 7. Open Questions

1. **Where does resolution belong** — inside `smart-rebase-analyze.sh`, or in a shared helper the
   three skills call? A shared helper is the obvious answer and the reason it is still open: it
   would give `/epic-merge` and `/push-ci` a dependency they do not have today.
2. **`git rebase` with `--end-of-options`** is unmeasured (§ 2.2 last-but-one row). Needed before
   any claim that the separator choice is settled for rebase.
3. **Finding 3's rejection half** — that the script rejects a legal cross-namespace mapping — is
   still unverified against a configured remote (r1 § 待複驗).
