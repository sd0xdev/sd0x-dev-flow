# Stacked PR Mode (`--stack`)

Detail reference for `/create-pr --stack`. Design source: `docs/features/create-pr-stacked/2-tech-spec/2-tech-spec.md`.

## Authorization Boundary ⚠️

This mode **never executes `git push`, `git rebase`, or any `gh stack` subcommand.** Only `gh pr create` / `gh pr edit` run under `--execute`, which is the skill's pre-existing authorization (Step 5a, Steps 6-7). Everything that mutates branches is either delegated to `/push-ci` or emitted as a command for the user to run.

| Operation | Executor | Authorization |
|-----------|----------|---------------|
| `gh pr create` / `gh pr edit` | this skill under `--execute` | existing create-pr contract |
| `git push` (per layer, non-force) | `/push-ci`, or user runs the emitted command | `@rules/git-workflow.md` exception |
| `gh stack init/add/submit/rebase/push/modify` | **user only** — this skill prints, never runs | out of Claude's execution scope |

## Input

```
/create-pr --stack <branch...>     # explicit chain, bottom layer first; dry-run default
/create-pr --stack                 # auto-detect from authoritative sources only
/create-pr --stack --execute       # per-layer gh pr create/edit (AskUserQuestion first)
/create-pr --stack --update        # refresh title/body of an existing stack, layer by layer
```

| Flag interaction | Behavior |
|------------------|----------|
| `--base` | applies to the **bottom layer only**, resolved exactly as in normal mode: `--base` → `{TARGET_BRANCH}` → `main`. Never hard-code `main` — a repo configured for `develop` would get the wrong base |
| `--title` | **rejected** in stack mode — each layer generates its own title |
| `--head` | mutually exclusive with `--stack` |
| `--update` | **all-existing precondition**: every layer must already have an OPEN PR. If any layer is absent, abort before Phase C — `--update` must never create. (Plain re-entry without `--update` keeps the auto-detected update/create routing.) |

## Chain Model

All values are read **after `git fetch --prune origin`** and resolve against remote refs. `--prune` matters: a deleted upstream branch otherwise leaves a stale `origin/<head>` that reads as current state.

```
chain := [ layer_1, ..., layer_N ]      # bottom first
layer := {
  head, base,                            # base: resolved target branch for layer_1, else layer_{i-1}.head
  local_oid, remote_oid, sync,           # sync ∈ NO_SUCH_BRANCH|ABSENT|IN_SYNC|LOCAL_AHEAD|REMOTE_AHEAD|DIVERGED
  pr:      { number, baseRefName, state } | null,
  commits: count of origin/<base>..origin/<head>
}
```

## Phase A — Sync Classification (runs first)

Phase A precedes chain validation because every later step reads remote refs: if `origin/<head>` does not exist, ancestry and commit-range commands cannot run at all.

**Emit this line in the turn that runs the fetch**, before the fence — `rules/git-workflow.md` lists `status | diff | log | branch | rev-parse` as allowed and `git fetch` is in neither that list nor the forbidden one, which makes it a Default-tier deviation, and a deviation is declared per run, not once during development:

```
[DEVIATION] rule=rules/git-workflow.md § allowed ops default=fetch is not in the allowed list chosen=git fetch --prune origin
reason=sync classification compares local against origin/<head>; without the fetch every verdict is computed from stale remote-tracking refs signal=fetch is absent from the forbidden closed set (add|commit|push|stash|reset --hard|rebase) and writes only remote-tracking refs — no working tree, no history
```

Shown for the layer `feat/auth-service`, with every dynamic value already single-quote rendered per SKILL.md § Command Rendering:

```bash
(
  git fetch --prune origin || exit "$?"
  echo 'local:'
  git rev-parse --verify --quiet 'refs/heads/feat/auth-service' || [ "$?" = 1 ] || exit 2
  echo 'remote:'
  git rev-parse --verify --quiet 'refs/remotes/origin/feat/auth-service' || [ "$?" = 1 ] || exit 2
  echo 'end:'
)
```

Three properties, each of which the obvious shorter form gets wrong.

