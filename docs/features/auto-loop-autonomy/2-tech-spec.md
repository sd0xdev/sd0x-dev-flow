# Auto-Loop Autonomy Technical Spec

> **Doc class**: Lifecycle phase 2（`@rules/docs-numbering.md`）
> **Created**: 2026-08-04
> **Status**: Consolidating — R1–R9 皆為 Candidate Complete

這份 spec 是**事後彙整**，不是實作前的設計稿。本 feature 以 R1–R9 九份 request doc 逐案推進，實作細節與論證寫在 `./4-implementation.md`。它存在的理由有二：`@rules/docs-numbering.md` 把 phase 2 列為 Required；以及 `scripts/lib/fc-extractor.js` 的 `classifySpecState()` 在缺 `1-requirements.md` 與 `2-tech-spec.md` 時回 `no-spec`，`fc-aggregator.js` 隨即讓 `/feature-completeness` 對本 feature 判 `⛔ Incomplete — no 1-requirements.md or 2-tech-spec.md`。缺這份檔案不只是體例問題，是本 repo 自己的工具會誤判。

**本檔不重述 `4-implementation.md` 的內容**，只提供 R1–R9 的合併敘述與交叉索引。任何論證的正本在實作筆記，這裡只放指標。

## 1. Requirement Summary

一句話：**讓 auto-loop 在不放寬任何 gate 的前提下，把「模型該自行判斷」的部分交還給模型。**

原始動機是四個使用者提問（2026-07-26）：程式碼註解過長、超過 10 輪要先診斷再繼續、規則與彈性的平衡、以及「review 輪數多但要有實質進度」。R1–R9 是這四問拆解後的工作單元（R9 為 2026-08-04 補開，見該列）。

| # | Request | 解決的問題 |
|---|---------|-----------|
| R1 | Dual-Mode 復原訊號修正 | dual mode 下復原訊號不正確 |
| R2 | Hook 事實訊號標準化 | hook 應輸出**事實**（`[AUTO_LOOP_STATE]`）而非裁決，處置權留給行為層 |
| R3 | Auto-Loop 散文縮減 | 常駐 context 過重；論證下沉到 `../auto-loop-evolution/4-implementation.md`（R3 的考古去處，非本 feature 的實作筆記），規則檔只留契約 |
| R4 | 敏感路徑 Advisory Hint | 安全／資料完整性路徑需提示升級，但不得硬性改寫 tier |
| R5 | 程式碼註解精簡與文件指向 | 使用者提問 1——長註解遷移到文件並留指標 |
| R6 | 觸頂診斷協定 | 使用者提問 2——Cap Diagnostic Protocol 與 round-10 checkpoint |
| R7 | 規則授權層級與提案核准通道 | 使用者提問 3——Anchor／Default／Guidance 與 Anchor Register |
| R8 | 規則覆寫契約遷移 | user-owned override 檔的解析順序，Anchor-first |
| R9 | 進度帳本 | 使用者提問 4——`[LOOP_PROGRESS]` finding 身分集合，讓 R6 的診斷有素材可讀（2026-08-04 補記 ticket） |

## 2. Existing Code Analysis

| 面向 | 現況 |
|------|------|
| 狀態檔 | `.claude_review_state.json` schema **v3**（`grep -nE '"schema_version": 3\|\.schema_version = 3' hooks/post-tool-review-state.sh` 恰兩處：初始化寫入與遷移目標）；schema 正本在 `../auto-loop-evolution/2-tech-spec/2-tech-spec.md`——注意該檔的 JSON 範例仍標 `"schema_version": 2`，是 v2 時期的設計稿，欄位形狀有效但版本號落後 |
| 輪數計數 | `current_round`（本次變更；precommit 通過**且**計數器通過整數性驗證、`max_rounds` 與持久值一致、且仍低於 clamp 後的 cap 時才歸零——`grep -n 'then \.iteration_history\.current_round = 0' hooks/post-tool-review-state.sh` 唯一命中即該處，三道守衛在其正上方）／`total_rounds_session`（狀態檔生命週期累計，**跨 session 保留**）——為何選前者見 `./4-implementation.md` §1.1。那道 cap 守衛是有後果的：跑過 cap 的 loop 從此拿不到清除，見 §1.1 末段 |
| 鎖 | lockdir 協定（`_lock`／`_own_lock`／`_unlock`），TTL + liveness 失效復原 |
| 規則層級 | `rules/discretion.md` 為單一權威；Anchor Register 是封閉清單 |

