# Requirements: Handoff Document Generator (`/handoff-doc`)

> **Doc class**: Lifecycle — Phase 1 requirements (per `@rules/docs-numbering.md`). Feature-level problem-space analysis. **Not** a task tracking ticket; for per-task progress tracking see `requests/*.md` (created via `/create-request`).
> **Created**: 2026-04-22
> **Updated**: 2026-04-22
> **Tier**: standard
> **Skill name**: `/handoff-doc`（2026-04-22 確認，OQ-1 已關閉，對齊 `/recap-doc`、`/tech-brief` 風格）

## 1. Problem Statement

當一個功能、服務、或模組的所有權或整合邊界要交給另一個「外部」對象（他隊、外部合作夥伴、接手維運者、整合端），**既有文件是「未篩選且散落」的**：tech-spec 寫給設計者、runbook 寫給維運者、README 假設讀者共享上下文。receiver 面對 50+ 份文件，其實只需其中 5-10 份與整合邊界直接相關的內容。手工篩選耗時、易漏關鍵合約（API 版本、event schema、authentication、config 範本），或反過來夾帶內部實作細節造成混淆。

需要一個技能能**分析上下文、識別整合表面（integration surface）、從現有文件與程式碼中萃取對 receiver 有用的部分**，產出一份聚焦的 handoff 文件（或 bundle），讓接手方以最短路徑上手或串接。

### 5-Why Trace

1. **Surface**：使用者說要「handoff 文件製作，像 /tech-spec 但跨系統」。
2. **Why**：現有文件都是 sender 視角，receiver（outsider）讀起來要自己翻譯、篩選。
3. **Why deeper**：ownership 或 integration 邊界被跨越時，讀者不再共享 sender 的隱性脈絡（命名、流程、慣例、技術債）。
4. **Why deeper**：文件散在多個系統/repo，且大多是內部實作細節，只有少數是「對外契約」。
5. **Root**：跨系統交付的本質是**邊界契約（boundary contract）+ 起手式（onboarding path）**的封裝；人工彙整容易漏、更新不及時；AI 能掃描整合表面（API、schema、event、config、env、auth、rate-limit）並自動策展。

## 2. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| 產出一份（或一組）以 receiver 為中心的 handoff 文件 | 取代 `/tech-spec`、`/runbook`、`/recap-doc` — 這些寫給內部 |
| 自動掃描程式碼與現有文件，識別整合表面並策展 | 自動產生全新的 API 文件或 SDK（由外部工具負責） |
| 明確標示契約（API/schema/event/auth/config），以及對應的使用範例入口 | 揭露內部實作細節、技術債、歷史包袱 |
| 適配多種 handoff 情境（team→team、ownership transfer、外部整合） | 無邊界的 onboarding（新員工入職）— 由 `/repo-intake` 覆蓋 |
| 與既有 taxonomy 相容（已註冊的 `handoff` ancillary 類型） | 新增獨立的 lifecycle 階段 |
| 支援 update mode：既有 handoff 文件更新時的差異合併 | 維運期的持續同步（out of scope v1） |

## 3. Stakeholders

| Stakeholder | Role | Key Concern |
|-------------|------|-------------|
| Sender（交付方 dev/team） | 使用者 / sender | 低撰寫成本、相信 AI 策展；不想重複寫過的內容 |
| Receiver（接手方 team） | 讀者 / dependent | 單一入口、明確合約、最短上手路徑 |
| Integrator（串接方） | 讀者（可能為 LLM/工具） | 機器可讀合約（OpenAPI/JSON Schema/範例） |
| Coordinator（PM / tech lead） | 監督者 | 確認關鍵合約未漏、ownership 邊界清楚 |
| Future maintainer（接手維運） | 讀者 | 操作手冊、運行 SLA、on-call 需知 |
| Security reviewer | 關注者 | 機密不得外流（secret redaction）、合規 |

## 4. Use Cases

