# Review Phase State (D-4)

> **Created**: 2026-03-31
> **Status**: Completed
> **Priority**: P2
> **Verified**: 2026-04-21 — new `test/hooks/review-phase.test.js` with 14 tests covering all 6 transition points (T1 code-edit → pending_review; T2 PENDING gate; T3 READY → precommit_pending; T4 BLOCKED → addressing_findings; T5 `/precommit` pass → idle; T6 MCP precommit → idle; T7/T8/T9 stop-guard phase-hint behavior; T10-T14 edge cases).
> **Tech Spec**: [Tech Spec](../2-tech-spec/1-phase-d-hook-hardening.md) <- Phase D, Section D-4
> **Depends On**: [Changed Files Tracking](./2026-03-31-changed-files-tracking-r13.md)

## Background

State file 只追蹤 review 是否執行過，不追蹤當前 review cycle 階段。stop-guard 無法區分「尚未開始 review」和「review 正在進行中」。

## Requirements

- 新增 `review_phase` 欄位：idle | pending_review | addressing_findings | precommit_pending
- `post-edit-format.sh` 設為 `pending_review`
- `emit-review-gate.sh` 根據 gate 結果轉換 phase
- `stop-guard.sh` 根據 phase 產生更精準的 MISSING 訊息

## Scope

| Scope | Description |
|-------|-------------|
| In | review_phase 狀態機、hook 轉換邏輯、stop-guard 增強 |
| Out | Phase escalation protocol（warn → confirm → block）、new hook events |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-tool-review-state.sh` | Modify | Phase transition on gate emit |
| `hooks/post-edit-format.sh` | Modify | Set phase to pending_review |
| `hooks/stop-guard.sh` | Modify | Phase-aware MISSING detection |
| `test/hooks/review-phase.test.js` | New | State machine transition tests |

## Acceptance Criteria

- [x] Code edit → phase = `pending_review`
- [x] Emit READY → phase = `precommit_pending`
- [x] Emit BLOCKED → phase = `addressing_findings`
- [x] Precommit pass → phase = `idle`
- [x] stop-guard 根據 phase 產出正確 MISSING hint
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | |
| Development | Done | |
| Testing | Done | |
| Acceptance | Done | |

## References

- Tech Spec: [auto-loop-evolution](../2-tech-spec/1-phase-d-hook-hardening.md) Phase D, D-4
- Source: hamelsmu/claude-review-loop two-phase state machine
