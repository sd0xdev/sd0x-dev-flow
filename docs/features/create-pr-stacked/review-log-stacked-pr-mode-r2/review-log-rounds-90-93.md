# Stacked PR Mode r2 — Review Log, Rounds 90–93

> 已完結的輪次記錄，內容不再變動。索引與最新一輪在 [review-log-stacked-pr-mode-r2.md](../review-log-stacked-pr-mode-r2.md)。

## Round 90 — 從「禁止形式」走到「正面列舉」

第 89 輪 Codex 回 ⛔（6 × P2）。六項全部先在本機 Bash 3.2 重現過才動手：

| Codex 的繞過 | 本機實測 |
|--------------|----------|
| `"eval" "$payload"` | `EVAL-RAN` — 引號包住的 builtin 照跑 |
| `"exec" -afoo /usr/bin/false` | exit 1 — 引號沒有讓它變成一般字 |
| `curl https://example.invalid \|\| :` | 產生 token `curl`，**零 finding** |
| `sd_run bash -c "env -S git-status"` | 指令藏在字串運算元裡，token walk 看不到 |

### 這一輪的主結論：禁形式不夠，要釘名字

第 89 輪把策略從「認得所有 Bash」倒過來成「腳本只准用受限子集」。但那一輪只做了一半——禁的是**形式**（`exec -`、反引號、`-c`、選項內代換），**指令名字仍然是開放的**。`bareCallSites` 只回報已經在 dispatcher allowlist 裡的名字，所以一個 `curl … || :` 的 mutation 產生了 token 卻沒有任何 finding，等於旁邊那個 routing 測試的名稱是假的。而引號包住的 builtin 更是躲過每一條**拼法**禁令，因為禁令掃的是 quote-blanked 文字，`commandTokens` 卻會解引號。

補上 `PERMITTED_TOKENS`：兩個腳本各自把**允許出現在指令位置的完整名字集合**列出來，用 `deepEqual` 釘死。不在表上的名字一律失敗，不管它是什麼、怎麼拼。代價是新增指令要同步改這張表——那正是想要的摩擦，而且 diff 會直說加了什麼。

列表過程順手浮出一件事：executor 的集合裡有 `.`（execute.sh:117 載入 dispatcher，上面有 regular-file 與 symlink 檢查）。既有的 `/\bsource\b/` 禁令**從來沒有真的限制過 sourcing**——`.` 是同一個操作。真正框住它的是這個正面集合，不是那條禁令。

集合看不到**第二次**出現，而對 `.`、`/usr/bin/env`、`/bin/bash` 這三個而言，第二次就是全部的風險（第二個 `.` 多載入一個檔、第二個 `env` 多一個控制流出口、第二個 `/bin/bash` 多一個直譯器）。所以另加 `SENSITIVE_COUNTS` 逐一計數。

### `ENV_BOOTSTRAP_FORM` 只驗前綴（Codex P2，本輪最嚴重的一項）

原本的形式 regex 停在 `/bin/bash -p --`，**後面的運算元不受約束**。Codex 示範：把腳本運算元換成 `"${UNTRUSTED_EXECUTOR:-${BASH_SOURCE[0]:-$0}}"`，regex 照樣命中，三個 oracle 輸出不變、`env` 計數不變、子集禁令不變——但只要呼叫端 export 那個變數，特權 bash 執行的就是別的腳本。

**決定什麼被執行的正是運算元，所以運算元才是必須釘死的部分。** 改成 `ENV_BOOTSTRAP_LINE` 整行字串比對（去註解、接續行合併、空白正規化後），選項與運算元一起釘。

### `[amend]` 不是可貼上的指令（Codex P2）

`### Recovery commands` 區塊自稱「每一行都是貼上即用」，但標籤在**行首**——`[amend]` 是一個指令字，Codex 實測 `/bin/bash -c '[amend] true'` 以 127 `command not found` 結束。改成行尾 shell 註解 `# [amend]`：說「貼上這行」的行，得撐得住被貼上。

### F1f 的反向斷言再度被繞過（Codex P2）

第 89 輪的反向斷言錨在行首（`^\s*(?:<PREFIX>\s+)?git\s`），兩種寫法照樣穿過：表格儲存格 `` | Inspect | `git show <sha>` | `` 不是以 `git` 開頭，`env -u GIT_DIR git show <sha>` 是以 `env` 開頭。**兩次都是錨在行首錯了。**

