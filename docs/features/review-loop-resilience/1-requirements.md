# Requirements: Review Loop Resilience

> **Doc class**: Lifecycle — Phase 1 requirements (per `@rules/docs-numbering.md`). Feature-level problem-space analysis. **Not** a task tracking ticket; for per-task progress tracking see `requests/*.md` (created via `/create-request`).
> **Created**: 2026-08-23
> **Updated**: 2026-08-23
> **Tier**: standard
> **Tech Spec**: [2-tech-spec](./2-tech-spec.md)
> **Request tickets**: See [`requests/`](./requests/) for per-task execution tracking

## 1. Problem Statement

Review loop 目前建立在兩個脆弱前提上：(a) `mcp__codex__codex-reply` 的同一 thread 可以無限延續，(b) Codex MCP 永遠可用。前提 (a) 失效時（3–4 輪後 thread 上下文過長），review 品質隨 LLM 長上下文性能衰退而下降，但 loop 本身察覺不到——衰退的 reviewer 仍照常發出 verdict；前提 (b) 失效時（quota 用盡、網路、CLI 未安裝），整個 loop 停在 `⚠️ Need Human`，開發流程中斷，且內建 reviewer 只能提供 advisory findings、不能承載 gate。

兩者是同一個根本問題的兩面：**review gate 必須在退化條件下（長 loop、供應商不可用）仍持續產出可信的 verdict**。

### 5-Why Trace

1. Surface: (a) reply 續審超過 3–4 輪或上下文過長時應換新 thread；(b) Codex 限額滿或不可用時 fallback 到內建 reviewer，效力等同 Codex review、機制一致
2. Why: (a) 長 thread 讓 reviewer 性能衰退，verdict 可信度無聲下滑；(b) Codex 單點故障讓 loop 無法終結，`⚠️ Need Human` 阻斷本可自動完成的工作
3. Root: 審查閉環的**可用性**（loop 一定能走到終態）與**品質**（每一輪 verdict 都出自狀態良好的 reviewer）必須同時成立，terminal completion invariant 才有實質意義

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| Review thread 有明確的輪替（rotation）條件與機制 | 改變任何 review family 的內容標準（severity、sentinels、finding 欄位） |
| 輪替後新 thread 不遺失已決事項與範圍凍結，loop 語意不中斷 | 改變 terminal completion invariant 或任何 Anchor 義務 |
| Codex 不可用時內建 reviewer 接手並**在該 review family 自身契約下承載 gate verdict**（適用範圍見下方矩陣） | 修復 Codex CLI / MCP server 本身的問題 |
| Fallback review 逐 family 沿用既有機制（同 prompt 契約、同 loop 行為、同該 family 的 verdict 記錄方式） | 多模型並行 review（`--dual` 已有，另議） |
| 政策變更同步落到 `rules/auto-loop.md` 與 `review-common.md`，不留矛盾 | 實作層設計（cascade 順序、契約落點、設定介面 — solution space → feasibility/tech-spec） |

### 適用範圍矩陣（Coverage Matrix）

輪替與 fallback 都是**在 family 內**發生的事，且不同類別承擔不同義務——gate、state plane、verdict 三者不重合：

