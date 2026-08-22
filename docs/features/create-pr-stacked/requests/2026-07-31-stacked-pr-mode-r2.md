# Stacked PR Mode — r2 v1 實作

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-07-31
> **Status**: In Progress
> **Note**: 不被 r1 的 Q1 阻塞（v1 主路徑為輸出手動 push 指令）；但 Phase D rollout 偵測細節依賴 r1 Q2 的實測結果，實作時以保守降級為預設
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec/2-tech-spec.md)
> **Depends On**: [r1 設計前置與 Preview 實測](./2026-07-31-stacked-pr-mode-r1.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

依 [tech spec](../2-tech-spec/2-tech-spec.md) 實作 `/create-pr --stack` 模式（WBS W1/W2/W2a/W4）：sync 分類先行、chain 驗證、逐層 PR create/edit（可重入）、依賴標記三模式、環境偵測與降級——全程不執行 push/rebase（Anchor #4 零變更）。

## Requirements

- `/create-pr` SKILL.md 新增 `--stack` 模式，行為依 spec §3.3–§3.4（W1）
- 細節承載於 `references/stack-mode.md`，SKILL.md 維持精簡（R6）。**行數上限已於第 54 輪撤除**——`@rules/docs-numbering.md` § Size Limit 現已明文豁免功能性文件，`test/skills/*.test.js` 的 11 個行數斷言隨之移除
- 新增契約測試 + 保留既有 sanitization regression（W2）
- sanitization 由散文改為可執行實作，Step 4b/7b 共用（W2a）
- doc sync：`docs/skill-catalog.yml` + `README.md`（W4）

## Scope

| Scope | Description |
| ----- | ---------- |
| In    | W1（SKILL.md + references）、W2（測試）、W2a（sanitization 可執行化）、W4（catalog sync + README） |
| Out   | W3 `/push-ci --branches` 擴充（待 r1 Q1 裁決後另開票）；自動執行任何 `gh stack` 指令（Won't v1）；auto-merge / merge queue（Won't v1） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/create-pr/SKILL.md` | Modify | 新增 `--stack` 模式入口與摘要 |
| `skills/create-pr/references/stack-mode.md` | New | Phase A–D 細節、依賴標記契約、shell 安全契約 |
| `test/skills/create-pr.test.js` | New | stacked 模式契約測試（spec §6） |
| `skills/create-pr/scripts/sanitize-pr-content.sh` | New | Step 4b/7b sanitization 的可執行實作（樣式取自 `commit-msg-guard.sh`） |
| `test/scripts/sanitize-pr-content.test.js` | New | 該腳本的單元測試（happy path／錯誤／邊界／fail-closed） |
| `docs/skill-catalog.yml` | Modify | create-pr 條目 description 同步 |
| `README.md` | Modify | skill catalog 的 `/create-pr` stacked-mode 條目同步 |
| `test/skills/create-pr-sanitization.test.js` | Modify | 既有 regression 保留，一項改寫為更強斷言（見 AC9） |
| `scripts/commit-msg-guard.sh` | Modify | canonical policy source 的兩個 fail-open 修正（locale、status >1）——見第 32–33 輪 P1 |
| `docs/features/create-pr-stacked/2-tech-spec.md` | Modify | Doc sync：§2 行數、§3.4 契約 7（生命週期擁有者）、§6 fail-closed 路徑數、§4 R6 風險 |
| `docs/features/create-pr-stacked/1-requirements.md` | Modify | NFR-1 的 `allowed-tools` 度量改寫（見下方 Note — NFR-1）、NFR-6 行數更新 |
| `docs/features/create-pr-stacked/requests/2026-07-31-stacked-pr-mode-r1.md` | Modify | 連結格式修正（本需求變更的一部分，故列於此） |
| `docs/features/create-pr-stacked/requests/2026-07-31-stacked-pr-mode-r2.md` | Modify | 本文件：進度與 AC 證據（review 歷程見同層 review log） |

> **路徑變更（2026-08-21 補記）**：上表的 `docs/features/create-pr-stacked/2-tech-spec.md` 是本單
> 動工當時的路徑，保留原文不改。該檔已依 `@rules/docs-numbering.md` § Size Limit 拆為
> [`../2-tech-spec/2-tech-spec.md`](../2-tech-spec/2-tech-spec.md)（主檔）與
> [`../2-tech-spec/1-core-logic.md`](../2-tech-spec/1-core-logic.md)（原 § 3.4 切出）。該列所述
> 的四處同步中，§ 3.4 契約 7 落在切出檔，其餘三處留在主檔。

## Acceptance Criteria

編號為**顯式且穩定**：新增條目不得改動既有編號，其他段落一律以 `AC<n>` 引用（位置式引用會隨條目增減而漂移，先前即已發生）。

- [ ] **AC1** `--stack` dry-run：三層線性 chain 輸出逐層 PR 指令，base 鏈正確，全程無 push/rebase 執行（Signal 1、5）
      — 「無 push/rebase」是**靜態契約驗證**，其涵蓋範圍逐項可查：shell fence（`SHELL_LANGS`，含 `dash`/`ash`/`fish` 等方言）走完整指令文法；非 shell fence 與行內 code span 走 exact-form allowlist，且**綁定 Markdown context**（散文中取得的例外不能授權訊息模板中的同一字串）；未加反引號的散文一律 fail closed（無 form 可綁例外）；縮排 code block 另有獨立檢查。以上四條各由合成 fixture 的 `assert.throws` 釘住。它證明的是「文件中不存在未授權的指令模板」，**不是**「skill 被實際呼叫時不執行 push/rebase」——後者屬 runtime，歸 `/feature-verify`。base 鏈由解析 shipped 範例證明。**dry-run 的檔案語意**：它會建立目錄、寫檔並 sanitize（Step 4b 作用於檔案，預覽出的 body 正是使用者會複製去執行的文字），但**不呼叫 mutating `gh`（`gh pr create` / `gh pr edit`），且在交付報告前自行 teardown**；唯讀查詢（Phase B `gh pr list`、Phase D `gh extension list`）仍會執行——保證的是「不留存」而非「不動作」。依據為 spec §3.4 契約 5、`stack-mode.md` Phase C，以及 `create-pr.test.js` 的 `dry-run runs no mutating gh command and leaves nothing on disk, in both documents` 測試
- [ ] **AC2** Phase A sync 分類依 per-state × per-mode 處置表：ABSENT 中止於 PR 規劃前並輸出待 push 清單；`LOCAL_AHEAD` dry-run 警告續行、`--execute` 拒絕
      — 分類的循環已解除，且探測 fence 現在**逐字執行**：fixture 以 git plumbing（`hash-object`／`mktree`／`commit-tree`／`update-ref`）建 commit graph，再 `clone --bare` 出真實 origin 並以真正的 `git fetch --prune origin` 產生 remote-tracking refs——不使用 `add`／`commit`／`push`／`reset --hard`（Anchor Register #4 封閉清單，測試不能自行開例外）。七種狀態各跑一次 shipped fence 並解析 `local:` / `remote:` / `end:` 區段，斷言 ABSENT 與 remote-only **可區分**（無標記時兩者輸出完全相同，處置卻相反）。另有負控制：拿掉 fence 的顯式 `|| exit "$?"`（**不是** `set -e`——fence 裡沒有 `set -e`，測試自身的註解亦如此聲明，見 `test/skills/create-pr.test.js` 的 `a failed fetch aborts Phase A instead of classifying stale refs`），失敗的 fetch 後探測仍讀到過期 ref 且回報 0——缺陷確實會重現。開發中此測試亦抓到 `git rev-parse --verify --quiet -- 'refs/…'` 的 `--` 缺陷。**仍缺**：per-mode 處置（ABSENT 真的抑制後續 PR 規劃、`--execute` 真的拒絕）尚未行為驗證
- [ ] **AC3** Phase B 驗證：ancestry（`merge-base --is-ancestor`）、PR 政策（`--state all --limit 100`，OPEN-且-base-相符或 ABSENT）、非線性/單層/空 chain 依 spec 處置（Signal 4）
      — **證據不足（Unit 缺口，非 Manual）**：多為「指令與政策字串存在」斷言；缺 stubbed `gh pr list` fixture。`--limit 100` 已補（預設 30 會讓第二頁的衝突 PR 被讀成不存在），但仍只有字串斷言
- [ ] **AC4** 依賴標記依情境正確（dry-run：下層 PR 已存在用 `#N`、ABSENT 用 branch 標記；execute 用 `#N`；update 將 branch 標記升級為 `#N`），無未解析佔位符
      — **證據不足（Unit 缺口，非 Manual）**：驗證政策表格內容，未實際產生 body 比對。（AC5 的逐層測試已附帶證明 `Stacked on #N` 標記在 sanitization 後仍存活，但未涵蓋四種情境的選擇邏輯）
- [x] **AC5** 逐層 Step 4b sanitization 與 execute 模式 Step 7b 生效（Signal 3）
      — sanitization 已由散文改為**可執行實作**：`skills/create-pr/scripts/sanitize-pr-content.sh`，三條樣式於執行期自 `scripts/commit-msg-guard.sh` 讀出（腳本不得自帶樣式，有測試釘住）。fail-closed 七路徑皆有測試：樣式來源缺失、讀到 0 條、讀到的樣式數少於宣告數（只執行部分政策與執行全部政策，從呼叫端看完全相同）、陣列中出現本 parser 不認得但 bash 合法的條目（`"雙引號"`／`$'ANSI-C'`——只數「認得的行」會讓兩個計數一致，而該樣式已悄悄停止生效）、`grep` 無法回答（exit ≥2：無效 ERE、讀取失敗——先前被當成「無匹配」，是 fail-open）、、`awk`／`cat`／`mv` 失敗（正規化為 2，不讓工具自身的狀態碼撞上腳本已賦予意義的 1），以及**呼叫端 locale 下的位元組失效**（第 32–33 輪新增，見下方該輪紀錄）。診斷**只輸出行號與命中的樣式編號，不回顯該行內容**：PR body 是可被外部影響的文字，`Generated by GPT-4; token=…` 這類行會把憑證寫進 log（`rules/security.md` Anchor）。
      **可執行串接已補齊**（先前兩份 review 皆指出測試自行補了 shipped 工作流缺少的步驟）：`body-inplace` 模式由腳本自己原子寫回（`… body file > file` 會在讀取前清空輸入檔），Step 7b 則以 shipped fence `gh pr view … > '<PR_BODY_DIR>/published.txt'` 自行產生待掃描檔案。行為驗證四項：**(a) 逐層** — 三層 chain 以未經處理的敵意 body 起始（三種樣式各一），逐層跑 shipped `body-inplace` 後執行 shipped 逐層 block，由 stub `gh` 錄下實際收到的 bytes，斷言發布內容皆不匹配三條樣式、無辜行與 `Stacked on #N` 存活、各層內容互異、每層 block 後自己的 body 檔已刪除；**(b) 敵意標題** — 偵測 → 重新生成一次 → 仍敵意 → HARD FAIL，並斷言 `gh` **完全未被呼叫**（以呼叫紀錄證明，非以文件字串證明）；**(c) Step 7b 完整循環** — 驗證循環（V1 建立目錄／V2 capture fence／V3 scan／V4 teardown）在 SKILL.md 只定義一次、由 Step 1–2 與 Step 4 兩度引用，測試也**跑兩次同一個 shipped fence**：第一次 capture（stub `gh pr view` 供料）→ `scan` 偵測到洩漏 → 以 **Step 4b 的乾淨快照**（非洩漏出來的 capture，Step 3 guardrail 2）經 shipped guarded `gh pr edit` block 重新發布 → **第二次跑同一個 capture fence**，掃描 GitHub 現在持有的內容而非測試手上的請求副本（stub 的 `pr view` 會反映 `pr edit` 的結果）。以變異驗證非空轉：把重新發布的內容改回帶 trailer，本測試會失敗。**(d) capture 失敗的清理** — redirect 在 `gh` 執行**前**就開檔，因此失敗的 capture 仍會留下部分快照；測試讓 stub `pr view` 失敗，斷言檔案確實存在、shipped teardown fence 以 `gh` 自己的狀態碼收尾且目錄不殘留
- [x] **AC6** shell 安全契約落實（escaping、option terminator、**heredoc 全面禁用**），且 shipped block 於真實 shell 可執行
      — 靜態契約驗證（授權掃描 + operation grammar）加上實際執行。**各案的 shell 涵蓋範圍不一致，逐案列出以免概括失真**：基本 `errexit` block 與呼叫端 `readonly STATUS` 為 `bash`；敵意 `IFS` 為 `bash`/`sh`/`zsh`；cleanup 狀態優先（`gh` 37 + `rm` 5 → 37；`gh` 0 + `rm` 5 → 5）與 teardown 狀態傳遞（層失敗 37 + cleanup 成功 → 37；全成功 + cleanup 失敗 5 → 5，且目錄確實殘留；兩者皆失敗 → 37）為 `bash`/`sh`/`zsh`/`dash`；Phase A 兩道 fence 為 `sh`/`bash`/`zsh`，且置於會停用 `errexit` 的 status-tested 呼叫脈絡（該抑制是 POSIX 行為，四種 shell 皆同——非 zsh 特有，見第 32 輪修正）。另驗證 body 檔未寫入時必須失敗。`--` 的適用範圍已修正為「CLI 接受之處」——`git rev-parse` 不接受
- [ ] **AC7** 降級路徑：`gh-stack` 未安裝/未 rollout → 明確訊息 + Multi-PR 模式下依模式選用的標記（Signal 2）
      — **證據不足**：grep Phase D 敘述；未 stub `gh extension list` 三種結果
- [ ] **AC8** `test/skills/create-pr.test.js` 涵蓋 spec §6 的 Unit 案例
      — `node --test test/skills/create-pr.test.js` 回報 **105 tests / 0 fail / 0 skipped**（本機）。**維持未勾選**：本文件 AC2／AC3／AC4 自陳仍有 Unit 缺口（per-mode 處置、Phase B PR 政策的 stubbed `gh pr list` fixture、依賴標記四情境的選擇邏輯），而那些正是 spec §6 的 Unit 範圍——不能同時宣告「已涵蓋 §6 Unit 案例」。已達成的是「§6 列出的契約皆有對應斷言，且行為型案例逐字執行 shipped fence」，涵蓋率的完整宣告待上述三項補齊
- [x] **AC9** 既有 `create-pr-sanitization.test.js` 無刪減
      — 20/20 保留，一項改寫為更強斷言；`test/scripts/sanitize-pr-content.test.js` 另有 42 tests / 0 fail
- [x] **AC10** 全 suite 通過（Signal 6）
      — `node --test $(find test -name '*.test.js')` 回報 **3189 tests / 3183 pass / 0 fail / 6 skipped**（本機；skip 皆為既有無關檔案）
- [ ] **AC11** 模擬第二層失敗：輸出各層狀態，重跑不重複建立（Signal 7）
      — shipped block 的 fail-stop／cleanup／exit status 已實際執行驗證；「各層狀態輸出」與「重入不重複」仍靠 test-local simulator，缺 `/feature-verify`
- [ ] **AC12** Stack 狀態表：FR-6／UC-3 把它定為 stack 執行的終端輸出，`2-tech-spec.md` §3.1 圖的兩條分支也都收在它上面
      — 先前**三處指定、零處定義**：`stack-mode.md` 與 `SKILL.md` 都沒有這張表的契約，唯一的逐層報告是失敗路徑的 succeeded／failed／pending 一行字。已於 `references/stack-mode.md` § Stack status table 定義欄位（`#`／`Head`／`Base`／`PR`／`Commits`／`Sync`／`State`）與兩項使其成為報告而非成功訊息的性質：**每一個宣告的層都要列**（提前中止的 run 也要列它沒走到的層）、**dry-run 與 `--execute` 皆輸出**。`Sync` 欄承載 Phase A 的原始分類值而非 yes/no——`DIVERGED` 與 `REMOTE_AHEAD` 的補救方式不同。契約由 `create-pr.test.js` 的 `stack mode defines the status table its requirements make the run's report` 釘住（欄位、兩項性質、六個 sync 值逐一斷言）。**維持未勾選**：已達成的是「契約已定義並由測試釘住」，而 AC 的敘述是「終端輸出」——實際 render 的 runtime 驗證仍缺，歸 `/feature-verify`。AC1／AC2／AC11 都因同一類缺口維持未勾選，AC8 自己的理由也是「不能在缺口仍在時宣告已涵蓋」，此處不另立標準
- [ ] **AC-Q1** Pass /codex-review-fast — round 27 ⛔ Blocked（3×P1 + 5×P2，thread `019fb9e4`），同輪 doc review ⛔ Needs revision（3×P1 + 5×P2 + 1 Nit，thread `019fb9e6`）。
      本輪 reviewer 以對抗性實測抓到兩個真實缺陷，皆已修並附「不修就會紅」的回歸測試：**(1) 繼承的 `xtrace` 讓 redaction 失效**——`SHELLOPTS=xtrace` 時 bash 會把整行匹配內容（可能含 token）寫進 stderr，早於 report() 的去識別化輸出；腳本開頭改為 `set +x` / `set +v`（Anchor Register #2）。**(2) `tr` 失敗會把好的 body 換成骨架**——空白判斷藏在命令替換裡，`tr` 失敗即無輸出、讀作「空」，`body-inplace` 隨即原子覆寫；改為先落變數再判斷，失敗一律 2。
      其餘已修：Phase A 只有探測、沒有可執行的分類器（補第二道 fence，印原始狀態碼而非 yes/no，128 不得讀成「no」）；dry-run「不呼叫任何 `gh`」是錯的契約（Phase B `gh pr list`、Phase D `gh extension list` 都是唯讀且必要——契約收斂為「不執行 mutating `gh pr create/edit`」）；dry-run「原樣貼上可執行」不可能成立（`<PR_BODY_DIR>` 需替換，已在文件與 NFR-3 誠實敘明）；Step 7b 測試改為四步皆執行 shipped fence（V1/V3/V4 先前用 Node 等價物），且 remediation block 改由 7b 段落內選取；auto-detect 補上起點（當前 branch 為 top layer）；`git fetch` 的 `[DEVIATION]` 改為 skill 每次執行都要輸出，不再只是開發期記錄；sanitizer 自身的 heredoc 移除（改用 process substitution），使「全面禁用」與實作一致並補測試；NFR-1「不得誘導執行」與「輸出指令供使用者執行」的自相矛盾已界定為「執行者是誰」；FR-4／NFR-5 改為誠實敘述 v1 無法查詢 rollout；W4 範圍、references 行號、測試計數、zh-TW 用詞（刷新→更新、配置→建立目錄）皆已同步。**第 28 輪再修**：sanitizer 的樣式擷取改為先賦值再判定（`while … done < <(… | sed …)` 會丟棄 producer 的離開狀態，一個先印出弱化樣式再失敗的 `sed` 會被讀成「乾淨」，已補專屬回歸測試）；ancestry fence 補上 `[ "$1" = 0 ] || [ "$1" = 1 ]` 狀態再拋（原本 128 會被捕捉、印出並接上 `end:`，fence 以 0 收尾），並新增**實際執行 shipped fence** 的測試（先前只有模擬器，會把 128 併入「no」），含負控制；三份文件中殘留的「不呼叫任何 `gh`」全數收斂為「不呼叫 mutating `gh`」，且測試改為**同時禁止**未收斂的說法（只斷言正確句存在無法擋掉舊句）；`stack-mode.md` 行數 306→332、rollout 契約（FR-4／NFR-5／A-2）改為「不可查詢即不列為偵測項」。**第 29 輪再修**（Codex 額度耗盡，改由本地嚴格審查代理獨立研究後提出，證據來源已於此註明）：sanitizer 的 `PLUGIN_ROOT` 覆寫是**政策來源可被環境變數掉包**的完全繞過——腳本與 SKILL.md 三處都聲明「無環境覆寫」，實測卻能以三條永不匹配的樣式讓真實 trailer 掃描為 exit 0；改為只由腳本自身位置解析，測試 harness 亦改為把腳本複製進偽 plugin tree（原本的注入機制正是該漏洞本身，使那條「無環境變數可弱化政策」的測試不可能失敗）。另修：`'A' 'B'` 單行兩條樣式為合法 bash 卻被併成一條錯誤 regex 且三道計數守衛全數同意；body 含 NUL 時 `grep` 改印 `Binary file <path> matches`，移除模式因而回報 `[AI_STRIPPED]` 卻一行未刪且把路徑寫進只該印位置的診斷（補 `-a` 與位置格式驗證）；Phase A 兩道 fence 的 `set -e`-in-subshell 在呼叫端測試狀態時失效（第 32 輪修正歸因：這是 POSIX 行為，`bash`／`sh`／`zsh`／`dash` 皆同，並非 zsh 特有——原先的歸因來自只量了 zsh 而未設 bash 對照組），改為顯式 `|| exit`，並新增跨 shell、且置於會停用 errexit 的呼叫脈絡的測試。以上五項守衛皆以變異驗證（還原缺陷後測試必紅）。**第 30 輪**（同一代理帶原 context 驗證修法）：五項確認關閉，但 `$0` 解析仍留一條 symlink 路徑——`dirname -- "$0"` 是呼叫者用的路徑而非檔案位置，經 symlink 或相對 `$0` 呼叫仍可選到弱化的 guard（實測 exit 0），已改為先解 link chain 再 `cd -P`/`pwd -P`，並誠實敘明「腳本被**複製**進偽 tree」是任何自我定位機制都無法防的（測試 harness 正是靠這點）。另修：新加的格式檢查用 `… | grep -q` 會在第一行就結束、`printf` 吃到 EPIPE，`pipefail` 下 `&&` 因而永不觸發——輸出超過 pipe buffer（實測 20 萬行）時檢查形同不存在，改為在函式自身 shell 內逐行讀取（process substitution）；`stack-mode.md` 兩處仍引用同一次編輯已移除的 `set -e`。
- [ ] **AC-Q2** Pass /precommit — 待 code review 通過後重跑

**Note — 工具限制（非本需求變更）｜已於 2026-08-04 關閉**：`scripts/check-comment-blocks.js` 曾把行首的 `/*` 一律當作 C 區塊註解開頭，因此 shell 的 `case "$x" in /*)` 會讓其後整個檔案被算成單一註解區塊（當時實測 236 行誤報）。本需求以參數展開改寫規避，未修改該檢查器。**該檢查器已在 auto-loop-autonomy 需求中修正**：`COMMENT_BY_LANG` 依副檔名解析註解語法，`.sh` 只計 `#`，由 `test/scripts/check-comment-blocks.test.js` 的 `case $x in /*)` 案例釘住。`run-skill.sh` 與 `sanitize-pr-content.sh` 的參數展開保留（本身即合法的 POSIX 絕對路徑判斷），但兩處註解已改寫，不再以此缺陷為理由。

**Note — 工具限制之二（非本需求變更）**：`precommit-runner.js` 會把執行摘要寫成 `.claude/cache/precommit/<repo>/<sha>/summary.md`，而 `.markdownlint-cli2.jsonc` 的 `ignores` 只排除 `node_modules/**` 與 `.git/**`，故該產物本身會違反 MD022／MD031。之所以一直沒被發現，是因為 `lint:fix` 會就地修好上一輪留下的檔案、接著本輪再寫出一份未修的——`/precommit` 因此恆為 PASS，只有唯讀的 `npm run lint:md` 會顯示失敗（實測：清空快取後 `lint:md` 為 0 issues，跑一次 precommit 後即出現至少 1 個錯誤，本次實測 10 個：MD022 ×6、MD031 ×4，數量隨快取中殘留的摘要檔數而變）。修法是在 `ignores` 加入 `.claude/cache/**`。本需求未修，應另開需求單。

**Note — 審查者替換（`[DEVIATION]`）**：

```text
[DEVIATION] rule=rules/auto-loop.md § Review Dispatch（並涉 rules/codex-invocation.md 全文）
default=code review 預設一律由 Codex 執行，且 Codex 須自行研究專案
chosen=第 29 輪起改由本地獨立嚴格審查代理執行，深度維持 thorough
reason=Codex 憑證不可得，但 Anchor Register #5／#6 要求審查轉換確實發生且深度不得降低
signal=mcp__codex__codex 於 2026-07-31 兩次回傳 usage limit（恢復時間 2026-08-06 14:04）
```

本需求第 29 輪起的 code review 不是由 Codex 執行。事實訊號：`mcp__codex__codex` 於 2026-07-31 兩次回傳 usage limit（訊息顯示 2026-08-06 14:04 恢復），該憑證非本地可取得。依 `rules/discretion.md`，`auto-loop.md` § Review Dispatch 的「預設由 Codex」屬 Default 層，Anchor Register #5／#6 要求的是**審查轉換確實發生**且深度不得降低，未指定審查者身分，故改由本地獨立嚴格審查代理執行，深度維持 `thorough`（P0／P1／P2 皆阻擋）。此註記存在的理由是證據來源必須可追溯。**替換終止於第 34 輪**：使用者於 2026-08-01 告知額度已補充，訊號消失，審查者即回到 `auto-loop.md` § Review Dispatch 的預設（Codex），第 29–33 輪的代理報告降為佐證。Codex 複審的起點是第 29–33 輪的五份報告與本輪 delta，不是本文件的結論。

**Note — 已記錄未修的 sub-threshold findings**（依 `@rules/auto-loop.md` § Sub-Threshold Findings，記錄後放行，不另開一輪）：
- ~~`skills/create-pr/references/stack-mode.md` 沒有像 `SKILL.md` 那樣的 500 行上限回歸測試。~~ **已撤回（第 55 輪）**：規則本身澄清後，`skills/**`（含 `references/*.md`）是 functional document，明列豁免於 500 行上限；缺的不是測試，是那條上限從來就不該套用在這裡。`SKILL.md` 側的 11 個行數斷言已一併刪除。
- 本文件 AC6 的證據段落把第 27–31 輪的 review 歷程壓在單一 bullet 內（約 4000 字），`@rules/docs-writing.md` 偏好表格；較佳形式是獨立的 § Review History。屬可讀性，不影響事實正確性。

**Note — 第 31 輪 code review**（同一代理第三次驗證，AC-Q1 的延續證據）：無 P0／P1。symlink、相對 `$0`、symlink 過的上層目錄、PATH 裸呼叫、`exec -a` 偽造 argv[0] 全數實測 exit 4；pipe-buffer 修正於 `title`／`scan`／`body`／`body-inplace` × {3 行, 20 萬行} 共 8 組皆 exit 2 且 stdout 為空；良好輸出的行為（含本文含 `:` 的行、單行命中兩條樣式）未改變。唯一殘留為**說法的邊界畫錯**：hardlink 是同一個 inode、`[ -L ]` 對它為 false，卻與 copy 一樣能選到旁邊的 guard，而原註解把界線畫在「不同的檔案」。已改為誠實敘明「任何路徑不等於本檔案真實位置的呼叫（copy、hardlink、任何被植入的 tree）都無法防」，並指出真正成立的控制是 `scripts/run-skill.sh` 以自身 `BASH_SOURCE` 組出絕對 `TARGET`；`SKILL.md` 同步。symlink 解析迴圈補上 40 跳上限（防禦性——symlink cycle 會先在 kernel exec 時 ELOOP）。待重審

**Note — 第 32–33 輪 code review／doc review**（同一代理，程式與文件兩面各一份獨立報告）：兩份皆 Blocked，且抓到的是前 31 輪全部沒抓到的東西。

- **P0（程式）locale 造成的完全繞過**：`grep -Eina` 跑在**呼叫端 locale**。UTF-8 locale 下 BSD grep（`/usr/bin/grep`，macOS 預設、也是本 repo 的環境）對「含無效 UTF-8 位元組的行」回傳 **1**——而 1 是「乾淨」分支，不是「無法回答」分支。實測：body 的 trailer 行為 `Caf\xe9 Co-Authored-By: Claude <…>` 時，`scan`／`title`／`body-inplace` 全部 exit 0，trailer 原封不動發布。commit message 帶 latin-1 位元組是日常，而 PR body 由 commit message 生成，因此這是可達的繞過而非理論值。修法 `LC_ALL=C grep`；回歸測試含負控制（拿掉 `LC_ALL=C` 即重現 exit 0）與反向控制（`中文`／`Café` 等合法 UTF-8 內容不得誤判）。**歸因更正**：我第一次驗證時互動 shell 的 `PATH` 指向 GNU grep、兩種 locale 都匹配成功，據此一度判定審查者有誤；改以 `/usr/bin/grep` 對照後確認審查者正確。
- **P1（程式）canonical policy source 同病**：`scripts/commit-msg-guard.sh` 的 `grep -Eqi "$pat" … 2>/dev/null` 有兩個 fail-open——同一個 locale 問題，加上把**所有**非零狀態讀成「無匹配」（無效 ERE 或 I/O 錯誤即 status 2，診斷還被丟棄）。同一份檔案在 sanitizer 放行後，commit hook 也一樣放行。已改為 `LC_ALL=C grep -Eim1`、不吞 stderr、status >1 一律拒絕該次 commit。`commit-msg-guard` 測試 22/22 通過（新增：latin-1 trailer 必須擋下、拿掉 `LC_ALL=C` 即重現繞過的負控制、無效 ERE 必須拒絕該次 commit、以及釘住致命分支的 fixture 前提）。
- **P2（程式）`<PRIOR_STATUS>` 的算術再求值**：teardown fence 的 `exit "$(( $1 ? … ))"` 會把 `$1` 的**內容**當算術式再求值，而該 placeholder 是唯一未加單引號的。第一次修法（加 `case` 位數守衛）被自己寫的測試打穿：未加引號的 `set -- <PRIOR_STATUS>` 在**代換當下**就執行了注入，守衛根本輪不到。正解是**取消這個豁免**——三處 fence 一律 `set -- '<PRIOR_STATUS>'`，`case` 守衛留作第二層（`$(( ))` 對加引號的數字字串照常運作）。測試以四種 shell 斷言注入不執行且退為 2，負控制拿掉守衛則確實執行並 exit 0。
- **P2（程式）宣告數與解析數的檢查無測試守護**：把該行註解掉，38 個測試全綠。已補「空條目」fixture（陣列中一行僅有一組空的單引號）（唯一只會觸發這道檢查的形狀），並變異驗證。
- **P1（文件）`gh pr edit` 帶 `--base`**：§3.1 圖寫 `gh pr edit（既有 PR，base=下層 head）`，與 `stack-mode.md` 的「edit 不重送 `--base` 是安全性質」及本 spec §6 授權列直接衝突。已改為「僅 title/body，不重送 `--base`」。
- **P2（文件）Phase C 缺 title 檔**：stack mode 全篇未提 `pr-title.txt`，但 Phase C 重用 Step 4b，其 `title` 模式吃的是**檔案**——照文件實作會 `die "file not found"`，每一次 stack 執行都 fail-closed 中止。已定義**逐層** `pr-title-<N>.txt`（單 PR 模式只有一個所以叫 `pr-title.txt`；共用一個名字會讓殘留檔是最後一層而非失敗那一層的），測試 fixture 同步。
- **P2（文件）FR-6 狀態表三處指定、零處定義** → 見 AC12。
- **P2（文件）短 ref 與 `--` 的無條件敘述**：§3.2／§3.4 用 `origin/<head>` 等短 ref，與 shipped 契約要求的 fully-qualified ref 相反（短 ref 可能解析到同名 tag）；§3.4 的 `--` 寫成無條件，而 shipped 契約是「限該 CLI 接受之處」——`git rev-parse` 不接受，加上去會讓每一層都誤判為 `NO_SUCH_BRANCH`。兩者皆已同步。
- **P2（文件）§3.4 契約清單的編號斷裂**：兩組各自從 1 編到 3，中間夾四個 `4a.`–`4d.`（Markdown 根本不當成清單項），渲染出來是 `1. 2. 3.` → 四段散文 → `1. 2. 3.`。已改為連續 1–10；引用該清單的他處同步為「§3.4 契約 7」。

**Note — 測試計數的可重現性**：上列計數為本機執行結果，未留存為 artifact；重驗請重跑同一指令。**需可寫入的暫存目錄**——所有 runtime 案例都會 `mkdtemp`，在唯讀沙箱中會以 `EPERM` 失敗，且**不會**顯示為 skip，因此「`skipped 0`」不足以反駁沙箱限制（先前版本曾如此主張，是錯的）。

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | done   | tech spec ✅ Mergeable（r1） |
| Development | in progress | W1/W2/W2a/W4 皆完成：SKILL.md + `references/stack-mode.md` + `scripts/sanitize-pr-content.sh` + catalog/README sync + 契約與行為測試（行數見下方 Note）。spec §5 明列的「sanitization 逐層套用」已由散文改為可執行實作並行為驗證（見 AC5）。第 27 輪的 code review 與 doc review findings 已全數修正，第 28–34 輪續修。第 35 輪 Codex 找出三個 P0、第 36 輪再找出兩個更上游的 P0、第 37 輪再找出兩個 P0 與三個 P1（皆為環境／pipeline／解析層的 fail-open，非邏輯錯誤），第 38 輪確認前述繞法全數關閉，另指出兩個**由本輪修正自身引入**的迴歸與一個解析期阻斷，已修正並補測試，待重審 |
| Testing    | in progress | 契約測試 109/0 fail、sanitizer 87/0 fail、既有 sanitization regression 20/0 fail、`commit-msg-guard` 83/0 fail、`run-skill` 25/0 fail（第 34 輪新增 4 個 fail-closed 案例——原本的 18 個在修正前後同樣全綠，證明不了那個修正；第 35 輪再增環境層與內容隱蔽案例），全 suite 3286 tests／3280 pass／0 fail／6 skipped（本機）。開發過程另以臨時 mutation 腳本反覆檢查各項守衛（revert 每個修正、注入敵意 fence），但該腳本未入庫、無留存產物，**故不列為證據**；能長期守住這些檢查的是入庫的合成 fixture 測試（`assert.throws` 直接驅動 sweep 函式）與負控制（拿掉守衛後缺陷必須重現）|
| Acceptance | -      | 待 `/feature-verify` 補齊 runtime 證據 |

**2026-08-21 依 § Write-Time Budget 移出兩段，整段搬移未改寫，去向均為
[`../review-log-stacked-pr-mode-r2.md`](../review-log-stacked-pr-mode-r2.md)**：第 35–37 輪的 P0/P1 鏈、
測試機制修正、NFR-1 度量、AC 粒度、Adequacy Gate、未關閉缺口分類 → § 逐輪 review 記錄；切分決議、
切點量測與雙向連結修復清單 → § 2026-08-20 round 16。兩檔皆 tracked，`git diff HEAD` 可逐行複核。

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec/2-tech-spec.md) §3.3–§3.4、§5、§6
- Requirements: [1-requirements.md](../1-requirements.md) §5、§8
- Sibling: [r1 — 設計前置](./2026-07-31-stacked-pr-mode-r1.md)

## Review Log

**第 38 輪起**的逐輪紀錄（findings、處置、變異驗證、撤回的宣稱）在
[../review-log-stacked-pr-mode-r2.md](../review-log-stacked-pr-mode-r2.md)（索引與最新一輪；較早輪次
在其同名子目錄）。**第 27–37 輪不在本節**：散見於 `## Acceptance Criteria`（AC-Q1 本體、審查者替換
說明及其後的 review Note）與 `## Progress`（狀態表與 Note），形式不一致，第 34 輪無獨立條目。
