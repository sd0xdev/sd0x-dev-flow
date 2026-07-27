# Session Lifecycle Reset (D-2)

> **Created**: 2026-03-31
> **Status**: Candidate Complete
> **Priority**: P1
> **Tech Spec**: [Tech Spec](../2-tech-spec/1-phase-d-hook-hardening.md) <- Phase D, Section D-2

## Background

`.claude_review_state.json` 跨 session 持久化，`session_id` 為空。上次 session 未完成的 review state 影響新 session，造成 false positive。

## Requirements

- 新增 SessionStart hook（`session-init.sh`）
- 偵測 session_id 變化，reset review state（保留 `total_rounds_session`）
- 首次 session 建立最小 state file
- 註冊到 `hooks.json`（additive，matcher: `startup`）

## Scope

| Scope | Description |
|-------|-------------|
| In | SessionStart hook, state reset logic, hooks.json registration |
| Out | SessionEnd cleanup、broker management、state migration |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/session-init.sh` | New | SessionStart hook — reset state on session change |
| `hooks/hooks.json` | Modify | Append SessionStart entry (matcher: startup) |
| `test/hooks/session-init.test.js` | New | Unit tests for session reset logic |

## Acceptance Criteria

- [x] 新 session 啟動時 review state reset（code_review/doc_review/precommit all false）
- [x] `total_rounds_session` 和 `strategic_reset_fired` 保留（不 reset）
- [x] 同 session 重複觸發不 reset（idempotent）
- [x] State file 不存在時建立最小版本
- [x] hooks.json additive（不破壞既有 namespace-hint、compact hooks）
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | |
| Development | Done | `85a9f07` — new session-init.sh + hooks.json |
| Testing | Done | 5 new test cases (all pass) |
| Acceptance | Done | Codex review ✅ Ready + precommit ✅ Pass |

## References

- Tech Spec: [auto-loop-evolution](../2-tech-spec/1-phase-d-hook-hardening.md) Phase D, D-2
- Source: codex-plugin-cc session-lifecycle-hook.mjs
