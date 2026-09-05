---
name: code-investigate
description: "Dual-perspective code investigation. Use when: deep code analysis needing both Claude and Codex perspectives. Not for: quick exploration (use code-explore), code review (use codex-code-review). Output: integrated findings from dual analysis."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*), Write
context: fork
---

# Code Investigate Skill

## Trigger

- Keywords: investigate code, how feature works, trace implementation, dual confirmation, deep dive, how code works, what this code does, code research

## When NOT to Use

- Just need quick lookup (use Grep/Glob directly)
- Code review (use codex-review)
- System verification (use feature-verify)
- Git history tracking (use git-investigate)

## Core Principle

```
Codex must explore independently. Feeding Claude's conclusions to Codex is prohibited.
```

```
┌─────────────────┐     ┌─────────────────┐
│ Claude Explores  │     │ Codex Explores   │
│ Independently    │     │ Independently    │
│   (Phase 1-2)   │     │    (Phase 3)     │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
   ┌───────────┐           ┌───────────┐
   │ Claude    │           │ Codex     │
   │ Conclusion│           │ Conclusion│
   └─────┬─────┘           └─────┬─────┘
         │                       │
         └───────────┬───────────┘
                     ▼
              ┌─────────────┐
              │ Consolidated│
              │   Report    │
              │  (Phase 4)  │
              └─────────────┘
```

## Workflow

| Phase | Name            | Action                              | Output                      |
| ----- | --------------- | ----------------------------------- | --------------------------- |
| 1     | Claude Explore  | Grep/Glob/Read to search code       | Related files list          |
| 2     | Claude Conclude | Analyze logic, form understanding   | Initial conclusion (internal)|
| 3     | Codex Explore   | Invoke Codex exec to explore independently | Codex analysis report  |
| 4     | Integrate       | Compare both perspectives, mark differences | Consolidated report   |

## Codex Invocation Rules

Dispatch Phase 3 per `@skills/codex-code-review/references/codex-transport.md` § Start with the template in `references/prompts.md`. The transport
pins the sandbox and the approval policy, and it derives the working directory from
`git rev-parse --show-toplevel` — none of the three is chosen here, and this skill no longer
restates them.

**Bind every placeholder before writing `prompt.md`.** The template is body-only, so nothing
evaluates an expression inside it: `${USER_QUESTION}` and `${PROJECT_PATH}` must carry real values
by the time the file is written.

### Correct Approach

## Code Investigation Task

## Question

${USER_QUESTION}

## Project Info

- Path: ${PROJECT_PATH}
- Tech Stack: ${TECH_STACK}  <!-- one bound value, read from the repository's own manifest and layout. `{FRAMEWORK}`/`{DATABASE}` were never in this file's binding contract and rendered literally, and the hard-coded `TypeScript` was false for any repository that is not one — this project is JavaScript. Omit the line entirely rather than guess. -->

Please **independently explore** the codebase and answer:
1. What files are related?
2. How does the core logic work?
3. What is the data flow?
4. What are the key dependencies?

Please grep/read and explore on your own, then provide your analysis.


### Prohibited Approaches

| Pattern            | Problem                           | Example                                     |
| ------------------ | --------------------------------- | ------------------------------------------- |
| Feeding conclusion | Claude's findings leak to Codex   | `Claude found these files: ${findings}`     |
| Leading question   | Presupposes answer                | `I think the problem is in cache, verify`   |
| Scope restriction  | Prevents independent exploration  | `Only look at src/service/`                 |

## Output

```markdown
## Investigation Report
- **Claude findings**: <independent analysis>
- **Codex findings**: <independent analysis>
- **Integrated conclusion**: <merged findings>
- **Confidence**: High / Medium / Low
```

## Verification Checklist

| Check                     | Standard                                      |
| ------------------------- | --------------------------------------------- |
| Claude independent conclusion | Phase 2 forms conclusion, not output to user |
| Codex prompt is clean     | Contains only question + project path, no Claude findings |
| Report perspectives separated | Claude / Codex conclusions presented separately |
| Integration is complete   | Marks agreement, differences, possible gaps   |

## References

| File                            | Purpose              | When to Read       |
| ------------------------------- | -------------------- | ------------------ |
| `references/prompts.md`         | Codex prompt templates | Before Phase 3   |
| `references/output-template.md` | Report format        | During Phase 4     |

## Examples

### Feature Investigation

```
Input: Investigate how order processing works
Phase 1: Grep "processOrder" -> Read src/service/order/*.ts
Phase 2: Form understanding: Controller -> Service -> Repository write
Phase 3: Codex explores independently (only given question + path)
Phase 4: Consolidated report -> mark both perspectives
```

### Mechanism Understanding

```
Input: How does the API caching mechanism work?
Phase 1: Grep "cache" + "portfolio" -> Read related files
Phase 2: Understand Redis TTL + fallback mechanism
Phase 3: Codex investigates independently
Phase 4: Compare differences -> output consolidated report
```

### Problem Diagnosis

```
Input: Why is token price sometimes null?
Phase 1: Search price-related logic + error handling
Phase 2: Identify possible fallback paths
Phase 3: Codex diagnoses independently
Phase 4: Synthesize both findings -> list possible causes
```
