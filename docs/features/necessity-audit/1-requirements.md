# Requirements: Necessity Audit (Over-Design Detection)

> **Doc class**: Lifecycle — Phase 1 requirements (per `@rules/docs-numbering.md`). Feature-level problem-space analysis. **Not** a task tracking ticket; for per-task progress tracking see `requests/*.md` (created via `/create-request`).
> **Created**: 2026-04-20
> **Updated**: 2026-04-20
> **Tier**: standard
> **Skill name**: `necessity-audit`（已定案，見 §9 Q1 RESOLVED）

## 1. Problem Statement

現行 spec pipeline（`/req-analyze` → `/tech-spec` → `/architecture`）紮實，但存在**反向失衡**：每個 phase 都在「加資訊」，沒有一個在「減資訊」。審核生態（`/review-spec` / `/codex-review-spec` / `/codex-review-doc` / `/feature-completeness` / `/best-practices`）全都在**找缺漏**（completeness、reasoning、risk、coverage、conformance），沒有任何 skill 在**找冗餘**。結果是 spec 越寫越肥 — 過度抽象、推測性擴展點、無 consumer 的 configurability、未量測的優化 — 這些都能通過現有審核，卻會在實作階段爆發為**過度工程 tax**（額外測試負擔、維護負擔、認知負擔）。

### 5-Why Trace

1. 表層：使用者想要一個能偵測「過度設計」的 skill
2. Why：紮實的 spec 流程鼓勵每個階段都「補完」，但沒有機制鼓勵「刪減」
3. Why：現有所有審核 skill 的失敗模式都偏向「找缺漏」 — reviewer 天生對「少了什麼」敏感，對「多了什麼」遲鈍
4. Why：必要性判斷反直覺 — 防禦性設計、擴展性焦慮、「以後可能用到」的抽象、configurability 強迫症都能說服自己是合理的
5. 根因：缺乏一個**對抗性必要性審核**機制，以 YAGNI / KISS / 精實原則為核心，主動挑戰每個設計元素「現在**真的**需要嗎」，並透過 Codex 獨立辯論對抗 Claude 自我共謀

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| 對 lifecycle spec 文件（`1-requirements.md` / `2-tech-spec.md` / `3-architecture.md`）執行必要性審核，標記 Keep / Review / Cut 三類元素 | 取代 `/codex-review-spec`（FP 推理挑戰 — 問「推理對嗎」；本 skill 問「需要嗎」） |
| 透過 `Skill("codex-brainstorm", ...)` 做雙邊 Nash-equilibrium 辯論（Claude 辯護現狀 vs Codex 質疑必要性），輸出 debate threadId + 引用 rounds | 取代 `/review-spec`（完整性 / 可行性 / 風險）或 `/feature-completeness`（跨維度完成度） |
| 採 **spec 為主、code 為 evidence** 模式：Codex 可 grep 實際程式碼驗證「這個抽象有幾個 consumer」「這個 flag 有幾處使用」等必要性證據（Q2:C） | 審核 code 本身是否過度抽象（由 `/simplify` / `/refactor` 負責） |
| 以**專屬** behaviour-layer sentinel（`✅ Audit Clear` / `⛔ Audit Revise`）整合 auto-loop（修訂自「沿用 doc review sentinel、不引入新 sentinel」，理由見 FR-7） | 自動執行刪減（審核只標示與建議，使用者決定；升為 `/refactor` / `/simplify` 的輸入） |
| 遵循 `@rules/codex-invocation.md`：不餵養結論、不餵養全文、Codex 獨立研究 | **預設**不對 `0-feasibility-study.md` 執行必要性審核（feasibility 階段本身即必要性辯論，重複）；例外見 FR-1 `--include-feasibility` override |
| 與 `/codex-review-spec` 可鏈式使用（先問「推理對嗎」→ 再問「需要嗎」）—兩者共存互補 | 跨 feature 的 portfolio 級必要性判斷（v1 限單 feature，單文件） |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| Spec 作者（Feature Designer） | User | 在 `/tech-spec` 完成後、進入 `/architecture` 或實作前，取得必要性挑戰，主動砍掉過度設計 |
| Reviewer（Senior Dev / Tech Lead） | User | PR / merge 前做 scope 審核，找出可 defer 到 v2 的元素 |
| Product Owner / Delivery Lead | User | 控制交付範圍、降低 over-engineering tax；debate 結論作為 scope trimming 決策依據 |
| Downstream 實作者（Developer） | Dependent | 避免接手過度複雜 spec 導致不必要實作成本 |
| Codex MCP | Dependent | 承擔獨立必要性挑戰者角色；須遵循 `@rules/codex-invocation.md` |
| `/codex-brainstorm`（Phase 3 辯論執行者） | Dependent | 本 skill 強制經由此 skill 發起辯論（對齊 `/best-practices` 的 Non-Negotiable Rule #2）；不得裸呼叫 `mcp__codex__codex` |
| Auto-loop / Stop Hook | Operator | 辨識本 skill 的 `✅ Audit Clear` / `⛔ Audit Revise` sentinel。這是**行為層**契約：`stop-guard.sh` 不解析它們，且刻意讓它們落在 doc-review 兩組 pattern 之外（含粗略的 `⛔.*(Block\|Needs revision\|Must fix)` recency 掃描），見 FR-7 |
| 既有審核 skills（`/codex-review-spec` / `/review-spec` / `/codex-review-doc` / `/feature-completeness` / `/best-practices`） | Peer | 本 skill 為縱向必要性軸；需在 `When NOT to Use` 清楚劃界 |
| `/simplify` / `/refactor` | Downstream | 本 skill 輸出的 Cut/Review 清單可作為修剪任務的輸入來源 |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|-------|--------|------------------|
| UC-1 | Spec 作者 | 完成 `2-tech-spec.md` 後執行 `/necessity-audit docs/features/<key>/2-tech-spec.md` | 取得 6 維度必要性評分 + 三層分類（Keep / Review / Cut）+ Codex 辯論 threadId + Nash equilibrium 結論 + gate sentinel |
| UC-2 | Reviewer | 對 `1-requirements.md` 執行 `/necessity-audit`，質疑 FR / NFR 是否「現在就需要」 | 找出可降級為 `Could` / `Won't` 的 FR；產出 MoSCoW 降級建議清單 |
| UC-3 | Reviewer | 對 `3-architecture.md` 執行，挑戰組件切分、擴展點、技術選型的必要性 | 取得「這個 layer 是否必要」「這個 adapter 是否有 ≥2 consumer」等具體質疑 |
| UC-4 | Spec 作者 | 依報告修正後執行 `/necessity-audit --continue <threadId>` | Codex 接續辯論，驗證修正是否確實移除過度設計、是否引入新的過度設計 |
| UC-5 | Reviewer | 在 `/tech-spec` 與實作之間作為 optional gate | 降低進入實作階段的 scope 冗餘 |
| UC-6 | Spec 作者 | 對 `1-requirements.md` 執行後，將 Cut 清單作為 `/simplify` 或後續 spec 修剪任務的輸入 | 下游修剪任務有明確、已辯論驗證的輸入 |