**Every failure exits explicitly; there is no `set -e` here, and that is the point.** "Fail closed if the fetch errors" is not something a comment can enforce: with a bare command list, a failed `git fetch` is followed by probes that read *stale* remote-tracking refs, and the fence exits 0 — Phase B then plans PRs from a topology that no longer exists. `set -e` inside the subshell looks like the fix and cannot be one: **errexit is disabled for a command whose status the caller tests, and that context is inherited into the subshell** — POSIX behaviour, not one shell's quirk. `f || true` around `( set -e; false; echo REACHED )` prints `REACHED` and exits 0 in `bash`, `sh`, `zsh` and `dash` alike. Measured with the shipped fence and an unreachable remote, in `bash`, `sh` and `zsh`: invoked directly the `set -e` form does abort (128, no `end:`), but under a status-tested caller it prints both stale OIDs and `end:` and hands back **0** — in every one of them. A fence cannot control whether its caller tests its status, so the `set -e` form is guarded only by luck; with `|| exit "$?"` it exits 128 with no probe output in both calling contexts. So the guard is the explicit exit — for the reason § Shell Safety rule 4 gives for its own capture-and-re-raise shape, that a caller controls `errexit` and a fence may not depend on it. Rule 4 states a cleanup contract, which this fence has no part of; what carries across is the rationale, not the shape. The subshell is here to keep the aborts off an interactive caller, not to carry the policy.

**Each probe is guarded, because absence is an expected answer.** `--quiet` makes `rev-parse` exit 1 for a ref that does not exist, and `NO_SUCH_BRANCH`, `ABSENT` and the remote-only case are all states this table must be able to reach. Were the probe written as `git rev-parse … || exit "$?"` — the shape the fetch above uses — it would exit on the first missing ref and every layer would look absent for the wrong reason. `|| [ "$?" = 1 ] || exit 2` accepts exactly the "not found" status; anything else — 128 for "not a repository" — exits, and `end:` is then absent from the output, which is how the reader tells an aborted classification from a complete one. The trailing `|| exit 2` is what makes that true rather than stated: without it the `[` merely evaluates false and, in any shell that is not applying `errexit` here, the next probe runs anyway.

**The labels are not decoration.** `--quiet` prints nothing for a missing ref, so two bare probes emit one unlabelled OID in *both* the `ABSENT` (local only) and remote-only cases — states whose dispositions are opposites: `ABSENT` stops before PR planning, remote-only continues. The `local:` / `remote:` / `end:` markers delimit each probe's output region, so an empty region means "this ref does not exist" and every one of the four combinations reads unambiguously.

**No `--` here, and that is not an oversight.** `git rev-parse` does not treat `--` as an option terminator — it is the rev/path separator, so everything after it is parsed as a *path*, no revision is left for `--verify`, and the command exits 1 for a ref that exists. Verify locally: `git rev-parse --verify --quiet -- HEAD` returns 1 in any repository. With the `--` in place every layer classifies as `NO_SUCH_BRANCH`, and since the probe's guard accepts exit 1 as "not found", Phase A reports a chain of branches that all exist as absent — a wrong classification rather than an abort, which is the worse of the two failures. The option-terminator rule in SKILL.md § Command Rendering is conditioned on "wherever the CLI accepts it"; `git rev-parse` is the case that does not, and the fully-qualified `refs/heads/…` operand needs no terminator because it cannot begin with `-`.

Fully-qualified refs only — a bare `<head>` can resolve to a tag or another ref and silently classify the wrong object. **Single quotes, not double**: `"refs/heads/$BRANCH"` still performs command substitution, so a branch legitimately named `feat/$(id)` executes `id` before `git` runs. If fetch or ref resolution errors, **fail closed**: report and stop, never treat an error as "absent".

Equality alone cannot separate the three unequal states; that needs ancestry in **both** directions. When both refs exist and the OIDs differ, run this second fence — the two booleans in the table below are its output, not something the reader is expected to derive:

```bash
(
  echo 'local-is-ancestor-of-remote:'
  set -- 0
  git merge-base --is-ancestor 'refs/heads/feat/auth-service' 'refs/remotes/origin/feat/auth-service' || set -- "$?"
  [ "$1" = 0 ] || [ "$1" = 1 ] || exit 2
  echo "$1"
  echo 'remote-is-ancestor-of-local:'
  set -- 0
  git merge-base --is-ancestor 'refs/remotes/origin/feat/auth-service' 'refs/heads/feat/auth-service' || set -- "$?"
  [ "$1" = 0 ] || [ "$1" = 1 ] || exit 2
  echo "$1"
  echo 'end:'
)
```

