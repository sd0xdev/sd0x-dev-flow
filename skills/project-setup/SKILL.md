---
name: project-setup
description: Initialize project configuration. Auto-detect framework, package manager, database, and replace CLAUDE.md placeholders.
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git:*), Bash(ls:*)
# context: shared (default) — intentionally NOT fork because Phase 2 requires user confirmation
---

# Project Setup

## Trigger

- Keywords: project setup, init, 初始化, 設定專案, configure project, setup CLAUDE.md, customize placeholders

## When NOT to Use

- CLAUDE.md placeholder 已全部替換完成（無 `{...}` 殘留）
- 非 Node.js/TypeScript 專案（本偵測邏輯針對 JS/TS 生態）
- 只想修改單一 placeholder — 直接 Edit CLAUDE.md 即可

## Workflow

```
Phase 1: 偵測專案環境
    │
    ├─ 讀取 package.json (dependencies, devDependencies, scripts)
    ├─ 偵測 lockfile (yarn.lock / pnpm-lock.yaml / package-lock.json)
    ├─ 偵測 entrypoints (glob src/)
    └─ 彙整結果
    │
Phase 2: 確認偵測結果
    │
    ├─ 呈現偵測結果表格
    └─ 等待使用者確認或修正
    │
Phase 3: 寫入 CLAUDE.md (除非 --detect-only)
    │
    ├─ 用 Edit tool 逐一替換 placeholder
    └─ 每個 placeholder 一次 Edit
    │
Phase 4: 驗證
    │
    ├─ 讀取 CLAUDE.md 確認無殘留 placeholder
    └─ 輸出最終摘要
```

## Phase 1: 偵測專案環境

依序執行以下偵測，規則詳見 `references/detection-rules.md`：

### 1.1 讀取 package.json

```
Read package.json
```

提取：
- `name` → `{PROJECT_NAME}` 候選
- `dependencies` + `devDependencies` → 框架、資料庫偵測
- `scripts` → 指令偵測

### 1.2 偵測 Package Manager

```
Glob: yarn.lock / pnpm-lock.yaml / package-lock.json
```

| 檔案 | PM |
|------|----|
| `yarn.lock` | yarn |
| `pnpm-lock.yaml` | pnpm |
| `package-lock.json` 或 fallback | npm |

PM 結果影響 `{TEST_COMMAND}`、`{LINT_FIX_COMMAND}`、`{BUILD_COMMAND}`、`{TYPECHECK_COMMAND}` 的前綴。

### 1.3 偵測 Framework

從 `dependencies` 判斷：

| 依賴 | Framework |
|------|-----------|
| `@midwayjs/core` | MidwayJS 3.x |
| `@nestjs/core` | NestJS |
| `express`（無 midway/nest） | Express |
| `fastify` | Fastify |
| `koa` | Koa |

### 1.4 偵測 Database

從 `dependencies` 判斷：

| 依賴 | Database |
|------|----------|
| `mongoose` / `mongodb` | MongoDB |
| `pg` / `typeorm` + `pg` | PostgreSQL |
| `mysql2` / `typeorm` + `mysql` | MySQL |
| `prisma` | 讀 `prisma/schema.prisma` 的 `provider` |
| `redis` / `ioredis` | Redis (補充) |

### 1.5 偵測 Entrypoints

```
Glob: src/configuration.ts, src/app.module.ts, src/main.ts, src/index.ts, bootstrap.js, bootstrap.ts
```

| Framework | Config 候選 | Bootstrap 候選 |
|-----------|------------|----------------|
| MidwayJS | `src/configuration.ts` | `bootstrap.js` 或 `bootstrap.ts` |
| NestJS | `src/app.module.ts` | `src/main.ts` |
| Express | `src/app.ts` 或 `src/index.ts` | `src/index.ts` |

### 1.6 偵測 Scripts

從 `package.json` 的 `scripts` 欄位：

| Placeholder | 優先取 | Fallback | 格式 |
|-------------|--------|----------|------|
| `{TEST_COMMAND}` | `test:unit` | `test` | `{PM} test:unit` |
| `{LINT_FIX_COMMAND}` | `lint:fix` | `lint` | `{PM} lint:fix` |
| `{BUILD_COMMAND}` | `build` | `compile` | `{PM} build` |
| `{TYPECHECK_COMMAND}` | `typecheck` | `type-check` | `{PM} typecheck` |

