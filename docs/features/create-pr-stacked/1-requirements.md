# Requirements: create-pr Stacked PR Mode

> **Doc class**: Lifecycle — Phase 1 requirements (per `@rules/docs-numbering.md`). Feature-level problem-space analysis. **Not** a task tracking ticket; for per-task progress tracking see `requests/*.md` (created via `/create-request`).
> **Created**: 2026-07-31
> **Updated**: 2026-07-31
> **Tier**: standard
> **Tech Spec**: [2-tech-spec.md](./2-tech-spec.md)
> **Request tickets**: See [`requests/`](./requests/) for per-task execution tracking

## 1. Problem Statement

多 Agent、同 repo、功能彼此相依的開發模式下，Agent 產出速度遠快於 code review 消化速度。現行 `/create-pr` 對相依 PR 只有兩個弱支援：Edge Case 表的「Stacked PRs (B → A → main) → body 註記 `Stacked on #N`」（SKILL.md § Edge Cases 的 “Stacked PRs (B → A → main)” 一列）與 Multi-PR Mode 的依序建立（同檔 § Multi-PR Mode）。此處刻意不引行號——SKILL.md 在本需求落地期間反覆增修，行號會在文件還沒改到時就先失效。GitHub 已於 2026-07-30 將原生 Stacked Pull Requests 推入 public preview（含 `gh-stack` CLI extension），提供正式的 stack 建模：每層 PR 只顯示該層 diff、底層 merge 後自動 re-target、branch protection 依 stack 最終目標 branch 套用。`/create-pr` 需要一個 stacked 模式，把「建立/更新一條 PR 鏈」變成一等公民操作，而不是手工逐一建 PR 再靠 body 註記表達依賴。

### 5-Why Trace

1. Surface: 在 `/create-pr` 提供 GitHub 原生 Stacked PR 模式。
2. Why: 大功能若走單一巨型 PR，reviewer 無法有效審閱；手動 stacked branches 需要不斷調 base、rebase、force-push，而現行 skill 只以文字註記模擬依賴，GitHub 端不知道這是一條 stack。
3. Root: 讓 Agent 產出的程式碼被切成「可理解、可審核、可依序落地」的變更鏈 — worktree 負責隔離執行環境，stacked PR 負責交付端的依賴、review 與 merge 順序，維持 review 品質不被產出速度壓垮。

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| `/create-pr` 能對一條線性 branch chain 產生每層一個 PR 的 stacked 輸出（含正確的 base 鏈） | 取代 `/epic-merge`（合併端 squash-merge chain）— 兩者關係另行評估 |
| 偵測既有 stack 並支援逐層 update（title/body 更新） | 自動執行 `gh stack rebase` / `gh stack push` / cascading rebase（見 Constraints — Anchor #4） |
| `gh-stack` 未安裝或 repo 未被 preview rollout 涵蓋時，明確降級至現行行為 | auto-merge / merge queue 整合（官方文件目前互相矛盾，preview 階段不納入） |
| 每層 PR 沿用 Step 4b AI sanitization 與 Step 7b post-verify | cross-fork stack（GitHub 目前不支援） |
| 保持 dry-run 為預設、可複製貼上執行 | 制定全團隊強制 stacked 規範（preview 階段僅提供工具，不定政策） |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| 開發者（skill 使用者） | User | 一條指令產生整條 stack 的 PR；dry-run 可預覽；失敗訊息明確 |
| `/create-pr` skill 維護者 | Developer | 新模式不破壞現有 create/update/dry-run/execute 矩陣；SKILL.md 行數與複雜度可控 |
| `/epic-merge` | Dependent | 同樣定義「linear stacked PR chain」；native stack 的 merge 語意（merge PR N 連帶合併其下所有層）與其手動 `rebase --onto` 流程重疊，需釐清分工 |
| `/pr-summary` | Dependent | 現以「base 非 main/master/develop」啟發式偵測 stacked PR（`skills/pr-summary/SKILL.md` § Workflow → 1. Run Script（`Detect` 列））；native stack metadata 出現後偵測方式需對齊 |
| `/push-ci` + `pre-push-gate.sh` | Dependent | push 是其獨佔授權工作流；stacked 模式任何 push 需求都必須經過它或維持 dry-run |
| Anchor Register #4（`rules/discretion.md`） | Governance | `gh stack rebase/push/submit` 內含 rebase 與 force-push；例外清單封閉，不得由 skill 自行擴充 |
| CI（GitHub Actions） | Operator | 每層 PR 各觸發一次 workflow，五層 stack 的 CI 成本可能 5 倍；cascading rebase 再放大 |
| Reviewer（人類或 Codex） | User | 每層只看該層 diff；rebase 改寫 SHA 可能使舊 review comment 錯位、approval 失效 |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|-------|--------|-----------------|
| UC-1 | 開發者 | 對已存在的線性 branch chain（A→B→C，皆已 push）執行 stacked 模式 dry-run | 輸出每層一個 PR 的建立指令，base 鏈正確（A→main、B→A、C→B），並標示 stack 歸屬 |
| UC-2 | 開發者 | stack 中某層有新 commit 後要求更新 | 受影響各層 PR 進入 update mode，逐層重新產生 title/body 並顯示 before/after diff |
| UC-3 | 開發者 | 在已有 native stack 的 branch 上執行 `/create-pr` | 偵測到 stack，輸出 stack 狀態表（層序、head/base、PR 編號、狀態）而非誤建重複 PR |
| UC-4 | 開發者 | 在未安裝 `gh-stack` 或 repo 未被 rollout 涵蓋的環境執行 stacked 模式 | 明確訊息說明缺什麼 + 降級為現行 Multi-PR Mode；body 依賴標記依模式調整（下層 PR 已存在 → `Stacked on #N`；尚未建立 → 下層 branch 名標記），不留半完成狀態 |
| UC-5 | 開發者 | stacked 模式下任一層 title/body 含 AI attribution | 該層照常走 Step 4b sanitization（title regenerate/fail、body line-strip + `[AI_STRIPPED]`）與 Step 7b post-verify |
| UC-6 | 開發者 | 對非線性依賴（DAG）或互不相依的 branches 要求 stacked 模式 | 拒絕並說明 stack 僅適合線性依賴，建議個別 `/create-pr` |