## 5. Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | 接受 target doc path 參數；支援 `1-requirements.md` / `2-tech-spec.md` / `3-architecture.md` / `4-*.md`；**預設排除** `0-feasibility-study.md`，但提供 `--include-feasibility` override flag（用於 feasibility study 過薄、必要性漂移發生在後續階段等邊緣案例）；override 時需於輸出頂端標示 `[OVERRIDE: feasibility included]` | Must | 劃清適用邊界；避免與 feasibility study 職責衝突；override 保留彈性 |
| FR-2 | 採**6 個必要性審核維度**（獨立於 `/fp-brief` 的 FP 維度，不對齊）：(1) **Necessity Now** — 現在就需要 vs 未來可能需要；(2) **Abstraction Justification** — 有 ≥2 個具體 consumer 嗎；(3) **Extensibility Speculation** — 擴展點有已知使用者嗎；(4) **Configurability Excess** — flag/option 有真實使用情境嗎；(5) **Premature Optimization** — 優化有量測支撐嗎；(6) **Scope Drift** — 解決原始 Problem Statement 還是偏離了 | Must | 核心審核框架；與既有 FP vocabulary 刻意區隔（目的不同：FP 是抽取推理，必要性是挑戰存在） |
| FR-3 | 三段式流程：**(A) Claude 初步分類** — 將 spec 中每個 FR / NFR / 抽象層 / 組件分為 Keep / Review / Cut；**(B) Codex 對抗辯論** — 透過 `Skill("codex-brainstorm", ...)`（**強制**，禁止裸呼叫 `mcp__codex__codex` 進行辯論），Claude 辯護現狀、Codex 質疑必要性，至 Nash equilibrium；**(C) 匯總 Verdict** — 依辯論結論調整分類、輸出最終報告。**Rounds 下限集中於 FR-11 定義**，本 FR 僅描述流程結構。**依賴契約繼承**：Phase B 透過 `/codex-brainstorm` 的 Codex 呼叫沿用該 skill 既有設定（含 `approval-policy: 'on-failure'`，見 `skills/codex-brainstorm/SKILL.md:62`），本 skill 不 override | Must | Q3:B 決議；對齊 `/best-practices` Non-Negotiable Rule #2；確保 Codex 不被 Claude 結論污染；避免宣告與下游 skill 實際契約衝突；rounds 語意單一來源（FR-11） |
| FR-4 | Codex 辯論 prompt **禁止餵養** Claude Phase A 分類結論；僅提供 (a) 目標文件路徑、(b) 必要性挑戰維度清單、(c) 允許 grep / cat 範圍 | Must | 遵循 `@rules/codex-invocation.md`；對抗 Claude 自我共謀 |
| FR-5 | **Code-as-evidence 模式（條件性）**：**Greenfield 判定規則（單一 operational 來源）** — 以 `git grep -l -E "<feature-key>" -- . ':(exclude)docs/**' ':(exclude)**/*.md' 2>/dev/null` 為主策略；若 pathspec magic 不可用（舊 Git）則 fallback `git grep -l -E "<feature-key>" -- . \| grep -vE '^docs/\|\.md$'`；兩者皆無輸出即視為 greenfield。有實作情境下，Codex 於 debate 中執行`grep -r` / `cat` 驗證具體必要性證據（例：抽象層 consumer 數、flag 使用處、擴展點 consumer），evidence 以 `file:line` 引用。**Greenfield 降級**：evidence 改以 `doc:section` 形式引用 spec 本身的自相矛盾 / 跨 spec 衝突 / 假設未支撐段落，並於該條目標記 `[REASONING-ONLY]` | Must | Q2:C 決議；讓辯論基於事實而非修辭；Greenfield 判定採單一規則（與 Signal-5 / Assumption 同步），避免實作者歧義 |
| FR-6 | 輸出結構：(1) 6 維度 rating table；(2) 三層分類清單（Keep / Review / Cut）每項附辯論結論引用；(3) Codex debate `threadId`（非空）；(4) Debate Conclusion（引用具體 Phase 3 rounds，不得留空或 placeholder）；(5) Suggested next commands（如 `/simplify` / `/refactor` / 手動修訂）。Evidence 欄位格式：`file:line`（code 可用時）或 `doc:section [REASONING-ONLY]`（greenfield 降級，見 FR-5） | Must | 對齊 `/best-practices` Non-Negotiable Rules #3-#4；讓下游 skill 可消費；與 FR-5 降級路徑一致 |
| FR-7 | **Gate sentinel 採本 skill 專屬命名空間（修訂自「沿用 doc review 標準」）**：`✅ Audit Clear`（無 Cut 項或所有 Cut 項已獲明確使用者認可） / `⛔ Audit Revise`（有未認可 Cut 項） | Must | 修正自原 FR-7：原文以「沿用 `hooks/stop-guard.sh:218-220` 解析、不引入新 sentinel」為理由，但該理由不成立——依修訂後的 FR-10，本 skill 的報告永遠不是 reviewer tool output，兩條 state 寫入路徑（Bash 端比對 command、MCP 端比對 prompt+output）都收不到它，所以「沿用」換不到任何 state。換到的是**碰撞**：`stop-guard.sh` 的 transcript fallback（無 state file 時的降級路徑）是位置無關的 grep，本 skill 報告提供 verdict，而 `/codex-review-doc` 這個 token 就出現在自己的 SKILL.md 路由表、`references/review-loop.md` 與 `preflight.js` advisory 中，兩半湊齊即可讓一次必要性稽核冒充 doc review 通過 Stop gate（已對真實 hook 實測重現：exit 0 `All steps completed`）。改採專屬 sentinel 即 `✅ Plan Ready` / `⛔ Plan Blocked` 對 plan plane 用的同一手法。用 `Revise` 而非 `Needs revision` 是刻意的：後者會被粗略 recency 掃描的 `.*` 命中，讓每次 blocking 稽核誤傷無關的 doc gate。詳見 2-tech-spec.md §3.9b 與 `test/skills/necessity-audit/stop-guard-isolation.test.js` |
| FR-8 | 支援 `--continue <threadId>` 透過 `mcp__codex__codex-reply` 做 loop 審核（注意：此為 Phase C Verdict 層的直接 Codex 呼叫，**非** Phase B 辯論；Phase B 的 loop 沿用 `/codex-brainstorm` 自身機制） | Must | 匹配 codex skills 的 review loop 模式；讓修正後驗證不需重新載入整個文件 context；清楚劃分兩種 Codex 呼叫時機 |
| FR-9 | `When NOT to Use` 清楚劃界：必須明列與 `/codex-review-spec`（FP 推理，規劃中）、`/review-spec`（完整性）、`/feature-completeness`（橫向完整性，規劃中）、`/best-practices`（產業標準）、`/simplify` / `/refactor`（code 層修剪）的職責差異；需包含 **Reasoning-vs-Necessity 2×2 決策矩陣**（見下方） | Must | 防止誤用；降低生態重疊爭議；2×2 矩陣於 §11 呈現 |
| FR-10 | 整合 auto-loop：**採顯式 review handoff，不自行寫 gate state**。本 skill 的報告由 `report.js` 在本地組裝、以模型自身訊息輸出——它**不是** Codex MCP 的 tool output，因此 `hooks/post-tool-review-state.sh` 的 MCP 路由收不到它，`doc_review.passed` 不會、也不應該被本 skill 觸發（見 2-tech-spec.md §3.3.3 / §3.9b）。稽核完成後由使用者或 auto-loop 明確執行 `/codex-review-doc` 走既有 doc gate。本 skill 仍在最終訊息尾部輸出裸 sentinel（`✅ Audit Clear` / `⛔ Audit Revise`，見修訂後的 FR-7）作為**行為層**訊號供人與模型判讀，但不宣稱任何 hook 會據此寫入 state。**不修改 hook 程式碼、不新增 state schema** | Must | 修正自原 FR-10：原文要求「MCP output 契約格式 → hook 設定 `doc_review.passed`」，但實作路徑下報告從不成為 MCP tool output，該 Must 驗收訊號永遠無法達成。與其為了滿足需求而讓一個本地組裝的報告偽裝成 reviewer 輸出（那正是 provenance 守衛要擋的東西），不如把契約改成它實際成立的樣子：稽核產出建議，doc gate 由真正的 doc review 負責 |
| FR-11 | 提供 `--depth brief\|normal\|deep` 旗標控制審核深度。**Depth 控制「維度覆蓋範圍 + equilibrium 嚴格度」，不控制 rounds**（下游 `/codex-brainstorm` 未暴露 `min_rounds` / `max_rounds` 輸入契約，其內部 min ~3 / max 5；spec 改為對齊可觀察行為）：`brief` = 維度 1-3（Necessity / Abstraction / Extensibility）、任意終止可接受；`normal` = 全 6 維、任意終止可接受（預設）；`deep` = 全 6 維 + **要求 Nash equilibrium**（若 `/codex-brainstorm` 以 convergence 或 max-rounds 終止，則觸發 `⚠️ Need Human` narrative + `⛔ Audit Revise` gate）。實際 rounds 數僅作為 audit trail，不參與 gate 決策 | Could | 對齊 `/codex-brainstorm` 實際可觀察行為，避免宣告不可實施的 round 下限（見 2-tech-spec.md §3.5 Phase C） |
| FR-12 | 提供 `--output json` 旗標輸出結構化 JSON，便於下游 skill 消費 Cut/Review 清單 | Could | 與 `/simplify` / `/refactor` pipeline 整合的強化點；v1 可先以 Markdown 為主 |
| FR-13 | **預檢策略（修訂：移除 nested `Skill()` 呼叫以避免 state 副作用）**：(a) 行數檢查 `wc -l <target>` ≥ 50，否則 hard block；(b) 讀取 `.claude_review_state.json` `doc_review.passed`；若 `true` 且 `last_run` 晚於 target file 最近 commit 時間，silent 通過；否則輸出 **非阻斷** advisory: `ℹ️ No recent /codex-review-doc pass detected in this session. Recommend running /codex-review-doc first.`（**不因此 block，因 state 未做 target-binding，advisory 為 session-level 而非 file-bound**）；(c) `--skip-preflight` flag 抑制 advisory，並在輸出頂端標示 `[PREFLIGHT SKIPPED]`；(d) 若工作區對 target 有未提交變更（`git status --porcelain -- <target>` 非空），輸出警告 `⚠️ Dirty working tree on target; necessity audit reflects uncommitted state`（獨立於 `--skip-preflight`，始終顯示） | Should | Nested `Skill("codex-review-doc")` 會觸發 `post-tool-review-state.sh` 對 `doc_review.passed` 的寫入，讓一次預檢在外層 skill 的 state 上留下副作用；改為 non-blocking advisory 消除之。（原文的附帶理由「`check_passed()` 不認 `✅ Mergeable`，只認 `## Gate: ✅` / `✅ All Pass`」自 2026-07-25 起不再成立：`check_passed()` 已改為僅認 review-plane sentinel — `✅ Ready` / `✅ Mergeable` / `## Gate: ✅` — 並移除 `✅ All Pass`，後者依 `@rules/auto-loop.md` 本就是行為層散文。副作用本身仍是改用 advisory 的理由。）target-binding 缺失靠 advisory 語氣與 dirty-tree warning 補償 |

