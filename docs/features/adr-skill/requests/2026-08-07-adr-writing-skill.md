# 新增 /adr skill：ADR（架構決策紀錄）撰寫

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-07
> **Status**: Candidate Complete
> **Note**: 本 feature 尚無 tech spec；實作前建議先跑 `/tech-spec` 定義 ADR 模板欄位與編號策略。
> **Priority**: P2

## Background

`rules/docs-numbering.md` 已定義 ADR 為 ancillary doc（pattern `adr-<number>-<title>.md`，`doc-classifier.js` 以 `semantic_pattern` 辨識、namespace `ancillary`），但目前沒有任何 skill 負責產生它——架構決策要嘛散落在 tech spec 裡，要嘛沒有留下可追溯的決策紀錄。

## Requirements

- 新增 `skills/adr/SKILL.md`：引導撰寫 ADR，輸出至 `docs/features/<feature>/adr-<number>-<title>.md`
- 提供 ADR 模板（`references/template.md`）：至少含 Context、Decision、Status（Proposed / Accepted / Superseded）、Consequences、替代方案；H1 標題帶 `ADR` 字樣（**更正**：原措辭「讓兩條辨識路徑都命中」不準確——`semantic_pattern`／`heading_signals` 對命名正確的檔案不會同時觸發，H1 是 `heading_signals` 在 `scanFeatureDocs({deep:true})` 且檔名已 fallback 時的補救訊號，非充分保證；見 References 的 doc review 記錄）
- 編號策略：三位補零 `adr-001-<title>.md`；掃描目標 feature 目錄**根層及其 `archived/` 子目錄**（`doc-classifier.js` 於根層與遞迴皆跳過名為 `archived` 的目錄，那是 ancillary 文件的歸檔位置；`requests/archived/` 是 request 的歸檔處，ADR 不會落在該處）既有 `adr-*`，以**數值解析**（非字典序——字典序下 `adr-9` 排在 `adr-10` 後會重號）取最大號 +1
- Superseded 流程：新 ADR 取代舊 ADR 時，雙向互相連結（新指舊、舊標記被誰取代）
- feature 目錄解析沿用既有 feature-context 機制（canonical 實作：`scripts/lib/feature-resolver.js`）
- 註冊進 `docs/skill-catalog.yml`，並重產 README catalog 區塊（`node scripts/generate-readme-catalog.js`——只改 catalog 不重產 README 會讓 `/adr` 缺席對外目錄且計數失準）

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | `/adr` skill 本體、模板、編號、Superseded 連結、catalog 註冊、結構測試 |
| Out   | 既有決策的回溯補寫（另開 request）；`doc-classifier.js` 修改（pattern 已存在，無需動） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/adr/SKILL.md` | New | Skill 本體：trigger、workflow、編號與 Superseded 規則 |
| `skills/adr/references/template.md` | New | ADR 模板 |
| `test/skills/adr.test.js` | New | 結構測試：frontmatter、模板欄位、編號規則描述存在 |
| `docs/skill-catalog.yml` | Modify | 註冊 `/adr` |
| `README.md` | Modify | 執行 `node scripts/generate-readme-catalog.js` 重產 catalog 區塊（marker 由 `test/scripts/generate-readme-catalog.test.js` 驗證） |

## Acceptance Criteria

- [x] `/adr` 可在指定 feature 下產生 `adr-<NNN>-<title>.md`（三位補零），編號以數值解析自動遞增、含歸檔位置在內不重號——`skills/adr/scripts/next-adr-number.js` 匯出 `nextAdrNumber()`，掃描 feature 根層與 `archived/` 兩處，取數值 max + 1（`i` 旗標大小寫不敏感）、`padStart(3, '0')` 補零；`test/skills/adr.test.js` 對真實暫存目錄直接呼叫此函式（非只比對 SKILL.md 文字），含 `adr-9` vs `adr-10` 的字典序碰撞案例——初版此處是純文字釘選，code review 抓到 mutation 存活（P1），已修正
- [x] 模板含 Context / Decision / Status / Consequences / 替代方案五欄，H1 帶 `ADR` 字樣——`skills/adr/references/template.md`
- [x] Superseded 時新舊 ADR 雙向連結——SKILL.md § Phase 4b：新 ADR 加 `**Supersedes**` 行、舊 ADR 加 `**Superseded by**` 行並將 Status 改為 Superseded，同一輪一併編輯。**修正（doc review P2 ×2）**：連結錨點原文寫「frontmatter block」但模板無 frontmatter，已改指向真正存在的 `> **Status**`/`> **Created**` blockquote；舊 ADR 若落在 `archived/` 時原本的相對路徑會失效，已補上依 Phase 2 實際掃描位置決定路徑的對照表，並補上「舊 ADR 已被第三份 ADR 取代」時的 Gate: Need Human
- [x] 產出檔名通過 `doc-classifier.js` 的 ancillary 分類（`semantic_pattern` 命中，非 fallback）——`test/skills/adr.test.js` 直接呼叫 `classifyByPath('adr-001-use-postgres.md')` 斷言 `type === 'adr'`、`confidence !== 'low'`，非文字釘選。**修正（code review P1）**：`doc-taxonomy.json` 中 `runbook`/`checklist` 的 `semantic_pattern` 未錨定且排在 `adr` 之前，標題含這兩個字（如 `adr-002-runbook-automation.md`）會被誤分類——已對真實程式碼驗證此碰撞確實發生。SKILL.md Phase 4 新增「寫入前先跑 `classifyByPath` 驗證 `type === 'adr'`」的 guard，`adr.test.js` 同時釘住兩個碰撞案例（`runbook`/`checklist`）與 guard 文件本身
- [x] `docs/skill-catalog.yml` 含 `/adr` 條目，且 README catalog 區塊已重產——`node scripts/generate-readme-catalog.js` 已重跑，README 顯示 99 public / 99 bundled
- [x] 結構測試涵蓋 happy path + 邊界（首個 ADR 檔名為 `adr-001-<title>.md`、`adr-9`/`adr-10` 碰撞、`archived/` 缺失、大小寫）+ 分類碰撞防呆——`test/skills/adr.test.js` **35/35** pass（另跑 `test/skills/skills-schema.test.js` 6/6，兩者合計 41/41，實測指令：`node --test test/skills/adr.test.js` 與 `node --test test/skills/adr.test.js test/skills/skills-schema.test.js`；先前記錄的「30/30」是把 25+6 誤記為單一檔案的數字，已更正；此行與下方 Progress 表的數字曾在多輪之間各自更新卻沒同步，round 5 code re-verify 抓到兩個舊測試本身是空測試（見下方 References）並修正後，兩處已統一改為本輪實測的 35/35、41/41）。「無 feature 目錄」一項是 SKILL.md 文字釘選（斷言 `Gate: Need Human` 字樣存在），非真正執行錯誤路徑——code review 指出原措辭誇大為「錯誤處理」覆蓋，已更正描述
- [ ] Pass /codex-review-doc
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 讀畢 `doc-taxonomy.json` 的 `adr` type、`doc-classifier.js` 分類邏輯、`feature-resolver.js`/`resolve-feature-cli.js`、既有 skill frontmatter 慣例 |
| Development | Done | `skills/adr/SKILL.md`、`skills/adr/references/template.md`、`skills/adr/scripts/next-adr-number.js`（code review P1 後新增：把編號函式從 prose 抽成真正可測的模組）、`docs/skill-catalog.yml` 註冊、README catalog 重產 |
| Testing | Done | `test/skills/adr.test.js` **35/35** pass（第五輪新增：`archived/` 雙向路徑釘選 2 條、鏈式取代與找不到舊 ADR 的 Gate: Need Human 釘選 2 條、`fp-brief`/`tech-brief` 後綴碰撞案例 1 條、重試上限釘選 1 條 + 對照組 1 條、guard 段落四型碰撞的對照組 1 條；並把兩條被 mutation 證實無效的舊測試改為只掃描 guard fenced code block 本身、外加對文件裡那段 `node -e` 指令做 `execFileSync` 端對端執行）；`test/skills/skills-schema.test.js` 6/6 pass（合計 41/41）；`generate-readme-catalog.test.js` 40/40 pass；`check-comment-blocks.js` 無新增警告；全專案 `npm test` 第五輪重跑：3721 pass / 0 fail / 6 skipped（3727 tests total），無回歸；本輪程式修正後再次重跑全專案套件確認無新回歸 |
| Acceptance | Candidate Complete | 五輪 advisory review（code：初次 + 第四輪 re-verify + 第五輪 re-verify；doc：初次 + 第二、三、四、五輪）發現的問題皆已修並各自用實際指令/mutation 測試重新驗證，全專案 `npm test` 第五輪重跑 3730 pass / 0 fail / 6 skipped（3736 tests，無回歸）。**功能面視為完成**——三張 gate AC（`/codex-review-doc`、`/codex-review-fast`、`/precommit`）仍未勾選，因為本 session Codex MCP 額度耗盡，只能用 fallback agent 做 advisory 覆核，非真正關閉 gate（`rules/auto-loop.md` § Review Dispatch）；待 Codex 恢復後補跑三個真正 gate 才算真正 Completed |

**Status**: Candidate Complete

## References

- `rules/docs-numbering.md` § Ancillary docs — ADR pattern 定義
- `scripts/config/doc-taxonomy.json` — `ancillary` namespace；`runbook`/`checklist` 的未錨定 pattern 是分類碰撞防呆存在的原因
- `skills/tech-spec/references/feature-context-resolution.md` — feature 目錄解析慣例的**canonical** 副本（原引用 `create-request` 的副本，已證實落後且缺欄位，已改指）
- **P1 修正記錄**（兩輪 advisory review，Codex 本 session 不可用，皆非真正 gate）：
  - code review ⛔ Blocked → ✅：分類碰撞（`runbook`/`checklist` 標題誤分類）、編號函式無實測覆蓋（原測試只比對 SKILL.md 文字，mutation 存活）
  - doc review ⛔ Needs revision → ✅：H1 需含 `ADR` 的理由誤述（實際上兩路徑不會同時命中）、`archived/` 慣例的引用來源造假（`rules/docs-numbering.md` 並無此描述）
- **Sub-threshold 記錄**（P2 已隨上述修正一併處理；以下 Nit 依 `rules/auto-loop.md` § Sub-Threshold Findings 記錄後不再開新一輪）：
  - `[NIT_DEFERRED] skills/adr/scripts/next-adr-number.js | padStart(3,'0') 在 max ≥ 1000 時會輸出 4 位數，未強制 3 位數上限 | reason: sub-threshold-Nit | 2026-08-07`
  - `[NIT_DEFERRED] skills/adr/scripts/next-adr-number.js:19 | 無結尾連字號的 adr-007.md（無標題段）不被掃描計入，其編號可能被重發 | reason: sub-threshold-Nit | 2026-08-07`
  - `[NIT_DEFERRED] docs/features/adr-skill/ | 本 feature 目前只有 requests/，無 2-tech-spec.md（ticket 開頭已自陳建議先跑 /tech-spec）| reason: sub-threshold-Nit | 2026-08-07`
- **第二輪 doc review**（同一批修正引入的新問題，已修）：Phase 2 主要執行指令 `$(dirname "$0" ...)` 在本環境的 shell 下必定解析錯誤導致 `MODULE_NOT_FOUND`（已刪除該片段，只留可運作的 repo-root 相對路徑寫法）；`scripts/next-adr-number.js` 在 SKILL.md 另外 4 處引用漏了 `skills/adr/` 前綴（已全部補上）；P1-1 的新措辭仍過度保證「H1 對即可在 --deep 下正確分類」，但 `classifyByHeading` 是對前 20 行任一 taxonomy signal 做子字串比對且依陣列序回傳第一個命中者，lifecycle 五型排在 adr 之前，H1 正確不是充分條件（已改寫為「best-effort，非保證」，並更正 `--deep` 是 `scanFeatureDocs` 的 `deep` 選項而非 CLI flag，且目前唯一的 production 呼叫端 `feature-resolver.js:29` 並未啟用）；本 ticket 這行本身仍留著被判定 P1 的原句且與下方修正記錄自相矛盾（已更正並加註）；測試數字誤記（見上）
- **第三輪 doc review**（新發現，已修）：
  - **[P1]** Phase 1 gate 對 `resolve-feature-cli.js` 行為的敘述是錯的——實測 `--feature <打錯的名字>` 回傳的是 `{"key":"<打錯的名字>","confidence":"high",...}`，不是空物件；`resolveFeatureContext` 在 explicit/branch/diff 三個層級只要 pattern 對就回傳 key（`confidence: high/medium`），只有目錄探測（`probe()`）失敗時 doc_inventory 是空的，key 本身從不因此變 null。也就是說「key 是 null/undefined 才 Gate」對打錯字的 feature key **永遠不會觸發**，會靜默建立一個打錯字的 feature 目錄——已改為以「`docs/features/<key>/` 是否真的存在」作為 gate 條件（`test -d`），而非只信任 `key`
  - **[P2]** `README.md:111`「89 of 98」是本次新增 `/adr` 後的舊數字，該行落在 catalog 重產 marker 之外、`generate-readme-catalog.js` 管不到，已手動更正為「90 of 99」（實測數字）
  - **[P2]** heading-path 誤分類的宣稱（前次只改成 prose）此輪補上第三個測試案例（body 含 "SOP"），並更正「五個 lifecycle 型別排在 adr 之前」為「十個」（含 `review-log`/`fp-brief`/`tech-brief`/`checklist`/`runbook`）
  - **[Nit]** 前次改寫時把「移除模板 HTML 註解」的一句插在一段 14 行密集段落尾端，已切成獨立段落
- **第四輪 code re-verify**（`strict-reviewer`，advisory；對兩個原始 P1 做 mutation 測試，均存活，總評 `✅ Ready (advisory)`；以下 5 個 P2 已修）：
  - **[P2，最高價值]** classification guard 範例只傳裸檔名，但 Phase 4 明文寫入目標是完整路徑 `docs/features/<key>/adr-<NNN>-<title>.md`；`classifyByPath` 對路徑敏感、無 `basename()` 步驟——實測 `classifyByPath('docs/features/auth/adr-001-use-postgres.md')` 回傳 `appendix`（`^adr-` 錨點被 `docs/` 前綴打斷），`classifyByPath('docs/features/deploy-runbook/adr-001-use-postgres.md')` 回傳 `runbook`（父目錄名碰撞）。已改為 guard 指令內建 `path.basename()`，讓傳入裸檔名或完整路徑結果一致，並補上兩個方向的端對端測試
  - **[P2]** guard 的重試迴圈沒有終止條件——目錄名碰撞（如 feature key 本身叫 `deploy-runbook`）無法靠改標題解決，會無限迴圈；已加上「3 次改標題失敗後升級為 Gate: Need Human」的終止條件
  - **[P2]** guard 文字只點名 `runbook`/`checklist` 兩型，但 `doc-taxonomy.json` 中排在 `adr` 之前且可被自由標題命中的實際有 4 型（另 2 個是後綴錨定的 `fp-brief`/`tech-brief`，如標題結尾恰為 `-fp-brief`/`-tech-brief`）；已補齊並各補一條碰撞測試
  - **[P2]** Phase 4b 的 `archived/` 路徑對照表與鏈式取代 Gate 完全無測試覆蓋；已補 4 條測試（雙向路徑釘選 2 條 + 兩個 Gate 各 1 條）
  - 「H1 mutation control 是否仍是 tautology」一項經此輪 mutation 測試（把 `doc-taxonomy.json` 的 `adr` 挪到 index 0 重跑，斷言確實失敗）證實不是——第二次改寫（`test/skills/adr.test.js` 的端對端 `classifyByHeading` 測試）已是有效控制，不需再修
- **第四輪 doc re-verify**（`tech-spec-reviewer`，advisory；⛔ Needs revision；以下已修）：
  - **[P1]** 第三輪修正引入的新假話：Phase 1 gate 文字寫「`resolve-feature-cli.js` 印出 `{}`」代表 key 為 null，但實測 no-match 情境印出的是完整物件 `{"key":null,"source":"none",...}`；`{}` 只在 `gitRepoRoot()` 失敗或 `main()` reject 時才會出現——已更正描述並補上真實輸出範例
  - **[P2]** 「每一層都回傳非 null key」的宣稱過廣：Level 1 對不合法 slug（如 `--feature ../evil`）直接回傳 null，不會先回傳 key；Level 3b（`skills/<key>/` 變更路徑）若 `probe()` 失敗會直接 fall through 到 Level 4/5，同樣落到 null，不是文字所稱「只有完全沒有層級命中才會 null」——已更正並把引用行號範圍從 `:59-84` 改為實際涵蓋全部層級判斷的 `:57-93`
  - Ticket 本文 AC 勾選與 Progress 表的測試數字互相矛盾（`25/25`/`31/31` vs `26/26`）——已改，但改的方向錯了（把 AC 對齊到過期的 Progress 舊值，矛盾換了數字仍在），round 5 覆核抓到後兩處才真正統一；「第 10 個案例」指稱不明，已改為「第 3 個分類碰撞案例」
- **第五輪 code re-verify + doc re-verify**（`strict-reviewer`/`tech-spec-reviewer`，advisory，並行分派）：

  **doc 面**（⛔ Needs revision → 以下 4 個 P1/P2 已修）：
  - **[P1]** 第四輪修正本身又把 AC 行（第 46 行）與 Progress 表（第 57 行）的測試數字改成互相矛盾的兩組值（`26/26`/`32/32` vs `32/32`/`38/38`）——實測 `node --test test/skills/adr.test.js`＝32、加上 `skills-schema.test.js`＝38，兩處已統一為 `32/32`/`38/38`
  - **[P1]** Phase 1 gate 新增的「Level 3b miss 必定變成 `key: null`」宣稱是錯的——實測構造 `docsBase` 只有一個 feature 目錄時，Level 3b miss 會落到 Level 4（`single_dir`），回傳該目錄名當 key、`confidence: "low"`，不是 null；此時 gate 表第一列（key 存在 + 目錄存在）會誤判通過，等於把「只是 repo 裡剛好只有一個 feature 目錄」的猜測當高信心結果放行——已改寫並在 gate 表新增一列，`confidence: "low"` 一律 Gate: Need Human
  - **[P2]** SLUG_RE 在文件中漏了 `/i`（實際是 `/^[a-z0-9][a-z0-9._-]*$/i`）——實測 `--feature ADR-SKILL` 確實通過，未依文件字面推理被拒——已補上 `/i`
  - **[P2]** Phase 1 gate 表要求用 `test -d` 檢查目錄，但本 skill 的 `allowed-tools` 只有 `Bash(node:*)`，沒有一般 `Bash`——已改為 `node -e "process.exit(require('fs').existsSync(...)...)"` 形式的等價檢查

  **code 面**（第四輪的 guard fix 本身正確、production 呼叫端 `doc-classifier.js:140-141` 已同樣做 basename，`✅ Ready` 但保護它的迴歸測試被 mutation 證實無效 → ⛔ Blocked 1 個 P1、3 個 P2 已修）：
  - **[P1]** 保護「guard 改用 `path.basename()`」這個修正的測試本身是空的——舊測試對整份檔案內容做 `content.match(/path\.basename|.../)`，被 Phase 4 說明段落中不相干的 `path.basename` 字樣滿足，實際把 guard 指令改回修正前的錯誤寫法（拿掉 `basename()`）重跑套件，`32/32` 仍全綠；已改為只抓 guard 段落的 fenced code block 本身斷言，並用 `execFileSync` 真的執行文件裡那段 `node -e` 指令對抗完整路徑＋目錄名碰撞。做完修正後我自己也對這條新測試做過同一個 mutation（把 guard 指令改回無 `basename()` 版本重跑），確認會 fail，再還原
  - **[P2]** 「四型碰撞」測試同樣是整檔 `content.includes(type)`，被無關段落的 `fp-brief`/`tech-brief` 字樣滿足；已改為只在 guard 段落本身檢查，並用 mutation 驗證（把 guard 段落的 `fp-brief`/`tech-brief` 句子拿掉重跑，確認 fail，還原後綠燈）
  - **[P2]** 3 次重試上限的舊理由（「目錄名碰撞無法靠改標題解決」）在 `path.basename()` 修正後已不成立——目錄名碰撞已被修正本身排除，理由已改寫為「使用者持續提出會碰撞的標題」；同時補上這個上限的測試覆蓋（斷言段落含「3 次/3 attempts」與 `Gate: Need Human`），過程中順手修正了一個既有的行內換行導致 `**Gate: Need Human**` 沒有連續星號的釘選問題（與本 session 先前「Numeric max, not lexical sort」斷行斷測試同一類）
  - **[Nit]** guard 段落與 References 兩處仍寫「兩型碰撞」，已更新為四型
  - 全專案 `npm test` 快照數字前兩輪各記過一次且互不相同，本輪起不再記錄——見上方 Testing 列的說明
