# Contributing

## Development

### Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Command schema validation
npm run test:schema
```

### Project Structure

```
scripts/          # Runner scripts (JS + Bash)
  lib/utils.js    # Shared utilities
commands/         # Slash commands (Markdown + YAML frontmatter)
skills/           # Workflow definitions
agents/           # Specialized sub-agents
hooks/            # Git/review hooks
rules/            # Always-on rules
test/             # Tests (node --test)
```