## 3. Technical Solution

### 3.1 R7／R8 — 授權層級（規則層，無程式碼）

三層 Anchor／Default／Guidance，加一份封閉的 Anchor Register。`rules/discretion.md` 是唯一判定處：Register 命中即 Anchor，任何檔案裡寫在指令旁的層級標註都無法降級它（**Anchor-first**，解析步驟 0）。偏離 Default 的方式是輸出 `[DEVIATION]` 行**並繼續工作**——它是陳述，不是請求。

覆寫契約（R8）：`auto-loop-project.md` 與 `testing-project.md` 為 user-owned，只能覆寫 Default／Guidance；未知 heading **fail closed 到 Default 並列入報告**，不得靜默丟棄。契約正本在 `rules/auto-loop.md` § Override Contract 與 `rules/testing.md` § Project Customization。

由 `test/rules/discretion-tiers.test.js` 釘住——Register 條目被降級時該測試依設計會紅。

### 3.2 R6 — 觸頂診斷與 round-10 checkpoint

兩個不同機制，共用同一份診斷清單：

| | 觸發 | 效果 |
|---|------|------|
| Cap Diagnostic Protocol | `current_round >= max_rounds` | 診斷 → 一次有界調整 → 回到 loop；每個 change 只准一次，第二次觸頂 → ⚠️ Need Human |
| `[STRATEGIC_RESET]` checkpoint | `current_round >= AUTO_LOOP_CHECKPOINT_ROUNDS`（預設 10） | 同一份清單，但**不擋、不動輪數預算**，每個 change 每個 session 一次 |

checkpoint 在 `fast`（cap 6）構不到——會先撞 cap；`standard`（15）與 `thorough`（30）自 R10 起則**由構造保證可達**。反過來說，「構不到」從來就不是不變式：沒有任何機制把 `current_round` 夾在 `max_rounds` 以內，而 `warn` 模式（本專案設定）的 stop-guard 不會真的停下 loop，因此即使在 R10 之前，跑過 cap 5 的 `standard` loop 一樣會到達 10 並觸發。設計論證與旗標的兩個清除點見 `./4-implementation.md` §1.1、§1.2。

### 3.3 R9／使用者提問 4 — 進度帳本

`[LOOP_PROGRESS] round=n closed=a persisted=b new=c findings=d`，記錄 finding **身分**（`file issue`——行號**已被剝除**，見 `./4-implementation.md` §2.2）而非計數——計數分不出「修掉一個、引入一個」與「什麼都沒動」，兩者都讀作 `total=2`。

三個必須一起讀的限制：只有 **code plane** 且**成功寫入 counter** 的輪次會發出；`persisted + new < findings` 表示帳本讀不到本輪 findings（section 形狀的報告沒有逐條文字），其數字不構成證據；**缺席不是訊號**，不得讀作 `closed=0`。churn signature 統一敘述為「一連串 `closed=0` 且仍有 findings 未結」。機制見 `./4-implementation.md` §2。

### 3.4 R5 — 註解長度與文件指標

以**邏輯區塊**（空行會**橋接**兩段註解）為單位，≥30 行阻擋、25–29 行警告。遷移是**移動或去重，不得淨損失資訊**。指令／授權首行豁免只涵蓋**該指令所領的連續段**，不涵蓋橋接進來的部分——否則一行 SPDX 加一個空行就能洗白任意長度的論述。

機械檢查 `scripts/check-comment-blocks.js`，接進 `/precommit` 的 `comment_blocks` 步驟（policy 步驟：會讓 run 失敗，但不算「validation 有跑」）。註解語法**逐語言解析**，`.sh` 只計 `#`。規則正本 `rules/docs-writing.md` § Code Comments。

### 3.5 R2／R4 — 事實訊號與敏感路徑提示

hook 輸出事實、行為層做裁決。R4 的敏感路徑只產生 advisory hint，**不改寫 tier**——真正的強制來自 `rules/auto-loop.md` § Tiers 那句 Anchor（Register #3）：安全或資料完整性變更一律以 `thorough` 審查，不論設定為何，覆寫亦然。

### 3.6 R10 — 卡關偵測與卡關記憶

R9 讓迴圈能**描述**自己有沒有在動，R10 讓它能**注意到**自己沒在動。缺的那一環是「學習」：先前沒有任何地方記得上一次診斷試了什麼。

