# 規則覆寫契約遷移 (R8)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 由 R7 拆出。R7 審查時發現「讓 Anchor 勝過使用者覆寫」不是標註工作而是**契約遷移**，且覆寫檔的結構讓 heading 級分類無法成立。兩者合併會使 R7 同時承擔標註與規格變更，AC 已達 11 條。父 tech spec 尚未建立（見 References）
> **Priority**: P2
> **Depends On**: [規則授權層級與提案核准通道 (R7)](./2026-07-26-rule-discretion-tiers-r7.md)
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`

## Background

R7 為 12 個 plugin 受管規則檔建立 Anchor / Default / Guidance 三級分層。兩個 user-owned 覆寫檔（`rules/auto-loop-project.md`、`rules/testing-project.md`）留給本張，原因是它們牽涉的不是標註，而是契約本身。

### 先確立現況：兩檔目前是空殼

實測（2026-07-26）：

| 檔案 | live `##` | 非註解的指示內容 |
|------|-----------|-----------------|
| `rules/auto-loop-project.md` | 6 個（`:14`, `:26`, `:33`, `:41`, `:48`, `:57`） | **零**（見下方導出指令，僅剩 4 行，全屬 `:7-12` 多行註解的內文） |
| `rules/testing-project.md` | **0 個** | **零**——`## Test Pyramid`(`:19`)、`## Adequacy Mode`(`:29`) 兩段連同 heading 一併被 `<!-- -->` 包起 |

```bash
grep -c '^## ' rules/auto-loop-project.md   # 6
grep -c '^## ' rules/testing-project.md     # 0
grep -vE '^\s*$|^#|^<!--|^\s|-->' rules/auto-loop-project.md   # 4 行，皆為 :7-12 註解內文
```

亦即**每一段的段落內容都在 HTML 註解裡**，包含 `:3` 的 precedence 宣告與 `:7-12` 的覆寫操作說明。這並非意外狀態——`test/skills/install-rules-customize.test.js:154` 的 `hasActiveContent returns false for template-only file` 正是釘住這個性質，「空殼」是設計上的初始態。

更要緊的是：**這些註解沒有進到模型的 context。** 本張撰寫時，兩檔以 project instructions 身分載入本 session，`auto-loop-project.md` 呈現為 6 個裸 heading、`testing-project.md` 僅剩 H1——與註解遭剝除的預期完全一致。這是消費端的第一手觀測，非推論；剝除的**機制**未經驗證（見 AC 第 1 條）。

**受影響的只有模型路徑，工具路徑不受影響。** `skills/claude-health/SKILL.md:196` 的 override drift 檢查直接讀檔內的 `<!-- Based on: auto-loop.md @ <hash> -->`，那是檔案解析而非 context 載入，照常運作。因此問題不是「註解沒用」，而是「precedence 宣告選錯了承載形式」——`rule-override-pattern/2-tech-spec.md:105` 選定的機制是「Self-contained header text — 不依賴 CLAUDE.md load order」，其唯一讀者是模型，而那段 header text 是 `:88` 範本裡的 HTML 註解。**宣告觸不到它唯一的讀者。** 兩檔今日之所以無害，是因為它們什麼都沒說，不是因為契約成立。

### 四個結構性問題

問題在使用者**取消註解**啟用某段的當下浮現——屆時帶著「本檔優先」語意的活指示才會進入 context。四者皆為契約屬性，與目前是否已啟用無關：

**① 三分之一的段落無母檔對應。**

| 覆寫檔段落 | 母檔對應 |
|-----------|---------|
| `auto-loop-project.md:14` `## Tier` · `:26` `## Max Rounds` | `auto-loop.md:18` `## Tiers`（可對應） |
| `auto-loop-project.md:33` `## Plan Review` · `:41` `## Plan Review Max Rounds` · `:48` `## Git Memory` | **無同名段落** |
| `auto-loop-project.md:57` `## Think Harder` | 僅散見於 § Strategic Reset，非段落級對應 |
| `testing-project.md:19` `## Test Pyramid`（註解中） | `testing.md` 有同名段落 |
| `testing-project.md:29` `## Adequacy Mode`（註解中） | **自述**為 `project-only extension — not in testing.md core` |

