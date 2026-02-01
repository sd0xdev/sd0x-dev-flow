# Codex Prompt Templates

## First Item Prompt (3a)

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior developer. Implement ONE specific item.

## Project Context (from Claude's research)
${PROJECT_CONTEXT}

## Current Item: #${N} — ${ITEM_TITLE}
${ITEM_DESCRIPTION}

## Target File
${TARGET_PATH}

## Existing Content (if any)
\`\`\`
${TARGET_CONTENT || '(new file)'}
\`\`\`

## Reference Files
${CONTEXT_CONTENT || 'None'}

## ⚠️ You MUST independently research and verify ⚠️

Do NOT blindly trust the context above. You must think and verify on your own.

### Phase 1: Understand the project
1. Read \`CLAUDE.md\` — tech stack, conventions, test commands
2. \`ls\` the source root, explore directory structure
3. Read \`package.json\` / \`pyproject.toml\` / \`go.mod\` — understand dependencies
4. Read existing docs in \`docs/\` if relevant to this item

### Phase 2: Study existing code
1. Search similar implementations: \`grep -rl "related keyword" <source-root> | head -10\`
2. Read 2-3 similar files end-to-end — understand patterns, not just function signatures
3. Understand interfaces, types, and data flow that your code will interact with
4. Check how errors are handled, how tests are structured

### Phase 3: Think before coding
Before writing any code, answer these questions to yourself:
- What exactly does this item need to do?
- What existing code will it call or be called by?
- What are the edge cases and failure modes?
- What tests are needed to prove it works?

### Phase 4: Implement and self-verify
1. Write the implementation
2. Write corresponding tests (unit test at minimum)
3. Run the project's test command to verify: \`grep -m1 "test" package.json\` or equivalent
4. If tests fail, fix until they pass — do NOT leave broken code

## Scope
- Implement ONLY this item: ${ITEM_TITLE}
- Do NOT implement other items
- Output complete, **verified** executable code
- Include necessary imports
- Include corresponding tests
- Follow project code style
- Add concise comments for key logic`,
  sandbox: 'workspace-write',
  'approval-policy': 'on-failure',
});
```

## Subsequent Item Prompt (3c)

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<saved threadId>',
  prompt: `Previous items implemented successfully. Now implement the next item.

## Current Item: #${N} — ${ITEM_TITLE}
${ITEM_DESCRIPTION}

## Target File
${TARGET_PATH}

## Current File Content
\`\`\`
${CURRENT_CONTENT}
\`\`\`

## Instructions
- Implement ONLY this item: ${ITEM_TITLE}
- Build on previously implemented code
- Do NOT modify previous items unless necessary
- Re-read any files you will modify to confirm current state
- Include corresponding tests for this item
- Run tests to verify your code works before finishing
- If tests fail, fix until they pass`,
});
```

## Modify Item Prompt (3b modify)

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<saved threadId>',
  prompt: `Modification requested for item #${N}:
${USER_FEEDBACK}

Please revise the implementation.
Re-read the affected files before making changes.
Run tests after fixing to verify.`,
});
```

## Review Fix Prompt

Used with `mcp__codex__codex-reply` when review finds issues:

```typescript
mcp__codex__codex-reply({
  threadId: '<saved threadId from Step 3>',
  prompt: `Review found the following issues. Fix them all.

## Review Findings
${REVIEW_FINDINGS}

## Current git diff
\`\`\`diff
${GIT_DIFF}
\`\`\`

Before fixing:
1. Re-read the affected files to understand current state
2. Understand WHY each issue was flagged
3. Think about whether the fix could break other code

Fix every issue. After fixing:
1. Run tests to verify nothing is broken
2. If tests fail, fix until they pass

Do NOT introduce new problems.
Do NOT modify code unrelated to the findings.`,
});
```