It prints the **raw status**, not a word, because that is what carries the third case: `--is-ancestor` answers "yes" with 0 and "no" with **1**, and anything else — 128 for a bad object or a directory that is not a repository — is a failure. Reading the table with only yes/no would collapse 128 into "no" and classify a broken repository as `DIVERGED`. So: `0` → yes, `1` → no, **any other value aborts the classification** — and the `[ "$1" = 0 ] || [ "$1" = 1 ] || exit 2` line is what makes that happen rather than merely stating it. Without the trailing `exit`, the fence is fail-open in the most misleading way available: the status is captured, printed, followed by `end:`, and the fence exits **0** — every executable completion signal says the classification succeeded. `set -e` cannot be what saves it, for the reason given above the first fence: `||` suppresses it where it applies at all, and a status-tested caller disables it inside the subshell in every POSIX shell. Measured under `bash`, `sh` and `zsh`: with a ref pointing at a missing object the unguarded form printed `128`, `128`, `end:` and exited 0; with the explicit exit it exits 2 and `end:` never appears. The `set -- 0` / `set -- "$?"` idiom is the canonical block's, for the same reason it exists there — a status must survive to the next command, and `$?` does not.

| local_oid | remote_oid | `is-ancestor local remote` | `is-ancestor remote local` | sync |
|-----------|-----------|---------------------------|---------------------------|------|
| absent | absent | — | — | `NO_SUCH_BRANCH` — chain input error, abort (not push remediation) |
| present | absent | — | — | `ABSENT` — never pushed |
| absent | present | — | — | `IN_SYNC` (remote-only: the fetched remote OID is authoritative) |
| equal | equal | — | — | `IN_SYNC` |
| ≠ | ≠ | no | yes | `LOCAL_AHEAD` (remote is an ancestor of local) |
| ≠ | ≠ | yes | no | `REMOTE_AHEAD` |
| ≠ | ≠ | no | no | `DIVERGED` |

| sync | dry-run | `--execute` |
|------|---------|-------------|
| `IN_SYNC` | continue | continue |
| `LOCAL_AHEAD` | continue **with warning** (content comes from the remote snapshot and may be stale) | **refuse** |
| `ABSENT` | **stop before PR planning**, emit push remediation | **refuse** |
| `REMOTE_AHEAD` / `DIVERGED` | abort that layer — user resolves via fetch/rebase | **refuse** |
| `NO_SUCH_BRANCH` | abort — the branch does not exist anywhere; pushing cannot fix a typo | **refuse** |

`git ls-remote` proves only that a remote branch exists, never that it matches local — which is why OID comparison replaces it here.

**Push remediation output** (two paths, user picks):

1. Per-branch `/push-ci` (existing contract; requires checking out each branch)
2. A copy-pasteable command: `git push origin -- 'b1' 'b2' 'b3'`

Then re-run `/create-pr --stack` — the flow is re-entrant.

## Phase B — Chain Validation

Runs only once every required remote ref is present.

| Check | Command | On failure |
|-------|---------|-----------|
| **Every layer** sits on its own declared base — including the bottom one on the target branch | `git merge-base --is-ancestor 'refs/remotes/origin/<base>' 'refs/remotes/origin/<head>'` for each layer | abort: layer does not descend from its base |
| Linear ancestry between adjacent layers | `git merge-base --is-ancestor 'refs/remotes/origin/<lower>' 'refs/remotes/origin/<upper>'` | abort: stack supports linear dependencies only |
| Layer has unique commits | `git log 'refs/remotes/origin/<base>..refs/remotes/origin/<head>'` non-empty | abort: empty layer is meaningless |
| Existing-PR policy | `gh pr list --head '<head>' --state all --limit 100 --json number,baseRefName,state` | abort listing the conflict |
| Layer count | see table below | per row |

The ancestry check is a real topology test — comparing declared list order against itself would prove nothing. The **bottom layer's** check is not optional: a non-empty `git log base..head` does not prove descent, so a layer 1 that diverged from the target branch (with layers 2–3 correctly stacked on it) would otherwise pass.

`--limit 100` is not decoration: `gh pr list` defaults to 30, and the policy below rejects *any* conflicting match — so a reused branch whose conflicting PR falls outside the first page would otherwise be classified as absent, or as uniquely valid, and the chain would be built on a false premise. If a head branch legitimately has more than 100 PRs, that is itself the conflict the policy exists to catch.

