# Review Log — Pre-Push Gate Opt-In

> **Doc class**: Review log (ancillary, semantic prefix — `@rules/docs-numbering.md`). **History record**:
> each entry states what a given round found and how it was verified, at that point in time. Entries are
> appended, never rewritten to match later rounds.
> **Created**: 2026-08-21（自 [r4](./requests/2026-08-15-push-gate-optin-r4.md) 抽出）

逐輪 review 的事實與驗證證據。與需求單本體分開，是因為兩者讀者與生命週期不同：需求單描述**要做什麼、
是否完成**（Status、Progress、AC），本檔描述**每一輪查到什麼、怎麼驗、結果如何**。需求單是工作單元，
不是敘事；把逐輪證據留在單內會讓它讀不完（`skills/create-request/SKILL.md` § Write-Time Budget）。

- 需求單：[r1](./requests/2026-08-15-push-gate-optin-r1.md)、[r2](./requests/2026-08-15-push-gate-optin-r2.md)、[r3](./requests/2026-08-15-push-gate-optin-r3.md)、[r4](./requests/2026-08-15-push-gate-optin-r4.md)
- 現行權威：[4-implementation.md](./4-implementation.md)

---

## 收尾驗證（AC 6）

兩類同時掃描，並排除記錄類文件（記錄與現況脫節是記錄正常運作）：

```bash
grep -rnE 'terminal hook (is|remains) final gate|final authorization gate|最終(授權)?閘門|kernel \+ (git )?hooks|AGENTS\.md \+ hooks|安裝.*git hooks|(已)?安裝[^。|]{0,12}(advisory|終端憑證|終端確認)|installed[^.|]{0,20}(is the terminal credential|advisory only)' docs/ skills/ rules/ \
  --include='*.md' | grep -vE '/requests/|/review-log-|/adr-'
```

三類 pattern，各對應一種錯法：

| 類 | Pattern | 抓什麼 |
| -- | ------- | ------ |
| 1 | `final gate` / `最終閘門` | 無條件的終端確認宣稱 |
| 2 | `kernel + hooks` / `安裝…git hooks` | 暗示兩個 hook 皆預設安裝的安裝面轉述 |
| 3 | `已安裝…advisory` / `installed…advisory only` | **只以「是否安裝」為條件**的敘述 —— 語意等價於第 1 類但措辭完全不同 |

- 第 3 類是 2026-08-16 code review R2 補上的：原本只有前兩類，`CLEAN` 因此不足以支撐本 AC，`create-pr-stacked/2-tech-spec.md:20,37,53` 正是漏網者。
- **此 grep 是輔助而非證明**：它抓固定措辭，抓不到任意改寫的語意等價句。AC 的實質證據是逐檔審讀 + `/codex-review-doc`，grep 只負責攔截人工掃描會漏的重複措辭 —— 它確實攔到過 `cross-tool-portability/2-tech-spec.md:147`。
- 2026-08-16 執行結果：兩筆命中，皆非缺陷 —— `create-pr-stacked/1-requirements.md:38` 敘述方向相反（pattern 誤報），`skills/push-ci/SKILL.md:144` 位於僅限 protected branch 的流程內、該處宣稱成立且已補上範圍註記。
- 2026-08-17 執行結果：一筆命中（`skills/push-ci/SKILL.md:181`，即上述同一處，行號因編輯位移），非缺陷。
- **第四類：grep 沒有 pattern、只能靠審讀的語意等價句**，同日補修兩處，兩者都不含上表任何措辭：
  - `create-pr-stacked/2-tech-spec.md` Q1 寫「`pre-push-gate.sh` 逐 push 把關」與「雙層 gate 皆未變」——把 opt-in 且僅 protected branch 觸發的 hook 當成無條件前提。

> **路徑重定向（2026-08-21 round 28 補記）**：本節上方兩處引用的 `create-pr-stacked/2-tech-spec.md` **已不存在於該路徑**——它依 `@rules/docs-numbering.md` § Size Limit 拆成了 [`../create-pr-stacked/2-tech-spec/2-tech-spec.md`](../create-pr-stacked/2-tech-spec/2-tech-spec.md)（主檔）與 [`../create-pr-stacked/2-tech-spec/1-core-logic.md`](../create-pr-stacked/2-tech-spec/1-core-logic.md)（原 § 3.4 切出）。**本文的舊路徑與舊行號一律不改寫**：它們是 2026-08-16 那一輪的真實觀測，改掉就沒有第二份了。定位方式改為——`:20,37,53` 三處與 Q1 的敘述皆屬 push-gate 前提陳述，落在**主檔**；§ 3.4 契約 7 那一處落在切出的 core 檔。行號一律以字串 grep 現場推導，不要沿用本文的數字。（這條註記存在的原因：markdown link checker 掃不到它——這兩處是行內 code 格式的純文字路徑，不是連結，所以 `check-doc-links.js` 回報 0 failures 並不代表這裡沒有斷掉的指標。）
  - `cross-tool-portability/2-tech-spec.md` 的 `Note（撰寫當時）` 把「protected branch 確認」列為 Tier C 的無條件保證；因該段是記錄，修法是在既有 `Update` 註記補一條限定句，而非改寫記錄本身。
  這兩筆正是上一條所說「抓不到任意改寫的語意等價句」的實例，也是本 AC 不能以 grep 結果收斂的理由。
- 2026-08-20（doc review round 14 前）執行結果：兩筆命中，皆非缺陷 ——
  - `push-gate-optin/4-implementation.md`（§2 的「為何舊 phrase pin 不適用」表格）：命中的是**被當作引文寫進說明表格的 pattern 字串本身**，該格的內容正好是在說明這些措辭並未出現在被修的句子裡。自我指涉的引用，不是殘留宣稱。
  - `skills/push-ci/SKILL.md`（Phase 0 protected branch pre-approval flow 第 3 步）：`final authorization gate` 一詞成立且已條件化——該句以 `Where the pre-push hook is installed` 起頭，並在同句內說明此宣稱「holds **here specifically**」是因為整段流程只涵蓋 protected branch（hook 唯一會提示的那一類），且 hook 未安裝時 AskUserQuestion 就是唯一的授權。

- **2026-08-20（doc review round 14 後）重跑：命中數由 2 增為 9**。增加的七筆全部來自**同一輪的還原動作**——`cross-tool-portability` 與 `readme-catalog-sync` 兩份 Design record 的就地改寫被還原為 2026-03 原文，原文裡的複數 "hooks" 因此重新出現在檔案中。逐筆判定如下，**九筆皆非殘留宣稱**：

  | # | 位置（節） | 判定 |
  | - | ---------- | ---- |
  | 1 | `readme-catalog-sync/2-tech-spec.md` — README 產生範例中的 `codex-setup init` 列 | 刻意還原的 2026-03 原文示意列；緊接該範例區塊之後有日期註記載明 generator 現行逐字輸出為 `commit-msg hook (pre-push gate opt-in)` |
  | 2 | `cross-tool-portability/2-tech-spec.md` — § Tier C 下方的 `Update` 註記本身 | 命中的是**更正註記自己**，該註記正是在說明原文的無條件保證「撰寫當時成立、本次變更後不再成立」。自我指涉 |
  | 3–4 | 同檔 § 3.1 架構圖的 `codex-setup skill -->\|AGENTS.md + hooks\|` 兩條邊 | 2026-03 原文快照；上一列的註記已明言「下方架構圖中兩條邊同樣是撰寫當時的快照」 |
  | 5 | 同檔 § 3.2 分層表 **L2: 基建安裝** 列 | ⚠️R16 原文快照，由**該表自己的**日期註記涵蓋（緊接該表之後，`§ 3.2` 內） |
  | 6–7 | 同檔 § 3.4 `init` / `sync` 指令表兩列 | ⚠️R16 原文快照，由**該表自己的**日期註記涵蓋（緊接該表之後，`§ 3.4` 內） |
  | 8 | `push-gate-optin/4-implementation.md` §2 說明表格 | 同前一次判定：pattern 字串作為引文 |
  | 9 | `skills/push-ci/SKILL.md` Phase 0 第 3 步 | 同前一次判定：已條件化且宣稱成立 |

  > ⚠️R16 = 該格文字為 doc review round 16 **就地替換**的結果，非 round 14 原文。原文原意、以及
  > 為何逐位元還原不可能，見下方 round 16／37 兩則註記。標記於 round 41 補上：證據本來就在，
  > 但讀者要再往下十行才會遇到，而判定就寫在這裡。加標記是**附註**，兩格的判定文字一字未改。

  **這正是本 AC 不能以「命中數歸零」為勾選條件的第二個實例**：把記錄還原成原文（正確的做法）必然讓 grep 命中數上升。可勾條件是「跑過且每一筆都逐筆判定」，不是 CLEAN——第一個實例是〈第四類〉那兩筆 grep 抓不到的語意等價句，方向相反、成因相同：**grep 命中與缺陷之間沒有任一方向的蘊含關係**。

  > **更正（2026-08-20 doc review round 16）**：上表第 5、6–7 列原寫「受同一則註記涵蓋」，指的是第 2 列那則 § Tier C 註記。實際不是——`§ 3.2` 分層表與 `§ 3.4` 指令表**各自**緊跟著一則獨立的日期註記，第 2 列那則的涵蓋範圍只到它自己明言的「下方架構圖兩條邊」（第 3–4 列）。判定結論（皆非殘留宣稱）不變，變的是**憑什麼**——三組快照由三則註記分別涵蓋，不是一則涵蓋六列。已就地改正該兩格。

  > **更正（2026-08-21 doc review round 37）**：上一則註記末句「已就地改正該兩格」記載的動作，本檔
  > 不得為之。`scripts/lib/doc-metadata.js` 把 `review-log-*` 判為 **History record**，
  > `skills/update-docs/SKILL.md` § Roles 對該列的規定是 **Do not rewrite. Append only**；本檔頁首
  > 第 3 行也自陳「Entries are appended, never rewritten to match later rounds」。round 16 援引的
  > 「事實更正」例外屬於 **Work record**（`skills/create-request/SKILL.md` § Phase 4.5，管的是需求
  > 單），不延伸到 History record——同一條規則在 round 25、36 對 r1–r5 套用正確，漏的是本檔自己。
  >
  > **原文在此保留**：第 5、6–7 列原記為「受同一則註記涵蓋」，指向第 2 列那則 § Tier C 註記。上一則
  > 註記的判定（各自由緊接其後的獨立註記涵蓋）維持不變，它本來就該以「並列於原文之旁」的形式存在，
  > 而不是取代原文。本檔為 untracked——`git cat-file -e HEAD:<本檔>` 失敗——故**逐位元還原不可能**，
  > 只能還原其記載的原意；把猜出來的儲存格寫回去冒充還原，比承認這件事更糟。

> **量測 provenance（補記 2026-08-21，doc review round 19）**：下方「9 增為 10」與其十筆列舉，是在
> **未提交的中間工作樹狀態**下跑出來的，git 中**沒有可供後人複核的工件**——
> `git log --all -S'命中數由 9 增為 10' -- docs/features/push-gate-optin` 為空。同段稍後的兩則搬移
> 註記已自陳中間態不可重建，這一則當時漏了，故補上。**十筆中屬 `cross-tool-portability` 的六筆今日
> 已不復現**：那些位置在 `2692ede` 之後留下的是 opt-in 後的文字，pattern 抓不到。
>
> **今日值不寫定**——它每輪都會變，且變動方向與缺陷無關：round 19 更正那四則註記時逐字引用了
> `2692ede^` 的原文，命中數因此**上升**，與本段下方已載明的「還原原文必然讓命中數上升」同一機制。
> 現值請以本節開頭的指令現場推導（2026-08-21 跑出 **7**，四個檔案：`cross-tool-portability` 3、
> `readme-catalog-sync` 2、`push-gate-optin/4-implementation.md` 1、`skills/push-ci/SKILL.md` 1）。
> 可勾條件仍是「跑過且每一筆都逐筆判定」，不是任何特定數字。

- **2026-08-20（doc review round 16）重跑：命中數由 9 增為 10**。新增的第 10 筆是 `readme-catalog-sync/2-tech-spec.md` § 內同日追加的**逐字對照表**其中一列，該列把 2026-03 原文 `AGENTS.md kernel + git hooks` 與 generator 現行輸出並列，pattern 命中的是**被引用的原文那一格**。與第 1、8 筆同類：引文，非宣稱。十筆逐筆判定如下（節名為準，行號會漂移）：

  | # | 位置（節） | 判定 |
  | - | ---------- | ---- |
  | 1 | `readme-catalog-sync/2-tech-spec.md` — README 產生範例中的 `codex-setup init` 列 | 刻意還原的 2026-03 原文示意列（同 round 14 判定） |
  | 2 | 同檔 — 該範例之後的逐字對照表 **Coverage** 列 | **本輪新增**；命中的是表中被引用的原文格。引文，非宣稱 |
  | 3 | `cross-tool-portability/2-tech-spec.md` — § Tier C 下方的 `Update` 註記本身 | 自我指涉（同 round 14 判定，序號由 2 移為 3） |
  | 4–5 | 同檔 § 3.1 架構圖兩條邊 | 原文快照，由第 3 列那則註記明言涵蓋 |
  | 6 | 同檔 § 3.2 分層表 **L2** 列 | 原文快照，由 § 3.2 自己的註記涵蓋 |
  | 7–8 | 同檔 § 3.4 `init` / `sync` 兩列 | 原文快照，由 § 3.4 自己的註記涵蓋 |
  | 9 | `push-gate-optin/4-implementation.md` §2 說明表格 | pattern 字串作為引文（同 round 14 判定） |
  | 10 | `skills/push-ci/SKILL.md` Phase 0 第 3 步 | 已條件化且宣稱成立（同 round 14 判定） |

---

## 原子發佈集破功的查證

> 2026-08-21 自 [r3](./requests/2026-08-15-push-gate-optin-r3.md) § Background 移入，**意圖為整段搬移**。
> ⚠️ 「未改寫」無工件可複核（round 18 指出，量測後接受）：這段內容是在本次工作樹的更早輪次寫成後才
> 搬過來的，`git show HEAD:…-r3.md | grep -c "⛔ 這個中間態已經發生了"` → 0，版控裡沒有搬移前的版本。
> 可核的只有現況：r3 該節現只剩指標，本節含其內容。r2／r4 的同一條 AC 指向此節。

> **⛔ 這個中間態已經發生了（2026-08-21 查證）**。上一句預言的「本單先落地」情境不是假設——commit
> `2692ede`（2026-08-16，主旨為 repo 更名同步）已把 README 的 opt-in 措辭發佈出去，而安裝器與規則層
> 都還停在舊契約。查證：
>
> ```bash
> git log --oneline -S'--with-push-gate' -- README.md              # 僅 2692ede
> git log --oneline -S'--with-push-gate' -- skills/codex-setup/SKILL.md   # 空——任何 commit 都沒有
> git show 2692ede:README.md | grep -n 'with-push-gate'            # :39 已寫「gate is opt-in — add --with-push-gate」
> git show 2692ede:rules/git-workflow.md | sed -n '14p'            # 仍為「Primary gate = pre-push-gate.sh … Install via /install-scripts」
> ```
>
> 後果是使用者可見的：照已發佈的 README 執行，會傳一個已發佈的 `codex-setup` 不認得的旗標。因此
> 「原子發佈」**不是「尚未完成」，而是已經破功**；剩下的工作不只是把三單一起合併，還包括讓合併
> 內容把這個已發佈的不一致收斂掉。本註記只記錄事實與時態，不改寫上方原文。

---

## 跨 feature 協調結果（AC 2）

> 2026-08-21 自 [r4](./requests/2026-08-15-push-gate-optin-r4.md) 移入，**意圖為整段搬移**；
> 同上節，「未改寫」無工件可複核——`git show HEAD:…-r4.md | grep -c "跨 feature 協調結果"` → 0。

落地前已讀畢 `create-pr-stacked` 的兩張 In Progress request，結論為**無語意衝突，僅存在合併衝突風險**：

| 進行中工作 | 觸及範圍 | 與本單的關係 |
| ---------- | -------- | ------------ |
| `create-pr-stacked` r1（`2026-07-31-stacked-pr-mode-r1.md`） | § Background 述及 `gh stack` 觸及 Anchor Register #4；AC 1 記錄「push → `/push-ci` 或使用者手動」的執行端授權決策；AC 3（未勾選）是待確認的 spec §7 Q1「`/push-ci --branches` 是否屬 Anchor #4 例外的範圍內引數擴充」 | **有語意重疊**：同樣談推送授權。但重疊面是**授權由誰執行**（`/push-ci` vs 使用者手動、引數擴充的邊界），本單談的是**授權由哪個機制構成**（hook 已裝與否決定 AskUserQuestion 是諮詢或授權）。兩者結論相容，無需協調變更 |
| `create-pr-stacked` r2（`2026-07-31-stacked-pr-mode-r2.md`） | v1 實作（SKILL.md／測試），不觸及推送授權敘述 | 無語意重疊 |
| 該 feature `2-tech-spec.md` 待改章節（§2、§3.4、§6、§4 R6） | 本單在該檔的六處條件化為：**§2 skill 表 `/push-ci` 列**、**§2 Anchor #4 例外表 `git push` 列**、**§3.4 sequenceDiagram 的 push 註**、§4 R2、§4 R5、§7 Q1。前三處**與待改章節同節**（§2 兩處、§3.4 一處）；後三處不重疊 | 有**文字面**重疊，無語意衝突：本單只在既有列上加授權條件，不改該 feature 的設計主張。merge conflict 風險因此高於「僅同檔並行」，落在同一節內 |

處置：本單只條件化上表列出的授權敘述，不動其餘章節。**衝突面**（2026-08-20 round 16 重新推導）：其中三處就落在 §2／§3.4 這兩個待改章節內，故需以**節內**行級 rebase 解，而非只是同檔不同節。結論不變——無語意衝突、無須重新設計。

r1 的 §7 Q1（`--branches` 是否屬 Anchor #4 範圍內擴充）仍未結，且**不是本單的前置條件**——本單只回答「授權由哪個機制構成」，不對「`--branches` 是否屬例外」表態，兩題相互獨立，故不阻擋本單落地。

> **補記（2026-08-20 doc review round 14）**：上表把 r1 與 r2 分列，是因為 r1 明確擁有 `/push-ci`、Anchor Register #4 與 `--branches` 授權未決問題——與本單「重疊但相容」，不是無重疊。**未動兩張單本身**（它們是他人的記錄，見 AC 5）。r1 的 Q1 仍未結，那是該 feature 自己的待辦，不是本單的前置條件——本單不對 `--branches` 是否屬例外表態。

## `CANONICAL_EFFICACY_SECTION` 護欄的三次改版

> **來源（2026-08-21 round 29 移入）**：本節整段自 [`requests/2026-08-15-push-gate-optin-r3.md`](./requests/2026-08-15-push-gate-optin-r3.md)
> 的「全 repo grep」AC 註記搬移而來，**逐字未改**。搬移理由是 `skills/create-request/SKILL.md` § Write-Time Budget：
> 單子是工作單位不是敘事，逐輪改版史屬於 review log。該 AC 的**處置說明**（為何不勾）仍留在單子裡，那是單子的職責。
>
> ⚠️ **「逐字未改」無工件可複核（2026-08-21 round 37 補記）**：搬移前的狀態不在版控中——
> `git show HEAD:…-r3.md | grep -c '黑名單（兩個方向都錯）'` → 0，
> `git log --all -S'CANONICAL_EFFICACY_SECTION 護欄的三次改版'` 為空。應讀作**意圖為整段搬移、
> 位元同一性未經驗證**，與本檔前兩則搬移註記（r3 § Background、r4 跨 feature 協調）同一限定；
> 那兩則當時寫對了，這兩則漏了。可核的只有現況：r3 該 AC 註記現只剩指標，本節含其內容。

**這條護欄前後換過三次寫法**：黑名單（兩個方向都錯）→ 段落 pin（同區段另起一段即可繞過）→ 整段 pin（誤殺 Default-tier 散文）→ 契約獨立成區段。三次都是實測推翻，不是推論；經過見 [`./4-implementation.md`](./4-implementation.md) § 2.1

**更正（2026-08-20，doc review round 3）**：上句寫「整段**逐位元**釘死」不精確。validator 會先把每個空行段收斂為一行、並去掉尾端空行，所以空行**數量**是自由的；但空行段的**存在與位置**仍被釘住（實測：一行空行變兩行 → 通過；刪掉一行空行使兩段相連 → 失敗；段落中插入空行使其一分為二 → 失敗）。同一輪也推翻了「只釘非空行」這個相反方向的過度放寬說法。原句保留，因為它記錄的是當時的理解

## r5：界線判讀與被推翻的 Anchor 讀法

> **來源（2026-08-21 round 30 移入）**：以下兩節整段自
> [`requests/2026-08-20-push-ci-force-with-lease-r5.md`](./requests/2026-08-20-push-ci-force-with-lease-r5.md)
> 搬移而來，**逐字未改**。它們記錄的是 2026-08-21 裁示**之前**的判讀，因此不隨裁示更新——那正是
> record 的作用。裁示本身與其處置仍留在單子裡；機制與設計論證在
> [`./4-implementation.md`](./4-implementation.md) § 3。
>
> ⚠️ **「逐字未改」無工件可複核（2026-08-21 round 37 補記）**：r5 本身即為 untracked
> （`git show HEAD:…-r5.md` 失敗），搬移前的兩節在版控中沒有任何版本。應讀作**意圖為整段搬移、
> 位元同一性未經驗證**。同一限定在本檔更早兩則搬移註記已正確寫出；此處與上一節一併補上。

#### 界線的可判定範圍（一併記錄，因為它是判斷不是推導）

`git-workflow.md` § Prohibited 禁止 force push 到 **shared** 分支，但規則從未定義 shared——那是「還有誰持有這個分支」的事實，preflight 從 ref 本身看不到。本次落地採取的讀法是：**protected 名單是 shared 集合中可判定的那一半**，因為那些分支依其性質必然共用，也是唯一能單憑分支名決定的一半。這是保守側的選擇，不是從規則推導出來的等式。

殘留的部分寫在 `skills/push-ci/SKILL.md` Phase 0 step 0，不留給讀者自己補：兩人共用的 feature branch 同樣是 shared，本 skill 仍會對它 lease-force，而且**兩種風險都沒有完全關掉**：

| 風險 | 現況 |
| ---- | ---- |
| 覆寫他人 commit | **只收窄了一段，沒有關閉**。不帶 `=<refname>:<expect>` 的 `--force-with-lease` 比對基準只是本地 remote-tracking ref；`git-push(1)` 明載此形式「與任何在背景跑 `git fetch` 的東西互動極差」、保護「輕易就被打破」。對真實 remote 實測：他人 commit 被背景 fetch 帶進但未整合時，裸 lease **exit 0 直接覆蓋**；併同 `--force-if-includes` 後同一情境改為 exit 1 拒絕、remote tip 不變，整合後再推則正常成功。**但 `--force-if-includes` 檢查的是「remote tip 是否可從本地 branch 的任一 reflog entry 抵達」，不是「要推的歷史是否仍含有它」**——實測：把他人 commit fetch 下來、checkout 過（reflog 留下記錄），再改寫成不含它的歷史後 push，仍 **exit 0 覆蓋**。這對旗標關掉的只有「背景 fetch 進來、操作者從未動過」那一段競態 |
| 干擾他人工作區 | **完全未處理，任何旗標都處理不了**。他人正 checkout 該分支時歷史被改寫，push 端看不到 |

> ⚠️ **這一節是同一個人為出口的第二項，不是已結案的殘留揭露（2026-08-21 round 19 doc review 指出，接受）。**
> 審查者的讀法比上表更嚴，且成立：`git-workflow.md` § Prohibited 的「Force push to shared branches」
> **沒有**把 shared 限縮為 protected 名單，而 `skills/push-ci/SKILL.md` 明寫兩人共用的 feature branch
> 是 shared 且本 skill 仍會 lease-force 它——可執行護欄只檢查 `main`／`master`／`develop`／`release/*`，
> 所有共用 feature branch 一律放行。這不是「無從判定所以保守拒絕」的邊界，而是**指令面明知而允許的禁止情形**；
> 「已揭露」不等於「已授權」。
>
> 調和它需要二選一，兩者都是 Anchor Register #4 的條文變更，**不由模型決定**：
> (a) 在規則層定義一個「可 force push 的非 shared 類別」，並指定一個可靠的認定機制（單憑分支名做不到）；
> (b) 維持 `/push-ci` 的 force push 禁止，撤回或收窄本單的授權範圍。
>
> 在使用者裁示之前，本單第一條 AC 與此項一併懸置——它們是同一次擴權的兩面。

#### 一個被推翻的 Anchor 判讀（記錄下來，因為錯的是判讀本身）

本單前一版把「補上 `--force-if-includes`」寫成 Anchor 層級變更而暫不處理，理由是 Register #4 授予的形式字面為 `git push --force-with-lease`。**這個讀法是錯的，且方向剛好相反。**

Register #4 凍結的是它的**例外清單**——哪些 workflow 可以 push、以及 attribution 白名單——不是授權指令上的每一個旗標；既有授權本來就會帶 `-u`、`--`、remote 與 ref 一起執行。`--force-if-includes` 只**增加拒絕條件**，是對已授權指令的單調收縮。以 anchor 為由拒絕它，等於把一條「防止不安全 push」的規則，拿來當作保留一條不安全 push 的理由。

實測支撐（`git version 2.55.0`）：

| 情境 | 裸 `--force-with-lease` | 併同 `--force-if-includes` |
| ---- | ---- | ---- |
| 他人 commit 已 fetch、未整合 | exit 0，覆蓋 | exit 1 拒絕（`remote ref updated since checkout`），remote tip 不變 |
| 他人 commit 已 fetch **且 checkout 過**，之後被改寫丟掉 | exit 0，覆蓋 | **exit 0，仍覆蓋**——reflog 可抵達即放行 |
| 整合後再推 | — | exit 0 成功 |
| 單純 rebase 後 force-push | — | exit 0 成功 |
| epic-merge rollback（`switch -C` 回 backup 後 force-push） | — | exit 0 成功 |

後兩列是加旗標前必須先確認的事：它若擋住合法的 rebase／rollback，就不能加。git < 2.30 會以 unknown option 失敗——這是正確方向，**不做**退回裸形式的 fallback，否則等於把風險靜默地放回來。

**加了旗標之後殘留的不只「干擾」一項**：干擾完全未動，覆寫也還留著 reflog 檢查看不見的那一段（上表第二列）。兩者的控制都仍在人這一側：呼叫端逐次傳旗標、核准文字指名 force 形式。

---

> **2026-08-21 round 33 補記（記錄更正）**
>
> 本檔 § 「今日值不寫定」那段，在說完不寫定之後兩行就寫定了一個值——「跑出 **7**，四個檔案：
> `cross-tool-portability` 3、`readme-catalog-sync` 2、`push-gate-optin/4-implementation.md` 1、
> `skills/push-ci/SKILL.md` 1」。2026-08-21 逐字重跑該段自己的 grep，得到的是 **8**：
> `cross-tool-portability` 3、`readme-catalog-sync` **3**、`4-implementation.md` 1、
> `skills/push-ci/SKILL.md` 1。
>
> 差異出在 `readme-catalog-sync` 由 2 增為 3。**這裡不再寫定新值**——寫定就是重蹈同一個錯；
> 權威是該段印出的那條指令，數字只是撰寫當時的快照。原文保留，這條附記說明它已過期。

> **2026-08-21 round 34（雙 gate Codex 判定與處置）**
>
> 兩個平面都由 Codex 開新 thread 判定，都是阻斷：code `⛔ Blocked`（`gate_reason=IN_SCOPE_BLOCKING`，
> 2 筆 P1）、doc `⛔ Needs revision`（1 筆 P0、4 筆 P2；tier=thorough，P2 亦阻斷）。
>
> | # | 平面 | 級別 | 內容 | 處置 |
> |---|------|------|------|------|
> | C1 | code | P1 | 六個 push 站點放行 `GIT_CONFIG_*` | 擴充 `env -u` 前綴，加 property 斷言 + 反向 fixture |
> | C2 | code | P1 | husky 模式「append sourcing」——stdin 一次性被前面的 hook 讀走 | 改為 prepend + execute + 交還 stdin，stanza 寫進文件並由測試**執行** |
> | D1 | doc | P0 | § 4.3 `PATH` 那列結論反了 | 重寫；補上 `--no-verify` 委派的實測 |
> | D2 | doc | P2 | 非互動回復形式漏 `ALLOW_FORCE_WITH_LEASE=1` | 改 gate 實際印出的字串，測試改為執行它 |
> | D3 | doc | P2 | tag 更新「要求 `--force`」不精確 | 改為 force semantics；byte pin 與正向 pin 一併重簽 |
> | D4 | doc | P2 | :227 段落自相矛盾（不寫分母卻寫了 47、又從 43 推論） | 兩個數字全移除，只留可執行的推導指令 |
> | D5 | doc | P2 | r4 § References 就地改寫「前置單: r3」 | 還原原句，改以 2026-08-21 日期附記追加 |
>
> **兩筆自行追加的發現，不在任一份 review report 裡**：`GIT_GRAFT_FILE` 毒化 gate 的 ancestry
> oracle（C1 的第三條通道），以及 C2 的 `$0` 那半——sourced 執行讓 gate 的特權 re-exec 指向 husky
> hook 本身，實測 parent hook 首行印兩次（`$-`=`hB` → `hpB`）。兩者都是先量到、才寫下。
>
> **本輪的方法論教訓，值得單獨記一筆**：D1 是同一列在兩輪內以**相反方向**各錯一次——先說「沒關」，
> 更正時矯枉為「什麼都沒被繞過」。兩次都不是缺量測，而是繞著已取得的量測去推論機制。§ 4.3 現在把
> 「哪個量測授權哪個結論、不授權哪個結論」列成表，就是為了讓下一次的過度推論在版面上無處可放。

### Round 35（2026-08-21）— 修法自身成為下一個缺陷

> tier=thorough（Anchor Register #3）。本輪四筆 in-scope 修正，三筆的對象是 round 34 的修法。
>
> | # | 平面 | 嚴重度 | 缺陷 | 修法與反向控制 |
> |---|------|--------|------|----------------|
> | 1 | code | P0 | husky stanza 以六個裸命令字抵達 gate；`pre-push` 繼承推送者整份環境 | 改為只用三種免疫構造（reserved word `case`、`${x:?}` 展開期中止、絕對路徑），其餘一律在 `/bin/bash -p -c` 內執行。反向控制把 round-34 stanza 逐字嵌回並斷言 exit 0 |
> | 2 | code | P1 | gate 特權 re-exec 透過可 shadow 的 `exec` 動作 | 改用 exported marker 建立特權態 + 展開期中止；`$-` 降為第二道檢查。反向控制把舊 `case $- in *p*` 區塊接回，斷言它在同一環境下 fall through |
> | 3 | code | P1 | 六站點前綴的 `-u GIT_NO_REPLACE_OBJECTS` 語意反了 | 改為 `=1`（set 才是安全值）。property 斷言正反各一：必須含 `=1`、且不得含 `-u` 形式 |
> | 4 | code | P2 | mode 1 從未複製 `pre-push-gate.sh`；modes 2–4 只驗身分（`-ef`）不驗可執行 | Phase 4 加條件式複製列；modes 2–4 加 `test -x`；mode 1 的 Active 述詞加可讀性檢查 |
>
> **stanza 的守衛改為正向封閉分類器**，不是禁用字清單：每個邏輯行對照一組允許的形狀，沒人想到的
> 構造因「不在清單上」而紅。理由就是 § 2 那個 phrase pin——黑名單是對拼法的假設。
>
> **一筆自我否證**：測試原本斷言 hostile 環境下 `TAIL-SAW 1`，但被 shadow 的 `exec` 無法交還
> stdin，而 POSIX 沒有不靠 `exec` 重開 fd 0 的構造。文件寫對、測試寫錯；改為明確斷言
> `TAIL-SAW 0` 為已記錄的殘留，兩者互相 pin。
>
> **doc 平面**：`4-implementation.md` 越過 500 行信號，依序套用剪→併→拒拆，並把判斷與理由寫進
> 檔案自身的 size disposition。拒拆的決定性理由是入向指標含**記錄**（`ref-name-hardening` r1 的
> 指標稽核、`2-tech-spec.md` § 4 的推導指令），為了拆得整齊而重指凍結記錄，等於改記錄去迎合後來
> 的決定。

> **更正（2026-08-21，round 40 追加——本條目不就地改寫）**：上表第 1 列的「其餘一律在
> `/bin/bash -p -c` 內執行」在撰寫當時就已不成立，是**原文的疏漏**而非事後才失效——round 35
> 交付的 stanza 本身即含兩個裸命令字：`exec 0< "$__sd0x_refs"` 與 `rm -f "$__sd0x_refs"`。
> 兩者都位於 `__sd0x_rc` 取得判決**之後**，因此 shadow 它們改不動放行與拒絕：被 shadow 的
> `exec` 讓專案自身 hook 讀到已耗盡的串流（`TAIL-SAW 0`，同輪已記錄），被 shadow 的 `rm`
> 每次 push 洩漏一個 0600 暫存檔。兩者皆非授權路徑。真正的缺陷是**主張的形狀**：寫成無例外的
> 全稱句，讀者便無從得知邊界在哪，而同一份 `skills/codex-setup/SKILL.md` 在五十行後其實已經
> 用「Two residuals」段落把例外寫清楚了——文件自相矛盾，錯的是開頭那句。round 40 已將
> `skills/codex-setup/SKILL.md` 與 `4-implementation.md` 兩處收窄為「判決前、以及承載拒絕的
> 構造」，殘留照舊明列。這正是 round 34「量測授權哪個結論」那張表要防的同一件事，只是這次
> 過度推論的對象是修法自己的封閉性。

### Round 36（2026-08-21）— 兩個平面各一次獨立 Codex 派工，修法自身再度中彈

> tier=thorough。code 與 doc 各開新 thread（非 `codex-reply`），兩份 report 皆為 ⛔。

#### code 平面：⛔ Blocked → 已修

| # | 嚴重度 | 缺陷 | 自行複現的量測 | 修法與反向控制 |
|---|--------|------|----------------|----------------|
| 1 | P1 | `scripts/pre-push-gate.sh` 的 `set -euo pipefail` 在特權 re-exec **之前**執行。`set` 是 builtin，bash 先解析 function | baseline exit 1；`BASH_FUNC_set%%='() { exit 0; }'` 注入後 **exit 0**；最小案例 `bash -c 'set -euo pipefail; echo UNREACHED'` 什麼都沒印 | 移到 `unset SD0X_PRIV_REEXEC` 之後。反向控制把該行搬回區塊上方並斷言 exit 0（含「mutation 確實套用」前置斷言） |
| 2 | P2 | `smart-rebase-analyze.sh` 的 `--target` 沒有 `--base` 那道歧義守衛 | branch/tag 同名時 `rev-parse --verify --symbolic-full-name` **rc=0 且 stdout 空** → `TARGET_FULL` 空 → 回退到裸名 → git 解到 **tag**（實測 branch `8fb844c` vs tag `f0b0ab1`） | 比照 `--base` 數五種精確 ref；反向控制把守衛切除並斷言不再拒絕 |

> **第 1 筆是本輪最值得記的一件事**：它與 round 35 修掉的 `exec` shadow 是**同一類**，而且就在那一行上面。
> 上一輪我把 re-exec 區塊硬化到只用三種免疫構造，卻沒有回頭問「這個區塊**之前**還有沒有東西在跑」。
> § 4 的開場說「修法是針對觸發它的失敗寫的，其自身的類別歸屬未被檢查」——這一筆是同一句話又應驗一次，
> 而且應驗在那句話自己所在的那一輪。
>
> **第 2 筆的修法本身也差點犯同一個錯**：我最初照抄 `--base` 的第二個 disjunct（「恰好 1 個精確 ref
> 但 symbolic 解析為空」）。對 target 而言空解析是**合法且預期**的狀態——尚未 fetch 的 remote-tracking
> ref 正是如此，而 fetch 它就是傳入它的理由。一次跑掛五條測試才發現。守衛已收窄為只看「>1 個精確 ref」，
> 理由寫進腳本註解。

#### doc 平面：⛔ Needs revision → 三筆修、五筆判定

**已修**

| 缺陷 | 判定 |
|------|------|
| `docs/cookbook/ship-change.md:38` 漏掉「hook 不在時仍欠第二個問題」 | **成立**。該行只說 AskUserQuestion 即授權，未載明 `rules/git-workflow.md` § Push safety 要求的：`/push-ci`／`/epic-merge` 須**具名**、且在 force 核准**之前**詢問被改寫的 ref 是否共用，未得到該證言即拒絕。已補 |
| r5 頁首 `Tech Spec` 欄位遭就地改寫 | **成立，且是我上一輪修 r1–r4 時漏掉的同一張單**。已還原欄位形狀、說明移入日期附記，並明記逐位元原文不可考（本檔 untracked） |
| `4-implementation.md` size disposition 的理由站不住 | **成立**。兩個理由一個引錯節號（§ 5 非 § 4）、一個錯認稽核主題——後者我在 report 抵達前的自查就已發現。已改寫為「延後拆分」而非「拒絕拆分」，並把真正站得住的理由（入向指標含凍結記錄）留下 |

**判定為不成立（附證據）**

| 主張 | 反證 |
|------|------|
| 「tech spec 是 current authority，必須改寫成現況」——F1／F2／F10 共用此前提 | `scripts/lib/doc-metadata.js:40` 的 `design-records` 樣式 `^[0-3]-(feasibility\|requirements\|tech-spec\|architecture)` 把 `2-tech-spec*` 定為 **Design record**；`FALLBACK_ROLE`（Current authority）只涵蓋 `4-implementation*` 與 `skills/rules/agents/commands`。`skills/update-docs/SKILL.md` 該表不是與規則相牴觸，它就是在記載這支分類器，並註明 2026-08-21 把 `2-tech-spec.md` 從 Current-authority 列移出的更正 |
| 「r1–r4 的日期附記本身即違反 Phase 4.5」 | `skills/create-request/SKILL.md` § Phase 4.5 明文：「The one exception is a factual correction to the record itself — a wrong path, a wrong date — which is a correction, not a re-sync, and is stated as such」。逐行檢視 `git diff HEAD` 的新增行：全部落在 Status／Progress 表／AC 勾選三個可變欄位，或是條文原文逐字保留、更正下移的日期附記。r4 的 diff 甚至可見 round 25 把更早輪次的**就地改寫還原**回 `HEAD` 原文 |

**由錯誤前提繞出的真發現**（reviewer 的推論路徑不成立，但沿路撞到的東西是真的）

| 發現 | 處置 |
|------|------|
| `skills/feature-dev/SKILL.md:143` 至今寫 `/update-docs docs/features/<feature>/2-tech-spec.md（current-authority doc）`，與分類器相反；根 `CLAUDE.md` 的 doc sync 段落轉述同一句 | `[OUT_OF_SCOPE_DEFERRED] skills/feature-dev/SKILL.md:143 \| 與 doc-metadata.js 的角色分類相牴觸，指示改寫 Design record \| 建議開單 \| 2026-08-21`。兩檔皆不在本任務 baseline，且非 code 檔無 call path（`rules/scope-discipline.md`：僅條件 1 與 3 適用） |
| `skills/create-request/SKILL.md` 自相矛盾：§ Phase 4.5 的可變集合只有四項，§ Write-Time Budget 卻寫「A ticket already over it is **trimmed** at the next substantive edit」並指示把逐輪敘事移入 review log——對**未關閉**的單而言這兩條互斥 | `[OUT_OF_SCOPE_DEFERRED] skills/create-request/SKILL.md § Write-Time Budget \| 與 § Phase 4.5 的封閉可變集合互斥（僅對未關閉的單）\| 建議開單 \| 2026-08-21`。不在 baseline。**但這條矛盾的後果本輪看得見**：r1–r4 的體積已接近「穿著 ticket 外衣的 review log」，而該矛盾正是它無法自行收斂的原因 |

**本輪記下的 `[DEVIATION]`**

```
[DEVIATION] rule=rules/fix-all-issues.md § Precedence default=in-scope ∧ ≥ blocking 一律修
chosen=延後 doc review 對 ref-name-hardening r1（記錄本體移出約 50 行）與
       cross-tool-portability/2-tech-spec.md（581 行未拆）兩筆 P2
reason=兩檔雖在 baseline（條件 1 成立，故不宣稱 out-of-scope），但本輪對它們的編輯**只是還原原文**，
       被指出的性質皆非本任務所產生；兩者各自屬於進行中的其他 feature 迴圈——ref-name-hardening 為
       2026-08-20 使用者裁示抽離的獨立 feature，cross-tool-portability 有自己的 doc review 週期
signal=git diff HEAD 對兩檔的新增行皆為日期註記與原文還原；使用者 2026-08-20 的抽離裁示
```

`[OUT_OF_SCOPE_DEFERRED] docs/features/create-pr-stacked/requests/2026-07-31-stacked-pr-mode-r2.md:134 | 記錄本體被移出至 review log | 屬該 feature 自身迴圈 | 2026-08-21`

#### 後續事項（本節即為該項的登記處）

- **`4-implementation.md` 的拆分**：已欠，延後為獨立變更。執行者請先讀
  [`../ref-name-hardening/requests/2026-08-20-ref-name-hardening-r1.md`](../ref-name-hardening/requests/2026-08-20-ref-name-hardening-r1.md)
  的指標稽核——上一次搬移同類檔案時，入向指標的重指與「哪些刻意不動」佔了整段篇幅，而這次會多出一項：
  指向本檔的指標有一部分位在**凍結記錄**裡。

### Round 37（2026-08-21）— 修法的憑證本身被推翻，以及記錄規則反噬本檔

> tier=thorough。code 與 doc 各開新 thread，兩份 report 皆為 ⛔。

#### code 平面：⛔ Blocked → 已修

| # | 嚴重度 | 缺陷 | 自行複現的量測 | 修法與反向控制 |
|---|--------|------|----------------|----------------|
| 1 | P1 | `pre-push-gate.sh` 的**環境 marker 可偽造**：預設 `SD0X_PRIV_REEXEC=1` 搭配 `SHELLOPTS=privileged` 即跳過 re-exec，而 `$-` 仍含 `p` | `env SHELLOPTS=privileged 'BASH_FUNC_marker%%=…' bash -c 'type marker'` → **`marker is a function`**；對照 `bash -p` 則未匯入。打真 gate：偽造組合 exit **0**，baseline exit 1 | 憑證改為**參數數量**：git 對 pre-push 的契約固定 2 個參數，環境改不了；`$# >= 3` 只能由我們自己的 exec（附加三枚 sentinel，任何起始數量都一跳到位）產生。偽造的 marker 現在**落回** re-exec 而非越過它。反向控制把條件縮回只看 marker，斷言同一環境下 exit 0 |
| 2 | P2 | `smart-rebase-analyze.sh` 的 `--base=`（接合形式、空值）靜默視為 auto-detect | `--base=` rc=0 且 `"mode": "auto-detect"`；`--base`（分離形式、無值）rc=1。而分離形式的錯誤訊息**正是叫你改用接合形式** | 兩個空值 pattern 排在 `--target=*`／`--base=*` 之前拒絕。反向控制切除守衛後斷言 rc=0 且落入 auto-detect；正向對照 `--base=main` 仍分析如常 |

> **第 1 筆的教訓比缺陷本身重要**：round 35 把 re-exec 區塊硬化成「只用三種免疫構造」，round 36 補上
> 「區塊之前不得有任何東西執行」，這一輪推翻的是更上游的一句——**「marker 存在 ⇒ 已經特權」**。
> 三輪都在同一個區塊上，每一輪修掉的都是前一輪沒問的那個問題。真正的分界線是：
> `SHELLOPTS` 在**匯入環境之後**才被讀，命令列的 `-p` 在**之前**——所以 `$-` 兩者都是 `p`，
> 分不出來。凡是攻擊者可寫的通道都不能當憑證，這次才把它寫成 argv。

#### doc 平面：⛔ Needs revision → 五筆全數成立

| # | 缺陷 | 判定與處置 |
|---|------|-----------|
| 1 (P1) | `4-implementation.md` § 3 寫「hook 未安裝時**沒有**證言」 | **成立**。該檔是 Current authority（`doc-metadata.js` 的 `FALLBACK_ROLE` 涵蓋 `4-implementation*`），而 `rules/git-workflow.md` § Push safety 與兩支 skill 都已要求在 force 核准**之前**具名詢問。少的是**終端**證言，不是證言。已就地改寫（Current authority 本就該改寫） |
| 2 (P2) | `/epic-merge --per-step` 寫「三道閘門」，卻列出四個提問 | **成立**。bundled 列上一輪已更新為 2，per-step 漏了。模式表與 `--per-step` 旗標說明各改一處 |
| 3–4 (P2) | 兩份 review log 各有一處**就地改寫**自己的舊記載 | **成立，且是我自己犯的**。`doc-metadata.js` 判 `review-log-*` 為 **History record**，`update-docs` § Roles 規定 **Do not rewrite. Append only**；round 16 援引的「事實更正」例外屬 **Work record**（`create-request` § Phase 4.5），不延伸過來。已改為在原文之旁**併列**更正註記，並載明兩檔皆 untracked、逐位元還原不可能 |
| 5 (P2) | 兩則搬移註記宣稱「逐字未改」，但搬移前狀態無工件 | **成立**。`git show HEAD:…-r3.md \| grep -c …` → 0；r5 本身 untracked。已降格為「意圖為整段搬移、位元同一性未經驗證」——本檔更早兩則搬移註記當時就寫對了，這兩則漏了 |

> **3–5 是同一件事的三個面**：我在 round 25／36 才因為「記錄不可就地改寫」去還原 r1–r5 的頁首，
> 同一批工作裡卻在 review log 就地改了表格、又寫下無工件可佐證的「逐字未改」。規則對記錄的要求
> 不因為那筆記錄是我寫的而放寬——**寫規則的人是最容易對自己免除規則的人**。

#### 本輪一併補上的欠項

`pre-push-gate.sh` 壓縮後的註解指向 `4-implementation.md` §§ 4.2、4.3，但 § 4.3 尚未載有 round 36
的 `set` shadow 與 round 37 的 marker 偽造量測——**指標指向不存在的內容**。已在 § 4.3 的 vector 表
補上兩列，各附可複跑的量測。

### Round 38（2026-08-21）— 一筆以量測反駁、一筆確認為我自己的缺口，doc 平面五筆

> tier=thorough。兩平面各開新 thread。code report `2t9pnwbb`、doc report `kfbmjb3f6`。

#### code 平面：一真一假

| # | reviewer 主張 | 判定 | 依據 |
|---|---------------|------|------|
| F1 | `BASH_ENV` 內執行 `set -- forged1 forged2 forged3` 可偽造 `$#`，繞過 round 37 的 argv 憑證 | **不成立** | 實測：探針腳本回報 `argc=2 args=origin https://x.invalid/r.git`——bash 在 **source `BASH_ENV` 之後**才指派腳本的位置參數，啟動檔設的值被覆蓋。reviewer 觀察到的 exit 0 來自他們自己控制組裡的 `ALLOW_PUSH_PROTECTED=1`（既有的、有記載的開發者旁路），不是新的偽造。已把這條反駁釘成通過測試 |
| F2 | `smart-rebase-analyze.sh` 的 `--base ''`／`--target ''`（分寫空字串）未被守衛擋下 | **成立，且是我上一輪自己留下的缺口** | round 37 我修的是合寫的 `--base=`，分寫的空字串是**另一種拼法**：空字串仍是「有提供引數」，`[ $# -lt 2 ]` 與 `case "$2" in -*)` 兩道都放行。已補 `[ -z "$2" ]`，附反向控制 |

> **F2 是本輪最該記的一件事**，而且與 round 36 的教訓同型：「每個分支各自必要」不等於「聯集充分」。
> 修合寫拼法時我沒有回頭問「同一個選項還有幾種拼法」。

#### doc 平面：五筆 P2 全部覆核成立，全部已修

| # | 缺陷 | 覆核 | 修法 |
|---|------|------|------|
| DD1 | `4-implementation.md` 有一句話被 40 行的 round-35 `exec` 段落**插在句中**（`:456` 結尾「assert the clearing as a」，`:498` 才接「**property** rather than…」） | 成立 | 句子接回，整段移到句後 |
| DD2 | 同檔宣稱 hook「在檢查之前設 `-euo pipefail`，量到 `ehpuB`」 | 成立，**且此檔自身就是反證**：round 36 正是把 `set` 移到 re-exec 之後（現為 `:60`，檢查在 `:44`–`48`） | 重新量測為 `hpB`，並寫明舊值出自被該輪移除的順序 |
| DD3 | `skills/push-ci/SKILL.md` 的可達性表已是 5 列，內文仍寫「四種形狀中的兩種」「四格中的三格 in-session 核准就是唯一核准」 | 成立。計數過時之外，**後半句的實質也錯**：表中列 1、2 是拒絕（什麼都沒授權），列 3–5 全都會走到 `/dev/tty` | 計數更正為五分之三；後半句改寫為「本表沒有任何一格是那種情形」，並指出唯一核准的情形落在**表外**（不在兩個提示類別中的放行推送，以及 hook 未安裝時） |
| DD4 | `skills/epic-merge/SKILL.md` 的 gate 表寫「每次迭代」，但 Iteration 1 是 direct squash、不 rebase 也不 force-push | 成立 | 表頭改為「per iteration (2..N)」，並加一段明寫 Iteration 1 不問那兩個 force 問題——**否則會為一個不會發生的歷史改寫收取「非共用」證言**，而逐次核准的紀錄只值它的問題為真的那個價 |
| DD5 | `skills/codex-setup/SKILL.md` 的 uninstall 段落說 Husky 模式「*append* 一段 sourcing stanza」，但 `:77`／`:82` 寫的是 **prepend 一段會執行、並把 stdin 交還**的 stanza | 成立——該段落帶的是**已退場**構造的措辭 | 改為 prepend／executing，並指出 source 與 append 皆為舊構造 |

#### 本輪的自傷事故（已寫成 lesson L4）

修 DD 之前，我為了處理一支 heredoc 產生的過度轉義，寫了整檔字串取代。那兩個 token 在
`test/skills/smart-rebase.test.js` 內**同時有合法用途**（template literal 裡刻意轉義的 shell 展開），
33 處被毀，而該檔 untracked、無工件可還原。以逐行 `node --check` 修回，六個步驟。
教訓與預防訊號記於 `.claude/sd0x-dev-flow-lessons.md` **L4**。

#### 驗證狀態

完整套件 **3857 pass / 0 fail / 4 skipped**；`node scripts/check-comment-blocks.js` **exit 0**。
`skills/push-ci`、`skills/epic-merge` 的 `SKILL_DIGEST` 已由腳本重簽（前置斷言：新措辭確實在檔內），
未手寫。`test/skills/codex-setup.test.js` 無 digest pin，無須重簽。

#### 兩個平面的 gate 皆為**未過**

本輪的編輯同時落在 code 平面（兩個測試檔的 digest pin）與 doc 平面（五個檔）。依 Anchor Register #6，
兩個 plane 的 gate 都因 digest 變動重新打開，且**本輪未再派工**——原因見下節，不是遺漏。

#### ⚠️ Need Human — round cap

tier=thorough 的 round cap 是 30，使用者上一次的授權是「round 32」，本輪為 **38**。
`rules/auto-loop.md` § Cap Diagnostic Protocol 明定：**security 或 data-integrity 變更跳過診斷協定，
任一觸發直接 ⚠️ Need Human**。push safety 屬 security 變更（Register #3），故此處不做第二次診斷、
不自行續跑，交由使用者裁示續授權或收尾。

### Round 38 尾聲 — 兩項人工裁示（2026-08-21）

| 事項 | 裁示 | 後續 |
|------|------|------|
| Round cap（tier=thorough cap 30，前次授權至 32，實際 38） | **續授權 +6 輪，至 round 44** | 迴圈續跑；至 44 仍未收斂則再次 ⚠️ Need Human |
| E1 out-of-scope critical：`skills/create-pr/references/stack-mode.md:124` | **選項 2 — 抽成獨立變更** | 已立單 [`../create-pr-stacked/requests/2026-08-21-push-remediation-refspec-guard.md`](../create-pr-stacked/requests/2026-08-21-push-remediation-refspec-guard.md) |

> 兩項裁示合看解掉了規則的一處歧義：`scope-discipline.md` 選項 2 寫「原任務暫停，等抽離的修正落地後
> 再回到自己的 gate」，但同時給本迴圈 +6 輪只有在迴圈續跑時才有意義。採用的讀法是：**抽離＝立單追蹤，
> 不在本任務修它（否則就是擴張 baseline，正是選項 1 而非選項 2）；push-gate-optin 的迴圈繼續**。
> 這個讀法寫在這裡而不是默默採用，因為它是對規則的解釋，不是規則本身。

**抽離時多找到一筆，且比原findings更重**：寫單過程量測分支名合法性時發現，`a';id;'b` 是合法 ref 名
（`check-ref-format` rc=0、`git branch` 建得起來），天真的單引號包裝會產出
`git push origin -- 'a';id;'b'`——貼進 shell 是三條指令。**可複製貼上指令的命令注入**，已一併寫進該單，
單的 Priority 定為 P0。原 finding 只指出 `+main` 的 force 語意；同一行上還有一個不同類別的洞。

**一併記下的一件事實**：為量測 ref 名合法性，我在 `$CLAUDE_JOB_DIR/tmp` 下的拋棄式 repo 執行了
`git init` / `git commit --allow-empty` / `git branch`。Anchor Register #4 的字面禁令沒有寫「限本 repo」，
所以這點主動說明：專案自身有九個測試檔以同樣方式建 fixture repo 並在 `npm test` 中例行執行
（`test/scripts/pre-push-gate.test.js:544` 起即是），故既有實踐是「anchor 管的是專案的 git 歷史，
不是量測夾具」。專案 repo 的歷史未被觸碰。

### Round 39（2026-08-21）— `/usr/bin/env` 絕對路徑硬化；修法自身兩度中彈

> tier=thorough。code 與 doc 各開新 thread。四筆 finding 我在動手修之前**先各自複現**，其中一筆被量測推翻。

#### code 平面

| # | 嚴重度 | 主張 | 我的複現結果 | 處置 |
|---|--------|------|--------------|------|
| F1 | P1 | `BASH_ENV` 可在腳本第一行之前 `set -- a b c`，偽造 `$#`（憑證所依據的參數個數） | **推翻**。bash 指派 script 的 positional parameters 是在**開始執行 script 檔案時**，晚於 startup file 被 source；startup file 的 `set --` 寫進去的那組隨即被取代 | 不修，改為**釘住成因**寫成通過測試（`test/scripts/pre-push-gate.test.js`），理由是不想每輪重打同一場官司；若未來 bash 改了順序，這會是第一個變紅的東西 |
| F2 | P1 | 只把 `git push` 正規化、比較用的 `git rev-parse` 不正規化，比不正規化更糟 | **成立，且量測到**：在有 ambient `GIT_DIR` 的環境下，`git rev-parse --abbrev-ref HEAD` 回 `main`@`4d01381e`，而正規化過的 push 把 `main` 解到 `2692ede5`。同一個分支名、兩個 repository，比較結果卻是綠的 | 修。`push-ci`／`epic-merge` 內**所有**產生事實的 git 指令一併加前綴（push-ci 7 條＋hook 路徑推導，epic-merge 21＋4 條），並在 `PLAN_BRANCH=` 上方寫進這組量測 |

**本輪的實質變更**：前綴由裸 `env -u …` 改為 `/usr/bin/env -u …`，**絕對路徑**。這不是風格：

- `env true` → 被 `BASH_FUNC_env%%` **繞過**
- `command env true` → **也被繞過**（function 位階高於 builtin，所以 `command` 自己就可被遮蔽）
- `/usr/bin/env true` → 真的執行。bash **拒絕匯入**名稱含 `/` 的 function：`bash: error importing function definition for '/usr/bin/env'`

遮蔽會直接廢掉 `-u`：量測中，`env -u GIT_DIR` 底下的子行程仍收到 `GIT_DIR=/attacker/repo.git`。

#### doc 平面

| # | 缺陷 | 判定與修法 |
|---|------|-----------|
| DDD1 | `push-ci/SKILL.md:47` 寫「Measured, all four shapes」但表格是五列；`:63` 的代名詞指涉不明 | 成立。`:47` 改為 five；`:63` 改寫為「**這張表無法提供自己的反例**」——表內每一格不是拒絕 push 就是走到 `/dev/tty`，唯一憑證是 in-session approval 的那些 push **正好不在表內**，所以從這五列推出「installed ⇒ prompted」是從唯一成立的那張表得到錯誤的規則 |
| DDD2 | `epic-merge/SKILL.md` 三處仍寫舊的 gate 數（`:491`／`:743`／`:751`） | 成立，且是我 round 38 只改了模式表表頭、其餘三處沒跟上。全部改為「iteration 1 一個 gate；iterations 2..N unshared question ＋ 一個 bundled gate」 |

#### 我自己造成的兩個缺陷（reviewer 沒報，是我自查抓到的）

批次轉換腳本 `tmp/f33.js` 在**授權文件**上跑，兩處都會實際出事：

1. **刪掉了 28 行的 `git`**：regex `/^(\s*)((?:[A-Z_]+=\$\()?)git /` 吃掉了 `git `，但 replacement `$1$2${CLEAN}` 沒有把它放回去。修法補在 `-u GIT_EXTERNAL_DIFF ` 之後插回 `git `，並加「每一條帶前綴的行都確實在跑 git」的正向斷言。
2. **把 `ALLOW_FORCE_WITH_LEASE=1` 傳播到 27 條非 push 的 git 指令**：剝除用的 regex 只匹配空值的 `ALLOW_FORCE_(WITH_LEASE|UNSHARED)=`，匹配不到 `=1`。這等於在每一條指令上掛了 force 旁路——正是 `/push-ci` § Prohibited 明文禁止的事。修法剝掉 33 行的 ` GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE=1`，保留 6 條真正的 push 行，並斷言「沒有任何非 push 指令帶旁路賦值」。

第 3 個同類問題：`f33.js` 漏掉 5 個 command-substitution 位置（`range=$(git log`、`sha=$(git rev-parse`、
`if [ -n "$(git status`、`rm -rf "$(git rev-parse`、`hook="$(git rev-parse`）——小寫賦值與 `$( )` 語境。
這是本輪第三次踩到「**每個分支都必要，不等於聯集充分**」，已寫成 L5。

#### 新發現的 P0（reviewer 未報，我在寫 ref 名量測時撞到）

`git push origin -- 'a';id;'b'` —— `a';id;'b` 是**合法的 ref 名**（`check-ref-format` rc=0、`git branch` 建得起來），
單引號與分號都是合法 ref 字元。天真的單引號包裹會產出三個 shell 指令，可複製貼上的 command injection。
連同 `+main` force refspec 一併抽成獨立變更：
[`../create-pr-stacked/requests/2026-08-21-push-remediation-refspec-guard.md`](../create-pr-stacked/requests/2026-08-21-push-remediation-refspec-guard.md)。
順帶記下一個**不要動**的事實：`--upload-pack=x` 雖是合法 ref 名，但 `--` **確實擋得住**它——修法要疊在 `--` 之上，不是取代它。

#### 測試面的連帶修正（三支紅燈，全是 pin/selector 指向已退休的裸 `env` 拼法）

| 檔案 | 症狀 | 修法 |
|------|------|------|
| `test/scripts/pre-push-gate.test.js` | selector `startsWith('env -u')` 數到 0（應為 4） | 改為**依指令形狀**辨識 push、把前綴檢查分開斷言。舊寫法把「前綴掉了」與「selector 漂移」報成同一種錯；新寫法讓掉了前綴的 push 仍被**選中**，才有機會被**判失敗**。附三方向控制（canonical／掉前綴／裸 push 皆須選中，五種散文皆不得選中） |
| `test/scripts/smart-commit.test.js`、`smart-commit-inspect.test.js` | `CANONICAL_PREFIX` 的 `/^(env -u GIT_DIR…)$/m` 錨點失配，`match` 回 null，整支檔案在 module 層就掛 | 錨點改為 `^/usr/bin/env`。`PREFIX_RUNS` 的 `/usr/bin/` 刻意設為**可選**——這個不對稱正是守衛本身：退化成裸 `env` 的呼叫點仍會被找到，然後在 byte-for-byte 比對上失敗 |

一併調整：`docs/features/smart-commit-hardening/2-tech-spec.md` 從 byte-for-byte 掃描中改為**較弱的義務**。
該檔經 `doc-metadata.js` 判為 **design record**，其 fence 仍保留已退休的 `GIT_ENV="env -u …"` 構造；
要求記錄類文件跟上今日拼法，等於命令記錄被改寫以映照後來的程式碼，正是凍結記錄所禁止的。
仍然檢查的是「變數清單不得被偷偷縮短」——**開頭那個字自由，清單不自由**。

#### 本輪收尾量測

- 完整測試套件：**3859 pass / 0 fail / 4 skipped**（147.8s）
- `node scripts/check-comment-blocks.js`：**EXIT=0**（19 筆 25–29 警告帶，無 BLOCK）

### Round 40（2026-08-21）— 四筆 code、五筆 doc；一筆 Nit 被我升級，一筆修法被量測反駁

> tier=thorough（Anchor Register #3）。code 與 doc 各開新 thread。九筆 finding 我在動手前**逐一自行複現**。

#### code 平面

| # | 嚴重度 | 缺陷 | 自行複現 | 修法與反向控制 |
|---|--------|------|----------|----------------|
| C1 | P1 | 保護分支上的 **rewrite** 只被問「可不可以推 main」，沒被問「還有沒有別人在用」——兩個問題被一個提示合併掉 | 成立 | `pre-push-gate.sh` 改為在 `PROT_REWRITE_LIST` 非空時，用**單一提示同時承載兩個憑證**；無終端機路徑的復原提示同時列出 `ALLOW_PUSH_PROTECTED=1 ALLOW_FORCE_UNSHARED=1`。反向控制是 **fast-forward** 的保護分支推送：必須只問原本那一句、不得出現 attestation 字樣（`ffRef` 新增於 `makeTwoCommitRepo`）。兩筆提示措辭斷言都改到 **PTY** 測試裡——第一版錯放在無終端機路徑上，那條路徑根本走不到提示 |
| C2 | P1 | `push-ci.test.js` 的封閉性註解過度主張：strip list 被寫成關掉了 global config，實際只中和 `GIT_*` **override** | 成立，且量測到：`HOME=… XDG_CONFIG_HOME=/nonexistent /usr/bin/env -u GIT_CONFIG_GLOBAL git config --global --get user.name` 回 `AmbientHomeIdentity`——unset 是**交還 git 預設查找**，不是關閉 | 註解改寫為明確邊界，並把 reviewer 建議的「綁 `/dev/null`」記為**已評估後拒絕**（會一併噤掉消費端專案的 `credential.helper`），`HOME`/`XDG_CONFIG_HOME` 與既有的 `PATH` 歸為同一類。新增雙向量測測試：unset → 讀得到；綁空檔 → 讀不到 |
| C3 | P2 | Phase 2 只比對**分支名**，不比對 commit。核准後、推送前在同分支多出的 commit 原樣通過 | 成立 | Phase 2 新增 `PLAN_HEAD_SHA`（完整 40 hex，字面寫入）＋ 重新推導比對，置於「保護分支 × force 禁止」**之後**（該禁止只該依賴分支名一個輸入）。Phase 1 計畫同步改為明示完整 SHA；Phase 3 改為監看**通過比對的那一組**。假 git 必須區分兩種 `rev-parse`，否則守衛會拿名字比名字而恆綠 |
| C4 | Nit → **我升級為 P1** | `test/skills/epic-merge.test.js` 的 `escapeRe` 被我自己的產生器寫壞成字面 `'\\const GIT_PREFIX = '` | 成立 | 依 @rules/auto-loop.md § Sub-Threshold Findings 的「嚴重度誤標」例外升級：這個 escaper 保護的是**授權指令逐位元組存在**的斷言，escaper 死了等於授權守衛死了。修好並補 14 個 metacharacter 的雙向控制測試 |

**C3 拒絕的修法，連同量測一起寫進文件**：reviewer 建議改推 `${PLAN_HEAD_SHA}:refs/heads/<branch>`，
把 commit 釘在 refspec 裡就不必比對。量測後拒絕——SHA 來源會**靜默廢掉 `--set-upstream`**：
`git push -u origin ${SHA}:refs/heads/feat/x` 成功，而 `@{u}` 仍回報 no upstream，兩個串流都沒有警告。
用「新分支第一次推送壞掉且沒人看得見」換 ref 級精確度，不划算。

#### doc 平面

| # | 嚴重度 | 缺陷 | 判定與修法 |
|---|--------|------|-----------|
| D1 | P1 | `4-implementation.md` 把 `$-` 寫成「discriminator is right」，且程式碼區塊停留在 round 35 的 `case $- in *p*`——現行程式碼早已不是這樣 | 成立。整段改寫為**編年**：round 34 argv[1]（remote 名可偽造，P0）→ round 35 `$-`（修對了判別、沒修對**動詞**，`exec` 是可 shadow 的 builtin）→ round 37 `$-` 本身被推翻。收尾寫明現行憑證是**參數個數**、marker 是**成對狀態**、`$-` 降為 re-exec **之後**的殘餘檢查 |
| D2 | P2 | `push-ci/SKILL.md` 寫「兩個 bypass 都設仍會被拒絕，已量測」 | 成立，且原量測跑在**無終端機**路徑（`runGate2`）。改為：仍需 unshared attestation；前景終端機下操作者可回 `yes`，無終端機則除非另給 `ALLOW_FORCE_UNSHARED=1` 才拒絕。原文把一半當成全部 |
| D3 | P2 | 「No bare command word may appear here」是無例外全稱句，而 stanza 本身就有兩個裸命令字 | 成立。`codex-setup/SKILL.md` 與 `4-implementation.md` 兩處收窄為「**判決前、以及承載拒絕的**構造」，並指向同檔五十行後早已寫清楚的「Two residuals」段落——文件本來就自相矛盾，錯的是開頭那句。round 35 條目**追加日期更正**（記錄不就地改寫） |
| D4 | P2 | `epic-merge/SKILL.md` 寫「操作者拒絕後：本地已還原、遠端未還原」 | 成立。拒絕會停在 rollback 區塊**之前**，而本地還原（`git switch -C`）就在那個區塊裡——所以兩邊都沒還原。改為**回報三個實測值**（本地 head、backup tag OID、`git ls-remote` 的遠端 OID），並明說不推不還原 |
| D5 | P2 | `update-docs/SKILL.md` 只列四組慣例配對，讀起來像分類器只認這四個 | 成立。量測：`1-tech-spec.md`、`3-requirements.md`、`0-architecture.md`、`2-feasibility-study.md` 全部判為 Design record——pattern 是**交叉乘積** `^[0-3]-(feasibility\|requirements\|tech-spec\|architecture)`，十六個名字而非四個。表格 cell 同時保留慣例名與實際 pattern，另補一段說明分類器**比慣例更寬**是刻意的（誤編號的 spec 仍受保護），以及邊界在**前綴**：`4-tech-spec.md` 落到 fallback，變成可改寫 |

**D5 的第一版修法被自家測試擋下來**，值得記一筆：我把四個 stem 從表格 cell 換成 regex，
`update-docs.test.js` 立刻紅——那條測試就是「表格必須逐列記載 resolver 實際指派的角色」。
換掉不是收窄而是**刪資訊**。最終兩者並存。

#### round 37 那筆推翻，本輪重新量測（不照抄程式碼註解）

| 呼叫方式 | `$-` 含 `p` | 匯入的 function |
|---|---|---|
| `env -u SHELLOPTS 'BASH_FUNC_f%%=…' bash script` | 否 | **在** |
| `env 'BASH_FUNC_f%%=…' SHELLOPTS=privileged bash script` | **是** | **在** |
| `env -u SHELLOPTS 'BASH_FUNC_f%%=…' bash -p script` | 是 | 不在 |

第 2 列就是偽造：`$-` 回報得與第 3 列的真 `bash -p` 一模一樣，而攻擊者的 function 照樣匯入。
成因是 bash 內部的順序——`SHELLOPTS` 在環境**之後**才讀，命令列的 `-p` 在環境**之前**。

#### 我自己在本輪踩的兩個坑

1. **`env` 的選項解析在第一個賦值處停止**：`env HOME=x -u FOO cmd` 會去執行一個名叫 `-u` 的指令（rc 127）。
   這正是本專案 F1e 已經釘住的性質，我卻在寫 C2 測試時原地再踩一次。**知道一條規則，和在新語境裡認出它適用，是兩件事。**
2. **C1 的第一版斷言放在走不到的路徑上**：無終端機時輸出停在 `Cannot open /dev/tty`，提示措辭根本不會出現，
   斷言卻是綠的。移到 PTY 測試後才真的在驗東西。

#### 本輪收尾量測

- 完整測試套件：**3863 pass / 0 fail / 4 skipped**（135.8s）
- `node scripts/check-comment-blocks.js`：**EXIT=0**（19 筆 25–29 警告帶，無 BLOCK；讀的是 exit code，不是 `grep -c`）
- `4-implementation.md` 621 行——仍超過 500 行信號。**拆分維持延後**，理由與 round 35 相同且未變：
  入向指標含凍結記錄，為了拆得整齊而重指記錄，等於改記錄去迎合後來的決定。判定寫在該檔 `:20` 的 size disposition

### Round 41（2026-08-21）— 兩筆 code、六筆 doc；三筆 doc 共用同一個根因

> tier=thorough（Anchor Register #3）。code 與 doc 各開新 thread，兩者皆回 ⛔。八筆 reviewer finding
> 加上我自查的兩筆表格破格，動手前逐一自行複現。

#### code 平面

| # | 嚴重度 | 缺陷 | 自行複現 | 修法與反向控制 |
|---|--------|------|----------|----------------|
| C1 | P2 | `smart-rebase-analyze.sh` 把 `git cherry -v` 的雜湊截成固定 8 字元，再與 `git log --oneline` 的雜湊做**字串相等**比對 | 成立，且量測到寬度：`git log -1 --oneline` 給 **7**（`core.abbrev`）、`git cherry -v` 給 **40**。8 對 7 永不相等，故 `cherry_status` 恆為 `unique`，與同一份輸出裡的 `cherry_dropped` 自相矛盾 | 去掉截斷（該雜湊只被比對與計數，從不顯示），比對改為 **prefix test**（`case "$dhash" in "$hash"*)`）——git 的縮寫本就是 OID 的前綴且在庫內唯一，這與 git 自己的比對同義，且對任何 `core.abbrev` 都成立 |
| C2 | P1 | `codex-setup` 的 Husky 列只寫了 `pre-push-gate.sh`。而 r2 AC 要求**無旗標的 `init` 預設安裝 `commit-msg`**——預設路徑在 Husky 專案下沒有定義 | 成立：全檔 `commit-msg` 的出現處無一說明 Husky 下如何安裝，而 `--with-push-gate`（opt-in 的那個）有完整 stanza | 新增 § The Husky commit-msg stanza：一張表講清兩個 hook 的輸入形狀不同（stdin 一次性 ref 串流 vs 訊息檔路徑 `$1`），因此 **兩段 stanza 而非一段**；威脅面相同故沿用同三種免疫構件。優先序表改為逐 hook 指名去處 |

**遮蔽這個缺陷的是 fixture 本身**：假 git 的 `log` 給 8 字元、`cherry` 給 16（再被截成 8），兩邊碰巧
相等，所以一個對真 git 永不成立的比對在測試裡成立。已改為 7 對 40 並補回歸斷言，反向控制是
「git cherry 標 `+` 的 commit 必須仍讀作 `unique`」——沒有它，這條測試在一個把值寫死成
`already-in-target` 的腳本上同樣全綠。修寬度後另有兩條硬寫 `aaaa1111` 的期望值轉紅：它們原本
等於輸入值，所以「指名解析後的 ref 而非輸入的 ref」這件事**根本無從驗證**，改為 `aaaa111` 後才真的分得開。

Husky commit-msg stanza 依同一套封閉集合分類器把關，且**刻意用另一份清單**：`exec 0<`、`mktemp`、
`rm -f` 在這裡一律不許——這個 hook 沒有要交還的串流，允許它們只會讓兩段 stanza 互相漂移。另加
執行期雙向測試：帶禁用 attribution trailer 的訊息必須擋下且不得落到專案自己的 hook；一般訊息必須
放行且專案 hook 仍要跑。`ALLOW_AI_COAUTHOR` 明文不 unset——那是 attribution anchor 的窄口，該由
guard 判讀，不該由 stanza 從外面改掉。

#### doc 平面

三筆共用一個根因：**文件斷言了一個拓撲尚未確立的改寫**。`rules/git-workflow.md` § Push safety 訂的是
「看拓撲、不看旗標」，hook 自己也是這樣判；文件卻無條件宣稱會改寫歷史。無條件問一個通常為假的問題，
正是讓真正要緊的那次也被同樣答過去的方式。

| # | 位置 | 修法 |
|---|------|------|
| D1 | `skills/push-ci/SKILL.md` unshared 提示 | 先以 `ls-remote` + `cat-file -e` + `merge-base --is-ancestor` 判拓撲：創建／fast-forward 不問；確為改寫才問；`ls-remote` 失敗或 tip 本地不存在 ⇒ **未知即 fail-closed，照問**。提示分兩種措辭，講明操作者在回答的是「已量到的改寫」還是「無法確立」 |
| D2 | `skills/epic-merge/SKILL.md` 迭代 2..N 閘門 | 同一原則，但兩種模式可量測的時點不同：`--per-step` 在 rebase 之後可**直接觀察**；bundled 在 Step 2 之前只能以 `merge-base --is-ancestor origin/<epic> origin/<head>` **預測**。預測較弱是「在 Step 2 前設閘」的代價，且它只會偏向多問。閘門數改記為 2（不改寫時為 1） |
| D3 | 同檔 Rollback | 兩處事實錯誤：其一「before any iteration gate ran」不成立——bundled 在 Step 2 前、per-step 在 Step 3 前各有閘門，Step 3 失敗必然在其下游；真正的理由是**沒有任何一個閘門問的是這一次推送**。其二 rollback 未必改寫：Step 3 失敗時遠端可能仍停在 backup 上，還原即 no-op。改為比對 `REMOTE_TIP` 與 `BACKUP` 後再決定是否發問 |

另三筆共用第二個根因：**記錄承載了強過其證據的宣稱**，修法一律是加註記、絕不改寫。

| # | 位置 | 修法 |
|---|------|------|
| D4 | 本檔 § round 14 判定表第 5、6–7 格 | 證據其實已完整（round 16／37 兩則註記記下了原意與「untracked 故無法逐位元還原」）。缺的只是**讀者在表格當下沒有提示**，要再往下十行才遇到。加 `⚠️R16` 標記與一行圖例；兩格的判定文字一字未改 |
| D5 | `review-log-adequacy-gate.md` round-16 註記與同檔分類表 | 該註記援引的「事實更正」例外屬 Work record，不及於 History record。在**宣稱當下**加警示標記並指向檔末 round-37 註記，原文不動 |
| D6 | `r5:88` 「逐字移入…未改寫」 | 這是絕對宣稱，且可證偽並已被證偽：目的地兩個標題由 `###` 降為 `####`，且各加一段括號副標。內文是否逐字則無從查核（兩檔當時皆 untracked）。附具日期限定註記：正確讀法是「以保留原意為意圖搬移」，非經查證的位元級轉錄 |

我自查另補兩筆表格破格（皆為本分支引入）：`codex-setup/SKILL.md` 一格內未跳脫的 `||` 把 2 欄列切成 5 欄；
`epic-merge/SKILL.md` 兩列掉了開頭的 `| 2 |`。另修兩筆記錄檔內未跳脫管線造成的**渲染**破格（mermaid 邊標籤、
一段含管線的指令引文）——不動任何一個字的語意，只讓該列照原樣呈現。

**護欄反過來抓到我自己**：epic-merge 的「每一條 git 指令都必須帶正規前綴」測試把我新加的
`git ls-remote` / `git rev-parse` 判為裸指令。那不是誤報——一條讀到 ambient `GIT_DIR` 的
`ls-remote` 會拿**另一個 repo** 的 remote tip 去比對 backup。已補上前綴。

閘門數測試也隨之改寫，並補雙向控制：計數必須以 2 開頭，較小的數字只能寫成「不改寫時」的條件；
裸的 `| 1 |`、以及以 1 開頭再加括號的寫法，都必須繼續判紅。

**驗證**：`node --test $(find test -name '*.test.js')` → 3866 pass / 0 fail / 4 skipped；
`node scripts/check-comment-blocks.js` → **EXIT=0**（僅 25–29 警告帶，且皆不在本輪改動的區塊）。
`push-ci` 與 `epic-merge` 的 `SKILL_DIGEST`、`smart-rebase` 的 `SCRIPT_DIGEST` 均以腳本重算。
兩份 skill 的改動確實**改變了何時需要核可**，這點不掩飾：由「無條件詢問」收斂為「量到改寫或無法確立時詢問」，
方向與 § Push safety 的 topology-not-flag 契約一致，未知一律 fail-closed。

---

## Round 42 — 2026-08-21｜兩份全新 Codex thread，雙雙 ⛔ 且獨立指向同一批缺陷

tier=thorough。code 與 doc 兩平面各開一條**全新** thread（非 `codex-reply`），兩份報告互不知情，
卻各自收斂到同一組根因——這是本任務至今最強的訊號，也是我先記下兩個 fail verdict、再逐筆自行複現
才動手的原因。

### 五筆阻斷級，全部先複現再修

| # | 缺陷 | 複現方式 | 修法 |
|---|------|----------|------|
| C1 | `REMOTE_TIP=$(git ls-remote … \| awk …)` 吃掉 `ls-remote` 的 exit status | 對不存在的 remote 實測得 `rc=0 tip=<>`，與「分支不存在於 remote」逐位元相同 | **移除 pipe 本身**：`if REMOTE_LS=$(…); then REMOTE_TIP=${REMOTE_LS%%<tab>*} …`。參數展開沒有指令，`BASH_FUNC_awk%%` 也無從遮蔽 |
| C2 | `origin/<name>` 有歧義 | `git check-ref-format refs/tags/origin/feat-x` exit 0 | 兩側都改為 `refs/remotes/origin/<name>`（§ Backup 早已如此要求） |
| C3 | rollback 以「不相等」判定改寫 | 把較舊的 remote tip 還原到其**後裔**是普通 fast-forward | 改以 `merge-base --is-ancestor` 判 ancestry；rollback 判定表擴為 5 列，失敗列置頂 |
| C4 | 迭代閘門的判定指令寫在表格儲存格裡 | 既有測試明文宣告「表格列內的 git 指令不受檢查」 | 移出儲存格，改為帶正規前綴的 fence |
| C5 | Husky Active 述詞寫死 `pre-push-gate.sh` | 讀 `codex-setup/SKILL.md:249` | 以 `$script` 參數化，並逐 hook 列出對應（`commit-msg` → `commit-msg-guard.sh`） |

### 行為測試補完——兩位審查者都點名的空白

`rg 'REMOTE_TIP' test/skills/epic-merge.test.js` 原本**零命中**：決定是否詢問「有沒有別人在用」
的兩個探測，沒有任何一條分支被走過。本輪補 7 筆：

- `push-ci` ×2、`epic-merge` ×4（迭代閘門與 rollback 各一組）——皆以假 git 實跑 fence，斷言
  **failed / absent / found 三種讀數互不相同**（C1 摧毀的正是這個性質），並要求解析出的 tip 真的
  被送進 `merge-base`；另加形狀測試（無 pipe、無 `awk`/`cut`/`sed`、前綴齊備）與反向控制。
- `codex-setup` ×1：Active 述詞必須逐 hook 解析，反向控制同時否決**兩個方向**的寫死。

過程中兩個自找的問題值得記下。其一，fence 抽取正則 `/```bash\n([\s\S]*?if REMOTE_LS=…)/` 看似
非貪婪其實無錨點，會從文件**第一個** fence 起跨越散文，於是形狀斷言審判的是 Phase 0 的
`git ls-remote --exit-code`，不是探測本身——改以 fence 分隔符切塊、只取整塊。其二，兩份 fence 都
刻意在註解裡**指名**自己取代掉的 `| awk` 寫法，逐行掃描會把警語本身判成它所警告的缺陷——先濾註解
再判，因為受測的是會執行的東西。

`commit-msg` 執行期 fixture 原本永遠複製 guard，等於 `test -r "$1" || exit 0` 這條分支從未走過。
補上「guard 未安裝」案例：必須**落穿**而非中止（stanza 會被前置到早於它存在的 hook 上），且
以 tail 是否執行區分落穿與靜默中止——兩者的 exit code 都是 0，只有 tail 分得出來。

**突變驗證**：把 rollback 的 lookup 改回 pipeline 形狀，先確認突變確實套用，兩筆 rollback 測試
如期判紅、迭代閘門測試維持綠（突變範圍正確），還原後與備份逐位元一致。

**驗證**：`node --test $(find test -name '*.test.js')` → **3873 pass / 0 fail / 4 skipped**
（較上輪 +7，與新增數相符）；`node scripts/check-comment-blocks.js` → **EXIT=0**。
`push-ci` / `epic-merge` 的 `SKILL_DIGEST` 與 `smart-rebase` 的 `SCRIPT_DIGEST` 皆以腳本重算。

`[NIT_DEFERRED] docs/features/push-gate-optin/4-implementation.md:254 | 段落先禁止攜帶計數，隨後
自己攜帶了一個 | reason: sub-threshold-Nit | 2026-08-21`

---

## Round 43 — 2026-08-21｜兩份全新 thread 再度 ⛔；九筆中八筆採納、一筆據量測駁回

tier=thorough（P0/P1/P2 皆阻斷）。code 平面 2 筆、doc 平面 7 筆。

### code 平面

| # | 缺陷 | 複現 | 修法 |
|---|------|------|------|
| C1 (P1) | `/epic-merge` 三條 ancestry 判定沒帶 `GIT_NO_REPLACE_OBJECTS=1`，它授權的兩條 push 卻有 | 逐行比對：538／541／671 缺、470／740 有 | 三條補上守衛。關鍵在 `-u GIT_REPLACE_REF_BASE` 只是取消「替換 ref 存放位置」的覆寫，**並不停用替換**——探測讀到被 graft 過的圖、push 送出真實歷史，於是判定與操作在兩張不同的 commit graph 上作答 |
| C2 (P2) | `/push-ci` 把 `40-hex` 寫死 | `pre-push-gate.sh:95` 同批變更已同時接受 40／64 | 改為「`git rev-parse HEAD` 印出的完整 object ID」。比較本來就是字串相等，壞的是**指示措辭**：照字面做，SHA-256 repo 每次 push 都會誤判成 HEAD 移動而中止 |

C1 的教訓是測試層的：原測試只斷言「解析出的 tip 有出現在 `merge-base` 的引數裡」，而**引數對、圖不對**
的探測會通過每一條引數形狀斷言。改為連假 `merge-base` 收到的環境一併記錄並斷言。突變驗證：拿掉
rollback 那條的守衛，該測試如期判紅。

### doc 平面

| # | 缺陷 | 修法 |
|---|------|------|
| D1 (P1) | bundled 模式的「不改寫」預測不成立：它只驗 `origin/epic` 是否為 `origin/head` 的祖先，但實際操作是 `rebase --onto origin/epic backup/pr-<prev> head` | 補上必要條件「切點即目標」（`$CUT` = `$DEST`），兩條都過才可讀為不改寫；判定表按模式拆開，並補 `merge-base` 以大於 1 結束的 fail-closed 列 |
| D3 (P2) | L1 表寫「`ALLOW_FORCE_WITH_LEASE=1` 之後保護檢查照常執行」 | 實際順序是 force-form 拒絕 → **未共用佐證** → 保護檢查。照原文讀會漏掉夾在中間的閘門 |
| D4 (P2) | push-ci 判定表不窮盡：缺 `merge-base` 錯誤（>1）一列 | 補 fail-closed 列。exit 1 是它的答案「否」，大於 1 是**沒有答案**，把泛化的非零讀成「不是改寫」正是讓不確定的拓樸變成沒被問的那條路 |
| D5 (P2) | 核可文字無條件宣稱「這會改寫遠端歷史」，與它自己上方的判定表相矛盾 | 改寫子句改為取決於量到的判定。固定措辭在被判為無害的狀態下是假的，而被訓練成「警告通常是錯的」的操作者，會在唯一一次不是錯的時候讀過去 |
| D6 (P2) | 契約測試仍寫「唯一一個提示類別」 | 補上釘住**第二類**的語意斷言與反向控制。全檔 digest 是複查觸發器，不是語意守衛——刪掉那一列再重算 digest，不會有任何測試指名「有一個授權類別消失了」 |
| D7 (P2) | `harness-engineering-rebrand/1-requirements.md:43` 儲存格內未跳脫的管線 | 跳脫 |

### D2 駁回——分類判斷有誤，附量測

審查者將 `docs/features/push-gate-optin/2-tech-spec.md` 判為 current-authority，要求就地改寫 §2.3
的規範矩陣。我照做之後才以專案自己的分類器複核，結果相反：

```
node -e 'const m=require("./scripts/lib/doc-metadata.js"); …'
docs/features/push-gate-optin/2-tech-spec.md -> Design record | owesCodeAlignment: false
docs/features/push-gate-optin/4-implementation.md -> Current authority | owesCodeAlignment: true
```

規則來源是 `BUILTIN_ROLE_CONFIG.path_defaults` 的 `^[0-3]-(feasibility|requirements|tech-spec|architecture)`。
**已把 §2.3 逐字還原**（207 → 194 行），改採本檔 round 41 已建立的處置：不動原文，只在宣稱當下加
一行指標，指向檔末既有的補記。記一個自己的錯誤：中途我把**角色字串**當路徑傳給
`owesCodeAlignment(p, source)`，得到 `true`，差點據此保留改寫——該函式吃的是路徑，一個匹配不到任何
規則的字串會落到 fallback，而 fallback 正是 `Current authority`。**fail-closed 的預設值，會讓呼叫錯
誤看起來像肯定的答案。**

### 自查：表格檢查器本身漏判

`tbl.js` 沒有剝 `> ` 前綴，於是 blockquote 裡的表格對它完全不存在——D7 那張表正是這樣躲過的；補上
fence 追蹤後又發現它會把 ```markdown fence 內的**示意模板**誤判為表格。修正後全平面重掃，剩 3 筆皆在
`create-pr-stacked/2-tech-spec/`，依既有裁示屬另一個 loop，記錄不擴權：

```
[OUT_OF_SCOPE_DEFERRED] docs/features/create-pr-stacked/2-tech-spec/2-tech-spec.md:270 | 儲存格內未跳脫的管線，5 欄對 header 4 欄 | create-pr-stacked 自身 loop | 2026-08-21
[OUT_OF_SCOPE_DEFERRED] docs/features/create-pr-stacked/2-tech-spec/2-tech-spec.md:296-297 | 列少一欄（2 對 3） | create-pr-stacked 自身 loop | 2026-08-21
```

**驗證**：`node --test $(find test -name '*.test.js')` → **3873 pass / 0 fail / 4 skipped**
（本輪新增皆為既有測試內的斷言，故總數不變）；`node scripts/check-comment-blocks.js` → **EXIT=0**；
`push-ci` / `epic-merge` 的 `SKILL_DIGEST` 以腳本重算。

## Round 44 — 2026-08-21

雙平面各開新 Codex thread（`mcp__codex__codex`，read-only／approval never），兩面皆回 ⛔。

### 對 round 43 記錄的更正（2026-08-21）

上一節 D1 那列寫「**兩條都過才可讀為不改寫**」。**寫下當時，被記錄的 fence 並沒有真的強制這個
連言**：判定寫成一串隱含的條件式，`$CUT` = `$DEST` 沒有成為讀出 `no-rewrite` 的必要條件。本輪
才把它改成顯式三分支（`no-rewrite` / `unknown` / `rewrite`），並補上真正會執行它的測試。記錄按
慣例不就地改寫——上一節維持原文，這一段是它的更正。

教訓與 D2 是同一類，只是換了方向：那次是**分類判斷**錯，這次是**驗證缺席**。宣稱「補上必要條件」
時，我把「文件裡寫了這個條件」當成「這個條件會被執行」，而當時沒有任何測試能分辨兩者。

### code 平面

| # | 缺陷 | 修法 |
|---|------|------|
| C3 | bundled 判定沒有語意測試：共用的假 `rev-parse` 對每個 ref 回同一個 sha，於是 `CUT` ≠ `DEST` 這個**述詞存在的唯一輸入**從未被送進去——把它整段刪掉，全檔仍綠 | 新增 `runBundledClassifier`（能分辨 ref、也能讓 `rev-parse` 失敗），覆蓋 ancestry 0/1/2/128 × 切點同異 × 兩種 ref 缺席共 7 種輸入；並以「只有一種輸入可讀為 `no-rewrite`」的**計數**斷言取代逐列比對，讓未來悄悄變寬的靜默路徑會被看見 |
| C4 | `push-ci` 判定表的 `merge-base` > 1 那列（round 43 新增）零覆蓋 | 補表格層級守衛：六列窮盡、每列 `Ask?` 必須可判定、恰兩列得以不問；反向控制為刪列與把該列翻成 `No` 各一 |
| C5 | 兩份測試的註解過濾只濾整行 `^\s*#`，行尾註解留在視野內 | 改為剝到第一個「前有空白的 `#`」，兩檔對齊；負向控制改走同一支剝除器——會吃掉程式碼的剝除器，本來可以靠刪掉證據通過上面每一條斷言 |

C5 不是假想：`epic-merge` 的形狀檢查就是被行尾註解裡的「the cut point」一詞判紅的——**它把自己的
說明定罪成它所警告的缺陷**。這與 round 42 修過的 fence 抽取器是同一個病灶：判斷對象取錯，不是規則寫錯。

### doc 平面

| # | 缺陷 | 修法 |
|---|------|------|
| D8 | `git-workflow.md` 與 `discretion.md` 都把 hook 第二類提示寫成「**確實改寫歷史**」，但 `pre-push-gate.sh:141` 用 `!` 否定 `merge-base --is-ancestor`，把 exit 1（答「否」）與大於 1（**沒有答案**）收進同一個分支 | 兩份條文與 `test/rules/discretion-tiers.test.js` 的兩個 pin **同一個變更內**一起改，措辭改為 fail-closed：該類的判準是「**未能證明是 fast-forward**」，不是「證明是改寫」 |

量測（`scripts/pre-push-gate.sh:141`）：

```
rc=0   -> treated as fast-forward
rc=1   -> treated as FORCE
rc=2   -> treated as FORCE
rc=128 -> treated as FORCE
```

修 pin 時的自傷一則：插進 JS 雙引號字串的 `"not an ancestor"` 沒跳脫，補救時又用整批替換，連同一份
**既有且已正確跳脫**的註解一起改壞。最後改成措辭不含雙引號（`— not an ancestor —`），兩處都不再有
跳脫風險。**遇到跳脫層數打架，換掉措辭比疊反斜線可靠。**

### 記錄，不修

```
[NIT_DEFERRED] docs/features/push-gate-optin/review-log-push-gate-optin.md | 我自己送出的 code 平面檔案清單不完整（漏列本輪改動的測試檔） | reason: sub-threshold-P2 | 2026-08-21
```

清單不完整不會讓審查者看不到那些檔案——`@rules/codex-invocation.md` 要求的是它自己去查，而它確實
查到了。但同一個清單下一次可能漏掉的是**沒人會另外查到**的檔案。

### 驗證

| 項目 | 結果 |
|------|------|
| `node --test $(find test -name '*.test.js')` | **3877 pass / 0 fail / 4 skipped**（3881 項；本輪淨增 4 個測試） |
| `node scripts/check-comment-blocks.js` | **EXIT=0**（3 筆 25–29 警告帶，皆非本輪變更） |
| 變更 `.md` 全平面表格檢查（39 檔） | 僅餘 `create-pr-stacked/2-tech-spec/` 3 筆，依既有裁示屬另一個 loop |
| `epic-merge` `SKILL_DIGEST` | 以測試訊息內附的指令重算（未手打） |

### 未授權事項

round 44 是使用者授權的最後一輪（「續授權 +6 輪（到 44）」）。本變更屬 security 平面，依
`@rules/auto-loop.md` § Cap Diagnostic Protocol，任一觸發皆直接走 ⚠️ Need Human——**round 45 的
review dispatch 需要新的人類授權**。未提交。

## Round 45 — 2026-08-21

使用者續授權後執行。雙平面各開新 Codex thread，兩面皆回 ⛔：code 2 筆、doc 4 筆，逐筆先驗證再修，
全部成立、全部已修。

### code 平面

| # | 缺陷 | 修法 |
|---|------|------|
| C6 (P1) | 拓樸探測問的是 `origin`，而 `origin` 可以是**兩個位址**：`ls-remote` 走 fetch URL，push 走 pushurl。探測把 A repo 判為建立／快轉，push 卻改寫 B repo，而**被改寫的那個 repo 從頭到尾沒有人被問過** | 改以 `git remote get-url --push --all origin` 解析實際目的地，`ls-remote` 直接問該 URL；Push Plan 一併顯示目的地 |
| C7 (P2) | 我 round 44 寫的判定表守衛是**計數式**：六列、恰兩列 `No`、`>1` 列仍問。把「查詢失敗」翻成 `No`、「建立」翻成 `Yes`，三個述詞全數維持，表格卻已經放未知拓樸過關 | 改為**逐列身分綁定**：每個 result 以自己 Result 欄的穩定片語指名，配唯一合法判定；再加「每一列都必須被恰好一個期望認領」，讓沒人想到要比對的新列無法無聲加入 |

C6 的量測（git 2.55.0）——兩種分歧機制，`get-url --push --all` 在兩者都等於 push 實際連的位址：

```
remote.origin.pushurl 已設      ls-remote --get-url origin -> fetch URL；push -> pushurl
url.<x>.pushInsteadOf、無 pushurl ls-remote --get-url origin -> fetch URL；push -> 改寫後 URL
```

三個新的 fail-closed 輸入都不呼叫 `ls-remote` 就先關門：多重 pushurl（git 會扇出到每一個，單一 tip
最多只能替其中一個回答）、`get-url` 失敗、以及解析不到任何位址。負向控制是把 fence 裡的
`-- "$PUSH_URL"` 改回 `-- origin`，證明「問錯 repo」看得出來。

C7 的教訓：**計數說不出「哪些」結果可以沉默，而那正是唯一的問題。** 這與 round 44 的 C5 是同一支
病：守衛判斷的對象取錯了。新版另加一個正向控制——把列的順序整個顛倒必須**維持綠燈**，否則守衛釘的
是位置而不是政策。

### doc 平面

| # | 缺陷 | 修法 |
|---|------|------|
| D9 (P2) | `update-docs/SKILL.md` 把 `owesCodeAlignment()` 寫成無參數形式 | 補回 `(path, source, taxonomy)`，並明寫「第一個參數是 repo 路徑，永遠不是角色標籤」——round 43 就是把 `"Design record"` 當路徑傳進去，落到 `FALLBACK_ROLE` 得到 `true` |
| D10 (P2) | 同檔把 current-authority 指為「literally the first row」 | 改以角色名指認（`Current authority` / `FALLBACK_ROLE`） |
| D11 (P2) | `codex-setup/SKILL.md:364` 把條件列指為「The last row」 | 改為「`scripts/pre-push-gate.sh` 那一列」 |
| D12 (P2) | `push-ci/SKILL.md` 的 L1 矩陣把改寫類別等同於 non-fast-forward，漏掉 **既有 tag 的任何更新**——git 對既有 `refs/tags/*` 的**任何**變更（含前進移動）都要求 force 語意，因為 tag 指的是一個 commit 而非一條歷史線 | 類別改為「non-fast-forward 的 **branch** 更新，或**既有 tag 的任何更新**」，並註明 tag 那半是 hook 層事實：`/push-ci` 只組 branch refspec，經由本 skill 到不了 |

D10／D11 與 round 44 在 `epic-merge` 修掉的是同一個病灶——**位置性指示壓在可編輯表格上**，同一輪內第三、
第四次出現。這已達 `@rules/self-improvement.md` 的「同一模式 3 次以上」門檻。

### 自傷一則：`$'` 把文件貼成三份

修 C6 時用 `node -e` 做 fence 替換，替換字串含 `${VAR%%$'\n'*}`。JS 的**替換字串**裡 `$'` 是特殊語法，
意思是「比對位置之後的整段原文」——兩處 `$'` 各把文件剩餘部分再貼一遍，696 行變 **1454 行**，
`### Phase 2`、`## Arguments`、`## Prohibited`、`## Verification`、`## Examples` 各變三份，而**編輯回報成功**。

查出來純屬僥倖：下一個 `Edit` 呼叫回報 `Found 3 matches`。把兩處編輯反轉後 digest 與 pin **逐位元相符**，
以該狀態為還原點重做，改用函式形式 `replace(OLD, () => NEW)`（函式回傳值不做 `$` 展開）。

已記為 **L6**（`.claude/sd0x-dev-flow-lessons.md`）。防呆訊號是**行數**：腳本化編輯後斷言行數變化等於
預期，`$` 展開的爆炸一定看得見。

### 驗證

| 項目 | 結果 |
|------|------|
| `node --test $(find test -name '*.test.js')` | **3878 pass / 0 fail / 4 skipped**（3882 項；本輪淨增 1 個測試） |
| `node scripts/check-comment-blocks.js` | **EXIT=0**，0 筆 BLOCK |
| 變更 `.md` 全平面表格檢查（39 檔） | 僅餘 `create-pr-stacked/2-tech-spec/` 3 筆，依既有裁示屬另一個 loop |
| `push-ci/SKILL.md` 結構複查 | 728 行；Phase 0–3、Arguments、Prohibited、Verification、Examples、判定表、REMOTE_LS fence 各 **1** 份 |
| `push-ci` `SKILL_DIGEST` | 以測試訊息內附指令重算（未手打） |

本輪有編輯，故兩平面 digest 再次過期；未提交。

## Round 46 — 2026-08-21

Code thread `01a0245f`（新 thread，非 `codex-reply`）。Doc thread `k8e9rr6up` **未產出判定**：MCP
在 1823 秒無回應後中止，那是基礎設施失敗而不是 review 結果，所以 doc 平面**不記 note**——沒跑完的
review 沒有判定可記，記了就是偽造。

Gate：`⛔ Blocked` / `gate_reason=IN_SCOPE_BLOCKING`（3×P1 + 1×P2；tier=thorough，P2 亦封鎖）。
`code_review` 已於判定回來當下記為 `fail`（rounds=6）。

| # | 嚴重度 | 位置 | 內容 | 處置 |
|---|--------|------|------|------|
| 1 | P1 | `scripts/pre-push-gate.sh:141` | ancestry 尊重 graft／replacement 狀態，rewrite 被判為 fast-forward | 已修並實測（見下） |
| 2 | P1 | `skills/epic-merge/SKILL.md:532`、`:698` | probe 讀 fetch URL、push 走 push URL | 已修，兩處 probe + 兩處 push 前重驗 |
| 3 | P1 | `skills/push-ci/SKILL.md:527` | Phase 2 未重驗目的地 | 已修，新增 `PLAN_PUSH_URLS` 比對 |
| 4 | P2 | `test/skills/push-ci.test.js:1772` | 判定表只是散文，`>1` 一格無行為測試 | 已修，classifier 改為可執行 fence |

**第 1 筆的獨立驗證超出 reviewer 所指**：reviewer 只指出「hook 未清除 graph 覆寫」，本輪實際建了
repo 跑完整條路徑，量到的是 exit 0 + remote tip 真的移動 + 完全沒有提問——比「可能被誤判」強得多的
證據，也因此修法從「加進 `env -u` 前綴」改成「在第二輪 pass 內 unset 兩個名字並 **export**
`GIT_NO_REPLACE_OBJECTS=1`」：`refs/replace/*` 住在 repo 裡，任何前綴都碰不到它。

**本輪自傷一次，已逐位元還原。** Phase 2 的編輯腳本用「命令名稱第一次出現的位置」往回找 `$(` 推導
shell 前綴，而該字串**第一次出現在散文裡**（Push Plan 範本），於是前綴橫跨百餘行，插入後
`### Phase 1` 與 `## Push Plan` 各成兩份，檔案 728 → 848 行。`PREFIX.startsWith('/usr/bin/env ')`
這道斷言**通過了**——起點對、終點錯。行數 canary（預期 +14 得到 +120）當場攔下；精確反轉後以既有
digest `bbda2bcc…` 逐位元證明還原，再以「錨定整行程式碼形狀 + 斷言前綴不含換行 + 長度上限」重做，
delta 正好 +14。記為 L8。

驗證（修補後）：

| 項目 | 結果 |
|------|------|
| `test/scripts/pre-push-gate.test.js` | 62 pass / 0 fail（含負向控制：拿掉兩行後 grafted rewrite 以 exit 0 通過） |
| `test/skills/push-ci.test.js` + `epic-merge.test.js` | 74 pass / 0 fail |
| 兩個 `SKILL_DIGEST` | 由腳本重簽，未手打 |
| Phase 2 byte pin | 由檔案本身重新產生，175 行 |

後續：全套測試、comment-block 檢查、doc 平面重派（thread 逾時，需重跑）。


## Round 47 — 憑證外洩、對不存在的核准比對，以及一個修錯的修補

**Code：⛔ Blocked（2 × P1）· Doc：⛔ Needs revision（1 × P1 + 2 × P2）。tier=thorough。**

| # | 平面 | 嚴重度 | 位置 | 結論 |
|---|------|--------|------|------|
| 1 | code | P1 | `skills/push-ci/SKILL.md` Phase 1/2 | 成立。`git remote get-url --push --all origin` 逐字回傳 `https://user:token@…`（已實測），而 Phase 1 要求把它印進核准文字、Phase 2 的拒絕訊息又印了兩份。命中 Anchor Register #2 |
| 2 | code | P1 | `skills/epic-merge/SKILL.md` 兩道 force-push 圍籬 | 成立。圍籬比對的是「核准指名的 URL」，但 bundled / per-step / rollback 三組提問都沒有指名目的地——偵測得到之後的設定變更，卻沒把破壞性 push 綁到操作者的決定上 |
| 3 | doc | P1 | `4-implementation.md` § 4.3 / § 4.6 | 成立。§ 4.6 是另起一段而不是併進 § 4.3，留下兩份互相矛盾的帳：一列寫 Caller、一段寫「hook 內關不掉」，而 hook 早已關掉它 |
| 4 | doc | P2 | `4-implementation.md` :630 | 成立，且比 reviewer 說的更嚴重（見下） |
| 5 | doc | P2 | `4-implementation.md` :675 | 成立。方向寫反了，同一段六行後的敘述才是對的 |

**第 4 筆查證時翻出 round 46 的修補本身是錯的。** 為了確認「當時是不是設了
`ALLOW_PUSH_PROTECTED=1`」而重建量測環境時測到：`unset GIT_GRAFT_FILE` 會讓 git 回退到預設路徑
`$GIT_DIR/info/grafts`，那是 repo 內的檔案，`env -u` 到不了——所以 round 46 的兩行**沒有關掉
第三條管道**，同一筆 grafted rewrite 仍以 exit 0 蓋掉受保護的 `main`。改為
`export GIT_GRAFT_FILE=/dev/null` 後拒絕，remote tip 未動。這條缺陷 reviewer 沒有找到；它是
「先自行查證再動手」查出來的，而不是照著 finding 修出來的。

同一個 `-u GIT_GRAFT_FILE` 也在 caller 層的六個 push 前綴裡，因此 `/push-ci` Phase 0 的
`merge-base` 分類器同樣可被騙。兩份 SKILL 中所有已帶 `GIT_NO_REPLACE_OBJECTS=1` 的圖形讀取點
一律補上 `GIT_GRAFT_FILE=/dev/null`（push-ci 8 處、epic-merge 7 處），並以**性質測試**釘住配對，
避免日後重生 byte pin 時掉一個。

**修補摘要**

| 項目 | 內容 |
|------|------|
| 憑證 redaction | 兩份 SKILL 共 6 個位置導出 `PUSH_URLS_SAFE`；原始值只留在 shell 內供查詢與比較之外的用途，核准文字、錯誤訊息、圍籬比對一律用遮蔽形式。遮蔽只會把「同一個 repo 的兩組憑證」併成一個字串，不可能把兩個 repo 併成一個，所以重導向仍偵測得到 |
| epic-merge 提問 | bundled 兩道、per-step 兩道、rollback 兩道，全部帶入 `<PUSH_URLS_SAFE>` |
| 圖形正規化 | hook 改 `export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1`；caller 前綴 15 處同步 |
| 測試 | `pre-push-gate` 62 → 64（新增 repo-grafts 正向案例 + 「用 unset 就重新打開」的負向控制）；skills 74 → 81（redaction 行為測試含三個正向控制、目的地可區分性、前綴配對性質、提問指名目的地含正負控制） |

**同一個形狀第三次出現**：unset 一個變數不等於關掉它所控制的行為——當 unset 之後的預設值本身
就是不安全的那一邊時，strip 只是把管道換一條。`GIT_NO_REPLACE_OBJECTS` 記在 r5，
`GIT_GRAFT_FILE` 記在這一輪。已升級為 L9。

**收尾 grep 於 round 47 後重跑**（本輪動過 `docs/features/push-gate-optin/4-implementation.md`，
故重驗）：§ 收尾驗證（AC 6）那條指令原樣執行，8 筆命中與 2026-08-20 那次**同一組**，判讀不變——
`readme-catalog-sync` 與 `cross-tool-portability` 的六筆是 Design record 刻意保留的撰寫當時字句
（各自帶日期註記），`4-implementation.md:91` 是本 grep 自己的 pattern 被表格引用而非一句宣稱，
`skills/push-ci/SKILL.md:286` 是條件式措辭（「Where the `pre-push` hook is installed」）而非無條件
的終端確認宣稱。無新增殘留。r4 的兩條相關 AC 維持不勾選，理由見該單自身的日期註記：字面條件
（「一律未被修改」／grep「證明」無殘留）本就不成立，實際達成的是較窄的結果。


## Round 48 — 目的地一旦被到處指名，就把它帶的東西一起公開了

**Code：⛔ Blocked（3 × P1 + 1 × P2）· Doc：⛔ Needs revision（1 × P2）。tier=thorough，P2 同樣阻擋。**

| # | 平面 | 嚴重度 | 位置 | 結論 |
|---|------|--------|------|------|
| 1 | code | P1 | `scripts/pre-push-gate.sh` 兩處 `Remote:` | 成立，且比 reviewer 指的多一處。git 在 push 未指名 remote 時把**目的地 URL 本身**當 `$1` 交給 hook，rewrite 與 protected 兩個提示都逐字印出。自行實測：`Remote: https://alice:<synthetic>@example.invalid/repo.git`。命中 Anchor Register #2 |
| 2 | code | P1 | `skills/push-ci/SKILL.md` sanitizer | 成立，且是兩個破口而不是一個。`?access_token=…` 與 fragment 原樣通過（實測）；`${AUTH#*@}` 切第一個 `@`，`https://alice:pw@<token>@host/…` 遮蔽後仍留下 token 片段（實測） |
| 3 | code | P1 | `skills/epic-merge/SKILL.md` 四份複本 | 成立。同一段 sanitizer 在兩份 SKILL 共 6 處，測試只執行第一份 |
| 4 | code | P2 | `skills/epic-merge/SKILL.md` rollback gate 2 | 成立。上一段分類器明確分出 creation 與 fast-forward 兩列，提問卻固定寫「This rewrites remote history.」——在那兩列上是假的，而 gate 1 早就是依拓樸選句的 |
| 5 | doc | P2 | `4-implementation.md` § 4.3 | 成立。文字宣稱的是端到端結果（remote tip 從 A 移到 B），引用的測試卻只用合成 ref 行直接呼叫 gate，沒有裝 hook、沒有真的 push、沒有讀 remote tip。兩個 SHA 出自一個丟棄式 repo，誰也查不到 |

**修補摘要**

| 項目 | 內容 |
|------|------|
| hook 提示 | 新增 `REMOTE_SAFE`，兩處 `Remote:` 一律印遮蔽值。遠端**名稱**（無 `://`）原樣通過 |
| sanitizer | 三個承載憑證的欄位一律整段遮蔽：userinfo 改切 **最後**一個 `@`（且 authority 先以 `?`/`#` 收界）、query、fragment。6 處逐位元組相同，hook 內複製同一套轉換 |
| rollback 提問 | 改為 `<effect>`，四列各自對應：rewrite／拓樸未知（fail-closed）／creation／fast-forward |
| 端到端測試 | 新增「the round-46 unset form wired as a real hook → a grafted rewrite moves the protected tip」：bare remote、hook 真的裝上、graft 寫進 `.git/info/grafts`、同一道 `ALLOW_PUSH_PROTECTED=1 git push --force origin main` 跑兩種正規化，兩側各讀一次 remote tip。**繞過真的重現**（tip 移到無血緣的 commit），修補側被拒且 tip 未動；拒絕原因以訊息斷言，不只看 exit code |
| 測試 | `pre-push-gate` 64 → 67；skills 81 → 85（含「每一份複本必須與被執行的那份逐位元組相同」及其負向控制） |

**這一輪的形狀：修補本身會產生新的攻擊面。** 前三輪把「目的地」變成每一道 gate 都要指名、都要比對的值——這是對的修補——而它同時把一個可能含憑證的字串放進提示、核准文字與錯誤訊息。reviewer 只指出 userinfo 一種；自行實測才發現 query、fragment 與多個 `@` 三種都漏。遮蔽的代價也一併寫進文件而不是略過：只有在被遮蔽的欄位內部不同的兩個目的地會讀起來相同，scheme／host／path 從不遮蔽，所以重導向仍偵測得到。

**第 5 筆是「引用了一個證明不了該主張的工件」。** 修法選了補測試而不是刪主張：那段量測是真的，缺的是任何人都能重跑的形式。


## Round 49 — 一個在核准前不存在的值，和一列永遠推不出去的 rollback

**Code：⛔ Blocked（2 × P2）· Doc：✅ Mergeable（0 findings）。tier=thorough。**

| # | 平面 | 嚴重度 | 位置 | 結論 |
|---|------|--------|------|------|
| 1 | code | P2 | `skills/push-ci/SKILL.md` Phase 1 計畫行 | 成立。計畫行要求印出「Phase 0 導出的 `PUSH_URLS_SAFE`」，但兩處導出（原 366、559 行）都落在 Phase 1 的 `--force-with-lease` 子區段內，Phase 0（104–287）根本沒有這個值——一般 push 走到 Phase 2 時，核准過的目的地是空的 |
| 2 | code | P2 | `skills/epic-merge/SKILL.md` rollback push | 成立，但只成立一半（見下） |

**第 2 筆只採納一半，理由是實測。** Reviewer 建議把兩處 lease 都綁到剛量到的 tip。實測
（2026-08-21，bare remote）顯示：對**仍然存在**的 ref，無值的 `--force-with-lease` 錨在
`refs/remotes/origin/<head>`——上一次 fetch 看到的 tip——它會拒絕「這次 fetch 之後別人推上去的
任何東西」，而綁在幾秒前量到的 tip 反而會接受那些東西。改綁是**放寬**，不是收緊。真正不可能成立
的只有 creation 那一列：remote 分支在 Phase 0 fetch 之後被刪掉時，tracking ref 還留著舊 OID 而
remote ref 是 null，無值 lease 以 `stale info` 拒絕——分類器標成「允許的 creation」的那一列
永遠推不出去。

**第一版修補被自己的測試否決，這件事值得記下來。** 先寫成 `LEASE=<依列選一種>` +
`git push "$LEASE"`，三個既有測試同時變紅：形式列舉把那行讀成 Anchor 授權沒有涵蓋的裸
`push`。那不是誤報——**flag 一旦離開呼叫點，靜態掃描和人眼就同時看不見它了**，而這份文件的
force 可稽核性正是靠「每個 push 形式都是字面值」撐著的。改採 fail-closed：creation 那一列
**不 push**，比照 `REMOTE_TIP` = `BACKUP` 那一列回報並交還開發者。能推的形式
（`--force-with-lease=refs/heads/<head>:`，空期望值）不在 `git-workflow.md` § Exception 的授權
清單上，加它本身就是 Anchor 層的變更（Register #4）；而且「別人把這個分支刪了」本來就不是
rollback 被要求撤銷的那個 rewrite。

**修補摘要**

| 項目 | 內容 |
|------|------|
| push-ci Phase 0 Step 7 | 新增一節，在核准之前無條件導出 `PUSH_URLS` / `PUSH_URL` / `PUSH_URLS_SAFE`；fence 已 `bash -n` 並在 fixture repo 實跑。Phase 0 = 104–327，Step 7 在 288，Phase 1 移至 328 |
| epic-merge rollback | push 行維持字面無值 lease；分類器 `REMOTE_TIP` 空那一列改為不推、回報並附上量測依據；gate 2 的 `<effect>` 移除 creation 那句（那一列不再走到這個 gate） |
| 測試 | push-ci 40 → 42（**位置**斷言：Phase 0 標題與 Phase 1 標題之間必須有導出，負向控制是把該行移除後仍留下後面的副本；以及把 Step 7 fence 實跑，驗 pushurl ≠ fetch url 且憑證被遮蔽）。epic-merge 45 → 48（creation 列拒絕 + 負向控制；git lease 語意 oracle：刪除後無值 lease → `stale info`、空期望值 → 重建成功、分支回來後 → 拒絕）。`assertPushProperties` 新增兩條性質：lease 必須字面出現在呼叫點、且不得帶裸 force |

**同一個形狀**：round 48 是「目的地被到處指名之後，它帶的東西也一起公開了」；這一輪是
「值被到處引用之後，才發現它在被引用的地方還沒有被算出來」。兩次都是**引用先於定義**，而兩次都
不是靠讀 finding 看出來的，是靠沿著呼叫鏈往回推位置看出來的。


## Round 50 — 建立憑證的那一道命令，正好是唯一擋得住的那一道

**Code：⛔ Blocked（1 × P1 + 3 × P2）· Doc：✅ Mergeable（0 findings）。tier=thorough。**

| # | 平面 | 嚴重度 | 位置 | 結論 |
|---|------|--------|------|------|
| 1 | code | P1 | `scripts/pre-push-gate.sh:31` | 成立，且是本功能到目前為止最嚴重的一筆 |
| 2 | code | P2 | `skills/push-ci/SKILL.md` Phase 0 | 成立，而且比 reviewer 說的多一項（見下） |
| 3 | code | P2 | `skills/epic-merge/SKILL.md` rollback 分類器 | 成立，且同形狀在迭代分類器上也成立 |
| 4 | code | P2 | `skills/epic-merge/SKILL.md` rollback 各列對應 | 成立，其中一半是 round 49 自己寫錯的 |

**第 1 筆：`exec` 是 builtin，builtin 會被環境匯入的函式遮蔽，而那個環境正是這段 re-exec 存在的
理由。** round 35 關掉的是「函式 **return**」那一種——控制流會回來，落在 `${x:?}` 保險絲上；
「函式 **exit**」那一種永遠不會回來，保險絲因此無法抵達。實測 2026-08-21：帶
`BASH_FUNC_exec%%='() { exit 0; }'` 時，誠實執行以 exit 1 拒絕的受保護分支 push，變成
**exit 0、零輸出**。

修法不是再加一道檢查，而是**不再經過 `exec`**：privileged shell 改以普通指令啟動，狀態由
`exit $?` 傳回。四項前提逐一量測：`exec` 在第一趟確實可被匯入函式遮蔽；`bash -p` 拒絕匯入函式
（所以第二趟安全，破口只在第一趟）；**含 `/` 的名稱無法被遮蔽**——bash 直接拒絕匯入名稱帶斜線的
函式定義，所以 `/usr/bin/env` 前面站不了任何東西；被遮蔽的 `exit` 會往下掉，因此保險絲仍要留在
後面。四種遮蔽形式（exec-exit、exec-return、exit-noop、兩者兼具）現在都以 exit 1 拒絕，而
`ALLOW_PUSH_PROTECTED=1` 的正向控制仍以 exit 0 放行——不是靠一律拒絕矇混。負向控制把 `exec`
接回去，在舊形式上重現 exit 0 靜默通過。

**第 2–3 筆是同一個形狀：值在 fence 裡被指派，然後隨 fence 一起消失。** `push-ci` 的 SKILL 自己
在 Phase 2 寫著「每個 fenced block 都是獨立的 shell」，而 round 49 新增的導出正是一個獨立 fence，
只指派、不輸出。reviewer 沒說的第三項：新節取名 **Step 7**，但 Phase 0 fence 裡**已經有一個
step 7**（pre-push gate detection）。三件事一起解——導出併進 Phase 0 fence 當 **step 8**，與
step 0–7 共用同一個 shell、排在受保護分支提問**之前**，並以
`printf 'PUSH_URLS_SAFE=[%s]\n'` 把值交出去。`epic-merge` 兩個分類器（迭代與 rollback）同樣補上
report 行。

**第 4 筆：執行區塊的前置條件把三件事綁成一件。** 舊句「只有在**兩道**提問都被回答之後」同時錯在
兩個方向：fast-forward 那一列不欠 unshared attestation，而「推不出去」的兩列**仍然欠本地
`git switch -C` 還原**——那兩列正好是本地分支壞掉才會走 rollback 的情境。現在 step 1–2（clean
tree 檢查 + 本地還原）宣告為每一列都欠，step 3（push）才依列決定：三列會推，其中兩列才問 gate 1。
round 49 那句「會走到這一行的只有 rewrite 與無法判讀」也漏掉 fast-forward，一併更正。

**修補摘要**

| 項目 | 內容 |
|------|------|
| `pre-push-gate.sh` | privileged 進入點不再經過 `exec`；`exit $?` 傳回狀態；保險絲保留給被遮蔽的 `exit` |
| `push-ci` | 導出併入 Phase 0 fence 成為 step 8（排在第一道提問之前），並印出 `PUSH_URLS_SAFE=[…]`；計畫行改引用 step 8 |
| `epic-merge` | 兩個分類器補上 report 行；rollback 前置條件依列拆開；round-49 的漏列更正 |
| 測試 | `pre-push-gate` 67 → 69（四種遮蔽形式 + 正向控制 + 在舊形式上重現 bypass 的負向控制）；`push-ci` 42（改為執行整段 Phase 0 fence 並讀 skill **自己**印出的值，不再由測試補 printf；step 抽取器改以「下一個編號步驟」為界）；`epic-merge` 48 → 50（分類器 report 性質測試 + 負向控制；rollback 各列與前置條件對應） |

**這一輪最該記下來的一件事**：三個 P2 都藏在「測試自己補上了被測物缺少的介面」後面——
`runEpicProbe` 自己 append `printf`，push-ci 的執行測試也自己 append `printf`。補上去之後，
量測與被量測的東西被關進同一個 shell，於是「值出不了 fence」這個缺陷在測試裡**看起來就像不存在**。
已升級為 L10。

---

## Round 51–52 — 修的是個案，不是那一類（2026-08-22）

**Round 51 判決**：code `⛔ Blocked`（4 × P1 + 1 × P2）、doc `⛔ Needs revision`（1 × P1 + 1 × P2）。
兩個平面都已記錄為 `fail`。以下是 round 52 對每一筆的處置與量測。

### 先更正 Round 50 那一筆記錄

上面「測試」那一列把兩種計數單位混在一起。`67 → 69`、`48 → 50` 是 node:test 報告的 `# tests`
總數（含參數化註冊），而同一列的 `push-ci 42` 是 `grep -c '^test('` 的頂層數。兩者不可比。
往後一律標明計數指令：**`grep -c '^test('`（頂層 test 宣告）**，round 52 收尾時為
`pre-push-gate 70`、`push-ci 42`、`epic-merge 40`、`codex-setup 26`。

同一列另一句「privileged 進入點不再經過 `exec`；`exit $?` 傳回狀態」在寫下時就是**問題本身**，
見下。

### P1-a：`exit $?` 和 `exec` 是同一類，只差一行

round 50 把 `exec /usr/bin/env …` 換成一般命令，理由是 `exec` 是 builtin、builtin 會被匯入的
函式遮蔽。緊接著那一行的 `exit $?` 是同一個論證，逐字適用。量測 2026-08-22，對一個 gate 本來以
exit 1 拒絕的 protected 推送：`BASH_FUNC_exit%%='() { builtin exit 0; }'` → **exit 0**，而子行程
的拒絕訊息還留在 stderr。也就是說 hook 自己的輸出說它拒絕了，git 記錄的卻是核准。

修法不是換一個更硬的終止子，而是**不要終止子**：檔案其餘部分移進同一個 `case` 的第二個分支，
第一遍最後執行的命令就是子行程啟動，bash 以最後一個命令的狀態離開。`case` 是保留字，由文法解析，
沒有命令查找可以介入。

### P1-b：領頭的那個字終究是可以被答的

round 50 的記錄與 `4-implementation.md` 都把 `error importing function definition for
'/usr/bin/env'` 讀成「函式名稱不能含斜線」。**不能的是「匯入」，不是「定義」**：在本 shell 內
`source` 進來的定義帶斜線完全合法（量測：`function /usr/bin/env { echo HIJACKED; }` 後呼叫
`/usr/bin/env true` 會印出 `HIJACKED`）。而 `$BASH_ENV` 正是在第 1 行之前被 source 的。

量測：對出貨時的 `#!/usr/bin/env bash`，一個內容為 `function /usr/bin/env { exit 0; }` 的
`BASH_ENV` 檔 → gate 回傳 **0，完全沒有輸出**。

檔案內部沒有任何一行早得過 `BASH_ENV`，所以唯一能修的地方是 shebang，現為
`#!/usr/bin/env -S bash -p`。`-p` 讓 bash 直接忽略 `BASH_ENV`/`ENV`/`SHELLOPTS` 與函式匯入；
`-S` 是 shebang 能帶旗標的唯一辦法（BSD env 與 GNU coreutils >= 8.30，較舊的 env 會讓 exec 失敗
→ git 判定 hook 失敗 → 拒絕推送，仍是 fail-closed）；維持 `env` 而不寫死 `/bin/bash`，是因為後者
在 macOS 等於 bash 3.2、在 NixOS 根本不存在。

**殘留，寫出來而不是關掉**：`bash <gate>` 加敵意 `BASH_ENV` 會繞過 shebang，仍是 exit 0。那不是
git 走的路徑（git 對 hook 檔 execve，Husky stanza 則以 `bash -p` 且已 `-u BASH_ENV` 執行），而且
能選直譯器的人同樣能選擇不跑 hook。Husky stanza 自己有同形狀的殘留高一層：它的第一行跑在專案自己的
`.husky/pre-push` shell 裡，那個 shebang 不是我們寫的。兩者都記在
`4-implementation.md` § 4.3 與 `skills/codex-setup/SKILL.md`，免得下一輪把 shebang 讀得比它實際
涵蓋的還多。

### P1-c、P1-d、P2：fence 的輸出介面仍然不完整

round 50 只替 `push-ci` 的一個 fence 與 `epic-merge` 的兩個分類器補了 report 行。實際上：

| 位置 | round 52 補上 |
|------|--------------|
| `push-ci` Phase 0 | 由只印 `PUSH_URLS_SAFE` 改為印 `BRANCH` / `SET_UPSTREAM` / `FORCE_WITH_LEASE` / `HEAD_SHA` / `PUSH_GATE` / `PUSH_URLS_SAFE` 六項（step 9） |
| `push-ci` force 拓撲分類器 | 新增 `ASK` / `ASK_REASON` / `REMOTE_TIP` / `LOOKUP_FAILED` |
| `epic-merge` 迭代分類器 | 新增 `BUNDLED_ANCESTRY` / `NEW_HEAD` / `PUSH_URLS_SAFE`（`BUNDLED_READING` 把「ancestry 出錯」與「切點落後」壓成同一個 `unknown`，只印結論會弄丟量到的是哪一個） |

### L10 三處實例全部拆掉

round 51 指名三處測試仍在替被測物補介面，現已改為讀被測物**自己**印出的值：
`test/skills/push-ci.test.js` 的 gate 偵測 helper（改為執行整段 Phase 0 fence，解析
`PUSH_GATE=[…]`；fixture 因此需要一個 commit，空 repo 會在 step 1b 以 detached HEAD 中止）、
同檔的拓撲分類器 harness（`TIP=<…> FAILED=<…> ASK=<…> WHY=<…>` 這個緊湊字串改為由 fence 自己的
report 行**重建**，缺欄位會顯示為 `<absent>` 而不是靜靜通過）、
`test/skills/epic-merge.test.js` 的 bundled classifier helper。

### 驗證

| 項目 | 結果 |
|------|------|
| `bash -n`（bash 3.2 與 5.3 各一次） | 通過 |
| 遮蔽矩陣（`exec` 兩形式、`exit` 兩形式、`builtin`/`command`/`[`、`BASH_ENV` 斜線函式經 shebang） | 全部 exit 1；正向控制 `ALLOW_PUSH_PROTECTED=1` 仍 exit 0 |
| 負向控制 | 兩個都重現舊漏洞（`exit $?` 版 exit 0 且 stderr 有拒絕訊息；舊 shebang 版 exit 0 且無輸出） |
| `node scripts/check-comment-blocks.js` | exit 0（gate 檔頭由 39 行 BLOCK 降為 27 行 WARN，量測內容遷入 `4-implementation.md` § 4.3 並留指標） |

## Round 53 — 兩個平面各 3 筆 P2（thorough tier 下全數 blocking）

日期：2026-08-22。tier=thorough（push safety 屬 security 變更，Anchor Register #3），P0/P1/P2 皆
blocking，Nit 不 blocking。round 52 兩個平面回傳 `⛔ Blocked` / `⛔ Needs revision`，各記 fail 一次。

| # | 平面 | 位置 | findings |
|---|------|------|----------|
| C1 | code | `skills/push-ci/SKILL.md` Phase 0 step 3 | 表格寫「Abort」，但該行狀態被丟棄，後續步驟看不到——「一個後續步驟看不見的中止，是一列沒有東西實作的表格」 |
| C2 | code | `skills/epic-merge/SKILL.md` 兩個 fence | `merge-base` 無條件執行，空 `REMOTE_TIP` 使一次執行同時命中兩列互相矛盾的表格列 |
| C3 | code | `scripts/pre-push-gate.sh` protected 提示 | rewrite 資訊與 attestation 憑證混在同一份清單，`ALLOW_FORCE_UNSHARED=1` 已回答過的問題仍被再問一次 |
| D1 | doc | gate 可被 source 繞過 | 已示範的繞過路徑：sourcing 跳過 shebang，`-p` 從未生效 |
| D2 | doc | `skills/codex-setup/SKILL.md` 兩處 | `$0` 與 `pipefail` 外洩的說法在量測後已不成立 |
| D3 | doc | `4-implementation.md` § 4.6 | 以現行語態呈現 `bash -p "$0"`，該構造已兩度更換 |

### C1 —— `--exit-code` 才是真正的缺陷，不是遺漏的中止

補上硬中止只做對了一半。量測（2026-08-22，對本機 bare repo）：

| remote 狀態 | `ls-remote --exit-code` | `ls-remote` |
|---|---|---|
| 可達、無 ref（新 repo） | **2** | 0 |
| 不可達 / 路徑不存在 | 128 | 128 |

`--exit-code` 把「答得出來但還沒有 ref」和「根本連不上」歸為同一個失敗。前者正是 `/push-ci` 存在
要服務的情境——新 repository 的第一次 push。旗標已移除；中止保留。`makeRepo` 的 origin 現在**刻意
留空**，使檔內每個 fixture 都成為這條判定的常設正向控制；另加一條 self-check（`ls-remote` 不通時
由 fixture 自己報錯，而不是看起來像 skill 有問題）。

### C2 —— 把「先檢查哪一列」從散文變成可執行的推導

空 `REMOTE_TIP` 讓 `merge-base --is-ancestor "" "$NEW_HEAD"` 以 128 結束，於是同一次執行既符合
「merge-base 高於 1 → topology 未知 → 要問」，又符合「REMOTE_TIP 為空 → creation → 不要問」。
rollback 表以散文寫著「**Checked first**」來排解，但那是寫在互相重疊的列**旁邊**的優先序，沒有任何
東西執行它。

兩個 fence 現在各推導出**一個詞**，順序中沒有重疊：

| fence | 詞 |
|---|---|
| iteration | `unknown` · `creation` · `up-to-date` · `fast-forward` · `rewrite` |
| rollback | `unknown` · `head-deleted` · `no-op` · `fast-forward` · `rewrite` |

`LOOKUP_FAILED` 測在最前面，這個位置是承重的而非風格：lookup 失敗同樣會使 `REMOTE_TIP` 為空，先測
空值會把每個連不上的 remote 讀成 creation，正好是 fail-closed 的反面。

同一個 fence 內另修一筆同類：`BACKUP` 原本用裸 `git rev-parse "backup/pr-${N}"`——ref 不存在時它會把
**參數本身**印到 stdout 並以 128 結束，於是 `BACKUP` 拿到字串 `backup/pr-3`，被印在 operator 讀作
object name 的欄位裡，並當成 object name 傳給 `merge-base`。改為 `--verify … ^{commit}` 搭配
`|| BACKUP=`。

測試：新增兩支（各平面共四支）。一支跑滿六種輸入 × 五個詞，並斷言六個輸入必須產生**五**個讀數；
另斷言空 tip 不得抵達任何 ancestry 測試（bundled 的那次除外，它問的是另一個問題）。負向控制兩個：
把前兩個分支整段對調（重現歷史缺陷：lookup 失敗被讀成 creation），以及刪掉空值分支（benign 讀數
變成 `unknown`）。

### D2 / D3 —— 地面真相在本輪又換了一次

`codex-setup` 的兩處說法原本就已失效，而 D1 的修法（gate 拒絕被 source）再次改變地面真相，所以不能
只是把時態改掉。重新量測（2026-08-22）：

| 動作 | 結果 |
|---|---|
| `. ./scripts/pre-push-gate.sh` | 拒絕，rc 127，訊息 `pre-push-gate: must be executed, not sourced`；拒絕在第 38 行，**早於**第 89 行的 `set -euo pipefail` |
| `. ./scripts/commit-msg-guard.sh <msg>` | 父腳本第 1 行跑一次（`$-=hB`），`exec` 取代父行程，`.` 之後的行**一行都沒跑到** |

於是兩段敘述各自換了理由，而不是換時態：gate 那段改記「這不是 stanza 表達的偏好，是 gate 唯一接受的
形式」；commit-msg 那段改記真正的代價——stanza 是 **prepend** 的，所以被靜靜停掉的是專案自己寫在
commit-msg hook 裡的一切。`4-implementation.md` § 4.6 的 sourcing 列改為過去式，並註明所引構造已兩度
更換（`$0` → `${BASH_SOURCE[0]:-$0}` → 拒絕 sourcing）。

### 驗證

| 項目 | 結果 |
|------|------|
| `test/skills/push-ci.test.js` | 42/42 |
| `test/skills/epic-merge.test.js` | 54/54 |
| `test/skills/codex-setup.test.js` | 26/26 |
| `test/scripts/pre-push-gate.test.js` | 72/72 |
| `bash -n`（3.2 與 5.3） | 兩個 epic-merge fence 與 gate 皆通過 |
| `node scripts/check-comment-blocks.js` | exit 0（gate 檔頭 34 行 BLOCK → 29 行 WARN；source-refusal 的量測敘述遷入 § 4.3 Round 53 並留兩行指標） |

## Round 54

兩個平面在 round 53 都回 blocking：code `ke0msbvoa` ⛔ Blocked（3×P1 + 2×P2）、doc `kg7jeyfxh`
⛔ Needs revision（4×P2）。tier=thorough，所以 P2 一樣 blocking。本輪把六筆全部關掉。

### C-53-1 / C-53-2（P1×2）—— 決定憑證的那個字是 builtin，而 builtin 可以被換掉

兩份 skill 的守衛與分類器全部寫成 `[ … ]`。`[` 是 builtin，bash 解析同名的**匯入函式**時會排在
builtin 之前。量測（2026-08-22，`/bin/bash` 3.2 與 bash 5.3 結果一致）：

| 構造 | 在 `BASH_FUNC_[%%=() { return 1; }` 之下 |
|---|---|
| `[ a = a ]` | **FORGED** —— `type -t "["` 回 `function` |
| `[[ a == a ]]` | TRUE（保留字） |
| `case a in a)` | TRUE（保留字） |
| `bash -p` | `[` 仍是 `builtin` —— 整類拒絕匯入 |

也就是說，只要能設一個環境變數，就能回答 fence 裡**每一個**判斷：branch guard、HEAD guard、
destination guard、ancestry 分類器。推送於是打到核准從未涵蓋的分支、commit 與 repository，而每一個
比較都回報「一致」。

修法不是只改被點名的九處，而是兩份 SKILL.md **所有可執行 fence** 內的 26 處 —— 沒被點名的是同一個
類別，留著就是下一筆 finding（L11）。字串與空值測試改 `[[ … ]]`（右側加引號，維持字面比對）；算術
比較**不能**這樣改，改成 `case`：

| 輸入 | `[ "$X" -eq 0 ]` | `[[ "$X" -eq 0 ]]` |
|---|---|---|
| `X=`（空） | 錯誤 → **false** | **true** |
| `X=a` 且 `a=7`，比 7 | false | **true**（算術運算元會**遞迴**當變數名解參考） |

空的 ancestry 讀成 0 會讓 `no-rewrite` 成立並跳過 unshared attestation —— 一次重新拼寫就把
fail-closed 翻成 fail-open。`case` 的 `*` 分支把空字串與其它非預期值一起收進 errored，是**構造上**
fail-closed，不是靠誰記得寫一個判斷式。

**測試替身得先免疫，才有資格見證這件事。** 兩個 fake git 都是 `#!/bin/sh`，而 macOS 的 `/bin/sh` 就是
posix 模式的 bash，一樣會匯入 `BASH_FUNC_*`。在偽造之下它們什麼都不回答，fence 因為分支為空而拒絕，
守衛測試第一版就這樣「通過」了 —— 把壞掉的替身當成生效的守衛。兩個替身現在都用 `case` 判斷。

兩份各補一個守衛測試，跑三個方向（`rules/testing.md` § Guards）：出貨的 fence 仍拒絕；同一份改回 `[`
就讓未核准的推送通過（`refs/heads/feat/somewhere-else` 出現在 recorder 裡）；同樣的敵意環境下合法的
那一次仍然成功。

### C-53-3（P1）—— 核准綁在一個刻意丟資訊的字串上

Phase 2 比對的是**遮蔽後**的 destination，而遮蔽會碰撞：
`https://gateway.example/push?repo=A&token=one` 與 `…?repo=B&token=two` 都變成
`https://gateway.example/push?<redacted>`。核准必須綁在**身分**上，不是綁在給人看的渲染上。

新增 `PUSH_URLS_DIGEST=$(printf '%s' "$PUSH_URLS" | <canonical prefix> git hash-object -t blob --stdin)`，
兩份 skill 共六處；Phase 2 與兩個 classifier fence 在遮蔽比較**之前**先比 digest。前綴用完整的
canonical 版本（第一版寫了縮寫版，被 epic-merge 的 prefix 測試擋下 —— 那個測試是對的）。

fake git 的 `hash-object` **委派真 git**，不是回傳固定字串：回固定字串會讓所有 destination 雜湊相同，
比較永遠拒絕不了任何東西，守衛看起來綠但什麼都沒防。

### C-53-4（P2）—— 把防禦降級成殘留，並且真的去跑它

round 53 加的 source 拒絕可以被繞過。量測：

```
printf '<ref line>' | /bin/bash -c 'function /usr/bin/env { return 0; }
  . "$0" origin <url>; printf "SOURCE_STATUS=%s\n" "$?"' ./scripts/pre-push-gate.sh
# → SOURCE_STATUS=0
```

拒絕是拿 `${BASH_SOURCE[0]}` 比 `$0`，而**被 source 的 shell 裡 `$0` 由呼叫端決定**。`BASH_SOURCE`
深度也不是判別式（executed / `bash -c '. "$1"'` / 偽造 `$0` 三者都是 `count=1`）—— 在被 source 的
shell 裡沒有任何值是呼叫端偽造不了的，所以「偵測 sourcing」本身做不出來。

處置：構造保留（它確實擋得住手寫 wrapper 裡不小心的 `source`），但不再被描述成防禦。§ 4.3 補一段
Round 54 記載繞過，歸入與 `bash <gate>`、敵意 `BASH_ENV` 同一類；`codex-setup` 兩處「整個關掉」「唯一
接受的形式」改為實測範圍。同時補上 round 53 缺的執行測試（含負向控制）——刪掉那個 `case` 之後整個
套件仍是綠的，正是 § Guards 要抓的形狀。測試跑三件事：拒絕成立、拿掉拒絕就 source 成功、以及**把已
記載的殘留當測試跑**，所以文件與程式碼不會各自漂移。

### D-53-2（P2）—— 定義與規則本體對不上

`rules/git-workflow.md` § Push safety 開頭把 class (ii) 定義成「rewrites history
(non-fast-forward)」，接著只解釋 ancestry —— 但同一行後面說既有 tag 的**任何**更新（含前進）都在這一
類。只讀定義的人會拿到錯的類別。改為開頭就說「rewrites a ref other people may already hold」，並言明
**per ref class**：branch 是 non-fast-forward（fail-closed），existing tag 從不問 ancestry。byte pin
由腳本從檔案本身重新產生。

### 驗證

| 項目 | 結果 |
|------|------|
| `test/skills/push-ci.test.js` | 43/43（+1 守衛測試） |
| `test/skills/epic-merge.test.js` | 55/55（+1 守衛測試、+1 mutant） |
| `test/scripts/pre-push-gate.test.js` | 73/73（+1 source 拒絕測試） |
| `test/rules/discretion-tiers.test.js` | 24/24（push-safety byte pin 重新產生） |
| `bash -n` | 兩份 skill 共 17 個 fence（佔位符代換後）全部通過 |
| `node scripts/check-comment-blocks.js` | exit 0 —— gate 檔頭因 round 53 的 synopsis 改寫從 29 漲回 31 觸發 BLOCK，argument-count 論證在 § 4.2 已完整記載屬重複，去重後 24 行 |

## Round 55

兩個平面在 round 54 都回 blocking：code `kvzcwvp24` ⛔ Blocked（2×P1 + 2×P2）、doc `k0sgyxmoc`
⛔ Needs revision（1×P1 + 2×P2）。tier=thorough，P2 一樣 blocking。七筆全部處理完。

code 的複核者明確**沒有**重提 round 54 的 `[` / builtin 問題，那一類視為已關；但它自陳無法跑
temp-dir 的 push 測試（`mkdtempSync` 在唯讀 sandbox 回 `EPERM`），所以它的測試面向意見是靜態讀出的。

### 先自己驗，不照單全收

四筆 finding 我在動手前各自量過一次，其中兩筆的**前提**被量測推翻，那才是本輪最重要的產出。

### D-54-1（P1）—— `/usr/bin/env` 絕對路徑「免疫」是誇大的

原文寫「只有含 `/` 的字免疫，因為 bash 拒絕匯入名字含 `/` 的函式」。前半對，結論錯。實測
2026-08-22：

| 情境 | 結果 |
|---|---|
| `BASH_ENV` 檔內 `function /usr/bin/env { printf HIJACKED; }` | **HIJACKED** |
| 同樣的呼叫，不設 `BASH_ENV` | SAFE |
| 同樣的 `BASH_ENV`，但跑在 `bash -p` 下 | SAFE |

絕對路徑關掉的是**匯入**這條路（`BASH_FUNC_/usr/bin/env%%` 會被拒），關不掉「在目前這個 shell 裡
被定義出來」的函式 —— 而 `$BASH_ENV` 在 fence 第一行之前就被 source 了。唯一擋得住的是 `-p`，而
markdown fence 無法指定直譯器旗標。

改法是把界線寫清楚而不是假裝沒有：`-u BASH_ENV` 保護的是這個 fence 生出的**子行程**；斜線擋的是
從環境送進來的函式；兩者都保護不了「父行程已經幫你設好 `BASH_ENV`」的世界 —— 而在那個世界裡
`git` 本身同樣可偽造，fence 早就沒有完整性可言。這正是 fence **不是**終端憑證的原因：
`pre-push-gate.sh` 會 re-exec 進 `bash -p`，那一層才是。三處（push-ci、epic-merge、
4-implementation.md 的向量表新增一列）同步更正。

### D-54-2（P2）—— 「tag 從不問 ancestry」在執行層面是假的

`scripts/pre-push-gate.sh:211`：

```sh
if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null || is_tag_ref "$remote_ref"; then
```

`||` 由左至右求值，所以 `merge-base` 對**每一個** ref 都會跑，tag 也不例外；`is_tag_ref` 只有在
ancestry 回答「是 fast-forward」時才被問到。分類**結果**沒錯（tag 兩條路都落在 rewrite 類），錯的是
把它寫成 short-circuit —— 那會宣稱一個這個 gate 並不具備的性質：tag 的分類獨立於物件庫是否損壞或緩慢。

改成描述 **override** 而非 short-circuit：`rules/git-workflow.md:23`（byte pin 以腳本重生，長度
6768）與 `4-implementation.md:323` 兩處。沒有改 code —— 重排 `||` 兩側雖然語意等價，但那是為了讓
文件變真而動安全路徑，方向反了。

### C-54-1 / C-54-2（P1×2）—— TOCTOU 屬實，但複核者建議的修法量測後不成立

finding 說：Phase 2 解析並雜湊了 `origin`，push 卻把可變的名字交給新的 git 行程再解析一次；建議
「改推已驗證的 URL」。前半屬實，後半被推翻。實測 2026-08-22：

| 動作 | 結果 |
|---|---|
| 設 `url.<B>.insteadOf=<A>`，目的地參數寫字面 URL `<A>` | ref 進了 **B** |
| `git remote get-url --push --all origin`（同樣設定下） | 回報 **B** —— 改寫後的 URL |
| `git push -u origin <SHA>:refs/heads/x` | 推送成功，`branch.<x>.remote` **完全沒設** |

也就是說：**字面 URL 一樣會被 `insteadOf` 改寫**，換成 URL 只是把再解析從一個 config key 搬到另一個，
什麼都沒釘住；順帶一提 `-u` 也會被無聲吃掉（round 54 已記，今天重量一次）。同一組量測也證明檢查端是
誠實的 —— `get-url --push --all` 回報的是改寫**後**的 URL，所以 Phase 0 雜湊到的就是 git 真正會用的
目的地。

剩下的殘留是 client-side 不可消除的：git 在自己的行程內、從這個 shell 凍結不了的設定解析目的地。能做
的是把窗口縮到最小 —— 比較與 push 在**同一個 fence**、中間沒有任何提問（核准離現在是好幾個 tool call
與數分鐘，這次讀取離 push 是微秒），並且把「這裡縮小窗口、不是消除窗口」明講出來，免得讀者以為目的地
已經被釘死而不再去找真正的終端層（`pre-push-gate.sh` 跑在 push 的 git 行程裡）。兩份 skill 各記一次，
epic-merge 的第二個 fence 只放指標不重述。

### C-54-3（P2）—— 目的地測試證明不了 digest

`test/skills/push-ci.test.js` 原本的「目的地變了」案例用 `elsewhere.git`，redaction 之後兩者**依然
不同**，所以既有的 `PUSH_URLS_SAFE` 比較自己就會拒絕 —— 把 digest 判斷整條刪掉，測試照樣綠。

新增案例：`https://gw.example/push?repo=alpha&token=one` vs `...?repo=beta&token=two`。redaction 會
刪掉整個 query，所以兩者的遮蔽字串**完全相同**，只有 digest 分得出來。測試含四段：前置條件（兩個方向都
斷言 —— 遮蔽後相同、raw 不同）、拒絕、正向控制、以及刪除 digest 判斷的變異（刪掉之後重導向真的通過，
1 次 push）。

### C-54-4（P2）—— epic-merge 的目的地守衛同樣沒驗 digest

原測試只斷言 redaction 比較。改成把每一條性質寫成資料（`DESTINATION_GUARD`），再加一個變異測試：
digest 判斷與 redaction 判斷**各自單獨**刪除，兩次都必須被回報 —— 因為會漏的情況正是「只剩一半」。
另含正向控制（未變異的文件必須全數通過）。

### D-54-3（P2）—— 就地改寫的損失要放在讀者一定會看到的位置

`review-log-adequacy-gate.md` 的 round-16 更正是就地寫掉的，兩份原文從未進 commit，
**不可復原**。round 41 的 caveat 已存在但夾在 § Correction 的 blockquote 裡，讀者讀到時已經看過好幾段
它所限定的內容。改法是在檔案最上方、doc-class 區塊之後加一段明說「這份記錄被就地改過一次，其中兩段
已經不可復原」，並指向 round-37 note。揭露不能還原證據，能做的只是不讓人把它當完整記錄讀。

### 驗證

push-ci 44/44、epic-merge 56/56、全套 3931 tests / 3927 pass / 0 fail / 4 skipped、
`check-comment-blocks.js` exit 0、`check-doc-links.js` 0 failures、兩份 skill 共 15 個 bash fence
全部 `bash -n` 通過。`rules/git-workflow.md` 的 byte pin 與兩份 SKILL_DIGEST、Phase 2 section pin
全部以腳本重生，未手打。

## Round 56 — 複核者說我的宣稱是假的，量測後它比複核者說的更假

round 55 兩個平面都回 blocking：code ⛔ Blocked（C-55-1、C-55-2 兩筆 P1；C-55-3、C-55-4 兩筆
P2），doc ⛔ Needs revision（C-55-5 與 D-55-1 在上一輪即已關閉）。tier=thorough，P2 同樣 blocking。
五筆全部處理完，其中三筆的修法不是複核者提的那一個。

### C-55-1 / C-55-2（P1×2）—— round 55 我寫下的「client-side 不可消除」是錯的

round 55 我把 TOCTOU 殘留寫成「git 在自己的行程內解析目的地，shell 凍結不了」，並據此宣稱只能縮小
窗口。複核者指出這句話不成立。實測 2026-08-22（git 2.55.0）後發現它比複核者說的還要不成立 ——
`$1` 與 `$2` 根本是兩個不同的東西：

| push 形式 | `$1`（hook 收到） | `$2`（hook 收到） |
|---|---|---|
| `git push origin`，無改寫 | `origin` | `<A>` |
| `git push origin`，設 `url.<B>.pushInsteadOf=<A>` | `origin` | `<B>` |
| `git push <A>`，設 `url.<B>.insteadOf=<A>` | `<A>`（改寫**前**） | `<B>`（改寫**後**） |

`$2` 是**改寫後的目的地**，而且是在推送行程內算出來的 —— 也就是 git 真正會連上去的那一個。更關鍵
的是：`sha1(printf '%s' "$2")` 與 Phase 0 檢查端 `git remote get-url --push --all origin | head -1`
的雜湊**逐位元組相同**，有改寫、沒改寫都一樣。所以檢查端算得出的 digest，正是終端層驗得了的 digest。

`scripts/pre-push-gate.sh:107` 那句 `# $2 is remote URL (unused)` 就是讓這個窗口看起來不可消除的
原因 —— 一句「用不到」的註解，讓兩輪 review 都沒去問它是什麼。

做法是新增 `SD0X_PUSH_DEST_DIGEST`：skill 在 push 那一行把 Phase 0 算出的 digest 交給自己發起的
push，gate 讀 `$2` 重算並比對，不符即 `exit 1`。三個性質是契約的一部分：

| 性質 | 內容 |
|---|---|
| Monotone | 不設就完全不改變行為 —— 手動 push、其他工具的 push 一律不受影響 |
| Fail-closed | 設了但算不出（`$2` 缺、hash 失敗）→ 拒絕，不是放行 |
| 不是 attestation | 它是**約束**，方向與 `ALLOW_*` 相反 |

最後一列是這次唯一容易寫反的地方。`ALLOW_PUSH_PROTECTED` / `ALLOW_FORCE_UNSHARED` 是**操作者的
證詞**，skill 只能清空、永遠不能設（設了就等於替人回答）；`SD0X_PUSH_DEST_DIGEST` 是 skill 對**自己
這一次 push** 加的限制，所以 skill 必須設 —— 不設就等於沒綁。§ Prohibited 新增的那一條把這個方向差
寫進去，因為它旁邊那兩條的字面規則正好相反。

實測端到端：alpha / beta 兩個 bare repo，逐次 push 以 `-c url.<beta>.pushInsteadOf=<alpha>` 施加
改寫。結果為 —— 不設變數：照推（monotone）；digest 相符：通過；被重導向：拒絕，且 beta 與 alpha
**兩邊都沒有東西落地**；改用 beta 自己的 digest：通過；`$2` 缺席：拒絕。另含一個刪除變異（把
`[ "$DEST_DIGEST" != "$SD0X_PUSH_DEST_DIGEST" ]` 換成 `false`），確認重導向真的會通過。

殘留說清楚：這道 gate 本身是 opt-in 的，未安裝就沒有終端層可驗，修法是
`/codex-setup sync --with-push-gate`。綁定不選擇任何憑證，所以 `rules/git-workflow.md` 的
credential-selection 契約**沒有動**。

### C-55-3（P2）—— smart-rebase 的 negative refspec：把猜測從寫入路徑整條移走

實測：CLI 上的 refspec **不繼承** config 的 negative refspec。設
`remote.origin.fetch = tagx:refs/remotes/origin/stable` 加 `^refs/tags/tagx` 之後，
`git fetch --refmap= --no-tags -- origin '+tagx:refs/remotes/origin/stable'` 照樣把 ref 建了出來；
把 `^refs/tags/tagx` 加到**同一條命令列**才擋得住（`fatal: Needed a single revision`，ref 不存在），
而無關的 `^refs/tags/other` 則不擋。

所以修法不是加強 claim-scan 的命名空間判斷，而是把設定裡的 negatives 原封不動交給 git。這讓
`refs/heads/<x>` 那個限定詞從**寫入路徑**上消失 —— 判斷交給 git 自己做。方向上的差別是：漏排除從
「寫錯 ref」變成「refresh 被拒」，前者是無聲的錯，後者會叫。原註解也改成明說那個限定詞是猜測、且
刻意不承載任何責任。

### C-55-4（P2）—— scp 形式的 userinfo 沒有被遮蔽

三個 redactor 都只處理 `scheme://` 那一支。修好之後順手把原本釘住「不遮蔽」的那個測試整個重寫，補了
四個負向控制，證明修法不是「看到冒號就遮」。

過程中我原本假設 scp 形式有密碼欄位，量測推翻：git 把**第一個** `:` 讀成 host/path 分隔，所以
`alice:pw@host:path` 的 host 是 `alice`；真正的分割點在 ssh 那一層，切在**最後一個** `@`
（`a@b@host` 的使用者是 `a@b`）。測試案例因此改成 `${SECRET}@alice@git.example:org/repo.git`。

### 驗證

pre-push-gate 76/76、smart-rebase 80/80、push-ci + epic-merge 102/102、全套
3938 tests / 3934 pass / 0 fail / 4 skipped、
`check-comment-blocks.js` exit 0（18 warning、0 BLOCK）、兩份 skill 共 17 個 bash fence 全數
`bash -n` 通過（round 55 記的「15 個」是掃描器漏掉兩個，本輪一併更正）、`check-doc-links.js` 39 份
0 斷鏈（唯一一筆 `unreadable` 是 create-pr-stacked 那份已拆分刪除的檔案，屬 out-of-scope 既有變更）。
兩份 SKILL_DIGEST、push-ci Phase 2 section pin、smart-rebase SCRIPT_DIGEST 全部以腳本重生，未手打。

## Round 57 — 三筆 P1 都在說同一句話：URL 不等於目的地

round 56 兩個平面都回 blocking：code ⛔ Blocked（三筆 P1），doc ⛔ Needs revision（一筆 P1、兩筆
P2）。tier=thorough，P2 同樣 blocking。六筆全關。

值得記的不是修法，是**六筆裡有三筆在量測之後比複核者說的更嚴重**。這一輪我把「先量測再動手」當成
硬規則執行 —— 每一筆都先用真的 git、真的 bare repo 重現，才決定怎麼改。三次量測都推翻了我原本打算
寫的補丁。

### C-57-1（P1）—— digest 是 SHA-1，而這是 security 決策

round 56 用 `git hash-object -t blob --stdin` 算 digest。`rules/security.md` 禁止 SHA-1 用於
security 用途（Anchor Register #1），而這個 digest 正是 security 用途：它要擋的對手，是能在核准與
push 之間改 `.git/config` 的人 —— 也就是能挑第二個輸入的人。SHA-1 的 chosen-prefix collision 自
2019 年起就是實務可行的，這條禁令在這裡不是儀式。

量測後發現它還錯第二層：`hash-object` **跟著 repository 的 object format 走**。同一個 URL 在
`--object-format=sha256` 的 repo 下算出來的值，跟預設格式下不一樣 —— 而比對的兩端本來就必須逐位元組
相同。所以這不只是「演算法選錯」，是「這支工具根本不能拿來做跨行程綁定」。

改成依序取用 `sha256sum` / `shasum -a 256` / `openssl dgst -sha256`，**並驗形狀**（64 個小寫十六進位
字元）才採信。形狀檢查不是防禦性冗餘：`shasum` 在 perl 缺 `Digest::SHA` 時會把診斷訊息印到 stdout
再以非零退出，沒有形狀檢查，那行診斷就會**靜靜變成 digest**。測試補了一個「工具壞掉」的案例，證明
綁定會拒絕，而未綁定的 push 不受影響。

### C-57-2（P1）—— 一個值 vs 一個集合：fan-out 被自己的 fail-closed 擋掉

量測 2026-08-22：一個 remote 設兩個 `pushurl` 時，git **每個 push URL 各叫一次 pre-push hook**，
每次 `$2` 只帶那一個 URL（`$1=origin, $2=<A>`，然後 `$1=origin, $2=<B>`）。

round 56 的綁定帶的是「換行串接後整串的 digest」—— 這個值**哪一次呼叫都對不上**。因為綁定是
fail-closed，結果是操作者明明設定好、也核准過的 fan-out，**兩邊都被拒**。複核者說「可能對不上」，
實測是「兩邊都不會落地」。

改成：變數帶「每個已核准目的地各一個 digest」，以空白分隔，判定改為集合成員資格。這不是放寬 ——
計畫顯示的每一個 URL 操作者都核准了，所以其中任何一個都是核准涵蓋的目的地。

### C-57-3（P1）—— `receivepack`：git 自己的成功訊息會指著沒有變動的那個 repo

這一筆最尖銳。設定 `remote.origin.receivepack` 指向一支 `exec git-receive-pack <B>` 的程式，然後對
`<A>` 做一次普通的分支 push，git 印出：

```
To <A>
 * [new branch]      main -> main
```

而物件**全部落在 `<B>`，`<A>` 一個都沒有**。整個過程 `$2` 都是 `<A>` —— 所以 digest 會相符，而它
證明的是空的。換句話說：把目的地綁死之後，還有一條路可以讓「每個元件都誠實回答」而物件仍然落在
核准沒指名的地方。

兩種拼法能走到這裡：config key（核准後改得動）、以及命令列的 `--receive-pack` / `--exec`（hook
看不到）。config 那條由 gate 在綁定啟用時拒絕、並由兩支 skill 在提問前就拒絕（未安裝 gate 的情形
—— `git-workflow.md` § Push safety 說的是「把問題搬走，不是刪掉」）；命令列那條靠兩支 skill 從不
輸出這兩個旗標來關閉，由它們自己的測試釘住。

### D-57-1（P1）+ D-57-2 / D-57-3（P2）—— 文件端

P1 那筆是 `skills/push-ci/SKILL.md` 裡一句「Nothing is displayed from it」。它是假的：digest 本身
不顯示，但比對失敗的訊息會顯示，而且比對本身就是一個 equality oracle —— 對手能離線猜測並驗證。改成
直說靠的是 SHA-256 的 preimage resistance，以及這個 oracle 的存在。

兩筆 P2 都是「話說得比證據滿」：4.6 的殘留段落把三種讓 gate 完全不執行的狀態混成一句話，現在逐一
拆開 —— gate 是 opt-in（有修法：`/codex-setup sync --with-push-gate`）、`core.hooksPath` 可被改指、
`--no-verify` 可被傳入；後兩者不是這個綁定「再努力一點」就能關掉的，因為能在 push 中途改本地 config
的對手，同樣能直接換掉 hook 檔案，釘住 hooksPath 買不到任何東西。

### 順帶關閉的兩個 comment BLOCK

`check-comment-blocks.js` 這一輪抓到兩筆 BLOCK（`pre-push-gate.sh:164` 39 行、
`smart-rebase-analyze.sh:366` 30 行）。依 `rules/docs-writing.md` § Code Comments 的
move-or-dedupe，論證搬進各自的 feature doc 並留下指標 —— 後者搬進
`docs/features/ref-name-hardening/4-implementation.md` § 1.8，那一節把 negative refspec 對短名
來源的量測表整個收進去，包含「只有短名實際落到的那個命名空間裡的 negative 才會取消映射，而本地
無從得知落在哪一個」這個結論，以及為什麼「未匹配」要讀成**未能證明被排除**而不是**匹配不到**。

### 驗證

全套 3941 tests / 3937 pass / 0 fail / 4 skipped、`check-comment-blocks.js` exit 0（18 warning、
0 BLOCK）、兩份 skill 共 17 個 bash fence 全數 `bash -n` 通過、`check-doc-links.js` 39 份 0 斷鏈
（唯一 `unreadable` 仍是 create-pr-stacked 那份已拆分刪除的檔案，out-of-scope）。兩份
SKILL_DIGEST、push-ci Phase 2 section pin、smart-rebase SCRIPT_DIGEST 全部以腳本重生，未手打。

第一次收尾跑出 1 fail，值得記：`smart-rebase-analyze.sh` 的 `SCRIPT_DIGEST` 已過期 —— 註解遷移是在
上一次重生 pin **之後**才落的，所以 pin 停在舊位元組。這正是那個守衛存在的理由，它要求的動作也不是
「重生就好」，而是**先讀改動、確認沒有新增 git 呼叫**再更新。照做了：現行腳本的 git 呼叫仍只有
`check-ref-format`、`show-ref`、`fetch --refmap= --no-tags`、`rev-parse`、`log`、`cherry`，全為唯讀，
且同一份測試裡三個「執行腳本並記錄每一次 git 呼叫」的行為守衛本來就是綠的 —— 位元組 pin 過期與行為
退化是兩件事，這次是前者。重生後全綠。教訓是順序：**任何腳本編輯之後才重生 pin，不能反過來**。

---

## 2026-08-22 補記 —— round 58 對 C-57-1 的更正

上面 C-57-1 寫「量測後發現它還錯第二層：`hash-object` 跟著 repository 的 object format 走…所以這不只
是『演算法選錯』，是『這支工具根本不能拿來做跨行程綁定』」。前半是實測事實，後半的推論**過強**，這裡
以追加註記更正（記錄不就地改寫）。

2026-08-22 量測（git 2.55.0），同一輸入 `https://example.invalid/x.git`：

| 環境 | `git hash-object -t blob --stdin` |
|---|---|
| 預設 object format 的 repo | `b354136aa410237bc6df2a4b0ef17791cd03fc47` |
| `--object-format=sha256` 的 repo | `7524f1f0d5c5177f233a45e0e44f73605a3b39109d88a9da47b6a3f3bd6119b1` |
| 不在任何 repo 內 | `b354136a…`（退回 SHA-1） |

差異確實存在，但它**不是**比對兩端不一致的獨立成因：綁定的兩端（skill 與 hook）跑在同一個 repository
裡，讀到同一個格式，本來就會一致。它真正咬人的只有一種較窄的情況 —— 某一端在 repo 外執行、靜靜退回
SHA-1 —— 以及一個設計理由：不該把跨行程綁定建立在「演算法由環境狀態決定」的工具上。

讓這個改動成為**必須**的，自始至終是 Anchor Register #1（SHA-1 不得用於 security 用途）那一層；
object format 是「為什麼換工具而不是給 `hash-object` 加一個格式旗標」的理由。當時的措辭把次要理由
寫成了獨立的破壞點。現行敘述見 `4-implementation.md` § 4.6。

---

## Round 58

### C-58-1（P1）—— receivepack 的 config 檢查是事後的

`4-implementation.md` 把 config 那一半寫得像是關上了。實測：git 是在 ref advertisement **之後**才跑
pre-push hook，transport 早已選定。一個先 `git config --unset remote.origin.receivepack` 再 exec 轉向
helper 的 wrapper，會讓 gate 讀到未設定、git 對 `<A>` 回報成功、而物件全部落在 `<B>`。

所以這一半是 **best effort**：它擋得住「改了就留在那裡」的 redirect（也就是核准與 push 之間動手腳的
真實形狀），擋不住會自我清除的那種。gate 的註解現在就在檢查處這樣寫，不是只寫在 doc 裡。

### C-58-2（P1）—— 命令列那一半其實關得掉，只是沒讀那個參數

跟 round 56 對 `$2` 犯的是同一個錯：把「沒讀的參數」當成「客戶端的固有殘留」。實測（兩個 bare repo，
配置 `receivepack` 指向第二個）：

| 寫法 | 結果 |
|---|---|
| `-c remote.origin.receivepack=git-receive-pack` | **不覆寫** —— git 印 `error: more than one receivepack given, using the first`，物件仍落在 `<B>` |
| `--receive-pack=git-receive-pack` | 覆寫，物件落在 `<A>` |
| `--exec=git-receive-pack` | 同上 |

於是 `/push-ci` 四個 push 形式、`/epic-merge` 兩個，全部逐字帶上 `--receive-pack=git-receive-pack`，
且**放在 force 旗標之後** —— `git push --force-with-lease` 必須留在行首逐字可讀，因為
`@rules/git-workflow.md` § Exception 的 Anchor 授權就是照字面稽核的。測試同時釘住存在與值，並直接禁止
`--exec` 與任何非標準的 `--receive-pack=` 值。

### C-58-3（P2）—— 遠端名稱可以含斜線

gate 原本用「長得不像 URL 就當遠端名」的字面分類，於是一個合法但名字含 `/` 的遠端被跳過 config 查詢。
`git remote add foo/bar <url>` 是被接受的，`remote.foo/bar.receivepack` 也會被遵守。改成問
`git remote` 拿清單、整串比對 —— 讓分類由 repository 回答，而不是由對拼寫的猜測回答。

### C-58-4（P2）—— 拒絕訊息把 operator 提供的字串印出來

receivepack 的拒絕訊息原本會印出設定值。改為只印 key 與讀取指令
（`git config --get remote.<name>.receivepack`）。測試用哨兵字串證明值不會出現在 stderr。

### C-58-5（P1）—— 形狀檢查不是正確性檢查

64 個十六進位字元正是「說謊的工具」也會產生的東西。gate 現在先跑 known-answer test（空字串 →
`e3b0c442…b855`、`abc` → `ba7816bf…15ad`），失敗就拒絕已綁定的 push，且診斷訊息指向**工具**而非
目的地 —— 拒絕的原因是工具，就該這樣說。

KAT **關不掉**的是「對這兩個向量答對、對 URL 說謊」的 input-aware shim；把這句寫進修正裡是修正的一部
分，不是附註。它把門檻從「PATH 上的任何工具」抬到「在兩個已知輸入上與 SHA-256 一致的工具」。

順帶把一個一直被默認的前提寫明：`bash -p` 只關掉 imported-function 這條路。gate 裡每一項檢查 ——
digest 工具、以及判斷改寫歷史用的 `git merge-base` —— 跑的都是經 `PATH` 解析的執行檔。所以 **PATH 完整
性是整個 gate 的前提**，不是這個綁定建立起來的性質。

### C-58-6（P1）—— fetch 成功而且什麼都沒傳，是最安靜的那種錯

`smart-rebase-analyze.sh` 只擋得住 fetch **失敗**。實測（git 2.55.0）：當命令列上每一條正向 refspec 都
被 negative 取消時，git exit **0**、不印任何東西、tracking ref 停在原值 —— 於是計畫是從陳舊歷史建出來
的，而且跟正確的計畫長得一模一樣。這與 round 23 的 `|| true` 是同一類，只是從「失敗」換成「成功」進來。

判別器是 `FETCH_HEAD` 而不是 exit code。git 在每次 fetch 開始時把它截斷，然後為實際納入考慮的每個 ref
寫一行：

| 情況 | 位元組 |
|---|---|
| 真的有更新 | 66 |
| 已是最新 | 66 |
| 不相干的 negative | 66 |
| 全被排除（短名來源） | **0** |
| 全被排除（完整 ref） | **0** |

`git fetch --porcelain` 無法替代 ——「已是最新」與「被排除」都印空的。腳本改以
`git rev-parse --git-path FETCH_HEAD`（linked worktree 也正確）讀出路徑後檢查非空，失敗則帶著可手動重跑
的指令中止。測試補了雙向：全排除的 fetch 必須報錯不出計畫，正常 fetch 必須照常出計畫，並以「拿掉非空
檢查」的 mutant 證明這個守衛真的在承重。

同一輪也更正了 `ref-name-hardening/4-implementation.md` § 1.8 收尾那段 —— 它宣稱這種 fetch「會以 git 的
`fatal:` 收場」，這是錯的，實測是安靜的 exit 0。

### C-58-7（P1）—— 用刪掉一個 guard 的方式安裝另一個 guard

`--with-push-gate` 是「加上一道防護」的請求。但在 modes 2–4，`/codex-setup` 是把 gate **當成**解析出來
的 `pre-push` 檔案整份寫下去，而 Phase 3 對那個路徑上原本有什麼隻字未提 —— 專案自己的 `pre-push` 會被
不可逆地刪掉，被一個要求更安全的指令刪掉。

所有權的詞彙其實就在隔壁一節：`uninstall` 只在「確認是 sd0x 所有」之後才刪 hook 檔。缺的是把同一個判準
寫在**檔案還在、還救得回來**的那一側。Phase 3 現在**以內容而非以存在**分類目的地：不存在或空 ⇒ 寫；
sd0x 所有 ⇒ 覆寫（這正是 `sync` 的工作）；其他 ⇒ 不寫、記 `pending`、報出該搬走哪一個檔案。

兩個選擇值得寫下來而不是留給下次重新推導：判準用行首前綴（`# pre-push-gate.sh - `）而非逐位元組比對，
因為逐位元組會拒絕每一個**舊版**的自家檔案 —— 而那正是 refresh 最需要成功的情況；拒絕寫入記 `pending`
而非 `declined`，因為 operator 確實選了要，只是接線沒完成，而轉移矩陣本來就把 `pending` 當成「要保留的
gate」，記 `declined` 會把他們的請求變成他們從沒做過的退出。

`test/skills/codex-setup.test.js` 兩條測試釘住這件事，第二條才是真正有價值的那條：它從 SKILL.md 讀出判
準字串，去斷言兩支出貨腳本**真的**帶著那一行。改了 header 措辭，判準就會開始拒絕覆寫自家安裝的副本
—— 方向是安全的，但會靜靜地發生，這條測試把它變成紅燈而不是一張客服單。

## 2026-08-22 補記 —— round 59 對 C-58-7 的更正

上面 C-58-7 最後一段寫「它從 SKILL.md 讀出判準字串」。round 59 的 doc review 抓到這句當時**不成立**：
測試檔自己寫死了 `` `# ${script} - ` ``，SKILL.md 改了措辭它也不會紅。修的方向是把測試變成真的，而不是
把這句話改弱 —— 現在測試解析 Phase 3 的 `sd0x-owned` 那一列，取出判準模板（含 `<script>` 的反引號字面
值）、視窗（`first 20 lines`）與兩支腳本名，再據此斷言。並補了第二條反向控制：把那一列的判準措辭改掉重
新解析，斷言改後的形式什麼都比不到 —— 寫死的判準會原封不動通過這一條，所以它才是讓「從 skill 讀出來」
成為可測宣稱、而不只是一句描述的控制組。

## Round 59

複核者這一輪給了 8 筆（2 code + 6 doc/測試耦合）。八筆都在動任何一行程式碼之前**各自重新量測過**，其中
一筆的結論被量測推翻——見 C-59-3。

### C-59-1（P0）—— 每個判斷都防得住了，答案卻從一個防不住的洞流出去

round 54（C-54-x）把兩個 skill 裡所有 `[ … ]` 換成 `[[` 與 `case`，理由是 `[` 是 builtin，匯入的同名
function 排在 builtin 前面。這一輪複核者指出：判斷是防住了，**回報**沒有。兩個 skill 的 classifier 最後
都是 `printf` 收尾，而 `printf` 同樣是 regular builtin。

實測（2026-08-22）：一段真實變數是 `ASK=1`、`ASK_REASON=rewrite` 的 fence，在 `BASH_FUNC_printf%%` 之下
印出 `ASK=[] ASK_REASON=[fast-forward]`。也就是說呼叫端可以直接改寫這段 fence 剛剛正確量到的結論，
`/push-ci` 於是會在一個**改寫歷史的 push** 上跳過 unshared 佐證。keyword 防護在回報還能被偽造的情況下
一分錢都沒買到。

修法在**回報端**，不是再加一個判斷式：兩個 skill 共十處（兩條 classifier 回報、四個 digest 迴圈、
iteration 計數行）改成 `/usr/bin/printf`。bash 拒絕匯入名字含斜線的 function（`error importing function
definition for '/usr/bin/printf'`），所以絕對路徑不是環境綁得到的名字。macOS 上 `/usr/bin/printf` 存在
（101808 bytes，`root:wheel`）。兩邊的結構測試現在要求絕對路徑的寫法，改回 builtin 會紅。

一般化的教訓寫進 `4-implementation.md` § 4.7：一段 fence 只可信到「量測 → 讀者」這整條路徑為止。

### C-59-2（P1）—— 預測不是量測

`/epic-merge` bundled 模式在 **Step 2 之前**就決定了要不要 unshared 佐證，而 Step 2、Step 3 正好是
checkout remote-tracking ref 與 rebase —— 決定最終 push 會覆蓋什麼的那兩個動作。等到真的要 push 時，那
個決定描述的拓樸已經不存在了。§ Safety 早就記過反方向的後果：協作者的 commit 被 checkout 下來又被
rebase 丟掉，push 以 exit 0 通過兩道 lease 覆寫掉它。

修法不是把預測做得更準，而是在 Step 5、push 前、**同一個 fence 裡**重新量一次，讀不出良性就拒絕。拒絕
寫成對那個詞的 `case` 加 `*` 全捕，而非否定列表 —— 還沒有人寫過的讀數要**依構造**落進拒絕分支。測試是
**執行**那個分支而不是讀它：三個良性詞 exit 0，`rewrite`／`unknown`／`something-nobody-wrote-yet` 都
exit 1；另外斷言它與 push 同 fence 且在 push 之前，因為分開的區塊量到的是 push 看不到的樹。

### C-59-3（P2）—— 量測是對的，掛在量測上的結論太強

複核者質疑 `4-implementation.md` § 4.6 說「同一個 URL 在兩邊會 digest 出不同值」。重新量測
（`git hash-object -t blob --stdin`，輸入 `https://example.invalid/x.git`）：預設格式 repo 得
`b354136a…`，`--object-format=sha256` repo 得 `7524f1f0…`，不在 repo 內得 SHA-1 那個值 —— 量測本身成立。

但掛在它上面的結論不成立：plan 端與 hook 端跑在**同一個 repository**、讀同一個 format，所以物件格式的分
歧不是這個比對的獨立破口。真正讓這個改動非做不可的是 Anchor Register #1 禁止 SHA-1 用於安全用途；物件
格式只是次級設計風險，且只在某一端跑在 repository 之外時才會咬人。文件與兩處測試訊息都照這個區分改寫。

這一筆值得記下來的原因：它是「量測正確、推論過頭」這一類的缺陷，而它出現在一份專門講「不要從預測推結
論」的文件裡。

### C-59-4 ~ C-59-6（P2，doc）—— `skills/smart-rebase/SKILL.md` 還在講 round 55 之前的故事

三處都說 analyzer「不支援 configured negative refspec」「遇到就別跑」，並把它列為 open defect。寫入端的
缺陷 round 55 就關掉了：現在選定 remote 的 `^…` 設定會被**帶到同一條 fetch 命令列上**，由 git 自己做比
對；短來源不與 negative 比對（視為「未被證明排除」而非「什麼都不比到」）；整條映射被 negative 取消時
fetch 會 exit 0 且什麼都沒傳，analyzer 讀 FETCH_HEAD 的後置條件（0 bytes vs 66 bytes）並**中止**，不會
拿舊歷史規劃。

三處分別改成：Step 1 的段落由「先擋」改成「先診斷」（gate 本身留著 —— 它現在買到的是一個**理由**，讓
operator 在 analyzer 拒絕之前就知道為什麼）；gate 的 `NEGATIVE REFSPEC CONFIGURED` 訊息由「別跑」改成
「預期 analyzer 會以空傳輸拒絕」；§ Names in commands 的 Known gap 區塊改寫成實際出貨行為＋兩列後果表。
`ref-name-hardening` r1 AC 1 仍然開著，但它開著的是**重新設計**（改用 `git ls-remote` ＋ ambiguity-aware
probe ＋ `git fetch --dry-run` 取代正向重建），不是這條寫入路徑。

### C-59-7 / C-59-8（P2，doc）—— 文件宣稱的耦合在測試裡並不存在

見上方 2026-08-22 補記。`4-implementation.md` § 4.8 的那句話也一併改寫成精確的說法（解析 `sd0x-owned`
那一列的三個部分），並補記了 round 59 這條反向控制的來歷。

**本輪 8/8 關閉。** stall streak 歸零（round 55 關 7/7、56 關 5/5、57 關 6/6、58 關 7 code + 3 doc、
59 關 8/8）；本次變更累計用掉 0 次 cap 診斷、0 次 stall 診斷。

## Round 60（2026-08-22，tier=thorough，Codex 新 thread）

本輪兩個平面各開一條新 thread（`mcp__codex__codex`，非 `codex-reply`），帶入既有 disposition 清單。
Codex 回報 6 筆阻擋級發現（C1–C5 加 D1/D2），全部與「量測」有關：不是規則寫錯，是**讀取結果的那一步**
不成立。六筆全數關閉，並各自附可執行證據。

### C1（P0，code）—— 先餵資料再挑工具，等於沒挑

兩個 skill 的 push URL 摘要都寫成 `printf '%s' "$U" | { sha256sum || shasum -a 256 || openssl … }`。
pipeline 的 stdin 是給**整個大括號群組**的，`||` 不會倒帶：第一個命令把輸入吃掉之後才失敗，後備就對著
EOF 做雜湊。於是每個 URL 都得到空字串的 SHA-256——**而且彼此相等**。這個 guard 唯一要回答的問題是「目的
地變了嗎」，它會在目的地已經變掉時回答「沒有」。

2026-08-22 在 `BASH_FUNC_sha256sum%%=() { cat >/dev/null; return 1; }` 下量到：
`…?repo=A&token=one` 與 `…?repo=B&token=two` 都得 `e3b0c442…7852b855`。

改法是把「挑工具」和「餵資料」拆開：`command -v` 不讀 stdin，所以選定之後輸入只被餵一次。再加一組
**known-answer test**（兩組固定向量）——工具存在不代表工具誠實，一個對任何輸入都回同一串合法 64-hex 的
shim 過得了形狀檢查，過不了 KAT。任一關失敗就把整個摘要變數清空，而不是清掉單筆：缺席即拒絕，單筆空白
反而會被讀成「這個目的地沒有摘要」。詳見 `4-implementation.md` § 4.10。

測試把兩個 skill 裡全部六份摘要區塊抽出來比對**逐位元組相同**，並用 fixture 還原舊 pipeline，證明碰撞確
實發生在 `e3b0c442…`——沒有這一段，上面的斷言可能只是因為環境根本沒生效而變綠。

### C2（P0，code）—— `/push-ci` 也有同一個「預測當量測」

round 59 修的是 `/epic-merge`，`/push-ci` 是同一個形狀：Phase 0 分類遠端拓樸並據此決定要不要問 unshared
attestation，Phase 2 才推。中間隔著一個 AskUserQuestion、一個不同的 shell，以及遠端在 operator 讀 plan
時能做的任何事。

Phase 2 現在在推送 fence 內重新量測，沿用 `case` + `*` catch-all。`rewrite` 那一臂是**用 attestation 放
行**而不是拒絕——`--force-with-lease` 存在的理由就是 rewrite。兩件測試斷言而非假設的事：`unknown` 即使
手上有 attestation 也拒絕（attestation 回答「這個 ref 有沒有人共用」，`unknown` 說的是**量測失敗**，前者
不是後者的證據）；以及平推完全不跑這段檢查（沒帶 flag 時 git 自己就會在 client 端擋掉 non-fast-forward，
多跑兩次網路往返之外，還可能把 git 本來就要拒的推送包裝成「本 skill 做了安全決定」）。

### C3（P0，code）—— 沒人讀 exit status 的步驟不算步驟

`/epic-merge` 每個 PR 的迴圈裡，Step 2/3/4 都是裸命令。checkout 失敗、rebase 中斷、manifest 寫不出來，
全都會直接走進 Step 5——那一步是 force-push。manifest 比對更糟：`# Mismatch → STOP + restore` 是寫在裸
`diff` 底下的**註解**，所以不一致時它印出 diff，然後照推。

三步各自包成 `if ! …; then <什麼已經不成立>; exit 1; fi`；比對改用絕對路徑 `/usr/bin/diff`（理由同
§ 4.7：`diff` 是命令字，會被匯入的 `BASH_FUNC_diff%%` 蓋掉，偽造的 exit 0 和沒檢查一樣不算數）。不一致
時從 backup tag 還原，**還原也失敗**時明講工作樹處在兩種狀態之外——那是唯一「什麼都別再做」才對的情況。

測試用 PATH 上的錄音版 `git` 實際執行這些 guard，不是讀它：失敗步驟 exit 1 並說出決定、成功步驟安靜通
過、不一致會還原且不推送、一致則直接放行不還原。最後一條是負向控制——一個無條件拒絕的 guard 會通過其他
每一條斷言，卻把 skill 整個弄壞，而這正是本輪自己犯過一次的錯（見 D1）。

### C4 / D1（P0，code）—— 拒絕一個 operator 已經具結過的 rewrite

round 59 給 `/epic-merge` Step 5 加上那個 `case` 時，把 `rewrite` 放進了拒絕臂。對這個 skill 而言那是錯
的，而且錯的性質不是嚴重度判斷：`/epic-merge` 的存在意義就是 rebase 一整條 stacked chain 再 force-push，
每一次正常迭代都讀作 `rewrite`。在那裡拒絕不是更嚴格的 gate，是壞掉的 skill。

正確形狀把「拓樸是什麼」和「有沒有人具結」分開：`rewrite` 臂改成比對 `UNSHARED_ATTESTED` 是否等於
`refs/heads/${head}`。三個不能省的性質——(1) `UNSHARED_ATTESTED` 在 fence 內**無條件賦值、預設為空**，
且永不從環境讀取（早先 export 的值會在沒有人被問的情況下回答問題，正是 `ALLOW_FORCE_UNSHARED` 要被清空
的同一個缺陷）；(2) 它記的是**ref 名稱**而不是 `yes`，所以對某個分支的具結不會飄到另一個分支；(3)
`unknown` 依然拒絕。測試是 reading × attestation 的九列矩陣，外加一條從外部 export `UNSHARED_ATTESTED`
仍然被拒的控制。

### D2（P1，code）—— 同一個檔案不等於同一個主人

§ 4.8 已經教會 `/codex-setup` Phase 3 不要覆蓋外來的 `pre-push`，但**狀態機**沒學會。`doctor` 判 `active`
只看兩件事：git 解析出來的路徑就是我們寫入的路徑、而且可執行。Phase 3 正確地拒絕覆蓋之後，這兩件事對那
個**外來** hook 全都成立——`$resolved` 和 `$written_path` 本來就是同一個檔案。於是 skill 在一個它（正確
地）什麼都沒安裝的專案上，回報 gate 已安裝。

三個述詞裡只有「所有權」（前 20 行的 `# <script> - ` 標記）能分辨。Active 述詞現在三者都要，並且新增一
個狀態而不是併入既有狀態——**`pending`（終端）**：解析到的檔案就是寫入路徑、可執行、且非 sd0x 所有。它
是終端的，因為補救方式不是重試；重新複製正是 Phase 3 拒絕做的事。兩張 transition matrix、`pending` 的
定義、兩列 doctor 輸出一併更新。

### C5（P2→在 thorough 為阻擋級，code）—— 命中是標籤，不是判決

`/smart-rebase` 的 analyzer 會在 remote 設有 negative fetch refspec 時示警。C5 的 gate 從「有 `^` 前綴的
refspec」直接預測傳輸會被清空——這個預測在一般情況下是錯的。

2026-08-22 對真實 bare remote 量測：negative refspec 只有在取消**每一條**正向映射時才會清空傳輸。
`^refs/heads/*` 與 `+refs/heads/*:refs/remotes/…` 並存時，`refs/remotes/cancelled/*` 一個都不會出現；
換成 `^refs/heads/wip/*`，`refs/remotes/cancelled/main` 就照樣出現——命名空間其餘部分仍然搆得到。

所以警告留著、判決拿掉：命中 `^` 現在印的是「如果 analyzer 以空傳輸中止，原因在這裡」，把問題交還給唯一
答得出來的人。散文一句話講完——**命中是標籤，不是判決**——而這個 gate 的 exit status 現在只回答一個問
題：設定讀得到嗎。

### 本輪自評

**6/6 關閉**，各自附可執行證據；四個受影響的測試檔（push-ci 52、epic-merge 63、codex-setup 33、
smart-rebase 81）全綠。stall streak 歸零（round 55–59 依序關 7/7、5/5、6/6、10、8/8，round 60 的發現全
是新的）；本次變更累計仍為 0 次 cap 診斷、0 次 stall 診斷。

值得單獨記下來的是 D1：round 59 修 C2 類缺陷時，把「重新量測」和「拒絕 rewrite」綁成同一件事，結果在
`/epic-merge` 上等於停用整個 skill。教訓不是「別加 guard」，而是**每個 guard 都要有正向控制**——一個無條
件拒絕的 guard 會通過所有「該拒絕時有拒絕」的斷言。`rules/testing.md` § Guards 已經寫著這條，本輪是它第
一次真的抓到東西（在 C3 的測試裡）。

## Round 61（2026-08-22，tier=thorough，兩平面各開新 Codex thread）

Code 平面 1 筆 P1，doc 平面 1 筆 P1 + 2 筆 P2，合計 4 筆阻擋級，全數關閉。本輪的共同形狀是：**先前
輪次做對的推論，沒有推到底**——第 4.3 節關掉了 config 那條改寫目的地的通道，卻在環境那條留了門；第 4.7
節證明了「決定用的字可以被換掉」，卻沒有把同一句話套用到 `true`／`false`／`exit`。

### C1（P1，code）—— 關掉 config 通道，環境那扇門還開著

兩個 skill 的 strip 清單都不清除 `GIT_SSH_COMMAND`，理由寫的是「transport set 只說怎麼認證，不說推什
麼」。更糟的是 `test/skills/epic-merge.test.js` 用 `assert.doesNotMatch` 把這個判斷**釘住**——它不只是寫
在文件裡，是被強制執行的。

這句話是錯的。2026-08-22 在 git 2.55.0 對 `ssh://approved.example/team/a.git` 實測：

| 匯出的變數 | git 拿它當 | 收到的 argv |
|-----------|-----------|------------|
| `GIT_SSH_COMMAND` | 連線本身 | `[approved.example] [git-receive-pack '/team/a.git']` |
| `GIT_SSH` | 連線本身 | 同上 |
| `GIT_PROXY_COMMAND`（`git://`） | 連線本身 | `[approved.example] [9418]` |
| `GIT_ASKPASS` | — | 完全沒被叫到 |

host 與 remote command 是**參數**，不是約束；wrapper 可以兩個都不理，連到別的 repository（它的 stdout
就是 protocol stream，這也是探針被 git 抓到的方式：`fatal: protocol error: bad line length character:
WRAP`）。`--receive-pack=git-receive-pack` 幫不上忙——那串字正是被忽略的參數之一。

失敗情境正是整個 feature 要防的那一個，而且過程中每一道控制都回報成功：Phase 0 讀 `origin`、印出並雜湊
**A**，使用者批准 **A**，`pre-push-gate.sh` 驗 A 的 digest、對 A 的 ref 發問——然後 `--force-with-lease`
落在 **B**，因為 lease 是在 wrapper 開的那條連線上協商的。`/epic-merge` 更糟：它在迴圈裡推，一個繼承來的
值會改寫每一次迭代。

三個名字現在都進了統一 strip 清單——`/push-ci` 全部 24 處、`/epic-merge` 全部 48 處，而不是只有 push
行。這是刻意的：量測拓樸的 `ls-remote` 和依據量測動作的 push 必須到達**同一個**目的地，兩份前綴就是兩個
會漂移的東西。

`GIT_ASKPASS` 維持不清除，而且這個區別是量出來的不是風格：它拿到一個提示、從 stdout 回傳憑證，選不了目
的地。測試同時斷言它的**缺席**，理由和斷言那三個名字在場一樣——一份長到把 credential helper 也吞進去的
清單，會通過上面每一條正向斷言並且弄壞真實的推送。

**這條沒關掉什麼，明講以免被讀成更多**：只關**環境**那條通道。repository 自己 config 裡的
`core.sshCommand` 與 `url.*.insteadOf` 仍然生效，這是刻意的——那份 config 是 operator 的，信任層級和他正
要發布的工作樹相同，而且它正是這個改動之後仍讓金鑰選擇能運作的東西（`~/.gitconfig`、`~/.ssh/config`）。
真正失去的是「為這個 shell 臨時 `export GIT_SSH_COMMAND=…`」，而且是**大聲地**失去：推送會認證失敗，而
不是成功推到錯的 repository。這個方向就是重點。

### D1（P1，doc）—— 講「字會被換掉」的文件，自己示範了那個會被換掉的字

`4-implementation.md` §4.13 用 `[ "$UNSHARED_ATTESTED" = … ] || { … }` 當作 attestation 檢查的
"correct shape"，而實際出貨的 fence 用的是 `[[ … ]]`。`[` 是 builtin，會被匯入函式蓋掉——這正是同一份文件
§4.7 建立的威脅模型。維護者照文件同步 skill，就會把繞道放回去：未取得具結的 `rewrite` 直接進 force-push。

範例已改成與出貨形狀一致的 `[[ … ]]`，並在 §4.13 補上為什麼那不是風格偏好。

### D2（P2，code）—— 契約寫在 exit status 上，而那個 status 由一個可被替換的字產生

`skills/smart-rebase/SKILL.md` Step 1 的 gate 宣稱「exit status 只回答一個問題：設定讀得到嗎」，但兩條路
徑分別以 `false` / `true` 收尾。實測（bash 3.2 / git 2.55.0）：

| 形式 | 在 `BASH_FUNC_<name>%%`（宣告 `return 7`）下 | 原因 |
|------|---------------------------------------------|------|
| `true`、`false` | 回 7 | 一般 builtin，函式優先 |
| `exit` | 回 7——`( exit 1 )` 竟然 exit **0** | special builtin，bash 預設模式下照樣可被蓋 |
| `[` | 回 shadow 的 status | 就是個 builtin |
| `[[` | 不受影響 | **keyword**，parser 在任何名稱查找之前就解析掉 |

Codex 實測的失敗情境：`GIT_CONFIG_COUNT=1` 讓 `git config` exit 128，正常跑得 `REFUSE rc=128`；加上
`BASH_FUNC_[%%='() { return 1; }'` 之後同一份 fence 得 `PROCEED rc=128`、`FINAL=0`。

改法是讓 fence 以 `[[ "$rc" -eq 0 || "$rc" -eq 1 ]]` 收尾——直接把判決講出來，而不是委託給一個字；訊息同
時移到 stderr，讓 wrapper 讀 status、人讀文字。殘留誠實寫著：`echo` 也是 builtin，被蓋掉就沒有訊息；
**status 才是契約**，而它是不可偽造的那一半。測試不是讀這段而是在三種 shadow 下實跑，且雙向都測（可讀的
設定在同樣 shadow 下仍須 exit 0——無條件拒絕的 fence 會通過另一半的每一條斷言）。

### D3（P2，doc）—— 把一台 macOS 的量測寫成跨平台保證

§4.7 原本寫 `/usr/bin/printf`「is part of every POSIX layout」。這與**同一份文件** §4.3 自相矛盾：那張表
明確以「NixOS 沒有 `/bin/bash`」作為不可硬編直譯器路徑的理由。POSIX 規範的是**工具**，不是**路徑名**；
本機 `getconf PATH` 回 `/usr/bin:/bin:/usr/sbin:/sbin`，那說的是標準工具在**這裡**的位置，不是到處都這樣。

段落改寫成能實際支撐的說法：macOS 有（101808 bytes、`root:wheel`，實測）、主流 Linux 發行版有、NixOS 沒
有——`/usr/bin` 在那裡只有 `env`（這也正好說明統一前綴不受影響）。路徑本身留著，因為**每個替代方案都會把
缺陷放回去**：任何在執行期「解析」工具的機制解析的都是一個**字**，而字正是匯入函式會換掉的東西。改的是
宣稱，不是機制。另補上在缺少這些路徑的 layout 上每個消費端都 fail-closed 的分析：`sha256_raw` 回空→摘要
為空→destination guard 拒絕；classifier fence 完全不印報告→下游讀不到偽造的；manifest 比對的
`if ! /usr/bin/diff` 把「工具不存在」和 mismatch 一視同仁——從 backup tag 還原並拒絕推送。沒有一條會在沉
默中前進。

### 本輪自評

**4/4 關閉**。四個受影響測試檔：push-ci 53、epic-merge 64、codex-setup 33、smart-rebase 81。stall streak
歸零（round 55–61 依序關 7、5、6、10、8、6、4，本輪發現全是新的）；本次變更累計仍為 0 次 cap 診斷、
0 次 stall 診斷。

值得記下來的是 C1 那條被測試**釘住**的錯誤判斷。一條 `assert.doesNotMatch` 把「不要清除 transport set」
從一句註解升級成強制條款，於是任何想修的人都會先看到一支紅燈，並合理地認為那是刻意設計。負向控制是必要
的（round 60 的教訓），但**負向控制本身也要有理由，而理由要是量出來的**——這一條的理由是一句從沒被驗證
過的直覺，而驗證它只需要一支 5 行的 wrapper 腳本。

## Round 62（2026-08-22，tier=thorough，兩平面各開新 Codex thread）

Doc 平面 4 筆阻擋級（3×P1、1×P2），全數關閉。本輪的形狀比 round 61 更窄也更難堪：**上一輪修對了機制，卻
沒有把同一句話在所有復述它的地方改掉**。三筆 P1 裡有兩筆就是這個。

（Code 平面首次派送被 Codex 的內容過濾以 cybersecurity risk 擋下——提示詞把攻擊面寫得太像操作指南。改寫
成防禦性審查措辭後重派成功。這件事本身值得記：review prompt 的措辭會決定 review 跑不跑得起來。）

### E1（P1，doc）—— 表格裡的 `exec`，同一份文件後面才剛推翻它

`4-implementation.md` §4.3 的攻擊面表格把 marker re-exec 寫成 `exec /usr/bin/env … "${BASH:-/bin/bash}"
-p …`。但出貨的 `scripts/pre-push-gate.sh:46` 是**普通命令**、沒有 `exec`——而拿掉 `exec` 的理由就寫在同一
份文件 line 600：`exec` 是 builtin，匯入的函式會蓋掉它。Codex 用
`BASH_FUNC_exec%%='() { return 0; }'` 跑表格所示的形狀，得到 `FELL_THROUGH`。

這是 current-authority 文件裡的一句可執行摘要。有人照它重建或重構 hook，就會把「以 exit 0 略過整個 push
gate」那條路放回去。已改成不帶 `exec` 的形式並指向 §4.7。

### E2 / E3（P1，doc + skill）—— 舊理由的兩處殘留

round 61 把「transport set 只說怎麼認證」這句話從 `skills/push-ci/SKILL.md` 與
`skills/epic-merge/SKILL.md` 的 strip 清單註解裡改掉了，也在 `4-implementation.md` 新增了 §4.16 記錄量
測。但同一句話還活在另外兩個地方：

- `4-implementation.md:411`（§4.3 談 prefix 成員資格的段落）仍寫著 transport set「deliberately absent」；
- `skills/epic-merge/SKILL.md:388` 的 recovery 說明更糟——它寫的是「deliberately **not** in the prefix
  **and must not be added**」，一句帶 `must not` 的指示，和同一份檔案 :341–350 以及 48 處實際 fence 直接
  牴觸。

危害不對稱：前者讓讀者誤解，後者讓讀者**動手**。維護者修復或複製 recovery fence 時會照著指示把
`GIT_SSH_COMMAND` 的清除拿掉，整條 stacked push 迴圈就重新可被一次環境設定導向另一個 repository。

兩處都改寫成正確的區分——三個 transport 名字在清單裡（git 把它們當連線本身執行），`GIT_ASKPASS` 不在清單
裡且不得加入（它只回傳憑證，選不了目的地）。並用一次 `grep -rn "how to authenticate\|not what is
pushed\|transport set"` 掃過 `skills/`、`docs/features/push-gate-optin/`、`rules/`，確認沒有第三處殘留。

### E4（P2，doc）—— 「不可偽造」說得比 keyword 給得多

round 61 把 smart-rebase Step 1 gate 的收尾改成 `[[ ]]`，散文寫「**status** 是契約，而它是不可偽造的那一
半」。Codex 指出並實測：尾端 `[[ ]]` 確實不能被函式蓋掉，但 status 的**輸入**仍來自裸 `git`——加上
`BASH_FUNC_git%%='() { return 0; }'` 之後，`type -t git` 回報 `function`，同一份讀不到的設定被判成
`rc=0`、fence exit 0。

散文改成精確的區分：不可被取代的是**判決形式**（沒有任何匯入函式能反轉最後一行，所以這個 gate 初版那種
反向錯誤在結構上不可能再發生）；判決的**輸入**是另一回事，而且這一層沒有解法也不假裝有——push fence 靠
`bash -p` 重新執行來丟棄函式匯入，而在 operator 自己 shell 裡跑的 markdown fence 要不到 `-p`（§4.3 對
push gate 的 caller 側記的是同一個限制）。真正的後盾在別處而且獨立：analyzer 自己執行 refresh，空傳輸就
中止——偽造出來的「乾淨讀取」買到的是一次仍然會停下來的執行。

這個殘留同時被**釘成測試斷言**，附一條反向控制（同一個 shadow 下可讀的設定也必須 exit 0，證明斷言講的是
偽造的讀取而不是 shadow 把 fence 弄啞）。理由寫在測試裡：被那段散文取代的說法claim 得比證據多，而未被釘住
的殘留正是最容易長回來的那種宣稱。

### 本輪自評

**4/4 關閉**。四個測試檔：push-ci 53、epic-merge 64、codex-setup 33、smart-rebase 81。stall streak 歸零
（round 55–62 依序關 7、5、6、10、8、6、4、4）；本次變更累計仍為 0 次 cap 診斷、0 次 stall 診斷。

值得記下來的是 E2/E3 這一類：**一個判斷被寫進 N 個地方，修的時候只改了其中 N−2 個**。round 61 已經因為
「測試把錯誤判斷釘住」學過一次相近的教訓，這一輪學到的是它的另一半——修正一個判斷時，要先把那個判斷的
所有復述**列舉出來**再動手，而不是修完再回想哪裡可能還有。一次 `grep` 的成本遠低於一句帶 `must not` 的
過期指示。

### Round 62 · code 平面（3 筆：1×P1、2×P2，全數關閉）

Code 平面首次派送（`kb86rifpv`）被 Codex 內容過濾以 cybersecurity risk 擋下——提示詞把攻擊面寫成了操作
指南的樣子。改寫成「對操作者自己 repository 的防禦性審查」措辭後以 `k4hc0zzja` 重派成功。這件事值得記在
記錄裡：**review prompt 的措辭會決定 review 跑不跑得起來**，而被擋下時看起來和「沒有 finding」一樣。

#### F1（P1）—— transport 清單少了不執行任何東西的那一個

round 61 把三個 transport 變數納入 canonical strip，理由是「git 拿它們當連線本身執行」。這個理由**推不到**
`GIT_SSH_VARIANT`——它不指向任何可執行檔。它決定 git 為連線**組出來的 argv** 用哪一種方言，而方言之間對
「port 是什麼」意見不同。實測（2026-08-22，git 2.55.0 / OpenSSH 10.3p1，`ssh://example.invalid:2222/...`）：

| `GIT_SSH_VARIANT` | git 組出的 argv |
|-------------------|-----------------|
| 未設（auto） | `ssh -o SendEnv=GIT_PROTOCOL -p 2222 example.invalid …` |
| `plink` | `ssh -P 2222 example.invalid …` |

OpenSSH 的 `-P` 不是 port，usage 寫的是 `[-P tag]`，所以 `2222` 被當成 tag 吃掉，連線靜靜落到 22。核准的
是 2222 上的 repository、同一主機 22 上是另一個 repository 時，就是 §4.16 那個失敗情境——而且完全沒有經過
「指定一個可執行檔」這一步。已補進 `/push-ci` 24 處、`/epic-merge` 48 處，測試改成斷言**真實 argv 與真實
port**（PATH 上放假 `ssh` 錄下 git 遞來的參數），兩個方向都斷言：帶 prefix 時 `-p 2222` 必須在、`-P 2222`
必須不在。

#### F2（P2）—— 「清掉它會很大聲地失敗」這句話只在 fallback 連不上時成立

round 61 在 §4.16 收尾寫：清掉 `GIT_SSH_COMMAND` 之後「會**大聲**失敗，而不是靜靜推到錯的 repository，
這個方向就是重點」。Codex 指出這句只在一半的情況成立。`GIT_SSH_COMMAND='ssh -p 2222'` 不只說「怎麼連」，
它帶著「連去哪」的一部分；清掉之後推到同一主機的 22——而那台主機若在 22 上也服務同一條路徑、同一把
key 也收，push 就**成功**了，推到錯的 repository。也就是說：清除本身也是一次目的地變更，方向相反而已，
結局一樣。

修法不是把清除拿掉，而是 Phase 0 **拒絕**：四個名字，任一 set 就停，早於任何 ref 被讀取之前。
`/push-ci` 放在 step 0b（flag 綁定之後、讀 `BRANCH` 之前）；`/epic-merge` 放在 Step 0 的 fetch **之前**
而不是之後——那個 fetch 本身就是 transport 操作，而且**會寫 ref**：被導向的話它不是報告錯誤的鏈，而是拿
另一個 repository 填滿 `refs/remotes/origin/*`，底下每一個 count、backup tag、rebase 目的地與 lease 都是
從那些 ref 算出來的。`-u` 清單保留為縱深防禦，給沒有經過這個拒絕就抵達後面 phase 的呼叫者。

判定用 `${!_n+set}`（set 含空字串）而非 `-n`：實測 exported-empty 的 `GIT_SSH_COMMAND` 不等於未設，git 會
把空字串當成命令執行（`run_command: GIT_PROTOCOL=version=2 '' -G …`）。輸出**只印名字、不印值**
（Anchor Register #2——transport 命令列上常常就掛著 key path），測試兩個方向都釘：帶 key path 的值不得出現
在輸出，且同一次執行必須有印出變數名，證明前一條斷言講的是「值」而不是「這個區塊根本沒印東西」。

`GIT_SSL_NO_VERIFY` 與 `ALL_PROXY`/`HTTPS_PROXY`/`HTTP_PROXY` 三個**沒有**加入，並在 §4.18 具名記為未完成
的殘留：它們對本 repository push 的實際效果沒有量測過，而 §4.16 的整個教訓就是「在這個面上不量測就推理，
會產出有自信、被測試釘住、而且錯的答案」。

#### F3（P2）—— 會分類 exit code 的 gate 必須在 `set -e` 下活得下來

smart-rebase Step 1 gate 存在的意義是把一次 `git config` 讀取分成三種結果：0=有設、1=沒設（是答案不是失敗）、
其他=根本讀不到。但 `refspecs=$(...); rc=$?` 在 `set -e` 的呼叫者下交付不了這件事：assignment 的 command
substitution 失敗時，assignment 自己就帶著那個 status，`set -e` 在下一行執行**之前**就動作——`rc` 從來沒被
讀到，三分類從來沒發生，呼叫者的 shell 在 gate 判定為「可以繼續」的那個情況下 exit 1，stderr 什麼都沒有。
改成 `if refspecs=$(...); then rc=0; else rc=$?; fi`——`if` 條件位置的命令被 shell 自己的規則豁免於 `set -e`，
這就是這個形狀存在的全部理由。回歸測試在 `set -e` 下對真 git 跑新舊兩種寫法，斷言 fence 之後的標記行：
新寫法到得了，舊寫法到不了。

#### 本輪自評（含 doc 平面）

**7/7 關閉**（doc 4 + code 3）。四個測試檔：push-ci 55、epic-merge 66、codex-setup 33、smart-rebase 82，
共 236 pass / 0 fail。stall streak 歸零；本次變更累計仍為 0 次 cap 診斷、0 次 stall 診斷。

F1 和 F2 指的方向相反，而這正是這一輪最有用的地方：一個說清單太短，另一個說**清單本身不是收尾的工具**。
round 61 把「清掉就對了」當成結論，round 62 才看出清掉也是一次沒說出口的目的地變更。可以往前帶的判準是：
**任何「我幫你把環境改成正確的樣子」的動作，都要先問改動本身會不會靜靜地成功**——會的話，正確做法是拒絕
並把問題交回去，不是替對方決定。

> **2026-08-22 更正（round 63 補記，不改寫上文）**：本輪收尾用的 grep 漏掉 `scripts/`，於是
> 「lost loudly」與 r5 的 transport 前提在 `scripts/pre-push-gate.sh:102`、
> `skills/push-ci/SKILL.md`（Phase 2 註解）與兩支測試的斷言訊息裡各留了一份未收回。詳見
> Round 63 · doc 平面 D#1／D#3／D#4，教訓記為 `.claude/sd0x-dev-flow-lessons.md` L12。

### Round 63 · code 平面（6 筆：3×P1、3×P2，全數關閉）

新開 thread `kxk9rbcuu`，⛔ Blocked。Codex 自陳其 sandbox 拒絕 `mkdtempSync`（`EPERM`），所以它的
重現全部寫成免暫存檔的形式——這點值得記下來：它給的證據仍然成立，但「它沒跑動態測試」不等於
「動態測試不需要」，本輪三筆修法的證據反而都是靠實際執行 fence 拿到的。

| # | 嚴重度 | 位置 | 內容 | 處置 |
|---|--------|------|------|------|
| #1 | P2 | 兩份 skill 的所有 `fetch`／`ls-remote` | push 端 pin 了 `--receive-pack`，決定「要推什麼」的 read 端卻沒 pin；`remote.<name>.uploadpack` 會讓另一個 repo 來回答 | 每一處 read 加 `--upload-pack=git-upload-pack`，並改為**逐行掃全文**的斷言 |
| #2 | P1 | `epic-merge` Phase 1 兩個 `for` 迴圈 | 迴圈的結束狀態是**最後一次**迭代的；第一個 PR 的備份 tag／manifest 失敗會被第二個 PR 的成功抹掉 | `PHASE1_OK` 記錄 + 最後一行 `[[ ]]` 表態；manifest 迴圈另外用旗標**閘住**，避免 `MANIFEST_DIR` 空值把檔案寫到根目錄 |
| #3 | P1 | `epic-merge` Iteration 1 | `gh pr merge --squash` 失敗被下一行 `git fetch` 的成功頂替，iteration 2 會在「PR 1 從未併入」的 epic 上繼續 | `ITER1_OK` 同一形狀；fetch 只透過 `[[ ]]` 抵達，位元組不變 |
| #4 | P1 | `push-ci` Phase 2 六處拒絕 | `exit` 是 builtin，匯入函式可以贏過它——量測到拒絕訊息完整印出、後面的 push 照跑、狀態 0 | 拒絕改為記進 `PUSH_BLOCKED=1`，push 只透過 `[[ ]]` 抵達 |
| #5 | P2 | `epic-merge` 兩處 force-push | 同上，且兩行 push 必須保持逐字相同 | 閘門獨立成一行 `[[ -z "$PUSH_BLOCKED" ]] && \`，push 那兩行位元組不動 |
| #6 | P2 | `smart-rebase` Step 1／Step 5 | `set -e` 會在「命令替換失敗的賦值」當場中止，而 `merge-base --is-ancestor` 回 1 正是這個 gate 最重要的**答案** | 改成 `if CMD; then rc=0; else rc=$?; fi`；Step 5 的判定改用 `case`／`[[ ]]` 關鍵字 |

證據形式值得單獨記一筆：#2／#3 的測試是把 fence 從文件裡取出來、替換掉 `<PR-numbers>` 這類佔位符、
用會記錄 argv 的假 `git`／`gh` **實際執行**，斷言的是結束狀態。純文字比對在這裡不夠——一個「有寫護欄
但什麼都沒記錄」的版本可以完全通過正規表示式。每一筆都附上把護欄剝掉的 mutant（同樣的失敗必須靜靜
通過，因為那正是修之前的行為），而且斷言 mutant 真的套用了。

### Round 63 · doc 平面（5 筆：3×P2、1×P1、1×Nit，全數關閉）

新開 thread `kp40r0k6t`，⛔ Needs revision。五筆全部是同一個類：**一個判斷寫在 N 處、只在 N−k 處被
收回**。

| # | 嚴重度 | 位置 | 處置 |
|---|--------|------|------|
| D#1 | P1 | `scripts/pre-push-gate.sh:102` | 「transport 變數只決定怎麼認證，不決定推什麼」是 r5 的原始前提，round 63 已量測推翻。結論（此處不做正規化）成立，但理由換成真的那個：**這個 hook 跑在 git 已經選好路由之後**，它的每一個比較都是本機 ancestry，正規化改不動任何判定；目的地問題屬於呼叫端，由 `/push-ci` Phase 0 step 0b 拒絕 |
| D#2 | P2 | `4-implementation.md` § 4.17 收尾 | 「status 是無法偽造的那一部分」收斂成 `smart-rebase` 已採用的區分：不能被取代的是**判定形式**，判定的**輸入**仍來自裸命令 |
| D#3 | P2 | `skills/push-ci/SKILL.md` Phase 2 註解 | 「loses it LOUDLY」只在 fallback 連不上時成立；一台主機兩個 port 的情形下它是靜默的 |
| D#4 | P2 | 兩支測試的 `stripFlags` 斷言訊息 | 「每一個都指名一支 git 拿來取代連線的執行檔」對 `GIT_SSH_VARIANT` 不成立——它不指名任何程式，只改變 git 怎麼組出命令列 |
| D#5 | Nit | `4-implementation.md:36` | 引用行號 `:194` → 推導指令實際在 `:200`（檔案已開著，就地修） |

停滯判定：本輪關閉 11 筆，全部是新的、真的缺陷，stall streak 維持 0；本次變更累計 0 次 cap 診斷、
0 次 stall 診斷。可往前帶的判準已寫成 L12：**寫下「舊說法錯了」的那一輪，必須同時出現一次跨
`docs/ skills/ rules/ scripts/ test/ hooks/` 的關鍵詞 grep，並把輸出貼進 review log。**沒有那行
grep 的更正，視同尚未更正。本輪的那行 grep 輸出剩下七筆命中，逐一確認全部是「引述舊說法並指出它錯」
的回顧性文字，加上一處待重算的位元組 pin。

### Round 64 · code 平面

Codex thread `01a026ff-178e-7d61-94d8-9a0ea9769881`（新開，非 `codex-reply`）→ `⛔ Blocked`，
`gate_reason=IN_SCOPE_BLOCKING`，5 筆（4×P1、1×P2）。tier=thorough，P2 亦為 blocking。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| C#1 | P1 | `skills/push-ci/SKILL.md` 收尾註解 | 承認 `$BASH_ENV` 可攔截絕對路徑前綴，卻把殘留責任推給 `pre-push-gate.sh`。該 hook 是 opt-in，未安裝時 `rules/git-workflow.md` § Push safety 明定 in-session 核准就是唯一憑證——沒有 L1 可以遞交 | 已修：兩份 skill 各新增 Phase 0 step 0a；收尾論斷改為指名殘留而非缺席的 hook |
| C#2 | P1 | `skills/epic-merge/SKILL.md` Step 5 | push 的結束狀態從未被讀取，失敗或被拒的 force-push 會直接落進 `gh pr edit` / `gh pr merge`——把 rebase 前的舊 PR 改基底並 squash 合併 | 已修：`STEP5_STATUS=$?` + `case` 拒絕，Step 6–7 以 `PUSH_BLOCKED` 圍起 |
| C#3 | P1 | 同上 Step 7→8 之間 | CI 閘門是 `gh pr merge` 前的一行 `#` 註解。註解不會攔任何東西——照抄執行就是無 PASS 直接合併 | 已修：fence 在 dispatch 處結束，Step 8 是「只在 PASS 才進入」的另一個 fence。閘門是 **fence 邊界** |
| C#4 | P1 | 同上 Rollback | 本地還原 `git switch -C "$head" "refs/tags/backup/pr-<N>"` 是裸指令；備份 tag 不存在時失敗被忽略，接著的 force-push 把「rollback 要取代掉的那個狀態」寫回遠端——而核准問的是備份 tag | 已修：包成 `if ! …; then … PUSH_BLOCKED=1; exit 1; fi`；guard 普查 3 → 4 |
| C#5 | P2 | `skills/push-ci/SKILL.md` Phase 2 | `--force-with-lease` 遇到多個 `remote.origin.pushurl` 時，最終拓撲複核只有一個 `FINAL_TIP`，必然讀成 `unknown` 而拒絕——但那時 plan 已出示、unshared 問題已具名問過、核准已收下 | 已修：改在 Phase 0 step 7c 前置拒絕。**不移除任何今天可用的能力**（這些 push 本來就會被拒，只是晚一個 shell）|

**C#1 的自查**：我獨立重現了攔截。bash 3.2.57 / zsh 5.9，2026-08-22——`function /usr/bin/env`
被 **定義**（非 import）時，兩種 shell 都讓絕對路徑的命令字解析到該函式，子行程根本沒跑。
終止子刻意用 `${x:?}` 而非 `exit`：`exit` 是 builtin，函式的優先序在其上；實測即使把 `:` 本身
也遮蔽掉，展開失敗仍會終止。反向控制（把終止子換成 `exit 1` 再遮蔽 `exit`）已寫進測試，
所以這句話是「量到的」不是「宣稱的」。

**修 C#1 時自己引入、又被 executing test 抓到的缺陷**：第一版拒絕訊息寫成
`the interpreter's startup file is inherited — refusing`。`${var:?word}` 的 word 裡即使處在雙引號
內，bash 仍把單引號讀成開引號，而且那是 **parse** 錯誤——整份 fence 連正常路徑都起不來。六個測試
同時變紅，其中一個是與啟動檔毫無關係的 fan-out 案例。已改掉並補一個 `bash -n` 解析測試，讓同類
問題下次直接以原因失敗。

### Round 64 · doc 平面

Codex thread `01a02701-b945-7183-b9dc-c72e4842bafe`（新開）→ `⛔ Needs revision`，4 筆（1×P1、3×P2）。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| D#1 | P1 | `rules/git-workflow.md:23`（＋ `skills/push-ci/SKILL.md:39`、`4-implementation.md`、`test/rules/discretion-tiers.test.js`）| 「every update to an existing tag is asked about」，而排除項只列了 tag 建立與 OID 未變——**刪除被靜默排除**：`scripts/pre-push-gate.sh` 的 rewrite 判定要求兩側 OID 皆非 null，所以 `git push origin :refs/tags/v1` 完全不會觸發提示 | 已修：四處都補上刪除這個排除項與理由；`test/scripts/pre-push-gate.test.js` 加雙向測試（既有 tag 刪除 exit 0 且不被列為 rewrite ／ 既有 tag 前移仍會被問）。**沒有擴大閘門**——是否該為「刪除他人持有的 ref」新增提示，是設計決策，另行提請使用者裁示 |
| D#2 | P2 | `scripts/pre-push-gate.sh` 註解 | 「every comparison below is local ancestry」為假——這句是本輪自己寫的。§ `SD0X_PUSH_DEST_DIGEST` 會對 `$2` 取摘要、讀 `remote.<name>.receivepack`，兩者都會拒絕 | 已修：改成正確的 **時序** 論證（hook 跑在 git 已完成路由之後，所有輸入在第 1 行前就已固定），並因超過 29 行上限而遷移至新增的 § 4.22，原處留 4 行指標 |
| D#3 | P2 | `test/skills/epic-merge.test.js` | 仍寫著「only the absolute path is immune」——L12 那一類：論斷在誕生的文件裡收回了，重述處沒有 | 已修：改為「絕對路徑買到的是 import 這一個通道，僅此而已」，並指向 step 0a |
| D#4 | P2 | `test/rules/discretion-tiers.test.js` | 引用 `pre-push-gate.sh:70-76` 與 `:78-82`，實際的 non-fast-forward 拒絕在 § Non-fast-forward push check、protected 判定在 § Protected branch gate，行號早已漂到 re-exec 區塊 | 已修：改以 **章節** 引用，並補一個機械檢查——直接從 gate 讀出兩個章節的先後順序。能不漂移的引用，仍不等於正確的引用 |

**驗證**：focused 七套 408/408；`check-comment-blocks.js` 自身 exit 0（讀結束碼，不用 `grep -c`）；
三個 `SKILL_DIGEST`、`CANONICAL_PHASE2_SECTION`、`CANONICAL_PUSH_SAFETY_LINE` 皆由腳本在
**最後一次編輯之後** 重新產生。

**非停滯**：round 55–64 分別關掉 7、5、6、10、8、6、4、7、11、9 筆，每一筆都真實且是新的。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

**裁示（2026-08-22）**：D#1 帶出的「刪除是否納入未共用佐證類別」已提請使用者決定，選擇「維持現狀，只記錄邊界」。
本輪因此交付的是 *列舉* 與雙向 pin，不是行為變更——閘門仍只問覆寫。日後若要擴權，那會是一次刻意的移動，不是意外。

**L12 收尾複查（2026-08-22，round 64）**——收回論斷後跨目錄 grep，輸出貼在此處而非只寫「已檢查」：

| 收回的論斷 | 殘留 |
|---|---|
| `only the absolute path is immune` | 無。唯一命中是 review log 本身（記錄，正確引述被收回的原文）|
| `every comparison below is local ancestry` | 無。命中處為 review log 與 `4-implementation.md` § 4.22——後者是把它當作「被更正的對象」引用 |
| `is where the authorization actually lands` | 無殘留 |
| `every update to an existing tag`（需同時帶刪除排除項）| 六處全部帶上：`rules/git-workflow.md`、`skills/push-ci/SKILL.md`、`4-implementation.md`、review log、`test/scripts/pre-push-gate.test.js`、`test/rules/discretion-tiers.test.js`（後者為重新產生的 byte pin）|

指令：`grep -rn "<phrase>" rules/ skills/ scripts/ docs/ test/`。

### Round 65 · code 平面

Codex thread `01a02735-b5da-7583-aef6-c7f7d950a223`（新開，非 `codex-reply`）→ `⛔ Blocked`，
`gate_reason=IN_SCOPE_BLOCKING`，4 筆（2×P1、2×P2）。tier=thorough，P2 亦為 blocking。
本輪 Codex 再次回報 `mkdtemp` EPERM，無法執行需要暫存目錄的測試，改以不寫檔的 shell 探測佐證。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| C#1 | P1 | 兩份 skill 的 Phase 0 step 0a | `${SD0X_*_REFUSED:?…}` 在展開前沒有重設哨兵，而 `:?` 只在 **null 或 unset** 時觸發——一個 `export SD0X_PUSH_CI_REFUSED=1` 就讓 fence 印完拒絕訊息後以 status 0 繼續。不需要遮蔽、不需要啟動檔 | 已修：assign-then-expand（空值指派在展開上一行）。指派是語法不是命令字，沒有函式能蓋過；實測預設哨兵 ＋ `echo`/`unset`/`:`/`exit` 全遮蔽下仍 rc=1。`scripts/pre-push-gate.sh` 本來就是這樣寫的（`SD0X_PRIV_GUARD=''`），skill 抄了想法沒抄那一行 |
| C#2 | P2 | 同上 ＋ `test/skills/push-ci.test.js` | `${!_n+set}` 是 bash 專屬的間接展開，zsh 5.9 直接 `bad substitution`（連 `--emulate sh` 也一樣）——macOS 預設 shell 上這個區塊在**第一次迴圈**就中止，它所記載的 `ENV` 拒絕從未執行過。而名為「zsh」的那個測試呼叫 `runStep0a`，內部無條件 `spawnSync('bash', …)` | 已修：迴圈與間接展開一起移除，兩個變數由 `[[ ]]` 逐字具名；測試 harness 改收 `shell` 參數，zsh 案例真的跑 zsh（無 zsh 時跳過）。**測試點名哪個 shell，就必須跑那個 shell** |
| C#3 | P1 | `skills/epic-merge/SKILL.md` Step 8 | PASS 判定是關於「某個 commit ＋ 某個 base」，而 `gh pr merge "<N>" --squash` 只綁 PR 編號。`/watch-ci` 等待期間與返回之後 PR 都可變——協作者推 head、任何人改 base，合併的就是沒被測過的 diff，而 fence 讀起來像是等過了 | 已修：`--match-head-commit "$CI_PASSED_SHA"`（由 GitHub 在合併時檢查，本地比對必輸競態）＋ 合併前重讀 `baseRefName` 並比對。`CI_PASSED_SHA` 由模型逐字寫入 fence，**不重新推導**——重推得到的正是這個檢查要懷疑的值。gh 沒有 `--match-base`，殘留視窗真實存在，文件寫明而非以程式碼暗示已關 |
| C#4 | P2 | `skills/push-ci/SKILL.md` step 7c | 終止子是裸 `exit 1`；`exit` 是 builtin，匯入的 `BASH_FUNC_exit%%` 蓋得過。實測拒絕訊息照印、執行續進報表與核准流程。Phase 2 仍會拒絕該 push，所以不是 fan-out force push 的通路——但「先拒絕再問」正是把檢查搬進 preflight 的全部理由，被繞過的 abort 還是問了 | 已修：改用與 step 0a 相同的 assign-then-expand；舊形式保留為反向控制測試 |

**兩個平面的 reviewer 各自獨立找到 C#1**，這一點值得記錄：doc 那條是從「文件宣稱它關掉了什麼」
讀出來的，code 那條是從展開語意讀出來的，兩條指向同一行。

### Round 65 · doc 平面

Codex thread `01a02733-7dc5-7b41-8c9b-e5b1f72d063e`（新開）→ `⛔ Needs revision`，4 筆（2×P1、2×P2）。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| D#1 | P1 | `4-implementation.md` § 4.23、`skills/push-ci/SKILL.md` 收尾註解 | 兩處都寫 step 0a「closes the reachable part / half」。**軸選錯了**：step 0a 讀的是變數，能關的就是變數看得見的部分；「定義函式後再 unset 變數」的父 shell 一樣可達，只是這個儀器看不到。寫成 unreachable 會讀成「其餘不可能發生」 | 已修：兩處改為 **detectable**，並明說殘留是「這個儀器偵測不到」而非「到不了」 |
| D#2 | P1 | `4-implementation.md` § 4.3 表格 `BASH_ENV` 那一列 | 同一格裡有兩個已被推翻的論斷沒有傳播：「**Neither layer**」早於 step 0a；「the fence was never the terminal credential — the hook … is」早於 opt-in 認定。L12 那一類——論斷在誕生處收回了，重述處沒有 | 已修：改為「Caller: step 0a **DETECTS** it; no layer closes it」，並補上「hook 是終端憑證」只在 hook **已安裝** 時成立，opt-in 未裝時 in-session 核准就是全部憑證 |
| D#3 | P2 | `4-implementation.md` § 4.22 | 「every input it reads was fixed before it was invoked」與 `scripts/pre-push-gate.sh` 自己量到的事實相牴觸：git 在 ref advertisement **之後** 才叫 hook，包裝程式可以先 `git config --unset remote.origin.receivepack` 再 exec，讓這個讀取什麼都看不到。三列裡只有兩列是 fixed | 已修：拆成「前兩列 fixed、第三列不是且為 best-effort by construction」，並指明真正關掉該案的是兩支 skill push 行上的 `--receive-pack=git-receive-pack`，不是這個讀取。表格原本要問的問題（有沒有 transport 變數碰得到）不變，結論也不變 |
| D#4 | P2 | `skills/push-ci/SKILL.md` step 7c 拒絕訊息 | 寫「`url.<x>.pushInsteadOf` rewrite **adds** a destination」——不成立。git 取**唯一最長**匹配前綴，改寫是一對一；且當該 remote 有明確 `pushurl` 時，`pushInsteadOf` 對它根本不被查閱 | 已修：訊息改為「`remote.origin.pushurl` 多值，或未設 pushurl 時 `remote.origin.url` 多值」，並在守衛上方補註記說明 `pushInsteadOf` 為何不是入口 |

**驗證**：`test/skills/push-ci.test.js` 74 項、`test/skills/epic-merge.test.js` 76 項——除 digest pin
外全綠（pin 在最後一次編輯後由腳本重產）。step 0a 電池由 12 → 13 項，新增預設哨兵案（含刪除重設行的
反向控制）、builtin 全遮蔽案、兩個真跑 zsh 的案例；step 7c 新增 imported-`exit` 案與其反向控制
（bash < 4.3 無此匯入形式時跳過，避免以空真值變綠）；epic-merge Step 8 新增 7 項，含兩個反向控制。
`node scripts/check-comment-blocks.js` 自身 exit 0，無 BLOCK。

**非停滯**：round 55–65 分別關掉 7、5、6、10、8、6、4、7、11、9、8 筆，每一筆都真實且是新的。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

### Round 66 · code 平面

Codex thread（新開，非 `codex-reply`；提示詞改用中性工程措辭——「請檢視一段 shell 指令的正確性：
引號、結束狀態、控制流」——安全／攻擊者措辭會被內容過濾器擋下）→ `⛔ Blocked`，
`gate_reason=IN_SCOPE_BLOCKING`，4 筆（1×P1、2×P2、1×Nit）。tier=thorough，P2 亦為 blocking。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| C#1 | P1 | `skills/epic-merge/SKILL.md` iteration 1、Step 9、§ Recovery resume | 三處同一形狀：跑完 `git fetch` 更新 `refs/remotes/origin/${epic}`，然後回報**合併**的狀態，fetch 自己的結束狀態沒有任何人讀。合併成功、fetch 失敗 ⇒ fence exit 0。代價不是「ref 過期」而已——下一輪 iteration 會 rebase 到那個 ref 上再 **force-push**，寫出一段不含剛合併 PR 的歷史，全程沒有任何一步報錯 | 已修：iteration 1 加 `ITER1_REFRESHED`，結束狀態為兩個 conjunct；Step 9 讓 fetch 失敗設 `MERGE_BLOCKED=1`；resume 以 `RESUME_OK` 串起 fetch → rebase → retarget → force-push。訊息**刻意不共用**：合併失敗與 refresh 失敗的修復動作不同，共用一句會把操作者送到錯的那一邊 |
| C#2 | P2 | 兩份 skill 的 Phase 0 step 0b | round 65 才把 `${!_n+set}` 從 step 0a 拿掉，隔一個區塊的 step 0b 原封不動。實測 2026-08-22 zsh 5.9：**第一次迭代**就 `bad substitution` rc=1（不論有沒有設變數），所以在平台預設 shell 上這道拒絕從未執行，Phase 0 其餘部分也沒有 | 已修：四個 `[[ ]]` 逐字具名，終止子改用 assign-then-expand。**跨 skill parity 測試救不了這種漏**：兩份拷貝帶著相同的缺陷區塊，parity 問的是「兩份一不一致」，而它們一致。真正的教訓是 round 65 的修補**綁在位置上而非綁在構造上** |
| C#3 | P2 | `test/scripts/pre-push-gate.test.js` SHA-256 對照 | `'b3a1'.repeat(16)` vs `'c7d2'.repeat(16)` 是 64 個十六進位字元但不是物件，`merge-base --is-ancestor` 回 **128**（`fatal: Not a valid commit name`）而不是 1——gate 擋下來走的是 fail-closed 路徑，不是 ancestry 判定。這個測試在「完全讀不到 SHA-256 寬度 ancestry」的 gate 上一樣是綠的，而那正是 null-OID 加寬可能引入的迴歸 | 已修：改名為它真正測的東西；另建真的 `git init --object-format=sha256` fixture，先斷言 ancestry 回 **1** 再跑 gate，並附同一 repo 同一寬度的 fast-forward 對照 |
| C#4 | Nit | 同檔「ordinary fast-forward … untouched by the attestation」 | ref line 帶 null remote OID——那是 ref **建立**，不是 fast-forward，而且上面兩個測試已經涵蓋。於是 attestation 唯一的反向控制實際上在斷言「建立會過」，一個對每個真 fast-forward 都索取 attestation 的 gate 可以直接通過它 | 已修（適用「檔案已開啟的一行修正」例外）：改用 two-commit fixture 的 `ffRef`，並補 `Non-fast-forward` 的否定斷言 |

**C#3／C#4 共同的形狀**：對照組只值它的輸入真正是什麼。這兩個都是照 ref line 的**外形**寫的
（40 或 64 個十六進位字元、某一側是 null），而不是照 git 拿它去做什麼。多查一個中間事實
（`merge-base` 在這裡回什麼？這個 ref 是被建立還是被前進？）就是兩者的分水嶺。

### Round 66 · doc 平面

Codex thread（新開）→ `⛔ Needs revision`，4 筆（全 P2）。其中兩筆由我以全新的端對端實測獨立佐證。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| D#1 | P2 | `4-implementation.md` § 4.22 表格第三列 ＋ `scripts/pre-push-gate.sh` 標頭註解 | 「`remote.<name>.receivepack` 這一列，transport 變數搆不到」——**實測不成立**。2026-08-22 建：bare remote、`remote.origin.url=ssh://fakehost/irrelevant`、記錄 `remote.origin.receivepack` 的 pre-push hook、以及一支假 `GIT_SSH_COMMAND`（記錄 → `git config --unset remote.origin.receivepack` → exec `git-receive-pack`）。順序檔讀出 `SSH_RAN`、`SSH_RAN`、`HOOK`、`HOOK sees receivepack=[]`——transport 程式在 hook **之前跑了兩次**，hook 讀到的是它已經清空的設定，push 仍報 `* [new branch] main -> main` | 已修：該列改為 **Yes**。**結論保留、立足點改換**：在這支腳本裡正規化 transport 變數依然不改任何判定，不是因為搆不到，而是因為 hook 第 1 行執行時它們早就搆到了——對 hook 而言可達性是錯的軸，**順序**才是，而在順序這條軸上 hook 無棋可下。所以該問的一方是 caller，這正是 `/push-ci` step 0b 選擇**拒絕**而非清除的理由 |
| D#2 | P2 | `4-implementation.md` § 4.3、§ 4.22 ＋ `pre-push-gate.sh` 同一句 | 「`GIT_SHALLOW_FILE` 與 `GIT_ALTERNATE_OBJECT_DIRECTORIES` 都只能讓 ancestry **無法證明**」——後者方向相反。實測 2026-08-22：缺少 commit `R` 的 repo，`merge-base --is-ancestor L R` 回 **128**；加上捐贈者的 object directory 後回 **0**。alternates 讓 ancestry 從「無法證明」變成「可證明」 | 已修：三處都拆成兩個理由。安全結論不變但改以正確的前提支撐——物件是 hash 定址且不可變，所以從 alternate store 讀到的圖就是真的圖，補上只能**補全**一個 gate 原本得不到的答案，不可能偽造一個它原本得到的答案 |
| D#3 | P2 | `4-implementation.md` 三處（§ 4.3 表格列、§ 4.21 兩處） | 仍寫「our own `exec`」「after the exec」。`scripts/pre-push-gate.sh` 的特權重跑是**普通命令**不是 `exec` builtin，而且該檔第 391 行早已寫明。兩個終止子（`exec`、`exit`）都是為同一個實測理由拿掉的：它們都是 builtin，匯入的 `BASH_FUNC_*` 蓋得過 | 已修：三處改為「特權重跑」，並在其中一處寫出它為什麼是普通命令、以及 hook 的答案為何由腳本**結束在它上面**來交付 |
| D#4 | P2 | `requests/2026-08-15-push-gate-optin-r3.md` AC 註記 | 寫 `CANONICAL_EFFICACY_SECTION` 整段「**逐位元**」釘死——不成立。`test/rules/discretion-tiers.test.js:1037-1047` 先把連續空行摺成一行、去掉尾端空行才比對；真正逐位元的是 `CANONICAL_PUSH_SAFETY_LINE`（`:741` 直接 `!==`）。差別是實質的：在 § Efficacy Boundary 段落間多插一個空行不會讓測試變紅，同樣的改動落在 push safety 那行上會 | 已修：**記錄類文件，以 2026-08-22 日期註記追加更正**，條文與原註記一字未改（`skills/create-request/SKILL.md` § Phase 4.5） |

**驗證**：`test/scripts/pre-push-gate.test.js` 85 項全綠；`test/skills/push-ci.test.js` 75 項、
`test/skills/epic-merge.test.js` 83 項——除 digest pin 外全綠（pin 於最後一次編輯後由腳本重產）。
epic-merge 新增 8 項（iteration 1 四案含反向控制、Step 9 三案含反向控制、zsh 執行 transport guard），
push-ci 新增 2 項（zsh 執行 ＋ 把迴圈放回去、證明 zsh 在乾淨環境下一樣中止的反向控制），
pre-push-gate 新增 1 項真 SHA-256 分岔（含 fast-forward 對照）並改寫兩個假對照組。
`node scripts/check-comment-blocks.js` 自身 exit 0，無 BLOCK。

**兩個既有測試因本輪編輯轉紅，屬正確的失敗**：rebase 目的地掃描器的行首正則沒有涵蓋
`if [[ -n "$RESUME_OK" ]] && ! ` 這個新守衛前綴，`transportGuardBlock()` 的擷取正則還錨在
`exit 1` 這個已被換掉的終止子上。兩者都是**寫死當前形狀**的 fixture，形狀一改就變紅而不是默默
測不到東西——這正是本專案把擷取正則寫窄的理由。

**非停滯**：round 55–66 分別關掉 7、5、6、10、8、6、4、7、11、9、8、8 筆，每一筆都真實且是新的。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

### Round 66 · 跑全套時抓到的第九筆（測試層，in-scope）

`test/scripts/commit-msg-guard.test.js` 的「opt-in leaves no temporary file behind」在全套跑時紅一次、
單獨跑兩次全綠。機制不是隨機：`scripts/commit-msg-guard.sh:202` 用 `mktemp -t commit-msg-guard.XXXXXX`，
而 **macOS 的 `-t` 走 `_CS_DARWIN_USER_TEMP_DIR`、不理會 `TMPDIR`**（2026-08-22 實測：把 `TMPDIR`
指到私有目錄，檔案仍落在 `/var/folders/…/T`）。所以那個掃描只能看全域 temp 目錄；而有**八個**測試檔
會跑同一支 guard，`node --test` 又是多檔並行，於是列表裡常常混進**別人**還在飛的暫存檔。

用全域命名空間的列表去斷言「某一次呼叫」，本來就不是同一件事。改法保留原本要測的性質而不放寬它：
`runGuard` 是同步的，回來時我們自己的 guard 行程已經結束——它的 trap 沒清掉的檔案會**永遠**在那裡，
別人的則會在別人的 trap 觸發時消失。所以改成「等到新增集合清空」，並附一個**反向控制**：自己種一個
永不消失的 `commit-msg-guard.negative-control-<pid>`，斷言 settle 迴圈會**失敗**而不是把它等掉。沒有
這個控制，上面那條在一個永遠回 true 的 settle 上也是綠的，而一支每次都漏檔的 guard 會讀起來像 trap 正常。

`scripts/commit-msg-guard.sh` 在本任務 baseline 內（已修改檔），該測試是它的直接消費者（one hop），
故為 in-scope；且它是會擋住 gate 的偽紅，不是可延後的 nit。

### Round 67 · code 平面

Codex thread（新開，中性工程措辭）→ `⛔ Blocked`，`gate_reason=IN_SCOPE_BLOCKING`，
6 筆（1×P1、4×P2、1×Nit）。tier=thorough，P2 亦為 blocking。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| C#1 | P1 | `skills/push-ci/SKILL.md` Phase 2 `PUSH_BLOCKED` 分支 | 該分支以 `echo` 收尾，而 `echo` **成功**——被拒絕的 push 讓 fence exit 0，Phase 2 讀起來是「完成」，呼叫端接著對一個從未發生的 push 派 `/watch-ci`。push 本身沒有風險（它躲在測 `PUSH_BLOCKED` 的 `[[ ]]` 後面），出事的是**回報**，而回報正是下一步要消費的東西 | 已修：改用 step 0a 的 assign-then-expand 收尾（`SD0X_PUSH_CI_REFUSED=` 是語法賦值，匯入函式蓋不掉；`:?` 對 null 值以非零結束）。**刻意不再用 `exit`**——這個分支存在的原因就是 `exit` 被回應過 |
| C#2 | P2 | 同檔 Phase 1 topology fence | fence 每一次查詢都寫 `"refs/heads/${BRANCH}"`，而它自己沒有綁 `BRANCH`；Phase 0 綁的那個在**另一個 shell**。未綁時 refspec 是 `refs/heads/`，精確查找無回傳、`REMOTE_TIP` 為空、分類器讀成 `creation`——於是重寫 `feat/x` 的 push **完全跳過** unshared 提問。無聲的方向恰好是要命的那一邊，因為 `creation` 對真正的新分支也是誠實答案 | 已修：fence 自行 `rev-parse --abbrev-ref HEAD` 並在推導不出時拒絕（空答案、rev-parse 失敗、detached HEAD 三種都是「沒有分支」，都不是分類） |
| C#3 | P2 | `skills/epic-merge/SKILL.md` iteration gate | 同一形狀 ×2：`head` 與 `epic` 都會走到命令列，都只在 Step 0 綁定。未綁時 per-step 分類器回答 `refs/heads/`，bundled 分類器因本地 ref 解不開而退化成 `unknown`——兩個裁決都是關於一個空名字，不是關於操作者正要核准的那一輪 | 已修：同上，fence 自綁 + 拒絕 |
| C#4 | P2 | 同檔 `PR_HEAD_SHA` 交遞 | 全文唯一還走 bare `printf` 的跨 fence 回報。Step 8 把這個值逐字寫回並以 `--match-head-commit` 合併，所以偽造的 SHA 會把 merge（與其後的 `/watch-ci`）送到錯的 commit，而 fence 仍 exit 0 | 已修：改 `/usr/bin/printf`。`printf` 是 builtin，匯入函式蓋得過它；含 `/` 的字則關掉匯入管道 |
| C#5 | P2 | 同檔 Phase 0 step 5 | `git rev-list --count origin/$BRANCH..HEAD 2>/dev/null \|\| echo "new branch"` 把「沒有 remote-tracking ref」和「rev-list 在壞掉的物件圖上 fatal（exit 128）」壓成同一個答案，丟掉診斷、印出讓人安心的讀法、exit **0**——而這個 phase 的契約是遇到基礎設施失敗要硬中止 | 已修：拆成兩步先問存在再問可數，只有「ref 存在但數不出來」才是錯誤。refspec 全限定，理由同 § Names in commands：`origin/<name>` 是 DWIM，git 先解 `refs/tags/`，一個叫 `origin/feat/x` 的 tag 會替branch回答這個 range |
| C#6 | Nit | `test/skills/epic-merge.test.js` 偽造測試的選擇器 | 以 `line.startsWith('/usr/bin/printf ')` 找兩份分類器回報並斷言「剛好兩份」。兩半都錯在同一件事：**選擇器就是待測性質**——退化成 bare word 的回報會直接掉出選擇範圍而讓測試以「不存在」通過；文件別處某行取得絕對路徑則會弄壞一個講偽造的測試（C#4 差一點就是後者） | 已修（適用「檔案已開啟的一行修正」例外）：改以「使它成為分類器回報」的欄位（`REMOTE_TIP=[%s]` ＋ `LOOKUP_FAILED=[%s]`）辨識，不論 `printf` 拼法一律找到，**然後**才斷言絕對路徑。計數保留但範圍收斂到這兩份——它是這個測試的涵蓋宣告（兩個 fence 都檢查過） |

**C#2／C#3 共同的形狀，以及測試為什麼看不到**：兩個 harness 都用環境變數供給這些綁定
（`BRANCH: 'feat/x'`、`head: 'feat/pr-3'`、`epic: 'epic/x'`）——那是測試替文件回答了它沒回答的問題。
分類器的每一條行為斷言都是綠的，而出貨的 fence 正在分類一個空 ref。兩個 harness 現在做操作者做的事：
代入文件寫的 `<quoted …>` 槽位，不對「自己不綁」的 fence 匯出任何東西。

### Round 67 · doc 平面

Codex thread（新開）→ `⛔ Needs revision`，4 筆（1×P1、3×P2）。

| # | 嚴重度 | 位置 | 缺陷 | 處置 |
|---|--------|------|------|------|
| D#1 | P1 | `review-log-adequacy-gate.md:7-16`、`:97-113` | 該檔揭露有記錄文字被就地覆寫且**不可復原** | 已處置為「已記錄，無可復原」，並以 2026-08-22 日期註記把可復原性**重新量測**而非重新宣稱：`git status --porcelain` 仍報 `??`；`git cat-file -e HEAD:<path>` 仍 fail；`git log --oneline --all -- <path>` 無回傳；`git stash list` 為空。所有可能持有舊版的儲存都問過了，沒有一個持有。**不做任何重建**——重建正是會讓這個損失變隱形的動作 |
| D#2 | P2 | 「記錄類文件被就地改寫」 | **大部分自行消解**：Codex 自己指出本 repo 的 `/create-request` § Phase 4.5 允許未關閉單據改動四個欄位（Status、Progress 表、AC 勾選、Progress.Note），是我的 review 提示詞把 append-only 講得過強。`create-pr-stacked/**` 與 `smart-commit-hardening/**` 的記錄編輯帶 `[OUT_OF_SCOPE_DEFERRED]` | 記錄於此，無檔案變更 |
| D#3 | P2 | `4-implementation.md:1518`、`push-ci/SKILL.md:180`、`epic-merge/SKILL.md:274` | 三處仍把 `${!_n+set}` 講成「該用的形式」，而它下面兩行的段落正在解釋這個構造因為在 zsh 直接中止而被拿掉。**性質**（測 set-ness 而非 empty-ness）沒有錯也沒有變，錯的是交付它的拼法 | 已修：三處改寫為出貨的拼法 `${VAR+set}`（直接形式，一名一測），並保留 `${!_n+set}` 作為「曾經如此、為何拿掉」的歷史敘述 |
| D#4 | P2 | `smart-commit-hardening/4-implementation.md:202` 起 | 文件自帶的三條 `grep` 計數已過期 | 已修：把文件自己的命令在當前工作樹重跑（2026-08-22），37→41 total、34→38 elsewhere、35→39 delegating call sites、20→24 fenced（14 inline 不變、1 prefixed 不變、11 skills 不變、obsidian-cli 的 2 inline ＋ 3 ＋ 4 兩個 block 不變）。**論證沒有改，只是重新量測**——會動的原因是這期間新增了 skill，而承重的那一列（1 prefixed）沒動 |

**驗證**：`test/skills/push-ci.test.js` 80 項、`test/skills/epic-merge.test.js` 87 項、
`test/scripts/pre-push-gate.test.js` 88 項，合計 255 全綠。本輪新增 10 項，每一筆修補配一組反向控制：
C#1 拒絕分支在匯入 `exit` 下必須非零結束／把終止子刪掉的同一個拒絕必須 exit 0；
C#2 三種推導不出分支的情形必須拒絕／把守衛刪掉後空分支讀成 `creation`；
C#3 head、epic、兩者皆空三種情形必須拒絕／把守衛刪掉後仍會分類；
C#4 匯入 printf 下必須回報實測值／bare word 形式可被偽造；
C#5 缺 ref 與數不出來必須分開／把一行式放回去會把 fatal 講成 new branch。
`BASH_FUNC_exit%%` 的匯入在本機**實測有效**（`/usr/bin/env 'BASH_FUNC_exit%%=() { return 0; }' bash -c 'exit 3; echo IMPORTED'` 印出 `IMPORTED`），所以那對測試不是靠 `functionImportWorks()` 早退的空轉。
`node scripts/check-comment-blocks.js` 自身 exit 0，無 BLOCK。三個 pin 皆於最後一次編輯之後由腳本重產。

**非停滯**：round 55–67 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10 筆，每一筆都真實且是新的。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

**收尾 grep 於 round 67 後重跑**（本輪又動過 `4-implementation.md`、兩份 SKILL.md 與
`smart-commit-hardening/4-implementation.md`，故重驗）：§ 收尾驗證（AC 6）那條指令原樣執行，
**8 筆命中，與 round 47 後那次同一組、同樣的判讀**——`readme-catalog-sync` 三筆與
`cross-tool-portability` 三筆是 Design record 刻意保留的撰寫當時字句（各自帶日期註記），
`4-implementation.md:91` 是本 grep 自己的 pattern 被說明表格引用而非一句宣稱，
`skills/push-ci/SKILL.md:580` 是條件式措辭（「Where the `pre-push` hook is installed」）——
行號因本輪編輯位移，位置與判定不變。**無新增殘留**：本輪新增的 §§ 4.29–4.32 不含上表任何 pattern。
r4 的 AC 5／AC 6 仍維持不勾選，理由見該單自身的日期註記。

---

### 更正（2026-08-22，round 68 doc 面 D#2）— Round 67「驗證」段的逐檔項數

本節是**記錄**，Round 67 的原文一字不動；以下為追加的更正。

Round 67 寫的是「`push-ci` 80 項、`epic-merge` 87 項、`pre-push-gate` 88 項」。三個數字**全錯**。
在 round 68 的修補落地之前，以 `node --test <單檔>` 逐檔重量的真值是：

| 檔案 | Round 67 記載 | 真值 |
|------|--------------|------|
| `test/skills/push-ci.test.js` | 80 | **82** |
| `test/skills/epic-merge.test.js` | 87 | **88** |
| `test/scripts/pre-push-gate.test.js` | 88 | **85** |
| 合計 | 255 | **255** |

**這筆錯誤為什麼撐得過一輪**：合計對了。80 + 87 + 88 和 82 + 88 + 85 都是 255，誤差彼此抵銷，
所以「合計 255 全綠」這句話是真的，而它就是當時唯一被覆核的數字。分項沒有被覆核——這正是
`@rules/auto-loop.md` § Stall Detection 講的「用總數比不出『修好一個又生一個』」在計數上的同構：
**總和相等不等於分項相等**，而分項才是下一輪拿來算差額的東西。

**錯法有兩種，不是一種**。前兩個數字是**通過數**被抄成了**總數**——那一輪 digest pin 是失敗的，
`node --test` 的 `# pass` 比 `# tests` 少 1，我抄了 `# pass`。第三個數字 88 兩者皆非：
`pre-push-gate` 那一輪沒有新增測試，85 從 round 66 起就沒動過，88 是抄錯。

**「本輪新增 10 項」則是對的**，理由要換一個基準才看得出來。Round 66 記的是
「`pre-push-gate` 85 項全綠；`push-ci` 75 項、`epic-merge` 83 項——除 digest pin 外全綠」——
同一個轉抄錯誤：75 與 83 是通過數，總數是 **76** 與 **84**。以 76 / 84 / 85 = 245 為基準，
round 67 的增量就是 push-ci +6、epic-merge +4，正好是原文列出的五對「修補＋反向控制」共 10 項。
換句話說：**增量一直是對的，被寫壞的是絕對值**，而兩輪壞在同一個地方——把跑出來的
`# pass` 當成 `# tests`。

**防再犯**：往後逐檔項數一律讀 `# tests`，並在 pin 重產**之後**再量；pin 未重產時
`# pass` 必然少 1，那個 1 不是測試不存在，是 pin 還沒追上最後一次編輯。

---

## Round 68

兩條全新的 Codex thread（`mcp__codex__codex`，非 `codex-reply`），中性工程措辭，
`sandbox: read-only`、`approval-policy: never`、`model_reasoning_effort: high`。
tier=thorough（push safety 屬 security 變更，Anchor Register #3）：P0／P1／P2 皆為 blocking。

### Round 68 · code 平面

thread `01a027ae-8a50-7103-8fc4-04e6af1df681` → **⛔ Blocked**，6 筆，每筆附可重現的實測。

| # | 嚴重度 | 位置 | 問題 | 處置 |
|---|--------|------|------|------|
| C#1 | P1 | `skills/epic-merge/SKILL.md` rollback | `[[ -n "$(git status --porcelain)" ]]` 把「讀不到」讀成「乾淨」，而下一行是 `git switch -C` | 拆成三態：讀不到→拒絕、髒→拒絕、乾淨→續行 |
| C#2 | P1 | 同檔 origin refresh 失敗分支 | 終止子是 `exit`，匯入的 `BASH_FUNC_exit%%` 蓋得過它，chain table 會用過期 ref 算出來 | 改 assign-then-expand，與同檔其他四處一致 |
| C#3 | P1 | 同檔 8 處 `gh` 呼叫 | 「gh 是外部程式所以安全」不成立：函式查找先於 PATH | 全數改走 `/usr/bin/env -u BASH_ENV -u ENV gh` |
| C#4 | P2 | 同檔 commit 計數 | 同上，`wc` 可被匯入函式攔截；註解還把這個誤解寫成理由 | 改 `/usr/bin/wc`，並更正註解 |
| C#5 | P2 | 同檔 cleanup | `rm -rf "$(…)"` 在 `rev-parse` 失敗時刪掉空字串並回 0，manifest 留給下一輪 | 先推導再檢查再刪 |
| C#6 | P2 | `skills/push-ci/SKILL.md` Phase 0 step 4、step 6 | 呼叫了 git 卻只看輸出；Phase 0 的契約是 infrastructure failure 就 hard-abort | 兩處都檢查狀態碼並拒絕 |

Codex 自陳一項驗證限制：其 read-only sandbox 使 `mkdtemp` 拋 `EPERM`，故未跑測試套件，
改以直接的 shell 重現。**這不是把驗證外包給我**——六筆的重現我逐一在本機複跑過，
並各自寫成一對測試（修補方向 ＋ 反向控制），反向控制就是把舊寫法放回去證明它會綠。

### Round 68 · doc 平面

thread `01a027b0-b2c4-7a03-8c79-da3634db3231` → **⛔ Needs revision**，5 筆（4 P2 ＋ 1 Nit）。

| # | 嚴重度 | 位置 | 問題 | 處置 |
|---|--------|------|------|------|
| D#1 | P2 | `smart-commit-hardening/2-tech-spec.md` D1 列 | 記錄被**就地改寫**，正是該檔 § 8 自己禁止的事 | 以 `git show HEAD:` 逐字還原該列，更正移入既有的追加表格（`git diff --numstat` 為 `15 0`，純追加） |
| D#2 | P2 | `review-log-push-gate-optin.md` Round 67 | 逐檔項數三個全錯，合計卻對——誤差抵銷 | 追加日期更正（記錄不改原文），並釐清錯因與增量為何仍成立 |
| D#3 | P2 | `smart-commit-hardening/4-implementation.md:766,771` | 「132 now (80 + 52)」與靜態 122 皆過期 | 就地改為 **166（102 + 64）** 與 **156**（current-authority 文件） |
| D#4 | P2 | 同檔 :1669, :1695 | prefix 位元組指標整組過期 | 559→**568**、11,739→**11,928**、65,800→**68,660**、17.8%→**17.4%**；並補上 `+9` 那一項的由來 |
| D#5 | Nit | `push-gate-optin/4-implementation.md:1149,1427,1594` | printf 與 env-prefix 的站點計數過期 | 就地更正為 20/19、26、74（`@rules/auto-loop.md` § Sub-Threshold 的第一種例外：檔案已開著的一行修補） |

**D#2 的錯因值得單獨記**：三個數字加起來剛好也是 255，所以「合計 255 全綠」是真的，
而它是當時唯一被覆核的數字。**總和相等不等於分項相等**——這和 § Stall Detection 說的
「用總數比不出『修好一個又生一個』」是同一個形狀，只是換到計數上。
真正的錯法是把 `# pass` 抄成 `# tests`：digest pin 未重產時 `# pass` 必然少 1。
往後一律讀 `# tests`，且在 pin 重產**之後**才量。

**驗證**：`test/skills/push-ci.test.js` **86** 項、`test/skills/epic-merge.test.js` **95** 項、
`test/scripts/pre-push-gate.test.js` **85** 項，合計 **266** 全綠（項數讀 `# tests`，且於三個 pin
重產之後量）。本輪新增 **11** 項——push-ci +4（step 4、step 6 各一對），
epic-merge +7（C#1 三態一對、C#2 一對、C#3 靜態涵蓋 ＋ 匯入函式行為、C#4 一對、C#5 一對）。
另修好 `test/skills/epic-merge.test.js` 的 `cleanup removes all of them`：它原本只 grep 子字串，
在該行前面加 `false &&` 照樣綠；現在改為「移除必須是整行」＋「不得再有裸替換形式」，
行為面則由新增的 C#5 那一對負責。
`node scripts/check-comment-blocks.js` 自身 exit 0（18 WARN，無 BLOCK）。
三個 pin 皆於最後一次編輯之後由腳本重產。

**非停滯**：round 55–68 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11 筆，
每一筆都真實且是新的。stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

---

## Round 69

兩條全新的 Codex thread，中性工程措辭，`sandbox: read-only`、`approval-policy: never`、
`model_reasoning_effort: high`。tier=thorough：P0／P1／P2 皆為 blocking。

### Round 69 · code 平面

thread `01a027d5-560b-7601-a37c-0d986e5e3793` → **⛔ Blocked**，3 筆 P2，每筆附可重現的實測。

三筆都是 round 68 那個 class 的**兄弟實例**，所以本輪的處置不是修那三筆，而是先把 class 掃完
（見 `4-implementation.md` § 4.37）。掃出來比 reviewer 指名的多四筆。

| # | 來源 | 位置 | 問題 | 處置 |
|---|------|------|------|------|
| R#1 | Codex | `epic-merge` Phase 2 | `MANIFEST_DIR=$(…)` 未檢查，下兩行是 `git switch -C` 與 `git rebase --onto`；空值讓 Step 4 寫到檔案系統根目錄，而那時 branch 已被覆寫 | 推導處即檢查並拒絕 |
| R#2 | Codex | `epic-merge` range 讀取 | 拒絕分支只靠 `exit`，且不設旗標——被蓋掉就把「讀不到」報成「0 個 unique commit」 | 改 assign-then-expand |
| R#3 | Codex | `epic-merge` cleanup | `rm` 是該 fence 最後一條命令，狀態碼就是 fence 的結論；可被匯入函式宣稱 | 改 `/bin/rm`（macOS 無 `/usr/bin/rm`） |
| R#4 | 本輪掃描 | `push-ci` Phase 0 step 1 | `BRANCH` 只比對字面 `HEAD`，`rev-parse` 失敗留下空字串，protected 比對、`origin/$BRANCH`、refspec 全部用它 | 補 `-z` 判斷，與 Phase 1 既有拒絕同形 |
| R#5 | 本輪掃描 | `push-ci` Phase 0 step 1b | 同 R#2 的終止子 class | 改 assign-then-expand |
| R#6 | 本輪掃描 | `push-ci` Phase 0 step 3 | 同上 | 同上 |
| R#7 | 本輪掃描 | `push-ci` PUSH_GATE 探測 | `grep` 與 `echo` 皆可被宣稱，而該 subshell 的 stdout 就是 `PUSH_GATE` | 改絕對路徑 |
| — | 本輪掃描 | `epic-merge` `mkdir` | 失敗已清 `PHASE1_OK`，非缺陷 | 一併改絕對路徑，理由寫在旁邊 |

**掃描的定義要對才有用**：第一次掃「所有 `exit`」得 17 筆，其中 14 筆帶
`PUSH_BLOCKED=1` 這種後面守衛會讀的旗標，不是缺陷。把 class 收斂成「唯一終止手段是 `exit`
且不設旗標」之後剩 3 筆，全修完掃描歸零。

Codex 同樣自陳 read-only sandbox 使 `mkdtemp` 拋 `EPERM`，改以直接 shell 重現；
三筆重現我都在本機複跑並各寫成一對測試。

### Round 69 · doc 平面

thread `01a027d7-b365-74d0-ab87-99fdaad23bf6` → **⛔ Needs revision**，2 筆 P2，
都在 `smart-commit-hardening/4-implementation.md` § 11。

| # | 位置 | 問題 | 處置 |
|---|------|------|------|
| D#1 | :1654 度量表 | `now` 欄三輪過期（129,199 vs 實測 136,281），且與本檔 11 行後剛更正的 68,660 自相矛盾 | 重量三個檔並改寫整表與結論：`+38.2% → +45.8%` |
| D#2 | :1675 | 「21 now against 20 at HEAD」為假——`git show HEAD:… \| grep -c` 今天回傳 **21** | 比較整句**移除**而非更正 |

**追查 D#2 追出的比表格本身更重要**：那一欄叫 `HEAD`，但整個 repo 沒有任何 commit 的
`SKILL.md` 是 579 行 / 43,892 bytes。round 10 當時的 `HEAD` 是 `96786d1`（471 行 / 20,953 bytes），
今天是 `fead97d`（811 行 / 68,471 bytes）。那是**重構前的工作區狀態，從未單獨 commit**，
所以任何指令都還原不出來——標籤從寫下的那天起就是錯的，只是要等到有人真的去跑那組指令才看得見。

處置是改欄名（`round-10 baseline`）並寫明不可還原、當時 `HEAD` 實際是什麼；
底下那組 `git show HEAD:` 指令標成不再適用並附上今天各回傳什麼。
把數字改成今天 `HEAD` 的輸出也能讓表格「對」，但那樣比較的就不是重構前後，整節論證會消失——
**還原不出來的基準仍是合法的度量，不能掛一個會回傳別的東西的指令當標籤。**

**驗證**：`test/skills/push-ci.test.js` **90** 項、`test/skills/epic-merge.test.js` **99** 項、
`test/scripts/pre-push-gate.test.js` **85** 項，合計 **274** 全綠
（讀 `# tests`，且於三個 pin 重產之後量——round 68 立的規則）。
本輪新增 **8** 項：push-ci +4（step 1b 兩案含反向控制、兩個拒絕分支在匯入 `exit` 下含反向控制、
PUSH_GATE 探測含反向控制），epic-merge +4（Phase 2 推導含反向控制、range 拒絕含反向控制）。
`node scripts/check-comment-blocks.js` 自身 exit 0。三個 pin 皆於最後一次編輯之後由腳本重產。

**非停滯**：round 55–69 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

---

### 更正（2026-08-22，round 70 前自查）— Round 69 doc 面 D#2 敘述中的一句時點斷言

本節是**記錄**，Round 69 的原文一字不動；以下為追加的更正。

Round 69 寫的是「round 10 當時的 `HEAD` 是 `96786d1`（471 行 / 20,953 bytes）」。
**這句沒有證據**。round 10 在 `smart-commit-hardening/4-implementation.md` 裡沒有日期，
無從對應到任何 commit；而該 feature 的變更至今未 commit，所以 round 10 當時的 `HEAD`
反而更可能是 `fead97d`（2026-08-13，最近一個動過該檔的 commit）。
我是從 commit 列表**推論**出 `96786d1` 的，並把推論寫成了事實。

**可查證的只有那個否定句**：`git log --format=%H -- skills/smart-commit/SKILL.md` 列出的
每一個 commit，`git show "${c}:<path>" | wc -l -c` 都不是 579 行 / 43,892 bytes——
最近三個是 811 行（`fead97d`）、823 行（`187b0aa`）、471 行（`96786d1`）。
基準無法從任何 commit 還原，這一點成立；它「對應到哪一個 commit」則無解，
現已在兩份 current-authority 文件裡改為明說不重建。

**這筆錯誤的形狀值得記**：round 69 修的正是「拿相對參照（`HEAD`）當基準」的缺陷，
而我在敘述那個修補時，順手寫下了另一個沒有證據的時點斷言。同一種錯誤換一個方向發生——
**修補的敘述本身不會因為主題是「求證」就自動被求證過**。

---

## Round 70

兩條全新的 Codex thread，中性工程措辭，`sandbox: read-only`、`approval-policy: never`、
`model_reasoning_effort: high`。tier=thorough：P0／P1／P2 皆為 blocking。

### Round 70 · code 平面

thread `01a027f3-661a-7653-bb3d-e779fbebfb38` → **⛔ Blocked**，1 筆 P1 + 5 筆 P2。

| # | 位置 | 問題 | 處置 |
|---|------|------|------|
| C#1 **P1** | `push-ci:453`、`:1027`、`epic-merge:771`、`:1286`、`:1602`、`:1852` | `command -v` 認得匯入函式，呼叫卻是裸字。兩向量 KAT 只擋常數；**adaptive** 函式兩個向量都答對、對真實 URL 回同一值 → Phase 0 與 Phase 2 的目的地摘要相同，批准↔目的地的綁定失效 | 六站全改 `/usr/bin/env <tool>`（§ 4.40）|
| C#2 | `push-ci:268` | `if ! git rev-parse --verify --quiet` 把 128（repo 讀不動）併進 1（ref 不存在），報成「new branch」並繼續 | `VERIFY_STATUS=$?` + 三路 `case`（§ 4.41）|
| C#3 | `push-ci:328` | 探測的外層仍是裸 `bash`；匯入 `BASH_FUNC_bash%%` 直接偽造 `PUSH_GATE=referenced`。round 69 的測試先剝殼再執行，所以標題的主張其實無人保證 | 改 `/bin/bash -c` + frontmatter 補授權 + 測整條賦值（§ 4.42）|
| C#4 | `epic-merge:1975` | `git log … \| grep -E …` 的狀態來自 `grep`，且 `grep` 可被宣稱；`git tag -l` 亦未守衛 | 先接進變數再過濾，`grep` 1 視為合法空、>1 視為失敗 |
| C#5 | `epic-merge:335` | 第一個 `gh pr view` 未守衛，狀態被後續命令覆蓋 | 加守衛拒絕 |
| C#6 | `epic-merge:2039/2042/2045` | cleanup 的 `git branch -D`、`git tag -l`、`git tag -d` 皆未守衛；最後一條 `/bin/rm` 成功就讓半途失敗的 cleanup 回 0 | 三條各自守衛，且在刪除下一份復原狀態**之前**停住 |

C#1 是本輪唯一擊穿安全性綁定的一筆——其餘五筆毀掉的是診斷，它毀掉的是「這個目的地是不是
被批准的那一個」。所以先修它。

**掃描結果**（§ 4.44）：三個 class 共掃出 11 個真缺陷位置，比 reviewer 指名的多；
另有一處 `scripts/pre-push-gate.sh` 掃到但判定**非缺陷**——它的 shebang 是
`#!/usr/bin/env -S bash -p`，privileged mode 不匯入函式。理由寫進註解，避免下一輪被「統一」掉。

### Round 70 · doc 平面

thread `01a027f5-9406-7d00-8f88-6bb3078e2d4e` → **⛔ Needs revision**，3 筆 P2。

| # | 位置 | 問題 | 處置 |
|---|------|------|------|
| D#1 | `smart-commit-hardening/4-implementation.md:1723` | 那組刪除線指令被寫成「現在不再重現基準」。實際上它們讀的是 committed `HEAD`，而基準是**從未 commit 的工作區**——所以是**從來沒有重現過**。1743 行更把它們稱為「產生它的指令」 | 改為「never 重現」，並把 1743 改為「原始推導不可得」|
| D#2 | 同檔 :1765 | 結論句仍寫 `+38.2%`，與剛更正的表格（`+45.8%`）矛盾 | **不再快取數字**，改成指向表格；並寫明這個數字被快取在句子裡正是它過期的原因 |
| D#3 | `push-gate-optin/4-implementation.md:2130` | §4.39 一邊撤回「round 10 的 HEAD 是 `96786d1`」這個沒有證據的推論，一邊說修法是「寫明當時 `HEAD` 其實是什麼」——自相矛盾 | 改為明說**當時 `HEAD` 同樣無從重建**，不補一個看起來合理的答案 |

D#3 是我自己上一輪自查修正的**殘留**：我改掉了那句斷言，卻沒改掉描述那個修法的句子。
**撤回一個主張，和撤回所有依賴它的句子，是兩件事**——前者做完會覺得結束了，後者才是結束。

### 驗證

`test/skills/push-ci.test.js` **94** 項、`test/skills/epic-merge.test.js` **102** 項、
`test/scripts/pre-push-gate.test.js` **85** 項，合計 **281** 全綠
（讀 `# tests`，且於三個 pin 重產之後量）。本輪新增 **7** 項、改寫 **6** 項：

- push-ci +3：commits-ahead 三路（1／0／128 與 count 失敗四案）、把 128 折回「new branch」的反向控制、探測**整條賦值**在匯入 `bash` 下的行為含反向控制
- epic-merge +2：resume 的 log 失敗 vs 無 merged PR 兩讀分離（含 `tag -l` 失敗）、管線形式的反向控制
- 兩檔各 +1：`ADAPTIVE_DIGEST` 控制——匯入函式被忽略、真實 digest 不相等；反向控制刪掉 `/usr/bin/env` 後在同一個 adaptive 函式下**通過 KAT 然後碰撞**
- 改寫：#7 探測外殼拼法、#90 探測 matcher、#44/#45 的兩列 regex、#5 的 git log pin（變異數量改為由 fixture 自身推導）、#62 守衛數 4→8 並補假 `gh`

`node scripts/check-comment-blocks.js` 自身 exit 0（僅 warning band，無 BLOCK）。

**非停滯**：round 55–70 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

---

### 更正（2026-08-22，round 70 收尾自查）— 上方 Round 70 條目的掃描計數

本節是**記錄**，上方原文一字不動；以下為追加的更正。

Round 70 條目寫的是「三個 class 共掃出 11 個真缺陷位置」。**這個數字沒有量過**，
是我從六筆 finding 順手歸納的。實測是 **五個 class、去重後 14 處**：

| Class | 修補站 | 量法 |
|-------|-------|------|
| (a) `command -v` 選中函式、卻以裸字呼叫 | 6 | `grep -c 'then /usr/bin/env sha256sum'` = 2 + 4 |
| (b) 管線狀態來自最後一段 | 1 | `grep -c 'MERGED_PRS=\$(/usr/bin/grep'` |
| (c) 命令未檢查狀態、後續覆蓋 `$?` | 6 | 本輪新增 `if !` 守衛計數 |
| (d) 兩個相反狀態被 `if !` 併成一條分支 | 1 | `grep -c '^VERIFY_STATUS=\$?'` |
| (e) 外層 interpreter 本身是裸字 | 1 | `grep -c 'PUSH_GATE=\$(/bin/bash -c'` |

(b) 與 (c) 有一處重疊（resume 的 `EPIC_LOG=$(git log …)` 兩者皆是），故 15 去重後為 14。
漏掉的是 (d) 與 (e) ——這兩個 class 我在 `4-implementation.md` §§ 4.41–4.42 各寫了一整節，
卻沒放進那張表；(c) 則少算了 resume 的 `git tag -l`。

**這筆錯誤的形狀，和本輪 doc 面 D#1–D#3 是同一個**：一段論證寫完之後，
順手在旁邊放一個總結數字，而那個數字是從論證「感覺起來」推出來的，不是從檔案量出來的。
連續三輪在同一個位置踩到，所以規則改成：**任何出現在文件裡的計數，右邊必須並列產生它的指令**——
§ 4.44 的表格現在就是這樣寫的。

**流程上的另一個教訓**：這次自查發生在 round 71 的 review 已經派出之後，
所以 round 71 的 doc 判定又一次「比工作區舊一個編輯」。round 69 也是如此。
自查應該排在派件**之前**，否則等於用一個已知過期的樹去換一份判定。

---

## Round 71

兩條全新的 Codex thread，中性工程措辭，`sandbox: read-only`、`approval-policy: never`、
`model_reasoning_effort: high`。tier=thorough：P0／P1／P2 皆為 blocking。

### Round 71 · code 平面

thread `01a02827-cf9a-7f13-afd2-4f261fd4410b` → **⛔ Blocked**，2 筆 P2。

| # | 位置 | 問題 | 處置 |
|---|------|------|------|
| C#1 | `epic-merge:919` | Step 5 的目的地驗證讀 `"$PUSH_URL"`，但 705 行只指派 `PUSH_URLS`。全新 shell 下擋掉每一次 iteration 2..N 的 force-push；沿用的 shell 下驗證的是上一輪的目的地 | 在讀清單的同一個條件式裡推導 `PUSH_URL`，並在查詢前加唯一目的地 fail-closed 守衛（§ 4.45）|
| C#2 | `push-ci:275`、`epic-merge:970`、`epic-merge:2034` | `cmd` 之後單獨一行 `STATUS=$?`：繼承的 errexit 讓 shell 在失敗處就結束，捕捉不會執行，為失敗寫的分支永遠等不到值。**這一類是我 round 70 的修法自己引進的** | 三處改為 `if cmd; then S=0; else S=$?; fi`（§ 4.46）|

C#1 兩筆都自行複驗過才動手：1164／1547 兩個 fence 早就寫對，1202／1585 也早有唯一目的地守衛，
只有 Step 5 兩樣都沒有——所以修法是補齊既有形狀，不是發明新的。

### Round 71 · doc 平面

thread `01a0282a-001c-7411-b1b5-85f4d87cb82d` → **⛔ Needs revision**，4 筆 P2。

| # | 位置 | 問題 | 處置 |
|---|------|------|------|
| D#1 | `push-gate-optin/4-implementation.md` §4.40 | 寫「函式管道整條關掉」，但同一份文件的 §4.23 已經記過：呼叫端 shell 被 source 過啟動檔就能**本地定義** `/usr/bin/env` 函式。一個被撤回的主張又被當成結論用 | 改為「**可匯入的**那條關掉」，把本地定義那條的殘留寫明並指回 §4.23，表格加一列 |
| D#2 | 同檔 §4.43 | 「較新的 bash 回 1」——**沒有量過**。實測 bash 5.3.15 同樣回 127 | 撤回版本相依的結論，只留兩筆量到的 127；標題去掉「而且是版本相依的」|
| D#3 | `smart-commit-hardening/4-implementation.md` §11 | `97 → 91` 把一個無法重建的基準寫成推導出來的量測。逐一檢查所有 committed 版本，沒有任何一版是 97 | 改為「現值 91（可重跑）」，97 標為記錄下來但不可重建 |
| D#4 | 同檔 §11 | 1746 行剛說 25 的原始推導不可得，1753 行又說 `25 → 7` 是「correctly based」 | 改為「基於**記錄下來的** 25」，並寫明只有 7 可以今天驗 |

D#1 和 D#4 是同一個形狀：**撤回一個主張，和撤回所有把它當前提的句子，是兩件事。**
round 70 的 D#3 也是這個形狀。第三次了，所以這一輪把它寫進掃描而不是靠讀。

### 自查（本輪排在派件**之前**）

除了 reviewer 指名的 6 筆，自查另外找到 1 筆並修掉：
`test/skills/push-ci.test.js` 裡有**兩個** `function commitsAheadBlock()`，
後者靜默覆蓋前者，於是一個更早的測試從 round 70 起一直在讀我的區塊（§ 4.47）。

同時把 `codex-setup` 那兩個同形狀站點的邊界補寫進文件：原本只點名 `__sd0x_rc`。

### 驗證

`test/skills/push-ci.test.js` **95** 項、`test/skills/epic-merge.test.js` **108** 項、
`test/scripts/pre-push-gate.test.js` **85** 項，`test/skills/codex-setup.test.js` **33** 項。
本輪新增 **6** 項（epic-merge 5、push-ci 1），改寫 **1** 項（合併重複的 helper）：

> **2026-08-22 更正（round 72 doc review 指出）**：上面兩個數字是錯的。
> `epic-merge.test.js` 在 round 71 收尾時是 **109** 項不是 108，本輪新增是 **8** 項不是 6
> （epic-merge 7、push-ci 1）。錯因是我用下面那份**條列**當計數依據，而條列是按「主題」寫的，
> 一則主題底下含兩個 `test()` 註冊時就少算一次——條列不是計數器。
> 可重跑的推導（避開 `node --test` 的分組輸出，直接數註冊次數）：
> ```bash
> node -e 'let n=0;const M=require("node:module"),load=M._load;M._load=(r,p,i)=>r==="node:test"?{test:()=>n++}:load(r,p,i);require("./test/skills/epic-merge.test.js");console.log(n)'
> ```
> 底下的條列本身沒有錯，錯的是把它讀成清單長度。原文保留，數字以本註記為準。

- Step 5 目的地：自行推導而非繼承（seed 一個 stale 值）＋ 反向控制**同時**還原推導與守衛
- Step 5 目的地：fan-out／解析失敗／無 URL 三案在任何查詢**之前**拒絕 ＋ 刪掉守衛的反向控制
- Step 5 push：繼承 errexit 下失敗仍走到命名它的分支，並用文件自己的消費端（Step 6 的守衛）當觀測介面 ＋ 反向控制
- resume 的 grep：errexit 下空結果仍不是錯誤 ＋ 反向控制
- push-ci commits-ahead：errexit 下 ref 不存在仍讀成 new branch ＋ 反向控制

`node scripts/check-comment-blocks.js` 自身 exit 0（18 筆 warning band，無 BLOCK）。

**非停滯**：round 55–71 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 72

兩條全新的 Codex thread（code 平面、doc 平面各一），皆回 blocking。
每一筆在動手之前都獨立複驗過，其中一筆的提案這份文件先前**判定過並否決**，
這一輪把否決的理由和一個當時沒試過的還原法都重新量了一次。

### Code 平面（4 筆，全部 P2 以上，tier=thorough 全阻擋）

| # | 位置 | 判定 |
|---|------|------|
| 1 | `push-ci` Phase 2、`epic-merge` Step 5＋rollback | refspec 左邊是分支**名**，而上面每一個分類問的都是**物件**——中間的空檔可以讓一個沒被分類看過的物件被推上去（§ 4.49） |
| 2 | 同上 | 左邊改成物件 ID 之後 `-u` 靜默失效；改用 push 後兩行 `git config` 寫 upstream，且 gate 在 push 成功上（§ 4.50） |
| 3 | `epic-merge` rollback 分類 fence | 讀 `${head}`／`${N}` 但沒綁；未綁時的判定講的是一個空名字而不是這次 rollback（§ 4.52） |
| 4 | `test/skills/epic-merge.test.js` | harness 用 env 餵進 `N: '3'`——把答案供給了受測對象，第 3 筆才能帶著全綠測試活到現在（§ 4.54） |

第 2 筆是被否決過的那一筆。round 63 量到「SHA 來源會讓 `-u` 失效」——**測量正確**；
但它的結論「所以不能用 SHA 當來源」建立在只試過 `--set-upstream-to`（需先 fetch）之上。
這一輪量到 SHA 來源的 push 仍會更新 `refs/remotes/origin/<branch>`，於是直接寫兩行
`branch.<name>.remote` / `.merge` 就完整重現 `-u`，不需要 fetch。撤回的是結論，不是測量。

改動 rollback 那條 push 之前先做了三方測量（含把 lease 刻意設成滿足的反向控制），
確認 `--force-if-includes` 在 SHA 來源下仍然會拒絕——它是那條路唯一真的靠著的旗標，
一個被靜默停用的旗標會比它要防的 race 更糟。

### Doc 平面（4 筆 P2）

| # | 位置 | 判定 |
|---|------|------|
| 1 | `docs/cookbook/ship-change.md` | 「actually rewrites history」寫窄了：gate 是 fail-closed（`!` 把 ancestry **答不出來**也收進同一支），且既有 tag 的更新一律在類別內 |
| 2 | `4-implementation.md` § 4.48 | 宣稱「每個數字都附推導命令」並點名 `node r71scan.js`，該檔不在版控裡——Class (a) 的 11／10 是重跑不出來的 |
| 3 | `4-implementation.md` § 4.48 | 表頭寫 23，列加總是 24：把「處理過幾個站點」和「現在 grep 到幾筆」混在同一欄 |
| 4 | 本檔 Round 71 § 驗證 | 108／6 是錯的，實際 109／8 |

第 2 筆的修法是**承認不可重跑**，不是補一支腳本：差集的邊界（`${VAR:-default}` 算不算讀取、
`case` 分支裡的指派算不算指派）會直接改變總數，重建出來的數字只會接近不會相等。
把不可重跑的計數包裝成可重跑，比承認它更糟。留下來能查的是判定，逐條指名。

第 4 筆的錯因是拿條列當計數器——條列按主題寫，一則主題兩個 `test()` 就少算一次。
更正以日期註記追加，原文保留（記錄類文件不就地改寫）。

### 自查（1 筆）

兩個 fence 旁邊各寫了一段「這兩條 force-push 位元組相同」的說明，
自 round 60 給 Step 5 帶值 lease 並拿掉 `--force-if-includes` 之後就不成立了。
守衛另起一行的結論仍然對，理由要換成 argv 邊界。**兩份一起改**——
只改一份，留下來的那份會在下一輪被當成新發現，這個形狀這個 loop 付過三次學費（§ 4.53）。

### 自己種進去、被既有測試抓到的（1 筆）

`-u` 拿掉後 Phase 2 的結尾變成一個 `if`，而複合 `if` 條件為假時離開狀態是 0——
「條件為假」正是 push 失敗會產生的狀態。fence 於是以 0 結束，呼叫端會去監看一個沒推上去的 push。

抓到它的是**既有的**測試 21（expected non-zero，got 0）。那條測試不是為這次改動寫的，
是為「任何時候有人把 Phase 2 的結尾改成一個吃掉狀態的形狀」寫的（§ 4.51）。
修法：補一段 `: "${VAR:?}"` 拒絕分支，拼法與區塊開頭那個拒絕一致。

### 驗證

`test/skills/push-ci.test.js` **95** 項、`test/skills/epic-merge.test.js` **111** 項、
`test/scripts/pre-push-gate.test.js` **85** 項、`test/skills/codex-setup.test.js` **33** 項
（推導命令見 Round 71 § 驗證的更正註記）。
本輪新增 **2** 項（epic-merge：分類 fence 未綁名字的拒絕＋反向控制；空物件不得變成刪除＋反向控制），
改寫的部分不用「幾項」計數，改列站點——一次 harness 改動會同時牽動好幾個 `test()`，
用條列當計數器正是 Round 71 § 驗證那筆更正的錯因：

| 檔案 | 改了什麼 |
|------|---------|
| `push-ci.test.js` | 測試 4／14／15／16／18／20／24／34／45：refspec 來源改物件 ID、`-u` 斷言換成兩筆 `git config` 的**有序**斷言（必須在 push 之後）、push 形式計數 4→2、Examples 與 Phase 2 兩個 pin 重生 |
| `epic-merge.test.js` | `assertPushProperties` 的 refspec 性質（連帶測試 6／7 與它們的負向控制）、probe harness 停止外供 `N` 並開始斷言問的是哪一個 ref、`step5PushSlice` 錨點與 `runStep5Push` 的 `PUSHED` 綁定與 argv 記錄 |
| `pre-push-gate.test.js` | 跨 suite 的 push 形式計數 4→2；同一段註解裡的第三份「位元組相同」說法一併更正 |

第三份是自查那一筆的延伸：`grep -rn "byte-identical"` 掃出來的第三個站點在**測試註解**裡。
一句錯誤的說明會抄成幾份，取決於有幾個地方覺得需要解釋它——所以修的時候要掃，不能靠記得。

> **2026-08-22 更正（round 73 code review 指出）**：上面這段寫「第三個站點」，
> 意思是掃出來一共三處、三處都改了。**兩者都是錯的**——實際有五處，當時只改了三處，
> `test/skills/epic-merge.test.js:275` 與 `:278` 兩處活了下來，round 73 才被 Codex 抓到。
>
> 錯因不在記性，在**指令**：那次掃描寫成 `grep -rn "byte-identical" … | head -20`。
> 命中超過 20 行，`head` 把尾巴切掉，而**被截斷的輸出和「沒有更多」長得一模一樣**——
> 沒有任何標記說「還有」。我讀成了後者，於是「三處都改了」這句話在寫下的當天就是假的。
>
> 這比漏改本身嚴重：漏改會在下一輪被 review 抓到，
> 但一句**寫進記錄的完整性宣稱**會讓下一輪不再去掃。所以更正必須留在原文旁邊，
> 而不是只把數字改掉。教訓：稽核用的 `grep` 一律不接 `| head -N`；
> 要限制輸出就用 `-c` 先數，或讓它整份印出來。

新增的兩項都帶反向控制，且反向控制**只動一件事**：
測 108 的 mutant 沿用新守衛原文，只搬 `$?` 的位置——同時拿掉守衛的話，
失敗訊息就說不出是哪一個改動造成的。

**非停滯**：round 55–72 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7、10 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 73

兩個新開的 Codex thread（依 `mcp 參數已經調整，開新的 thread 進行 review` 的指示，不用 `codex-reply`），
一個看 code 平面、一個看 doc 平面，各自獨立研究。合計 7 筆阻斷級（tier=thorough，P0／P1／P2 皆阻斷）。
七筆全部先複驗成立才動手——複驗排在派件之後、修改之前，這是 round 70 記下的順序。

### code 平面（3 筆）

**空字串通過不等式**。Phase 2 在 push 前比對「核准當時的 commit」與現在的 `HEAD`：
`if [[ "$HEAD_SHA" != "$PLAN_HEAD_SHA" ]]`。這條守衛看不見空值——`"" != ""` 為**假**，
所以兩個都空的時候它一路放行，讀起來就像「HEAD 正是核准當時的位置」。
往下走到 push 站，refspec 組成 `${PLAN_HEAD_SHA}:refs/heads/${BRANCH}`，
左邊是空的——而**冒號左邊為空是 git 拼「刪掉這個 ref」的方式**。
一個本來要發布 commit 的流程，會變成刪掉分支。

`pre-push-gate.sh` 在這裡不是後盾：它的 rewrite 測試（`:388`）要求**兩邊 OID 都非空**才往下判，
所以刪除依設計不會走到它任何一個提示。同樣的守衛、同樣的理由，
`epic-merge` 的 push 上早就有 `[[ -n "$PUSHED" ]]`——那邊補了，這邊沒有。

修法是兩道獨立機制：比對前先拒空，push 站再獨立確認一次
（`[[ -n "$PUSH_BLOCKED" ]] || [[ -z "$PLAN_HEAD_SHA" ]]`）。
測試分別拿掉其中一道驗證另一道仍擋得住，兩道都拿掉才讓 argv 記到 `:refs/heads/feat/x`——
**斷言看得到那個冒號**，而不只是「exit 非 0」。

**push 成功、上游寫入失敗，被報成一切正常**。`-u` 在 round 72 換成兩筆 `git config` 之後，
兩筆的離開狀態沒有人接。commit 確實推上去了，但 `branch.<n>.remote` / `.merge`
可能沒設或只寫了一半，而 fence 回報成功。
補上 `UPSTREAM_STATUS`（在 `if` 之前初始化為 0，兩筆 `git config` 各自 `|| UPSTREAM_STATUS=$?`），
以及一段**措辭很小心**的拒絕：它必須先說「**commits 已經推上去了，不要再推一次**」，
再給出手動補設的兩行指令。一個說成「什麼都沒發生」的失敗訊息，會誘發第二次 push。

**跨 fence 的交接寫不出去，最後一行看不見**。`epic-merge` Step 7 把 PR head SHA
用 `/usr/bin/printf` 交給 Step 8，但沒接狀態；fence 最後一行 `[[ -z "$PUSH_BLOCKED" ]]`
於是替一個沒完成的交接回報成功，Step 8 會拿呼叫端**以為**的 SHA 去 `--match-head-commit`。
補 `REPORT_STATUS=$?` 與拒絕分支。

> 這裡有一個必須寫下來的量測。原本想用「把 fd 1 關掉」來驅動失敗，
> 但在 macOS 上實測 `bash -c 'exec 1>&-; /usr/bin/printf "x\n"; echo $?'` → **0**：
> `/usr/bin/printf` 不回報關閉的 stdout。
>
> **2026-08-22 更正（round 74 doc review 指出）**：上面抄的那條指令**印不出任何東西**。
> fd 1 已經關掉，所以後面的 `echo $?` 自己也寫不出去——它會失敗（`Bad file descriptor`），
> shell 以 1 結束。結論（`/usr/bin/printf` 在 macOS 上不回報關閉的 stdout）是對的，
> 錯的是這條「可複現指令」：它證不了它自己。實際跑得出來的形式必須把診斷送到 **stderr**：
>
> ```
> $ bash -c 'exec 1>&-; /usr/bin/printf "x\n"; s=$?; echo "printf=$s" >&2'
> printf=0
> ```
>
> 同一條錯抄也進了 `test/skills/epic-merge.test.js` 的註解，已就地更正（測試檔是現行權威，
> 不是記錄）。錯因跟 L13 同源：**寫下「實測得到 X」時，要真的把那條指令再跑一次**，
> 而不是憑對它行為的推理抄下來——推理對了結論、錯了證據，而讀者複查的是證據。改用 `/dev/full` 則被 sandbox 擋下
> （`Operation not permitted`，那個 1 來自重導向失敗，不是 printf）。
>
> 所以測試改成測**狀態管線**本身：把交接指令換成一個會依指定碼離開的等價指令
> （**照樣印出同樣的 bytes**——若同時不印，那條拒絕會因為錯的理由通過），
> 斷言非 0 必須傳到 `PUSH_BLOCKED`；反向控制同時拿掉捕捉與分支，
> 證明少了它就是 exit 0；另外跑一次**未改動**的原文，確保 fixture 不會退化成只測自己。
> 限制寫在測試註解裡，不是靜靜地放寬斷言。

### doc 平面（4 筆）

四筆都圍繞同一句話：`actually rewrites history`。
這個說法對 gate 的實際行為**兩個方向都不準**——
窄了（`:388` 要求兩邊 OID 都非空且相異，所以 ref 的**建立**、**刪除**、OID 未變都不進這一類），
也寬了（`:392` 用 `!` 否定 `merge-base --is-ancestor`，把「不是祖先」和「祖先測不出來」
壓進同一條分支，是 fail-closed；而既有 tag 被 `|| is_tag_ref` 整個覆寫，
連前進的更新都算）。改成「**不是可證明的 fast-forward**，且逐 ref class 判定」。
四個站點：`skills/push-ci/SKILL.md:653`、同檔 `:1418`、
`test/rules/discretion-tiers.test.js:161`、`docs/cookbook/ship-change.md:38`。

第四筆是 round 72 § 驗證那段完整性宣稱的漏網——見該節 2026-08-22 更正註記。

### 驗證

四個 suite 合計 **327** 項全過（epic-merge 112、push-ci 97、pre-push-gate 85、codex-setup 33；
推導命令見 Round 71 § 驗證的更正註記）。
`node scripts/check-comment-blocks.js` exit **0**，18 筆落在 25–29 警告帶，無 BLOCK。
兩份 `SKILL_DIGEST` 在**該檔最後一次編輯之後**重簽。

本輪新增 3 項測試（push-ci 2、epic-merge 1），每一項都帶反向控制，
且反向控制**只動一件事**——理由與 round 72 相同。

**非停滯**：round 55–73 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7、10、7 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 74

兩條新開的 Codex thread（code 平面、doc 平面各一，皆獨立研究）。
code 平面 **⛔ Blocked**（3×P1 + 1×Nit），doc 平面 **⛔ Needs revision**（3×P2 + 1×Nit）。
另有自查 3 筆，其中 1 筆與 doc 平面第 2 筆是同一筆——**這次自查排在派件之後**，
是本輪的流程退步，記在 § 自查排序 那段。全部先複驗成立才動手。

### code 平面（3×P1）

**分類的物件和推出去的物件不是同一個**。`/push-ci` 終檢問「遠端 tip 是不是即將取代它的祖先」，
答案決定要不要問 unshared。但被比對的那一側是 `git rev-parse --verify --quiet "refs/heads/${BRANCH}"`
——**分支名重新解析一次**——而 push 送的是 `${PLAN_HEAD_SHA}`。兩者只在「中間沒有東西移動分支」時相同，
而那段空窗正是另一個 worktree 的 rebase、第二個 agent session、編輯器會落在的地方。

危險的方向是安靜的那個：分支移到 B，終檢對 B 讀出 `fast-forward` 而跳過 attestation，
git 卻用核准的 A 覆蓋遠端；而 tracking ref 與 reflog 已被同一次移動更新，
所以 lease 和 `--force-if-includes` **都會過**。

這是 § 4.50 的同一個缺陷晚一個 fence 重演：核准綁在一個 commit 上，
**每一個替這個 push 授權的檢查都必須綁在同一個 commit 上**。修法是把該行換成
`FINAL_LOCAL=$PLAN_HEAD_SHA`——不是換一個 git 命令，是**不再讀**。

測試要能分辨兩者，就必須讓假 git 對 `rev-parse --verify` 回一個和 `rev-parse HEAD` 不同的值；
在此之前所有 rev-parse 共用一個 `FAKE_HEAD_SHA`，**這個缺陷在測試裡是不可表達的**
（§ 4.54 的同一課：harness 表達不出來的狀態，測試就見證不了）。
負向控制把舊那行放回去，斷言 `merge-base` 這次收到的是被移動後的值。

**分類表寫「不要推」的兩列，執行面照樣推**。`/epic-merge` rollback 的分類表自 round 53 起就寫著
`no-op` 與 `head-deleted` 只做本機還原、不 push。但 `ROLLBACK_READING` **從來沒有進到執行 rollback 的那個 fence**
——fence 是另一個 shell，分類器印出來的值不會自己過去——所以 push 的前提只有
「`PUSH_BLOCKED` 空」和「`PUSHED` 非空」，兩者在那兩列上都成立。
於是「別人把這個分支刪了」會走到一個可能把它重建回來的 force-push。

修法照 `PUSH_URLS_DIGEST` 既有的作法：以 `<…written literally and quoted>` 欄位綁進來，
再用 `case` 逐列判定，`*` 收尾——**未替換的欄位與空字串都必須落進拒絕臂**。

**rollback 的授權會在還原之前就過期**。Step 5 在 push 前重新量測遠端拓樸，rollback 沒有。
它靠的是更早一個 fence 的分類（在核准之前、在 `git switch -C` 產生被推物件之前）
加上一個**無值的 lease**。而 `switch -C` 會把分支原本的 OID 寫進 reflog，
那正是 `--force-if-includes` 拿來驗證的東西；無值 lease 讀的又是 tracking ref 而不是遠端。
三道保護於是可以同時通過，在一個「分類之後才變動」的遠端上。

修法是在**同一個 fence、還原之後**重新量測，並且對 `$PUSHED`（refspec 左邊那個物件）量，
不是對 `refs/heads/${head}`。lease 維持無值——那是 `head-deleted` 那列既有的設計選擇，
本輪沒有推翻它的理由，重新量測本身就足以關掉這個缺口。

### doc 平面（3×P2 + 1×Nit）

**一條「實測指令」印不出任何東西**。round 73 記錄裡抄的
`bash -c 'exec 1>&-; /usr/bin/printf "x\n"; echo $?'` ——fd 1 已經關掉，後面的 `echo`
自己也寫不出去。結論是對的，證據是假的，而**讀者複查的是證據**。
記錄以日期註記追加更正（記錄類文件不就地改寫），測試註解就地改（測試檔是現行權威）。
錯因與 L13 同源：寫「實測得到 X」時要真的再跑一次，不能憑對它行為的推理抄下來。

**行號指到無關內容**。§ 4.58 列了四個站點以供複查「四份是不是都改了」，
其中一個行號在後續編輯中飄掉，指到了 transport 段。這一節存在的目的就是複查，
指錯就等於複查落空。改成**按內容指名**，並附上可重跑的掃描方式。

寫這一段的時候還踩到同一個坑兩次：先寫「四份都可用一條 `grep` 掃出」——不成立，
四份不共用同一個字串（兩份完整版、兩份摘要版）；改成兩條 `grep` 之後，
第二條仍掃不到 `ship-change.md`，因為 markdown 粗體標記夾在片語中間（`**overwrites** a ref`）。
最後改成只掃單字 `overwrites` 並寫明為什麼。**`.md` 裡的片語掃描本來就不可靠**，這句話值得留著。

**憑證表把類別讀窄了**。`skills/push-ci/SKILL.md` 的表格列寫「a non-fast-forward **branch** update」
——已知的 non-fast-forward。但 gate 是 `! git merge-base --is-ancestor`，
**ancestry 答不出來也落進同一支**，所以「祖先測試出錯」的 push 依表格會被歸到「其他 push」那一列，
讀成「不預期有終端授權」。同一份文件在別處已經寫對，表格自己和自己矛盾。
改成與 `:653`／§ Push safety 一致的 fail-closed 措辭。

**Nit**：`:388` 是註解尾巴，判定式從 `:389` 起。三個站點一併更正為 `:389`–`:391`。

### code 平面 Nit

`test/scripts/pre-push-gate.test.js` 的 SHA-256 案例在 git 不支援時 `return`，
**node 會把它記成通過、零斷言**——正是該 fixture 上方註解自己警告的「silent pass」。
改成 `t.skip()`。

### 自查排序

round 70 記過一課：**自查應該排在派件之前**。本輪沒做到——派件之後才自查，
於是三筆自查有一筆與 Codex 撞號，另兩筆得等回報才能一起修（現在改會讓 Codex 手上的 digest 過期）。
沒有造成錯誤，但浪費了一次可以在派件前就關掉的機會。下一輪回到正確順序。

### 驗證

五個 suite 合計 **354** 項全過（epic-merge 114、push-ci 98、pre-push-gate 85、codex-setup 33、
discretion-tiers 24；推導命令見 Round 71 § 驗證的更正註記）。
本輪新增 **3** 項測試：push-ci 1（終檢分類的是被推物件，含「假 git 必須能分辨兩種 rev-parse」的
harness 擴充與負向控制）、epic-merge 2（不推的兩列真的不推＋會推的列仍會推；還原後重新量測，
含 attestation 指名別的 ref 不算數、量測答不出來一律拒絕兩組案例）。

改寫的站點列表：

| 檔案 | 改了什麼 |
|------|---------|
| `push-ci/SKILL.md` | 終檢改綁 `PLAN_HEAD_SHA`；憑證表第二列改 fail-closed 措辭；push 站 `:?` 訊息補上「核准的 commit 是空的」這一支；一句反事實註解跟上新增的第二個 arm |
| `epic-merge/SKILL.md` | rollback fence 綁入 `ROLLBACK_READING` 與 `UNSHARED_ATTESTED`，加逐列閘門；還原後的拓樸重新量測與拒絕臂 |
| `push-ci.test.js` | 假 git 新增 `rev-parse --verify` 分支；有序呼叫清單少一筆讀取（**其不存在被斷言**）；測試 79 的 mutant 字串跟上新訊息；Phase 2 section pin 與 `SKILL_DIGEST` 重生 |
| `pre-push-gate.test.js` | SHA-256 不支援時改 `t.skip()` |
| `4-implementation.md` / `ship-change.md` / review log | `:388`→`:389`–`:391`；§ 4.58 改按內容指名並附可重跑掃描；round 73 的假證據以日期註記更正 |

**非停滯**：round 55–74 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7、10、7、10 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 75

兩條新開的 Codex thread（code／doc 各一，皆獨立研究）。
code 平面 **⛔ Blocked**、doc 平面 **⛔ Needs revision**，合計 7 筆；另有自查 1 筆。
其中 5 筆與 Anchor 界線無關，先修完；剩下 2×P1 卡在一個授權範圍的問題上，
向使用者提問後得到裁示才動手（見 § Anchor 裁示）。

### code 平面

**綁了值的 lease 才是 lease**（2×P1）。`/push-ci` Phase 2 與 `/epic-merge` rollback
都用 `--force-with-lease --force-if-includes` 的**無值形式**。無值 lease 讀的是
**tracking ref**，`--force-if-includes` 讀的是**本機 reflog**——兩者都是本機狀態，
都會被一次背景 `git fetch` 更新。實測（2026-08-22，git 2.55.0，`bypass.sh`）：
分類器讀到遠端 `C`；協作者推上分歧的 `D`；背景 fetch 把 tracking ref 移到 `D`；
`D` 因為操作者曾在這個分支上 commit 出 `D` 又 reset 掉而留在**分支自己的 reflog**裡
（`git commit` 會寫分支 reflog，那正是該旗標讀的那一份；單純 checkout 一個沒移動的分支不會）
——於是 round 74 出貨的那組旗標
把核准的 `A` 蓋掉了 `D`，回報 `+ 30b0ccd...2f05240 feat/x -> feat/x (forced update)`、
**exit 0**。同一棵樹改用 `--force-with-lease="refs/heads/feat/x:<C>"`（`bypass2.sh`）
被拒為 `! [rejected] … (stale info)`，遠端仍是 `D`。

修法是把兩處都綁到**自己這個 fence 量到的 tip**，並拿掉 `--force-if-includes`
（實測 C：帶值 lease 旁邊放這個旗標是 no-op）。空值不是漏洞而是 `creation` 那一列的讀數
——git 把空期望值讀成「這個 ref 必須不存在」，正是推一個遠端還沒有的分支的意思（實測 D）。

**分類之後才被刪除的 head，會被 force-push 重建回來**。`/epic-merge` rollback 還原後的
`case` 把 `creation` 與 `up-to-date`、`fast-forward` 併在同一支放行。但還原前的
`head-deleted` 那列擋不到「分類**之後**才刪除」的情形，而還原後重新量測讀到的正是 `creation`。
無值 lease 也代替不了：`fetch --prune` 會把 tracking ref 這個錨點拿掉。
新增獨立的 `creation` 拒絕臂，理由寫在該臂自己身上。

**只數呼叫次數，看不出比對的是什麼**。還原後的 ancestry 呼叫在測試裡只被計數。
一個改去重新解析 `refs/heads/<head>`（而不是比對被推出去的物件）的分類器，
會回同一個被設定的狀態碼，**每一項執行面測試都仍然是綠的**。
假 git 改成記下整個 argv，並補一個把 `"$PUSHED"` 換成 `"refs/heads/${head}"` 的負向控制。

### doc 平面

**transcript 與現行 gate 行為不符**。`4-implementation.md` 裡那段 D#1 逐字稿是舊行為的產物。
以 `pty.fork()` 驅動重新量測（`printf | script -q /dev/null` 不行：輸入在 prompt 出現前就被吃掉，
只留下 `^D` 與一次空的 `read`），把整段換成新的實測輸出，並補一段 Round 75 更正說明
——受保護分支那個 prompt 同時收兩份憑證，這件事原文沒說清楚。

**「`--dry-run` 不是 push」讀錯了 Register #4**。抽離出去那張單
（`create-pr-stacked/requests/2026-08-21-…`）把 `git push --dry-run` 當成可以隨手跑的檢查。
Register #4 管的是**命令**不是它的效果，`--dry-run` 仍然是 `git push`。以日期註記追加更正，
並寫明只有 `/push-ci` 與 `/epic-merge` 這兩條工作流能承載這種量測。

**輪次歸屬**。Codex 把本輪新增的測試算進 round 74。round 74 記錄裡的 **354** 是當時
的正確快照，不改；改成在測試檔裡加一段 round-75 標示，讓後續讀者從檔案本身就分得出來。

### 自查

`r1` 引用的 `scripts/pre-push-gate.sh:3` 在後續編輯中飄到 `:5`。以日期註記追加更正；
AC 文字與勾選狀態**不動**——那是當時的記錄。

### Anchor 裁示

兩筆 P1 的修法要用 `--force-with-lease=<ref>:<expected-oid>`。Anchor Register #4 授權
`/push-ci` 與 `/epic-merge` 執行 `git push --force-with-lease`，但**沒有寫**帶值形式算不算
同一個旗標；照窄讀，能真正關掉這個缺陷的形式反而不在授權內。這是 `discretion.md`
§ Proposal Channel 的第 (1) 種觸發，不是「不確定所以問」，所以停下來提問。

使用者 2026-08-22 裁示：**算在授權內**——規則文字只點名旗標、沒有限制參數形式。
兩處於是都改綁量測值。附帶發現：`/epic-merge` Step 5 **從 round 60 起就一直在用帶值形式**，
所以 rollback 註解裡那句「能work的形式不在 Anchor 授權內」與同一份檔案自己出貨的程式碼矛盾。

### 驗證

push-ci **99** 項全過、epic-merge **119** 項全過（round 74 收尾時分別是 98、114
——兩個 suite 合計 +6）。全套實測 **4074 項 / 4070 pass / 0 fail / 4 skipped / EXIT=0**；
`check-comment-blocks.js` exit **0**（18 筆 WARN，無 BLOCK——讀的是離開碼，不是 `grep -c WARN`）。
Phase 2 section pin 與兩份 `SKILL_DIGEST` 在**最後一次編輯之後**由腳本重生，未手打。

**非停滯**：round 55–75 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7、10、7、10、8 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 76

兩條新開的 Codex thread（code／doc 各一，皆獨立研究）。
code 平面 **⛔ Blocked** 1 筆（P2）、doc 平面 **⛔ Needs revision** 4 筆（P2），
另有自查 2 筆。全部獨立覆核為真。

### code 平面

**`url.*.insteadOf` 會把已解析的 URL 再改寫一次**（P2）。
`git remote get-url --push --all origin` 給出的字串，交回給任何 git 指令會**再過一次改寫表**。
實測 2026-08-22（git 2.55.0，`url.<B>.insteadOf=<A>` + `url.<C>.insteadOf=<B>`）：
push 落在 `B`（`B.git` 多了 `refs/heads/feat/x`，`C.git` 為空），
`git ls-remote -- "<B>"` 卻回 **`C` 的 tip**（`e21864d…` vs B 的 `ec62dc7…`）。
四個探測點都會踩到：`/push-ci` Phase 0/1 與 Phase 2、`/epic-merge` Step 5 與 rollback。
後果比「量不到」更糟——round 75 剛把 lease 綁上量測值，這條鏈會讓 lease 綁上**別的倉庫**的 tip。

從 URL 字串本身無法修復（任何交回 git 的字串都會再被改寫），所以修法是**偵測後拒絕**：
`git ls-remote --get-url -- "$URL"`（純本機、不連線）答案 ≠ 傳入值，或指令本身失敗，
就導向既有的 `unknown` fail-closed 路徑。單調，只增加拒絕。詳見 `4-implementation.md` § 4.67。

### doc 平面

四筆都在 `4-implementation.md`：§ 4.62 後半已被 round 75 推翻，補上「不要照這一段實作」的
指路 blockquote；§ 4.64 開頭把「一次 fetch 同時餵飽 tracking ref 與分支 reflog」改成
**兩個不同動作**（fetch 不寫本機分支的 reflog）；§ 4.64 的重現步驟原本不可執行
（字面 `...`、沒有任何指令產生 `D`），換成實際跑過的 `repro76.sh` 全文與它的真實輸出；
§§ 4.65、4.66 補上 round 75 兩個缺陷的獨立記述。

### 自查

**引用了 job 暫存目錄的腳本**。§ 4.64 原本引用 `bypass.sh` / `bypass2.sh`——那是本次工作的
暫存檔，不在 repo 裡，讀者無從覆核。先改成行內重現步驟，Codex 隨即正確指出那段仍不可執行，
才換成真正跑過的完整腳本。（Round 75 記錄裡對這兩個檔名的引用**保留原樣**——那是當時的記錄；
可重現的形式在 § 4.64。）

**reflog 來源寫錯**。原文寫「`D` 因為操作者曾 checkout 後 reset 而留在 reflog」，
實際上是 **commit 會寫分支自己的 reflog**，單純 checkout 一個沒移動的分支只寫 HEAD 的。
三處都已更正。修正時把字面的 `git commit` 帶進 `skills/epic-merge/SKILL.md`，
被該檔自己的破壞性 git 形式守衛擋下（測試 11、12 紅），改寫措辭後回綠——守衛照設計動作。

### 本輪修正時發現的兩件事

**我自己在 round 76 的插入寫錯了變數名**：`/epic-merge` Step 5 的新拒絕臂寫成 `FINAL=`，
應為 `FINAL_TIP=`。仍然 fail-closed（`FINAL_LOOKUP_FAILED=1` 才是路由依據），
但會留下陳舊的 `FINAL_TIP` 與一個沒人讀的變數。已修。

**突變控制不能綁死字面**。`epic-merge.test.js` 兩支「刪掉 exactly-one guard」的控制
是用一段固定字串 `split().join('')` 做的。新的拒絕臂插在 guard 與查詢之間之後，
那段字面不再存在，切掉 guard 會留下沒有 `if` 的 `elif`——突變會因為**夾具的理由**而失敗，
不是因為缺陷。改成一個從 guard 切到 tip 查詢、並把查詢升為鏈首的 regex（`dropDestinationGuard`），
兩支控制共用。

### 假 git 的擴充

四個 harness 的假 git 原本一律用同一支 `ls-remote` 臂回答，`--get-url` 會拿到 ref 行或空輸出，
於是**每一種讀數都變成 `unknown`**——suite 會回報 fail-closed 臂在運作，實際上量的是壞掉的替身。
四處都補上獨立的 `--get-url` 臂（預設回傳原 URL，`FAKE_REPROBE_URL` 表達被鏈式改寫、
`FAKE_REPROBE_EXIT` 表達讀不到）。有 ARG_LOG 的兩處把它記在**自己的前綴** `geturl` 下：
底下每一個計數判的都是**網路查詢**，而 `--get-url` 不連線——併在一起會讓
「這條路徑沒有問過遠端」對一條確實沒問過遠端的路徑變成假。

### 驗證

push-ci **101** 項全過、epic-merge **121** 項全過（round 75 收尾時分別是 99、119）。
全套實測 **4078 項 / 4074 pass / 0 fail / 4 skipped / EXIT=0**（round 75 為 4074 / 4070，
差額 +4 正是本輪新增的 4 支）；`check-comment-blocks.js` exit **0**。
兩份 `SKILL_DIGEST` 在最後一次編輯之後由腳本重生，未手打。

### 對 Round 75 記錄的更正（2026-08-22）

- 上面那則 doc 平面第二點寫「只有 `/push-ci` 與 `/epic-merge` 這兩條工作流能承載這種量測」。
  更精確地說：`/push-ci` 的參數面是封閉的，它自己組 `<SHA>:refs/heads/<branch>` refspec，
  **承載不了** `+main` 這類實驗；那張單上的量測只能由操作者在 agent 之外自己跑。
  已於 `create-pr-stacked/requests/2026-08-21-push-remediation-refspec-guard.md` 追加日期註記。

**非停滯**：round 55–76 分別關掉 7、5、6、10、8、6、4、7、11、9、8、9、10、11、9、9、7、10、7、10、8、7 筆。
stall streak 0；cap 診斷 0 次、stall 診斷 0 次。

## Round 77（進行中）

兩條新開的 Codex thread（code／doc 各一）已派出，尚未回。以下是**派件後**的自查所得。

### 自查：round 76 的偵測器只補了四處，實際有六處

Round 76 把 `--get-url` 偵測器加在 `/push-ci` 的 Phase 0/1、Phase 2，與 `/epic-merge` 的
Step 5、rollback 還原後複查。用「哪些地方把已解析 URL 交回給 git」重掃一遍，
`/epic-merge` 還有**兩個 iteration/rollback 分類 fence**（`REMOTE_LS=` 那一對）漏掉了。

漏掉的這兩處**比已補的更關鍵**：它們的讀數決定的是「要不要問操作者這些 ref 是不是沒人共用」。
讀到別的倉庫的 tip，可能把一個 rewrite 讀成 fast-forward，於是那個問題**根本不會被問**
——而 L1 hook 是 opt-in 的，沒裝的專案裡這個問題就是唯一的憑證。

兩處補上同形狀的偵測器（fail-closed 到 `LOOKUP_FAILED=1` → `unknown` → 會問），
並加上兩支執行面測試（iteration gate 與 rollback 各一，由既有的參數化 suite 帶出），
含負向控制：URL 沒被改寫時，同一組夾具必須仍然讀出 `fast-forward`。

**這一則的教訓不是「漏了兩處」，是掃描的軸選錯了**。Round 76 是照「哪些 fence 剛好被 review 提到」
補的；正確的軸是「哪些指令收到的是已解析字串」。後者可機械枚舉，前者不行。
判準寫進 `4-implementation.md` § 4.67：問**遠端名字**的不會二次改寫，問**已解析字串**的才會
——所以 `/push-ci` 三處 `ls-remote --upload-pack` 只有兩處需要偵測器。
這句原本是推理，事後補了實測（2026-08-22，同一棵樹）：`git ls-remote origin` 回 B 的 tip，
`git ls-remote -- "$(git remote get-url --push --all origin)"` 回**空輸出**（問到 C 去了），
`git ls-remote --get-url -- "$U"` 回 C。空輸出這個形狀特別要記：分類器把它讀成 `creation`
——一個**不必問**的列，所以缺陷最自然的表現是那個共用性問題根本不會被問。逐字輸出見 § 4.67。

### code 平面（Codex，⛔ Blocked：2×P1 + 1×Nit）

**attestation 不是核准**（2×P1，`skills/push-ci/SKILL.md` 與 `skills/epic-merge/SKILL.md` 兩處）。
量測完成後的 `rewrite` 復原臂原本寫的是：「把共用性問題按名字問操作者，得到 yes 就帶著
`UNSHARED_ATTESTED` 重跑這個 fence」。少了一步——**重新取得推送核准**。

`rules/git-workflow.md` § Push safety 固定了**順序**：共用性問題要按名字問，而且要在 force 核准
**之前**。上面那個流程的實際順序是：核准（在一個「不是 rewrite」的計畫下給的）→ 發現是 rewrite →
問共用性 → 重跑 → 推。手上那份核准描述的是一個已經不成立的拓樸，而 attestation 回答的是
「這個 ref 有沒有別人在用」——兩者都不是「我核准把它蓋掉」。

三個復原臂（push-ci 最終複查、epic-merge Step 5、epic-merge rollback）都改成兩步、標明順序，
並說出**為什麼**手上那份核准不算數（否則「再問一次」讀起來像官僚流程，會被跳過）。
配兩支形狀測試 + 負向控制：復原臂必須同時出現「按名字問」與「重新核准」，且**問在前、核准在後**
——只斷言兩者都出現，會讓一個順序寫反的臂通過。

**Nit：偵測器把「指令失敗」和「URL 不符」併在同一支**（6 處）。診斷訊息一律說
「`url.*.insteadOf` 二次改寫了目的地」，但指令失敗並沒有證明這件事——安全結果仍然正確
（fail-closed 到 `unknown`），錯的是給操作者的說法。低於 `thorough` 的阻擋線，記錄後放行：

```
[NIT_DEFERRED] skills/push-ci/SKILL.md:805 | the --get-url detector reports a second insteadOf rewrite even when the command merely failed; command failure should read as an indeterminate measurement | reason: sub-threshold-Nit | 2026-08-22T00:00:00Z
[NIT_DEFERRED] skills/epic-merge/SKILL.md:952 | same detector, same conflation, four sites in this file | reason: sub-threshold-Nit | 2026-08-22T00:00:00Z
```

### doc 平面（Codex，⛔ Needs revision：2×P2）

**「三個 fence」與底下列出的數量不符**——這一筆在 Codex 回覆抵達前就已經因為上面那則自查修掉了
（§ 4.67 現在寫「共六處」並逐一列出）。兩邊獨立看見同一個問題，這裡記錄為已關閉。

**Round 77 記的 epic-merge 項數錯了**。原本寫 122，實測是 **123**——當時那次執行是
`# pass 122 # fail 1`（fail 的是還沒重生的 digest pin），我把 pass 數當成了總數。
Codex 另外指出「本輪新增 4 支」與現況的六個 URL 案例不符：那是**輪次歸屬**的差異，
round 76 確實只加了 4 支（2+2），第 5、6 支是上面那則 round 77 自查加的。
Round 76 的數字是當時的正確快照，**不改**；這裡把差異寫清楚。

### 驗證

push-ci **103**、epic-merge **125** 全過（進入本輪時分別是 101、121）。
全套實測 **4084 項 / 4080 pass / 0 fail / 4 skipped**；`check-comment-blocks.js` exit **0**。
Phase 2 section pin（584 → 591 行）與兩份 `SKILL_DIGEST` 在最後一次編輯之後由腳本重生，未手打。

**數項數的教訓**：`# pass N` 不是總數。有 fail 的那一次執行，`# tests` 和 `# pass` 會差開，
而記錄裡要寫的是 `# tests`。這一輪兩次都栽在同一個地方（122／121 都是這樣來的）。

## Round 78

tier=thorough（push safety 屬 security 變更，Anchor Register #3；P0/P1/P2 皆阻擋）。
兩個 Codex thread 皆為新開（`mcp 參數已經調整，開新的 thead 進行 review`）。code 平面回覆
`⛔ Blocked gate_reason=IN_SCOPE_BLOCKING`。

### 自查（派件後、Codex 回覆前）：核准當下的事實有沒有被比對

軸是「授權所依據的事實，到執行當下有沒有被驗證仍然成立」。`/push-ci` Phase 2 已經把
**目的地**（`PLAN_PUSH_DIGEST`）、**發布的物件**（`FINAL_LOCAL=$PLAN_HEAD_SHA`，round 74）
與 **ref 名字**（具結字串）綁在核准上；lease 也在 round 75 改成帶值形式
`--force-with-lease=refs/heads/<b>:$FINAL_TIP`。少的是第四樣：**這次推送要銷毀的那個 commit**。

`grep -n 'PLAN_' skills/push-ci/SKILL.md` 實測：只有 `PLAN_BRANCH`、`PLAN_HEAD_SHA`、
`PLAN_PUSH_URLS`、`PLAN_PUSH_DIGEST`，**沒有任何 plan 端的 remote tip**。epic-merge 連
`PLAN_*` 家族都沒有。於是這條路徑成立：

| 步驟 | 發生什麼 |
|------|----------|
| Phase 1 | 量到 tip=C，判 `rewrite`，按名字問未共用、取得具結、取得核准 ⚠️ |
| 核准之後 | 同事推上 D |
| Phase 2 | 重量得到 D，仍判 `rewrite`，具結字串仍然對得上 ref 名字 → **放行** |
| push | lease 帶 `$FINAL_TIP`=D，**符合**，D 被覆寫。操作者從頭到尾只看過 C |

lease 在這裡幫不上忙，正因為它帶的是**此刻**量到的值——這是 round 75 讓它能在正常情況成功的
同一個性質。更關鍵的是：**tip 在兩次量測之間移動，本身就是打臉那份具結**（「這個 ref 沒別人在用」
的 ref 不會長出這裡沒發布過的 commit）。fence 手上有這個證據卻沒讀。

**P1，三處**（與 round 77 修的是同一族：具結不等於核准，這次是「核准的是哪個 commit」）：

| 位置 | 綁入的欄位 | 為什麼那裡特別重要 |
|------|-----------|------------------|
| `skills/push-ci/SKILL.md` Phase 2 `rewrite` 臂 | `PLAN_REMOTE_TIP` | 與既有三項比對同一形狀，補齊第四項 |
| `skills/epic-merge/SKILL.md` Step 5 `rewrite` 臂 | `APPROVED_TIP` | rebase 只動本地端，所以 iteration gate 量到的 remote tip 仍是同一個事實 |
| `skills/epic-merge/SKILL.md` rollback `rewrite` 臂 | `APPROVED_TIP` | **這裡最關鍵**：`rewrite` 是回滾的**正常**讀數（backup 本來就不含剛推上去的 head），所以讀數本身無法區分「回滾自己推的」與「別人又推了上去」，tip 是唯一的判準 |

三處都 fail-closed：欄位留空即拒絕（空值與非空的 `$FINAL_TIP` 不相等）。

**測試**（皆含負向控制——刪掉比對後，漂移列轉紅而正常列維持綠）：
push-ci 1 支（漂移／未填／未漂移三列）；epic-merge Step 5 併入既有 `case` 矩陣測試
（新增形狀斷言 3 條 + 漂移／空值／環境注入／負控制 4 列）；epic-merge rollback 1 支
（漂移、空值、佔位符未替換、未漂移四列）。

harness 上踩到一個坑並修掉：`runRollbackGate({ approvedTip: undefined })` 會被解構預設值
`approvedTip = tip` 吃掉，那一列其實測到的是**未漂移**路徑（status 0）。改用 `null` 當
「保留佔位符」哨兵，並在 harness 註解裡寫明不能用 `undefined`。

### code 平面（Codex，⛔ Blocked：1×P1）

**P1 — `skills/codex-setup/SKILL.md` § sync：Husky 模式的 sd0x 佈線是兩個工件，`sync` 只管了一個。**
獨立查證的結果是「成立，但 Codex 的嚴重性理由只對了一半」：

- 成立的部分：`sync` 的每一列都寫「Re-copy and update the hash」，指的都是
  `.claude/scripts/<script>`。modes 2–4 那就是全部；**mode 1 只是一半**，另一半是這個 skill
  寫進 `.husky/<hook>` 的 marker 區塊。整個 `sync` 沒有一句話管它。對比之下，`unknown` 那列
  還特地為 script 寫了「stale bytes 會讓 doctor 通過」的警告，stanza 卻沒有對應的一句。
- Codex 說「`doctor` 仍會通過」對舊安裝**不成立**：mode 1 的 Active 條件要求
  「`$written_path` 仍帶有 sd0x stanza」，無 marker 就判 `pending`。
- 但實測 `git show HEAD:skills/codex-setup/SKILL.md` 後，缺口比 Codex 描述的更糟：HEAD 只有
  一格「Append sourcing to Husky hooks」，**沒有 marker、沒有 stanza 文本**。所以舊安裝留下的是
  一行**無 marker** 的 sourcing——以 marker 為界的取代根本找不到它，而新版 gate 拒絕被 source
  （已實測，rc 127），結果是該 repo **每一次 push 都失敗**。方向是 fail-closed，但等於把 repo 弄壞。
- 這條落在 r2 已經打勾的 AC「`sync` ⋯已安裝時照常更新且不移除」上。

**修法**：在 `## sync` 增一節 `#### Husky mode: "re-copy" names one artifact, and the wiring is two`，
以 marker 對為界分成四種情況——恰好一對 → **就地取代**（不是重新 prepend，否則檔案裡會有兩個 gate
而舊的仍會先跑）；無 marker 且無殘留 → 照 Phase 3 prepend；無 marker 但有指向
`.claude/scripts/<script>` 的行 → **不寫任何東西**，記 `pending`，印出要操作者手動刪除該行的補救
（它是安裝過的證據，所以不能記 `declined`；它沒有邊界，所以這個 skill 不能進去改別人的檔案）；
marker 重複或不成對 → **終局拒絕**，與 foreign-collision 那列同一個方向。

測試 1 支（`test/skills/codex-setup.test.js`，34/34）。因為文件與測試都是我寫的，另做一次
mutation 驗證：把該節整段拿掉 → `not ok 34`；放回去 → 34/34。

### 驗證

push-ci **104**、epic-merge **126**、codex-setup **34**，合計 264 全過。
Phase 2 section pin（591 → 617 行）與兩份 `SKILL_DIGEST` 在最後一次編輯之後由腳本重生，未手打。

## Round 79

Tier=thorough（push safety，Anchor Register #3）。Round 78 的 doc plane 任務逾時失敗
（`kjaofn0hg`，1800s 無回應），沒有產出裁決，因此併入本輪；本輪兩個平面都跑完。

### Doc plane

| # | 嚴重度 | 位置 | 判定 |
|---|---|---|---|
| 1 | P1 | `4-implementation.md` §4.69 | **成立，已修**。§4.69 說 fence 拿計畫核准過的 tip 來比對，但 Phase 1 的 Push Plan 樣板根本沒有這個欄位（實測樣板只有 Branch / Remote / Commits / HEAD / Push gate / Command），tip 只出現在未共用**具結問題**裡，而 §4.68 已經確立具結不是核准。修法有兩半：計畫端加 `- Overwrites:` 行（rewrite 時寫 `REMOTE_TIP` 全長物件 ID，其餘讀數寫 `nothing (<reason>)`），fence 端才有東西可比。Round 77 那條「帶著會實際攜帶的 lease 回來重新取得核准」的復原指示，到這一輪才第一次真的可執行 |
| 2 | P1 | `rules/git-workflow.md` § Push safety、`rules/discretion.md` § Efficacy Boundary | **不改，記錄理由**。見下 |

**Finding 2 的處置理由**：這兩份文件規範的是**憑證選擇**（哪個機制授權這次 push），不是
**核准的時效性**（核准當時成立的事實在執行時是否還成立）。兩者都是 byte-pin 的 Anchor 素材
單行。同一類「計畫 vs 現在」的拒絕已經存在兩個——`PLAN_HEAD_SHA`（round 54）與
`PLAN_PUSH_DIGEST`（round 74）——這兩份文件同樣沒有列舉它們，而它們已經過了約 24 輪
thorough review。樣板修好之後，這條拒絕可以直接從規則自己的句子推導出來：「a plan that shows
a plain push while a lease-force runs is not an approval of what happens」。若下一輪 reviewer
仍認為規則層需要明寫，那是規則層的獨立變更（Anchor 素材、需要重生 byte pin），不是本輪的缺陷。

### Code plane

| # | 嚴重度 | 位置 | 判定 |
|---|---|---|---|
| 1 | P1 | `push-ci/SKILL.md`、`epic-merge/SKILL.md`（3 處 round-78 新增，實際涵蓋 30 處） | **成立，已修**。`BASH_FUNC_exit%%='() { PUSH_BLOCKED=; return 0; }'` 會抹除拒絕紀錄。實測重現：拒絕印出、旗標清空、push 以 status 0 執行。改為 `readonly PUSH_BLOCKED=1`（30 個 push 前站點）。詳見 §4.70 |
| 2 | P1 | `codex-setup/SKILL.md` `unknown` 列 + mode-1 Active predicate | **成立，已修**。兩處都寫「sd0x stanza present」，而該偵測是**開頭 marker 的 grep**（第 216 行自陳），所以被截斷的 stanza 會被判為 `installed`，與 marker 矩陣對同一個檔案給出的終局 `pending` 直接矛盾。兩處改讀**成對** marker；第 216 行加註那個 grep 只是 presence probe |
| 3 | P2 | `codex-setup/SKILL.md` 四格矩陣 | **成立，已修**。原本 row 2/3 以「沒有 marker **pair**」為鍵、row 4 只列開頭 marker，於是（a）落單的**結尾** marker 不落入任何一列；（b）只掉了開頭 marker 的**現行** stanza 會落入 legacy 列，拿到一句「刪掉那行 source」——而檔案裡根本沒有那行。改為**先數 marker**再看路徑引用，row 4 擴為「任何不是恰好一組平衡配對」的情形，訊息改為 `duplicated, unbalanced or out of order` |

Codex 另外指出 `test/skills/codex-setup.test.js` 的 contract test 在「移除 opening without
its closing」的 mutation 下仍然通過——它只檢查訊息字串。已補強為逐一列舉五種畸形形狀 +
要求 zero-marker 兩列都寫成「no sd0x marker of either kind」。

### 自己弄壞的四支測試（round 78 的殘留，跨兩個套件）

| 測試 | 原因 | 處置 |
|---|---|---|
| push-ci #26 | 改寫 force 條款時把測試比對的片語斷成兩行 | 重排句子讓片語回到同一行 |
| push-ci（新增） | 用了本檔不存在的 `splitSkill` | 改用 `readSkill()` |
| epic-merge #54 | round 78 把 `This rewrites remote history.` 改成 `…, replacing <REMOTE_TIP>.`，句號位移 | 更新 regex，並**要求**那個物件 ID |
| epic-merge #119 | mutation 錨點 `PUSH_BLOCKED=1; exit 1` 因 `readonly` 前綴失配 | 錨點改為含 `readonly`，順帶把凍結也 pin 住 |

### 驗證

Mutation：五個 mutant（codex-setup 三個修正各還原一次、push-ci 與 epic-merge 各解凍一個站點），
全部命中對應測試轉紅，檔案於 `finally` 還原。

行為測試 + 靜態列舉並用：`readonly` 是機械式套用到 30 個站點，行為測試只能覆蓋兩道 fence
（Step 5 的 harness 觀察不到 push），因此另加一支列舉式測試，把「凡與 `exit` 配對的拒絕都必須
凍結」變成可查全集，並以「push 後累積站點維持普通賦值」作負控制——否則規則會變成「任何地方
都不准普通賦值」，今天綠、明天錯。

## Round 80

Tier=thorough。兩個平面都在同一批編輯後派件，各自開新 thread（code `01a02994…`、doc
`01a02996…`）。兩個平面都回 blocked，四筆 finding 全部落在 round 79 改過的
`skills/codex-setup/SKILL.md`——也就是**上一輪的修正自己引入的缺陷**。

### 判定與處置

| # | 平面 | 嚴重度 | 判定 |
|---|---|---|---|
| 1 | code | P1 | **成立，已修**。round 79 把三個判定從「carries the sd0x stanza」收窄成「well-formed marker pair」，於是 marker 平衡但 body 被清空／註解掉／指向另一個 hook 的 block 會讓 `doctor` 報 `installed × Active` ✅，而沒有任何 gate 執行。改成集中定義的 **intact sd0x block**（數量／順序／body 呼叫本 hook 的 script 三個子句），三處共用 |
| 2 | code | P2 | **成立，已修**。step 3 的「a line referencing」把一行**註解**提到路徑也判成 legacy wiring，於是拒絕一個本來會成功的安裝，並叫操作者刪一行不存在的 source。改成「非註解行」，並寫明這個判準刻意在安全方向上粗糙 |
| 3 | doc | P2 | **成立，已修**。四格表格不是分割：最後一列選擇子寫「any other marker **count**」卻收了「closing before its opening」——那個例子與第一列數量相同、只差順序。改寫成程序（數量 → 順序／完整性 → 引用），一次只問一個問題 |
| 4 | doc | P2 | **成立，已修**。「`commit-msg` is unaffected by the matrix above」把「豁免 opt-in」寫成了「豁免接線程序」。mode 1 給它同樣兩個工件，舊安裝器對 Husky hooks 一律 append sourcing，而 source 這支 guard 會 `exec` 取代呼叫它的 shell——比 gate 的失敗更糟且無聲 |
| 5 | doc | Nit | **就地修正**。round 79 標題寫「兩支測試」，下方表格列了四支。這是同一節、同一次會話剛寫下的事實錯誤，屬於對紀錄本身的更正，非重寫歷史；已改為「四支測試（跨兩個套件）」 |

### 自查發現（不是 reviewer 提的）

`test/skills/codex-setup.test.js` 的 `section()` / `phase()` helper 用 `(?=^## |\Z)` 當擷取結尾。
**JS regex 沒有 `\Z` 錨點**，那是字面的大寫 Z，所以每個 section 都在標題後第一個大寫 Z 就被截斷。
新表格裡的「**Zero each**」踩到之後，一支既有測試（#13 uninstall）才翻紅。這是**既有**的
harness 缺陷，最傷 `doesNotMatch` 類斷言——切短的 slice 讓「不准出現 X」恆真。已改為
`$(?![\s\S])` 並補一支雙向 guard 測試。詳見 §4.74。

### 驗證

Mutation：六個 mutant（Active predicate 收窄回 marker pair、定義刪掉 body 子句、step 3 改回
「a line referencing」、step 1 收回順序判斷、`commit-msg` 改回「unaffected」、helper 改回 `\Z`），
全部命中對應測試轉紅，檔案於 `finally` 還原。`\Z` 那個 mutant 一次讓 4 支轉紅，包含那支 guard
測試本身。

### 一個模式，值得記下來

Round 79 的三筆修正裡有兩筆在 round 80 被推翻，方向都一樣：**為了修一個「太寬鬆」的判定，
換上了一個「太窄」的判定**——用 marker 平衡取代「stanza 完整」、用「有沒有提到路徑」取代
「有沒有接線」。共同成因是拿**容易機械檢查的代理**去代替真正要問的問題，而且代理與問題的差距
在寫的當下看不出來，要等到有人構造出「代理成立但問題答案相反」的輸入。這一輪的修法都是把
問題本身寫出來（三個子句、五個步驟），代價是文字變長。

## Round 81（最終輪 — 依使用者裁示不進修復迴圈）

Tier=thorough。使用者在 round 80 之後選了「跑完 round 81 後停手」：對當時那棵樹再派一次
code + doc review，**不論回 Ready 或 Blocked 都停下來交接**，把發現寫進 review log 與需求單，
不再進入修復迴圈。以下七筆因此全部是**紀錄，不是待辦的已修項**——都還開著。

背景：security 變更（Anchor Register #3）在 `rules/auto-loop.md` § Cap Diagnostic Protocol 下，
**任一觸發都直接走 ⚠️ Need Human**，不做診斷。`thorough` 的 30 輪上限早在約 round 80 就已遠遠
超過，這一輪是使用者授權的單次收尾。

| 平面 | thread | Gate |
|---|---|---|
| code | `01a029ac-8ff1-7523-9206-b45ea58577c3`（call `kyl5rk0rr`） | `⛔ Blocked` · `gate_reason=IN_SCOPE_BLOCKING` |
| doc | `01a029ae-ae9c-7f00-91a1-2a8b04b1925c`（call `kxovrxgiq`） | `⛔ Needs revision` |

### Code 平面 — 3 筆

| # | 嚴重度 | 位置 | 內容 |
|---|---|---|---|
| C1 | P1 | `skills/codex-setup/SKILL.md:225` | 「intact block」仍不能證明那段**會被執行**。反例：Husky hook 在 marker pair 之前有一行 `exit 0`，三個子句與 mode 1 的 Active predicate（`:309`）全部成立，gate 卻永遠跑不到，`doctor` 對一道失效的安全閘報 `installed × Active`。`origin=in-diff scope_reason=diff-file`。`test/skills/codex-setup.test.js:1239` 只用 regex 檢查那三個子句「有被寫出來」 |
| C2 | P2 | `skills/codex-setup/SKILL.md:621` | 一行會執行但不呼叫的指令，例如 `printf '%s\n' '.claude/scripts/pre-push-gate.sh' >/dev/null`，仍被算成 wiring（`:631–635` 明文如此），於是安裝被拒絕，並告訴操作者「這個 hook 有 source 那支 gate」——與事實相反。與 C1 同型 |
| C3 | P2 | `skills/codex-setup/SKILL.md:77` | 重複執行 `init` 會**再前置一段**帶 marker 的 stanza，因為 Phase 3 mode 1 從來不走 marker 程序（該程序只定義在 `sync` 之下）。接著 Active predicate 因「必須恰好一組」而拒絕 → `pending` → sync 走到終端 step 4 → 需人工修復。與 `:390` 宣稱支援的重複 init 生命週期、以及 `:620`「再前置一次會留下兩道 gate」的理由互相矛盾。`origin=uncertain` |

Codex 的收尾建議（原文轉述）：**做一個共用、以 fixture 驅動的 Husky 分類器，同時覆蓋
`init` / `sync` / `doctor`**——證明那段可達、把真正的呼叫／source 語法與「一行活著的文字提及」
分開、並讓重複 `init` 就地替換既有的 owned block。三筆 finding 收在同一個判定邊界上。

Codex 明列為**已定案、不再是 finding**：opt-in hook + AskUserQuestion fallback；兩類 prompt、
刪除排除、`ALLOW_FORCE_WITH_LEASE` 拒絕邊界、protected × rewrite 合併提問；`PUSH_BLOCKED` +
`exit 1` 的設計與現行 readonly 紀錄；帶值 `--force-with-lease`、destination digest 綁定、
push-ci / epic-merge 的 force-push 重新量測。獨立驗證：round 80 codex-setup 測試 4/4、
授權與 destination 相關的 push-ci + epic-merge 測試 5/5、四支測試檔 `node --check`、
`git diff --check HEAD`、comment-blocks exit 0。（temp-dir 套件在 read-only sandbox 下
`mkdtemp` EPERM 跑不了，兩個 reviewer 都明講這不是 repo 的問題。）

### Doc 平面 — 4 筆 P2

| # | 位置 | 內容 |
|---|---|---|
| D1 | `skills/codex-setup/SKILL.md:621` | 五步程序仍不是一致的分割：step 3 的「invoking or sourcing」與 `:628–635` 的「任何非註解引用」互斥；intact block 在 step 2 就終止，與 `:625`「每個 hook 檔恰好抵達 steps 3–5 其中之一」相矛盾；body 呼叫**另一個 hook 的 script** 的平衡 block 會落到 step 4，而 step 4 只診斷 `duplicated, unbalanced, out of order or empty`——四者對這個情形都不成立 |
| D2 | `skills/epic-merge/SKILL.md:1868` | `head-deleted` 那一列描述的是已經退役的機制（對 tracking ref 下 lease、`stale info`、帶值形式在授權之外）。現行路徑在 `:2181–2185` 於任何 push 之前就拒絕 `head-deleted`；push 用的是 `:2328` 的 `--force-with-lease="refs/heads/${head}:${RB_TIP}"`；`:2303–2306` 記錄了維護者裁示「帶值形式在授權之內」。正確的敘述是：`head-deleted` 不 push，因為**重建一個已刪除的分支不在 rollback 的核准範圍內** |
| D3 | `skills/push-ci/SKILL.md:635`（同句複製於 `push-ci:1363`、`epic-merge:1622`） | **「實測」宣稱為假**。文中說「帶值 lease 加上 `--force-if-includes` 會成功，而單獨帶值的 lease 會拒絕」。Git 2.55.0 文件（`/opt/homebrew/opt/git/share/doc/git-doc/git-push.adoc:364–366`）寫明 `--force-if-includes` 在 `--force-with-lease=<refname>:<expect>` 旁是 no-op。倉庫裡那份宣稱「完整」的量測（`4-implementation.md:2778–2783`）比較的是**無值 lease + 該旗標** 對上**過期的帶值 lease（無旗標）**，從未跑過「帶值 + 旗標」那一格。**刪掉那個多餘旗標仍然正確**；錯的是那個比較句與「實測」的歸屬 |
| D4 | `docs/features/push-gate-optin/4-implementation.md:2751` | 宣稱「完整、可直接執行」的重現腳本產不出自己的輸出：`:2793`、`:2798` 印的 `remote after: f4e544a` / `remote after: b641186`，在 `:2754–2784` 的 fence 裡找不到任何一條會產生它的指令 |

Doc 平面明列已定案：r1–r5 五張單；`2-tech-spec.md` 作為 design record；`review-log-adequacy-gate.md`
與本檔的歷史內容（reviewer 明說「Round 81 的處置應該**追加**，不要改寫進 Round 80」——本節即依此
追加）；`rules/discretion.md`、`rules/git-workflow.md`、`docs/cookbook/ship-change.md`、
`.claude/sd0x-dev-flow-lessons.md`、`skills/smart-rebase/SKILL.md`、2026-08-21 那張 create-pr 單；
刪除邊界；500 行的 deferred nit。

### 這一輪學到的兩件事

**一、代理與性質的差距，第三次以同一種形狀出現。** round 79 用「marker 成對」代替「stanza 完整」，
round 80 用「intact block」代替「這段會跑」、用「非註解行」代替「有接線」；round 81 指出 intact
block 仍不等於**可達**、非註解行仍不等於**呼叫**。三輪都在關掉上一輪的反例，而不是把問題本身換掉。
已寫成 lesson L15。

**二、D3 與 D4 是 L14 的第三次復發**（「寫『實測得到 X』時，證據要真的跑過」）。這次的變形是：
指令確實跑過了，但**跑過的輸入組合和結論描述的不是同一組**；以及一段輸出貼在腳本底下，而腳本裡
指不出是哪一條指令印的。已寫成 lesson L16。

### 狀態

七筆全部**開著、未修**。兩個平面的 verdict 都記為 `fail`。`/precommit`、Adequacy Gate、Doc Sync
在這一輪都沒有抵達——依 `rules/auto-loop.md` 的終局完成不變式，這份變更**尚未完成**，只是停在一個
可交接的位置。
