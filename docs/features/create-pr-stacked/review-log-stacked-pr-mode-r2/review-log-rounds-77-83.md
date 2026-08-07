# Stacked PR Mode r2 — Review Log, Rounds 77–83

> 已完結的輪次記錄，內容不再變動。索引與最新一輪在 [review-log-stacked-pr-mode-r2.md](../review-log-stacked-pr-mode-r2.md)。

## 第 77 輪 — 架構重整（使用者核准）

第 76 輪的 ⚠️ Need Human 被使用者以「照審查者建議做架構重整」結案。這一輪不是再修 walker，而是**把被檢查的對象換掉**。

### 做了什麼

| 之前 | 之後 |
|------|------|
| `references/execute-mode.md` 內嵌可執行 bash fence，由 Claude 翻譯成工具呼叫 | `skills/smart-commit/scripts/execute.sh` — 受檢入的實作，三個子命令 `alloc` / `commit` / `verify-last` |
| 沒有統一的外部執行入口，白名單是測試檔裡的一個 Set 常數 | `skills/smart-commit/scripts/dispatch.sh` — `sd_run` 執行期強制白名單（`bash env git mktemp rm`），越界回 127 |
| `test/scripts/smart-commit.test.js` 3007 行，F6b walker 佔 1908 行 | 850 行；F6b 及六個只讀 fence 的測試退役 |
| — | `test/scripts/smart-commit-execute.test.js` 455 行，34 個測試，全部**執行**腳本 |

### 為什麼問題會消失

**一個 process，環境政策只回答一次。** fence 形式下每個區塊都是獨立 shell，所以每塊都要重新推導 `GIT_ENV` 前綴與 `REPO_ROOT`——而「同一個問題回答兩次」正是驗證器與 commit 指向不同 repository 那個缺陷的來源。腳本在頂端 `unset` 一次，這件事在結構上變成不可能，不再只是一條要記得遵守的規則。

**re-exec 剝掉 `SHELLOPTS`，所以繼承的 `set -e` 根本到不了。** fence 版本裡那整批「inherited errexit 會在 cleanup 前退出」的防禦，變成入口點的性質，而不是每個區塊都要記住的紀律。

**檢查方式從靜態分析換成兩個真實 oracle**：

1. **執行期拒絕** — `sd_run curl` 回 127，測試直接斷言，不需要任何 bash 分析器。白名單由 `dispatch.sh --allowlist` **從產物讀出**，不是在測試裡複述（複述正是上一版漂移的來源）。
2. **執行軌跡** — 把 `PATH` 換成只含白名單五個名字的 shim，跑完整 alloc → commit → verify-last。任何白名單外的外部命令都會 command not found 讓流程崩掉。**負向控制**：拿掉 `git` 必須讓流程失敗——沒有這個控制，軌跡測試對「什麼都不執行的腳本」也會通過。

第 76 輪那個 `hash -p` 形狀（報出的集合不變、實際執行的東西變了）在這個模型下不再是盲區：軌跡看的是**真的被執行了什麼**，不是名字的集合。

### 順帶收窄的授權

`allowed-tools` 從 `Bash(git:*), Bash(bash:*), Bash(env:*), Bash(mktemp:*), Bash(rm:*)` 減為 `Bash(git:*), Bash(bash:*), Bash(env:*)`。`mktemp` 與 `rm` 隨程序搬進腳本，授權也跟著收回——一個不再需要的授權不是惰性的，它是仍然生效的權限。F6 現在雙向斷言（該有的要有、不該有的不能留），且只讀 frontmatter 的 `allowed-tools` 值，不掃全檔（我自己的說明文字第一次就絆到了未收斂的版本）。

### 退役測試的覆蓋去向

| 退役 | 由誰接手 |
|------|---------|
| E9（guard 候選路徑清單） | `.claude/scripts` 優先於 `scripts/` 的**實際**測試 |
| F1（驗證器不可由環境變數選擇） | `CLAUDE_PLUGIN_ROOT` 指向寬鬆 guard，斷言仍被拒 |
| F2 / F2b（repointed git root） | `GIT_DIR`/`GIT_WORK_TREE` 指向另一個植入 repo，斷言 guard 與 commit 都不被改向；控制組先證明變數**確實有這個能力** |
| F3（mktemp 配置） | 實際 alloc：0600、TMPDIR 選目錄、`TMPDIR=-d` 失敗關閉 |
| F4（opt-in 預設剝除） | 雙向：繼承的 `ALLOW_AI_COAUTHOR=1` 不開啟 opt-in；opt-in 不外洩到 `git commit`（用 commit-msg hook 觀測） |
| F6b（1908 行 walker） | 執行期拒絕 + 執行軌跡 + 負向控制 |

### 證據

全套件 **3407 tests / 3401 pass / 0 fail / 6 skipped**（baseline 3381 / 3375 / 0 / 6，淨 +26）。`git diff --check` 乾淨。`check-comment-blocks.js` 對兩支新腳本無 WARN、無 blocking。

---

## Round 78 — Codex ⛔ Blocked 的三個 P1 都是真的，逐一重現後才動手

第 77 輪的重整交出去後，Codex 在 thorough tier 回 ⛔ Blocked。**三個 P1 我都先在 `/bin/bash` 下重現，確認不是誤報，才開始改**——這一步不是儀式，其中兩個的嚴重性只有跑過才看得出來。

### P1-1：`$BASH_ENV` 在文件化的呼叫形式上整個繞過腳本

把腳本當作**參數**交給 `bash`，`#!/bin/bash -p` 這行 shebang 根本不會生效；而 `$BASH_ENV` 是在腳本第一行之前被 source 的——也就是在腳本自己做的任何加固之前。