若 script 不存在，值設為 `# N/A (no script found)` 讓使用者手動填。

## Phase 2: 確認偵測結果

呈現偵測結果：

```markdown
## 偵測結果

| Placeholder | 偵測值 | 來源 |
|-------------|--------|------|
| `{PROJECT_NAME}` | my-app | package.json name |
| `{FRAMEWORK}` | NestJS | @nestjs/core detected |
| `{DATABASE}` | PostgreSQL | pg + typeorm detected |
| `{CONFIG_FILE}` | src/app.module.ts | glob match |
| `{BOOTSTRAP_FILE}` | src/main.ts | glob match |
| `{TEST_COMMAND}` | yarn test:unit | scripts.test:unit exists |
| `{LINT_FIX_COMMAND}` | yarn lint:fix | scripts.lint:fix exists |
| `{BUILD_COMMAND}` | yarn build | scripts.build exists |
| `{TYPECHECK_COMMAND}` | yarn typecheck | scripts.typecheck exists |

以上正確嗎？如需修正請告知。
```

等使用者確認後才進入 Phase 3。

## Phase 3: 寫入 CLAUDE.md

**前提**：使用者已確認，且非 `--detect-only` 模式。

1. 讀取 CLAUDE.md
2. 對每個 placeholder 執行 `Edit`（使用 `replace_all: true`）：

```
Edit CLAUDE.md:
  old_string: "{PROJECT_NAME}"
  new_string: "my-app"
  replace_all: true
```

依序替換全部 9 個 placeholder。

3. 如果 CLAUDE.md 尚不存在，從 plugin 的 CLAUDE.md 模板複製一份到專案根目錄。

## Phase 4: 驗證

1. 讀取修改後的 CLAUDE.md
2. 搜尋殘留的 `{` + 大寫字母 pattern：

```
Grep: \{[A-Z_]+\} in CLAUDE.md
```

3. 輸出結果：

```markdown
## Setup Complete

| Placeholder | Value |
|-------------|-------|
| ... | ... |

殘留 placeholder: 0 (或列出未替換的)
```

## Output Format

```markdown
## Project Setup Complete

| Placeholder | Value |
|-------------|-------|
| `{PROJECT_NAME}` | my-app |
| `{FRAMEWORK}` | NestJS |
| `{DATABASE}` | PostgreSQL |
| `{CONFIG_FILE}` | src/app.module.ts |
| `{BOOTSTRAP_FILE}` | src/main.ts |
| `{TEST_COMMAND}` | yarn test:unit |
| `{LINT_FIX_COMMAND}` | yarn lint:fix |
| `{BUILD_COMMAND}` | yarn build |
| `{TYPECHECK_COMMAND}` | yarn typecheck |

Remaining placeholders: 0
```

## Examples

### Example 1: NestJS + PostgreSQL + yarn

```
User: /project-setup
Claude: [Reads package.json, detects NestJS + pg + yarn]

偵測結果：
| Placeholder | 偵測值 |
| {PROJECT_NAME} | my-nest-api |
| {FRAMEWORK} | NestJS |
| {DATABASE} | PostgreSQL |
| {CONFIG_FILE} | src/app.module.ts |
| {BOOTSTRAP_FILE} | src/main.ts |
| {TEST_COMMAND} | yarn test:unit |

以上正確嗎？

User: 正確
Claude: [Edits CLAUDE.md, replaces all placeholders]
Setup Complete. Remaining placeholders: 0
```

### Example 2: MidwayJS + MongoDB + pnpm

```
User: /project-setup
Claude: [Reads package.json, detects MidwayJS + mongoose + pnpm]

偵測結果：
| {FRAMEWORK} | MidwayJS 3.x |
| {DATABASE} | MongoDB |
| {TEST_COMMAND} | pnpm test:unit |

User: DB 應該是 PostgreSQL，我們有兩個 DB
Claude: [修正 DATABASE 為 PostgreSQL + MongoDB]
[Edits CLAUDE.md]
```

### Example 3: 只偵測

```
User: /project-setup --detect-only
Claude: [偵測並顯示結果，不修改任何檔案]
```

## References

偵測規則詳見：[detection-rules.md](./references/detection-rules.md)
