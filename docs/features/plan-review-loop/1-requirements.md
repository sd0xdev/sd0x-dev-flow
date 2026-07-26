# Requirements: Plan-Review-Loop — Pre-ExitPlanMode Codex Review Gate

> **Doc class**: Lifecycle — Phase 1 requirements (per `@rules/docs-numbering.md`). Feature-level problem-space analysis. **Not** a task tracking ticket; for per-task progress tracking see `requests/*.md` (created via `/create-request`).
> **Created**: 2026-05-14
> **Updated**: 2026-05-14
> **Tier**: standard

## 1. Problem Statement

Claude Code 的 plan mode 由 `ExitPlanMode` 工具終結：Claude 草擬完計畫後直接把 plan 文字交給使用者裁決。整個流程**只有一個視角**——草擬者就是定稿者，沒有獨立挑戰者；使用者既要當決策者又要當品管。當 plan 立基於錯誤假設、過度設計、或漏掉關鍵考量時，缺陷的偵測責任被推給使用者，造成「批准 → 開工 → 才發現方向錯」的反覆。

使用者希望在 ExitPlanMode 把 plan 還給使用者**之前**先讓 Codex（或任何具備獨立研究能力的 reviewer）對 plan 做對抗性審查，跑類似 `/codex-review-doc` 的多輪 review loop，討論完、收斂到 ✅ Plan Ready 後才把最終 plan（含精煉/修正後內容）呈現給使用者。本質是把「使用者人工 review plan」這道流程左移成「自動化 review + 收斂」，降低使用者的 cognitive load 並提升 plan 品質。

### 5-Why Trace

1. **表層**：使用者要在 plan mode 流程中插入一個 Codex review loop，討論完才返回 plan
2. **Why**：目前 Claude → ExitPlanMode → User 是單一視角流；plan 任何缺陷只能靠使用者人工發現
3. **Why**：缺乏獨立挑戰者，plan 的假設、推理、邊界、替代方案皆未經對抗檢驗
4. **Why**：使用者批准 plan 後若才發現缺陷，已耗費實作成本，回頭成本高
5. **根因**：plan 階段缺乏「fail-fast adversarial gate」——讓 plan 在進入「使用者裁決」與「實作」前先過獨立 FP 審查，把缺陷壓在最低成本的窗口

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| 在使用者看到 plan 之前，plan 先經過獨立 reviewer 對抗性審查 | 修改 ExitPlanMode 工具本身（須在 harness 工具契約內運作） |
| 多輪 fix → re-review → 直到審查收斂才把 plan 呈現給使用者 | 取代使用者最終裁決——review 完仍由使用者批准 |
| 與既有 review 基礎建設（hooks/skills/rules）相容，不破壞或污染既有狀態 | 自動執行 plan（review 通過 ≠ 開工） |
| 與既有 code/doc/spec review 路徑保持 MECE，依各自職責處理對應審查對象 | review 非 plan-mode 場景的審查對象（lifecycle spec 等屬於既有/未來 spec-review 範疇） |
| 提供使用者逃生口（override / bypass / disable）避免 review 劫持控制權 | 強制所有 plan 都進 review（啟用光譜需可調：opt-in / opt-out / always）|
| 透明化 review 過程——使用者能知道 plan 是否被審、被挑戰了什麼 | 把 review 對話原文夾雜進 plan（須有訊噪比設計） |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| 使用者（Plan Receiver） | User | 拿到品質更高、已過獨立挑戰的 plan，而不被 review 流程拖慢或淹沒 |
| Claude（Plan Author） | Operator | 在不破壞 ExitPlanMode 契約的前提下，能 orchestrate review loop |
| Codex MCP | Dependent | 收到符合 `@rules/codex-invocation.md` 的 prompt——獨立研究、不被餵養結論 |
| Secondary reviewer（Task agent） | Dependent | 對 plan 提供第二視角（可選 dual-review parity） |
| Auto-loop / Stop Hook | Operator | 須能辨識 plan-review gate sentinel，與 code/doc review 不衝突 |
| Plan-review state carrier（review 狀態的持久化載體）| Dependent | 新增的狀態紀錄不破壞既有 `code_review` / `doc_review` / `aggregate_gate`；具體 schema / 欄位名 / 載體（是否沿用 `.claude_review_state.json`）由 feasibility 決定 |
| 既有 review skills / features / infrastructure（`/codex-review-doc` 與 `/review-spec` 是現有 skill；`dual-reviewer` 與 `codex-review-spec` 目前僅有 feature docs，尚未 ship 為 skill） | Dependent | 不重複職責、不爭奪 sentinel/state namespace、Auto-loop 觸發條件不衝突 |
| Harness 開發者（Claude Code）| External Dependent | 提供 ExitPlanMode 工具契約、PreToolUse hook 能否攔截為未知，影響可行性 |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|-------|--------|-----------------|
| UC-1 | Claude in plan mode | 準備 ExitPlanMode 前自動觸發 plan-review-loop | Codex 對 plan 跑 ≥1 輪 FP 審查；若有 P0/P1 finding，Claude 自動修 plan，再 review，直到 ✅ Plan Ready 才呼叫 ExitPlanMode |
| UC-2 | 使用者 | 想直接看 raw plan（跳過 review） | 透過 disable flag / 環境變數 / explicit 指示，可一次性 bypass 該輪 review loop |
| UC-3 | 使用者 | 想看 review 過程 | 取得 review trail 摘要：每輪 findings 數、最終解決狀態、被修改的 plan 段落 diff |
| UC-4 | Auto-loop | plan review 與既有 code/doc review 並存時 | 兩者 state field 隔離，stop-guard 不誤判；plan review 不消耗 code review max_rounds 預算 |
| UC-5 | Plan author (Claude) | review loop 達 max_rounds 仍未收斂 | 觸發 ⚠️ Need Human：把目前 plan + 殘餘 findings 列表交給使用者裁決，不強制進 ExitPlanMode |
| UC-6 | Codex MCP 不可用 | 連線/授權失敗 | Graceful degradation：跳過 review、附 warning 標籤 ExitPlanMode（plan 仍可送達使用者），不阻塞 plan mode |

