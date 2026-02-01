---
description: Generate unit tests for specified functions using Codex MCP
argument-hint: <file-path> [--function <name>] [--output <path>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Write
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/test-review/SKILL.md
@skills/test-review/references/codex-prompt-test-gen.md

## Context

- Git status: !`git status -sb`

## Task

Generate unit tests using Codex MCP.

### Arguments

```
$ARGUMENTS
```

| Parameter           | Description                        |
| ------------------- | ---------------------------------- |
| `<file-path>`       | Required, source file to test      |
| `--function <name>` | Optional, specific function name   |
| `--output <path>`   | Optional, output path              |

### Workflow

```
Read source → Derive test path → Codex generate → Save test file → Suggest review
```

1. **Read source**: Read the source file content
2. **Derive test path**: `src/service/xxx.ts` → `test/unit/service/xxx.test.ts` (unless `--output`)
3. **Codex generate**: `mcp__codex__codex` with test generation prompt
4. **Save**: Write generated test code to target path
5. **Next steps**: Run tests, then `/codex-test-review`

### Key Rules

- **Codex must independently research** — read existing tests to match project patterns
- **AAA pattern** — Arrange-Act-Assert in every test
- **Follow project conventions** — mock setup, assertion style, describe/it structure
- **At least one test per public method** — happy path + edge cases

## Output

```markdown
## Test Generation Report

### File Info
- Source file: <source-path>
- Test file: <test-path>
- Function: <function-name or all>

### Generation Result
Test code saved to: `<test-path>`

### Next Steps
1. Run tests: `{TEST_COMMAND} <test-path>`
2. Review tests: `/codex-test-review <test-path>`
```

## Examples

```bash
/codex-test-gen src/service/user/user.service.ts
/codex-test-gen src/service/user/user.service.ts --function getUserById
/codex-test-gen src/service/xxx.ts --output test/unit/xxx.test.ts
```
