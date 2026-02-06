# MidwayJS Intake Heuristics (Reference)

## Canonical entrypoints (most important)

- src/configuration.ts
  - Midway lifecycle / configuration entry (commonly ILifeCycle)
- bootstrap.js / bootstrap.ts (commonly at repo root)
  - Deployment/startup entry (actual startup path)
- midway.config.ts / midway.config.js (repo root)
  - Project-level config (hooks/routing/build output etc.)

## Test map classification (engineering definitions)

- Unit
  - Path: `test/unit/`
- Integration
  - Path: `test/integration/`
- E2E
  - Path: `test/e2e/`
  - Playwright/Cypress config used as hints only, not for classification

## Repo scan priorities (file reading order)

1. README / docs/
2. src/configuration.ts
3. bootstrap.js/ts
4. midway.config.ts/js
5. package.json scripts (dev/build/test)
6. test/ (_.test.ts / _.spec.ts)

## Monorepo notes

- If multiple package.json files exist (packages/_, apps/_), scanner should list "other package.json" as a hint in the report
- Actual entrypoints and tests may be inside sub-packages