## 5. Functional Requirements

> **Note**: FRs are stated as **observable capabilities / outcomes**, not implementation mechanisms. Specific mechanisms（hook attachment point、sentinel naming、state schema key、prompt 重用方式）皆推延至 `/feasibility-study` 評估，列入 §9 Open Questions。

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | 系統必須能在 plan 被呈現給使用者之前介入並啟動 review；具體攔截點（harness-level hook、skill-level pre-step、或其他）由可行性研究決定 | Must | 無觸發點即無 review；機制屬於 solution-space |
| FR-2 | 系統必須將 plan 內容送獨立 reviewer（具備獨立研究能力，符合 `rules/codex-invocation.md`）做對抗性審查 | Must | 核心功能；reviewer 為什麼引擎與 prompt 設計屬於 solution-space |
| FR-3 | 系統必須支援多輪 fix → re-review → 收斂；有最大輪數上限（達上限後升 ⚠️ Need Human） | Must | 單輪不保證收斂；plateau / fingerprint 等進階偵測屬 Should，視可行性 |
| FR-4 | 系統必須在 review 收斂（無 P0/P1）後才把最終 plan 呈現給使用者。**「Blocked」** 在此 FR 指 reviewer 仍標示 P0/P1（review 結論為 `⛔`）；reviewer 不可達 / 失效不視為 blocked，走 NFR-3 graceful degradation 例外路徑（plan 仍可送達，但 output 須附明確 degradation 標記） | Must | 「review 通過才回 plan」核心承諾；本款只規範 review 結論層級，不規範 reviewer infrastructure 可用性 |
| FR-5 | 系統必須提供使用者逃生口：明示要直接看 plan / disable review / dry-run 時，當輪立即跳出 loop 並呈現原 plan | Must | 控制權保留——review 不可劫持流程 |
| FR-6 | 系統必須確保 plan-review 狀態不污染既有 code/doc/aggregate review 狀態（任一邊狀態變化不互相覆蓋） | Must | research findings 指出 sentinel / state collision 為已知風險；隔離方式（獨立 sentinel namespace 或獨立 state field）屬 solution-space |
| FR-7 | 系統必須在跨 reply / 跨 round 場景保留 review 進度，使中斷後能恢復 | Must | 跨 reply 持久化需求；具體欄位/檔案/schema 為 solution-space |
| FR-8 | 系統應支援多 reviewer 並行視角（不僅單一 Codex），以降低單點與 false-negative | Should | 多視角顯著提升審查命中率；具體 reviewer 組合 / 並行模式參考既有 dual-reviewer 設計，但實現方式為 solution-space |
| FR-9 | 系統應在最終 plan output 附 review trail summary（至少輪數、findings 數、主要被修正項），讓使用者可審計 | Should | 透明度——避免「黑箱潤色」破壞信任 |
| FR-10 | Plan-review 的迭代 / 成本預算應與 code/doc review 預算邏輯隔離，避免互耗 | Should | UC-4 隔離需求；具體 max_rounds、token cap 透過配置或新配置點實現屬 solution-space |
| FR-11 | 系統可支援不同審查深度（淺/中/深）以匹配 plan 複雜度；深度模式可升級為 `/codex-brainstorm` 級對抗式辯論 | Could | 簡單 plan 不必跑完整辯論；`/codex-brainstorm` 提供成熟 pattern 可借鑑或鏈接 |
| FR-12 | 系統可依 plan domain（architecture / refactor / bug-fix...）路由到專長 reviewer | Could | 提升命中率，但會增加 prompt 維護負擔，需評估 ROI |
| FR-13 | 修改 ExitPlanMode 工具內部行為 | Won't | Harness 工具契約屬於 Claude Code 上游，本 plugin 只能在外圍 orchestrate |
| FR-14 | review 通過後自動執行 plan（auto-implement） | Won't | 使用者最終裁決權保留；review 通過 ≠ 開工 |
| FR-15 | 對 lifecycle spec（`1-requirements.md`、`2-tech-spec.md` 等）執行 review | Won't | 由既有 `/review-spec` 或未來 `/codex-review-spec` 負責；本範圍只覆蓋 plan-mode 輸出 |

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Performance | review loop 應在合理輪數內收斂 | 典型 plan p50 ≤3 輪、p95 ≤5 輪收斂（具體 max_rounds 數值在 feasibility 階段決定） |
| NFR-2 | Cost | 系統須有 plan-review 預算上限機制，避免 plan-mode 變成 token sink | 達 max_rounds 或預算上限時不靜默通過，必須升 ⚠️ Need Human；預算配置點（複用既有 `auto-loop-project.md` 還是新增）由 feasibility 決定 |
| NFR-3 | Reliability | Reviewer 失效時須 graceful degradation，不阻塞 plan mode | Reviewer 不可達（連線錯誤、auth 失敗）情境下，plan 仍能在當輪送達使用者，且 plan output 含可被 grep 偵測的明確 degradation 標記（namespaced sentinel `[PLAN_REVIEW_DEGRADED]`，與既有 code/doc review routing 不衝突）|
| NFR-4 | Usability | 預設行為對使用者透明：是否進 review、進幾輪、最後改了什麼 | Plan output 含可辨識的 review summary 區塊（至少輪數、findings count、修正摘要 3 欄）；verbose 模式可看 round-by-round |
| NFR-5 | Safety | 使用者可隨時 escape（明示「skip review」、reply override、其他逃生指令） | 從使用者發送 escape 訊號到下一個 plan output 之間最多經過 1 輪 review；不存在「卡死於 loop 無法跳出」的狀態 |
| NFR-6 | Maintainability | 與既有 review 基礎建設共用核心模式（loop convergence、sentinel emission、state persistence），盡量擴充而非複製 | 對既有介面的修改幅度最小化；可重用模式 vs 必要修改的取捨在 feasibility 階段量化 |
| NFR-7 | Boundary | plan-review state 與 code/doc/aggregate review state 不互相覆寫 | 自動化測試證明：plan-review 觸發後，既有 code_review / doc_review / aggregate_gate 欄位值不變；反之亦然 |
| NFR-8 | Security | review 過程不外流 secrets / tokens / API keys 到 reviewer 上下文 | plan 內容含 **regex-valid** dummy secret（須真正命中 [`scripts/security-redact.js`](../../../scripts/security-redact.js) 的高敏 pattern：`sk-` + ≥20 字元如 `sk-abcdefghijklmnopqrstUVWX`、`ghp_` + 恰 36 字元如 `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`、PEM header）時，送 reviewer 前的 payload grep 結果不含任何高敏 pattern；遵循 [`rules/security.md`](../../../rules/security.md) 的「Logging private keys/passwords/tokens」禁令，redact 實作可重用 `security-redact.js` 或同等 primitive |

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint | ExitPlanMode 是 harness-provided tool，本 plugin 無法修改其行為 | 本 repo grep 找不到 ExitPlanMode 程式碼；屬 Claude Code harness 範疇 |
| Constraint | 本 repo `hooks/hooks.json:32-41` PreToolUse matcher 目前僅覆蓋 `Edit\|Write`；要攔截其他 tool 需擴充，且 harness 是否支援 PreToolUse 對 ExitPlanMode 為未知 | [`hooks/hooks.json:32-41`](../../../hooks/hooks.json) + harness 文件缺口 |
| Constraint | review 必須遵守 `rules/codex-invocation.md` 全文——獨立研究、不餵養結論、prompt 來自 reference template | [`rules/codex-invocation.md:1`](../../../rules/codex-invocation.md)（全文）|
| Constraint | sentinel / state field 不可污染既有 review state；既有可辨識 sentinel 與 state 欄位列於 `rules/auto-loop.md` Gate Sentinels 與 [`hooks/post-tool-review-state.sh`](../../../hooks/post-tool-review-state.sh) | [`rules/auto-loop.md`](../../../rules/auto-loop.md) Gate Sentinels 章節 |
| Constraint | Plan review 必須非 destructive：不刪除 plan 段落或改變語意，只能 surface findings 讓 Claude 重寫 | 衍生自 NFR-4 透明度 + UC-3 review trail |
| Assumption | Claude 在 plan mode 能取得自己即將傳給 ExitPlanMode 的 plan 文字 | 推論：Claude 是 plan author；plan 內容本來就在其 working context |
| Assumption | 獨立 reviewer（Codex MCP 為主要候選）在 plan mode 仍可被呼叫，不被 plan-mode 的 read-only constraint 排除 | 推論：Codex 屬 MCP 諮詢工具，plan-mode 限制針對 Edit/Write |
| Assumption | 使用者多數情境希望 plan 經過 review；少數情境（探索、demo、教學）需要 raw plan | 來自 user 原始陳述「希望...透過 codex review loop」——預設啟用為主要訴求 |
| Assumption | Plan review 平均 1-3 輪內收斂（plan 為高層敘述，issues 比 code review 少） | 經驗推論；確切數值待 feasibility / pilot 驗證 |
| Assumption | 使用者願意接受 plan 被 review 修改後再呈現，但要求透明度（FR-9） | 「討論完後才返回使用者 plan」隱含接受修改後版本 |

