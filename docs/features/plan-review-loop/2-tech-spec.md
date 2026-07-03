# Technical Spec: Plan-Review-Loop — Pre-ExitPlanMode Codex Review Gate

> **Doc class**: Lifecycle — Phase 2 technical spec (per [`rules/docs-numbering.md`](../../../rules/docs-numbering.md)).
> **Created**: 2026-05-18
> **Canonical inputs**: [`./1-requirements.md`](./1-requirements.md) (Phase 1), [`./0-feasibility-study.md`](./0-feasibility-study.md) (Phase 0)
> **Architecture decision**: v1 = **A1 + B1 + C2** (feasibility Nash equilibrium, threadId `019e298f-3645-7801-b6ff-b60b8d1235e6`)

## 1. Requirement Summary

- **Problem**: Claude Code 的 plan mode 由 `ExitPlanMode` 終結，草擬者即定稿者，無獨立挑戰者；plan 缺陷的偵測責任全推給使用者，造成「批准 → 開工 → 才發現方向錯」的高成本反覆（[`1-requirements.md` §1](./1-requirements.md)）。
- **Goals**: 在 plan 呈現給使用者**之前**插入一個 Codex 對抗式 review loop，多輪 fix → re-review 收斂後才呼叫 `ExitPlanMode`；與既有 code/doc/aggregate review 狀態與 sentinel **完全隔離**；reviewer 失效時 graceful degrade 不阻塞 plan mode；保留使用者逃生口。
- **Scope**:

| In Scope (v1) | Out of Scope |
|---------------|--------------|
| 新增 `/plan-review` skill（A1 skill-driven trigger） | 修改 `ExitPlanMode` 工具本身（harness 上游，FR-13 Won't） |
| `.claude_review_state.json` 加 namespaced `plan_review` 欄位（B1，schema v2→v3 additive migration） | PreToolUse hook 攔截 `ExitPlanMode`（A3，v2-gated on OQ-Sx-1 harness probe） |
| plan-only sentinel namespace + `scripts/emit-plan-gate.sh` | 對 lifecycle spec 執行 review（FR-15 → `/review-spec` owns） |
| 3-tier ladder：quick / standard / deep（deep 委派 `/codex-brainstorm`，C2） | review 通過後自動執行 plan（FR-14 Won't） |
| `stop-guard.sh` 擴充辨識 plan sentinel 並維持隔離（OQ-Sx-3 hard precondition） | plateau / fingerprint 偵測（OQ-9 → V2，需 hook 端 fingerprint 儲存） |
| Bypass（`--skip-review` + 使用者明示偵測）、graceful degradation、review trail summary | |

## 2. Existing Code Analysis

### 2.1 Related modules (verified)

| Module | Role for plan-review | Reference |
|--------|---------------------|-----------|
| `hooks/post-tool-review-state.sh` | State carrier + MCP sentinel router；pre-v1 既有 state 為 `schema_version: 2`（as-built：`init_state_file()` 直接產出 v3 含 `plan_review`；既有 v2 檔由 migration 升級） | [`init_state_file()`](../../../hooks/post-tool-review-state.sh)（state init）、[MCP routing Priority 1.5 plan branch](../../../hooks/post-tool-review-state.sh)（`## Plan Review` discriminator；行號隨版本漂移，以符號名為準） |
| `hooks/stop-guard.sh` | Stop gate enforcement；`grep -E '✅ Mergeable\|✅ Ready'` 視為 REVIEW_PASSED | transcript-fallback 模式的 `REVIEW_PASSED` / `REVIEW_BLOCKED` / `LAST_REVIEW` 變數（[`hooks/stop-guard.sh`](../../../hooks/stop-guard.sh)；引用穩定符號名而非行號以免漂移） |
| `scripts/emit-review-gate.sh` | gate emission contract（`PENDING\|READY\|BLOCKED` → `REVIEW_GATE=$GATE`） | [`scripts/emit-review-gate.sh`](../../../scripts/emit-review-gate.sh) |
| `skills/doc-review/SKILL.md` | Codex loop topology：first `mcp__codex__codex`（存 threadId）→ `mcp__codex__codex-reply` loop；`sandbox: read-only`, `approval-policy: never` | [`skills/doc-review/SKILL.md:48-58`](../../../skills/doc-review/SKILL.md) |
| `skills/codex-brainstorm/SKILL.md` | Nash equilibrium engine（deep tier 委派目標） | [`skills/codex-brainstorm/SKILL.md`](../../../skills/codex-brainstorm/SKILL.md) |
| `rules/auto-loop.md` | Convergence decision table（max_rounds / plateau / strategic reset），rule-level model 可重用 | [`rules/auto-loop.md`](../../../rules/auto-loop.md) Exit Conditions |
| `hooks/hooks.json` | PreToolUse 僅 `Edit\|Write`；A1 **不需**改 hooks.json | [`hooks/hooks.json:32-41`](../../../hooks/hooks.json) |
| `scripts/security-redact.js` | secret redaction primitive（NFR-8 送 reviewer 前 sanitize） | [`scripts/security-redact.js`](../../../scripts/security-redact.js) |

### 2.2 Reusable components

| Component | Reuse posture |
|-----------|---------------|
| `.claude_review_state.json` lock / migration / compact-resume infra | **Extend**：加 `plan_review` 子樹，沿用既有 lock + atomic write |
| MCP sentinel routing `## <Header> + ✅/⛔ <Verb>` pattern | **Mirror**：新增 `## Plan Review` discriminator branch |
| doc-review `mcp__codex__codex` → `codex-reply` loop | **Adopt topology**：plan-review standard tier 同構 |
| `rules/auto-loop.md` convergence decision table | **Reuse rule-level model**：plan-review 擁有獨立 `iteration_history`，不消耗 code/doc `total_rounds_session` |
| `/codex-brainstorm` Nash engine | **Delegate**：deep tier 直接呼叫，不複製對抗引擎 |

### 2.3 Files requiring changes

