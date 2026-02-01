---
description: Implement feature code using Codex MCP, writing directly to files
argument-hint: "<requirement>" [--target <file>] [--context <files>] [--spec <doc>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion, Skill
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/codex-implement/SKILL.md

## Context

- Git status: !`git status --short | head -5`

## Task

Use Codex MCP to implement feature code **one item at a time**.

### Arguments

```
$ARGUMENTS
```

| Parameter           | Description                            |
| ------------------- | -------------------------------------- |
| `"<requirement>"`   | Required, requirement description      |
| `--target <file>`   | Optional, target file path             |
| `--context <files>` | Optional, reference files (comma-separated) |
| `--spec <doc>`      | Optional, tech spec or request doc path |

### Workflow

```
Parse → Decompose → Claude collects context → Codex implements per item → Review loop
```

1. **Decompose**: Read spec/requirement, break into items (one interface/method/endpoint each), present dependency table to user
2. **Context**: Claude reads CLAUDE.md, target files, similar code — summarizes as PROJECT_CONTEXT
3. **Iterate**: For each item, call Codex (`codex` for first, `codex-reply` for rest) → `git diff` → user confirms
4. **Review**: `/codex-review-fast` → `/precommit` — issues found → `codex-reply` on same thread to fix → re-review

### Key Rules

- **One item per Codex call** — never batch multiple items
- **Claude researches, Codex implements** — don't make Codex explore blindly
- **Same thread throughout** — use `codex-reply` with saved `threadId` for subsequent items and fixes
- **Tests required** — every item needs corresponding tests; if Codex omits, request via `codex-reply`
- **Codex self-verifies** — must run tests before finishing each item
- **Review loop uses Codex** — fixes go through `codex-reply`, not manual edits

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Examples

```bash
/codex-implement "Add a method to calculate fees"
/codex-implement "Implement wallet service" --spec docs/features/wallet/2-tech-spec.md
/codex-implement "Add getUserBalance method" --target src/service/wallet.service.ts
/codex-implement "Implement cache logic" --target src/service/cache.ts --context src/service/redis.ts
```
