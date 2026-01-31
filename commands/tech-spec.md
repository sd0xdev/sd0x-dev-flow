---
description: Produce a technical spec document from requirements
argument-hint: <requirement description> [--request] [--no-save]
allowed-tools: Read, Grep, Glob, Bash(git:*), Write
skills: tech-spec
---

## Task

Produce a technical spec document based on requirements.

### Requirements

```
$ARGUMENTS
```

### Execution Guide

Follow the workflow and templates in the skill:

| Phase    | Reference                                        |
| -------- | ------------------------------------------------ |
| Workflow | @skills/tech-spec/SKILL.md               |
| Template | @skills/tech-spec/references/template.md |

### Parameter Description

- `--request` - Also generate a request document
- `--no-save` - Do not save to docs/

## Examples

```bash
/tech-spec "Add user quota management feature"
/tech-spec "Optimize cache performance" --request
```