重現結果比「少了一層防禦」嚴重得多：`BASH_ENV` 指向一個只有 `exit 0` 的檔案時，呼叫**回傳 status 0，而什麼都沒執行**。呼叫端讀到的是「commit 成功了」。這是 fail-open，不是 fail-closed。

修法是 `bash -p -- "$EXECUTE"`，`-p` 讓 bash 直接忽略 `BASH_ENV`。Step 1c 有同一個洞（既有問題，非本次引入），依 `fix-all-issues.md` 一併修掉——「不是我改的」不是理由。

測試帶負向控制，而且**控制先跑**：沒有 `-p` 的版本必須真的被劫持（status 0、`HIJACK` 出現在 stderr、`smart-commit-msg` 沒有出現在 stdout），這個斷言若失敗，下面那個「有 `-p` 就安全」的斷言等於什麼都沒證明。

### P1-2：腳本在 consumer repo 裡根本找不到

我原本讓 `execute.sh` 透過 `scripts/run-skill.sh` 啟動。調查後發現 `/install-scripts` 會把 `skills/<name>/scripts/*` **攤平**進 `.claude/scripts/`，而 run-skill.sh 的路徑推導是 `PLUGIN_ROOT/skills/<name>/scripts/`——攤平後這個推導永遠落空。

這是專案層級的既有問題（8+ 個 skill 都用 cwd-relative 呼叫），但**我的改動新增了一條對它的硬依賴**，所以我把依賴移除而不是繞過：腳本自己建立 privileged 模式，除了一個路徑之外不需要 runner 給它任何東西。解析方式改成 repo-relative，`.claude/scripts/` 優先於 `skills/smart-commit/scripts/`——和 guard 完全相同的順序與相同的理由：**不能有變數指名那個執行政策的東西**。

順帶把兩支腳本改名為 `smart-commit-execute.sh` / `smart-commit-dispatch.sh`。理由同樣是攤平：未來任何一個 skill 附一支自己的 `execute.sh`，就會靜默覆蓋掉這支負責 attribution anchor 的腳本。用別的 skill 的腳本覆蓋政策執行點，和把變數指向一個寬鬆 guard 是同一個失效類別。

### P1-3：`verify-last` 可以被跑贏——attribution anchor 的最後一道防線是可破的

`commit` 驗證的是**一個檔案**，只有把 commit 讀回來才驗證了**那個 commit**。這兩個不是同一個物件，而 `commit-msg` hook 就坐在中間，有能力在驗證之後改寫訊息。

重現用的 fixture：一個 `commit-msg` hook 注入 `Co-Authored-By: Claude`，加上一個 `post-commit` hook 疊一個乾淨 commit 上去。`verify-last` 回 **0**，而 trailer 就在歷史裡。理由很簡單——事後才看 `HEAD` 的檢查，被違規 commit 早已不在 `HEAD` 這件事直接繞過。

修法是把驗證搬進 `commit` 自己的程序內，而且**綁在它自己造出來的東西上**：

```
before = HEAD（空 repo 時為空）
git commit …
after  = HEAD          → 讀不到、或 after == before，一律 UNVERIFIED
for oid in rev-list before..after:  對 git log -1 --format=%B <oid> 跑 guard
```

綁 range 而不是綁 `HEAD` 才是重點。同一個 fixture 現在回 **status 4** 並指名那個 OID。`after == before` 自成一種拒絕（status 7）：`git commit` 說成功但 HEAD 沒動，表示 commit 去了這個 process 看不到的地方，而「看不到」永遠不解讀成「乾淨」。

`verify-last [<commit-ish>]` 保留，但降級為 skill 收斂回合的**次要**檢查——事後檢查永遠可能被執行當下的 hook 跑贏。

### P2-5：那個執行軌跡斷言結構上不可能失敗

Codex 指出 `observed.filter(n => !allowlist().includes(n))` 恆為空集——因為只有白名單的 shim 才存在、才寫得進 trace.log。這正是第 74–76 輪的可證偽性課題又長回來一次：形狀不同，病一樣。

修法分兩層，而且明白寫出各自的盲區：

| Oracle | 看得見 | 看不見 |
|--------|--------|--------|
| `sd_run` 拒絕測試 | 白名單外的**名字**進到 dispatcher | 根本不經過 `sd_run` 的呼叫點 |
| 執行軌跡 | 流程**實際執行**了什麼（PATH shim） | 絕對路徑呼叫——不查 PATH |
| 靜態呼叫點檢查 | 兩支腳本裡每一個絕對路徑執行檔字面量 | 執行期算出來的路徑 |

軌跡改成**相等**斷言（`git mktemp rm`），不是「沒有白名單外的東西」。`bash` 與 `env` 依設計不在其中：兩者都用釘死的絕對路徑呼叫，不查 PATH——這個盲區正是靜態檢查存在的理由。靜態檢查只允許 `/usr/bin/env` 與 `/bin/bash` 兩個 bootstrap 路徑，第三個就是 finding；它的控制組把 `/usr/bin/curl` 注入腳本副本，要求檢查抓到，並且**先斷言 mutation 真的套用成功**——沒套用成功的 mutation 看起來和「檢查通過」一模一樣。

### 順手抓到的一個假綠燈

舊套件 F1b 裡有一段 `if (selfPolicing.length) { … }`，用來驗證 execute 腳本自己 `unset` 了整份 `GIT_*` 清單。它是以「這個呼叫出現在 run-skill.sh 的 delegation 清單裡」為條件的——而 P1-2 把 runner 依賴拿掉的那一刻，這個條件永遠為假，整段檢查靜默變成 no-op。改為無條件斷言。**不可能失敗的檢查不是檢查**，這條在同一輪裡出現了兩次。

### 證據

