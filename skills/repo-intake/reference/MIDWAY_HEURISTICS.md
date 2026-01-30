# MidwayJS Intake Heuristics（Reference）

## Canonical entrypoints（最重要）

- src/configuration.ts
  - Midway lifecycle / configuration entry（常見 ILifeCycle）
- bootstrap.js / bootstrap.ts（repo root 常見）
  - 部署/啟動 entry（真實啟動路徑）
- midway.config.ts / midway.config.js（repo root）
  - project-level config（hooks/路由/構建輸出等）

## Test map classification（工程定義）

- Unit
  - 路徑：`test/unit/`
- Integration
  - 路徑：`test/integration/`
- E2E
  - 路徑：`test/e2e/`
  - Playwright/Cypress config 僅作為線索，不作分類依據

## Repo scan priorities（讀檔順序）

1. README / docs/
2. src/configuration.ts
3. bootstrap.js/ts
4. midway.config.ts/js
5. package.json scripts（dev/build/test）
6. test/（_.test.ts / _.spec.ts）

## Monorepo notes

- 若存在多個 package.json（packages/_、apps/_），scanner 應在報告列出「其他 package.json」做提示
- 實際入口與測試可能在子 package 內
