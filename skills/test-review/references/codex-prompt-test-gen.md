# Codex Prompt: Test Generation

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a testing expert. Generate complete unit tests for the following code.

## Source File
- Path: ${FILE_PATH}
- Function: ${FUNCTION_NAME || 'all'}

\`\`\`
${SOURCE_CONTENT}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Before generating tests, you **must** perform the following research:

### Research Steps
1. Understand test structure: \`ls test/unit/\`, \`ls test/integration/\`
2. Search similar tests: \`ls test/unit/service/\` or \`grep -r "describe" test/unit/ -l | head -5\`
3. Read existing test examples: \`cat <similar test path> | head -100\`
4. Understand source dependencies: \`grep -r "import" ${FILE_PATH} | head -10\`
5. Search related interface/type: \`grep -r "interface" src/ -l | head -5\`

### Verification Focus
- What test patterns does the project use?
- How are mocks set up?
- What assertion style do existing tests use?

## Test Standards
1. At least one test per public method
2. Cover happy path and edge cases
3. Use mocks to isolate external dependencies
4. Test names clearly describe expected behavior
5. Follow AAA pattern (Arrange-Act-Assert)

## Test Template
\`\`\`
describe('ServiceName', () => {
  // setup

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
