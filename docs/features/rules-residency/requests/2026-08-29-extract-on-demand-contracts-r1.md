# 抽出 review 平面的隨用載入契約（movement r1）

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-29
> **Status**: Candidate Complete
> **Priority**: P1
> **Tech Spec**: [rules-residency tech spec](../2-tech-spec.md)

## Background

規則層每 session 常駐 1,106 行 / 97,826 bytes（≈24–28K tokens），其中大部分是**只在特定情境才需要**的程序細節：scope 欄位正規化、斷路器計數、stall/cap 診斷、測試金字塔與 AC 證據規則、文件切分機制。IFScale（arXiv 2507.11538）量到前沿模型從約 10–15 條同時指令開始退化，context-rot 研究量到近重複陳述本身就是 distractor——而本 repo 的高優先概念被重述 3–4 次。

Tech spec § 5 把落地切成四張票，本票是第一張的**前半**：rows 1–2 的 **review 平面**。它只搬程序細節、不改任何政策，也不碰三處 byte-pinned 的 Anchor Register #4 文字。

**為何再切一刀**：rows 1–2 原本一票涵蓋四個契約領域（scope、loop、testing、docs），但消費者廣度差距懸殊——scope 只有 4 個檔案引用，`docs-numbering`/`docs-writing` 有約 18 個。四個領域同時搬移正是 tech spec § 4 列為風險的 ATTENTION_DIFFUSION 形狀，而 `/create-request` § Phase 1.5 的 scope breadth（3+ 獨立領域）本來就是拆票訊號。故本票只做 review 平面（scope + loop diagnostics），測試與文件契約留給 r2。

## Requirements

- 依 tech spec § 3.4 目的地表，把程序細節**搬移**（move，非 copy）到各 skill 的 `references/`：review 平面的 scope 契約與 loop 診斷、測試契約、文件機制
- 每個被搬空的 `rules/*.md` 留下**緊湊常駐守則 + 指標**，不留重複散文——split-brain 契約是 tech spec § 4 明列的風險
- 補 routing 測試（tech spec § 6 機械類）：每個 review skill 載入 scope + loop 契約，doc/test skill 載入各自契約
- **不得**觸及三處 byte-pinned 區域：`rules/git-workflow.md` 的 `anchor:register-4` 區塊與 Push safety 行、`rules/discretion.md` § Efficacy Boundary。推送授權契約的搬移屬 task 3，需人工核准

## Scope

| Scope | Description |
| ----- | ----------- |
| In | `rules/scope-discipline.md` 與 `rules/auto-loop.md`（§ Stall Detection、§ Cap Diagnostic Protocol）的程序細節搬移；`skills/codex-code-review/references/` 兩個新契約檔；跨檔 `§` 指標修正；routing 測試與其負控制 |
| Out | **測試契約與文件契約**（r2——見上方拆票理由）；**推送授權契約搬移**（Anchor 級，需核准——tech spec 開放問題 1）；`framework.md` 刪除與 `fix-all-issues.md` 合併（task 3）；常駐核心改寫與觸發表（task 3）；雙預算測試（task 4）；hook `procedure_hint`（task 5）；canary（task 8） |

## Acceptance Criteria

- [x] `skills/codex-code-review/references/scope-contract.md` 承載 baseline 計算、scope 欄位正規化、gate derivation（routing matrix 仍在 review skill § Step 4.5）、斷路器、處置記錄、closed-set options、E1/E2；`rules/scope-discipline.md` 縮為常駐守則 + 指標
- [x] `skills/codex-code-review/references/loop-diagnostics.md` 承載 stall detection、stall memory、cap diagnostic protocol 與 `/refactor` 五項約束；`rules/auto-loop.md` 對應段落縮為 `## Stall Detection and Diagnosis` 常駐語意 + 指標
- [x] **Move 不是 copy**：`test/rules/scope-discipline.test.js` 以 `Gate Derivation`、`Circuit Breaker`、`scope_reason`、`monotonic precise union` 四個字串斷言它們**只**存在於契約端
- [x] 常駐守則保留 ad-hoc session 在載入任何東西前就需要的語意（凍結、one-hop、fail-closed、完整反證、sweep ban、E1、Register #6），並具名指向契約檔
- [x] Routing 測試 `test/rules/contract-routing.test.js` 涵蓋兩個方向（dangling path/`§` heading、契約無人啟用），掃描集為 tracked ∪ untracked-unignored ∪ **current-authority** `docs/`（record 由 `owesCodeAlignment()` 機械排除），每一項檢查都以突變驗證過會轉紅（驗證的突變類別：scanner 各分支、boundary、heading 過濾與 base、REF 兩個 alternative 與 lookbehind、RECORD_LINE 雙向、掃描集各來源類別、以及「清單縮減 + 利用其所守內容」的複合突變；孤立刪除頂層斷言不列入——任何測試皆然）
- [x] **守衛隨內容移動**：`REVIEW_POLICY_CARRIERS`（review-grant 掃描）與 `DUPLICATED_STALL_POLICY`（跨兩份 carrier 的重複陳述）以清單驅動，任一 carrier 的政策文字遭改動即轉紅；`loop-diagnostics.md` 三條引用 Anchor Register 的陳述另行釘定
- [x] 三處 byte-pinned Anchor 區域逐位元不變：`rules/git-workflow.md` 與 `rules/discretion.md` 相對 HEAD **整檔未動**；`test/rules/discretion-tiers.test.js` 通過
- [x] 跨檔連結無失效：連結檢查 0 failures——**指令要帶檔案清單**（無參數時 `checked: 0`，等於什麼都沒驗）：
  `{ git diff --name-only HEAD | grep '\.md$'; git ls-files --others --exclude-standard '*.md'; } | xargs node scripts/check-doc-links.js`；全測試 `npm run test:ci` 0 fail
