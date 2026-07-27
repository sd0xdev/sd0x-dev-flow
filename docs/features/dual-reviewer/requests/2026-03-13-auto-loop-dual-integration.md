# 雙 Reviewer Auto-Loop 整合

> **Created**: 2026-03-13
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [3-auto-loop-integration.md](../3-auto-loop-integration.md)
> **As-built 勘誤（2026-07-27）**：本單屬歷史紀錄，**未逐條查核，遇有疑義一律以現行契約為準**（`skills/codex-code-review/`）。已知撤銷：本單的目標「讓 dual dispatch 在每次 code review 時自然觸發」已被推翻——dual 改為 opt-in，唯一入口是 `/codex-review-branch --dual`；Codex 失敗亦永不降級為通過的 gate。詳見 [tech spec 勘誤](../2-tech-spec.md)。

## Background

雙 reviewer 基礎設施（SKILL.md + hooks + state）已完成，但 command `.md` 的 Workflow section 只描述 single Codex review，`auto-loop.md` 也不感知 dual mode，導致 Claude 實際行為中幾乎不觸發 dual dispatch。根因為 instruction proximity bias — Claude 跟著 command workflow（最近的指令）走，忽略 SKILL.md 中更完整的 dual dispatch 流程。

## Requirements

| 需求 | 說明 |
|------|------|
| Command workflow 引導 dual dispatch | 3 個 review command 的 Workflow section 明確包含 dual dispatch 步驟 |
| Auto-loop 感知 dual mode | `auto-loop.md` 新增 Dual Review Mode section |
| Non-blocking secondary | 次要 reviewer 以 background agent 執行，不阻塞主流程 |
| Loop 不重啟 secondary | `--continue` loops 僅使用 Codex stateful re-review |
| Pre-precommit checkpoint | precommit 前 reconcile late secondary 結果（行為層：command workflow 明確寫出步驟） |
| Late P0/P1 policy | Pre-precommit：Secondary 已完成且有 P0/P1 → re-emit BLOCKED → re-open loop（zero tolerance）。Secondary 未完成 → Codex gate 為權威，proceed。Post-precommit：late result 為 advisory log（session 內輸出但不阻塞） |

## Scope

| Scope | Description |
|-------|-------------|
| In | 3 個 review command workflow 修改、`auto-loop.md` Dual Review Mode section、SKILL.md + `review-common.md` loop behavior 修正、output template source attribution |
| Out | Hook 程式碼修改（checkpoint 為行為層，非 hook 層）、`emit-review-gate.sh` 修改、新增 reviewer agent、severity 定義修改 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `commands/codex-review-fast.md` | Modify | Workflow + Output 加入 dual dispatch |
| `commands/codex-review.md` | Modify | Workflow + Output 加入 dual dispatch |
| `commands/codex-review-branch.md` | Modify | Workflow + Output 加入 dual dispatch |
| `rules/auto-loop.md` | Modify | 加入 Dual Review Mode section |
| `.claude/rules/auto-loop.md` | Modify | 同步 Dual Review Mode section |
| `skills/codex-code-review/SKILL.md` | Modify | Case B loop behavior 修正（不重啟 secondary） |
| `skills/codex-code-review/references/review-common.md` | Modify | Dual Mode loop 定義同步（移除 "每輪 fresh Task"） |

## Acceptance Criteria

### AC1: Command Workflow Dual Dispatch

- [x] `codex-review-fast.md` Workflow 包含 "Dual Review" 或 "Task" 步驟
- [x] `codex-review.md` Workflow 包含 "Dual Review" 或 "Task" 步驟
- [x] `codex-review-branch.md` Workflow 包含 "Dual Review" 或 "Task" 步驟
- [x] 3 個 command 的 Workflow 步驟遵循 canonical sequence：emit PENDING → collect metadata → Dual Review（Codex blocking + Task background） → Await Codex → Reconcile → Emit Gate → Output

### AC2: Auto-Loop Dual Awareness

- [x] `auto-loop.md` 包含 "Dual Review Mode" section
- [x] 定義 first-pass dual、non-blocking secondary、late P0/P1、loop re-review、pre-precommit checkpoint 規則
- [x] `.claude/rules/auto-loop.md` 同步更新
- [x] Structural test：grep `auto-loop.md` for "Dual Review Mode"

### AC3: SKILL.md + review-common.md Loop Behavior

- [x] SKILL.md `--continue` loops 明確寫 "Codex `codex-reply` only; do not restart secondary"
- [x] `review-common.md` Dual Mode loop 定義與 SKILL.md 一致（無 "每輪 fresh Task" 矛盾）
- [x] 新增 pre-precommit reconcile 步驟說明

### AC4: Output Template

- [x] 3 個 review command 的 Output template 包含 `[source:]` tag
- [x] Source tag 支援 `codex|toolkit|both` 標記（`strict-reviewer` fallback 歸類為 `toolkit`）

### AC5: Behavioral Paths

- [x] First-pass path：觸發 `/codex-review-fast` 時，同時啟動 Codex + Task background
- [x] Loop path：`--continue` re-review 僅呼叫 `codex-reply`，不啟動新 Task
- [x] Late-arrival path：pre-precommit 時若 Task 已完成且有 P0/P1 → re-emit BLOCKED → re-enter loop

### AC6: Quality Gates

- [x] Pass `/codex-review-fast`（修改後的 command 不影響 review 流程）
- [x] Manual review 確認 dual dispatch 實際觸發

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Best Practices | Done | `/best-practices` audit + `/codex-brainstorm` 3 輪辯論 |
| Tech Spec | Done | `3-auto-loop-integration.md` |
| Development | Pending | W1-W6 待實作 |
| Testing | Pending | Structural tests 待驗證 |
| Acceptance | Pending | AC1-AC6 待驗證 |

## References

- Tech Spec: [3-auto-loop-integration.md](../3-auto-loop-integration.md)
- Best Practices Audit: `/codex-brainstorm` threadId `019ce4ee-b430-7153-9137-8557fcb6a716`（3 輪辯論）
- 根因分析：Instruction proximity bias
- 前置 feature: [dual-reviewer 2-tech-spec](../2-tech-spec.md)（Completed）
- 前置 request: [2026-03-11-dual-reviewer-parallel-architecture](./2026-03-11-dual-reviewer-parallel-architecture.md)（Completed）
