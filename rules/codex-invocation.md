# Codex Invocation Rule ⚠️ CRITICAL

**Codex must independently research. Never feed it your conclusions.**

Codex is a second pair of eyes, not a rubber stamp. Tell it the answer and ask "is this right?" and you have paid full price for agreement.

## Required in every `mcp__codex__codex` prompt

Give **metadata** (changed file list, diff stats, the task) and mandate exploration. Never paste the diff or the code itself — Codex has sandbox access and finds what you did not think to show it.

```
## ⚠️ Important: You must independently research the project ⚠️

### Git Exploration (Priority)
1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Read changed files: `cat <changed file> | head -200`

### Project Research
- Search related code: `grep -r "keyword" src/ --include="*.ts" -l`
- Read related files: `cat <file-path> | head -100`
```

Config for review operations: `sandbox: 'read-only'`, `'approval-policy': 'never'`. Use the prompt template from `@skills/*/references/` rather than composing one ad hoc.

## Prohibited patterns

| Pattern | Example | Why it's wrong |
|---------|---------|---------------|
| Feeding full diff/content | `"## Git Diff \`\`\`diff … 2000 lines …\`\`\`"` | Burns tokens and hands Codex a truncated slice instead of full context |
| Feeding code | `"Here's the fix: \`\`\`code\`\`\` Is it correct?"` | Codex sees only what you showed; it cannot find what you missed |
| Feeding conclusion | `"Claude found the bug is in X, confirm?"` | Presupposes the answer — Codex will not challenge it |
| Leading question | `"I think the problem is caching, verify?"` | Anchors Codex to your hypothesis |
| Scope restriction | `"Only look at src/service/"` | Prevents discovery in related files, which is where the second opinion pays |
| Confirmation prompt | `"These fixes look good, right?"` | Invites agreement, not analysis |

The shared shape: every one of these narrows what Codex can find to what you already believe. If the prompt could not possibly produce a finding that surprises you, it is not a review.

## Loop review exception

For `mcp__codex__codex-reply` (continuing a thread), providing the new diff is fine — Codex already has project context from the first pass. Still: give the diff, not your reading of it; ask it to *verify* the fixes, not confirm them; and always include "Did the fixes introduce new issues?"
