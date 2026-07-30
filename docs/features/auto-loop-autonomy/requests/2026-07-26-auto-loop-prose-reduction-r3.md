# Auto-Loop 散文縮減與常駐 Context 瘦身 (R3)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 本張是「給模型更多自由度」的主要來源。必須在 R2 之後執行 — 訊號機制未就位前刪散文會拿掉 warn 模式下唯一的執行力。父 tech spec 尚未建立（見 References）
> **Priority**: P1
> **Depends On**: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`
> **Equilibrium**: Nash Equilibrium (3 rounds, Claude vs Codex)

## Background

每次 session 開頭載入 `CLAUDE.md`(201) + `.claude/CLAUDE.md`(189) + `rules/*.md`(710) = **1,100 行**，其中大量是命令編排與重複強調。（撰票時 rules 快照為 688 行；R1/R2 落地後、R3 施作前以 `git show HEAD:` 實測為 710，AC9 的「改造前」基線以施作前實測 1,100 為準。）

三個實測發現：

1. **執行期載入到互相矛盾的指示，但源頭不是 tracked 檔**。`.claude/CLAUDE.md` 寫必跑 gate 為 `/precommit-fast`、測試指令為 `node --test test/**/*.test.js`；而 tracked 的 `CLAUDE.md:160` 明文警告 npm scripts 走 `/bin/sh`、`**` 不展開巢狀目錄，不可用該寫法。**實測確認 tracked 的 `CLAUDE.md` 與 `CLAUDE.template.md:7` 兩者一致**（皆為 `/precommit`；template 的測試指令是 `{TEST_COMMAND}` placeholder）——矛盾完全來自 `.claude/CLAUDE.md` 是由**舊版 template 渲染後未跟上更新**的過期生成物。`.claude/` 整個目錄被 `.gitignore:11` 忽略，是本 plugin 對自己 dogfood 的開發安裝（`skills/project-setup/SKILL.md:127-137` 生成），刻意不納入版控。

   因此本張的交付物只有 tracked 檔。**生成物 drift 目前無任何已出貨的偵測機制**——`/claude-health` 的 sync module 只管 rules / hooks / scripts（`skills/claude-health/SKILL.md:151`），對 CLAUDE 生成物僅檢查 `auto-loop-project.md` 引用是否存在（`:190`）；`upgrade-doctor` 只有 spec、無 skill 實作，其 `2-tech-spec.md:62` 講的是更新 `/claude-health` 的描述文字而非 drift 偵測。本張的收斂手段因此是**重新生成後人工驗證**：`/project-setup` Phase 3 由 template 重寫，Phase 4 確認無殘留 placeholder（`skills/project-setup/SKILL.md:127-137`、`:42`）。自動 drift 偵測不在本張範圍。

2. **90+ 列指令表被複製多份**（約 110 行 × 2 載入），而釘死它的測試遠多於初估。實測：**17 個測試檔直接讀 `CLAUDE.md`，其中 14 個帶有指令註冊斷言**——`claude-md-coverage.test.js`（結構性：抽取 `## Command Quick Reference` 區塊，要求每個 skill 皆列於表中，`INTERNAL_SKILLS` 除外）、`test-deep:64`、`fp-brief:115`、`deep-research:62`、`deep-explore:60`、`test-health:74`、`remind:44`、`recap-doc:425`、`orchestrate:352`、`ask:163`、`pre-pr-audit:72`、`tech-brief:94`、`recap-ask:369`、`post-dev-recap:350`。其中 `orchestrate` / `recap-ask` / `post-dev-recap` 三者連 `.claude/CLAUDE.md` 與 `CLAUDE.template.md` 一併斷言（`tech-brief:95` 只讀 root `CLAUDE.md`）。其餘 3 個（`context-management-rule`、`testing-rules`、`create-pr-sanitization`）斷言的是其他章節，不受影響。

   多數指令在 `CLAUDE.md` 中**只出現於表格內**（抽驗 11 個指令，10 個表格外出現次數為 0）。這 14 個測試皆與「表格式註冊」耦合，但移除表格後的實際結果分兩種：**12 個會直接失敗**；`recap-ask:390-392`（`if (rows.length === 0) ... return;`）與 `post-dev-recap:369-371`（`present === 0 || present === rows.length`）刻意容忍「全數缺席」的 pre-T5 狀態，故不會失敗——但仍須遷移，否則契約會靜默失去意義。清單須於施作時由下方導出指令重新產生，不得沿用本張的手寫列舉。skill 的 frontmatter `description` 本來就是 dispatcher 的發現介面。
3. **`comments-only 可跳過所有 gate` 是不實承諾**。`CLAUDE.md:9` 與 `hooks/stop-check.md:21` 都這樣寫，但 hooks/scripts 中**零實作**；且辯論證明註解本來就不保證語意惰性——本 repo 自己的 `scripts/lib/utils.js:142` 與 `skills/git-profile/scripts/git-profile.sh:60` 就有會改變檢查結果的 directive 註解。

## Requirements

- `rules/auto-loop.md` 從命令編排改為**一條終端完成不變式**
- 移除「same reply」祈使、Auto-Trigger 逐條命令表、Correct Behavior 劇本
- 保留：獨立審查要求、驗證要求、round cap、人工升級出口、安全/資料完整性強制升級
- configured tier 降為**基準線**，有效 tier 由模型依變更語意選擇
- 維持 tracked `CLAUDE.md` 與 `CLAUDE.template.md` 的一致性（改造前已一致，改造後不得破壞）：gate 政策同步、`{TEST_COMMAND}` 維持 placeholder 形式；`.claude/CLAUDE.md` 的矛盾以「由更新後的 template 重新生成」收斂，不當作被提交的修改
- 移除 90+ 列指令表，並將**所有**表格支撐的註冊斷言遷移到 catalog/frontmatter 契約；清單由指令導出，不採手寫列舉
- 新增迴歸檢查，阻擋日後再新增「直接對 Quick Reference 表格斷言」的測試
- 更正 comments-only 不實承諾，改為誠實敘述

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `rules/auto-loop.md` 重寫；tracked CLAUDE 檔去重與一致性維持；指令表移除；全部表格支撐的註冊測試遷移 + 迴歸守門；comments-only 承諾更正；`.claude/CLAUDE.md` 重新生成後的人工收斂驗證 |
| Out | hook 行為變更（R2 已處理）；tier 寫入 hook（維持行為層）；`rules/` 其他檔案的縮減（另評估）；skill frontmatter 格式變更；**生成物 drift 的自動偵測**（今日無任何 skill 涵蓋，需另立需求單） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `rules/auto-loop.md` | Modify | 183 行 → 終端不變式為核心；考古移至 `4-implementation.md` |
| `CLAUDE.md` | Modify | 移除指令表；更正 comments-only；保留 Footguns 等非顯而易見知識 |
| `CLAUDE.template.md` | Modify | 同步移除指令表；**維持**與 `CLAUDE.md` 既有的 gate 政策一致（皆為 `/precommit`），且測試指令維持 `{TEST_COMMAND}` placeholder 不得寫死 |
| `.claude/CLAUDE.md` | Regenerate | **不提交**（`.gitignore:11` 忽略）。由更新後的 template 經 `/project-setup` 重新生成，驗證渲染輸出而非原始 template 收斂到本 repo 的 `find` 形式測試指令 |
| `hooks/stop-check.md` | Modify | `:21` comments-only 列更正 |
| `test/skills/claude-md-coverage.test.js` | Modify | 結構性斷言改為 catalog/frontmatter 一致性；**保留** `:127-257` 的 terminal-gate routing 斷言；新增迴歸守門，禁止新測試直接對 Quick Reference 表格斷言 |
| `test/skills/*.test.js`（13 個） | Modify | `test-deep:64`、`fp-brief:115`、`deep-research:62`、`deep-explore:60`、`test-health:74`、`remind:44`、`recap-doc:425`、`orchestrate:352`、`ask:163`、`pre-pr-audit:72`、`tech-brief:94`、`recap-ask:369`、`post-dev-recap:350` — 逐一遷移至 catalog 契約。**施作時須以下列指令重新導出清單並以導出結果為準**，本列僅為本張撰寫時的快照 |
| `docs/skill-catalog.yml` | Reference | 遷移後的 catalog 真實來源；設計決定：alias / internal 分類**刻意留在 catalog 之外**（`public:` 欄位管 README 曝光；internal / alias 身分由測試層常數持有），理由見 Implementation Notes 首條 |

**清單導出指令**（施作起點，取代手寫列舉）：

```bash
# 母體：真正「讀取」CLAUDE.md 的測試檔（17）
grep -rln "CLAUDE\.md'" test/

# 遷移對象（14）= 母體 − 明列的非註冊消費者 allowlist(3)
comm -23 \
  <(grep -rln "CLAUDE\.md'" test/ | sort) \
  <(printf '%s\n' \
      test/skills/context-management-rule.test.js \
      test/skills/create-pr-sanitization.test.js \
      test/skills/testing-rules.test.js | sort)
```

**為何用 allowlist 相減，而非正面比對片語**：片語法（`Quick Reference` / `command reference`）實測只回傳 10 個檔 — 誤收 `test/skills/runbook.test.js`（`:69` 的字串是 `'SRE Quick Reference'`，與 CLAUDE 目錄無關），並漏掉 `ask` / `pre-pr-audit` / `tech-brief` / `recap-ask` / `post-dev-recap` 五個真實消費者（這五者對該三個片語的命中數皆為 0，它們用的是裸指令 regex 如 `/\/tech-brief/` 或表格列 regex 如 `` /\|\s*`\/recap-ask`[^\n]+\|/ ``）。若把片語法當權威，會複製出本張 AC 正要防止的不完整遷移。

