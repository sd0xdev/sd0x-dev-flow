# Hook 事實訊號標準化 (R2)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 機制先行 — 本張必須在 R3（散文刪除）之前完成，否則會在訊號建立前拿掉唯一的執行力。父 tech spec 尚未建立（見 References）。實作於 commit `b984ff3`（與 R1 同批）
> **Priority**: P1
> **Depends On**: [Dual-Mode 復原訊號修正 (R1)](./2026-07-26-dual-mode-signal-repair-r1.md)
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`
> **Equilibrium**: Nash Equilibrium (3 rounds, Claude vs Codex)

## Background

目前 hook 對模型說話的方式是**祈使命令**：`stop-guard.sh:1166-1167` 輸出「Execute immediately:${MISSING} — invoke the command now; do not ask the user, do not summarize.」，`post-skill-auto-loop.sh` 輸出「Do not ask 要執行嗎？— execute ${NEXT} now」，`post-compact-auto-loop.sh:324-334` 在 compaction 後重新注入「Required next step」「do not stop, do not ask」「execute ${NEXT} now」並複述兩條 Anchor。

辯論的考古結論：這個 repo 面對「模型停在 review 之前」的失敗，反覆的回應是**再加一層行為提醒**（`4911bb2` → `c044484` → `3856821` → compaction 注入 → post-skill 注入）。命令式重複本身已成為問題，而非解法。

同時，訊號的**內容**不足。`post-edit-format.sh:1149-1150` 確實輸出失效事實——完整字串為 `[Edit Hook] Code change detected: $file_path` 與 `[Edit Hook] Invalidated code_review + precommit + aggregate_gate (iteration counter retained)`——但不含 phase、round、configured tier、剩餘義務。模型拿到「發生了什麼」卻拿不到「現在站在哪」。

本張把六個 emitter 的輸出統一成**結構化事實**：hook 擁有事實，模型擁有語意決策。

## Requirements

- 六個 emitter 改為輸出統一格式的 `[AUTO_LOOP_STATE]` 事實區塊（五個 transition emitter + 一個 compaction emitter）
- 欄位至少涵蓋：change class、收據新舊、review phase、round/cap、configured tier、pending obligations、degraded/unknown 狀態
- 移除所有「立即執行」「不要問」「不要總結」等祈使句
- **不得**指定強制的下一個命令；`suggested_*` 類欄位為建議而非義務
- **degraded 路徑為明示例外**：`stop-guard.sh:167`、`:179`、`:186`、`:206`（jq 不可用、state 不可讀、sidecar 無 state）輸出的 `do not stop with unverified state` 與 `then re-run` **予以保留**。這些是狀態不可驗證時的 fail-closed 安全指示，與本張要移除的激勵型祈使句性質不同；未明示的話，實作要嘛漏改、要嘛連同安全性質一併剝除
- 所有既有 state 寫入與 exit status 完全不變
- precommit 跑過 mutating `lint:fix` 時，誠實標記 `freshness=unverified-after-mutating-check`（揭露限制，不假裝已修）

## Scope

| Scope | Description |
| ----- | ----------- |
| In | 六個 emitter 的 stdout/stderr 輸出格式；新增共用的 emit helper；對應測試 |
| Out | state schema 變更；exit code 語意變更；`review_mode` 寫入；風險評分整合（見 R4）；Bash 端變更偵測（fingerprint 硬化軌） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `hooks/post-edit-format.sh` | Modify | `:1149`, `:1214` 改用統一 emit helper，補 phase/round/tier |
| `hooks/post-tool-review-state.sh` | Modify | review/doc/precommit 三個 transition 點改報結果狀態 |
| `hooks/post-skill-auto-loop.sh` | Modify | 移除祈使句，改報 pending obligations |
| `hooks/user-prompt-review-guard.sh` | Modify | `[PENDING_REVIEW]` 改為事實式 |
| `hooks/stop-guard.sh` | Modify | `:1166-1167`, `:1174` 的 STRICT/WARN 訊息改為結構化義務 |
| `hooks/post-compact-auto-loop.sh` | Modify | `:324-334` 的 `[AUTO_LOOP_RESUME]` 移除祈使句與 Anchor 複述，改報事實狀態 |
| `test/hooks/*.test.js` | Modify | 六個 emitter 的輸出格式斷言，含 `post-compact-auto-loop.test.js` |

## Acceptance Criteria

- [x] 六個 emitter 皆輸出統一 `[AUTO_LOOP_STATE]` 格式，欄位名稱跨 emitter 一致（compaction 得保留自身的 `[AUTO_LOOP_RESUME]` 標頭，欄位須同構）— 共用區塊逐位元一致，`test/hooks/auto-loop-state.test.js` 釘住
- [x] 訊號含 change class、收據新舊、phase、round/cap、configured tier、pending obligations — 收據為三值（`true`/`false`/`unknown`），型別測試讀取（jq `//` 對 boolean `false` 的陷阱見測試 `_alf_receipt decodes a receipt by TYPE`）
- [x] 全 repo hook 輸出中不再出現「Execute immediately」「do not ask」「do not summarize」等祈使句，degraded 路徑除外，測試釘住四條安全指示仍存在
- [x] precommit 走過 `lint:fix` 時輸出 `freshness=unverified-after-mutating-check`
- [x] 既有 state 寫入邏輯零變更 — Codex 第 4 輪獨立確認「No state-write or exit-code logic moved」；讀回 + sidecar 快照全為讀取端
- [x] 既有 exit code 分支零變更；strict 仍 `exit 2`、warn 仍 `exit 0` — 測試釘住
- [x] 訊號經真實 hook 協定送達驗證，涵蓋 Edit/Write、Skill、compaction、UserPromptSubmit、strict Stop retry 五個路徑 — 各路徑皆有欄位非空斷言（零位元 state 曾使欄位靜默渲染為空）
- [x] Pass /codex-review-fast — 4 輪（⛔×3 → ✅ Ready），threadId `019fa1da-b50a-7363-b6f8-c91bedc1ed55`
- [x] Pass /precommit — ✅ PASS（lint 乾淨、2891 tests / 2885 pass / 0 fail / 6 skipped）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 訊號性質 | 事實陳述 | 祈使命令 | 命令式重複是這個 repo 反覆犯的錯；模型已能從狀態推導行動 |
| 下一步命令 | 建議欄位（可選） | 強制欄位 | 保留模型對時機與深度的判斷權 |
| mutating check 的處理 | 誠實揭露限制 | 靜默或假裝已驗證 | 該缺陷屬 fingerprint 硬化軌，本張不解決但不得掩蓋 |
| 交付順序 | 先於 R3 | 與 R3 同時或之後 | warn 模式下散文是唯一執行力，先拆散文等於裸奔 |

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Codex 辯論 R3 最終建議 P2；Claude Position A 的存活核心 |
| Development | Done | 六 emitter 共用區塊 + `_alf_transition`/`_alf_begin` 讀回 + 三 reminder hook aggregate 分流（commit `b984ff3`，與 R1 同批） |
| Testing | Done | `auto-loop-state.test.js` 新增 25 案；七檔既有 hook 測試套件擴充；全套 2885 pass / 0 fail |
| Acceptance | Done | Codex 4 輪複驗至 ✅ Ready；兩條 P2 依 standard tier 延後（同 plane 重複失敗少報一次、多世代讀取競態），`/codex-review-branch` 下次深審接手 |

**Status**: Candidate Complete

## References

- 前置: [Dual-Mode 復原訊號修正 (R1)](./2026-07-26-dual-mode-signal-repair-r1.md)
- 後續: [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md)
- 相關: [Hook Architecture](../../hook-architecture/)