| File | Change type | Detail |
|------|-------------|--------|
| `skills/plan-review/SKILL.md` | **New** | 核心 orchestration skill（A1） |
| `skills/plan-review/references/codex-prompt-plan.md` | **New** | Codex prompt template（OQ-Sx-5：plan 作為 "candidate artifact to attack"） |
| `skills/plan-review/references/review-loop-plan.md` | **New** | re-review 續輪 template |
| `.claude/skills/plan-review/...`（經 `.claude/skills -> ../skills` dir symlink 自動可見）+ `docs/skill-catalog.yml` + 3 份 CLAUDE quick-ref row | **New/Modify** | 使用者可呼叫入口（v3 起無 `commands/` thin entry，skill 直接註冊） |
| `scripts/emit-plan-gate.sh` | **New** | plan gate emission contract |
| `hooks/post-tool-review-state.sh` | **Modify** | (a) `init_state_file()` 加 `plan_review`、`schema_version` 2→3；(b) schema migration 分支；(c) MCP routing 加 Priority 1.5 plan branch |
| `hooks/stop-guard.sh` | **Modify** | plan sentinel 隔離（`✅ Plan Ready` 不得滿足 code/doc gate；plan pending 獨立追蹤）— OQ-Sx-3 |
| `rules/auto-loop-project.md` | **Modify** | 新增 `## Plan Review Max Rounds` 配置區塊（OQ-10，default 5） |
| `rules/auto-loop.md` | **Modify** | Standard Gate Sentinels 表加 plan namespace 列 |
| `test/skills/plan-review.test.js` | **New** | skill 結構/契約測試（靜態斷言；行為驗證見 §6） |
| `test/scripts/emit-plan-gate.test.js` | **New** | gate emission 測試 |
| `test/hooks/post-tool-review-state.test.js` | **Modify** | 加 plan sentinel routing + schema migration fixtures |
| `test/hooks/stop-guard.test.js` | **Modify** | 加 plan isolation fixtures |

## 3. Technical Solution

### 3.1 Architecture Design

```mermaid
sequenceDiagram
    participant U as User
    participant C as Claude (plan mode)
    participant PR as /plan-review skill
    participant RD as security-redact
    participant CX as Codex MCP
    participant SA as Secondary (Task agent)
    participant BR as /codex-brainstorm
    participant ST as .claude_review_state.json (plan_review.*)
    participant EX as ExitPlanMode (harness)

    C->>C: 草擬 plan（in-context）
    C->>PR: opt-in 啟用 → 呼叫 /plan-review（前置於 ExitPlanMode）
    PR->>PR: Step1 tier 判定 (quick/standard/deep)
    PR->>RD: Step2 scanHighConfidence(plan)
    alt high-confidence secret 命中（fail-closed，終態）
        RD-->>PR: {name,fingerprint}
        PR->>ST: degraded=true; status_reason=secret-detected
        PR->>C: [PLAN_REVIEW_DEGRADED]（plan 不外送 reviewer）
        C->>EX: ExitPlanMode（plan + degradation 標記）
        EX->>U: 呈現 plan（未經 review，degradation 標記）
    else 無 high → maskMediumConfidence（唯一進入 reviewer 的路徑）
        RD-->>PR: masked plan
        alt tier = quick
            PR->>CX: 單輪 review（plan = candidate artifact）
        else tier = standard
            par dual dispatch
                PR->>CX: Codex review loop（存 threadId）
            and
                PR->>SA: Secondary 視角（並行）
            end
        else tier = deep
            PR->>BR: 委派 Nash equilibrium 辯論
        end
        CX-->>PR: findings + ## Plan Review sentinel
        PR->>ST: 寫 plan_review.iteration_history（獨立預算）
        alt 有 P0/P1 (⛔ Plan Blocked)
            PR->>C: surface findings（不改寫 plan）
            C->>C: revise plan
            C->>PR: re-review (codex-reply --continue)
            Note over PR: loop 直到 ✅ Plan Ready 或 max_rounds
        else 收斂 (✅ Plan Ready)
            PR->>C: 附 review trail summary
            C->>EX: 呼叫 ExitPlanMode（精煉後 plan）
            EX->>U: 呈現最終 plan
        else max_rounds 未收斂
            PR->>C: ⚠️ Plan Needs Human + 殘餘 findings
            C->>U: 交付當前 plan + findings（不靜默通過）
        else reviewer 不可達
            PR->>ST: plan_review.degraded=true; status_reason=reviewer-unavailable
            PR->>C: [PLAN_REVIEW_DEGRADED]
            C->>EX: ExitPlanMode（plan + degradation 標記）
        end
    end
    Note over U,PR: 任一時點使用者明示「skip review」/ --skip-review → ≤1 輪內跳出
```

### 3.2 Data Model

`.claude_review_state.json` schema v2 → **v3**（additive）。新增 `plan_review` 頂層欄位，與 `code_review` / `doc_review` / `aggregate_gate` 同層但**互不覆寫**（NFR-7）。

> **以下 JSON 為部分節錄（partial excerpt），僅示 `plan_review` 新增子樹**。As-built：[`init_state_file()`](../../../hooks/post-tool-review-state.sh) 直接產出 **v3**（含 `plan_review`）；**pre-v1 既有 state 檔為 v2**，由 migration 升級。v2/v3 頂層欄位（migration 必須完整保留**值**者）：`session_id`、`updated_at`、`review_mode`、`has_code_change`、`has_doc_change`、`code_review`、`doc_review`、**`precommit`**、`aggregate_gate`、root `iteration_history`——不只 code/doc/aggregate/root iteration；`schema_version` 為唯一刻意改值的欄位（2→3，見 migration 一節）。

```jsonc
// partial excerpt — only the additive plan_review subtree shown
{
  "schema_version": 3,                  // bumped from 2
  // ...all existing v2 top-level fields preserved verbatim
  // (session_id, updated_at, review_mode, has_code_change,
  //  has_doc_change, code_review, doc_review, precommit,
  //  aggregate_gate, iteration_history) ...
  "plan_review": {
    "executed": false,
    "passed": false,
    "degraded": false,
    "skipped": false,
    "status_reason": null,
    "tier": null,
    "last_run": "",
    "iteration_history": {
      "current_round": 0,
      "max_rounds": 5,
      "findings_by_round": [],
      "total_rounds_session": 0
    },
    "history": []
  }
}
```

| Field | Semantics | OQ resolved |
|-------|-----------|-------------|
| `plan_review.iteration_history` | **獨立** loop 預算；不讀寫 root `iteration_history` / `total_rounds_session` | OQ-5 / FR-10 |
| `plan_review.iteration_history.max_rounds` | default `5`；可由 `auto-loop-project.md ## Plan Review Max Rounds` 覆寫 | OQ-10 / NFR-1 |
| `plan_review.history[]` | per-plan reset；保留最近 **5** 筆 trail（schema 見下），超出 FIFO 汰除 | OQ-6 |
| `plan_review.degraded` | reviewer 不可達 **或** 偵測到 high-confidence secret 時 `true`；output 伴隨 `[PLAN_REVIEW_DEGRADED]` | NFR-3 / NFR-8 |
| `plan_review.skipped` | 使用者明示 bypass 時 `true`（**與 `degraded` 區分**：使用者意圖 ≠ reliability 失效） | FR-5 / NFR-5 |
| `plan_review.status_reason` | `null \| "user-skip" \| "reviewer-unavailable" \| "secret-detected" \| "needs-human"`（最後者由 `update_plan_state()` 於 `NEEDS_HUMAN` 寫入） | NFR-3/5/8 |
| `plan_review.tier` | `"quick"\|"standard"\|"deep"` | OQ-Sx-4 |
| 無 `strategic_reset_fired` | plan-review v1 不啟用 strategic reset（plateau 屬 V2） | OQ-9 → V2 |

