---
description: Smart batch commit — group changes by cohesion, generate commit messages matching project style, output git commands (or execute directly with --execute)
argument-hint: [--execute] [--scope <path>] [--type <type>] [--ai-co-author]
allowed-tools: Bash(git:*), Read, Grep, Glob, AskUserQuestion
---

**Must read and follow the skill below before executing this command:**

@skills/smart-commit/SKILL.md

## Context

- Status: !`git status --short`
- Recent style: !`git log --oneline -10`
- Branch: !`git rev-parse --abbrev-ref HEAD`

## Task

Follow the `smart-commit` skill workflow:

1. **Detect mode**: Read CLAUDE.md / git-workflow rules → manual (default) or execute (`--execute` flag)
2. **Pre-flight**: Verify `/precommit` passed for code changes
3. **Collect**: `git status`, `git diff --stat`, exclude sensitive files
4. **Group**: High-cohesion grouping (staged first, then by feature/type)
5. **Generate**: Commit messages matching project style + git commands (or execute directly in `--execute` mode)
6. **Verify**: `git status` after completion

Arguments:
- `--execute`: Execute `git add` + `git commit` directly (overrides manual mode, requires user approval via AskUserQuestion)
- `--scope <path>`: Only include changes under this path
- `--type <type>`: Force all commits to use this type (feat/fix/docs/etc.)
- `--ai-co-author`: Add `Co-Authored-By: Claude <noreply@anthropic.com>` trailer to commit messages (off by default)

## Output

**Manual mode** (default): For each commit group, output a code block with copy-pasteable git commands.
Respect `rules/git-workflow.md` — if Claude is forbidden from git commit, output commands only.

**Execute mode** (`--execute`): Use `AskUserQuestion` to show the full commit plan and get approval once, then execute `git add` + `git commit` directly for each group. Verify each commit with `git log --oneline -1`. Stop on failure.
