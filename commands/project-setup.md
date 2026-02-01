---
description: Initialize project settings. Auto-detect framework, package manager, database, and replace all CLAUDE.md placeholders.
argument-hint: [--detect-only]
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git:*), Bash(ls:*)
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/project-setup/SKILL.md

## Context

- Repo root: !`git rev-parse --show-toplevel`

## Task

Initialize CLAUDE.md settings for the current project.

### Arguments

```
$ARGUMENTS
```

- `--detect-only`: Only detect and display results, do not write to CLAUDE.md

## Examples

```bash
# Auto-detect + confirm + write
/project-setup

# Detect only, do not modify
/project-setup --detect-only
```
