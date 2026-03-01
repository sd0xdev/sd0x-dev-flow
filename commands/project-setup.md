---
description: "One-stop project onboarding. Auto-detect framework, configure CLAUDE.md, install rules and hooks for the full review-loop experience."
argument-hint: [--detect-only] [--lite] [--no-rules] [--no-hooks] [--guard-mode warn|strict]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(node:*), Bash(git:*), Bash(ls:*), Bash(mkdir:*), Bash(diff:*), Bash(chmod:*), Bash(jq:*), Bash(bash:*)
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/project-setup/SKILL.md

## Context

- Repo root: !`git rev-parse --show-toplevel`
- Existing local rules: !`bash -c 'ls .claude/rules/ 2>/dev/null || echo "(none)"'`
- Existing local hooks: !`bash -c 'ls .claude/hooks/ 2>/dev/null || echo "(none)"'`
- Settings file: !`bash -c 'ls .claude/settings.json 2>/dev/null || echo "(none)"'`

## Task

Initialize .claude/CLAUDE.md settings for the current project, install rules and hooks for the full auto-loop review cycle.

### Arguments

```
$ARGUMENTS
```

| Argument | Description |
|----------|-------------|
| `--detect-only` | Only detect and display results, do not write anything |
| `--lite` | Only configure CLAUDE.md (skip rules and hooks) |
| `--no-rules` | Skip rules installation (Phase 5) |
| `--no-hooks` | Skip hooks installation (Phase 6) |
| `--guard-mode warn\|strict` | Set stop-guard mode (default: strict). `strict` blocks stop before review; `warn` only warns |

## Examples

```bash
# Full onboarding: CLAUDE.md + rules + hooks
/project-setup

# Detect only, do not modify
/project-setup --detect-only

# CLAUDE.md only, no rules or hooks
/project-setup --lite

# CLAUDE.md + rules, no hooks
/project-setup --no-hooks

# CLAUDE.md + hooks, no rules
/project-setup --no-rules

# Full onboarding with warn-only guard (no blocking)
/project-setup --guard-mode warn
```