| # | Actor | Action | Expected Outcome |
|---|-------|--------|-----------------|
| UC-1 | Sender dev | 執行 `/handoff-doc` 於有 tech-spec/架構的 feature 目錄 | 產出 `handoff-<receiver>.md`，含契約、起手式、FAQ |
| UC-2 | Sender dev | 用 `--target integrator` 標示讀者類型 | 文件偏向機器可讀契約與 sample code，隱藏運維細節 |
| UC-3 | Tech lead | 團隊交接專案，執行 `/handoff-doc --scope feature/<name>` | 產出 ownership transfer bundle（維運 + 程式碼所有權 + 關鍵決策） |
| UC-4 | Sender dev | 既有 handoff 文件加入新 endpoint 後執行 `/handoff-doc --update` | 僅差異合併，未變更段落保留；標註變動處 |
| UC-5 | Sender dev | 執行時指定 `--receiver-repo <url>` 或描述 | AI 推測 receiver 關切的表面（例如對方是 Node 後端，就偏向 REST/Event） |
| UC-6 | Receiver（LLM/agent） | 讀取產出文件並執行整合 | 不需要 sender 介入即可完成串接（goal：self-serve） |
| UC-7 | Security reviewer | 掃描輸出 | 確認無 secret、無內部 URL、無敏感路徑 |

## 5. Functional Requirements

| ID | Requirement | Priority | Rationale |
|----|-------------|----------|-----------|
| FR-1 | 技能必須能**自動偵測 feature 目錄**（沿用 `feature-context-resolution` 的 behavior + code layer cascade） | Must | 與 `/tech-spec` / `/req-analyze` 行為一致 |
| FR-2 | 技能必須**讀取既有 lifecycle 文件**（`2-tech-spec.md`、`3-architecture.md`、`requests/*`）作為輸入來源 | Must | 避免重複撰寫，承接先前分析 |
| FR-3 | 技能必須**掃描程式碼 integration surface**：API route / schema / event / config schema / env vars / auth mechanism / rate-limit / error codes | Must | Receiver 的核心關切是合約 |
| FR-4 | 技能必須產出**符合 taxonomy 的 ancillary 文件**：`handoff-<topic>.md`（`^handoff-` 或 `交接` 命名 pattern，見 `scripts/config/doc-taxonomy.json` 的 `handoff` 項目） | Must | Taxonomy 已保留此類型 |
| FR-5 | 技能必須支援 **target audience 分類**（至少：`integrator`、`maintainer`、`team-transfer`、`partner-external`） | Should | 不同 receiver 關切面不同；擬定於 OQ-2 |
| FR-6 | 技能必須在**輸出中明確標示 unknown / TBD 的合約**（例如找不到 schema 時不得虛構） | Must | 安全性 + 誠實性；避免 AI 幻覺合約 |
| FR-7 | 技能必須支援 **update mode**：既有 handoff 文件存在時偵測差異並局部合併 | Should | 符合 `/tech-spec`、`/update-docs` 既有模式 |
| FR-8 | 技能必須能**列出尚未文件化的接口**（缺 schema / 缺範例 / 缺 auth 說明）作為 Open Questions 供 sender 補齊 | Must | AI 不能虛構，但要指出 gap |
| FR-9 | 技能必須**自動觸發 `/codex-review-doc`**（per `@rules/auto-loop.md`） | Must | 全站 doc 生成 skill 共同規範 |
| FR-10 | 技能必須**redact secrets**（承 `@rules/security.md`）：token、privateKey、API key；並額外遮罩內部 URL / 內網主機（handoff-specific policy，見 Constraints） | Must | 跨系統文件風險最高 |
| FR-11 | 技能必須產出 **quickstart 區塊**：最短可執行的 receiver 起手式（環境、呼叫範例、預期回應） | Should | Receiver 優先想要「5 分鐘跑起來」 |
| FR-12 | 技能必須支援 **bundle 模式**（單檔 vs 多檔策展）— 見 OQ-3 | Could | 部分情境需要附 OpenAPI spec、sample repo 連結 |
| FR-13 | 技能必須提供 **receiver feedback loop**：文件尾附「遇到問題如何回報」欄位，含 owner / channel | Should | 降低 sender 未來被打擾頻率 |
| FR-14 | 技能必須**記錄產出決策**：哪些文件被引用、哪些被故意排除（短 rationale），存於 header metadata | Could | 可追溯性；重新產生時可對比 |
| FR-15 | 技能必須在 header 寫入**新鮮度 metadata**：來源 commit SHA、產生時間 (ISO 8601)、contract version（若 tech-spec 有版本欄位則沿用） | Must | Receiver 最怕用到過期契約；必要資訊須顯式寫入 |

## 6. Non-Functional Requirements

