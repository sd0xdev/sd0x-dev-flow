# Anchor 擴權記錄：授予 `/push-ci` 執行 `git push --force-with-lease`

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-20
> **Status**: In Progress
> **Note**: 本單是**補記錄**，不是新需求。這項擴權在 r1–r4 的實作過程中發生並已落地，但當時只存在於對話，repo 端沒有任何證據——round 13 的 Codex 審查正是以「查遍四張需求單都找不到 force-with-lease 的需求，`rules/discretion.md:41` 要求的人工核准無證據」為由標記為 blocking。它的判讀對 repo 而言完全正確，缺的就是這份記錄
> **Priority**: P1
> **Tech Spec**: 無獨立 spec

## Background

`rules/discretion.md` § Anchor Register #4 的例外清單**本身就是 anchor 的一部分**：

> **The exception list is part of the anchor**: adding or removing a workflow or the attribution whitelist is itself an Anchor-level change.

而 `discretion.md` § Proposal Channel 對此類變更的規定是：不得由模型自行判斷，必須走提案管道取得人工核准。HEAD 的授權表中，`/push-ci` 的 `git push --force-with-lease` 欄位原本是 **Forbidden**。

r1–r4 四張需求單**都沒有**要求這項能力。它是在實作 r3（授權契約條件化）期間，因為契約敘述必須說明「哪一種 push 由誰授權」而浮現的獨立問題。

## 核准事實（本單存在的理由）

| 項目 | 內容 |
| ---- | ---- |
| 提問方式 | AskUserQuestion，選項包含維持禁止與授予兩種 |
| 使用者回答 | **「B，允許執行」** —— 明示授予 |
| 授予範圍 | 僅 `git push --force-with-lease`，且僅在呼叫端**明示傳入該旗標**時 |
| 未授予 | 裸 `--force` 對所有 skill 維持禁止；`--force-with-lease` 推向 protected branch 由 Phase 0 硬中止、Phase 2 再確認 |
| 落地位置 | `rules/discretion.md` Register #4、`rules/git-workflow.md` § Exception、`skills/push-ci/SKILL.md` 授權表與 Phase 0/2 |

> ⚠️ **本表是對話內容的轉錄，本身不構成憑證（2026-08-21 doc review 指出，接受）**。倉庫中**沒有**這次
> 核准的持久工件：`git log --all -S'B，允許執行' -- docs rules skills` 為空，本檔亦為 untracked。後續審查者
> 能查核的只有「這張單**聲稱**核准發生過」，而非核准本身——一張單為自己記載的擴權背書，是循環的。
>
> 這是 Anchor Register #4 的**例外清單擴增**，依 `discretion.md` § Proposal Channel 屬不得由模型自行判斷者，
> 因此**持久人工背書尚欠**：合併這項擴權之前，需要一件由使用者產生、留在倉庫裡的工件（例如帶簽署的 commit
> 訊息，或使用者本人在本單上的確認）。在那之前本單的 AC 不勾選，且此擴權不得被當成已確立。

**這份記錄補的是轉錄，不是核准本身。** 核准早於實作發生；缺的是把它寫進 repo，讓後續審查者不必依賴對話就能查核。這正是 record 類文件的用途。

> **這個矛盾不由模型調和（2026-08-21 round 17 doc review 指出，接受）。** 審查者的觀察成立且刺人：
> `rules/discretion.md` § Anchor Register #4 與 `rules/git-workflow.md` § Exception 現在**已經**把
> `--force-with-lease` 寫成既定例外，而本單同時說它「不得被當成已確立」——單看規則檔的讀者看不到後者。
> 這不是兩處敘述打架待修，而是**一個尚未關閉的人為出口**：削弱規則檔的措辭等於代替使用者收回授權，
> 補一句「待背書」到 Anchor 條文裡則是模型自行改寫 Anchor 文字（且該段由 `test/rules/discretion-tiers.test.js`
> 逐位元釘住）。兩條路都不該由模型走。
>
> **關閉它的動作只有一個，且必須由使用者做**：把這批規則變更**提交**進倉庫——commit 本身就是留在
> repo 裡、由使用者產生、可被後續審查者查核的工件，正是 `discretion.md` § Proposal Channel 所要求的
> 那一件。在那之前，本單 AC 維持未勾，本擴權維持「已寫入工作樹、尚未確立」。

