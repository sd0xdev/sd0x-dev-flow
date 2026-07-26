# Plan Schema（正典）

Planner agent 輸出的計畫必須符合本 schema；`scripts/validate-plan.js` 為強制執行者（規則代碼對照見文末）。

## Schema

```jsonc
{
  "intent": "string（必填）",
  "done_definition": "string（必填）",
  "steps": [{
    "id": "s1",                              // 必填，唯一
    "kind": "fanout | main-skill | verify | gate | proposed-manual",
    "target": "Explore | performance-optimizer | /codex-review-doc | …",
    "why": "必填非空（NFR-2/Signal 6）：為何選此 skill/agent；含 repo_signals 引用",
    "parallel_group": "w1",                  // 選填；同 group = 平行（FR-5）
    "depends_on": ["s0"],                    // 選填；循序（FR-5）
    "converge": {                            // 選填；重複直到收斂（FR-5）
      "max_rounds": 2,                       // ≤ budget.max_waves
      "until": "completeness gate 描述"
    },
    "preconditions": ["…"],                  // 選填（FR-6）
    "done_criteria": "…",                    // 選填（FR-6）
    "mutating": false,                       // 預設 false；true 時 kind 必須 proposed-manual
    "mutation_class": "code | doc | external" // 選填；僅 mutating:true 時有意義；缺漏或 external 一律視同 code（最保守——v1 尚無 external 專屬 gate）
  }],
  "stop_conditions": ["budget 用盡", "post-verify 偵測變更"],
  "required_gates": ["doc-review"]           // change-type → gate 映射結果；v1 至少含 doc-review
}
```

## Lint 規則對照（`validate-plan.js`，全 fail-closed）

| 代碼 | 規則 |
|------|------|
| A1 | `kind: fanout` 的 `target` 必須在 admission allowlist（deny-by-default） |
| A2 | `kind: fanout` 且 `mutating: true` → 拒（矛盾宣告） |
| A3 | 任何 `mutating: true` 步驟的 `kind` 必須是 `proposed-manual`（v1 report-only） |
| A4 | `kind: main-skill` 的 `target` 必須存在於 plan-context `skill_candidates`（反幻覺——planner 只能選真實 skill；context 缺 `skill_candidates` 亦拒，fail-closed） |
| G1 | 含 code-class mutating 步驟（`mutation_class` 缺漏或 `external` 視同 code）→ `required_gates` 須含 `code-review` + `precommit`；doc-class → 須含 `doc-review` |
| G2 | `required_gates` 至少含 `doc-review`（v1 報告 Write 必為 doc mutation） |
| O1 | 每步 `why` 非空 |
| B1 | `steps.length ≤ max_plan_steps`；單一 `parallel_group` 的 fanout 數 ≤ `max_workers`；`converge.max_rounds ≤ max_waves`（非數值亦拒） |
| S1 | 序列化後不得含 hook-parsed sentinel 字串（gate / precommit Overall / doc-review / plan-review 的 Markdown 標頭行，以及 Ready、Mergeable、All-Pass、Plan Ready、Blocked、Plan Blocked、Needs revision、Must fix 等 gate 記號）——以名稱描述 gate，勿照抄記號原文（本表本身亦遵守此規則，故不列出帶記號前綴的字面值） |
| SCHEMA | 結構完整性：`intent`/`done_definition` 非空、`steps` 為陣列、`kind` 已知、step `id` 必填且唯一、`depends_on` 為陣列、引用存在的 id、且整體構成 DAG（無循環依賴，拓樸可排序） |
