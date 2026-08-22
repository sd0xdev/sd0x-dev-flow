# Ref-Name Hardening: Stop Modelling git's Ref Handling — Ask git

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-20
> **Status**: Pending
> **Note**: 由 `push-gate-optin` 任務**抽離**而來（2026-08-20，使用者選擇「抽離 smart-rebase」）。抽離後的 round 12 審查證明這個缺陷類別不只在 smart-rebase：epic-merge 與 push-ci 各自中招，故本單範圍由「smart-rebase 解析層」擴為**跨 skill 的 ref 名稱處理**。抽離原因不是降級，而是診斷為 `ARCHITECTURE`：修 A 破 B 已實測成立，繼續打補丁只會擴大問題
> **Priority**: P1
> **Tech Spec**: [`../2-tech-spec.md`](../2-tech-spec.md)（2026-08-21 建立）
> **生命週期文件的缺口已補（2026-08-21）**：本 feature 先前只有 `4-implementation.md`，缺
> `@rules/docs-numbering.md` 生命週期表列為 Required 的 `2-tech-spec.md`。判準是分類器而非自述：
> `node scripts/classify-docs-cli.js --feature ref-name-hardening` 現回報 `canonical_docs.tech_spec`
> 為 `2-tech-spec.md`（先前為 `null`），`4-implementation.md` 仍是 `Current authority`。
> **補上文件不等於本 feature 開工**：該 spec 寫的是已定的方向與已量測的限制，逐一呼叫點的設計仍列在
> 它的 § 7 Open Questions。**因此本 feature 仍不與 `push-gate-optin` 同批合併**：本單所有實作 AC 皆未
> 勾選，工作樹中屬於它的檔案是抽離時搬入的，不是完成品。

## Background

三支 skill 會把 ref 名稱放進指令：`/smart-rebase` 產生給開發者貼上執行的 `git rebase --onto`；`/epic-merge` 逐一 rebase 並 force-push PR head；`/push-ci` push 當前分支。**ref 名稱是可被影響的輸入**，而且不是「使用者手打」才危險——它從遠端來。

選項形狀的名稱（`--all`）由 `git switch -C` / `git branch` 拒絕建立，但含 shell metacharacter 的名稱
走的是最普通的建立途徑，git 照建不誤；`git symbolic-ref HEAD refs/heads/--all` 之後，
`git rev-parse --abbrev-ref HEAD` 就回傳 `--all`，那正是 `/push-ci` 取得 `$BRANCH` 的方式。
逐項實測表見 [`../2-tech-spec.md`](../2-tech-spec.md) § 1。

## Root Cause（本單真正要解決的）

**這些 skill 在多處「自己模擬 git 如何處理 ref 名稱」，而不是「直接問 git」。** 兩個獨立的讀者
（shell 與 git 的選項解析器）各需一個答案，而規則的例外太多，模擬必然漏。

> **2026-08-21 搬移**：本節原本承載「逐讀者的漏失對照表」「分隔子逐指令實測表（含 `git rev-parse`
> 兩行輸出的實證）」與「設計方向」三段，共約 50 行——那是 tech spec 的材料，不是工作單的
> （`skills/create-request/SKILL.md` § Write-Time Budget：單子超過約 150 行就是在做 tech spec 的事）。
> 整段移入本次新建的 [`../2-tech-spec.md`](../2-tech-spec.md)：漏失對照表在 § 2.1，分隔子實測在 § 2.2，
> 歧義為 warning 而非 error 的量測在 § 2.3，設計方向在 § 3。**意圖為只搬移；「未改寫」無工件可複核**——
> 本單與該 spec 皆為 untracked，`HEAD` 沒有搬移前的版本，與本單 AC「現行工作樹狀態」那條的證據限制同一類。
> 本單留此摘要與指標。

## Findings

本節分兩段，因為兩段的證據等級不同：下表為**已由本地實測確認**者；尚未複驗的 finding 3 另列於其後的
「待複驗」小節，不混入已實測表內。

