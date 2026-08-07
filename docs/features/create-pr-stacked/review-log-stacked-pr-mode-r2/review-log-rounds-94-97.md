# Stacked PR Mode r2 — Review Log, Rounds 94–97

> 已完結的輪次記錄，內容不再變動。索引與最新一輪在 [review-log-stacked-pr-mode-r2.md](../review-log-stacked-pr-mode-r2.md)。

## Round 94 — ⛔ Blocked（4 × P2，仍無 P0/P1）

Thread `019fc207`。Codex 明確肯定 shell script 本身：`sweep_owned` 與文件一致、temp 檔所有權生命週期正確、git 呼叫的順序與引號正確、16 條 pin 合理、dispatcher 內部自洽、`bash -n` 與 `git diff --check` 乾淨。四個 P2 全部落在**檢查證明了什麼**，其中一個同時是產品缺口。

### P2-1：`git_verify` 允許的是指令**家族**，不是唯讀操作

這條最重要，因為它同時打穿產品不變式與它的測試。

Round 93 我在「釘死九個呼叫點」與「runtime 拒絕」之間選了後者，理由是「產品自己執行的性質，強過測試對產品文字的斷言」。**那個推理本身沒錯，但我選的邊界比我拒絕的那個弱**——runtime gate 只看得到 `$1`，而被允許的名字裡有兩個的寫入形式完全活在後面的 operand：

- `git symbolic-ref <name> <ref>` 會**更新** ref，`--delete` 會刪除；
- `git reflog delete|drop|expire` 會改寫 reflog。

兩者都不動 `$1`，所以 runtime 拒絕看不見，測試也看不見。

第二個缺陷在測試本身：`verifyReads` 用 `.match()` 掃**整個檔案**取第一個 `for name in …`。Codex 做出一個 mutant——在函式**上方**放一個帶著預期清單的誘餌迴圈，同時把 `-c` 加進真正的 gate——`verifyReads` 照樣回傳預期的六個，測試全綠。**能被產品從不執行的文字滿足的定位器，量的是 regex，不是拒絕行為。**

修法是兩個控制都要，並且說清楚各自守哪一半：

| 控制 | 守備範圍 | 何時生效 |
|------|----------|----------|
| runtime gate（`for name in …`） | **第一個位置**，任何 argv | 執行期 |
| argv pin（`PINNED_CODE_BEARING`） | **其餘所有 operand** | 對出貨文字 |

作法是把 `git_verify` 加進 `CONTROL_TRANSFER`，於是 **9 個呼叫點 + 1 個定義行**全部連**完整 argv** 被釘住（pin 裡與 `git_verify` 相關的 segment 共 11 條，多出來那條是函式內部的 `sd_run git … "$@"` 轉發行，本來就在 pin 裡）。`verifyReads` 改成先用 `gateBody()` 切出函式本體（定義行到 column-0 `}`）再取清單，並補上誘餌的負向控制——**round 95 證明這個切法仍不夠，見下一節**。

### P2-2：F1f 同時有偽陰性與偽陽性

