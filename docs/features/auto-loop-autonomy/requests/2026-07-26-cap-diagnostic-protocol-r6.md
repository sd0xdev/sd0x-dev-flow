# Auto-Loop 觸頂診斷協定 (R6)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 改寫既有的 opt-in Strategic Reset，而非新建機制。與 R2 的事實訊號互補：R2 讓模型知道「現在站在哪」，R6 處理「一直走不出去時該怎麼辦」。父 tech spec 尚未建立（見 References）
> **Priority**: P1
> **Depends On**: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md) · [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md) — R3 重寫 `rules/auto-loop.md` § Exit Conditions，本張改寫同一節，須在其定稿後進行
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`

## Background

今天撞到輪次上限的行為是**直接升級人工**（`rules/auto-loop.md` § Exit Conditions 第 1 列 → `⚠️ Need Human`）。上限本身不診斷，也不追問「為什麼會走到這裡」。

已存在一個部分相關的機制，但七項條件都與需求不符。實測 `hooks/post-compact-auto-loop.sh:265-300`：

| 面向 | 現有 Strategic Reset | 需求 |
|------|---------------------|------|
| 啟用 | **opt-in**，`rules/auto-loop-project.md` 中 `## Think Harder: enabled` 目前為註解狀態（未啟用） | 預設生效 |
| 觸發時機 | `total_rounds_session >= max_rounds - 3`，**在**上限前 | 觸頂時 |
| 觸發管道 | 只掛在 `matcher: "compact"` 事件（`hooks/hooks.json` 與生成的 `.claude/settings.json` 皆為此 matcher）— 沒發生 compaction 就永不觸發 | 不依賴 compaction |
| 內容 | 5 條泛用清單（重讀需求、挑戰假設、換路徑） | 具**診斷分類**的根因分析 |
| 產出 | 提示文字 | 一次**有界的**結構調整 |
| 收尾 | 「若仍卡住，於 max_rounds 升級」 | 調整後**回到 auto-loop** |
| 次數 | 每個 state 檔生命週期一次（`strategic_reset_fired`） | 每次觸頂一次，且有防迴圈上限 |

`ITER_MAX` 由 `post-compact-auto-loop.sh:255` 解析，預設 **30**，與需求所述輪次相符。

**`stop-guard.sh` 目前主動指示相反行為。** 觸頂時 `:1128-1130` 會清空 `MISSING` 並改寫原因（註解明寫 `Hard cap: override MISSING — human intervention needed, not more review cycles`），`:1177-1179` 進一步把訊息換成 `Max rounds reached; escalate to human, do not auto-retry`，並在 strict 下以 `exit 2` 送出。本張若只改規則而不動這裡，模型會同時收到「先診斷再續行」（規則）與「不得自動重試」（hook stderr）兩個對立指令——而 hook 訊號在 strict 下是硬性的。

**但 hook 不能改為「有條件地」指示不同處置。** 觸頂分支能取得的 state 只有 `ITER_ROUND` 與 `ITER_MAX`（`:1115-1116`）；既沒有「本次觸頂前是否已診斷過」的持久標記，也沒有變更風險性質的判別欄位。`strategic_reset_fired` 無法替代——它是 state 檔生命週期範圍、且只在 compaction 發生後才寫入，沒發生 compaction 時恆為 false。相同的 hook 輸入無法同時滿足「首次觸頂允許診斷」與「第二次觸頂要求人工」。要讓 hook 具備此判別，必須新增持久欄位與其生命週期，屬 schema 變更、超出宣告半徑。

因此 `stop-guard.sh` 的改動限定為**把觸頂訊息中性化**：移除 `do not auto-retry` 這類處置裁決，只回報「已達輪次上限（n/max）」的事實。**首次／第二次／敏感變更的分流全部留在 `rules/auto-loop.md`**，由模型依規則判斷。這同時與 R2 的「emitter 只述事實、不得指定強制下一步」契約一致——若在此處引入條件式祈使句，等於在 R2 剛拆掉命令式訊號後又裝回一個。

