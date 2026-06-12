# Workflow Orchestration（代理式編排器）可行性研究報告

> **Doc class**: Lifecycle — Phase 0 feasibility（依 `@rules/docs-numbering.md`）。
> **Created**: 2026-05-29
> **Requirements**: [1-requirements.md](./1-requirements.md)
> **方法**: 5-Why + 約束盤點 + code research + 4 方案 + Codex 雙輪對話 + feasibility-analyst 獨立查證

## 1. 問題本質

### 1.1 Surface Requirement

設計一版通用 workflow，把「98 個 skill 如何串成 workflow」的編排決策交給 agent，而非由人依 `CLAUDE.md:13-17` 的固定流程表手動編排（k8s 解決容器編排的類比）。

### 1.2 Underlying Problem（5-Why）

| 層 | 結論 |
|----|------|
| Surface | 想要 agent 自動編排 skill |
| Why | 編排決策目前 100% 人工，靠人腦 + 記憶流程表 |
| Why | 編排知識鎖在人腦/文件；98 skill 組合爆炸；固定表無法因應動態情境 |
| Root | 需「宣告意圖 → 自動規劃並執行 → 持續比對現況 vs 期望直到達成」的能力——**但本專案的核心價值是 hook 強制的 fail-closed 審查 gate，編排自動化不可繞過它** |

核心張力：**自動化編排（FR-1/2）⟷ 安全 gate 不可繞過（FR-4/NFR-1/NFR-4）**。可行性的成敗完全取決於能否在不破壞安全平面的前提下引入編排自動化。

### 1.3 Success Criteria（量化驗收）

| # | 條件 | 來源 |
|---|------|------|
| SC-1 | 給定意圖能輸出「隨 repo 狀態變動」的 workflow 計畫（非固定模板） | 需求 Signal 1 |
| SC-2 | 計畫/執行含該 change-type 所需 gate，且 0 次未授權 git 變更 | 需求 Signal 2 |
| SC-3 | v1 通用 workflow 端到端跑通至少一個真實情境 | 需求 Signal 3 |
| SC-4 | 既有 auto-loop / hook 測試 0 回歸 | 需求 Signal 4 |
| SC-5 | 新增 skill 可被自動納入候選，無需改編排核心 | 需求 Signal 5 |

## 2. 約束盤點

| 類型 | 約束 | 來源 | 彈性 |
|------|------|------|------|
| Technical | 安全保證錨定**單一信號** `has_code_change`，由 `PostToolUse(Edit\|Write)` 設定——**主 session 與同 cwd DW subagent 的 `Edit/Write` 皆會觸發**（Spike 1 已驗證，見 §8）；lock 失敗 fallback 與 doc 對應 `has_doc_change` 同函式 | `hooks/post-edit-format.sh`（`update_change_flag "has_code_change"`；引用穩定符號名而非行號以免漂移） | **None** |
| Technical | `hooks.json` 對 `Task`/`Agent`/`SubagentStop` **零綁定**（已驗證）；但 subagent 自帶一份 project hooks，其 `Edit\|Write` **會觸發** `post-edit-format.sh`（Spike 1 已驗證，見 §8）——`hooks.json` 無 `SubagentStop` 並非判據 | `hooks/hooks.json:43`（grep 無結果） | None |
| Technical | `stop-guard` 的 git 對帳是**單向 `true→false`**，永不從 git status 補回 dirty | `hooks/stop-guard.sh`「Stale-state git check」section | None |
| Technical | Dynamic Workflows 腳本本身**不能讀寫檔/跑 shell**，只能透過 subagent | Workflow 工具契約 | None |
| Technical | DW `resume` 僅同一 CC session 內有效 | Workflow 工具契約 | Low |
| Compat | 既有 stop-guard 預設 **warn 模式**（非全面 fail-closed） | `.claude/settings.json:3`、`stop-guard.sh`（`_resolve_guard_mode` 預設 `warn`） | Med（使用者偏好 warn） |
| Compat | `allowed-tools` **不可信任**為 read-only 判據（見 §3.3） | 多處 SKILL.md | None |
| Resource | DW 為付費 **research preview**，API 可能變動 | Workflow 工具契約 | Low |
| Business | 不可繞過 no-auto-commit 與既有例外 | `rules/git-workflow.md:6-9` | None |
| Business | Codex 呼叫須獨立研究 | `rules/codex-invocation.md` | None |

### 2.1 已驗證的關鍵證據（vs 待 Spike 驗證）

