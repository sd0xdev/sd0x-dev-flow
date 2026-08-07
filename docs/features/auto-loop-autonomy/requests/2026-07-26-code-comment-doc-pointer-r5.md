# 程式碼註解精簡與文件指向 (R5)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking.
> **Created**: 2026-07-26
> **Status**: Candidate Complete
> **Note**: 與 R3 同源 — 都是「常駐／隨碼載入的散文過量」。但 R5 針對程式碼註解、R3 針對 context 檔，範圍不重疊，**可與 R3 並行**。本張會在 `rules/docs-writing.md` 新增指示，故須早於 R7 的全規則分類。父 tech spec 尚未建立（見 References）
> **Priority**: P2
> **Brainstorm threadId**: `019f9d77-5c89-75f1-b610-00a2262e5dc3`

## Background

實測本 repo 的 hook 註解密度（`grep -cE '^\s*#'` 對比 `wc -l`）：

| 檔案 | 行數 | 註解行 | 佔比 |
|------|------|--------|------|
| `hooks/session-init.sh` | 694 | 386 | **55%** |
| `hooks/stop-guard.sh` | 1,196 | 653 | **54%** |
| `hooks/post-tool-review-state.sh` | 2,730 | 1,294 | **47%** |
| `hooks/post-edit-format.sh` | 1,262 | 554 | 43% |

連續註解區塊分佈，範圍為 `hooks/`、`scripts/`、`skills/` **三棵樹遞迴**（與下方導出指令完全一致）：≥20 行 **55** 個、≥25 行 **32** 個、≥30 行 **15** 個、≥40 行 **10** 個。最長者為 `skills/orchestrate/scripts/prune-runs.js:3`，**86 行**。

> 範圍必須遞迴。非遞迴的 glob（`hooks/*.sh scripts/*.js scripts/lib/*.js`）只得 28/17/9/7，會漏掉 `skills/orchestrate/scripts/` 與 `scripts/skills/necessity-audit/` 底下的六個 ≥30 行區塊，其中包含最長的那個。

**次長的那塊是重複，不是缺文件。** `hooks/post-tool-review-state.sh:443` 的 69 行內容包含一張 sidecar marker 的 ownership 表（哪個 plane 擁有哪個 marker、由誰清除），而 `docs/features/auto-loop-evolution/4-implementation.md` **§3.6「Markers are keyed by plane」已經有同一張表**；該區塊另涉及集合累積、序列化與 sidecar lock，分別對應同文件的 §3.1 與 §3.7。`rules/auto-loop.md` 早已指向該文件的 §1/§3。同樣的論證因此存在於三處：規則指標、文件正文、程式碼註解——這是本張的核心證據，但它是**重複型**；`skills/` 底下的區塊多為**獨有型**，須搬移而非刪除。

註解本身品質不差——它們是真正的架構論證而非贅述。問題在於**位置**：這類內容每次讀該檔就全額載入，卻只在少數修改時才需要，且與文件版本各自漂移。

**尚無任何規則規範程式碼註解長度**（`rules/` 全文檢索，僅 `auto-loop.md:24` 的 tier 表與 `auto-loop-project.md` 的 HTML 註解語法提及 comment，皆非本主題）。

## Requirements

- 建立註解政策：註解回答**此處的 what/why**；延伸論證、歷史考古、跨檔協定改放文件並以指標引用
- 定義可機械檢查的門檻與指標格式，避免政策淪為主觀判斷
- 遷移實測 ≥30 行的 **15** 個區塊；20–29 行者（55 − 15 = 40 個）於日後修改該處時順手處理，不在本張強制
- 遷移必須是**搬移或刪除重複**，不得只是刪掉論證——資訊不得淨損失
- 目的地文件須同時滿足 `@rules/docs-numbering.md` 的 500 行上限（見 Design Decision）

## Scope

