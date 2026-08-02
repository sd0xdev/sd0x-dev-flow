# sd0x-dev-flow Lesson Log

## L1 — Never use context/token limits as excuse to skip auto-loop

- **Context**: After completing rule-override-pattern feature implementation (9 files modified), suggested deferring `/codex-review-doc` to "next session" due to long context
- **Error pattern**: Used "context is very long" as justification to skip mandatory review step, violating auto-loop Prohibited Behaviors
- **Correct approach**: Always invoke the review command in the same reply. If context is genuinely exhausted, attempt anyway — the tool invocation itself may succeed even if the model's internal context is compressed
- **Prevention**: Added explicit prohibition to `rules/auto-loop.md`: "Context/token excuse" is now a named violation. No circumstance (session length, context pressure, token budget) justifies skipping review
- **Source**: 2026-03-17 — rule-override-pattern feature-dev session, auto-loop violation after 9-file implementation

## L2 — 套用規則前先確認它管的是哪一類檔案

- **Context**: 在 smart-commit 硬化的多輪審查中，我把 `docs-numbering.md` 的 500 行上限當成 `skills/smart-commit/SKILL.md` 的預算，為此連續數輪壓縮內容、把論述搬到 `references/`，並在多則回覆裡把「SKILL.md 貼在 500 行上限」當成成本回報
- **Error pattern**: 該規則的第一句就界定範圍是 `docs/features/<feature>/` 的 feature 文件；`skills/**` 從未在內。我從 `docs-writing.md` 那條通用的 Bounded 敘述推斷它適用於任何 `.md`，沒有回頭讀 `docs-numbering.md` 的範圍句，也沒有查有無機制在執行它
- **Correct approach**: 套用任何數值門檻前，先讀該規則自己的範圍界定句，並找出「誰在執行它」。功能性文件（skill／agent／command／rules／template）是**指令介面**，整份被載入執行，長度成本與被人閱讀的散文不同，本來就不受此限
- **Prevention**: 兩個可觀察訊號。(1) **反例存在**：`skills/project-setup/SKILL.md` 已 555 行且從未被任何檢查擋下——一個「規則」若有長期存活的違例而無人抱怨，多半是我套錯範圍。(2) **找不到執行者**：`grep -rn "500" test/ hooks/ scripts/` 找不到對 skill 行數的檢查，代表沒有機制認為它適用。現規則已把範圍與豁免正面表列（`rules/docs-numbering.md` § Size Limit 的 Exempt 表）
- **Source**: 2026-08-01 — smart-commit-hardening 審查迴圈，把 feature 文件的行數上限誤套到 SKILL.md

## L3 — 新增一道守衛時，正向控制和負向控制要同時提交

- **Context**: `test/scripts/smart-commit.test.js` 的 F6b（判斷 fence 呼叫了哪些外部命令）在第 55、57、58 三輪各出現一次同型缺陷：新增的檢查會誤觸無辜輸入。第 55 輪是整張 `OPAQUE` 表刪掉後所有 probe 仍全綠（它從來沒有負向控制）；第 57 輪我把 `eval`／`trap` 加進 `OPAQUE`、把「以 `)` 結尾」當成 case pattern，兩者都只寫了「必須失敗」的案例；第 58 輪 Codex 指出 `printf eval` 與 `("curl")` 因此分別誤觸與漏掉
- **Error pattern**: 為新守衛只寫「它會抓到什麼」，不寫「它不該抓到什麼」。這在當下永遠是綠的——誤觸要等到某個真實輸入撞上才會出現，而那時它看起來像新缺陷，不像舊疏漏
- **Correct approach**: 一道守衛的規格是**一對**斷言：構造出現時具名失敗，同樣的字詞當作散文／資料／引數時必須通過。兩者同一次提交，不是「之後補」
- **Prevention**: 兩個可執行的檢查。(1) **刪除測試**：把新守衛整段註解掉，若所有既有案例仍全綠，代表它沒有負向控制。(2) **同字詞反例**：新守衛若比對某個字詞（`eval`、`xargs`、`alias`），就寫一個把該字詞當引數或資料的案例。第 58 輪正是靠 (2) 當場抓到我收窄後仍存在的誤觸（`eval)` 這個 case pattern），而該誤觸讀程式碼是看不出來的
- **Source**: 2026-08-01 — create-pr-stacked r2 第 55／57／58 輪審查，F6b 守衛連續三次缺正向控制

## L4 — 用 shell heredoc 傳程式碼片段給 node 會被 shell 改寫，改壞的檔案與「測試沒抓到」外觀相同

