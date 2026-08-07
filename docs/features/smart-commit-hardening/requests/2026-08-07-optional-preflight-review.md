# Smart-commit Step 2 pre-flight review 改為可選

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-07
> **Status**: Pending
> **Priority**: P1
> **Tech Spec**: [smart-commit-hardening tech spec](../2-tech-spec.md)

## Background

`/smart-commit` Step 2 Pre-flight Check 在「必要檢查未跑、stale 或不確定」時一律 **Halt**。多數情況下 auto-loop 已跑完 review + precommit——收據記在 `.claude_review_state.json`、由 Stop hook 讀取——Step 2 只是重複驗證同一份收據，這道重複把關在正常流程裡只剩摩擦。例外確實存在（`/smart-commit` 可以在編輯後、review 前被叫起；terminal completion invariant 約束的是宣告完成的時點，不是本 skill 被呼叫的時點），這正是嚴格模式要以 opt-in 形式保留的理由。

## Requirements

- Step 2 預設行為從 **Halt** 改為 **advisory**：偵測不到 fresh check 時顯示警告（列出缺哪個 gate、為何判定 stale）後**繼續**，不中斷流程
- 保留嚴格模式作為 opt-in：`--strict-preflight` flag（或等價設定）恢復現行 Halt 行為
- 警告訊息需可行動：指出該跑的指令（`/precommit-fast`、`/codex-review-doc` 等），而非只說「未通過」
- `--execute` 模式的 AskUserQuestion 核准畫面需帶出 pre-flight 狀態（passed / stale / not run），讓使用者在核准當下看得到風險
- **兩處** Policy note 需一併改寫：SKILL.md「Deliberately stricter than auto-loop」那段，**以及** `2-tech-spec.md` §3.5 自己的 Policy note（「刻意比 `auto-loop.md` baseline 更嚴格…不允許跳過」）連同其決策邏輯表的三列 `**HALT**`——只改 SKILL.md 會留下 tech spec 端的矛盾殘留

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | SKILL.md Step 2 行為改寫、flag 定義、核准畫面資訊、相關測試與 tech spec 同步 |
| Out   | auto-loop 本體的 gate 規則（`rules/auto-loop.md` 不動——Step 2 是 skill 層的額外把關，放寬它不影響 auto-loop invariant）；`smart-commit-execute.sh` 的 runtime AI-guard 驗證（獨立安全層，維持不變）。本變更不觸及 Anchor Register #4——`--execute` 的核准配對是「per-use AskUserQuestion + runtime validation」（`rules/discretion.md` § Proposal Channel），Step 2 pre-flight 不屬於該配對的任一半 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/smart-commit/SKILL.md` | Modify | Step 2 改為 advisory 預設 + `--strict-preflight` opt-in；改寫 Policy note；核准畫面帶 pre-flight 狀態；mermaid 圖 Step 2 節點語意一併確認 |
| `test/scripts/smart-commit.test.js` | Modify | **新增** Step 2 斷言（現況該檔測的是 commit-msg-guard 與 git-env prefix 不變式，無任何 Step 2 覆蓋）：advisory 為預設、`--strict-preflight` 為 opt-in、警告訊息含可行動指令 |
| `docs/features/smart-commit-hardening/2-tech-spec.md` | Modify | Doc sync：§3.5 Policy note + 決策邏輯表三列 HALT 改寫、Step 2 行為變更記入 |

## Acceptance Criteria

- [ ] 未帶 `--strict-preflight` 時，manual 與 `--execute` 兩種模式的 pre-flight 未通過皆只產生警告並繼續，不 Halt（「模式」指 SKILL.md Step 1a 的 manual/execute，兩者行為一致）
- [ ] 警告內容列出缺失的 gate 與對應指令
- [ ] `--strict-preflight`（或等價設定）恢復 Halt 行為，測試雙向覆蓋（預設不擋、strict 擋）
- [ ] `--execute` 核准畫面顯示 pre-flight 狀態
- [ ] SKILL.md 與 `2-tech-spec.md` §3.5 兩處 Policy note、及 §3.5 決策表皆與新行為一致，無矛盾殘留
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | - | |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed (canonical lifecycle — see create-request SKILL.md §Phase 4)

## References

- Tech Spec: [smart-commit-hardening](../2-tech-spec.md)
- `rules/auto-loop.md` — terminal completion invariant（Step 2 想重複驗證的上游 gate；其約束時點見 Background）
- Related Request: [pre-flight diagnostics](./2026-03-04-pre-flight-diagnostics.md)