Priority: Must / Should / Could / Won't (MoSCoW)

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Correctness | Codex prompt 必須要求獨立 `cat` 目標文件；Claude 不得附帶文件內容在 prompt 中 | Prompt template 審核：不含 `${FILE_CONTENT}`、不含 Phase A 分類結論 |
| NFR-2 | Correctness | Phase B 辯論必須經由 `Skill("codex-brainstorm", ...)`；禁止裸呼叫 `mcp__codex__codex` 做辯論 | SKILL.md grep 驗證 + Non-Negotiable Rule 文件化（對齊 `/best-practices` Rule #2） |
| NFR-3 | Security | **僅本 skill 直接發起的 Codex 呼叫**（如 FR-8 `--continue` loop review）採 `sandbox: 'read-only'` + `approval-policy: 'never'`；Phase B 透過 `/codex-brainstorm` 發起的 Codex 呼叫沿用下游 skill 既有設定（見 FR-3 依賴契約繼承條款），本 skill 不 override | Prompt template grep；清楚區分本 skill 直接呼叫 vs 下游 skill 繼承呼叫 |
| NFR-4 | Security | 目標 path 必須通過 **兩層驗證**：(a) **Resolver 層** — 沿用 `scripts/lib/feature-resolver.js:9` 之 slug regex `/^[a-z0-9][a-z0-9._-]*$/i`；(b) **Post-resolve Containment 層**（本 skill 新增）— 對 resolved path 執行 `realpath` 後驗證仍位於 `git rev-parse --show-toplevel` 之下，拒絕 `..` 穿越、絕對路徑逃逸、repo 外 symlink。**不假設** shared resolver 已做 containment — 實測 `feature-resolver.js:17` 無 `realpath/lstat` 檢查 | 路徑驗證 unit test 涵蓋：(1) 合法 slug、(2) `..` 穿越、(3) 絕對路徑、(4) repo 外 symlink 連結、(5) repo 內但目錄外 symlink |
| NFR-5 | Consistency | Gate sentinel 使用本 skill 專屬命名空間（`✅ Audit Clear` / `⛔ Audit Revise`），**且輸出與所有隨稽核載入 transcript 的 skill 檔案中皆不得出現 doc-review sentinel**（修訂自「使用 doc review 標準、不引入新 sentinel」，理由見 FR-7） | `stop-guard-isolation.test.js`：(a) 對 5 個 audit surface 逐行掃描無 doc-review sentinel；(b) 對真實 `stop-guard.sh` 端到端驗證通過稽核不滿足 doc gate、blocking 稽核不撤銷既有 doc pass；(c) 反向 control |
| NFR-6 | Consistency | 報告 schema 包含 `threadId` 與 `Debate Conclusion` 兩欄，缺一視為 Report rejected（對齊 `/best-practices` Non-Negotiable Rules #3-#4） | Report validator unit test |
| NFR-7 | Maintainability | SKILL.md 採 thin entry 模式；完整 prompt、6 維度定義、debate guide、output template 置於 `references/`（對齊 `/codex-review-doc` / `/doc-review` / `/best-practices` 結構） | SKILL.md ≤ 200 行（對齊 `/best-practices` SKILL.md 195 行 peer 基準）；references 分離 |
| NFR-8 | Performance | 預設 `--depth normal` 對單一 spec 的耗時，相較於 `/codex-review-doc` 同文件 p50 耗時不超過 **2.0 倍**（含 Codex debate overhead）。**Baseline 環境固定**：(a) 同一 MCP session（warm cache）；(b) 同一 target file revision（不跨 commit 比較）；(c) 量測前排除首次冷啟動樣本；(d) 採樣方法：連續 5 次執行取 p50，1.5×IQR outlier 排除 | 可量測；baseline 環境完整；outlier 處理明確 |
| NFR-9 | Reliability | Codex MCP 不可用時，skill 明確失敗並提示 fallback（如先執行 `/review-spec` 取得基礎審核） | 錯誤處理 unit test |
| NFR-10 | Reliability | Phase B 辯論若 Codex 未實質參與，skill 必須於輸出中標記 `⚠️ Need Human` narrative 並將 gate sentinel 設為 `⛔ Audit Revise`（**narrative 與 sentinel 分離**：sentinel 永遠是 `✅ Audit Clear` 或 `⛔ Audit Revise` 此為 **behavior-layer** 詞彙選擇，非 hook 相容性需求：state 寫入是 provenance-bound 的，這兩個 sentinel 不會由本 skill 觸發 hook 記錄，且自 FR-7 改用專屬命名空間後亦不再與 transcript fallback 碰撞（見 2-tech-spec.md §3.9b）；`⚠️ Need Human` 出現在 sentinel 前的敘述段落）。**Deterministic 觸發條件**（任一 fail 則 Need Human narrative + ⛔）：(i) 辯論 rounds ≥ 2（最低有意義的辯論；`/codex-brainstorm` 預設 min ~3，< 2 視為異常）；(ii) Codex 輸出含至少 1 筆 evidence citation（`file:line` 或 `doc:section`）；(iii) 辯論內容含 ≥1 筆明確立場（Challenge / Defend / Accept / Reject / Concede）；(iv) threadId 非空；(v) 對 `--depth deep`，`equilibrium_reached === true`（convergence / max-rounds 視為未達）；(vi) Debate Conclusion 明確引用具體 round（`R<n>` 或 `round N`）——即 SKILL.md Rule #4，防止結論留白或 placeholder。滿足所有 check 但 findings 為空屬**合法 pass**（`✅ Audit Clear`） | 測試：(1) Codex 空回應、(2) rounds < 2、(3) 無 evidence、(4) 純立場重複、(5) 合法 empty-findings pass、(6) deep depth 無 equilibrium、(7) 結論未引用 round |
| NFR-11 | Security | 輸出報告之 evidence citations（`file:line` / `doc:section`）、debate 內容不得包含 secrets / tokens / passwords / 完整地址；沿用 `@rules/security.md` 與 `@rules/logging.md` 遮罩規範；sensitive pattern 偵測於 SKILL.md 輸出前過濾層實作 | 輸出 grep 測試：對包含 mock secrets 的測試 spec 執行後，驗證輸出不含原始 secret；對齊 `docs/features/codex-review-spec/1-requirements.md` NFR-9 redaction 先例 |

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint | 必須沿用現有 doc review sentinel 契約；禁止修改 `hooks/stop-guard.sh` 或擴充 state schema | `@rules/auto-loop.md` 不擴充 hook 契約原則 |
| Constraint | Phase B 辯論必須經由 `/codex-brainstorm`，不得裸呼叫 `mcp__codex__codex`（與 `/best-practices` Non-Negotiable Rule #2 一致） | 生態一致性要求 |
| Constraint | Skill 僅對 `1-/2-/3-/4-*.md` 有效；**預設拒絕** `0-feasibility-study.md` 與非 lifecycle docs；`--include-feasibility` 為白名單 override（FR-1） | FR-1；避免與 `/feasibility-study` 功能重疊；override 語意一致於 Non-Goal 表 |
| Constraint | SKILL.md ≤ 200 行（thin entry 模式，對齊 `/best-practices` peer 基準） | NFR-7；對齊生態 |
| Assumption | 使用者能接受「必要性審核本質上有主觀性」— 因此輸出分類（Keep / Review / Cut）而非 binary verdict，並附辯論依據 | 使用者 input（Q3:B 選擇雙邊對抗） |
| Assumption | Codex MCP 於 YAGNI / KISS / 精實開發議題有足夠知識基礎，能扮演挑戰者角色；不需要額外 fine-tune | `/codex-brainstorm` 既有使用情境 |
| Assumption | 目標 spec 已完成（非 draft 階段），否則過早的必要性審核會產生大量偽陽性 | FR-13；建議先執行 `/codex-review-doc` |
| Assumption | 目標 spec 所屬 feature 若已有部分實作或 related code，Code-as-evidence (FR-5) 可提供 `file:line` 強證據；greenfield 判定沿用 **FR-5 / Signal-5 單一 operational 規則**（`git grep -l -E "<feature-key>"` + pathspec exclude，見 FR-5），降級為 `doc:section` 引用並標記 `[REASONING-ONLY]`，**非**無 evidence pass | Greenfield 判定已集中於 FR-5，Assumption / Signal-5 同步引用該規則，避免三處不一致 |
| Assumption | 必要性分類的「Review」中間類別比 binary Keep/Cut 更能反映現實 — 許多元素不是「絕對必要」也不是「絕對多餘」，而是「需要更多 context 才能定」 | UX 考量；對應 UC-2 的 MoSCoW 降級情境 |

