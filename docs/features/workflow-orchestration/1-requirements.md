# Requirements: Workflow Orchestration（代理式編排器）

> **Doc class**: Lifecycle — Phase 1 requirements（依 `@rules/docs-numbering.md`）。Feature 層級的問題空間分析。**非**任務追蹤 ticket；逐任務進度追蹤見 `requests/*.md`（由 `/create-request` 建立）。
> **Created**: 2026-05-29
> **Updated**: 2026-05-29
> **Tier**: standard

## 1. Problem Statement

目前要把專案的 98 個 skill 串成一條可用的 workflow，**完全靠人工編排**：開發者必須自己決定「先 `/req-analyze` → 再 `/tech-spec` → 再 `/codex-review-fast` → …」，並憑記憶遵循 `CLAUDE.md:13-17` 的固定流程表。這個「編排決策」是問題的核心——它鎖在人腦與文件中，無法因應動態情境，也無法隨 skill 數量成長而擴展。

我們要的能力：**人只聲明「意圖 + 約束 + 完成定義」，由 agent 自動推導出該跑哪些 skill、用什麼順序/並行、何時驗證、何時收斂，並持續維持「期望狀態」直到達成**——一如 k8s 把容器編排從「人工逐步部署」轉為「宣告期望狀態、由控制迴圈自動調度」。

### 5-Why Trace

1. **Surface**：想要一版通用 workflow，把「skills 如何串成 workflow」交給 agent 決定，而非人手動編排。
2. **Why（為何需要）**：每個任務都要人決定步驟順序，靠人腦 + 記憶 `CLAUDE.md` 流程表；編排是純人工活動。
3. **Why（為何是問題）**：(a) 編排知識鎖在人腦/文件，新情境難正確編排；(b) 98 skills 組合爆炸，人記不住最佳路徑；(c) 固定流程表無法因應動態情境（這個 task 該不該跳過某步？該不該並行？）；(d) 編排成果不可重用、不可隨 skill 成長擴展。
4. **Root（成功樣貌）**：給定「意圖 + 約束」，系統能自動規劃並執行 workflow，持續比對「現況 vs 期望」決定下一步，直到完成定義被滿足——編排能力本身成為一項可被 agent 承擔的服務，而非人工負擔。

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| 以「宣告式意圖」取代「命令式步驟序列」作為 workflow 的輸入 | 設計具體的編排引擎/控制器架構（屬 `/tech-spec`、`/architecture`） |
| 由 agent 動態推導 skill 組合與順序/並行（而非寫死於 skill 作者的 if/then 或文件流程表） | 取代或繞過既有 auto-loop / hook safety gate |
| 提供一版 v1「通用 workflow」作為規劃基線，涵蓋最常見任務形狀 | 為全部 98 skill 一次性補齊完整 metadata（範圍待 feasibility 評估） |
| 執行前可預覽 agent 推導出的計畫（plan preview / dry-run） | 全自動無人監督地大規模改檔（高風險，刻意排除） |
| 編排層與 skill 邏輯解耦，新增 skill 可被自動納入候選 | 決定採用 Dynamic Workflows preview 或自製（屬 `/feasibility-study`） |
| 與既有 98 skill、15 agent、hook 狀態機、Codex 規則共存 | 多人協作/跨 session 的團隊式編排（後續迭代） |

> **與 `multi-agent-enhancement` 的關係**：該 feature（`docs/features/multi-agent-enhancement/2-tech-spec.md:10`）明確將「full agent platform (C)」排除於範圍外。本 feature 正是那個被排除的**編排平台層**，與其互補而非重疊。

### Adjacent Scope（與 `multi-agent-enhancement` 對照）