| Scope | Description |
| ----- | ----------- |
| In | 註解政策規則；門檻與指標格式定義；≥30 行區塊（**15** 個，遞迴涵蓋 `hooks/`、`scripts/`、`skills/` 三棵樹）的遷移；重複內容的刪除；門檻檢查腳本與測試（須涵蓋巢狀路徑） |
| Out | 20–29 行區塊的強制遷移（55 − 15 = 40 個，隨後續修改處理）；`rules/` 散文縮減（R3）；註解語意分類（辯論已淘汰，見 R3）；第三方或 vendored 檔案 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `rules/docs-writing.md` | Modify | 新增「程式碼註解」小節，定義門檻與指標格式（置此而非新檔，避免再多一個 `@` 載入項） |
| `hooks/post-tool-review-state.sh` | Modify | `:443`(69)、`:1797`(56)、`:1110`(46)、`:643`(41)、`:2681`(31) — 5 個；`:443` 與 §3.1/§3.6/§3.7 重複，改為多節指標 |
| `skills/orchestrate/scripts/prune-runs.js` | Modify | `:3`(**86** — 全庫最長) |
| `skills/orchestrate/scripts/validate-plan.js` | Modify | `:3`(54) |
| `skills/orchestrate/scripts/run-verify.js` | Modify | `:3`(41)、`:453`(34) — 2 個 |
| `scripts/skills/necessity-audit/cleanup.js` | Modify | `:5`(39)、`:336`(37) — 2 個 |
| `hooks/stop-guard.sh` | Modify | `:401`(43)、`:446`(30) — 2 個 |
| `hooks/session-init.sh` | Modify | `:322`(41) |
| `hooks/post-edit-format.sh` | Modify | `:413`(41) |
| `docs/features/auto-loop-evolution/4-implementation.md` | Modify | 遷移目的地；現 253 行，須依 Design Decision 處理擴張 |
| `scripts/check-comment-blocks.js` | New | 門檻檢查，可獨立執行亦可納入 precommit |
| `test/scripts/check-comment-blocks.test.js` | New | 門檻判定、指標格式驗證、豁免清單 |

**現況導出指令**（施作起點）：

```bash
# 列出所有 >= N 行的連續註解區塊。範圍必須用 find 遞迴，
# 非遞迴 glob 會漏掉 skills/*/scripts/ 與 scripts/skills/**/ 底下的區塊。
for f in $(find hooks scripts skills -type f \( -name '*.sh' -o -name '*.js' \) | sort); do
  awk -v F="$f" -v T=30 '
    /^[[:space:]]*(#|\/\/|\*)/ { if(!s) s=NR; n++; next }
    { if(n>=T) printf "%s:%s|%s\n", F, s, n; s=0; n=0 }
    END { if(n>=T) printf "%s:%s|%s\n", F, s, n }
  ' "$f"
done | sort -t'|' -k2 -rn
```

以此指令於 2026-07-26 導出的 ≥30 行完整清單（**15 個**，即本張的遷移對象）：

| # | 位置 | 行數 | # | 位置 | 行數 |
|---|------|------|---|------|------|
| 1 | `skills/orchestrate/scripts/prune-runs.js:3` | 86 | 9 | `hooks/post-tool-review-state.sh:643` | 41 |
| 2 | `hooks/post-tool-review-state.sh:443` | 69 | 10 | `hooks/post-edit-format.sh:413` | 41 |
| 3 | `hooks/post-tool-review-state.sh:1797` | 56 | 11 | `scripts/skills/necessity-audit/cleanup.js:5` | 39 |
| 4 | `skills/orchestrate/scripts/validate-plan.js:3` | 54 | 12 | `scripts/skills/necessity-audit/cleanup.js:336` | 37 |
| 5 | `hooks/post-tool-review-state.sh:1110` | 46 | 13 | `skills/orchestrate/scripts/run-verify.js:453` | 34 |
| 6 | `hooks/stop-guard.sh:401` | 43 | 14 | `hooks/post-tool-review-state.sh:2681` | 31 |
| 7 | `skills/orchestrate/scripts/run-verify.js:3` | 41 | 15 | `hooks/stop-guard.sh:446` | 30 |
| 8 | `hooks/session-init.sh:322` | 41 | | | |

