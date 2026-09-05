# Codex Prompt: Code Explanation

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Code Explanation) -->

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start:

You are a senior software engineer. Explain the following code.

## File Info

- Path: ${FILE_PATH}
- Range: ${LINE_RANGE}
- Depth: ${DEPTH}

## Code Content

```
${CODE_CONTENT}
```

## ⚠️ Important: You must independently research the project ⚠️

Before explaining code, you **must** perform the following research:

### Research Steps

1. Understand the project structure — list the target file's own directory and the repository root; do not assume a `src/` layout, which many repositories (this one included) do not have
2. Search the target file's imports. **Its path is data, not shell source.** The safe form is a
   **single-quoted** literal, with any embedded apostrophe written as `'\''`:
   `grep -rn "import.*from" -- 'the/target/path.js' | head -10`. Neither `--` nor double quotes does
   this job, and saying otherwise is worse than saying nothing: `--` only ends *grep's* option
   parsing, and `$(…)` and backticks are still expanded **inside double quotes** — measured, a path
   named `draft$(printf injected).md` became `draftinjected.md` before the command ran. Single
   quotes suppress expansion outright, which is why they are the form named here
3. Read referenced modules: `cat <dependency path> | head -100`
4. Search where this code is called: `grep -rn "<symbol>" . --include="<the target's extension>" -l | head -5`, rooted at the repository, not at an assumed source directory

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
- Depends on which modules