| 類別 | 成員 | 輪替 | Fallback 承載 gate | Verdict 記錄 | 驗收斷言 |
|------|------|------|--------------------|--------------|----------|
| Gate-bearing、有 state plane | code review（plane `code_review`）、doc review（plane `doc_review`） | 適用 | 是——以該 family 自身 sentinels | `review-state.js note <plane>` | `check --format=json` 該 plane `passed === true` |
| Gate-bearing、無 state plane | plan review、test review | 適用 | 是——以各自 sentinels | 對話與報告（行為層） | 報告含該 family 的通過 sentinel |
| Gate-bearing、無 state plane、**輪替與 fallback 皆排除（v1）** | necessity-audit | **排除（v1）**——無單一首輪 reviewer 模板可供輪替後 fresh dispatch（其首輪是構成性 pipeline），維持現行行為 | 否——Codex 辯論是其構成性機制（非單一 reviewer 模板可替代），Codex 不可用時維持既有 degradation 行為 | 對話與報告（行為層） | 既有契約不變 |
| 非 gate 驗證 | `seek-verdict` | 邊際適用——其設計本為 fresh thread，僅 rebuttal reply 受輪替條件約束 | 否——產出資訊性 verdict token，依其自身契約 | `[DISMISS_VERDICT]` / `[SEEK_VERDICT]` 紀錄 | 紀錄格式與現行契約一致 |
| 範圍外 | `precommit`（state plane 存在，但 runner 自記結論，無 reviewer 可 fallback） | 不適用 | 不適用 | runner 自行 note | — |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| Plugin 維護者 | Developer | 輪替與 fallback 契約散落 63 個檔案（`grep -rln "threadId\|codex-reply\|--continue" skills/`，2026-08-23），修訂一致性 |
| Skill 使用者 | User | Loop 不再因 quota 中斷；不因 thread 衰退拿到劣化 review |
| Review 類 skills（`codex-review*`、`doc-review`、`plan-review`、`test-review`、`necessity-audit`、`seek-verdict`） | Dependent | 各 family 依適用範圍矩陣接上輪替與 fallback 語意（含各自的 sentinels 與 verdict 記錄方式），不被套上別家契約 |
| `rules/auto-loop.md` § Review Dispatch、`rules/codex-invocation.md` | Dependent | 「Codex unavailable = Need Human」與「secondary 只 advisory」需按新政策改寫 |
| `scripts/review-state.js` 提醒層 | Operator | 對矩陣第一列的 plane（`code_review`、`doc_review`），fallback verdict 的 note 語意必須與 Codex verdict 同款；`precommit` plane 不受本需求影響 |
| `codex-plugin-fallback` feature | Dependent | 其 degradation cascade L4 設計與本需求的等效性要求需對齊（見 §10） |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|------|--------|-----------------|
| UC-1 | Review loop（第 4 輪 re-review） | 達到輪替門檻，dispatch 改開新 thread | 新 threadId、延續資訊不遺失（見 FR-3），review 品質回到 fresh 狀態 |
| UC-2 | Review loop（單輪內上下文已過長） | 判斷上下文過長，提前輪替 | 同 UC-1，不必等滿輪數 |
| UC-3 | 開發者執行 `/codex-review-fast`，Codex quota 已滿 | Loop 偵測 Codex 不可用，切換內建 reviewer | Review 照常完成，verdict 可 note 為 gate 紀錄，不停在 `⚠️ Need Human` |
| UC-4 | Fallback reviewer 發出 `⛔ Blocked` | 開發者修復後 re-review | Fallback reviewer 依同一 loop 規則 re-dispatch（含輪替條件），直到 `✅ Ready` 或列舉的人類出口 |
| UC-5 | 事後稽核者讀 review 報告 | 查看該次 review 由誰承載、是否輪替過 | 報告可辨識 reviewer 來源與 thread 輪替事件 |

## 5. Functional Requirements