| 主張 | 狀態 | 證據 |
|------|------|------|
| stop-guard 預設 warn 模式 | ✅ 已驗證 | `.claude/settings.json:3` |
| git 對帳單向 `true→false` | ✅ 已驗證 | `hooks/stop-guard.sh`「Stale-state git check」section |
| 旗標 false 時 stop-guard 為 no-op | ✅ 已驗證 | `hooks/stop-guard.sh`「Stale-state git check」（`HAS_CODE_CHANGE="false"` 單向覆寫） |
| 僅 strict 模式 `exit 2` 封鎖 | ✅ 已驗證 | `hooks/stop-guard.sh`（state-file 模式 strict 分支 `exit 2`） |
| `post-skill-auto-loop` 只印 directive 不執行 | ✅ 已驗證 | `hooks/post-skill-auto-loop.sh:108-115` |
| `hooks.json` 無 Task/Agent/SubagentStop 綁定 | ✅ 已驗證 | `grep -niE '(task\|agent\|subagent)' hooks/hooks.json` → exit 1（檔中無此事件鍵） |
| subagent `Edit\|Write`（同 cwd、hooks 已安裝）觸發 `post-edit-format.sh` 設 `has_code_change` | ✅ 已驗證（2026-06-02 Spike 1，見 §8） | 探針：state 旗標 false→true + touched-files 收錄（`post-edit-format.sh` 指紋） |

> 註：外部 runtime 主張（DW 16 並行/1000 總量、resume 限制、acceptEdits）來自 Claude Code「Workflow 工具契約」，非本 repo 可驗證；`hooks.json` 零綁定的實證來自 `grep -niE "(task|agent|subagent)" hooks/hooks.json`（exit 1）。

## 3. 既有能力盤點

### 3.1 既有編排機制（三種，皆非通用引擎）

| 機制 | 性質 | 決策方式 | 證據 |
|------|------|---------|------|
| Wave-based 平行（`deep-explore`/`deep-research`） | agent 派發 + 分數 gate | `deep-explore`：每波 2-3 agent、最多 2-3 wave；`deep-research`：2-3 並行 researcher（結構不同，非 wave）；subagent 預設 `Explore`，但 `deep-research` 有 `general-purpose` fallback（`:148,:180`）→ read-only 須靠 admission 強制，非天生保證 | `deep-explore/SKILL.md:56,193`、`deep-research/SKILL.md:50,250` |
| Heuristic next-step（`analyze.js`） | 16 條規則（註釋稱 16，實際 17 個 `findings.push`，第 17 個在 `:609`） | 計算 phase + 信心排序指令，**閉集合** | `skills/next-step/scripts/analyze.js:326-619` |
| 反應式狀態機（hooks + `.claude_review_state.json`） | FSM；**只提示/封鎖，不執行 skill** | stop-guard 的「下一步必跑」**寫死 3 個指令**（`MISSING` 組裝 `/codex-review-fast`、`/precommit`、`/codex-review-doc`） | `stop-guard.sh`（`MISSING` logic）、`post-skill-auto-loop.sh`（只印 `[AUTO_LOOP]` directive，不執行） |

### 3.2 可重用基礎設施

| 資產 | 用途 | 證據 |
|------|------|------|
| `mkdir` lockdir + TTL | 狀態檔併發鎖 | `post-edit-format.sh:45`、`post-tool-review-state.sh:35` |
| `.blocked` sidecar（fail-closed） | 強制 strict + dirty | `stop-guard.sh`「Sidecar fail-closed marker」section |
| Context Packet（傳事實不傳結論） | 防 context 污染（行為層，無強制碼） | `deep-explore/SKILL.md:87-94` |
| `analyze.js` phase + findings | planner 的**輸入信號** | `analyze.js:215-279` |
| 15 custom agents（`performance-optimizer` 僅 `Read,Grep,Glob` 為純讀；`feasibility-analyst` 無 Edit/Write 但有 `Bash(git/codex/bash:*)` → 非嚴格 read-only，須全量盤點 mutation 能力） | 編排 worker 候選 | `agents/performance-optimizer.md:4`、`agents/feasibility-analyst.md:4` |

### 3.3 Tech Debt / 阻礙（需繞過）

| 問題 | 影響 |
|------|------|
| **既有 skill 已派發會 mutate 的 subagent**：`/doc-refactor` 派 `doc-refactor` agent（`agents/doc-refactor.md:4` 含 `Edit`）、`/simplify` 派 `code-simplifier`（Edit）+ `refactor-reviewer`；另 `codex-implementer` 含 `Edit,Write`（agent 存在，但目前無 skill 以 `subagent_type` 派發它） | **Spike 1（2026-06-02，§8）已證實：同 cwd subagent 的 `Edit/Write` 會觸發 `post-edit-format.sh`**——故 `/doc-refactor`、`/simplify` 在 Edit/Write 偵測路徑上**應同樣不繞 gate**（推論自共享的 subagent project-hook 語意；本探針實測為 DW `Workflow agent()`，Agent-tool 子代理建議另跑 smoke test 確認（`-uno` 降級 bug 已於 2026-06-03 修復，見 §8）；殘餘風險限 subagent 內 Bash/process 改檔與 worktree isolation。DW 的 16 並行/1000 總量只是把規模放大（~111×），非新風險類別 |
| `allowed-tools` 無 Edit/Write ≠ read-only：`/smart-commit:370`（--execute 跑 git add/commit）、`/jira:102`（--execute 跑 checkout -b）、`/update-readme:52`（委派 `generate-readme-catalog.js:365` 寫 README）、`/op-session:19`、`/statusline-config:79`（無 allowed-tools 卻寫 `~/.claude/`）、`/bump-version:43`（用 Edit） | 98 skill 中 89 宣告 allowed-tools、僅 **40** 在 `allowed-tools` 含 Edit/Write（另如 `/bump-version` 無 allowed-tools 卻於 body 用 Edit）→ 天真分類器需信任其餘 **58** 個（= 98−40，含 9 個無 allowed-tools 者）|
| 安全狀態無 monotonic `safety_epoch`：review 結果未與 edit epoch 關聯 | 晚到的 review 可能覆寫已被 edit 失效的 gate（`post-tool-review-state.sh:225`） |
| 個別 review-state 寫入 lock 失敗時 **fail-open** | 與 edit/aggregate 的 sidecar fail-closed 不一致（`post-tool-review-state.sh:235`） |