allowlist 中的 3 個檔須有測試釘住其「非註冊消費者」身分，任何新增的 CLAUDE 讀取者因此被迫做出分類決定，而非默默漏掉。

> 母體 pattern 刻意錨定引號結尾。放寬為 `grep -rlE "CLAUDE\.md"` 會多出 `test/hooks/stop-guard.test.js`（18），但該檔僅於 `:646` 註解提及、並未讀取此檔，其餘命中為 `CLAUDE_PROJECT_DIR` 環境變數。導出後須確認每個命中確實有 `readFileSync`。

## Acceptance Criteria

- [x] `rules/auto-loop.md` 以單一終端完成不變式取代命令編排，且不含「same reply」祈使（正向釘樁 + 負向釘樁：`review-dispatch.test.js` 斷言 `Terminal completion invariant` 存在且 `same reply` 零命中）
- [x] 保留項全數存活：獨立審查、驗證、round cap、人工升級、安全/資料完整性強制升級（`review-dispatch.test.js` 逐項釘樁，含 `max_rounds → Need Human` 與三個無條件人工出口）
- [x] `CLAUDE.md` 與 `CLAUDE.template.md` 的必跑 gate 敘述維持一致（皆為 `/precommit`），且 template 的測試指令仍為 `{TEST_COMMAND}` placeholder（未被寫死）——placeholder 釘樁錨定 Development Rules 行本體（`/^2\. \*\*Test command\*\* -- ...$/m`），經 Codex mutation 驗證非空洞
- [x] 經 `/project-setup` 由 template 渲染出的 `.claude/CLAUDE.md`（非原始 template）解析為本 repo 的 `find` 形式測試指令，`**` glob 寫法零殘留——指令本體為 find 形式；唯一 `**` 命中位於警語內作為被禁用反例引述（「勿用 `test/**/*.test.js`」），非可執行指令
- [x] tracked CLAUDE 檔移除 90+ 列指令表；**以導出指令重新產生的清單中，零個測試仍直接對 Quick Reference 表格斷言**，全部遷移至 catalog 契約且測試全綠，且 `claude-md-coverage.test.js:127-257` 的 terminal-gate routing 斷言仍存活（行號已因改寫位移，斷言本體逐字保留且全綠）
- [x] 新增迴歸檢查，涵蓋三種寫法而非只有標題字串：(a) 對 `## Command Quick Reference` 區塊斷言、(b) 裸指令 regex（如 `/\/ask/`）、(c) 表格列 regex（如 `` /\|\s*`\/recap-ask`[^\n]+\|/ ``）；並釘住 allowlist 的 3 個非註冊消費者身分，使新增的 CLAUDE 讀取者必須明確分類——(a) 全域掃描；(b)(c) 於讀取者 choke point 攔截（`READER_PATTERN` 涵蓋三種引號寫法，經 mutation fixtures 驗證），已知界限：既有 allowlist 成員若日後自行新增 (b)(c) 型斷言不會被自動偵測，見 Implementation Notes
- [x] 表格移除後跑完整測試套件作為行為層後盾（`recap-ask` / `post-dev-recap` 容忍全數缺席，靜態檢查不足以證明遷移完成）——`npm test`（可寫入之本機環境；skip 數依環境而異）：2906 tests / 2900 pass / 0 fail / 6 skipped，precommit log：`.claude/cache/precommit/sd0x-dev-flow--3ec2abf1/b984ff3/test_unit.log`
- [x] comments-only 敘述更正為「code 檔的註解仍保守歸類為 code」，`CLAUDE.md` 與 `hooks/stop-check.md` 同步（`review-dispatch.test.js` 雙檔釘樁 + 結構性拒斥歷史列 `| Comments only |`）
- [x] 常駐 context 總行數較改造前下降 ≥ 40%（以 `wc -l` 實測前後對比為證）——改造前 `git show HEAD:` 實測 201+189+710 = 1,100；改造後 658；降幅 **40.18%**
- [x] 所有 hook 解析的 sentinel 詞彙與 `[NIT_DEFERRED]` 欄位順序**未被更動**（hook 測試全綠；hook parser shell scripts 零變更，僅 `hooks/stop-check.md` 說明文件修改）
- [x] Pass /codex-review-doc（✅ Mergeable，3 輪：2 輪各 4/2 個 🔴 全數修復——含不變式 per-plane 措辭、stop-check sentinel 表、claude-health check 2 重對映、safe-remove catalog 驗證）
- [x] Pass /precommit（`## Overall: ✅ PASS`，2026-07-29 重跑於最後一次 code 編輯之後）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| tier 歸屬 | 維持行為層，hook 只揭露不裁決 | 寫進 hook 強制 | hook 裁決 = 降低自由度；hook 揭露 = 提高有效自由度 |
| comments-only | 更正承諾為保守歸類 | 實作語意分類器 | 註解可攜帶 compiler/lint/build directive，跨語言證明語意惰性是獨立的 feature |
| 指令表 | 刪除，靠 skill description 發現 | 保留但精簡 | frontmatter description 已是 dispatcher 介面，表格是重複 |
| 保留哪些散文 | 非顯而易見的專案知識（Footguns、sentinel 契約、Codex 反模式表） | 全面精簡 | 這些是模型看檔案系統推不出來的，屬「編碼你的品味」 |

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | Codex 辯論 R3 建議 P1+P5；矛盾與測試釘樁經 Claude 實測驗證 |
| Development | Done | auto-loop.md 183→46 行；CLAUDE.md 201→60；template 355→254；14 測試檔遷移至 catalog 契約；`.claude/CLAUDE.md` 重新生成（60 行、find 形式）；行數以最終 `wc -l` 為準 |
| Testing | Done | `/codex-review-fast` 5 輪（3 P1 + 3 釘樁空洞 P1 修復，皆經 Codex mutation 驗證）→ ✅ Ready；`/precommit` ✅ PASS（2906/2900/0 fail） |
| Acceptance | Done | `/codex-test-review --ac-trace`：advisory 模式，7 個覆蓋缺口中 4 個以新釘樁關閉、AC4/AC9 為證據澄清（見 AC 註記）、AC6 界限記錄於 Implementation Notes |