## 使用者裁示（2026-08-21）

上面兩段記的是**尚未關閉的人為出口**。2026-08-21 兩個出口都由使用者以 AskUserQuestion 裁示，**逐字轉錄如下**。
本節是追加註記，不改寫上文——上文記錄的是裁示之前的狀態，那是它作為 record 的價值。

### 裁示一：force 界線 → 「A：定義可佐證的非共用類別」

> **提問**：`rules/git-workflow.md:18` 無條件禁止 force push 到 shared branch，但規則從未定義 shared，
> 而 `/push-ci` 與 `/epic-merge` 都會對非 protected 的分支 lease-force。要怎麼收這條界線？
>
> **選項 A（使用者所選）**：定義可佐證的非共用類別——`/push-ci` 與 `/epic-merge` 在缺乏佐證時
> 拒絕 force-push。

**已落地，非僅記錄。** 佐證機制是 `scripts/pre-push-gate.sh` 新增的 `ALLOW_FORCE_UNSHARED` 關卡：
force 形式的 push 若目標含**非 protected** 分支，必須帶佐證才放行——`ALLOW_FORCE_UNSHARED=1`，
或操作者在 `/dev/tty` 提示（提示會把分支名唸回去）輸入 `yes`。機制與三項契約性質寫在
[`../4-implementation.md`](../4-implementation.md) § 3；規則面記於 `rules/git-workflow.md` § Push safety
（同一句由 `test/rules/discretion-tiers.test.js` 的 `CANONICAL_PUSH_SAFETY_LINE` 逐位元釘住）。

設計論證（為何是佐證而非推論、關卡的擺放位置、殘留風險）不寫在本單裡——那是
[`../4-implementation.md`](../4-implementation.md) § 3 的職責，本單只記裁示與其處置。
依 `skills/create-request/SKILL.md` § Write-Time Budget：單子是工作單位，不是技術規格。

### 裁示二：擴權處置 → 「核准，保留擴權」

> **提問**：`rules/discretion.md:36`（Anchor Register #4）已把 `/push-ci --force-with-lease` 寫成既定例外，
> 但 r5 需求單自己記著「此擴權不得被當成已確立」。要怎麼處置？
>
> **回答（使用者所選）**：**核准，保留擴權。**

因此上文「本擴權維持『已寫入工作樹、尚未確立』」自本日起**不再成立**：擴權已由使用者核准並保留，
規則檔的既定例外措辭是正確的、不需削弱。仍然成立的是另一半——AC 1 要求的是**倉庫內可查核**，
而本檔至今仍為 untracked。缺的**不再是核准**，只剩把它提交進 git 歷史；本單不自行提交
（Anchor Register #4：`/feature-dev` 不執行 commit）。

### 兩段判讀敘事已移出（2026-08-21 round 30）

本單原有 `### 界線的可判定範圍` 與 `### 一個被推翻的 Anchor 判讀` 兩節，共 44 行，**逐字移入** [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md)
§ r5：界線判讀與被推翻的 Anchor 讀法。移出理由是 `skills/create-request/SKILL.md` § Write-Time Budget：
單子是工作單位不是敘事，逐輪判讀史屬於 review log，而「A ticket already over it is trimmed at the
next substantive edit」——本次即為該次編輯。兩節記錄的都是**裁示之前**的判讀，未改寫；
裁示之後的機制與論證見 [`../4-implementation.md`](../4-implementation.md) § 3。