`plan_review.history[]` 元素 schema（範例；v1 實作僅寫入以下 5 欄——`hooks/post-tool-review-state.sh update_plan_state()`）：

```json
{ "ts": "2026-05-18T10:00:00Z", "tier": "standard", "rounds": 3,
  "findings_total": 5, "outcome": "ready" }
```

**Migration**（`post-tool-review-state.sh`，`init_state_file()` 之後新增分支；jq 以 `. +` 合併保留未知欄位）：

```
讀 STATE_FILE.schema_version
  == 3        → no-op
  == 2 (或缺) → jq '. + {plan_review: $default} | .schema_version = 3'（atomic write，鎖保護）
  其他         → 保守不動，stderr 結構化告警
```

Migration 為**純加法**：`. +` 合併確保**所有**既有頂層欄位（含 `session_id`/`updated_at`/`review_mode`/`has_*`/`precommit`）保留。**唯一刻意變更為 `schema_version` 2→3**；回歸測試斷言 migration 前後**除 `schema_version` 外**全部 v2 頂層欄位語意等價（`schema_version` 單獨斷言由 2 變 3）。

### 3.3 API Design

#### T1 — Plan-only sentinel namespace（forbidden collision 表）

| Sentinel | 意義 | Parsed by |
|----------|------|-----------|
| `## Plan Review` | section discriminator（**必出現**，路由前綴） | hook routing |
| `✅ Plan Ready` | 無 P0/P1，收斂 | hook + behavior |
| `⛔ Plan Blocked` | 有 P0/P1，續 loop | hook + behavior |
| `⚠️ Plan Needs Human` | max_rounds 未收斂 / hard precondition 未過 | behavior-only |
| `[PLAN_REVIEW_DEGRADED]` | reviewer 不可達 **或** high-confidence secret 偵測 → fail-closed，不送 reviewer（reason 區分） | hook + behavior |
| `[PLAN_REVIEW_SKIPPED]` | 使用者明示 bypass（≠ degrade；使用者意圖非 reliability 失效） | hook + behavior |

> **Forbidden（硬約束）**：plan-review 路徑**永不**輸出裸 `✅ Ready` / `✅ Mergeable` / `## Gate: ✅` / 裸 `⛔ Block*`（會被 code/doc/aggregate routing 誤收）。Collision 分析（**已實測**：`printf '✅ Plan Ready' | grep -qE '✅ Ready'` → **SAFE**）：`✅ Plan Ready` 不含子字串 `✅ Ready`（`✅` 與 `Ready` 間為 `" Plan "`），故 `✅` 方向安全。**真正風險在 `⛔` 方向**：`stop-guard.sh` 的 `REVIEW_BLOCKED` / `LAST_REVIEW` grep（`⛔.*Block`）會匹配 `⛔ Plan Blocked`——故 `## Plan Review` discriminator + routing 順序（T2）+ stop-guard 過濾（T4）三層防護缺一不可。

#### T2 — MCP sentinel routing 擴充（`post-tool-review-state.sh` MCP routing Priority 1.5 分支）

於既有 doc(Priority 1) 與 code(Priority 2) 之間插入 **Priority 1.5 plan branch**：

```
if   '## Document Review' && '✅ Mergeable'      → doc_review pass      # P1（不動）
elif '## Document Review' && '⛔ Needs revision' → doc_review fail      # P1（不動）
elif '## Plan Review'     && grep -F '[PLAN_REVIEW_DEGRADED]' → plan_review degraded  # P1.5（token 先判）
elif '## Plan Review'     && grep -F '[PLAN_REVIEW_SKIPPED]'  → plan_review skipped   # P1.5（token 先判）
elif '## Plan Review'     && '⛔ Plan Blocked'   → plan_review fail     # P1.5（BLOCKED 先於 READY）
elif '## Plan Review'     && '✅ Plan Ready'     → plan_review pass     # P1.5
elif '✅ Ready'                                  → code_review pass     # P2（不動）
elif '⛔ Blocked'                                → code_review fail     # P2（不動）
```

> **⚠️ Literal-match 硬約束**：`[PLAN_REVIEW_DEGRADED]` / `[PLAN_REVIEW_SKIPPED]` 含 `[` `]`，在 `grep -E`（ERE）中 `[...]` 是 **character class**（會匹配 `P/L/A/N/_/...` 任一字元），**絕不可**用 `grep -qE '[PLAN_REVIEW_DEGRADED]'`。**必須** `grep -qF '[PLAN_REVIEW_DEGRADED]'`（fixed string）或 escaped ERE `\[PLAN_REVIEW_DEGRADED\]`。Routing regression 必含：`## Plan Review` + `⚠️ Plan Needs Human`（無 degraded/skipped token）**不得**被標記為 degraded。
>
> **分支優先序（as-built，fail-closed）**：machine token（DEGRADED/SKIPPED）**先於** verdict 文字——degraded/skipped 輸出若在 prose 中引述 verdict marker，不得丟失 flag/status_reason；再 `⛔ Plan Blocked` **先於** `✅ Plan Ready`——同時含兩個 verdict marker 的 ambiguous 輸出一律路由為 blocked。

**寫入路徑（as-built，history 單一擁有者）**：terminal `history[]` 由 emit-plan-gate Bash 路徑獨佔。MCP verdict 分支走 `_update_plan_iteration`（先記 round/finding counts，state file 缺失時 `init_state_file`）→ `update_plan_verdict(passed)`（僅 verdict，無 history append）；MCP token 分支走 `update_plan_state(gate, "", "", "no-history")`。如此後續 `emit-plan-gate.sh` 的 history snapshot 取得 fresh counts 且不重複 append。MCP degraded 不帶 reason（恆 `reviewer-unavailable`）：secret-detected 永不經 MCP 路由——skill 在外送 reviewer 前即 fail-closed，由 Bash 路徑記錄 reason。

