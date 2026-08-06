# "Think Harder" Near-Cap Strategic Reset

> **Created**: 2026-03-25
> **Status**: Candidate Complete
> **Priority**: P2 (medium-high effort, hook + rule change)
> **Brainstorm threadId**: `019d24b5-0085-74f3-b143-ae6b35060c95`
> **Origin**: autoresearch project analysis (deep-research 2026-03-25)
> **Equilibrium**: Pure Strategy Convergence (3 rounds)

## Background

autoresearch 在偵測到 >5 次連續失敗時觸發策略重置（re-read files, try combinations, try opposites），而非停下來問用戶。sd0x-dev-flow 目前在 `max_rounds` 達到上限時直接報告 blocker 並停止，沒有「嘗試不同策略」的中間階段。

**關鍵發現**（Codex debate R2）: `current_round` 在 code edit 時會 reset（`post-edit-format.sh` code-edit iteration reset block），所以 near-cap 邏輯如果基於 `current_round` 將很少觸發。需要新的 state-file-lifetime counter `total_rounds_session`。

> **⚠️ 已被後續變更取代（2026-07-25）**：上述「code edit 會 reset `current_round`」**已不再成立**。該 reset 正是讓 row-1 hard cap 永遠碰不到的原因（auto-loop 每輪 review 之間必然有 edit），因此已移除——code edit 現在**不會**動 `current_round`。目前的生命週期**一律以 [`docs/features/auto-loop-evolution/4-implementation.md`](../4-implementation.md) §2 Round counter lifecycle 為準**（2026-07-26 起該表從 `rules/auto-loop.md` 移出，規則本體只保留一句「`current_round` 是實際輪數的下界」）——本文不再複述歸零條件（先前那句已經過時兩處：`doc_review` 同為終端 gate 卻被刻意排除在歸零之外，且上界是 clamp 過的 cap 而非原始 `max_rounds`，複述本身就是過時來源）。本節保留原文以記錄當時的推導脈絡，**不代表現行行為**；`total_rounds_session` 這個結論本身仍然成立（它另有理由：永不歸零，反映累計投入）。

## Requirements

- State file 新增 `iteration_history.total_rounds_session`（state-file lifetime，不因 edit 或 session change reset）
- 在 `total_rounds_session` 接近 `max_rounds` 時（`max_rounds - 3`），注入 strategic reset checklist
- 一次性觸發（state-file lifetime 只觸發一次），避免重複延遲 human escalation
- 行為層實施（behavior-layer），opt-in via `auto-loop-project.md`

## Scope

| In | Out |
|----|-----|
| State file schema: 新增 `total_rounds_session` | `current_round` 邏輯變更 |
| `hooks/post-tool-review-state.sh`: increment `total_rounds_session` | Hook 阻擋邏輯（行為層 only） |
| `hooks/post-compact-auto-loop.sh`: 注入 strategic reset | `max_rounds` 預設值變更 |
| `rules/auto-loop.md`: 新增 strategic reset section | |
| `rules/auto-loop-project.md`: opt-in config | |

## Acceptance Criteria

- [x] State file 含 `iteration_history.total_rounds_session`（state-file lifetime，不跨 session reset）
- [x] `total_rounds_session` 每次 review iteration 遞增，不因 edit reset
- [x] 在 `total_rounds_session >= max_rounds - 3` 時注入 strategic reset checklist
- [x] Strategic reset per state-file lifetime 只觸發一次（記錄 `strategic_reset_fired: true`，state file 重建時 reset）
- [x] `auto-loop-project.md` 可 opt-in（uncomment `## Think Harder: enabled`）；opt-out = 保持 comment 或移除該行
- [x] 預設 disabled（opt-in），避免改變現有用戶行為

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| Counter scope | State-file lifetime（跨 session 保留，state file 重建時 reset） | Global counter | 確保 strategic reset 基於累計 effort，而非單一 review cycle |
| 觸發時機 | `max_rounds - 3` | 固定 round 7 | 相對值更 robust（用戶可能改 max_rounds） |
| 觸發次數 | State-file lifetime 一次性 | 每 3 rounds | 避免重複延遲 human escalation |
| 預設 | Disabled (opt-in) | Enabled | 新行為不應自動改變所有用戶的體驗 |