**② 可分類的指示位於首個 `##` 之前。** precedence 宣告（`:3`）與覆寫操作說明（`:7-12`）在任何 heading 之前，heading 級對照表在結構上構不到。此問題不因它們目前是註解而消失——`/install-rules` 每次生成都會寫入，且 R8 若要收窄 precedence 文字，改的正是這段。

**③ 單一段落內混合層級。** `auto-loop-project.md:14-22` 的 `## Tier` 註解同時包含**可設定項**（`To override: uncomment below, leaving a bare tier name`）與**不可協商的安全規則**（`Security and data-integrity changes are treated as thorough regardless`）。使用者依指示取消註解時，兩者一起變成活指示；給這個 heading 指定單一層級，不是凍結可設定項、就是把安全指示降級。

**④ 現行契約與 Anchor 優先直接衝突。** `rule-override-pattern/2-tech-spec.md:98` 定義覆寫語意為 section-level full replacement，`:88` 的範本 header 稱「this file takes precedence」，全篇無任何不可覆寫的例外；`:100` 另要求覆寫 heading 必須與母檔**完全相同**——後者與 `testing-project.md:29` 這種 project-only 段落的存在本身就不一致。若 R7 的 Anchor 不可覆寫要成立，這份規格與兩個範本 header 都必須一併更新，否則文件組會對「使用者檔能否解除 Anchor」給出兩個相反答案。

## Requirements

- 先確認 HTML 註解是否確實不進入模型 context；結論決定 precedence 宣告該以何種形式承載
- precedence 宣告必須以能抵達模型的形式呈現（活文字而非註解），或改採不依賴檔內宣告的機制
- 分類以**指示層級**為單位，並定義明確的解析階序，能處理 preamble 與混合層級段落
- 未列入對照表的自訂 heading 有 fail-closed 歸屬，且歸屬結果可被列舉而非靜默
- `rule-override-pattern` 規格與兩個範本 header 同步更新為「Anchor 不可覆寫、其餘維持覆寫優先」
- 區分 plugin repo 的**範本來源**（須修改，否則新安裝不合規）與消費端**已安裝副本**（不得被靜默改寫，帶舊 header 者以診斷回報處理）
- 規格中「覆寫 heading 須與母檔完全相同」的要求須與 project-only 段落的既有事實調和
- 覆寫檔與母檔 Anchor 衝突時，Anchor 勝出並回報衝突

## Scope

| Scope | Description |
| ----- | ----------- |
| In | 註解可見性查證；precedence 承載形式；指示層級解析階序定義；preamble 與混合層級處理；fail-closed 歸屬；`rule-override-pattern/2-tech-spec.md` 的 precedence 契約與 `override_templates` 映射更新；**plugin repo 範本來源**的 header 文字；`claude-health` S2.5 第 6 項診斷；測試 |
| Out | 改寫**消費端已安裝**的 `.claude/rules/*-project.md`（僅診斷回報）；12 個受管檔的分層（R7）；`/install-rules` 的互動流程重構；hook 端強制執行分層；把 `## Tier` 等段落的預設值從註解改為啟用（那是設定變更，非契約變更） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `docs/features/rule-override-pattern/2-tech-spec.md` | Modify | `:98` 的 full replacement 語意加上 Anchor 例外；`:100` 精確 heading 要求與 project-only 段落調和；`:105` 的「self-contained header text」機制須因應註解不可見而重選；`:88` 範本 header 同步；`:120` 的 `override_templates` 補齊或明載 testing 不走複製 |
| `rules/auto-loop.md` · `rules/testing.md` | Modify | 發布各自的 heading → tier 對照表與解析階序 |
| **`rules/auto-loop-project.md` · `rules/testing-project.md`** | **Modify** | **plugin repo 的受追蹤範本來源**（`2-tech-spec.md:81`：`Template source exists in rules/ for /install-rules to copy from`）。只改 header 的 precedence 文字與其承載形式，不動任何 `##` 段落內容 |
| `.claude/rules/*-project.md`（消費端已安裝副本） | Reference | **不改寫**。user-owned，僅由診斷回報舊 header |
| `skills/install-rules/SKILL.md` | Modify | 確認複製路徑產出的是新 header；`--customize --reset` 的重生成同步 |
| `skills/claude-health/SKILL.md` | Modify | S2.5（`:182`）已擁有 5 項 override 檢查，新增第 6 項「舊 precedence header」偵測與建議；檢查為唯讀 |
| `test/rules/override-contract.test.js` | New | 解析階序、preamble、混合層級、fail-closed、Anchor 不可被覆寫的負向測試 |
| `test/skills/install-rules-customize.test.js` | Modify | **既有套件**，已含 `:109` Generated-by sentinel、`:114` Based-on hash 等範本 header 斷言。新 precedence header 文字與「未安裝 → 生成新 header／已存在 → 位元組不變」兩分支置此 |
| `test/skills/claude-health.test.js` | **New** | 目前**不存在**（`find test -iname '*claude-health*'` 無結果；`test/` 樹內僅 `test/scripts/namespace-hint-sentinel.test.js` 提及該 skill，且與本檢查無關）。承接 S2.5 第 6 項檢查的非變更性迴歸測試 |