#### T3 — `scripts/emit-plan-gate.sh` + **hook parse branch**（鏡射 `emit-review-gate.sh` 全鏈）

`emit-review-gate.sh` 只是 emitter；**狀態真正被更新是因為 `post-tool-review-state.sh` 的 `emit-review-gate` parse 分支**（`Bash` PostToolUse）解析 `REVIEW_GATE=`。plan gate 必須補齊**兩端**：

**(a) Emitter** `scripts/emit-plan-gate.sh`：

```
Usage: bash scripts/emit-plan-gate.sh PENDING [quick|standard|deep]      # tier（僅 PENDING 接受）
       bash scripts/emit-plan-gate.sh DEGRADED [reviewer-unavailable|secret-detected]  # reason（僅 DEGRADED 接受）
       bash scripts/emit-plan-gate.sh READY|BLOCKED|NEEDS_HUMAN|SKIPPED  # 其餘 gate 拒絕額外參數
→ echo "PLAN_REVIEW_GATE=$GATE"   # namespace 前綴避免與 REVIEW_GATE 衝突
→ 另輸出 PLAN_REVIEW_TIER= / PLAN_REVIEW_REASON=（有對應參數時）
非法值 / 空參數 / 非法 tier/reason → exit 1（set -euo pipefail）
```

**(b) Hook parse branch**（`post-tool-review-state.sh`，鏡射 `emit-review-gate` 分支，新增獨立分支）：

```bash
# === emit-plan-gate parse branch (as-built) ===
if [[ "$TOOL_NAME" == "Bash" ]] && echo "$COMMAND" | grep -qF 'emit-plan-gate'; then
  PLAN_GATE=$(echo "$TOOL_OUTPUT" | grep -oE '^PLAN_REVIEW_GATE=(PENDING|READY|BLOCKED|DEGRADED|NEEDS_HUMAN|SKIPPED)' | tail -1 | cut -d= -f2) || PLAN_GATE=""
  # REASON 集合鏡射 emitter 實際輸出（僅 DEGRADED；SKIPPED 不發 REASON，user-skip 由 update_plan_state 內部硬編碼）
  PLAN_REASON=$(... '^PLAN_REVIEW_REASON=(reviewer-unavailable|secret-detected)' ...) || PLAN_REASON=""
  PLAN_TIER=$(... '^PLAN_REVIEW_TIER=(quick|standard|deep)' ...) || PLAN_TIER=""
  update_plan_state "$PLAN_GATE" "$PLAN_REASON" "$PLAN_TIER"   # 第 4 參數 history_mode 預設 append
fi
```

**全 6 值 → `update_plan_state()` 語意（無未定義值）**：

| Gate | `executed` | `passed` | 其他 flag | stop-guard 視角 |
|------|-----------|----------|-----------|------------------|
| `PENDING` | `true` | `false` | reset per-plan cycle（round 0、findings 清空、degraded/skipped/status_reason 歸零；接受 tier） | loop 進行中：warn-only 提示，不阻塞 |
| `READY` | `true` | `true` | terminal → history append | 收斂；不滿足 code/doc gate（隔離） |
| `BLOCKED` | `true` | `false` | — | 續 loop；不阻塞 code/doc Stop（T4 過濾） |
| `DEGRADED` | `true` | `false` | `degraded=true`、`status_reason`（reason 參數，預設 reviewer-unavailable）；terminal → history append | 非阻塞，warn-only |
| `SKIPPED` | `true` | `false` | `skipped=true`、`status_reason=user-skip`；terminal → history append | 非阻塞，warn-only |
| `NEEDS_HUMAN` | `true` | `false` | `status_reason=needs-human`（stop-guard 以此視為終態，不發 pending warn）；terminal → history append | 終態 `⚠️ Plan Needs Human`；behavior-layer 升級，warn-only（非 hook hard-block） |

> **as-built 補充**：terminal history（FIFO last-5，欄位 ts/tier/rounds/findings_total/outcome）僅由本 Bash 路徑 append（`history_mode=append` 預設）；MCP 路由一律 no-history（見 T2）。Schema migration fail-closed：`schema_version` 非數字或 >3 → `_migrate_state_plan_review` 回傳 1，所有 plan writers（update_plan_state /_update_plan_iteration / update_plan_verdict）整段 skip 並 stderr 註記，state 完全不動。
>
> hook 端測試**必須涵蓋全 6 值**（非僅 READY/BLOCKED/DEGRADED/SKIPPED）。
>
> 測試必須涵蓋 **hook 端**（Bash 命令含 `emit-plan-gate` → `plan_review.*` 正確更新），不僅 script stdout。

#### T4 — `stop-guard.sh` 隔離擴充（OQ-Sx-3 hard precondition）

| 問題 | 實際風險（已驗證） | 修正 |
|------|------|------|
| `REVIEW_PASSED` 的 `✅ Ready` 誤收 `✅ Plan Ready` | **低**：實測 `✅ Plan Ready` 不含 `✅ Ready`（SAFE） | 加防護但非主風險 |
| **`REVIEW_BLOCKED` + `LAST_REVIEW` 的 `⛔.*Block` 匹配 `⛔ Plan Blocked`** | **高（主風險）**：plan ⛔ 被誤判為 code/doc FAIL，阻塞無關 Stop | **as-built：`_strip_plan_sentinels()` substring strip**（sed 移除四個 plan sentinel token），套用於 `REVIEW_PASSED`/`REVIEW_BLOCKED`/`LAST_REVIEW` 三處掃描。**不採整行 `grep -v`**：transcript 為 JSONL（一行打包整則訊息），整行過濾會把同行的真 code/doc gate verdict 一併丟棄（false allow）；substring strip 使 plan sentinel **既不滿足也不阻塞** code/doc gate，且保留同行其餘內容 |
| plan-review pending 未被 stop-guard 感知 | — | 讀 `plan_review.executed && !passed && !degraded && !skipped && status_reason != "needs-human"` → **warn-only** 提示「plan-review 進行中」，**不**併入 code/doc aggregate 決策（隔離）。`needs-human` 為終態（使用者仲裁中），排除於 pending 之外 |

> stop-guard 對 plan-review 採 **warn-only**（不 strict-block）：plan-review 是 analysis-only、skill-driven、ExitPlanMode 前置流程，非 precommit-style 強制 gate。

#### T5 — `/plan-review` skill 介面