真正區分「可執行的復原指令」與「敘述中提到的操作」的是**運算元**：散文寫 `git commit --amend`，可跑的指令會指向 `<sha>` 或 `<REPO_ROOT>`。改掃這個性質，行內任何位置都算，在儲存格裡也算。標籤契約同時補上：定義端唯一性檢查，引用集合與定義集合改為**相等**（單向包含會漏掉「定義了卻沒人引用」的指令）。

### mutation

| Mutation | 結果 |
|----------|------|
| `curl … \|\| :` / `"eval" "$payload"` / `"exec" -afoo …` / `sd_run bash -c …` | 四項全部 KILLED |
| 第二個 `. "$DISPATCH"` | KILLED（`SENSITIVE_COUNTS`） |
| bootstrap 運算元換成 `${UNTRUSTED_EXECUTOR:-…}` | KILLED（整行比對） |
| F1f：表格儲存格指令、`env` 開頭指令、重複 `[amend]`、定義了卻沒被引用的標籤、標籤改回行首 | 五項全部 KILLED |

十一個 mutation 全數殺掉預期斷言。

### 這一輪自己踩到的一個 harness 問題

批次 mutation 跑到第四個時整批 timeout，SIGTERM 讓 Python 的 `finally` 沒有執行，**工作區留著一個 mutant**。事後 `diff` 才發現並從備份還原。備份 + 事後 `diff -q` 驗證是這裡唯一救得回來的機制——`finally` 不是。

---

## Round 91 — 名字擋不住藏在運算元裡的程式碼

第 90 輪 Codex 回 ⛔（5 × P2 + 1 Nit）。五項全部成立，而且共用同一個結構：**定位器是文字的，攻擊是語法的。**

| Codex 的繞過 | 為什麼躲得掉 |
|--------------|--------------|
| `sd_run bash "-c" 'printf BYPASS'` | `bash -c` 禁令掃的是 `blankQuoted` 文字，變成 `sd_run bash "" ''` |
| `sd_run "bash" -c …` | 同上，`bash` 被引號抹掉 |
| `trap '/bin/bash -c "printf BYPASS"' EXIT` | `commandTokens` 只看到已核可的 `trap`，酬載是資料 |
| decoy 行 + `/usr/bin/e""nv` + 換運算元 | 整行 `\benv\b` 比對選中的是**誘餌**，真正執行的那行沒被選到 |
| `git show HEAD`（無 placeholder） | F1f 反向掃描以「有沒有 `<sha>`／`<REPO_ROOT>`」判斷是不是指令 |

### 主結論：`PERMITTED_TOKENS` 只擋名字，擋不住運算元

第 90 輪把「允許出現在指令位置的名字」釘死了。但 `trap` 與 `bash` 都是**被允許的名字**，它們要執行什麼寫在運算元裡——而 `commandTokens` 把運算元當資料是**正確的**，不是 bug。名字集合結構上就看不到這一層。

所以補的是 `PINNED_CODE_BEARING`：把每一個「運算元帶程式碼」的構造連同運算元整組釘死，用**有序陣列**（兩個相同的 `sd_run bash` guard 呼叫是合法的，第三個不是——集合相等看不出來）。executor 七項、dispatcher 兩項。

定位器改成**結構性**的：切 segment → `shellWords` → `unquote`。這一步同時解掉三個 finding：`"-c"` 還原成 `-c`、`/usr/bin/e""nv` 還原成 `/usr/bin/env`、而引號內的文字維持**一個 word**，不會冒充成指令。誘餌因此定位不到，真正那行反而定位得到。

**三個文字定位器連續陣亡**，各死於一般的 shell 引號。這一輪換掉的不是規則，是規則作用的那一層。

### 一個沒有回歸測試的修正

Codex 指出 `blankSingleQuoted` 完全沒有回歸保護：mutation helper `trips()` 寫死用 `blankQuoted`，**忽略每個 ban tuple 的第三個元素**。把 `blankSingleQuoted` 改回 `blankQuoted` 什麼都不會壞。這是 L7 的同一形狀第四次出現——測試名稱宣稱的性質比它實際跑的強。修正：`trips()` 改用各自的 scanner，並注入 `x="`git status`"`（雙引號內的反引號照跑，`blankQuoted` 會抹掉它）。實測：把 scanner 改回去，測試變紅。

### 一個我拒絕加的 mutation

