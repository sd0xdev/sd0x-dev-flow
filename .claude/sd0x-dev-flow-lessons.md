# sd0x-dev-flow Lessons

Recurring corrections, recorded so the class stops repeating. Format and rules: `@rules/self-improvement.md`.

## Active

### L1 — Re-wrapping a paragraph breaks line-oriented cross-file assertions

- **Context**: `test/skills/scan-error-gate.test.js` asserts that every consumer skill *states* a
  gate, by matching phrases such as `` a non-null `key` is not evidence the sets are complete ``
  against the skill's instruction surface. The check is line-oriented — it reads a document, not a
  reflowed string.
- **Error pattern**: editing the surrounding prose of a `SKILL.md` and re-wrapping the paragraph at
  a different column, so a required phrase ends up split across a newline. The words are all still
  there and the rendered document is identical; the assertion fails. Hit twice: first across four
  `SKILL.md` files at once, then again while rewriting `skills/recap-ask/SKILL.md` step 4b.
- **Correct approach**: when editing a file that a `test/skills/*.test.js` greps for phrases, keep
  the asserted phrase on one physical line and wrap around it. Rewrap the *other* lines instead.
- **Prevention**: the signal is available before the edit —
  `grep -rn "<the file's basename>" test/skills/ test/scripts/` names every test that reads it, and
  the phrase constants are visible in those files. Run it whenever prose in `skills/**`, `rules/**`
  or a shared reference is being reflowed rather than only appended to. The failure mode is
  distinctive on the other side too: an assertion that fails while the change "only reworded
  something" is this, not a broken gate.
- **Source**: 2026-08-11 — r2 doc-review-phasing, `scan_error` consumer-gate assertions.

### L2 — `git checkout <file>` is not an undo for a mutation test

- **Context**: mutation-checking a guard means editing a file, running the suite, and restoring it.
  Every other restore in the session used a `cp` backup taken immediately before the edit; one
  restore reached for `git checkout <file>` instead.
- **Error pattern**: the file carried a whole session's worth of uncommitted work. `git checkout`
  restores it to **HEAD**, not to the pre-mutation state, so it silently discarded the very feature
  being tested — the mutation "passed" because the guard, the gate and the prose were all gone.
  The tell was `# fail 2` where the mutant should have produced `# fail 1`.
- **Correct approach**: `cp <file> /tmp/<name>.bak` before applying the mutant, `cp` back after.
  Never use a VCS command to undo an edit to a file with uncommitted changes.
- **Prevention**: the mutation harness has exactly one restore mechanism and it is the backup copy.
  A restore step that names `git` at all is the signal. Second signal, after the fact: a mutant that
  changes the failure *count* by more than one, or a suite that fails in files the mutant did not
  touch — that is deleted work, not a caught defect.
- **Source**: 2026-08-11 — r2 doc-review-phasing, `skills/recap-ask/SKILL.md` step 4b.

### L3 — 緊接表頭插入 blockquote（或巢狀表格）會終結整張表

- **Context**: doc review 的更正註記往往要「加在某張表附近」。我用 Edit 把 `> **更正…**`
  這類 blockquote 插在表頭或分隔列的正下方，或把一張小表塞進某個儲存格裡。
- **Error pattern**: Markdown 的表格必須是**連續**的列。表頭 / `|---|` 分隔列之後若出現
  blockquote、清單或另一個區塊元素，解析器就在該處收掉表格——後面每一列會被算成普通段落，
  整張表在算繪後消失。同一批 doc review 內**重演三次**：batch 3 § 5 Pattern Map、
  batch 1 FR-4（儲存格內巢狀表格）、batch 1 Risks 表。
- **Correct approach**: 註記只放在**表頭之前**或**最後一列之後**；要放進儲存格的內容一律壓成
  單列行內文字（用 `；` 或 `<br>` 分隔，不要換行、不要 `|`）。