| Arg | 行為 |
|-----|------|
| (無) | tier=standard（OQ-Sx-4 default）；dual-dispatch（使用者決策：standard+deep 啟用 dual） |
| `--quick` | 單輪 Codex，無 loop，**不** dual |
| `--deep` | 委派 `/codex-brainstorm`（C2），dual（Nash engine 內含對抗雙視角） |
| `--skip-review` | 立即跳出，輸出 raw plan + `[PLAN_REVIEW_SKIPPED]`、`plan_review.skipped=true`、`status_reason=user-skip`（≤0 輪；**與 degrade 區分**） |
| `--verbose` | review trail round-by-round（預設僅 summary，OQ-4） |

### 3.4 Core Logic

#### 啟用光譜（OQ-3，使用者決策：opt-in → pilot → opt-out）

| 階段 | 行為 |
|------|------|
| **v1（ship）** | **opt-in**：預設**不**啟用。使用者明示 `/plan-review`、或 `auto-loop-project.md` 設 `## Plan Review: enabled` 表達意圖。未 opt-in → plan mode 原行為（Claude → ExitPlanMode 直送） |
| **2 週 pilot 後** | 評估 false-negative / 使用者摩擦 → 升級 **opt-out**（預設開、`--skip-review` 可關）。升級為文件 + 預設值變更，無 schema 變動 |

> **⚠️ v1 Acceptance Scope（A1 enforcement boundary）**：v1 的 review gate **僅在 `/plan-review` 實際被呼叫時生效**（review-gated only when invoked）。`## Plan Review: enabled` 在 v1 是 **advisory opt-in**——它表達「希望 Claude 在 ExitPlanMode 前 self-invoke `/plan-review`」的意圖，但 **v1 不提供「已啟用卻從未呼叫」的偵測或強制**。原因（已驗證）：(a) stop-guard 的 plan-pending 檢查只在 `plan_review.executed` 已存在後才有意義，無法偵測「該執行卻從未執行」；(b) ExitPlanMode 為 harness 上游工具、v1 不攔截（A3 → v2，gated on OQ-Sx-1 harness probe），故已送入 ExitPlanMode 的 plan 無法事後 gate。因此 **v1 驗收明確界定為**：「`/plan-review` 被呼叫 → 跑收斂 loop → `✅ Plan Ready` 才呈現 plan」；**enabled-but-unexecuted 偵測 + pre-ExitPlanMode / tool-boundary 強制（FR-4 完整版）列為 v2**（見 R3、§7 OQ-Sx-1 / A3）。

#### Tier ladder + dual-review（OQ-7，使用者決策：standard + deep 啟用 dual）

| Tier | Reviewer | Dual? | Loop | 委派 |
|------|----------|-------|------|------|
| quick | 單 Codex MCP | ❌ | 1-pass | — |
| **standard**（default） | Codex MCP + Secondary（Task agent，Explore） **並行** | ✅ | fix→re-review loop（`codex-reply --continue`） | — |
| deep | `/codex-brainstorm` | ✅（Nash 內含 attack/defense 雙視角） | brainstorm termination | `/codex-brainstorm` |

> **決策來源（Decision Record DR-1）**：feasibility OQ-7 disposition 的 default proposal 為 **deep-only**；本 spec 採 **standard + deep** 係 **使用者於 `/tech-spec` 互動決策覆寫 feasibility default**（AskUserQuestion，2026-05-18）。此 spec 區塊**即為該決策的 durable record**（無獨立 request artifact；本 DR-1 註記讓未來審查者能區分「使用者決策」與「作者假設」）。Trade-off：標準 plan 命中率↑，但 standard tier 成本/延遲約翻倍（見 §4 R5）。**可逆性**：屬預設值層級、無 schema 變動；pilot 量測若不符 ROI，回退 feasibility deep-only default 僅需改本表預設，不影響已 ship 介面。
>
> standard tier 的 dual 鏡射 `auto-loop.md` Dual Review Mode：Codex 為阻塞主審，Secondary 背景並行；late P0/P1 重開 loop。Secondary 用 Task agent（subagent_type: `Explore` 或 `strict-reviewer`），prompt 同樣遵守 `codex-invocation.md` 獨立研究原則。

#### Plan handover 與 Codex prompt framing（OQ-2 / OQ-Sx-5）

- Claude 為 plan author，plan 文字本就在 working context（`1-requirements.md` Assumption）。
- `/plan-review` 把 plan 文字作為 **"candidate artifact to attack"** 傳給 Codex，**絕不**寫成 "Claude 的結論，請確認"（`codex-invocation.md` Prohibited Pattern）。
- **Secret redaction contract（NFR-8，依 [`scripts/security-redact.js`](../../../scripts/security-redact.js) **實測 API**）**。實測行為（勿信 source docstring，已驗證）：
  - `scanHighConfidence(text)` → 命中回傳 **`{name, fingerprint}`**、無命中回傳 **`null`**；**不 throw**（docstring 寫 throw 為誤導）。
  - `maskMediumConfidence(text)` → 僅遮罩 medium pattern，**不**遮罩 high-confidence（實測 `sk-…` 原樣穿透）。
  - `redact(text)` 預設 `abortOnHigh=true` → high 命中時 throw `AbortError`；`redact(text,{abortOnHigh:false})` 僅回傳遮罩字串、無 metadata、**無法分辨 high/medium**。
  - 送 reviewer 前的契約（採 truthy-return，主路徑，無例外控制流）：

    ```
    const high = scanHighConfidence(planText);   // {name,fingerprint} | null
    if (high) {
      // fail-closed：plan 不外送 reviewer
      plan_review.degraded=true; status_reason=secret-detected; emit [PLAN_REVIEW_DEGRADED]
      // plan 仍交付使用者（這是使用者自己的 plan），僅拒絕外送 reviewer
    } else {
      send(maskMediumConfidence(planText))         // medium → [REDACTED] 後才送
    }
    ```

    等價替代：`try { send(redact(planText)) } catch (AbortError) { failClosed(...) }`（靠 `redact` 預設 throw）。
  - 高敏 pattern 範圍：PEM、`AKIA…`、`sk-[A-Za-z0-9_-]{20,}`、`ghp_[A-Za-z0-9]{36}`、`xox[aboprs]-…`、`AIza…`。
  - 反例（禁用）：以 `redact(...,{abortOnHigh:false})` 回傳值判 high（high 已遮罩成 `[REDACTED]`、與 medium 不可區分）。
- prompt template 強制含 §「You must independently research the project」+ 具體 git/grep 指令；plan 文字標註為待攻擊產物。

#### Convergence（reuse rule-level decision table）