## Acceptance Criteria

- [x] `rules/docs-writing.md` 新增註解政策，含**數值門檻**與指標格式範例，非僅原則性敘述 — § Code Comments：≥30 blocking、25–29 warning、指標格式含節號範例、move-or-dedupe、豁免清單
- [x] 導出指令（三棵樹遞迴版）重跑後，≥30 行的連續註解區塊數為 **0**（現況 **15**），且該指令與本張列出的清單同源 — awk 導出重跑輸出為空；更嚴格的 `check-comment-blocks.js`（stateful `/* */` 計數）亦 0 BLOCK、exit 0，並因此多抓到 awk 漏掉的 prune-runs.js 相鄰 49 行 JSDoc（已一併遷移至 workflow-orchestration `4-implementation.md` §1.1）
- [x] 每個被移除的區塊，其論證皆可在文件中找到對應段落；抽查 3 處以 `grep` 佐證資訊未淨損失 — Codex AC-trace 獨立抽查 3 處（sidecar §3.1/§3.6/§3.7、prune containment/TOCTOU、cleanup capability token）皆命中
- [x] `post-tool-review-state.sh:443` 改為指標，且涵蓋 `4-implementation.md` **§3.1、§3.6、§3.7** 三節（該區塊跨越集合累積、plane 歸屬與 sidecar lock 三個主題），指標含節號而非僅檔名 — 指標明列三節號。**不記行號**：本 request 之後的每一輪修改都會把它推移（`:443` → `:669` → 現值），寫死的行號是這份文件反覆漂移的來源。以 `grep -n '§3.1, §3.6, §3.7' hooks/post-tool-review-state.sh` 定位
- [x] 目的地文件皆 ≤ 500 行（`wc -l` 為證）；若觸及上限則依 `@rules/docs-numbering.md` 拆為編號子資料夾，且主檔保留 canonical 檔名 — **2026-07-26 當日量測**：auto-loop-evolution 295、workflow-orchestration 82（新檔）、necessity-audit 23（新檔）、docs-writing 56（doc review 收斂豁免文字後）。這些檔案之後仍持續增修，數字必然漂移；AC 約束的是「≤ 500」這個性質，不是快照值。重新量測：`wc -l docs/features/*/4-implementation.md rules/docs-writing.md`（2026-08-04 重量：auto-loop-autonomy 352、auto-loop-evolution 295、workflow-orchestration 96、necessity-audit 41、docs-writing 64——全數仍 ≤ 500）
- [x] `check-comment-blocks.js` 可回報違規位置與行數，並支援豁免清單（授權標頭、`shellcheck`/`eslint` directive 等）— `BLOCK/WARN file:line — N comment lines in one logical block` 格式（2026-08-04 修訂：原為 contiguous，改為 logical block — 空行橋接，見下方 Amendment）；SPDX/Copyright/eslint-disable/shellcheck-disable 首行豁免 + vendored 目錄名任意深度豁免；`--json`、無效 `--root` fail-closed exit 2
- [x] 既有行為零變更：`test/hooks/*.test.js` 與 `skills/orchestrate` 相關測試全綠，且**被遷移的那 15 個區塊所在的既有檔案**在 diff 中無非註解行異動（本條僅約束受遷移檔；新增的 `check-comment-blocks.js`、其測試與 `rules/docs-writing.md` 的政策段落當然含非註解行，不在此條範圍內）— hook suite 812/810 pass 0 fail；orchestrate 20/20；8 個遷移檔 hunk 級過濾非註解 diff 行 = 0（`post-edit-format.sh` 的非註解 hunk 屬 R4 交付物，經 Codex 以 R4 ticket Related Files 佐證排除）
- [x] Pass /codex-review-fast — 4 P1（hook 執行位遺失、`/* */` stateful 計數、無效 --root fail-open、豁免錨定層級）修復後 ✅ Ready
- [x] Pass /precommit — ✅ PASS（**2026-07-26 該次 run** 2951 tests / 2945 pass / 0 fail）。收據記錄的是打勾當下的樹，不描述現況；本 request 之後的變更已使全套成長至 3552 tests / 3546 pass / 0 fail（2026-08-04）