適用範圍由 §2 矩陣統一界定：FR-1–FR-4（輪替）適用於矩陣中「輪替＝適用」的 family；FR-5–FR-8（fallback）適用於「Fallback 承載 gate＝是」的列。necessity-audit 的 v1 義務是**維持既有續審與 degradation 行為**（兩機制皆排除）。

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | Review loop 的 reply 續審在同一 thread 達到輪替條件時，必須改開新 thread 而非繼續 `codex-reply` | Must | 使用者明示；長 thread 性能衰退直接侵蝕 verdict 可信度 |
| FR-2 | 輪替條件至少包含：(a) 同 thread 已續審達輪數門檻（3–4 輪），(b) 判斷上下文過長（指標見 Open Questions） | Must | 兩個觸發器缺一則衰退仍可能發生（少輪但大 diff、多輪小 diff） |
| FR-3 | 輪替不得遺失已決事項與範圍凍結：(a) 新 thread 首輪 prompt 只含 `rules/codex-invocation.md` 本已允許的 metadata——其中**凍結的 scope baseline**（檔案清單，不得重算；`rules/scope-discipline.md` 的 frozen list 跨 thread 有效）必須延續；(b) 有效 dispositions（`[USER_SKIPPED]`、`[OUT_OF_SCOPE_DEFERRED]`——其記錄格式含 issue 文字，**非中性、不得注入 prompt**）與上一 thread 的未關 findings 一律留在 orchestration 側，於新 thread 產出報告**之後對帳（reconcile）**；(c) `[NIT_DEFERRED]` 維持 reporting record，不注入亦不參與對帳前的任何注入 | Must | 換 thread 不得變相重開 scope 或遺失已決事項；對帳一律後置，才與 FR-4 的獨立研究相容——先審後對，兩者同時成立，且無需動用 invocation 規則的例外 |
| FR-4 | 新 thread 是 fresh dispatch：適用 `rules/codex-invocation.md` 的獨立研究契約（給 metadata、不餵結論），loop-review exception（reply 可帶 diff）不適用於新 thread 首輪；一切 reviewer 結論（含 disposition 所載 issue 文字）走報告後對帳 | Must | 輪替的價值就在 reviewer 重新以完整視角研究；帶著舊結論開新 thread 只是換個地方衰退 |
| FR-5 | Codex 不可用（quota、網路、未安裝、逾時）時，review loop 必須 fallback 到內建 reviewer 繼續，而非停在 `⚠️ Need Human`——**適用於矩陣中「Fallback 承載 gate＝是」的列**；necessity-audit v1 除外，其義務是維持既有 degradation 行為 | Must | 使用者明示；單點故障不應阻斷可自動完成的閉環 |
| FR-6 | 對矩陣中**「Fallback 承載 gate＝是」**的 family，fallback reviewer 的 verdict **效力等同**原 reviewer：在該 family 自身契約下承載 gate（sentinels 依 family）；其中有 state plane 者，verdict 可被 `review-state.js note` 記錄；非 gate 的 `seek-verdict` 依其自身契約產出資訊性 verdict，等效性指驗證契約不變 | Must | 使用者明示「效力等同」；advisory-only 的現況正是要改掉的行為。等效性是對各 family 自身契約的等效，不是把 code review 契約套到所有 family |
| FR-7 | （同 FR-5/FR-6 適用範圍）Fallback review 的**機制**與該 family 的 Codex review 一致：同一套 prompt 契約（獨立研究、禁止餵結論）、該 family 既有的 severity 分級、finding 欄位、gate sentinels 與 loop 行為（re-review、輪替條件、cycle reset）——fallback 不引入新 sentinel、不換一套機制 | Must | 使用者明示「機制應該一樣」；機制不一致則等效性只是名義上的 |
| FR-8 | Fallback 啟用必須明示記錄：報告標明 reviewer 來源（gate source），切換事件在對話與報告中可見 | Should | 等效不等於隱形；事後稽核需要知道該 verdict 由誰承載 |
| FR-9 | Thread 輪替事件應在報告或對話中留下紀錄（舊 threadId → 新 threadId、觸發原因） | Should | 稽核與 stall 診斷需要對齊輪次與 thread 邊界 |
| FR-10 | 輪替門檻與 fallback 行為宜支援專案層覆寫 | Could | 預設值已可用；覆寫介面（落在哪個設定面）屬 solution space，由 tech-spec 決定 |
| FR-11 | 保留 `--dual` 的 opt-in 啟用、平行分派與成功時的雙報告聚合語意；其「Codex ❌」degradation 列**由本需求的 fallback 政策刻意取代**（見 Constraint 第一列） | Must | 完整凍結 `--dual` 與改寫 degradation 不能同時成立；保留的是聚合機制，取代的是不可用時的死路 |

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Reliability | Codex 不可用時（fallback 適用的 family），**每次 dispatch 都產出該 family 的合法 verdict**，且 loop 不因供應商故障滯留：actionable 的 `⛔` 後照常進入 fix → re-review，直到該 family 的通過 sentinel 或列舉的人類出口。「fallback 給出 ⛔ 後停下」**不算**完成 | 模擬 Codex 失效的測試中：每次 dispatch 有合法 verdict 100%；loop 僅在通過 sentinel 或列舉人類出口處終止 |
| NFR-2 | Quality | 輪替後 review 覆蓋面不縮水（輪替適用的 family）：新 thread 首輪為完整獨立研究 | 新 thread 首輪 prompt 含獨立研究段落（可測：模板欄位存在） |
| NFR-3 | Maintainability | 輪替與 fallback 契約對所有 review skills 呈現**單一一致的權威**：任何兩個 consumer 對同一問題（輪替條件、延續集合、等效語意）不得得出不同答案 | 跨 skill 抽查同一問題答案一致；契約落點（shared reference 或其他形式）由 tech-spec 決定 |
| NFR-4 | Usability | 輪替與 fallback 於**其適用的 family 內**自動發生，不要求使用者手動判斷或介入 | 0 個新增的人工步驟（記錄除外） |
| NFR-5 | Auditability | Reviewer 來源與 thread 邊界可從報告重建 | 報告含 gate source 與輪替紀錄欄位 |

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint | **與現行規則牴觸——採納即政策變更**：`rules/auto-loop.md` § Review Dispatch（「Codex unavailable is not a fallback — it is ⚠️ Need Human」；內建 reviewer 「advisory findings, never a gate verdict」）與 `review-common.md` § Degradation Matrix 第 3 列（Codex ❌ → `⛔ Blocked` + Need Human）必須同步改寫，不可默默偏離。`auto-loop.md` 該段為 Default tier；`review-common.md` 是 skill 契約文件、不在 `rules/discretion.md` 的分類範圍內，但兩處必須同步改。Anchor Register 未鎖 reviewer 身分，變更合法但需明文落地 | `rules/auto-loop.md`、`skills/codex-code-review/references/review-common.md:223-232`、`rules/discretion.md` |
| Constraint | Anchor 義務對 fallback reviewer 完全適用：Declaring ≠ Executing、Fixing ≠ Verifying、edit 重開 gate、cycle reset（Register #5/#6）。等效性只轉移 gate 承載者，不豁免任何 loop 義務 | `rules/discretion.md` § Anchor Register |
| Constraint | Security/data-integrity 變更的 `thorough` 升級（Register #3）在 fallback 下同樣成立 | `rules/discretion.md` |
| Constraint | 各 review family 的 sentinels 與 verdict 記錄方式互不相容且**維持現狀**（詳見 §2 適用範圍矩陣；plan review 禁用裸 code sentinels 且無 state plane） | `rules/auto-loop.md` § Gate Sentinels、各 skill loop references |
| Constraint | `doc-review` 的 one-thread-per-batch 契約：輪替單位是 batch 的 thread，不得輪替成合併 thread | `skills/doc-review/references/review-loop-doc.md` |
| Constraint | Scope baseline 凍結跨 thread 有效；輪替不是重算 baseline 的藉口 | `rules/scope-discipline.md` § Scope Baseline |
| Assumption | 長 thread（3–4 輪以上）造成 reviewer 性能衰退 | 使用者陳述＋LLM 長上下文衰退的普遍認知；本專案未量測具體衰退曲線，3–4 輪為經驗值 |
| Assumption | 「內建 reviewer」指現有 plugin agents（如 `strict-reviewer`、`pr-review-toolkit:code-reviewer`），且其能力足以承載與 Codex 同深度的 review | 使用者陳述「內建的 reviewer」＋`agents/` 現況（`model: opus`、`effort: high`） |
| Assumption | Codex「不可用」可被機械偵測（MCP 呼叫錯誤、quota 錯誤碼、逾時） | 程式觀察：MCP 呼叫失敗會以 error 形式回報 |

