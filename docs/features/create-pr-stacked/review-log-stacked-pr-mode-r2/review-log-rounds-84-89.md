# Stacked PR Mode r2 — Review Log, Rounds 84–89

> 已完結的輪次記錄，內容不再變動。索引與最新一輪在 [review-log-stacked-pr-mode-r2.md](../review-log-stacked-pr-mode-r2.md)。

## 第 84 輪 — 「這件事在單一行程內無法判斷」被推翻了

第 83 輪我寫下：並行行程搶先推進 branch 造成的誤歸屬，**單一行程內無法偵測**，因為兩種情況可用的證據是同一個可達性關係。Codex 直接反駁，並給出證據來源：`GIT_REFLOG_ACTION`。

實測確認它是對的：

```
$ GIT_REFLOG_ACTION='sd0x-marker-XYZ' git commit -qam second
$ git reflog --format='%h | %gs'
a56fb52 | sd0x-marker-XYZ: second      ← 我們做的
45baa55 | commit: third-by-someone-else ← 別人做的
```

我當初的結論之所以錯，是因為我只想到「從歷史結構去推論」，沒想到 **git 自己會記錄是誰在什麼動作下寫的**。可達性是推論，reflog entry 是證據。

### 改成用證據，而不是推論

| 情況 | 舊（可達性） | 新（reflog marker） |
|------|-------------|---------------------|
| `git commit` 做的、有 trailer | 4 | **4** |
| **hook** 做的、有 trailer | 7 | **4**（hook 繼承 marker，因這次 commit 而生的就屬於這次操作）|
| 並行行程推進 branch | **4（錯，指著別人的 commit 叫你 amend）** | **7** |
| fetch 進來的 commit / tag | 7 | **7** |
| reflog 讀不到 | — | **7**（fail-closed）|

兩個既有測試因此**斷言反轉**：被 hook 停放到側邊 ref 的洩漏 commit，以前判 7，現在判 4。這不是為了配合新行為改測試——那個 commit 本來就是 `git commit` 自己做的，hook 只是事後把 branch 挪開，reflog 證明它屬於我們。以前判 7 是可達性推論的**能力不足**，不是事實。負向對照仍然成立：fetch 進來的 commit 在**別的 repository** 建立，本地 reflog 根本沒有它的紀錄，照樣判 7。

### mutation 抓到我自己漏掉的東西

我在註解裡寫「不需要不可預測性，只要唯一性」。把 marker 換成**固定字串**後——**全部測試照樣綠**。

固定 marker 不是無害的：它會讓這支腳本的每一次過去與並行執行都變得無法區分，於是 A 次執行做的 commit 會被 B 次執行認領並回報成 B 的洩漏。**同一個誤歸屬，只是上升了一層。**「只要唯一性」這句話本身就是一個未經量測的宣稱，所以補上專屬對照：兩次執行必須產生不同 marker。

| Mutation | 被殺的測試 |
|----------|-----------|
| ownership 恆為真（≈ 舊的可達性答案）| 並行 commit 誤歸屬 + fetched tag |
| marker 改成固定字串 | **每次執行使用相異 marker**（新增）|
| reflog 比對拿掉前綴判斷 | 並行 commit 誤歸屬 |

### 靜態 oracle 的兩個繞道（Codex P2）

兩個都重現成功，而且都對**真實腳本**有效：

1. `"/bin/true"` — `stripQuoted()` 把整個引號段落抹成 `""`，於是加了引號的絕對路徑照常執行卻完全隱形。**引號是 shell 的分詞保護，不是註解。**
2. `cmd=git; "$cmd" …` — 執行 trace 完全相同、不引入絕對路徑，兩個既有 oracle 都看不見。而「禁用動態派發」那個測試禁的是 `eval`/`source` 等**拼法**，不是這個**性質**。

修法不是再加拼法，而是換掉識別方式：把「先把引號抹掉再切」改成**引號感知的掃描器**。原本一個函式同時要做兩件互斥的事——讓引號內的 `;` 不要切開行、以及讓引號內的字不要被當成指令——抹除法兩件都做到了，代價是連指令位置上的引號也一起抹掉。掃描把兩件事分開：引號內的分隔符是字面文字，引號內的字仍留在原位由**位置**決定是否為指令。另外新增 `dynamicDispatchSites()`，直接斷言性質。

### 新 oracle 第一次跑就吐出六個假陽性

這件事值得記下來，因為**會亂報的識別器最後一定會被關掉**。六個全部來自兩個文法缺口：