### 已實測確認（非轉述）

| # | Sev | 位置 | 實測證據 |
| - | --- | ---- | -------- |
| 1 | P1 | `smart-rebase-analyze.sh` rebase operand | 分支 `refs/heads/tags/v0.0.1` 與 tag `v0.0.1` 併存時，git 印 `refname 'tags/v0.0.1' is ambiguous`，`rev-parse --verify` 直接報錯；`git rebase --onto main main -- 'tags/v0.0.1'` 退出 0 但**分支未被 rebase** |
| 2 | P1 | 短來源正規化（round-32 引入） | 設定 `+v0.0.1:refs/remotes/probe/stable` 與 `^refs/tags/v0.0.1`：git 本身**不抓取**（尊重 negative）；本腳本建構的 refspec 卻抓到 `[new tag] v0.0.1 -> probe/stable`，**繞過**設定的排除 |
| 4 | P2 | `SCRIPT_DIGEST` 可被更新 | digest pin 本質是 review reminder，任何 mutant 都能重算 pin。屬結構限制 |
| 5 | P2 | 文件掃描器負向控制 | separator 的 negative control 只斷言「字串被換掉」，未對 `reverted` 跑安全 predicate；`bareRefOptionOperands` 僅檢查 `--target`/`--base`，新增的無 slot 指令看不到。**2026-08-21 另量出同類的第三個盲點並已修**：`scanCommandSlots` 的啟用判準原本只認**以 `git `／`bash ` 開頭的行**，故 `n=$(git for-each-ref … "refs/heads/<quoted branch>"` 整段對所有 slot 守門隱形——一個巢狀引號缺陷因此出貨（該形式實測匹配 0 個 ref，會擋掉每一次正常 rebase）。判準已擴及賦值形式的命令替換，並補上會實跑該守門的行為測試。**本 finding 的其餘兩個盲點仍開著** |
| 6 | P2 | 測試檔未納入版控 | `test/skills/smart-rebase.test.js` 為 untracked，`git commit -a` 會只帶走程式碼而漏掉回歸測試 |
| 7 | P2 | `skills/epic-merge/SKILL.md` `git switch -C "$head" "origin/$head"` | 選項形狀的 head 由 git 直接拒絕（`fatal: '--all' is not a valid branch name`）。**是失敗，不是被處理**。**2026-08-20 round 16 更新**：偵測層已補上——Phase 0 validation gate 於任何寫入前中止以 `-` 開頭的 head（理由段在 § Names in commands 末段、規則本身在 § Phase 0: Analyze PR Chain 的 **Validation gate** 條列，工作樹，未提交至 `HEAD`），所以「沒有偵測也沒有訊息」**已不再成立**；但那只是把不透明的失敗提前，**ref 仍未經 git 中介處理**，本 finding 的重新設計層依然開著 |
| 8 | P2 | 同上，`git log "origin/$epic..$head"` 範圍運算式 | 該形式無適用分隔子；目前靠 `origin/` 前綴使字串不以 `-` 開頭而僥倖安全，非設計保證 |
| 9 | P1 | `smart-rebase-analyze.sh` Mode 1 `--base` 解析（**2026-08-21 新量測**） | finding 1 的同類第二例，位置不同：分支 `shared` 與 tag `shared` 併存時，`--base shared` 的解析把 stderr 丟棄，腳本**不報錯**而以其中一個為切點算出整份計畫（實測：修補前輸出 `"status": "ready"`，`keep_count` 依選中的 ref 而異）。與 finding 1 不同之處在於 `--base` 依 `../4-implementation.md` § 1.1 刻意豁免**名稱形狀**檢查，故不能用 `check-ref-format` 補；已改以**解析結果**判定（`show-ref --verify` 數 5 個 exact ref，≥2 即拒），使 `HEAD~1`／raw commit id 這類運算式永遠碰不到該拒絕。偵測層已修並雙向 pin 於 `test/skills/smart-rebase.test.js`；**本單的重新設計層仍開著**——這仍是逐點補丁，不是「改為向 git 詢問」 |


