---
description: Change-aware next step advisor. Runs deterministic analysis on git state, then suggests actionable next steps or session summary.
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node skills/next-step/scripts/analyze.js*), Bash(cat .claude_review_state.json*), Bash(ls:*)
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/next-step/SKILL.md

## Context

- Script analysis: !`node skills/next-step/scripts/analyze.js --json 2>/dev/null; true`
- Git branch: !`git branch --show-current`
- Git status: !`git status -sb`
- Review state: !`cat .claude_review_state.json 2>/dev/null || echo "no state file"`

## Task

Run the analyze script, then format findings or session summary per SKILL.md.

### Workflow

1. **Parse script output** — JSON with findings, gates, diff summary
2. **If script failed** — fall back to manual signal collection (branch + status + review state)
3. **Format output** — Findings Mode (P0/P1 exist) or Session Summary (no P0/P1, all gates pass; P2/P3 as oversights)
4. **Suggest, don't execute** — user decides what to run

### Key Rules

- Format top 3 findings as actionable suggestions
- When all gates pass: output session summary with commit seed, NOT "commit/push"
- Use non-command suggestions when appropriate (requirements unclear, need human decision)
- Check document completeness for feature branches

## Examples

```bash
/next-step
```
