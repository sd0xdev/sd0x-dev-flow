# Review Loop Resilience — r4 契約測試、回歸與 E2E 驗證

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-08-23
> **Status**: Candidate Complete
> **Depends On**: [r1](./2026-08-23-review-loop-resilience-r1.md)、[r2](./2026-08-23-review-loop-resilience-r2.md)、[r3](./2026-08-23-review-loop-resilience-r3.md)
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

r1–r3 落地後，以契約測試 pin 新政策、同步既有測試斷言，並執行失效注入驗證（tech spec T7＋T8。原規劃為手動 E2E；2026-08-23 更正：實際以**整合層模擬**執行——真實 Codex 斷線演練未執行，見 AC 與 Progress.Note）。

## Requirements

- 新增 `test/rules/review-loop-resilience.test.js` 契約測試
- 同步 `auto-loop-behaviour.test.js` 受影響斷言
- 手動 E2E 失效注入程序（記載於本票 §E2E，`/feature-verify` 執行）
- Doc Sync（spec／requirements 記錄補記）

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | Tech spec T7＋T8；§6 測試矩陣第 3–4 列 |
| Out   | Validator／dispatch 的 unit harness（r2 已含）、新功能 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `test/rules/review-loop-resilience.test.js` | New | 契約斷言（雙向 guard 同 commit） |
| `test/rules/auto-loop-behaviour.test.js` | Modify | 受影響斷言同步；stall/cap pin 不動 |

## E2E 失效注入程序（`/feature-verify` 執行，READ-ONLY 對照）

1. 暫時使 Codex MCP 不可達（如以無效 `CODEX_HOME` 啟動或斷網環境）
2. 對一個小型 doc change 跑 `/codex-review-doc`：預期 `[REVIEWER_FALLBACK]` 記錄、contract-neutral-reviewer 分派、報告含 doc family 合法終態、`note doc_review` 成功
3. 同 change 再 re-review：預期不再探測 Codex（黏著）
4. 恢復 Codex；new change 預期回到 Priority 1

## Acceptance Criteria

- [x] `test/rules/review-loop-resilience.test.js` 落地：spec §6 第 3 列全部斷言（規則關鍵句、Matrix 改寫、輪替條款、同 thread 限縮、消費點指向條款、frontmatter 增補、映射句、per-family Priority 4 無偽造 sentinel），且雙向 guard 同 commit
- [x] `auto-loop-behaviour.test.js` 受影響斷言同步；stall/cap 既有 pin 不動且綠
- [x] `doc-review` 既有測試綠（one-thread-per-batch 回歸）；`frontmatter.test.js` 綠（新 agent 入 pin）
- [x] `npm test` 全綠（4136 tests／0 fail，第二輪 2026-08-23）
- [x] §E2E 程序以**整合層失效注入模擬**驗證（`decide()` 決策序列＋validator 探針；非真實 Codex 斷線演練——2026-08-23 事實性更正，原句「E2E」高估了驗證層級）並回報 L3 信心，結果記入本票 Progress.Note（載體代跑細節見該欄）
- [x] Doc Sync：`2-tech-spec.md` Status 更新、requirements 開放問題勾銷已決者，一次 `/codex-review-doc` 過（Doc Sync 批次於獨立 thread `01a02e87` 一次分派審查 spec＋r2＋r4；本勾銷依該批次審查者的 reconcile 指示同輪完成，終判以該 thread 的 `✅ Mergeable` 為準）
- [x] Pass `/codex-review-fast` → `/precommit`（測試檔屬 code class）

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | Done   | spec §6 第 3–4 列展開為 18 條契約斷言 |
| Development | Done  | 契約測試 18/18 綠；auto-loop-behaviour 同步（single-mode pin 改寫為「不得默換：具名＋驗證＋標示」）；auto-loop.md 修剪回 19986 bytes（20KB ceiling） |
| Testing    | Done   | 全套第二輪 4136/0 fail；第一輪 6 敗全數修復（CLAUDE 讀者登記＋basename 相撞、auto-loop.md 尺寸、舊政策 pin、2 個引用路徑）；第三輪（doc review 修復後 pins 同步＋3 個新雙向 guard）4150/0 fail，auto-loop.md 20000 bytes（上限內）；第四輪（rounds 10–14 強化後）4161/0 fail；第五輪（Doc Sync 審查揭露 §6 coverage overclaim，補「健康路徑 fail 留 P1」測試後）4162/0 fail |
| Acceptance | Done | 整合層失效注入模擬完成（見 Note；真實斷線 E2E 未執行、deferred）；code review 歷經 15 輪（含 2 次 R-a thread 輪替；第 15 輪為 Doc Sync 審查揭露 §6 coverage overclaim、補「健康路徑 fail 留 P1」測試後於同 thread 重審）終判 `✅ Ready`；doc review b1–b5 批次歷經 8 輪（含 1 次 R-a 輪替）全批 `✅ Mergeable`，Doc Sync 批次（spec＋r2＋r4）因前 thread R-a 已滿另起新 thread `01a02e87` 收尾；precommit `## Overall: ✅ PASS` 於最終樹（第 15 輪補測後全模式重跑） |