## 8. Acceptance Signals

- Signal 1（FR-1/2，於輪替適用的 family）：同一 review 進入第 N+1 輪（N = 輪替門檻）時，dispatch 使用新 threadId；上下文過長時提前輪替
- Signal 2（FR-3/4，同 Signal 1 適用範圍）：新 thread 首輪 prompt 僅含 invocation 契約本已允許的 metadata（含凍結 baseline 檔案清單），不含 dispositions 或前輪 findings 的任何 issue 文字；dispositions 與未關 findings 於新報告產出後在 orchestration 側完成對帳；輪替前後 scope 判定結果不變（同一 finding 集合得出同一 in/out-of-scope 結論）
- Signal 3（FR-5/6）：模擬 Codex 不可用——矩陣第一列 family：loop 以內建 reviewer 完成並 note 出 gate verdict，`node scripts/review-state.js check --format=json` 中該 plane `passed === true`；矩陣第二列 family：報告含該 family 的通過 sentinel；兩者皆不停在 `⚠️ Need Human`
- Signal 4（FR-7）：Fallback 報告含**該 family 既有的** sentinels 與 finding 欄位；fallback 下的 re-review 行為（cycle reset、edit 重開 gate）與 Codex 路徑一致
- Signal 5（FR-8/9）：報告可辨識 gate source 與輪替事件（舊/新 threadId、觸發原因）
- Signal 6（Constraint）：`rules/auto-loop.md` 與 `review-common.md` 改寫後 grep 不到殘留的矛盾語句（如「never a gate verdict」原句）

