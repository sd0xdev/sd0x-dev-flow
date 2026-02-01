---
description: Start from first principles, explore possible solutions and quantitatively assess feasibility. Use before /tech-spec.
argument-hint: <requirement description> [--constraints <constraints>] [--context <code path>] [--no-codex]
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(codex:*), Bash(bash:*), Write, mcp__codex__codex, mcp__codex__codex-reply
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/feasibility-study/SKILL.md

## Context

- Project root: !`git rev-parse --show-toplevel`
- Recent changes: !`git diff --name-only HEAD~5 2>/dev/null | grep -E '^src/' | head -10`

## Task

Analyze the following requirement from first principles, exploring all possible solutions.

### Input

```
$ARGUMENTS
```

| Parameter                 | Description                                |
| ------------------------- | ------------------------------------------ |
| `<requirement>`           | Required, requirement description           |
| `--constraints <text>`    | Optional, constraints to consider           |
| `--context <code path>`   | Optional, related code to research          |
| `--no-codex`              | Optional, skip Codex discussion             |

### Workflow

```
5 Why decompose → Constraints → Code research → 2-3+ Solutions → Codex discussion → Comparison → Report
```

1. **Decompose**: 5 Why to uncover essence, define success criteria
2. **Constraints**: Inventory technical/business/resource constraints with flexibility
3. **Code research**: grep/read existing modules, patterns, tech debt
4. **Solutions**: Brainstorm 2-3+ options with quantified feasibility assessment
5. **Codex discussion**: `/codex-brainstorm` → `/codex-architect` → continuous dialog (unless `--no-codex`)
6. **Decision**: Comparison table + recommendation + backup + open questions

### Key Rules

- **First principles** — 5 Why decomposition, not surface-level analysis
- **Quantified assessment** — every solution rated on 5 dimensions (feasibility, effort, risk, extensibility, maintenance)
- **Codex is mandatory** — continuous dialog unless `--no-codex`; not one-and-done
- **Record differences** — document where Claude and Codex disagree and the resolution
- **2-3+ solutions minimum** — never present only one option

### Codex Discussion Principle

**⚠️ Any idea, proposal, update, or change must be discussed in depth with Codex ⚠️**

| Tool | When |
|------|------|
| `/codex-brainstorm` | At start — enumerate all possibilities |
| `/codex-architect` | After proposal — evaluate/compare |
| `mcp__codex__codex-reply` | Anytime — ask on every new idea |

## Relationship with Other Commands

```
/feasibility-study → /tech-spec → /deep-analyze → /codex-implement
```

## Examples

```bash
/feasibility-study "Add user quota management feature"
/feasibility-study "Add user quota" --constraints "cannot change existing API"
/feasibility-study "Optimize asset cache" --context src/service/asset.service.ts
/feasibility-study "Add logging feature" --no-codex
```
