---
name: create-pr
description: "Create or update GitHub PR with gh CLI. Auto-extracts ticket ID from branch name, generates title/summary from commits. Auto-detects existing PR and switches to update mode. Supports --stack for stacked PR chains (per-layer PRs with chained bases; never executes push/rebase). Default: --dry-run (show command, don't execute). Use when: user asks to open/create/update a PR, says /create-pr, wants a stacked PR chain, wants to refresh PR description after new commits, or says 'update pr', 'update PR title', 'refresh PR body'."
allowed-tools: Bash(git:*), Bash(gh:*), Bash(mktemp:*), Bash(rm:*), Bash(bash:*), Read, Write, Grep, Glob, AskUserQuestion
---

# Create PR

## Input

`/create-pr [--head <branch>] [--base <branch>] [--title <title>] [--stack <branch...>] [--update] [--execute] [--dry-run]`

- `--head`: Source branch (default: current branch)
- `--base`: Target branch (default: `{TARGET_BRANCH}` or `main`)
- `--title`: Override auto-generated title (**rejected** with `--stack`)
- `--stack`: Stacked PR chain mode, bottom layer first (mutually exclusive with `--head`; the bottom layer's base follows the same `--base` / `{TARGET_BRANCH}` / `main` resolution as normal mode) — see [Stacked PR Mode](#stacked-pr-mode)
- `--update`: Force update mode (re-generate title/body for existing PR)
- `--dry-run`: Show command without executing (default)
- `--execute`: Actually create/update the PR (requires user confirmation)
- No args: use current branch → default target, dry-run mode. Auto-detects existing PR → update mode

## Workflow

### 0. Mode Dispatch (first, before anything else)

**When `--stack` is present**: read `references/stack-mode.md` and run Phases A–D from there. Skip generic Steps 1, 5, 6 and 7 entirely — Phase A must run `git fetch --prune origin` and classify sync state *before* any PR planning, so the generic `ls-remote` / local `base..head` path must not run first. What is reused, per layer, exactly as Phase C directs:

| Reused | Skipped |
|--------|---------|
| Steps 2–4 content generation (ticket ID, title, body) | Step 1 gather — Phase A replaces it |
| Step 4b sanitization, Step 7b post-creation verify | Step 5 pre-flight + mode detection — Phase A/B replace it |
| **Step 5a's smart-diff update logic** — the routing decision is Phase B's, the diff-and-update mechanics are Step 5a's | Steps 6–7 single-PR output/execute — Phase C emits per-layer commands instead |

Otherwise continue with Step 1 below.

### 1. Gather Info (parallel)

```bash
# Current branch
git rev-parse --abbrev-ref HEAD

# Remote repo (owner/repo)
gh repo view --json nameWithOwner --jq '.nameWithOwner'

# Check if head branch is pushed
git ls-remote --heads origin -- 'feat/PROJ-42-add-widget'

# Check existing PR
gh pr list --head 'feat/PROJ-42-add-widget' --base 'main' --json number,title,state

# Commits between base..head
git log --oneline 'refs/remotes/origin/main..refs/remotes/origin/feat/PROJ-42-add-widget'

# Full diff for summary
git diff 'refs/remotes/origin/main...refs/remotes/origin/feat/PROJ-42-add-widget' --stat
```

### 2. Extract Ticket ID

From branch name, extract ticket ID using `{TICKET_PATTERN}` (default: `[A-Z]+-\d+`):

| Branch Pattern | Ticket ID |
|----------------|-----------|
| `fix/PROJ-520` | `PROJ-520` |
| `fix/PROJ-520-2` | `PROJ-520` |
| `feat/PROJ-123-some-desc` | `PROJ-123` |
| `refactor/PROJ-999` | `PROJ-999` |

Regex: first match of `{TICKET_PATTERN}` — take first match. Strip trailing `-N` suffixes.

### 3. Generate Title

Format: `<type>: [<TICKET>] <concise summary>`

- `<type>`: from branch prefix (`fix/` → `fix`, `feat/` → `feat`, `docs/` → `docs`, `refactor/` → `refactor`)
- `<TICKET>`: extracted ticket ID (omit if none found)
- `<concise summary>`: summarize commits in <60 chars, focus on main changes

### 4. Generate Body

```markdown
## Summary

<3-5 bullet points summarizing changes from commits>

## Ticket

[<TICKET>]({ISSUE_TRACKER_URL}<TICKET>)

## Test plan

- [ ] <test items based on what changed>
```

**Rules:**

- No AI-generated tags — enforced by Step 4b sanitization (see below)
- Keep summary factual, based on actual commits
- Use imperative mood in bullet points
- Omit Ticket section if no ticket ID or `{ISSUE_TRACKER_URL}` not configured

**Forbidden patterns** (case-insensitive ERE with `\b` word boundaries — canonical source: `scripts/commit-msg-guard.sh`):

| Pattern Category | Regex |
|-----------------|-------|
| Co-Authored-By AI | `Co-Authored-By:.*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini\|noreply@anthropic)` |
| Generated-by tag | `Generated[ -](by\|with).*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini)` |
| Emoji robot tag | `🤖.*(Claude\|Anthropic\|\bAI\b\|GPT\|OpenAI\|Copilot\|Codex\|Gemini)` |

> **Note**: `\|` in the table above is Markdown table escaping. Actual ERE uses unescaped `|`. Only `AI` is `\b`-bounded — it prevents bare `AI` from matching inside ordinary words ("maintainer", "domain") under `-i`. `GPT` and `OpenAI` are intentionally left unbounded so they still match inside `ChatGPT` / `GPT-4` (no English word contains "gpt"). `Generated[ -]` covers the hyphenated `Generated-by:` form, which the earlier space-only version accepted.

### 4b. AI Content Sanitization

After generating title and body (Step 3-4), scan for forbidden patterns and sanitize **before** any output or execution. Applies to all modes: dry-run/execute, create/update, `--title` override.

Sanitization is **executed, not paraphrased** — `skills/create-pr/scripts/sanitize-pr-content.sh` is the implementation, and it reads the three forbidden patterns out of `scripts/commit-msg-guard.sh` at runtime so the two can never drift. The path is resolved from the script's own location, after following any symlink chain, and from nothing else — **`PLUGIN_ROOT` is deliberately not consulted**, even though `run-skill.sh` exports it to exactly that value, because an environment variable that selects the policy source lets a caller swap in a guard declaring three never-matching patterns and get exit 0 on a real trailer. What self-location cannot cover is an invocation whose path is not the file's real location — a copy or a hardlink into a planted tree; the script says so in its own comment rather than implying otherwise, and `run-skill.sh` building an absolute target from its own location — **after physically resolving its own symlink chain**, without which a symlink to the wrapper planted in an attacker's tree selected that tree's copy of the policy script — is what closes that for the documented entrypoint. The documented invocation spells the interpreter absolutely (`/bin/bash -p`) for the same reason one layer earlier: a bare `bash` is resolved in the caller's shell, so an exported `bash` function answered the whole command with exit 0 and neither script ever started. A pattern set that reads as empty, as fewer entries than the guard declares, or as a line this parser cannot fully read aborts with exit 2 rather than reporting content clean.

**The run directory is allocated before this step, in every mode — including dry-run.** Sanitization operates on files, so a mode that writes no file cannot sanitize; a dry-run that skipped it would render an unsanitized body into its own report, which is precisely the text a user copies into `gh`. What dry-run must not do is *leave* the files behind or run a **mutating** `gh` call, and § Command Rendering's teardown fence is what guarantees the first. "No `gh` at all" would be the wrong contract and the wrong claim: stack mode's Phase B reads `gh pr list` and Phase D reads `gh extension list` — both read-only — in order to decide what to print. The line is `gh pr create` / `gh pr edit`: those are never run in dry-run. The lifecycle below is one sequence with one owner, and every exit from it — including a sanitizer failure — passes through the same teardown:

| # | Step | On failure |
|---|------|-----------|
| 1 | Allocate the run directory (`mktemp -d`, § Command Rendering step 1) | Nothing was created; stop |
| 2 | Write `pr-title.txt` and `pr-body-N.md` out of band (Write tool) — stack mode writes one of each **per layer** (`pr-title-N.txt`), see `references/stack-mode.md` | Run the teardown fence, then stop |
| 3 | `title` mode on the title file | Exit 3 → regenerate once; still 3 → teardown, then hard fail |
| 4 | `body-inplace` mode on each body file | Exit 2 → teardown, then hard fail |
| 5 | Operate (`gh`) — **execute mode only**; dry-run renders the report instead. The `--title` value is **read back from the file step 3 scanned**, not from the generator's copy | The guarded block already cleans and re-raises |
| 6 | Teardown (§ Command Rendering) — in dry-run this is a step of its own, run after the report is rendered | — |

**Why step 5 reads the title back.** `--body-file` names the very artifact `body-inplace` rewrote, so nothing in this workflow re-renders the body between the verdict and the send. `gh` has no `--title-file`, so the title is the one field this workflow could make diverge *by itself*: scan `pr-title.txt`, then render `--title` from a string the generator still holds, and the verdict belongs to bytes that were never published. Regenerating the title after the scan (step 3's "regenerate once" path) is exactly when that happens. The file is the artifact of record: re-scan it after any regeneration, and render the flag from what it holds.

**What this does *not* establish — stated because the earlier wording overclaimed it.** "Same pathname" is not "same bytes". Scan and publish are separate processes reading a mutable path, so between them any process running as the same user — a second agent, a stray editor, anything sharing the account — can replace either file, and the `0700` run directory does not help because it is that same user's own directory. The sanitizer has a narrower instance of the same gap internally: it scans the path, then reopens it to emit. Closing this properly means one hardened operation owning both the verdict and the send (sanitize and pipe those exact bytes into `gh --body-file -`), which `gh`'s per-flag interface and this skill's agent-driven step sequence do not currently allow. So the honest contract is: **this workflow never itself publishes unscanned bytes; it does not defend against a concurrent same-user writer.** Step 7b's post-publication scan is what covers that residual, and it is *detection* — it runs after `gh` has already sent the content, so it bounds exposure rather than preventing it.

Steps 3 and 4, with `<PR_BODY_DIR>` replaced by the literal path from step 1:

```bash
/bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh title '<PR_BODY_DIR>/pr-title.txt'
```

```bash
/bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh body-inplace '<PR_BODY_DIR>/pr-body-1.md'
```

**Title sanitization** (regenerate/fail) — `title` mode exits **3** on a match, never rewrites, and reports `[AI_DETECTED] line <n> matched pattern <k>`:

1. Scan title for forbidden patterns
2. Exit 3 → regenerate title from commits (1 attempt, without AI attribution) and re-run
3. If the regenerated title still exits 3 → **HARD FAIL**: tear down, abort with an error message. No `gh` command runs
4. `--title` override: same scan-and-fail logic (no regeneration — user-provided text fails immediately if matched)

**Body sanitization** (line-strip + log) — `body-inplace` replaces the file with its sanitized content and logs each removal to stderr:

1. Scan body line-by-line for forbidden patterns
2. Remove matching lines
3. Log each removal as `[AI_STRIPPED] line <n> matched pattern <k>` — **the matching line itself is never echoed.** A PR body is attacker-influenced text and a matched line can carry a token (`Generated by GPT-4; token=…`); `@rules/security.md` forbids putting one into a log. The line number locates it in the file
4. If all content lines removed → preserve template structure (Summary / Test plan headers only)

Use `body-inplace`, not `body` with a redirect: `… body <file> > <file>` truncates the file before the sanitizer reads it, so `gh` would receive an empty body. `body` mode (stdout) exists for previewing and for tests; `body-inplace` is what the workflow runs, and it replaces the file through a sibling temp file and an atomic rename. In `--stack` mode this happens **per layer**, on that layer's own `pr-body-N.md`, immediately before that layer's block.

### 5. Pre-flight Checks + Mode Detection

| Check | Action if fails |
|-------|-----------------|
| Head branch not pushed | Warn: "branch not pushed to remote, push first" and STOP |
| PR already exists | → **Enter Update Mode** (see section below) |
| `--update` flag + no existing PR | Warn: "no PR found for this branch" and STOP |
| No commits between base..head (create mode) | Warn: "no diff between branches" and STOP |
| No commits between base..head (update mode) | Continue — PR may need title/body refresh from `--title` override |

**Mode detection logic**:

| Condition | Mode |
|-----------|------|
| `--update` flag passed | Force update mode (error if no PR exists) |
| Existing PR detected (auto) | Update mode (auto-switch) |
| No existing PR, no `--update` | Create mode (original workflow) |

### 5a. Update Mode

When an existing PR is detected (or `--update` is passed):

**Step 1**: Fetch current PR state (use PR number from pre-flight `gh pr list` result):

```bash
gh pr view <PR-number> --json number,title,body,url,baseRefName
```

**Step 2**: Re-generate title and body from latest commits (same logic as Steps 2-4 above, using full commit range `base..head`). **Run Step 4b AI Content Sanitization** on the re-generated content before proceeding.

**Step 3**: Smart diff — compare current vs newly generated:

| Field | Current | New | Action |
|-------|---------|-----|--------|
| Title | same | same | Skip (no change needed) |
| Title | differs | differs | Show before/after |
| Body | same | same | Skip |
| Body | differs | differs | Show before/after |

**Step 4**: Decision — if both title and body are unchanged → report "PR is already up to date" and STOP. Step 4b has already allocated the run directory and written the title and body files by this point, so **STOP means running the teardown fence first** (§ Command Rendering, `<PRIOR_STATUS>` = `0`). An early exit is still an exit from the lifecycle, and it is the one most easily mistaken for "nothing happened".

If changes detected, show the diff and decide what to update:

- **Title changed significantly**: update title automatically. Criteria: type prefix changed (`fix:` → `feat:`) or ticket ID changed.
- **Title changed trivially**: AskUserQuestion — "Title changed slightly. Update?" (show before/after). Criteria: only the summary text after `<type>: [<TICKET>]` differs.
- **Body changed**: always update (body reflects commit history, should stay current)
- When `--title` is passed: override title regardless of diff

**Step 5**: Output (respects `--dry-run` / `--execute`):

Dry-run (default) — show the `gh pr edit` command with **only changed fields** included:

Every update is the canonical block below, instantiated — never a bare `gh pr edit`. A bare one is unguarded, so a caller's `errexit` exits at the failing `gh` before any cleanup runs, and Step 4b has already allocated the run directory and written the title and body files into it by this point. Only the two parameters the Cleanup row names vary, and no copy of the shape is kept here — a second copy is a second source, and this section is where it would drift from:

| Update | Flags on the block's `gh pr edit` | Cleanup operand |
|--------|-----------------------------------|-----------------|
| Title only | `--title` with the rendered title, no `--body-file` | `<PR_BODY_DIR>` — nothing was written for this operation, but the Step 4b directory is still this path's to remove |
| Body | `--body-file` naming the file in the run directory | `<PR_BODY_DIR>` |
| Body + title | both | `<PR_BODY_DIR>` |

#### Command Rendering (mandatory) ⚠️

Branch names, titles and bodies are all attacker-influenceable — a branch name is accepted by `git check-ref-format --branch` with `;`, `&`, quotes and `$( )` in it, and the body is generated from commit messages. Two rules, and **both** are load-bearing:

**1. Single-quote rendering, never double quotes.** Every dynamic value interpolated into a rendered command is wrapped in single quotes with embedded quotes escaped:

```
render(v) = ' + v.replace(every ' with '\'') + '
```

Double quotes are **not** a substitute: `"$(id)"` still runs `id`, so `git rev-parse "refs/heads/$BRANCH"` executes a command substitution embedded in a branch name. Templates in this skill and in `references/stack-mode.md` show values already rendered. Add `--` before positional arguments wherever the CLI accepts it, so a value cannot be parsed as a flag.

**2. Body text never appears inside shell syntax — no heredoc, ever.** This is a prohibition, not a preference, and it has no "unless" clause. A heredoc terminates at the first line equal to its delimiter, so a body containing that line closes the heredoc early and every following line is parsed as shell input — arbitrary command execution, not a formatting bug. Quoting the delimiter (`<<'X'`) only disables expansion *inside* the body; it does not prevent the collision. Nor does a random-looking fixed delimiter: fixed is fixed, and a body can contain it. `--body-file /dev/stdin` does not help either — termination happens in the shell before `gh` runs.

| Path | Rule |
|------|------|
| Required | Write the body to a file **out of band** — the Write tool when the skill runs (it is in `allowed-tools` for exactly this), the user's editor when they copy-paste — then pass `--body-file '<path>'`. The command names the file and never contains the body |
| Where | A directory **allocated by `mktemp -d`**, one per run: `mktemp -d` is atomic, returns a unique name, and creates it `0700`. Never invent the name — an invented path is not created, so `Write` fails on the missing parent, and on a shared `/tmp` a predictable name can be pre-created or symlinked by another user. **Never under `.git/`** either: `pre-edit-guard.sh` rejects every `.git/` path, and in a linked worktree `.git` is a file, not a directory |
| How the path is carried | Run `mktemp -d` **once**, read the path it prints, and substitute that **literal absolute path** into every later command. Each Bash invocation is a fresh shell, so `DIR=$(mktemp -d)` followed by `$DIR` in a later step silently resolves to nothing — and on macOS `TMPDIR` is an ambient variable pointing at the shared temp root, so a stray `rm -rf "$TMPDIR"` would target that root. Same rule and the same reasoning as `skills/necessity-audit/SKILL.md` § Phase 0. `<PR_BODY_DIR>` below marks where the returned literal goes |
| Cleanup | The shell **shape** is defined **once**, by the canonical block below, and every body-file command in this skill — create, update, stacked, Step 7b — uses that shape unchanged. What varies between them is the operation and the cleanup *operand*, and only those: a single-PR command cleans the whole run directory, while a stacked layer cleans its own `pr-body-N.md` and leaves the directory for the layers above it (`references/stack-mode.md` § Phase C). The structure around them — subshell, seeded status, guarded operation, guarded cleanup, arithmetic re-raise — is copied verbatim. Do not restate it in prose; a restatement is a second source that can drift. What the shape buys, so it is not "simplified" away: the operation is guarded so a caller's `errexit` cannot exit at the failing `gh` before cleanup runs (an unguarded command followed by a capture line is skipped outright); the status is carried in a subshell's positional parameters rather than a named variable, because a named one belongs to the caller — `readonly STATUS=9` would make the seeding assignment itself fail *after* allocation, leaking the directory, and an ordinary caller would silently lose its own value; the expansion is quoted, because a bare one is field-split with the caller's `IFS` and an `IFS` containing the status digit drops the status (bash and sh report a different code, zsh under `SH_WORD_SPLIT` reports success); and the subshell keeps the re-raise from closing an interactive shell. Cleanup runs on success *and* on failure — a PR body can carry private repository context even without credentials — but it must never **mask** the failure: an unconditional trailing `rm` succeeds, so the block would report 0 after a failed `gh`. Capture, clean, re-raise — and the cleanup is guarded in turn, because a *failing* `rm` would otherwise replace the operation's status with its own. `--` guards the operand, and the operand is the exact literal `mktemp -d` printed: an empty one deletes nothing, while a *wrong* non-empty literal would delete the wrong directory — which is why the exact-output provenance rule above is load-bearing. `Bash(mktemp:*)` and `Bash(rm:*)` are in `allowed-tools` for exactly these two steps, and `Bash(bash:*)` for the Step 4b/7b sanitizer invocation |
| Never | Any `<<` heredoc, `echo`/`printf` of body text, or body interpolated into a command string. With no delimiter in play, no body line can collide with one |
| Commands this skill executes | Pass arguments as an array — never interpolate body or title into a shell string |

This applies to every mode: create, update, stacked, and the Step 7b remediation below.

**Canonical cleanup block.** Every body-file command below is this block with its own `gh` invocation substituted — the one authority for the shape. It is **two fences, and the split is load-bearing**: a single fence containing both the allocator and the placeholder has no correct way to be run. Execute it whole and `mktemp -d`'s output is discarded while `gh` is handed the un-substituted literal `<PR_BODY_DIR>/…`, which does not exist; run the allocator separately and then execute the same fence "verbatim" and it allocates a *second* directory that nothing ever removes. A shell comment cannot pause execution while a body is written out of band — only a fence boundary can.

```bash
# Step 1 — allocate the run directory. Run this fence alone and read the literal
# path it prints. Nothing else belongs in it.
mktemp -d
```

Step 2 is out of band and is not shell: write each body file into that directory with the Write tool (or your editor). If that write fails or is interrupted, the directory is already allocated and may already hold a private body, so the teardown fence is the immediate next action rather than step 3.

The same fence is the **single teardown for every exit that does not reach step 3** — a failed or interrupted write, a Step 4b sanitizer failure (exit 2 or a title that fails twice), a user declining the confirmation, and the end of a dry-run preview. Step 3's own guarded block covers the paths that do reach it. Between them, no route out of the lifecycle leaves the directory behind, which is what makes "the body never outlives the run" a property rather than an intention:

```bash
# Any exit before step 3 — remove the allocated directory before anything else.
(
  set -- '<PRIOR_STATUS>'
  case "$1" in ''|*[!0-9]*) set -- 2 ;; esac
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

`<PRIOR_STATUS>` is the status the run already carries, and it is **single-quote rendered like every other dynamic value** — there is no bare-placeholder exemption in this skill. It once had one, on the reasoning that an arithmetic operand must not be quoted; that was wrong in both directions. `$(( … ))` converts a quoted digit string without complaint, and an unquoted `set -- <PRIOR_STATUS>` executes a hostile value at *substitution* time, before any arithmetic runs — the exemption created the hole it was reasoned into. The `case` line is the second layer: `$(( $1 ? … ))` re-evaluates `$1`'s *contents* as an expression, so a value like `a[$(…)]` would still run a command substitution there; anything that is not a run of digits becomes `2` (environment failure) before the arithmetic sees it. Cleanup runs either way.

The value itself: for an out-of-band write failure and for the end of a dry-run it renders as `0` — neither left a shell status behind, so the teardown's own status is the one worth reporting. After a Step 4b failure it renders as the sanitizer's exit (`2` for an environment failure, `3` for a title that failed twice), so the reason the run stopped survives the cleanup instead of being replaced by it. In `--execute` mode it renders as the failing layer's status instead, and cleanup can then only add a failure, never replace one — see `references/stack-mode.md` § Phase C.

```bash
# Step 3 — the guarded operation. Run it only once every <PR_BODY_DIR> is the
# literal path from step 1 and every named body file exists. No allocator here.
(
  set -- 0
  gh pr edit 42 --body-file '<PR_BODY_DIR>/pr-body-1.md' || set -- "$?"
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

**Why cleanup is guarded too.** An unguarded `rm` masks the operation twice over. It masks a *failure* when it succeeds — the historical bug — and it masks the operation's status when it *fails*: under an inherited `set -e`, `gh` exiting 37 followed by `rm` exiting 5 reports 5 in bash, sh, zsh and dash alike. The arithmetic re-raise gives the operation precedence and lets a cleanup failure surface only when the operation succeeded, so a leaked body directory is never silent either.

Execute (`--execute`) — ask user for confirmation via AskUserQuestion, then run `gh pr edit`. Output:

```
PR updated: <URL>
Title: <old-title> → <new-title>
Changes: title updated, body updated
```

### 6. Output (dry-run, default) — Create Mode

Show the full `gh pr create` command. **Dry-run runs no mutating `gh` call (`gh pr create` / `gh pr edit`) and leaves nothing on disk** — read-only queries such as `gh pr list` and `gh extension list` still run, because the report's content depends on their answers — but it does allocate, write and sanitize, because Step 4b operates on files and a preview whose body was never sanitized is exactly the text a user copies into a real `gh` invocation. The distinction that matters is durability, not activity: the run directory dry-run creates is torn down by the skill before the report is delivered, using the teardown fence below, so no private PR body survives a preview. The `gh` fence is *printed*, never run.

The steps below are what dry-run renders for the user to copy. The skill's own dry-run pass runs steps 1–2 plus Step 4b against a directory it allocates and then removes; it stops short of step 3.

```bash
# Step 1 — allocate. This fence holds nothing else; read the path it prints.
mktemp -d
```

Step 2 is out of band and is not shell: write the body into that directory as `pr-body-1.md` with the Write tool (or any editor). Only then, with `<PR_BODY_DIR>` replaced by the literal step-1 path:

```bash
# Step 3 — the guarded operation. Nothing of the body appears in it.
(
  set -- 0
  gh pr create \
    --head 'feat/PROJ-42-add-widget' \
    --base 'main' \
    --title 'feat: [PROJ-42] Add widget endpoint' \
    --body-file '<PR_BODY_DIR>/pr-body-1.md' || set -- "$?"
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

The three steps are run **in order, not pasted as one block**, and step 3 needs one substitution: `mktemp -d` prints a path that does not exist until the user runs it, so `<PR_BODY_DIR>` in the write and in the command is replaced with what step 1 printed. The skill's own preview directory is not reusable for this — it is torn down before the report is delivered, precisely so a private body does not outlive the preview. Say this in the report rather than implying a single paste; the alternative is a user pasting a command with a literal `<PR_BODY_DIR>` in it. Re-running with `--execute` avoids the substitution entirely: the skill then performs the allocation, the write and the operation itself, and owns the cleanup.

### 7. Execute (--execute flag)

Ask user for confirmation, then run the command. Output:

```
PR created: <URL>
Title: <title>
Base: <base> ← Head: <head>
```

### 7b. Post-creation Verify (execute-only)

After `gh pr create` or `gh pr edit` completes in `--execute` mode, verify the published content for AI attribution leaks.

Verification runs **twice** — once on what was just published, and once more after a remediation attempt. Both runs are the same four-step cycle, defined here once and invoked by reference; writing it out a second time is how the second verification previously degraded into the prose "re-verify via `gh pr view`", which names no file for the sanitizer to read and therefore produces no verdict at all.

#### The verification cycle

It needs a directory of its own, and for two different reasons depending on the mode. In single-PR mode the Step 4b run directory is **already gone** by the time verification starts — step 3's guarded block removes it in the same command that ran `gh`. In stack mode it is still open: each layer's block removes only its own `pr-body-N.md`, and the directory itself comes down in a teardown fence after the last layer (`references/stack-mode.md` § Phase C), while Step 7b runs per layer *between* those. Either way it must not be reused — a private body must not outlive its operation so a later step can borrow the path, and in stack mode the directory still holds the bodies of the layers not yet published. `<PR_BODY_DIR>` below is this cycle's own fresh literal, as in the 3a remediation.

| Step | What it does | On failure |
|------|--------------|-----------|
| **V1** | Allocate — run the `mktemp -d` fence alone, read the literal path it prints | Nothing was created; stop |
| **V2** | Capture the published content into it | Run **V4** immediately with `<PRIOR_STATUS>` = `gh`'s exit, then stop |
| **V3** | Scan the captured file (`scan` mode, exit **4** on a leak) | Its status is the verdict V4 carries |
| **V4** | Tear down, whatever V3 reported | — |

V2's redirect is what makes the scan possible: the sanitizer reads files, so a `gh pr view` printing only to the terminal leaves V3 scanning a path that does not exist (exit 2 — a fail-closed error, not a verdict). Writing to a *different* file than any input keeps the `body-inplace` truncation hazard from arising here. And V2's failure path is not optional: the redirect opens `published.txt` **before** `gh` runs, so a failed `gh pr view` can still leave a partial snapshot of a private repository's title and body in a directory that has no verdict to reach — only a directory to remove.

```bash
mktemp -d
```

```bash
gh pr view 42 --json title,body --template '{{.title}}{{"\n"}}{{.body}}' > '<PR_BODY_DIR>/published.txt'
```

```bash
/bin/bash -p scripts/run-skill.sh create-pr sanitize-pr-content.sh scan '<PR_BODY_DIR>/published.txt'
```

V4's `<PRIOR_STATUS>` renders as the status the cycle already carries (`0` clean, `4` leak, `2` fail-closed, or `gh`'s own status when V2 failed), so cleanup cannot mask the verdict and the captured snapshot never outlives the check:

```bash
(
  set -- '<PRIOR_STATUS>'
  case "$1" in ''|*[!0-9]*) set -- 2 ;; esac
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

**Step 1–2 — run the verification cycle** (V1–V4) against the PR just created or edited. Its result is the verdict: `0` clean and this section is done, `4` a leak, anything else a fail-closed error that stops the run.

**Step 3**: If leak detected — **auto-remediate** (single attempt, using pre-sanitized snapshot from Step 4b):

The Step 4b snapshot is held by the skill, not by a shell variable — a variable set in an earlier command does not survive into this one. Re-materialize it here with the same three steps as § Command Rendering — allocate, write out of band, operate — sub-numbered so they are not read as this section's own Steps 1–4:

**3a — allocate.** Run this fence alone and read the literal path it prints:

```bash
mktemp -d
```

**3b — write the snapshot, out of band.** This step is not shell: write the Step 4b sanitized body into the directory from 3a as `pr-body-1.md`, using the Write tool. Skipping it is the one way this remediation silently does the wrong thing — `gh` is handed a `--body-file` that does not exist, and the remediation fails after the leak has already been published. If the write fails, run the teardown fence from § Command Rendering and stop.

**3c — the guarded operation**, with `<PR_BODY_DIR>` replaced by the literal path from 3a:

```bash
(
  set -- 0
  gh pr edit 42 --title 'feat: [PROJ-42] Add widget endpoint' --body-file '<PR_BODY_DIR>/pr-body-1.md' || set -- "$?"
  rm -rf -- '<PR_BODY_DIR>' || set -- "$1" "$?"
  exit "$(( $1 ? $1 : ${2:-0} ))"
)
```

**Step 4 — run the verification cycle again** (V1–V4, a fresh directory each time), now against the remediated PR. This is the same sequence as Step 1–2, not a lighter check: the remediation published new content, so the only thing that establishes it is clean is capturing and scanning what GitHub now holds. A `0` here closes the section. If it still reports `4` → **HARD FAIL**:

```
❌ AI attribution leaked in PR #<number> after remediation attempt.
   Manual fix: re-run the canonical guarded block (§ Command Rendering) with
   `gh pr edit <number>` as its operation and a freshly sanitized body file.
```

This message names the canonical block rather than spelling a command out. A
second rendering of the same operation is a second thing to keep correct, and
this one sat in an untyped fence — outside the reach of the sweep that checks
every bash fence — while carrying an unquoted `<clean-body-file>`.

**Guardrails**:
1. Single remediation attempt only — no retry loop
2. Use pre-sanitized snapshot (do not re-generate from commits)
3. Fail-fast on GitHub API errors (no retry for transient errors)

## Multi-PR Mode

When user specifies multiple branch pairs (e.g. "A → main, B → A"), create them sequentially and output all URLs at the end.

## Stacked PR Mode

`--stack <branch...>` (bottom layer first) turns a linear branch chain into one PR per layer, each based on the layer below. Full detail — phase tables, chain model, shell-safety contract, native `gh stack` comparison — lives in `references/stack-mode.md`; what follows is the contract this skill will not deviate from.

**Never executes `git push`, `git rebase`, or any `gh stack` subcommand.** Under `--execute` only `gh pr create` / `gh pr edit` run, which is this skill's existing authorization (Step 5a, Steps 6-7). Branch pushes go to `/push-ci` or are emitted for the user to run; `gh stack` commands are printed, never invoked.

| Phase | Does |
|-------|------|
| A. Sync classification | `git fetch --prune origin`, then classify each layer by local/remote OID: `IN_SYNC` / `LOCAL_AHEAD` / `ABSENT` / `REMOTE_AHEAD` / `DIVERGED` / `NO_SUCH_BRANCH`. Every failure in the fence exits explicitly (`\|\| exit`), so a failed fetch cannot be followed by probes reading stale refs — `set -e` would not do it, because a caller that tests the fence's status disables errexit inside it — in every POSIX shell; each ref probe accepts exit 1 and exits on anything else, because absence is an expected answer, and the probes' output is delimited by `local:` / `remote:` / `end:` markers — without them a missing ref prints nothing and `ABSENT` reads identically to remote-only, whose disposition is the opposite. Runs **first** — later phases read remote refs, so a missing `origin/<head>` must surface here |
| B. Chain validation | Real ancestry — **every layer on its own base, bottom layer included** (`git merge-base --is-ancestor origin/<base> origin/<head>`) plus each adjacent pair; non-empty layer; existing-PR policy via `gh pr list --head <head> --state all --limit 100` (default is open-only, and the default page is 30 — both flags are mandatory); layer-count rules |
| C. Per-layer create/edit | Bottom to top; existing PR → update (Step 5a), absent → create. Steps 2-4 + 4b per layer; Step 7b per layer under `--execute`. Execute mode is **one guarded block per layer**, not one `&&` chain — an upper body carries the lower PR's number, which does not exist until the lower layer has run |
| D. Environment detection | Two independent conditions, and **both** must hold before any native sequence is printed: the `github/gh-stack` extension is installed **and** native stacks are confirmed rolled out for this repo. Installed but rollout unconfirmed is the conservative case — say so and take the non-native path, exactly as if the extension were absent |

| Sync state | dry-run | `--execute` |
|------------|---------|-------------|
| `IN_SYNC` | continue | continue |
| `LOCAL_AHEAD` | continue with stale-content warning | refuse |
| `ABSENT` | stop before PR planning, emit push remediation | refuse |
| `REMOTE_AHEAD` / `DIVERGED` | abort layer — user resolves via fetch/rebase (push is not the remedy) | refuse |
| `NO_SUCH_BRANCH` | abort — branch exists nowhere; pushing cannot fix a typo | refuse |

| Contract | What it means |
|----------|---------------|
| **Classification** | Ancestry in **both** directions (`merge-base --is-ancestor` each way) — OID equality alone cannot tell `LOCAL_AHEAD` from `REMOTE_AHEAD` from `DIVERGED`. Refs fully qualified (`refs/heads/…`, `refs/remotes/origin/…`); any fetch or resolution error fails closed |
| **`--update`** | Asserts every layer already has an OPEN PR: if any is absent, Phase B aborts before Phase C — `--update` never creates. Plain re-entry (no `--update`) keeps the auto-detected update/create routing |
| **Dependency marker** | `#<N>` whenever the lower PR number is known (including in dry-run), a `` `branch` `` marker only when that PR is absent, upgraded to `#<N>` on `--stack --update`. Never emit an unresolved placeholder |
| **Fail-fast, not atomic** | Layers are independent mutations, so partial success is a real outcome. On failure, stop before the next layer and report every layer as succeeded / failed / pending; re-running detects created layers in Phase B and routes them to update mode |
| **Shell safety** | Single-quote rendering for every dynamic value (double quotes do not suppress `$( )`), `--` as option terminator, and the body never enters shell syntax at all — no heredoc in any form; it is written to a file out of band and passed via `--body-file` |
| **Rejections** | Non-linear chain, layer with no unique commits, PR that is CLOSED / MERGED / base-mismatched / multiply matched, single-layer chain (use plain `/create-pr`), explicit-but-empty chain, and auto-detection with no authoritative source (existing PR base relations or native stack metadata). A dirty working tree only warns — all content derives from fetched remote refs |

## Edge Cases

| Case | Behavior |
|------|----------|
| No ticket ID in branch name | Omit `[TICKET]` from title, omit Ticket section from body |
| Branch suffix like `-2`, `-3` | Strip suffix when extracting ticket ID |
| User provides `--title` | Use as-is (skip auto-generation), but **still run Step 4b scan** — fail immediately if forbidden pattern matched |
| Stacked PRs (B → A → main) | Prefer `--stack` (per-layer PRs, chained bases). Without it: note dependency in body — `Stacked on #<PR-number>` when that PR exists, otherwise the lower branch name |
| `--update` but no existing PR | Error: "No PR found for branch `<head>` → `<base>`" |
| Auto-detect existing PR | Switch to update mode, show "Existing PR #N detected, switching to update mode" |
| PR body has manual edits | Re-generate from commits; user reviews before/after diff |
| Title unchanged after new commits | Skip title update, only update body |

## Verification

### Create and update modes

- [ ] Step 4b: Title and body pass the forbidden-pattern scan before they are output or sent
- [ ] Step 7b: Post-creation / post-edit verify finds no AI attribution (execute-only)
- [ ] Dry-run commands are valid and runnable in order, with `<PR_BODY_DIR>` the only substitution the user makes
- [ ] *(create)* Branch exists and is pushed to remote; no existing PR for the same head/base
- [ ] *(create)* Title follows project convention; body includes summary and test plan
- [ ] *(update)* Existing PR fetched successfully (`gh pr view`); new title/body generated from latest commits
- [ ] *(update)* Before/after diff shown to user; only changed fields included in `gh pr edit`

### Stacked mode (`--stack`)

- [ ] No `git push`, `git rebase`, or `gh stack` subcommand executed
- [ ] Phase A ran first: `git fetch --prune origin` + per-layer sync classification; `ABSENT` stopped before PR planning
- [ ] Phase B validated real ancestry and queried PRs with `--state all`
- [ ] Dependency markers resolved (`#N` when known, branch marker only when absent)
- [ ] Failure reported per layer (succeeded / failed / pending); re-run created no duplicates
- [ ] Displayed commands single-quote rendered; no heredoc anywhere, body passed via `--body-file`