## 5. Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | 提供 stacked 模式進入點（旗標或 branch-chain 引數），對線性 chain 產生每層一個 PR，base 鏈正確 | Must | 核心價值：把依賴建模交給 GitHub，取代 body 註記 |
| FR-2 | 所有 stack 操作預設 dry-run，輸出可複製貼上的指令；`--execute` 僅沿用現行已授權的 `gh pr create` / `gh pr edit`（`skills/create-pr/SKILL.md` Step 5a 與 Steps 6-7 既有契約；同前，以節名而非行號引用），branch push / rebase / force-push 一律不執行 | Must | Anchor #4 禁止清單是 git mutation（push/rebase 等），不含 `gh pr create/edit`；後者已是現行 execute 模式的一部分（見 Constraints C-1） |
| FR-3 | 每層 PR 的 title/body 套用 Step 4b AI sanitization；execute 模式套用 Step 7b post-creation verify | Must | Anchor Register #4 的 no-AI-attribution 規則涵蓋 PR title/body，逐層皆是一個 PR |
| FR-4 | 前置偵測 `gh-stack` extension 是否安裝（`gh extension list`）；rollout 涵蓋**不列為可偵測項**——目前沒有已確認的查詢訊號（tech spec §7 Q2），因此 v1 的要求是「rollout 未確認即視同缺件」。兩者任一缺件 → 明確訊息 + 降級為現行 Multi-PR 行為；native 路徑在 Q2 有答案前是刻意不可達的，而非未實作 | Must | Public preview 逐步 rollout（2026-07-30 起），環境不齊是常態而非例外；本機目前即未安裝（`gh extension list` 實測） |
| FR-5 | 拒絕非線性輸入：chain 驗證失敗（層間無真實 ancestry 關係、既有 PR 已關閉/已合併/base 不符）→ 中止並說明；working tree dirty 僅警告不中止（資料來源為 fetch 後的 remote refs，本地未提交內容不影響輸出） | Must | stack 僅適合線性依賴；`/epic-merge` Phase 0 有同型驗證可對齊，但其 dirty-tree 中止是 checkout/rebase 流程所需，不適用於純遠端 PR 操作 |
| FR-6 | stack 狀態表：層序、PR 編號、head/base、unique commits、state | Should | 使用者需要一眼看懂 stack 現況；`/epic-merge` chain table 已有同構輸出 |
| FR-7 | update mode 支援 stack：偵測既有 stack 的各層 PR，逐層執行現行 update 流程（smart diff、只更新變動欄位） | Should | stack 生命週期長，更新是高頻操作 |
| FR-8 | 與 `/pr-summary`、`/epic-merge` 共用 stack 偵測約定（同一條 chain 的定義與偵測來源一致） | Could | 避免三個 skill 各自實作互相矛盾的啟發式 |
| FR-9 | 自動執行 `gh stack rebase --upstack` / `gh stack push` / `gh stack submit` / `gh stack modify` | Won't (v1) | 內含 rebase 與 force-push，落在 Anchor Register #4 禁止清單；例外清單封閉，擴充本身是 Anchor-level 變更（見 Open Questions） |
| FR-10 | auto-merge / merge queue 整合 | Won't (v1) | 官方 merging reference 明言 stacked PR 不支援 auto-merge，與 AI 教學頁矛盾；preview 階段以保守文件為準 |

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Security / Governance | **skill 自身不得執行** Anchor #4 禁止操作（rebase、force-push、push）。輸出供使用者自行執行的指令、或指向 `/push-ci` 等授權工作流，**不算違反**——這是本需求的界線所在：原文同時寫「不得誘導執行」又允許輸出指令，兩者互相矛盾，而 metric 只能證明前者。界線定為「執行者是誰」：Claude 不執行，使用者知情後自行執行 | skill 測試斷言輸出不含直接執行該類指令的步驟。`allowed-tools` **可以擴增，但只能往「Anchor #4 未涵蓋的操作」方向擴**：v1 加入 `Bash(mktemp:*)`、`Bash(rm:*)`、`Bash(bash:*)`、`Write`——分別是 run directory 建立、teardown、sanitizer 腳本呼叫與 body 檔案的 out-of-band 寫入。原本寫成「`allowed-tools` 不擴增」是把手段誤當成目的：真正的約束是 `Bash(git:*)` 的可用性不得被用來執行 push/rebase，而那由 SKILL.md 的契約與測試斷言把關，不是由工具清單的長度把關 |
| NFR-2 | Reliability | execute 模式為逐層獨立 mutation，部分成功是可能結果，不承諾原子性：任一外部指令（`gh pr *`）失敗即 fail-fast 停止後續 mutation，輸出各層狀態（succeeded / failed / pending），並提供可重入恢復路徑（重跑時偵測既有 PR 自動進入 update mode，不重複建立） | SKILL.md 中每個外部呼叫均有對應失敗處置；部分失敗情境有「狀態回報 + 重入不重複建立」的測試案例 |
| NFR-3 | Usability | dry-run 輸出可依序執行，**唯一需要使用者替換的是 `<PR_BODY_DIR>`**——`mktemp -d` 的路徑要等使用者自己跑第一步才存在，skill 的預覽目錄則在交付報告前就已 teardown（私有 body 不應為了讓使用者事後貼上而延長壽命）。原本寫「原樣貼上可執行」是不可能達成的契約，會讓使用者貼出帶字面 `<PR_BODY_DIR>` 的指令；降級訊息說明「缺什麼、怎麼補」 | 人工驗證：三步依序執行可完成；報告本身明說該替換 |
| NFR-4 | Maintainability | 依 Development Rule 5：**新增** `test/skills/create-pr.test.js`（本需求成立時尚不存在，現已建立），涵蓋 stacked 模式 happy path + 降級 + 拒絕路徑；既有 `test/skills/create-pr-sanitization.test.js` 的 sanitization regression 全數保留 | `npm test` 通過；新增案例含 null/空 chain/單層極端值；既有 sanitization 測試無刪減 |
| NFR-5 | Compatibility | 明示環境需求（gh 版本、`gh-stack` extension、repo rollout 狀態），並對**可查詢者**於執行時偵測，不假設齊備。rollout 在 v1 不可查詢，故不納入偵測要求，改以「未確認即降級」滿足本需求的保守方向 | 前置偵測步驟存在且缺件時走 FR-4 降級；`gh extension list` 失敗亦視同缺件 |
| NFR-6 | Maintainability | SKILL.md **不受**行數上限約束：`@rules/docs-numbering.md` § Size Limit 的 500 行只管 `docs/features/` 下的 prose，`skills/**` 屬 functional document（整份被 dispatcher 載入執行）明列豁免。要求改為實質的：stacked 模式的操作細節外移至 `references/stack-mode.md`，`SKILL.md` 只留分派與決策表 | `SKILL.md` 內不含 stack 逐步操作序列（該序列只在 `references/stack-mode.md`）；不設行數斷言 |

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint (C-1) | **Anchor Register #4**：`git push` / `rebase` / force-push 僅限 `/push-ci`、`/smart-commit --execute`、`/epic-merge` 三個封閉例外工作流。`gh stack submit`（push branches）、`gh stack rebase` + `gh stack push`（cascading rebase + `--force-with-lease`）全部落在禁止清單。把 `/create-pr` 加入例外清單本身是 Anchor-level 變更，需人工核准並更新 `test/rules/discretion-tiers.test.js` | `rules/discretion.md` § Anchor Register #4 |
| Constraint (C-2) | GitHub Stacked PR 為 public preview（2026-07-30 發布），API、CLI 行為、rollout 涵蓋皆可能變動；merge queue 支援分批 rollout 中 | GitHub Changelog（見 § References，web 驗證） |
| Constraint (C-3) | 官方文件矛盾：merging reference 寫 auto-merge 不支援，AI tutorial 頁建議可用 — 需以保守文件為準並實測 | 使用者輸入研究，標記待實測 |
| Constraint (C-4) | cross-fork 不支援；所有 branches 須在同一 repository | GitHub Docs（使用者輸入研究） |
| Constraint (C-5) | 合併只能由 stack 底部開始、連續區段；不能跳層 merge | GitHub Docs（使用者輸入研究） |
| Constraint (C-6) | 每層 PR 依 stack 最終目標 branch 套用 branch protection / required checks，每層須為有效可測狀態 | GitHub Docs（使用者輸入研究） |
| Assumption (A-1) | 本機 gh CLI ≥ 2.95.0 可用；`gh-stack` extension 目前**未安裝**（`gh extension list` 實測 2026-07-31） | Code observation |
| Assumption (A-2) | 目標 repo 是否被 preview rollout 涵蓋 — 未知且 v1 不可查詢，故不作「已涵蓋」的假設。防護不是偵測（偵測不到），而是 FR-4 的保守降級：未確認即走 Multi-PR 路徑 | Inferred |
| Assumption (A-3) | 使用者輸入的研究內容與官方來源一致 — 已抽驗 changelog 日期（2026-07-30）與 `gh-stack` extension 存在性；其餘細節（stack metadata 欄位名、CLI 子指令全集）未逐一驗證 | Web validation（部分） |
| Assumption (A-4) | 使用情境為「一個 worktree 對應一條 stack」，多 Agent 不同時改寫同一條 stack | User statement |