> **限定（2026-08-21 doc review round 41）**：上句「逐字移入」是絕對宣稱，而它是可證偽的，且已被證偽。
> 目的地的兩個標題並非原樣：`### 界線的可判定範圍` 與 `### 一個被推翻的 Anchor 判讀` 在
> `review-log-push-gate-optin.md` 中是 `#### 界線的可判定範圍（一併記錄，因為它是判斷不是推導）`
> 與 `#### 一個被推翻的 Anchor 判讀（記錄下來，因為錯的是判讀本身）`——層級由三降四，標題各加一段
> 括號副標。內文是否逐字則**無從查核**：兩檔當時皆為 untracked（`git cat-file -e HEAD:<兩者>` 皆
> 失敗），沒有可比對的工件。因此正確的讀法是「以保留原意為意圖搬移」，而非經查證的位元級轉錄；
> 「未改寫」同樣只適用於論證內容，不適用於標題。本註記不改上文一字——記錄該記錄當時所寫的。

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | 記錄本次 Anchor 擴權的範圍、界線與核准事實；確認實作與記錄一致 |
| Out | 擴大或縮小該授權**的範圍**——即改變 Register #4 所列的「哪些工作流可以推、可以用哪種 force 形式」（那會是另一次 Anchor 層級變更，需另一次核准） |

> **「範圍」與「安全旗標」的界線（2026-08-20 round 16 補記）**：本次實作在執行端加了 `--force-if-includes`，它**不**落在上列 Out 之內。Register #4 授權的單位是**操作形式**（`git push --force-with-lease`），`--force-if-includes` 不新增任何操作形式，只讓同一個 lease 在「本地未取得遠端新提交」時**多失敗一種情況**——是嚴格收緊執行條件，不是收窄授權範圍。判準：一個旗標若會讓原本被拒的推送變成可行，那是擴權，須另行核准；若只讓原本可行的推送在更多情況下被拒，則屬實作層的安全強化，本單範圍內。裸 `--force` 之所以是擴權而非強化，正是因為它落在前一類。

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `rules/discretion.md` | Verify | Register #4 的 `/push-ci` 例外含 `--force-with-lease`，且明列「never bare `--force`」 |
| `rules/git-workflow.md` | Verify | § Exception 同步，且要求核准必須**指名 force 形式** |
| `skills/push-ci/SKILL.md` | Verify | 授權表、Phase 0 硬中止、Phase 2 再確認三處一致 |
| `test/rules/discretion-tiers.test.js` | Verify | 擴權後的契約仍以斷言釘住，非放寬檢查 |

## Acceptance Criteria

- [ ] 核准事實與授權界線記錄在案，後續審查者可在 repo 內查核，不需依賴對話 —— **未達成（2026-08-21 更正，前一版誤勾）**：本檔目前為 **untracked／未提交**（`git status --porcelain <本檔>` 回 `??`），只存在於這個 checkout 的工作樹。「在 repo 內查核」的前提是它進入 git 歷史；在有 commit 之前，這條 AC 描述的能力並不存在。本單不自行提交（Anchor Register #4：`/feature-dev` 不執行 commit），故此格待實際 commit 後才可勾選

  > **更新（2026-08-21，doc review round 30）**：上段仍然為真，但**欠缺的東西已經換了一樣**。核准本身補齊了——§ 使用者裁示（2026-08-21）逐字轉錄兩則 AskUserQuestion 回答，裁示二為「核准，保留擴權」。所以本格待補的不再是「無核准工件」，而是「工件尚未進入 git 歷史」。上段未改寫：它記錄的是當時為真的判讀，而該判讀在當時完全正確
