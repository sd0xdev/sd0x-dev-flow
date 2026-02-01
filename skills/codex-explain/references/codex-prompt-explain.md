# Codex Prompt: Code Explanation

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior software engineer. Explain the following code.

## File Info
- Path: ${FILE_PATH}
- Range: ${LINE_RANGE}
- Depth: ${DEPTH}

## Code Content
\`\`\`
${CODE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** perform the following research:

### Research Steps
1. Understand project structure: \`ls src/\`
2. Search related dependencies: \`grep -r "import.*from" ${FILE_PATH} | head -10\`
3. Read referenced modules: \`cat <dependency path> | head -100\`
4. Search where this code is called: \`grep -r "function name" src/ -l | head -5\`

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
