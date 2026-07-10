---
name: create-pr
description: "Create or update GitHub PR with gh CLI. Auto-extracts ticket ID from branch name, generates title/summary from commits. Auto-detects existing PR and switches to update mode. Default: --dry-run (show command, don't execute). Use when: user asks to open/create/update a PR, says /create-pr, wants to refresh PR description after new commits, or says 'update pr', 'update PR title', 'refresh PR body'."
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
---

# Create PR

## Input

`/create-pr [--head <branch>] [--base <branch>] [--title <title>] [--update] [--execute] [--dry-run]`

- `--head`: Source branch (default: current branch)
- `--base`: Target branch (default: `{TARGET_BRANCH}` or `main`)
- `--title`: Override auto-generated title
- `--update`: Force update mode (re-generate title/body for existing PR)
- `--dry-run`: Show command without executing (default)
- `--execute`: Actually create/update the PR (requires user confirmation)
- No args: use current branch → default target, dry-run mode. Auto-detects existing PR → update mode

## Workflow

### 1. Gather Info (parallel)

```bash
# Current branch
git rev-parse --abbrev-ref HEAD

# Remote repo (owner/repo)
gh repo view --json nameWithOwner --jq '.nameWithOwner'

# Check if head branch is pushed
git ls-remote --heads origin <head-branch>

# Check existing PR
gh pr list --head <head-branch> --base <base-branch> --json number,title,state

# Commits between base..head
git log --oneline <base>..<head>

# Full diff for summary
git diff <base>...<head> --stat
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
| Co-Authored-By AI | `Co-Authored-By:.*(Claude\|Anthropic\|GPT\|OpenAI\|Copilot\|noreply@anthropic)` |
| Generated-by tag | `Generated (by\|with).*(Claude\|\bAI\b\|GPT\|OpenAI\|Copilot)` |
| Emoji robot tag | `🤖.*(Claude\|\bAI\b\|GPT\|OpenAI)` |

> **Note**: `\|` in the table above is Markdown table escaping. Actual ERE uses unescaped `|`. Only `AI` is `\b`-bounded — it prevents bare `AI` from matching inside ordinary words ("maintainer", "domain") under `-i`. `GPT` and `OpenAI` are intentionally left unbounded so they still match inside `ChatGPT` / `GPT-4` (no English word contains "gpt").

### 4b. AI Content Sanitization

After generating title and body (Step 3-4), scan for forbidden patterns and sanitize **before** any output or execution. Applies to all modes: dry-run/execute, create/update, `--title` override.

**Title sanitization** (regenerate/fail):

1. Scan title for forbidden patterns (`grep -Ei`)
2. If match found → regenerate title from commits (1 attempt, without AI attribution)
3. If regenerated title still matches → **HARD FAIL**: abort with error message
4. `--title` override: same scan-and-fail logic (no regeneration — user-provided text fails immediately if matched)

**Body sanitization** (line-strip + log):

1. Scan body line-by-line for forbidden patterns
2. Remove matching lines
3. Log each removal: `[AI_STRIPPED] <removed line>`
4. If all content lines removed → preserve template structure (Summary / Test plan headers only)

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

**Step 4**: Decision — if both title and body are unchanged → report "PR is already up to date" and STOP.

If changes detected, show the diff and decide what to update:

- **Title changed significantly**: update title automatically. Criteria: type prefix changed (`fix:` → `feat:`) or ticket ID changed.
- **Title changed trivially**: AskUserQuestion — "Title changed slightly. Update?" (show before/after). Criteria: only the summary text after `<type>: [<TICKET>]` differs.
- **Body changed**: always update (body reflects commit history, should stay current)
- When `--title` is passed: override title regardless of diff

**Step 5**: Output (respects `--dry-run` / `--execute`):

Dry-run (default) — show the `gh pr edit` command with **only changed fields** included:

```bash
# Title-only update (use printf for safe escaping):
gh pr edit <number> --title "$(printf '%s' '<new-title>')"

# Body-only update (use --body-file for safe escaping):
gh pr edit <number> --body-file /dev/stdin <<'EOF'
<new-body>
EOF