| 面向 | `multi-agent-enhancement` | 本 feature（workflow-orchestration） |
|------|---------------------------|--------------------------------------|
| 核心目標 | 把既有 agent 接線到 skill（該 spec 當時 14 個；目前 repo 為 15）；平行化 2 個高 ROI skill | 由 agent 動態**規劃**整條 workflow（選 skill + 編排） |
| 抽象層級 | 單一 skill 內的 agent 派發 | 跨 skill 的編排決策層 |
| 編排者 | skill 作者預先寫死 | agent 依意圖執行期推導 |
| 範圍歸屬 | Phase B0/B1 | 被該 spec 排除的 Phase C「full agent platform」 |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| Plugin 使用者（開發者） | User | 少記 workflow，下「意圖」即可；計畫可預覽、可信任 |
| Plugin 維護者（本 repo 作者） | Developer | 編排核心可維護；不破壞既有 safety gate（現況預設 `STOP_GUARD_MODE=warn` 為 advisory，strict 為 opt-in fail-closed——見 §7 Constraints） |
| 既有 98 個 skill | Dependent | 被編排的對象——編排器需理解其用途/前後置/I-O 契約（`docs/skill-catalog.yml` 已編目 96 筆，其中部分有 `use_when`） |
| auto-loop / hook 狀態機 | Operator / Dependent | 既有反應式編排器（`hooks/stop-guard.sh`、`post-tool-review-state.sh`、`.claude_review_state.json` `review_phase`）；新編排器須相容，避免雙頭衝突 |
| Claude 主 agent | Operator | 規劃與執行的承載者；編排狀態不應污染主上下文 |
| Codex（MCP 驗證者） | Dependent | 驗證步驟須遵守獨立研究規則（`rules/codex-invocation.md`） |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|-------|--------|-----------------|
| UC-1 | 開發者 | 下達「完成這個 feature 並確保品質」 | 編排器自動規劃 req → spec → dev → test → review → precommit 並執行，全程過既有 gate |
| UC-2 | 開發者 | 下達「audit 整個 repo 的某主題」 | 編排器規劃 fan-out 審計 + 交叉驗證 + 匯總（report-only，不改檔） |
| UC-3 | 開發者 | 執行前想先看計畫 | 系統輸出可讀的 workflow 計畫（skill + 順序 + 平行點 + 驗證點 + 收斂條件），確認後才執行 |
| UC-4 | 維護者 | 新增一個 skill | 下次編排自動將其納入候選，無需修改編排核心 |
| UC-5 | 開發者 | 編排中途某步失敗或偏離 | 編排器重新規劃或安全停在 human gate，而非整體失敗或繞過 gate |
| UC-6 | 開發者 | 編排執行中主動中止 | 系統安全停止、不留下半完成的危險狀態（如未驗證的部分變更），並可報告已完成/未完成步驟 |

## 5. Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | 接受**宣告式意圖**輸入（目標 + 約束 + 完成定義），而非命令式步驟序列 | Must | 問題根因——把「怎麼做」從人轉移給系統 |
| FR-2 | 由 **agent 動態推導**候選 skill 集合與相依順序/並行；決策不寫死於文件流程表或 skill 作者的 if/then 分支 | Must | 現況條件呼叫皆為作者寫死（`req-analyze` SKILL.md:199、`deep-research` SKILL.md:221-238 的條件→派發、`remind` SKILL.md:76-83 偵測+:154-165 執行、`next-step` SKILL.md:60-72），非執行期適應 |
| FR-3 | 輸出可讀的 **workflow 計畫**（選用 skill + 順序 + 平行點 + 驗證點 + 收斂條件），支援執行前預覽（plan preview / dry-run） | Must | Safety——人需在執行前審視 agent 推導出的計畫 |
| FR-4 | 編排執行**必須尊重既有 safety gate**：auto-loop review/precommit、no-auto-commit、human gate——不可繞過。對會**改檔/mutating** 的編排，須在執行前確保 stop-guard 處於 fail-closed（`STOP_GUARD_MODE=strict`）；否則維持 report-only（見 §7 strict-preflight constraint） | Must | 編排器**期望**達到 fail-closed 強制；但現況 stop-guard 預設 `STOP_GUARD_MODE=warn`（advisory），strict 為 opt-in，故 mutating 編排須做 strict preflight 而非假設既有預設已 fail-closed；`rules/git-workflow.md`、`rules/auto-loop.md` |
| FR-5 | 支援三種編排形狀：**循序**、**平行**（多步同時進行後彙整）、**重複直到收斂**。v1 至少涵蓋此三者（具體原語/語法屬 `/tech-spec`） | Should | 對應既有 wave-based（`deep-explore`）與 auto-loop 收斂迴圈兩種已存在形狀 |
| FR-6 | 每個被編排步驟可宣告**前置條件與完成判準**；編排器依此判斷某步是否該執行、是否已達成（如何持續比對屬 `/tech-spec`） | Should | 對應既有 `review_phase` FSM 的轉移概念；使用者 k8s 類比的核心 |
| FR-7 | 編排**中間結果與狀態獨立持有**，不污染主對話上下文 | Should | 既有痛點——`deep-explore` 已用 background agent fan-out（`SKILL.md:56-67`）+ context packet 過濾（`SKILL.md:87-94`）緩解 |
| FR-8 | 提供 v1「**通用 workflow**」起點：一份涵蓋最常見任務形狀（feature 開發、bug 修復、審計/研究）的通用編排基線 | Must | 使用者明確要求「至少先設計一版通用 workflow」 |
| FR-9 | 步驟失敗/偏離時可**重新規劃**（re-plan），而非整體失敗 | Could | v1 可選；提升韌性 |
| FR-10 | 編排成果可**保存/重用**，同類任務可重跑 | Could | v1 可選；對應 Dynamic Workflows 的「saved workflow command」概念 |
| FR-11 | 新增 skill 時，編排器能在**不修改編排核心**的前提下將其納入候選 | Should | k8s「新資源自動可被調度」；維護性關鍵 |