全套件 **3412 tests / 3406 pass / 0 fail / 6 skipped**（第 77 輪為 3407 / 3401 / 0 / 6，淨 +5：BASH_ENV 負向控制、兩個 sign flag 測試、靜態檢查與其 mutation 控制）。`smart-commit-execute.test.js` 39 個測試、`smart-commit.test.js` 41 個，兩檔全綠。

---

## Round 79 — 兩個 P0，其中一個是隔壁 skill 早就學會、我沒帶過來的教訓

第 78 輪交出去後 Codex 回 ⛔ Blocked，八個 finding，thorough tier 下全部 blocking。**八個我都先重現才動手**，兩個 P0 都是 fail-open——不是「防禦弱了一層」，是「檢查回報通過但實際沒過」。

### P0-1：釘死 `/bin/bash`，因為 `-p` 保護不到「哪個程式被啟動」

第 78 輪我修了 `$BASH_ENV`，但只改成 `bash -p`。Codex 指出 `-p` 只在**預期的那個 bash 已經在跑之後**才生效；而 `bash` 這個名字是由呼叫端的 shell 解析的。兩個劫持向量都重現成功：

| 向量 | 結果 |
|------|------|
| `PATH` 前面放一支 `bash` shim | status 0、`SHIM-RAN`、什麼都沒配置 |
| `export -f bash` 匯出同名函式 | status 0、`FUNC-RAN`、什麼都沒配置 |

兩者都回**成功**而政策腳本從未啟動；而且任何一個都同樣可以自己去跑 `git commit -F <msg-file>`，帶著 attribution 進 commit。這正是這支腳本存在要守的 anchor。

真正該記下來的不是這個修法，而是：**`skills/create-pr/SKILL.md` 早就寫著這一條**，連理由都寫了（「a bare `bash` is resolved in the caller's shell, so an exported `bash` function answered the whole command with exit 0 and neither script ever started」）。同一個 repo、同一類入口點、同一個失效模式，我在寫 smart-commit 時沒有把它帶過來。教訓不是「要用絕對路徑」，是**改政策入口點之前先去看這個 repo 裡其他政策入口點怎麼寫的**。

回歸測試從**文件裡把呼叫寫法讀出來**再拿去跑（測試自己複述一份，就會在產物換成別的寫法時照樣通過），對兩個向量各跑一次，並且**控制組先跑**：bare 寫法必須真的被劫持，否則「釘死版沒被劫持」什麼都沒證明。斷言的是**可觀察的產出**（真的配置出一個 msg 檔），不是 status 0——因為 status 0 正是 bypass 的長相。

### P0-2：`git replace` 可以把驗證讀到的位元組換掉

第 78 輪把驗證綁到 `rev-list <before>..<after>`，擋掉了 post-commit 疊 commit。Codex 指出還有一層：git 的物件讀取**預設 replace-aware**。post-commit hook 可以造一個乾淨的 commit 物件，然後 `git replace <真實 oid> <乾淨 oid>`——`rev-list` 仍然吐出真實 oid，但 `git log <真實 oid>` 讀到的是替身。驗證回 0；而 replacement ref 是本機的、不會跟著 push，被推上去的是那個帶 attribution 的 commit。

重現確認：同一個 oid，一般讀法回 `feat: clean`，`--no-replace-objects` 回真正帶 trailer 的訊息。

修法是所有讀回操作走同一個 `git_verify()` helper，統一釘上 `--no-replace-objects`——**用 flag 不用 `GIT_NO_REPLACE_OBJECTS` 環境變數**，理由和這支腳本其他地方一致：不能有環境變數決定政策看到什麼。

### P1-3：`--ai-co-author` 在推薦的安裝方式下根本不能用

第 77 輪我把 `ALLOW_AI_COAUTHOR=1` 關在 subshell 裡「不讓它外洩到 `git commit`」，還為此寫了測試。Codex 指出：推薦的安裝方式就是把 canonical guard 裝成 repo 的 `commit-msg` hook，而**那個 hook 正是靠讀 `ALLOW_AI_COAUTHOR` 才允許那一行白名單**。扣住它的結果是 hook 拒絕了這個 flag 存在的唯一目的，commit 以 status 5 失敗。

重現確認：裝上真 guard 當 hook，`commit --ai-co-author` 帶精確白名單行 → status 5、無 commit。

更該記的是**那個測試在把壞行為釘住**：它斷言 hook 看到 `unset`，於是「功能壞掉」在測試裡長得和「防禦成功」一模一樣。窄不等於安全；窄到讓契約失效就只是壞掉。現在改成 per-call subshell 同時包住 guard 與 `git commit`，並用**真 guard 當 hook** 的端到端測試釘三個方向：繼承的變數不開啟 opt-in、無 flag 時沒有 hook 看得到它、有 flag 時白名單行過而同一個 fixture 裡的 `Generated by Claude` 仍被拒。

### P1-4：`$EXECUTE` 活不過一次工具呼叫

這個諷刺得剛好：整個重整的立論就是「每個 fence 是獨立的 shell」，而我自己寫的 Step 5c 卻把解析結果存進變數，跨 alloc → Write → commit 三次呼叫使用。第二次呼叫時 `$EXECUTE` 是空的——或者更糟，是呼叫端匯出的值。三個 fence 現在各自帶完整 locator。順帶修掉錯誤的復原指示：`/install-scripts` → `/install-scripts --skill smart-commit`。

### P2 三則