## 8. Acceptance Signals

- **Signal-1 (FR-1, FR-9)**: 對 `1-requirements.md` / `2-tech-spec.md` / `3-architecture.md` 分別執行後，輸出報告結構一致；對 `0-feasibility-study.md` 執行則回傳明確拒絕訊息
- **Signal-2 (FR-2, FR-6)**: 報告包含完整 6 維度 rating table + Keep / Review / Cut 三層分類；每個 Cut 項附 Codex 辯論引用
- **Signal-3 (FR-3, NFR-2)**: Skill 執行過程中可觀察到 `Skill("codex-brainstorm", ...)` 被呼叫（非裸 `mcp__codex__codex`）；辯論輸出含非空 threadId
- **Signal-4 (FR-4, NFR-1)**: Codex prompt inspection 顯示不含 Phase A 分類結論；Codex 於辯論中主動執行 grep / cat
- **Signal-5 (FR-5, FR-6)**: **條件性** — greenfield 判定沿用 FR-5 定義的單一 operational 規則（primary：`git grep -l -E "<feature-key>" -- . ':(exclude)docs/**' ':(exclude)**/*.md'`；fallback：`git grep -l -E "<feature-key>" -- . \| grep -vE '^docs/\|\.md$'`；feature-key 由 `scripts/lib/feature-resolver.js` 取得）。有輸出視為「有實作」，至少一個 Cut 項引用 `file:line`；無輸出視為 greenfield，至少一個 Cut 項引用 `doc:section` 並標記 `[REASONING-ONLY]`
- **Signal-6 (FR-7, FR-10, NFR-5)**: (a) 報告尾部輸出裸 sentinel（`✅ Audit Clear` 或 `⛔ Audit Revise`），且輸出與所有隨稽核載入的 skill 檔案皆不含 doc-review sentinel；(b) 執行本 skill **不會**改動 `.claude_review_state.json` 的 `doc_review` 子樹——以 before/after 比對驗證，這是負向斷言：本地組裝的報告不得偽裝成 reviewer 輸出而取得 gate；(c) 稽核後執行 `/codex-review-doc`，由該 skill 的真實 MCP 輸出走既有路由設定 `doc_review.passed`
- **Signal-7 (FR-8)**: `--continue <threadId>` 能接續同一 Codex session 執行 Phase C 的 verdict 層續審，驗證修正是否移除過度設計（Phase B 辯論續審由 `/codex-brainstorm` 自身 loop 機制處理）
- **Signal-8 (NFR-10)**: NFR-10 **六**條件任一 fail 時於 sentinel 前輸出 `⚠️ Need Human` narrative **並**設 gate 為 `⛔ Audit Revise`；合法 empty-findings pass（Codex 明確表示無過度設計且六條件均滿足）不誤觸發，輸出 `✅ Audit Clear`。條件數以 `consolidate.js` 實作為準（`rounds_ok` / `has_evidence_citation` / `has_explicit_stance` / `has_threadId` / `equilibrium_required_met` / `conclusion_references_rounds`）——需求原文寫「五條件」而實作與 tech spec 皆為六，差異即為 `conclusion_references_rounds`
- **Signal-9 (NFR-8)**: 連續 5 次採樣（同 session、同 revision、排除冷啟動、1.5×IQR outlier 排除）`/necessity-audit` p50 ≤ `/codex-review-doc` p50 的 2.0 倍
- **Signal-10 (NFR-7)**: SKILL.md 行數 ≤ 200（peer 基準對齊 `/best-practices` SKILL.md）；`references/` 目錄包含 prompt template / debate guide / 6-dimension definition / output template 四個分離檔案
  - ⚠️ **目前未達標（2026-07-25 量測：224 行）**。references 分離的部分已達成（7 個檔案）；超出的是移除 `Bash(rm:*)` 後新增的 scratch-dir cleanup 契約說明，必須內嵌在 `cleanup.js` 呼叫前。判定與處置見 tech-spec §3.10「NFR-7 deviation」。此訊號維持 ≤ 200 不調整——要嘛裁到達標，要嘛明確修訂 NFR-7，不得默默放寬。