## 8. Acceptance Signals

- Signal 1（FR-1/FR-2）：對三層線性 chain 執行 stacked dry-run，輸出三個 PR 建立指令，base 鏈為 `layer1→main`、`layer2→layer1`、`layer3→layer2`，且未執行任何 push/rebase。
- Signal 2（FR-4）：在 `gh-stack` 未安裝的環境執行，得到明確缺件訊息與降級輸出（現行 Multi-PR + 依情境調整的依賴標記：下層 PR 已存在用 `#N`、尚未建立用下層 branch 名），流程不中斷於未定義狀態。
- Signal 3（FR-3）：對含 forbidden pattern 的層執行，title 被 regenerate 或 HARD FAIL，body 逐行剝除並記錄 `[AI_STRIPPED]`。
- Signal 4（FR-5/UC-6）：對非線性 chain 輸入，得到拒絕訊息與原因，不建立任何 PR。
- Signal 5（NFR-1）：全程 audit — session 中無 `git add/commit/push/rebase` 或 `gh stack push/rebase/submit` 之執行紀錄。
- Signal 6（NFR-4）：`npm test` 通過，新增的 `test/skills/create-pr.test.js` 含 stacked 模式的 happy path、降級、拒絕案例，且既有 `test/skills/create-pr-sanitization.test.js` 全數通過無刪減。
- Signal 7（NFR-2）：模擬第二層 `gh pr create` 失敗，輸出含各層狀態（succeeded / failed / pending）；重跑後第一層被偵測為既有 PR 進入 update mode，未重複建立。