- **Context**: F6b 的多輪修補中，我反覆用 `node - <<'NODE' … NODE` 一次套用多處字串替換。同一天出現三次事故：(1) 突變規格裡的 `\&\&` 被寫成字面反斜線，四個突變體回報「pass 0 / fail 1」，看起來像「全部抓到」，其實是檔案語法錯誤；(2) 替換字串裡的 `$'` 被 shell 吃掉，寫進檔案的是 `if (s[i + 1] === '` 這種半截程式碼；(3) 同一次操作讓整份測試檔被重複串接三份，`node --test` 只回報一行 `not ok 1`，看不出是檔案結構壞了
- **Error pattern**: 把「含引號、`$`、反斜線的程式碼」當成可以安全穿過 shell 的字串。`<<'EOF'` 只擋住 heredoc 本身的展開，替換內容裡的逸出序列仍會被我自己寫錯；而 node 對半截程式碼的失敗訊號（`# tests 1 / # fail 1`）與一個真正失敗的測試檔外觀幾乎相同
- **Correct approach**: 程式碼片段與突變規格一律先用 Write 工具寫成檔案（`$CLAUDE_JOB_DIR/tmp/*.js` 或 `*.json`），再由 node 讀檔套用。多處替換用 JSON 規格檔，不用 shell 引號
- **Prevention**: 三個可觀察訊號。(1) **測試數不對**：`node --test` 回報的 `# tests` 不等於該檔案已知的案例數（此處是 49），就是檔案壞了，不是測試失敗——突變腳本應直接區分 CAUGHT／SURVIVED／BROKEN FILE 三種結果而非只看 fail 數。(2) **改完先 `node --check`**：語法檢查比跑測試快，且直接指出行號。(3) **行數暴增**：`wc -l` 與 `git diff --stat` 對不上預期的編輯規模，代表發生了重複串接
- **Source**: 2026-08-01 — create-pr-stacked r2 第 62／66 輪，F6b 測試檔三次被 shell 引號改寫

## L5 — 綠燈要問「是誰讓它綠的」：斷言太弱與構不到的分支，外觀和真正的覆蓋一模一樣

- **Context**: smart-commit 硬化第 81／82 輪，同一天兩次。(1) 我為 malformed ref 新寫的測試只斷言 `status != 0`；mutation 顯示它**存活**——拿掉被測的檢查後，流程往下走並死在 `git commit`，狀態 5，一樣不是 0，綠燈是別的機制給的。(2) Codex 指出我第 81 輪為 `snapshot_tips` 失敗寫的測試只碰得到第一次呼叫：shim 讓每次 `for-each-ref` 都失敗，於是在 `git commit` 前就中止，commit 之後那個 handler 永遠走不到——「把那段刪掉，整個套件仍然全綠」
- **Error pattern**: 把「測試通過」當成「該控制措施有效」。兩種失效方式都不會顯示為紅燈：**斷言太寬**（`!= 0`、`ok(x.length > 0)`、`match(/./)`）讓任何失敗路徑都算過關；**分支構不到**（前置條件在抵達目標分支前就中止）讓那段程式碼從未被執行。同一輪我還寫了兩個防禦性檢查（ref 清單比對、loose ref 檔案存在性），事後造不出任何 fixture 能讓它們發揮作用
- **Correct approach**: 每個斷言要釘死**只有被測機制才會產生的那個訊號**——具體狀態碼加上該路徑專屬的診斷字串，不是「非零」。分支若需要前置步驟成功才會抵達，shim 必須是**有狀態的**（放行第 N 次、讓第 N+1 次失敗），否則測到的是另一個分支
- **Prevention**: 三個可執行的檢查。(1) **精確 mutation**：只中性化目標那一行（換成 `true`／`:`），若死掉的測試數不是預期的那幾個，斷言就沒對準——粗糙的 mutation 殺掉 29 個測試，證明不了任何一行。(2) **診斷字串入斷言**：狀態碼會被其他路徑撞上，該路徑獨有的訊息不會。(3) **防禦性程式碼要求 fixture**：新增一個 `if … return` 卻造不出讓它 fire 的情境，就該刪掉——構不出反例的防禦性程式碼不是控制措施，是無法驗證的表面積
- **Source**: 2026-08-02 — create-pr-stacked r2 第 81／82 輪，`snapshot_tips` 與 malformed-ref 測試

## L6 — 審查者在讀檔案時，絕對不能對同一份檔案做 mutation 驗證

- **Context**: smart-commit 硬化第 85 輪。我把 Codex 派去背景做 thorough review，然後在等待期間對 `smart-commit-execute.sh` 連續套用九個 mutation（每次驗完還原並 `diff -q` 逐位元組一致）。Codex 回報一個 **P0 fail-open**：`verify_created()` 裡有 `[ -n "${SEEN_ONE:-}" ] && break`，只檢查第一個 OID 就中止，且 `SEEN_ONE` 未被清除，外部匯出即可讓整個檢查空轉。那正是我第七個 mutation 的內容，檔案上根本沒有它
- **Error pattern**: 把「mutation 一定會還原」當成「這段期間對外可見狀態不變」。背景審查者是**另一個行程**，它讀的是那個瞬間的位元組，不是我還原後的結果。更糟的是這種誤報**完全無法從報告本身分辨真假**——Codex 的推理全對，行號、機制、危害、Anchor Register #4 的歸類都精確，只有它讀到的那份 artifact 是我的
- **Correct approach**: mutation 驗證與外部審查**互斥**。要嘛在派出審查前把所有 mutation 做完，要嘛在 mutation 期間不派審查。若非得並行，就在 git worktree 的獨立副本上做 mutation，讓審查者讀的路徑永遠是穩定的
- **Prevention**: 兩個訊號。(1) **報告裡出現自己 mutation 的字面內容**（哨兵變數名、`SEEN_ONE`、`break` 位置）——先 `grep` 檔案確認是否真的存在，再決定要不要修；不要照著改。(2) Codex 自己給了最強的訊號：它寫「the reported zero-failure suite cannot correspond to the exact script currently present」——**當審查者說「你的測試結果與這份檔案對不起來」，先懷疑檔案在被讀的當下是什麼樣子，而不是懷疑測試**
- **Source**: 2026-08-02 — create-pr-stacked r2 第 85 輪，Codex P0 指向一個只存在於 mutation 期間的哨兵

