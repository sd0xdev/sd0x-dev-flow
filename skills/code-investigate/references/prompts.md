# Code Investigate Codex Prompts

## Required Parameters

| Parameter         | Value       | Description                          |
| ----------------- | ----------- | ------------------------------------ |
| `sandbox`         | `read-only` | Force read-only, prevent accidental modification |
| `approval-policy` | `never`     | Auto-approve shell commands          |
| `cwd`             | Project root| Codex exploration starting point     |

## Standard Investigation Prompt

```typescript
mcp__codex__codex({
  prompt: `# Code Investigation Task

## Question
${userQuestion}

## Project Info
- Path: ${cwd}
- Tech Stack: {FRAMEWORK} + TypeScript + {DATABASE}

## Investigation Requirements

Please **independently explore** the codebase and answer the following:

1. **Related files**: Which files are related to this feature?
2. **Core logic**: What is the main processing flow?
3. **Data flow**: How does data flow (input -> processing -> output)?
4. **Key dependencies**: Which services/modules does it depend on?
5. **Edge cases**: What special handling exists?

## Exploration Suggestions

- Start tracing from the entrypoint
- Use grep to search for keywords
- Read related service/provider files
- Pay attention to DI-injected dependencies

Please provide your complete analysis.`,
  cwd: process.cwd(),
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Specific Feature Investigation

```typescript
mcp__codex__codex({
  prompt: `# Feature Investigation: ${featureName}

Project path: ${cwd}

Please independently explore this feature's implementation:

1. Find all related files
2. Trace the call chain
3. Understand data structures
4. Identify external dependencies

No hints needed from me -- please explore on your own and provide your analysis.`,
  cwd: process.cwd(),
  sandbox: 'read-only',
});
```

## Problem Tracking Investigation

```typescript
mcp__codex__codex({
  prompt: `# Problem Tracking

Problem description: ${problemDescription}

Project path: ${cwd}

Please investigate independently:
1. Potentially involved code areas
2. Potential problem points
3. Related logic branches
4. Possible root causes

Please explore on your own and provide your diagnosis.`,
  cwd: process.cwd(),
  sandbox: 'read-only',
});
```

## Prohibited Prompt Patterns

| Pattern            | Problem                           | Bad Example                                       |
| ------------------ | --------------------------------- | ------------------------------------------------- |
| Feeding conclusion | Claude's findings leak to Codex   | `Claude found these files: ${findings}, confirm`  |
| Leading question   | Presupposes answer, limits exploration | `I think problem is in cache, please verify`  |
| Scope restriction  | Prevents independent exploration  | `Only look at src/service/ directory`             |
| Confirmation question| Not exploration, just validation | `Is this understanding correct?`                  |

## Correct Prompt Principles

| Principle            | Description                      | Example                          |
| -------------------- | -------------------------------- | -------------------------------- |
| Only give question   | Don't share Claude's findings    | `How does order processing work?`|
| Only give project path| Let Codex explore on its own    | `cwd: '/path/to/project'`       |
| Open exploration     | Don't restrict search scope      | Don't add `only look at xxx dir` |
| Request independent analysis | Explicitly say "explore on your own" | `Please independently explore the codebase` |
