# Auto-Loop 卡關偵測與卡關記憶 (R10)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-08-07
> **Status**: In Progress
> **Priority**: P1
> **Depends On**: [Auto-Loop 進度帳本 (R9)](./2026-08-04-progress-ledger-r9.md) — 卡關偵測完全建立在帳本的 finding 身分之上 · [Auto-Loop 觸頂診斷協定 (R6)](./2026-07-26-cap-diagnostic-protocol-r6.md) — 本張把診斷的**觸發**從輪數改為證據，協定本身不變

## Background

R9 讓每一輪 review 都輸出 `[LOOP_PROGRESS] round=n closed=a persisted=b new=c findings=d`，R6 給了六分類診斷協定。但兩者之間**沒有任何東西把它們接起來**：帳本印出事實，協定等著被觸發，而唯一的觸發器仍是輪數（round cap 與 round-10 checkpoint）。誰來讀那一串 `closed=0`？答案是模型自己，而這正是失敗過的地方。

`.claude/sd0x-dev-flow-lessons.md` 的 L5（第 81/82 輪）、L7（86/87）、L8（91/92）是同一族：「綠燈要問是誰讓它綠的」。同一個教訓在同一次 smart-commit 硬化迴圈裡跨十餘輪重複出現，**沒有任何機制注意到它在重複**。這不是注意力不足，是缺少一個外部觀測者。

使用者的原始提問把要解決的東西講得很完整：

> 就像人遇到卡關之後，會自己覆盤、學習、收斂再出發

四個階段對照現況，缺口很明確：

| 階段 | 現況 |
|------|------|
| 覆盤 | R6 診斷協定 ✅ |
| **學習** | **完全沒有**——沒有任何地方記得上次試過什麼 |
| 收斂 | `/refactor` 存在，但與迴圈無關 |
| 再出發 | R6 步驟 3 ✅ |

「學習」正是 Reflexion（arXiv:2303.11366）量到最有價值的那一塊：self-reflection 相對於單純的 episodic memory 額外帶來 +8%。而其 episodic buffer 的界是 **Ω = 1–3**，重複行為的啟發式門檻是「同一動作 + 同一回應連續超過 3 次」——與此處要偵測的形狀完全同構。

同時使用者要求「調整 review 上限，改成多一點」。這兩件事是同一件事的兩面：cap 之所以被設得緊，是因為它同時兼任 runaway backstop **與** 卡關偵測器；一旦卡關偵測獨立且更早觸發，cap 就可以回去只做它誠實的那份工作。

## Requirements

- 從帳本自動偵測「連續數輪沒有任何 finding 被關閉」，並發出訊號，不阻擋任何 gate
- 記錄每次診斷的**分類／所試調整／結果**，且能在下一次診斷**之前**被讀回（跨 compaction）
- 讓 `/refactor` 成為 R6 協定中兩個分類的正式 bounded adjustment，並受既有 Anchor 約束
- 調高 tier round cap，並把 cap 與卡關偵測的分工寫清楚

## Scope

| 範圍內 | 範圍外 |
|--------|--------|
| `rules/auto-loop.md` § Stall Detection（新）、§ Tiers、§ Cap Diagnostic Protocol | R6 六分類本身（不新增、不改語意） |
| `hooks/post-tool-review-state.sh`：`stall_streak` 與 `stall_memory` | 帳本身分正規化（R9 已定，本張不動） |
| `hooks/session-init.sh`：兩個新欄位的生命週期 | hook 端 `max_rounds` 預設 30（不動，見 AC） |
| 6 語系 README 的 tier 表 | 自動執行 `/refactor`（仍由模型決定並宣告） |

## Related Files

| 檔案 | 變更 |
|------|------|
| `rules/auto-loop.md` | § Stall Detection（新）、§ Tiers cap 與兩層 cap 的關係、anti-loop budget 拆分、`/refactor` 護欄表 |
| `hooks/post-tool-review-state.sh` | `_replay_stall_memory`／`_upsert_stall_memory`；`_update_iteration` 的 streak filter 與 `[LOOP_STALL]` 邊緣偵測；ingest routing |
| `hooks/session-init.sh` | SessionStart 清除 `stall_streak`／`stall_memory` |
| `skills/codex-code-review/SKILL.md` | 移除重複的 cap 數字，改為指向 § Tiers |
| `README*.md`（6 語系） | tier 表 cap 同步 |
| `test/rules/stall-detection.test.js` | 新增——跨檔一致性 |
| `test/hooks/jq-filter-fidelity.test.js`、`test/hooks/post-tool-review-state.test.js` | streak 語意（真 jq）與 hook 行為 |
| `test/hooks/session-init.test.js` | SessionStart 清除兩個新欄位 |
| `test/skills/review-dispatch.test.js` | tier 表 cap 斷言 3/5 → 6/15 |