- fence regex 的 info string 寫成 `[a-z]*`，所以 ```` ```shell-session ```` 整塊被跳過；`~~~bash` 完全沒被找過。
- 禁令抓不到 `$GIT status` / `"$GIT" status`（沒有 `${` 或 `$(`），也抓不到反斜線換行拼接。
- 禁令套在**每個 span 的每個字元**上，所以散文寫「the `${GIT_DIR}` variable」會被誤判。

三者其實是同一個錯誤的兩面：軸選錯了。改成 **invocation vs reference**——單字 span 是引用（`GIT_DIR`、`$GIT_ENV`、`git-environment.md`、`<sha>`），兩字以上才是指令，而且只檢查**指令名**那一個字（operand 本來就該能引號，如 `-C '<REPO_ROOT>'`）。分隔符後的位置也算指令位置。反斜線換行先接起來再讀。

**F1f 從來沒有 mutation control**——這正是 round 87 到 94 連續四個 selector 都能出貨、每個都看不見自己名字承諾要抓的東西的原因。新增 F1k，七個繞過各一個控制，外加三個「文件不是指令」的負向控制。

### P2-3：heredoc delimiter 的引號移除是跨整個 word 的

我 round 93 改成解析四種引號形式，但 bash 是**逐component 去引號後再接起來**：`<<E"OF"`、`<<'E'OF`、`<<\E\O\F` 都以純 `EOF` 行結束。實測（bash 3.2.57）三者都在 `EOF` 後繼續執行下一行，而我的 alternation 分別回報 `E`、`E`、`E`。

**我對 Codex 第四個例子的「訂正」本身是誤讀**（round 95 已更正）：他原本列的是 `<<$'EOF'`，那個確實會執行（實測終止於純 `EOF` 行）。我把它記成 `<<EOF'`，那才是語法錯誤（未閉合單引號）。兩者現在都在控制清單裡，前者因為會執行，後者因為拼法規則按形式拒絕它。

修法同 round 89 的反轉：這些 block 只准一種拼法 `<<'NAME'`（全單引號、大寫），先驗拼法再解析。`<<<` 是 here-string（無終止行）不受管；註解裡的 `<<EOF` 用 `liveCode` 排除，否則規則會讓文件無法討論這個構造。

實作時自己踩到同一類錯：`^<<-?'([A-Z][A-Z0-9_]*)'` 會匹配 `<<'E'OF` 的**前綴**，解析成無害的 `E`，尾巴 `OF` 根本沒被看。加上 lookahead 要求吃掉整個 delimiter word 才修好——**跟上一層是同一個 bug**。

### P2-4：失敗清理沒有行為測試

刪掉 `sweep_owned` 的 `warn` 與 `rc=1`，pin、token 集合、所有 runtime case 全部不變。新增行為測試：PATH 上放一個永遠失敗並記錄 operand 的 `rm`，斷言 commit 仍為 0、檔案還在、stderr 指名確切路徑、EXIT trap **重試**（同一路徑被 rm 呼叫兩次）、且**兩個**不同的殘留檔都被回報（迴圈不會在第一個失敗就停）。

**明確不宣稱**：`rc=1` 沒有外部觀察者（只有 EXIT trap 呼叫它，bash 丟棄其回傳值）。測試註解直接寫明不涵蓋，而不是假裝有涵蓋——M2 mutation 確實存活，與這句話一致。

### mutation

| Mutation | 結果 |
|----------|------|
| M1 `sweep_owned` 拿掉 `warn` | KILLED |
| M2 `sweep_owned` 拿掉 `rc=1` | **SURVIVED（已聲明不涵蓋）** |
| M3 `scrub` 改回吞掉失敗 | KILLED |
| M4 插入一個新的 `git_verify` 呼叫點 | KILLED |
| `symbolic-ref` 改成寫入形式（兩種） | KILLED |
| `reflog delete` / `-c alias` | KILLED |
| 誘餌 `for name in` + 真 gate 加 `-c` | KILLED |
| heredoc 九種拼法 | 全部 KILLED |
| F1f 七種繞過 | 全部 KILLED |
| **負向控制**：here-string、註解裡的 `<<EOF`、散文 `${GIT_DIR}`、`$GIT_ENV`、`-C '<REPO_ROOT>'` | **全部 SURVIVED（正確）** |

全套 3457 tests / 3451 pass / 0 fail / 6 skipped。`bash -n`、`check-comment-blocks.js`、`git diff --check` 皆乾淨。

---

## Round 95 — ⛔ Blocked（4 × P2 + 3 Nit）

Codex 再次確認 shell 實作本身無新缺陷：`git_verify` 的六個子指令對九個呼叫點正確且完整、`verify-last` 的使用者輸入拒絕前導選項、`rev-list` 陣列只由 object ID 加固定 `--not` 組成、`sweep_owned` 契約自洽（他自己在 bash 3.2 驗證失敗的 EXIT trap 同時保留先前的成功與失敗狀態）。**四個 P2 全部是我 round 95 新寫的測試 oracle 本身的弱點或空轉。**

### P2-1：`gateBody()` 不認引號

我用「定義行到 column-0 `}`」切函式本體。但那個切法不是 quote-aware——把預期清單和一個 column-0 `}` 放進函式**開頭的多行單引號賦值**裡，切片就提早結束，讀到的是誘餌，真正迴圈加的 `-c` 完全沒被看見。我實測該 mutant `bash -n` 通過，是合法 bash。

**這是同一個錯誤第三次**：round 94 是「比對文字，而文字可能是永不執行的引號資料」，round 95 的修法**還是**比對文字，只是換了範圍。

改用檔案裡既有的 quote-aware `splitSegments()`：抽出所有 segment，找 `for name in` 開頭者。引號內的誘餌是**一個 word 的資料**，根本無法呈現為 `for` segment。不唯一就回 `null`（大聲失敗，而不是從候選裡默默挑一個）。

**寫控制時自己踩到兩個錯，都是跑 mutation 才發現的：**

1. 我先插誘餌再套 `-c`，而 `String.replace` 取第一個出現位置——結果 `-c` 被套到誘餌上，真迴圈毫髮無傷。
2. 我把誘餌錨在 `ROOT=$(repo_root)`（第 538 行），而 `git_verify` 在第 256 行——所謂「函式上方的誘餌」其實在**下方**。真迴圈因為位置在前而被先找到，唯一性規則根本沒出力：把 `=== 1` 改成 `>= 1`，測試照樣全綠。改錨到 `git_verify() {` 之上後，該 mutation 才被殺掉。

Round 94 的那個控制**從來沒有測到它宣稱的排序性質**。

### P2-2：token 數分類法本身不成立

`$GIT` 一個字就會執行——`GIT='git show HEAD'` 時複製 `$GIT` 就跑那個指令（我實測確認）。`env $GIT show HEAD` 把展開放在第二個位置，first-word 規則沒看。另外四空格縮排 code block 是 CommonMark 的可複製程式碼，兩個 extractor 都不認。偽陽性方面，`$ <PREFIX> git …` 這種 shell-session 提示符會因為開頭 `$` 被拒。

**五個 selector 全部失敗，共同形狀是：每個都試圖「判斷」一個 span 是不是指令。** 所以第六個不判斷——它**列舉**。`PINNED_COPYABLE` 釘死 § On a leak 的完整可複製清單（2 個 fence + 15 個 inline span），新增任何東西都會失敗，直到作者刻意加進去。沒有推論可以出錯，因為沒有推論。`problems` 只留 extractor **完全搆不到**的表面（`~~~` fence、縮排 code block）。

F1k 擴到 11 個繞過控制（含 Codex 新找到的三個）＋ 3 個「文件不是指令」的正向控制。

### P2-3：heredoc oracle 掃的是字元，不是 operator

`liveCode` 只去整行註解，所以 `printf '%s\n' "<<EOF"`、行尾註解、`(( mask = value << 2 ))` 都會被誤判。另外 lookahead 少了重導向：`cat <<'SAFE'>out` 是合法的 canonical heredoc，卻被拒（我實測確認會執行）。

重導向那個是真的誤拒，補上 `<>` 進 lookahead。**其餘三個我選擇不做 lexer，而是把限制講明**：這些 bash block **不得出現 `<<`，除非是 canonical opener**——連字串、算術、行尾註解裡的都不行。Fail-closed、今天零成本（兩個檔案都沒有這種構造），而斷言訊息直接寫出這條政策，不是讓人看到一個莫名其妙的失敗。Codex 明確說這種嚴格度可以是刻意的文件子集，**但必須明說**。

在文件測試裡寫 bash lexer，正是 executor 那些 oracle 需要修十一輪的原因。

### P2-4：清理測試為錯的理由通過

`reported.size === 2` 我當成「迴圈有走完」的證據。但 post-commit 偵測配置第二個 temp 檔，**兩條路徑在 trap 執行前都已經過 `scrub` 並各警告一次**。所以「第一個失敗就 return」的 mutant 仍然給出兩次 message-file 嘗試、兩個相異路徑——全部斷言照過。

改成**按路徑分組**：必須恰好兩條相異路徑，**每條恰好兩次嘗試**。警告也同樣分組比對，並用分隔符取路徑而非 `.split(' ')[0]`（含空白的路徑會被截斷後合併成一條）。M5 mutant 現在被殺。

### Nit（三個都當場修，都是已開啟檔案裡的一兩行）

1. **我對 Codex 第四個 heredoc 例子的「訂正」本身是誤讀**。他原本列的是 `<<$'EOF'`，實測**會**執行；我記成 `<<EOF'`，那個才是語法錯誤。兩者現在都在控制清單，理由分別寫清楚。review log 第 1941 行同一處誤述也已更正。
2. review log 寫「11 個呼叫點 + 1 個定義行」——實際是 **9 個呼叫點 + 1 個定義行**；11 條相關 segment 多出來的是函式內部的 `sd_run git … "$@"` 轉發行。
3. `smart-commit-execute.sh:124` 的註解說「已清掉的檔案在 sweep 時花一次 `rm -f`」——自從成功移除會 disown 之後就不對了，改成「成功清掉的路徑不花 sweep 任何成本，只有失敗的才留著重試」。

### mutation

| Mutation | 結果 |
|----------|------|
| M5 `sweep_owned` 第一個失敗就 return | KILLED（round 95 前存活） |
| M10 `verifyReads` 去掉唯一性（`=== 1` → `>= 1`） | **第一次 SURVIVED**（誘餌錨點錯）→ 修正錨點後 KILLED |
| 引號誘餌（函式內、含 column-0 `}`） | KILLED（`bash -n` 驗證為合法 bash） |
| M12 fence info string 縮回 `[a-z]*` | **SURVIVED — 已被 inventory pin 涵蓋** |
| F1k 11 個繞過（含一字 `$GIT`、`env $GIT`、縮排 block） | 全部 KILLED |
| heredoc 十種拼法（含 `<<$'EOF'`） | 全部 KILLED |
| **正向控制**：`<<'SAFE'>out`、here-string、註解裡的 `<<EOF`、三段散文 | 全部 SURVIVED（正確） |

**M12 存活是誠實的結果，不是漏網**：改成列舉式 pin 之後，任何新增的 fence 都會擾動 inventory 而被抓到，所以 info string 放寬本身不再是單獨承重的控制。它仍然正確（讓抽取忠實），但它的殺傷力被 pin 吸收了。

全套 3457 tests / 3451 pass / 0 fail / 6 skipped。`bash -n`、`check-comment-blocks.js`、`git diff --check` 皆乾淨。

---

## Round 96 — ⛔ Blocked（4 × P2）

產品再次確認無新缺陷。四個 P2 全在 oracle。**這一輪的共同教訓：定位器（locator）本身就是攻擊面。**

### P2-1：`for name in` 綁的是語法，不是那個函式

Codex 的 mutant：在 `git_verify` 前放一個無害的 `for name in <預期清單>; do :; done`，把**真正迴圈的迭代變數從 `name` 改名為 `candidate`**，再對真迴圈加 `-c`。於是「唯一的 `for name in` segment」就是誘餌，`verifyReads()` 回傳預期六個，`bash -n` 通過，argv pin、token 集合、dispatch oracle 全部不變。

**這是同一個錯誤第四次**：

| 定位器 | 被什麼打穿 |
|--------|-----------|
| 全檔 `.match()` | 上方任何位置的誘餌（round 94） |
| 定義行到 column-0 `}` | 引號內含 column-0 `}` 的多行字串（round 95） |
| 唯一的 `for name in` segment | 改名真迭代變數，讓誘餌成為唯一（round 96） |

每次修法都是「把搜尋範圍縮小」，而下一個 mutation 就繞過那個縮小——因為它們都靠**清單長什麼樣**去找它。清單不是該找的東西，**函式才是**。

改成 `PINNED_GATE`：整個 `git_verify` 函式（11 行）逐字釘死。誘餌在上、誘餌在引號內、改名、加 `-c`——全部改變這些 byte。四個 mutation 現在都被殺，外加一個正向控制（改動函式**以外**的地方不得觸發 pin，否則它退化成全檔 checksum）。

代價要講明：以後改 `git_verify` 必須同時改這個常數。對於決定「哪些 git 操作可以執行」的十一行，這是刻意的摩擦。

### P2-2：`codeLines()` 在 quote-aware 掃描**之前**刪註解

它先刪掉所有 `^\s*#` 實體行。但 bash 把多行字串裡的 `# "` 讀成**會關掉引號的內容**；刪掉之後，靜態掃描的引號一路開著跨過真正的程式碼，直到下一個賦值才重新同步——中間所有 command position 同時從所有 segment-based oracle 消失。

**這不是假想**：executor 本來就刻意用多行字串（`out="$out$oid\n"`、以及用 `case "\n$mine\n"` 做精確集合成員判定，第 345、483、486 行）。所以 Codex 說的「可以做成承重的」是對的——載體已經在檔案裡了。

我原本想用「禁止多行字串」的 restricted-subset 解法，**實測後放棄**：那三處是刻意設計且必要的。所以改成 Codex 的另一個選項——把註解移除搬進 quote-aware 掃描裡（`commentOnlyLines()`）。行首 `#` 只有在**不在引號內**時才算註解。

新增控制：把一個 `sd_run bash -c "$UNTRUSTED"` 夾在兩組 `# "` 引號行之間必須被 pin 抓到；而正向控制——真正的註解行仍然要被移除，否則每個註解掉的範例都會開始被讀成呼叫點。

### P2-3：`PINNED_COPYABLE` 對 CommonMark 不完整

列舉只在「兩個 regex extractor + 兩個 problems 檢查」的範圍內精確。Codex 分別注入 **tab 縮排 code block** 與 **raw HTML `<pre><code>`**，兩者都讓 `copyable` 與 pin **逐 byte 相同**、`problems` 空陣列。

列舉式 pin 只和餵給它的表面集合一樣完整——這是我上一輪沒想透的地方。補上五條 form ban（tab、raw HTML code 標籤、多重反引號 code span、四個以上反引號的 fence、未閉合 fence），每條都是**按形式拒絕**而非解析，和 heredoc 那條同一個做法。F1k 加四個對應控制。

**同時修正我上一輪對 M12 的判斷**：我說 info string 放寬「被 pin 涵蓋」。Codex 指出這只在**當前語料**成立（現有兩個 fence 沒有帶連字號的 info string）；把 regex 縮回 `[a-z]*` **並且**加一個 `shell-session` fence，兩者一起做就會讓 inventory 不變。所以那不是 subsumption，是語料巧合。

### P2-4：`bashBlocks()` 只認 `` ```bash `` 這個精確拼法

Codex 把一個手動指令 fence 改成 `` ```bash title=manual `` 並把 delimiter 換成 `<<'EOF'`：不安全的 heredoc 仍然渲染、仍然可複製，但整個 fence 從 `bashBlocks()` 消失，而其他精確 fence 還在，所以 oracle 連「輸入變空」這種明顯失敗都不會有。

改成 `fencedBlocks()`：抽出**每一個** fence，依 CommonMark 的 run-length 規則配對（收尾的反引號數要 ≥ 開頭），再用 info string 的**第一個字**分類。四個反引號的 markdown 範例是一個 block，而它**內部**的三反引號 bash fence 會被遞迴掃描——因為那正是讀者會複製的東西。實測新抽取結果對兩個檔案都是舊結果的超集（實際完全相同），無覆蓋退化。新增 E12。

### mutation

| Mutation | 結果 |
|----------|------|
| 改名真迭代變數 + 誘餌（round 96 的繞過） | KILLED |
| 誘餌在函式上方 / 引號內 / 裸加 `-c` | 全部 KILLED |
| 函式外的無關修改 | **SURVIVED（正確——pin 不是全檔 checksum）** |
| `# "` 引號行夾住真 dispatch | KILLED |
| 真註解行仍被移除 | **SURVIVED（正確）** |
| tab 縮排 / raw HTML / `` ``span`` `` / 四反引號 fence | 全部 KILLED |
| `` ```bash title=manual `` 藏 fixed-EOF heredoc | KILLED |
| 非 bash fence 不被當 bash 掃描 | **SURVIVED（正確）** |

全套 3460 tests / 3454 pass / 0 fail / 6 skipped。`bash -n`、`check-comment-blocks.js`、`git diff --check` 皆乾淨。

---

## Round 97 — Codex ⛔ Blocked（4×P2 + 1 Nit）＋ 收斂性判決

Thread `019fc207-6f2d-7d62-b11b-dd7723fe2537`。四個 P2 全數落在靜態 oracle 完備性，shell 產品行為再次確認無缺陷。

| # | 嚴重度 | 發現 |
|---|--------|------|
| P2-1 | P2 | `PINNED_GATE` 只釘住 `git_verify` 的位元組；在其後定義 `[() { ... }` 遮蔽 `[` builtin，可單獨偽造 `[ -z "$found" ]`，所有既有靜態檢查全部不變 |
| P2-2 | P2 | ANSI-C `$'…'` 中 `\'` 是逸出而非收尾，`commentOnlyLines()` 誤判字串提早結束，把下一行整行當註解刪除 —— **false negative**，可執行程式碼在任何 oracle 看到之前就消失 |
| P2-3 | P2 | `PINNED_COPYABLE` 的來源面不完備：CommonMark code span 可跨行；blockquote 容器內的縮排程式碼區塊，其首字元是 `>`，column-0 檢查看不到 |
| P2-4 | P2 | `fencedBlocks()` 的 run-length 配對只認 column-0 反引號 fence；縮排 0–3 空格的 fence 與 `~~~` fence 都被略過，把 fixed-EOF heredoc 移進去即可讓 E10/E12 收到空字串 |
| Nit | Nit | `commandTokens` 附近註解仍描述已被取代的 per-line 註解剝除實作 |

### Codex 的收斂性判決（本輪主動提問）

> The design is converging locally but not structurally. […] the subset checks reuse the same
> incomplete quote and surface representations, so additional negative regexes continue to expose
> adjacent grammar forms. […] the extractors are now the structurally open part of the proof.

### Cap Diagnostic Protocol — class `ARCHITECTURE`

依 `@rules/auto-loop.md` § Cap Diagnostic Protocol 正式診斷。

- **Signals**：同一缺陷跨 `smart-commit.test.js` 與 `smart-commit-execute.test.js` 重複出現；修 A 立刻暴露相鄰的 B。連續四輪（94–97）每輪關掉具體形式、每輪長出新形式。Codex 的收斂判決是同一診斷。
- **Bounded direction**：停止 patching recognizer，回到設計、re-scope。
- **Anti-loop**：本變更的**第一次**診斷。同一變更再次落入同類 → ⚠️ Need Human，不再診斷。

### Bounded adjustment — **pin the delimiters, not the parse**

宣告於實作之前。Scope：僅上述兩個測試檔，不動任何 shell 邏輯。

四輪下來每一個 bypass 都**必須引入一個分隔符位元組**才成立 —— `` ` ``、`~`、`$'`、`()`、tab、`<pre`。因此不再追求 recognizer 完備，改成把分隔符的**出現本身**釘住。完備性來自語言而非 regex：Bash 函式定義必然含 `()` 或 `function` 關鍵字，ANSI-C 字串必然含 `$'`，沒有第三種拼法。

| 編輯 | 對應 | 內容 |
|------|------|------|
| 1 | P2-1 | `PINNED_DELIMITERS` —— 兩個 script 中含 `()` / `function name {` / `alias x=` / `$'` 的**原始位元組行**逐行釘住（execute 26 行、dispatch 3 行）。遮蔽定義必然新增一行 |
| 2 | P2-2 | 四個共用 quote 邏輯的 scanner（`commentOnlyLines` / `expansionEnd` / `splitSegments` / `unquote` / `shellWords`）統一加入 ANSI-C 狀態：`\` 在 `"` 與 `$'` 中逸出、在 `'` 中不逸出 |
| 3 | P2-4 | `fencedBlocks()` 補齊 CommonMark：0–3 空格縮排 opener、`~~~` delimiter、closer 必須**同字元**且不短於 opener、body 依 opener 縮排量去縮排 |
| 4 | P2-3 | code span 改在「移除 fence 後的文字」上抽取並允許跨行（空行則不算同一 span，換行依 CommonMark 轉空白）；新增 blockquote 容器縮排程式碼的 form ban |
| 5 | Nit | 註解改寫為實際狀態，並列出仍未建模的形式（`$( … )` / `${ … }` 內的巢狀引號範圍） |

### 過程中量測到、且改變了做法的三件事

1. **`$'` 不能禁用，只能建模** —— `smart-commit-dispatch.sh:47` 與 `smart-commit-execute.sh` 的 `repo_root` **都在使用** `${x//$'\n'/ }`。原本打算走「restricted subset：直接禁用」，量測後改為正確建模。
2. **`String.replace` 的替換字串中 `$'` 是特殊樣式**（代表 match 之後的整段字串）。第一版 ANSI-C mutation 因此把整份檔案尾巴接了進去；`assert.notEqual(mutant, src)` 照樣通過，測試看起來像「mutation 存活」。所有 mutation 改用 function replacement，並把斷言強化為「mutant 必須**逐字**含有 payload」。
3. **`notDeepEqual` 作為 mutation 控制太弱** —— 引號狀態失步的 scanner 也會讓輸出改變，斷言便以**錯誤的理由**通過。實測：ANSI-C 修正的兩個 mutant 在 `notDeepEqual` 形式下**雙雙存活**。改為直接斷言 pin 中**含有** `['sd_run','bash','-c','$UNTRUSTED']` 這個 segment 後，兩個 mutant 立即被殺。同一弱點也存在於 round 96 的既有控制，一併修正。

### 兩個「假設」被量測推翻成「已存在的事實」

- `execute-mode.md:452–453` **已經有一個跨行 code span**（`` `git rev-parse\n--git-path` ``）。它落在 `## What this cannot do`，不在 `copyableSurface` 掃描的 § On a leak 內，所以 pin 沒有記錯 —— 但 extractor 的盲點是真的。
- `SKILL.md:432, 446` **已經有兩個 3 空格縮排的 ```bash fence**。舊 `fencedBlocks` 從未掃過它們。新版對 SKILL.md 的 bash 面由 101 行增為 **115 行、零遺失**（execute-mode.md 5 行完全相同），是嚴格超集。

### 新增的防線：E10 的 count pin

`heredocOracle('')` 恆為真，所以**每一次** fence recognizer 的缺口（r96 的精確 info string、r97 的 column-0＋反引號限定）都是以「輸入被縮小」而非「斷言失敗」的形式抵達 oracle。現在 E10 在跑 oracle **之前**先斷言掃描面的行數（execute-mode.md 5、SKILL.md 115）。把 `fencedBlocks` 還原成 column-0/backtick-only 後，E10 與 E12 同時變紅。

### Mutation 結果

| Mutant | 結果 |
|--------|------|
| `[() { … }` / `function [ { … }` / `function [ () { … }` / `alias [=…` 四種遮蔽拼法 | 全部 KILLED（delimiter pin） |
| 新增 `$'…'` 字串 | KILLED |
| 不含分隔符的一般編輯（`readonly SOMETHING=1`） | **SURVIVED（正確）** —— pin 是 inventory，不是整檔 checksum |
| 移除 `commentOnlyLines` 的 ANSI-C opener | KILLED（強化後的控制；`notDeepEqual` 形式下曾存活） |
| 移除 `splitSegments` 的 ANSI-C opener | KILLED（同上） |
| `fencedBlocks` 還原為 column-0＋反引號限定 | KILLED（E10 count pin ＋ E12） |

全套 3461 tests / 3455 pass / 0 fail / 6 skipped。`bash -n`（兩個 script）、`check-comment-blocks.js`、`git diff --check` 皆乾淨。
