# Codex Prompt: Test Generation

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Test Review) -->

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start:

You are a testing expert. Generate complete unit tests for the following code.

## Source File

- Path: ${FILE_PATH}
- Function: ${FUNCTION_NAME}  <!-- bound by ../SKILL.md § Workflow: /codex-test-gen — the named
     function, or the literal `all` for the file-only invocation. Never left unbound: nothing here
     evaluates a default. -->

```
${SOURCE_CONTENT}
```

## ⚠️ Important: You must independently research the project ⚠️

Before generating tests, you **must** perform the following research:

### Research Steps

1. Understand test structure: `ls test/unit/`, `ls test/integration/`
2. Search similar tests: `ls test/unit/service/` or `grep -r "describe" test/unit/ -l | head -5`
3. Read existing test examples: `cat <similar test path> | head -100`
4. Understand source dependencies: `grep -r "import" ${FILE_PATH} | head -10`
5. Search related interface/type: `grep -rln "interface" . | head -5` — rooted at the repository, or at a directory discovery surfaced; never an assumed `src/`

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

```
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
```

## Output Requirements

1. Output only complete test code
2. Include all necessary imports
3. Organize tests with describe/it
4. Reference existing project test style
5. Add appropriate comments describing test purpose