- [x] `rules/discretion.md` 與 `rules/git-workflow.md` 的例外清單一致，且兩者都載明裸 `--force` 仍為禁止（`discretion.md` 「never bare `--force`」；`git-workflow.md` 「Bare `--force` stays forbidden to every skill」）
- [x] `skills/push-ci/SKILL.md` 三處敘述與規則一致；核准選項文字**指名 force 形式**（「顯示普通 push 卻執行 lease-force」不構成核准）—— 授權表 `:26`、Phase 0 step 0 的硬中止（`rg -n 'hard-aborts here' skills/push-ci/SKILL.md` **現回報兩個命中：`:211` 的硬中止本身，以及 Examples 的引述**（該引述的行號於 round 33 又漂了一次，故此處不再寫定；第一個命中才是硬中止）；前一版寫 `:209`（更早寫 `:95`，那是 `### Phase 0: Preflight` 標題**之前**的空行，不是硬中止所在）。2026-08-21 round 32 更正：行號會漂移，命中數也會——這條裸 grep 已不再唯一指向硬中止，要定位它得看第一個命中或改用更窄的樣式）、Phase 2 再確認的 `case` 區塊
- [x] `test/rules/discretion-tiers.test.js` 以斷言釘住擴權後的契約，且既有的突變測試仍能翻紅（`CANONICAL_PUSH_SAFETY_LINE` 逐位元釘死 + 刪除宣告／同段前後插入 waiver／第二條宣告三組突變）

  > **本條原本寫錯自己的證據**（2026-08-20 Adequacy Gate 抓到）：前一版列的三組突變是「改字／**插空行**／複製標題」，但該測試的 `const free = {...}` 區塊恰恰把「在段落前插空行」列在**必須放行**的 Default-tier 自由編輯集裡（`an extra blank line above the push-safety paragraph`、`an extra blank line above the prohibition paragraph`）——段落 pin 比對的是內容不是空白行數，插空行翻紅才是缺陷。真正會翻紅的三組見上，位於同檔 `const widenings = {...}` 區塊，標籤為 `the push-safety credential paragraph deleted outright`、`a waiver prepended／appended in the same paragraph, canonical line retained`、`a second push-safety declaration beside the pinned one`。修正記於此，不回頭改寫測試以遷就原文
  >
  > **（2026-08-20 round 16 再更正）** 上一版用行號 `:786-790` 指那個自由編輯集，行號是錯的（該區塊當時亦不在該位置），且測試檔每次增修都會位移。**改以區塊常數名與突變標籤標定**——那兩者是測試自己的識別字，不隨行數變動；若要複核，`grep -n "const free\|const widenings" test/rules/discretion-tiers.test.js` 即可定位
- [ ] Pass `/codex-review-fast`（tier `thorough` — 屬 security 變更，Anchor Register #3）
- [ ] Pass `/precommit`
- [ ] Pass `/codex-review-doc`

---

> **2026-08-21 round 33 補記（記錄更正，非重寫）**
>
> 本單 § 「已落地，非僅記錄」段把 attestation 的適用範圍寫成無條件形式——「force 形式的 push 若
> 目標含**非 protected** 分支，必須帶佐證才放行」。撰寫當時那句成立，但 2026-08-21 稍晚的審查
> 指出它正是後來被認定為漏洞的那個讀法：**排除只在 protected 提示真的會問時才成立**。
> `scripts/pre-push-gate.sh` 的實際條件是
>
> ```bash
> if [ "${ALLOW_PUSH_PROTECTED:-}" != "1" ] && is_protected "$ref_name"; then
>   continue
> fi
> ```
>
> ——`ALLOW_PUSH_PROTECTED=1` 讓 protected 提示直接 `exit 0`，被排除的 ref 於是沒有第二道提示可以
> 落到，必須回到 attestation。無條件寫法下兩個變數組合起來，會讓 `main` 的 force push 靜默通過
> 兩道 gate。權威敘述見 `rules/git-workflow.md` § Push safety 與
> `../4-implementation.md` § 3。
>
> 原文保留不動：這是記錄，記錄裡的話過期本身就是記錄在運作。同批的 `2-tech-spec.md`、
> `review-log-push-gate-optin.md` 都以同樣的日期附記處理過同一件事，本單先前漏了。