- **路徑重用**：`scrub` 成功後沒有把路徑移出 `OWNED`，於是每個檔案被 unlink 兩次。`rm -f` 對「路徑不存在」是冪等的，對**路徑被重用**不是——兩次之間別的行程在同名位置建了新檔，EXIT sweep 會刪掉別人的。改成成功即 disown，只在刪除**失敗**時保留給 trap 重試。測試用一支 wrapper guard 在驗證階段重建該路徑，斷言它活著。
- **`verify-last` 多個 operand**：後面的靜默覆蓋前面的，`verify-last <帶 trailer 的 oid> <乾淨 oid>` 回 0。改成第二個 operand → exit 2。**安靜地檢查了別的東西，比拒絕檢查更糟**。
- **兩個靜態 oracle 都還有可達的 mutant**：`absoluteExecutables` 只認 `bin`/`sbin` 版面，`/tmp/curl`、`/usr/libexec/helper` 直接繞過；而「每個外部命令都走 `sd_run`」這條文件宣稱的性質，**三個 oracle 沒有一個看得見**——把 `sd_run git` 換成裸 `git`，軌跡一模一樣（shim 記的是同一個名字）、沒有絕對路徑、也不會進到 dispatcher 被拒。前者改成以**命令位置**為判準而非目錄白名單；後者新增第四個 routing oracle，控制組就是那個 mutation。

### 可證偽性：這一輪是實際跑出來的，不是宣稱的

新測試逐一做了 mutation 驗證，而且確認**只有**該殺的那個測試變紅：

| Mutation | 被殺的測試 |
|----------|-----------|
| 拿掉 `--no-replace-objects` | replacement object 遮蔽 |
| `verify_range` → `verify_one "$after"` | post-commit 疊 commit |
| 文件改回 bare `bash` | shadowed-bash（含 2 個向量）+ 文件拼寫斷言 |
| `/usr/bin/curl`、`/tmp/curl`、`/usr/libexec/helper` 注入 | 絕對路徑檢查（三者都抓到） |
| 拿掉 `sd_run` 前綴 | routing oracle（絕對路徑檢查對它是綠的——這正是它存在的理由） |

驗完全部還原，`diff -q` 確認腳本與 SKILL.md 逐位元組還原。

### 證據

全套件 **3422 tests / 3416 pass / 0 fail / 6 skipped**（第 78 輪 3412 / 3406 / 0 / 6，淨 +10）。`smart-commit-execute.test.js` 49 個、`smart-commit.test.js` 41 個。`/bin/bash -n` 兩支腳本皆過，`git diff --check` 乾淨，`check-comment-blocks.js` 對變更檔無 finding。

---

## Round 80 — 「驗證我造出來的東西」這句話本身是錯的

第 79 輪交出去後 Codex 回 ⛔ Blocked，四個 finding、兩個 P0。四個都重現後才動手。

### P0-1：腳本檔頭自己還寫著 bare `bash`

第 79 輪我把 SKILL.md 與 execute-mode.md 都改成 `/bin/bash -p --`，但腳本自己的檔頭註解仍寫著「Launch it as `bash -p -- <path>`」。而我那個新測試**只掃兩份文件、不掃產物自己的註解**——照著檔案本身讀的人拿到的就是那個有洞的寫法。

一行修好，但它暴露的是斷言範圍的盲點：檔頭註解也是**出貨的指示**。斷言現在把兩支腳本的註解一起納入。

### P0-2：ref 轉向——`before..after` 認的是「從最終 HEAD 可達」，不是「這次造出了什麼」

這是這一輪真正重要的一個。第 78 輪我把驗證綁到 `rev-list <before>..<after>`，第 79 輪加上 `--no-replace-objects`，兩次都還在 HEAD 這條線上。Codex 指出 post-commit hook 可以：

1. 把帶 trailer 的 commit A 存到 `refs/keep/leaked`
2. 用 A 的**父節點**造一個乾淨的 B
3. 把 branch 移到 B

於是 `after = B`，`before..B` 只含乾淨的 B，驗證回 **0**——而 A 仍然可達、仍然可以被 push。不需要 replace object，不需要 graft。

重現確認：verifier 回 0，`refs/keep/leaked` 上就躺著那個帶 `Co-Authored-By` 的 commit。

修法是換掉錨點：commit 前後各對**整個 ref 空間**（`for-each-ref` + HEAD）取快照，驗證 `rev-list <after tips> --not <before tips>` 的每一個 commit。判準變成「這次操作讓什麼東西**變成可達**」——而**可以被 push 的 commit 依定義就是從某個 ref 可達**，所以疊 commit 與轉向兩種都被涵蓋。新的實作其實比舊的簡單。

順帶處理 Codex 點出的 graft：`.git/info/grafts` 會改寫 parentage，因而改變 `rev-list` 認定的可達性，而 `--no-replace-objects` **不涵蓋它**。graft 檔非空即 exit 7 拒絕，不出具判定——在被改寫過的 ancestry 上算出來的判定不是判定。graft 已 deprecated 且罕見，拒絕是誠實的，信任不是。

### P1-3：我把修法**寫在註解裡**，而不是**做出來**

Step 5c 的 `$EXECUTE` 跨工具呼叫問題，第 79 輪我改成一個 fence 加一句註解「…then Write the message, and in a NEW fence carrying the same locator:」——但**第二個 fence 並不存在**。照著產物逐字執行的人，commit 那一步的 `$EXECUTE` 仍然是空的。

這正是 `Declaring ≠ Executing` 在文件層的版本：描述一個修法不等於做出那個修法。現在是兩個真的 fence，各帶完整 locator，而測試**把兩個 fence 從文件抽出來、在兩個各自獨立的 shell 裡真的跑一遍**，中間夾著 Write。mutation 控制：把第二個 fence 的 locator 拿掉，測試就紅。

### P2-4：靜態 oracle 的 shell 文法盲區

Codex 實測了具體輸入：`LC_ALL=C git log`、`while git status; do`、`{ git status; }`、`LC_ALL=C /tmp/curl`、`if /tmp/curl; then`——我那兩個以「前導分隔符」錨定的 regex 對全部回空。都是再平常不過的 shell。

