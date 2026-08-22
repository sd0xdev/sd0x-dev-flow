# Stacked PR Mode r2 — Review Log

> **Parent request**: [2026-07-31-stacked-pr-mode-r2.md](./requests/2026-07-31-stacked-pr-mode-r2.md)

逐輪 code review／doc review 的事實紀錄。與需求單本體分開，是因為它已成長為獨立主題：需求單描述**要做什麼與是否完成**，本檔描述**每一輪查到什麼、怎麼修、怎麼驗**。兩者讀者與生命週期不同。

- Tech Spec: [2-tech-spec.md](./2-tech-spec/2-tech-spec.md) §3.3–§3.4、§5、§6

> **路徑變更（2026-08-21 補記）**：上列連結的**顯示文字 `2-tech-spec.md` 即本檔撰寫當時記下的檔名，未
> 改**；改的只有 href——該檔已依 `@rules/docs-numbering.md` § Size Limit 拆分，現址為
> `./2-tech-spec/2-tech-spec.md`（§ 3.4 另切為同資料夾的 `1-core-logic.md`）。**只重指 href、不動顯示
> 文字，是本批對記錄的一致處置**：記錄的用字是記錄，指標是導覽；把 href 也凍結只會留下死連結，而死
> 連結不保存任何資訊。散文中出現的路徑（非連結）則逐字保留，見姊妹檔
> [`review-log-rounds-38-61.md`](./review-log-stacked-pr-mode-r2/review-log-rounds-38-61.md) 標頭。
- Requirements: [1-requirements.md](./1-requirements.md) §5、§8
- Sibling: [r1 — 設計前置](./requests/2026-07-31-stacked-pr-mode-r1.md)

## 輪次索引

本檔保留**索引與尚未搬移的輪次**（目前是第 98、99 兩輪，各自的 gate 計數見該節末）；較早的輪次移入同名子目錄。搬移**以逐字複製為原則，但有一處例外**：第 38 輪 P1-4 的 POSIX 敘述補上了版本限定，那是事實更正而非搬移，明細見本檔末〈搬移驗證〉。切分點一律取在輪次的第一行，因為已完結的輪次是不可變前綴——後續續寫只會加在本檔尾端，不會再移動任何一個邊界。

**本檔的逐輪記錄從第 38 輪開始。** 第 27–37 輪未搬過來，散見於[需求單](./requests/2026-07-31-stacked-pr-mode-r2.md)正文的 `## Acceptance Criteria`（AC-Q1 本體、審查者替換說明，及其後的 review Note）與 `## Progress`（狀態表與第 35–37 輪的 Note）；形式不一致——有的是具名 `**Note —**`，有的併在 AC 段落裡，第 34 輪則只出現在審查者替換說明與 Testing 狀態列，沒有獨立條目。該檔的 `## Review Log` 一節只是指回本檔的索引，不含輪次內容。第 1–26 輪未以逐輪形式記錄。

| 範圍 | 檔案 | 主題 |
|------|------|------|
| 38–61 | [review-log-rounds-38-61.md](./review-log-stacked-pr-mode-r2/review-log-rounds-38-61.md) | 加固措施自身的副作用；F6b 從「禁止形式」重寫為引號狀態機 |
| 62–76 | [review-log-rounds-62-76.md](./review-log-stacked-pr-mode-r2/review-log-rounds-62-76.md) | 連串自引入的迴歸、引號語意、誤報側攻擊，至 ⚠️ Need Human |
| 77–83 | [review-log-rounds-77-83.md](./review-log-stacked-pr-mode-r2/review-log-rounds-77-83.md) | 架構重整（使用者核准）：換掉被檢查的對象，而非再修 walker |
| 84–89 | [review-log-rounds-84-89.md](./review-log-stacked-pr-mode-r2/review-log-rounds-84-89.md) | oracle 自身的缺陷比 Codex 指出的還多；靜態辨識器的文法基礎重寫 |
| 90–93 | [review-log-rounds-90-93.md](./review-log-stacked-pr-mode-r2/review-log-rounds-90-93.md) | 從「禁止形式」走到「正面列舉」；選錯軸，dispatcher 自己說了 |
| 94–97 | [review-log-rounds-94-97.md](./review-log-stacked-pr-mode-r2/review-log-rounds-94-97.md) | 分隔符 pin、ANSI-C 引號建模、fence recognizer 補齊，至收斂性判決 |
| 98 | 本檔以下 | PR #8 的 CI 紅燈：三個平台可攜性缺陷 |
| 99 | 本檔以下 | 為第 98 輪的 CDPATH 修法補上守衛：一個守衛被連續拆穿五次 |

## Round 98 — PR #8 的 CI 紅燈：三個各自獨立的平台可攜性缺陷

PR #8 建立後 CI 失敗（9 個測試）。三個根因彼此無關，全部**先在本機重現**再修，沒有一個是從程式碼推論出來的。

| # | 根因 | 症狀 | 修法 |
|---|------|------|------|
| 1 | `git init` 繼承 `init.defaultBranch` | 7 個測試失敗。本機是 `main`，CI 未設定 → `master`，hook 更新的 ref 沒有東西指向它，於是測試自己的控制斷言先炸 | `git init --initial-branch=main`（與既有 6 個測試檔一致：`user-prompt-review-guard`、`session-init`、`post-edit-format`、`git-profile`、`namespace-hint-sentinel`、`smart-commit-scope`）|
| 2 | privileged 模式對 CDPATH 的處理隨版本改變 | `run-skill.test.js` 的 negative control 失敗 | 改為**探測**而非推導版本，兩種 regime 都斷言、不 skip |
| 3 | POSIX 模式下 process substitution 的合法性隨版本改變 | `sanitize-pr-content.test.js` 的 mutation control 失敗 | 見下方 round 4–6 |

重現條件：`GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`，7/7 精確重現。

貫穿三者的原則：**不放寬測試**——把每一個隱含的平台假設換成明確量測，並且**兩種 regime 都斷言而非 skip**。skip 會讓旁邊那個正向測試以一個沒說出口的理由保持綠燈。

### CDPATH：版本邊界不是直覺猜得到的

bash NEWS 記載 CDPATH 在 **4.0** 加入 privileged 模式忽略的變數清單。本機兩個 build 剛好夾住這個邊界（3.2 遵守、5.3 忽略，皆為實測），4.x 未安裝——這正是改用行為探測的理由。探測必須問 `/bin/bash` 而非 `bash`：`run-skill.sh:36` 的 re-exec 寫死了那個路徑。

### 第 98 輪內的 code review 第 4–6 次：一個 mutation control 被連續拆穿三次

編號說明：4–6 是**本輪內部**對 `sanitize-pr-content.test.js` 的第幾次 Codex code review，與上方索引表的全域輪次無關；本節其他地方提到「第 6 次」時同義。

| 輪 | Codex 發現 | 我原本的設計錯在哪 |
|----|-----------|-------------------|
| 4 | 釘住 argv 陣列 ≠ 釘住呼叫；`/<\s*<\(/` 分不出語法與引號內文字 | `: '< <('` 匹配該 regex 卻不含任何 process substitution |
| 5 | `toString()` regex 不是因果控制 | `false ? parsePosix(t) : parsePlain(t)` 仍匹配 `parsePosix(`；`['-n', t, '--posix']` 仍匹配 `/'--posix'/` 但 flag 在 operand 之後不啟用 POSIX |
| 6 | `assert.doesNotThrow` 對 no-op 也通過 | bash 5.3 上 discriminator 的 `strict === 0`，空函式讓兩個 sibling 測試全綠 |

**我的一個全稱結論被 Codex 推翻。** 我測了十二個構造，宣稱 bash 5.3 不存在 parse-verdict discriminator。Codex 給出反例，實測確認：

```
echo "${x:-'}}"          3.2[posix:2 plain:2]   5.3[posix:0 plain:2]
process substitution     3.2[posix:2 plain:0]   5.3[posix:0 plain:0]
```

POSIX 規定雙引號 `${...}` 內的單引號是字面字元；bash 預設模式卻當作引號起始、一路吃到 EOF。**這兩個候選構造，沒有一個在兩個 build 上都能區分**——上表就是全部證據，它不支持「不存在這種構造」的全稱句（上一段那個被推翻的宣稱正是這樣寫出來的）。這一點形塑了最終設計：不做版本判斷，改為**探測選擇**——列出兩個 exact-byte fixture，用字面 argv 各探一次，取第一個在本機解譯器上兩模式真的分歧者。

最終形狀：一個 discriminator 存在性 guard，加三個 helper 行為斷言，缺一不可。

| 斷言 | 擋掉的變異 |
|------|-----------|
| `assert.ok(d)` | 本機解譯器上兩個 fixture 都不分歧時**大聲失敗**而非靜默跳過 |
| `parsePosix(d.path).status === d.strict` | helper 退化成 plain parse：掉 flag、flag 位置錯 |
| `parsePosix(合法腳本).status === 0` | 常數 stub `{status: 2}` |
| `parsePosix(語法錯誤).status !== 0` | 常數 stub `{status: 0}`——即 round 6 的 no-op |

第四條補的是 Codex 給的 remedy **本身仍留的洞**：`strict === 0` 時單一等值斷言退化成一個 bit，常數 0 照樣滿足。

這四條的射程**僅限 helper 自身**。sibling 的 `test()` 本體若改寫成直接 spawn bash，四條全部觀測不到——見下方〈誠實的邊界〉。

### 觀測強度，不是斷言數量

這三輪的共同教訓：控制力取決於**能觀測到幾個狀態**。「有沒有丟例外」是一個 bit，區分不了「正確通過」與「什麼都沒做」；讓 helper 回傳 verdict 就有三態。而當 oracle 的期望值恰好落在某個常數上，單一等值斷言又退回一個 bit——所以要用兩個方向的邊界把常數空間夾掉。

同一個道理解釋了為何 `toString()` 必須整組移除：source predicate 觀測的是**文字**，而語意等價但行為不同的寫法（dead code、參數位置）在文字上無法區分。行為斷言則把受測對象放進一個輸出會分歧的環境，**helper 內部**的 bypass 於是都塌縮成 plain verdict。

### 誠實的邊界

沒有任何 runtime 控制能證明 sibling 的 `test()` 本體真的呼叫了 helper——改寫測試本體去直接 spawn bash，是任何斷言都觀測不到的。這一點寫進註解而非用脆弱的全檔 grep 假裝擋住了：那種 tripwire 會被檔案裡無關的 `spawnSync` 誤觸，正是 `rules/testing.md` § Guards 警告的「當天綠、日後假陽性」。Codex 獨立確認這是誠實邊界而非藉口。

### Mutation 結果（最終設計）

> **證據性質**：以下六列、上文的 CI 9 failures、7/7 本機重現、以及本節末的 gate 計數，都是**本次 session 的實測結果，repo 內沒有留存產物**——mutation harness 寫在暫存目錄，不是版本控管的檔案。未來維護者不應把它們當成可重播的 repository evidence。重跑方式：逐一套用「Mutant」欄的編輯到 `test/scripts/sanitize-pr-content.test.js`，執行 `node --test test/scripts/sanitize-pr-content.test.js`，確認具名的 mutation control 轉紅，再還原。相對地，**斷言本身的靜態形狀是可驗證的**，Codex 已獨立確認它會拒絕列出的六種變異。

| Mutant | 結果 |
|--------|------|
| helper 掉 `--posix` | KILLED |
| `--posix` 置於 operand 之後 | KILLED |
| helper stub 成常數 PASS（round 6 的 no-op） | KILLED |
| helper stub 成常數 FAIL | KILLED |
| procsub fixture 不再是 process substitution（仍合法 bash） | KILLED |
| quoted-expansion fixture 失去單引號 | KILLED |

Gate：Codex round 6 **✅ Ready**（P0/P1/P2 = 0，1 Nit 已 `[NIT_DEFERRED]`）。`/precommit` **✅ PASS** — 3462 tests / 3456 pass / 0 fail / 6 skipped。

### 未處理項

`[NIT_DEFERRED] test/scripts/sanitize-pr-content.test.js:1221` — 舊註解與一則斷言訊息仍宣稱 process substitution 在 POSIX 模式一律是語法錯誤，與新表格記載的 bash 5.1 行為矛盾。低於 `thorough` 的阻擋門檻，依 `@rules/auto-loop.md` § Sub-Threshold Findings 記錄放行，留給 `/codex-review-branch` 下次深審。

### 本檔的拆分（`@rules/docs-numbering.md` 500 行）

拆分完成，形狀見上方〈輪次索引〉。**我原本主張延後拆分，理由被量測推翻。** 當時的兩個前提各錯一項：

| 我的前提 | 實測 |
|----------|------|
| 「拆分邊界會隨續寫移動，現在拆等於做兩次」 | 已完結的輪次是**不可變前綴**，archive 一次就不會再動；續寫只加在本檔尾端 |
| 「會引入一整批 inbound link 的重指」 | `grep -rn` 全庫只有**一個** inbound markdown link（在 R2 需求單），且主檔保留原路徑，該連結一字未改 |

一併記下：規則給的 Default-tier 例外問的是「為何這個檔案**不拆比較好讀**」，而我當時寫的是預期的編輯成本——那不是規則問的問題。

搬移驗證：把六個 archive 的內文（各檔跳過前 4 行的標題與返回連結）依序重組，與原檔對應行逐行 diff。差異只有兩類，**都在此列出**：

1. **切分邊界的空白**——61/62、83/84、89/90、93/94 四個接縫各少一個空行；76/77 接縫少了「空行、`---`、空行」三行（該 `---` 是輪次之間的分隔，非內容）。
2. **一處內容更正**（非搬移）——`review-log-rounds-38-61.md` 第 11 行，第 38 輪 P1-4 的 POSIX 敘述加上「限 bash 3.2–5.0；5.1 起已允許 process substitution，見 Round 98」。原句是無版本限定的全稱句，經本輪實測為錯，故就地更正而非原樣保存。

除這兩類外，其餘段落、表格、程式碼區塊**逐字相同**，無任何一輪遺失或重複。除第 2 項那處內容更正外，為切分而新增的位元組只有各檔的標題行與返回連結，以及本檔的索引表。本檔案組內 17 個相對連結全部解析成功（本檔 11、六個 archive 各 1 條返回連結）。

---

## Round 99 — 為第 98 輪的 CDPATH 修法補上守衛：一個守衛被連續拆穿五次

第 98 輪修好了 CDPATH 這個威脅本身（解析前 `CDPATH=''`，見 §3.4 item 24），但**沒有任何測試釘住那條線**——它可以被刪掉、被移到解析之下、或被改寫成永不執行的資料，三種情形下既有測試全綠。本輪補這個守衛，過程中 Codex 連續五輪各找出一個**不同**的真實缺陷，第 6 輪 clean。

| 次 | Codex 發現 | 我原本錯在哪 |
|----|-----------|-------------|
| 1 | 守衛不存在 | 第 98 輪只改了程式，順序與執行都沒有觀測點 |
| 2 | regex locator 兩個方向都錯；且負控制與斷言**共用同一個 locator** | 漏抓 `\cd -P`、`pushd scripts`、以 `#` 開頭的行裡多行字串內的 `cd`（三者經實測皆會執行並跟隨 CDPATH）；誤抓 `printf '%s\n' "please cd later"`、`: # cd scripts` |
| 3 | landmark 本身可以是**資料** | `CDPATH_DOC="\nCDPATH=''\n"` 保留了逐字位元組，每一條文字斷言照樣通過，而那行永不執行 |
| 4 | 「Linux CI 上既沒有這個威脅、也沒有觀測它的方法」是**錯的** | 我只量了 `cd` 解析那一半，見下 |
| 5 | `notEqual` 太弱；decoy 的形狀讓控制組在 bash 3.2 上退化 | 見下〈decoy 的形狀決定哪個 oracle 開火〉 |
| 6 | 無 finding | — |

### 一條線，兩個各自獨立的 oracle

`CDPATH=''` 同時有**解析**效果與**賦值**效果，而它們的可觀測範圍不同。只看前者，就會寫出第 4 輪那句錯話。

| oracle | 觀測什麼 | 在哪些 build 上可見 |
|--------|---------|-------------------|
| 解析 | `cd -P scripts` 是否跟隨呼叫端的 CDPATH | **僅 bash 3.2**——5.3 的 `-p` 對 `cd` 已忽略 CDPATH，那條線還沒讀到就已無效 |
| 賦值 | 被派送的目標**繼承到**的 CDPATH 值 | **兩代皆可見**——`-p` 保留變數的值與其 export 屬性 |

推翻第 4 輪那句話的量測：`-p` 之下 bash 5.3 在賦值前是 `declare -x CDPATH="<decoy>"`、賦值後是 `declare -x CDPATH=""`，子行程於是分別看到 `<decoy>` 與空字串。把 wrapper 的副本接上 bash 5.3 實跑才確認，不是從版本說明推論的。結論相反：**不需要 macOS CI job**，可攜的執行 oracle 在 ubuntu 上就成立。

### decoy 的形狀決定哪個 oracle 開火

decoy 目錄**故意不建 `scripts` 子目錄**。帶了它，bash 3.2 的 mutant 會在解析階段就失敗、根本走不到 dispatch——控制組於是**靜默退化成解析 oracle 的第二份複本**，看起來紅得很合理，卻不是為了它宣稱的理由。拿掉之後 CDPATH 查找落空，兩代 bash 都退回真實的相對目錄，dispatch 必定發生，唯一還在變動的就只剩目標繼承到的那個值。

同一輪還把 `assert.notEqual(mutant.stdout, production.stdout)` 換成釘死 exit status 與逐位元組的 stdout：Codex 示範了一個插在 dispatch 之前的 `exit 17` 就能滿足 `notEqual`——任何無關的失敗都能冒充控制組成功。

### 負控制必須在**關鍵維度**上獨立

第 2 輪的控制組用 `findIndex(isCdCommand)` 產生變異點，而斷言也用同一個 `isCdCommand` 定位。locator 找錯位置時，變異點跟著一起錯，兩邊同時綠——那只驗證了算術，沒有驗證定位。改法是讓插入點取自第一條解析敘述的**字面文字**，不再經過斷言依賴的任何 locator。

### Mutation 結果

> **證據性質**：同 Round 98——以下為本次 session 的實測，harness 寫在暫存目錄，repo 內無留存產物。重跑方式：套用「Mutant」欄的編輯到 `test/scripts/run-skill.test.js` 所測的 wrapper 副本，執行 `node --test test/scripts/run-skill.test.js`，確認具名測試轉紅後還原（還原以 `cmp` 與空的 `git diff --stat` 驗證）。

| Mutant | 結果 |
|--------|------|
| `CDPATH=''` 整行改寫成 `CDPATH_DOC="\nCDPATH=''\n"`（位元組仍在，降格為資料） | KILLED——test 29（解析）與 test 31（執行）**同時**紅，兩個獨立 oracle |
| 上者再疊一個與 CDPATH 無關的 `exit 17` | test 31 仍紅（23 個失敗之中）——狀態碼與精確 stdout 釘死後，無關失敗不再能滿足控制組 |
| 把 `CDPATH=''` 移到第一條解析 `cd` 之下 | KILLED——source-order predicate 轉紅 |
| 基線（未變異） | 35/35 綠 |

Codex 第 6 輪獨立在兩代 bash 上重跑了矩陣：3.2 與 5.3 × production 與 mutant，四格全部 exit 0，目標觀測值分別為空字串與 decoy 絕對路徑，`PLUGIN_ROOT` 四格皆正確——確認 mutant 在兩代都真的走到 dispatch，沒有其他路徑提前短路。它另外驗證了尾斜線與含 symlink 的拼法在 5.3 下逐位元組保留（本測試兩種歧義拼法都沒用到，`root` 先經 `realpathSync()` 正規化）。

### 誠實的邊界

source-order 測試建立的**只有文字順序**：那些字面行出現在 `CDPATH=''` 之後。它不宣稱任何一行會執行——code 與 data 的區分是由上述執行 oracle **行為地、可攜地**判定的，不是靠 regex。這一點寫進註解，因為第 2、3 輪的兩個缺陷正好各對應這條界線的一側。

Gate：Codex round 6 **✅ Ready**（P0/P1/P2 = 0，無 finding）。`/precommit` **✅ PASS** — 3464 tests / 3458 pass / 0 fail / 6 skipped。

---

## 2026-08-20 round 16 — tech spec 切分決議與後續待辦

> 本節 2026-08-21 自 [r2 需求單](./requests/2026-07-31-stacked-pr-mode-r2.md) § 待辦**整段移入**，
> 未改寫。移入理由：它是 round 16 doc review 的產物與設計推理，屬 review log；需求單是工作單元
> （`skills/create-request/SKILL.md` § Write-Time Budget）。

- [x] **切分 `2-tech-spec.md`**：該檔 `wc -l` = 526，超過 `@rules/docs-numbering.md` § Size Limit 的
  500 行，且**不適用記錄豁免**（該豁免逐字列的是 request ticket／review log／ADR；tech spec 是該規則
  自陳的主要對象）。prune 與 merge 已於 round 16 執行完畢，**只剩 split**。切點已定位：§ 3 佔
  419／526 行（80%），§ 3.4 Core Logic 約 274 行是 dominates 的那一節，`###` 為天然邊界。
  目標形狀依 § Size Limit：`2-tech-spec/` 資料夾、主檔維持 canonical 檔名 `2-tech-spec.md`、
  子檔自 1 起編號。**切分同時要修雙向連結**：8 個入向檔案（`requests/*-r1.md`、`*-r2.md`、
  `review-log-rounds-38-61.md`、`smart-commit-hardening/{2-tech-spec,4-implementation}.md`、
  `push-gate-optin/requests/*-r4.md`、`skills/smart-commit/references/git-environment.md`、
  `skills/create-pr/references/stack-mode.md`——最後兩個屬 code 平面），以及主檔內部每一條相對連結。
  完成後跑 § Size Limit 所載的 dead-link 檢查與 `/codex-review-doc`，並以 `wc -l` 重新量測。

  > **完成（2026-08-21）**。切分當下該檔已是 **559** 行（上方記入時為 526，之後 round 16 的更正
  > 又長了 33 行——記入時的數字是當時快照，不改寫）。§ 3.4 Core Logic 實測 **272** 行（佔 49%，
  > 非上方估計的 274／80%——80% 說的是整個 § 3 而非 § 3.4）。產出：
  > `2-tech-spec/2-tech-spec.md`（**294** 行）＋ `2-tech-spec/1-core-logic.md`（**277** 行），
  > 兩者皆落在 § Size Limit 的 ≤ 400「Fine」區間。
  >
  > > **量測 provenance（補記 2026-08-21）**：本段的 **559**、**272**、**294** 三個數字，都是在
  > > **未提交的中間工作樹狀態**下用 `wc -l` 讀到的，git 中**沒有可供後人複核的工件**——
  > > `git log --all -S'559' -- docs/features/create-pr-stacked` 為空，切分後的兩個檔案至今仍是
  > > untracked，而 `git show HEAD:docs/features/create-pr-stacked/2-tech-spec.md | wc -l` 給出的是
  > > 切分**前**的 301 行（那是 `HEAD` 的狀態，不是切分當下的 559）。記錄保留這三個數字是因為它們
  > > 是當時的真實觀測，但讀者無法重跑它們。**今日值請自行推導**：
  > > `wc -l docs/features/create-pr-stacked/2-tech-spec/*.md`——主檔現為 324 行（切分後各輪更正
  > > 又長了 30 行），core 仍為 277 行。**277 是本段唯一今日仍可複核的數字**；另兩個不是。
  > >
  > > **更正（2026-08-21 round 28）**：上一句把 **324** 寫成「今日值請自行推導」的結果，但它同樣是寫下當刻的快照，而且已經過期——`wc -l docs/features/create-pr-stacked/2-tech-spec/*.md` 現回報主檔 **331**、core **277**。本文保留原數字（記錄不改寫），此處只更正其時態：**這一段不該再嵌任何「現為 N 行」**，因為每一輪更正都會推動它。讀者請直接跑上列指令，把回報值當成當下的答案，不要引用本段的任何主檔行數。
  >
  > **入向連結實際為 13 個檔案，不是 8 個**（**計數更正，2026-08-21**：本段前一版寫「10 個」，
  > 該數字與它自己的敘述矛盾——它列了 8 + 2 = 10 之後，又另外點名三個 shell 腳本卻沒有計入。
  > 依 § Size Limit「腳本裡寫死的舊路徑也算」，三者本就該計入）。以 HEAD 為基準重新推導：
  >
  > ```bash
  > git grep -l 'create-pr-stacked/2-tech-spec\.md' HEAD -- docs skills rules scripts test   # 11
  > git grep -l -E '\]\((\.\.?/)+2-tech-spec\.md' HEAD -- docs/features/create-pr-stacked      # 4
  > # 兩集合交集為 r1、r2 兩檔；11 + 4 − 2 = 13（已排除被搬移檔自身）
  > ```
  >
  > **13 個檔案的處置分兩類，不是一律改指**（**主張更正，2026-08-21**：前一版寫「全部已改指新路徑」，
  > 對記錄類檔案而言那會是就地改寫記錄，正是 § Freeze 禁止的）：9 個現行權威／指令面檔案直接改指
  > 新路徑（其中 `git-environment.md`、`smart-commit-hardening/4-implementation.md` 及三支 shell
  > 腳本的 item 級引用，於 2026-08-21 再更正為指向 `1-core-logic.md`——items 不在主檔）；4 個記錄檔
  > （本檔、r1、`review-log-rounds-38-61.md`、`push-gate-optin/…-r4.md`）**保留原路徑原文**，各自
  > 追加日期路徑變更註記。
  >
  > **節號刻意不變**：`1-core-logic.md` 標題仍為 `3.4 Core Logic`，因為上述三支 shell 腳本與
  > `git-environment.md` 以「§3.4 items N」引用其編號條目。

---

## 逐輪 review 記錄（自本單 Progress 移入）

> 2026-08-21 自 [r2 需求單](./requests/2026-07-31-stacked-pr-mode-r2.md) § Progress **整段移入**，
> 未改寫。需求單只保留 Progress 表本身。

**Note — 檔案行數**：`wc -l` 為 SKILL.md 481 行、`references/stack-mode.md` 351 行。**此上限已不再適用**：`@rules/docs-numbering.md` § Size Limit 只管 `docs/features/` 下的散文，功能性文件（`skills/**`、`agents/`、`commands/`、`rules/`、template）整類豁免，該行數測試已於第 54 輪移除。以下是當時在該上限下的歷程，保留為紀錄：SKILL.md 一度到 507 行、被行數上限測試擋下，改以 `@rules/docs-writing.md` 的第一原則（表格取代散文）壓回；第 35 輪修 Step 5 的裸 `gh pr edit` 時，發現該處把 canonical block 整段又抄了一遍，改為參數表指向唯一權威後降到 477，離上限 23 行（第 37 輪補入 residual 契約與絕對直譯器說明後為 481，餘裕 19 行）——Step 7b 的驗證循環與 § Stacked PR Mode 的六段散文改為表格，資訊不減；可執行 fence 全數留在 SKILL.md，因為全域 fence 掃描與 canonical block 測試以它為輸入。

**Note — 第 35 輪：三個環境層 P0（Codex）**

前五輪 review（含兩個本地 strict reviewer）都沒找到這三項，共同形狀是**它們都不是邏輯錯誤**：政策條文正確、控制流正確，失效發生在條文之外的一層。

| # | 缺陷 | 重現 | 修法 | 負控制 |
| - | ---- | ---- | ---- | ------ |
| P0-1 | 兩個執行點皆以裸名呼叫工具；bash 在腳本第一行**之前**就從環境匯入函式，且匯入的函式優先於 PATH **與同名 builtin**（`set`／`unset`／`command` 皆然），故腳本內清除不可行 | `BASH_FUNC_grep%%='() { return 1; }'` → `scan` 對真實 trailer 回 0、hook 放行 | 第一行 `exec /bin/bash -p`（privileged mode 不匯入函式）；判據為 `$-` 含 `p`——參數展開，無法被偽造。`exec` 亦可被遮蔽，故其後以 `${x:?}` 對本行剛清空的變數展開作 fail-closed 中止（展開早於命令查找） | 只拿掉 `exec` → 拒絕執行；連中止一起拿掉 → 缺陷重現（exit 0） |
| P0-2 | `matched_lines \| cut \| sort \| paste` 在 `pipefail` 下回報**最後一個**非零成分，`cut` 回 1 遮蔽掃描的 2，而 1 正是「乾淨」 | 樁住 `cut` 回 1 → 敵意 body 原樣輸出、exit 0，同時記了 `[AI_STRIPPED]` | 掃描狀態先單獨捕獲再轉換；轉換自成 pipeline，任一 utility 失敗即中止 | `cut`／`sort`／`paste` 各一個 exit-1 案例 + `body-inplace` 不得覆寫原檔 |
| P0-3 | guard 把命中的整行寫進 stderr（終端機與 CI log），commit message 可能夾帶貼上的憑證（Anchor Register #2）；同一條政策的另一端早已隱蔽內容 | 合成 marker 出現在 stderr | 只報 `line <n> matched pattern <i>`，格式與 sibling 一致 | 還原成印出 `$MATCH` → marker 重現 |

同輪另修 Codex P1（Step 5 裸 `gh pr edit` 未受保護且不清理 Step 4b 目錄）與 P2（`commit-msg-guard` 的「診斷未被丟棄」測試是空洞的——不製造不可用 pattern、不檢查 stderr，還原 `2>/dev/null` 仍全綠）。P2 改為取真實 grep 對同一 pattern 的錯誤訊息作期望值（BSD 與 GNU 措辭不同，不可寫死），並附還原丟棄的負控制。

**Note — 第 35 輪 delta review（另一位審查者）**：獨立確認前一輪四項修復皆真實生效，並實測 `<PRIOR_STATUS>` 的兩層防護各自擋不同通道（引號擋代換期執行、`case` 擋算術重求值），拿掉任一層在 fence 實際執行的 shell 下都會重開缺口。其 P1（guard 無回歸測試）在該快照後已補；P2（fail-closed 分支未給出路，反射動作會是 `--no-verify`）已修。三個 Nit 逐項處置：SKILL.md 行數已從 497 降到 477（現 481）；`awk`／`sed` 未釘 locale 屬一致性而非缺陷，且不參與判定，記為 `[NIT_DEFERRED]`；零填充 `<PRIOR_STATUS>`（`010` 被讀為八進位）不可達（shell status 不會補零）且清理照常執行，同記 `[NIT_DEFERRED]`。

**Note — 第 36 輪：兩個更上游的 P0（Codex 重審）**

第 35 輪修完三個 P0 後送重審，Codex 找出兩個**位置更前面**的同類缺陷。共同教訓：把防線畫在腳本第一行，仍然晚了一步。

| # | 缺陷 | 重現 | 修法 | 負控制 |
| - | ---- | ---- | ---- | ------ |
| P0-4 | `$BASH_ENV`：非互動 bash 在腳本**第一行之前**載入它，內容 `exit 0` 即讓整個執行以成功結束、一行都沒跑。上一輪的 privileged 區塊在第一行**之後**，救不到 | `BASH_ENV=<(echo 'exit 0') bash <script>` → sanitizer 0、hook 0 | shebang 改為 `#!/bin/bash -p`（`-p` 不處理 `$BASH_ENV`），git 以 shebang 執行 hook 故該路徑關閉；SKILL.md 三道指令模板改為 `bash -p scripts/run-skill.sh …`，skill 路徑關閉 | 把 shebang 的 `-p` 拿掉 → 缺陷重現（exit 0） |
| P0-5 | `run-skill.sh` 以 `exec bash "$TARGET"` 派送；匯入的 `exec` 函式直接回傳成功而不啟動任何東西，目標腳本自身的防護一次都沒跑。上一輪的測試全部直接呼叫目標，看不到 wrapper 這一層 | `BASH_FUNC_exec%%='() { return 0; }'` 經 wrapper → 0；直接呼叫目標 → 1 | wrapper 自己先進 privileged mode，再以 `exec bash -p "$TARGET"` 派送 | 兩種呼叫形式（帶／不帶 `-p`）都斷言非 0 |

**residual 明說**：`bash <script>` 這種略過 shebang 的形式配上敵意 `$BASH_ENV` 仍會失效。這不是可修的洞——那等同於呼叫端根本沒有執行這道檢查，與不呼叫它無從區分；能做的是讓**文件化的每一種呼叫形式**都不長那樣，已照做。

同輪另修：

| findings | 處置 |
| ---- | ---- |
| P1：`--title` 檢查的是 `pr-title.txt`、發布的卻是另一份 inline 字串，兩者無機制綁定（body 因 `--body-file` 指向同一份檔案而無此問題） | SKILL.md 明訂「`--title` 由掃描過的那個檔讀回渲染」，並說明 Step 4b 的「重新產生一次」正是分歧時點；harness 的 `renderLayer()` 改為讀檔渲染——原本取產生端的字串，兩者依構造相等，永遠測不出分歧。另加測試：只改檔案內容，渲染結果必須跟著變 |
| P1：locale 負控制在 CI 必紅——CI 跑 ubuntu-latest，GNU grep 不重現該 bypass，而斷言寫死「拿掉 pin 就會重現」 | 改為先量測前提（實跑本機 grep 看是否回 1），不成立則 `t.skip` 並說明原因。以模擬 GNU 行為的 stub 驗證：兩案 skip 而非 fail |
| P2：guard 未關 xtrace；`bash -px` 下已是 privileged、不會 re-exec，於是 `MATCH=` 的整行被 xtrace 寫進 stderr，繞過刻意的內容隱蔽 | 補 `set +x` / `set +v`，與 sibling 一致；負控制拿掉後 marker 重現 |
| 「hostile title 不觸發 gh」的測試對**順序**而言是空洞的——`fx.calls()` 為空只因為該測試從未執行任何 block | 補正向對照：同一 fixture、同一道 shipped block、乾淨 title，必須錄到一次呼叫 |

**Note — 第 37 輪：兩個又更上游的 P0+ 三個 P1（Codex 重審）**

第 36 輪修完兩個 P0 後再送重審。Codex 找出的仍不是邏輯錯誤，而是**同一條邊界再往前一格**：前兩輪把防線從 utility 推到直譯器、再推到呼叫形式，這一輪指出被繼承的**環境值**與被解析的**檔案位置**都還在防線之外。

| # | 缺陷 | 重現（本機實測） | 修法 | 負控制 |
| - | ---- | ---- | ---- | ------ |
| P0-6 | `GREP_OPTIONS`：BSD grep 至今仍尊重它。privileged mode 擋匯入的**函式**，對繼承的**值**毫無作用 | `GREP_OPTIONS=-x` → hook 對真實 trailer exit 0；sanitizer `scan` 0、`body` 把違規行原樣輸出。`-m0` 對 `scan` 同樣有效 | 兩個執行點釘死 `PATH`／`GREP_OPTIONS`／`IFS`（sanitizer 另含 `umask`） | 拿掉 pin 後在**先量測前提**（本機 grep 是否尊重該變數）成立時斷言缺陷重現；GNU grep 上直接 return，避免在 CI 空跑 |
| P0-7 | 文件化入口寫成裸 `bash -p …`。`bash` 這個字是在**呼叫端 shell** 解析的，發生在 privileged mode 存在之前 | `BASH_FUNC_bash%%='() { return 0; }'` 包住文件所寫的指令 → exit 0，wrapper 與政策腳本一行都沒跑 | 文件、wrapper 內部派送、腳本 usage 一律改寫 `/bin/bash -p` | 同一敵意函式下，裸寫法必須 exit 0、絕對寫法必須回 4 |
| P1-1 | 敵意 `PATH`：所有 utility 以裸名呼叫。換掉 `grep` 回答「沒命中」，換掉抽取用的 `sed` 吐三條永不命中的 pattern——下游每一項計數檢查都滿足 | 植入 `exit 1` 的假 grep → hook 0、`scan` 0 | 同 P0-6 的 PATH pin | 拿掉 pin，同一個植入目錄下缺陷必須重現 |
| P1-2 | wrapper 由未解析的 `BASH_SOURCE` 推導 root。把 wrapper 的 symlink 種進攻擊者的樹，派送到的就是那棵樹裡的「政策」腳本——只需 `exit 0` | planted tree + symlink → 攻擊者副本被選中 | wrapper 先實體解析自身 symlink 鏈（含深度上限）再推導 root | planted tree 必須回 4（真政策執行）；`while false` 掉解析迴圈即變紅 |
| P1-3 | `ALLOW_AI_COAUTHOR=1` 直接 `exit 0`、訊息連讀都沒讀。Anchor Register #4 只給**一行**例外，實作卻放行整份禁止清單，且憑一個任何呼叫端都能設的環境變數 | opt-in 下 `Generated by Claude`／🤖 標記／變體 `Co-Authored-By` 全部通過 | 以 `grep -Fxv` 移除**恰好那一行**（整行相符），其餘仍受完整 pattern 集約束。白名單字串未變，`/smart-commit --ai-co-author` 照常通過——這是執行既有例外，不是新增例外 | 7 種變體在 opt-in 下必須全部 exit 1；把 `-Fx` 改成 `-F` 立刻變紅 |

**同輪自行引入並修掉的迴歸**：`cleanup()` 在無暫存檔時最後一個命令回 1，而 EXIT trap 的結束狀態會**覆蓋**腳本結束碼——乾淨的 commit message 變成 exit 1，等於 hook 否決了它自己核准的每一次 commit。補 `return 0`，並以三種乾淨訊息的迴歸測試釘住（拿掉 `return 0` → 10 個測試變紅）。

同輪另修的 P2：

| findings | 處置 |
| ---- | ---- |
| 「檢查的位元組綁定發布的位元組」是過度宣稱——掃描與發布是兩個行程讀同一個可變路徑，同 user 的任何行程都能在中間替換 | SKILL.md 改寫為可據以行動的契約：**本工作流自身永不發布未經掃描的位元組；它不防禦並行的同 user 寫入者**，並註明 Step 7b 是偵測而非預防。新增一個**明示 TOCTOU 示範測試**把界線釘住，另加測試禁止舊措辭回來 |
| `run-skill.test.js` 的主測試以 `; true` 吞掉結束碼、斷言 `output.length >= 0`——對任何字串（含空字串）都成立，目標沒啟動也會綠 | 整份改寫：確定性 fixture 印出 nonce + 解析後的 root，斷言**精確 stdout 與結束碼**；另補 symlink、敵意 PATH、`-p` 傳遞（以 `$-` 直接觀測）、`.js`／`.sh` 派送。四項守衛逐一 revert 皆變紅 |
| 整合測試以裸 `bash <script>` 直接呼叫目標，而非文件渲染的 wrapper 入口——這正是它看不到 P0-7／P1-2 的原因 | harness 改走 `/bin/bash -p scripts/run-skill.sh …`，並加一個測試比對 harness 與 SKILL.md 實際渲染的指令形狀是否一致 |
| 三處迴圈無條件 spawn `zsh`／`dash`；缺其一時 `status` 為 `null`，測試因環境而非產品而紅 | 全部改走既有的 `availableShells()`（補上 `dash`），並要求 `bash`／`sh` 必須存在——那是真檢查而非可攜性風險 |

**測試機制本身的兩處修正**：PATH pin 讓 9 個既有「壞掉的 utility」測試失去注入通道。**沒有**放寬腳本，而是改在**完整樹的副本**裡把 harness 自有的 stub 目錄接進被釘死的清單前端——仍是固定清單、仍非呼叫端可選。另外兩個既有負控制因我的重構打錯了替換目標而失效（`LC_ALL=C grep` 現在會先命中新加的白名單 grep；policy grep 已改讀 `$SCAN_FILE`），皆補上「突變確實套用」的斷言——未套用的突變看起來和存活的測試一模一樣。

**Note — NFR-1**：`1-requirements.md` 原本把度量寫成「`allowed-tools` 不擴增」，與實作不符——v1 加入了 `Bash(mktemp:*)`／`Bash(rm:*)`／`Bash(bash:*)`／`Write`。這是把手段誤當成目的：真正的約束是 `Bash(git:*)` 不得被用來執行 push/rebase，那由 SKILL.md 契約與測試斷言把關，不是由工具清單長度把關。已改寫該度量而非改實作。

**Note — `git fetch --prune origin` 的定位**：`rules/git-workflow.md` 的 allowed 清單（status/diff/log/branch/rev-parse）未列 fetch，forbidden 清單（add/commit/push/stash/reset --hard/rebase）也未列。Phase A 需要它：分類是本地與 `origin/<head>` 的 OID 比對，沒有 fetch 就是拿過期的 remote-tracking refs 做判定。fetch 只寫 remote-tracking refs、不動工作樹也不改寫歷史，不落在 Anchor Register #4 的破壞性操作範圍。詳見本輪 `[DEVIATION]` 記錄。

**Note — AC 粒度**：排除兩個 quality-gate AC 後有 11 個行為 AC，超過 request template 建議的 ≤8（其中 3 個是把原本綁在一起、可各自獨立證偽的條件拆開計分的結果——寧可條目多，也不要以已達成項掩蓋未達成項）。本票涵蓋 W1+W2+W2a+W4 四個 WBS 單元是成因。**不於實作中途重切**：重切會讓既有 gate 歷史（review round、precommit 記錄）分裂在兩張票之間，代價高於收益；記錄為已知偏離，後續同類功能票依 layer 拆分。

**Note — review 歷史的可追溯性**：本文件引用的 review round 與 thread id（本文件僅在 AC-Q1 引用兩個：round 27 的 code review `019fb9e4` 與 doc review `019fb9e6`）存在於 Codex session，**repository 內無留存產物**。它們用於說明現況演進，**不作為 AC 證據**；可作為證據的只有入庫的測試與可重跑的指令（與上方 mutation 腳本同一原則）。

**Note — Adequacy Gate（advisory mode，`testing-project.md ## Adequacy Mode` 未設定）**

較早一輪 Codex AC trace 判定 **⛔ Inadequate**。多數判據已關閉，此處記錄現況而非沿用舊結論（同上，該 trace 本身無留存產物）：

| 舊判據 | 現況 |
| ---- | ---- |
| shipped-block runtime 測試未執行 | 為唯讀沙箱的 `mkdtemp` 限制；本機確實執行。**注意**：此類失敗不會顯示為 skip，故不可用 `skipped 0` 反駁 |
| 全 suite 未通過 | 本機 3286 tests / 3280 pass / 0 fail / 6 skipped |
| AC2 由文件表格建 classifier 再驗證同一表格，構成循環 | **已解除**——以 plumbing 建真實 git DAG 與真實 `fetch`，逐字執行 shipped fence，期望值獨立寫定，並附負控制 |
| AC5 僅有文字斷言 | **已解除**——sanitization 改為可執行腳本，逐層／敵意標題／Step 7b 首次驗證／Step 7b 重驗四路徑皆實際執行 shipped fence |
| 建議補 Phase A 的 git DAG fixture | 已存在（`buildSyncFixture()`，七種狀態 + bare origin） |

**仍未關閉的缺口分兩類**，先前版本誤稱「全部屬 Manual」：

*Unit 證據缺口*（屬 spec §6 的 Unit 列，非 Manual）——AC3 Phase B 政策與 AC4 依賴標記仍以「政策字串存在」為主要證據，缺 stubbed `gh pr list` fixture；AC2 的 per-mode 處置亦尚未行為驗證。關閉它們會重新開啟 code review gate，故列為下一輪工作而非本輪阻塞項。

*Manual 缺口*（spec §6 本就歸屬 Manual 列，需 `/feature-verify`）——三者授權需求不同：

| Manual 驗證 | 對外副作用 | 是否需使用者授權 |
| ---- | ---- | ---- |
| 三層 dry-run（AC1） | 無——僅輸出指令，不呼叫 `gh pr create` | 否，可逕行執行 |
| 缺 extension 降級（AC7） | 無——僅讀取 `gh extension list` | 否，可逕行執行 |
| 第二層失敗後重入（AC11） | **會建立真實 PR** | **是**，須先取得授權 |