`[LOOP_STALL] streak=n threshold=t round=r`：連續 `AUTO_LOOP_STALL_ROUNDS`（預設 3，Reflexion 的重複行為門檻）個 stall round 後發出。stall round 需三條同時成立——帳本讀得到（`persisted + new >= findings`）、仍有 findings 未結、`closed = 0`。第三種狀態是關鍵：帳本讀不到的輪次**維持** streak 原值，既不計入也不重置，因為 §3.3 的「缺席不是訊號」必須對稱地兩邊都成立。**邊緣偵測**，每個 streak 只發一次；有進展即歸零並自動重新武裝，因此不需要 checkpoint 那種 `*_fired` 旗標。

`[STALL_MEMORY] class=… | tried=… | outcome=… | <ISO8601>`：FIFO 保留最近 3 筆（Reflexion Ω=1–3），在下一次 `[LOOP_STALL]` 或 `[STRATEGIC_RESET]` 之下**縮排**讀回。兩個設計決定各自封住一個具體失效：記錄自 **command** 解析而非 tool output——模型是作者而 tool output 不是模型的串流，且讀 output 會讓一次 `cat rules/auto-loop.md` 把該節的格式範例偽造成真記錄；讀回無法被任一 ingest 路徑重新吃進去——保證來自**拆分**而非縮排：ingest 需要 `[STALL_MEMORY]` 與 `class=` 同行，而讀回把 marker 只放在 header（無 `class=`）、`class=` 只放在記錄行（無 marker），兩半都不是記錄。縮排是給讀的人看的；ingest 從未錨定 column 0。

cap 隨之調整為 `fast` 6／`standard` 15／`thorough` 30。cap 原先兼任 runaway backstop 與卡關偵測器，後者它結構上做不到（收斂的迴圈與空轉的迴圈停在同一個數字）；偵測獨立後 cap 回歸單一職責。`standard` 提到 15 另外修掉一個死角：round-10 checkpoint 在原本 cap 5 的預設 tier **通常**觸發不到（只有跑過 cap 的 `warn` 模式 loop 構得到，見 §3.2），等於是一段幾乎跑不到的活程式碼。行為層 tier cap 與 hook 持久化的 `max_rounds`（未設定時一律 30）是兩個數字，**取較低者**。

`/refactor` 成為 `DOC_TOO_LONG` 與 `ATTENTION_DIFFUSION` 的正式 bounded adjustment，受五項護欄（`--target` 恆用、重開 code gate、內部品質檢查不等於本迴圈 gate、security／data-integrity 排除、共用診斷預算）。機制與論證見 `./4-implementation.md` §3。

## 4. Risks and Dependencies

| 風險 | 處置 |
|------|------|
| 規則層變更無法以測試涵蓋 | `test/rules/` 以結構不變式釘住 Register 與覆寫表 |
| hook 寫入競態導致訊號遺失 | lockdir + fail-closed sidecar；帳本缺席明確定義為「非訊號」 |
| 文件與程式碼漂移 | 本 feature 自己踩過多次（寫死計數、過期的規避理由）；對策是**不寫可漂移的數字**，要寫就附推導指令與量測日期 |

## 5. Testing Strategy

| 層 | 檔案 |
|----|------|
| 規則結構不變式 | `test/rules/discretion-tiers.test.js`、`test/rules/*.test.js` |
| 規則↔hook 跨檔一致性 | `test/rules/stall-detection.test.js`（門檻、FIFO 界、六分類閉集、`codex-code-review` 不再自行敘述 cap 數字） |
| Hook 行為 | `test/hooks/post-tool-review-state.test.js`、`state-commit-ownership.test.js`、`jq-filter-fidelity.test.js` |
| 共用結構解析 | `test/helpers/shell-structure.test.js` |
| 註解檢查器 | `test/scripts/check-comment-blocks.test.js` |

守衛類測試依 `rules/testing.md` § Conventions「Guards」列要求**雙向**：拒絕的案例與用相同字詞當一般資料的通過案例必須同時存在。

## 6. Cross-References

- `./4-implementation.md` — 實作筆記，所有論證的正本
- `./requests/` — R1–R10
- `../auto-loop-evolution/4-implementation.md` — 狀態檔、sidecar、鎖的機制
- `rules/discretion.md`、`rules/auto-loop.md`、`rules/docs-writing.md`