採 [`rules/auto-loop.md`](../../../rules/auto-loop.md) Exit Conditions 決策表，但作用於 `plan_review.iteration_history`：

| # | Condition | Action |
|---|-----------|--------|
| 1 | `current_round >= max_rounds`（default 5） | `⚠️ Plan Needs Human` + 殘餘 findings（不靜默通過，Signal 7） |
| 2 | `findings_by_round[n].total == 0` | `✅ Plan Ready` → 附 trail summary → ExitPlanMode |
| 3 | plateau（fingerprint overlap ≥50% 連 3 輪） | **V1 不可達**（OQ-9 → V2：需 hook fingerprint 儲存）；v1 僅靠 row 1 hard cap |
| 5 | `total < prev_total` | Continue loop |

#### Bypass / Escape（FR-5 / NFR-5 / UC-2）

```
使用者明示「skip review」/「直接 show plan」/ --skip-review
  → 偵測點：skill 入口 + 每輪 re-review 前
  → ≤1 輪 review 內跳出（NFR-5）
  → 已啟動者輸出部分 trail
  → plan_review.skipped=true; status_reason=user-skip; emit [PLAN_REVIEW_SKIPPED]
    （使用者意圖 — 非 reliability 失效，與 degrade 分離）
  → raw / 當前 plan → ExitPlanMode
```

#### Graceful degradation（NFR-3 / NFR-8 / Signal 6）

兩種 degrade 來源，皆 `plan_review.degraded=true` + emit `[PLAN_REVIEW_DEGRADED]`，但 `status_reason` 區分：

```
(a) reviewer 不可達：Codex MCP 連線錯誤 / 401 / timeout
  → 不 retry-storm（最多 1 retry）
  → status_reason=reviewer-unavailable
(b) plan 含 high-confidence secret（redact contract fail-closed）
  → 不外送 reviewer
  → status_reason=secret-detected
共同：plan 當輪交付使用者 + output 含可 grep 的 [PLAN_REVIEW_DEGRADED] 標記；不阻塞 plan mode
```

## 4. Risks and Dependencies

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **OQ-Sx-2**：plan mode 內 MCP / Skill 呼叫不可用 → A1 根本不可實作 | Medium | **Critical** | **Hard precondition**：實作前先跑 smoke test（見 §7）；若不可用 → ⛔ 架構回頭（A1 不成立，需重評 A2/A3 或 harness 協作） |
| R2 | **OQ-Sx-3**：stop-guard 未隔離 → `⛔ Plan Blocked` 觸發 `⛔.*Block`（stop-guard `REVIEW_BLOCKED`/`LAST_REVIEW` grep）誤判 code/doc FAIL，阻塞無關 Stop（NFR-7 破功） | Medium | High | **Hard precondition**：T4 隔離擴充（as-built：`_strip_plan_sentinels()` **substring strip**——transcript 為 JSONL 一行打包整則訊息，整行 `grep -v` 會把同行真 code/doc verdict 一併丟棄造成 false allow）+ 回歸測試斷言互不覆寫 |
| R3 | A1 為 best-effort：即使使用者已 `## Plan Review: enabled`，Claude 忘記 self-invoke `/plan-review` → 繞過 review（**enabled-but-unexecuted gap**）。v1 無偵測路徑：stop-guard 的 plan-pending 檢查需 `plan_review.executed` 已存在才有意義、ExitPlanMode 不被攔截（FR-4 tool-boundary 層 v1 未保證） | Medium | Medium | **v1 明確界定為「review-gated only when /plan-review invoked」**（見 §3.4 v1 Acceptance Scope）；`auto-loop` + Stop Hook 提示 raise compliance（advisory）；enabled-but-unexecuted 偵測 + tool-boundary 強制留待 v2 OQ-Sx-1 harness probe（A3） |
| R4 | schema migration 破壞既有 state | Low | High | 純加法 jq 注入；atomic write + lock；回歸測試斷言除 `schema_version` 外語意等價 |
| R5 | dual-review 在 standard tier 使短 plan 成本/延遲翻倍 | Medium | Low | Secondary 背景並行不阻塞主 gate；pilot 量測；不符 ROI 可回退 deep-only（feasibility default） |
| R6 | Codex prompt 違反 `codex-invocation.md`（餵養結論） | Low | Medium | 強制使用 `references/codex-prompt-plan.md` template；plan 標註為待攻擊產物；review checklist 把關 |
| R7 | secret 洩漏到 reviewer context（NFR-8） | Low | High | redact contract（§3.4）：medium→mask、high→fail-closed 不外送；測試用**regex-valid** dummy（`sk-` + ≥20 字元如 `sk-abcdefghijklmnopqrstUVWX`、`ghp_` + 恰 36 字元、PEM header），斷言 high-confidence 走 `[PLAN_REVIEW_DEGRADED]`、`status_reason=secret-detected` 且 payload 不外送 |
| R8 | plateau 偵測 v1 缺位 → 同類 finding 反覆但不升 Need Human | Low | Medium | v1 靠 max_rounds=5 hard cap 兜底；OQ-9 明列 V2；trail summary 讓使用者可觀測重複 |

**Dependencies**:

| Dependency | Type | Status |
|------------|------|--------|
| Codex MCP 在 plan mode 可呼叫 | External (harness) | **未驗證 — OQ-Sx-2 hard precondition** |
| Skill 在 plan mode 可呼叫 | External (harness) | **未驗證 — OQ-Sx-2 hard precondition** |
| `scripts/security-redact.js` 存在且涵蓋高敏 pattern | Internal | 需確認介面（W1 預檢） |
| `/codex-brainstorm` skill 穩定 | Internal | 已 ship（deep tier 委派） |

## 5. Work Breakdown

> **Gate**：W0 hard preconditions **必須全綠**才進 W1+。任一不過 → `⚠️ Plan Needs Human`，停工回報（不繞過）。

