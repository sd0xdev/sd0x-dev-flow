# 規則覆寫契約遷移 (R8)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Pending
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

**解析階序（草案，優先序由高至低）**

| 序 | 規則 | 適用 |
|----|------|------|
| 1 | 指示層級的明文標註 | 混合層級段落中的個別條款（如 `Tier` 段內的安全升級句） |
| 2 | heading 對照表 | 有母檔同名段落者 |
| 3 | preamble 合成歸屬 | 首個 `##` 之前的指示，視為一個合成段落統一歸屬 |
| 4 | 未知 heading fail-closed → **Default** | 不歸 Guidance（使用者刻意寫下的設定不應可被忽略），亦不自動歸 Anchor（使用者本就有權調整） |

## Acceptance Criteria

- [ ] 查證「HTML 註解不進入模型 context」並記錄結論與查證方式；若成立，precedence 宣告改為活文字（或改採不依賴檔內宣告的機制），且該決定寫入 `rule-override-pattern/2-tech-spec.md:105`
- [ ] 兩個覆寫檔範本中的**每條**指示（含目前處於註解狀態者）解析為恰好一個層級，涵蓋 preamble、六個 `auto-loop-project` 段落、兩個 `testing-project` 段落，且測試拒絕遺漏、重複與衝突的對照
- [ ] `auto-loop-project.md:14-22` 這類混合層級段落，其可設定項與安全升級句取得**不同**層級（測試以該段為 fixture）
- [ ] `rule-override-pattern/2-tech-spec.md:98` 的 full replacement 語意收窄為 Default／Guidance，且與 R7 的 Anchor 定義無矛盾（兩份文件對「使用者檔能否解除 Anchor」給出同一答案）
- [ ] `:100`「覆寫 heading 須與母檔完全相同」的要求與 project-only 段落的既有事實調和，且不使 `testing-project.md:29` 成為違規
- [ ] 測試在**獨立 consumer fixture**（來源與目標為分離路徑，不得用本 repo 的 `.claude/rules` 符號連結）中同時證明兩件事：`/install-rules` 對**尚未安裝**的目標生成的 header 帶新 precedence 文字，且**已存在**的目標位元組完全不變。`rules/` 範本來源本身允許且必須被修改，`testing-project.md` 的散布路徑於 `2-tech-spec.md:120` 有明確定義（納入映射或明載不複製）
- [ ] 負向測試證明：覆寫檔無法壓制「編輯後須 review」、無法讓 tier 決定迴圈是否執行、無法解除 code 編輯的週期重置
- [ ] 舊 header 的既有安裝由 `claude-health` S2.5 第 6 項檢查回報，且有迴歸測試釘住該檢查不修改檔案
- [ ] Pass /codex-review-doc
- [ ] Pass /precommit

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

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 兩檔現況（live `##` 6/0、活指示 0）與四個結構性問題皆經實測；註解不進 context 為消費端第一手觀測，機制待查（AC 第 1 條） |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 前置: [規則授權層級與提案核准通道 (R7)](./2026-07-26-rule-discretion-tiers-r7.md)
- 受影響規格: [Rule Override Pattern](../../rule-override-pattern/2-tech-spec.md)
- 全組執行順序: 見 R7 § 全組執行順序
