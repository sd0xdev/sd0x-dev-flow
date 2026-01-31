---
description: Get architecture/design advice from Codex (third brain)
argument-hint: "<question>" [--context <files>] [--mode design|review|compare]
allowed-tools: Read, Grep, Glob, mcp__codex__codex, mcp__codex__codex-reply
skills: codex-architect
---

## Task

Get architecture advice from Codex to form a dual-perspective view.

### Question

```
$ARGUMENTS
```

### Execution Guide

Follow the workflow and templates in the skill:

| Phase             | Reference                                                       |
| ----------------- | --------------------------------------------------------------- |
| Workflow          | @skills/codex-architect/SKILL.md                        |
| Project Knowledge | @skills/codex-architect/references/project-knowledge.md |

## Examples

```bash
/codex-architect "Is this cache design reasonable?" --context src/service/cache/
/codex-architect "Microservices vs monolith?" --mode compare
```
