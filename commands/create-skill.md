---
description: Create or refactor a Claude Code skill
argument-hint: <skill-name> [docs-path]
allowed-tools: Read, Grep, Glob, Write, Task
skills: create-skill
---

## Task

Create or refactor a skill.

### Parameters

```
$ARGUMENTS
```

### Execution Guide

Follow the workflow and structure standards in the skill:

| Phase    | Reference                             |
| -------- | ------------------------------------- |
| Workflow | @skills/create-skill/SKILL.md |

## Examples

```bash
/create-skill circuit-breaker docs/features/resilience
/create-skill codex-brainstorm  # Refactor existing skill
```