**現場案例（撰寫本張的 session）**：doc review 連跑三輪撞到 `fast` tier 上限，第三輪由 reviewer 判定 `⛔ Blocked` 並要求升級人工。三輪的 blocking 涵蓋數類缺陷（遺漏的 emitter、被誤當交付物的 gitignore 生成檔、失效的 regex、單內自相矛盾），其中**反覆出現**的一類是「文件宣稱未經量測」，且有一輪的缺陷是前一輪修正時新引入的。若當時先做根因分類再繼續，會比再跑一輪更快收斂。同一份 state 的 `iteration_history.current_round` 為 `0`：doc review 輪次 hook 全程未觀測，上限純屬行為層自律，這正是本張必須落在行為層的原因。

## Requirements

- 觸頂時的預設動作由「直接升級人工」改為「**先診斷、再有界調整、然後回到 auto-loop**」
- 診斷須輸出**封閉分類**的根因，而非自由散文，使其可被檢查與累積
- 調整必須有界：範圍、性質與體量皆須事前聲明，禁止在迴圈中途變成重寫
- 需有防迴圈上限：同一個變更經診斷後再次觸頂 → 硬性 `⚠️ Need Human`，不得再診斷
- 觸發不得依賴 compaction 是否發生
- 安全與資料完整性變更的觸頂**不套用**本協定，維持直接升級人工
- `stop-guard.sh` 觸頂分支的訊息改為**中性事實**（回報已達上限與 round/cap 數值），移除處置裁決字句；**不得**改為依情境輸出不同指示——hook 缺少作此判別所需的輸入
- 首次／第二次／安全與資料完整性的分流**全部**由 `rules/auto-loop.md` 承擔，hook 不參與
- 不改 state schema、不改 exit code 分支（strict 仍 `exit 2`、warn 仍 `exit 0`，改的只是隨之送出的訊息語意）

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `rules/auto-loop.md` § Exit Conditions 第 1 列改寫；診斷分類定義；有界調整的界線定義；防迴圈上限；`auto-loop-project.md` 的設定項更新；**`stop-guard.sh` 觸頂分支的原因／指示字串**與其測試 |
| Out | state schema 新增欄位（含 per-cycle 診斷計數器 — 屬硬化軌）；exit code 分支變更；hook 端**強制執行**診斷（訊號可述、不可裁決）；`post-compact-auto-loop.sh` 的 compaction 注入管道本身（保留為輔助）；plateau detection（V2）；`current_round` 納入 doc review（enforcement lifecycle 變更） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `rules/auto-loop.md` | Modify | § Exit Conditions 第 1 列由 `⚠️ Need Human` 改為診斷協定；新增診斷分類表與防迴圈上限 |
| `rules/auto-loop-project.md` | Modify | `## Think Harder` 語意更新為本協定的開關 / 門檻覆寫 |
| `hooks/stop-guard.sh` | Modify | `:1128-1130` 的 `BLOCKED_REASON` 與 `:1177-1179` 的 `BLOCK_DESC` **中性化**（只述「已達 n/max」），移除處置裁決；不新增條件分支、不動 exit code |
| `test/hooks/stop-guard.test.js` | Modify | 觸頂訊息中性化的斷言；strict `exit 2` 與 warn `exit 0` 皆以實際執行釘住 |
| `hooks/post-compact-auto-loop.sh` | Modify | `THINK_HARDER=` heredoc（開單時 `:285-290`，現約 `:421`）的 5 條泛用清單改為診斷分類；保留為輔助管道而非唯一管道 |
| `test/hooks/post-compact-auto-loop.test.js` | Modify | 清單內容變更的斷言 |
| `docs/features/auto-loop-evolution/4-implementation.md` | Reference | 輪次計數器語意（§2）；本張不改其行為 |

**診斷分類（封閉集合，草案）**

