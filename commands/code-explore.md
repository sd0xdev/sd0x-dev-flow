---
description: Pure Claude code investigation. Quickly deep-dive into codebase — trace execution paths, understand architecture, diagnose issues.
argument-hint: '<investigation target or question>'
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*)
skills: code-explore
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Services: !`ls src/service/ 2>/dev/null | head -10`
- Providers: !`ls src/provider/ 2>/dev/null | head -10`

## Task

Investigate code using pure Claude, without Codex.

### Investigation Target

```
$ARGUMENTS
```

### Execution Guide

Follow the 4-phase workflow in the skill:

| Phase | Name          | Action                                       |
| ----- | ------------- | -------------------------------------------- |
| 1     | Locate Entry  | Grep/Glob to find related files              |
| 2     | Trace Path    | Read entry points -> trace dependencies      |
| 3     | Understand    | Analyze core logic, data flow, error handling |
| 4     | Output Report | Architecture diagram + key files + flow       |

### References

| File                                                       | Purpose              |
| ---------------------------------------------------------- | -------------------- |
| @skills/code-explore/SKILL.md                      | Full workflow        |
| @skills/code-explore/references/search-patterns.md | Search pattern ref   |

## Examples

```bash
# Feature understanding
/code-explore "How is token balance queried"

# Problem diagnosis
/code-explore "Why is NFT metadata sometimes empty"

# Architecture understanding
/code-explore "Overall architecture of the user module"
```

## Difference from /code-investigate

| Dimension   | /code-explore            | /code-investigate        |
| ----------- | ------------------------ | ------------------------ |
| Speed       | Fast (single perspective)| Slow (dual perspective)  |
| Confidence  | Single perspective       | Cross-validated          |
| Tools       | Pure Claude              | Claude + Codex           |
| Best for    | Quick investigation, daily understanding | Important decisions, need confirmation |
