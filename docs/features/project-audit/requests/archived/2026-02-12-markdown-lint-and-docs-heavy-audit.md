# Markdown Lint and Docs-Heavy Audit Profile

> **Created**: 2026-02-12
> **Status**: Completed
> **Archived**: 2026-02-12
> **Priority**: P2
> **Tech Spec**: N/A (per-check evolution, no separate spec needed)

## Background

`/project-audit` 的 `robustness-lint-typecheck` check 偵測 Node `lint`/`typecheck`/`tsconfig` 啟發式 + Python/靜態型別語言捷徑，但不認識 markdown lint 工具。對以文件為主的專案（如 sd0x-dev-flow：~180 .md vs 23 .js）語義不對齊。Codex Brainstorm 對抗式討論達成 Nash Equilibrium：安裝 `markdownlint-cli2`（不加 devDep）+ 修改審計邏輯支援 docs-heavy profile。

## Requirements

### Part 1: 安裝 Markdown Lint（零依賴方式）

| Item | Decision |
|------|----------|
| Tool | `markdownlint-cli2` |
| Install | **npx**（不加入 devDependencies，保持零依賴） |
| Config | `.markdownlint-cli2.jsonc`（專案根目錄） |
| Local | `npx markdownlint-cli2 "**/*.md"` via `npm run lint:md`（unpinned，使用最新版） |

### Part 2: 修改 `checkRobustnessLintTypecheck()` 審計邏輯

#### Profile Detection 定義

```
docs  = countFiles(root, f => CLASSIFICATION.doc_extensions.includes(ext(f)))
code  = countFiles(root, f => CLASSIFICATION.code_extensions.includes(ext(f)))
// 兩者均遵循 ignore_prefixes（node_modules、.git 等）
doc_ratio = (docs + code) === 0 ? 0 : docs / (docs + code)
isDocsHeavy = doc_ratio >= 0.6 && docs >= 30
```

#### Signal Detection 定義

| Signal | Definition |
|--------|------------|
| `scriptSignal` | `pkg.scripts` 中任一 key（`lint`、`lint:fix`、`lint:md`、`docs:lint`）的 **command 值**含 `markdownlint` 字串 |
| `configSignal` | `.markdownlint.json`、`.markdownlint.jsonc`、`.markdownlint.yaml`、`.markdownlint.yml`、`.markdownlint-cli2.jsonc`、`.markdownlint-cli2.yaml`、`.markdownlint-cli2.yml` 任一存在 |

#### Scoring Matrix

| Condition | Result |
|-----------|--------|
| docs-heavy + scriptSignal + configSignal | `pass`（typecheck N/A） |
| docs-heavy + 僅一個 signal | `partial` |
| docs-heavy + 無 signal | fallback 至現有 Node/Python 邏輯（通常為 `fail`） |
| 非 docs-heavy | 維持現有邏輯（lint + typecheck/tsconfig） |

### Design Constraints

- 不加入 npm devDependencies（保持零依賴，避免 `stability-lock-audit`、`runnability-env-docker` 級聯變更）
- 不使用 phantom `tsconfig.json`（無 `tsc` 安裝的空殼設定無實質價值）
- Profile 偵測使用 `CLASSIFICATION.doc_extensions` + `CLASSIFICATION.code_extensions`（已於 `file-classification.json` 定義）
- Script matching 容錯：涵蓋 `lint`、`lint:fix`、`lint:md`、`docs:lint`

## Scope

| Scope | Description |
|-------|-------------|
| In | `.markdownlint-cli2.jsonc` 設定、`package.json` lint:md script、`audit.js` docs-heavy 分支、對應測試 |
| Out | ESLint for JS（23 檔不值得）、TypeScript 遷移、CI workflow 修改（獨立 follow-up PR）、GitHub Actions markdownlint action |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `.markdownlint-cli2.jsonc` | New | markdownlint 設定檔 |
| `package.json` | Modify | 新增 `lint:md` script |
| `skills/project-audit/scripts/audit.js` | Modify | `checkRobustnessLintTypecheck()` 新增 docs-heavy 分支 |
| `skills/project-audit/references/check-catalog.md` | Modify | 更新 `robustness-lint-typecheck` 判定標準 |
| `test/scripts/project-audit.test.js` | Modify | 新增 docs-heavy profile 測試案例 |

## Acceptance Criteria

- [x] `.markdownlint-cli2.jsonc` 設定檔存在且可被 `npx markdownlint-cli2` 讀取
- [x] `npm run lint:md` 可執行 markdown lint（透過 npx，無 devDependencies）
- [x] `checkRobustnessLintTypecheck()` 偵測 docs-heavy profile（`doc_ratio >= 0.6` 且 `docs >= 30`）
- [x] docs-heavy + scriptSignal + configSignal → `pass`
- [x] docs-heavy + 僅一個 signal → `partial`
- [x] 非 docs-heavy 專案維持現有邏輯不變
- [x] 零依賴狀態不變（`stability-lock-audit` 和 `runnability-env-docker` 仍為 `n/a`）
- [x] sd0x-dev-flow 自身審計分數 >= 90（83 → 90）
- [x] 現有 37 test cases 全部通過（無 regression，全套 232 pass）
- [x] 新增測試覆蓋 docs-heavy profile 場景（5 new tests: 38-42）
- [x] Pass `/codex-review-fast`（3 rounds, ✅ Ready）
- [x] Pass `/precommit`（lint:fix 0 errors + test:unit 23/23）

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Codex Brainstorm Nash Equilibrium 達成（3 rounds） |
| Development | Done | 3 helpers + docs-heavy branch + .markdownlint-cli2.jsonc + lint:md/lint:fix scripts |
| Testing | Done | 42/42 tests pass (5 new), full suite 232/232 |
| Acceptance | Done | Score 83→90, all AC checked, review ✅, precommit ✅ |

## References

- Brainstorm: 2026-02-12 Codex Brainstorm session (Nash Equilibrium — Position D: hybrid markdown lint + audit evolution)
- Predecessor: [Audit Check Applicability Refinements](./2026-02-12-audit-check-applicability-refinements.md) (Completed, score 53→83)
- Predecessor: [Project Audit Scoring Skill](./2026-02-12-project-audit-scoring-skill.md) (Completed)
- Source: `skills/project-audit/scripts/audit.js` — `checkRobustnessLintTypecheck()`
- Config: `scripts/config/file-classification.json` — `doc_extensions`, `code_extensions`
