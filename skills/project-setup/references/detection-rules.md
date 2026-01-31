# Detection Rules

## Package Manager

| Priority | File | Result |
|----------|------|--------|
| 1 | `pnpm-lock.yaml` | pnpm |
| 2 | `yarn.lock` | yarn |
| 3 | `package-lock.json` | npm |
| 4 | fallback | npm |

## Framework

From `package.json` `dependencies` + `devDependencies`:

| Priority | Dependency | Framework | Notes |
|----------|------|-----------|------|
| 1 | `@midwayjs/core` | MidwayJS 3.x | Check version to confirm 3.x |
| 2 | `@nestjs/core` | NestJS | |
| 3 | `fastify` (no midway/nest) | Fastify | |
| 4 | `koa` (none of the above) | Koa | |
| 5 | `express` (none of the above) | Express | |
| 6 | `next` | Next.js | |
| 7 | `nuxt` | Nuxt | |
| 8 | fallback | (ask user) | |

## Database

| Dependency | Database | Verification Method |
|------|----------|----------|
| `mongoose` | MongoDB | |
| `mongodb` | MongoDB | |
| `pg` | PostgreSQL | |
| `typeorm` + `pg` | PostgreSQL | Check ormconfig/data-source |
| `typeorm` + `mysql2` | MySQL | |
| `mysql2` | MySQL | |
| `prisma` / `@prisma/client` | (read schema) | `grep provider prisma/schema.prisma` |
| `sequelize` + `pg` | PostgreSQL | |
| `sequelize` + `mysql2` | MySQL | |
| `better-sqlite3` | SQLite | |
| `redis` / `ioredis` | Redis | Supplementary record, not primary DB |

When multiple DBs are detected, list all joined with ` + ` (e.g., `PostgreSQL + Redis`).

## Entrypoints

### Config File (`{CONFIG_FILE}`)

| Framework | Candidate Files (by priority) |
|-----------|---------------------|
| MidwayJS | `src/configuration.ts` |
| NestJS | `src/app.module.ts` |
| Express | `src/app.ts` → `src/app.js` |
| Fastify | `src/app.ts` → `src/app.js` |
| Next.js | `next.config.js` → `next.config.ts` |
| fallback | `src/config/index.ts` → `src/config.ts` |

### Bootstrap File (`{BOOTSTRAP_FILE}`)

| Framework | Candidate Files (by priority) |
|-----------|---------------------|
| MidwayJS | `bootstrap.js` → `bootstrap.ts` |
| NestJS | `src/main.ts` |
| Express | `src/index.ts` → `src/server.ts` → `index.js` |
| Next.js | (N/A -- Next.js auto-starts) |
| fallback | `src/index.ts` → `src/main.ts` → `index.js` |

Detection method: Use `Glob` to search candidate paths, take the first one that exists.

## Scripts

From `package.json` `scripts` object:

### `{TEST_COMMAND}`

| Priority | Script key | Output |
|----------|-----------|------|
| 1 | `test:unit` | `{PM} test:unit` |
| 2 | `test` | `{PM} test` |
| 3 | fallback | `# N/A` |

### `{LINT_FIX_COMMAND}`

| Priority | Script key | Output |
|----------|-----------|------|
| 1 | `lint:fix` | `{PM} lint:fix` |
| 2 | `lint` | `{PM} lint` |
| 3 | fallback | `# N/A` |

### `{BUILD_COMMAND}`

| Priority | Script key | Output |
|----------|-----------|------|
| 1 | `build` | `{PM} build` |
| 2 | `compile` | `{PM} compile` |
| 3 | fallback | `# N/A` |

### `{TYPECHECK_COMMAND}`

| Priority | Script key | Output |
|----------|-----------|------|
| 1 | `typecheck` | `{PM} typecheck` |
| 2 | `type-check` | `{PM} type-check` |
| 3 | `tsc` (in scripts) | `{PM} tsc` |
| 4 | fallback | `npx tsc --noEmit` |

### PM Prefix Format

| PM | Run format |
|----|----------|
| yarn | `yarn {script}` |
| pnpm | `pnpm {script}` |
| npm | `npm run {script}` |

## `{PROJECT_NAME}`

| Priority | Source | Value |
|----------|------|------|
| 1 | `package.json` name | Strip scope prefix (`@org/name` → `name`) |
| 2 | git repo root dirname | `path.basename(repoRoot)` |
| 3 | fallback | ask user |