**範本來源 ≠ 已安裝副本。** 這兩者同名，是本張最容易出錯的地方——`rules/*-project.md` 是 plugin repo 內受 git 追蹤的**複製來源**，`2-tech-spec.md:124` 的虛擬碼 `Copy from rules/{project_file} as template` 讀的就是它；`.claude/rules/*-project.md` 才是使用者擁有、不得改寫的**安裝副本**。`scripts/lib/fc-doc-currency.js:137-147` 已明確區分這兩層。把來源檔標為唯讀會使新安裝永遠拿到舊 header——即「不改寫使用者檔」與「新生成須合規」兩項需求無法同時成立。

**附帶查到的缺口**：`2-tech-spec.md:120` 的 `override_templates = { "auto-loop.md": "auto-loop-project.md" }` **只映射 auto-loop**，`testing-project.md` 不在其中，`skills/install-rules/SKILL.md:60` 亦只泛稱 `*-project.md` 而未列舉。`testing-project.md` 的散布路徑因此無明確定義，本張須一併釐清。

**測試環境限制**：本 repo 是自身的 dogfood 消費端，`.claude/rules` 是指向 `../rules` 的符號連結（`.claude/hooks`、`.claude/scripts` 同）。在此 checkout 中「範本來源」與「已安裝副本」是同一份檔案，兩分支測試無法就地區分。實作時必須在**獨立的 consumer fixture**（來源與目標為分離路徑的暫存目錄）中執行，不得依賴工作目錄的 `.claude/rules`。

**解析階序（已定案，優先序由高至低）** — 草案原以「明文標註」為最高優先，doc review R1 指出這與 `discretion.md` 的權威順序矛盾，且讓使用者檔中的自我標註得以壓過 Register 命中；已補入 step 0。

| 序 | 規則 | 適用 |
|----|------|------|
| 0 | **Anchor Register 命中 → Anchor，解析終止** | 全域。層級由 `discretion.md` 決定而非由指示旁的標籤決定；任何檔案中的 tier 標註都不能降級 Register 命中，嘗試降級即回報衝突 |
| 1 | 指示層級的明文標註（僅限非 Anchor） | 混合層級段落中的個別條款（如 `Tier` 段內的安全升級句） |
| 2 | heading 對照表 | 有母檔同名段落者 |
| 3 | preamble 合成歸屬 | 首個 `##` 之前的指示，視為一個合成段落統一歸屬 |
| 4 | 未知 heading fail-closed → **Default** | 不歸 Guidance（使用者刻意寫下的設定不應可被忽略），亦不自動歸 Anchor（使用者本就有權調整） |

## Acceptance Criteria