- **Prevention**: 機械訊號——存檔後跑這支 awk，命中即為本缺陷：

  ````bash
  awk 'FNR==1{fence=0;fc="";fl=0;d=0;intab=0;prevt=""}
       { tt=$0; ind=0
         while (ind<3 && substr(tt,1,1)==" ") { tt=substr(tt,2); ind++ }
         c=""; n=0; rest=tt
         if (tt ~ /^`/) c="`"; else if (tt ~ /^~/) c="~"
         if (c != "") { while (substr(rest,1,1)==c) { n++; rest=substr(rest,2) } }
         if (fence) {
           if (c==fc && n>=fl && rest ~ /^[ \t]*$/) { fence=0; fc=""; fl=0 }
           prevt=tt; next }
         if (c != "" && n >= 3) { fence=1; fc=c; fl=n; prevt=tt; next } }
       !intab && tt ~ /^\|[ :|-]*-[ :|-]*\|$/{
         if (prevt !~ /^\|/) printf "%s:%d: 表頭與分隔列之間插入了區塊元素\n", FILENAME, FNR-1
         d=FNR; intab=1; prevt=tt; next }
       { if (d && FNR==d+1 && NF && tt !~ /^\|/) printf "%s:%d: 分隔列正下方是區塊元素\n", FILENAME, FNR
         if (tt !~ /^\|/) intab=0
         prevt=tt }' <file>...
  ````

  設計要點，每一項都是實測逼出來的：**雙向檢查**（只看分隔列下方會漏掉插在表頭與分隔列**之間**
  的那一種）；**不比對區塊字元**（改用「不是 `|` 開頭」的補集，因為清單可以是 `-`／`*`／`+`／
  `1.`，列舉必然漏）；**分隔列樣式須含 `-`**（否則 `| | |` 這種空表頭會被誤判成分隔列，
  `rules/fix-all-issues.md` 即是實例）；**略過 ``` 圍籬**（否則示範用的表格會誤報，
  `docs/features/doc-review-phasing/` 有多處）；**「分隔列」是位置判定，不是樣式判定**（`intab`
  ——見下方更正）。驗證：對四種反例（表頭後 blockquote、分隔列後
  blockquote、`1.` 有序清單、`*` 項目清單）各命中一次，對有效表格 0 命中，全 repo 掃描 0 命中。

  > **更正（2026-08-21，round 20 doc review 指出，接受）**：前一版沒有 `intab`，於是**誤拒合法輸入**。
  > 分隔列樣式 `^\|[ :|-]*-[ :|-]*\|$` 會把資料列 `| - | - |` 一併吃下——而這不是樣式寫壞了：
  > 那一列在 GFM 語法上**確實**是合法的分隔列，區分它們的是**位置**，不是長相。實測輸入
  > `| A | B |` / `|---|---|` / `| - | - |` / `> 段落` 被誤報為「分隔列正下方是區塊元素」，
  > 因為第 3 列重設了 `d`。加上 `intab` 後：進入表格主體之後，凡以 `|` 開頭的列一律是資料列，
  > 不再視為新的分隔列；遇到非 `|` 開頭的列才離開表格。四個反例仍各命中一次，同檔第二張表仍受檢，
  > 全 repo 仍 0 命中。<br>**教訓本身**：一支只驗過「反例會命中」的檢查，等於只驗了一半。
  > 正例必須包含**長得像缺陷的合法輸入**（此處即含 `-` 的資料格），否則護欄上線當天是綠的，
  > 日後才誤報，而那時它讀起來像新缺陷而不是缺失的控制組——與 `rules/testing.md` § Guards 同一條。
  > **更正（2026-08-21，round 21 doc review 指出，接受）**：前一版的圍籬是**單一布林值**，任何以
  > ``` 或 ~~~ 開頭的列都翻轉它。CommonMark 允許以更長的圍籬包住較短的——四個反引號內的
  > ``` 是**內容**，不是圍籬——所以那一行把偵測器翻成「圍籬外」，其後的示範表格被當成正文掃描。
  > 實測：`````markdown` / ` ``` ` / 表格 / `> 引言` / ` ``` ` / `````` 這份輸入誤報一次。改法照
  > CommonMark 的收尾規則：記住**開啟圍籬的字元與長度**，只有同字元、長度不短於它、且該列除空白
  > 外別無他物者才收尾。驗證：四個反例仍各命中一次、含 `-` 的資料列仍 0、同檔第二張表仍受檢、
  > 巢狀那份由 1 降為 0、混合檔（圍籬內示範被略過、圍籬外真缺陷被命中）與 `~~~`、
  > 「巢狀圍籬正確收尾後仍偵測」三份各命中一次，全 repo 仍 0 命中。<br>**教訓本身**：這是
  > L3 第二次因為「把位置/狀態問題當成樣式問題」而誤拒合法輸入——`intab` 那次是分隔列，
  > 這次是圍籬。凡是「這一行算不算 X」的判斷，先問它**由前文的狀態決定**還是**由長相決定**。
  > **更正（2026-08-21，round 22 doc review 指出，接受）**：前一版的表格判定拿**原始 `$0`** 去比
  > `^\|`，等於只認「頂格、且左右都有 `|`」的表格。GFM 兩件事都更寬鬆：縮排最多 3 個空白仍是表格
  > （第 4 個才變成縮排程式碼區塊），而左右兩側的 `|` 是**可省略**的。改法只補前者——另存一份
  > 最多剝 3 個空白的 `tt`（不吃 tab，tab 本身就是程式碼區塊），表格判定與 `prevt` 全部改用 `tt`。
  > 實測：原有十份 fixture 逐份同值、全 repo 仍 0 命中，新增三份——縮排壞表命中 1（原本 0）、
  > 縮排好表 0、四空白縮排 0。**沒補的是省略 `|` 的那一種**，所以下面那句「抓不到的」由一種改成兩種：
  > 補它要另寫一套分隔列文法，代價與收益不成比例，而假裝抓得到比抓不到更糟。
  > **再更正（同日，round 23 doc review 指出，接受）**：上一版只把 3 空白規則套在**表格**判定，
  > **圍籬**判定仍用剝掉無限前導空白的變數——於是四空白開頭的 ``` 被誤認成圍籬開頭，其後真正的
  > 壞表格全被當成圍籬內容而漏檢。實測：`    ``` ` + 壞表格 + 未縮排收尾 → 舊版 0、新版 1；
  > 三空白的合法圍籬仍為 0。改法是把兩者統一：**只剝一次、最多 3 個空白，圍籬與表格共用同一個 `tt`**
  > （順帶少一個變數）。原有十三份 fixture 逐份同值，只有新增的四空白圍籬那份由 0 變 1。
  > <br>**教訓本身**：上一輪的「四空白」負向控制測的是**表格**縮排，不是**圍籬**縮排——同一條規則
  > 有兩個適用點時，只在其中一個加控制組，另一個的漏洞會躲在那份看起來很像的 fixture 後面。

  **這支檢查抓不到的兩種**：（1）儲存格內的巢狀表格——它每行都以 `|` 開頭，與正常資料列無從區分；
  （2）省略左右 `|` 的表格（`A | B` 配 `---|---`）——分隔列不以 `|` 起訖，這支檢查的分隔列樣式看不見它。
  這兩種只能靠上面的 Correct approach 事前避免，不能靠事後偵測。
- **Source**: 2026-08-21 — push-gate-optin / ref-name-hardening doc review，三次重演。

### L4 — 整檔字串取代跑在「同一個 token 有合法用途」的檔案上，是不可逆的

- **Context**: 為了修一個 heredoc 產生的過度轉義（`\\\`` 變成字面上的反斜線＋backtick），我寫了一支
  `unesc.js`，把整個檔案裡的 `\\\`` 一律換成 `\``、`\\${` 一律換成 `${`。
- **Error pattern**: 那兩個 token 在檔案裡**同時有合法用途**——`test/skills/smart-rebase.test.js` 內有一段
  JS template literal 包著多行 shell 腳本，裡面每一個 `\`` 與 `\${` 都是**刻意**轉義的，為的是讓
  backtick 與 `${IFS}`、`${!#}` 這類 shell 展開活到執行期而不是被 JS 先吃掉。取代之後兩個檔案共
  33 處合法序列被毀，而其中一個檔案是 **untracked**，`git` 沒有任何版本可還原。修回去花了六個步驟。
- **Correct approach**: 一個 token 如果在同一檔案裡既是「錯誤」也是「正確」，那這個取代就**沒有反函數**，
  不該用整檔 replace。改用逐處錨定編輯（帶唯一性斷言），或先把檔案複製一份當還原點。
- **Prevention**: 動手前先數：`grep -c '<token>' <file>` 與「我打算修幾處」對不上，就停手。事後的訊號是
  `git diff --stat` 的變動行數大於預期處數——**但 untracked 檔沒有 diff 可看，這正是本次踩中的那一格**，
  所以對 untracked 檔的批次轉換，事前的 `cp` 備份是唯一的還原路徑（@rules/self-improvement.md 的
  `[[feedback_mutation_harness_restore]]` 講的是同一件事的另一半：mutation 也要備份還原，不靠 git）。
- **Source**: 2026-08-21 — push-gate-optin round 38，修 heredoc 過度轉義時毀損兩個測試檔的合法轉義序列

### L5 — 批次轉換「筆數對得上」不等於「轉對了」；要看渲染後的樣本

- **Context**: round 39 用 `tmp/f33.js` 對兩份授權文件（`push-ci`／`epic-merge` 的 SKILL.md）批次加上
  `/usr/bin/env -u …` 前綴。腳本回報的處理筆數與我預期的一致。
- **Error pattern**: 筆數一致，內容卻是錯的，而且錯了三種：
  （1）replacement 吃掉了 `git ` 卻沒放回去，28 行變成不會執行的指令；
  （2）剝除舊賦值的 regex 只匹配空值 `ALLOW_FORCE_WITH_LEASE=`，匹配不到 `=1`，於是把 force 旁路
  **傳播到 27 條非 push 的 git 指令**上——這是 `/push-ci` § Prohibited 明文禁止的事；
  （3）漏掉 5 個 command-substitution 位置（小寫賦值 `range=$(git log`、`$( )` 語境）。
  三種都通過了「筆數對得上」這個檢查，因為筆數只證明 regex 命中了幾行，不證明命中的那幾行變成了什麼。
- **Correct approach**: 轉換完成後，把**渲染後的樣本**印出來讀——每一類語法位置各取一行（行首、
  `VAR=$(`、`$(`、管線後、`&&` 後），不是只讀計數。再加一條**正向閉包斷言**：轉換後不該存在任何
  「未被前綴覆蓋的指令位置」，這條比計數強，因為它斷言的是集合空，不是集合大小。
- **Prevention**: 偵測訊號是「我只看了腳本印出的數字就往下走」。可自動化的版本：批次腳本自己在結尾
  `assert` 一條**否定式全域條件**（例如「沒有任何非 push 的 git 指令帶 `ALLOW_FORCE_` 賦值」），
  失敗就不寫檔。與 [[feedback_mutation_union_sufficiency]] 是同一件事的兩半：那條講「每個分支必要不等於
  聯集充分」，這條講「聯集看起來充分不等於逐處正確」。
- **Source**: 2026-08-21 — push-gate-optin round 39，`/usr/bin/env` 前綴批次轉換三度誤傷

### L6 — JS 替換字串裡的 `$'` 是「比對之後的全文」，不是字面字元

- **Context**: 用 `node -e` 把 `skills/push-ci/SKILL.md` 的一段 bash fence 換成新版。新版含兩處
  shell 參數展開 `${VAR%%$'\n'*}` 與 `${VAR%%$'\t'*}`。
- **Error pattern**: `t.replace(OLD, NEW)` 的第二個參數是**替換字串**，其中 `$'`、`` $` ``、`$&`、
  `$1` 都是特殊語法。`$'` 代表「比對位置之後的整段原文」，於是每出現一次就把文件剩餘部分再貼一遍：
  696 行變 1454 行，`### Phase 2`、`## Arguments`、`## Prohibited`、`## Verification`、`## Examples`
  各自變成三份，而**編輯本身回報成功、沒有任何錯誤**。這與 L4 相鄰但不同：L4 的問題出在來源檔的
  token 有合法用途，這裡的問題出在替換字串有它自己的元字元語言。
- **Correct approach**: 替換內容含 `$` 一律用**函式形式** `t.replace(OLD, () => NEW)` —— 函式回傳值
  不做任何 `$` 展開。`replaceAll` 同理。
- **Prevention**: 對文件做腳本化編輯後，**斷言行數變化等於預期**（新增 N 行就該是 +N），或比對已知
  digest。本次能查出來，是因為「同一個表格出現三次」讓 `Edit` 工具報 `Found 3 matches`；沒有那次
  巧合，1454 行的檔案會直接進入下一輪 review。行數是最便宜的 canary——`$` 展開的爆炸一定看得見。
- **Source**: 2026-08-21 — push-gate-optin round 45，`skills/push-ci/SKILL.md` fence 替換

### L7 — 位置性指示壓在可編輯表格上，是在等下一列出現時才爆的缺陷

- **Context**: 同一個 feature loop 內出現四次：`epic-merge` 的「在第一列與最後一列發問」（表格由 4 列
  拆成 7 列後靜靜漏掉兩列）、`update-docs` 的「literally the first row」、`codex-setup` 的
  「The last row is conditional」、以及 `push-ci` 判定表的計數式守衛。
- **Error pattern**: 指示用**序位**（第一列／最後一列／恰兩列）指認表格中的某一列。表格是可編輯的：
  插入、重排、拆分都不會讓指示報錯，只會讓它**指向別的東西**。計數式守衛是同一個病的變體——
  「恰兩列 `No`」說不出**哪兩列**可以是 `No`，翻轉兩列即可維持計數而語意已經反了。
- **Correct approach**: 以**內容**指認：`Current authority` 那一列、`scripts/pre-push-gate.sh` 那一列、
  「`Ask?` 欄寫 Yes 的每一列」。守衛則對每一列綁定唯一合法判定，並斷言**每列都被恰好一個期望認領**，
  讓沒人想到要比對的新列無法無聲加入。
- **Prevention**: 兩個訊號。(1) 寫指示時，只要句子裡出現「第一／最後／前 N／恰 N 列」而受詞是表格，
  就換成內容指認。(2) 寫守衛時加**正向控制**：把列的順序整個顛倒，測試必須**維持綠燈**——會變紅就
  表示它釘的是位置而不是政策。
- **Source**: 2026-08-21 — push-gate-optin round 44–45；`epic-merge` / `update-docs` / `codex-setup` /
  `push-ci` 四處

### L8 — 從「命令名稱的第一次出現」往回推導字面值，第一次出現往往是散文而不是程式碼

- **Context**: 要把一段 shell 前綴（`/usr/bin/env -u …`）重用到新指令上，腳本寫成：找出
  `git remote get-url --push --all origin` 第一次出現的位置 `i`，再取 `t.lastIndexOf('$(', i)`
  當作前綴起點。
- **Error pattern**: 該字串在文件中**第一次出現的位置是散文**——Push Plan 範本裡的
  `` `<the effective push destination, from `git remote get-url --push --all origin`>` ``。
  往回找 `$(` 於是跨越了一百多行，抓到的「前綴」是整段文件；插入後 `### Phase 1` 與 `## Push Plan`
  各出現兩次，檔案從 728 行變 848 行。防護斷言 `PREFIX.startsWith('/usr/bin/env ')` **通過了**，
  因為往回最近的 `$(` 恰好就在一行 `/usr/bin/env` 指令裡——起點對、終點錯，前綴長 558 → 數千字元。
  與 L6 同科但不同因：L6 錯在替換字串的元字元，這裡錯在**錨點選錯**，而錨點的弱斷言讓它看起來沒事。
- **Correct approach**: 錨點要綁**整行的程式碼形狀**，不是綁命令名稱的出現位置：
  `t.match(/^HEAD_SHA=\$\((\/usr\/bin\/env [^\n]*?)git rev-parse HEAD\)$/m)` —— `^…$` 加 `[^\n]*?`
  在語法上就排除了跨行。
- **Prevention**: 兩道，都便宜。(1) 抽出的字面值**斷言不含換行**，並加一個合理長度上限
  （`PREFIX.length > 900` 即拋）——`startsWith` 只驗開頭，驗不到跨行。(2) 沿用 L6 的行數 canary：
  預期 +14 行卻得到 +120，當場就知道錯了。本次兩道都有，所以在下一次 review 之前就攔下來，
  並用既有 digest pin 逐位元證明還原成功。
- **Source**: 2026-08-21 — push-gate-optin round 46，`skills/push-ci/SKILL.md` Phase 2 目的地重驗


### L9 — unset 一個變數，不等於關掉它控制的行為

- **Context**: pre-push gate 要防止 `merge-base --is-ancestor` 對被竄改的 commit graph 作答。
  round 46 寫成 `unset GIT_GRAFT_FILE GIT_REPLACE_REF_BASE` + `export GIT_NO_REPLACE_OBJECTS=1`。
- **Error pattern**: 把「移除環境變數」當成「關閉該功能」。`GIT_GRAFT_FILE` 被 unset 之後，git
  改讀它的**預設路徑** `$GIT_DIR/info/grafts`——repo 裡的檔案，`env -u` 到不了。unset 等於把
  環境那條管道關掉、同時把 repo 那條打開。同一份記錄上面才剛為 `GIT_NO_REPLACE_OBJECTS`
  記過「unset 會回到 git 預設的『honour replacements』」，隔壁變數立刻重犯。
- **Correct approach**: 先問「這個變數 unset 之後，預設行為是安全的還是危險的那一邊？」危險的
  就必須**賦值**：`export GIT_GRAFT_FILE=/dev/null`、`export GIT_NO_REPLACE_OBJECTS=1`。
  strip list 只對「預設是安全值」的變數有效。
- **Prevention**: 對每個進入安全前綴的變數名，跑一次三態量測——誠實、被污染、套用修補——三個
  出口碼都要看。round 46 只量了誠實與環境污染兩態，缺的正是「套用修補後」那一態，所以修補無效
  看起來和修補有效一模一樣。測試上的具體形式是**以舊修補為負向控制**：把修補換回上一版而不是
  整段刪掉，如果測試仍然綠，那就證明測試從未量到修補本身。
- **Source**: 2026-08-21 — push-gate-optin round 47；`scripts/pre-push-gate.sh` 圖形正規化。


### L10 — 測試替被測物補上缺少的介面，就再也看不見那個介面是缺的

- **Context**: `skills/*/SKILL.md` 的 fenced block 是給 agent 執行的指令面。fence A 量到的值，
  fence B 讀不到——它們是兩個 shell。三個 round-50 的 P2 都是這個形狀。
- **Error pattern**: 測試把 fence 抽出來執行，然後**自己在後面接一行 `printf "$THE_VALUE"`**
  才去斷言。這一接，量測與被量測的東西被關進同一個 shell，於是「值傳不出去」這個缺陷在測試裡
  看起來就像不存在。`runEpicProbe` 與 push-ci 的執行測試各犯一次；兩者都是綠的，兩者都沒看見。
- **Correct approach**: **只執行被測物寫的東西**，斷言它**自己**產生的輸出。如果它什麼都沒產生，
  那就是 finding 本身，而不是需要在測試裡補齊的空白。要補，就補進被測物。
- **Prevention**: 檢查訊號很具體——測試裡出現「fence 內容 + 自己拼上去的一行輸出指令」
  （`[fence, 'printf ...'].join('\n')`、`writeFileSync(f, fence + '\necho $X')`）就是這個形狀。
  問一句：**這一行如果不加，測試還讀得到答案嗎？** 讀不到，就代表被測物少了一個介面。
- **Source**: 2026-08-21 — push-gate-optin round 50；`skills/push-ci/SKILL.md` Phase 0 step 8、
  `skills/epic-merge/SKILL.md` 兩個 topology 分類器。

### L11 — 修掉被點名的那個命令，不等於修掉那一類命令

- **Context**: pre-push gate 的 privileged 再進入。round 50 收到「`exec` 是 builtin，會被匯入的
  函式遮蔽」，於是把 `exec /usr/bin/env …` 改成一般命令。round 51 在**下一行**找到 `exit $?`，
  同一個論證逐字適用；round 52 再確認 `builtin`、`command`、`[` 也全部可被遮蔽，只有保留字
  （`case`）與展開失敗（`${x:?}`）不能。
- **Error pattern**: 把 review finding 當成「這一行有問題」而不是「這個屬性有問題」。修完之後
  在同一段裡留下三個具有相同屬性的命令，於是同一個缺陷可以連續三輪被當成新發現回報。
- **Correct approach**: 收到「X 因為屬性 P 而不安全」時，先**列舉這段程式碼裡所有具有 P 的
  東西**，再決定修法；修法本身若還需要一個具有 P 的命令，那就不是修法。這一次的答案是完全不用
  終止子——把其餘程式碼移進 `case` 的另一個分支，讓 shell 以最後執行命令的狀態自然結束。
- **Prevention**: 偵測訊號——修完之後在改動的那一段跑
  `grep -nE '\b(exec|exit|eval|builtin|command|source|\.|\[|test|set|unset|read|printf|echo)\b'`，
  逐一問「這個字如果被回答成 0，這段會怎樣」。若答案是「就通過了」，那它和剛修掉的是同一筆。
- **Source**: 2026-08-22 — pre-push-gate 遮蔽面 round 50→52；同期另一例是把「函式名不能含斜線」
  讀得比量測更廣（不能匯入 ≠ 不能定義），修法在 shebang 而不在檔案內部。

### L12 — 收回一個論斷時，只改「論斷誕生的那份文件」等於沒收回

- **Context**: push-gate-optin 的 transport 面。round 62 量到「清掉 `GIT_SSH_COMMAND` 這件事本身
  就是一次無聲的目的地變更」，於是把 `4-implementation.md` § 4.16 那句「失去的東西會大聲失去」
  改掉。同一個論斷當時還寫在 `skills/push-ci/SKILL.md`（Phase 2 註解）、`test/skills/push-ci.test.js`
  的兩處逐字 pin，以及 `scripts/pre-push-gate.sh:102` 的「transport 變數只決定怎麼認證，不決定推
  什麼」——round 63 把這四處原封不動地又回報一次。第三次重現（前兩次：round 62 的 E2/E3）。
- **Error pattern**: 收尾用的 `grep` 範圍是「我剛才編輯過的目錄」，而不是「這個論斷可能被寫進去
  的所有目錄」——那次漏掉 `scripts/`。更根本的是把「更正」當成編輯動作而不是**傳播動作**：文件
  被改對了，指令面（skill）與斷言訊息（test）仍然逐字教著已被自己量測推翻的說法。
- **Correct approach**: 更正一個論斷的當下，先用**論斷本身的關鍵詞**（不是檔名、不是路徑）跨
  `docs/ skills/ rules/ scripts/ test/ hooks/` 全域搜，把命中清單列出來一次改完；改不完的要當場
  記成 finding，而不是留給下一輪 reviewer 重新發現。斷言訊息與註解算正文——它們是讀者唯一會讀
  的那一份。
- **Prevention**: 偵測訊號——每次寫下「舊說法錯了／已推翻／不再成立」這類句子時，同一輪必須出現
  一次 `grep -rn '<舊說法的關鍵詞>' docs/ skills/ rules/ scripts/ test/ hooks/`，且輸出要貼進
  review log。沒有這行 grep 的更正，視同尚未更正。
- **Source**: 2026-08-22 — round 62 收回「lost loudly」與 r5 的 transport 前提，round 63 在
  `scripts/pre-push-gate.sh`、`skills/push-ci/SKILL.md`、兩支測試的斷言訊息裡各找回一份。

### L13 — 截斷的輸出和「沒有更多」長得一模一樣

- **Context**: Round 72 自查，掃一句錯誤說法有幾份副本，指令寫成
  `grep -rn "byte-identical" skills/ test/ docs/ | head -20`。
- **Error pattern**: 命中超過 20 行，`head` 切掉尾巴。畫面上沒有任何標記說「還有」，
  於是把截斷讀成「就這些」，記錄裡寫下「三處都改了」——實際五處，活了兩處到下一輪。
  代價不在漏改（review 會抓到），在那句**寫進記錄的完整性宣稱**：它讓下一輪不再去掃。
- **Correct approach**: 稽核用的 `grep` 一律不接 `| head -N`。要控制輸出量就先 `-c` 數，
  或 `-l` 只列檔名，或整份印出來。一份長輸出的成本遠低於一句假的完整性宣稱。
- **Prevention**: 訊號是**指令裡出現 `| head`／`| tail`／`| sed -n '1,Np'`，
  而那條指令的結論被寫成「全部」「都」「沒有其他」**。這兩件事不能同時出現在一輪裡。
  寫下完整性宣稱之前，回頭看產生它的那條指令有沒有 pager。
- **Source**: 2026-08-22 — push-gate-optin round 72→73，跨檔案說法一致性掃描

### L14 — 寫「實測得到 X」時，證據要真的跑過，不能靠推理抄下來

- **Context**: 記錄 macOS `/usr/bin/printf` 在 stdout 關閉時仍 exit 0，抄了一條
  `bash -c 'exec 1>&-; /usr/bin/printf "x\n"; echo $?'` 當「可複現指令」。
- **Error pattern**: 那條指令**印不出任何東西**——fd 1 已經關掉，後面的 `echo` 自己也寫不出去。
  結論是對的（我確實量過），錯的是我事後憑對它行為的推理**重寫**了那條指令。
  而讀者複查的是證據，不是結論：一條證不了自己的指令，比沒有指令更糟，
  因為它讓人以為複查過了。
- **Correct approach**: 貼進記錄的每一條「實測指令」，貼之前原樣再跑一次，把**實際輸出**貼上去。
  診斷輸出要送到不受該實驗影響的通道（此例：`>&2`，因為被關掉的正是 stdout）。
- **Prevention**: 訊號是**記錄裡出現 `$ <指令>` 加一行輸出，而那組字不是從終端複製貼上的**。
  只要是重打的、簡化的、「意思一樣」的，就當成沒跑過——回去跑。
  同族：[[L13]]（截斷讀成沒有）也是「產生結論的那條指令本身壞掉」。
- **Source**: 2026-08-22 — push-gate-optin round 73→74，closed-stdout 量測記錄

### L15 — 可機械檢查的代理，不等於你真正要問的性質

- **Context**: Round 79–81，`skills/codex-setup/SKILL.md` 判斷「這個 Husky hook 有沒有裝上
  sd0x 接線」。三輪連續被推翻，每一輪的修正在下一輪成為新缺陷。
- **Error pattern**: 每次都拿一個**容易機械檢查的代理**去代替真正要問的問題，而且代理選得愈來
  愈精緻，方向卻一直錯在同一件事上：
  - 「有開頭 marker」代理「stanza 完整」→ 被截斷的 stanza 過關（round 79 修）
  - 「marker 成對」代理「這段會跑」→ body 被清空／指向另一個 hook 的 block 過關（round 80 修）
  - 「三個子句都成立」代理「這段會被執行到」→ 前面一行 `exit 0` 就讓整段永遠跑不到（round 81）
  - 「有提到路徑」代理「有接線」→ 一行註解被判成 legacy（round 80 修）
  - 「非註解行提到路徑」代理「有接線」→ `printf '...pre-push-gate.sh' >/dev/null` 被判成 legacy（round 81）
  收斂看起來在發生（每輪都關掉 findings），實際上是同一個缺口換一個位置。
- **Correct approach**: 修一個代理的反例時，先問**這個代理和那個性質的差距在哪裡**，而不是
  「怎麼把這個反例排除掉」。排除反例會生出下一個反例；把問題本身寫出來才會停。以本例而言，
  真正要問的是「git 執行這個 hook 時，控制流會不會到達並執行我們的那段」——那是**可達性**，
  三個靜態子句都答不了，需要一個共用的、有 fixture 的分類器。
- **Prevention**: 訊號是**同一個判定連續兩輪被以「還有一個你沒排除的輸入」推翻**。第二次就
  停手改設計，不要再補第三個子句——第三個子句幾乎必然也有反例，而且會讓文件更長、更難看出
  缺口在哪。另一個訊號：修正的措辭是「⋯⋯，但不包括 X」而不是「⋯⋯若且唯若 Y」。
- **Source**: 2026-08-22 — push-gate-optin round 79/80/81，codex-setup Husky 接線判定

### L16 — L14 的第三次復發：「實測」兩個字要對得上那次實測的**輸入**

- **Context**: Round 81 doc review 在 `skills/push-ci/SKILL.md`、`skills/epic-merge/SKILL.md`
  與 `4-implementation.md` 找到同一句話的三份副本：「帶值的 lease 加上 `--force-if-includes`
  成功，而單獨帶值的 lease 拒絕」。
- **Error pattern**: 這句話有一份「完整可複現」的實測紀錄——但那次實測比較的是**無值 lease +
  `--force-if-includes`** 對上**過期的帶值 lease**，從來沒跑過「帶值 lease + 該旗標」這一格。
  L14 說的是指令要真的跑過；這次指令真的跑過了，錯的是**結論描述的輸入組合和跑過的不是同一組**。
  同一份記錄裡另一處也踩到：宣稱「完整可直接執行」的腳本印出了 `remote after: <sha>`，
  而腳本裡沒有任何一行會讀或印遠端 tip。
- **Correct approach**: 寫下「實測得到 X」之前，把**那次實測的完整指令列**與 X 的主詞逐項對照。
  若 X 是一個比較句（A 成功、B 失敗），實測必須包含 A 與 B 兩格，且兩格只差你宣稱的那個變因。
  輸出區塊只能貼終端真的印出來的東西；額外註記要標成註記。
- **Prevention**: 訊號是**記錄裡出現「X 成功而 Y 失敗」這種比較句，但重現腳本只跑了一格**，
  或**輸出區塊裡有一行，你在腳本裡指不出是哪個指令印的**。後者是機械可查的：逐行問「這行的
  producer 是哪一條指令」。
- **Source**: 2026-08-22 — push-gate-optin round 81 doc review（三份副本 + 一份不自洽的重現腳本）

### L17 — 把文字搬出某個檔案，會靜默地解除所有「綁定該檔案」的守衛

- **Context**: rules-residency 抽取把程序散文從 `rules/auto-loop.md`、`rules/scope-discipline.md` 搬到隨用契約，三個守衛仍指著舊檔案。
- **Error pattern**: 改動測試的檔案 binding（或放著不動）而沒有問「這個守衛原本證明什麼？現在還有什麼在證明它？」。第 4 輪：把 `scope-discipline.test.js` 的斷言改指契約，等於移除 Anchor Register #1/#2/#3 **常駐性**的唯一釘定。第 5 輪：`discretion-tiers.test.js` 的 review-grant 掃描只讀 `rules/auto-loop.md`，因此在搬走的契約裡加一句「模型可略過 review」能通過全部 4192 個測試。同一輪我已在 `auto-loop-behaviour.test.js` 修過這個形狀，卻沒有推廣。
- **Correct approach**: 文字搬移時，列舉覆蓋它的守衛，各自改用明確的 **carrier 清單**（如 `REVIEW_POLICY_CARRIERS`）而非單一路徑，讓守衛隨內容移動。若 `rules/discretion.md` § File Baselines 把某條規則綁定到具名檔案，釘定就必須留在**那個檔案**，不可跟著散文走。
- **Prevention**: 每搬一塊，就把該守衛存在的理由所對應的缺陷**種進新位置**確認轉紅。只在舊位置轉紅的守衛，已經什麼都沒守。
- **Source**: 2026-08-29 — rules-residency r1，code review 第 4、5 輪。

### L18 — 沒有跑到真正程式路徑的反向控制，是「因為錯誤的理由而綠」

- **Context**: 同一變更。`test/rules/contract-routing.test.js` 在五輪審核中每一輪都被點名。
- **Error pattern**: 同一錯誤的四種變體。(1) 控制直接呼叫 helper，而餵給真正檢查的 regex 一個都沒配對到——57 個引用中 0 個。(2)「抽出來」的 scanner 其實是 forward test 迴圈的**複本**，所以弱化真迴圈時控制仍綠。(3) 反向控制斷言在區域 `String#replace` 的結果上，而非測試實際呼叫的函式。(4) 控制挑的 fixture 在突變後**同樣**不會配對，於是兩種情況都成立。
- **Correct approach**: 一份實作，測試與其控制都呼叫它。然後突變**真正的程式碼**——不是它的複本——確認轉紅。單一 fixture 無法辨別時，改為斷言突變會改變的**集合**（候選數量），而非其中一個成員。
- **Prevention**: 宣稱守衛有效前先跑突變測試。`rules/testing.md` § Guards 已經寫了判準——「刪掉守衛；若既有案例全數維持綠，它就沒有反向控制」——這四次都通過了對該句的**解讀**，卻沒通過該句本身。
- **Source**: 2026-08-29 — rules-residency r1，code review 第 1–5 輪。