改成真的做一次粗略的 tokenize：先把引號內容抹掉，再以 shell 分隔符切段，然後逐層剝掉關鍵字前綴與**變數賦值前綴**，取每段第一個 token。抹引號這步是被自己的產物逼出來的——我新寫的一行 `warn '…(grafts are deprecated; git replace refuse both)…'`，舊 regex 把引號裡的散文讀成了 `git` 呼叫點。Codex 沒抓到這個，是我改完跑測試才紅的；一個會把散文當程式碼的檢查器，最後的下場是被人關掉。

Codex 給的五個輸入全部進了測試當控制組，反方向也釘了：routed 的呼叫、命令替換裡的 routed 呼叫、引號散文，都必須**不**被報。

### 這一輪的可證偽性驗證

| Mutation | 被殺的測試 |
|----------|-----------|
| ref 快照改回 `verify_created "$before" "$after"` | ref 轉向 |
| 拿掉 `refuse_on_grafts` | graft 拒絕 |
| 文件第二個 fence 的 locator 拿掉 | 抽出 fence 實跑 |

每次驗完還原並以 `diff -q` 確認逐位元組一致。

### 文件不再宣稱做不到的事

新增 § What this cannot do，把邊界寫死：hook 帶著使用者完整權限執行，這支腳本擋不住在驗證前就 `git push`、或把工作排到本行程結束之後、或去動另一個 repo 的 hook——那一類的答案是 `commit-msg` hook 本身（在物件寫入**之前**跑），這也是它被列為推薦安裝而非可選的原因。同時明講 `ALLOW_AI_COAUTHOR=1` 在 opt-in 時會被 `git commit` 啟動的**所有** hook 與子行程繼承，不只 `commit-msg`——「應該只 scope 到 guard」是很自然的假設，而它不成立。

**安全文件的失效模式是讀者以為它涵蓋的比實際多。** 這一節寫的是它涵蓋不到的部分。

### 證據

全套件 **3426 tests / 3420 pass / 0 fail / 6 skipped**（第 79 輪 3422 / 3416 / 0 / 6，淨 +4）。`smart-commit-execute.test.js` 53 個、`smart-commit.test.js` 41 個。`/bin/bash -n` 兩支腳本皆過，`git diff --check` 乾淨，`check-comment-blocks.js` 對變更檔無 finding。

---

## 第 81 輪 — ref 快照不等於物件建立邊界

第 80 輪 Codex 回 ⛔ Blocked：3 個 P0、1 個 P1、3 個 P2。thorough tier 下全部 blocking。

### P0-1：`snapshot_tips` 靜默降級

`snapshot_tips` 無條件 `return 0`，兩個呼叫端也都沒檢查命令替換的狀態。`for-each-ref` 一失敗，快照就悄悄退化成「只有 HEAD」——正是第 80 輪引入 ref 空間快照要補的那個盲點。**一個失敗時會自動縮小涵蓋範圍的檢查，比沒有檢查更糟**，因為它看起來仍然在運作。

改成失敗即非零，兩個呼叫端都測狀態。同時要把「尚無 commit 的 unborn repo」和「repo 讀不到」分開——前者合法，後者不是——用 `symbolic-ref -q HEAD` 判別：HEAD 解不開但仍是 symbolic ref，才是 unborn。

`--exclude` 沒有用，因為那是 Git 2.36+ 的選項；在舊版 Git 上靜默涵蓋更少，正是這條在防的事。改用 shell 過濾。

### P0-2：graft 只在 commit 之前拒絕

`refuse_on_grafts` 只在 `git commit` **之前**跑一次，而 `post-commit` hook 在那之後才執行——它可以在遍歷開始前才裝上 graft。而且 graft 路徑解析失敗被當成「沒有 graft」，是 fail-open。

先獨立重現，確認攻擊成立：hook 在 leaking commit A 之上造出乾淨的 B、移動 branch，再寫 graft 把 B 的 parent 改成 A 的 parent。`rev-list B --not P` 從 `{B, A}` 變成 `{B}`，A 被抹掉，但 A 仍是真實且可推送的物件。

改成 commit 前後各拒絕一次，解析失敗回 7。兩次檢查只是把窗口縮小，**沒有讓它變成原子操作**，這點文件裡照實寫。

### P0-3：ref 可達性不是物件建立的邊界（未修，改為收斂宣稱）

Codex 指出我在腳本註解和文件裡都寫了「可推送 ⇒ 可從某個 ref 到達」。這是錯的，而且可以量測：

```
git reset --hard <parent>          # 讓某 commit 從任何 ref 都到不了
git rev-list --all | grep <oid>    # 0 筆
git push --dry-run . <oid>:refs/heads/probe
  → * [new branch]  d5fc086... -> probe     # 仍然成功
```

所以 hook 可以把 leaking commit 的 OID 留在 `ORIG_HEAD`、reflog、gitlink 或一個純文字檔裡，再從舊 parent 造一個乾淨 commit，遍歷就只看得到乾淨的那個。

**我沒有修這個，而是收掉宣稱。** 理由值得寫下來而不是含糊帶過：要走到這一步，攻擊者已經在 repo 裡執行任意程式碼——而這樣的攻擊者可以在本行程再次被排到之前就直接把 leaking commit 推出去。**一個在 commit 之後才跑的檢查，擋不住不等它的東西。** 真正要關上，得用 `core.hooksPath` 把 commit 限制在受信任的 hook 集合裡，但那會連開發者自己的 `pre-commit` 一起停掉——那是契約變更，不是修補，不該默默做掉。

這個設計實際防的是**非蓄意的 attribution 洩漏**（生成出來的 trailer、會改寫訊息的 hook、過期的 template），加上文件裡點名的那幾種遮蔽手法。它不是對抗本機惡意程式碼的圍籬，文件現在就是這樣寫的。