- [x] 查證「HTML 註解不進入模型 context」並記錄結論與查證方式；precedence 宣告改為活文字，決定寫入 `rule-override-pattern/2-tech-spec.md` precedence-mechanism 設計列 — 查證方式：**消費端第一手觀測**（2026-07-29 session 注入的 project instructions 中 `auto-loop-project.md` 僅 6 個裸 heading、`testing-project.md` 僅 H1，磁碟檔帶完整註解），結論與工具路徑豁免（claude-health 讀 `Based on:` 為檔案解析）一併記入規格；測試 `spec when recording the carrier decision` 釘住記錄
- [x] 兩個覆寫檔範本中的**每條**指示解析為恰好一個層級 — 母檔各發布 heading → tier 對照表（`auto-loop.md` § Override Contract 7 列：preamble 合成段落＋6 heading；`testing.md` § Project Customization 3 列）；`override-contract.test.js` 以 strict 表格解析 deepEqual 全列、Set 檢重複、並對磁碟範本 heading 清點交叉驗證拒絕遺漏（含註解態 heading，排除 `： enabled` 範例值行）
- [x] 混合層級段落：`## Tier` 的可設定項（Default）與安全升級句（Anchor）取得**不同**層級 — 測試以實際範本 `## Tier` 段為 fixture。Anchor 主張**有 Register 背書而非自我背書**（code review P1 修正）：升級義務收進 `discretion.md` Register #3 內容（「reviewed at `thorough` whatever tier is configured — overrides included」，屬既有項目的內容擴充，7 項封閉清單不變）、範本句帶明文標註 `(Anchor — discretion.md Register #3; no tier setting or override removes it)`、對照列引 Register #3 hit、測試三環交叉驗證且限定在 `3. **Data integrity**` 項本體內比對（P2 當場修）
- [x] full replacement 語意收窄為 Default／Guidance，Anchor 不可被覆寫、衝突回報；規格明文「兩份文件對『使用者檔能否解除 Anchor』答案一致：**不能**」— 測試斷言新語意存在且舊無條件句不得逐字存活
- [x] 「覆寫 heading 須與母檔完全相同」調和：規格 Note 加註 documented project-only extension 例外，`## Adequacy Mode` 由 `testing.md` 對照表明列（"no parent section here; permitted as a documented extension"），不再構成違規
- [x] 獨立 consumer fixture（mkdtemp 分離來源/目標路徑，不用本 repo 符號連結）雙分支測試：未安裝 → 複製產生帶活 `Precedence:` header 的副本；已存在（帶舊 header＋使用者編輯）→ `Buffer.equals` 位元組完全不變；`testing-project.md` 散布路徑納入 `override_templates` 映射（`"testing.md": "testing-project.md"`）。**證據範圍誠實聲明**：fixture 執行的是測試本地的 `installOverrideTemplates()` 鏡像，不是出貨 skill 本身（skill 為宣告式 markdown，無可執行入口）。AC-trace 據此判為 Medium gap，補救方式是把鏡像**綁回出貨合約**：`shipped /install-rules contract pins…` 逐條斷言 `skills/install-rules/SKILL.md` § Override Template Copy Contract 的兩組映射、absent-copy 正向整句、`--reset` 活 header、never-rewrite、legacy 路由；doc review 再追加 managed-set 排除斷言。因此可證的是「文件合約 + fixture 行為分支」，仍不可證「執行期安裝流程」——後者需要可執行入口，列入 Known Limitation
- [x] 負向測試：discretion.md Register #6 三條迴圈義務逐字存活＋兩個載體對照表全列 Default（無任何列可授予解除路徑）＋規格 tier-scoped 語意；`REVIEW_GRANT_PATTERNS` 掃描持續涵蓋 `rules/auto-loop.md`（含新增的 § Override Contract 文字）
- [x] 舊 header 偵測：claude-health S2.5 第 6 項（`<!-- Precedence:` 存在且首個 `##` 前無活 `Precedence:` 行 → P2 回報）；`test/skills/claude-health.test.js` 釘住 6 列檢查表、read-only 措辭、偵測鏡像 4 fixture（legacy 旗標／live 通過／dual 通過／無宣告不誤報）、shipped 範本不觸發。**AC-trace 兩輪補救**：初版以原始位元組讀 skill、`indexOf()` 抽 S2.5，把 S2.5 包進 fenced block 後八條斷言全綠而 `liveText()` 已無該指引——即本張要防的缺陷落在最後一個未遷移的檔案。改為 `liveText()` 讀取＋`structuralViolations` 斷言＋唯一活區段抽取，pin 置於完整 `### Sync Module — Checks (S1-S3)` 區域（8129 字元），並補三個變異測試（fenced 包裹／重複 S2.5／區域內 H4 兄弟段）。第二輪指出逃逸不在區域本體而在其**終止者**（`### Sync Module — Exception` 插在 `### Fix Tiers` 前，落點恰為區域原本結束處，本體逐字不變），加上 H1–H3 標題序列 pin。邊界矩陣：H1/H2/H3 插入 → 序列 pin 擋；H4 插入 → 區域 pin 擋；fenced H3 → 兩者皆不變但撤回句不在 `liveText()`，即非規範範例的預期行為。附帶修正 `skills/claude-health/SKILL.md` 的 S2.5 標題層級（`###` → `####`，與 S1/S2/S3 對齊）
- [x] Pass /codex-review-doc — 4 輪後 ✅ Mergeable（5 P2 deferred）；本張這次 Doc Sync 編輯與 `skills/claude-health/SKILL.md` 標題層級變更另行 doc review
- [x] Pass /precommit — `## Overall: ✅ PASS`（3042 tests / 3036 pass / 0 fail / 6 skipped，2026-07-30）；code review 33 輪後 ✅ Ready；AC-trace ✅ Adequate（8/8 Covered，AC8 兩輪補救後翻轉）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 分類單位 | 指示層級 + heading 預設 | 純 heading 層級 | 混合層級段落與 preamble 使純 heading 法在結構上不可行 |
| 未知 heading | fail-closed 為 Default | Guidance | Guidance 可被忽略，等於讓使用者刻意寫下的設定失效 |
| 未知 heading | fail-closed 為 Default | Anchor | 自動升為不可協商會凍結使用者本有的調整權 |
| 已安裝的消費端副本 | 只診斷不改寫 | 自動遷移 header | 檔案定義上為 user-owned；靜默改寫違反其所有權契約 |
| plugin repo 的範本來源 | 必須修改 | 比照副本設為唯讀 | 它是 `/install-rules` 的複製來源；設為唯讀等於新安裝永遠拿到舊 header |
| 契約變更落點 | 規格 + 範本一併改 | 只改 R7 的分層定義 | 不改規格的話，同一問題有兩份互相矛盾的權威答案 |
| 分類範圍 | 含註解狀態的範本指示 | 只分類已啟用的活指示 | 目前活指示為零，只分類活指示等於本張無事可做；風險在使用者取消註解的當下才現形 |

