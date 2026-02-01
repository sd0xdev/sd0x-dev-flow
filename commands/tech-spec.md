---
description: Produce a technical spec document from requirements
argument-hint: <requirement description> [--request] [--no-save]
allowed-tools: Read, Grep, Glob, Bash(git:*), Write
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/tech-spec/SKILL.md

## Task

Produce a technical spec document based on requirements.

### Requirements

```
$ARGUMENTS
```

### Parameter Description

- `--request` - Also generate a request document
- `--no-save` - Do not save to docs/

## Examples

```bash
/tech-spec "Add user quota management feature"
/tech-spec "Optimize cache performance" --request
```
