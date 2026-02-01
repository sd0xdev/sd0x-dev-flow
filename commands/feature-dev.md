---
description: Feature development workflow. Guides through design -> implement -> verify -> review -> commit flow.
argument-hint: "<feature description>" [--skip-design] [--skip-review]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Skill, AskUserQuestion, mcp__codex__codex, mcp__codex__codex-reply
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/feature-dev/SKILL.md

## Context

- Git status: !`git status -sb`
- Current branch: !`git branch --show-current`

## Arguments

| Parameter | Description |
|-----------|-------------|
| `<feature>` | Feature requirement description |
| `--skip-design` | Skip architecture design phase |
| `--skip-review` | Skip code review phase |

## Workflow

```
Requirements -> Design -> Implement -> Test -> Review -> Commit
                │          │            │        │          │
                ▼          ▼            ▼        ▼          ▼
           /codex-     /codex-      /verify  /codex-    /precommit
           architect   implement             review-fast
```

## Key Rules

- Reference existing code patterns before implementing
- Every new service/provider must have unit tests
- Bug fixes must include regression tests
- Follow auto-loop rule: fix -> re-review -> ... -> Pass

## Examples

```bash
/feature-dev "Add user authentication with JWT"
/feature-dev "Implement fee calculation" --skip-design
```