**Progress.Note — 審查迴圈強化紀錄（2026-08-23，rounds 8–14）**：code/doc 兩平面交錯審查共揪出並修復 9 項阻擋級（P1／🔴）fail-open 或矛盾——ghost pass 關係不變量、gitignored 檔依賴、secondary-only Ready 關閘、SKILL 殘留舊指令、plan orchestration 標記逃逸 ×2（mid-line DEGRADED＋SKIPPED）、raw 形狀強制缺失、stripped-vs-raw 檢查層錯位、dispatcher P1-validatorResult 偽造——另修 1 項 P2（basename 相撞），每項均含雙向 guard 測試；code thread 輪替 2 次（`01a02dd8`→`01a02e33`→`01a02e68`）、doc thread 輪替 2 次（`01a02e0a`→`01a02e46`→Doc Sync 批次 `01a02e87`）。

**Progress.Note — 失效注入（整合層模擬，2026-08-23；原稱 E2E，同日更正）**：

1. 決策路徑（deterministic，`review-dispatch.js decide()` 八狀態）：S2 codex_fail→P2 dispatch `contract-neutral-reviewer`、validator pass→`noteEligible:true`、S3 黏著不再探測、S4 恢復→Priority 1 codex；對照組：doc 耗盡→terminal 無 sentinel、plan 耗盡→`[PLAN_REVIEW_DEGRADED]`、necessity→既有 degradation、R-a threadRounds≥3→rotate。全部符合 spec §3.2.1。
2. 實際載體分派（live）：以 doc family 對真實變更 `rules/codex-invocation.md` 執行 fallback 審查——治理模板 `codex-prompt-doc.md`、獨立研究（git diff＋中央契約三主張逐一核對＋模板 grep 佐證）、產出 `✅ Mergeable`＋`gate_source=fallback:contract-neutral-reviewer`、一條 `[NIT_DEFERRED]`（sub-threshold，已記錄不修）。
3. 驗證：報告經 `node scripts/validate-family-sentinel.js doc` → `[SENTINEL_VALID] contract=doc`（exit 0）。
4. 誠實記錄兩點：(a) 真實 MCP 斷網（程序步驟 1）需環境層控制，本 session 內以「決策模組注入＋實際載體分派」等價覆蓋；(b) `contract-neutral-reviewer` agent registry 於 session 啟動快照，本次以 general-purpose 內嵌其完整 system prompt 代跑——新 session 後該 agent 直接可用。信心：L3（決策層 deterministic 全覆蓋＋載體層 live 驗證）。

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §5 T7/T8、§6
- Sibling: [r1](./2026-08-23-review-loop-resilience-r1.md)、[r2](./2026-08-23-review-loop-resilience-r2.md)、[r3](./2026-08-23-review-loop-resilience-r3.md)