| 缺口 | 例子 | 為什麼看起來像指令 |
|------|------|-------------------|
| 反斜線續行 | `for cand in "$root/..." \`<br>`"$root/scripts/..."; do` | 逐行分析時，續行的第二行開頭是運算元 |
| 陣列字面值 | `args=("$head")` | `(` 被當成 subshell 切開 |

再加上 case pattern：`"$0")` 單獨一行，`)` 被當成一般分隔符，於是 `$0` 被報成動態派發。這正是第 82 輪 `case "$p" in /*)` 被誤報成絕對路徑執行檔的**同一個缺口**——當時我改的是**程式碼**去閃避識別器，這次改的是識別器。

修法：續行先合併、`=(` 不切、depth 為 0 的 `)` 視為 case pattern 終止而**丟棄**該段落。五個 mutation 全部被預期的測試殺死。

### 文件更正

- `execute-mode.md` 第 83 輪那段「單一行程內沒有證據」整段重寫，並明確寫出**上一版錯了**與錯在哪。
- `git-environment.md` 的「Scope of the claim」與新清單自相矛盾（Codex P2）：原文說清單「就是重新指向 repository/tree/index 的那些變數」且 `GIT_CONFIG_*` 仍然生效，但前綴現在明確清掉 `GIT_CONFIG*`。改為敘述真正的規則，並實測列出**仍然生效**的通道：

| 通道 | 前綴下 | 實測 |
|------|--------|------|
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | 生效 | `git var GIT_AUTHOR_IDENT` 回傳注入的名字 |
| `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` | 生效 | 在無 local 設定的 repo 回傳注入的 email |
| `GIT_CONFIG*`（local-env-vars 內） | **清除** | 對照組回傳真實值 |

順帶把第 83 輪那句話講精確：問題從來不是「某個變數存在」，而是**診斷與它所描述的 commit 清除的集合不一致**。兩邊都不清，Step 1c 會看到並回報；只有一邊清，計畫與 commit 才會無聲地各說各話。

- `SKILL.md` 的 exit 4 指引原本無條件說「輸出 amend 指引」。但 exit 4 指名的 commit **不一定在 HEAD**（hook 可以把它停放到側邊 ref），對著別的 commit 叫人 amend 是錯的指引。已改為先讀 OID 再決定。

### 證據

全套件 **3448 tests / 3442 pass / 0 fail / 6 skipped**（第 83 輪 3446 / 3440，淨 +2）。`smart-commit-execute.test.js` 73 個。`bash -n` 過，`check-comment-blocks.js` exit 0。所有 mutation 驗完還原並 `diff -q` 逐位元組一致。

## 第 85 輪 — 修 oracle 的過程，比 Codex 指出的洞還多找到三個

第 84 輪 Codex 回 ⛔ Blocked，四項。四項都修完了，但真正的收穫在 P2：**為了補 Codex 指名的三個缺口而重寫識別器時，又量到三個他沒指名、而且更嚴重的假陰性。**

### P1 — amend 指引仍然無條件（`execute-mode.md`）

`SKILL.md` 第 84 輪已改，但 `references/execute-mode.md` § On a leak 還是無條件輸出 `git commit --amend`。

`--amend` 改寫的是 **HEAD**，不是訊息裡指名的那個 commit，而兩者經常不同：`post-commit` hook 把帶 trailer 的 commit 停放到側邊、branch 從乾淨的 parent 重建，executor 指名的是**帶 trailer 的那一個**。在那裡建議 amend 會改寫一個無辜的 commit、把洩漏原封不動留著，而訊息還宣稱處理過了。

改為先比較 `<sha>` 與 `git rev-parse HEAD`：相等才給 amend 指引；不相等則不給，改為輸出 `git branch -a --contains <sha>` 與 `git for-each-ref --contains <sha>`，告訴開發者那個 commit 到底在哪裡。

### P1 — reflog 每個 commit 讀一次

原本 `owns_commit()` 逐 commit 呼叫，N 個新 commit 就是 N 個 `git reflog` 子行程、各自重掃 R 筆紀錄。而這支腳本**刻意支援**的並行 fetch 路徑一次可以引進上千個 commit。

改成 `marked_oids()` 讀一次、在記憶體做集合比對。但 Codex 要的不只是改，是**釘住**：新增 shim 計數 fixture，視窗中插入三個外來 commit（traversal 共四個 OID），斷言 `git reflog` 恰好被呼叫 **1 次**。

這個測試需要一個對照，否則「只讀了一次」對一個**提早中止**的腳本同樣成立——所以其中一個外來 commit 帶 trailer，斷言 stderr 指名它，證明迴圈確實跑完全長。

**而我第一版的對照是假的。** 我把 trailer 放在**最新**的那個外來 commit 上。但 `rev-list` 是新到舊，最新的就是**第一個**被檢查的 OID——「檢查完第一個就中止」的腳本照樣會指名它。實測確認：把「檢查完第一個就 break」的 mutation 打進 executor，舊排法下這個測試**照樣綠**（其他六個測試紅）。

改成把 trailer 放在**最舊**的外來 commit（四個 OID 中的第三個），同一個 mutation 立刻殺掉它。這件事是我在把「對照是否真的承重」寫進給 Codex 的問題清單時，順手驗證自己的答案才發現的——**一個沒被 mutation 驗過的對照，和沒有對照沒有差別。**

### P2 — 靜態 oracle 的剩餘缺口

Codex 指名三種：混合引號單字 `"/usr/bin"/true`、`$"…"` / `$'…'` 引號、指令位置的命令替換 `$(printf git) --version`。三種都先量測確認**目前確實隱形**，才決定怎麼處理。

在真 Bash parser 與「禁用」之間選了後者，理由不是省事：`$(printf git)` 的指令名是**執行期算出來的**，再完整的 parser 也救不回來，所以 parser 方案最後還是得禁它。既然如此，就用這個檔案既有的設計原則——*banned outright, which is a claim a test can hold*。

但寫禁令的過程本身就是教訓：**兩版禁令都因為在「一般程式碼」上誤報而被這個測試擋下來**，不是被 review 擋下來的。

| 禁令初版 | 誤報的對象 | 為什麼它是合法的 |
|----------|-----------|-----------------|
| 全檔禁 `$['"]` | `${REPO_ROOT%$'\n'}` | ANSI-C 引號是**運算元**，用來精準砍掉衍生哨兵的那一個換行 |
| 全檔禁「混合引號單字」 | `SD0X_PRIV_GUARD=''` | 普通的空字串賦值 |

兩者的共同修法是**限縮到指令位置**：運算元是資料，只有指令字必須可被命名。第二項最後連禁令都拿掉了——見下。

### 修 oracle 時量到的三個假陰性（Codex 沒指名）

這三個都在**危險方向**：oracle 回報乾淨，實際照跑。

| 缺口 | 例子 | 原因 |
|------|------|------|
| 雙引號內的命令替換 | `x="$(git status)"` | 掃描器把整段 `"…"` 當文字；但命令替換在雙引號內**是會求值的** |
| 未加引號的 `${…}` | `cmd=git; ${cmd} status` | `{` `}` 在分隔符集合裡，`${cmd}` 被切成 `$`、`cmd`、`status`。**加引號的 `"${cmd}"` 抓得到，不加引號的抓不到** |
| 帶空白的引號賦值 | `X="a b" git log` | 用正規式剝前綴無法知道單字在哪結束：剝掉 `X="a`、剩下 `b" git log`，於是 `b"` 被當成指令，後面的 `git` 隱形 |

第二項最值得記：`dynamicDispatchSites()` 的過濾式 `/^\$\{?[A-Za-z_0-9@*]/` **明確允許 `${`**，寫的時候顯然預期會有 `${cmd}` 這種 token——但掃描器根本產不出來。**一個防護寫了兩層，其中一層從來沒有被觸發過，而測試不會告訴你。**

修法：`${…}` 視為參數展開（追蹤巢狀，整段併入單字）、雙引號內遇到 `$(` 照樣開命令位置（以堆疊保存引號脈絡，`)` 時還原）、單字切分改為引號感知的 `shellWords()`。

### 一個禁令被撤銷 — 因為改成「看得見」比「禁止」好

混合引號單字 `"/usr/bin"/true` 原本要禁。但更好的作法是讓 `unquote()` **像 shell 一樣把各段接起來**：`"/usr/bin"/true` → `/usr/bin/true`，`absoluteExecutables` 直接抓到。禁令因此整條刪除。

能禁的東西不代表該禁——**讓識別器看得懂，優於要求程式碼閃避識別器**。這正是第 82 輪的反面教材（當時我改程式碼去閃避識別器），也是第 84 輪六個假陽性的同一課。

### mutation

| Mutation | 被殺的測試 |
|----------|-----------|
| 拿掉「未加引號換行為分隔符」 | 多行字串**之後**的派發必須看得見 |
| 逐行掃描（不跨行帶引號狀態）| 跨行字串內的 `$mine` 不是指令位置 |
| reflog 改回逐 commit 讀 | 四個 OID 只能有一次 reflog 讀取 |
| `unquote` 改回只剝完整一層 | `"/tmp"/curl` 必須看得見 |
| `${…}` 改回被分隔符切開 | `cmd=git; ${cmd} status` 必須看得見 |
| 雙引號內不開命令位置 | `x="$(git status)"` 必須看得見 |
| 單字切分改回 `/\s+/` | `X="a b" git log` 必須看得見 |
| 純賦值段落仍吐出 RHS | 三個負向對照（賦值不是派發）|
| executor 檢查完第一個 OID 就中止 | reflog 計數 fixture（**修正對照後**才殺得掉，見上）|

九個 mutation，全部只殺掉預期的測試。每次驗完還原並 `diff -q` 逐位元組一致。

### 另外補上一個「只寫在文件裡」的宣稱

上面那張表新增的「reflog 讀不到時，乾淨的 commit 回 0」這一列，寫完當下**沒有任何測試支撐**——就是我這幾輪一直在指責的那一類。補上 `an unreadable reflog costs a clean commit nothing and a leaking one a 7`，用同一個 shim 同時斷言兩個方向：只擋一邊會讓沒有 reflog 的 repo 完全不能用，只放一邊就是這個檢查存在的理由被繞過。

### 文件對齊（P2）

| 位置 | 原本 | 改為 |
|------|------|------|
| `execute-mode.md` status 7 列 | 「視窗中出現但**不可從 HEAD 到達**的 commit」 | 「帶 attribution 且**沒有 reflog entry 繫到這次執行**的 commit」；並補上 graft/shallow/replace |
| 同表 hook 那列 | hook 做的一律判 4 | 只有**經由 `git commit`** 的才判 4；用 `commit-tree`+`update-ref` 或在別的 worktree 提交都**不會**寫這個 HEAD 的 reflog，判 7 |
| 同表 reflog 讀不到 | 一律 7 | 帶 trailer 才 7；**乾淨的 commit 回 0**（reflog 只在要判斷「這是誰的洩漏」時才讀）|
| `SKILL.md` exit 7 | 「其全部意義是無法確立歸屬」 | 7 是唯一的 UNVERIFIED，還涵蓋訊息讀回失敗、ref space 讀取失敗、祖先覆寫存在 |
| executor `verify_created` 註解 | 仍以「從新 HEAD 可達 = 洩漏」描述 | 改以 reflog marker 描述，並寫明舊說法**兩個方向都錯** |

### 證據

全套件 **3449 tests / 3443 pass / 0 fail / 6 skipped**（第 84 輪 3448 / 3442，淨 +1）。`smart-commit-execute.test.js` **75 個**（第 84 輪 73，+2：reflog 計數 fixture 與 reflog 不可讀的雙向斷言；另有多筆 fixture 併入既有測試）。`bash -n` 過，`check-comment-blocks.js` exit 0，本輪改動的檔案連 warning 都沒有。

## 第 86 輪 — 一個 P0 是我自己造的，四個 P2 全部成立

第 85 輪 Codex 回 ⛔ Blocked，五項。**第一項 P0 是我的流程錯誤造成的假警報，其餘四項全部重現成功。**

### P0 不成立 — 但它暴露的是我的問題，不是 Codex 的

Codex 回報 `verify_created()` 有 `[ -n "${SEEN_ONE:-}" ] && break`，只檢查第一個 OID 就中止，而且 `SEEN_ONE` 沒有被清除，外部匯出即可讓整個檢查空轉——一個可觸及的 Anchor Register #4 fail-open。

檔案上沒有這段。`grep` 為空，且與 mutation 前的備份**逐位元組一致**。那是我第七個 mutation 的內容：我把 Codex 派去背景審查，然後在等待期間對**同一份檔案**連續套用九個 mutation。Codex 讀到的是那個瞬間的位元組。

這個誤報**無法從報告本身分辨真假**——行號、機制、危害、Anchor 歸類全部精確。而 Codex 自己給出了最強的訊號：

> the reported zero-failure suite cannot correspond to the exact script currently present

它已經指出「你的測試結果和這份檔案對不起來」。正確的反應是先問**檔案在被讀的當下是什麼樣子**，而不是照著報告改。已記錄為 L6：**mutation 驗證與外部審查互斥**。

### 其餘四項 — 全部先重現再修

四項都用真的 Bash 3.2 驗過，不是照著描述改。

#### P1 — amend 指引的指令沒有 anchor（`execute-mode.md`）

第 85 輪我把 amend 指引改成「先比較 OID 與 HEAD」，方向對，但用的是裸 `git rev-parse HEAD`、`git branch`、`git for-each-ref`——沒有 `git-environment.md` § 2 要求的字面 `env -u …` 前綴與 `-C '<REPO_ROOT>'`。

這不是診斷訊息的裝飾問題：**那個比較「決定」要不要給 amend 指引**。繼承的 `GIT_DIR` 會讓 executor 對 repository A 提交、然後從 repository B 回答「這是 HEAD 嗎」，並對錯的 repository 建議 `--amend`。**做決定的指令，至少要和它所決定的那個指令一樣 repository-safe。** 三條指令全部改為 § 2 形式，前綴由 `git-environment.md` 抽出而非手打。

#### P2 — replace ref 被我寫成 status 7（這個錯是第 85 輪我自己加的）

我在補狀態表時寫了「ancestry overlay (graft / shallow / replace)」。查 executor：`git_verify()` 是 `git --no-replace-objects`，replace ref 是**被中性化**，不是被拒絕。

| overlay | 處理 | 結果 |
|---------|------|------|
| graft / shallow | **拒絕** — 無法驗證就停 | 7 |
| replace | **中性化** — 每次驗證讀取都繞過它 | 一般 repo 照常 0；被遮蔽的洩漏浮出為 **4** |

把 replace 列進 7 是往**錯的方向**描述：宣稱了一個腳本沒有執行的拒絕，而它對這個構造的處理其實比拒絕更好。`execute-mode.md` 與 `SKILL.md` 都已更正。

而「一般 replace ref 回 0」這一半**原本沒有測試**——只有「遮蔽洩漏 → 4」那半有。補上 `an ordinary replace ref is neutralized, not refused`。

#### P2 — `${…}` 掃描不感知引號，而我寫的「退化」說法是錯的

我在註解裡寫：引號內的 `}` 會造成 under-consume，「退化成舊行為而非靜默」。Codex 給出反例 `v=x; X=${v:-"}"} /usr/bin/true`——Bash 3.2 接受（實測 `printf "[%s]" ${v:-"}"}` 印出 `[x]`）。實測識別器對它的輸出：

```
tokens = []   absolute = []   bare = []
```

**不是退化，是全面靜默**——引號內的 `}` 讓大括號計數提早收尾，殘留的 `"` 開啟引號並吞掉整行。這是 bypass 檢查唯一不能有的結果。抽出 `expansionEnd()`，掃描時同時追蹤引號與逸出。

#### P2 — 三個識別器缺口

| 缺口 | 反例 | 後果 |
|------|------|------|
| 禁令只認 segment 開頭與 `then`/`do`/`else` | `if $(printf git) --version; then :; fi` | 漏掉 `if`/`while`/`until`/`!`/`time`/`command`／賦值／前置重導向後的指令位置 |
| `command` 之後的 `--` 未被消耗 | `command -- "$cmd" "$@"` | **dispatcher 自己那一行** |
| `unquote()` 移除雙引號內所有反斜線 | `"g\it"` | Bash 保留它（實測印出 `g\it`），識別器卻**憑空造出**一個 git 呼叫點 |

第二項最嚴重：`smart-commit-dispatch.sh:57` 是全專案唯一真正的動態派發，而測試斷言 `dynamicDispatchSites(src) === []` ——**在這個 oracle 最該約束的那一支腳本上，它一直是空過的**。

修法不是把 `--` 加進禁令，而是修正契約：兩支腳本的契約**本來就不同**。dispatcher 的工作就是執行 allowlist 內的指令，它必然有一個派發點。

```
executor   → 恰好 0 個派發點
dispatcher → 恰好 1 個，且必須是 $cmd
           → 且 [ "$name" = "$cmd" ] 這個精確比對必須still在
```

**指名唯一被允許的那一個，是比「零」更強的宣稱**：出現第二個、或換成別的變數，現在都會紅。

第一項的修法也不是再列前綴：`splitSegments` 改為標記「這個 segment 是被 `$(` 結束的」，於是這個檢查**繼承前綴剝除迴圈已經理解的一切**，而不是把前綴清單再抄一次。負向對照同樣重要——`x=$(git status)`、`arr=($(…))` 的替換是**值**不是指令，沒有這些對照，禁令會在一般程式碼上開火（本輪前兩版禁令就是這樣死的）。

### mutation

| Mutation | 被殺的測試 |
|----------|-----------|
| `expansionEnd` 不追蹤引號 | 引號內的 `}` 不得吞掉後面的指令 |
| `--` 移出前綴字集 | dispatcher 恰好一個派發點 |
| `unquote` 移除所有反斜線 | 一般字元前的反斜線是字面 |
| `endedBySub` 恆為 false | 七個「計算出的指令字必須看得見」 |
| `sub()` 不排除賦值 | 四個負向對照 + 禁令在真實腳本上開火 |

五個 mutation，全部只殺掉預期的斷言。**這一輪的 mutation 全部在沒有審查者讀取樹的期間執行**——這是第 85 輪違反的前提。

### 證據

全套件 **3451 tests / 3445 pass / 0 fail / 6 skipped**（第 85 輪 3450 / 3444，淨 +1）。`smart-commit-execute.test.js` **76 個**（第 85 輪 75，+1 為 replace ref 中性化）。`bash -n` 兩支腳本都過，`check-comment-blocks.js` exit 0。所有 mutation 驗完還原並 `diff -q` 逐位元組一致。

### 本輪的模式

第 84、85、86 三輪，我自己造成的缺陷有一個共同形狀：**寫下一個沒有測試支撐的宣稱，然後它是錯的。**

| 輪 | 宣稱 | 實際 |
|----|------|------|
| 84 | 「只要唯一性，不需要不可預測性」 | 固定 marker 會讓不同次執行互相認領 |
| 85 | 計數 fixture 的對照「證明迴圈跑完全長」 | 對照放在最新的 commit 上，提早中止照樣通過 |
| 85 | 「reflog 讀不到時乾淨 commit 回 0」 | 方向是對的，但**沒有任何測試** |
| 85 | `${…}` 引號問題「退化成舊行為而非靜默」 | 全面靜默 |
| 85 | replace 是 status 7 的成因 | 是被中性化，不是被拒絕 |

散文可以自洽而錯誤，測試不行。**只要一句話描述的是行為，它就該有一個會紅的斷言**——本輪為其中三句補上了。

---

## 第 87 輪 — 靜態辨識器的文法基礎重寫

第 86 輪 Codex 回 ⛔ Blocked，四項 P2。四項在動手前都先對本機 Bash 3.2 重現過，不是照著描述改：

```
=== 1. 跳脫大括號 ===      YES /usr/bin/true 執行了
=== 2. 引號內 cmdsub ===   YES git 執行了
=== 3. 選項前綴 ===        YES command -p 執行了 / YES time -p 執行了
=== 4. prefix 位元組數 ===  474 / 474（一致，但沒有任何測試在守）
```

### 修法

| # | findings | 修法 | 為何不是更小的修法 |
|---|----------|------|-------------------|
| a | `expansionEnd` 不認反斜線跳脫的 `}` | 掃描器加一條反斜線規則 | 與第 85 輪引號版同型；`${v:-\{}` 提早關閉展開，整行後段被吞 |
| b | `sub()` 用「文字後綴是否為 `=`」判斷指令位置 | 拆成 `atCommandPosition()`，從**解析狀態**判斷 | 後綴測試**兩個方向都錯**——`"$(printf git)"` 漏放、`x="$(git status)"` 誤報。同時可繞過又吵，是 oracle 最糟的形狀 |
| c | `command -p` / `time -p` 的選項未剝除 | 抽出共用的 `peelPrefixes()`，剝除選項字 | 兩個 oracle 原本各有一份前綴定義，對「什麼算前綴」意見不一致 |
| d | execute-mode.md 的貼上型復原指令沒有測試守 | 新增 F1f | F1d 掃的是 `GIT_ENV="…"`，這份是字面展開的第二份副本，掃不到 |

### 修 (b) 時自己找到的兩個延伸缺陷

**其一：半計算的指令字。** 我先寫的規則是「接續的部分字必須全是引號字元」。加 fixture 時發現 `'g'"$(printf it)" --version` **會執行 git**（實測），而該規則判它不是指令位置。改成「部分字只要不是賦值或重導向就算指令名的一部分」後兩個方向都對，程式反而更短。

更關鍵的是它原本回報什麼：oracle 會把字面片段 `g` 當成指令名報出去。**報一個假的已解析名字，比什麼都不報更糟**——後者看起來是盲區，前者看起來是結論。

**其二：`exec -a` 帶運算元。** 一律跳過 `-` 開頭的字之後，`exec -a innocuous "$cmd"` 的 `innocuous` 升格成指令名，`$cmd` 依然隱形。這是**繞過穿著 oracle 自己的輸出**當偽裝。四個前綴關鍵字裡只有 `exec -a` 吃運算元，所以特判它。

**其三（順手）：替換結束後的尾段。** `"$(git rev-parse HEAD) suffix"` 的尾段會在新片段裡把結束引號當成起始引號，於是 `suffix` 被報成指令名。修法是還原引號狀態時把該引號字元一併帶入尾段，讓引號成對。

### 結構調整

`splitSegments` 原本用兩個獨立計數器（`depth` + 待加的 `arrayDepth`）追蹤巢狀。改成**單一具型別的堆疊**：陣列字面的 `)` 和子 shell 的 `)` 是同一個字元、相反的意義，兩個計數器無法回答「剛才關掉的是哪一個」。

### mutation

| Mutation | 被殺的斷言 |
|----------|-----------|
| `expansionEnd` 不認反斜線 | 跳脫大括號不得吞掉後面的指令 |
| `atCommandPosition`：任何非空部分字一律否決 | `"$(printf git)" --version` 必須看得見 |
| 移除賦值／重導向部分字的排除 | `x=$(git status)` 不得被誤報 |
| 移除選項剝除 | `command -p "$cmd"` 必須看得見 |
| 剝除選項但不吃 `exec -a` 的運算元 | `exec -a innocuous "$cmd"` 必須看得見 |
| `peelPrefixes(words) === length` 放寬為 `>=` | `>\| $(printf /dev/null) echo hi` 不得被誤報 |
| `inArray()` 恆為 false | `arr=(x $(git status))` 不得被誤報 |
| execute-mode.md 少一個 `-u` | 貼上的 prefix 必須逐位元組一致 |
| 一條復原指令拿掉 `-C` | 每條復原指令都必須釘住 repository |

九個 mutation，全部只殺掉預期的斷言。全部在**沒有審查者讀取樹**的期間執行（第 85 輪違反的前提，見 L6）。

### 本輪的模式

第 86 輪四項 findings 有一個共同形狀，和前三輪的「無測試支撐的宣稱」不同：**辨識器用文字近似取代文法**。後綴是否為 `=`、前綴是否在某張清單上、引號是否成對——每一條都是「大多數情況下對」的近似，而每一條的反例都是合法且會執行的 shell。

把兩個 oracle 共用的前綴定義抽成一個函式，是這輪唯一的結構性收穫：兩份定義各自演化時，不一致不會有任何測試會紅。

---

## 第 88 輪 — 辨識器的「包裝命令」與遞迴掃描

第 87 輪 Codex 回 ⛔ Blocked，四項 P2。四項**全部**是 oracle 缺陷——不是腳本有洞，而是「守著腳本的東西」有洞，每一項都附帶一個能保持全綠的具體不安全變更。動手前逐項對本機 Bash 3.2 實測，並用探針直接量測 oracle 在**真實腳本**上的輸出：

```
executor absolute : ["/usr/bin/env"]          ← 測試名稱叫「bootstrap pair」，只守住一個
nested ${} tokens : ["unset"]                 ← git 完全隱形
exec -ca dispatch : []                        ← 派發點隱形
```

### 四項 findings

| # | 缺陷 | 為何是可達的 |
|---|------|-------------|
| 1 | `${…}` 內的命令替換被整段吞掉 | 實測 `unset x; y=${x:-$(… && echo RAN)}` 印出 RAN；生產變更可藉此塞進未經 `sd_run` 的命令 |
| 2 | `exec -a` 只比對完全相等，不認選項叢集 | 實測 `exec -ca harmless "$evil"` 會執行 `$evil`；dispatcher 加上這種站點後，斷言結果仍是 `['$cmd']` |
| 3 | `absoluteExecutables` 看不到 `env` 的運算元 | 續行會先被合併，所以整段 re-exec 只有一個命令位置（`env`）。**把 `/bin/bash` 換成 `/tmp/curl`，沒有任何 oracle 輸出改變** |
| 4 | F1f 的完整性斷言是循環的 | 它用「已經有 `<PREFIX>`」來挑行，所以永遠挑不到沒有 prefix 的那行 |

第 3 項是本專案第二次出現同一形狀：**oracle 在它存在的理由上空轉**。第 86 輪是 `dynamicDispatchSites` 對 dispatcher 回傳 `[]`；這次是「bootstrap pair」只守住一個成員。共同徵狀是**測試名稱描述的性質比斷言強**。

### 修法

| # | 修法 |
|---|------|
| 1 | `splitSegments(line, valueContext)`：`${…}` 內部若含 `$(` 或反引號則遞迴掃描，並在 `valueContext` 下丟棄深度 0 的片段——展開式本身的文字是**值**，不是指令名 |
| 2 | 檢查整個選項叢集是否含 `a`，含則吃掉運算元 |
| 3 | 新增 `WRAPPER_OPERAND_FLAGS`：`env` 這類**執行其運算元**的外部命令，剝除其選項後繼續往內走，同時報出包裝者與被包裝者 |
| 4 | 改用**位置**挑行（復原 fence 內縮排 ≥5 空格者），與是否已有 prefix 無關 |

### 修 (2) 時發現自己的斷言是錯的

我先加了 `exec -la "$cmd"` 當正向 fixture，理由是「早先實測過會執行」。重測後：**印不出 marker**——`-la` 的 `a` 把 `$cmd` 當成 NAME 吃掉，沒有命令留下，exec 什麼也沒執行。先前那次「實測」是 `( … ) && echo YES`，子 shell 正常退出就印出 YES，**對照本身是假的**。改成 marker 腳本才問得出真話。

該 fixture 已改為負向對照，並寫明理由。

### 修 (3) 時發現自己的 mutation 沒有生效

新加的 artifact mutation 用 `src.replace('/bin/bash -p --', …)`。該字串在**第 7 行的註解**裡也出現，`replace` 只換第一個，於是變更落在註解上、被 `codeLines` 剝掉，測試對著**未變更的腳本**通過。改用 re-exec 自身的運算元當錨點，並先斷言錨點唯一。

這正是 memory 裡那條 mutation harness 紀律：**沒生效的 mutation 和存活的測試長得一模一樣。**

### 順帶修掉的兩個真實漏洞

**反引號沒有被當成成對結構。** 為了讓 `${x:-\`git status\`}`可見而把反引號納入堆疊時，發現雙引號內的反引號**從來沒被辨識過**——`x="\`git rev-parse HEAD\`"` 會執行 git，而所有 oracle 都回報空。原本只有 `$(` 在引號分支裡被特別處理。

**反引號只開不關的 mutation 一度存活。** 這是本輪唯一一個「mutation 沒被殺掉」的訊號，追下去才找到上面那個漏洞。補上的斷言是負向的：`x="\`git rev-parse HEAD\` /tmp/curl"` 裡的 `/tmp/curl` 是字串內容，不是命令——**只開不關會讓後面每個字都變成未引號狀態**，於是把字串內容報成命令。

### mutation

| Mutation | 被殺的斷言 |
|----------|-----------|
| `${…}` 內部不再遞迴掃描 | 展開式內的命令必須可見 |
| `exec` 叢集改回完全相等比對 | `exec -ca harmless "$cmd"` 必須可見 |
| 移除 wrapper 追蹤 | bootstrap pair 兩個成員都要在 |
| 選項剝除不再要求 owner | `-p "$evil"` 不得被誤報 |
| `command -v` 視為會執行運算元 | `command -v "$evil"` 不得被誤報 |
| 反引號分支整段移除 | 展開式內的反引號命令必須可見 |
| 反引號只開不關 | 收尾反引號後的文字仍在字串內 |
| 雙引號內反引號不辨識 | `x="\`git…\`"` 必須可見 |
| execute-mode.md 加一行未加 prefix 的貼上指令 | 每條貼上指令都必須釘住 repository |

九個 mutation，全部只殺掉預期的斷言（其中一個是先存活、追出真實漏洞後才被殺掉的）。

### 本輪的模式

第 87 輪四項的共同形狀是：**測試的名稱比它的斷言強**。「bootstrap pair」只守一個成員、「every paste-ready command」只挑已經合規的行——兩者都不是斷言寫錯，而是**選取集合的方式讓反例落在集合外**。

這比「斷言太弱」更難發現：斷言太弱會在 mutation 下存活，而選取太窄的斷言連 mutation 都造不出來——除非先去量測 oracle 在真實成品上的實際輸出。本輪三次探針量測（`absoluteExecutables(executor)`、`commandTokens('${x:-$(git status)}')`、`dynamicDispatchSites('exec -ca …')`）是唯一問得出這件事的方法。

---

## 第 89 輪 — 從「辨識所有 Bash」改為「只准寫受限子集」

第 88 輪 Codex 回 ⛔ Blocked，五項 P2。**這一輪不是再補一個辨識規則，而是換掉整個策略。**

### 為什麼要換

第 84 到 88 輪，每一輪都關掉一個辨識器的洞，下一輪 Codex 就找到新的：

| 輪 | 新發現的 Bash 形式 |
|----|-------------------|
| 84 | 引號包住的絕對路徑、混合引號的單一字 |
| 85 | 展開式內引號包住的 `}`、計算出的指令字 |
| 86 | 跳脫的 `{`、引號內 `$(`、`command -p` / `time -p` |
| 87 | `${…}` 內的替換、`exec -a` 叢集、`env` 的運算元 |
| 88 | `exec -afoo` 附著式名稱、跳脫巢狀反引號、`env -iu` / `-S`、`command -v$(…)` |

「把 Bash 的每一種寫法都認出來」是**沒有邊界的問題**。而這兩支腳本總共 670 行、完全由我掌控。所以方向反過來：**腳本只准使用受限子集，辨識器只需要對那個子集完備。**

本輪五項全部驗證通過（實測，非引述）：

```
exec -afoo /usr/bin/false          → status=1   （執行了 false，argv[0]=foo）
${x:-`echo \`… && echo INNER\``}   → INNER-RAN
/usr/bin/env -iu PATH printf …     → ENV-IU-RAN
/usr/bin/env -S "printf ENV-S-RAN" → ENV-S-RAN
command -v$(printf "") "$evil"     → 印出路徑，status=0（查詢，未執行）
```

### 新增的禁令（`SUBSET_BANS`）

| 禁令 | 為何禁而不是解析 |
|------|-----------------|
| `exec` 不得帶任何選項 | 名稱可以附著在叢集上（`-afoo`），沒有固定規則讀得對每一種拼法 |
| 反引號一律禁止 | 舊式巢狀靠**反斜線跳脫**，單層配對模型不出來 |
| 選項字內不得有替換 | `command -v$(printf '')` 是查詢，辨識器讀成計算出的指令字——禁掉它，就不必仲裁 |
| `env` 只准唯一一種形式 | 用**正向形式斷言**（`ENV_BOOTSTRAP_FORM`）取代逐一列舉禁止拼法；`-S`、`-iu`、長選項全都不符合 |
| `env` 呼叫次數用**計數**，不去重 | `absoluteExecutables` 用 `Set`，第二個 `/usr/bin/env` 不會改變集合 |

每一條禁令都配一個 artifact mutation 證明它會開火——**沒人踩得到的禁令不是控制措施**。

### 同時也把辨識器改對

禁令是主要控制，但辨識器不該對自己宣稱的能力說謊：

- `exec` 叢集：只有 `a` **結尾**時才吃下一個字（`-afoo` 的名稱是 `foo`，指令已經是下一個字）
- `env` 選項叢集：運算元附著在**最後一個字元**上（`-iu PATH` 吃掉 PATH；`-ui` 的 `i` 是 `u` 的運算元，不吃）

### F1f：改文件，不改選取器

前兩輪的 F1f 各換過一次選取器，各被 Codex 打掉一次：`^ *<PREFIX>` 只挑得到已經合規的行；「fence 內縮排 ≥5」是**呈現細節**，換成未縮排的 fence 或 ` ```bash ` fence 就繞過。

第三次不再猜。改的是**文件結構**：新增 `### Recovery commands` 區塊，契約寫在文件裡——「這個區塊的每一行都是貼上即用的指令，區塊外沒有任何一行是」。測試檢查**該區塊的每一行**（沒有選取步驟可以出錯），外加一條反向斷言：區塊外任何一行都不得以 `git` 開頭。輸出範本改用 `[amend]`、`[where-1]` 標籤引用，並斷言每個被引用的標籤都存在。

### 本輪自己找到的一個弱斷言

驗證 `env` 叢集修正時，mutation **存活**了。追下去發現 fixture 用的是 `absoluteExecutables(line).length > 0`——而 `/usr/bin/env` 本身就滿足它，運算元根本沒被檢查。這是第 87 輪「bootstrap pair」的同一個形狀，只是換了地方：**斷言比它宣稱的性質弱**。改成 `deepEqual` 釘死完整集合後才殺得掉。

同一形狀在兩輪內出現三次，已寫成 **L7**。

### mutation

| Mutation | 結果 |
|----------|------|
| 反引號禁令移除 / `exec -` 禁令移除 / 選項替換禁令移除 | 全部 CAUGHT |
| `env` 改用去重集合 / 形式斷言放寬 | 全部 CAUGHT |
| `exec` 叢集改回成員測試 / `env` flags 改回不支援叢集 | 全部 CAUGHT |
| F1f：未縮排 fence、`bash` fence、區塊內未加 prefix 的行、指令掉 `-C`、範本引用不存在的標籤、prefix 少一個 `-u` | 六項全部 CAUGHT |

十三個 mutation，全部殺掉預期的斷言（其中一個先存活，追出上面那個弱斷言）。

### 順手處理的 Nit

Codex 的 `[NIT_DEFERRED]` 指出 `snapshot_tips` 上方註解仍寫「ownership is decided by REACHABILITY FROM HEAD」，與 reflog-marker 實作矛盾。屬於「已開啟檔案內的一行修正」，依 @rules/auto-loop.md § Sub-Threshold Findings 當場修掉。

---
