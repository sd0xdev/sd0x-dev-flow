---
description: Implement feature code using Codex MCP, writing directly to files
argument-hint: "<requirement>" [--target <file>] [--context <files>] [--spec <doc>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion
---

## Context

- Git status: !`git status --short | head -5`

## Task

You will use Codex MCP to implement feature code **one item at a time**.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter           | Description                            |
| ------------------- | -------------------------------------- |
| `"<requirement>"`   | Required, requirement description      |
| `--target <file>`   | Optional, target file path             |
| `--context <files>` | Optional, reference files (comma-separated) |
| `--spec <doc>`      | Optional, tech spec or request doc path |

### Step 1: Parse & Decompose Requirements

**If `--spec` provided**: Read the spec/request doc and extract individual requirement items.

**If `$ARGUMENTS` provided without `--spec`**: Use directly as a single item.

**If no arguments**: Ask the user:

1. What is the requirement? (or provide a tech spec path)
2. Which file to modify/create?
3. Any reference files needed?

#### Decomposition Rules

Break requirements into **implementation items**, each item should be:

- One logical unit (e.g., one interface, one service method, one API endpoint)
- Implementable independently or in dependency order
- Small enough for a single Codex call

Present the plan to the user before starting:

```
Found N implementation items:

| # | Item              | Target File          | Depends On |
|---|-------------------|----------------------|------------|
| 1 | Define interfaces | src/interface/x.ts   | -          |
| 2 | Core logic        | src/service/x.ts     | 1          |
| 3 | Error handling    | src/service/x.ts     | 2          |
| 4 | Controller/Route  | src/controller/x.ts  | 2          |

Proceed with implementation?
```

### Step 2: Collect Context (Claude does this, NOT Codex)

Before calling Codex, **Claude** researches the codebase:

1. Read `CLAUDE.md` to learn tech stack and conventions
2. If target file specified, read existing content
3. If context files specified, read reference code
4. Search for similar existing implementations
5. Read 2-3 similar files to understand patterns

Summarize findings as `PROJECT_CONTEXT` to pass to Codex.

### Step 3: Iterative Codex Implementation

Implement items **one at a time**, in dependency order.

#### 3a: First item — start new Codex session

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

## Research Instructions
Before writing code, you **must** research:
1. Read \`CLAUDE.md\` for conventions
2. \`ls\` the source root to understand structure
3. Search similar implementations: \`grep -rl "related keyword" <source-root> | head -10\`
4. Read 1-2 similar files for style reference

## Scope
- Implement ONLY this item: ${ITEM_TITLE}
- Do NOT implement other items
- Output complete executable code for this item only
- Include necessary imports
- Follow project code style
- Add concise comments for key logic`,
  sandbox: 'workspace-write',
  'approval-policy': 'on-failure',
});
```

**Save the returned `threadId`.**

#### 3b: Show diff and confirm before next item

After each Codex call:

1. Run `git diff` to show changes
2. Ask the user:

```
Item #N complete. Accept?
1. ✅ Accept — continue to next item
2. ❌ Reject — revert this item
3. 🔄 Modify — provide feedback, regenerate
```

**If accepted**: Proceed to next item (3c).

**If rejected**: `git checkout .` for the affected files, then re-attempt the same item from 3a/3c (max 2 retries per item; after 2 failures, skip and report as ⛔).

**If modify**: Use `mcp__codex__codex-reply` with the same `threadId`, then loop back to 3b to confirm again:

```typescript
mcp__codex__codex-reply({
  threadId: '<saved threadId>',
  prompt: `Modification requested for item #${N}:
${USER_FEEDBACK}

Please revise the implementation.`,
});
// → loop back to 3b (show diff, confirm)
```

#### 3c: Subsequent items — continue same thread

Use `mcp__codex__codex-reply` to maintain context:

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

## Scope
- Implement ONLY this item: ${ITEM_TITLE}
- Build on previously implemented code
- Do NOT modify previous items unless necessary`,
});
```

Repeat 3b → 3c until all items are done.

### Step 4: Final Confirmation

After all items are implemented:

1. Run `git diff` to show the complete changeset
2. Ask the user for final confirmation

### Step 5: Auto Review & Full Verification

After user accepts, **must** execute the full review cycle. Scope is smaller per item, but **nothing can be skipped**:

| Step | Command | What it checks |
|------|---------|---------------|
| 1 | `/codex-review-fast` | Code quality, correctness, security |
| 2 | `/precommit` | lint:fix → build → test:unit |

#### Test Requirements

Implementation is **not complete** without corresponding tests:

| Change Type | Required Tests |
|-------------|---------------|
| New service/provider | Unit tests (happy path + error + edge cases) |
| New API endpoint | Unit + integration tests |
| Modified logic | Existing tests pass + new tests for new logic |
| Bug fix scenario | Regression test |

If Codex did not generate tests, **Claude must add them** before proceeding to review.

## Review Loop

**⚠️ Follow @CLAUDE.md auto-loop rules: fix → re-review → fix → ... → ✅ PASS ⚠️**

- Review found issues → fix all → re-run `/codex-review-fast` (same reply, no stopping)
- Review passed → run `/precommit`
- Precommit failed → fix → re-run `/precommit`
- All passed → done

## Output

````markdown
## Codex Implementation Report

### Requirement

<requirement or spec doc reference>

### Implementation Items

| # | Item | Target File | Status |
|---|------|-------------|--------|
| 1 | ...  | ...         | ✅/❌  |
| 2 | ...  | ...         | ✅/❌  |

### Change Summary

| File | Operation     | Description |
| ---- | ------------- | ----------- |
| ...  | Create/Modify | ...         |

### Change Details

```diff
<git diff output>
```
````

### User Confirmation

- [ ] Accept changes

### Review Result

<codex-review-fast output>

### Gate

✅ Implementation complete and review passed / ⛔ Needs modification

````

## Examples

```bash
# Basic — single item
/codex-implement "Add a method to calculate fees"

# From tech spec — auto-decompose into items
/codex-implement "Implement wallet service" --spec docs/features/wallet/2-tech-spec.md

# Specify target file
/codex-implement "Add getUserBalance method" --target src/service/wallet.service.ts

# With reference files
/codex-implement "Implement cache logic" --target src/service/cache.ts --context src/service/redis.ts
````
