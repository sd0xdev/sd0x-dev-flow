# Code Investigate Codex Prompts

## Required Parameters

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start; the transport pins the sandbox, the approval policy and the
working directory, so none of them appears here.

## Standard Investigation Prompt

## Code Investigation Task

## Question

${USER_QUESTION}

## Project Info

- Path: ${PROJECT_PATH}
- Tech Stack: ${TECH_STACK}  <!-- bound by ../SKILL.md from the repository's own manifest and layout; omit the line rather than guess. The old `{FRAMEWORK} + TypeScript + {DATABASE}` form was not in the binding contract, so it dispatched literally, and asserted TypeScript for every project. -->

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

Please provide your complete analysis.


## Specific Feature Investigation

## Feature Investigation: ${FEATURE_NAME}

Project path: ${PROJECT_PATH}

Please independently explore this feature's implementation:

1. Find all related files
2. Trace the call chain
3. Understand data structures
4. Identify external dependencies

No hints needed from me -- please explore on your own and provide your analysis.


## Problem Tracking Investigation

## Problem Tracking

Problem description: ${PROBLEM_DESCRIPTION}

Project path: ${PROJECT_PATH}

Please investigate independently:
1. Potentially involved code areas
2. Potential problem points
3. Related logic branches
4. Possible root causes

Please explore on your own and provide your diagnosis.


## Prohibited Prompt Patterns

| Pattern            | Problem                           | Bad Example                                       |
| ------------------ | --------------------------------- | ------------------------------------------------- |
| Feeding conclusion | Claude's findings leak to Codex   | `Claude found these files: ${FINDINGS}, confirm`  |
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
