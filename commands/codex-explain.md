---
description: Explain complex code logic using Codex MCP
argument-hint: <file-path> [--lines <start>-<end>] [--depth brief|normal|deep]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob
---

## Context

- Git status: !`git status -sb`

## Task

You will use Codex MCP to explain code logic.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `<file-path>`           | Required, file to explain                      |
| `--lines <start>-<end>` | Optional, specify line range                   |
| `--depth <level>`       | Optional, explanation depth (brief/normal/deep)|

### Depth Levels

| Level  | Description                                          |
| ------ | ---------------------------------------------------- |
| brief  | One-sentence summary                                 |
| normal | Standard explanation (default)                       |
| deep   | In-depth: design patterns, complexity, potential issues |

### Step 1: Read Target File

```bash
Read(FILE_PATH)
```

If `--lines` specified, extract only that range of code.

### Step 2: Execute Codex Explanation

Use `mcp__codex__codex` tool:

```typescript
mcp__codex__codex({
  prompt: `You are a senior software engineer. Explain the following code.

## File Info
- Path: ${FILE_PATH}
- Range: ${LINE_RANGE}
- Depth: ${DEPTH}

## Code Content
\`\`\`typescript
${CODE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** perform the following research:

### Research Steps
1. Understand project structure: \`ls src/\`
2. Search related dependencies: \`grep -r "import.*from" ${FILE_PATH} | head -10\`
3. Read referenced modules: \`cat <dependency path> | head -100\`
4. Search where this code is called: \`grep -r "function name" src/ --include="*.ts" -l | head -5\`

### Verification Focus
- What role does this code play in the project?
- How does it interact with other modules?
- Where is this code called from?

## Explanation Requirements (by depth)

### brief
One-sentence functional summary.

### normal
1. Functional overview
2. Execution flow (step-by-step breakdown)
3. Key concept explanation

### deep
1. Functional overview
2. Execution flow (step-by-step breakdown)
3. Design patterns used
4. Time/space complexity
5. Potential issues or improvement suggestions
6. Dependency analysis

## Output Format

### Functional Summary
<one-sentence description>

### Detailed Explanation
<section-by-section explanation>

### Key Concepts
- <concept1>: <description>
- <concept2>: <description>

### Project Context (based on research)
- Called by which modules
- Depends on which modules`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Output

```markdown
## Code Explanation Report

### File Info

- Path: <file-path>
- Range: <line-range>
- Depth: <depth>

### Functional Summary

<one-sentence description>

### Detailed Explanation

<section-by-section explanation>

### Key Concepts

- <concept>: <description>

### Project Context

- Called from: <locations>
- Dependencies: <dependencies>
```

## Examples

```bash
# Explain entire file
/codex-explain src/service/order/order.service.ts

# Explain specific line range
/codex-explain src/service/order/order.service.ts --lines 50-100

# Deep analysis
/codex-explain src/service/xxx.ts --depth deep
```
