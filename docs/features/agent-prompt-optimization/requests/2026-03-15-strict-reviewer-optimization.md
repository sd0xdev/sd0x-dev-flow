# strict-reviewer sub-agent prompt 優化

> **Created**: 2026-03-15
> **Status**: In Progress
> **Priority**: P2

## Background

`agents/strict-reviewer.md` 目前僅 37 行（severity table + output template），缺乏 workflow、review dimensions、evidence 規則。對比同級 agent（`performance-optimizer` 83 行、`refactor-reviewer` 84 行）及 Claude Code 官方 code-reviewer 範例，明顯 under-specified，導致 review 品質不一致。經 `/best-practices` audit + `/codex-brainstorm` 對抗辯論（threadId: `019cef5b-a35f-76d0-8320-d24023429cd8`，3 rounds，Nash Equilibrium）確認最佳化方案。

## Requirements

| # | Requirement | Detail |
|---|-------------|--------|
| R1 | 5-step workflow | git status → diff → read files → trace callers → produce findings；大 diff 時優先 touched files、限制 caller tracing 深度 |
| R2 | 4-dimension review table | correctness / security / performance / maintainability，對齊 `review-common.md` |
| R3 | Severity 對齊 | inline 定義與 `review-common.md` 一致（消除 drift） |
| R4 | 3+1 evidence rules | require file:line、no speculation、dedupe、no secrets/tokens/passwords/API keys in findings |
| R5 | 完整 output template | 展示 P0/P1/P2/Nit 各 section + 結尾 gate sentinel（`✅ Ready` / `⛔ Blocked`） |
| R6 | description 優化 | 提升 routing 精準度（含 "Use proactively" 語句） |
| R7 | 彈性 diff-range | 相容 HEAD 及 branch review（不 hardcode `git diff HEAD`） |

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `agents/strict-reviewer.md` 重寫（`.claude/agents/` 為 symlink，同步更新） |
| Out | review-common.md 修改、SKILL.md invocation prompt 修改、aggregation 邏輯變更 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `agents/strict-reviewer.md` | Modify | 主要修改對象，目標約 55-65 行（soft target，品質優先） |
| `skills/codex-code-review/references/review-common.md` | Reference | severity / dimensions 對齊來源（不修改） |
| `skills/codex-code-review/SKILL.md` | Reference | 確認 Task prompt 相容性（不修改） |

## Acceptance Criteria

- [ ] 檔案長度約 55-65 行（soft target，品質優先於行數）
- [x] 包含 5-step workflow section（含大 diff 防護策略）
- [x] 包含 4-dimension review table，定義對齊 `review-common.md`
- [x] Severity 定義與 `review-common.md` 一致（無 drift）
- [x] 包含 evidence rules（require file:line、no speculation、dedupe、no secrets）
- [x] Output template 展示所有 severity sections（P0/P1/P2/Nit）
- [x] Output 結尾包含 gate sentinel（`✅ Ready` / `⛔ Blocked`）
- [x] Output format 相容 dual-review aggregation（`- [severity] file:line issue → fix`）
- [x] 無 confidence scoring（經辯論確認不加）
- [x] `model: opus` 保留不變
- [x] `description` 含 "Use proactively" routing 語句

## Design Decisions（Debate Record）

| Decision | Rationale | Debate Round |
| -------- | --------- | ------------ |
| 不加 confidence scoring | 破壞 aggregation format 相容性；toolkit 已有 confidence | R1, Codex conceded |
| 保留 `model: opus` | fallback reviewer 品質優先；invocation 頻率低 | R1, both agreed |
| 目標約 55-65 行（soft target） | 避免 "Curse of Instructions"；verify-app 39 行、refactor-reviewer 84 行之間 | R1, revised from 70-110 |
| 不加 Mission paragraph | frontmatter `description` 已處理 routing；省 token | R1, Codex conceded |
| Severity inline + reference hybrid | Agent 需 inline 定義做分類；reference 防 drift | R2, Claude conceded removal |
| 彈性 diff-range 措辭 | 相容 `/codex-review-fast`（HEAD）及 `/codex-review-branch`（base..HEAD） | R3, Codex edge case |

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | ✅ Done | best-practices audit + codex-brainstorm 完成 |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 10/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |
