---
description: Initialize project settings. Auto-detect framework, package manager, database, and replace all CLAUDE.md placeholders.
argument-hint: [--detect-only]
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git:*), Bash(ls:*)
skills: project-setup
---

## Context

- Repo root: !`git rev-parse --show-toplevel`

## Task

Initialize CLAUDE.md settings for the current project.

### Arguments

```
$ARGUMENTS
```

- `--detect-only`: Only detect and display results, do not write to CLAUDE.md

### Execution Guide

Follow the workflow and structure standards in the skill:

| Phase           | Reference                                            |
| --------------- | ---------------------------------------------------- |
| Workflow        | @skills/project-setup/SKILL.md                |
| Detection Rules | @skills/project-setup/references/detection-rules.md |

## Examples

```bash
# Auto-detect + confirm + write
/project-setup

# Detect only, do not modify
/project-setup --detect-only
```