| ID | Task | Depends | Size | Test mapping |
|----|------|---------|------|--------------|
| **W0** | **Hard precondition spikes** | — | S | — |
| W0.1 | OQ-Sx-2 smoke test：plan mode 內呼叫 `mcp__codex__codex` + Skill 是否回傳；記錄結論 | — | S | spike report（非自動化測試） |
| W0.2 | OQ-Sx-3 stop-guard 隔離設計定稿（regex 過濾 + warn-only 策略確認） | — | S | 設計 note |
| **W1** | **State 基建** | W0 | M | |
| W1.1 | `post-tool-review-state.sh`：`init_state_file()` 加 `plan_review`、`schema_version` 2→3 | W0 | S | `test/hooks/post-tool-review-state.test.js`（新 fixtures） |
| W1.2 | schema v2→v3 additive migration 分支 + atomic/lock | W1.1 | M | 同上（migration：除 `schema_version` 外語意等價斷言） |
| W1.3 | MCP routing Priority 1.5 plan branch（`grep -F` literal for `[PLAN_REVIEW_*]`）+ `update_plan_state()` | W1.1 | M | 同上（plan routing + literal-match + collision 斷言） |
| **W2** | **Gate emission + 隔離** | W1 | M | |
| W2.1 | `scripts/emit-plan-gate.sh`（6 值含 SKIPPED + namespace 前綴）**+ `post-tool-review-state.sh` `emit-plan-gate` parse 分支**（鏡射 `emit-review-gate` parse 分支） | W1.3 | M | `test/scripts/emit-plan-gate.test.js`（emitter）+ `test/hooks/post-tool-review-state.test.js`（hook parse 分支） |
| W2.2 | `stop-guard.sh` 隔離擴充（T4） | W0.2,W1 | M | `test/hooks/stop-guard.test.js`（plan isolation fixtures） |
| **W3** | **`/plan-review` skill** | W1,W2 | L | |
| W3.1 | `skills/plan-review/SKILL.md`（tier ladder / loop / bypass / degrade） | W1,W2 | L | `test/skills/plan-review.test.js`（new） |
| W3.2 | `references/codex-prompt-plan.md` + `review-loop-plan.md`（OQ-Sx-5 framing） | W3.1 | M | skill test 引用斷言 |
| W3.3 | secret redaction 串接（NFR-8，呼叫 `security-redact.js`） | W3.1 | S | skill test（**as-built：靜態斷言** SKILL.md 含 redaction contract + fail-closed 流程；end-to-end dummy-payload 行為驗證留 pilot 手動） |
| W3.4 | standard tier dual-dispatch（Codex + Task secondary 並行） | W3.1 | M | skill test（**as-built：靜態斷言** dual-dispatch 段落存在；skill 為 model-driven markdown，行為驗證留 pilot 手動） |
| W3.5 | deep tier 委派 `/codex-brainstorm` | W3.1 | S | skill test（**as-built：靜態斷言** deep tier 委派段落存在；行為驗證留 pilot 手動） |
| **W4** | **Config + rules + 文件** | W3 | M | |
| W4.1 | `auto-loop-project.md` 加 `## Plan Review Max Rounds`（default 5）+ `## Plan Review: enabled` opt-in 開關 | W1 | S | Max Rounds：hook 解析測試（`_read_project_plan_max_rounds`，含 range/邊界）；**`## Plan Review: enabled` 為 model-read advisory（v1 無 hook 解析，無自動化測試）** |
| W4.2 | `rules/auto-loop.md` Standard Gate Sentinels 加 plan namespace 列 | W3 | S | doc review |
| W4.3 | `/plan-review` skill 登錄（`.claude/skills -> ../skills` symlink 自動可見 + `docs/skill-catalog.yml`）+ `CLAUDE.md` Command Quick Reference 加列（v3 起無 thin command entry） | W3 | S | skills-schema 測試 + symlink parity 斷言 |
| W4.4 | request ticket（`/create-request`）追蹤 AC 進度 | W3 | S | — |

預估：W0 ~1 day（gating）；W1-W4 ~6-8 person-days（feasibility §6 A1+B1+C2 估值範圍內）。

## 6. Testing Strategy

| Layer | Scope | Cases (key) |
|-------|-------|-------------|
| **Unit** | `emit-plan-gate.sh`（emitter） | 6 合法值（含 SKIPPED）→ 正確 `PLAN_REVIEW_GATE=`；非法值 exit 1；空參數 exit 1 |
| **Unit** | **emit-plan-gate hook parse 分支** | Bash 命令含 `emit-plan-gate` + stdout `PLAN_REVIEW_GATE=` **全 6 值**（`PENDING`/`READY`/`BLOCKED`/`DEGRADED`/`SKIPPED`/`NEEDS_HUMAN`）→ `update_plan_state()` 各依 §3.3 T3 語意表更新 `plan_review.*`（**hook 端**，非僅 script stdout） |
| **Unit** | schema migration | v2→v3 `. +` 合併注入 `plan_review`；v3 no-op；migration 後**全部 v2 頂層欄位**（`session_id`/`updated_at`/`review_mode`/`has_code_change`/`has_doc_change`/`code_review`/`doc_review`/**`precommit`**/`aggregate_gate`/root `iteration_history`）語意等價，**`schema_version` 單獨斷言 2→3**（NFR-7 Signal 4） |
| **Unit** | MCP routing | `## Plan Review`+`✅ Plan Ready` → pass；`+⛔ Plan Blocked` → fail；`+[PLAN_REVIEW_DEGRADED]`（**`grep -F` literal**）→ degraded；`+[PLAN_REVIEW_SKIPPED]` → skipped；**`## Plan Review`+`⚠️ Plan Needs Human`（無 token）不得標 degraded**（literal-match regression）；實測 `printf '✅ Plan Ready' \| grep -qE '✅ Ready'` = SAFE 斷言；doc/code branch 不回歸 |
| **Unit** | stop-guard 隔離 | **主**：`⛔ Plan Blocked` 不觸發 `REVIEW_BLOCKED`（`⛔.*Block` regex）→ 不誤判 code/doc FAIL；`✅ Plan Ready` 不滿足 `REVIEW_PASSED`；plan pending → warn-only 不併入 aggregate |
| **Unit** | config 解析 | `## Plan Review Max Rounds` 覆寫 default 5（含 range 3-50 inclusive 邊界 + 超界 fallback + migration path 覆寫）；缺區塊 → fallback 5；**`## Plan Review: enabled` 為 model-read advisory，v1 無 hook 解析 → 無自動化測試（doc review 覆蓋）** |
| **Integration**（v1 deferred → pilot 手動） | skill loop（mock Codex） | P0/P1 → revise → re-review → `✅ Plan Ready` 收斂；max_rounds=5 未收斂 → `⚠️ Plan Needs Human`+殘餘 findings（Signal 2/7）。**As-built：skill 為 model-driven markdown，無法以 node:test 驅動 loop；v1 以 `test/skills/plan-review.test.js` 靜態結構斷言 + pilot 手動驗證取代** |
| **Integration**（v1 部分自動化） | bypass vs degrade（分離斷言） | `--skip-review` ≤1 輪跳出 → `[PLAN_REVIEW_SKIPPED]`+`skipped=true`（Signal 3）；mock reviewer offline/401/timeout → `[PLAN_REVIEW_DEGRADED]`+`status_reason=reviewer-unavailable` 不卡死（Signal 6）；兩者 sentinel/flag 不混用。**As-built：sentinel/state 語意（含不混用）已由 emit-plan-gate + hook routing unit tests 覆蓋；end-to-end skill 行為留 pilot** |
| **Integration**（v1 deferred → pilot 手動） | secret redaction | medium dummy（`password=hunter2dummy`）→ `maskMediumConfidence` `[REDACTED]` 後照送；high dummy（**regex-valid**：`sk-` + ≥20 字元、`ghp_` + 恰 36 字元、PEM header）→ `scanHighConfidence` truthy → fail-closed：plan **不外送** reviewer + `[PLAN_REVIEW_DEGRADED]`、`status_reason=secret-detected`，payload grep 無高敏 pattern（Signal 8/NFR-8）。**As-built：redaction contract 由 skill 結構測試靜態斷言；`security-redact.js` 自身既有測試；end-to-end fail-closed 行為留 pilot** |
| **Integration**（v1 已於 unit 層覆蓋） | 並行隔離 | 同 session 觸發 code-review + plan-review → 兩者 state 互不覆寫（Signal 4/NFR-7）。**As-built：雙向隔離由 `post-tool-review-state.test.js` unit fixtures 自動化覆蓋** |