## 4. 可能方案

### Option A：全面採用 Dynamic Workflows（含 mutation 階段）

**Core idea**：把通用 workflow 寫成 `.claude/workflows/*.js`，由 DW runtime 規劃並執行**全部**步驟（含改 code）。

**Implementation path**：1) 啟用 preview；2) 撰寫 planner workflow；3) mutation 走 DW subagent。

| 維度 | 評級 | 說明 |
|------|:----:|------|
| Technical Feasibility | 🟡 | 工具存在；mutation × hook 觸發在 `Edit/Write` 同 cwd 路徑**已驗證會觸發**（§8），但 Bash/process 改檔、worktree isolation 仍斷裂（`-uno` 降級已修，2026-06-03） |
| Effort | 🟡 | 建置中等，但「做到安全」極高 |
| Risk | 🔴 | linchpin（Edit/Write 偵測）已解，但 A「全面含 mutation」仍含 Bash/process + worktree + async race 多重 bypass（`-uno` 降級已修）；preview API 變動；無護欄直接違反 FR-4 |
| Extensibility | 🟢 | DW 原語強大（pipeline/budget/16 並行） |
| Maintenance | 🔴 | preview churn + 兩套狀態模型 |

**Cost**：A 全面含 mutation 仍須面對多個殘餘安全向量（Bash/process、worktree、async race；`-uno` 降級已修），且無護欄即違反 FR-4。

---

### Option B：自製 meta-orchestrator skill（僅用既有原語）

**Core idea**：新 `/orchestrate` skill——planner agent 產出計畫，主 Claude 用 `Skill()`/`Agent()` 逐步執行。

**Implementation path**：1) 意圖輸入；2) planner agent 讀 `skill-catalog.yml` + SKILL.md 產計畫；3) 主 agent 逐步派發；4) hook gate 生效於 **mutation 由 `Edit/Write` 觸發時**——主 session 或同 cwd DW subagent 的 `Edit/Write` 皆會設 `has_code_change`（`post-edit-format.sh` 的 `update_change_flag "has_code_change"` 呼叫，Spike 1 已驗證，見 §8）。**注意**：`Bash` 改檔/commit/切 branch **不設旗標**（`Bash` 綁 `post-tool-review-state.sh`，只解析 review/precommit 輸出，`hooks.json:54`），不論主 session 或 subagent 皆須靠 pre/post HEAD/branch/worktree/external 檢查補強。

| 維度 | 評級 | 說明 |
|------|:----:|------|
| Technical Feasibility | 🟢 | 全用既有 Agent/Skill + deep-explore 模式 |
| Effort | 🟡 | 3-10 人日（planner + 計畫格式 + executor） |
| Risk | 🟡 | 安全保留**有條件**（主 session + 同 cwd subagent 的 `Edit/Write` 確定**設 change flag、失效 review state**；完整 enforcement 仍須 strict（`-uno` fix 已完成）；Bash/process 例外）；編排漂移仍在（行為層執行） |
| Extensibility | 🟡 | 受限 3 並行；非 runtime scheduler |
| Maintenance | 🟢 | 無 preview 依賴，模式熟悉 |

**Cost**：「安全但不夠 k8s」——`next-step --go` 本質是 single-step dispatcher（信心 + 無 P0 才自動派發一個 top action），非 reconciler（`next-step/SKILL.md:61`）。**注意**：B/C 的「mutation 走主 agent Skill」並非自動安全——若該 Skill 內部派發會 mutate 的 subagent（如 `/doc-refactor`/`/simplify`），其 `Edit/Write` 雖會觸發 hook（Spike 1 已驗證，§8），但 subagent 內的 Bash/process 改檔仍不設旗標。故 mutation 安全須靠**明確 metadata/allowlist + pre/post 檢查**，而非「只要走 Skill」。

---

### Option C：混合兩平面（control plane / safety plane 分離）★

