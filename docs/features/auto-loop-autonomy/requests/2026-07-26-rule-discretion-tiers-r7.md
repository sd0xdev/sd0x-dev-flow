# 規則授權層級與提案核准通道 (R7)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 本張橫跨全部 `rules/`，風險最高 — 寫鬆了會讓模型有理由合理化跳過 review。必須在 R2（事實訊號就位）之後執行。父 tech spec 尚未建立（見 References）。實作採需求允許的「單一索引」形式（`rules/discretion.md`），12 受管檔本體未動
> **Priority**: P1
> **Depends On**: [R2](./2026-07-26-factual-hook-signals-r2.md) · [R3](./2026-07-26-auto-loop-prose-reduction-r3.md) · [R5](./2026-07-26-code-comment-doc-pointer-r5.md) · [R6](./2026-07-26-cap-diagnostic-protocol-r6.md) — 本張是**最後的全規則整合分類**，須待前述各張對 `rules/` 的新增與改寫定稿，否則新寫入的指示會漏標層級
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`

## 全組執行順序

本張為分層標註的終點，因此在此記錄八張單的順序（三張單都改寫 `rules/auto-loop.md`，順序錯了會互相覆蓋）：

```
R1 ──► R2 ──┬──► R3 ──► R6 ──┐
            │                ├──► R7 ──► R8（覆寫契約遷移，最後）
            └──► R4          │
                             │