| 分類 | 判定訊號 | 有界調整方向 |
|------|---------|-------------|
| `ARCHITECTURE` | 同一缺陷在不同檔案反覆出現；修 A 破壞 B | 停止修補，改回設計層並重新界定範圍 |
| `DOC_TOO_LONG` | 目標檔超過 `@rules/docs-numbering.md` 上限；reviewer 反覆指出前後不一致 | 先拆檔或縮減，再繼續審查 |
| `ATTENTION_DIFFUSION` | 修正引入新缺陷；同一事實反覆記錯 | 縮小單次修改批量，逐項驗證後再合併 |
| `UNVERIFIED_CLAIM` | blocking 集中在「宣稱未經量測」 | 先量測再下筆，將導出指令寫入文件 |
| `TIER_MISMATCH` | findings 嚴重度長期低於 blocking 門檻 | 依 tier 判定收斂並進入下一 gate |
| `REQUIREMENT_AMBIGUITY` | reviewer 與實作者對「正確」認知不同 | 向人類確認，不再自行猜測 |

## Acceptance Criteria

- [x] `rules/auto-loop.md` § Exit Conditions 第 1 列改為「診斷 → 有界調整 → 回到迴圈」，且**保留**安全／資料完整性變更直接升級人工的例外 — § Tiers cap 句改指向 § Cap Diagnostic Protocol；該節首段明訂安全／資料完整性例外（skip protocol → ⚠️ Need Human）
- [x] 診斷分類以封閉集合定義（≥6 類），每類含判定訊號與調整方向，非自由散文 — 6 類表（ARCHITECTURE…REQUIREMENT_AMBIGUITY），Signals + Bounded direction 兩欄
- [x] 明訂防迴圈上限：同一變更第二次觸頂即 `⚠️ Need Human`，且該上限在規則中以具體數字表述 — 「Anti-loop cap: 1 diagnosis per change」，第二次觸頂 → ⚠️ Need Human、不得再診斷
- [x] 「有界調整」的界線可檢查：明訂允許的變更性質與體量，並明確禁止在迴圈中途擴張為重寫 — 協定第 2 步：範圍（檔案）、性質（分類方向欄）、體量（單一拆分／單一重界定／≤5 個聚焦編輯），並明文禁止中途變成重寫
- [x] 觸發不依賴 compaction：規則層敘述不得以 post-compact hook 為唯一管道，且該 hook 仍可作為輔助注入 — 協定首段明訂觸發是 cap 本身（行為層），post-compact 注入為輔助管道、never the trigger
- [x] `post-compact-auto-loop.sh:285-290` 的清單改為診斷分類，`strategic_reset_fired` 的既有寫入邏輯與鎖協定零變更 — 該 5 條泛用清單（開單時位於 `:285-290`，實作時已因其他單移動；以 `THINK_HARDER=` heredoc 為穩定定位，現約 `:421`）改為 6 類 taxonomy + 指向句（不裁決分流，AC-trace High 修正後）；fired 寫入與鎖協定 diff 零觸及
- [x] `stop-guard.sh` 觸頂訊息為中性事實：不含 `do not auto-retry`、`escalate to human` 等處置裁決，且**不依情境分歧**（測試以實際執行 hook 取得 stderr 為證，非讀原始碼）— cap 訊息「Review round cap reached (n/max)」；cap+event-marker 並存路徑同步中性化（`SIDECAR_EVENT_NORETRY` 去祈使句與行動評價、BLOCKED renderer 改「Unretireable obligation: <事實>」）；strict/warn + 有無 marker 共 4 個實際執行 fixtures 釘住 stderr/stdout 禁語
- [x] 首次／第二次／安全變更的分流條文完全位於 `rules/auto-loop.md`；`stop-guard.sh` 的 diff 中無任何新增的條件式訊息分支 — 分流全在 § Cap Diagnostic Protocol；stop-guard diff 僅字串替換（cap matcher 為既有條件式），post-compact heredoc 尾句改為指向句、hook 不裁決（測試以負向斷言釘住）
- [x] state schema 與 exit code 分支零變更：觸頂在 strict 下仍 `exit 2`、warn 下仍 `exit 0`（**兩者皆以實際執行 hook 釘住**），`git diff` 中無 `jq` 寫入語句異動 — 4 個 cap fixtures 斷言 exit 2/0；diff 無 jq 寫入異動
- [x] Pass /codex-review-doc — rules/auto-loop.md + auto-loop-project.md ✅ Mergeable（2 P2 deferred）；本張與 R4 證據附註的 Doc Sync 編輯另行 doc review
- [x] Pass /precommit — `## Overall: ✅ PASS`（2955 tests / 2949 pass / 0 fail / 6 skipped，2026-07-29）；AC-trace `✅ Adequate`（AC7/AC8 High 缺口修正後複核）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 落點 | 裁決在行為層，hook 只述不裁 | hook 強制執行診斷 | doc review 輪次 hook 本就不觀測（實測 `current_round=0`），強制執行需改 enforcement lifecycle，超出宣告半徑 |
| hook 是否改動 | 觸頂訊息中性化，不改 exit 分支 | 完全不動 hook | 不動的話 hook 會持續輸出 `do not auto-retry`，在 strict 下硬性壓過規則，兩者對立 |
| hook 是否分流 | 否，只述事實 | hook 依首次／第二次／敏感度輸出不同指示 | 觸頂分支只拿得到 `ITER_ROUND`／`ITER_MAX`，無診斷嘗試標記亦無風險欄位；要判別須新增持久狀態，屬 schema 變更。且條件式祈使句會違反 R2 的純事實 emitter 契約 |
| 診斷產出 | 封閉分類 | 自由散文 | 散文無法檢查、無法累積；分類可在多次觸頂間比對 |
| 防迴圈 | 第二次觸頂硬性升級 | 無上限 | 「診斷後回到迴圈」本身可能無限循環，這是本協定最大的失敗模式 |
| 既有機制 | 改寫 Strategic Reset | 另建平行機制 | 兩套近似機制會產生哪套優先的歧義 |
| 安全變更 | 不套用，維持直接升級 | 一體適用 | 安全與資料完整性的觸頂不該由模型自行調整後續行 |