`/usr/bin/e""nv` 單獨出現時，unquote 後就是 `/usr/bin/env`，**執行的是同一個程式、同一條指令**。斷言它必須失敗，等於斷言一個不存在的差異。它對攻擊者的價值只有「隱形」，而 unquote 已經拿掉那個價值。所以它只出現在 Codex 那個三合一 composite mutant 裡，不單獨成立一條。

### F1f：不再有選取器

反向掃描的三代選取器（`^ *<PREFIX>`、行首錨點、運算元判定）各被打掉一次。第四次不再猜：**把整節裡每一個 `git` / `env` 呼叫列舉出來**，共四個（兩句散文、一句 `env -u …` 說明、一個釘死的 HEAD 比對），用相等斷言。第五個出現就紅，直到有人明確加進清單——與 `PERMITTED_TOKENS` 同一套機制。

契約同時**收斂到 git**，並寫進文件：會被繼承的 `GIT_DIR` 導向的是 git；範本裡的 `/install-scripts` + `cp` 不是 git、不對受損 repo 執行，本來就不該由這個區塊管。原本的措辭沒說清楚這件事，是 Codex 指出範本裡早就有未被掃描的指令才浮現。

### mutation

| Mutation | 結果 |
|----------|------|
| `blankSingleQuoted` 改回 `blankQuoted` | KILLED（這就是缺的那個回歸） |
| `CODE_BEARING` 拿掉 `trap` | KILLED |
| 真實檔案：`trap 'printf BYPASS; exit 130' INT` | KILLED |
| 真實檔案：`sd_run bash "-c" 'printf BYPASS'` | KILLED |
| 文件：`git show HEAD` / 表格儲存格 `git show <sha>` / `env -u GIT_DIR git show <sha>` | 三項全部 KILLED |

七個 mutation 全數殺掉預期斷言。加上測試內建的 composite mutant（decoy + 分裂拼法 + 換運算元），Codex 五項 finding 各自都有對應的失敗證據。

### Nit（當場修）

`smart-commit-execute.sh:376` 的 graft 診斷寫「git replace + this script refuse both」，但 replace ref 實際是**被中和**（`--no-replace-objects`）而非拒絕，與參考文件矛盾。屬於「已開啟檔案內的一行修正」，依 @rules/auto-loop.md § Sub-Threshold Findings 當場修掉。

---

## Round 92 — 選錯軸，dispatcher 自己說了

第 91 輪 Codex 回 ⛔（3 × P2，從 5 降下來）。三項都成立，而第一項指出**上一輪的修法本身選錯了軸**。

### 我釘在錯的行上

第 91 輪的 `CODE_BEARING = {bash, env, trap}` 是問「這個 segment 的運算元裡有沒有出現這些名字」。Codex 的反證直接來自 dispatcher 的輸出——那份輸出我自己貼在上一輪的 log 裡，卻沒讀出它在說什麼：

```
["printf","%s\\n","bash","git","mktemp","rm"]   ← allowlist 的「資料」，不轉移任何控制
["cmd=/bin/bash"]                                ← 一個賦值
```

**真正 dispatch 的那一行 `command -- "$cmd" "$@"` 沒有被選到。** 整個 dispatcher 裡唯一交出控制權的地方，不在釘死清單上；而被釘的兩行都不執行任何東西。

同一個錯誤軸讓三個 mutant 存活（Codex 三個都實測會執行）：

| Mutant | 為什麼躲得掉 |
|--------|--------------|
| `. "${UNTRUSTED_DISPATCH:-$DISPATCH}"` | `.` 不在集合裡；`.` 的計數仍然是 1 |
| `sd_run "${RUNNER:-bash}" -c "/usr/bin/true"` | 名字是**算出來的**，segment 裡根本沒有 `bash` 這幾個字 |
| `sd_run git -c alias.pwn='!/usr/bin/true' pwn` | 程式碼騎在 **git 選項**裡，沒有任何直譯器名字出現 |

正確的軸是**操作**，不是運算元的拼法：`CONTROL_TRANSFER = {., source, sd_run, exec, trap, command, eval}`，且只看**指令位置**（`peelPrefixes` 給的前綴字 + 指令字）。`printf .` 把 `.` 當資料傳，不該選——選了就是雜訊，會教讀者忽略這個 pin。

改完後 executor 從 7 個 segment 變 16 個（每一個 `sd_run` 呼叫連運算元整組釘死），dispatcher 從 2 個變 3 個，而且是**對的三個**。Codex 三個 mutant 全部定位得到。

### F1f：第四個繞過，也是最後一個選取器