## 8. Acceptance Signals

Acceptance signals 列述使用者可觀察的外部行為，刻意避免綁定特定 state schema、sentinel 字串、或 hook 實作方式（那些屬 feasibility / design 階段決定）。

- **Signal 1 (FR-1, FR-4)**：在 plan mode 工作階段中，使用者實際看到的 plan output 之前，系統 log / output 中可觀察到 review 已執行過至少一次的證據（具體呈現方式由 feasibility 決定）
- **Signal 2 (FR-3, FR-4)**：給定一個含已知缺陷的 plan，系統觀察到 reviewer 標示 P0/P1，Claude 修改 plan 後再 review，直到 reviewer 不再標示 P0/P1，才把 plan 呈現給使用者；若 review 持續未收斂達上限，系統升 `⚠️ Need Human` 並把殘餘 findings 一併列出（不靜默通過）
- **Signal 3 (FR-5, NFR-5)**：使用者在 review loop 中明示「skip review」/「直接 show plan」/ 同義指令，在不超過 1 輪 review 後系統跳出 loop 並呈現 plan（review 已啟動者可顯示部分 trail，但不繼續迭代）
- **Signal 4 (FR-6, FR-7, NFR-7)**：對同一 session 並行觸發既有 code-review 與 plan-review 的測試情境下，兩者狀態互不覆蓋（自動化測試可驗證）
- **Signal 5 (FR-9, NFR-4)**：使用者最終看到的 plan output 包含可辨識的 review summary 區塊，至少含輪數、findings 數、被修正項摘要 3 欄
- **Signal 6 (NFR-3)**：模擬 reviewer 不可用情境（offline / 401 / timeout），plan-review-loop 不卡死；plan 仍能在當輪交付使用者，且 output 含可被 grep 偵測的明確 degradation 標記
- **Signal 7 (NFR-1, NFR-2)**：review 達 max_rounds 後系統明確輸出 `⚠️ Need Human` + 殘餘 findings 列表，並把目前狀態的 plan 交給使用者裁決
- **Signal 8 (NFR-8)**：plan 內容含 **regex-valid** dummy secret（須真正命中 `security-redact.js` 高敏 pattern，如 `sk-abcdefghijklmnopqrstUVWX`、`ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`、PEM header；**不可**用 `sk-test-xxx`/`ghp_xxx` 這類長度不足、不會命中 regex 的假樣本，否則測試會假性通過而未實際驗證 redaction）時，送 reviewer 前的 payload grep 結果不含高敏 pattern；reviewer log（若可取）亦不含原始 secret

