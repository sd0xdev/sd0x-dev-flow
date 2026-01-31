---
description: Adversarial brainstorming. Claude and Codex independently research the project then debate until Nash equilibrium.
argument-hint: "<topic description>" [--constraints <constraints>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Bash(ls:*), Bash(find:*)
skills: codex-brainstorm
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Project structure: !`ls -la src/ 2>/dev/null | head -15`
- Services: !`ls src/service/ 2>/dev/null | head -10`
- Providers: !`ls src/provider/ 2>/dev/null | head -10`

## Task

Conduct adversarial brainstorming on the topic. **Both sides must independently research the project before** debating until Nash equilibrium is reached.

### Topic

```
$ARGUMENTS
```

### ⚠️ Key: Independent Research by Both Sides ⚠️

| Phase | Executor | Research Requirement                                   |
| ----- | -------- | ------------------------------------------------------ |
| 1     | Claude   | Use Read/Grep/Glob to research related code, form position |
| 2     | Codex    | **Independently execute** ls/grep/cat to research, form position |

**Forbidden**: Claude feeding its analysis results to Codex. Codex must research independently.

### Codex Independent Research Setup

Must use when calling Codex:

```typescript
mcp__codex__codex({
  prompt: '...',
  sandbox: 'read-only', // Allow file reading
  'approval-policy': 'on-failure', // Only confirm on command failure
});
```

### Execution Guide

Follow the workflow and templates in the skill:

| Phase          | Reference                                                  |
| -------------- | ---------------------------------------------------------- |
| Workflow       | @skills/codex-brainstorm/SKILL.md                  |
| Codex Research | @skills/codex-brainstorm/SKILL.md#phase-2          |
| Debate Techniques | @skills/codex-brainstorm/references/techniques.md |
| Equilibrium    | @skills/codex-brainstorm/references/equilibrium.md |
| Report Template| @skills/codex-brainstorm/references/templates.md   |

## Examples

```bash
/codex-brainstorm "How to design a high-concurrency cache system?"
/codex-brainstorm "User quota management feature" --constraints "cannot change existing API"
/codex-brainstorm "Redis vs MongoDB as cache layer?"
```