## L7 — 測試名稱比它的斷言強，是 mutation 造不出反例的盲區

- **Context**: smart-commit 硬化第 86、87 兩輪，Codex 各找到一個同型缺陷。第 86 輪：`dynamicDispatchSites()` 對 dispatcher 回傳 `[]`——那支腳本正是該 oracle 存在的唯一理由，`command --` 藏住了它唯一的派發點。第 87 輪：測試叫「the only absolute executables are the bootstrap **pair**」，但 `absoluteExecutables()` 在真實 executor 上只回傳 `["/usr/bin/env"]`；`/bin/bash` 是 `env` 的運算元，續行合併後整段 re-exec 只有一個命令位置。**把 `/bin/bash` 換成 `/tmp/curl`，測試全綠**
- **Error pattern**: 斷言不是寫錯，是**選取集合的方式讓反例落在集合外**。`found.filter(p => !ALLOWED.includes(p))` 只能證明「沒有意外的」，永遠證明不了「該有的都在」；F1f 用 `^ *<PREFIX>` 挑行，於是永遠挑不到沒有 prefix 的那行。名稱描述的性質比斷言強，而讀的人信名稱
- **Correct approach**: 對「集合」的斷言用 `deepEqual` 釘死**完整預期集合**，不要用 `filter(...)` 加空集合；挑選待檢查項目時，用**位置／結構**（縮排、命令位置、檔案角色）當條件，絕不用「已經合規」當條件
- **Prevention**: 一個可執行的動作——**把 oracle 直接跑在真實成品上，把輸出印出來看**。這類盲區在 fixture 上永遠是綠的，在 mutation 下也可能是綠的（連反例都造不出來，因為造出來的反例落在集合外）。本輪三次探針量測是唯一問得出真話的方法：`node -e 'console.log(oracle(readFileSync(realScript)))'`。任何名稱裡有「pair」「every」「all」「only」的測試，都該先問一次「跑在成品上，它實際回傳什麼？」
- **Source**: 2026-08-02 — create-pr-stacked r2 第 86／87 輪，bootstrap pair 與 F1f 的循環選取

## L8 — oracle 的輸出是待驗證的主張，不是通過的證據

- **Context**: smart-commit 硬化第 91 輪。我把 `codeBearingSegments()` 的輸出跑在真實的 dispatcher 上，印出來看過（這正是 L7 教的動作），把結果貼進 review log，然後照著它寫下釘死清單。第 92 輪 Codex 指出：那份輸出選中的是 `printf '%s\n' bash git mktemp rm`（allowlist 的**資料**）和 `cmd=/bin/bash`（一個賦值），而整支腳本裡唯一交出控制權的 `command -- "$cmd" "$@"` **不在裡面**。三個可執行的 mutant 因此存活
- **Error pattern**: L7 的動作做了，L7 的**問題沒問**。把 oracle 跑在成品上只回答「它輸出什麼」；真正要問的是「輸出的每一列，是否真的具備這個 oracle 宣稱要抓的性質」。我看到兩列合理的 shell，就當成定位器work；沒有逐列問「這一行有執行任何東西嗎？」。根因是**選錯軸**——我以「運算元裡有沒有出現 `bash`／`env` 這些名字」選取，而該選的是「這個 segment 的指令位置是不是一個轉移控制權的操作」。名字是可以算出來的（`"${RUNNER:-bash}"`），也可以完全不出現（`git -c alias.pwn='!…'`）
- **Correct approach**: 定位「會執行東西的地方」時，以**操作**為軸（`.`／`source`／`exec`／`trap`／`command`／`eval`／專案自己的路由函式），並且只看**指令位置**；不要以運算元的拼法為軸。運算元拼法可被計算、被引號拼接、被完全省略，操作不行
- **Prevention**: 兩個。(1) 逐列反問——把 oracle 輸出的每一列讀成「這一列宣稱具備性質 P」，然後對**至少一列**具體檢查 P 是否成立（「`printf` 那行執行了什麼？」）。(2) **反向檢查**：先獨立列出成品裡符合該性質的地方（「哪幾行會執行外部東西？」），再和 oracle 輸出對照——差集就是缺口。只看 oracle 輸出，永遠看不見它沒選中的東西
- **Source**: 2026-08-02 — create-pr-stacked r2 第 91／92 輪，dispatcher 的 dispatch 行沒被定位器選中