## 9. Open Questions

- [ ] **Solution concern — 觸發機制**：plan-review-loop 應該是 (a) skill-driven（Claude 在 plan mode 自覺呼叫 plan-review-loop skill）、(b) PreToolUse hook 攔截 ExitPlanMode、還是 (c) 兩者並存（hook 兜底 + skill 為主）？harness PreToolUse 對 ExitPlanMode 是否可用為未知 — 建議執行 `/feasibility-study`
- [ ] **Solution concern — Plan artifact 可見性**：Claude 在準備呼叫 ExitPlanMode 時，plan 內容存在哪？（in-context message draft？ExitPlanMode 的 `plan` 參數？）如果 plan 只在工具呼叫瞬間才具象化，review 須在 Claude 端 orchestrate 而非 hook 端攔截 — 建議 `/feasibility-study`
- [ ] **Solution concern — 預設啟用 vs opt-in**：plan-review-loop 預設 always-on、opt-out、還是 opt-in？影響 NFR-2 cost 與 UC-2 user override 設計 — 建議 stakeholder 討論
- [ ] **Trade-off — review trail 訊噪比**：UC-3 要看 review 過程 vs NFR-4 透明度但不淹沒 plan，平衡點在哪？默認 summary、verbose 可選？需 UX 設計
- [ ] **Boundary — auto-loop 預算共享**：plan_review 是否共用 `total_rounds_session` 還是獨立計？FR-10 傾向獨立，但若使用者一個 session 內進多次 plan mode，總成本上限如何控制？
- [ ] **State scope — per-session vs per-plan**：`plan_review` 欄位是覆蓋還是累積？每次新 plan mode 重置，還是保留歷史 plan 的 review trace？
- [ ] **Dual-review trigger**：FR-8 應在所有 tier 預設啟用 dual，還是只 deep tier？dual-review 對短 plan 文字的邊際效益可能較小
- [ ] **與 `/codex-brainstorm` 的關係 / 深度光譜**：plan-review-loop 的 tier 譜系該如何切？quick = 單輪 Codex 文件審查、standard = 多輪 fix→re-review、deep = `/codex-brainstorm` 對抗式辯論？兩者皆有 Codex 多輪 loop，但 `/codex-brainstorm` 強調 Nash equilibrium 收斂條件、attack/defense 對稱、threadId 追溯 — plan-review 是否該完全內嵌或僅作為 escalation 路徑？需 `/feasibility-study` 評估深度與成本比
- [ ] **Solution concern — Plateau / fingerprint 偵測可行性**：`rules/auto-loop.md` 定義 plateau detection（fingerprint overlap ≥50% 連 3 輪），但 `hooks/post-tool-review-state.sh` 目前只記錄 finding counts，未儲存 fingerprints。plan-review-loop 是否要在收斂偵測上同樣支援 plateau？若是，須先擴充 state schema — 屬 solution-space，建議列入 `/feasibility-study`
- [ ] **Solution concern — Plan-review 預算配置點**：NFR-2 要求 plan-review 須有預算上限，但目前 `rules/auto-loop-project.md` 僅支援 `Max Rounds`、`Git Memory`、`Think Harder` 三個配置點，無 token / cost cap 配置介面。是否新增獨立的 `Plan Review Budget` 配置欄位，還是重用 `Max Rounds` 但獨立 namespace？需 feasibility 評估
- [ ] **與 `/codex-review-doc` 的邊界**：Goals 區塊主張「與既有 review 路徑保持 MECE」，但本 Open Question 列出的「是否為 `/codex-review-doc` 變體」尚未拍板——兩者皆審查文字內容，差別在於 review 對象（plan 文字 vs lifecycle .md 檔）、觸發時機（pre-ExitPlanMode vs ad-hoc）、修正模型（Claude 自動 revise vs 人工 revise）。需在 `/feasibility-study` 階段給出明確 boundary 公理

