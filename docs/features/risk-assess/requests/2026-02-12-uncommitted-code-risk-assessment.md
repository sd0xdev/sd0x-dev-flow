# Uncommitted Code Risk Assessment Skill

> **Created**: 2026-02-12
> **Status**: In Development
> **Priority**: P2
> **Tech Spec**: (pending — run `/tech-spec` to generate)

## Background

現有 auto-loop 覆蓋「變更局部正確性」（bug、安全、lint/test），但缺乏「系統全局風險」分析——破壞性變更、影響範圍、重構規模等。開發者需要在 PR 前深度評估未提交代碼的風險程度，目前無對應工具。

## Requirements

### Architecture

- 新建獨立 Skill `/risk-assess`，不修改 `next-step/analyze.js`
- 單一腳本 `risk-analyze.js`，沿用 `next-step`/`skill-lint` 模式
- 重用 `scripts/lib/utils.js` + `scripts/config/file-classification.json`
- v1 不修改 hook（stop-guard / post-tool-review-state），不擴展 `.claude_review_state.json`

### Dual Mode

| Mode | 觸發 | 行為 |
|------|------|------|
| `--mode fast` (預設) | 手動或 `/pr-review` 自動呼叫 | 確定性指標，幾秒內完成 |
| `--mode deep` | fast 結果為 High+ 時觸發，或手動 | 加入 git 歷史分析 + import graph |

### 3 Core Scoring Dimensions (v1)

| Dimension | Weight | Detection Method |
|-----------|--------|-----------------|
| `breaking_surface` | 45% | git diff 偵測 export 變更、函式簽名改變、config key 移除 |
| `blast_radius` | 35% | grep/rg 搜尋 import 變更模組的檔案數（直接依賴） |
| `change_scope` | 20% | 檔案數 + LOC delta + 目錄跨度 + rename 比例 |

### 2 Conditional Flags (v1, not in core score)

| Flag | Trigger | Behavior |
|------|---------|----------|
| `migration_safety` | schema/migration/SQL 檔案出現在 diff | 硬警告 + 檢查 rollback 檔案 |
| `regression_hint` | 資訊性輸出 | v2 做完整歷史分析 |

### Risk Levels & Gate Behavior

| Score | Level | Session | PR (`/pr-review`) |
|-------|-------|---------|-------------------|
| 0-29 | Low | 建議 | Pass |
| 30-49 | Medium | 建議 deep review | Pass + 提示 |
| 50-74 | High | 建議 deep review | Auto-run deep → 需確認 |
| 75-100 | Critical | 強烈建議 | `⛔ BLOCK` PR checklist 失敗 |

### Output

- JSON + Markdown 雙輸出（`--json` / `--markdown`）
- Risk Gate sentinel: `## Risk Gate: ✅ PASS` / `⚠️ REVIEW` / `⛔ BLOCK`
- Exit codes: `0` = low/medium, `1` = high, `2` = critical

### Routing Boundary

| Skill | 職責 |
|-------|------|
| `/risk-assess` | 影響量化（breaking、blast radius、scope） |
| `/codex-security` | 漏洞偵測（OWASP Top 10、injection、auth bypass） |
| `/codex-review-fast` | 變更局部正確性（bug、performance、maintainability） |

### v1 Exclusions

- 不修改 hook / `.claude_review_state.json`
- 不做 AST-based import 解析（grep-based 近似）
- 不做完整 `regression_history` 維度（defer to v2）
- 不做多檔案偵測器模組（單一 `risk-analyze.js`）

## Scope

| Scope | Description |
|-------|-------------|
| In | `risk-analyze.js` 腳本、SKILL.md、command、references、tests、`/pr-review` 整合 |
| Out | hook 修改、AST 解析、regression history 完整維度、多模組架構 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/risk-assess/SKILL.md` | New | Skill 定義 + workflow + routing boundary |
| `skills/risk-assess/scripts/risk-analyze.js` | New | 確定性風險引擎 (~600-800 行) |
| `skills/risk-assess/references/risk-dimensions.md` | New | 3+2 維度定義 + 判定標準 |
| `skills/risk-assess/references/output-template.md` | New | 報告格式模板 |
| `commands/risk-assess.md` | New | Command 進入點 |
| `commands/pr-review.md` | Modify | 加入 `/risk-assess --mode fast` 自動呼叫 |
| `test/scripts/risk-assess.test.js` | New | 測試 (~300-500 行) |
| `scripts/config/file-classification.json` | Reference | 語言偵測（不修改） |
| `scripts/lib/utils.js` | Reference | 共用工具（不修改） |

## Acceptance Criteria

- [x] `risk-analyze.js` 可獨立執行 `--mode fast` 和 `--mode deep`
- [x] 3 個核心維度各有確定性 checks，加權計算 overall risk score
- [x] 2 個條件旗標在對應檔案出現時正確觸發
- [x] Risk levels 正確對應 exit codes（0/1/2）
- [x] Blast radius 使用 grep-based 近似，輸出 confidence 等級
- [x] 語言偵測支援 JS/TS/Python/Go 基本 import pattern
- [x] Risk Gate sentinel 格式正確
- [x] `/pr-review` 整合：自動呼叫 fast mode，High+ 時觸發 deep
- [x] SKILL.md 明確定義與 `/codex-security` 的 routing boundary
- [ ] SKILL.md 通過 `/skill-health-check`
- [x] 測試覆蓋 happy path + edge cases（空 diff、大規模重構、migration 檔案）
- [x] Pass `/codex-review-fast`
- [x] Pass `/precommit`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Codex Brainstorm 完成，Nash Equilibrium 達成 |
| Development | Done | 7 files created/modified, 4 rounds Codex review (11 issues fixed) |
| Testing | Done | 22 tests pass, 216/216 full suite pass, `/precommit` pass |
| Acceptance | In Progress | 12/13 AC checked, pending `/skill-health-check` |

## References

- Brainstorm: 2026-02-12 Codex Brainstorm session (Nash Equilibrium report)
- Pattern: `skills/next-step/scripts/analyze.js` (heuristic + JSON 輸出模式)
- Pattern: `skills/skill-health-check/scripts/skill-lint.js` (評分腳本模式)
- Integration: `commands/pr-review.md` (PR 階段觸發點)
- Boundary: `skills/security-review/SKILL.md` (安全審計對照)
