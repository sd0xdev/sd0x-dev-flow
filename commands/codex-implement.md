---
description: Implement feature code using Codex MCP, writing directly to files
argument-hint: "<requirement>" [--target <file>] [--context <files>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob, Edit, Write, AskUserQuestion
---

## Context

- Git status: !`git status --short | head -5`

## Task

You will use Codex MCP to implement feature code.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter           | Description                            |
| ------------------- | -------------------------------------- |
| `"<requirement>"`   | Required, requirement description      |
| `--target <file>`   | Optional, target file path             |
| `--context <files>` | Optional, reference files (comma-separated) |

### Step 1: Parse Requirements

**If `$ARGUMENTS` provided**: Use directly

**If no arguments**: Ask the user:

1. What is the requirement?
2. Which file to modify/create?
3. Any reference files needed?

### Step 2: Collect Context

Before running Codex, collect relevant information:

1. If target file specified, read existing content
2. If context files specified, read reference code
3. Search for similar existing implementations as reference

### Step 3: Execute Codex Implementation

Use `mcp__codex__codex` tool:

```typescript
mcp__codex__codex({
  prompt: `You are a senior developer. Implement feature code based on requirements.

## Requirement Description
${REQUIREMENT}

## Target File
${TARGET_PATH || 'TBD'}

## Existing Content (if any)
\`\`\`typescript
${TARGET_CONTENT || '(new file)'}
\`\`\`

## Reference Files
${CONTEXT_CONTENT || 'None'}

## ⚠️ Important: You must independently research the project ⚠️

Before implementing code, you **must** perform the following research:

### Research Steps
1. Read \`CLAUDE.md\` (or repo root docs) to learn the tech stack and conventions
2. Identify the source root and list top-level directories: \`ls\`, \`ls src/\` (or equivalent)
3. Search similar implementations: \`grep -rl "related keyword" <source-root> | head -10\`
4. Read 2-3 similar files for style reference: \`cat <similar file> | head -150\`
5. Search existing error handling patterns: \`grep -r "throw\\|raise\\|Error" <source-root> | head -10\`

### Verification Focus
- What design patterns does the project use?
- What is the existing code style? (naming, indentation, comments)
- How are similar features implemented?
- What error handling pattern is used?

## Project Architecture
Detect from CLAUDE.md and project files. Do NOT assume any specific stack.

## Code Style Guidelines
1. **Research first** — read 2-3 similar files to learn the project's conventions
2. Match existing patterns (naming, error handling, module system, DI if present)
3. Use async/await, avoid callbacks
4. Add necessary type annotations (if TypeScript project)
5. Follow the project's existing error handling pattern

## Output Requirements
1. Output complete executable code
2. Include all necessary imports
3. Follow project code style (based on research)
4. Add concise comments for key logic
5. Consider error handling and edge cases

Output code directly, no additional explanation.`,
  sandbox: 'workspace-write',
  'approval-policy': 'on-failure',
});
```

### Step 4: Confirm Changes

After execution, use `git diff` to show changes and ask the user:

```
Accept these changes?
1. ✅ Accept - Keep changes, proceed to review
2. ❌ Reject - Revert changes
3. 🔄 Modify - Provide modification suggestions, regenerate
```

**If rejected**:

```bash
git checkout .
git clean -fd
```

**If modify**: Collect modification suggestions, use `mcp__codex__codex-reply` to regenerate

### Step 5: Auto Review

After user accepts, **must** execute:

```bash
/codex-review-fast
```

## Review Loop

**⚠️ Follow @CLAUDE.md review loop rules: must re-review after fix until ✅ PASS ⚠️**

## Output

````markdown
## Codex Implementation Report

### Requirement

<requirement>

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
# Basic implementation
/codex-implement "Add a method to calculate fees"

# Specify target file
/codex-implement "Add getUserBalance method" --target src/service/wallet.service.ts

# With reference files
/codex-implement "Implement cache logic" --target src/service/cache.ts --context src/service/redis.ts
````