## Known Limitation

「診斷後回到迴圈」把一個確定性的停止點換成一個帶條件的續行點。防迴圈上限是唯一的硬保護，而它**完全在行為層**——hook 觸頂分支拿不到「是否已診斷過」與「變更風險性質」，因此無法機械執行首次／第二次的區分，`STOP_GUARD_MODE=warn` 下更無強制力。

這是本張最實質的取捨：把觸頂訊息中性化，等於移除了目前唯一一句硬性的「不得自動重試」，而換來的分流保證只存在於規則層。要恢復機械保證，需要一個持久的「診斷嘗試」狀態與風險判別欄位——屬 schema 變更，與 R4 的 enforcement-escalation 同屬硬化軌，本張不涵蓋。

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 現有 Strategic Reset 七項落差、`ITER_MAX` 預設值、hook 註冊事件皆經實測；現場案例取自本 session |
| Development | Done | rules/auto-loop.md § Cap Diagnostic Protocol、auto-loop-project.md Think Harder 語意、stop-guard cap 中性化（含 cap+marker 路徑）、post-compact taxonomy heredoc；code review ✅ Ready（AC-trace 修正回合共 3 輪驗證） |
| Testing | Done | stop-guard 4 個 cap fixtures（strict/warn × 有無 marker）+ post-compact taxonomy 斷言；/precommit ✅ PASS 2949/2955 |
| Acceptance | Done | AC-trace `✅ Adequate`（初判 ⛔ 2 High → AC7/AC8 修正 → 複核 Covered） |

## References

- 互補: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
- 相關: [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md)
- 輪次計數器語意: [Auto-Loop Evolution 實作紀錄](../../auto-loop-evolution/4-implementation.md) §2
- 既有 R10 需求: [Think Harder Near Cap](../../auto-loop-evolution/requests/2026-03-25-think-harder-near-cap-r10.md)