# Both title + body:
gh pr edit <number> --title "$(printf '%s' '<new-title>')" --body-file /dev/stdin <<'EOF'
<new-body>
EOF
```

Use `--body-file` instead of `--body` to avoid shell escaping issues with quotes and newlines in the body content.

Execute (`--execute`) — ask user for confirmation via AskUserQuestion, then run `gh pr edit`. Output:

```
PR updated: <URL>
Title: <old-title> → <new-title>
Changes: title updated, body updated
```

### 6. Output (dry-run, default) — Create Mode

Show the full `gh pr create` command:

```bash
gh pr create \
  --head <head-branch> \
  --base <base-branch> \
  --title "<title>" \
  --body "$(cat <<'EOF'
<generated body>
EOF
)"
```

User can copy-paste to execute, or re-run with `--execute`.

### 7. Execute (--execute flag)

Ask user for confirmation, then run the command. Output:

```
PR created: <URL>
Title: <title>
Base: <base> ← Head: <head>
```

### 7b. Post-creation Verify (execute-only)

After `gh pr create` or `gh pr edit` completes in `--execute` mode, verify the published content for AI attribution leaks.

**Step 1**: Fetch actual published content:

```bash
gh pr view <number> --json title,body --template '{{.title}}{{"\n"}}{{.body}}'
```

**Step 2**: Scan for forbidden patterns (same 3 `ERE + \b` patterns from Step 4b).

**Step 3**: If leak detected — **auto-remediate** (single attempt, using pre-sanitized snapshot from Step 4b):

```bash
# Title (safe escaping via printf):
gh pr edit <number> --title "$(printf '%s' "$SANITIZED_TITLE")"

# Body (safe escaping via --body-file + heredoc):
gh pr edit <number> --body-file /dev/stdin <<'EOF'
<pre-sanitized-body-snapshot>
EOF
```

**Step 4**: Re-verify via `gh pr view`. If still leaked → **HARD FAIL**:

```
❌ AI attribution leaked in PR #<number> after remediation attempt.
   Manual fix: gh pr edit <number> --title "<clean-title>" --body-file <clean-body-file>
```

**Guardrails**:
1. Single remediation attempt only — no retry loop
2. Use pre-sanitized snapshot (do not re-generate from commits)
3. Fail-fast on GitHub API errors (no retry for transient errors)

## Multi-PR Mode

When user specifies multiple branch pairs (e.g. "A → main, B → A"), create them sequentially and output all URLs at the end.

## Edge Cases

| Case | Behavior |
|------|----------|
| No ticket ID in branch name | Omit `[TICKET]` from title, omit Ticket section from body |
| Branch suffix like `-2`, `-3` | Strip suffix when extracting ticket ID |
| User provides `--title` | Use as-is (skip auto-generation), but **still run Step 4b scan** — fail immediately if forbidden pattern matched |
| Stacked PRs (B → A → main) | Note dependency in body: "Stacked on #<PR-number>" |
| `--update` but no existing PR | Error: "No PR found for branch `<head>` → `<base>`" |
| Auto-detect existing PR | Switch to update mode, show "Existing PR #N detected, switching to update mode" |
| PR body has manual edits | Re-generate from commits; user reviews before/after diff |
| Title unchanged after new commits | Skip title update, only update body |

## Verification

### Create mode

- [ ] Branch exists and is pushed to remote
- [ ] No existing PR for the same head/base
- [ ] Title follows project convention
- [ ] Body includes summary and test plan
- [ ] Step 4b: Title and body pass forbidden-pattern scan
- [ ] Step 7b: Post-creation verify finds no AI attribution (execute-only)
- [ ] Dry-run command is valid (copy-pasteable)

### Update mode

- [ ] Existing PR fetched successfully (`gh pr view`)
- [ ] New title/body generated from latest commits
- [ ] Step 4b: Re-generated content sanitized before output/edit
- [ ] Step 7b: Post-edit verify finds no AI attribution (execute-only)
- [ ] Before/after diff shown to user
- [ ] Only changed fields included in `gh pr edit` command
- [ ] Dry-run command is valid (copy-pasteable)
