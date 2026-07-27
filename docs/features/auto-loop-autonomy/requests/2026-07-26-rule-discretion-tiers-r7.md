# 規則授權層級與提案核准通道 (R7)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Pending
> **Note**: 本張橫跨全部 `rules/`，風險最高 — 寫鬆了會讓模型有理由合理化跳過 review。必須在 R2（事實訊號就位）之後執行。父 tech spec 尚未建立（見 References）
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

- [ ] 三級分層在 `rules/` 中有單一權威定義；**12 個 plugin 受管規則檔**的每條指示皆解析為恰好一個層級（含位於首個 `##` 之前的 preamble 指示）
- [ ] 兩個 user-owned 覆寫檔的語意在本張完成後**未被改變**（diff 可證未觸及），且分層定義明文標示其分類由 R8 處理
- [ ] 錨點以**封閉清單**列舉，至少涵蓋安全、資料完整性、機密記錄、git 破壞性操作、auto-loop 四大錨點；每個含既有例外者，其例外清單一併列為錨點契約的一部分
- [ ] `/push-ci`、`/smart-commit --execute`、`/epic-merge` 三個既有核准工作流在改造後仍然有效，且有測試釘住（防止錨點被寫成無條件形式而抹除它們）
- [ ] 改造前後比對可證：無任何現有錨點被降級為 Default 或 Guidance
- [ ] 偏離 Default 時的陳述格式有明文定義，且要求引用具體事實訊號而非泛稱判斷
- [ ] 提案通道明訂效力邊界，並載明 AskUserQuestion 可能因 session 快取自動核准、不得作為安全性核准的唯一憑據
- [ ] 提案通道明訂**觸發條件為封閉集合**（Anchor 衝突、不可逆後果），且規則中含明文條款排除「不確定就先問」的讀法；Default 範圍內的判斷一律以「陳述理由後續行」處理，不得停下等待回覆
- [ ] `auto-loop.md` 四大錨點在新分層下仍為 Anchor，且規則中無任何可解讀為「可自行判斷是否 review」的措辭
- [ ] 錨點測試集除四大錨點外，另**明確涵蓋三條可執行的迴圈義務**，防止日後改標籤即繞過：(a) 編輯後須觸發 review 的轉移、(b) tier 只決定審查深度、**永不決定迴圈是否執行**、(c) 任何 code 編輯重置審查週期
- [ ] `test/rules/discretion-tiers.test.js` 釘住上述封閉集合，任何項目被移除或降級為 Default／Guidance 即測試失敗
- [ ] Pass /codex-review-doc
- [ ] Pass /precommit

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
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 前置: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
- 相關: [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md)
- 相關: [Auto-Loop 觸頂診斷協定 (R6)](./2026-07-26-cap-diagnostic-protocol-r6.md)
- 後續: [規則覆寫契約遷移 (R8)](./2026-07-26-override-contract-migration-r8.md) — 兩個 user-owned 覆寫檔的分類與 precedence 契約
- 唯一既有授權句: `rules/auto-loop.md:5`
