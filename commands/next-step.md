---
description: Change-aware next step advisor. Runs deterministic analysis on git state, then suggests actionable next steps or session summary.
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node skills/next-step/scripts/analyze.js*), Bash(cat .claude_review_state.json*), Bash(ls:*), Skill
argument-hint: "[--go] [--feature <key>]"
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/next-step/SKILL.md

## Context

- Script analysis: !`node skills/next-step/scripts/analyze.js --json 2>/dev/null; true`
- Git branch: !`git branch --show-current`
- Git status: !`git status -sb`
- Review state: !`cat .claude_review_state.json 2>/dev/null || echo "no state file"`
- Feature listing: !`ls -1 docs/features 2>/dev/null || echo "no features"`

## Task

Run the analyze script (forwarding any `--feature <key>` arg), then format findings or session summary per SKILL.md.

### Arguments

| Arg | Description |
|-----|-------------|
| `--go` | Auto-dispatch top next_action if confidence >= 0.8 and no P0 |
| `--feature <key>` | Override feature context (skips branch/diff detection) |

### Workflow

1. **Parse script output** — JSON with findings, gates, diff summary, phase, feature_context, next_actions, backlog
2. **If script failed** — fall back to manual signal collection (branch + status + review state)
3. **Format output** — Findings Mode (P0/P1 exist) / Post-Precommit (doc sync) / Feature Complete (backlog) / Session Summary (no P0/P1, all gates pass; P2/P3 as oversights)
4. **If `--go` flag** — auto-dispatch top action per Dispatch Mode rules in SKILL.md
5. **Otherwise** — suggest, don't execute (user decides what to run)

### Key Rules

- Format top 3 findings as actionable suggestions
- When all gates pass: output session summary with commit seed, NOT "commit/push"
- Use non-command suggestions when appropriate (requirements unclear, need human decision)
- Check document completeness for feature branches
- In dispatch mode (`--go`), invoke the Skill tool for the top next_action

## Examples

```bash
/next-step
/next-step --go
/next-step --feature plugin-testing
/next-step --go --feature my-feature
```
