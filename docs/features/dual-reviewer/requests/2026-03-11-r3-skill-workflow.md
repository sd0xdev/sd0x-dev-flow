# R3: Skill Workflow — 雙重分派與結果彙整

> **Created**: 2026-03-11
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Parent Request**: [dual-reviewer-parallel-architecture.md](./2026-03-11-dual-reviewer-parallel-architecture.md)
> **Depends On**: [R1 Foundation](./2026-03-11-r1-foundation-config.md)
> **As-built 勘誤（2026-07-27）**: 本單記錄的是當初的設計，**其餘內容未逐條查核，遇有疑義一律以現行契約為準**（`skills/codex-code-review/`）。已知被撤銷者五處，勿據以行動——(1) AC1「退回 Codex-only 行為（`review_mode=single`）」：不存在 `dual → single` 降級路徑；(2) Requirements 表「降級處理：任一失敗 → 單源結果 + 警告」與 (3) AC4「Codex 失敗 + 次要成功 → 次要-only（`source=toolkit-only`）」：Codex 失敗永不降級為通過的 gate，現行為 `⛔ Blocked` + `⚠️ Need Human`、gate source `none`；(4) AC1「Step 3.5: 等待雙方結果返回」：現行由 Codex 決定時序，次要 reviewer 非阻塞背景執行；(5) AC3「任一 P0/P1 → BLOCKED」：閘門改由 tier 決定，且唯一的 dual 入口 `/codex-review-branch` 的 tier 固定為 `thorough`，因此 P2 也阻擋。dual 亦已非預設。詳見 [tech spec 勘誤](../2-tech-spec.md)。

## Background

在 `SKILL.md` 實作雙 reviewer 並行分派工作流，並在 `review-common.md` 定義 severity mapping 與結果彙整規則。此為雙 reviewer 架構的核心行為層。

## Requirements

| 需求 | 說明 |
|------|------|
| 雙重分派 | Step 0 發射 PENDING → Step 3 並行 Codex + Task(secondary) → Step 3.5 等待 → Step 4 彙整 → Step 4.5 發射 gate |
| Reviewer 選擇 | `pr-review-toolkit:code-reviewer` (優先) → `strict-reviewer` (fallback) → Codex-only (降級) |
| Severity mapping | toolkit confidence 90-100+P0 關鍵字→P0、90-100→P1、80-89→P2 |
| 結果彙整 | 正規化 → 去重（file + canonical_issue, ±5 lines） → 取最高 severity → 標記 source |
| 降級處理 | 任一失敗 → 單源結果 + 警告；都失敗 → `⛔ Blocked` + `⚠️ Need Human` |

## Scope

| Scope | Description |
|-------|-------------|
| In | `SKILL.md` 雙重分派工作流（Step 0/3/3.5/4/4.5）、`review-common.md` 彙整規則 + severity mapping + 降級表、reviewer 可用性偵測（30s timeout） |
| Out | Hook 修改（見 R2）、emit-review-gate.sh 腳本（見 R1）、Codex MCP prompt 格式不變 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/codex-code-review/SKILL.md` | Modify | 新增 Step 0/3/3.5/4/4.5 雙重分派工作流 |
| `skills/codex-code-review/references/review-common.md` | Modify | 新增「雙 Reviewer 彙整」section：severity mapping、去重演算法、降級表、source 標記 |

## Acceptance Criteria

### AC1: SKILL.md 工作流

- [x] Step 0: 雙 reviewer 模式下呼叫 `bash scripts/emit-review-gate.sh PENDING`
- [x] Step 3: 並行啟動 Codex MCP + `Task(pr-review-toolkit:code-reviewer)`
- [x] 若 `pr-review-toolkit:code-reviewer` 不可用（30s timeout），fallback 至 `Task(strict-reviewer)`
- [x] 若兩者皆不可用，退回 Codex-only 行為（`review_mode=single`）
- [x] Step 3.5: 等待雙方結果返回
- [x] Step 4: 正規化 + 去重 + 彙整為統一 findings
- [x] Step 4.5: 呼叫 `bash scripts/emit-review-gate.sh READY|BLOCKED`

### AC2: Severity Mapping

- [x] toolkit confidence 90-100 + P0 關鍵字（crash, data loss, security vulnerability, injection, auth bypass）→ P0
- [x] toolkit confidence 90-100（無 P0 關鍵字）→ P1
- [x] toolkit confidence 80-89 → P2
- [x] `strict-reviewer` 已使用 P0/P1/P2/Nit，無需對應

### AC3: 結果彙整

- [x] 雙方 findings 正規化為 `[severity] file:line description → fix`
- [x] 去重 key = `file + canonical_issue_text`（忽略 line number ±5 差異）
- [x] 衝突解決：同一 key 取最高 severity（P0 > P1 > P2 > Nit）
- [x] 標記 `source = codex | toolkit | both`
- [x] 排序：P0 → P1 → P2 → Nit
- [x] 閘門：任一 P0/P1 → BLOCKED；否則 → READY

### AC4: 降級處理

- [x] Codex 成功 + 次要成功 → 聯集彙整（`source=codex+toolkit`）
- [x] Codex 成功 + 次要失敗 → Codex-only + 降級警告（`source=codex-only`）
- [x] Codex 失敗 + 次要成功 → 次要-only + 降級警告（`source=toolkit-only`）
- [x] 都失敗 → `⛔ Blocked` + `⚠️ Need Human`（`source=none`）

### AC5: Review Loop 整合

- [x] Codex MCP: `mcp__codex__codex-reply(threadId)` 延續先前上下文
- [x] 次要 reviewer: 每輪重新啟動，帶最新 diff
- [x] 彙整閘門在每輪 loop 結尾重新計算並發射

### Quality Gates

- [x] Pass `/codex-review-fast`
- [x] P2/Nit Quality Sweep 對統一格式 findings 正常運作

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech Spec §3.3.1-§3.3.4, §3.4, §W6/W7 |
| Development | Done | SKILL.md 雙重分派 + review-common.md 彙整規則（commits `b97198a`..`962024c`） |
| Testing | Done | `/codex-review-fast` passed（雙 reviewer 首次實際執行）+ `/precommit-fast` passed |
| Acceptance | Done | AC1-AC5 全部完成 |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §3.3.1 Reviewer 選擇、§3.3.2 Severity Mapping、§3.3.3 彙整演算法、§3.3.4 降級處理、§3.4 SKILL.md 工作流、§5 W6/W7
- 前置: [R1 Foundation](./2026-03-11-r1-foundation-config.md)
- 後續: [R4 Testing](./2026-03-11-r4-testing.md)
