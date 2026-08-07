# Stacked PR Mode r2 — Review Log

> **Parent request**: [2026-07-31-stacked-pr-mode-r2.md](./requests/2026-07-31-stacked-pr-mode-r2.md)

逐輪 code review／doc review 的事實紀錄。與需求單本體分開，是因為它已成長為獨立主題：需求單描述**要做什麼與是否完成**，本檔描述**每一輪查到什麼、怎麼修、怎麼驗**。兩者讀者與生命週期不同。

- Tech Spec: [2-tech-spec.md](./2-tech-spec.md) §3.3–§3.4、§5、§6
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
