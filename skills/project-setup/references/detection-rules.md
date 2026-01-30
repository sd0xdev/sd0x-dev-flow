# Detection Rules

## Package Manager

| 優先級 | 檔案 | 結果 |
|--------|------|------|
| 1 | `pnpm-lock.yaml` | pnpm |
| 2 | `yarn.lock` | yarn |
| 3 | `package-lock.json` | npm |
| 4 | fallback | npm |

## Framework

從 `package.json` 的 `dependencies` + `devDependencies`：

| 優先級 | 依賴 | Framework | 附註 |
|--------|------|-----------|------|
| 1 | `@midwayjs/core` | MidwayJS 3.x | 看版本確認 3.x |
| 2 | `@nestjs/core` | NestJS | |
| 3 | `fastify` (無 midway/nest) | Fastify | |
| 4 | `koa` (無以上) | Koa | |
| 5 | `express` (無以上) | Express | |
| 6 | `next` | Next.js | |
| 7 | `nuxt` | Nuxt | |
| 8 | fallback | (ask user) | |

## Database

| 依賴 | Database | 確認方式 |
|------|----------|----------|
| `mongoose` | MongoDB | |
| `mongodb` | MongoDB | |
| `pg` | PostgreSQL | |
| `typeorm` + `pg` | PostgreSQL | 看 ormconfig/data-source |
| `typeorm` + `mysql2` | MySQL | |
| `mysql2` | MySQL | |
| `prisma` / `@prisma/client` | (讀 schema) | `grep provider prisma/schema.prisma` |
| `sequelize` + `pg` | PostgreSQL | |
| `sequelize` + `mysql2` | MySQL | |
| `better-sqlite3` | SQLite | |
| `redis` / `ioredis` | Redis | 附加記錄，非主 DB |

多個 DB 時，列出全部用 ` + ` 連接（如 `PostgreSQL + Redis`）。

## Entrypoints

### Config File (`{CONFIG_FILE}`)

| Framework | 候選檔案（依優先級） |
|-----------|---------------------|
| MidwayJS | `src/configuration.ts` |
| NestJS | `src/app.module.ts` |
| Express | `src/app.ts` → `src/app.js` |
| Fastify | `src/app.ts` → `src/app.js` |
| Next.js | `next.config.js` → `next.config.ts` |
| fallback | `src/config/index.ts` → `src/config.ts` |

### Bootstrap File (`{BOOTSTRAP_FILE}`)

| Framework | 候選檔案（依優先級） |
|-----------|---------------------|
| MidwayJS | `bootstrap.js` → `bootstrap.ts` |
| NestJS | `src/main.ts` |
| Express | `src/index.ts` → `src/server.ts` → `index.js` |
| Next.js | (N/A — Next.js 自動啟動) |
| fallback | `src/index.ts` → `src/main.ts` → `index.js` |

偵測方式：用 `Glob` 搜尋候選路徑，取第一個存在的。

## Scripts

從 `package.json` 的 `scripts` 物件：

### `{TEST_COMMAND}`

| 優先級 | Script key | 輸出 |
|--------|-----------|------|
| 1 | `test:unit` | `{PM} test:unit` |
| 2 | `test` | `{PM} test` |
| 3 | fallback | `# N/A` |

### `{LINT_FIX_COMMAND}`

| 優先級 | Script key | 輸出 |
|--------|-----------|------|
| 1 | `lint:fix` | `{PM} lint:fix` |
| 2 | `lint` | `{PM} lint` |
| 3 | fallback | `# N/A` |

### `{BUILD_COMMAND}`

| 優先級 | Script key | 輸出 |
|--------|-----------|------|
| 1 | `build` | `{PM} build` |
| 2 | `compile` | `{PM} compile` |
| 3 | fallback | `# N/A` |

### `{TYPECHECK_COMMAND}`

| 優先級 | Script key | 輸出 |
|--------|-----------|------|
| 1 | `typecheck` | `{PM} typecheck` |
| 2 | `type-check` | `{PM} type-check` |
| 3 | `tsc` (in scripts) | `{PM} tsc` |
| 4 | fallback | `npx tsc --noEmit` |

### PM 前綴格式

| PM | run 格式 |
|----|----------|
| yarn | `yarn {script}` |
| pnpm | `pnpm {script}` |
| npm | `npm run {script}` |

## `{PROJECT_NAME}`

| 優先級 | 來源 | 取值 |
|--------|------|------|
| 1 | `package.json` name | 去 scope prefix（`@org/name` → `name`） |
| 2 | git repo root dirname | `path.basename(repoRoot)` |
| 3 | fallback | ask user |
