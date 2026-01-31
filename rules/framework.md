# Framework Rules

## Entrypoints

- `{CONFIG_FILE}` - ILifeCycle
- `{BOOTSTRAP_FILE}` - Bootstrap entry
- `src/provider/factory.ts` - Provider factory

## Test Patterns

| Pattern                               | Type        |
| ------------------------------------- | ----------- |
| `createApp()` / `createHttpRequest()` | Integration |
| `createBootstrap()` -> {BOOTSTRAP_FILE}   | E2E         |
| No app startup                        | Unit        |