- [ ] 品質閘門：`/codex-review-fast` ✅ Ready → `/precommit` ✅ PASS → `/codex-review-doc` ✅ Mergeable

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `rules/scope-discipline.md` | Modify | 193 行縮為常駐守則 + 指標 |
| `rules/auto-loop.md` | Modify | § Stall Detection、§ Cap Diagnostic Protocol 搬出 |
| `skills/codex-code-review/references/scope-contract.md` | Create | scope 權威契約 |
| `skills/codex-code-review/references/loop-diagnostics.md` | Create | stall/cap 權威契約 |
| `skills/codex-code-review/SKILL.md` | Modify | 六處 `§` 指標改指契約 |
| `skills/codex-code-review/references/review-common.md` | Modify | 四處 `§` 指標改指契約 |
| `rules/auto-loop-project.md` | Modify | 章節改名連動 |
| `test/rules/contract-routing.test.js` | Create | routing 測試 + 負控制 |
| `test/rules/scope-discipline.test.js` | Modify | 契約／常駐兩個 binding，新增常駐守則斷言 |
| `test/rules/auto-loop-behaviour.test.js` | Modify | 預算表斷言改指契約，常駐語意另立斷言 |
| `test/rules/override-contract.test.js`、`test/skills/claude-md-coverage.test.js` | Modify | 章節改名連動、新測試分類 |

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Development | Done | 常駐層自 1,106 行 / 97,826 bytes 降約 15%（≈ −3.7K tokens/session）。**行數與位元組不寫字面值**——本票已因後續修正兩度失準，改記推導指令：`cat CLAUDE.md rules/*.md | wc -lc`、`wc -l rules/scope-discipline.md rules/auto-loop.md skills/codex-code-review/references/*.md` |
| Testing | Done | `npm run test:ci` → 0 fail |
| Acceptance | Done | 三道閘門全通過（見下） |

**閘門結果**（Codex 全程不可用，兩個平面均由 fallback carrier 承載）：

| Plane | Rounds | Blocking rounds | Final | gate_source |
| ----- | ------ | --------------- | ----- | ----------- |
| code_review | 9 | r1, r3, r4, r5, r6, r7, r8 | `✅ Ready` | `fallback:strict-reviewer` |
| doc_review | 5 | r4 | `✅ Mergeable` | `fallback:contract-neutral-reviewer` |
| precommit | — | — | `## Overall: ✅ PASS` | runner |

`[REVIEWER_FALLBACK] plane=code_review from=codex to=strict-reviewer reason=timeout | 2026-08-29T05:05:00Z`（sticky per change）

**七次 blocking 的分佈**：八次中七次落在**測試守衛強度**，同一類遞歸（守衛綁單檔 → 清單無下限 → 下限太鬆 → 只釘存在不釘內容），已記為 L17／L18；唯一不同類的是 r4 doc——我在 `loop-diagnostics.md` 的 tier 宣告把兩條 Default 誤稱 Anchor，等於刪掉其 `[DEVIATION]` 路徑，是本票承諾「政策零變動」下的真實違反，已據 `rules/discretion.md` 逐條更正。**交付物本身（搬移）在九輪中從未被指出缺陷**。

## Open Questions

1. ~~`rules/docs-numbering.md` 的分類法是否被 `doc-classifier.js` 直接讀取？~~ **已答（tech spec 開放問題 4 結案）**：`scripts/lib/doc-classifier.js:16` 讀的是 `scripts/config/doc-taxonomy.json`，與規則散文無耦合，故分類法沒有 parity 理由必須常駐。r2 可整段搬移。
2. **同一類缺陷四度復發**（已記入 `.claude/sd0x-dev-flow-lessons.md` L17/L18）：守衛綁定單一檔案，內容搬走後靜默失效。第 6 輪改為清單驅動的 carrier 斷言作為有界調整，不再逐條修補。
3. 搬移在 skill 之間新增了可達邊：`review-common.md → scope-contract.md → codex-code-review/SKILL.md` 曾讓 `/check-coverage` 透過遞移圖繼承一個它無權執行的 shell shim（`test/skills/scan-error-gate.test.js` 抓到）。本票以移除契約端回指 `SKILL.md` 的兩處反向引用解決——契約本身才是權威。**r2 起每次搬移都要檢查這一類新增邊**。