**Core idea**：宣告式「意圖編譯器」——read-only/高扇出階段路由給 DW，mutation/安全關鍵階段走既有 **hook-enforced 主 session 執行路徑**（`Edit/Write` 是會由 hook 設 change flag 的路徑：code→`has_code_change`、doc→`has_doc_change`；主 session 與同 cwd DW subagent 的 `Edit/Write` 皆觸發，Spike 1 已驗證，§8）；**編排 run-state 與安全 state 分離**。注意：`Bash` 改檔/git 操作不觸發 change flag，須另以 pre/post HEAD/branch/worktree/external 檢查補強。

**Implementation path**：
1. **Control plane**：`/orchestrate` 把意圖編譯成宣告式 run plan，狀態存 `.claude_workflows/<run-id>.json`（擁有 desired steps / deps / budget / evidence / retry / convergence）。
2. **Safety plane**：`.claude_review_state.json` 維持 hook 獨佔；orchestrator **只讀不寫**（不得偽造 `has_code_change`/`*.passed`）。
3. **Execution policy**：v1 DW 只跑 read-only fanout worker；mutation 由**主 agent 自身的 `Edit/Write`** 執行。Spike 1（§8）已證明同 cwd DW subagent 的 `Edit/Write` 亦會觸發 hook，故 v2 可在護欄就緒後（strict + `-uno` 已修 + 等背景結束 + 同 cwd + Edit/Write-only）開放 mutation subagent。**`Bash` 例外**：`Bash` 改檔/commit/切 branch **不設 change flag**（綁 `post-tool-review-state.sh`，只解析 review/precommit 輸出），須限縮在已知 verification/review 指令，或搭配獨立 mutation detector + pre/post HEAD/branch/worktree/external 檢查。
4. **Admission controller**：依**明確 mutation metadata**（非 `allowed-tools`）決定哪些工作可進 DW。

| 維度 | 評級 | 說明 |
|------|:----:|------|
| Technical Feasibility | 🟢 (v1 read-only) / 🟡 (later mutation) | v1 用 deep-explore 既有模式 + pre/post dirty check |
| Effort | 🟡 | v1 ~3-5 人日；完整版另需 metadata 2-3 人日 + spikes + epoch |
| Risk | 🟢 (v1) / 🟡 (overall) | v1 worker fanout 無 mutation，唯一寫入為主 session 報告（受 doc hook/review 管控）；preview 風險隔離在非安全半邊 |
| Extensibility | 🟢 | DW backend 證實後可擴至 16/1000；backend 可插拔 |
| Maintenance | 🟡 | 兩平面但職責清晰；共用 lock helper |

**Cost**：兩個編排機制需維護；分類邊界需 admission controller。

---

### Option D：把 hook FSM 擴成宣告式 reconciler

**Core idea**：泛化 `.claude_review_state.json` + stop-guard 成「desired-state 控制迴圈」（最 k8s-faithful，無新 runtime）。

| 維度 | 評級 | 說明 |
|------|:----:|------|
| Technical Feasibility | 🟡 | bash 限制；無平行；**hook 不執行 skill**（`post-skill-auto-loop.sh:108` 只印字） |
| Effort | 🔴 | 需把 stop-guard 寫死的 3-指令 ladder 改寫成宣告式依賴圖 |
| Risk | 🟡 | 把窄而專的安全 FSM 污染成 scheduler |
| Extensibility | 🔴 | bash、僅 tool 邊界反應、無 fanout |
| Maintenance | 🔴 | 安全 + 編排耦合的複雜 bash FSM |

**Cost**：把反應式安全 hook 變調度器——方向性錯誤。

## 5. Codex 深入討論記錄

### 5.1 討論過程

| 輪 | 主題 | Codex 關鍵觀點 |
|----|------|---------------|
| 1 | 方案枚舉 + pivotal risk | 不要讓 mutation 走 DW；安全模型錨在單一 `has_code_change` 信號；repo 其實是 warn-mode 非全面 fail-closed；提出**兩平面**綜合方案 + 最小風險 v1 + 3 spikes |
| 2 | admission 信號 + 兩平面分歧風險 | `allowed-tools` 不足為 read-only 判據（6 個誤判實例）；需明確 `mutation:` metadata（2-3 人日）；列出 stale-read / late-overwrite / invisible-mutation / compaction split-brain 四種分歧；可重用 lockdir/sidecar 模式 |

### 5.2 Codex 建議方向

- **兩平面分離**：control-plane run-state 獨立於 hook-owned safety-plane，orchestrator 只讀安全平面。
- **最小風險 v1**：report-only `/orchestrate "audit/research topic" --dry-run --execute`——planner 讀 catalog → 計畫預覽 → read-only fanout（DW 可用則用、否則退回既有 Agent）→ pre/post 驗證 HEAD/branch/worktree/外部副作用無變更（變更則 fail-closed；非僅 porcelain）→ 報告由主 agent 寫 → 正常 `/codex-review-doc`。
- **明確 metadata**：`mutation: none|workspace|git|external|delegated` + `requires-human-gate` + `dynamic-workflow-admissible`。

### 5.3 Codex 指出的風險