> **2026-08-21 round 34 補記（授權契約擴張，非收斂）**
>
> Codex code gate 判定 `⛔ Blocked` / `gate_reason=IN_SCOPE_BLOCKING`，其中一筆直接打在本單建立的
> 那條 push 指令上：六個授權 push 站點清掉了 `BASH_ENV`／`ENV`／`GIT_EXEC_PATH`，卻整組放行
> `GIT_CONFIG_*`。本輪自行複現並擴充後，實測到三條各自獨立的繞過（皆 2026-08-21，真實 repo、gate
> 已 wired、`main` 為 protected）：
>
> | 通道 | 結果 |
> |------|------|
> | `GIT_CONFIG_COUNT=1` + `core.hooksPath=/dev/null` | `main` forced update，exit 0，**gate 完全沒跑** |
> | 同通道 + `url.<host>.insteadOf` | gate 照跑，但被核准的 refspec 送到另一台 server |
> | `GIT_GRAFT_FILE` | gate 照跑，其 `merge-base --is-ancestor` 回 0，rewrite 被判為 fast-forward，**不提問** |
>
> 第三條是 Codex 未點名、本輪自行找到的：它不移除 gate，而是毒化 gate 唯一問的那個問題。修法是把
> 這些名字加進同一個 `env -u` 前綴（六站點皆同），並在 `test/skills/push-ci.test.js`／
> `epic-merge.test.js` 以 **property** 而非只靠 byte pin 斷言——byte pin 正是維護者合法重簽時會
> 一併帶走的東西。
>
> **刻意不納入的邊界**：`GIT_SSH_COMMAND`、`GIT_ASKPASS` 等 transport 變數不清。它們說的是「怎麼
> 認證」而非「推什麼」，清掉會弄壞操作者自己的金鑰選擇，而那筆 push 本身完全符合已核准的內容。
> 這條邊界在 epic-merge 測試裡有自己的反向 fixture：把 transport 掃進來的變體必須紅。
>
> 另一筆同輪修正落在本單引用的那行提示上：gate 印的非互動回復形式原本只寫
> `ALLOW_FORCE_UNSHARED=1 …`，但這是兩道 gate 中的第二道——照抄到新指令列時，前一道
> non-fast-forward 檢查會先擋下。現在印出兩個變數，且測試改為**執行**印出的那行，而不是比對字串。
>
> 原文保留不動：這是記錄。

> **2026-08-21 追加（round 35 執行記錄）**
>
> 本輪四筆修正中有三筆落在**上一輪寫的修法本身**，記在這裡是因為它們改動的是本單授權的那六個
> push 站點與其 gate：
>
> | 修正 | 量測 |
> |------|------|
> | `env -u GIT_NO_REPLACE_OBJECTS` 語意反了——unset 等於恢復 git「尊重 `refs/replace/*`」的**預設**，等於前綴花了一輪在啟用它 | 誠實 ancestry 1；repo 內放一筆 `git replace --graft L R` 後 0（rewrite 被判 fast-forward，不提問，而 pack transfer 不理會 replacement，推出去的仍是真正無關的 L）；改為 `GIT_NO_REPLACE_OBJECTS=1` 後 1 |
> | gate 的特權 re-exec 判斷正確、卻透過 `exec` 動作，而 `exec` 是可被 shadow 的 builtin | 匯入 `BASH_FUNC_exec%%` 後 `type exec` 回報 function、執行後**繼續往下**：整段成為 no-op，baseline exit 1 → injected exit 0 |
> | 上一輪寫進 `.husky/pre-push` 的 stanza 以六個裸命令字（`git`／`cat`／`bash`／`mktemp`／`test`／`exec`）抵達 gate | 七個名字全部 shadow 後，gate 會擋的 protected push 以 **exit 0** 完成，回報 `* [new branch] main -> main`——不是繞過 gate，是根本沒叫到 gate |
>
> 三者共因相同：修法是針對「觸發它的那個失敗」寫的，卻沒有回頭檢查修法自己屬不屬於同一類。
> `skills/smart-commit/references/git-environment.md` 帶著同一個 `-u GIT_NO_REPLACE_OBJECTS` 而
> **刻意不動**——push 才有「gate 被問的問題，其答案傳輸並不採納」這個不對稱，smart-commit 應該對
> repo 現況作用。該理由已寫進兩個 push skill，以免日後有人去「修好」另一個檔。
>
> 細節與逐項量測：[`../4-implementation.md`](../4-implementation.md) §§ 4.3、4.5。原文保留不動：這是記錄。

> **2026-08-21 更正（記錄還原，round 36）**
>
> 頁首 `Tech Spec` 欄位曾被就地改寫成指向 `../2-tech-spec.md` 的連結並附一段說明。已還原為欄位形
> 狀。`Tech Spec` 不在 `skills/create-request/SKILL.md` § Phase 4.5 的四項可變欄位（Status／
> Progress 表／AC 勾選／Progress.Note）之內——這與本目錄 r1–r4 上一輪修的是**同一類錯誤，而我漏了
> 這一張**。
>
> **還原的證據強度要說清楚**：本檔為 untracked，`HEAD` 沒有改寫前的版本，逐位元原文**不可考**。上面
> 那行是依本檔自述（改寫時寫下的「先前此欄寫『無獨立 spec』」）還原其**記載的原意**，不是逐位元還原。
> 沒有工件可供第三方比對，這點本身就是為什麼記錄不該被就地改寫。
>
> 被移出的那段說明，其內容在此保留：本單的變更本身是 `@rules/discretion.md` § Anchor Register #4
> 與 `@rules/git-workflow.md` 的例外清單；spec 不重述那些規則（它們才是權威），而是把本擴權列為
> [`../2-tech-spec.md`](../2-tech-spec.md) § 3 的風險與 § 5 的未決問題：**尚無持久核准工件**。
> `@rules/docs-numbering.md` 把 Phase 2 列為 Required，沒有「規則變更免附 spec」這條例外——所以
> 「無獨立 spec」在撰寫當時是實況陳述，不是生命週期例外的主張。