**Existing-PR policy (single policy)**: every layer must be either **OPEN with `baseRefName` equal to the chain's declared base**, or **absent**. Multiple matches, `CLOSED`, `MERGED`, or a base mismatch all abort and require manual resolution. `gh pr list` defaults to open-only, so `--state all` is mandatory — without it a closed or wrong-base PR is invisible and the layer looks free.

| Layer count | Behavior |
|-------------|----------|
| empty, no arguments | enter auto-detection |
| empty, explicit arguments | error |
| 1 | abort — suggest plain `/create-pr` |
| 2–5 | normal |
| > 5 | warn, continue |

**The walk starts at the current branch**, resolved with `git rev-parse --abbrev-ref HEAD` — that branch becomes the chain's **top** layer and the walk descends from it. Saying only "walk back to the target branch" names a destination and no origin, which in a repo with several open chained PRs leaves no deterministic chain to walk. `--head` is rejected in stack mode precisely because this is the one resolution: a stack has one top, and it is where you are standing. If HEAD is detached or on the target branch itself, there is no chain to detect — require an explicit one.

**Auto-detection accepts authoritative sources only**: existing PR base relations, or native stack metadata when available, walked back to **the resolved target branch** — the same `--base` → `{TARGET_BRANCH}` → `main` resolution the bottom layer uses, computed *before* the walk. Never walk to literal `main`: in a repo configured for `develop`, terminating on `main` validates the chain against a branch it was never meant to target. A git branch does not record its intended base, so with neither source present, require an explicit chain — ambiguity STOPs rather than guesses.

A dirty working tree **warns but never blocks**: every v1 mutation is a remote `gh pr` operation and all content derives from fetched remote refs.

## Shell Safety (both display and execution)

Git accepts branch names containing shell metacharacters — `;`, `$( )`, `&`, and quotes all pass `git check-ref-format --branch` (a leading `-` is rejected by that check, but CLI arguments still need `--` so an option-like value is never parsed as a flag).

The contract is SKILL.md § Command Rendering; it applies unchanged here, and every template in this file is shown already rendered. The four rules that bite hardest in stack mode:

1. **Displayed commands**: every dynamic value (branch, base, title) is single-quote rendered — `'` becomes `'\''`. Double quotes are not equivalent: `"refs/heads/$BRANCH"` still runs a `$( )` embedded in the branch name. Use `--` as the option terminator where the CLI accepts it.
2. **Body text never enters shell syntax**: no heredoc, in any form. A body line equal to the delimiter closes the heredoc early and the remainder is parsed as shell input, and a fixed "random-looking" delimiter is no safer than `EOF` — fixed is fixed. Write each body to a file out of band and pass `--body-file '<path>'`.
3. **Commands this skill executes** are passed as argument arrays, never interpolated into a shell string.
4. **Cleanup survives the caller's shell state**: every `gh` invocation here runs inside the canonical cleanup block SKILL.md § Command Rendering defines. Dry-run substitutes the whole `&&` chain for that block's single operation; execute mode substitutes one layer's operation and that layer's own body file as the cleanup operand. Nothing else about the shape changes. Three caller states are why the shape is what it is, and a stack meets all three: `set -e` (an unguarded command aborts before cleanup, and in a chain only the *final* layer is exposed, since `&&` makes the others non-fatal), a `readonly` or pre-existing status variable of the same name (the caller's, not yours), and an `IFS` containing a status digit (a bare expansion is field-split and the status is lost). Leaving the directory behind leaks a private PR body; reporting the wrong status hides a failed layer.

A stack multiplies the exposure: N layers means N renderings of branch names the user chose, so one unrendered value is enough to run `git push` or `gh stack` under a mode whose entire contract is that it never does.

## Phase C — Per-Layer PR create/edit (re-entrant)

Bottom to top. Each layer routes on the `pr` field resolved in Phase B: present (OPEN, base matches) → update via Step 5a smart diff; absent → create. **Under `--update` this routing does not apply**: that flag asserts every layer already has a PR, and Phase B aborts before reaching here if any layer is absent — `--update` never creates. Title and body come from Steps 2-4 plus Step 4b sanitization; `--execute` additionally runs Step 7b post-creation verify per layer.

### Per-layer commands

Worked example — a three-layer chain on a repo whose resolved target branch is `develop`:

```
develop ← feat/auth-schema ← feat/auth-service ← feat/auth-api
```

Each layer's `--base` is the layer below it; only the bottom layer's base is the resolved target branch.

**Bodies are never embedded in shell syntax.** Each layer's body is written to its own file first — by the Write tool when the skill runs, or by the user's editor when they copy-paste — and the command only names that file. This is what removes the heredoc-delimiter class of injection entirely: with no delimiter, no body line can collide with one. Paths follow SKILL.md § Command Rendering: one `mktemp -d` directory per run — allocated, never invented — one file per layer, never under `.git/`. `<PR_BODY_DIR>` marks the literal path `mktemp -d` printed. Layer 2's body, for example:

```markdown
<layer 2 generated body>

Stacked on `feat/auth-schema`
```

Dry-run then emits one command per layer, bottom to top. Here layers 1 and 2 have no PR yet and layer 3 already has #118.

**In dry-run the skill runs no mutating `gh` command and leaves nothing on disk.** Read-only queries are exactly what dry-run is made of: Phase B needs `gh pr list` to route each layer and Phase D needs `gh extension list` to choose which sequence to print, so a literal "no `gh` at all" would describe a mode that cannot produce its own report. `gh pr create` and `gh pr edit` are the ones that never run. What it does do is allocate, write and sanitize (SKILL.md § 4b): sanitization operates on files, and dry-run's whole output is a body a user may copy into a real `gh` invocation, so a preview that skipped it would be the one path by which an AI trailer reaches a PR. The distinction is durability, not activity — dry-run tears its directory down with the teardown fence before delivering the report, so no private PR body survives a preview, whereas leaving it for the user to clean would depend on a command they may well decide not to run. Step 3 below is the user's to perform, if and when they choose to run the chain; under `--execute` the skill performs all three itself, per layer, and owns the teardown (§ Phase C).

```bash
# Step 1 — allocate once per run. This fence holds nothing else; substitute the
# literal path it prints wherever <PR_BODY_DIR> appears below.
mktemp -d
```

Step 2 is out of band and is not shell: write all three bodies into that directory — `pr-body-1.md`, `pr-body-2.md`, `pr-body-3.md` — with the Write tool (or any editor). Dry-run can render them **all up front** because no marker in it depends on a number that does not exist yet — that is the one property execute mode does not have.

**Titles are files too, one per layer.** Phase C reuses SKILL.md § 4b unchanged, and its `title` mode takes a *file*: each layer's title is written as `pr-title-<N>.txt` alongside its body and sanitized before that layer's command is emitted. Single-PR mode names it `pr-title.txt` because it has exactly one; a stack has one per layer, and reusing a single name would make the surviving file the last layer's rather than the failing layer's — the same reason the bodies are numbered. A layer whose title fails twice stops the run at that layer (SKILL.md § 4b step 3), before any `gh` command for it is emitted.

```bash
# Step 3 — bottom to top, inside a subshell whose positional parameters hold the
# status; see SKILL.md § Command Rendering for why it is not a named variable.
# `&&` stops the chain at the first failure, so a failed layer 2 never lets
# layer 3 run; the trailing `|| set -- "$?"` captures the outcome and keeps a
# caller's `set -e` from exiting before cleanup.
(
  set -- 0
  gh pr create --head 'feat/auth-schema' --base 'develop' \
    --title 'feat: [PROJ-42] Add auth schema' --body-file '<PR_BODY_DIR>/pr-body-1.md' && \
  gh pr create --head 'feat/auth-service' --base 'feat/auth-schema' \
    --title 'feat: [PROJ-42] Add auth service' --body-file '<PR_BODY_DIR>/pr-body-2.md' && \
  gh pr edit 118 \
    --title 'feat: [PROJ-42] Add auth API' --body-file '<PR_BODY_DIR>/pr-body-3.md' || set -- "$?"

  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

| Layer | Head → base | Command | Lower PR known? | Marker in its body |
|-------|-------------|---------|-----------------|--------------------|
| 1/3 | `feat/auth-schema` → `develop` | create | — (bottom layer) | none |
| 2/3 | `feat/auth-service` → `feat/auth-schema` | create | no — layer 1 has no PR in dry-run | ``Stacked on `feat/auth-schema` `` |
| 3/3 | `feat/auth-api` → `feat/auth-service` | edit #118 | no — layer 2 has no PR in dry-run | ``Stacked on `feat/auth-service` `` |

**Execute mode is not one chain — it is one guarded block per layer.** Layer N+1's body must carry layer N's *number*, and that number does not exist until layer N's `gh pr create` has already returned. A single `gh … && gh … && gh …` list offers no point at which control comes back to write the next body, so rendering all three up front and running them as one chain can only publish stale branch markers. The chain shape belongs to dry-run, which has no such dependency.

Two consequences follow, and both are easy to get wrong:

1. **`gh pr create` prints the PR *URL*, not its number** (`gh pr create --help`: "Upon success, the URL of the created pull request will be printed"). The number is read back explicitly rather than scraped from the URL:

   ```bash
   gh pr view 'feat/auth-schema' --json number --jq '.number'
   ```

2. **Cleanup is per layer, then once for the directory.** Each layer's guarded block removes only *its own* body file — that layer's private content is gone as soon as it is published or fails — and the run directory itself is removed after the sequence ends, on the success path and the failure path alike.

Per layer, bottom to top, for layer 1 of the worked example:

```bash
# Layer 1/3 — the canonical block of SKILL.md § Command Rendering with this
# layer's single operation, and this layer's own file as the cleanup operand.
(
  set -- 0
  gh pr create --head 'feat/auth-schema' --base 'develop' \
    --title 'feat: [PROJ-42] Add auth schema' --body-file '<PR_BODY_DIR>/pr-body-1.md' || set -- "$?"
  rm -rf -- '<PR_BODY_DIR>/pr-body-1.md' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

Then, and only then: read layer 1's number, run Step 7b for layer 1, render layer 2's body with `Stacked on #116`, write it out of band, and run layer 2's block. After the last layer — or immediately after any layer fails — remove the directory:

```bash
(
  set -- '<PRIOR_STATUS>'
  case "$1" in ''|*[!0-9]*) set -- 2 ;; esac
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

**Teardown is a fence of its own, and it carries the failing layer's status.** Both properties are load-bearing. A layer block that fails exits non-zero, so anything *chained after it* under a caller's `set -e` would never run — the directory would survive exactly on the path where cleanup matters most. A separate fence is not chained to anything: it is dispatched unconditionally after the sequence ends, however it ended. And `<PRIOR_STATUS>` — the status of the layer that just ran, `0` when every layer succeeded — is substituted as a literal so the run reports *that* status, not `rm`'s. Without it a successful teardown would report `0` over a failed layer, which is the same masking the per-layer blocks are guarded against, moved up one level.

| Layer | Lower PR known when its body is written? | Marker in its body |
|-------|------------------------------------------|--------------------|
| 1/3 | — (bottom layer) | none |
| 2/3 | yes — layer 1 created, then read back as #116 | `Stacked on #116` |
| 3/3 | yes — layer 2 created, then read back as #117 | `Stacked on #117` |

A dry-run marker is never carried into execute mode unchanged: that is what would publish a branch marker where a number was available. Equally, dry-run never invents a number for a PR that does not exist yet.

| Layer state | Command | Base argument |
|-------------|---------|---------------|
| no PR (Phase B found none) | `gh pr create --head '<head>' --base '<base>'` | the layer below, or the resolved target for layer 1 |
| PR exists, OPEN, base matches | `gh pr edit <number>` via Step 5a smart diff — title and body only | **not resent** |
| PR exists, any other state | Phase B already aborted | — |

**The edit does not carry `--base`, and that is a safety property rather than an omission.** Phase B admits a layer only when its PR is already OPEN *on the declared base*; any mismatch aborts. So `--base` on an edit can never change the base to something it is not already — its only reachable effect is on the case Phase B did not see: a base someone retargeted manually between validation and execution. Resending it there silently reverts a deliberate human change, and Step 5a's smart diff exists precisely so an unchanged field is not transmitted. Setting the base is `gh pr create`'s job; for an existing PR the base is an invariant this mode checks, not a field it writes.

Each layer gets its **own** file — `pr-body-1.md`, `pr-body-2.md`, `pr-body-3.md` — because execute mode re-renders bodies as PR numbers become known, and a shared filename would let one layer overwrite another's content. Cleanup runs on success and on failure, but never *masks* the failure, and it must not depend on the caller's shell state — the canonical cleanup block in SKILL.md § Command Rendering is the definition, and `--execute` follows it unchanged rather than re-deriving one. Capture, clean, re-raise.

`--execute` runs these blocks after one AskUserQuestion confirmation covering the whole chain — the confirmation is per run, the execution is per layer: write body → guarded block → read the number back → Step 7b → next layer. A layer that fails ends the sequence there; the layers below it stay created, which is exactly what makes a re-run re-entrant (Phase B finds them and routes to `edit`). Dry-run prints its chain and runs no mutating `gh` call (`gh pr create` / `gh pr edit`) — the read-only ones it does run are named in § Phase B (`gh pr list`) and § Phase D (`gh extension list`). It still allocates, writes and sanitizes per § Phase C above, then tears the directory down before delivering the report. Neither mode ever emits `git push`, `git rebase`, or `gh stack` as something this skill runs.

**Dependency marker** — the rule is: use `#<N>` whenever the number is known, a branch marker only when it is not. Never emit an unresolved placeholder.

| Situation | Marker in body |
|-----------|----------------|
| dry-run, lower PR already exists | ``Stacked on #<N>`` |
| dry-run, lower PR absent | ``Stacked on `<lower head branch>` `` |
| `--execute` (bottom-up, lower number known by then) | ``Stacked on #<N>`` |
| `--stack --update` | upgrade any leftover branch marker to `#<N>` |

**Fail-fast, no atomicity**: per-layer mutations are independent, so partial success is a real outcome. On failure, stop before the next layer and report every layer as succeeded / failed / pending. Re-running detects already-created layers in Phase B and routes them to update mode, so nothing is created twice.

### Stack status table (terminal output, both modes)

Every run ends with one table — dry-run and `--execute` alike, success and partial failure alike. It is the run's report, so a run that stopped early still prints it for **every declared layer**, not only the ones it reached:

| Column | Value |
|--------|-------|
| `#` | Layer position, 1 = bottom |
| `Head` | The layer's branch |
| `Base` | The layer below it; the resolved target branch for layer 1 |
| `PR` | `#<number>` once known, `—` when none exists yet |
| `Commits` | Unique commit count from Phase B's `refs/remotes/origin/<base>..refs/remotes/origin/<head>` |
| `Sync` | Phase A's classification verbatim (`IN_SYNC` / `LOCAL_AHEAD` / `ABSENT` / `NO_SUCH_BRANCH` / `REMOTE_AHEAD` / `DIVERGED`) |
| `State` | `created` / `updated` / `unchanged` / `pending` / `failed` — in dry-run every actionable layer is `pending`, because dry-run performs no mutation |

The `Sync` column carries Phase A's raw class rather than a yes/no, for the same reason the ancestry fence prints a raw status: `DIVERGED` and `REMOTE_AHEAD` need different remedies, and collapsing them into "not ready" hides which one applies.

## Phase D — Environment Detection and Native Comparison

```bash
gh extension list        # match the github/gh-stack identity, not a loose "stack" substring
```

| Extension | Rollout | Behavior |
|-----------|---------|----------|
| available | **confirmed** covered | dry-run additionally prints the equivalent `gh stack init/add/submit` sequence for the user to run |
| available | unknown (no confirmed signal — the current state, tech spec §7 Q2) | take the **conservative non-native path**; may mention that `gh-stack` is installed but must not present the native sequence as known-working |
| missing | any | emit the message below verbatim, then fall back to the existing Multi-PR behavior with mode-appropriate dependency markers |

Missing-extension output — name the component, not just "unavailable":

```
gh-stack extension not installed — falling back to Multi-PR mode.
  Missing: github/gh-stack (gh extension)
  Install: gh extension install github/gh-stack
  Effect:  chained-base PRs are still created; no GitHub stack object,
           so no per-layer diff view and no linked merges.
```

If `gh extension list` itself errors or cannot be run, **detection failure degrades conservatively to the non-native path** — an unreadable environment is treated as "missing", never as "available".

Because no confirmed rollout signal exists yet, "extension installed" alone never unlocks the native output — the first row is unreachable until Q2 is answered, and that is deliberate: degrade conservatively rather than promise a native stack the repo may not support.

Both paths produce chained-base PRs. The native path additionally yields a GitHub stack object (per-layer diff view, linked merges) — **say so in the output**; a hand-built chained-base PR set is not claimed to be equivalent.

## Update Flow

After the user runs `gh stack rebase --upstack` + `gh stack push` themselves (which rewrites SHAs), `/create-pr --stack --update` refreshes each layer's title/body. CI monitoring can be chained via `/watch-ci`.
