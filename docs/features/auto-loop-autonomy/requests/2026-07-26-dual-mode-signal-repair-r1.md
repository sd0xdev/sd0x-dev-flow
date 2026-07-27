# Dual-Mode 復原訊號修正 (R1)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 本張為既有缺陷修正，非新功能。與 R2/R3/R4 的自主性升級無依賴，可獨立先行。父 tech spec 尚未建立（見 References）。AC 全數具證據（測試釘樁 + 兩份 Codex review + 現場 Stop hook 輸出），但未跑 `--verify-ac`，故不逕標 Completed
> **Priority**: P0
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`
> **Equilibrium**: Nash Equilibrium (3 rounds, Claude vs Codex)

## Background

`/codex-brainstorm` 辯論過程中驗證出兩個**今天就存在**的缺陷，與本次升級無關，但會直接傷害任何使用 `/codex-review-branch --dual` 的人。

**缺陷 1 — 復原指令死鎖**：dual 模式下 `aggregate_gate` 未通過時，`stop-guard.sh:936` 將 `/codex-review-fast` 加入 `MISSING`。但 fast review 無法寫入 aggregate 平面（只有 `/codex-review-branch --dual` 的最終 emitter 會），因此模型跑完 fast、`code_review.passed=true`、aggregate 仍未完成 → Stop 再次要求 `/codex-review-fast`。這是**確定性的介面死鎖**，不是機率問題。

**缺陷 2 — dual 跨 session 殘留**：`session-init.sh:617-631` 的 SessionStart reset 會寫入 `session_id`、`updated_at`、兩個 change flag、三個 review 收據、`aggregate_gate`、`current_round`、`findings_by_round`，並重建 `session_commit_scope`。該交易**未觸及**的欄位不只一個——`review_mode`、`review_phase`、`plan_review` 子樹皆在其外，另有 `total_rounds_session` 等刻意保留的 state-lifetime 欄位。

本張只主張其中一項已證實的缺陷：**`review_mode` 在 SessionStart 後存續，但 `skills/codex-review-branch/SKILL.md:31`、`skills/codex-code-review/SKILL.md:48`、`skills/codex-code-review/references/review-common.md:153` 三處皆宣稱 dual 強制 strict「for the rest of the session」**——文件與實作不符，且全 repo 沒有任何 `dual → single` 的降級路徑。其他未重設欄位是否為缺陷，本張不作判斷（見 Scope Out）。

**現場實證（2026-07-26，撰寫本張的 session 內觀測）**：該 session 只執行過 `/codex-brainstorm`、`/create-request`、`/codex-review-doc`，從未觸發 dual，但 `.claude_review_state.json` 的 `review_mode` 為 `"dual"`——即殘留自更早的 session。連帶後果是 `.claude/settings.json:3` 明示的 `STOP_GUARD_MODE: "warn"` 遭 `stop-guard.sh:577` 無條件覆寫，Stop hook 實際以 **STRICT** 運作並硬性攔截。兩個缺陷因此不是理論推導，而是預設 dogfood 設定下的當前行為。同一份 state 的 `iteration_history.current_round` 為 `0`，與 `rules/auto-loop.md` 所述「只計 code review 輪次」一致——doc review 的輪次上限純屬行為層自律，hook 不觀測。

## Requirements

- `stop-guard.sh` 在 `review_mode=dual` 且 aggregate 未完成時，回報的義務必須是 dual 聚合，而非 `/codex-review-fast`
- 修正後的訊號必須指向真正能滿足該 gate 的進入點
- 缺陷 2 **僅記錄與測試**，不在本張變更 reset 行為 — 該變更會動到 enforcement lifecycle，超出訊號層半徑
- 修正文件中「for the rest of the session」的不實宣稱，改為與實作相符的敘述

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `stop-guard.sh` dual 分支的 `MISSING` 內容修正；缺陷 2 的迴歸測試與文件更正 |
| Out | `session-init.sh` 實際重設 `review_mode`（enforcement lifecycle 變更，另立需求單）；新增 `dual → single` 降級技能；`review_mode` 來源 provenance 欄位（schema 變更） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `hooks/stop-guard.sh` | Modify | `:936` dual 分支改報聚合義務，不報 `/codex-review-fast` |
| `test/hooks/stop-guard.test.js` | Modify | 新增死鎖迴歸測試 |
| `test/hooks/session-init.test.js` | Modify | dual 跨 session 殘留的行為釘樁（置於實際受測 hook 的套件） |
| `skills/codex-review-branch/SKILL.md` | Modify | `:31` 更正「for the rest of the session」 |
| `skills/codex-code-review/SKILL.md` | Modify | `:48` 同一句 session-bounded 宣稱，須同步更正 |
| `skills/codex-code-review/references/review-common.md` | Modify | `:153` 同上，此為 review 家族的權威來源 |
| `hooks/session-init.sh` | Reference | 僅作為缺陷 2 的證據來源，本張不修改 |

## Acceptance Criteria

- [x] `review_mode=dual` 且 `aggregate_gate.executed=false` 時，Stop 回報的**事實**為待決聚合義務（R2 落地後表述為 `pending_obligations=aggregate_gate`，進入點置於 `suggested_route`），且不含 `/codex-review-fast`
- [x] 迴歸測試證明：dual + 已通過的 `code_review.passed=true` + aggregate 未完成 → 不再要求 fast review
- [x] `single` 模式的 `MISSING` 行為完全不變（既有測試全綠）
- [x] 新增測試釘樁 `session-init.sh` 目前**不**重設 `review_mode` 的實際行為，測試名稱標明此為已知缺陷
- [x] 三處權威敘述（`codex-review-branch/SKILL.md:31`、`codex-code-review/SKILL.md:48`、`review-common.md:153`）皆改為與實作相符的存續期間表述——**持續至 state 檔重建或人工替換為止，並明文載明目前不存在受支援的 `dual → single` 降級路徑**——無一處殘留「for the rest of the session」，亦不得暗示存在降級機制
- [x] 上述敘述經全庫檢索佐證，且**區分建構子與轉移寫入**——`review_mode` 共 4 個寫值點：state 重建時初始化為 `"single"`（`post-tool-review-state.sh:279`、`post-edit-format.sh:831`），既有 state 的模式轉移一律寫 `"dual"`（`post-tool-review-state.sh:2203`、`:2277`）。須成立的不變式是「**初始化為 single；所有對既有 state 的模式變更皆寫 dual；SessionStart 保留該欄位；不存在受支援的降級轉移**」，而非「只有兩個寫入點」
- [x] `exit 0` / `exit 2` 分支與 state schema 零變更（diff 可證）
- [x] Pass /codex-review-fast
- [x] Pass /precommit

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Codex 辯論 R3 定位，Claude 獨立驗證 `stop-guard.sh:936`、`session-init.sh:617-624` |
| Development | Done | `stop-guard.sh` +148 行：`_sidecar_event_any` / `SIDECAR_EVENT_NORETRY` / `_AGG_OBLIGATION` 路由 + `AGG_OBLIGATION_NOTE`；三個終端出口加 non-retry 分支 |
| Testing | Done | `stop-guard.test.js` 208 項、`review-dispatch.test.js` 34 項、`session-init.test.js` 釘樁；全庫 precommit ✅ PASS |
| Acceptance | Done | 程式碼 review ✅ Ready（無 P0/P1）、文件 review ✅ Mergeable（4 輪，7 個 P1 全修）；AC1 另有現場 Stop hook 輸出佐證 |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 受影響 spec: [Dual Reviewer](../../dual-reviewer/2-tech-spec.md)
- 受影響 spec: [Dual Reviewer Loop Enforcement](../../dual-reviewer-loop-enforcement/2-tech-spec.md)
- 相關既有需求: [Session Lifecycle Reset (D-2)](../../auto-loop-evolution/requests/2026-03-31-session-lifecycle-reset-r12.md)
- 後續: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