### 待複驗

本列 2026-08-21 由上表移出：它的兩半證據狀態不同，混在一張「皆由本地實測確認」的表裡會讓讀者以為
整列都已成立。對應的 AC 3 亦仍未勾選。

| # | Sev | 位置 | 已成立的一半 | 待複驗的一半 |
| - | --- | ---- | ------------ | ------------ |
| 3 | P2 | 單一 remote 寫到自身 namespace 之外 | **合法映射這一半已複驗（2026-08-21）**：`git fetch --dry-run . '+refs/heads/main:refs/remotes/up/main'` 回 `* [new branch] main -> up/main`，status 0——即使沒有名為 `up` 的 remote，git 仍接受該映射 | **腳本拒絕這一半尚未複驗**：需在**已設定 remote** 的情境下完整重現腳本的拒絕路徑，才能確認拒絕確實發生且原因為何 |

**已在 `push-gate-optin` round 12 改好、不屬本單的**（**改動僅存在於 2026-08-20 工作樹，尚未提交**——`HEAD` 仍是舊行為，故此處一律不寫「已修掉／已釋出」）：epic-merge 的兩道 `case` 守門（改為變數綁定，不再求值）、epic-merge 與 push-ci 全部 6 個 push 站點的 `--` 分隔子、epic-merge 兩處 `ALLOW_FORCE_WITH_LEASE=1`、`git rev-parse --end-of-options`、以及三支測試的守門（含能自證可偵測的注入 fixture）。這些不因本單重新設計而作廢。

> **更正（2026-08-21 doc review）**：上列的 `git rev-parse --end-of-options` **已被後續變更取代**，
> 現行工作樹沒有這個形式。`skills/epic-merge/SKILL.md` 該處現為
> `sha=$(git rev-parse --verify --quiet "refs/heads/${head}") || {`（全名 ref + `--verify --quiet`），
> 原因即上方 rev-parse 一列的更正：`--end-of-options` 會多印一行分隔子。清單其餘各項重新查核**皆仍
> 成立**：六個 push 站點都帶 `--`、epic-merge 兩處 `ALLOW_FORCE_WITH_LEASE=1`、三支 skill 測試仍為
> untracked。本段是記錄，故不刪除原文，以此註記記下該項的後續替換。

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `skills/smart-rebase/**`、`test/skills/smart-rebase.test.js`；`skills/epic-merge/SKILL.md` 的 findings 7–8；解析層改為向 git 求答案 |
| Out | `push-gate-optin` r1–r4 的授權契約本身（已於 round 12 收斂，兩者互不阻擋） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `skills/smart-rebase/scripts/smart-rebase-analyze.sh` | Modify | 解析層重新設計；findings 1–3 |
| `skills/smart-rebase/SKILL.md` | Modify | 隨解析層調整模板與 § Names in commands |
| `test/skills/smart-rebase.test.js` | New | findings 4–6；負向控制須實跑 predicate。**尚未納入版控**（`git status --short -- test/skills/smart-rebase.test.js` 回 `??`），故 Action 為 New 而非 Modify——對應 AC「測試檔納入版控」仍未勾選 |
| `skills/epic-merge/SKILL.md` | Modify（**偵測層已落地於工作樹**） | findings 7–8。Phase 0 validation gate 已加入「任一 PR head 以 `-` 開頭即中止」（`skills/epic-merge/SKILL.md` § Names in commands 末段給理由，§ Phase 0: Analyze PR Chain 的 **Validation gate** 條列是規則本身；一律以節名標定，該檔每輪 review 仍在增長，行號會漂移）——**這是緩解，不是重新設計**；§ Names in commands 的「尚未關閉」段落在 Git-mediated ref handling 重新設計落地前仍然成立 |
| `docs/features/push-gate-optin/4-implementation.md` | Moved（**工作樹已生效，未提交**） | § 1 全節屬本 feature，2026-08-20 移入本目錄。**兩檔皆為 untracked，`HEAD` 沒有搬移前的版本**，故「已完成」只能以工作樹現況查核，不能以 git 歷史查核（可查核的事實見下方 AC 的註記）。觸發原因是來源檔膨脹：搬移前 557 行，被搬走的 § 1 佔 459 行（82%），§ 1.4 佔 152 行——**皆為 2026-08-20 搬移當日的快照**。**行數不寫定現值**：本目錄的 `4-implementation.md` 每輪 doc review 都在追加更正，寫下的數字下一輪就過期。現值一律以 `wc -l docs/features/push-gate-optin/4-implementation.md docs/features/ref-name-hardening/4-implementation.md` 現場推導，size disposition 以該檔自身該段的重測記錄為準 |