> **2026-08-21 追加（round 46 執行記錄）**
>
> 本輪 Codex code gate 判定 `⛔ Blocked` / `gate_reason=IN_SCOPE_BLOCKING`，三筆 P1 + 一筆 P2，四筆
> 都落在本單授權的那條 push 路徑上。三筆 P1 共一個形狀：**檢查答對了，但答的不是這次要改的那個東西**。
>
> | 缺陷 | 量測 |
> |------|------|
> | gate 自己沒有正規化 commit graph | 真實 repo、gate 已 wired、`main` protected：`GIT_GRAFT_FILE` 把 remote tip 掛成一個無關 orphan commit 的 parent 後，誠實 ancestry exit 1、被毒化的 exit 0，`git push --force origin main` 以 **exit 0 完成且一句都沒問**，remote tip 由 `4fea809` 移到 `6792669`（兩者無共同歷史）。`git replace --graft` 走 repo 內的 `refs/replace/*` 達成同一結果 |
> | `/epic-merge` 兩處 probe 讀 fetch URL、push 走 push URL | 與上一輪 `/push-ci` 同因（`pushurl` 與 `pushInsteadOf` 兩種機制皆已量測）。上一輪只修了一半：姊妹 skill 仍是舊形狀 |
> | `/push-ci` Phase 2 重驗 branch 與 HEAD，唯獨沒重驗**目的地** | 核准與 push 之間改動 `remote.origin.pushurl`，其餘每一條斷言都仍為真，而已核准的 commit 被送去別的 repo |
>
> 第四筆 P2 打在測試上：Phase 0 那張六列判定表是該決策的**唯一**陳述，於是它所依賴的性質沒有任何
> 行為測試——`merge-base --is-ancestor` 有三種讀法（0 含、1 不含、**大於 1 是出錯而非回答**），而
> `if ! git merge-base …` 會把後兩者併成「沒有 rewrite」。classifier 已改為可執行 fence，產出 `ASK`
> 與 `ASK_REASON`；七種輸入逐一執行，兩個 mutant 皆先斷言**已套用**再判讀其效果。
>
> gate 側的修補在 `test/scripts/pre-push-gate.test.js` 有三向控制：兩種偽造、一個誠實 fast-forward
> 的正向控制，以及**負向控制**——把那兩行拿掉後同一筆 grafted rewrite 必須以 exit 0 通過，否則
> 「擋住了」可能只代表 harness 從未重現該繞過。
>
> 原文保留不動：這是記錄。


### 2026-08-21 更正（round 47）— 上面那筆 round-46 修補是錯的修補

以下三點更正**追加**於此，上面的原文一字未動：記錄寫的是當時的認知，把它改掉就沒有東西能證明
這一輪學到了什麼。

1. **`unset GIT_GRAFT_FILE` 不是「關掉」，是「換一條路開著」。** unset 之後 git 回退到它的
   *預設* graft 路徑 `$GIT_DIR/info/grafts`——那是 repo 裡的檔案，任何 `env -u` 都碰不到。
   2026-08-21 實測（hook 已接上、`main` 受保護）：誠實 ancestry exit 1；放進
   `.git/info/grafts`（remote tip 當作無血緣 orphan 的 parent）後 exit 0；**加上 round-46 的
   `unset GIT_GRAFT_FILE` 與 `GIT_NO_REPLACE_OBJECTS=1` 仍然 exit 0**。正確的關法是賦值：
   `export GIT_GRAFT_FILE=/dev/null`。同一個「unset 等於回到被污染的預設值」的形狀，這份記錄
   上面才剛為 `GIT_NO_REPLACE_OBJECTS` 記過一次，然後在隔壁的變數上重犯。

