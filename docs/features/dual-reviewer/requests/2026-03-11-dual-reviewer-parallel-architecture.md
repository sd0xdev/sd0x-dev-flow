# 雙 Reviewer 並行審查架構

> **Created**: 2026-03-11
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **As-built 勘誤（2026-07-27）**：本單屬歷史紀錄，**未逐條查核，遇有疑義一律以現行契約為準**（`skills/codex-code-review/`）。兩項已知撤銷：Requirements 表「雙 reviewer 並行：預設同時啟動」——dual 已改為 opt-in，唯一入口是 `/codex-review-branch --dual`；「降級串接：Codex 失敗 → 次要 reviewer 單獨出 gate」——Codex 失敗永不降級為通過的 gate，現行為 `⛔ Blocked` + `⚠️ Need Human`、gate source `none`。詳見 [tech spec 勘誤](../2-tech-spec.md)。

## Background

現有 `/codex-review-fast` 僅呼叫單一 `mcp__codex__codex`（Codex MCP），存在三個核心問題：

| 問題 | 影響 |
|------|------|
| 單點失敗 | Codex MCP 不可用時，review 流程完全中斷，auto-loop 停擺 |
| 單一視角 | 僅一個 reviewer 的 prompt/rubric，盲點無法被交叉驗證 |
| 無降級機制 | 沒有 fallback path，失敗即阻塞 |

業界最佳實務（2025-2026）推薦 fan-out/fan-in 並行多 reviewer pattern。Anthropic 官方 `pr-review-toolkit` plugin 已實作 6 個並行 specialist agents 的模式。Claude Code 原生支援 Agent/Task tool 並行 subagent 啟動。

使用者已安裝 `pr-review-toolkit` plugin（含 `code-reviewer`、`silent-failure-hunter` 等 6 agents），專案內也有 `.claude/agents/strict-reviewer.md`（Opus model）。

## Requirements

| 需求 | 描述 |
|------|------|
| 雙 reviewer 並行 | 預設同時啟動 Codex MCP + 次要 reviewer（`pr-review-toolkit:code-reviewer`） |
| 降級串接 | Codex 失敗 → 次要 reviewer 單獨出 gate；次要失敗 → Codex 單獨出 gate；皆失敗 → `⛔ Blocked` + `⚠️ Need Human` |
| 結果彙整 | 正規化雙方 findings 至 P0/P1/P2/Nit，去重，取最高 severity |
| 閘門相容 | 維持 `✅ Ready` / `⛔ Blocked` sentinel 格式，hook 可正確解析 |
| 向後相容 | 使用者未安裝 `pr-review-toolkit` 時，自動降級為現有單 reviewer 行為 |
| Fail-closed | 雙 reviewer 模式下，若彙整閘門未成功產出，視為 blocked |

## Scope

| Scope | Description |
|-------|-------------|
| In | SKILL.md 雙重分派工作流、command allowed-tools 擴充、`emit-review-gate.sh` 腳本、hook 彙整閘門解析、state file 新增 `aggregate_gate`（含 `reason` 欄位）+ `review_mode` 欄位、可攜式鎖定機制、`strict-reviewer` 解耦 |
| Out | 修改 Codex MCP prompt 格式、修改 `pr-review-toolkit` 內部邏輯、修改 severity 定義、新增 reviewer agent |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `commands/codex-review-fast.md` | Modify | 加入 `Task` 至 allowed-tools |
| `commands/codex-review.md` | Modify | 加入 `Task` 至 allowed-tools |
| `commands/codex-review-branch.md` | Modify | 加入 `Task` 至 allowed-tools |
| `skills/codex-code-review/SKILL.md` | Modify | 加入 `Task` 至 allowed-tools + 雙重分派工作流 + 彙整邏輯 |
| `skills/codex-code-review/references/review-common.md` | Modify | 新增彙整規則、severity mapping、雙 reviewer section |
| `scripts/emit-review-gate.sh` | New | PENDING/READY/BLOCKED 閘門發射腳本 |
| `hooks/post-tool-review-state.sh` | Modify | `emit-review-gate` 解析分支 + `aggregate_gate` 寫入 + 可攜式鎖定 |
| `hooks/stop-guard.sh` | Modify | 雙模式閘門偏好 + fail-closed 邏輯 |
| `hooks/post-edit-format.sh` | Modify | `aggregate_gate` 重置 + 可攜式鎖定 |
| `.claude/agents/strict-reviewer.md` | Modify | 移除 `skills: codex-code-review` 避免 fallback 遞迴 |

