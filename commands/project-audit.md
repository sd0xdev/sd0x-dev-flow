---
description: Project health audit with deterministic multi-dimension scoring. Evaluates OSS readiness, robustness, scope, runnability, and stability.
allowed-tools: Read, Grep, Glob, Bash(node skills/project-audit/scripts/audit.js*), Bash(git:*), Bash(ls:*)
argument-hint: "[--dir <path>]"
---

@skills/project-audit/SKILL.md

## Context

- Audit result: !`node skills/project-audit/scripts/audit.js --json 2>/dev/null; true`

## Task

Run the audit script, then format the results with qualitative interpretation per SKILL.md.

### Arguments

| Arg | Description |
|-----|-------------|
| `--dir <path>` | Audit a specific directory (default: current git repo root) |

### Workflow

1. **Parse script output** — JSON with overall_score, status, dimensions, checks, findings, next_actions
2. **If script failed** — report error, suggest manual run
3. **Format output** — Blocked (P0) / Needs Work (P1) / Healthy per SKILL.md
4. **Add interpretation** — qualitative notes beyond raw scores
5. **List next actions** — prioritized improvement suggestions

## Examples

```bash
/project-audit
/project-audit --dir /path/to/other/project
```