- **High bypass risk**（與 feasibility-analyst 獨立一致）：DW subagent 改 code 若不觸發主 session hook，gate 靜默失效。
- 無 `safety_epoch`：晚到 review 覆寫失效 gate。
- compaction split-brain：`post-compact-auto-loop.sh`（"Derive next required command" 的 `NEXT` 推導邏輯）不知 workflow 狀態。
- review-state lock 失敗 fail-open 與 edit/aggregate fail-closed 不一致。

### 5.4 與 Claude 分析的差異

| 觀點 | Claude 初判 | Codex | 採納 |
|------|------------|-------|------|
| fail-closed 現況 | 假定全面 fail-closed | **實為 warn-mode**（settings.json:3） | Codex（修正假設） |
| 最 k8s 的方案 | 傾向 Option D（hook reconciler） | D 是反模式（hook 不執行 skill） | Codex（棄 D） |
| 狀態該放哪 | 想擴充既有 state 檔 | **兩平面分離**，安全平面 hook 獨佔 | Codex（更安全） |
| read-only 判據 | 想用 `allowed-tools` | 不可信，需明確 metadata | Codex（加 metadata） |
| v1 能否全 agent-driven | 想直接 agent 規劃 | **mutation 流程須先用受限模板**，agent 只參數化；read-only 子集可全 agent-driven | Codex（分階段） |

### 5.5 整合結論

兩個獨立來源（Codex 2 輪 + feasibility-analyst）對 **pivotal risk 一致**：安全模型錨在單一信號、`hooks.json` 對 subagent 零綁定、git 對帳單向（皆已驗證）。**但 bypass 本身尚未實證——它是「unverified, high-risk」而非「已證實」**：`hooks.json` 無 subagent 綁定不等於證明 runtime 不傳播 `PostToolUse`（CC 文件區分 subagent frontmatter hook 與 project-level lifecycle hook），故須 Spike 1。結論（撰寫當時）：**mutation 編排在 Spike 1 驗證前不可交給 DW**（→ §8：Spike 1 已於 2026-06-02 實證——DW subagent `Edit/Write` 會觸發 hook，此限制就 Edit/Write 路徑解除，須配護欄）。最務實路徑＝**Option C 分階段**：v1 先做 report-only 編排器（read-only，可全 agent-driven），用 pre/post dirty check 證明零變更；mutation 編排延後到 metadata + spike + safety-epoch 就緒。這既滿足使用者「至少一版通用 workflow + 把編排交給 agent」的核心訴求（v1 的 planning 確實由 agent 動態決策），又不賭上安全模型。

## 6. 方案比較

| 維度 | A 全面 DW | B 自製 orchestrator | **C 混合兩平面 ★** | D hook reconciler |
|------|:--------:|:------------------:|:------------------:|:-----------------:|
| Technical Feasibility | 🟡 | 🟢 | 🟢 (v1) | 🟡 |
| Effort | 🟡 | 🟡 3-10d | 🟡 v1 ~3-5d | 🔴 >10d |
| Risk | 🔴 | 🟡 | 🟢 (v1) | 🟡 |
| Extensibility | 🟢 | 🟡 | 🟢 | 🔴 |
| Maintenance | 🔴 | 🟢 | 🟡 | 🔴 |
| 滿足 FR-4（不繞 gate） | ❌ | ✅* | ✅* | ✅ |
| 滿足 k8s 願景（規模/宣告式） | ✅ | ⚠️ | ✅（漸進） | ⚠️ |

> \* B/C **有條件**滿足 FR-4：已知安全的 mutation 偵測路徑為主 session `Edit/Write` 與同 cwd DW subagent `Edit/Write`（hooks 已安裝，Spike 1 已驗證，見 §8），或經 admission 限定為 read-only 時成立。**主 session `Bash` 改檔/commit/切 branch 不設 change flag**（`Bash` 綁 `post-tool-review-state.sh`，只解析 review/precommit 輸出），須限縮在已知 verification 指令或搭配 pre/post HEAD/branch/worktree/external 檢查；經未驗證的 mutating subagent 改檔亦不保證。

## 7. 建議

**推薦：Option C（混合兩平面），分階段導入。**

**v1 範圍（最小風險，report-only `/orchestrate`）**：
- 接受意圖 + 約束 + budget + 完成定義 → planner agent 讀 `docs/skill-catalog.yml` + SKILL.md 產**隨狀態變動**的計畫（SC-1）。
- 計畫預覽（FR-3）：選用 skill/agent、平行 shard、驗證點、停止條件。
- read-only fanout：DW 可用則用、否則退回既有 background `Agent`（沿用 `deep-explore` fanout + 完整性 gate）。
- **read-only admission（deny-by-default）適用於所有 fanout backend**：DW、退回的 background `Agent`、以及任何 skill 委派——只有明確標記為 read-only 的 skill/agent 才可被 fanout；未知者在所有後端一律拒絕（避免 DW 不可用時退回 Agent 仍派出 mutating agent）。
- **無變更驗證須超越 `git status --porcelain`**：porcelain 抓不到 commit（worktree 仍乾淨）、`git checkout -b`（branch 變更）、Jira/外部副作用、寫 repo 外（如 `~/.claude/`）。v1 須檢查 `HEAD`、branch、worktree、以及宣告的外部副作用；任一變動即 fail-closed（SC-2）。
- worker fanout 為 read-only；**最終報告由主 agent 自身 `Write` 寫入（這是主 session 的 doc mutation，會觸發 hook）→ 正常 `/codex-review-doc`**。

