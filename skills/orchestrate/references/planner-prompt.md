# Planner Prompt（獨立推導契約）

派發給 planner agent（`Explore`，admission allowlist 內唯一具研究能力者）的 prompt 模板。精神遵 `rules/codex-invocation.md`：**planner 獨立推導，不餵 Claude 預擬的步驟**——否則 FR-2 的「agent 動態推導」淪為 rubber stamp。

## 契約

| 規則 | 內容 |
|------|------|
| 輸入 | plan-context JSON（候選 + 信號 + admission + budget）+ 使用者意圖原文 + plan schema（`plan-schema.md`） |
| **禁止輸入** | Claude 預擬的步驟序列、傾向性結論（「我覺得應該先跑 X」）、scope 限縮指示 |
| 輸出 | **純 plan JSON**（符合 `plan-schema.md`），不附散文解釋 |
| 狀態感知 | 每個取捨必須引用 `repo_signals` 佐證（如「`2-tech-spec.md` 已存在 → 跳過 `/tech-spec`」寫入該步 `why`）——Signal 1 可追溯證據 |
| 邊界 | 不得規劃 allowlist 外的 fanout；mutating 構想一律 `kind: proposed-manual` + `mutating: true`；gate 步驟以名稱描述（`code-review` / `precommit` / `doc-review`），**不得複述 sentinel 原文** |

## Prompt 模板

```
Agent({
  description: "Orchestrate planner: <intent slug>",
  subagent_type: "Explore",
  run_in_background: true,
  prompt: `You are a workflow planner. Derive a workflow plan for the intent below.
You must decide the steps yourself from the candidates and repo signals — no
pre-made step sequence is provided, and none should be assumed.

## Intent
<user intent verbatim>

## Done definition
<done definition>

## Plan context (candidates + repo signals + admission + budget)
<plan-context.js output JSON>

## Output contract
Return ONLY a JSON document conforming to the plan schema below. Every step
needs a non-empty "why" that cites repo_signals where a trade-off was made
(e.g. skipping a phase because its artifact already exists). Steps that would
mutate anything must be kind "proposed-manual" with "mutating": true — they
will not be executed. Fanout steps may only target: <admission.allowlist>.
Describe gates by name (code-review / precommit / doc-review); never write
gate sentinel text. Budget: max <max_plan_steps> steps, <max_workers> per
parallel group, <max_waves> converge rounds.

## Plan schema
<plan-schema.md 正典內容>
`
})
```

## 驗收

Planner 輸出一律過 `scripts/validate-plan.js`（fail-closed lint）；lint 失敗 → 帶規則代碼重規劃 ≤1 次，仍失敗 → ⚠️ Need Human。
