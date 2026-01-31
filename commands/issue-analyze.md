---
description: GitHub Issue deep analysis. Read issue -> classify problem -> select investigation strategy -> integrate four investigation tools.
argument-hint: <issue-number or issue-url>
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(gh:*), mcp__codex__codex
skills: issue-analyze
---

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Task

Analyze a GitHub Issue and produce a root cause analysis report.

### Arguments

```
$ARGUMENTS
```

### Execution Flow

```bash
# Step 1: Read Issue
gh issue view <number> --json title,body,labels,comments,author,createdAt

# Step 2: Problem Classification (see SKILL.md decision tree)
# - Regression -> /git-investigate
# - Feature misunderstanding -> /code-explore
# - Complex root cause -> /code-investigate
# - Multiple possibilities -> /codex-brainstorm

# Step 3: Execute Investigation

# Step 4: Produce Report
```

### Execution Guide

Follow the workflow in the skill:

| Phase          | Reference                                                   |
| -------------- | ----------------------------------------------------------- |
| Workflow       | @skills/issue-analyze/SKILL.md                      |
| Classification | @skills/issue-analyze/references/classification.md  |
| Report         | @skills/issue-analyze/references/report-template.md |

## When to Use

- ✅ Need deep analysis of a GitHub Issue
- ✅ Root cause is uncertain
- ✅ Systematic investigation needed

## When NOT to Use

- ❌ Root cause already known, fix directly (use `/bug-fix`)
- ❌ Simple issue, just check code directly

## Examples

```bash
# Analyze by issue number
/issue-analyze 123

# Analyze by issue URL
/issue-analyze https://github.com/user/repo/issues/123

# Analyze by description (no issue)
/issue-analyze "API returns 500 when token is empty"
```
