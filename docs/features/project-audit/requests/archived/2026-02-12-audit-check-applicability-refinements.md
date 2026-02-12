# Audit Check Applicability Refinements

> **Created**: 2026-02-12
> **Status**: Completed
> **Archived**: 2026-02-12
> **Priority**: P2
> **Tech Spec**: N/A (per-check fixes, no separate spec needed)

## Background

`/project-audit` 的 12 checks 以應用程式專案為預設假設，導致工具型/插件型專案（如純 markdown + JS scripts）在 scope、runnability、stability 維度取得系統性低分。Codex Brainstorm 對抗式討論達成 Nash Equilibrium：逐 check 修正判定邏輯，而非引入全域 `project_profile` 切換。

## Requirements

### 6 Per-Check Fixes

| # | Check ID | 問題 | 修正方案 |
|---|----------|------|----------|
| 1 | `scope-declared-impl` | 硬編碼 `src\|lib\|app` 路徑，插件專案無這些目錄 | 使用 `countFiles()` + `code_extensions` 偵測任意位置的程式碼檔案，排除依 `file-classification.json` 之 `test_indicators`（含 `test/`、`tests/`、`__tests__/`、`spec/` 目錄前綴及 `.test.ts`、`.test.js`、`.spec.ts`、`.spec.js` 等列舉後綴） |
| 2 | `stability-lock-audit` | 零依賴專案仍因無 lock file 而 fail | **僅限 Node 生態系**：當 `package.json` 中 `dependencies` + `devDependencies` + `peerDependencies` + `optionalDependencies` 全空時回傳 `n/a`；Go/Rust/Python 等生態系維持現有邏輯不變 |
| 3 | `runnability-env-docker` | 純腳本專案無 `.env.example`/`Dockerfile` 即 fail | 當零依賴且無 runtime scripts（`start`/`dev`/`serve`）時回傳 `n/a` |
| 4 | `runnability-scripts` | 要求 `start`/`dev`/`build`/`test` 四腳本，非 runtime 專案不需 `start`/`dev` | 偵測 runtime indicators（`start`/`dev`/`serve`），無則僅要求 `test` 即 pass |
| 5 | `robustness-lint-typecheck` | 無 lint/typecheck 工具鏈 | 維持現狀（確為真實缺口，不調整） |
| 6 | `stability-type-config` | 純 JS 專案無 `tsconfig.json` 即 fail | 偵測純 JS（無 `.ts`/`.tsx`/`.mts`/`.cts` 檔），回傳 `partial`/P2 而非 `fail`/P2 |

### Design Constraints

- 不引入 `--project-profile` 或 `rubric.json` 外部配置
- 每個 check 自主偵測適用性，無全域狀態
- 現有通過的測試不應 regress
- 檔案清單（file inventory）應於 checks 間共用，避免重複 tree walk（v1 各 check 仍獨立呼叫 `countFiles()`，未來可最佳化）
- Runtime indicators 限定 v1 範圍：`start`/`dev`/`serve`（不涵蓋 `preview` 等框架特定腳本）

## Scope

| Scope | Description |
|-------|-------------|
| In | `audit.js` 中 6 個 check 函式的判定邏輯修改、對應測試更新 |
| Out | 新維度/新 checks、外部配置檔、`check-catalog.md` 重寫 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/project-audit/scripts/audit.js` | Modify | 修改 5 個 check 函式（#5 不動） |
| `skills/project-audit/references/check-catalog.md` | Modify | 更新判定標準描述 |
| `test/scripts/project-audit.test.js` | Modify | 新增/修改測試案例覆蓋新邏輯 |

## Acceptance Criteria

- [x] `scope-declared-impl`：純 markdown + scripts 專案不再因無 `src/` 而 fail（排除 test 檔案後仍偵測到程式碼）
- [x] `stability-lock-audit`：Node 零依賴專案（含 `optionalDependencies`）回傳 `n/a`，不計入分母；Go/Rust 維持現有邏輯
- [x] `runnability-env-docker`：零依賴 + 無 runtime scripts 專案回傳 `n/a`
- [x] `runnability-scripts`：無 runtime indicators 時僅要求 `test`，有 `test` 即 pass
- [x] `stability-type-config`：純 JS 專案（無 `.ts`/`.tsx`/`.mts`/`.cts`）回傳 `partial`（非 `fail`）
- [x] `robustness-lint-typecheck`：邏輯不變，確認現有測試仍通過
- [x] 現有 26 test cases 全部通過（無 regression）
- [x] 新增測試覆蓋：工具型/插件型專案場景（零依賴、無 src/、純 JS）
- [x] sd0x-dev-flow 自身審計分數 >= 70（現為 53）— 實際達成 83/100
- [x] Pass `/codex-review-fast` — 3 rounds, ✅ Ready
- [x] Pass `/precommit` — ✅ PASS (test:unit 23/23)

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Codex Brainstorm Nash Equilibrium 達成 |
| Development | Done | 4 helpers + 5 check 修改 + 3 rounds review fixes |
| Testing | Done | 37/37 pass (26 原有 + 11 新增), 全套 224/224 pass |
| Acceptance | Done | 自身審計 83/100 (原 53), 所有 AC 通過 |

## References

- Brainstorm: 2026-02-12 Codex Brainstorm session (Nash Equilibrium — per-check fixes)
- Related: [Project Audit Scoring Skill](./2026-02-12-project-audit-scoring-skill.md)
- Source: `skills/project-audit/scripts/audit.js` — `checkScopeDeclaredImpl()`, `checkRunnabilityScripts()`, `checkRunnabilityEnvDocker()`, `checkStabilityLockAudit()`, `checkStabilityTypeConfig()`
