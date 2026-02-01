---
description: Explain complex code logic using Codex MCP
argument-hint: <file-path> [--lines <start>-<end>] [--depth brief|normal|deep]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-explain/SKILL.md
@skills/codex-explain/references/codex-prompt-explain.md

## Context

- Git status: !`git status -sb`

## Task

Explain code logic using Codex MCP.

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `<file-path>`           | Required, file to explain                      |
| `--lines <start>-<end>` | Optional, specify line range                   |
| `--depth <level>`       | Optional: brief / normal (default) / deep      |

### Workflow

```
Read target → Codex explain → Output explanation
```

1. **Read target**: Read file content (or line range if `--lines`)
2. **Codex explain**: `mcp__codex__codex` with explanation prompt
3. **Output**: Functional summary + detailed explanation + key concepts + project context

### Key Rules

- **Codex must independently research** — trace imports, find callers, read dependencies
- **Depth levels** — brief (1 sentence), normal (overview + flow + concepts), deep (+ patterns + complexity + issues)

## Output

```markdown
## Code Explanation Report

### File Info
- Path: <file-path>
- Range: <line-range>
- Depth: <depth>

### Functional Summary
<one-sentence description>

### Detailed Explanation
<section-by-section explanation>

### Key Concepts
- <concept>: <description>

### Project Context
- Called from: <locations>
- Dependencies: <dependencies>
```

## Examples

```bash
/codex-explain src/service/order/order.service.ts
/codex-explain src/service/order/order.service.ts --lines 50-100
/codex-explain src/service/xxx.ts --depth deep
```