## Acceptance Criteria

- [ ] 短來源的解析改為向 git 求答案，tag 與 branch 皆正確；finding 2 的設定下不再繞過 negative refspec
- [ ] rebase operand 具歧義時被偵測並拒絕，不再產生「退出 0 但分支沒動」的指令
- [ ] finding 3 複驗：合法且唯一的跨 namespace 映射不再被誤拒
- [x] findings 7–8 **偵測層**：選項形狀的 head 由 skill **偵測並給出訊息**，而非讓 git 拋出無上下文的錯誤
  —— 已落地於 2026-08-20 工作樹（`skills/epic-merge/SKILL.md` § Names in commands 末段；validation gate 於 § Phase 0: Analyze PR Chain），**未提交至 `HEAD`**
- [ ] findings 7–8 **重新設計層**：ref 一律經 git 中介處理（fully-qualify／escape），`epic-merge`
  § Names in commands 的「尚未關閉」段落屆時才同步移除。偵測層不取代這一條
- [ ] 文件掃描器的負向控制實際執行安全 predicate，而非僅斷言字串改變
- [ ] 測試檔納入版控
- [x] **`docs/features/ref-name-hardening/2-tech-spec.md` 產出**（`@rules/docs-numbering.md` 生命週期表列為 Required）——2026-08-21 建立。驗收指令：`node scripts/classify-docs-cli.js --feature ref-name-hardening` 的 `canonical_docs.tech_spec` 不再為 `null`（現回報 `2-tech-spec.md`）。**不是把 `4-implementation.md` § 1 複製一份**：該檔記的是已量測的 git 行為與現況缺陷，spec 寫的是取代它們的設計。
  > **這條勾選的是「文件存在且分類器認得」，不是「重新設計已完成」。** spec 的 § 1–§ 2 是本單 § Root Cause 整段移入的量測材料，§ 3 是已定的方向，§ 7 Open Questions 明列仍未決的三件事（解析層放哪、`git rebase` 的 `--end-of-options` 未量測、finding 3 的拒絕半邊未複驗）。其餘實作 AC 因此全數維持未勾。
