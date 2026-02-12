---
description: Uncommitted code risk assessment — breaking changes, blast radius, scope analysis.
allowed-tools: Read, Grep, Glob, Bash(node skills/risk-assess/scripts/risk-analyze.js*), Bash(git:*)
argument-hint: "[--mode fast|deep] [--base <ref>]"
---

@skills/risk-assess/SKILL.md

## Context

- Risk result: !`node skills/risk-assess/scripts/risk-analyze.js --json 2>/dev/null; true`

## Task

Run the risk analysis script, then format the results with qualitative interpretation per SKILL.md.

### Arguments

| Arg | Description |
|-----|-------------|
| `--mode fast\|deep` | Fast (default) or deep analysis with churn/hotspots |
| `--base <ref>` | Compare against specific ref (default: HEAD) |

### Workflow

1. **Parse script output** — JSON with overall_score, risk_level, dimensions, flags, gate, next_actions
2. **If script failed** — report error, suggest manual run
3. **If High+** — auto-escalate to `--mode deep` if not already deep
4. **Format output** — per risk level (Low/Medium/High/Critical) per SKILL.md
5. **Add interpretation** — qualitative notes beyond raw scores
6. **List next actions** — prioritized improvement suggestions

## Examples

```bash
/risk-assess
/risk-assess --mode deep
/risk-assess --base HEAD~3
```