## Acceptance Criteria

- [x] tier round cap 調整為 `fast` 6／`standard` 15／`thorough` 30，且 `standard` **高於** round-10 checkpoint——調整前預設 tier 只有在跑過自身 cap（`warn` 模式，無任何機制把 `current_round` 夾在 `max_rounds` 內）時才構得到，並非由構造保證可達——是一個死角 — `test/rules/stall-detection.test.js`
- [x] `skills/codex-code-review/SKILL.md` 的 cap 複本（先前已漂移）移除並改為指向 § Tiers — `test/rules/stall-detection.test.js`；6 語系 README 由既有 `generate-readme-catalog.test.js` 以 `rules/auto-loop.md` 為 oracle 校驗。**這不等於「全樹只敘述一處」**：規則散文、README、實作筆記都仍會提到這些數字，被釘住的是那一份會漂移的複本已消失
- [x] 兩層 cap 的關係寫入 § Tiers：行為層 tier cap 與 hook 持久化的 `max_rounds`（未設定時一律 30）不同，**取較低者**，`n/30` 出現在 `standard` 不是矛盾
- [x] stall round 定義為三條同時成立：帳本讀得到（`persisted + new >= findings`）、仍有 findings 未結、`closed = 0`；連續 `AUTO_LOOP_STALL_ROUNDS`（預設 3）輪發出 `[LOOP_STALL] streak=n threshold=t round=r` — `test/hooks/jq-filter-fidelity.test.js`（真 jq，filter 由 hook 原始碼抽出）
- [x] 有進展（`closed > 0`）或無 findings 未結 → streak 歸零；帳本**讀不到**的輪次則**維持原值**，既不計入也不重置（「缺席不是訊號」對稱地兩邊都成立） — 同上，含配對正控制
- [x] `[LOOP_STALL]` 為**邊緣**偵測而非位準：每個 streak 只發一次，進展後才重新武裝 — `test/hooks/post-tool-review-state.test.js`「fires once per streak」
- [x] `stall_streak` 對狀態檔的污染值（`false`／負數／字串／`null`／陣列）一律以 0 為底，不得無限延後跨越
- [x] `[STALL_MEMORY] class=… | tried=… | outcome=… | <ISO8601>` 由 hook 解析並以 FIFO 保留最近 **3** 筆（Reflexion Ω=1–3）
- [x] 該記錄自 **command** 讀取而非 tool output：模型是作者，而讀 output 會使任何一次 `cat rules/auto-loop.md` 把該節的格式範例吃成真記錄 — `test/hooks/post-tool-review-state.test.js`「merely MENTIONING the marker forges nothing」，配對正控制確保守衛不誤殺真記錄
- [x] `class` 不在六分類閉集內 → 記錄並丟棄，不落地；hook 的閉集與 `rules/auto-loop.md` 表格逐項相等 — `test/rules/stall-detection.test.js`
- [x] 記錄在寫入前剝除控制位元組：該值會在後續輪次被印回，未處理的 ESC 會成為終端跳脫序列
- [x] 讀回發生在 `[LOOP_STALL]` 或 `[STRATEGIC_RESET]` 之下，且無法被任一 ingest 路徑重新吃進去——保證來自**拆分**（marker 只在 header、`class=` 只在記錄行，ingest 需兩者同行）而非縮排；縮排是給讀的人看的 — `test/hooks/post-tool-review-state.test.js`「the replay is SPLIT」，該測試以**從 hook 抽出的 `_SM_RE`、在真 grep 下**比對 replay 每一行，並以「把 marker 移到縮排行上就會被吃進去」作為負控制
- [x] ingest 的 gate 與 extraction **共用同一條 regex**：兩份分開寫時只有 extractor 要求結尾的 `| <ts>`，未帶時間戳的記錄會通過 gate 後靜默消失（正是本記憶要防的失效），且使 `_upsert_stall_memory` 的 ts 預設值在生產路徑上不可達 — `test/hooks/post-tool-review-state.test.js`「stamped, not dropped」，配對負控制確保放寬 ts 沒有一併放寬 `outcome=`
- [x] `stall_streak`／`stall_memory` 在 SessionStart 與收斂重置兩處都被清除——兩者的生命週期與 `current_round` 相同 — `test/hooks/session-init.test.js`、`test/hooks/jq-filter-fidelity.test.js`（真 jq，含不重置路徑的負控制）
- [x] 讀回在輸出端也剝除控制位元組：狀態檔是工作目錄裡的普通檔案，輸入端的清理不是保護終端的那道邊界
- [x] `/refactor` 僅對 `DOC_TOO_LONG` 與 `ATTENTION_DIFFUSION` 開放，且五項護欄成文：`--target` 恆用不用 `--auto`、重開 code gate（Register #6）、其內部品質檢查不等於本迴圈的 precommit gate、security／data-integrity 排除（Register #3）、共用同一份診斷預算 — `test/rules/stall-detection.test.js`
- [x] anti-loop budget 依觸發來源拆分：round cap 1 次／`[LOOP_STALL]` 3 次（與記憶界同數）
- [x] 六項突變測試確認測試確實會殺掉被還原的實作：ingest 改讀 TOOL_OUTPUT、移除 blind-round 分支、邊緣偵測改為位準、還原兩份分開的 ingest regex、刪除 `session-init.sh` 的清除、刪除收斂重置的清除——各由釘住該行為的測試殺掉，非全盤變紅。每次突變均先斷言「確實改到檔案」才執行：未套用的替換與存活的突變在輸出上完全相同
- [ ] Pass code review — **未通過，且本輪無法通過**：見下方 `[DEVIATION]`
- [x] Pass /precommit — `## Overall: ✅ PASS`（3780 tests / 3774 pass / 0 fail / 6 skipped）。其後的編輯全為 `.md`，依 `rules/auto-loop.md` 終局不變式的 per-plane freshness，未重開 code gate

