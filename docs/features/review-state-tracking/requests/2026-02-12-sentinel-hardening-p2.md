# Sentinel Routing Hardening (P2)

| Field | Value |
|-------|-------|
| Status | **Completed** |
| Priority | P2 |
| Created | 2026-02-12 |
| Updated | 2026-02-12 |
| Feature | review-state-tracking |
| Tech Spec | TBD |

## Background

`/codex-brainstorm` Nash Equilibrium 辯論（3 輪）發現多個 P2 等級的防禦缺口與邊界案例。這些問題在正常操作流程下不會觸發，但在特定邊界條件（sentinel 格式變更、降級模式、大型 repo）下可能造成 false-positive 或 false-negative 的狀態追蹤。

來源：[Fix Hook State Persistence](./2026-02-12-fix-hook-state-persistence.md) 的 brainstorm 後續發現。

## Requirements

- Sentinel 路由應使用唯一標記（而非子字串比對）以消除跨 skill 碰撞風險
- Transcript fallback 模式應能辨識所有 fail sentinel 變體
- `git status` 檢查應有 timeout 保護，避免大型 repo 阻塞
- 單向 stale-state 調和的限制應有文件說明

## Scope

| Scope | Description |
|-------|-------------|
| In | Sentinel 碰撞修復、transcript fallback 強化、git timeout、文件補充 |
| Out | 重新設計 sentinel 協議（需跨 skill 協調）、效能最佳化 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-tool-review-state.sh` | Modify | 強化 sentinel 比對邏輯 |
| `hooks/stop-guard.sh` | Modify | 加入 git timeout + transcript fallback 強化 |
| `skills/security-review/references/codex-prompt-security.md` | Review | 確認 gate 格式與排除規則一致 |
| `test/hooks/post-tool-review-state.test.js` | Modify | 新增碰撞測試案例 |
| `test/hooks/stop-guard.test.js` | Modify | 新增 timeout + fallback 測試 |

## Acceptance Criteria

### D1: Security/Doc Sentinel 碰撞防護

- [x] MCP 路由對 `✅ Mergeable` 使用更精確的比對（例如搭配 section header `## Document Review`），而非僅靠 `Mergeable: No P0` 排除
- [x] 測試：security review 輸出（無 `No P0` 限定詞）不會誤觸 `doc_review.passed`
- [x] 測試：doc review 輸出仍正常路由

### N2: Transcript Fallback Sentinel 強化

- [x] `stop-guard.sh` transcript fallback 的 `REVIEW_BLOCKED` 正規表達式包含 `⛔ Needs revision` 和 `⛔ Must fix`
- [x] 測試：transcript 中出現 `⛔ Needs revision` 時被辨識為 blocked

### D2: Transcript Fallback Precommit 結果檢查

- [x] Transcript fallback 模式不僅檢查 `/precommit` 是否執行，也檢查其結果（pass/fail）
- [x] 匹配演算法：掃描 transcript 中最後一次出現的 `/precommit` 指令，接著在其後續輸出中搜尋 `## Overall: ✅ PASS` 或 `## Overall: ⛔ FAIL`（以最後一組配對為準）
- [x] 測試：transcript 中出現 `/precommit` + `## Overall: ⛔ FAIL` 時被辨識為 blocked
- [x] 測試：transcript 中出現 `/precommit` + `## Overall: ✅ PASS` 時不阻擋

### A3: Git Status Timeout

- [x] `stop-guard.sh` 的 `git status --porcelain -uall` 加上 timeout 保護（跨平台：優先 `timeout 5`，macOS fallback 用 `gtimeout 5` 或 background + sleep 實作）
- [x] Timeout 時 fail-open（視為 git 不可用）
- [x] 測試：模擬 timeout 情境（stub git 延遲回應）

### N3: Transcript Fallback `.mdx` 偵測

- [x] Transcript fallback 的 doc 變更偵測正規表達式包含 `.mdx`
- [x] 測試：transcript 中編輯 `.mdx` 檔案時被偵測為 doc 變更

### B1: 單向調和文件

- [x] `stop-guard.sh` 中加入註解說明為何 stale-state 檢查是單向的（僅 true→false）
- [x] 說明反向（false→true）會造成 false-positive 的理由

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | `/codex-brainstorm` Nash Equilibrium 確認為 P2 |
| Development | Done | 全部 6 AC (D1/N2/D2/A3/N3/B1) 實作完成 |
| Testing | Done | 25 stop-guard tests + 3 post-tool-review-state collision tests 全通過 |
| Acceptance | Done | `/codex-review-fast` ✅ Ready + `/precommit` ✅ PASS (194 tests) |

## References

- 來源辯論：[Fix Hook State Persistence](./2026-02-12-fix-hook-state-persistence.md) brainstorm Phase 5 報告
- 優先序：D1 > N2 > D2 > A3 > N3 > B1