- **Signal-11 (NFR-11)**: 輸入包含 mock secret pattern 的測試 spec，輸出報告不含原始 secret 字串（通過 grep 驗證）
- **Signal-12 (NFR-4)**: 路徑驗證 unit test 通過 5 個案例（合法 slug / `..` 穿越 / 絕對路徑 / repo 外 symlink / repo 內目錄外 symlink）

## 9. Open Questions

### Resolved Decisions

- [x] **Q1**: Skill 命名 → `necessity-audit`（使用者 2026-04-20 決議，選項 B）
- [x] **Q2**: 審核目標範圍 → spec 為主、code 為 evidence（使用者 2026-04-20 決議，選項 C）
- [x] **Q3**: 辯論對抗模式 → 雙邊對抗（Claude 辯護 vs Codex 質疑）Nash equilibrium（使用者 2026-04-20 決議，選項 B）
- [x] **Q7 (originally: greenfield degradation)**: Code-as-evidence 降級路徑 → 已於 FR-5 / FR-6 / Signal-5 明文規定（`doc:section` + `[REASONING-ONLY]` 標記）；不再為 open question

### Open (to be decided at `/tech-spec`)

> 以下問題交由 `/tech-spec` 階段決議（Phase 2 設計決策，非需求 scope）。

- [ ] **Q4**: 6 維度精確定義與評分標準（rating scale 採 0-10 / High/Med/Low / Keep/Review/Cut？）— 建議 tech-spec 階段與 `/fp-brief` 對照避免語彙衝突
- [ ] **Q5**: Phase A Claude 分類是否需要 prompt template 化？還是依賴 SKILL.md 行為指示即可？— 傾向前者以確保一致性
- [ ] **Q6**: Cut 清單如何與 `/simplify` / `/refactor` 整合？JSON 輸出格式？(FR-12) — 可留至 v2 迭代
- [ ] **Q8**: 是否允許使用者在 Phase C Verdict 階段 override Codex 結論？— 影響 gate sentinel 發射邏輯（建議：允許但需 `--override <rationale>` 明確 flag，於輸出中留記錄）
- [ ] **Q9 (NEW)**: 輸出 secret 遮罩（NFR-11）於何處實作？SKILL.md 行為層 filter 或 references/ template 中內建？— tech-spec 決定實作位置
- [ ] Solution concern: 若 Codex MCP 長期不可用（例如離線環境），是否提供 Claude-only 降級模式？— 涉及解決方案空間，建議以 `/feasibility-study` 延伸評估