## 10. References

- Related lifecycle docs (problem-space sibling features):
  - [`docs/features/dual-reviewer/2-tech-spec.md`](../dual-reviewer/2-tech-spec.md) — 並行 Codex + Task 雙視角審查架構（feature spec，尚未 ship 為獨立 skill；可借鑑模式）
  - [`docs/features/codex-review-spec/1-requirements.md`](../codex-review-spec/1-requirements.md) — Codex FP spec 審查（feature requirements，尚未 ship 為 skill；boundary 對照）
- Request-level implementation history:
  - [`docs/features/review-state-tracking/requests/`](../review-state-tracking/requests/) — `.claude_review_state.json` schema 演進的 request 紀錄（非 lifecycle，僅供溯源）
- Related skills (currently shipped — reusable patterns):
  - [`skills/codex-brainstorm/SKILL.md`](../../../skills/codex-brainstorm/SKILL.md) — 對抗式 Nash equilibrium 辯論（Phase 1-5 workflow、termination conditions、attack/defense templates）；可作為 deep-tier 升級路徑或 prompt-pattern 來源
  - [`skills/codex-code-review/SKILL.md`](../../../skills/codex-code-review/SKILL.md) — review loop convergence + `--continue` threadId 延續
  - [`skills/doc-review/references/review-loop-doc.md`](../../../skills/doc-review/references/review-loop-doc.md) — 多輪文件審查 loop template
  - [`skills/review-spec/SKILL.md`](../../../skills/review-spec/SKILL.md) — 現有 spec 審查 skill（FR-15 排除範圍的對應 owner）
- Hook / loop primitives:
  - `hooks/post-tool-review-state.sh` — sentinel parser + iteration_history schema
  - `hooks/stop-guard.sh` — gate enforcement + dual mode
  - `scripts/emit-review-gate.sh` — gate emission contract
- Rules:
  - [`rules/auto-loop.md`](../../../rules/auto-loop.md) — rule-level convergence model（decision table、max_rounds、plateau detection 與 strategic reset 的規格描述；plateau 之 fingerprint 偵測尚未在 hook 端實作，須 feasibility 評估補上）
  - `rules/codex-invocation.md` — Codex prompt 規範
  - `rules/fix-all-issues.md` — analysis-only mode（plan-review 內在屬性）
- Research:
  - Phase 2 Explore findings（2026-05-14）: 確認 ExitPlanMode 不在本 repo（屬 harness）、`hooks/hooks.json` PreToolUse 僅 Edit\|Write、sentinel/state collision 風險、`auto-loop-project.md` 已支援 max_rounds 配置
