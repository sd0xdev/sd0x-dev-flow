---
description: Review uncommitted changes using Codex CLI (not MCP). Codex autonomously explores the entire project.
argument-hint: [--base <branch>] [--title "<text>"] [--prompt "<text>"]
allowed-tools: Bash(bash:*)
skills: codex-cli-review
---

## Context

- Git status: !`git status -sb`
- Changed files: !`git diff --name-only HEAD 2>/dev/null | head -10`

## Task

Use Codex CLI to review uncommitted changes.

### Arguments

```
$ARGUMENTS
```

### Execute Script

```bash
bash skills/codex-cli-review/scripts/review.sh $ARGUMENTS
```

## Difference from MCP Version

| Feature            | CLI Version (this command) | MCP Version           |
| ------------------ | -------------------------- | --------------------- |
| Autonomous explore | ✅ Full disk read          | ⚠️ Needs explicit instruction |
| Context preserve   | ❌ None                    | ✅ threadId           |
| Loop review        | ❌ Each run independent    | ✅ --continue         |

## Output

Codex native review format:

- **Summary**: Change overview
- **Issues**: Critical / Major / Minor / Suggestion
- **Recommendations**: Improvement suggestions

## Review Loop

**Note**: This command does not support loop review (no context preservation).

For loop review, use:

```bash
/codex-review-fast --continue <threadId>
```

## Examples

```bash
# Review uncommitted changes
/codex-cli-review

# Compare with main branch
/codex-cli-review --base main

# With title
/codex-cli-review --title "Feature: User Auth"

# Custom review prompt
/codex-cli-review --prompt "Focus on security and performance"
```
