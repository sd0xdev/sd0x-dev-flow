# Framework Rules

## Entrypoints

- `{CONFIG_FILE}` - Application config
- `{BOOTSTRAP_FILE}` - Bootstrap entry

## Test Patterns

| Pattern | Type |
|---------|------|
| Full app startup | Integration/E2E |
| No app startup, isolated logic | Unit |

Note: Framework-specific test patterns depend on ecosystem. See `.claude/CLAUDE.md` for project-specific mappings.