**Rationale**：
- 滿足約束：v1 的 worker fanout 不含 mutation；唯一變更是主 session 寫報告（受 hook 監看 + doc review），安全平面風險極低（SC-2/SC-4）。
- **Risk hedge（Spike 1 已解，2026-06-02 更新，見 §8）**：Spike 1 已證明 DW subagent 的 `Edit/Write`（同 repo cwd、hooks 已安裝）會觸發宿主 hook 並設 `has_code_change`，故 mutation 編排走 DW 在 `Edit/Write` 路徑**不繞 mutation detection / change-flag 傳播**（完整 enforcement 仍須下列護欄）——mutation 平面不再被迫永久限縮於主 session。**但 mutation 編排解禁前須一組護欄**：(1) `STOP_GUARD_MODE=strict`；(2) ✅ 已修 `stop-guard.sh` 的 `-uno` 降級 bug（已改 `-uall`，2026-06-03）；(3) Stop 前須等待背景 workflow/subagent 結束，否則 review/precommit 後仍可能有遲到的背景寫入（async mutation race）；(4) mutation agent 限同 repo cwd（worktree isolation 待 Spike 1b）；(5) mutation 限 `Edit/Write`（`MultiEdit` 須加入 matcher），**`Bash`/process 改檔仍不觸發 change flag，須搭配 pre/post HEAD/branch/worktree/external 檢查**；(6) **hook preflight**：執行前確認 `.claude/settings.json` 含已安裝的 `Edit|Write` hook、腳本可執行、`CLAUDE_PROJECT_DIR` 正確；(7) **tamper protection**：`pre-edit-guard.sh` 須防 agent `Edit/Write` 竄改 `.claude_review_state.json`、`.claude/hooks`、`.claude/settings*.json`。在護欄就緒前，v1 維持 report-only 為零前置成本的安全起點；即使退回 Option B 亦同此護欄。
- 平衡點：核心訴求（agent 動態規劃）在 v1 即達成；高風險的 mutation 編排延後到證據就緒。
- Codex 觀點：兩來源獨立一致——report-only 是「不賭安全模型」的唯一安全起點。

**Backup：Option B（C 去除 DW backend）。**
**適用情境**：若 DW preview 不可用/不穩、或團隊要求零 preview 依賴——則 v1 的 fanout 純用既有 3-並行 `Agent`，其餘設計不變（C 與 B 的 v1 執行後端本就可互換）。

**明確不推薦**：A（賭安全模型）、D（hook 不執行 skill，方向錯）。

## 8. Open Questions