## Known Limitation

**過渡期的雙重敘述**：消費端已安裝的副本會繼續帶著舊 header，直到使用者自行更新。`claude-health` 可以回報，但不能代為修改。因此在過渡期內，同一句 precedence 在規格／範本來源與既有安裝之間不一致——這是尊重 user-owned 所有權的直接代價。新安裝不受影響（範本來源已更新）。

**分層無強制力**：R7 與本張都是行為層。使用者仍可在覆寫檔中寫下與 Anchor 抵觸的文字，屆時模型面對的是兩段互相矛盾的 context，靠的是規則敘述而非 hook 攔截。hook 端強制執行明列於 Scope Out。

**安裝流程的可證性上限**：`/install-rules` 是宣告式 skill（markdown 工作流，無可執行入口），因此測試最多能釘住**出貨合約文字**與**行為分支鏡像**，不能執行真正的安裝路徑。managed-set 排除、copy-time hash stamping、`--reset` 例外都以合約斷言把關；若日後抽出可執行的安裝邏輯，這三項應改為直接呼叫該實作。

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 兩檔現況（live `##` 6/0、活指示 0）與四個結構性問題皆經實測。**消費端行為已確立**（註解不進 context，第一手觀測，AC 第 1 條已結）；仍待查的是 harness **底層剝除機制**（在哪一層、是否所有註解形式一致），屬 plugin 外部實作細節，不阻擋本張 |
| Development | Done | 兩範本 header 活文字化（`##` 段落零觸及）；`auto-loop.md` § Override Contract＋`testing.md` § Project Customization 對照表與階序；規格更新＋`override_templates` 補 testing 映射；claude-health S2.5 第 6 項；install-rules 複製契約段。**doc review R1 六個 P1 修正**：階序改 **Anchor-first**（step 0 為 Register 判定，明文標註不得降級 Register 命中）；對照表加 **Kind 欄**（section replacement vs setting）並標明各自 consumer——出貨的 auto-loop 六個 heading 全為 setting（`## Tier` ≠ 母檔 `## Tiers`）；drift check #1 加「有活內容才比對」前置條件＋複製時 stamp hash（否則 fresh install 立即誤報）；install-rules workflow 明列 `*-project.md` managed-set 排除（Phase 2/3.5/4 皆不得觸及）；`--reset` 與 never-rewrite 的矛盾收斂為單一例外；兩份仍在教舊註解式 header 的規範文件（`3-customize-v2.md` §3.6、`testing-rules-enrichment/2-tech-spec.md` §3.3）標 superseded 並改活文字 |
| Testing | Done | `override-contract.test.js` **47 tests**（新）＋`claude-health.test.js` **12 tests**（新）＋`install-rules-customize.test.js` **28 tests**（+14：fixture 雙分支、活 header、preamble 豁免、出貨合約綁定、managed-set 排除、copy-time stamping、否定式掃描）＋`testing-rules.test.js` 1 斷言汰換舊 supremacy 句＋`discretion-tiers.test.js` baseline 列同步。code review **33 輪**（全數由 Codex 依 @rules/codex-invocation.md 獨立研究；thread `019fae06-54fc-7070-9aa9-a8161f2d9a14`）。**證據範圍聲明**（doc review R5 P2）：輪次計數是 **in-session 記錄**，無法從工作樹重建——`.claude_review_state.json` 只存 session 層級的 `total_rounds_session`，不按需求單歸屬，各輪報告也未落檔。可從樹上驗證的是各檔測試數與全套件結果；輪次本身僅此 thread 可回溯。逐輪摘要：R1 ⛔（P1 升級句 Register 背書化）→ R2 ✅ → R3 ✅（AC-trace 補救後複驗）→ R4 ⛔ 2 P1：**fixture 仍是逐位元複製、無法 stamp，且因範本 hash 恰等於母檔而遮蔽**（改為以 `0000000` 刻意過期 hash 播種＋本地 blob hash 計算並與 `git hash-object` 對驗）、**合約 regex 可被否定句穿透**（改比對含主詞的完整子句＋否定式掃描）；2 P2 一併修：活躍偵測誤判 heading-form 設定（`## Plan Review: enabled` 無 body 行）、heading 比對對縮排/反引號敏感（統一 normalizer）→ R5 ⛔ 1 P1：**逐行 allowlist 遮蔽反轉句**（`never rewritten, but are not excluded` 整句被視為單一允許 span），改為逐 match 判定 → R6 ⛔ 1 P1 + 1 P2：否定式僅認分詞、漏掉 `do not copy` 系列且誤傷 `not only copied`（改為文法對齊的動詞交替＋`(?!only\b)` 排除，並以 lookahead 阻止單一 match 跨子句）、ATX 解析未追蹤 fenced block 且統一剝反引號（拆為 `atxHeadingName` / `mappingHeadingName` / fence-aware `documentSections`）。**R7 起改為結構性防護**：`assert.match(doc, /X/)` 在原始位元組上比對，可以證成讀者看不見的散文——HTML 註解不進模型 context，這正是本張 AC 第 1 條的發現反過來咬到測試自身。新增 `test/helpers/markdown-structure.js`（共用 Markdown 解析器＋封閉結構閘門 `structuralViolations()`），受護文件皆斷言 0 violations（`override-contract.test.js` 迴圈涵蓋七份，AC8 補救時把 `skills/claude-health/SKILL.md` 納入為第八份）；載重句改以 canonical 等值 pin，並逐輪從行級提升到段級、再到完整區域級。R7–R30 逐輪由審查者示範一個新的載體或解析歧異後修正，關鍵轉折：R24 改為**以詞法約束註解**而非在閘門內另寫一部剖析器（兩部剖析器的每個分歧點都是假綠燈）、R25 認出 strikethrough 是「可見但語意被撤回」的另一類別、R27 證明行級 pin 不劃定語意單位（canonical 行逐字不變，例外寫在旁邊）、R29 證明釘記錄不等於釘區域（不以 `Phase` 開頭的指示、寫在子段外的 redirect）。最終邊界：`## Workflow` 與 `### 3.4 Core Logic Changes` 兩個完整區域 pin（normalized 3524／4659 字元；**度量基準**為測試實際使用的 `liveText(raw, { fencesCount: true })` → `sectionAt()` → 去 NUL 後折疊空白。以 fences 隱藏量測會得到 3049／2894，那不是 pin 的值——doc review R5 即因此誤判數字過期，故在此明載函式）。**R31–R33** 是 AC-trace 揪出的獨立缺口：`claude-health.test.js` 原以原始位元組讀出貨 skill，同一缺陷落在最後一個未遷移的檔案，遷移後再由兩輪找出「兄弟子段」與「區域終止者」兩個逃逸，補上 `### Sync Module — Checks (S1-S3)` 區域 pin（8129 字元）與 H1–H3 標題序列 pin。全套件 **3042 tests / 3036 pass / 0 fail / 6 skipped**（2026-07-30 本機實測）。**skip 歸因更正**（doc review R5 P2）：這 6 個 skip 與 Codex sandbox 無關，全是主機環境／平台條件的 `t.skip` — `post-tool-review-state.test.js:4610`（Linux stale-reclaim race）、`stop-guard.test.js:2201/2318/2366`（無 perl／無 zh_TW locale／以 root 執行）、`user-prompt-review-guard.test.js:386` 與 `post-skill-auto-loop.test.js:452`（coreutils 無法解析）。本張的 detached consumer fixture（`install-rules-customize.test.js:427`、`:638`）**直接呼叫 `mkdtempSync` 且無 skip guard**，因此在唯讀 sandbox 中會被計為 fail 而非 skip；先前把兩件事混為一談是錯的記錄 |
| Acceptance | Done | AC-trace ✅ Adequate（8/8 Covered；AC6 與 AC8 各由 Medium gap 補救後翻轉）；precommit `## Overall: ✅ PASS`（3042 / 3036 pass / 0 fail / 6 skipped，2026-07-30）；code review 33 輪後 ✅ Ready，審查者宣告設計在其邊界內封閉——三層責任分工：結構閘門擋住不渲染的 Markdown 載體冒充規範散文、區域等值偵測明確擁有的契約邊界內任何語意變更、跨段落矛盾與同時竄改原始碼與 canonical 常數歸人工審查（再擴張需釘住整份檔案乃至每份能引用它的文件，得不到有意義的有限邊界）。doc review 4 輪：R1 ⛔ 6 P1、R2 ⛔ 3 P1（drift check 硬編碼 auto-loop.md、CLAUDE autonomy 文字重新授權 sub-threshold 自由修正、testing 面操作說明仍留無條件 supremacy）、R3 ⛔ 1 P1（check #1 交棒的「衍生 base 缺失」指向不具該偵測的 check #3，且僅涵蓋單一覆寫檔——已將 check #3 泛化為「Missing reference or base」並補測試）＋2 P2（本單測試計數過期，已同步；tech spec 殘留 auto-loop-only 的過期範圍敘述，已修正）、R4 ✅ Mergeable（5 P2 deferred）；本張這次 Doc Sync 編輯與 `skills/claude-health/SKILL.md` 標題層級變更另行 doc review；hooks 消費端驗證：`^##` 閘控 awk 不受 preamble 活文字影響（code review 獨立確認）；`REVIEW_GRANT_PATTERNS` 掃描含新 § Override Contract 文字通過 |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 前置: [規則授權層級與提案核准通道 (R7)](./2026-07-26-rule-discretion-tiers-r7.md)
- 受影響規格: [Rule Override Pattern](../../rule-override-pattern/2-tech-spec.md)
- 全組執行順序: 見 R7 § 全組執行順序