Conventions 遵 [`rules/testing.md`](../../../rules/testing.md)：AAA、`assert/strict`、≤7 assertions/case、realistic data。Evidence 對應（Acceptance Signals 定義於 [1-requirements.md §8](./1-requirements.md)）：state / sentinel / gate / 隔離層 Signal 由 unit + 靜態結構自動化證據覆蓋（Evidence Model priority 1）；上表標記「v1 deferred → pilot 手動」的 end-to-end skill 行為面向，v1 以結構斷言 + pilot 手動驗證為證據（priority 2/3，pilot 期間補齊）。

**Doc link-check**：本 lifecycle doc 位於 depth 3（`docs/features/plan-review-loop/`），跨 repo-root 引用用 `../../../`。CI doc-link 檢查涵蓋本檔；已 spot-check `../../../rules/auto-loop.md`、`../../../hooks/post-tool-review-state.sh`、`../dual-reviewer/2-tech-spec.md` 均可解析。

## 7. Open Questions

### 7.1 Hard preconditions（gating W1+，必須先解）

| OQ | Question | Resolution path |
|----|----------|-----------------|
| OQ-Sx-2 | plan mode 內 MCP / Skill 是否可呼叫？ | **W0.1 smoke test**。不可用 → ⛔ A1 不成立，停工升 `⚠️ Plan Needs Human` |
| OQ-Sx-3 | `stop-guard.sh` 如何隔離 plan sentinel？ | **W0.2 設計定稿** → T4 實作 + 回歸斷言 |

### 7.2 已於本 spec 拍板（feasibility tech-spec disposition + 使用者決策）

| OQ | 決策 | 來源 |
|----|------|------|
| OQ-3 啟用光譜 | opt-in v1 → 2 週 pilot → opt-out（= feasibility default，使用者確認） | **使用者決策**（`/tech-spec` AskUserQuestion，2026-05-18） |
| OQ-7 dual-review | standard + deep 啟用 dual；quick 單 Codex（**覆寫** feasibility deep-only default） | **使用者決策**（`/tech-spec` AskUserQuestion，2026-05-18） |
| OQ-4 trail 訊噪比 | 預設 summary（rounds/findings/modified-sections）；`--verbose` round-by-round | feasibility default |
| OQ-6 state scope | per-plan reset；`history[]` 保留最近 5 筆 | feasibility default |
| OQ-10 預算配置點 | `auto-loop-project.md` 新增 `## Plan Review Max Rounds`，default 5 | feasibility default |
| OQ-Sx-4 tier 自動偵測 | default `standard`；`--quick`/`--deep` 顯式升降 | feasibility default |
| OQ-Sx-5 Codex framing | plan 作為 "candidate artifact to attack"，遵 `codex-invocation.md` | feasibility default |

### 7.3 Deferred to V2（不阻塞 v1）

| OQ | Question | 條件 |
|----|----------|------|
| OQ-9 | plateau / fingerprint 偵測 | 需 hook 端 fingerprint 儲存；v1 僅 max_rounds hard cap |
| OQ-Sx-1 | PreToolUse 攔截 `ExitPlanMode`（A1→A3 升級） | harness probe；成立則 v2 升 A3+B1+C2（state/tier 不變，僅加 hook tripwire） |

### 7.4 Pilot-revisit（v1 ship 後量測再定）

| 項目 | 量測訊號 |
|------|---------|
| OQ-3 opt-in → opt-out 升級時機 | 2 週 false-negative rate + 使用者摩擦回饋 |
| OQ-7 standard dual ROI | dual vs single 在短 plan 的邊際命中率；不符 ROI → 回退 deep-only |

## 8. References

- Canonical: [`./1-requirements.md`](./1-requirements.md), [`./0-feasibility-study.md`](./0-feasibility-study.md)
- Sibling lifecycle: [`docs/features/dual-reviewer/2-tech-spec.md`](../dual-reviewer/2-tech-spec.md), [`docs/features/codex-review-spec/1-requirements.md`](../codex-review-spec/1-requirements.md)
- Reused skills: [`skills/codex-brainstorm/SKILL.md`](../../../skills/codex-brainstorm/SKILL.md), [`skills/doc-review/SKILL.md`](../../../skills/doc-review/SKILL.md), [`skills/codex-code-review/SKILL.md`](../../../skills/codex-code-review/SKILL.md)
- Loop primitives: [`hooks/post-tool-review-state.sh`](../../../hooks/post-tool-review-state.sh), [`hooks/stop-guard.sh`](../../../hooks/stop-guard.sh), [`scripts/emit-review-gate.sh`](../../../scripts/emit-review-gate.sh)
- Rules: [`rules/auto-loop.md`](../../../rules/auto-loop.md), [`rules/codex-invocation.md`](../../../rules/codex-invocation.md), [`rules/auto-loop-project.md`](../../../rules/auto-loop-project.md), [`rules/docs-numbering.md`](../../../rules/docs-numbering.md), [`rules/testing.md`](../../../rules/testing.md), [`rules/security.md`](../../../rules/security.md)
- Codex feasibility debate threadId: `019e298f-3645-7801-b6ff-b60b8d1235e6`