2. **原記錄的量測少寫了 `ALLOW_PUSH_PROTECTED=1`。** 上面寫的
   「`git push --force origin main` 以 exit 0 完成、完全沒有提示」不完整：protected-branch 提示
   是**另一個問題**，沒有那個變數會先被它擋下（已實測）。graft 打敗的只有 rewrite 這一問。
   重測後的完整事實：`ALLOW_PUSH_PROTECTED=1 git push --force origin main` 把 remote tip 從
   `2b0da2e` 移到 `e7049f5`（兩者無共同歷史），rewrite gate 全程沒問。

3. **「`if ! git merge-base …` 把後兩種讀法併成 no rewrite」的敘述方向寫反了。** 否定只是把所有
   非零狀態併進**同一個「要問」的分支**——錯誤因此被回報成*已量測*的 rewrite。`ASK` 這個 bit
   不會變，掉的是理由的忠實度，而理由正是操作者被要求回答的那句話。同一句錯誤敘述也出現在
   `skills/push-ci/SKILL.md` 的 Phase 0 註解與 `4-implementation.md` § 4.6，兩處已一併更正。


### 2026-08-21 追記（round 48）— 目的地遮蔽，以及那筆量測終於有了可重跑的工件

1. **目的地一旦成為 gate 比對的值，就必須先遮蔽再顯示。** `git remote get-url --push --all` 逐字
   回傳憑證；git 也在 push 未指名 remote 時把 URL 本身當 `$1` 交給 hook，因此 `pre-push-gate.sh`
   的 rewrite 與 protected 兩個 `/dev/tty` 提示同樣會印出來（2026-08-21 實測）。現在三個承載憑證的
   欄位一律遮蔽：userinfo（切**最後**一個 `@`——git 是這樣解析的，切第一個會留下密碼尾巴）、
   query、fragment。六個 `PUSH_URLS_SAFE` 位置逐位元組相同，hook 內複製同一套轉換。

2. **上面 round 47 那筆量測，現在有測試了。** 原記錄引用的是 ref 行協定層的測試，證明不了它自己
   寫的「remote tip 從 A 移到 B」。新增的端到端案例把 bare remote、真的 hook、`.git/info/grafts`
   與同一道 push 全部做完，兩種正規化各跑一次並各讀一次 remote tip——繞過重現、修補側被拒。原文的
   兩個 SHA 出自丟棄式 repo，已在 `4-implementation.md` § 4.3 改為指向測試名稱；此處記錄不動。

> **2026-08-22 收尾註記（round 81，使用者裁示停手）**
>
> 使用者在 round 80 之後裁示：對當時那棵樹再派一次 code + doc review，**不論回 Ready 或 Blocked
> 都停下來交接**，不再進入修復迴圈。round 81 兩個平面都回 blocked——code `⛔ Blocked`
> （`gate_reason=IN_SCOPE_BLOCKING`，3 筆：1×P1 + 2×P2）、doc `⛔ Needs revision`（4×P2）。
> 七筆**全部開著、未修**，逐筆內容記在
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § Round 81。
>
> 本單 Status 維持 `In Progress`，AC 維持 3/7——round 79–81 做的是內部強化（`readonly`
> 拒絕紀錄凍結、Husky 接線判定的三次收窄），沒有推進任何一條 AC。未勾選項全部是品質閘
> （`/codex-review-fast`、`/precommit`、`/codex-review-doc`）、需要 commit 才成立的
> 「同一批落地」條款，或先前已裁示刻意不勾的項目。
>
> 停手時的實測狀態：全測試套件 4097 tests / 4093 pass / 0 fail / 4 skipped；
> `node scripts/check-comment-blocks.js` exit 0（18 筆既有 WARN、0 BLOCK）。
> `/precommit`、Adequacy Gate、Doc Sync 這一輪都沒有抵達，依 `rules/auto-loop.md` 的終局完成
> 不變式，這批變更**尚未完成**，只是停在可交接的位置。