## 9. Open Questions

- [x] **執行端授權設計**（最關鍵）：`gh pr create/edit` 已在現行 `--execute` 授權內，無需新授權；缺口在 **branch push**——`gh stack submit` 同時做 push branches + create PRs，無法只取其半。**已裁決（2026-07-31，使用者決策）**：v1 採組合方案——branch push 經 `/push-ci` 或使用者手動執行，skill 僅逐層 `gh pr create/edit`，`gh stack` 系列一律由使用者自行執行；不啟動 Anchor-level 變更。設計細節見 [2-tech-spec.md](./2-tech-spec.md) §3.1。
- [ ] Solution concern（**post-v1 限定**——v1 授權已由上一項裁決，本項不重啟）：未來若要自動執行 mutating `gh stack` 系列（cascading rebase 傳遞、多 branch force-with-lease），授權應落在何處 — suggest `/feasibility-study`。
- [ ] Solution concern：native stack 的 merge 語意與 `/epic-merge` 的手動 squash chain 是取代、共存還是分工（native stack 用於新 chain、epic-merge 用於 epic branch 場景）— suggest `/feasibility-study`。
- [ ] `/pr-summary` 的 stacked 偵測啟發式（base 非主幹）與 native stack metadata 的對齊時機與方式。
- [ ] 本 repo 的 CI（plugin 測試）是否需要 stack-aware 分層策略（cheap checks 每層、full suite 頂層）；stack metadata 欄位（`github.event.pull_request.stack.*`）需實測確認。
- [ ] auto-merge 矛盾（C-3）：待 repo 實際 rollout 後實測，決定 FR-10 是否從 Won't 升級。
- [ ] rebase 改寫 SHA 對本 repo ruleset 的影響（stale approval dismissal、review comment 錯位）— 導入前小規模驗證。

## 10. References

- `skills/create-pr/SKILL.md` — 現行流程；§ Multi-PR Mode、§ Edge Cases 的 Stacked PRs 一列（以節名引用，理由同 §1）
- `skills/epic-merge/SKILL.md` — 既有 linear stacked PR chain 合併工作流（chain 驗證、backup tags、per-iteration gate）
- `skills/pr-summary/SKILL.md` § Workflow → 1. Run Script（`Detect` 列） — 現行 stacked PR 偵測啟發式
- `rules/discretion.md` § Anchor Register #4、`rules/git-workflow.md` — 禁止操作與封閉例外清單
- Research（web 驗證 2026-07-31）：
  - [Stacked pull requests are now in public preview — GitHub Changelog](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/)
  - [About stacked pull requests — GitHub Docs](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)
  - [Quickstart for stacked pull requests — GitHub Docs](https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart)
  - [gh-stack extension](https://github.github.com/gh-stack/)
- 使用者輸入研究（2026-07-31 對話）— 涵蓋 CI 成本、rebase 陷阱、簽名、cross-fork、auto-merge 矛盾等細節；A-3 標註其驗證狀態
