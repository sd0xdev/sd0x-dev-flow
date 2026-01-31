---
description: Generate unit tests for specified functions using Codex MCP
argument-hint: <file-path> [--function <name>] [--output <path>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Write
skills: test-review
---

## Context

- Git status: !`git status -sb`

## Task

You will use Codex MCP to generate unit tests.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter           | Description                        |
| ------------------- | ---------------------------------- |
| `<file-path>`       | Required, source file to test      |
| `--function <name>` | Optional, specific function name   |
| `--output <path>`   | Optional, output path              |

### Step 1: Read Source File

```bash
Read(FILE_PATH)
```

Save source file content as `SOURCE_CONTENT`.

### Step 2: Derive Test File Path

If `--output` not specified, auto-derive:

- `src/service/xxx.service.ts` -> `test/unit/service/xxx.service.test.ts`
- `src/provider/yyy.ts` -> `test/unit/provider/yyy.test.ts`

### Step 3: Execute Codex Test Generation

Use `mcp__codex__codex` tool:

```typescript
mcp__codex__codex({
  prompt: `You are a testing expert. Generate complete unit tests for the following code.

## Source File
- Path: ${FILE_PATH}
- Function: ${FUNCTION_NAME || 'all'}

\`\`\`typescript
${SOURCE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Before generating tests, you **must** perform the following research:

### Research Steps
1. Understand test structure: \`ls test/unit/\`, \`ls test/integration/\`
2. Search similar tests: \`ls test/unit/service/\` or \`grep -r "describe" test/unit/ --include="*.ts" -l | head -5\`
3. Read existing test examples: \`cat <similar test path> | head -100\`
4. Understand source dependencies: \`grep -r "import" ${FILE_PATH} | head -10\`
5. Search related interface/type: \`grep -r "interface" src/ --include="*.ts" -l | head -5\`

### Verification Focus
- What test patterns does the project use?
- How are mocks set up?
- What assertion style do existing tests use?

## Test Framework
- Jest
- {FRAMEWORK_MOCK_LIB}

## Test Standards
1. At least one test per public method
2. Cover happy path and edge cases
3. Use mocks to isolate external dependencies
4. Test names clearly describe expected behavior
5. Follow AAA pattern (Arrange-Act-Assert)

## Test Template
\`\`\`typescript
import { createApp, close } from '{FRAMEWORK_MOCK_LIB}';
// import { Framework } from '{FRAMEWORK_WEB}';
// import { Application } from '{FRAMEWORK_CORE}';

describe('ServiceName', () => {
  let app: Application;
  let service: ServiceClass;

  beforeAll(async () => {
    app = await createApp<Framework>();
    service = await app.getApplicationContext().getAsync(ServiceClass);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('methodName', () => {
    it('should do something when condition', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
\`\`\`

## Output Requirements
1. Output only complete test code
2. Include all necessary imports
3. Organize tests with describe/it
4. Reference existing project test style
5. Add appropriate comments describing test purpose`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

### Step 4: Save Test File

Save Codex-generated test code to target path:

```bash
Write(OUTPUT_PATH, TEST_CODE)
```

## Output

```markdown
## Test Generation Report

### File Info

- Source file: <source-path>
- Test file: <test-path>
- Function: <function-name or all>

### Generation Result

Test code saved to: `<test-path>`

### Test Structure

- describe: <ServiceName>
  - describe: <methodName>
    - it: should ...
    - it: should ...

### Next Steps

1. Run tests: `TEST_ENV=unit yarn jest <test-path>`
2. Review tests: `/codex-test-review <test-path>`
```

## Examples

```bash
# Generate tests for entire file
/codex-test-gen src/service/user/user.service.ts

# Generate tests for specific function
/codex-test-gen src/service/user/user.service.ts --function getUserById

# Specify output path
/codex-test-gen src/service/xxx.ts --output test/unit/xxx.test.ts
```