### P1：並行 ref 更新被算到這次操作頭上

我在第 80 輪就已獨立重現過這個 false positive，當時刻意押著沒修，以免讓進行中的審查失效；Codex 也獨立提了同一件事。

`post-commit` 裡的 `git fetch` 會把同事帶 AI trailer 的 commit 變成新可達——腳本於是回 4，**拒絕開發者自己乾淨的 commit，並告訴他洩漏了根本沒發生的東西**。誤告比漏抓更傷，因為它會直接讓人把這個檢查關掉。

`refs/remotes/` 排除出快照。這是一次**刻意的涵蓋縮減**：換掉的是「hook 把 commit 停在 `refs/remotes/` 底下」，而那不是 push 目標（除非明寫 refspec），且有這種權限的 hook 直接 push 更快。其餘並行情形（另一個終端機開的 branch）仍可能誤報，文件照實列出，且報告一定帶 OID，人可以自己核。

### P2：三項

`commandTokens` 看不到前導重導向——`>/dev/null git …`、`2>/dev/null /tmp/curl …` 對兩個 oracle 都隱形。剝掉重導向前綴後又發現切段那步會把 `2>&1` 從 `&` 剖成兩半，第二段開頭變成 `1`，後面的 `git` 一樣消失；切段 regex 加上 lookbehind。

`env` 從 allowlist 移除。它當初的理由是「execute.sh 開頭的特權 re-exec 需要」——但那個 re-exec 用的是**絕對路徑** `/usr/bin/env`，而且在 dispatcher 被 source **之前**就跑完了，`sd_run env` 這個呼叫點從來不存在。列著它只是白白放寬第一個 token 的面積（`sd_run env /bin/sh -c …` 當時回 0）。

順帶把 dispatcher 的 header 修掉：檔名還寫著不存在的 `dispatch.sh`，sourcing 範例用 `dirname "$0"`——在被 source 的檔案裡 `$0` 仍是**呼叫端**的路徑，解出來的目錄是錯的。改用 `BASH_SOURCE`。

同時把 dispatcher 定位寫清楚：**這是相依路由，不是 sandbox**。allowlist 只比對第一個 token，`sd_run bash -c 'curl …'` 照跑不誤，`git` 自己也能透過 config 執行任意程式碼。它框的是腳本會**指名**哪些外部程式——那是讓新相依在審查中現形的東西。

### 這一輪的可證偽性驗證

| Mutation | 被殺的測試 |
|----------|-----------|
| 拿掉 commit 後的 `refuse_on_grafts` | POST-commit graft 拒絕 |
| `snapshot_tips` 吞掉 `for-each-ref` 失敗 | ref 空間讀不到須中止 |
| 拿掉 `refs/remotes/` 排除 | fetch 不該被算到這次 commit |
| `before_tips` 不檢查狀態 | 22 個測試（每一次 commit 都中止） |
| 拿掉重導向剝離 | 靜態 recognizer 文法涵蓋 |
| `env` 放回 allowlist | allowlist 內容 + env 逃逸被拒 |

`env` 那一次第一輪替換沒吃到（跳脫寫錯），harness 直接標示 `MUTATION DID NOT APPLY` 而不是報「測試存活」——**沒套用的 mutation 和存活的測試長得一模一樣**，這個區分是刻意做的。重跑後確認殺掉兩個測試。每次驗完還原並 `diff -q` 確認逐位元組一致。

### 證據

全套件 **3430 tests / 3424 pass / 0 fail / 6 skipped**（第 80 輪 3426 / 3420 / 0 / 6，淨 +4）。`smart-commit-execute.test.js` 57 個。

---

## 第 82 輪 — 環境變數才是真正的洞，以及「可達」不等於「是我做的」

第 81 輪 Codex 回 ⛔ Blocked：1 個 P0、1 個 P1、3 個 P2。

### P0：`GIT_GRAFT_FILE` 繞過兩次 graft 檢查

整個設計的地基是「一個行程、一份環境政策」，開頭一次 `unset` 掉 `GIT_*`。Codex 指出這份清單漏了 `GIT_GRAFT_FILE`——ancestry 可以被導向任意檔案，`info/grafts` 保持不存在，**兩次 graft 拒絕都看到一個乾淨的 repo**，而 `rev-list` 走的是被改寫的 parentage。

先獨立重現：`rev-list B --not P` 從 2 個 commit 掉到 1 個，`.git/info/grafts` 全程不存在。

真正的教訓不是漏了哪一個變數，是**這份清單本來就不該用手挑**。改成問 git 自己：

```
git rev-parse --local-env-vars
```

跑出來才發現洞比雙方講的都大——`GIT_CONFIG_PARAMETERS` 也沒被清掉，而它可以注入任意 config。實測 `git config user.email` 回傳攻擊者指定的位址；同一條路徑也能設 `core.hooksPath` 和 `commit.gpgsign`。這比 graft 嚴重，而 Codex 沒點到它，是拉 git 自己的清單才浮出來的。

現在清單覆蓋該指令列出的全部項目，並且**測試在執行時重新去問 git**，未來 Git 新增變數會直接讓測試紅，而不是靜靜地漏掉。

`GIT_SHALLOW_FILE` 一併清掉，但 Codex 附帶宣稱的「寫 `.git/shallow` 可截斷遍歷」**我重現不出來**：非 shallow repo 寫進去後 `rev-list` 仍是 2 個 commit。所以它是為了決定性而清，不是因為有已展示的攻擊——文件照這樣寫，沒有把重現不出來的東西講成已知威脅。

### P1：命名空間過濾本來就是錯的軸

