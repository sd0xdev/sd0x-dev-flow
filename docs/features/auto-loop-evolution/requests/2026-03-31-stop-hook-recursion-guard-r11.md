# Stop Hook Recursion Guard (D-1)

> **Created**: 2026-03-31
> **Status**: Candidate Complete
> **Priority**: P0
> **Tech Spec**: [Tech Spec](../2-tech-spec/1-phase-d-hook-hardening.md) <- Phase D, Section D-1

## Background

Strict mode `stop-guard.sh` exit 2 可能造成 infinite loop：Claude 回應 → 再 stop → 再 exit 2。需檢查 `stop_hook_active` flag 防止遞迴。

## Requirements

- 在 `stop-guard.sh` 頂部讀取 stdin JSON 的 `stop_hook_active` flag
- 若 `true` 則立即 `exit 0`（允許 stop，中斷遞迴）
- 確保不影響正常 strict mode 行為

## Scope

| Scope | Description |
|-------|-------------|
| In | stop-guard.sh recursion guard（3 行） |
| Out | Stop mode 切換、warn/strict 策略、其他 hooks |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/stop-guard.sh` | Modify | 頂部新增 3 行 recursion guard |
| `test/hooks/stop-guard.test.js` | Modify | 新增 recursion guard test case |

## Acceptance Criteria

- [x] `stop_hook_active=true` 時 exit 0（不觸發 review 檢查）
- [x] `stop_hook_active=false` 或缺失時行為不變
- [x] jq parse 失敗時 fallback 為 `false`（不中斷）
- [x] Pass /codex-review-fast
- [x] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | |
| Development | Done | `85a9f07` — 3 lines in stop-guard.sh |
| Testing | Done | 2 new test cases (51 total pass) |
| Acceptance | Done | Codex review ✅ Ready + precommit ✅ Pass. `--verify-ac` 2026-08-27，**未達 closure-grade**：本次驗證只涵蓋 3 條實質 AC，本票共 **5** 條（另兩條為 `Pass /codex-review-fast`、`Pass /precommit-fast` 兩張 gate receipt，未經獨立驗證）。決策表要求報告對**每一條** AC 各有一筆結果，故此報告為 unaccounted；全部 checkbox 已勾，依規則 2 得 `Candidate Complete` 而非 `Completed`。以下為已驗證的 3 條： AC1/AC2 `Complete (later removed)` High; AC3 rests on implementation evidence alone — `|| echo "false"` at `85a9f07:hooks/stop-guard.sh:79`, placed before the `command -v jq` check so a failing or missing jq degrades to `false` rather than aborting. No dedicated jq-**parse-failure** test for `stop_hook_active` was ever written: `96786d1` added jq-**unavailable** cases (`jq unavailable + stop_hook_active=true → recursion guard allows`), which is a related but distinct condition. Implemented `85a9f07`, present through `3c063ed^`, retired 2026-08-13 — `3c063ed` removed the guard (rewritten Stop hook exits 0 on every path, so recursion is structurally impossible), `91b5fc9` deleted `test/hooks/stop-guard.test.js`. That removal is the hook-lightweighting design, not a regression here |

## References

- Tech Spec: [auto-loop-evolution](../2-tech-spec/1-phase-d-hook-hardening.md) Phase D, D-1
- Source: claudefa.st + community patterns
