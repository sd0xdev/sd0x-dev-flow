# Auto-Loop 進度帳本 (R9)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-08-04
> **Status**: Candidate Complete
> **Note**: 補記 ticket。此機制隨 R6 的 checkpoint 一併實作、一併審查，但當時未獨立開單——`/codex-test-review --ac-trace` 的 adequacy gate 在 2026-08-04 把它列為追溯缺口（F5：「文件記載了實質新行為，卻無任何需求可對應」）。本張補上該對應，AC 依既有實作與測試回填，不新增行為
> **Priority**: P2
> **Depends On**: [Auto-Loop 觸頂診斷協定 (R6)](./2026-07-26-cap-diagnostic-protocol-r6.md) — 帳本是 R6 診斷的素材來源 · [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md) — 帳本沿用其「只述事實、不下裁決」契約

## Background

R6 給了 auto-loop 一個**何時**停下來想的訊號（round-10 checkpoint 與觸頂協定），但沒有給**拿什麼想**。使用者的原始提問把這一半講得很清楚：

> review 輪數常常過多，但可能又是真的有發現問題，不想透過限制 review 次數來限制，也想長時間運行，但我要的是有實質進度。

「有實質進度」不是輪數問題，是**可觀測性**問題。而現有的 `iteration_history.findings_by_round` 只存計數（`total`/`p0`/`p1`/`p2`/`nit`），計數在這個問題上是**不可判別的**：

| 實際發生 | 第 n 輪 | 第 n+1 輪 |
|---------|--------|-----------|
| 修掉 1 個、引入 1 個（churn） | `total=2` | `total=2` |
| 什麼都沒動（stall） | `total=2` | `total=2` |
| 修掉 2 個、reviewer 換角度找到 2 個新的（進展） | `total=2` | `total=2` |

三種情況在計數上完全相同，而它們該導向的處置南轅北轍——第一種指向 `ATTENTION_DIFFUSION`，第二種指向 `ARCHITECTURE`，第三種則**不該診斷**，該繼續跑。R6 的診斷表列了六個分類與各自的 signals，但沒有任何 hook 產出能餵給它。

要分辨，必須比對 finding 的**身分**而非數量：本輪與上一輪的 finding 集合，交集是 persisted、只在舊集合的是 closed、只在新集合的是 new。

## Requirements

- 每一輪 code review 產出可比對的 finding **身分集合**，並持久化於狀態檔
- 由身分集合算出 `closed` / `persisted` / `new`，以 hook 訊號輸出給模型
- 訊號為**事實，不是裁決**——不得阻擋任何 gate、不得指定下一步（沿用 R2 契約）
- 身分正規化須讓「同一個缺陷因上方插入程式碼而行號位移」被認定為**同一個** finding
- 訊號的適用邊界須明確且寫進規則，避免被過度解讀

## Acceptance Criteria

- [x] 狀態檔 `iteration_history.findings_by_round[].ids` 持久化每輪 finding 身分，上界為每輪 40 筆 × 每筆 120 個 `cut -c` 單位，落在既有 50 輪保留窗內 — jq filter 於 `hooks/post-tool-review-state.sh` `_update_iteration`；schema 樣本見 `../../auto-loop-evolution/2-tech-spec/2-tech-spec.md`
- [x] 身分為「finding 文字去除 severity 標籤、`file:line` 縮為 `file`、水平空白收斂、截斷至 120 單位」，且**行號位移不改變身分** — `test/hooks/identity-normalization.test.js`（含 `a shifted line number is the SAME finding`、`location numbers are stripped to any depth`、injectivity 測試）
- [x] 空身分集合不得產生幻影成員：尾隨換行與中間空行皆為 `""`，須被濾除 — `test/hooks/jq-filter-fidelity.test.js` 的 blank-only 案例（`'\n\n'` → `["","",""]` 為承重的那一半；`''` 在 jq 已為 `[]`，僅為邊界檢查）
- [x] 每輪輸出 `[LOOP_PROGRESS] round=n closed=a persisted=b new=c findings=d` 至 **stderr**（模型讀取的串流） — `test/hooks/post-tool-review-state.test.js` 的 stream-pinning 測試，雙向斷言（stderr 命中 + stdout 缺席）
- [x] 訊號不阻擋任何 gate、不改變輪數預算 — 帳本只寫 state 與印一行，`update_state` 的 gate 判定不讀 `ids`
- [x] 集合運算在缺少 `comm` 時**降級而非中止**：`set -e` 下裸命令替換會在 state commit **之後**中止 hook，連帶吞掉 `[STRATEGIC_RESET]`、`[NIT_DEFERRED]` 與 `[AUTO_LOOP_STATE]` — 三處 `_id_set_count` 各自帶 `|| _closed=0` 形式的守衛
- [x] 身分擷取的管線截斷不得被讀作失敗：`head -40` 在第 40 行關閉管道，`pipefail` 下 `sort` 收到 SIGPIPE 使整條替換回報失敗 — `|| true`（非 `|| cur_ids=""`），迴歸測試須超過約一個 pipe buffer（~64 KB）的身分文字，僅超過 40 筆的小案例釘不住
- [x] 適用邊界寫入 `rules/auto-loop.md` § Cap Diagnostic Protocol：**只有 code plane 且成功寫入 counter 的輪次**會發出；`persisted + new < findings` 表示帳本讀不到本輪 findings（section 形狀的報告無逐條文字），其數字不構成證據；**缺席不是訊號**，不得讀作 `closed=0`
- [x] churn signature 在三處敘述一致（`rules/auto-loop.md`、`4-implementation.md` §2.3／§2.4）：「一連串 `closed=0` 且仍有 findings 未結」
- [x] Pass code review — 第 15 輪 `✅ Ready`（Codex 額度耗盡，改由本地嚴格審查代理獨立研究，見下方 `[DEVIATION]`）
- [x] Pass /precommit — `## Overall: ✅ PASS`（3552 tests / 3546 pass / 0 fail / 6 skipped，2026-08-04）

## References

- 實作與論證正本：[Auto-Loop Autonomy 實作紀錄 §2](../4-implementation.md)
- 彙整 spec：[../2-tech-spec.md](../2-tech-spec.md) §3.3
- 規則契約：`rules/auto-loop.md` § Cap Diagnostic Protocol

## Note — 審查者替換（`[DEVIATION]`）

```text
[DEVIATION] rule=rules/auto-loop.md § Review Dispatch（並涉 rules/codex-invocation.md 全文）
default=code review 預設一律由 Codex 執行，且 Codex 須自行研究專案
chosen=改由本地獨立嚴格審查代理執行，深度維持 thorough（P0/P1/P2 皆阻擋）
reason=Codex 憑證不可得，但 Anchor Register #5／#6 要求審查轉換確實發生且深度不得降低
signal=使用者於本次對話明示「Codex 額度不足，這個對話先用 fallback 內建的 reviewer」
```
