---
description: "System diagnosis skill (READ-ONLY). Verifies feature behavior through code analysis, data validation, and Codex confirmation."
argument-hint: "<feature to verify>" [<data-source credentials>]
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Task, Skill, mcp__codex__codex, mcp__codex__codex-reply
skills: feature-verify
---

## Context

- Git status: !`git status -sb`
- Project root: !`git rev-parse --show-toplevel`

## Arguments

| Parameter | Description |
|-----------|-------------|
| `<feature>` | Feature or system to verify |
| `<credentials>` | Optional data source connection strings |

## Workflow

1. **Explore** — Understand system architecture, data flow, trigger points
2. **Plan** — Build verification checklist, present to user for confirmation
3. **Execute** — Run read-only queries, record expected vs actual
4. **Analyze** — Claude independently forms diagnostic conclusion
5. **Confirm** — Codex third-perspective verification
6. **Integrate** — Synthesize dual perspectives, produce final report

Refer to @skills/feature-verify/SKILL.md for safety rules and verification checklist.

## Key Rules

- **ALL operations must be READ-ONLY** — no write/update/delete
- Present verification plan before executing queries
- Do not expose full credentials in output
- Claude forms conclusion first, then Codex confirms independently

## Examples

```bash
/feature-verify "User Authentication"
/feature-verify "Payment Processing" MongoDB: mongodb://...
```