R5（無前置，可與 R3 並行）────┘
```

| 單 | 前置 | 與 `rules/auto-loop.md` 的關係 |
|----|------|------------------------------|
| R1 | — | 無 |
| R2 | R1 | 無（改 hook 輸出） |
| R3 | R2 | **重寫**（散文縮減） |
| R4 | R2 | 無 |
| R5 | — （可與 R3 並行） | 無，但新增 `docs-writing.md` 指示 |
| R6 | R2 · R3 | **改寫 § Exit Conditions** |
| R7 | R2 · R3 · R5 · R6 | **分類標註 12 個受管檔的指示** |
| R8 | R7 | 覆寫檔分類 + precedence 契約遷移 |

## Background

「信任模型能力」目前在 `rules/` 中只有**一句**成文授權——`rules/auto-loop.md:5`：

> Where this rule leaves room for judgment, use it; where it states an anchor, the anchor is not negotiable.

其餘 13 個規則檔皆無等價語句（導出指令：`grep -rliE "room for judgment|自行判斷|模型.*判斷" rules/*.md`，僅 `auto-loop.md` 命中）。

強制性語彙的分佈實測。**絕對數對詞表與大小寫處理高度敏感，因此以下同時列出兩種計法，可靠的訊號是排序而非數值**：

```bash
# 大小寫敏感（A 欄）
grep -oE "MUST|NEVER|必須|不得|禁止|forbidden|Prohibited|never|must not" rules/<f>.md | wc -l
# 大小寫不敏感（B 欄）
grep -oiE "must|never|必須|不得|禁止|forbidden|prohibited" rules/<f>.md | wc -l
```

| 檔案 | A（敏感） | B（不敏感） | 行數 | A 密度 |
|------|-----------|-------------|------|--------|
| `rules/auto-loop.md` | 8 | 14 | 183 | 4.4% |
| `rules/context-management.md` | 4 | 7 | 36 | 11.1% |
| `rules/git-workflow.md` | 2 | 2 | 15 | **13.3%** |
| `rules/codex-invocation.md` | 2 | 6 | 42 | 4.8% |
| `rules/docs-numbering.md` | 2 | 2 | 80 | 2.5% |
| `rules/testing.md` | 0 | 7 | 71 | 0.0% |
| 其餘 8 檔 | 0–1 | 0–3 | — | — |

**兩個指標的排序不同，故分開陳述**：絕對數以 `auto-loop.md`（A=8 / B=14）居首；每行密度以 `git-workflow.md`（13.3%）居首、`context-management.md`（11.1%）次之。`testing.md` 在方法 B 下有 7 次而方法 A 為 0，顯示其強制語彙全為小寫散文形式——這正是「絕對數對詞表與大小寫高度敏感」的例證，也是本張改以**分層標註**取代語彙統計的理由：統計只用來說明問題規模，不作為分類依據。

問題不在數量而在**未分層**：「絕不記錄私鑰」與「文件超過 500 行就拆檔」以相同的語氣書寫，模型無從判斷哪些可依情境調整、哪些是紅線。結果是兩種失敗都會發生——該守的被權衡掉，該權衡的被機械照做。

**既有的提案先例**：`rules/git-workflow.md:7-9` 已有「X may do Y after explicit user approval via AskUserQuestion」的句型，本張是將其一般化。

**但該管道有已載明的弱點**：同檔 `:14` 寫著「AskUserQuestion in `/push-ci` is **advisory only** (session caching may auto-approve)」——AskUserQuestion 可能因 session 快取被自動核准，因此**不足以作為安全性核准的唯一憑據**。真正的 push 保護是 `pre-push-gate.sh` 這個走 `/dev/tty` 的 git hook。本張的提案通道設計必須繼承此教訓。

## Requirements

- 為所有 `rules/` 的指示建立**三級分層**：不可協商錨點 / 預設值（可帶理由偏離） / 純建議
- 錨點集合須明確列舉且封閉，至少涵蓋：安全、資料完整性、機密記錄、git 破壞性操作、auto-loop 四大錨點
- 偏離預設值時，須陳述理由與所依據的事實訊號；偏離不得是靜默的
- 建立向人類提案核准的通道，並明訂**其效力邊界**——不得將 AskUserQuestion 當作安全性核准的唯一憑據
- 授權不得成為跳過 review 的理由：`auto-loop.md` 四大錨點在任何分層下皆屬錨點
- **提案通道不得降低自主性。** 分層與提案通道的目的是讓模型在 Default 範圍內**自行判斷後繼續執行**，而非增加停下詢問的次數。提案僅用於 Anchor 衝突、或偏離會造成不可逆後果時；能以「陳述理由後續行」處理者，一律續行不問。規則措辭須明確排除「不確定就問」這種讀法
- 分層須寫在各規則檔內或單一索引，模型讀規則時即可判定層級，無需推測

## Scope

| Scope | Description |
| ----- | ----------- |
| In | 三級分層定義；錨點封閉清單；偏離的陳述格式；提案通道與其效力邊界；**12 個 plugin 受管** `rules/*.md` 的指示標註（含 preamble 指示） |
| Out | 兩個 user-owned 覆寫檔的分類與 precedence 契約（**R8**）；放寬任何現有錨點（安全 / 機密 / git 破壞性操作 / 四大錨點）；hook 強制執行分層；新增核准機制的程式實作（如 `/dev/tty` 確認 — 屬硬化軌）；`rules/` 內容縮減（R3、R5 分別處理） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `rules/auto-loop.md` | Modify | `:5` 的授權句一般化；四大錨點明確標為錨點層級 |
| `rules/git-workflow.md` | Modify | 紅線標為錨點；`:14` 的 AskUserQuestion 效力邊界提升為通用原則 |
| `rules/security.md` | Modify | 全檔標為錨點層級 |
| `rules/logging.md` | Modify | `:5` 機密清單標為錨點 |
| `rules/context-management.md` | Modify | 密度最高者；四條 ❌ 逐條分層 |
| `rules/docs-numbering.md` | Modify | 500 行上限等標為預設值（可帶理由偏離） |
| `rules/testing.md` · `rules/docs-writing.md` · `rules/codex-invocation.md` · `rules/fix-all-issues.md` · `rules/framework.md` · `rules/self-improvement.md` | Modify | 逐條標註層級 |
| `rules/auto-loop-project.md` · `rules/testing-project.md` | Reference | **不在本張範圍**，分類與 precedence 契約由 [R8](./2026-07-26-override-contract-migration-r8.md) 處理 |
| `test/rules/discretion-tiers.test.js` | New | 錨點清單完整性、標註格式、錨點未被降級、三條迴圈義務、三個既有 git 核准工作流仍有效 |

**分層草案**

| 層級 | 語意 | 偏離要求 | 例 |
|------|------|---------|-----|
| **Anchor** | 不可協商 | 不允許 | 絕不記錄私鑰；Claude 不在**明列的核准工作流之外**執行 `git commit`；Declaring ≠ Executing |
| **Default** | 預設如此，模型可依情境判斷 | 陳述理由 + 所依據的事實訊號 | 文件 500 行上限；tier 選擇；測試分層位置 |
| **Guidance** | 建議 | 無 | 表格優於段落；命名慣例 |

**錨點含其既有例外，例外是錨點契約的一部分而非缺口。** `rules/git-workflow.md:7-9` 已明列 `/push-ci`、`/smart-commit --execute`、`/epic-merge` 三個經使用者核准後可執行破壞性 git 操作的工作流。若把錨點寫成「Claude 絕不執行 `git commit`」的無條件形式，會抹除這些既有授權流程；正確表述是「不在明列清單之外執行」，且該清單的增刪本身也是錨點層級的變更。

**user-owned 覆寫檔不在本張範圍，改由 [R8](./2026-07-26-override-contract-migration-r8.md) 承擔。** 原先設想的「繼承母檔分層」經查不成立——`auto-loop-project.md` 的六個段落中有三個無母檔同名對應、`testing-project.md` 的 `## Adequacy Mode`（`:29`，目前在 `<!-- -->` 內）自述為 project-only 擴充、兩檔的 precedence 與覆寫說明位於第一個 `##` **之前**（heading 級對照表構不到）、且 `## Tier` 一個段落內同時含可設定項與不可協商的安全規則。更根本地，讓 Anchor 勝過覆寫檔等於變更 `docs/features/rule-override-pattern/2-tech-spec.md:98`（section-level full replacement）與 `:100`（heading 須與母檔完全相同）這份既有契約——那是規格遷移，不是標註工作。R8 另查出該契約的承載形式本身有缺陷（`:105`），詳見該張。

本張因此只處理 **12 個 plugin 受管規則檔**。R8 完成前，兩個覆寫檔維持現行語意不變。

## Acceptance Criteria

- [x] 三級分層在 `rules/` 中有單一權威定義；**12 個 plugin 受管規則檔**的每條指示皆解析為恰好一個層級（含位於首個 `##` 之前的 preamble 指示）— 採需求允許的**單一索引**形式：新檔 `rules/discretion.md` 開頭即定義解析規則「Anchor Register hit → Anchor；否則檔案例外；否則檔案 baseline」，preamble 依同規則解析；12 檔 baseline 表以測試逐格 deepEqual 釘住
- [x] 兩個 user-owned 覆寫檔的語意在本張完成後**未被改變**，且分層定義明文標示其分類由 R8 處理（`discretion.md` preamble 末句）— 出處證明（AC-trace High 修正）：`git diff HEAD -- rules/testing-project.md` 為**空**；`rules/auto-loop-project.md` 的工作樹 diff 屬 **R6 的變更集**，其單張級出處記錄於 [R6](./2026-07-26-cap-diagnostic-protocol-r6.md) 的 Scope In（`auto-loop-project.md 的設定項更新`）、Related Files（`rules/auto-loop-project.md | Modify | ## Think Harder 語意更新`）與 Development 註記；R7 自身的變更清單（本單 Progress.Development）不含任一覆寫檔
- [x] 錨點以**封閉清單**列舉（7 項 Anchor Register），涵蓋安全（#1）、資料完整性（#3）、機密記錄（#2，含禁止含 secrets 的 commit）、git 破壞性操作（#4）、auto-loop 四大錨點（#5）；#4 內明列三工作流例外與 `--ai-co-author` 精確白名單行，並載明「例外清單本身屬錨點」
- [x] `/push-ci`、`/smart-commit --execute`、`/epic-merge` 三個既有核准工作流在改造後仍然有效，且有測試釘住 — 測試釘住 `git-workflow.md` 三條完整 Exception 行 + 各 SKILL.md 的核准契約句 + `pre-push-gate.sh` 主閘門句
- [x] 改造前後比對可證：無任何現有錨點被降級為 Default 或 Guidance — register 測試斷言七項識別字精確有序，且逐項禁止 `→ Default|Guidance` 降級標記；「改造前」清點另以 `FROZEN_ANCHOR_INVENTORY`（AC-trace High 修正、code review 硬化）為基準：**明示凍結、具日期（2026-07-29）的手寫 before-oracle**，18 條逐項涵蓋 security 全部 5 條 Prohibited、logging never-log、git 四項（forbidden ops／protected branches／force push／secrets commit）、testing 三條 ❌ Never 逐列、auto-loop 終局不變量＋三不等式＋cycle reset、context 兩條；每條同時驗證來源片語存活**且**映射進 register/baseline（刻意不採 runtime 衍生——衍生會隨其欲防之變異一同漂移）
- [x] 偏離 Default 時的陳述格式有明文定義（`[DEVIATION] rule= default= chosen= reason= signal=`），signal 須為 `[AUTO_LOOP_STATE]` 欄位、量測值或 reviewer verdict，明文「Silent deviation is a violation」
- [x] 提案通道明訂效力邊界，並載明 AskUserQuestion 可能因 session 快取自動核准、不得作為安全性核准唯一憑據——並區分「工作流內未指名更強機制者（smart-commit/epic-merge）仍必要且充分」與「指名更強機制者（push-ci → `pre-push-gate.sh` 為終局憑據）」
- [x] 提案通道明訂**觸發條件為封閉集合**（Anchor 衝突、不可逆後果），且明文「Uncertainty is NOT a trigger for this channel」；封閉集合限定於規則偏離核准，明文不限縮 `auto-loop.md` 自身的 Need Human 出口（REQUIREMENT_AMBIGUITY 出口保持以觸頂診斷為前提）
- [x] `auto-loop.md` 四大錨點在新分層下仍為 Anchor（Register #5），且「Authorization is never a reason to skip review」明文收尾；負向半邊（AC-trace Medium 修正）：`auto-loop.md when scanned` 測試以 8 族禁用樣式（附 12 正 10 反自驗 fixtures）掃描 `rules/auto-loop.md`，任何「可自行判斷是否 review」措辭（may decide whether review、review optional、skip review 等）入檔即失敗（sentinel token 先剝除防誤中）
- [x] 錨點測試集除四大錨點外，另涵蓋三條迴圈義務（Register #6 (a)(b)(c)：編輯重開閘門、tier 只決定深度、code 編輯重置審查週期），測試釘住其逐字內容
- [x] `test/rules/discretion-tiers.test.js` 釘住上述封閉集合（19 tests）：strict `parseTable` 消費全部表列、格數精確驗證防走私；register 七項 deepEqual；baseline 12×3 全格 deepEqual；移除或降級即失敗
- [x] Pass /codex-review-doc — ✅ Mergeable（1 輪修 2 P1：提案通道與 auto-loop 人類出口的矛盾、Register 漏列 secrets commit；1 Nit deferred：`§` 引用指向行內標籤）
- [x] Pass /precommit — ✅ PASS，0 fail（首跑揪出 `test/rules/` 不在任何 npm 分割腳本，已補進 `test:schema`/`test:fast`）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 分層數 | 三級 | 二級（強制／建議） | 二級會把「可帶理由偏離」擠進其中一邊，而那正是本張要創造的空間 |
| 錨點集合 | 封閉列舉 | 以原則描述 | 原則描述可被重新詮釋；封閉清單可被測試釘住 |
| 偏離要求 | 陳述理由 + 引用事實訊號 | 靜默偏離 | R2 讓事實訊號可得，偏離才有可稽核的依據 |
| 提案通道 | 明訂效力邊界 | 直接沿用 AskUserQuestion | `git-workflow.md:14` 已載明其可被 session 快取自動核准 |
| 四大錨點 | 維持 Anchor | 納入可判斷範圍 | 這四條正是為了防止模型合理化跳過 review 而存在，授權它們自我豁免會使整套機制失效 |

## Known Limitation

本張擴大模型的裁量空間，而在 `STOP_GUARD_MODE=warn` 下規則層本就沒有機械強制力——分層因此主要影響**模型如何自我約束**，而非外部能否阻止。錨點清單的測試只能證明文件未被改動，無法證明執行期被遵守。這是宣告半徑內的固有限制。

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 授權語句唯一性、強制語彙密度、AskUserQuestion 效力弱點皆經實測 |
| Development | Done | 單一索引 `rules/discretion.md`（~63 行）＋ 3 份 CLAUDE 模板 import ＋ 6 README／docs/rules.md／project-setup 計數同步；12 受管檔本體零修改（單一索引形式使逐檔標註不必要） |
| Testing | Done | `test/rules/discretion-tiers.test.js` 19 tests；code review 8 輪 ✅ Ready（結構化封閉性經多輪硬化：resolution-order 逐字釘、register/baseline deepEqual、strict parseTable 防走私、效力邊界 push 分流、REQUIREMENT_AMBIGUITY 觸頂前提）；precommit ✅ PASS |
| Acceptance | Done | doc review ✅ Mergeable；AC-trace（advisory）⛔ → 2 High + 1 Medium 以測試與出處證據補齊後再審，見 Implementation Notes |

## Implementation Notes

- **單一索引決定**：需求允許「寫在各規則檔內**或單一索引**」；採單一索引（`rules/discretion.md`）使 12 受管檔本體零修改——標註漂移面集中於一檔，且 Related Files 原列的逐檔 Modify 因此不適用（該表為開單時的預估形式）。
- **封閉性硬化沿革**（code review 8 輪，其中 6 輪有修正）：R1 修 `.claude/CLAUDE.md` gitignored 測試缺口、效力邊界誤撤銷工作流、結構化釘樁不足、attribution 無條件化；R2 修 push-ci「必要且充分」矛盾（引入「未指名更強機制」限定）、baseline 全格 deepEqual、工作流全句釘樁；R3 修 filter+slice 可走私解析 → strict `parseTable`；R4 ✅；R5 修 baseline secrets 指標懸空（#4→#2 拆分）與 REQUIREMENT_AMBIGUITY 觸頂前提；R6 ✅；R7 修 AC-trace 補救測試之清點不完整（凍結 oracle 化＋補全 18 條）；R8 修掃描器假陰陽（8 族樣式＋自驗 fixtures）✅ Ready。
- **Adequacy（advisory ⛔ → 缺口處置）**：High AC2（覆寫檔出處）以 R6 單張級出處 + 空 diff 補證；High AC5（前後清點）以來源片語為 before 基準的 `legacy anchors when migrated` 測試補齊（regression 類 AC 不得以手動例外處理，per `rules/testing.md`）；Medium AC9（負向措辭）以禁用樣式掃描補齊（初版 4 族，code review R8 擴充為最終 8 族＋自驗 fixtures）。均入測試後送 AC-trace 再審。
- **`[NIT_DEFERRED]`**（隨下次 `/codex-review-branch` 處理）：separator row 未逐格驗證 `/^:?-+:?$/`（code R4）；`§ Prohibited`/`§ Push safety` 引用行內標籤而非真 heading（doc R2）。

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 前置: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
- 相關: [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md)
- 相關: [Auto-Loop 觸頂診斷協定 (R6)](./2026-07-26-cap-diagnostic-protocol-r6.md)
- 後續: [規則覆寫契約遷移 (R8)](./2026-07-26-override-contract-migration-r8.md) — 兩個 user-owned 覆寫檔的分類與 precedence 契約
- 唯一既有授權句: `rules/auto-loop.md:5`
