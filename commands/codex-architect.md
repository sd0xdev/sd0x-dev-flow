---
description: Get architecture/design advice from Codex (third brain)
argument-hint: "<question>" [--context <files>] [--mode design|review|compare]
allowed-tools: Read, Grep, Glob, mcp__codex__codex, mcp__codex__codex-reply
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-architect/SKILL.md

## Task

Get architecture advice from Codex to form a dual-perspective view.

### Question

```
$ARGUMENTS
```

## Examples

```bash
/codex-architect "Is this cache design reasonable?" --context src/service/cache/
/codex-architect "Microservices vs monolith?" --mode compare
```