## Strategic Reset Checklist (injected at near-cap)

```markdown
[STRATEGIC_RESET] Approaching iteration cap. Before escalating to human:
1. Re-read the original error/requirement from conversation start
2. Challenge your current assumption — what if the opposite is true?
3. Search for similar patterns in codebase: `grep -r "keyword" --include="*.ts" -l`
4. Try a fundamentally different approach (not incremental fix)
5. If still blocked after this reset, escalate normally at max_rounds
```

## Resolved Questions

| # | Question | Resolution |
|---|----------|------------|
| 1 | Session identity semantics | Resolved by D-2: `session-init.sh` writes `session_id` on SessionStart; session boundary = harness-provided session_id change |
| 2 | Trigger path (behavior vs hook) | Hook injection chosen: `post-compact-auto-loop.sh:90-117` injects `[STRATEGIC_RESET]` checklist into context |
| 3 | Compact safety for `total_rounds_session` | Validated: compact hook reads state and injects context via stdout; writes only `strategic_reset_fired = true` (one-shot persistence). State file persists across compaction; test coverage confirms counter preservation |

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep research + Codex debate (3 rounds) |
| Development | Done | `post-compact-auto-loop.sh:90-117`, `session-init.sh` preserves counter |
| Testing | Done | `post-compact-auto-loop.test.js` covers enabled/disabled/one-shot |
| Acceptance | Done | Codex review + precommit pass |

## Superseded (2026-08-04)

The near-cap trigger this request shipped — `total_rounds_session >= max_rounds - 3`, injected only
from `post-compact-auto-loop.sh` behind `## Think Harder: enabled` — could not fire at a fixed round
and, on a long session, fired on effort already spent on changes that had since passed their gates.
It is replaced by a fixed-round checkpoint on `current_round`, with the primary emission moved into
the round-counting hook so it no longer depends on a compaction happening. Resolved Question 3 above
still holds for the auxiliary channel; the one-shot flag is now shared by both channels and cleared
at two sites — a passing precommit and SessionStart.

**AC6（「預設 disabled（opt-in），避免改變現有用戶行為」）在新設計下不再成立，此處明列。** 上方 AC 維持打勾是因為**它們在當日確實達成**——R10 出貨的版本正是 opt-in 的；不成立的是替代它的設計，不是當時的實作。新的 primary channel（`post-tool-review-state.sh` `_update_iteration`）**無條件**觸發：`AUTO_LOOP_CHECKPOINT_ROUNDS` 只有一道 `^[0-9]+$` 且 `-ge 1` 的驗證（`:1419-1420`），沒有任何開關讀取 `## Think Harder: enabled`；auxiliary channel 才仍受該開關管轄（見 §1.2 的兩通道表）。

這是刻意的取捨，理由是 checkpoint **什麼都不擋**：它不消耗輪數預算、不改變 gate、只多印一行提示，因此「改變現有用戶行為」的成本與 R10 當初設想的 opt-in 保護對象不同量級。實質的 opt-out 存在但**先前未被寫成 opt-out**：把 `AUTO_LOOP_CHECKPOINT_ROUNDS` 設得**遠高於** tier cap（`thorough` 為 30）。注意 cap+1 **不是保證**——沒有任何機制把 `current_round` 夾在 `max_rounds` 以內，`warn` 模式下 stop-guard 也不會真的停下 loop（見 `../../auto-loop-autonomy/4-implementation.md` §1.1），所以恰好設成 31 仍可能被跑過頭的 loop 追上。

Rationale and the two-channel contract: [Auto-Loop Autonomy 實作紀錄 §1](../../auto-loop-autonomy/4-implementation.md).
