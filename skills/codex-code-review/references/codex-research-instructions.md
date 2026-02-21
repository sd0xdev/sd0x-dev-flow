# Codex Independent Research Instructions

Shared boilerplate for all Codex MCP prompt templates. Each template should reference this file instead of inlining the research block.

## Standard Research Block (Code Review)

Include this block verbatim in code review prompts (fast, full, branch):

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing code, you **must** perform the following research, do not rely only on the diff above:

### Git Exploration (Priority)
1. Check change status: \`git status\`
2. Check changed files: \`git diff --name-only HEAD\`
3. Check full changes for specific file: \`git diff HEAD -- <file-path>\`
4. Check full content of changed files: \`cat <changed file> | head -200\`

### Project Research
- Search called functions: \`grep -r "functionName" src/ -l | head -10\`
- Read related files: \`cat <file-path> | head -100\`
- Understand class definitions: \`grep -A 20 "class ClassName" src/\`
```

## Variant: Document Review

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing documents, you **must** verify code-documentation consistency:

### Research Steps
1. Check project structure: \`ls src/\`
2. Search related code: \`grep -r "keyword" src/ -l | head -10\`
3. Read related files: \`cat <file-path> | head -100\`
```

## Variant: Security Review

```
## ⚠️ Important: You must independently research the project ⚠️

Security review requires full context. You **must** independently research:

1. \`grep -r "auth\\|token\\|session" src/ -l | head -10\`
2. \`grep -r "@Body\\|@Query\\|@Param" src/ -A 5 | head -50\`
3. \`grep -r "password\\|secret\\|key" src/ -l\`
```

## Variant: Test Review / Test Gen

```
## ⚠️ Important: You must independently research the project ⚠️

When reviewing test coverage, you **must** perform the following research:

### Research Steps
1. Check project structure: \`ls src/\`, \`ls test/\`
2. Search related code: \`grep -r "className" src/ -l | head -10\`
3. Read source file: \`cat <source path> | head -150\`
4. Check existing tests: \`ls test/unit/\` or \`cat test/unit/xxx.test.ts | head -50\`
```

## Variant: Code Explanation

```
## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** independently research:

### Research Steps
1. Check project structure: \`ls src/\`
2. Trace imports: \`grep -r "import.*from" ${FILE_PATH} | head -10\`
3. Read dependencies: \`cat <dependency path> | head -100\`
4. Find callers: \`grep -r "function name" src/ -l | head -5\`
```