## Acceptance Criteria

### AC1: 並行分派

- [x] `codex-review-fast.md` 的 `allowed-tools` 包含 `Task`
- [x] `codex-review.md` 的 `allowed-tools` 包含 `Task`
- [x] `codex-review-branch.md` 的 `allowed-tools` 包含 `Task`
- [x] `codex-code-review/SKILL.md` 的 `allowed-tools` 包含 `Task`
- [x] `strict-reviewer.md` 移除 `skills: codex-code-review` 耦合（避免 fallback 遞迴）
- [x] 觸發 `/codex-review-fast` 時，同時啟動 Codex MCP + `Task(pr-review-toolkit:code-reviewer)`
- [x] 若 `pr-review-toolkit:code-reviewer` 不可用（啟動失敗或 30s timeout），fallback 至 `Task(strict-reviewer)`
- [x] 若兩者皆不可用，退回為現有 Codex-only 行為

### AC2: 結果彙整

- [x] 雙方 findings 正規化為 P0/P1/P2/Nit 格式
- [x] toolkit confidence 90-100 + P0 關鍵字 → P0
- [x] toolkit confidence 90-100 → P1
- [x] toolkit confidence 80-89 → P2
- [x] 以 `file + canonical_issue` 為 key 去重
- [x] 保留 `source=codex|toolkit|both` 來源標記

### AC3: 閘門機制

- [x] `scripts/emit-review-gate.sh` 建立且可執行
- [x] 雙 reviewer 起始時發射 `PENDING`（設定 `review_mode=dual`）
- [x] 彙整完成後發射 `READY` 或 `BLOCKED`
- [x] `post-tool-review-state.sh` 新增 `emit-review-gate` 解析分支
- [x] State file 包含 `aggregate_gate` 和 `review_mode` 欄位

### AC4: Fail-closed

- [x] `stop-guard.sh` 在 `review_mode=dual` 時優先使用 `aggregate_gate`
- [x] `review_mode=dual` 時強制 strict blocking（無視 warn 設定）
- [x] `review_mode=dual` + `aggregate_gate.executed=false` → 視為 blocked（reason: `aggregation_incomplete`）
- [x] 鎖定失敗時寫入 `aggregate_gate.gate=BLOCKED`、`aggregate_gate.reason=lock_failure`
- [x] State schema 包含 `aggregate_gate.reason` 欄位（string | null）

### AC5: 狀態管理

- [x] `post-edit-format.sh` 編輯檔案後重置 `aggregate_gate`
- [x] 可攜式 `mkdir` lockdir 鎖定機制（macOS 相容）
- [x] 鎖定含 bounded wait（5s）、owner PID + timestamp、stale lock 回收

### AC6: 向後相容

- [x] `review_mode` 缺失時，行為與現有完全一致
- [x] 現有 Bash/MCP sentinel 偵測邏輯不受影響
- [x] 現有測試全數通過

### Quality Gates

- [x] Pass `/codex-review-fast`
- [x] Pass `/precommit`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Best Practices | Done | `/best-practices` audit + `/codex-brainstorm` 9 輪辯論 |
| Tech Spec | Done | `2-tech-spec.md` |
| Development | Done | R1 (config) + R2 (hooks) + R3 (skill workflow) + R4 (testing) 全部完成 |
| Testing | Done | R1-R4 全部通過；92 hook tests（含 emit-review-gate 5 tests） |
| Acceptance | Done | AC1-AC6 全部完成 |

## References

- Best Practices Audit: Codex Brainstorm threadId `019cdbbd-c8e6-7fd3-8cbf-a995d70cb050`（9 輪，21 攻擊點）
- [9 Parallel AI Agents That Review My Code](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents)
- [Single-Agent vs Multi-Agent Code Review](https://www.qodo.ai/blog/single-agent-vs-multi-agent-code-review/)
- [Common Workflow Patterns for AI Agents](https://claude.com/blog/common-workflow-patterns-for-ai-agents-and-when-to-use-them)
- [Create Custom Subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- [PR Review Toolkit - Claude Plugin](https://github.com/anthropics/claude-code/tree/main/plugins/pr-review-toolkit)
- 前置 feature: [review-state-tracking](../../review-state-tracking/requests/2026-02-12-fix-hook-state-persistence.md)（已完成，本 feature 直接擴充其 hook 基礎建設）
- 前置 feature: [p2-quality-sweep](../../p2-quality-sweep/requests/2026-03-06-p2-nit-quality-sweep.md)（已完成，P2/Nit sweep 邏輯需適配雙源 findings）
