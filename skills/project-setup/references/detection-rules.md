# Detection Rules

## Ecosystem Detection

| Priority | Manifest | Ecosystem |
|----------|----------|-----------|
| 1 | `package.json` | Node.js |
| 2 | `pyproject.toml` | Python |
| 3 | `Cargo.toml` | Rust |
| 4 | `go.mod` | Go |
| 5 | `build.gradle` / `build.gradle.kts` | Java (Gradle) |
| 6 | `pom.xml` | Java (Maven) |
| 7 | `Gemfile` | Ruby |

Detection method: Glob for these manifest files in project root. If multiple found, use priority order above. Primary ecosystem determines template block selection.

### Per-Ecosystem Detection

#### Python (`pyproject.toml`)

**Framework**: Read `[project.dependencies]` or `[tool.poetry.dependencies]`

| Dependency | Framework |
|------------|-----------|
| `django` | Django |
| `fastapi` | FastAPI |
| `flask` | Flask |
| `starlette` | Starlette |
| fallback | (ask user) |

**Database**: Read dependencies for `sqlalchemy`, `psycopg2`/`asyncpg` (PostgreSQL), `pymongo` (MongoDB), `django.db` (check settings.py)

**Entrypoints**: `manage.py` (Django), `main.py` / `app.py` (FastAPI/Flask), `pyproject.toml` `[tool.poetry.scripts]`

**Scripts**:

| Placeholder | Detection |
|-------------|-----------|
| `{TEST_COMMAND}` | `pytest` (if pytest in deps) or `python -m unittest` |
| `{LINT_FIX_COMMAND}` | `ruff check --fix .` (if ruff) or `flake8` |
| `{BUILD_COMMAND}` | `python -m build` or `poetry build` |
| `{TYPECHECK_COMMAND}` | `mypy .` (if mypy in deps) or `# N/A` |

#### Go (`go.mod`)

**Framework**: Read `require` block

| Dependency | Framework |
|------------|-----------|
| `github.com/gin-gonic/gin` | Gin |
| `github.com/gofiber/fiber` | Fiber |
| `github.com/labstack/echo` | Echo |
| `github.com/gorilla/mux` | Gorilla Mux |
| fallback | stdlib `net/http` |

**Database**: Check imports for `database/sql`, `gorm.io/gorm`, `go.mongodb.org/mongo-driver`

**Entrypoints**: `cmd/*/main.go` or `main.go`

**Scripts**:

| Placeholder | Detection |
|-------------|-----------|
| `{TEST_COMMAND}` | `go test ./...` |
| `{LINT_FIX_COMMAND}` | `golangci-lint run --fix` (if `.golangci.yml` exists) or `go vet ./...` |
| `{BUILD_COMMAND}` | `go build ./...` |
| `{TYPECHECK_COMMAND}` | `# N/A (implicit)` |

#### Rust (`Cargo.toml`)

**Framework**: Read `[dependencies]`

| Dependency | Framework |
|------------|-----------|
| `actix-web` | Actix Web |
| `axum` | Axum |
| `rocket` | Rocket |
| `warp` | Warp |
| fallback | (ask user) |

**Database**: Check `[dependencies]` for `diesel` (PostgreSQL/MySQL/SQLite), `sqlx` (PostgreSQL/MySQL/SQLite), `sea-orm` (PostgreSQL/MySQL/SQLite), `mongodb` (MongoDB)

**Entrypoints**: `src/main.rs` (binary) or `src/lib.rs` (library)

**Scripts**:

| Placeholder | Detection |
|-------------|-----------|
| `{TEST_COMMAND}` | `cargo test` |
| `{LINT_FIX_COMMAND}` | `cargo clippy --fix` |
| `{BUILD_COMMAND}` | `cargo build` |
| `{TYPECHECK_COMMAND}` | `# N/A (implicit)` |

#### Ruby (`Gemfile`)

**Framework**: Read Gemfile

| Dependency | Framework |
|------------|-----------|
| `rails` | Rails |
| `sinatra` | Sinatra |
| `hanami` | Hanami |
| fallback | (ask user) |

**Database**: Check Gemfile for `pg` (PostgreSQL), `mysql2` (MySQL), `sqlite3` (SQLite), `mongoid` (MongoDB)

**Entrypoints**: `config/application.rb` (Rails), `app.rb` (Sinatra)

**Scripts**:

| Placeholder | Detection |
|-------------|-----------|
| `{TEST_COMMAND}` | `bundle exec rspec` (if rspec) or `bundle exec rake test` |
| `{LINT_FIX_COMMAND}` | `bundle exec rubocop -a` (if rubocop) |
| `{BUILD_COMMAND}` | `# N/A` |
| `{TYPECHECK_COMMAND}` | `bundle exec srb tc` (if sorbet) or `# N/A` |

#### Java (`pom.xml` / `build.gradle`)

**Framework**: Read dependencies

| Dependency | Framework |
|------------|-----------|
| `spring-boot-starter` | Spring Boot |
| `io.quarkus` | Quarkus |
| `io.micronaut` | Micronaut |
| fallback | (ask user) |

**Database**: Check dependencies for `spring-boot-starter-data-jpa` / `spring-data-jpa` (JPA), `r2dbc` (reactive DB), `mysql-connector-java` (MySQL), `postgresql` (PostgreSQL), `mongodb-driver` / `spring-data-mongodb` (MongoDB)

**Entrypoints**: `src/main/java/**/Application.java` or class with `@SpringBootApplication`

**Scripts**:

| Placeholder | Detection |
|-------------|-----------|
| `{TEST_COMMAND}` | `./gradlew test` or `mvn test` |
| `{LINT_FIX_COMMAND}` | `./gradlew spotlessApply` or `mvn spotless:apply` |
| `{BUILD_COMMAND}` | `./gradlew build` or `mvn package` |
| `{TYPECHECK_COMMAND}` | `# N/A (implicit)` |

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
