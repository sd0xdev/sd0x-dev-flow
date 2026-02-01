---
description: Dual-perspective code investigation. Claude and Codex explore independently, then integrate conclusions.
argument-hint: "<question about code>"
allowed-tools: Read, Grep, Glob, Bash(git:*), mcp__codex__codex, mcp__codex__codex-reply
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/code-investigate/SKILL.md

## Context

- Git status: !`git status -sb`
- Project root: !`git rev-parse --show-toplevel`

## Arguments

| Parameter | Description |
|-----------|-------------|
| `<question>` | What you want to investigate about the codebase |

## Workflow

1. **Claude Explore** — Grep/Glob/Read to search related code
2. **Claude Conclude** — Form independent understanding (internal, not output)
3. **Codex Explore** — Invoke Codex MCP to explore independently (no feeding Claude's conclusions)
4. **Integrate** — Compare both perspectives, mark agreements and differences

## Key Rules

- Codex must explore independently — do NOT feed Claude's findings to Codex
- No leading questions or scope restrictions for Codex
- Report must present Claude/Codex conclusions separately before integration

## Examples

```bash
/code-investigate "How does order processing work?"
/code-investigate "Why is token price sometimes null?"
/code-investigate "How does the API caching mechanism work?"
```
