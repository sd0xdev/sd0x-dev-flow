# Pre-Push Gate: Downstream Restatement Consistency Sweep

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: In Progress
> **Note**: ⚠️ 本單與 [r2](./2026-08-15-push-gate-optin-r2.md)、[r3](./2026-08-15-push-gate-optin-r3.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）。工作**順序**上本單在 r2/r3 的編輯之後，但那是工作區內的先後，不是發佈先後 —— 故不使用 `Depends On`。跨 feature 修改需與 `create-pr-stacked` 進行中的工作協調
> **Priority**: P2
> **Tech Spec**: Pending（掃描型工作，無獨立設計）

## Background

方案 A 改變的是契約本體（`rules/`、`skills/push-ci/`、README —— 由 r3 負責），但 repo 內另有多份文件**轉述**該契約，且皆為無條件敘述。r3 落地後這些轉述會與契約矛盾。已確認涉及者：

| 文件 | 位置 | 現行無條件敘述 |
| ---- | ---- | -------------- |
| `docs/cookbook/ship-change.md` | `:32,38` | 「`/push-ci` warns and requires terminal confirmation」、「Terminal `/dev/tty` confirmation」 |
| `docs/features/create-pr-stacked/2-tech-spec.md` | `:20,37,53` | 把 `pre-push-gate.sh` 列為每次 push 的 policy gate 與 Anchor #4 例外的組成 |
| `docs/features/create-pr-stacked/1-requirements.md` | `:38` | 「push 是其獨佔授權工作流；stacked 模式任何 push 需求都必須經過它或維持 dry-run」 |
| `docs/features/readme-catalog-sync/2-tech-spec.md` | `:145` | 「`/codex-setup init` … AGENTS.md kernel + git hooks」—— 安裝面轉述，複數 hooks |

`create-pr-stacked` 的兩張 request（`2026-07-31-stacked-pr-mode-r1/r2.md`）目前皆為 **In Progress** —— 動它的 current-authority 文件必須與該 feature 的進行中工作協調，不可逕行改寫。

**與 r2/r3 的原子性約束**：本單不能靠排先後解決。先於 r2+r3 落地，是用舊實作描述新契約；後於它們落地，則兩次發佈之間留著與新契約矛盾的 current-authority 文件。任何一種順序都留下不一致的中間態，故 **r2、r3、r4 必須一起合併**；r1 為純缺陷修復，不受此約束，可獨立落地。

## Requirements

- 掃描 `docs/` 全域，找出所有轉述推送授權契約的無條件敘述
- 只修正 **current-authority** 文件；**記錄類文件一律不動**
- 跨 feature 的修改先協調再落地

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `docs/cookbook/`、`docs/features/*/` 的生命週期檔（`0-`～`4-`）中轉述本契約之處 |
| Out | `rules/`、`skills/push-ci/`、README ×6（皆屬 r3，不重複認領）；`/codex-setup`（r2）；`scripts/pre-push-gate.sh`（r1） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `docs/cookbook/ship-change.md` | Modify | `:32,38` 條件化 |
| `docs/features/create-pr-stacked/2-tech-spec.md` | Modify | `:20,37,53`；需與該 feature 進行中工作協調 |
| `docs/features/create-pr-stacked/1-requirements.md` | Modify | `:38` 同 feature 對應敘述 |
| `docs/features/readme-catalog-sync/2-tech-spec.md` | Modify | `:145` 安裝面轉述（複數 "git hooks"） |
| `docs/features/{upgrade-doctor,hook-lightweighting,cross-tool-portability,harness-engineering-rebrand}/` | Review | 生命週期檔涉及 pre-push 敘述，逐份判定是否為 current-authority |

> **本表與 § Background 的行號為 2026-08-15 的座標（2026-08-20 round 16 補記）**。重新推導：`ship-change.md:32,38` 與 `create-pr-stacked/1-requirements.md:38` **仍然成立**；`create-pr-stacked/2-tech-spec.md:20,37,53` 與 `readme-catalog-sync/2-tech-spec.md:145` **已位移**（後者現為 `:180`，前者見 AC 2 的節名列舉）。動工前的目標清單本身是記錄，故只在此標明時態與哪幾個已失效。

> **路徑變更（2026-08-21 補記）**：`docs/features/create-pr-stacked/2-tech-spec.md` 已依
> `@rules/docs-numbering.md` § Size Limit 切分，現址為
> `docs/features/create-pr-stacked/2-tech-spec/2-tech-spec.md`（§ 3.4 另切出為同資料夾的
> `1-core-logic.md`）。本表與本單其他各處寫下的是 2026-08-15 當時的正確路徑，故不改寫；讀者依本註記
> 換算即可。切分本身記錄於 `create-pr-stacked/requests/2026-07-31-stacked-pr-mode-r2.md` § 待辦。

## Acceptance Criteria

- [x] `docs/cookbook/ship-change.md:32,38` 條件化，不再無條件宣稱終端確認為最終閘門
- [x] `create-pr-stacked` 的 `2-tech-spec.md:20,37,53` 與 `1-requirements.md` 對應敘述條件化，且落地前已與該 feature 兩張 In Progress request 協調（協調結果記入本單 Progress）

  > **⚠️ 條文還原（2026-08-21 doc review round 25）**：上一行在 round 16 曾被**就地改寫**——原文的 `:20,37,53` 座標被刪去、換成當時推導出的現況列舉。那是把記錄改寫成今日狀態，記錄因此喪失「當初要求什麼」與「後來查出什麼」的區別。原條文已按 `HEAD` 逐字還原，改正內容全部下移到本註記。勾選框維持 `[x]`：勾選是進度欄位，可更新；條文不是
  >
  > **落地結果（round 16 推導，內容不變）**：`2-tech-spec.md` **共六處**（§2 skill 表 `/push-ci` 列、§2 Anchor #4 例外表 `git push` 列、§3.4 sequenceDiagram 的 push 註、§4 R2、§4 R5、§7 Q1）加 `1-requirements.md` 一處，皆已條件化（stack 每層都是 feature branch，hook 不對其提示，故兩種安裝狀態下 AskUserQuestion 都是授權本身）。協調結果見下方「跨 feature 協調結果（AC 2）」一節，兩張 request 本身零改動
  >
  > **定位方式（2026-08-20 doc review round 16 補記）**：本條的 `:20,37,53` 等行號是 2026-08-15 的座標，皆已被後續編輯推移，判讀時一律改以**節名**標定；行號請以 `grep -rnE 'pre-push|push-gate|AskUserQuestion' docs/features/create-pr-stacked/2-tech-spec/` 現場推導（**2026-08-21 修正指令路徑**：該檔已切分為資料夾，舊指令指向的單檔路徑已不存在，會回傳 `No such file`）
  >
  > **落地形式更正（2026-08-21）**：本條寫的「`1-requirements.md` FR-4（`:38`）一處」有兩個錯。其一，`:38` 是該檔的 **stakeholder 表 `/push-ci` 列**，不是 FR-4（FR-4 在 `:65`；推導：`grep -n '^| FR-4' docs/features/create-pr-stacked/1-requirements.md`）——本單實際條件化的是那兩處。其二更重要：那兩處原本是**就地改寫**該檔的原始表列，而該檔是 Phase 1 生命週期記錄；2026-08-21 已將兩列**還原為 2026-07-31 原文**，條件化內容改以緊接各表之後的日期註記表述。落地處數不變，落地**形式**改變——與 `cross-tool-portability`／`readme-catalog-sync` 兩檔在 round 14 的處置同一類
- [x] `docs/features/readme-catalog-sync/2-tech-spec.md:145` 的安裝面轉述改為區分預設安裝與 opt-in

  > **⚠️ 條文還原（2026-08-21 doc review round 25）**：與 AC 2 同一類的改寫——原文的 `:145` 座標曾被刪去、換成「§ README 產生範例中的 `codex-setup init` 列」。原條文已逐字還原；該節名是**現址**的定位方式，記於此：`:145` 的座標已位移，現行位置即 § README 產生範例中的 `codex-setup init` 列
  >
  > **本條的落地方式在 2026-08-20 doc review round 14 被改正**：該檔是 Design record，原先的就地改寫已還原為 2026-03 原文（`AGENTS.md kernel + git hooks`），改以緊接該範例區塊之後的日期註記記錄「generator 現行逐字輸出」。因此照本條行號去看會看到**刻意保留的歷史示意列**，那不是殘留，判讀依據是那條日期註記
- [x] 其餘 `docs/features/*/` 生命週期檔逐份判定並修正：已知候選為 upgrade-doctor、hook-lightweighting、cross-tool-portability、harness-engineering-rebrand
- [ ] **記錄類文件（`requests/`、`review-log-*`、`adr-*`）一律未被修改** —— 記錄與後續變更脫節是記錄正常運作，改寫會摧毀記錄（`@rules/docs-numbering.md` § Size Limit、`skills/update-docs/SKILL.md` § Step 1.5）

  > **⛔ 這條的字面條件**（「一律未被修改」）**不成立，故不勾選**（2026-08-21）。`git status --short docs/` 直接否證它：本任務自己的五張單（r1–r5）以及 `create-pr-stacked` 的兩張 request、兩份 review log 都是 modified。
  >
  > 實際達成的是一個**較窄的結果**，記於此而不改寫上方條文：**他人的**記錄類文件未被 r4 的下游轉述一致性掃描改寫——`review-log-*`、`adr-*`、他人的 `requests/` 皆非本掃描的改動對象；本掃描動到的只有本任務自己的五張單。`create-pr-stacked` 那四個檔的改動屬**該 feature 自己的 doc review 迴圈**（`2-tech-spec.md` 依 § Size Limit 切入 `2-tech-spec/` 資料夾後的入向連結重指，加上該 feature 自己的 finding 修復），不是本單所為。查核指令：`git diff --numstat HEAD -- docs/features/create-pr-stacked/`——**此處不抄下輸出值**，那些數字在 review 迴圈中每輪都變。
  >
  > 差距說明：原條文寫成絕對句，而正確的要求應該是「不得改寫**他人的**記錄」。條文本身是當初要求的記錄，故保留原文；要不要以較窄版本重開一條 AC，屬本單合併時的決定。
- [ ] 收尾 grep 證明 `docs/` 已無殘留敘述，**兩類都要掃**：無條件的終端確認宣稱，以及暗示兩個 hook 皆預設安裝的安裝面轉述；該命令寫入本單供複核

  > **⛔ 這條的字面條件**（grep「證明」已無殘留）**不成立，故不勾選**（2026-08-20 doc review 抓到）。它與本單「收尾驗證（AC 6）」節內〈**此 grep 是輔助而非證明**〉那一條自陳的說法直接矛盾：grep 抓的是固定措辭，抓不到任意改寫的語意等價句——同節〈**第四類：grep 沒有 pattern、只能靠審讀的語意等價句**〉記的兩筆漏網者就是實例。
  >
  > 實際達成的是：收尾 grep **已執行**，且每一筆命中都已逐筆判定（結果見該節）。實質證據是逐檔審讀 + `/codex-review-doc`（下一條，尚未通過）。同樣地，條文保留原文，改寫可勾條件屬合併時的決定。
  >
  > **（round 14 補記）** 記錄內指向自身的指標一律用**節名與條目標題**，不用行號——行號會隨每一輪註記漂移，節名不會
- [ ] 本單與 r2、r3 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度

  > **⛔ 這一條已經被違反，不是「尚未完成」（2026-08-21 查證）**。本條禁止的不一致中間態**已經發生**：`2692ede`（2026-08-16，主旨為 repo 更名同步）把 README 的 `--with-push-gate` opt-in 措辭發佈了出去，而安裝器側從未跟上。查證指令與結果：`git log --oneline -S'--with-push-gate' -- README.md` → 只有 `2692ede`；同樣的指令對 `skills/codex-setup/SKILL.md` → **全歷史為空**；`git show HEAD:README.md | grep -c 'with-push-gate'` → 1，`git show HEAD:skills/codex-setup/SKILL.md | grep -c 'with-push-gate'` → **0**。即 HEAD 的 README 已宣告 opt-in 旗標，HEAD 的安裝器卻不認得它——這正是 r2 § Background 所預言的「r3 先落地，README 宣告 opt-in 但安裝器仍無條件安裝」那一種中間態
  >
  > **本條的狀態因此是「已失敗」而非「未開始」**，勾選框留空所表達的意思要改讀：它不再代表「等待三單一起落地」，而是代表**已發佈的不一致尚未被調和**。調和方式（本工作樹已備妥、待同批提交）：`skills/codex-setup/SKILL.md` 的 opt-in 生命週期（r2）與 `rules/`／`skills/push-ci/` 的授權契約（r3）與本單的下游轉述，一起進入同一批 commit，使安裝器追上 README 已發佈的宣告。在那批落地前，README 的該段對外仍是超前敘述
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 doc review R2 指出三張單的聯集不完整。掃描結果：cookbook 與 create-pr-stacked（含 `1-requirements.md:38`）為確認命中，R3 再補出 `readme-catalog-sync/2-tech-spec.md:145`；另有四個 feature 目錄待逐份判定是否為 current-authority |
| Development | Done | 逐檔逐節列舉如下，**不記聚合處數**——處數在每一輪 review 都被重新推導出不同的值，寫下即過期。cookbook：終端閘門宣稱兩節。`create-pr-stacked/2-tech-spec/`：§2 skill 表 `/push-ci` 列、§2 Anchor #4 例外表 `git push` 列、§3.4 sequenceDiagram 的 push 註、§4 R2、§4 R5、§7 Q1。其 `1-requirements.md`：stakeholder 表 `/push-ci` 列、FR-4——**兩處皆已於 2026-08-21 還原原表列文字**，條件化內容改以表後日期註記表述。`readme-catalog-sync/2-tech-spec.md`：§ README 產生範例的 `codex-setup init` 列。`cross-tool-portability/2-tech-spec.md`：安裝圖、init/sync 指令表、state schema `commit-msg` 補 `status`、Risk 1。後兩檔與 `1-requirements.md` 同為記錄類，就地改寫皆已還原為原文，八月行為改以日期註記表述——落地**形式**改變，涵蓋範圍不變。其中一處為收尾 grep 補抓、非人工逐行找出 |
| Testing | Done | 收尾 grep 見下方「收尾驗證」，執行結果與逐檔審讀併記於該節（**非 CLEAN**：命中皆經判讀，兩筆語意等價句是 grep 抓不到、由審讀補上的）。**他人的**記錄類文件未被本掃描修改：`review-log-*`、`adr-*` 零改動；`requests/` 唯一被動的是本任務自己的五張單（r1–r5） |
| Acceptance | Blocked | 待 `/codex-review-doc`。**AC 5、AC 6 不勾選**——兩者的字面條件已被證據否證，理由見各條下方的註記。**AC 7（原子發佈）已被違反**：`2692ede` 已把 README 的 opt-in 措辭發佈出去，而安裝器側從未跟上；查證與調和方式見該條註記，調和尚未完成。AC 2 已補齊並勾選：協調結果記在下方「跨 feature 協調結果（AC 2）」一節。**注意「本單沒改」與「檔案沒變」是兩件事**：`create-pr-stacked` 的兩張 request 在同一工作樹中確有改動，但那是該 feature 自身 doc review 迴圈的產物（入向連結重指與 split 完成註記），不是 r4 的轉述掃描所為 |

## 跨 feature 協調結果（AC 2）

協調對象、逐項關係表與衝突面分析已移至
[`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § 跨 feature 協調結果（AC 2）
（2026-08-21，依 `skills/create-request/SKILL.md` § Write-Time Budget）。**意圖為整段搬移；「未改寫」無工件可複核**——被搬走的內容是本次工作樹更早輪次寫成的，`HEAD` 版本不含它。
結論：無語意衝突，兩張 request 本身零改動。

## 收尾驗證（AC 6）

逐輪掃描指令、命中判定與四類漏網分析已移至
[`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § 收尾驗證（AC 6）
（2026-08-21，依 `skills/create-request/SKILL.md` § Write-Time Budget：需求單是工作單元，逐輪證據屬
review log）。**意圖為整段搬移；「未改寫」無工件可複核**（同上，`HEAD` 不含被搬走的內容）；AC 6 的判定仍見上方該條的註記。

## References

- 記錄豁免依據：`skills/update-docs/SKILL.md` § Step 1.5 —— doc sync 不觸碰 request ticket
- 前置單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)
  - **2026-08-21 更正**：此條原文保留。撰寫當時記為「前置單」，隱含 r3 須先行合併；實際的發佈關係是
    **原子發佈集**——r2、r3、r4 三單必須一起合併，彼此並非序列前置（見本單頁首）。更正只以本註記追加，
    不改寫原句：request ticket 是記錄，它與今日事實的落差本身就是記錄在運作
    （`skills/create-request/SKILL.md` § Phase 4.5）。上一輪此處是就地改寫，那是同一份文件在同一輪
    裡對其他條目用附記處理、卻對這一條沒有的不一致，而不是別的判斷。
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)、[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)

