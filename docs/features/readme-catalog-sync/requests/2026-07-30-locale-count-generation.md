# Locale README Count Generation + Hero Tail Derivation

> **Created**: 2026-07-30
> **Status**: Pending
> **Priority**: P2
> **Tech Spec**: [Tech Spec](../2-tech-spec.md)

## Background

v4.1.0 的 README v4 全篇重寫（英文 + 5 locale）驗證了一個既知缺口：generator 只產生英文 README 的 5 個 marker 區塊，locale README 的 marker 區塊為手動同步。目前 locale 區塊內的計數（96 bundled/public）落後英文（98）。現有 locale drift 測試釘的是 Hooks/Scripts 資源列、在地化 prose 的 hook 計數、與 tier round cap 對 `rules/auto-loop.md` 的一致性 —— 但**沒有任何測試釘 locale 的 skill 計數欄位**（HERO-COUNT、INSTALL-COVERAGE、What's Included、FULL-CATALOG summary/分類計數），drift 因此未被擋下。另外 HERO-COUNT 區塊內的 `~4% of Claude's context window` 尾綴是寫死的 prose，不是由 token 量測衍生，generator 無法驗證其真實性。

## Requirements

- generator 為 6 個 README（en + 5 locale）更新 **count-bearing marker 區塊**（HERO-COUNT、INSTALL-COVERAGE、WHATS-INCLUDED-COUNT、FULL-CATALOG 的 summary/分類計數）；ESSENTIAL-SKILLS 不含計數，明確排除在本張範圍外
- **在地化保留模型須二擇一並以測試釘住**（實作時決策並記錄）：(a) 只改寫衍生的數字/條目，保留 locale 自有文字（FULL-CATALOG 的在地化 summary、分類標題、表頭、描述，如 `README.zh-TW.md` 的分類段落）；或 (b) 引入完整 locale 模板/資料（glossary 目前只提供 Skills/Agents/Hooks/Rules/Scripts 五個標籤，不足以支撐 (b)，選 (b) 需先擴充）
- 修正現存 96→98 locale hero drift（generator 首跑即應消除）
- HERO-COUNT 的 `~4%` 尾綴改為 derive-or-remove：由 token 量測腳本衍生，或自 marker 區塊移出成手寫 prose
- 測試釘住修訂後的 contract：6 檔 skill 計數欄位與 disk inventory 相等；並涵蓋 marker 區塊外的 `allowed-tools` 宣告計數（harness 表第 5 列，6 檔現為 89/98，目前無測試釘住）— 納入生成、納入 drift 測試、或明確記錄排除，三擇一並記錄決策

## Scope

| Scope | Description |
|-------|-------------|
| In | `scripts/generate-readme-catalog.js` 多檔輸出、locale 標籤表、hero 尾綴 derive-or-remove、`test/scripts/generate-readme-catalog.test.js` contract 更新 |
| Out | locale prose 翻譯自動化（仍走 `/readme-i18n-sync`）、CI auto-trigger（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/generate-readme-catalog.js` | Modify | 多檔 marker 生成 + locale 標籤 + hero 尾綴處理 |
| `test/scripts/generate-readme-catalog.test.js` | Modify | 6-locale count contract、hero 尾綴新 contract |
| `README.md` + 5 locale README | Regenerate | marker 區塊由 generator 重寫 |
| `skills/readme-i18n-sync/references/glossary.md` | Read / Modify if (b) | locale 類別標籤來源；選模型 (b) 時需擴充 |

## Acceptance Criteria

- [ ] generator 一次執行更新 6 個 README 的 count-bearing marker 區塊（HERO-COUNT / INSTALL-COVERAGE / WHATS-INCLUDED-COUNT / FULL-CATALOG 計數；ESSENTIAL-SKILLS 除外）
- [ ] 在地化保留模型已決策（(a) 或 (b)）並有測試證明：locale 自有文字在重生成後存活，只有預期的生成欄位改變
- [ ] locale hero 計數與英文一致（98/98），96→98 drift 消除
- [ ] `~4%` 尾綴：衍生自量測，或移出 HERO-COUNT 區塊（擇一，記錄決策）
- [ ] locale drift 測試涵蓋 skill 計數欄位（HERO-COUNT、INSTALL-COVERAGE、What's Included、FULL-CATALOG summary 與各分類計數），並對 marker 外的 `allowed-tools` 計數（89/98）依 Requirements 的三擇一決策執行（生成／釘住／明確記錄排除）
- [ ] 既有 40 個 catalog 測試全數通過（contract 修訂處除外，需同步更新）
- [ ] `/codex-review-fast` → `/precommit` 通過

## Progress

| Phase | Status |
|-------|--------|
| Development | Pending |
| Testing | Pending |
| Acceptance | Pending |

## References

- 前置：[2026-04-07 README Skill Catalog Auto-Sync](./2026-04-07-readme-catalog-auto-sync.md)
- 觸發脈絡：v4 README 全篇重寫（2026-07-30）發現 locale 計數 drift 與 hero 尾綴不可驗證

## Outcome — Partially Addressed (2026-08-13)

**這批做的不是本 request 提的解法。** 本 request 主張讓 generator 一次寫入六份 README 的 marker 區塊（AC 1）；
2026-08-13 這批改採「locale 仍手動同步，但 drift 由 CI 擋下」的路線。

兩個階段要分開講，本批只處理後者：**手動同步製造了 drift 的機會，缺測試讓 drift 逃過偵測。** generator 路線
（AC 1）能消滅前者，但其成本——在地化文字保留模型、locale 類別標籤來源——仍未償還，因此延後而非否決。

| AC | 狀態 | 證據 |
|----|------|------|
| generator 一次更新 6 份 README | **未做** | `generate-readme-catalog.js` 只有一個 `README_PATH`，仍只寫 `README.md` |
| 在地化保留模型已決策 | **未做（隨 AC 1 延後）** | 本批未走 generator 路線，此決策未做出；AC 1 恢復時必須先解決 |
| locale hero 計數與英文一致 | **已達成** | 六份皆 99/99/15；測試分別與 `docs/skill-catalog.yml`、`git ls-files skills/`、`agents/` 衍生出的數字比對 |
| `~4%` 尾綴衍生自量測或移出 | **未做** | 仍寫死在 `generate-readme-catalog.js` 的 `buildHeroCount()`；本批列為 sub-threshold 延後（見下方 § Deferred Findings） |
| locale drift 測試涵蓋 skill 計數欄位 | **已達成** | HERO-COUNT 三個數字、INSTALL-COVERAGE 的 bundled/public、What's Included 的 Skills 與 Agents 列、FULL-CATALOG 逐分類命令序列與 `<summary>`／分類計數、`allowed-tools` 比例（六種語序以排序數對比較）、Codex 註冊指令 |
| 既有 40 個 catalog 測試通過 | **已達成** | 2026-08-13 當批：`test/scripts/generate-readme-catalog.test.js` 135 pass / 0 fail、全庫 3449 pass / 0 fail。Round 26 後重測（2026-08-14）：**139 pass / 0 fail**、全庫 **3457 tests / 3453 pass / 0 fail / 4 skipped** |
| `/codex-review-fast` → `/precommit` | **未達成** | 逐輪狀態一律以 § Gate Record 為準——此欄不再複述，因為它前後兩次都寫成過期值 |

AC 5 一度被寫成「已達成」而其實只涵蓋一半：INSTALL-COVERAGE 與 What's Included 的 Skills 列當時沒有守衛。
Codex 在 AC trace 用 mutation 證明了這點：把 zh-TW 的兩處計數改成 777，當時 75 個測試照樣全過。補上守衛後
該 mutation 即被攔下。可重現的當前量測（2026-08-14，以現行套件執行同一組 mutation）：**3 項測試轉紅**——
`the count blocks publish no integer they were not built to publish`、`INSTALL-COVERAGE counts match the
shipping set and the catalog`、`the What's-Included Skills and Agents rows match disk`。此處只記可重跑的
數字；當時那一版套件的轉紅數已無法重測，故不再引用。

### 本批順帶修掉的兩個實質缺陷

1. `/adr` 在**本批開發中的中間版本**被插進五份 locale 的 Planning 而非 Documentation & Tooling（插入點以
   英文前一列定位，而該列是 Planning 的最後一列）。總數與各分類計數自洽，集合式比對看不見；改成逐分類
   序列比對後才抓得到。最終檔案已在正確分類，Git diff 只看得到修正後的狀態。
2. 六份 README 對 `jq` 的因果敘述過寬（原稱「每個 hook 都用它解析 stdin JSON」）。實際只有
   `pre-edit-guard` 與 `post-edit-format` 解析 payload，其餘四個僅在 local-hook 仲裁使用且有 grep 後備。

### Deferred Findings

```
[NIT_DEFERRED] README.md:16 | hero 的 `~4% of Claude's context window` 由 generate-readme-catalog.js buildHeroCount() 寫死，非量測衍生，六份 README 皆然 | reason: sub-threshold-P2 | 2026-08-13T14:45:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:339 | keepFenced 不保留 4-column 縮排式 code block，註冊範例若改用縮排形式會被誤報缺漏 | reason: sub-threshold-P2 | 2026-08-13T14:45:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:784 | 分類身分以 section 位置推斷，交換兩個在地化分類標題（成員不變）不會被抓 | reason: sub-threshold-P2 | 2026-08-13T14:45:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1072 | 錯誤分類的合成控制組是同義反覆，未實際呼叫 production 比較 | reason: sub-threshold-P2 | 2026-08-13T14:45:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1623 | blockIntegers 讀 renderInline 後的文字，仍保留連結目的地，故 `[hooks](…/v2)` 的 2 會被當成 block 發佈的整數（誤判方向；要真正解決需 Markdown parser 或禁止產生含數字的連結目的地，再寫一條手寫正規式會重演 round 22） | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1448 | NON_ASCII_DIGIT 只涵蓋 Unicode 類別 Nd；類別 No（上標 `⁷⁷⁷`、圈號 `⑦`）不在內，寫法罕見故列為 sub-threshold；註解已如實標明涵蓋範圍為「ASCII 與 Unicode 十進位數字」 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1538 | 符號檢查不看數字「後面」的符號（`6 個 hooks-`）；一條後綴規則會用 `Node.js 18+` 這個真實字串拒絕語料，故刻意不加 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1479 | 符號字元表只列七個數學正負號；`±`（U+00B1）不在內，`±6 個 hooks` 對讀者是帶號的卻會通過。補一個 `±` 正是本記錄整篇在講的失敗模式，故登記而不補 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1569 | 兩處 decodeSignRefs 呼叫沒有各自的控制組——刪掉任一處套件仍全綠，只有合併結果被驗到 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1488 | 後綴符號允許的空白分支自己開了一個面：`0+ 6 hooks`、`0+\n`6 hooks`` 等形狀滿足三個條件後仍走得出去。就地再修一次會是第三輪同樣的補強，依 § Sub-Threshold Findings 登記而不修 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1569 | `&#49;` 這個封閉清單的行為控制組在允許收窄成 ASCII `+` 之後就不再依賴封閉清單（後面的 `-` 已被 `m[0] === '+'` 擋掉），只剩直接斷言守著它 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
[NIT_DEFERRED] test/scripts/generate-readme-catalog.test.js:1488 | 跨軟換行的連接詞（`15 條 rules\n+ 6 個 hooks`）會被形狀檢查誤拒；六份 README 都不這樣寫，對未發佈的形狀下斷言會讓守衛不再由語料衍生 | reason: sub-threshold-P2 | 2026-08-14T00:00:00Z
```

行號隨檔案成長而漂移，且本批每一輪都漂了一次。**權威的是每一則自己描述的構造名稱，行號是輔助**——
上表為 round 29 全部修正完成後（2026-08-14）以函式／常數名重新推導的值。第三則曾被誤認為已由本批關閉，
查證後**並未**：`catalogSectionsIn()` 只接受檔案路徑，三個呼叫點（第 868、954、976 行）全部餵真實
README，沒有任何已提交測試把合成文件送進真正的分類比較。

第五則（連結目的地）曾於 round 22 修掉，又於 round 23 **還原為延後**：那個修法用一條 `[^)]*` 正規式在
已渲染文字上剝除連結，round 22 複審證明它兩邊都錯——code span 裡的 `\`count=[bundled skills](777)\`` 是
讀者看得見的字面文字卻被刪掉（漏抓），而目的地含成對括號的 `[hooks](https://e.test/a_(stable)/v2)` 會停在
第一個 `)`、把`/v2)` 留下（誤判）。手寫正規式判定不了 Markdown 的可見文字；還原比留著一個兩邊都錯的
近似值好。

## 守衛強化：八次改設計加一輪有界收緊，round 21–29（2026-08-14）

計數守衛在 round 7–28 之間反覆強化。過程值得記下來的不是結果而是**失敗與收斂的形狀**：前七次每一次
都仍留下可構造的新逃逸——不是每次都只修實例（round 26 的 `W-W` 就是整個 default-ignorable 類別一起
關的），而是每次都還有下一個層級沒被涵蓋。第八次才把「這是一個問題」的假設本身拆掉。本節談測試守衛
這條支線；六份 README 的內容面見下方 § 內容面。

### 第一階段：四次調參（round 17–20）

| Round | 「數字是否在宣稱這個名詞」的判定方式 | 反方向缺陷 |
|-------|--------------------------------------|-----------|
| 17 | 有界非數字間隔 `[^\d]{0,6}` | `Claude 3 has bundled skills` 被當成宣稱 → **正確文件被判失敗** |
| 18 | 空白與標點 `[\s\p{P}]{0,4}` | 同上，`Claude 3 — bundled skills` |
| 19 | 先移除包覆裝飾再要求相鄰 | `Claude 3（bundled skills 支援）` 被正規化成 `Claude 3bundled skills`，**憑空造出一個宣稱** |
| 20 | 放棄鄰近度，改判「block 內是否出現不該出現的整數」 | 抓不到 `-99`（`/\d+/g` 丟失正負號）與全形 `７７７` |

診斷類別是 `ARCHITECTURE`（同一缺陷跨輪復發、修 A 破壞 B）。**正確的處置不是第五次調參，而是承認
「這個數字是不是在宣稱那個名詞」根本不該由鄰近度回答。** Round 20 起改問一個沒有語系文法的問題：
*這個 block 本來就該出現這個整數嗎？* 依據是先做的量測——六份 README 的四個計數區域整數多重集完全相同，
且每個成員都可由磁碟推導（`shippingSkillDirs` / `publicCatalogCommands` / `diskCount`），唯一的字面值是
hero 的 `~4%`。FULL-CATALOG 只讀 `<summary>`，因為它其餘的數字來自 skill 描述文字（`sd0x`→0、`P0-P5`→0/5、
`Top 10`→10、`v1`／`1Password`→1），是散文不是計數。

### Round 20 剩下的兩個 P1，於 round 21 關閉

1. **`blockIntegers()` 只認 ASCII 數字且丟失正負號。** 原本 `-99 bundled skills` 與全形 `７７７` 都能全綠
   通過。修法分成兩個正交的子句，而不是把符號解析進比較裡：全形數字在抽取前正規化為 ASCII（讀者看到的是
   數字，`/\d+/` 卻看不到）；符號則**直接拒絕**——量測顯示六份 README 的四個計數區域裡「符號緊接數字」
   出現 0 次，計數區塊沒有合法的負數或顯式正數，所以符號的存在本身就是缺陷，與它會算出什麼值無關。
2. **合成控制組保護的是抽取器，不是 production 判定。** 已把判定本身抽成 `assertPublishedIntegers()` /
   `assertBlockIntegers()`，per-file 守衛與控制組走同一條路；控制組改為斷言它**會拋出**，因此削弱該斷言
   會讓控制組轉紅。這正是 `rules/testing.md` § Guards 說的那種失敗，而本檔案先前確實出過一次。

### 一個方法論教訓

我在 round 20 用 mutation 自證「刪掉 per-file 斷言會轉紅」，**那個驗證是無效的**：替換後的程式碼是語法
錯誤，`node --check` 不過，RED 來自模組載入失敗而不是守衛攔截。已驗證過的紀律是「斷言 mutant 確實套用」，
但套用成功不等於 mutant 有效——**mutation harness 必須額外斷言 mutant 可被解析**，否則語法錯誤會偽裝成
守衛生效。這是本批最值得帶走的一條。

### Round 21 的驗證（每個 mutant 都先過 `node --check`）

| Mutation | 結果 |
|----------|------|
| 刪除 signed-number 拒絕子句 | RED（控制組攔下） |
| 刪除全形數字正規化 | RED |
| 使 derived 多重集比較同義反覆（round 20 的未保護分支） | RED |
| zh-TW `完整（-99 bundled skills` | RED（round 20 為 GREEN） |
| ja 全形 `（実際は ７７７ bundled skills）` | RED（round 20 為 GREEN） |
| ko `777개의 bundled skills` | RED |
| es coverage 列改回 `/codex-setup init` | RED |
| 未變更樹 | GREEN |

沒有任何 mutant 被判 INVALID——這是 round 20 缺的那道檢查。

### Round 21–28：前七輪的修法都被下一輪複審推翻

這一段是本批最該被讀的部分。準確的說法不是「三次都靠移除」——那與下表不符。實際分佈是：**round 22 加的
兩樣東西被移除，其餘缺陷則靠換掉判定式、換掉表徵、改接線、或改 fixture 的值處理**。共通點只有一個：
沒有一項是靠「把同一條規則再調一次參數」關掉的。

| Round | 我加了什麼 | 下一輪複審證明它壞在哪 | 最終處置 |
|-------|-----------|----------------------|---------|
| 21 | 全形數字正規化 + ASCII/U+2212 符號拒絕 | 全形負號 `－99`、漢字 `七百七十七`、阿拉伯-印度數字 `٧٧٧` 全部照樣全綠 | 改為「拒絕非 ASCII 十進位數字」（保留） |
| 22 | 再加一組 CJK 數字字元拒絕 | `一` 在 `七百七十七` 是數字、在 `統一配置` 是語素，拒字元等於拒散文；且永遠不完整（`〇`、`廿` 都在集合外） | **移除**（round 23） |
| 22 | `readerText()` 以 `[^)]*` 剝除連結目的地 | code span 內的 `\`count=[bundled skills](777)\`` 是可見字面文字卻被刪掉；目的地含成對括號時停在第一個 `)` 而留下 `/v2)` | **移除**（round 23），該 nit 還原為延後 |
| 22 | `assertDocumentCounts()` 收攏區域接線 | 接線只保護到函式**內部**：把 per-file 測試的 `readFileSync(...)` 換成 `DOC_FIXTURE()`，六個測試照樣全綠 | 保留函式，改掉 fixture 的值（round 23） |
| — | （既有缺陷，非本輪新增） | 表徵不一致：`SIGNED_NUMBER` 讀原始區塊、計數讀取器讀 `renderInline(區塊)`，於是 `-**99** bundled skills` 兩邊都看不到——符號跨不過 `**`，而 `renderInline` 之後符號早已不在檢查範圍 | round 24 改為與讀取器同一表徵 |

**CJK 那次是 round 17–19 的同一個錯誤換皮。** 當年是用「鄰近度」判定「這個數字是不是在宣稱那個名詞」，
這次是用「字元表」判定「這個字是不是數字」——兩者都是在自由散文上問一個判定不了的問題。我在同一段註解裡
已經寫下界線「用文字拼出的數不在範圍內」，然後自己越過它：`七百七十七` 正是用文字拼出的數。現行註解把
這件事寫成防再犯的理由，並有一條測試釘住它（`ordinary CJK prose that happens to contain a numeral
character is not a count`）——重新加入字元表就會讓它轉紅。

`\p{Nd}` 保留，因為它沒有這個歧義：Unicode 十進位數字在任何語境下都是數字，拒絕它是對字元的判斷，
不是對「某個語系怎麼用它」的猜測。

**已知且刻意的限制**：用 CJK 數字或英文單字拼出的計數（`七百七十七`、"seven hundred"）**抓不到**。
這是界線的代價，寫在註解與測試裡，不是疏漏。

### Round 23 的驗證（每個 mutant 先過 `node --check`）

| Mutation | 結果 |
|----------|------|
| 從文件 map 刪掉 `INSTALL-COVERAGE` | RED |
| 刪掉整個 marker-block 迴圈 | RED |
| 刪掉 FULL-CATALOG `<summary>` 檢查 | RED |
| 刪掉非 ASCII 數字拒絕子句 | RED |
| 刪掉 signed-number 拒絕子句 | RED |
| 使 derived 多重集比較同義反覆 | RED |
| ja 全形 `７７７` ／ zh-CN `٧٧٧` ／ es `－99` ／ ko `777개의` | 四者皆 RED |
| **外層接線**：per-file 測試改吃 `DOC_FIXTURE()` 而非自己的 README | RED |
| **槽位對應** ×4：INSTALL-COVERAGE 用兩次 `bundled`／HERO 的 public 餵 `bundled`／FULL-CATALOG 總數餵 `bundled`／Rules 餵 `agents` | 四者皆 RED |
| zh-CN 的 `统一配置、一键安装`（round 22 複審的誤判案例） | **GREEN**（合法在地化編輯不再被拒） |
| 未變更樹 | GREEN |

### Round 24：符號與計數讀取器改用同一表徵（**此路線於 round 25 被放棄**）

Round 23 複審剩一個 P1，且**不是本輪新增的**：`SIGNED_NUMBER` 檢查原始區塊，而 `installCoverageClaim`／
`heroCountsIn` 檢查 `renderInline(區塊)`。真實 zh-TW 改成 `完整（-**99** bundled skills…）` 時，讀者看到
`-99`，但符號正規式跨不過 `**`，計數讀取器把強調去掉後又只看到 `99`——138 個測試全綠。

修法是**用檔案裡既有的 `renderInline`**（另外三個守衛已經在用），不是再寫一條手寫的「讀者看到什麼」
近似式——那正是 round 22 被推翻的作法。

| Mutation | 結果 |
|----------|------|
| zh-TW `-**99**`（round 23 為 GREEN） | RED |
| zh-TW `－**99**`（round 23 為 GREEN） | RED |
| 把 `renderInline(region)` 改回 `region` | RED |
| 刪掉 signed-number／非 ASCII 數字拒絕子句 | 兩者皆 RED |
| zh-TW `**99**`（只有強調、計數正確） | **GREEN**（未誤傷） |
| 未變更樹 | GREEN |

外層接線與四個槽位對應之所以在 round 22 全綠、round 23 轉紅，只因為一件事：`DOC_COUNTS` 從
`{99, 99, 15, 6, 15, 21}`（= 當下磁碟真值）改成互不相同也不等於任何磁碟值的哨兵
`{101, 97, 13, 7, 11, 23}`。**合成 fixture 只要與真實資料同值，就可以冒充真實資料**——這是本批第二條
值得帶走的方法論。第一條是 round 20 的「mutant 必須先能被解析」。

### Round 25：符號改問一個**詞法**問題，一次關掉整個包裝器類別

Round 24 複審提出兩個 P1。第二個是單純的遺漏（`allowed-tools` 比例那格從沒被納入符號檢查，`-90 of 99`
解析成 `[90, 99]` 全綠），補上即可。**第一個才是關鍵**：`renderInline` 保留 code span 的反引號、不展開
連結標籤、不移除 inline HTML，所以下列三種寫法都逃掉——

```md
完整（-`99 bundled skills`、…）
完整（-[99 bundled skills](#coverage)、…）
完整（-<strong>99 bundled skills</strong>、…）
```

到這裡模式已經無法否認：round 17–19 用「鄰近度」問「這個數字在宣稱那個名詞嗎」，round 22 用「字元表」問
「這個字是數字嗎」，round 24 用「表徵」問「這個符號黏著那個數字嗎」——**三次都是在自由散文上問一個判定
不了的問題，而每一次的修法都只關掉當下被示範的那一個實例**。Markdown 能在兩個字元之間塞進去的隱形東西
沒有上限，逐一追是追不完的。

改問一個可判定的問題：**這個區塊有沒有在它從不合法使用的位置上出現符號？** 這是詞法問題，完全不需要
「讀者看到什麼」的概念。

**「符號」在這裡指且僅指 `SIGN_CHARS` 的七個字元**（`-−－﹣+＋﹢`）。全形與半形的連字號、減號、加號都在
內；**en dash 與 em dash 刻意不在內**——每個 HERO-COUNT 都含一個合法的 em dash（`— ~4%`），把它納入等於
把正確文件判成失敗。下表與「其餘一律拒收」都以這七個字元為範圍，不是對所有標點的宣稱。

在這個範圍內，六份 README 的計數區域只用到三種**構造**（round 26 修正後的定義與量測，見下）：

| 構造 | 例 | 受檢區域內出現次數 |
|------|----|------------------|
| `W-W`：兩側皆為**可見**文字或數字 | `auto-loop`、`pre-edit-guard` | 336 |
| 表格分隔列裡的 hyphen run | `\|------\|---------\|` | 599 |
| 連接詞加號：兩側各有一個運算元 | `AGENTS.md kernel + git hooks` | 42 |

其餘一律拒收。`-` 後面接反引號、`[`、`<` 或 HTML 註解，都不屬於這三種構造，不必知道它最後渲染成什麼。

量測方式可重跑：把 `offendingSign()` 的三條 `continue` 各加一個計數器、拒收路徑加一個，跑一次套件即得
上表。同一次量測另有 **23 次拒收**，全部來自控制組刻意寫壞的 fixture——**六份真實 README 的拒收次數是 0**，
這由套件全綠直接證明（任何一次真實檔案上的拒收都會讓該檔的測試轉紅）。

| Mutation | 結果 |
|----------|------|
| zh-TW 符號在 code span 外／連結外／inline HTML 外（round 24 皆為 GREEN） | 三者皆 RED |
| zh-TW `-**99**`、`-99` | 兩者皆 RED |
| README.md `-90 of 99`（round 24 為 GREEN） | RED |
| 刪除三種合法形狀的任一項允許 | 三者皆 RED（量測出的清單不會被悄悄縮小） |
| 使區塊／比例的符號檢查同義反覆 | 兩者皆 RED |
| zh-TW `**99**`（只有強調、計數正確） | GREEN（未誤傷） |
| 未變更樹 | GREEN |

**這個判定式也被下一輪推翻了（round 25 複審，⛔ Blocked，2 P1）。** 上表的 mutation 全部成立，但它們證明
的只是「被示範過的那些逃逸現在會轉紅」——Codex 用**我自己允許的三種鄰域**各構造出一個新的逃逸，全部全綠：

| 逃逸 | 為何通過 | 讀者看到 |
|------|---------|---------|
| `\| Plugin 安裝 \| Claude Code \|-99 bundled skills…` | `-` 的前一個字元是 `\|`，落入「連字串／分隔列」允許 | 一般資料格，渲染出 `-99` |
| `完整（--99 bundled skills…）` | 兩個 `-` 互為鄰居，各自落入同一允許 | `--99` |
| `完整（ + 99 bundled skills…）`、`+ 90 of 99` | 空格包夾，落入「連接詞加號」允許 | 一元正號 |
| `ㅤ-99`（HANGUL FILLER 是 `\p{L}`） | 前後皆為「文字字元」，落入 `W-W` | 不可見字元 + `-99` |

根因一句話：**這三種形狀描述的是語法鄰域，不是合法語義。** 「相鄰有 `-` 或 `\|`」不等於「這是分隔列」，
「空格包夾的 `+`」不等於「這是連接詞」。而被移除的 `SIGNED_NUMBER` 反而擋得住 `+ 99`（它允許符號與數字
之間有空白），所以這次換問題**丟失了既有涵蓋**，不是純粹的進步。

第二個 P1 是量測本身不完整：`offendingSign()` 只接到三個 marker 區塊、FULL-CATALOG summary 與比例欄，
**沒有接到 locale 散文的 hook 計數讀取器**（`/(\d+)\s*(?:個|个|개)?\s*(?:hooks?|フック|钩子)/gi`）。把
zh-TW 的 `6 個 hooks` 改成 `-6 個 hooks`，138 個測試全過。所以「所有計數區域都已量測」這句話當時是錯的。

另有一則 P2：`isSignRunChar` 的 `\|` 那半沒有任何已提交控制組——把它刪成只剩 `'-'`，138 個測試照樣全綠
（分隔列的 `-` 總有另一個 `-` 當鄰居）。那條未受保護的分支正是上表第一個逃逸的入口。

### Round 26：把三種形狀從「鄰域」收緊為「構造」

Round 25 的診斷本身給了修法方向，而且它**不是第六次調參**：Codex 指出的是一個類別錯誤——三條規則允許
的是「碰到了合法用法也會碰到的東西」，而不是「就是那個合法用法」。碰到 `|` 不等於身在分隔列，兩個 `-`
互相鄰接不等於是表格裡的 run，空格包夾的 `+` 不等於是連接詞。三條規則因此各自改成約束構造本身：

| 構造 | 收緊前（鄰域） | 收緊後（構造） |
|------|--------------|--------------|
| `W-W` | 兩側是 `\p{L}`／`\p{N}` | 兩側是**可見**的文字字元——排除整個 `\p{Default_Ignorable_Code_Point}` 類別 |
| 分隔列 | 相鄰有 `-` 或 `\|` | 先定位**整個 `-` run**，要求它兩端都不碰文字字元，且至少一端靠著 `\|` 或 `:`　⚠️ **這條沒修成，round 27 整條刪除** |
| 連接詞 `+` | 前後皆為空格 | 前後皆為空格，**且**距離 2 的兩側各有一個文字字元（連接詞要有兩個運算元） |

不可見字元那條特別說明：修的是**類別**不是實例。U+3164 HANGUL FILLER 只是 Codex 用來示範的那一個，
ZWSP、SHY 等等都同樣是「碰巧被歸進 `\p{L}`／`\p{N}` 的不可見字元」，排除整個 default-ignorable 類別才
不會下一輪又冒出一個。另外鄰居改以**碼位**而非 UTF-16 code unit 讀取，否則星球平面的字母會以孤立
surrogate 出現、比對不上任何屬性，把合法的連字號詞判成失敗（round 25 的 P2）。

P1 #2（locale 散文 hook 計數讀取器沒接符號檢查）一併補上，並且**抽成 `assertProseHookCount()` 才接**——
原本寫在 per-locale 測試裡的判定無法被合成控制組觸及，而 round 20 已經確立「觸及不到的分支就是沒有保護
的分支」。抽出時發現一個新缺陷並修掉：8 字元的 lead-in 會從識別字中間切開，`pre-edit-guard: 6 hooks`
被切成 `-guard: 6 hooks` 後那個 `-` 左邊變成切片邊界，合法識別字會被誤判——視窗必須向左擴到邊界。

**驗證：21 個 mutation，全部如預期，沒有 SKIP、沒有 INVALID、沒有 FAIL。**

| 方向 | 內容 | 結果 |
|------|------|------|
| Codex round 25 的四個逃逸 | `\|-99` 資料格、`--99`、`（ + 99`、`ㅤ-99`（HANGUL FILLER） | 四者皆 RED（原為 GREEN） |
| 同上，比例欄 | `+ 90 of 99` | RED |
| round 25 未接線區域 | zh-TW `-6 個 hooks` | RED（原為 GREEN） |
| round 21–24 的舊逃逸 | code span／連結／inline HTML／強調外的符號、`-99`、`-90 of 99` | 六者**仍為** RED（收緊未造成回歸） |
| 分支刪除 | 三條允許各刪一次、四個收緊條件各中和一次、散文接線中和、視窗擴邊界刪除 | 九者皆 RED（3+4+1+1；21 = 12 輸入 mutation + 9 分支 mutation） |
| 負控制 | 只有強調的正確計數、計數區塊裡的連字號識別字、六份 README 實際出貨的句子 | 皆 GREEN（無誤判） |

### Round 26 的複審結果：分隔列那條沒修成，同一個 category error

Code review round 26 與 doc review round 8 **各自獨立**構造出同一類逃逸，兩者都指向分隔列那條規則：

| 逃逸 | 為何通過 |
|------|---------|
| `完整（:-**99** bundled skills）` | `-` 左邊是 `:`、右邊是 `*`，滿足「靠著 `:`」；強調在計數讀取器之前就消失了 |
| `\| Plugin 安裝 \| Claude Code \|-- 99 bundled skills \|` | run `--` 碰到 `\|`、右邊接空格——但這是**普通資料格**，不是分隔列 |

我自行複現，兩者皆通過（同時確認 `\|------\|------\|` 仍被正確接受、真實 coverage 列仍被正確接受）。

根因是 round 25 指出的**同一個 category error 沒被修掉**：`againstCell` 用「附近有 `\|` 或 `:`」來辨識
分隔列，而那仍然是局部字元特徵，不是分隔列這個構造。三條規則裡我只真正修好兩條（`W-W` 的可見性、
連接詞的兩個運算元），分隔列這條換了寫法但沒換層級。

另有兩個 P2，見 § 仍待處理。

### Round 27：兩個**刪除**，把判定移到行層級

我一度把 round 26 的結果判成 `ARCHITECTURE`、準備退出。那個判定有一處事實錯誤：`rules/auto-loop.md`
定義 stall round 是「有 finding 未關且該輪一個都沒關掉」，而 round 26 關掉了四個中的三個、且沒有任何
回歸（round 21–24 的逃逸全部仍為 RED）。那不是 stall，是收斂；我把 stall 預算說成用盡是錯的。
`ARCHITECTURE` 的訊號是「修 A 破壞 B」，這裡也沒有發生。

真正的線索在對照本身：**已關閉的都換了層級，未關閉的只換了寫法。** 分隔列那條在字元層級改了兩次寫法，
散文視窗則是調了一個長度參數。兩者的正解都是**刪除**，而不是第三次改寫：

| 原本 | round 27 |
|------|---------|
| 分隔列允許：判斷 `-` 附近有沒有 `\|`／`:` | **整條刪除**。改成在**行層級**先跳過分隔列——`DELIMITER_ROW` 判定整行是否只由 `\|`、`:`、`-`、空白組成。分隔列不承載計數，跳過整行即可，裡面的符號不需要任何允許 |
| 散文區域：固定 8 字元 lead-in（外加邊界擴張補丁） | **整個參數刪除**。區域改為「行首 → 計數結尾」。任何固定長度都是作者可以填滿的數字（八個反引號、夠長的 `<span class=…>` 開標籤都做到了）；行沒有長度可以超過 |

剩下兩條允許（`W-W`、連接詞 `+`）都只描述「某一個字元周圍的文字」，兩者都無法描述一整列——這正是它們
不會被拿來偽裝分隔列的原因。

區域結束在計數而非行尾，是量測出來的而非圖方便：修飾數字的符號在數字之前，而五份 locale 的
`--lite` 長旗標就寫在 `6 個 hooks` 的**後面同一行**——取整行會讓五個語系全部誤判（於 round 28 的
程式重新實測：139 → 133，六項失敗中五項是 locale、一項是 round 27 新增的 `--lite` 合成負控制）。

**驗證：24 個 mutation，無 SKIP、無 INVALID、無 FAIL。**（此結論於 round 27 成立；round 28 複審
證明它不完整——見下節。）

| 方向 | 內容 | 結果 |
|------|------|------|
| round 26 的兩個逃逸 | `:-**99**`、`\|-- 99`、八反引號填視窗、長 `<span>` 填視窗 | 四者皆 RED |
| round 25 的六個 | `\|-99`、`--99`、`（ + 99`、`ㅤ-99`、`+ 90 of 99`、`-6 個 hooks` | 六者**仍為** RED |
| round 21–24 的六個 | code span／連結／inline HTML／強調外的符號、`-99`、`-90 of 99` | 六者**仍為** RED |
| 分支刪除（**雙向**） | 刪除分隔列跳過 → RED（真實分隔列被拒）；把它放寬成「任何含 `-` 的行」 → RED（逃逸放行）；另六條規則各刪／中和一次 | 八者皆 RED |
| 負控制 | 只有強調的正確計數、計數區塊裡的連字號識別字、`--lite` 在計數之後同一行 | 皆 GREEN |

分隔列跳過是這批唯一有**雙向**控制組的規則，而那是必要的：一個「跳過」比一個「允許」更危險——放寬它
會靜默地讓整行免檢。刪除它會讓真實分隔列被拒（11 個測試轉紅），放寬它會讓逃逸通過（3 個轉紅）。

另補了一個先前只靠 mutation、沒有已提交測試的案例：長包裝器填滿視窗的三種寫法，現在是控制組。

**過程中被本專案自己的守衛擋了一次**：新 fixture 裡寫了 `CLAUDE.md` 字面文字，觸發
`claude-md-coverage.test.js` 的「哪些測試檔讀 CLAUDE 檔」分類守衛。那個字眼對該 fixture 沒有意義，
改寫掉。焦點套件全綠而全庫轉紅，正是跑全庫的理由。

### Round 28：兩個問題，不是一個

Round 27 的複審用兩個逃逸證明了「行層級」還是錯的層級，而且兩個都是同一個根因：

```md
<summary>全部
-
99 個 public skills</summary>
```

每一行單獨看都無辜——`-` 那行就是一列分隔列的形狀，被整行跳過——但 **Markdown 的軟換行會被渲染成
空格**，讀者看到的是 `全部 - 99`。散文那條一模一樣：`15 條 rules + -\n6 個 hooks。` 是同一個段落，
讀者看到 `+ - 6`，而以行為界的區域只拿到第二行。

換句話說：**區域有外面，行有下一行。** 前七輪都在問「這個符號周圍的東西」，而周圍是可以被推到界外的。
唯一沒有接縫的東西是**數字本身**——它從哪裡開始就是哪裡開始。

於是這一輪的第一個嘗試是把整套區域掃描刪掉，只從每個已發佈的數字往左讀。它擋下了 round 27 的兩個
逃逸，然後**當場被自己的既有控制組打回**：

| 逃逸 | 為什麼「從數字往左讀」看不到 |
|------|---------------------------|
| ``-`99 bundled skills` `` | `renderInline` 刻意讓 code span 保持字面，所以數字左邊第一個字元是反引號，不是符號 |
| `-[99 …](#x)`、`-<strong>99 …</strong>` | 同理，包裝器就卡在符號與數字之間 |

這才是這一輪真正的發現：**這一直是兩個問題，不是一個。**

| | 問的是 | 讀的是 | 盲點 | 由誰補 |
|---|-------|-------|------|-------|
| **A 形狀** | 這個區域有沒有用到語料從不使用的符號形狀？ | 原始碼 | 軟換行——它讀的「行」不是讀者讀的行 | B |
| **B 數字** | 讀者看到的那個數字有沒有帶符號？ | 渲染後文字 | 包裝器——它卡在符號與數字之間 | A |

兩者互為對方的盲點，誰都不能刪。被刪掉的是「其中一個就是全部」這個假設。實作是
`offendingSignShape(raw) ?? offendingSignOnNumber(visible)`，兩個問題各自的區域也各自定義：形狀問題讀
行首到計數（`--lite` 就寫在計數之後同一行），數字問題讀整個段落（因為它只看數字旁邊，段落裡別處的
`--lite` 根本不會被檢查）。

過程中被自己的控制組抓到一個真缺陷：`SIGN_CHARS` 是 global regex，`.test()` 會帶著 `lastIndex` 狀態，
所以單字元判定會答 true、false、true——**每隔一個候選就被靜默跳過**。兩個方向的 fixture（`-` 與 `:-`）
才讓它現形；只寫一個永遠是綠的。

**驗證：37 個 mutation，無 SKIP、無 INVALID、無 FAIL。**

| 方向 | 內容 | 結果 |
|------|------|------|
| round 27 的三個新逃逸 | `-` 獨立成行、`:-` 獨立成行、散文軟換行拆開 | 三者皆 RED |
| 包裝器類（形狀問題專屬） | code span／連結／inline HTML／強調外的符號 | 四者**仍為** RED |
| round 21–26 的十二個 | `:-**99**`、`\|-- 99`、八反引號、長 `<span>`、`\|-99`、`--99`、`（ + 99`、`ㅤ-99`、`-99`、`-90 of 99`、`+ 90 of 99`、`-6 個 hooks` | 十二者**仍為** RED |
| 分支刪除 | 兩個問題各刪一次；分隔列跳過**雙向**；`W-W`、連接詞、連接詞的兩個運算元、隱形字元排除、`\p{M}`、碼位鄰居、global regex、段落區域、跨空白走訪、兩處接線 | 十五者皆 RED |
| 負控制 | 只有強調的正確計數、連字號識別字、`--lite` 在計數之後同一行 | 皆 GREEN |

這一輪把 round 26 遺留的兩個 P2 一併關掉，方法是補上它們缺的控制組而不是改實作：碼位鄰居還原成
UTF-16 索引時，星球平面字母的負控制會轉紅；拿掉 `\p{M}` 時，NFD 拼寫的 `café-6` 負控制會轉紅。

**已知且刻意不擋的兩件事**，寫在這裡而不是留給下一輪重新發現：

| 不擋 | 為什麼 |
|------|-------|
| 數字**後面**的符號（`6 個 hooks-`） | `Node.js 18+` 是這六份文件真的有的字串；一條後綴規則會用正確形狀拒絕語料 |
| 跨軟換行的連接詞（`15 條 rules\n+ 6 個 hooks`） | 形狀問題讀原始碼的行，會看到一個沒有左運算元的 `+`。沒有任何一份 README 這樣寫——對語料沒有發佈的形狀下斷言，正是守衛不再由語料衍生的起點 |

### Round 29：六個有界收緊，以及停止迭代的判定

Round 28 的複審（code round 28）回了 3 個 P1，其中一個是我自己在 round 28 引進的誤判。三項都修了，
過程中順帶做了三項不是複審要求的改動。**六項的證據等級並不相同**，分開講，因為把它們寫成同一句
「先量測語料再收緊」會讓沒有量測支持的那幾項借到不屬於它們的可信度：

- 第 1、3 項處理複審示範的逃逸，各有一條可重跑的語料量測支持。
- 第 2 項處理複審示範的逃逸；語料量測只證明「目前沒有 HTML 實體」，也就是說它是預防性的。
- 第 4 項處理的是**誤判**，不是逃逸——而且是我自己在 round 28 引進的。
- 第 5 項沒有語料量測，語料裡也沒有能觸發它的字元；它是把字元類寫寬，不是收緊。
- 第 6 項是結構去重，沒有對應的逃逸——而它正是本輪引進新誤判的那一項（見下方 § Round 29 的複審）。

| # | 逃逸／缺陷 | 收緊 | 支持它的量測 |
|---|-----------|------|------------|
| 1 | `\|-` 獨立成行＋計數包在 code span → 形狀問題整行跳過、數字問題被反引號擋住 | 分隔列的跳過改為**必須含 `\|`**，且**上一行必須也含 `\|`**（分隔列依定義是表格的第二行） | 六份 README 的每一條真分隔列都含 `\|`，且上一行都含 `\|` |
| 2 | `&minus;99`、`&#8722;99`、`&plus;99` — HTML 字元參照把同樣七個字元換一種拼法 | 兩個問題都先解碼字元參照，僅限**解出來就是那七個符號**時才替換（封閉清單） | 六份 README 目前不含任何 HTML 實體 |
| 3 | `正+99`、`負-99` 走了連字號識別字的允許 | 連字號後接數字時，左側必須是 ASCII；`+` 後接數字一律視為符號 | `perl -ne 'print "$&\n" while /(?<=[^\x00-\x7F])-\d+/g' README*.md` 無輸出（`grep -oP` 不可攜：stock macOS `/usr/bin/grep` 回 `invalid option -- P`，得到的是錯誤而不是空結果）；`Claude+Codex`（README.md:412）證明字母前的 `+` 合法；`4-시그널` 證明右側不可限制成 ASCII |
| 4 | **我自己在 round 28 引進的誤判**：段落邊界找的是字面 `\n\n`，帶空白的空行或 CRLF 檔案會讓區域跨過真正的段落邊界，把上一段的 `-5°C` 拉進來 | 邊界改成 `/\n[ \t]*\r?\n/` | CommonMark 的空行可含空白；誤判方向是昂貴的那一邊 |
| 5 | 符號與數字之間夾 NO-BREAK SPACE，走訪停住而讀者看到相鄰 | 空白類改成 `\s` | — |
| 6 | 形狀與數字兩個問題各自維護一份區域 | 合併成同一個段落區域 | 這是刪除，不是新規則 |

六項的性質已如上分列，摘要必須沿用同一分類，否則會把沒有逃逸可關的三項也算成戰果：**兩項（1、3）
關閉了複審示範的逃逸，一項（2）是預防性處理，一項（4）修的是誤判，一項（5）是沒有語料量測的字元
類放寬，一項（6）是結構去重**。

真正跨越六項成立的模式是另一句話：**每做完一項，探測就找出一個更牽強的殘餘面**。第六項之後的殘餘
是 `<summary>全部 | x |` ＋ `|-` ＋ code span——上面補一行含 `\|` 的假 header 就又過了。

依 `rules/auto-loop.md` § Cap Diagnostic Protocol，這是 `ARCHITECTURE` 的訊號，不是需要再一輪的訊號：

```
class = ARCHITECTURE
signals =
  1. 同一個缺陷跨檔案／跨層級反覆出現：符號守衛從 round 17 到 29 共 9 輪變更
     ——8 次改設計（鄰域 → 字元表 → 表徵 → 詞法 → 構造 → 行層級 → 兩個問題），
     加 round 29 這一輪有界收緊。每一輪都是被複審示範漏洞才收斂，沒有一輪是設計出來就對。
  2. 修 A 弄壞 B：round 28 的段落區域關掉了軟換行接縫，同時引進第 4 項的誤判。
  3. 兩位複審者在 round 28 各自獨立構造出同一類「組合逃逸」——證明 A 與 B 的盲點會相乘，
     而「A 必要」「B 必要」的 mutation 對「A∪B 是否充分」一個字都沒說。
budget = 本變更的 cap 診斷額度 1 次，已於 round 10 checkpoint 用掉；stall 額度 3 次已用盡
```

Protocol 步驟 2 明文寫著：診斷本身若顯示需要架構層級的改動，就走 ⛔ Need Human，不要再調整。
所以 round 29 收在這裡：六項都留著（各自都是嚴格的改善，其中第 4 項還修掉一個會擋住合法編輯的
誤判），仍開著的案例誠實寫進記錄，不再開第 9 次設計。

這一輪順帶做了一個**刪除**：`isVisibleWordChar` 的 `\p{Default_Ignorable_Code_Point}` 排除項，原本
用來擋 U+3164 HANGUL FILLER 假扮識別字。第 3 項的 ASCII 限制以更強的理由擋住同一個逃逸，分支刪除
證明這個排除項已經沒有任何案例依賴它，於是移除而不是補一個為了讓它活著而寫的測試——U+3164 的逃逸
控制組仍然是紅的。

**驗證（round 29）**：焦點套件 140 pass / 0 fail；全庫 3454 pass / 0 fail / 4 skipped；
`generate-readme-catalog.js --check` 回報 up to date；`check-comment-blocks.js` exit 0（僅剩既有的
warning band）。分支刪除方向重跑：header-row 要求、stateful regex、`ASCII_IDENT`、`\p{M}` 四者刪除
後皆轉紅；`\s` 空白類收窄後**仍為綠**——它是字元類的寬度選擇而非分支，語料到不了那些字元，這點如實
記在這裡而不是補一個構造出來的測試。

### Round 29 的複審：第 6 項自己引進了一個誤判

送審後 code review round 29 回 `⛔ Blocked`，1 P1 ＋ 2 P2。**P1 不是第 26 種逃逸，是我在第 6 項
（形狀與數字合併成同一個段落區域）引進的誤判**——把形狀問題的範圍從「計數所在的那一行」擴大到
整個段落之後，它開始把段落裡**別的句子**的符號讀成計數的符號。復現出來的最小案例：

```
Requires Node.js 18+
and includes 6 hooks.
```

`Node.js 18+` 是六份 README **第 53 行都有**的真實字串（`Claude Code 2.1+` 同一行也是）。這個守衛
在註解裡明寫「數字**後面**的符號刻意不檢查」，但那條界線寫在範圍還是單行的時候；範圍擴大時沒有把
界線一起帶過去，界線就失效了。這是誤判方向——它擋掉的是本來正確的編輯。

修法是把那條已宣告的界線寫進新的範圍：**左鄰是數字的符號是後綴符號**，跳過。已量測的反面證據：
`2-3`、`6-08`、`claude-haiku-4-5` 的內部連字號左鄰都是數字，本來就走識別字允許；而 `-99`、`--99`、
`（ + 99`、`ㅤ-99`、`|-99`、`&minus;6`、`正+99`、`負-99`、`-90 of 99` 這些逃逸的符號左鄰都不是數字。
重跑 14 個逃逸控制組全部仍為 RED，新分支刪除後轉紅。

另外兩項 P2 依 `standard` tier 屬 sub-threshold。其中一項是「控制組沒碰到它宣稱保護的分支」——
`&amp;` 根本不匹配 `SIGN_REF`，所以那個負控制是空的。這一項就地修掉（一行、檔案已開），改成直接
斷言封閉清單本身，並在註解裡寫明**為什麼沒有 fixture 能端到端驗證它**：替換一個非符號永遠造不出
符號，這條規則沒有可觀察的行為失效。另一項（`±6` 不在那七個字元裡）登記為 deferred——補一個 `±`
正是這份記錄整篇在講的那個失敗模式。

Codex 在被要求獨立判斷後，同意 `ARCHITECTURE` 的分類，並且是從它自己找到的三件事推出來的：已知的
組合逃逸、它新構造的 `±6`、以及第 6 項的新誤判。它的結論與 § 長期方向的選項 B、C 一致。

**這一項的意義超出本批**：它是「每做完一項，探測就露出一個新面」這個模式的又一個實例——不編號，
因為 finding identity 的計數單位在這份記錄裡已經被複審點名過一次。真正新的是**露出來的不是更牽強
的逃逸，是誤判**。守衛擴大範圍換取涵蓋率，代價直接落在正確編輯上——這正是 `ARCHITECTURE` 診斷所說
的「修 A 弄壞 B」。

#### 後續：那條後綴符號允許自己又被收窄了一次

上面寫的修法是「左鄰是數字的符號就跳過」。**那個版本已經不是現在的實作**，而記錄的紀律是追加而
不是回頭改寫，所以兩個版本都留著：送審後 code review round 30 回 `✅ Ready`（無 P0/P1），但指出這
條允許**先跳過符號、才看右邊有什麼**，於是下面五種形狀都能從右側的包裝器走出去：

```text
0−**6 hooks**
0−`6 hooks`
0−[6 hooks](#x)
0−<strong>6 hooks</strong>
2026-
`6 hooks`
```

這是這條允許自己開出來的面。依 § Sub-Threshold Findings 的「檔案已開的一行修正」就地收窄成三個
條件：**ASCII `+`、左鄰是數字、右鄰是空白或行尾**。語料支持：`Node.js 18+`、`Claude Code 2.1+`
兩者都符合這三個條件。

五個包裝器案例現在都轉紅並且都有已提交控制組；三個分支刪除方向（整條刪除、只拿掉 ASCII `+` 要求、
只拿掉右鄰要求）各自轉紅——第三個一開始沒有控制組，因為那五個案例用的都是 `−`，會先被 ASCII `+`
要求擋掉，所以另補了 `0+\`6 個 hooks\``。

Codex 同一輪也點出 `0−6 hooks` 仍為綠。實測確認**它在這條允許存在與否時都為綠**——那是既有的範圍／
識別字允許（`2-3 天`）的性質，不是這條允許開出來的面，故不計入上述五個。

#### 後續：封閉清單的行為控制組其實存在，方向相反

上面寫「沒有 fixture 能端到端驗證封閉清單」。**那句話是錯的**，同一輪複審證偽了它，這裡追加而不
回頭改寫。當時的推理是「替換一個非符號永遠造不出符號」——這一半沒錯，但漏掉了反方向：替換一個
非符號可以**壓制**一次本來會成立的拒絕。`&#49;` 是數字 `1`，若被錯誤解碼替換進去，就會滿足新的
後綴符號允許（左鄰是數字），把包在 code span 裡的計數放過去。`&#124;` 同理可以造出假的 header
pipe，讓下一行的 `|-` 被當成分隔列跳過。已補上 `&#49;-\`6 個 hooks\`` 這個端到端控制組：拿掉封閉
清單（改成無條件替換）它就轉紅。

**再更正（round 31）**：上一段最後那句已經不成立，追加而不改寫。`&#49;-\`6 個 hooks\`` 當時確實
依賴封閉清單，但緊接著的收窄把後綴允許限成 ASCII `+` 之後，就算 `&#49;` 被無條件解碼成 `1`，後面
那個`-` 仍會被 `m[0] === '+'` 這一條擋下——所以這個 fixture 在拿掉封閉清單後**仍是紅的，卻不是
因為封閉清單**。目前真正守著封閉清單的只有 `decodeSignRefs('rules &#8211; hooks')`這條直接斷言。
已登記為 deferred，不再補第三次：`&#124;` 假 header 那條路可以做出真正依賴封閉清單的行為控制組，
但補它就是第三輪同樣的補強，而這正是 `ARCHITECTURE` 診斷所說的模式。

### 仍未做的：`~4%`

AC 4 未動。`~4%` 仍寫死在 `buildHeroCount()`，測試以 `HERO_CONTEXT_PERCENT = 4` 這個字面常數釘住它，
是未來衍生值的落點。守衛能保證六份 README 的 `4` 一致，不能保證 `4` 是真的。

### Gate Record

| Gate | 結果 | 出處 |
|------|------|------|
| Code review（Codex round 2，2026-08-13 批次） | `✅ Ready` | thread `019ffb7f-2363-7b40-8ddd-a54e39d5c9e3` |
| Doc review（Codex round 2，2026-08-13 批次） | `✅ Mergeable` | thread `019ffb81-3f11-77c2-9c2e-049071e214cf` |
| AC trace + record review | `⛔ Inadequate` → 據此補守衛 | thread `019ffb94-c4fc-7643-9355-8f239c2136d0` |
| Code review（Codex round 20，本批次） | `⛔ Blocked` — 2 P1 | thread `019ffb7f-…`（code） |
| Code review（Codex round 21，本批次） | `⛔ Blocked` — 2 P1（數字家族涵蓋、production 區域接線） | thread `019ffb7f-…`（code） |
| Code review（Codex round 22，本批次） | `⛔ Blocked` — 2 P1（CJK 字元表誤判、連結剝除正規式兩邊皆錯） | thread `019ffb7f-…`（code） |
| Doc review（Codex round 1–4，本批次） | `⛔ Needs revision` → 逐輪修正 | thread `019ffc52-…`（doc） |
| Doc review（Codex round 5，本批次） | `⛔ Needs revision` — 含一則 code 平面 P1（外層接線可被抽換） | thread `019ffc52-…`（doc） |
| Code review（Codex round 23，本批次） | `⛔ Blocked` — 1 P1（符號與讀取器表徵不一致，既有缺陷）＋ 2 P2（已登記為延後） | thread `019ffb7f-…`（code） |
| Code review（Codex round 24，本批次） | `⛔ Blocked` — 2 P1（符號跨越隱形包裝器；`allowed-tools` 比例仍在原始 `\d+` 上） | thread `019ffb7f-…`（code） |
| Doc review（Codex round 6，本批次） | `⛔ Needs revision` — 2 P1（摘要欄位過期、敘述與自己的表格矛盾） | thread `019ffc52-…`（doc） |
| Code review（Codex round 25，本批次） | `⛔ Blocked` — 2 P1（三種詞法允許皆可構造逃逸；locale 散文 hook 計數讀取器未接符號檢查）＋ 2 P2 | thread `019ffb7f-…`（code） |
| Doc review（Codex round 7，本批次） | `⛔ Needs revision` — 3 P1（`已解決` 少計 round 24 兩則且引用已廢棄的解法、標題聲稱 round 25 已被推翻但當時尚未送審、量測界線的敘述寬於 `SIGN_CHARS` 實際涵蓋）＋ 1 P2（行號過期）；六份 README 仍為 5/5，記錄本身 2/5 | thread `019ffc52-…`（doc） |
| Code review（Codex round 26，本批次） | `⛔ Blocked` — 2 P1（分隔列仍以局部字元辨識、散文視窗固定 8 字元可被填滿）＋ 2 P2 | thread `019ffb7f-…`（code） |
| Doc review（Codex round 8，本批次） | `⛔ Needs revision` — 1 P1（**獨立**構造出同一個分隔列逃逸，記錄的收斂宣稱被證偽）＋ 2 P2（mutation 算術 8→9、行號過期）；六份 README 仍為 5/5，記錄 2/5 | thread `019ffc52-…`（doc） |
| Code review（Codex round 27，本批次） | `⛔ Blocked` — 2 P1（兩個刪除都留下**跨行**接縫：分隔列形狀的行被整行跳過、散文區域以行為界，而軟換行渲染成空格）＋ 2 P2 ＋ 1 nit | thread `019ffb7f-…`（code） |
| Doc review（Codex round 9，本批次） | `⛔ Needs revision` — 2 P1（§ 長期方向的選項 A 仍描述 round 26 的狀態、「14 提出／12 關閉」混用出現次數與獨立缺陷兩種計數單位）＋ 3 P2（行號再度漂移、`139 → 134` 已過期、測試檔註解與已刪除實作矛盾）；六份 README 仍為 5/5，記錄 3/5 | thread `019ffc52-…`（doc） |
| Code review（Codex round 28，本批次） | `⛔ Blocked` — 3 P1（形狀與數字兩個盲點可**組合**：`\|-` 行＋code span；HTML 字元參照換一種拼法；`正+99`／`負-99` 走了連字號允許。第三項的誘因是 round 28 自己引進的段落邊界誤判） | thread `019ffb7f-…`（code） |
| Doc review（Codex round 10，本批次） | `⛔ Needs revision` — 2 P1（Gate Record 與 `review-state.js` 記載不一致；記錄引用 `mut28.py` 為可重跑證據，但該檔不在版控內）＋ 3 P2（round 26 表格的關閉輪次自相矛盾、「六則」與實際八則不符、nit 行號漂移）；六份 README 仍為 5/5 | thread `019ffc52-…`（doc） |
| Code review（Codex round 29，本批次） | `⛔ Blocked` — 1 P1（**第 6 項合併區域引進的誤判**：`Node.js 18+` 這個六份 README 都有的真實字串，落在計數同段就被拒）＋ 2 P2（`&amp;` 負控制碰不到它宣稱保護的分支；`±6` 不在那七個符號字元裡）。Codex 獨立同意 `ARCHITECTURE` 分類 | thread `019ffd0f-c431-7c90-8b14-ab5d49e0366b`（code） |
| Doc review（Codex round 11，本批次） | `⛔ Needs revision` — 5 P1（Round 29 的證據等級被寫成同一句；`grep -oP` 在 stock macOS 不可攜，得到錯誤而非空結果；§ 長期方向標題說「不擋本批」與內文矛盾；「九次改設計」與標題的計數單位不一致；「目前沒有未關的 P1」漏掉仍開著的 residual）；**六份 README 全部 5/5**，記錄 2/5 | thread `019ffd12-1411-7d73-8f40-16c6e8b784b6`（doc） |
| Code review（Codex round 30，本批次） | **`✅ Ready`** — 無 P0/P1；2 P2（後綴符號允許先跳過符號才看右側，開出五個包裝器面；封閉清單註解的「無法端到端驗證」被證偽） | thread `019ffd0f-…`（code） |
| Doc review（Codex round 12，本批次） | `⛔ Needs revision` — 6 P1（摘要仍寫成「每項都關掉逃逸」與逐項分類矛盾；計數單位仍有一處寫「九次設計」；§ Round 29 的複審對修法的敘述落後於實作；封閉清單「無法端到端驗證」已被證偽；仍開著的案例寫成一個、實為兩個；測試檔另一處 `grep -nP` 同樣不可攜）＋ 1 P2（三個 nit 錨點再度漂移）；**六份 README 全部 5/5**，記錄 2/5 | thread `019ffd12-…`（doc） |
| Code review（Codex round 31，本批次） | **`✅ Ready`** — 無 P0/P1；2 P2（後綴允許的空白分支自己開了一個面；`&#49;` 控制組在收窄後不再依賴封閉清單）。**兩則都登記為 deferred，不再就地修** | thread `019ffd0f-…`（code） |
| **Code review gate** | **已通過**——`review-state.js note code_review pass` 記於 digest `sha256:4611117b…`，`passed:true, owed:false` | — |
| Doc review（Codex round 13，本批次） | `⛔ Needs revision` — 3 P1，三者都是**複審期間我還在編輯**造成的現狀漂移：仍開著的案例已從兩個變四個、`&#49;` 行為控制組在收窄後失去依賴、Gate Record 下方仍寫兩平面皆 `fail`；**六份 README 全部 5/5** | thread `019ffd12-…`（doc） |
| Doc review（Codex round 14，本批次） | `⛔ Needs revision` — 2 P1 ＋ 1 P2：「具體形狀」這個計數單位本身不可能收斂（複審當場再造出 `∓6`），且 § 已解決 的「另有兩項」與後面的清單矛盾；**六份 README 全部 5/5** | thread `019ffd12-…`（doc） |
| Doc review（round 14 修訂後） | **未送審** | 計數單位改為**規則家族**（四個，其中字元表那族依定義涵蓋無限多形狀）；§ 已解決 追加現狀更正；§ 仍待處理 同步 |
| Doc review（Codex round 15，本批次） | `⛔ Needs revision` — 2 P1 ＋ 1 P2：**「規則家族」這個單位同樣被 production 反例證偽**（`PROSE_HOOKS` 定位不到候選計數時判定從未被呼叫——`−٩ hooks`、「−9 個鉤子」皆為綠）；Gate Record 三處 digest 前綴寫成 `46111170` 而實際是 `4611117b`；round 14 的修訂是取代而非追加；**六份 README 全部 5/5** | thread `019ffd12-…`（doc） |
| Doc review（round 15 修訂後） | **未送審** | 分類依據改為守衛自己的**四個處理階段**（階段封閉、階段內漏洞不封閉），並自行重現第五個逃逸、另量到名詞清單缺 zh-TW「鉤子」與 ko「훅」；digest 前綴三處更正；紀律例外記明 |
| Doc review（Codex round 16，本批次） | `⛔ Needs revision` — 2 P1：**階段列舉數漏一步**（`∸6 hooks`，U+2238——候選定位成功、無需正規化、`SIGN_CHARS` 沒認出它所以從未進入放行判斷，證明「一個字元算不算符號」是獨立的一步）；Gate Record 的現狀更正仍寫 doc `rounds=5` 而實際已是 6；**六份 README 全部 5/5** | thread `019ffd12-…`（doc） |
| Doc review（round 16 修訂後） | **未送審** | 階段表由四階改為**五階**並附呼叫鏈（讓讀者能核對列舉而不是信我數對了）；`rounds` 改為「寫下即過期，附重算指令」而不再逐輪追 |
| Doc review（Codex round 17，本批次） | `⛔ Needs revision` ＋ **`⚠️ Need Human`**（複審自己也給出這個結論）— 2 P1：五階的範圍宣稱過大（`assertProseHookCount()` 另有數值相等驗證與 verdict 接線兩步，且拿掉接線時前五階全對、帶號計數照樣綠）；「階段 2 無逃逸」被 `&plusmn;6 hooks` 推翻＋1 P2（紀律：四階表是改寫非追加）；**六份 README 全部 5/5** | thread `019ffd12-…`（doc） |
| **Doc review gate** | **仍開著，於輪次上限走 `⚠️ Need Human`** — round 17 的三項已如實記入 § 長期方向的 round 17 更正段，但**那是編輯，所以 doc 平面的 digest 又動了**；本記錄不 note pass，交人決定選項 B 之後再走一次 doc gate | — |
| Doc review（Codex round 18，本批次） | `⛔ Needs revision` — 1 P1：**doc gate 被錯綁到範圍外的 AC 1**（§ Outcome 與 § 長期方向都寫明本批不走 generator 路線、B 應在自己的批次做）＋ 2 P2（四階表仍是改寫非追加；呼叫鏈圖不是真實執行順序）。round 17 三項中第 1、2 項判定已關 | thread `019ffd12-…`（doc） |
| Doc review（round 18 修訂後） | **本輪送審中** | 解除 gate 對選項 B 的依賴；還原四階表為歷史快照；呼叫鏈圖正名為 failure-surface 對照圖並補真實執行順序 |
| Doc review（Codex round 19，本批次） | `⛔ Needs revision` — 2 P1（§ 長期方向仍以現況口吻寫「阻擋本批」；「誠實的界線」表仍寫「範圍限於分類器內部」）＋ 1 P2（round 17 的 Gate 列與章節標題被改寫而非追加）。round 18 的四階表還原與執行順序兩項判定已關 | thread `019ffd12-…`（doc） |
| Doc review（round 19 修訂後） | **本輪送審中** | 三項歷史句全部保留、以追加更正承載現況；round 17 的 Gate 列與標題逐字還原 |
| Doc review（Codex round 20，本批次） | `⛔ Needs revision` — round 19 三項**全部判定已關**；1 P1 為純帳務：round 19 的 verdict 未進 Gate Record，且「18 輪 doc review」少算一輪 | thread `019ffd12-…`（doc） |
| Doc review（round 20 修訂後） | **本輪送審中** | 補齊 round 19、20 兩筆 verdict 與修訂列；輪數改為指向本表而非寫死；並把「記 verdict 的同時就補這張表」寫成規則（見表後） |
| Doc review（Codex round 21，本批次） | `⛔ Needs revision` — round 20 的 P1 已關（1–20 輪 verdict 齊全、無缺號）；1 P1（帳務規則的「漏過兩次」只查得到一次）＋ 1 P2（又一次回寫歷史列的狀態） | thread `019ffd12-…`（doc） |
| Doc review（round 21 修訂後） | **本輪送審中** | 「兩次」改為只寫查得到證據的 round 19 一次；`round 18 修訂後` 那列的 point-in-time 狀態還原為「本輪送審中」 |
| Precommit（第一次） | `❌ FAIL` — `lint_fix` code=1：記錄裡的逃逸樣本 `[6 hooks](#x)` 被 markdownlint 當成真連結片段（MD051）。樣本改放進 fenced block | — |
| **Precommit** | **`## Overall: ✅ PASS`** — comment_blocks / lint_fix / test_unit 皆 code=0，記於 digest `sha256:4611117b…` | — |

**帳務規則（round 20 的 P1，寫成規則以免再犯）**：`node scripts/review-state.js note <plane> <verdict>`
與**在上表補一列**是同一個動作的兩半，必須同時做。這份記錄漏過一次——**round 19 的 verdict**（doc round 20 查出）——
造成「有更正段卻沒有來源列」，對接手的人來說那會斷掉「finding → 修訂 → 再送審」的證據鏈。
只寫查得到證據的那一次：doc round 21 查證後，記錄中沒有第二次。凡是文件裡出現「round N 的更正」，上表就必須找得到 round N 的 verdict 列。

`review-state.js` 的狀態槽與上表的關係，據實寫明（doc round 10 的 P1）：兩個平面目前都是
`fail`、`rounds=5`。這個計數**不等於**上表的輪次——它只數目前這個 digest 上被記過的失敗 verdict，
而 round 29 的編輯又把 digest 推走了一次。更該說清楚的是一筆已經發生的錯誤記帳：round 27 的
`⛔ Blocked` verdict 被 `note code_review fail` 記進去時，樹已經是 round 28 的內容，所以那筆記錄
把 round 27 的判定綁在 round 28 的 digest 上。內容定址收據的意義就在於「這個判定屬於這棵樹」，
綁錯了就不是收據。這裡不重寫那筆記錄（記錄類文件不回頭改寫成今天的樣子），而是留下這段說明：
**上表是 verdict 的來源，狀態槽只是提醒器的輸入**，兩者不一致時以上表為準。

**現狀更正（round 31 之後）**：上一段寫「兩個平面目前都是 `fail`、`rounds=5`」——那是寫下當時的
狀態，現在不再成立，依記錄紀律追加而不回頭改寫。目前 `review-state.js check --format=json`：

| 平面 | verdict | rounds | digest_match | owed |
|------|---------|--------|--------------|------|
| `code_review` | **pass** | 0 | true | **false** |
| `doc_review` | fail | 5 | false | true |
| `precommit` | 舊 digest 的 pass | 0 | false | true |

也就是：**code 平面的 gate 已關**（Codex round 31 `✅ Ready`，已 note 在它實際複審的那棵樹上）；
doc 平面仍欠；precommit 在目前 digest 上仍未跑。

**再更正**：precommit 隨後也跑完並通過（`## Overall: ✅ PASS`），槽位現為 `passed:true, digest_match:true, owed:false`；上表的 precommit 那一列是寫下當時的狀態。此後只剩 doc 平面仍欠——本節後續的編輯都落在 doc 平面，不動 code 與 precommit 的 digest。

**第三次更正（doc round 16）**：上表的 `doc_review rounds=5` 也過期了——doc 平面每記一筆 `fail`
就 +1，round 15、16 各記一筆，寫這段時是 **7**。這裡不再逐輪追這個數字，因為它**寫下即開始過期**：
`rounds` 只是提醒器的輸入，verdict 的來源是上面那張逐輪表。要現況請直接跑：

```bash
node scripts/review-state.js check --format=json
```

寫下當時的輸出：`code_review` = pass / rounds 0 / digest_match true / owed false；
`doc_review` = fail / rounds 7 / digest_match false / owed true；
`precommit` = pass / rounds 0 / digest_match true / owed false。

兩條 thread 的完整 id：code `019ffb7f-2363-7b40-8ddd-a54e39d5c9e3`、doc `019ffc52-d130-77d2-93b3-1f9aa3ca87c1`。
thread id 只在該次 session 內可續談，日後不可重播；此處記錄它們是為了說明 verdict 的來源，不是可重跑的憑證。

## 內容面（與守衛支線分開看）

已完成：六份 README 的計數全部同步為 99/99/15，並補上 Codex MCP 註冊章節、`jq` 需求說明與
`allowed-tools` 比例（90/99）。`node scripts/generate-readme-catalog.js --check` 回報 up to date。
語系措辭經 doc review 逐條查證：zh-TW／zh-CN 無用詞混用，`jq` 因果敘述與 hook 實作一致，
ja／es／ko 三處措辭已修正並複驗通過。

`/codex-setup init` 的宿主與語法不一致已修正（歷程見下方 § 已解決）：六份的 literal 使用者輸入改為
`$codex-setup init` 並移出 `bash` fence。

**唯一仍未完成的內容項**：AC 4 的 `~4%` 仍是寫死值，而六份 README 照樣把它當事實發佈。

## 仍待處理

- **AC 1**：generator 六檔寫入，以及它的前置——在地化文字保留模型決策、locale 類別標籤來源
- **AC 4**：`~4%` 需要可重現的量測來源，或移出 HERO-COUNT 區塊；目前以
  `HERO_CONTEXT_PERCENT = 4` 這個字面常數釘在測試裡，是未來衍生值的落點
- 上方十二則 `[NIT_DEFERRED]`
- **符號守衛：五個處理階段全部都有已示範的逃逸**——(1) 候選定位（計數根本沒被 `PROSE_HOOKS`
  找到，判定從未被呼叫）；(2) 表徵正規化（`&plusmn;6`——具名實體白名單只收 `minus`／`plus`）；
  (3) 符號候選辨識（字元表是列舉式的，依定義涵蓋所有未列舉的符號）；(4) 放行判斷（後綴允許的空白
  分支、既有的識別字／範圍允許）；(5) 區域組合（分隔列跳過與包裝器盲點的組合）。另有兩個不在五階
  範圍內的步驟（數值相等驗證、verdict 接線），見 § 長期方向的呼叫鏈。這些都不是待補的規則，是
  § Round 29 診斷為 `ARCHITECTURE` 的證據——換過三次計數單位，前兩次的單位本身被證偽，第三次是我
  對階段的列舉數漏一步（round 16 修正）。階段定義、呼叫鏈與來源見 § 長期方向的表，處置見選項 B。
  另兩件刻意不擋的事（數字後方的後綴符號、跨軟換行的連接詞）是界線不是待辦
- **Gate**：code review 已通過（Codex round 31 `✅ Ready`）、precommit 已通過（`## Overall: ✅ PASS`，
  digest `sha256:4611117b…`）；doc review 見 § Gate Record 的逐輪狀態

**round 18 的更正**：round 17 把輪次上限與 doc gate 混為一談，寫成「交人決定選項 B 之後再走一次
doc gate」。那是錯的，兩件事互不相干：輪次上限管的是**不再改守衛設計**（守衛程式碼自 round 31 起
一行未改），而選項 B 就是本批一開始就排除在範圍外的 AC 1（見 § Outcome）。doc gate 只需要記錄本身
誠實且無矛盾，**不以任何架構決定為前置條件**。

## ⚠️ Need Human：要決定的就一件事

**（round 19 還原：這個標題是 round 17 當時的身分，保留為歷史。它已由下方 § 給人的建議取代——
選項 B 是建議，不阻擋本批任何 gate。）**

## 給人的建議（不阻擋本批任何 gate）

**選項 B——讓 `scripts/generate-readme-catalog.js` 直接產生六份 README 的 marker block（即 AC 1）
——要不要做？** 這是 architecture-level 的範圍變更，依 `rules/auto-loop.md` 該由人決定，且依 § Outcome
本來就該在自己的批次做。

決定之前先看這三個事實，它們是這 18 輪 doc review ＋ 31 輪 code review 買到的東西：

（**round 20 更正**：doc review 至該輪已完成 20 輪。這個數字寫下即過期，**以 § Gate Record 的逐輪表
為準**，不再於此處追。）

1. 守衛的五個處理階段**全部**都有已示範的逃逸，其中階段 3 的字元表依定義涵蓋無限多形狀。再收一輪
   只會關掉被示範的那一個形狀
2. 這條規則已改 11 次，**每一次都是被下一輪複審攻破才前進**，沒有一次是設計出來就對
3. 它在回答散文本來答不了的問題——「這個數字對讀者而言帶不帶符號」需要渲染語意，而守衛拿到的是
   原始碼加一個手寫的近似渲染。選項 B 讓這個問題不存在，而不是再答對一次

**選 B 之後這條守衛的定位也會變**：計數由 generator 產生，守衛就從「防止手寫錯誤」退成「防止有人
手改產生區塊」，那時它擋得住的 25 項歷史 mutation 就已經足夠，五個階段的逃逸也不再是風險。

### Round 26 提出的 4 項：全部已關（4 項皆於 round 28 關閉）

| # | 嚴重度 | 內容 | 可複現的逃逸 |
|---|-------|------|------------|
| 1 | P1 | `againstCell` 用局部字元辨識分隔列，普通資料格可以偽裝成分隔列 | **round 27 改法、round 28 關閉**：round 27 整條刪除改行層級跳過，複審證明跨行仍可逃逸；關掉它的是 round 28 的兩個問題 |
| 2 | P1 | `proseCountRegion()` 的 8 字元 lead-in 是固定值，長包裝器可填滿它把符號推到界外 | **round 27 改法、round 28 關閉**：round 27 刪掉固定參數改行首起算，複審以軟換行證明仍可逃逸；關掉它的是 round 28 的段落區域 |
| 3 | P2 | 碼位鄰居讀取（`cpBefore`／`cpAfter`）沒有控制組——還原成 UTF-16 索引，139 個測試照樣全綠 | **已關閉（round 28）**：星球平面字母的負控制，還原索引即轉紅 |
| 4 | P2 | 可見字元判定用碼位而非字素叢集：NFD 拼法的 `café-flow` 會被誤判，NFC 的則通過 | **已關閉（round 28）**：可見字元類別加入 `\p{M}`，NFD 拼寫的負控制守住它 |

第 1、2 兩項是 blocking。Round 27 各以一個**刪除**關閉了它們在字元層級的形態，但 round 27 的複審
證明那兩個刪除本身又留下跨行的接縫（§ Round 28）——所以真正關掉它們的是 round 28 的「兩個問題」。
第 3、4 兩項依 `standard` tier 屬 sub-threshold，本可繼續延後；round 28 順手補上控制組把它們關了，
因為它們缺的正是控制組而不是實作。

### 長期方向：這條規則要不要繼續留著（**round 29 起阻擋本批**）

這一節原本標示為「不擋本批」——那在 round 28 以前是對的。Round 29 起不再成立，本批就是停在它上面。

**round 19 的現況更正（本節標題與上一句是 round 29 當時的判定，保留為歷史）**：「阻擋本批」限縮為
**停止再改守衛設計**——守衛程式碼自 code review round 31 `✅ Ready` 起一行未改，也不會再改。它
**不阻擋任何 gate**：code review 與 precommit 都已在目前 digest 上通過，doc review 只取決於這份記錄
本身誠實無矛盾，不以選項 B／AC 1 或任何架構決定為前置。本節後面凡以現況口吻寫「阻塞事項」
「停在它上面」「本批走 ⛔ Need Human」的句子，一律依此更正解讀。

歷史 mutation 集中的 **25 項**逃逸目前都被擋下，每一條規則被刪除或中和後都至少有一個已提交測試轉紅
（分隔列跳過與後綴符號允許更是雙向）。**但這一節在 round 29 從「下一批的判斷題」變回了阻塞事項**，
而且理由不是「還差一輪」——是**每一次重新定義「還剩幾個」的計數單位，複審都當場造出一個不在該
單位裡的反例**。三個單位依序失敗：具體形狀（round 14 以 `∓6` 證偽）、規則家族（round 15 以候選
定位證偽），現在改依處理階段分類，見下方：

**計數單位先定義清楚**，而且這一版和前一版不同，理由本身就是重點：前一版數的是「具體形狀」，
而複審隨即又造出一個沒被列到的（`∓6`，U+2213）。**具體形狀這個單位不可能收斂**——只要規則是列舉
式的，就永遠能再造一個。所以下表改數**規則家族**：每一列是一個「為什麼會漏」的原因，形狀只是它的
例子。四個家族之中三個是守衛自己的規則開出來的，一個是既有允許的性質。

**紀律例外，記在這裡**（doc round 15 的 P2）：round 14 的修訂是**取代**而非追加——上一版以「具體
形狀」為單位的定義段與四列表格被整段改寫，原文已不在檔案裡，只在 Gate Record 的 round 14 那一列留
下摘要。本記錄其他地方採用的是「保留舊段落、另加現狀更正」，這一次沒有。此後（含下方 round 15 的
更正）一律追加，下表因此保留不動。

| 仍開著的家族（round 14 版，**已由下方階段表取代**） | 為什麼會漏 | 已示範的形狀 | 來源 |
|--------------|-----------|-------------|------|
| 分隔列跳過 ＋ 包裝器盲點的**組合** | 形狀問題跳過整行、數字問題被包裝器擋住，兩個盲點相乘 | `<summary>全部 \| x \|` ＋ `\|-` 獨立成行 ＋ 計數包在 code span | round 29 探測，兩位複審者各自重現 |
| **符號字元表是列舉式的** | 只認那七個字元，任何不在表上的符號一律通過——這一列涵蓋所有未列舉的符號，不是只涵蓋已示範的那兩個 | `±6 個 hooks`（U+00B1）、`∓6 個 hooks`（U+2213） | code review round 29、doc review round 14 各構造一個 |
| 後綴符號允許的**空白分支** | 滿足 ASCII `+`、左鄰數字、右鄰空白三條件之後就不再往右看 | `0+ 6 hooks`、`0+\n\`6 hooks\`` | code review round 31 構造 |
| **既有**的識別字／範圍允許 | `2-3 天` 這種範圍寫法必須放行，而它和帶號的計數在字元層級同形 | `0−6 hooks` | code review round 30 構造；實測與後綴允許存在與否無關 |

**現狀更正（doc review round 15）：上表同樣不是封閉的計數單位，保留為歷程。** 複審沿 production
路徑造出第五個原因，而它不落在上表任何一列：`assertProseHookCount` 先用 `PROSE_HOOKS` 定位候選
計數，**定位不到就整個檢查都不會執行**——不是判定放行，是判定從未被呼叫。已獨立重現（回傳空陣列
即代表連候選都沒有）：

```bash
node -e 'const P=/(\d+)\s*(?:個|个|개)?\s*(?:hooks?|フック|钩子)/gi;
for (const c of ["Includes 6 hooks.", "Contradiction: \u2212\u0669 hooks.", "\u77db\u76fe\uff1a\u22129 \u500b\u9264\u5b50\u3002"])
  console.log(JSON.stringify(c), [...c.matchAll(P)].map(m => m[0]));'
# "Includes 6 hooks." [ '6 hooks' ] / 後兩者皆 []
```

這不只是刻意構造：名詞清單有 zh-CN 的「钩子」卻沒有 zh-TW 的「鉤子」，也沒有 ko 的「훅」。六份
README 目前都寫成名詞用英文（`6 個 hooks`／`6개 Hooks`），所以現在全部命中；有人把 zh-TW 在地化成
「6 個鉤子」，那一處就從此不再被檢查，而其他段落仍命中，`mentions.length > 0` 照樣成立——**沒有任何
訊號會亮**。

所以計數單位第三次更換，而且這次換的是**分類的依據**：不再列「已知的放行路徑」（那是開放集合，
用開放集合當計數單位正是前兩次失敗的共同原因），改依守衛自己的**處理階段**。階段之所以可能封閉，
是因為它們不是我歸納出來的類別，而是**端到端符號檢查路徑上實際存在的步驟**。範圍必須講死
（round 17、18 的更正）：這五階是那條路徑的**五個語意失效面**，不是整個 `assertProseHookCount()`
的全部步驟——它還有兩步不在五階裡，見下方 ⚠️ 兩行；也不能說成「分類器內部」，因為 `PROSE_HOOKS`
與 `proseCountBlock()` 都在呼叫端。

**真實執行順序**（測試檔 601–609 行，可直接對照）：

```text
PROSE_HOOKS → assert.equal(parseInt(m[1]), hooks) → proseCountBlock()
  → renderInline(proseCountBlock(...)) → offendingSign(raw, visible)
  → decodeSignRefs() → offendingSignShape() / offendingSignOnNumber()
  → assert.equal(..., null)
```

**failure-surface 對照圖**（語意分類，不是 call stack）：

```text
PROSE_HOOKS                            → 1 候選定位
assert.equal(parseInt(m[1]), hooks)    → ⚠️ 數值相等驗證——不在五階內
renderInline() / decodeSignRefs()      → 2 表徵正規化
proseCountBlock()、DELIMITER_ROW、行 vs 段落 → 5 區域組合
SIGN_CHARS / SIGN_CHAR                 → 3 符號候選辨識
identifierSign() 等三條允許             → 4 放行判斷
assert.equal(offendingSign(...), null) → ⚠️ verdict 接線——不在五階內
```

兩個 ⚠️ 步驟為什麼要單獨標出來，而不是硬塞進五階：它們是**接線**而不是判定——round 25 的其中一個
P1 正是「這個區域接了相等檢查卻沒接符號檢查」，也就是接線本身就是一類獨立的失效面。把它們算進五階
會讓「階段」同時指涉兩種東西；標在鏈上而不編號，是承認它們存在且不在這個計數單位的範圍內。

**每個階段內的漏洞數量仍不封閉**，這正是 `ARCHITECTURE` 診斷的內容。

| 階段 | 這一階段問什麼 | 已示範的逃逸 | 來源 |
|------|--------------|-------------|------|
| 1 候選定位 | 這段文字裡哪些位置是「計數」 | `−٩ hooks`（U+0669 非 ASCII 數字）、「−9 個鉤子」（名詞不在清單） | doc review round 15 |
| 2 表徵正規化 | 把字元參照與 inline 標記還原成讀者看到的樣子 | `&plusmn;6 hooks`——`SIGN_REF` 的具名分支只收 `minus\|plus`，`renderInline()` 也不解實體，所以讀者看到 `±` 而守衛看到字面 `&plusmn;` | doc review round 17 |
| 3 符號候選辨識 | 這個字元**算不算一個符號** | 字元表是列舉式的：`±6`（U+00B1）、`∓6`（U+2213）、`∸6`（U+2238） | code review round 29、doc review round 14、round 16 |
| 4 放行判斷 | 已認出的符號是識別字／範圍／連接詞，還是計數的號 | 後綴允許的空白分支、既有的識別字／範圍允許 | code review round 30、31 |
| 5 區域組合 | 形狀讀行、數字讀段落，兩者的邊界如何相接 | 分隔列跳過 ＋ 包裝器盲點的組合 | round 29 探測，兩位複審者各自重現 |

**round 16 的更正**：上一版寫「四個階段」，並把字元表列舉問題掛在正規化底下。那是錯的——複審以
`∸6 hooks`（U+2238 DOT MINUS）證明：候選定位成功、沒有東西需要正規化、`SIGN_CHARS` 根本沒認出這個
字元所以從未進入放行判斷、區域組合也正確。**「一個字元算不算符號」是獨立的一步**，現已列為階段 3。

這件事本身要說清楚，因為它會被誤讀成「階段這個單位也失敗了」：**失敗的是我對階段的列舉，不是分類
依據**。前兩個單位（具體形狀、規則家族）是開放集合，再怎麼列都會有下一個；階段來自呼叫鏈，數量固定，
只是我第一次數漏了一步——上面的呼叫鏈就是為了讓下一個讀者能直接核對，而不是再信我數對了。

前一版那四個家族分別落在階段 3、4、5；round 15 的反例落在**階段 1**，round 16 的落在**階段 3**。

**被取代的四階表，還原於此**（doc round 18 的 P2；round 16 當時直接改寫，這裡把原表補回並標為歷史
快照，下方五階表才是現況）：

| 階段（round 15–16 版，**已由上方五階表取代**） | 這一階段問什麼 | 已示範的逃逸 | 來源 |
|------|--------------|-------------|------|
| 1 候選定位 | 這段文字裡哪些位置是「計數」 | `−٩ hooks`（U+0669 非 ASCII 數字）、「−9 個鉤子」（名詞不在清單） | doc review round 15 |
| 2 正規化 | 把字元參照與 inline 標記還原成讀者看到的樣子 | 符號字元表是列舉式的：`±6`、`∓6` | code review round 29、doc review round 14 |
| 3 放行判斷 | 這個符號是識別字／範圍／連接詞，還是計數的號 | 後綴允許的空白分支、既有的識別字／範圍允許 | code review round 30、31 |
| 4 區域組合 | 形狀讀行、數字讀段落，兩者的邊界如何相接 | 分隔列跳過 ＋ 包裝器盲點的組合 | round 29 探測，兩位複審者各自重現 |

**紀律的最終說法（round 18）**：不再主張「現況型表格可以就地改寫」——這份是 request record，契約就是
不回寫歷史。實際規則是：**被取代的表保留並標示已取代，新的現況另立一張**；round 14 的「具體形狀」
表因為改寫時未留副本已無法還原，只能在 Gate Record 的 round 14 列留下摘要，這一點如實記在這裡。

**round 17 的更正**：三件事，一次講完。

1. **階段 2 不是空的**。上一版寫「目前無已示範逃逸」，複審當場推翻：`Contradiction: &plusmn;6 hooks.`
   全程為綠。已獨立重現——`/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(minus|plus));/g` 對 `&plusmn;6 hooks`
   回傳 `[]`（`&minus;`、`&plus;`、`&#8722;` 三者都命中，只有 `&plusmn;` 不命中），而 `renderInline()`
   不解 HTML 實體。所以現況是**五個階段全部都有已示範的逃逸**。處置**不是**把 `plusmn` 加進白名單
   ——那正好又是「再答對一次」，見選項 B。
2. **五階的範圍被限縮**：它是符號分類器內部的 failure surface，不是整條呼叫鏈。上方鏈中的兩個
   ⚠️ 步驟（數值相等驗證、verdict 接線）不在五階內，且 verdict 接線被拿掉時前五階全部正確執行、
   帶號計數照樣為綠。`proseCountBlock()` 也從「表徵正規化」改列到「區域組合」，它建立的是段落區域。
3. **紀律的實話**：這份記錄宣告過「此後一律追加」，然後 round 16 又把四階表改寫成五階。與其第三次
   宣告，不如把實際採用的規則寫明：**現況型表格（階段表、狀態表）視為 current-authority，就地改寫；
   逐輪表列與更正段一律追加**——被改寫的內容一定同時在 Gate Record 留下該輪摘要與一段更正。這是
   round 14、round 16 兩次改寫的實際做法，登記於此，不再宣告做不到的事。

刻意不硬編「第 26 種」「第 27 種」：那需要先重新定義 finding identity 的計數單位，而混用計數單位
正是本記錄前面已經被複審點名過一次的地方。依 § Round 29 的 `ARCHITECTURE` 診斷，這是設計層級的
問題，不是再一輪能關掉的。

誠實的界線，逐項分開講，因為它們的可查證程度不同：

| 敘述 | 可查證嗎 |
|------|---------|
| 這 25 種逃逸現在都被擋下 | **當時可以**——mutation harness 是寫在 job 暫存目錄的一次性腳本，沒有進版控，所以這一條**現在無法重跑**；可重跑的只有已提交的測試（見下一列） |
| 每條規則都有已提交控制組 | **可以**——`node --test test/scripts/generate-readme-catalog.test.js`，140 個案例；分支刪除方向於 round 28、29 各驗過一次 |
| 不存在下一個逃逸 | **不可以，而且這個問題本身問錯了**：三種計數單位（具體形狀、規則家族、處理階段）依序被換掉，前兩種各被複審當場證偽一次。目前的單位是**五個處理階段**（取自實際步驟，非歸納；範圍是**端到端符號檢查路徑的五個語意失效面**，不是「分類器內部」——`PROSE_HOOKS` 與 `proseCountBlock()` 都在呼叫端，round 19 更正），五階**全部**都有已示範的逃逸；階段封閉而階段內的漏洞不封閉——例如階段 3 的「字元表是列舉式的」依定義涵蓋無限多形狀，`±`、`∓`、`∸` 只是已被示範的三個。這條規則到 round 29 為止共 **9 輪變更（8 次改設計，加 round 29 的有界收緊）**，其後 round 30、31 又各收窄一次（見 § Round 29 的複審的兩則後續），**合計 11 次**；每一次都是被複審指出漏洞才收斂，不是被設計出來就對 |

真實風險（手動同步打錯字）它擋得住；面對刻意構造，它的紀錄是**11 次變更每一次都被下一輪攻破，且五個處理階段全部都有已示範的逃逸**。

三條路的代價不同層級，值得由人決定：

| 選項 | 做法 | 代價 |
|------|------|------|
| A：維持現狀 | 就用 round 29 的守衛，把兩件刻意不擋的事（數字後方的後綴符號、跨軟換行的連接詞）與五個處理階段各自的已知逃逸（見上表）都登記為已知界線 | 擋得住 drift——那是真實風險（手動同步打錯字）。**但要誠實**：它擋得住的是歷史 mutation 集中的 25 項，而五個處理階段**全部**都有已示範的逃逸，其中階段 3 的字元表涵蓋無限多形狀，所以絕不能寫成「守衛保證計數正確」 |
| B：換掉輸入 | 不在散文上判定，改成 marker 區塊由 generator 產生（即 **AC 1**），測試比對「產生的字串 == 檔案裡的字串」 | 要償還 AC 1 的前置成本（在地化保留模型、locale 類別標籤），但這條規則會整個消失 |
| C：換掉剖析器 | 引入真正的 Markdown parser，在 AST 上判定 | 新依賴；且第五則 `[NIT_DEFERRED]`（連結目的地）也只有這條路能真正解決 |

我的建議仍是 **B**，而且 round 29 之後它不再只是偏好：這條規則 11 次變更（8 次改設計，加 round 29、30、31 各一次有界收窄）
都沒有停下來，每一輪都是被攻破才前進，因為它在回答散文本來就答不了的問題——「這個數字對讀者而言帶不帶符號」需要的是渲染語意，
而守衛拿到的是原始碼加一個手寫的近似渲染。AC 1 本來就是本 request 的主張，而它讓這個問題不存在，
而不是再答對一次。B 是 architecture-level 的範圍變更，依 `rules/auto-loop.md` 該由人決定、且該在它
自己的批次裡做——這正是本批走 ⛔ Need Human 而不是開第十輪的理由。

（依 round 19 的現況更正：這裡的 ⛔ Need Human 指的是**不再開下一輪守衛設計**，不是 gate 的前置
條件；選項 B 是建議，不阻擋本批任何 gate。）

## 已解決（保留歷程，這裡不是待辦）

### 守衛的 P1：報告出現 16 次，去重後 12 個獨立缺陷，12 個全關

**兩種計數單位要分開講，否則「提出幾個、關掉幾個」會被讀成「還有幾個沒關」。**

*出現次數*：code review round 20 兩個、21 兩個、22 兩個、23 一個、24 兩個、25 兩個、26 兩個、27 兩個，
加上 doc review round 5 補的一個（外層接線可被抽換——code reviewer 沒抓到，doc reviewer 抓到了），
共 **16 次**。

*獨立缺陷*：依 finding identity 去重後是 **12 個**。差額來自兩條線各被點名三次——分隔列判定
（round 25 → 26 → 27）與散文區域（round 25 → 26 → 27）：每一輪的修法都關掉了上一輪示範的形態，
又在下一個層級留下接縫，所以複審一再回到同兩條線，而不是找到新的缺陷。

**round 20–27 的 12 個獨立缺陷全部已關**，最後兩條由 round 28 收掉。這句話的範圍就到 round 27 為止，
不是「現在沒有未關的 P1」——**另有兩項不計入這 12 項、也不計入十二則 deferred P2**：round 29 探測構造出
的 architecture residual（`<summary>` 假 header ＋ `\|-` ＋ code span，至今仍為綠，見 § 長期方向），以及
code review round 29 找到並已於本輪修掉的誤判（見 § Round 29 的複審）。

**現狀更正（round 31 之後）**：上一段寫「另有兩項」——那是寫下當時的狀態。經過 code review
round 30、31 兩輪與 doc review round 15–17，正確的說法是：**守衛的五個處理階段全部都有已示範的
逃逸**（定義與清單見 § 長期方向的表），外加 code review round 29 找到並已修掉的那個誤判。這些既
不計入上述 12 個歷史 P1，也不等同於十二則 deferred P2——只有兩項在 deferred 清單裡有對應條目
（階段 3 的字元表、階段 4 的空白分支），其餘（階段 1 的候選定位、階段 5 的假 header 組合、階段 4
的識別字／範圍允許）記錄在 § 長期方向而非 deferred 清單，因為它們不是「可以補一條規則關掉」的
項目。**不再寫任何「還剩 N 個」的數量**：那個問法本身已被證偽三次。

前 8 個（round 20–23 的七個，加 doc round 5 那個）在 round 26 之前關閉，每一項都有一個「刪掉它就
轉紅」的已提交控制組。**Round 25 起的四項全部集中在同一條「符號」規則上**，處置橫跨三輪：

| 來源 | P1 | round 26 的處置 |
|------|----|----------------|
| round 24 | 符號可跨越隱形包裝器（code span／連結／inline HTML） | **關閉**：三個示範仍為 RED，且收緊後未回歸 |
| round 24 | `allowed-tools` 比例欄沒有符號檢查 | **關閉**：已接上收緊後的判定式（`+ 90 of 99` 亦 RED） |
| round 25 | 三種允許各自可被構造出帶符號的計數 | round 26 修好 `W-W`（可見性）與連接詞（兩個運算元）；**分隔列那條沒修成**（round 26 以 `:-**99**`、`\|-- 99` 證明），round 27 改行層級跳過，round 27 複審再以獨立成行的 `-` 證明跨行仍可逃逸；**round 28 關閉**（形狀＋數字兩個問題） |
| round 25 | locale 散文 hook 計數讀取器未接符號檢查 | round 26 接上了，但固定 8 字元視窗可被長包裝器填滿；round 27 改行首起算，複審再以軟換行拆開證明；**round 28 關閉**（形狀讀行、數字讀段落） |

12 個獨立缺陷的處置方式歸類（次數合計 12）：

| 方式 | 次數 | 例 |
|------|------|----|
| 換一個問題來問 | 3 | 鄰近度 → 白名單整數；判定內部 → 判定接線；同值 fixture → 哨兵值 |
| 把自己加的東西移除 | 2 | CJK 字元表、連結剝除正規式（該 nit 隨之還原為延後） |
| 改用檔案裡既有且已被信任的機制 | 3 | 全形數字改判 `\p{Nd}`；符號與整數讀取器改用同一個 `renderInline` |
| 把判定的**對象**從鄰域收緊為構造 | 2 | `W-W` 的可見字元、連接詞的兩個運算元（§ Round 26） |
| **拆開一個被當成單一問題的問題** | 2 | 分隔列與散文區域最後都不是「換一條規則」關掉的，而是承認形狀與數字是兩個問題（§ Round 28）。中間的兩次刪除（§ Round 27）換對了層級但仍假設只有一個問題 |

**沒有一項是靠「把同一條規則再調一次參數」關掉的。** 撐最久的分隔列那條走完了完整的階梯：先兩次
只換寫法沒換層級（「相鄰有 `\|`」→「run 的兩端有 `\|`」，兩者都是局部字元特徵），再一次換對層級但
仍假設只有一個問題（行層級跳過），最後才是拆開成兩個問題。

三段教訓，由弱到強，也正好是這批被複審推著走完的順序：

1. **換寫法無效，換層級有效**——而兩者在 diff 上長得很像。分辨方法是問「這條規則描述的東西，跟它要
   辨識的構造是不是同一個層級」。
2. **換對層級還不夠，如果層級本身有接縫**。行有下一行，區域有外面；Markdown 把軟換行渲染成空格，
   所以「一行」不是讀者讀到的單位。
3. **最後要問的是「這是一個問題還是兩個」**。形狀與數字互為盲點，任何一邊單獨拿去回答都會被另一邊
   的盲點穿過——前七輪的失敗全部可以用這一句重述。

### `$codex-setup init` 的宿主與呼叫語法

doc review 指出 Codex CLI 以 `$skill-name` 呼叫 skill，而六份 README 使用 `/` 前綴。我一度把這歸為
「跨全部 catalog 條目的全域慣例、beyond current scope」——**那個推理是錯的**，doc review round 2 已駁回：
catalog 表格的顯示用識別名，與快速開始那行和 INSTALL-COVERAGE 方法欄的 **literal 使用者輸入**，是兩個
不同的面，只有後者需要改；而 `rules/fix-all-issues.md` § Exceptions 的該項僅限 architecture-level 變更，
不適用於此。

（規模的正確數字：每份 README 的 FULL-CATALOG 是 **99 列**，全檔以 `/` 開頭的表格列共 **114 列**——99 列
加上 Essential Skills 重複列出的 15 列。先前這裡寫「115 條 catalog 條目」是錯的，doc review round 4 指出，
已查證更正。）

中途的錯誤處置：本批曾把快速開始的註解由「在 Claude Code 內執行」改為「在 Codex CLI 內執行」，而 `/` 是
Claude Code 的語法——這個改動把一條原本正確的指示變成斷言一個未經查證的宿主語法，**已還原**。當時未動 `$`
是因為無法本機查證（`codex-cli 0.146.0` 的 `--help` 未說明 skill 呼叫語法，repo 內亦無證據）。

Round 3 補充：`$` 已由外部文件確立。我曾問「引用外部文件是否足以作為在無法本機驗證下動手的依據」，
reviewer 明確回答足夠，並指出 `codex --help` 未列出該語法不構成反證——那份 help 不涵蓋所有 composer 慣例。
依據：OpenAI Build Skills 文件 <https://learn.chatgpt.com/docs/build-skills#optional-metadata>。

**最終修法**：六份快速開始把 shell 安裝指令與 Codex composer 輸入拆成兩個 fence，後者改用 `text` fence 並
寫成 `$codex-setup init`——`$...` 留在 `bash` fence 內會被讀成 shell 變數展開，這是 reviewer 指出、我原本
會漏掉的細節。六份 INSTALL-COVERAGE 的方法欄同步為 `$codex-setup init`，其中 README.md 那份由
`scripts/generate-readme-catalog.js` 重新產生（該檔第 244 行的英文字串已改），五份 locale 手動同步，相關
測試 fixture 一併更新。`--check` 回報 up to date。catalog 的顯示用識別名維持 `/` 前綴不變。