## 10. References

- Request ticket directory: `requests/` — not yet created; per-task tickets go there once the first is filed via `/create-request`. Deliberately not a link while the target does not exist.
- Tech Spec: [2-tech-spec.md](./2-tech-spec.md)
- Ecosystem peers:
  - `docs/features/codex-review-spec/1-requirements.md` — **planned** (not yet implemented) FP 推理審核（縱向 · 推理對嗎）— 非本 skill（本 skill 問必要性）
  - `skills/review-spec/` — **implemented** Claude subagent 完整性 / 可行性 / 風險審核（橫向多維）
  - `docs/features/feature-completeness/1-requirements.md` — **planned** (Phase 1 done 2026-04-20, skill not yet built) 跨維度完成度核對（橫向 · 做完沒）
  - `skills/best-practices/` — **implemented** 產業標準符合度 + 對抗辯論（辯論模式直接參考；Non-Negotiable Rules 模式來源）
  - `skills/codex-review-doc/` — **implemented** 文件細節審核（寫作 / 引用 / 代碼對應）
  - `skills/fp-brief/` — **implemented** FP 推理鏈抽取（共享 vocabulary 參考，但**不對齊**必要性維度）
  - `skills/simplify/` / `skills/refactor/` — **implemented** 下游修剪 skill（本 skill 輸出可作為其輸入）