**Status**: Pending / In Progress / Candidate Complete / Completed

## Implementation Notes

- **catalog 分類欄位**：未新增 `internal:` / `alias:` 欄位——這是明確的設計決定，非既有欄位「等價滿足」。`generate-readme-catalog.js` 只以 `s.public !== false` 過濾——單純新增 `internal:` / `alias:` 欄位本身不會改變 README 計數，但要讓分類「生效」勢必連動 `public` 值或 generator 過濾邏輯，屆時六語系 README 產出數字才會改變；為避免這條連鎖，分類留在測試層。現況分工：`public:` 欄位管 README 曝光；local-only 身分由測試內 `LOCAL_ONLY_SKILLS` 集合（`readme-i18n-sync`、`update-readme`）持有；alias 身分由測試層常數（如 `ALIAS_MAP`）持有，皆在 catalog 之外。若日後需 catalog 內建分類，另立需求單。
- **迴歸守門界限（AC6）**：(b) 裸指令 regex 與 (c) 表格列 regex 的攔截點是「讀取者集合」——任何讀 CLAUDE 檔的測試必須列入 `ALLOWED_CLAUDE_READERS` 並附理由，未列入即紅。已知界限：allowlist 既有成員日後自行新增 (b)(c) 型斷言不會被自動偵測（需靠 review 把關）；`READER_PATTERN` 為刻意保守——任何帶引號的 `CLAUDE*.md` 引用皆計為讀取者（含引號散文），僅無引號提及放行。
- **連帶消費者修復**（首輪 review 發現）：`/remind` 的章節對映（The Four Anchors / Auto-Trigger → 終端不變式 / Gate sequence）與 `/sharingan` 產出模板的註冊指引（CLAUDE 表格 → `docs/skill-catalog.yml`）同步遷移，各附 liveness 釘樁測試。
- **doc 審查遞延（🟡，sub-threshold）**：`/claude-health` S2.5 check 2 新演算法（同節指令比對）尚無 `test/skills/claude-health.test.js` fixture 覆蓋（verbatim 複製不觸發 / 移除 `/precommit` 觸發 / 無重述章節 vacuous pass）——待該 skill 下次實作變更時補釘。
- **審查者記錄之 NIT_DEFERRED（P2，sub-threshold-standard）**：catalog description 斷言可被 YAML null/block scalar 空洞化（`claude-md-coverage.test.js:81`）；READER_PATTERN 保守性把引號散文計為讀取者（`:122`，註解已如實描述）。待 `/codex-review-branch` 深度審查時收斂。

## References

- 前置: [Hook 事實訊號標準化 (R2)](./2026-07-26-factual-hook-signals-r2.md)
- 考古去處: [Auto-Loop Evolution 實作紀錄](../../auto-loop-evolution/4-implementation.md)
- 生成物來源與重新生成流程: `skills/project-setup/SKILL.md` Phase 3–4
- 未涵蓋事項（生成物 drift 自動偵測，尚無 skill 實作）: [Upgrade Doctor](../../upgrade-doctor/2-tech-spec.md) — 僅 spec，且其 `:62` 談的是 `/claude-health` 描述文字更新，非 drift 偵測
- 相關: [Agent Prompt Optimization](../../agent-prompt-optimization/)