| ID | Category | Requirement | Metric |
|----|----------|-------------|--------|
| NFR-1 | Performance | 標準 feature（tech-spec 400 行 + 10 路由）產出時間 | ≤ 60 秒（不含 web research） |
| NFR-2 | Security | 產出文件零 secret 洩漏 | 通過 2-tier 掃描（high-conf 中止；medium 遮罩） |
| NFR-3 | Maintainability | 技能遵循 skill 骨架（SKILL.md + references/） | `/skill-health-check` 通過 |
| NFR-4 | Usability | 文件長度適配 receiver | 單檔 ≤ 400 行；超過則自動建議 bundle |
| NFR-5 | Reliability | 無法解析 feature 時明確 gate | 輸出 `⚠️ Need Human`，不強行產檔 |
| NFR-6 | Testability | 技能有對應測試 | `test/skills/handoff-doc.test.js` 覆蓋 happy + edge |
| NFR-7 | Accuracy | 引用的 API / schema 必須能在程式碼定位（file:line） | 100% traceable；不可虛構 |
| NFR-8 | Locale | 預設以 zh-TW 寫作（與全站一致），保留英文技術名詞 | 通過 `/de-ai-flavor` 審查 |
| NFR-9 | Observability | 技能自評輸出品質：引用文件數、integration surface 覆蓋項數、未解 Open Questions 數 | 輸出尾端**必含** `<!-- handoff-stats -->` 區塊，**三項計數皆需出現**（無則填 0）；供後續 adoption / quality 追蹤建置使用 |

## 7. Constraints & Assumptions

| Type | Description | Source |
|------|-------------|--------|
| Constraint | 必須產出 ancillary 類型（非 lifecycle phase） | `@rules/docs-numbering.md` + `doc-taxonomy.json` |
| Constraint | 命名必須為 `handoff-<topic>.md`（已註冊 semantic_pattern） | `scripts/config/doc-taxonomy.json` → `"id": "handoff"` 項目 |
| Constraint | 不可自動 `git add/commit/push` | `@rules/git-workflow.md` |
| Constraint | 必須遵循 auto-loop（寫完後立即 `/codex-review-doc`） | `@rules/auto-loop.md` |
| Constraint | 不得在輸出含 secret（token / private key / 密碼） | `@rules/security.md`（Logging private keys/passwords/tokens 條款） |
| Constraint | 不得在輸出含內部 URL、內網主機、非外部可達資源參照 | Handoff 情境自身 policy（sender-internal 資源對 outsider 無意義且可能資安風險）；未來可考慮寫入 `rules/security.md` 擴充 |
| Assumption | 多數 handoff 發生在**已有 tech-spec 的 feature**；冷啟動時可退化為只掃 code | 既有 workflow 觀察 |
| Assumption | Receiver 通常會讀**一份主文件**，不會展開 30 個 sub-links | UX 常識；待 OQ-3 決定 bundle 策略 |
| Assumption | 現有 skill 的 integration surface 多數可透過 grep / AST 抽取（JS/TS/Node 為主） | 本專案 tech stack（Node.js） |
| Assumption | `/tech-brief`、`/runbook`、`/recap-doc` 不覆蓋 cross-system 情境 | Phase 2 研究：三者均為內部讀者 |

## 8. Acceptance Signals

- **AS-1**（FR-1, FR-2, FR-3）：於含 `2-tech-spec.md` 的 feature 目錄執行 `/handoff-doc`，60 秒內產出檔名符合 `handoff-*.md` 的文件，且包含 API/schema/auth 至少三個段落，無人工介入。
- **AS-2**（FR-6, FR-8, NFR-7）：對一個**刻意殘缺**的 feature（schema 缺失）執行，輸出應出現 `## Unknown / TBD Gaps`（per tech-spec §3.4 合約缺失段）列出缺失項，且不得虛構 schema 內容；`grep` 驗證所有 API 引用皆能 file:line 對回原檔。
- **AS-3**（FR-10, NFR-2）：測試 fixture 混入假 secret，產出不得包含該字串；secret scanner 測試通過。
- **AS-4**（FR-5）：相同 feature 以 `--target integrator` 與 `--target maintainer` 執行，輸出段落比例明顯不同（integrator 偏 API/schema；maintainer 偏 SLA/on-call）。
- **AS-5**（FR-7）：update mode 測試：第一次產出後手動改一節→第二次帶 `--update`→檢查手動段落保留，僅差異段落更新。
- **AS-6**（FR-9, NFR-3）：產出後 `/codex-review-doc` 自動觸發且通過；`/skill-health-check` 對新 skill 通過。
- **AS-7**（NFR-4）：單檔超過 400 行時，輸出尾端提示 bundle 建議（FR-12 若實作則產出 bundle）。
- **AS-8**（NFR-5）：無 tech-spec、無程式碼、無 feature 目錄的情境，技能輸出 `⚠️ Need Human` 並終止。
- **AS-9**（FR-15）：產出文件 header 必含三個欄位可被 grep 抽出：`commit SHA`（`^[0-9a-f]{7,40}`）、ISO 8601 時間戳（`\d{4}-\d{2}-\d{2}T`）、contract version（若 tech-spec 有版本欄位則值須一致，否則標註 `n/a`）。