- Normative rules:
  - `@rules/codex-invocation.md` — Codex 獨立研究原則（FR-4 / NFR-1 源）
  - `@rules/auto-loop.md` — Sentinel 契約與 Need Human 定義（FR-7 / FR-10 / NFR-5 / NFR-10 源）
  - `@rules/docs-numbering.md` — Lifecycle doc 編號規則（FR-1 適用範圍源）
  - `@rules/security.md` / `@rules/logging.md` — Secret / sensitive data 遮罩規範（NFR-11 源）
- Hook contracts (以 Codex 獨立驗證實際行數為準，非靜態 line ranges)：
  - `hooks/stop-guard.sh` — Doc review sentinel 解析（NFR-5 整合點，read-only state 消費者）
  - `hooks/post-tool-review-state.sh` — MCP tool 輸出解析並寫入 state（FR-10 整合點：依 MCP output 模式 `## Document Review` + sentinel 觸發，非依命令名稱）
- Precedent templates:
  - `skills/best-practices/SKILL.md` Non-Negotiable Rules 區段 — 本 skill Rules #2-#4 沿用
  - `skills/doc-review/references/codex-prompt-doc.md` — Codex prompt template 起點（6 維度替換後可用）
  - `skills/create-request/references/feature-context-resolution.md` — 共享 feature resolver（含 slug regex；本 skill **另外追加** Post-resolve containment 驗證，見 NFR-4）
  - `scripts/lib/feature-resolver.js` — Resolver 實際程式碼（NFR-4 引用，slug regex 來源）
  - `docs/features/codex-review-spec/1-requirements.md` NFR-9 — Redaction 先例（NFR-11 對齊基準）