Priority: Must / Should / Could / Won't (MoSCoW)

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Security | 預設 plan-first / report-only；寫檔、刪除等高風險動作須經 human gate；不得執行 Claude 禁止的 git 變更操作（`add`/`commit`/`push`/`stash`/`reset --hard`/`rebase`），既有例外（`/push-ci`、`/smart-commit --execute`、`/epic-merge`）仍須經各自的使用者核可 | 0 次未授權 git 變更；高風險步驟 100% 經 gate |
| NFR-2 | Observability | 編排過程可見：哪個 skill 在跑、為何被選、目前處於哪個 phase | 每個編排決策附「選用理由」且可追溯 |
| NFR-3 | Cost | 編排規劃本身 token 成本可控、可預估；規劃階段須有可配置 token 上限，超出即 fail-closed（不靜默截斷）。分層方式（例如 S/M/L budget tier）屬 `/tech-spec` | 規劃有 token 上限；超預算時規劃明確失敗而非無限展開 |
| NFR-4 | Compatibility | 與既有 98 skill、15 agent、auto-loop hook FSM、Codex 規則共存 | 既有 auto-loop / hook 測試 0 回歸 |
| NFR-5 | Maintainability | 編排邏輯與 skill 邏輯解耦；skill 作者不需在各 skill 寫死 if/then 編排分支 | 新增情境不需改既有 skill 內文 |
| NFR-6 | Reliability | 編排可重入；中斷後狀態可恢復或安全重跑 | 中斷後不產生重複副作用，可從狀態恢復 |

Categories: Performance, Security, Usability, Maintainability, Reliability, Scalability

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint | 不可繞過 git 變更禁令（完整集合與例外見 NFR-1 與 `rules/git-workflow.md:6-9`） | `rules/git-workflow.md` |
| Constraint | **現況 safety gate 預設為 advisory，非 fail-closed**：`.claude/settings.json` 設 `STOP_GUARD_MODE=warn`，且 `hooks/stop-guard.sh` 預設亦為 `warn`——此模式僅警告缺步驟但仍放行 stop；唯有 `STOP_GUARD_MODE=strict` 才硬阻擋（exit 2）。編排器**不可假設既有預設已 fail-closed**。 | `.claude/settings.json:3`、`hooks/stop-guard.sh`（`_resolve_guard_mode` 預設 `warn`、strict 才 exit 2） |
| Constraint | **Strict-preflight（mutating 編排）**：任何會改檔/mutating 的編排在執行前須確保 stop-guard 為 `STOP_GUARD_MODE=strict`（fail-closed）；無法確保 strict 時，該編排須降級為 report-only（v1 預設行為，見 NFR-1），不得在 warn 模式下執行 mutating 步驟而誤以為 gate 會硬阻擋 | 衍生自 FR-4 + 現況 warn 預設 |
| Constraint | 既有 auto-loop 由 hook FSM 強制（`hooks/stop-guard.sh`、`post-tool-review-state.sh`）；新編排器須相容，不可形成兩套互相衝突的編排 | 程式碼觀察 |
| Constraint | 編排中所有 Codex 驗證須遵守獨立研究規則 | `rules/codex-invocation.md` |
| Constraint | 目前無宣告式 workflow 引擎；`CLAUDE.md:13-17` 流程為 documentation-as-policy，僅供 Claude 遵循 | 程式碼觀察 |
| Assumption | 編排層可用 Claude Code 既有原語（`Skill()`、`Agent()`）組裝（16 個 SKILL.md 已引用 `Agent(`，其中 7 個用 `run_in_background` 背景派發） | 程式碼觀察 |
| Constraint | 各 skill 的**用途**可部分由 SKILL.md `description` / `docs/skill-catalog.yml`（96 筆）的 `use_when` 推導；但**前置/後置/I-O 契約 metadata 尚未系統化**，需 feasibility 階段盤點補齊（見 Open Questions） | 程式碼觀察 |
| Assumption | 使用者願意以「宣告意圖」取代「逐步下指令」 | 使用者陳述 |
| Assumption | k8s 類比（宣告期望狀態 + 控制迴圈調度）適用於 skill 編排領域 | 使用者陳述（待 feasibility 驗證） |