第 81 輪我用排除 `refs/remotes/` 來擋並行 fetch 的誤報。Codex 指出 fetch 會 **auto-follow tags**，新的 `refs/tags/` tip 把同一段歷史原封不動帶回來——過濾器擋不住。而我那個測試沒有 tag，所以**結構上不可能證偽這件事**。

Codex 的建議是別用命名空間判斷歸屬。接受，`refs/remotes/` 過濾整個拿掉，改用**是否能從新的 HEAD 到達**來決定歸屬：

| 新變得可達，而且… | 判定 | 理由 |
|---|---|---|
| 能從新 HEAD 到達 | trailer ⇒ **洩漏，狀態 4** | 這就是這次 commit 加進去的歷史 |
| **不**能從新 HEAD 到達 | trailer ⇒ **UNVERIFIED，狀態 7**，並印出 OID | fetch、另一個終端機、hook 停放 commit，從這裡看完全一樣 |

兩者都 fail-closed。差別在於對開發者說什麼——只有 4 是在斷言「你的 commit 洩漏了」，而對一個無法歸屬的 commit，這句話根本沒有資格說。

代價要講清楚：轉向攻擊（commit 停在 `refs/keep/x`）從 4 降成 7。那是真的降級，但誠實——這支程式確實分不出惡意轉向和同事的 fetch。

### P2：一個構不到的分支等於沒有斷言

Codex 指出我第 81 輪加的 `snapshot_tips` 失敗測試**只碰得到第一次呼叫**：shim 讓每一次 `for-each-ref` 都失敗，所以在 `git commit` 之前就中止了，commit 之後那個 handler 永遠走不到。「把那段刪掉，整個套件仍然全綠。」

這正是我這幾輪一直在抓的那個毛病，出現在我自己新寫的測試上。改用帶狀態的 shim：放行第一次、讓第二次失敗，並斷言狀態 7 **加上 commit 後才會出現的那句診斷**——後者才是證明分支真的被走到。

### P2：我反過來推翻了 Codex 的前提

Codex 說 `symbolic-ref` 不足以分辨 unborn 與壞掉的 HEAD，建議加嚴。我照做了，加上 ref 清單比對與 loose ref 檔案存在性檢查——然後**又把它們拿掉**。

因為實測結果相反：HEAD 指向壞掉的 ref 時，`git symbolic-ref -q HEAD` 直接 **exit 128**（`fatal: No such ref: HEAD`），而 `for-each-ref` 只印 warning 並 exit 0。所以既有那一行本來就是判別器。至於「ref 指向不存在的物件」，HEAD 反而**正常解析得出來**，根本不會進到那個分支。

我造不出任何一個 fixture 能讓新加的兩個檢查發揮作用。**構不出反例的防禦性程式碼不是控制措施，是無法驗證的表面積**——所以移除，並把量測結果寫進註解，避免下一個人再憑直覺加回去。

精確 mutation 確認：把 `symbolic-ref` 那行中性化，剛好死一個測試。

### 一個自己抓到的假陽性

新寫的 malformed-ref 測試原本只斷言 `status != 0`。mutation 顯示它**存活**——因為拿掉檢查後流程會往下走，最後死在 `git commit`，狀態 5，一樣不是 0。斷言太弱，綠燈是別的機制給的。改成釘死狀態 7 加上快照專屬的診斷字串後才真正可證偽。

### 這一輪的可證偽性驗證

| Mutation | 被殺的測試 |
|----------|-----------|
| `GIT_GRAFT_FILE` 不清 | local-env-vars 覆蓋 + graft 環境繞過 |
| `GIT_CONFIG_PARAMETERS` 不清 | local-env-vars 覆蓋 + config 注入 |
| 拿掉歸屬切分（一律歸咎） | 轉向停放 + fetched tag |
| 拿掉 commit 後的 ref 空間檢查 | commit 後失敗才抓得到 |
| 重導向運算子不再最長優先 | 靜態 recognizer 文法涵蓋 |
| `symbolic-ref` 判別器中性化 | malformed ref 視為 unborn |

每次驗完還原並 `diff -q` 確認逐位元組一致。

### 註解搬遷

`verify_created` 的註解長到 41 行，超過 `@rules/docs-writing.md` 的 30 行上限而被 `check-comment-blocks.js` 擋下。內容已經在 `execute-mode.md` 裡，所以壓成 16 行加指標——**搬移與去重，不是刪除**。

### 證據

全套件 **3438 tests / 3432 pass / 0 fail / 6 skipped**（第 81 輪 3430 / 3424 / 0 / 6，淨 +8）。`smart-commit-execute.test.js` 65 個。`bash -n` 兩支腳本皆過，`check-comment-blocks.js` exit 0。

## 第 83 輪 — 修好一半的洞：executor 補了，manual mode 沒補

第 82 輪把 executor 的環境變數清除清單從「手挑」改成「由 `git rev-parse --local-env-vars` 推導」。這一輪回頭看才發現，同一個 skill 的**另一半**還停在舊清單上。

### `GIT_ENV` 前綴是兩個模式共用的，不是只給 manual mode

`git-environment.md` § 1 寫得很清楚：「**這個 skill 自己跑的**每一條 git 指令 — 讀或寫、任一模式」都帶這個前綴。所以它不只出現在印給使用者的指令裡，Step 1c 的身分診斷 `git config --get user.email` 也是用它跑的。

而 `GIT_CONFIG_PARAMETERS` 正好覆寫 `user.email`。結果就是：**診斷報告一個作者，commit 記錄另一個作者**——一個唯一職責就是「值得信任」的檢查，安靜地說謊。同一條通道還能碰到 `core.hooksPath`（AI 屬名防護的所在地）與 `diff.external`。

這和第 82 輪 Codex 擋下的 P0 是同一類缺陷，只是在隔壁一格。不修它就是 `@rules/fix-all-issues.md` 明令禁止的「這個不相關 / 本來就有」藉口，所以修。