- [x] **現行工作樹狀態**（本條刻意寫成可機械查核的較弱條件，不宣稱「整段搬移／逐位元保存」——見下方註記）：`ref-name-hardening/4-implementation.md` 含 § 1 與 § 1.1–§ 1.7 的 `/smart-rebase` 內容；`push-gate-optin/4-implementation.md` 已不含該內容、亦無任何 § 1.x 子節；兩檔的相對連結皆無死連結 —— 2026-08-20 由 push-gate doc review round 1 的 finding #8 觸發（**搬移前**該檔 557 行，§ 1 佔 82%，主題與檔名不符——此為當時快照，非現值；現值見 Related Files 該列）
  > **這一條勾選所依據的，是可機械查核的較弱事實，不是逐位元相同。** 來源與去向兩個 `4-implementation.md` **皆為 untracked**，`HEAD` 沒有搬移前的版本，也沒有可回收的 blob——「整段搬移、節號不變」是作者的**主張**，任何審閱者都無工件可複核。仍可查核的是這三件事，指令附後：
  >
  > | 可查核事實 | 推導指令 |
  > | ---------- | -------- |
  > | 去向檔含 § 1 與 § 1.1–§ 1.7 的 `/smart-rebase` 內容 | `grep -n '^## 1\.\|^### 1\.' docs/features/ref-name-hardening/4-implementation.md` |
  > | 來源檔已不含 `/smart-rebase` 那一節的**內容**（§ 1 這個**編號**仍在，主題已重編為 formatter），亦不含任何 § 1.x 子節 | `grep -n '^## 1\.\|^### 1\.' docs/features/push-gate-optin/4-implementation.md` |
  > | 兩檔的相對連結皆無死連結 | `@rules/docs-numbering.md` § Size Limit 的死連結掃描，對兩檔皆回報 0 |
  >
  > **搬移時重指的入向指標共 6 處，拼法兩種**（依各自來源檔的慣例，不是同一個字串）：
  >
  > | 來源 | 處數 | 拼法 |
  > | ---- | ---- | ---- |
  > | `skills/smart-rebase/SKILL.md` | 2（`:112`、`:226`） | repo 根相對：`docs/features/ref-name-hardening/4-implementation.md` |
  > | `skills/smart-rebase/scripts/smart-rebase-analyze.sh` | 2（`:218`、`:564`，皆為註解行，未新增任何 git 呼叫，`SCRIPT_DIGEST` 已重算） | 同上 |
  > | `push-gate-optin/requests/2026-08-15-push-gate-optin-r1.md` | 1（`:56`） | 檔案相對：`../../ref-name-hardening/4-implementation.md` |
  > | 同目錄 `-r2.md` | 1（`:82`，§ Progress 的 **Acceptance** 列） | 同上 |
  >
  > 節號不變，故只需改路徑不必改節號。推導：`grep -rn 'ref-name-hardening/4-implementation.md' skills/ scripts/ docs/ test/`。
  > **搬移之後另有新增的入向指標**，不屬上表：`create-pr-stacked/2-tech-spec/1-core-logic.md`（該 feature 自己的 doc review 加的）、以及來源檔 `push-gate-optin/4-implementation.md` 指向去向檔的那一處（搬移本身產生的新指標，非重指）。
  >
  > **不在此列的一處**：`test/skills/smart-rebase.test.js` 的指標指向 `push-gate-optin/4-implementation.md` § 2.1，**刻意未動**——它引用的是 efficacy pin 為何不能用黑名單寫，屬 push-gate 的內容，不隨 ref-name 段搬走。檔名相同不等於指向被搬走的東西。
  >
  > 來源檔同步把 § 2/§ 3 重編為 § 1/§ 2，指向 § 3.1 的兩處（r3.md）改指 § 2.1。
> **2026-08-22 補記（push-gate-optin round 75 的量測外溢）**：`/push-ci` 與 `/epic-merge` 本日
> 改用帶值 lease `--force-with-lease=<ref>:<這個 fence 量到的 tip>`，並移除 `--force-if-includes`
> ——實測（git 2.55.0）證明無值 lease 加該旗標，在「背景 fetch 更新 tracking ref ＋ 被覆蓋的
> commit 留在 reflog」的組合下會以 exit 0 覆蓋別人的提交，而帶值形式被拒為 `(stale info)`。
> `skills/smart-rebase/SKILL.md`（`:472`、§ Prohibited、§ Verification）**輸出**給開發者的仍是
> 無值的那一對。那份文件對這對旗標的宣稱本身沒有錯——它已寫明只關掉一個視窗、reflog 可達那條路
> 仍開著——所以這不是一筆錯誤陳述，而是**建議可以更強**：改建議帶值形式需要先量測遠端 tip，
> 那是這張單的 smart-rebase 重新設計範圍，記在這裡以免隨 round 75 收尾一起消失。
> 依據量測：`docs/features/push-gate-optin/4-implementation.md` § 4.64。

- [ ] `/codex-review-fast` 通過（`thorough` tier — 屬 security 變更，Anchor Register #3）
- [ ] `/precommit` 通過