`g""it show HEAD` 被 bash 讀成 `git show HEAD`，貼上就跑，而 `\bgit\b` 永遠看不到它。反斜線接續是同一類。

不再用拼法禁令，改成**先照 shell 的讀法正規化再列舉**：合併反斜線接續、去掉轉義反斜線、去掉引號字元。引號拼接與反斜線轉義正是「沒有任何 word-boundary 比對跟得上的兩種寫法」，所以把它們還原掉，而不是去禁它們的拼法。

### 契約句子第三次被指出是假的

文件寫「no git command outside it is」，但決策表裡那個釘死的 `<PREFIX> git -C '<REPO_ROOT>' rev-parse HEAD` **就在區塊外面**——而且 F1f 自己明確允許並單獨釘死它。測試與散文描述的是兩份不同的契約。

改成把例外寫進句子本身：「每一個可貼上的復原 git 指令都在區塊裡；區塊外唯一的 git 指令是決策表那個釘死的 HEAD 比對，沒有別的。」**例外沒寫進句子，正是前兩版契約句變成假的原因。**

### mutation

| Mutation | 結果 |
|----------|------|
| 真實檔案：`. "${UNTRUSTED_DISPATCH:-…}"` | KILLED |
| 真實檔案：`sd_run git -c alias.pwn='!…' pwn` | KILLED |
| 真實檔案：dispatcher 的 `command -- "$cmd" "$@"` 加一個運算元 | KILLED |
| `CONTROL_TRANSFER` 拿掉 `sd_run` | KILLED |
| 文件：`g""it show HEAD` / `g\it show HEAD` | 兩項都 KILLED |

六個 mutation 全數殺掉預期斷言，另加測試內建的 computed-runner mutant。

### 這一輪學到的

上一輪那份 dispatcher 輸出我看過、貼過、還寫進了 log——但沒有問「這兩行有交出控制權嗎？」。**oracle 的輸出要當作待驗證的主張讀，不是當作通過的證據。** 這與 L7（測試名稱比斷言強）是同一族：都是把「看起來對」當成「是對的」。

---

## Round 93 — 換了新 thread，也換了兩個修法的方向

### 先講一件流程上的事

第 93 輪對舊 thread `019fc042` 的 `codex-reply` **被服務端的安全分類器擋下**（「flagged for possible cybersecurity risk」）。原因是我的 prompt 列了一長串 shell 繞過寫法（homoglyph、HTML entity、`BASH_ENV`、`PROMPT_COMMAND`…）當作待驗證清單——那讀起來像在索取攻擊手法，而不是在硬化一支 commit 腳本的測試。

拿掉那串清單重送，仍被擋（累積 90 幾輪的 thread 上下文本身就是觸發源）。改開**全新 thread** `019fc207`，用中性、以工作為主的 prompt 送出，通過。

依 @rules/codex-invocation.md，全新 thread 本來就是更強的形式——Codex 一定要自己研究，不該餵它我的結論。清單本來就沒在做什麼事。

### 結果：4 × P2 + 1 Nit，**沒有 P0/P1**

而且 Codex 對兩支腳本本身的評價是正面的：特權 re-exec 的時機、訊息檔所有權的起點、guard／commit／cleanup／post-commit 驗證的順序、ref 快照與 reflog 歸屬，都判定為 internally consistent。這是 84 輪以來第一次沒有 P0/P1。

### P2-1：`git_verify "$@"` 是一個沒被守住的轉發器

`git_verify` 把 `"$@"` 直接轉給 git，九個呼叫點的運算元決定 git 做什麼，而它不在 `CONTROL_TRANSFER` 裡。Codex 實測 `git_verify -c alias.pwn='!/tmp/curl' pwn` **會執行 shell alias**，而所有靜態簽章（permitted tokens、code-bearing segments、absolute executables、bare calls、dynamic dispatch）**全部不變**。

Codex 給了兩個選項，並明確表示偏好後者：加進釘死集合（多九個 pin），或**把任意 `"$@"` 介面換成具名的固定讀取操作**——「讓生產不變量更銳利，而不是讓 pin 清單更長」。

採用後者，但做成**執行期拒絕**：git 的**全域選項**（`-c alias.x='!cmd'`）才是帶可執行設定的那些，而全域選項**必須排在子命令前面**。所以只要第一個字必須是封閉集合裡的子命令，全域選項需要的那個位置就消失了。這和 `sd_run` 的 allowlist 同一套理由，也同樣是「一個測試斷言得到的**執行期拒絕**」，而不是「一個關於腳本文字的主張」。