## 9. Open Questions

- [x] 「上下文過長」的機械判斷指標為何 — **已決（2026-08-23）**：v1 不設機械指標，R-b 為行為層判斷（tech spec §3.1；`review-common.md` § Thread Rotation）
- [x] 輪替門檻與覆寫介面 — **已決（2026-08-23）**：預設 3，`auto-loop-project.md` 新 setting `## Review Thread Rotation`（2–6；`auto-loop.md` § Override Contract）
- [x] 凍結 baseline 以外的注入欄位 — **已決（2026-08-23）**：無；全部後置對帳成立，`codex-invocation.md` 未增例外
- [x] Fallback reviewer 選擇與順序 — **已決（2026-08-23）**：per-contract carriers（code：strict-reviewer→toolkit；非 code：contract-neutral-reviewer ×2）；L4 未納入（`scripts/lib/review-dispatch.js` FALLBACK_CARRIERS）
- [x] 契約落點 — **已決（2026-08-23）**：中央契約併入 `review-common.md` § Thread Rotation，各 family loop 模板以指向條款消費
- [x] 降級標記粒度 — **已決（2026-08-23）**：報告帶 `gate_source=fallback:<agent>`、對話帶 `[REVIEWER_FALLBACK]` 記錄；不另設降級語意
- [x] Codex 中途恢復 — **已決（2026-08-23）**：per-change 黏著（同 change 不回切、不再探測）；新 change 回 Priority 1 重新探測
- [ ] `seek-verdict` 的「Codex 盲驗」在 Codex 不可用時如何等效（驗證者與被驗者同源的獨立性問題）——其非 gate 定位見 §2 矩陣，但獨立性問題仍待解 — solution concern
- [x] plan/test 持久記錄補強 — **已決（2026-08-23）**：v1 刻意維持現狀（對話＋報告），與 hook-lightweighting 的行為層方向一致；補強屬未來需求

## 10. References

- Related feature: [`../codex-plugin-fallback/2-tech-spec.md`](../codex-plugin-fallback/2-tech-spec.md) — degradation cascade（L1–L4）既有設計；本需求把「fallback 只 advisory」升級為「等效承載 gate」，tech-spec 階段需對齊
- 現行 loop 契約：`skills/codex-code-review/references/review-common.md` § Degradation Matrix、§ Review Loop；`skills/doc-review/references/review-loop-doc.md`（one thread per batch）
- 規則面：`rules/auto-loop.md` § Review Dispatch、§ Gate Sentinels、`rules/codex-invocation.md` § Loop review exception、`rules/scope-discipline.md` § Scope Baseline
- Research: 影響面盤點 — `grep -rln "threadId\|codex-reply\|--continue" skills/` 命中 63 檔（2026-08-23）