## Design Decision

| Decision | Choice | Alternative | Rationale |
|----------|--------|------------|-----------|
| 門檻值 | 30 行（本張強制），25 行列為警告 | 一律 15 行 | 15 個區塊是可完成的範圍；55 個（≥20）會讓本張變成無底洞 |
| 範圍界定 | `find` 遞迴三棵樹 | 非遞迴 glob | 非遞迴只得 9 個，會漏掉含最長區塊在內的 6 個，且讓 AC 在未完成時誤判為達成 |
| 政策落點 | 併入 `rules/docs-writing.md` | 新增 `rules/code-comments.md` | 新檔等於再多一個常駐 `@` 載入項，與本張目的相悖 |
| 目的地擴張 | 遷移前先評估目的地是否需拆資料夾，且 `skills/` 區塊不一定歸 `4-implementation.md` | 全部追加至單一文件 | 15 個區塊合計約 **689** 行原始內容，即使壓縮也遠超 `4-implementation.md`（現 253 行）到 500 行上限的餘裕 |
| 資訊處理 | 重複者刪除、獨有者搬移 | 一律搬移 | `:443` 與 §3.1/§3.6/§3.7 已重複，搬移只會製造第四份；但 `skills/` 的區塊多為獨有，必須搬移 |
| 檢查時機 | 獨立腳本，precommit 可選接 | 直接硬性納入 precommit | 先證明誤判率可接受，再談強制 |

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 註解密度、區塊分佈、`:443` 與 §3.6 重複性皆經實測 |
| Development | Done | 15 區塊全數遷移（9 shell + 6 JS）+ checker 落地；awk 漏抓的相鄰 JSDoc 49 行區塊由 checker 發現後補遷 |
| Testing | Done | 全套 2951/2945 pass；hook suite 812/810；checker + executability 23/23；hook 執行位迴歸測試新增 |
| Acceptance | Done | Codex AC-trace ✅ Adequate（AC7 以 hunk 級 provenance 排除 R4 共檔異動後重驗通過） |

**Status**: Pending / In Progress / Candidate Complete / Completed

## References

- 同源主題（context 檔散文縮減）: [Auto-Loop 散文縮減 (R3)](./2026-07-26-auto-loop-prose-reduction-r3.md)
- 遷移目的地: [Auto-Loop Evolution 實作紀錄](../../auto-loop-evolution/4-implementation.md)
- 文件尺寸與拆分規範: `@rules/docs-numbering.md` § Size Limit

## Amendment (2026-08-04)

三處與交付結果不符，已修正：

| 項目 | 原始行為 | 現在 |
|------|---------|------|
| 計數單位 | contiguous run — 一個空行就切斷區塊 | **logical block** — 空行橋接，只有非註解非空行才結束區塊。原本的規則等於「每 29 行插一個空行」即可規避，改變的是形狀不是量 |
| 註解語法判定 | 單一 regex，`#`/`//`/`/*`/`*` 一律視為註解 | 依副檔名分派：`.sh` 只認 `#`。原本 shell 的 `case "$1" in /*)` 會被當成 C 區塊註解開頭 |
| 執行時機 | 僅手動執行，未接 precommit | `/precommit` 的 `comment_blocks` step；**唯有 repo 自己 check in 了 `scripts/check-comment-blocks.js` 才執行**，否則 skip 而非 fail。`/install-scripts` 安裝到 `.claude/scripts/` 的副本刻意不算數——checker 掃的是 repo 自己的 `hooks/ scripts/ skills/`，認它等於拿本 plugin 的規約去審消費端專案的程式碼 |
