---
description: OWASP Top 10 security review using Codex MCP. Supports review loop with context preservation.
argument-hint: [--scope <dir>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/security-review/SKILL.md
@skills/security-review/references/codex-prompt-security.md

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

OWASP Top 10 security review using Codex MCP.

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                          |
| ----------------------- | ------------------------------------ |
| `--scope <dir>`         | Review scope (default: `src/`)       |
| `--continue <threadId>` | Continue a previous review session   |

### Workflow

```
Determine scope → Collect changes → Codex OWASP review → Findings + Gate → Loop if Must fix
```

1. **Determine scope**: Parse `--scope`, default `src/`
2. **Collect changes**: Uncommitted diff → recent commits → key security files
3. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
4. **Output**: Findings summary table + detailed findings (OWASP category, impact, fix, test) + Gate

### Key Rules

- **Codex must independently research** — search auth, input validation, sensitive operations
- **Save `threadId`** — for review loop continuation
- **OWASP A01-A10** — full checklist coverage
- **Each finding includes** — location, OWASP type, impact, fix, verification test
- **Gate sentinels** — output `✅ Mergeable` or `⛔ Must fix` for hook parsing

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

```markdown
## Security Review Report

### Review Scope
- Scope: <dir>
- Changed lines: <lines>

### Findings Summary
| Level | Count | Type |
| :---: | :---: | :--- |
|  P0   |   N   | ...  |
|  P1   |   N   | ...  |

### Detailed Findings
#### [P0] <Issue Title>
- **Location**: file:line
- **Type**: OWASP Category
- **Impact**: Potential harm
- **Fix**: Specific recommendation
- **Test**: Verification method

### Gate
✅ Mergeable / ⛔ Must fix (N P0 issues)

### Loop Review
To re-review after fixes: `/codex-security --continue <threadId>`
```

## Examples

```bash
/codex-security
/codex-security --scope src/controller/
/codex-security --continue abc123
```

## Related Commands

| Command      | Description               |
| ------------ | ------------------------- |
| `/dep-audit` | Dependency security audit |