- [x] **Spike 1（linchpin，二元）— 2026-06-02 已實證解除**：用本環境 `Workflow` 工具（即 DW）在本 repo（`.claude/settings.json` hooks 已安裝）派 subagent 以 `Write` 建立 `.spike1-probe.tmp.js`。**結果：`has_code_change` false → true、`changed_files_since_review` + `session_commit_scope.touched_files` 收錄該檔、`review_phase=pending_review`、`code_review.passed=false`（invalidation 路徑相符）——即 `post-edit-format.sh:341-355`（`update_change_flag` + `_track_changed_file` + review invalidation）的指紋。** 結論：**DW subagent 的 `Edit/Write`（同 repo cwd、hooks 已安裝）會觸發宿主 PostToolUse hook，change flag 經共享 `.claude_review_state.json` 傳到主 session Stop——即 mutation 偵測 / change-flag 傳播路徑就 `Edit/Write` 成立。** ⚠️ 注意：這證明的是「偵測 + 旗標傳播」，**非端到端 fail-closed enforcement**——因 `stop-guard.sh` 當時（修復前）用 `git status --porcelain -uno`，strict Stop 對本探針的 untracked 檔仍可能回 `{"ok":true}`；完整 gate 須先修 `-uno`（✅ 2026-06-03 已修，見下方殘餘缺口）並啟用 strict。 靜態分析（`hooks.json` 無 `Task/Agent/SubagentStop` 綁定）不足以判定，因 subagent 自帶一份 project hooks，其內部 `Write` 命中 `Edit|Write` matcher；故本題必須實證。subagent 自身 transcript 看不到 hook 輸出（`post-edit-format.sh` 走 stderr、prettier `2>/dev/null`、`[AUTO_LOOP]` 僅 `Skill` 後觸發），但 state 檔確實被寫入。
  - **殘餘缺口（與 Spike 1 正交，mutation 編排前須處理）**：
    - ✅ **`stop-guard.sh` 的 `git status --porcelain -uno` bug（2026-06-03 本 session 已修）**（雙方獨立實證：`-uno` 看不到新 untracked 檔，`-u` 才看得到）：stop-guard 單向 true→false 對帳會把已正確設好的 flag **降級回 false** → 回 `{"ok":true}`。此 bug 對主 agent 與 subagent 一視同仁（影響所有新建 untracked 檔），是既有 fail-closed 漏洞，須改用 `-u`（更穩健可用 `--untracked-files=all`/`-uall`，涵蓋新建未追蹤目錄內的檔；`user-prompt-review-guard.sh` 已刻意避開 `-uno`）。**另 `post-skill-auto-loop.sh`（修復前）也用 `-uno`**——雖非 fail-closed Stop 的一環，但會對新建 untracked 檔抑制 auto-loop directive，已一併以同樣對帳修正（現為 `:71`/`:73` 的 `-uall`）。**修復摘要（2026-06-03）**：4 hook 改 `-uall`（`stop-guard.sh`/`post-skill-auto-loop.sh`/`post-compact-auto-loop.sh`；`user-prompt-review-guard.sh` 改 `--porcelain -uall`）+ flag-aware git stub 與回歸測試。連帶修正 reconciliation 的兩個次生 fail-open：(a) `echo | grep -q` 在 pipefail 下的 SIGPIPE 誤降級 → 改 here-string；(b) 無界 `-uall` walk → `timeout 5/3` 包覆，無 `timeout`/`gtimeout` helper 時 fail-closed skip（設 `__GIT_UNAVAILABLE__`、保留旗標）。dual-review ✅✅、precommit-fast ✅、tests 669/669。
    - ✅ **`stop-guard.sh` transcript-missing 繞過 state gate 的 P0（2026-06-03 本 session 由 Codex 獨立揪出並修）**（與 `-uno` 同屬 **fail-open** 類別）：當 `transcript_path` 缺失/不可讀時，hook 在**諮詢 state 檔之前**就以 `{"ok":true,"reason":"no transcript"}` 早退；但 state 檔才是**主要 enforcement 來源（不需 transcript）**，故缺 transcript 會靜默清掉一個 pending 的 strict/dual gate → fail-OPEN。根因：此 transcript 早退邏輯早於「state-file primary」設計，改版時未同步更新。**修復**：改為三分支 fail-closed——(a) 無 state 檔且無 `.blocked` sidecar → 允許（視為無待辦；無可執行的 review state/sidecar）；(b) 無 state 檔但有 `.blocked` sidecar → 一律 fail-closed 阻擋（exit 2，不分 warn/strict；與 jq-available 主路徑對 sidecar force-strict 一致）；(c) state 檔存在 → 設 `TRANSCRIPT=""` 落到 review-state enforcement（`USE_STATE_FILE=true` 會跳過 legacy transcript 掃描，安全）。**測試**：`test/hooks/stop-guard.test.js` 新增 3 個 transcript-missing 回歸案——`strict+pending→block`、`strict+sidecar-only→block`（此 2 案 pin 舊 `{"ok":true}` fail-open，revert 即 FAIL）、`warn+pending→allow`（保留 warn 不過度阻擋的 over-block guard，非 mutation pin）；分支 (a) 由既有 no-state allow 案覆蓋（`jq unavailable` recursion-guard 案屬另一 Nit#1，不計入本 P0）。本 session 另手動跑 dual-review ✅✅（未納入 repo artifact）。對 mutation 編排意義同 `-uno`：缺 transcript 不再能繞過 strict gate。
    - ✅ **sidecar fail-open 兩個延伸 corner（2026-06-10 本 session 由 Codex dual-review 揪出並修，secondary 該輪回 ✅ 漏掉）**：(P0-2) 上述 sidecar-only fail-closed 原僅在 transcript 缺失分支內——若 `.blocked` 在、主 state 檔不在、但 **transcript 可讀**，line 147 條件為 false → 跳過該分支 → `USE_STATE_FILE=false` → 落到 legacy transcript parsing → 可能放行；改為把 sidecar-only 檢查**上提到 transcript 處理之前**，一律阻擋。(P0-1) jq 遺失時，jq-missing 分支對 sidecar / `review_mode=dual` 原本只在 strict 才擋、warn 放行，與 jq-available 主路徑（force-strict）不一致；改為 **sidecar 一律擋 + jq-free grep 偵測 `"review_mode":"dual"` 一律擋**（single-mode warn 維持放行，與主路徑一致，不破壞既有 `jq unavailable + warn → allow` 契約）。3 個 mutation-pinned 回歸案（`jq-available sidecar-only + readable transcript`、`jq-missing sidecar`、`jq-missing dual`；revert 各自 → EXIT 0 放行 → FAIL，已實證）。
    - 安裝設定為 `STOP_GUARD_MODE=warn`；mutation 編排要真 fail-closed 須 strict（惟 sidecar 與 dual-mode gate 即使 warn 也一律 fail-closed，見上兩條）。
    - **Bash/process mutation**（subagent 內 `echo >`、`sed -i`、`git checkout`、workflow JS `fs.writeFileSync`）仍不觸發 change flag（沿用 R4 caveat），須 pre/post HEAD/branch/worktree/external 檢查。