## 8. Acceptance Signals

- **Signal 1（FR-1/2/3）**：給定一段自然語言意圖，系統輸出一份「自動推導的 workflow 計畫」（含 skill + 順序 + 平行點 + 驗證點 + 收斂條件）。「非預先人工編排」的判準：相同意圖在不同 repo 狀態下，計畫會隨現況改變（例如已有 tech-spec 時跳過 `/tech-spec`），而非套用固定模板。
- **Signal 2（FR-4 / NFR-1）**：計畫與執行包含**該 change type 所需的既有 gate**——code 變更含 `/codex-review-fast` + `/precommit`、`.md` 變更含 `/codex-review-doc`、report-only 流程可無 precommit；**mutating 編排須附 strict-preflight 證據（確認 `STOP_GUARD_MODE=strict`），否則降級為 report-only**（見 §7 strict-preflight constraint）；全程無未授權 git 變更。
- **Signal 3（FR-8）**：v1 通用 workflow 能端到端跑通至少一個真實情境（如 UC-1 或 UC-2）。
- **Signal 4（NFR-4）**：既有 auto-loop / hook 相關測試全綠（0 回歸）。
- **Signal 5（FR-11 / NFR-5）**：新增一個 dummy skill 後，編排候選自動納入該 skill，無需修改編排核心。
- **Signal 6（NFR-2）**：每個編排步驟的「為何被選」可被追溯（observability）。

## 9. Open Questions

- [ ] **Solution**：採用 Claude Code **Dynamic Workflows**（research preview）還是自製編排層？兩者在 safety gate 整合、resume、`acceptEdits` 上差異重大 — 建議 `/feasibility-study`
- [ ] **Solution**：宣告式 intent 的 schema / 介面如何設計？ — 建議 `/tech-spec`
- [ ] 如何讓 agent 取得各 skill 的前置/後置條件與 I/O 契約？是否需為 98 個 skill 補充 metadata（範圍/成本）？ — 建議 `/feasibility-study`
- [ ] 新編排器與既有 hook FSM（`stop-guard` / `review_phase`）如何整合，避免兩套編排互相衝突？
- [ ] Dynamic Workflows 的 `acceptEdits`、無中途人工輸入、session-bound resume 與本專案 human-gate 哲學（及 strict-mode opt-in fail-closed，見 §7 strict-preflight constraint）的張力如何調和？
- [ ] v1「通用 workflow」的範圍邊界：明確涵蓋哪幾種任務形狀（feature / bugfix / audit / research）？
- [ ] 保存的編排成果（FR-10）是否需要版本化？意圖 schema 演進時，舊的保存計畫如何相容？
- [ ] 使用者若不接受「宣告意圖取代逐步下指令」模型（見 Assumptions），是否需提供「逐步確認」的漸進式採用路徑？

## 10. References

- 既有編排器型 skill：`skills/deep-explore/SKILL.md`（wave-based agent 決策，完整性 gate :106-127；fan-out :56-67）、`skills/deep-research/SKILL.md`（3-phase + 條件 Phase 3 :221-227）、`skills/next-step/SKILL.md`（17 條 heuristic + `skills/next-step/scripts/analyze.js`，`--go` 自動派發 :60-72）
- 反應式狀態機（既有編排）：`.claude_review_state.json`（`review_phase` FSM）、`hooks/stop-guard.sh`（"Stale-state git check" 對帳區）、`hooks/post-tool-review-state.sh`（`update_aggregate_gate()`）、`hooks/hooks.json`
- 條件式 skill 派發（作者寫死）：`skills/remind/SKILL.md:76-83`（偵測對應）+ :154-165（執行契約）
- 固定流程（documentation-as-policy）：`CLAUDE.md:13-17`、`rules/auto-loop.md`
- 相鄰 feature：`docs/features/multi-agent-enhancement/2-tech-spec.md:10`（Phase C 排除）、`docs/features/proactive-suggestion/`（規劃中）、`docs/features/scenario-cookbook/`（手動查找）
- Skill 編目：`docs/skill-catalog.yml`（96 筆 catalog entries）
