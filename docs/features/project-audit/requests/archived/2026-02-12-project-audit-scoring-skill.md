# Project Audit Scoring Skill

> **Created**: 2026-02-12
> **Status**: Completed
> **Archived**: 2026-02-12
> **Priority**: P2
> **Tech Spec**: (pending — run `/tech-spec` to generate)

## Background

開發過程中需要定期對專案進行多維度審計評分，目前仰賴手動腦力激盪，過程冗長且不可重現。需要一個自動化 Skill (`/project-audit`) 以確定性腳本產出可重現的評分基線，搭配 Claude 層做質性解讀。

## Requirements

### Architecture

- Script-Driven Hybrid 架構：`scripts/audit.js` 做確定性評分 + Claude 做解讀與行動建議
- 遵循 `next-step`/`skill-health-check` 現有模式：腳本產出 JSON → Skill 層格式化
- 重用 `scripts/config/file-classification.json` 做語言偵測
- 重用 `scripts/lib/utils.js` 共用工具

### 5 Dimensions × 12 Checks (v1)

| Dimension | ID | Checks | Check 範例 |
|-----------|-----|--------|-----------|
| 開源友好 | `oss` | 2 | LICENSE 存在、README 品質（sections 數+長度） |
| 穩健完整 | `robustness` | 3 | CI config、lint/typecheck 工具鏈、test 檔案比例 |
| 宣告範圍完整 | `scope` | 2 | 宣告文件 vs 實作對應、AC 完成率 |
| 可運行度 | `runnability` | 3 | manifest 存在、runnable scripts、.env.example/Docker |
| 穩定度 | `stability` | 2 | lock file + dep audit 路徑、type config 存在 |

### Scoring Model

- 每個 check → `1` (pass) / `0.5` (partial) / `0` (fail) / `N/A` (不適用)
- `dimension_score = Σ(applicable_check_scores) / applicable_count × 100`
- `overall_score = weighted_average(5 dimensions)`
- `dimension_confidence = applicable_count / total_checks_in_dimension`

### Status Determination

| Status | Condition |
|--------|-----------|
| Blocked | 任何 P0 finding |
| Needs Work | 無 P0，有 P1 |
| Healthy | 無 P0/P1 |

### Output

- JSON + Markdown 雙輸出（`--json` / `--markdown`）
- Gate sentinel: `## Gate: ✅` / `## Gate: ⛔`
- `next_actions[]` 建議制，人工觸發 `/create-request`
- Exit codes: `0` = healthy, `1` = has P1, `2` = has P0

### v1 Exclusions

- 不做 `rubric.json` 外部權重配置
- 不做 `project_profile` 偵測（claude-plugin/library/app）
- 不做 `--go` 自動建立需求單
- 不做 M1-M5 成熟度等級

## Scope

| Scope | Description |
|-------|-------------|
| In | `audit.js` 腳本、SKILL.md、command、references、tests |
| Out | 歷史趨勢追蹤、跨專案比較、自動需求單建立、外部配置檔 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/project-audit/SKILL.md` | New | Skill 定義 + workflow |
| `skills/project-audit/scripts/audit.js` | New | 確定性評分引擎 (~500-650 行) |
| `skills/project-audit/references/check-catalog.md` | New | 12 checks 定義 + 判定標準 |
| `skills/project-audit/references/output-template.md` | New | 報告格式模板 |
| `commands/project-audit.md` | New | Command 進入點 |
| `test/scripts/project-audit.test.js` | New | 測試 (~250-400 行) |
| `scripts/config/file-classification.json` | Modified | 新增 `_test.go` 至 test_indicators |
| `scripts/lib/utils.js` | Reference | 共用工具（不修改） |

## Acceptance Criteria

- [x] `audit.js` 可獨立執行，產出 JSON 或 Markdown
- [x] 5 個維度各有對應 checks，total 12 checks
- [x] 每個 check 回傳 `pass/partial/fail/N/A`
- [x] N/A checks 不計入分母，confidence 正確反映覆蓋率
- [x] Status 判定正確：Blocked / Needs Work / Healthy
- [x] `next_actions[]` 包含可執行的命令建議
- [x] Exit codes 正確：0/1/2 對應 healthy/P1/P0
- [x] Gate sentinel 格式正確，可被 `stop-guard.sh` 解析
- [x] SKILL.md 通過 `/skill-health-check` (30/30 skills pass, 0 issues)
- [x] 測試覆蓋 happy path + edge cases（空 repo、monorepo、多語言）— 26 test cases
- [x] 遵循 `next-step-analyze.test.js` 測試模式（temp git repo 隔離）
- [x] Pass `/codex-review-fast` (gate ✅ Ready)
- [x] Pass `/precommit` (✅ PASS, 194 tests)

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Codex Brainstorm 完成，Nash Equilibrium 達成 |
| Development | Done | audit.js (~600 行) + SKILL.md + command + references 全部完成 |
| Testing | Done | 26 test cases 全通過（含 Go/Rust/Dotnet 生態系、nested csproj、cross-ecosystem lock） |
| Acceptance | Done | `/codex-review-fast` ✅ Ready + `/precommit` ✅ PASS + `/skill-health-check` 0 issues |

## References

- Brainstorm: 2026-02-12 Codex Brainstorm session (Nash Equilibrium report)
- Pattern: `skills/skill-health-check/scripts/skill-lint.js` (評分腳本模式)
- Pattern: `skills/next-step/scripts/analyze.js` (heuristic + JSON 輸出模式)
- Guide: `skills/create-skill/references/skill-design-guide.md`