- [x] **Spike 1b（承 Spike 1）— 2026-06-03 以 code-reading + Codex 獨立驗證（threadId `019e8c7d`）解除，不需 live spike**：
  - **問題**：`isolation:'worktree'` 的 DW agent 在獨立 worktree 改檔時，hook 會寫 worktree 自身還是主 repo 的 `.claude_review_state.json`？主 session Stop 是否看得到？
  - **判定（雙方獨立一致）**：7 個 state-touching hook（見下方前置 1 完整清單）全用**相對路徑** `STATE_FILE=".claude_review_state.json"`、**不 `cd`**、**不以 `CLAUDE_PROJECT_DIR` 定位 state**（`post-edit-format.sh:43`、`stop-guard.sh:110`；`post-edit-format.sh:309` 的 `--show-toplevel` 僅正規化被編輯檔路徑）。故 worktree agent 的 `Edit/Write` 把 state 寫進 `<linked-worktree>/.claude_review_state.json`，主 session Stop 以主 repo cwd 讀 `<main-root>/.claude_review_state.json` → **不同檔 → split-brain → fail-OPEN**。Codex 實測 git 語義佐證：`--show-toplevel`=worktree top、`--git-common-dir`=主 `.git`。
  - **決策**：**v1 維持「mutation agent 限同 repo cwd（禁 worktree isolation）」為硬約束**（即護欄 (4)）；worktree-isolated mutation 延後至前置就緒。
  - **解禁前置（雙重，路徑收斂為必要非充分）**：
    1. **Canonical state resolver**：以 `git rev-parse --path-format=absolute --git-common-dir`（fallback `CLAUDE_PROJECT_DIR` → `PWD`）解析出 `<git-common-dir>/.claude_review_state.json` 為唯一 canonical 路徑（須一次性從舊的 repo-root `.claude_review_state.json` 遷移、並更新測試/文件預期），統一 7 個 state-touching hook（`post-edit-format.sh`、`post-tool-review-state.sh`、`stop-guard.sh`、`post-skill-auto-loop.sh`、`post-compact-auto-loop.sh`、`session-init.sh`、`user-prompt-review-guard.sh`）。
    2. **Reconciliation 須 worktree-aware 或停用**（Codex 補的耦合點）：本 session 修好的 `-uall` 降級對帳本質是 **cwd-scoped**——即使統一 state 路徑，主 repo `git status` 仍看不到 linked worktree 內的 dirty 檔，會再次誤降旗 → fail-open 復活。須改為對每個登錄 worktree 跑 `git -C <root> status --porcelain -uall`（全乾淨才降）或直接停用 true→false 降級（更 fail-closed 但跨 worktree 正確）。
  - **與 Spike 2 耦合**：canonical 共享 state 使 `mkdir` lock 與 `.blocked` sidecar 變**全域**，高並行下 lock 競爭/fail-closed 阻塞上升——故 Spike 2（16 並行 lock 競爭）成為 Spike 1b 前置的**硬依賴**，非正交。
- [ ] **Spike 2**：isolation on/off + 16 並行 edit，確認皆命中同一 `.claude_review_state.json`、lock 競爭產生 sidecar、stop-guard 看得到。
- [ ] **Spike 3**：把 98 skill + 15 agent 分類成 read-only / workspace / git / external / delegated / human-gate（admission metadata 盤點，~2-3 人日）。
- [ ] 安全平面是否需加 monotonic `safety_epoch` + CAS，關聯 review 與 edit epoch？
- [ ] `mutation:` metadata schema 與 lint 強制（→ `/tech-spec`）。
- [ ] 意圖宣告 schema 設計（→ `/tech-spec`）。
- [ ] control plane 的 compaction resume（需 workflow resume hook，補 `post-compact-auto-loop.sh` 的 split-brain）。

## 9. Next Steps

- `/tech-spec workflow-orchestration` — 針對 Option C v1（report-only 編排器）詳細設計，含兩平面狀態、admission metadata schema、計畫格式。
- **Spike 1 + 1b 已完成、`-uno` bug 已修（2026-06-02/06-03，§8）**：mutation 編排前的順序更新為——(1) ✅ 修 `-uno` 降級 bug（已改 `-uall` + 次生 fail-open 一併修）；(2) 啟用 `STOP_GUARD_MODE=strict` + hook preflight；(3) **同 cwd mutation**（無 worktree）即可在護欄就緒後解禁；(4) **worktree-isolated mutation 另需**：canonical state resolver（`--git-common-dir` 統一 7 hook）+ worktree-aware/停用 reconciliation 降級 + Spike 2（16 並行 lock 競爭，已升為硬依賴），三者就緒才設計 mutation 平面。
- `/necessity-audit` — 對 tech-spec 做過度設計檢查（兩平面/metadata 是否必要）。
- 參考：[1-requirements.md](./1-requirements.md)、`docs/features/multi-agent-enhancement/2-tech-spec.md`（Phase C 排除）。
