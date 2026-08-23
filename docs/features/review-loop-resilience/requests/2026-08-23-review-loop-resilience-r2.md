# Review Loop Resilience — r2 程式層：validator、dispatch 決策與 neutral agent

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-08-23
> **Status**: Candidate Complete
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

Fallback 等效化需要兩個機械強制點（raw 終態驗證、分派決策）與一個受 pin 保證的 contract-neutral reviewer agent（tech spec T2）。

## Requirements

- `scripts/validate-family-sentinel.js`：per-contract raw 終態驗證，fail-closed
- `scripts/lib/review-dispatch.js`：純函式分派決策表
- `agents/contract-neutral-reviewer.md`：薄身 agent，pinned frontmatter
- 兩支 harness 測試（happy＋error＋edge）

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | Tech spec §3.2 validator 表、§3.2.1 決策模組、新 agent（T2） |
| Out   | 行為層規則（r1）、skill 消費點接線（r3）、契約測試（r4）、necessity-audit contract |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `scripts/validate-family-sentinel.js` | New | `<contract>` 引數＋stdin 報告 → exit 0/1；終態表見 spec §3.2 |
| `scripts/lib/review-dispatch.js` | New | `decide(state) → action`；零依賴、無 I/O |
| `agents/contract-neutral-reviewer.md` | New | `model: opus`、`effort: high`；body 依所附模板全文執行 |
| `test/scripts/validate-family-sentinel.test.js` | New | Fixture 驅動終態驗證 |
| `test/scripts/lib/review-dispatch.test.js` | New | 決策序列 harness（原載 `test/lib/`，2026-08-23 事實性更正：實際落點含 `scripts/` 段） |

## Acceptance Criteria

- [x] Validator：五 contract（`code`／`doc`／`plan`／`test:coverage`／`test:ac-trace`）各自合法 raw 終態 → exit 0；跨契約終態、雙終態、缺終態、空／malformed → exit 1（fail-closed）
- [x] Validator：coverage 四別名聯集各自過、混用拒；plan `⚠️ Plan Needs Human` 與 `[PLAN_REVIEW_DEGRADED]` 並存拒
- [x] Validator：終態同詞出現於引文／程式碼區塊不誤判（反向 guard 與正向案例同 commit，`testing.md` § Guards）
- [x] Dispatch：`decide()` 覆蓋 probe 失敗→P2、validator 失敗→下一 priority、耗盡→per-contract terminal（plan=`[PLAN_REVIEW_DEGRADED]`、其餘無 sentinel、`noteEligible=false`）、sticky 不再探測、`threadRounds≥threshold`→rotate、necessity 特例（永不 rotate；codex_fail→既有 degradation terminal）
- [x] `agents/contract-neutral-reviewer.md` frontmatter 為 `model: opus`、`effort: high`（`test/agents/frontmatter.test.js` 自動涵蓋並綠）
- [x] `npm test` 全綠；新測試涵蓋 happy path＋error handling＋edge cases（null／空／極端）
- [x] Pass `/codex-review-fast` → `/precommit`

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | Done   | 依 tech spec §3 對應段落實作 |
| Development | Done  | validate-family-sentinel.js＋review-dispatch.js＋contract-neutral-reviewer.md 落地 |
| Testing    | Done   | validator 10 測綠、dispatch 11 測綠（test/scripts/lib/）、frontmatter pin 綠 |
| Acceptance | Done | AC 全數勾銷：code review `✅ Ready`（2026-08-23 第 6 輪）＋`/precommit` `## Overall: ✅ PASS`（第 3 輪）後補記 |

**2026-08-23 後續強化附記（rounds 10–14，r4 收尾期間）**：doc/code 審查迴圈在本票標記 Candidate Complete 後又對本票產物落地四項 fail-closed 強化——(1) plan orchestration-owned 三標記（`⚠️ Plan Needs Human`／`[PLAN_REVIEW_DEGRADED]`／`[PLAN_REVIEW_SKIPPED]`）在未引用散文中任何位置皆拒（防偽造耗盡／跳過 P3）；(2) per-family raw 形狀強制（`checkShape()`：doc／coverage 裸末行、ac-trace 未 bullet 末行、plan `## Plan Review` 判別行；code 無形狀）；(3) 形狀檢查對 CRLF 正規化後原始報告精確比對（引用內容不得藏匿判定行後）；(4) dispatcher 關係不變量（fallback 路徑 P1 帶 validatorResult 一律 throw）。細節見 tech spec §3.2／§3.2.1 與 r4 Progress。最終驗收：code review 第 14 輪 `✅ Ready`（rotated thread）＋全套 4161 測試 0 fail。

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §3.2、§3.2.1、§6
- Sibling: [r1](./2026-08-23-review-loop-resilience-r1.md)、[r3](./2026-08-23-review-loop-resilience-r3.md)、[r4](./2026-08-23-review-loop-resilience-r4.md)
