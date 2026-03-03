---
description: Industry best practices audit with adversarial debate.
argument-hint: "<topic>" [--scope <directory>]
allowed-tools: Read, Grep, Glob, WebSearch, WebFetch, mcp__codex__codex, mcp__codex__codex-reply
---

**Must read and follow the skill below before executing this command:**

@skills/best-practices/SKILL.md

## Context

- Project root: !`git rev-parse --show-toplevel`
- Project structure: !`ls -la src/ 2>/dev/null | head -15`

## Task

Conduct a best practices audit on the given topic. Follow the 4-phase workflow strictly: Industry Research, Codebase Analysis, Adversarial Debate (mandatory), Gap Report.

### Arguments

Parse from `$ARGUMENTS`:

| Argument | Description | Default |
|----------|-------------|---------|
| `<topic>` | The technology/practice to audit (first positional arg) | Required |
| `--scope <dir>` | Limit codebase analysis to directory | Project root |

```
$ARGUMENTS
```

### Key Requirements

- Phase 3 (adversarial debate via `codex-brainstorm`) is **mandatory** and cannot be skipped
- Phase 4 report must include the "Debate Conclusion" field referencing Phase 3 results
- Phase 1 must cite at least 3 independent sources
- Phase 2 must include specific code locations (file:line)

## Examples

```bash
/best-practices "Prometheus metrics design"
/best-practices "Redis caching strategy" --scope src/service/
/best-practices "error handling patterns"
```