### 為什麼舊清單會短

`git-environment.md` 開頭原本問的是「**哪一個 repository、tree、index**？」——這個框架本身就是清單過短的原因。一個變數不需要改動 *repository* 就能讓答案不可信：

| 變數 | 路徑動了嗎 | 但是 |
|------|-----------|------|
| `GIT_CONFIG_PARAMETERS` | 沒有 | 覆寫 `user.email`、`core.hooksPath`、`diff.external` |
| `GIT_GRAFT_FILE` | 沒有 | repository 是對的，它報告的歷史不是 |
| `GIT_SHALLOW_FILE` | 沒有 | 同上 |

所以問題改寫成「哪一個 repository、tree、index、**ancestry 與 configuration**」，清單隨之補齊 9 個變數，31 處副本同步。

### 兩份清單宣稱相同，卻沒有任何測試檢查

改完才注意到真正的結構問題：`GIT_ENV` 前綴與 `smart-commit-execute.sh` 的 `unset` 區塊是**兩份獨立的清單**，而 § 1 和 F1b 都用了「identical」這個字——**在此之前沒有任何測試檢查這件事**。

`REQUIRED_ENV_TOKENS` 只各自釘住兩邊的**下限**，所以任一邊往上長、超過另一邊，測試照樣全綠，而文件繼續宣稱兩者相等。這就是這個 loop 反覆抓到的同一類缺陷：**未經量測的宣稱**。

補上兩個控制：

| 測試 | 釘住的宣稱 |
|------|-----------|
| `F1i` | 前綴與 executor `unset` 是**同一個集合**（以集合比較，兩邊格式本來就不同、順序無意義） |
| `F1j` | 清單涵蓋 `git rev-parse --local-env-vars` 說出的每一個變數 — 對 git 本身驗證，未來 Git 新增變數會**失敗**而不是留洞 |

F1j 存在的理由就是 `GIT_GRAFT_FILE` 與 `GIT_CONFIG_PARAMETERS` 被漏掉 80 輪的原因：手挑清單沒有任何機制會告訴你漏了什麼。

### 可證偽性驗證

| Mutation | 被殺的測試 |
|----------|-----------|
| executor `unset` 單獨拿掉 `GIT_CONFIG_PARAMETERS` | F1i、F1b |
| 前綴單獨拿掉 `GIT_PREFIX` | F1d、F1i、**F1j**、F1b、F1c |

兩個 mutant 都被**預期的**測試殺死；F1j 專門抓 F1i 抓不到的那一面（兩邊一起變短時，集合仍相等）。還原後 `diff -q` 逐位元組一致。

### 文件更正：我上一輪寫錯了一件事

第 82 輪我在 `execute-mode.md` 寫下「非 shallow repository 會忽略 `.git/shallow`，所以清除它只是為了確定性，不是因為有實證攻擊」。**這是錯的**，Codex 反駁後我重驗確認。

錯在測法：我把 commit 的**父節點**寫進去，什麼都沒發生。真正會咬人的是把 **commit 自己**寫進去——因為 `shallow` 裡列的每個 OID 都變成 traversal **ROOT**，而不是它下面的邊界。實測 `git rev-parse HEAD > .git/shallow` 之後 `git rev-list --count HEAD` 從 3 掉到 1，洩漏的父節點永遠不會被走到。

文件已改為記錄實測結果，並說明錯誤的測法長什麼樣子——避免下一個人用同樣的方式「驗證」出同樣的錯誤結論。

### 文件更正：「並行活動只能回報、無法歸屬」是過寬的宣稱

Codex 的 P1：從觀察到的 HEAD 可達**不是**所有權證明。原文說並行 ref 活動「cannot be attributed, only reported」，但反方向沒說：

若另一個行程在本腳本的 `git commit` 與 `rev-parse --verify HEAD` 之間推進了 checked-out branch，那個 commit **從實際觀察到的 HEAD 可達**、且不在 `before_tips` 裡，於是被回報成「這次 commit 洩漏了」——一個指著別人作品的 status 4。

單一行程內無法分辨這兩種情況，因為兩者可用的證據是同一個可達性關係。所以緩解手段是**範圍，不是偵測**：只有真的存在 trailer 時才會進到這個分類、冒犯的 OID 一律完整印出而非摘要、status 4 的指引是先檢查那個 OID 再談 amend。文件已改為「heuristic，不是 proof」並寫明這個方向。

### 其他

- `smart-commit-execute.sh:255-258` 的註解宣稱 `symbolic-ref` 不足以判別，與下方 278-286 行的實測記錄及程式碼本身相矛盾——第 81 輪改了程式碼與呼叫點註解，漏了檔頭。已更正。
- `SKILL.md` 的 bundled-script 表仍寫著 dispatcher 允許 `env`，但 allowlist 早已縮到 `bash git mktemp rm`。已更正（第 82 輪的 `[NIT_DEFERRED]`）。
- `execute-mode.md` 補上 `resolve_git_path` 的存在理由：`git rev-parse --git-path` 回傳的是 **repository 相對路徑**，相對路徑由 shell 對**呼叫端的 cwd** 解析。從子目錄啟動時，裸寫 `[ -s "$(git rev-parse --git-path info/grafts)" ]` 測的是一個不存在的檔案——檢查通過，而 graft 就在那裡生效。

### 證據

全套件 **3446 tests / 3440 pass / 0 fail / 6 skipped**（第 82 輪 3438 / 3432 / 0 / 6，淨 +8，其中 +2 為 F1i / F1j）。`check-comment-blocks.js` exit 0（無 ≥30 阻擋項）。前綴、executor `unset` 與 `git rev-parse --local-env-vars` 三者以集合比較完全一致。
