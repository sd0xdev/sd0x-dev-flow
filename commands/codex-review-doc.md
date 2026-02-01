---
description: Review documents using Codex MCP. Supports review loop with context preservation.
argument-hint: [<file-path>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Glob
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/doc-review/SKILL.md
@skills/doc-review/references/codex-prompt-doc.md

## Context

- Git modified docs: !`git diff --name-only HEAD 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Git staged docs: !`git diff --cached --name-only 2>/dev/null | grep -E '\.(md|txt)$' | head -5`
- Untracked docs: !`git ls-files --others --exclude-standard 2>/dev/null | grep -E '\.(md|txt)$' | head -5`

## Task

Review documents using Codex MCP (5 review dimensions + rating table).

### Arguments

```
$ARGUMENTS
```

| Parameter               | Description                              |
| ----------------------- | ---------------------------------------- |
| `<file-path>`           | File path (optional, auto-detect)        |
| `--continue <threadId>` | Continue a previous review session       |

### Workflow

```
Determine target → Read content → Codex review → Rating table + Gate → Loop if Needs revision
```

1. **Determine target**: Use specified path, or auto-detect changed `.md` files
2. **Read content**: Read full file content
3. **Codex review**: New session (`mcp__codex__codex`) or continue (`mcp__codex__codex-reply`)
4. **Output**: Rating table (5 dimensions) + severity-grouped findings + Gate

### Key Rules

- **Codex must verify code-documentation consistency** — grep/cat to check referenced files exist
- **Save `threadId`** — for review loop continuation
- **5 review dimensions** — Architecture, Performance, Security, Doc Quality, Code Consistency
- **Gate sentinels** — output `✅ Mergeable` or `⛔ Needs revision` for hook parsing

### Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

## Output

```markdown
## Document Review Report

### Reviewed Document
- Path: <file-path>

### Review Summary
| Dimension              | Rating     | Notes |
|------------------------|------------|-------|
| Architecture Design    | ⭐⭐⭐⭐☆ | ...   |
| Performance            | ⭐⭐⭐☆☆  | ...   |
| Security               | ⭐⭐⭐⭐⭐ | ...   |
| Documentation Quality  | ⭐⭐⭐⭐☆ | ...   |
| Code Consistency       | ⭐⭐⭐☆☆  | ...   |

### 🔴 Must Fix (P0/P1)
- [Section/Line] Issue → Fix recommendation

### Gate
✅ Mergeable / ⛔ Needs revision (N 🔴 items)

### Loop Review
To re-review after revisions: `/codex-review-doc --continue <threadId>`
```

## Examples

```bash
/codex-review-doc docs/features/xxx/tech-spec.md
/codex-review-doc
/codex-review-doc --continue abc123
```

## Related Standards

- @rules/docs-writing.md