## Review Gate Status

```text
[DEVIATION] rule=rules/auto-loop.md § Review Dispatch（並涉 rules/codex-invocation.md 全文）
default=code review 預設一律由 Codex 執行，且 Codex 須自行研究專案
chosen=改由本地獨立嚴格審查代理執行，深度維持 thorough（P0/P1/P2 皆阻擋）
reason=Codex 憑證不可得，但 Anchor Register #5／#6 要求審查轉換確實發生且深度不得降低
signal=使用者於本次對話明示「Codex 額度不足，這個對話先用 fallback 內建的 reviewer」
```

代理產出為 **advisory findings，不是 gate verdict**。receipt hook 以 command name 辨識 producer
（`/codex-review*`、`/review-spec`），Task 代理無論結論為何都不會關閉 `.claude_review_state.json`
上的任何 gate——因此上面的 `- [ ] Pass code review` 保持未勾選，狀態是 `⚠️ Need Human`。

實際跑過的輪次：code 1 輪（P0:0 P1:1 P2:6 Nit:5）、doc 5 輪（P1: 4→2→1→1→0，每輪皆有 finding 關閉，`closed>0` 恆成立即為收斂而非停滯）。第 5 輪結論 `✅ Mergeable`。
所有 P1 皆已修並重審；P2／Nit 依 § Sub-Threshold Findings 記錄於下表後放行。

## Deferred Findings

低於 `standard` 阻擋門檻（P0/P1）的 findings，依 `rules/auto-loop.md` § Sub-Threshold Findings 記錄後放行，不再開一輪。因本次審查由 fallback 代理執行、非受認可的 producer，`[NIT_DEFERRED]` sentinel 不會被 hook 收錄，故在此留下持久紀錄。

