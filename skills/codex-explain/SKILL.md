---
name: codex-explain
description: "Explain complex code via Codex MCP. Use when: understanding complex logic, tracing data flow, onboarding to unfamiliar code. Not for: code review (use codex-code-review), exploration (use code-explore). Output: structured explanation at chosen depth."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob
---

# Codex Explain Skill

## Trigger

- Keywords: explain code, what does this do, how does this work, code walkthrough

## When NOT to Use

- Code review (use `codex-code-review`)
- Bug investigation (use `bug-fix` or `issue-analyze`)
- Architecture overview (use `code-explore`)

## Workflow

```
Read target → [Collect context] → Codex explain → Output explanation
```

### Step 1: Read Target File

Read file content. If `--lines` specified, extract only that range.

### Step 2: Codex Explanation

Use `mcp__codex__codex` with explanation prompt. See @references/codex-prompt-explain.md.

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

## Depth Levels

| Level  | Description                                          |
| ------ | ---------------------------------------------------- |
| brief  | One-sentence summary                                 |
| normal | Functional overview + execution flow + key concepts (default) |
| deep   | + Design patterns + complexity + issues + dependencies |

## Output

```markdown
## Code Explanation: <target>
- **Depth**: brief / normal / deep
- **Summary**: <functional overview>
- **Execution flow**: <key paths>
- **Key concepts**: <patterns, abstractions>
```

## Verification

- [ ] Codex independently researched project context (imports, callers)
- [ ] Explanation matches requested depth level
- [ ] Key concepts are identified and explained

## References

- Explanation prompt: `references/codex-prompt-explain.md`

## Examples

```
Input: /codex-explain src/service/order/order.service.ts
Action: Read file → Codex explain (normal) → Functional summary + detailed explanation

Input: /codex-explain src/service/xxx.ts --depth deep
Action: Read file → Codex explain (deep) → Patterns + complexity + issues

Input: /codex-explain src/xxx.ts --lines 50-100
Action: Read lines 50-100 → Codex explain → Focused explanation
```
