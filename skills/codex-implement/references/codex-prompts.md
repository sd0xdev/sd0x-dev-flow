# Codex Prompt Templates

## First Item Prompt (3a)

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start:

**Do not stage or commit anything.** No `git add`, no `git commit`, no `git stash`. Leave every
change in the working tree: the operator reviews it and decides. A commit removes the committed part
from the diff-based review; a stash removes the stashed part from the tree — in both cases only the
part that was taken, since `git commit -- <path>` and `git stash push --patch`/pathspec take less
than everything. The surrounding workflow compares `HEAD` and `git stash list` across each item.
What that observes is **persistent drift in those two values** — not the operation itself: a commit
later undone within the same item, or a stash created and popped, leaves both readings unchanged. This instruction
exists so the run does not have to stop on that detection.


You are a senior developer. Implement ONE specific item.

## Project Context (from Claude's research)

${PROJECT_CONTEXT}

## Current Item: #${N} — ${ITEM_TITLE}

${ITEM_DESCRIPTION}

## Target File

${TARGET_PATH}

## Existing Content (if any)

```
${TARGET_CONTENT}
```

## Reference Files

${CONTEXT_CONTENT}

## ⚠️ You MUST independently research and verify ⚠️

Do NOT blindly trust the context above. You must think and verify on your own.

### Phase 1: Understand the project

1. Read `CLAUDE.md` — tech stack, conventions, test commands
2. `ls` the source root, explore directory structure
3. Read `package.json` / `pyproject.toml` / `go.mod` — understand dependencies
4. Read existing docs in `docs/` if relevant to this item

### Phase 2: Study existing code

1. Search similar implementations: `grep -rl "related keyword" <source-root> | head -10`
2. Read 2-3 similar files end-to-end — understand patterns, not just function signatures
3. Understand interfaces, types, and data flow that your code will interact with
4. Check how errors are handled, how tests are structured

### Phase 3: Think before coding

Before writing any code, answer these questions to yourself:
- What exactly does this item need to do?
- What existing code will it call or be called by?
- What is the simplest shape that fits the existing system — who owns each responsibility, and is a named pattern genuinely useful here, or is direct code clearer? Prefer composition when it reduces coupling; never add an abstraction only to satisfy a principle
- What are the edge cases and failure modes?
- What tests are needed to prove it works?

### Phase 4: Implement and self-verify

1. Write the implementation
2. Write corresponding tests (unit test at minimum)
3. Run the project's test command to verify: `grep -m1 "test" package.json` or equivalent
4. If tests fail, fix until they pass — do NOT leave broken code

## Scope

- Implement ONLY this item: ${ITEM_TITLE}
- Do NOT implement other items
- Output complete, **verified** executable code
- Include necessary imports
- Include corresponding tests
- Follow project code style
- Add concise comments for key logic


## Subsequent Item Prompt (3c)

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume — same thread:

Previous items implemented successfully. Now implement the next item.

## Current Item: #${N} — ${ITEM_TITLE}

${ITEM_DESCRIPTION}

## Target File

${TARGET_PATH}

## Current File Content

```
${CURRENT_CONTENT}
```

## Instructions

- Implement ONLY this item: ${ITEM_TITLE}
- Build on previously implemented code
- Do NOT modify previous items unless necessary
- Re-read any files you will modify to confirm current state
- Include corresponding tests for this item
- Run tests to verify your code works before finishing
- If tests fail, fix until they pass


## Modify Item Prompt (3b modify)

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume — same thread:

Modification requested for item #${N}:
${USER_FEEDBACK}

Please revise the implementation.
Re-read the affected files before making changes.
Run tests after fixing to verify.


## Review Fix Prompt

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume when review finds issues — same thread:

Review found the following issues. Fix them all.

## Review Findings

${REVIEW_FINDINGS}

## Current git diff

```diff
${GIT_DIFF}
```

Before fixing:
1. Re-read the affected files to understand current state
2. Understand WHY each issue was flagged
3. Think about whether the fix could break other code

Fix every issue. After fixing:
1. Run tests to verify nothing is broken
2. If tests fail, fix until they pass

Do NOT introduce new problems.
Do NOT modify code unrelated to the findings.