| 位置 | 嚴重度 | 內容 | 未處理的理由 |
|------|--------|------|--------------|
| `hooks/post-tool-review-state.sh` `_update_iteration` | P2 | 一個 change 的**第一輪** review 必然計為 stall round：`prev_ids` 為空 ⇒ `closed=0` 恆成立，於是 streak 從 1 起跳，`[LOOP_STALL]` 實際上在 `t-1` 次修正嘗試後就發出 | 不阻擋任何 gate，只是早一輪診斷；修正需同時動 jq filter、測試與規則敘述，超出「有界調整」的尺度 |
| `_upsert_stall_memory` 簽章 | P2 | `state_file="${2:-$STATE_FILE}"` 可寫入任意路徑，但 `_lock`／`_own_lock` 一律鎖全域 `$LOCKDIR`；傳第二參數時鎖不覆蓋該寫入 | 潛在缺陷：目前唯一呼叫點不傳第二參數 |
| `_upsert_stall_memory` ts 欄位 | Nit | `ts` 只做長度截斷與控制位元組剝除，未驗格式；任何 40 字內字串都會被當時間戳存起來並讀回 | 純顯示欄位，不參與任何判斷 |
| `_upsert_stall_memory` 截斷 | Nit | `cut -c` 在 GNU 上計位元組、BSD 上計字元，200 的界因平台而異，且可能切斷 UTF-8 序列 | 已實測：`jq --arg` 以 U+FFFD 取代並正常結束 |
| `docs/features/auto-loop-autonomy/4-implementation.md` | P2 | 544 行，超過 `@rules/docs-numbering.md` § Size Limit 的 500；三個 section 彼此獨立（§1=R6、§2=R9、§3=R10），是真正該拆的檔案而非一段長論證 | 拆分要雙向重指連結，實測有 9 個檔／13 處入口引用（`docs/` 4、`hooks/` 4、`test/` 3、`rules/` 2），是獨立一次變更、須自帶審查；判斷、量測指令與應產生的資料夾形狀已連同 `[DEVIATION]` 寫在該檔頭部的 Size note |
| 完整測試套件（未歸因） | P2 | doc review 第四輪期間出現過**一次** `3773 pass / 1 fail`，該次輸出被 `tail` 截掉、失敗的 TAP 區塊未留存，之後無法重現 | 已以**存檔輸出**（非 `tail`）連續重跑 **5 次全綠**——本輪 4 次 + reviewer 第 5 輪 1 次，每次皆 `3774 pass / 0 fail`、`grep -c '^not ok'` = 0。本輪新增的 437 行 hook 測試中實測無 `sleep`／`setTimeout`／lock TTL／並發構造，非明顯嫌疑；傾向既有的時間敏感測試。**未歸因即記錄**——一支不穩定的測試正是最會掩蓋真缺陷的東西，下次再現時務必保留完整 TAP 輸出再查，不要接 `tail` |
| 六份 README `:194`／`:169` | Nit | 人類出口清單改為 trigger-agnostic 後，第 3 項（同一改動第二次觸頂 → 人類）仍是 cap 專屬，而其 stall 對應項（`rules/auto-loop.md`：同一改動第四次卡關 → 人類）在六份 README 中從未出現 | 重構造成的不完整而非矛盾——第 3 項本身正確，anti-loop budget 確實依 trigger 而異。補齊需六份各加一句，屬 README 篇幅取捨 |
| 六份 README `:194`／`:169` 首句 | Nit | 首句仍為 cap-scoped（`Hitting the cap is a diagnosis point…`），而 `rules/auto-loop.md:51` 已改為 `all are diagnosis points` | 語域不勻而非矛盾：`:192` 已先講明 stall 才是主要觸發器 |
| `_upsert_stall_memory` degrade 分支 | Nit | 五條拒絕／降級路徑（class 不在閉集、`tried=`／`outcome=` 為空、鎖競爭、mktemp 不可用、寫入失敗）中，本輪只為前兩類補了測試 | 其餘三條與既有 degrade 路徑同形，已由該處測試涵蓋 |

## References

- 實作與論證正本：[Auto-Loop Autonomy 實作紀錄 §3](../4-implementation.md)
- 彙整 spec：[../2-tech-spec.md](../2-tech-spec.md) §3.6
- 規則契約：`rules/auto-loop.md` § Stall Detection、§ Cap Diagnostic Protocol
- Reflexion: Language Agents with Verbal Reinforcement Learning — arXiv:2303.11366（Ω=1–3 episodic buffer；重複行為門檻 3）
- ReflexGrad — arXiv:2511.14584（progress-gated 雙歷程路由：僅在戰術修正停滯時才動用昂貴的策略性推理）。它支撐的是「診斷由**證據**觸發、而非由輪數觸發」這個決定：cap 是輪數閘門，`[LOOP_STALL]` 是進度閘門，而把診斷掛在後者上正是這篇的結論
