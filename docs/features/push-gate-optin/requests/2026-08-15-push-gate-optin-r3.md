# Pre-Push Gate: Push Authorization Contract When the Hook Is Absent (方案 A)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: In Progress
> **Note**: ⚠️ 契約變更已由使用者於 2026-08-15 明示核可（方案 A）。本單與 [r2](./2026-08-15-push-gate-optin-r2.md)、[r4](./2026-08-15-push-gate-optin-r4.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）
> **Priority**: P1
> **Tech Spec**: Pending（方案已定；範圍擴大再補）

## Background

`rules/git-workflow.md:14` 與 `rules/discretion.md` § Proposal Channel 現行敘述「`pre-push-gate.sh` 是 terminal credential，AskUserQuestion 僅為諮詢」。r2 把 hook 改成預設不裝之後，該 credential 預設不存在，因此必須明訂 hook 不在時由什麼授權推送。使用者已在三個方案中選定 **方案 A：hook 不在時 AskUserQuestion 即足夠**（B = 需明示旗標、C = 拒推受保護分支，均未採用）。

**原子發佈集（r2 + r3 + r4）**：分開落地，無論何種順序都留下不一致的中間態 —— r2 先落地，hook 預設消失但規則層仍宣稱它是 terminal credential，出現無授權依據的真空；本單先落地，README 宣告 `pre-push` 為 opt-in 但安裝器仍無條件安裝（`skills/codex-setup/SKILL.md:50,61`），文件與實作矛盾。r4 的下游轉述同樣無法靠排先後解決（見該單 Background）。約束是原子性而非先後，故 **r2、r3、r4 三單皆不使用 `Depends On`**，須一起合併；r1 為純缺陷修復，不受此約束。

> **⛔ 這個中間態已經發生了**（2026-08-21 查證）——查證指令、輸出與後果分析記於
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § 原子發佈集破功的查證。
> 本註記只記錄事實與時態，不改寫上方原文。

README 的安裝面敘述**一半是生成的**：`README.md:50` 那列由 `scripts/generate-readme-catalog.js:244` 硬編產出（`:39` 的散文則為手寫），locale 鏡像再由 `/readme-i18n-sync` 自英文版傳播。只手改 README 會被下一次 `/update-readme` 蓋回去，故必須改產生器與其 fixtures。

`test/rules/discretion-tiers.test.js:144,253,258` 以斷言釘死現行措辭 —— 依 `rules/discretion.md`「the test fails on the removal by design」，更新該測試就是這道契約變更的人為煞車。

## Requirements

- 依方案 A 改述授權契約：hook 已安裝 → 它是 terminal credential；hook 未安裝 → AskUserQuestion 即為授權
- 敘述一律條件化，不得留下「`pre-push-gate.sh` 必然存在／必然是最終閘門」的無條件斷言
- 修正「install via `/install-scripts`」不實敘述（真正安裝 git hook 的是 `/codex-setup`）
- 六份 README 同步，且區分「預設安裝」與「opt-in」

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `rules/git-workflow.md`、`rules/discretion.md`（各含 `.claude/` 鏡像）、`skills/push-ci/SKILL.md` 全部無條件敘述、README ×6 全部相關敘述**及其產生器**、對應測試 |
| Out | `/codex-setup` 安裝行為（r2）；`scripts/pre-push-gate.sh` 本身（r1）；cookbook 與其他 feature 文件的轉述（r4） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `rules/git-workflow.md` + `.claude/rules/git-workflow.md` | Modify | `:14` Push safety 改述 + 安裝來源修正 + 方案 A |
| `rules/discretion.md` + `.claude/rules/discretion.md` | Modify | § Proposal Channel efficacy boundary：stronger mechanism 條件化 |
| `skills/push-ci/SKILL.md` | Modify | 五處無條件敘述：`:26`（Authorization 表）、`:32`（L1 列）、`:36`（Primary gate）、`:96`（pre-approval flow 標題）、`:104`（Phase 0 註記） |
| `test/skills/push-ci.test.js` | New | 目前不存在；CLAUDE.md 規則 5 要求 SKILL.md 對應測試 |
| `README.md` + 5 份 locale 鏡像 | Modify | 安裝段落、Harness 列、Defense-in-depth 列、Human-in-the-loop 列、enforcement 段、rules 總覽段 —— **以語意定位**，英文版行號僅為錨點（locale 行號不同） |
| `scripts/generate-readme-catalog.js` | Modify | `:244` 硬編「AGENTS.md kernel + git hooks」，是 `README.md:50` 的產生來源 |
| `test/scripts/generate-readme-catalog.test.js` | Modify | `:1741,2113` 兩處 fixture 釘住舊字串 |
| `test/rules/discretion-tiers.test.js` | Modify | `:144,253,258` 三條斷言隨契約更新 |

> **本表與 § Background 的行號皆為 2026-08-15 的座標，不是現況（2026-08-20 round 16 補記）**——含 Background 的 `rules/git-workflow.md:14` 與 `test/rules/discretion-tiers.test.js:144,253,258`。本單落地後三個檔各自大幅位移。**Related Files 是動工前寫下的目標清單，本身是記錄**，故不逐格改寫成今日行號；現行位置一律以節名標定、行號現場推導：
>
> | 開單時的座標 | 現行定位 | 推導指令 |
> | ------------ | -------- | -------- |
> | `rules/git-workflow.md:14` | § Push safety（已自成一節） | `grep -n '^## Push safety' rules/git-workflow.md` |
> | `skills/push-ci/SKILL.md` 五處 | 見 AC 3 的節名列舉 | 見該條註記的 grep |
> | `test/rules/discretion-tiers.test.js:144,253,258` | 見 AC 8 的驗證側記 | `grep -n 'CANONICAL_PUSH_SAFETY_LINE\|CANONICAL_EFFICACY_SECTION' test/rules/discretion-tiers.test.js` |

## Acceptance Criteria

- [x] `rules/git-workflow.md` 與 `.claude/` 鏡像載明：hook 已安裝時為 terminal credential，未安裝時 AskUserQuestion 即為授權（方案 A），且安裝來源為 `/codex-setup`
- [x] `rules/discretion.md` 與 `.claude/` 鏡像的 efficacy boundary 條件化改述，未留下「pre-push-gate 必然存在」的敘述
- [x] `skills/push-ci/SKILL.md` **五處**（`:26,32,36,96,104`）全部條件化，skill 內部無自相矛盾，且不再宣稱 `/install-scripts` 安裝 hook

  > **五處的現行位置（2026-08-20 doc review round 16 記入；2026-08-21 把被就地改寫的 AC 原文還原，改以本註記追加）**。AC 原文的 `:26,32,36,96,104` 是 2026-08-15 的座標，重新推導後其中四個已落在空行或無關註解上——該檔在 r5 的 `--force-with-lease` 落地後大幅位移。以**節名**標定的現行五處為：§ Defense in Depth 表的 **L1** 列（標 opt-in）、其下「Which layer authorizes depends on whether L1 is installed」段、該段的憑證矩陣（`L1 installed` ÷ `L1 not installed` 兩欄）、Phase 0 的 `PUSH_GATE` 回報段（`absent` 時明說沒有終端憑證）、Phase 0 protected pre-approval flow 第 3 步；行號請以 `grep -n 'opt-in\|is installed\|not installed\|Where the' skills/push-ci/SKILL.md` 現場推導
- [x] 新增 `test/skills/push-ci.test.js`，同時釘住「hook 已安裝」與「hook 未安裝」兩個分支的授權敘述
- [x] 六份 README 全部相關敘述同步且語意一致：安裝段落區分 `commit-msg` 預設安裝與 `pre-push` opt-in（不再以複數 "git hooks" 暗示兩者皆裝），其餘契約敘述（含 enforcement 段與 rules 總覽段的「git 層級護欄維持硬性」）一併條件化；**生成段落改在產生器**（`scripts/generate-readme-catalog.js:244` 與 fixtures `test/scripts/generate-readme-catalog.test.js:1741,2113`），改後 `node scripts/generate-readme-catalog.js --check` 退出 0，locale 再經 `/readme-i18n-sync` 傳播
- [ ] 本單與 r2、r4 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度
- [x] `test/rules/discretion-tiers.test.js` 三條斷言更新，且仍以斷言釘住新契約（非刪除了事）

  **驗證側記（2026-08-21）**。本條不記「改了幾行／加了幾條斷言」這類定值——那些值在同一個 review 迴圈內每輪都會變，寫下即過期。可稽核的寫法是把推導指令寫進文件本身（`@rules/auto-loop.md` § Cap Diagnostic Protocol 的 `UNVERIFIED_CLAIM` bounded direction）：

  | 要問的事 | 推導指令 |
  | -------- | -------- |
  | 本單對該測試檔改了多少 | `git diff --numstat HEAD -- test/rules/discretion-tiers.test.js` |
  | 全檔斷言數 | `grep -c 'assert\.match' test/rules/discretion-tiers.test.js`；`grep -c 'assert\.doesNotMatch' …` |
  | HEAD 的測試條數 | `git show HEAD:test/rules/discretion-tiers.test.js \| grep -cE '^test\('` |
  | 該檔是否全綠 | `node --test test/rules/discretion-tiers.test.js` |

  改動的**性質**（不隨行號漂移）：兩處刪除皆為就地替換——授權行擴為含 `--force-with-lease`、訊息條件化；另有 `CANONICAL_PUSH_SAFETY_LINE` 逐位元釘死整段契約。
- [x] 全 repo grep 確認 `rules/`、`skills/`、README 三處已無殘留的無條件終端確認敘述

  > **執行結果（2026-08-21 由條文行移入本註記）**：條文行原本把下述發現直接接在要求之後，讀起來像是當初就這樣要求的。條文一字未刪，只是移位——AC 陳述當初要的，發現寫在註記裡。
  >
  > **首次掃描並非乾淨**：`rules/discretion.md` § Proposal Channel 的括號句「`pre-push-gate.sh` over `/dev/tty` is the credential and AskUserQuestion is advisory」是同類殘留，且本單收尾 grep 的三組 pattern 都抓不到它（它用不同措辭陳述同一契約）。已改為條件化敘述，並把該契約獨立成 `rules/discretion.md` § Efficacy Boundary、以 `CANONICAL_EFFICACY_SECTION` 整段逐位元釘死（`test/rules/discretion-tiers.test.js`）。這條護欄的三次改版史（黑名單 → 段落 pin → 整段 pin → 契約獨立成區段）與 round 3 對「逐位元」一詞的更正，**已於 2026-08-21 round 29 移出本單**，去向 [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § `CANONICAL_EFFICACY_SECTION` 護欄的三次改版——依 `skills/create-request/SKILL.md` § Write-Time Budget：「A ticket carrying 「Round 1 … Round 7 …」 is a review log wearing a ticket’s name」。整段搬移未改寫，技術經過另見 [`../4-implementation.md`](../4-implementation.md) § 2.1
- [ ] Pass `/codex-review-fast`（tier `thorough` —— push safety 屬 security 變更，Anchor Register #3）
- [ ] Pass `/precommit`
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 三方案提呈，使用者選定 A；doc review R2 補出 push-ci 漏兩處、README 漏三段；R3/R4 進一步釐清 r2/r3/r4 之間的約束是原子性而非先後 |
| Development | Done | `rules/git-workflow.md` § Push safety 與 `rules/discretion.md` § **Efficacy Boundary** 皆改為條件式（hook 在→terminal credential；不在→AskUserQuestion 即授權）；`skills/push-ci/SKILL.md` 五處條件化；六份 README 同步，生成段落改在 `scripts/generate-readme-catalog.js`，`--check` 退出 0。**節名注意**：開單當時 `rules/discretion.md` 的該節叫 `## Proposal Channel (efficacy boundary)`，故 § Background 與 § Related Files 沿用該名；本單把它拆成 `## Proposal Channel` 與 `## Efficacy Boundary` 兩節，被條件化的 credential 敘述落在後者。對比指令：`git show HEAD:rules/discretion.md \| grep -n '^## '` 與工作樹的同一指令 |
| Testing | Done | 新增 `test/skills/push-ci.test.js`，釘住 hook 在／不在兩個分支；`test/rules/discretion-tiers.test.js` 釘住新契約而非刪除。條數與斷言數不寫定值（每輪會變），推導指令見上方 AC 8 的驗證側記；收尾 grep 見 r4 |
| Acceptance | Blocked | `thorough` 的 30 輪上限在 round 30 觸及；因屬 security 變更，依 @rules/auto-loop.md § Cap Diagnostic Protocol 直接走 ⚠️ Need Human。使用者其後明示授權延長至 **round 32**，該額度已用盡：round 30/31/32 各回一條 P2，全部針對「efficacy boundary 這道護欄該寫在哪個單位上」，且每一輪都關閉了前一輪的 finding（無 stall streak）。round 32 的補救（契約獨立成 `rules/discretion.md` § Efficacy Boundary + 整段 pin）**已落地但尚未複審**，故 code 平面仍記為 ⛔ Blocked。smart-rebase 的缺陷已於 2026-08-20 抽離為獨立變更（`docs/features/ref-name-hardening/`），不再阻塞本單。詳見 `../4-implementation.md` § 2.1 |

## References

- 契約煞車：`rules/discretion.md` §「No register item may be re-labelled…That is a spec change requiring human approval **and** updating `test/rules/discretion-tiers.test.js`」
- 審查層級依據：`rules/auto-loop.md` § Tiers —— security 變更一律以 `thorough` 審
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)
- 同批單：[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)、[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)

> **2026-08-21 更正（記錄還原）**
>
> 頁首 `Tech Spec` 那行上一輪被就地改寫成指向 `../2-tech-spec.md` 的連結。原句已還原：撰寫當時
> 這張單確實沒有 tech spec，寫著 `Pending` 是當時成立的事實，把它改成今天的連結等於用後見之明覆寫
> 記錄。實際的關聯改以本註記表述——設計面現在落在
> [`../2-tech-spec.md`](../2-tech-spec.md) § 2.3（推送授權契約，方案 A）。
>
> 這是與 r4 § References 同一類的錯誤，同一輪各犯一次：request ticket 是記錄，可變欄位只有
> Status／Progress 表／AC 勾選／Progress.Note 四項（`skills/create-request/SKILL.md` § Phase 4.5），
> `Tech Spec` 不在其中。上一輪我掃自己的就地改寫時，把 `Tech Spec` 連同那四項一起濾掉，於是掃出
> 「只有一處」——漏的不是證據，是把不可變欄位算進了可變集合。

> **2026-08-22 更正（用詞精確度）**
>
> 上方 AC 註記寫「以 `CANONICAL_EFFICACY_SECTION` 整段**逐位元**釘死」——「逐位元」用錯了對象。
> `test/rules/discretion-tiers.test.js` 對這兩道護欄用的是兩種比對：
>
> | 護欄 | 比對方式 | 「逐位元」是否成立 |
> |------|----------|-------------------|
> | `CANONICAL_PUSH_SAFETY_LINE` | 取出的行直接 `!==` 常數 | ✅ 成立（本單上一則註記那句沒問題） |
> | `CANONICAL_EFFICACY_SECTION` | 先把連續空行摺成一行、再去掉尾端空行，然後才比對 | ❌ 不成立 |
>
> 差別是實質的而非修辭：在 § Efficacy Boundary 段落之間多插一個空行、或在段尾留下空行，**不會**
> 讓那個測試變紅；同樣的改動落在 push safety 那一行上會。把後者的性質寫在前者身上，會讓讀者以為
> 這段的空白也在契約裡，於是在不必要的地方綁手綁腳，也讓真正該注意的地方（任何一句被增刪或改寫）
> 顯得沒那麼特別。
>
> 依 `skills/create-request/SKILL.md` § Phase 4.5，記錄以追加更正表述，條文與原註記一字未改。

> **2026-08-22 收尾註記（round 81，使用者裁示停手）**
>
> 使用者在 round 80 之後裁示：對當時那棵樹再派一次 code + doc review，**不論回 Ready 或 Blocked
> 都停下來交接**，不再進入修復迴圈。round 81 兩個平面都回 blocked——code `⛔ Blocked`
> （`gate_reason=IN_SCOPE_BLOCKING`，3 筆：1×P1 + 2×P2）、doc `⛔ Needs revision`（4×P2）。
> 七筆**全部開著、未修**，逐筆內容記在
> [`../review-log-push-gate-optin.md`](../review-log-push-gate-optin.md) § Round 81。
>
> 本單 Status 維持 `In Progress`，AC 維持 7/11——round 79–81 做的是內部強化（`readonly`
> 拒絕紀錄凍結、Husky 接線判定的三次收窄），沒有推進任何一條 AC。未勾選項全部是品質閘
> （`/codex-review-fast`、`/precommit`、`/codex-review-doc`）、需要 commit 才成立的
> 「同一批落地」條款，或先前已裁示刻意不勾的項目。
>
> 停手時的實測狀態：全測試套件 4097 tests / 4093 pass / 0 fail / 4 skipped；
> `node scripts/check-comment-blocks.js` exit 0（18 筆既有 WARN、0 BLOCK）。
> `/precommit`、Adequacy Gate、Doc Sync 這一輪都沒有抵達，依 `rules/auto-loop.md` 的終局完成
> 不變式，這批變更**尚未完成**，只是停在可交接的位置。
