---
description: Context-aware next step advisor. Analyzes conversation, git state, and file changes to suggest optimal next action.
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(cat .claude_review_state.json*), Bash(ls:*)
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/next-step/SKILL.md

## Context

- Git branch: !`git branch --show-current`
- Git status: !`git status -sb`
- Changed files: !`git diff --name-only HEAD 2>/dev/null | head -50`
- Review state: !`cat .claude_review_state.json 2>/dev/null || echo "no state file"`

## Task

Analyze current context and suggest the optimal next step(s).

### Workflow

1. **Collect signals** — conversation history + injected context above
2. **Determine work type** — from branch pattern or conversation
3. **Identify current phase** — from executed commands + review state
4. **Output suggestions** — 1-3 prioritized next steps

### Key Rules

- Suggest, don't execute — user decides what to run
- Use non-command suggestions when appropriate (requirements unclear, need human decision)
- Check document completeness for feature branches
- Respect the progression tables in SKILL.md

## Examples

```bash
/next-step
```