- Research artifacts: Phase 2 code analysis（Explore agent report, 2026-04-20）

## 11. Reasoning-vs-Necessity Decision Matrix（FR-9 支持）

當 reviewer 面對 spec 不確定該用哪個審核 skill 時，依下表判斷：

| 審核目標 | 推理合理嗎？（邏輯對嗎） | 現在需要嗎？（必要性） |
|---------|------------------------|---------------------|
| **新 spec 第一輪審核** | `/codex-review-spec`（FP 推理挑戰，規劃中）→ 再 `/necessity-audit` | 順序：先推理、後必要性（站不住的推理上的必要性無意義） |
| **Reviewer 懷疑 scope 過大** | — | `/necessity-audit`（直接）— 推理已在其他階段檢查 |
| **Reviewer 懷疑假設錯誤** | `/codex-review-spec`（規劃中）/ `/review-spec` | — |
| **Reviewer 懷疑兩者皆有** | 先 `/codex-review-spec` → 修正 → `/necessity-audit` → 修正 | 避免同時執行產生交叉干擾 |
| **PR / release gate** | `/review-spec`（完整性） + `/feature-completeness`（橫向做完沒，規劃中） | `/necessity-audit`（scope 冗餘） |
| **Spec 已 merge 但實作發現過度** | — | `/simplify` / `/refactor`（code 層）— 非本 skill |

**Chain 範例**：`/codex-review-doc` (細節) → `/codex-review-spec` (推理，規劃中) → `/necessity-audit` (必要性) → `/feature-completeness` (完整性，規劃中) → `/review-spec` (綜合)。本 skill 為鏈中第三站。
