# Codex Invocation Rule ⚠️ CRITICAL

**Codex must independently research. Never feed conclusions.**

## Core Principle

```
Codex is a second pair of eyes — not a rubber stamp.
If you tell Codex the answer and ask "is this right?", you get zero value.
```

## Required: Independent Research Instructions

Every `mcp__codex__codex` call MUST include this section in the prompt:

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing, you **must** perform the following research:

### Git Exploration (Priority)
1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Read changed files: `cat <changed file> | head -200`

### Project Research
- Search related code: `grep -r "keyword" src/ --include="*.ts" -l`
- Read related files: `cat <file-path> | head -100`
```

## Prohibited Patterns

| Pattern | Example | Why It's Wrong |
|---------|---------|---------------|
| Feeding code | `"Here's the fix: \`\`\`code\`\`\` Is it correct?"` | Codex only sees what you show, can't find what you missed |
| Feeding conclusion | `"Claude found the bug is in X, confirm?"` | Presupposes the answer, Codex won't challenge it |
| Leading question | `"I think the problem is caching, verify?"` | Anchors Codex to your hypothesis |
| Scope restriction | `"Only look at src/service/"` | Prevents discovering issues in related files |
| Confirmation prompt | `"These fixes look good, right?"` | Invites agreement, not independent analysis |

## Correct Pattern

```typescript
// ✅ CORRECT: Give context + mandate independent exploration
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer...

## Git Diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

## ⚠️ You must independently research the project ⚠️
[... full research instructions ...]

## Review Dimensions
[... checklist ...]`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

```typescript
// ❌ WRONG: Feed fix and ask for confirmation
mcp__codex__codex({
  prompt: `Two issues were fixed:
1. simulate.ts: to field is now omitted...
2. summary.ts: Contract creation now returns...

\`\`\`typescript
// the fix code
\`\`\`

Are these fixes correct?`,
  sandbox: 'read-only',
});
```

## Enforcement Checklist

Before every `mcp__codex__codex` call, verify:

| Check | Required |
|-------|----------|
| Prompt includes "independently research" section | ✅ |
| Prompt includes concrete git/grep commands | ✅ |
| Prompt does NOT contain Claude's analysis results | ✅ |
| Prompt does NOT ask "is this correct/right?" | ✅ |
| `sandbox: 'read-only'` set (for review operations) | ✅ |
| `'approval-policy': 'never'` set | ✅ |
| Uses prompt template from `@skills/*/references/` | ✅ |

## Loop Review Exception

For `mcp__codex__codex-reply` (continuing a previous thread), providing the new diff is acceptable because Codex already has full project context from the initial review. But still:

- Provide the diff, not your interpretation of it
- Ask Codex to verify fixes, not confirm your fixes
- Include: "Did fixes introduce new issues?"
