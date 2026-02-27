---
name: create-pr
description: "Create GitHub PR with gh CLI. Auto-extracts ticket ID from branch name, generates title/summary from commits. Default: --dry-run (show command, don't execute). Use when: user asks to open/create a PR, or says /create-pr"
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob
---

# Create PR

## Input

`/create-pr [--head <branch>] [--base <branch>] [--title <title>] [--execute] [--dry-run]`

- `--head`: Source branch (default: current branch)
- `--base`: Target branch (default: `{TARGET_BRANCH}` or `main`)
- `--title`: Override auto-generated title
- `--dry-run`: Show `gh pr create` command without executing (default)
- `--execute`: Actually create the PR (requires user confirmation)
- No args: use current branch → default target, dry-run mode

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

- No AI-generated tags (no "Generated with Claude" etc.)
- Keep summary factual, based on actual commits
- Use imperative mood in bullet points
- Omit Ticket section if no ticket ID or `{ISSUE_TRACKER_URL}` not configured

### 5. Pre-flight Checks

| Check | Action if fails |
|-------|-----------------|
| Head branch not pushed | Warn: "branch not pushed to remote, push first" and STOP |
| PR already exists | Show existing PR URL, ask if user wants to edit title/body |
| No commits between base..head | Warn: "no diff between branches" and STOP |

### 6. Output (dry-run, default)

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

## Multi-PR Mode

When user specifies multiple branch pairs (e.g. "A → main, B → A"), create them sequentially and output all URLs at the end.

## Edge Cases

| Case | Behavior |
|------|----------|
| No ticket ID in branch name | Omit `[TICKET]` from title, omit Ticket section from body |
| Branch suffix like `-2`, `-3` | Strip suffix when extracting ticket ID |
| User provides `--title` | Use as-is, skip auto-generation |
| Stacked PRs (B → A → main) | Note dependency in body: "Stacked on #<PR-number>" |

## Verification

- [ ] Branch exists and is pushed to remote
- [ ] No existing PR for the same head/base
- [ ] Title follows project convention
- [ ] Body includes summary and test plan
- [ ] Dry-run command is valid (copy-pasteable)