> **2026-08-21 更正（記錄還原）**
>
> 頁首 `Tech Spec` 那行上一輪被就地改寫成指向 `../2-tech-spec.md` 的連結。原句已還原：撰寫當時
> 這張單確實沒有 tech spec，寫著 `Pending` 是當時成立的事實，把它改成今天的連結等於用後見之明覆寫
> 記錄。實際的關聯改以本註記表述——設計面現在落在
> [`../2-tech-spec.md`](../2-tech-spec.md) § 2（本單為掃描型工作，無獨立設計面）。
>
> 這是與 r4 § References 同一類的錯誤，同一輪各犯一次：request ticket 是記錄，可變欄位只有
> Status／Progress 表／AC 勾選／Progress.Note 四項（`skills/create-request/SKILL.md` § Phase 4.5），
> `Tech Spec` 不在其中。上一輪我掃自己的就地改寫時，把 `Tech Spec` 連同那四項一起濾掉，於是掃出
> 「只有一處」——漏的不是證據，是把不可變欄位算進了可變集合。

> **2026-08-22 收尾註記（round 81，使用者裁示停手）**
>
> 使用者在 round 80 之後裁示：對當時那棵樹再派一次 code + doc review，**不論回 Ready 或 Blocked
> 都停下來交接**，不再進入修復迴圈。round 81 兩個平面都回 blocked——code `⛔ Blocked`
> （`gate_reason=IN_SCOPE_BLOCKING`，3 筆：1×P1 + 2×P2）、doc `⛔ Needs revision`（4×P2）。
> 七筆**全部開著、未修**，逐筆內容記在
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § Round 81。
>
> 本單 Status 維持 `In Progress`，AC 維持 4/8——round 79–81 做的是內部強化（`readonly`
> 拒絕紀錄凍結、Husky 接線判定的三次收窄），沒有推進任何一條 AC。未勾選項全部是品質閘
> （`/codex-review-fast`、`/precommit`、`/codex-review-doc`）、需要 commit 才成立的
> 「同一批落地」條款，或先前已裁示刻意不勾的項目。
>
> 停手時的實測狀態：全測試套件 4097 tests / 4093 pass / 0 fail / 4 skipped；
> `node scripts/check-comment-blocks.js` exit 0（18 筆既有 WARN、0 BLOCK）。
> `/precommit`、Adequacy Gate、Doc Sync 這一輪都沒有抵達，依 `rules/auto-loop.md` 的終局完成
> 不變式，這批變更**尚未完成**，只是停在可交接的位置。