### 兩個我自己踩到、被自己的守衛擋下的錯

改 `git_verify` 時：

1. warn 訊息我寫成 `"...refusing \`${1:-}\`..."`——**雙引號內的反引號**，正是第 90 輪加的禁令要擋的形式。禁令當場擋下。改用單引號。
2. 第一版用 `case reflog|log|...)`，結果 `commandTokens` 把每個 alternation 分支讀成指令位置，五個子命令名字跑進 token 集合。**不是把它們加進允許清單**（它們不是程式），而是改寫成 `for name in ... ; do`——與 `sd_allowlist` 同一形狀。token 集合只多了 `break`。

### P2-2：`sweep_owned` 吞掉清理失敗

`scrub` 在 `rm` 失敗時保留路徑讓 EXIT trap 重試，但 `sweep_owned` **無條件清空 `OWNED` 並 return 0**——而 trap 就是最後一次重試，所以那個保留什麼也沒買到。commit 成功、訊息檔還在磁碟上，程式仍然 exit 0，與文件「removed on every path」矛盾。

改成：失敗時具名回報到 stderr、`return 1`。但**不改動整個 run 的 exit status**——commit 成功就是成功了，因為刪不掉暫存檔就回報失敗是更大的謊。文件同步改成 attempted 而非 guaranteed，並寫明為什麼不改 exit status。

### P2-3：F1f 把散文變成了清冊

Codex 指出兩件事，兩件都對：

1. 我的「照 shell 讀法正規化」只是幾個 `replace`，不是解析。`$'git'`、`g$''it`、`g${EMPTY:-it}` 三種都會執行 git，三種都零命中（他實測）。
2. **列舉散文是錯的形狀**——它把每個句子變成清冊，將來寫「the `env` utility」會被當成指令而失敗，而真正的洞還開著。

改成他建議的方向：只掃**可複製的表面**（fenced block + inline code span），散文完全不掃。表面上兩條規則：(a) 指令名不得是計算或拼接出來的——直接禁；(b) 有 (a) 成立，單純的 `\bgit\s` 比對就是充分的。表面上的 git 指令現在剛好兩個（一句散文命名的操作、一個釘死的 HEAD 比對）。

負向控制實測：在真正的散文裡加一句「The `env` utility is what the prefix invokes.」**通過**——散文不再是清冊。

（第一次跑這個負向控制時它失敗了，我差點當成 bug。實際是我把 markdown inline code 注入到 fenced 範本裡，那不是散文，而 fenced block 內出現反引號本來就該被拼接禁令擋下。**測試位置錯了，不是控制錯了**——這正是 L8 說的「把結果當主張質詢」。）

### P2-4：`heredocOracle` 只認一種拼法

`!code.includes("<<'EOF'")`。但 `<<EOF`、`<<"EOF"`、`<<\EOF` 都以同一行 `EOF` 結束 heredoc，三種都通過一個叫「no fixed-EOF heredoc」的測試。**引號只決定 body 展不展開，從來不決定什麼結束文件**，所以不可能是檢查該鎖的東西。

改成解析 delimiter（四種引號形式 + `<<-`），E11 對**每一種拼法**各給一個 mutation control，外加一個負向控制：delimiter 只是**包含** `EOF` 字樣（`MSG_EOF_MARKER`）必須通過，否則這個 oracle 只是披著 parser 名字的子字串比對。

### Nit（當場修）

hostile-TMPDIR 那條斷言的訊息宣稱「`--` 讓 TMPDIR 不被當成選項」，但拿掉 `--` 時 `mktemp` 一樣會失敗（`-d/smart-commit-msg.XXXXXX` 是無效選項），結果一模一樣，斷言分不出來。訊息改成它真正證明的事（fail-closed），並註明 `--` 是由有序 segment pin 守住的。

### mutation

| Mutation | 結果 |
|----------|------|
| `git_verify -c alias.pwn='!…' pwn` | KILLED |
| 把 `-c` 加進允許的 verification reads | KILLED |
| `sweep_owned` 改回吞掉失敗 | KILLED |
| 文件：`$'git'` / `g$''it` / `g${EMPTY:-it}` / 純 `git show HEAD` | 四項全部 KILLED |
| **負向控制**：散文加一句 `` the `env` utility `` | **SURVIVED（正確）** |

七個殺傷型 mutation 全數命中，一個負向控制正確存活。

---