## 9. Open Questions

- [x] **OQ-1 命名與 trigger**：~~skill 名稱用 `/handoff-doc`（對應 `/recap-doc`、`/tech-brief` 風格）還是 `/handoff`（簡短）？~~ → **決議 2026-04-22：`/handoff-doc`**。子命令（`--bundle`, `--update`, `--target`）保留給 tech-spec 階段設計。
- [ ] **OQ-2 Target audience taxonomy**：`integrator` / `maintainer` / `team-transfer` / `partner-external` 這四類是否足夠？是否需要 `vendor`、`contractor`、`regulator` 等？是否預設值、還是強制 sender 指定？
- [ ] **OQ-3 Bundle 策略**：單檔 `handoff-<topic>.md` vs. 多檔 bundle（main + api-contract.yaml + samples/）— bundle 模式的檔案組織？是否引入新目錄 `handoff-<topic>/`？Taxonomy 目前只保留單檔 pattern，需確認是否擴充。
- [ ] **OQ-4 Integration surface 偵測範圍**：v1 MVP 是否限於 API route + schema + env vars？還是立即含 event/topic、GraphQL、gRPC？本專案是 Node/plugin 場景，scope 可能較窄；跨用戶使用時需要可插拔偵測器嗎？
- [ ] **OQ-5 Receiver repo 推測**：`--receiver-repo <url>` / `--receiver-description` 是否 v1 必要？若 receiver 不具名（通用 handoff），策展策略如何退化？
- [ ] **OQ-6 與 `/runbook`、`/tech-brief` 的邊界**：如果 receiver 是「接手維運」，是否直接建議 `/runbook` 而非 handoff？建議加一節「When to use what」決策表。
- [ ] **OQ-7 Solution concern — 建議 `/feasibility-study`**：handoff 文件的**生成策略**（純 LLM 策展 vs. 規則式抽取 vs. 混合）、以及 **Codex 獨立研究的納入方式**，屬於解法空間 — 建議後續跑 `/feasibility-study handoff-doc`。
- [ ] **OQ-8 更新觸發**：是否要加入 auto-loop hook，當 tech-spec 變更時建議重跑 handoff？或留給使用者手動？

## 10. References

- **Taxonomy**：`scripts/config/doc-taxonomy.json` → 搜尋 `"id": "handoff"`（ancillary 類型；行號會隨檔案演進，不直接寫死）
- **Numbering rules**：`rules/docs-numbering.md#ancillary-documents`
- **Prior art 現況**：Code-level 僅 taxonomy 註冊，尚無 `skills/handoff-doc/` 實作（`grep -rl "handoff" skills/` 無回傳）
- **Related skills**（比對邊界）：
  - `skills/tech-brief/SKILL.md` — 內部同事分享
  - `skills/runbook/SKILL.md` — 運維 SOP
  - `skills/recap-doc/SKILL.md` — 事後 recap
  - `skills/tech-spec/SKILL.md` — 設計階段文件
  - `skills/project-brief/SKILL.md` — PM/CTO 摘要
- **Context resolution 模式**：`skills/create-request/references/feature-context-resolution.md`（behavior + code layer cascade）
- **Output template 參考**：`skills/tech-brief/references/` + `skills/runbook/references/`
- **Request tickets**: `./requests/`（建立後）— 每個執行任務的追蹤票
- **Tech Spec**: 尚未產出（建議下一步：`/feasibility-study` → `/tech-spec`）
