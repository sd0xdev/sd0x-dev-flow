# Framework Rules

## Entrypoints

- `{CONFIG_FILE}` - ILifeCycle
- `{BOOTSTRAP_FILE}` - 啟動入口
- `src/provider/factory.ts` - Provider 工廠

## Test Patterns

| Pattern                               | 類型        |
| ------------------------------------- | ----------- |
| `createApp()` / `createHttpRequest()` | Integration |
| `createBootstrap()` → {BOOTSTRAP_FILE}    | E2E         |
| 無 app 啟動                           | Unit        |
