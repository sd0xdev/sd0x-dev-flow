# Plan Review Loop — V1 A1+B1+C2 全量實作

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md`.
> **Created**: 2026-06-12
> **Status**: Done
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

實作 plan-review-loop v1（A1+B1+C2）：skill 驅動的 `/plan-review` 對抗式計畫審查迴圈，在 plan mode 中於 `ExitPlanMode` 前讓 Codex 攻擊 plan 草稿並迭代收斂。State 以 namespaced `plan_review.*` subtree 存於 `.claude_review_state.json`（schema v2→v3 additive migration），與 code/doc/aggregate 平面完全隔離（NFR-7）；deep tier 委派 `/codex-brainstorm`。工作分解依 tech-spec §5 W0–W4。

## Requirements

- W1 state 基建 — `plan_review` 欄位 init + schema v2→v3 migration + `_read_project_plan_max_rounds`（`## Plan Review Max Rounds`，default 5）
- W2 gate 通道 — `scripts/emit-plan-gate.sh`（6 gates + tier/reason 參數）+ hook parse 分支 + MCP Priority 1.5 routing（`## Plan Review` discriminator）+ stop-guard plan sentinel 隔離（transcript grep filter + warn-only advisory）
- W3 skill — `skills/plan-review/SKILL.md` + `references/codex-prompt-plan.md`（candidate-artifact framing + 獨立研究指令）+ `references/review-loop-plan.md`（codex-reply VERIFY-not-CONFIRM）
- W4 設定與文件 — `rules/auto-loop.md` plan sentinel rows、`rules/auto-loop-project.md` 兩個 opt-in 區段、3 份 CLAUDE quick-ref row、`docs/skill-catalog.yml` 登錄

## Scope

| Scope | Description |
|-------|-------------|
| In  | `plan_review` state subtree（init/migration/update/iteration）；`emit-plan-gate.sh` + hook parse；MCP plan routing；stop-guard 隔離（warn-only）；`/plan-review` skill + 2 references；rules/CLAUDE/catalog 登錄；對應 unit tests |
| Out | Hook 強制 enabled-but-unexecuted 偵測（v2）；plateau/fingerprint 收斂偵測（OQ-9, v2）；ExitPlanMode hook 攔截（A2，已否決）；aggregate_gate 整合 plan 平面 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/emit-plan-gate.sh` | New | PLAN_REVIEW_GATE sentinel emitter（PENDING tier / DEGRADED reason 驗證） |
| `hooks/post-tool-review-state.sh` | Modify | plan_review init + v2→v3 migration + `update_plan_state` + `_update_plan_iteration` + emit-plan-gate parse + MCP Priority 1.5 routing |
| `hooks/stop-guard.sh` | Modify | transcript grep plan sentinel 過濾（×3 處）+ plan pending warn-only advisory |
| `skills/plan-review/SKILL.md` | New | Skill 主文件（tier ladder / redaction contract / convergence / degradation） |
| `skills/plan-review/references/codex-prompt-plan.md` | New | Codex 首輪 prompt 模板 |
| `skills/plan-review/references/review-loop-plan.md` | New | codex-reply 複審模板 |
| `.claude/skills/plan-review/**` | New | Install-visible path（經 `.claude/skills -> ../skills` symlink 可見，非獨立複本） |
| `rules/auto-loop.md` | Modify | Standard Gate Sentinels 表 + plan namespace isolation note |
| `rules/auto-loop-project.md` | Modify | `## Plan Review` + `## Plan Review Max Rounds` opt-in 區段 |
| `CLAUDE.template.md` / `CLAUDE.md` / `.claude/CLAUDE.md` | Modify | `/plan-review` quick-ref row |
| `docs/skill-catalog.yml` | Modify | `/plan-review` review category 登錄 |
| `test/scripts/emit-plan-gate.test.js` | New | 6 gates + tier/reason 驗證 + 拒絕非法參數 |
| `test/hooks/post-tool-review-state.test.js` | Modify | migration v2→v3 / update_plan_state 各 gate / plan iteration / MCP plan routing / 隔離雙向 |
| `test/hooks/stop-guard.test.js` | Modify | plan sentinel 不觸發 code 評估 + plan pending warn-only |
| `test/skills/plan-review.test.js` | New | SKILL.md 結構 + sentinel 約束 + references 存在 |

## Acceptance Criteria

- [x] `emit-plan-gate.sh` 對 6 個 gate 輸出 `PLAN_REVIEW_GATE=<GATE>`；PENDING 接受 tier、DEGRADED 接受 reason、其餘拒絕額外參數；非法值 exit 1（FR-6/T3）
- [x] State schema v2→v3 additive migration：v2 檔案升級後保留既有 code/doc 欄位且新增完整 `plan_review` default subtree；v3 重跑 no-op；ver>3 / 非數字 warn skip（B1/T3）
- [x] `update_plan_state` 六種 gate 語意符合 T3（PENDING reset cycle、terminal gates 寫 history FIFO last-5、DEGRADED/SKIPPED 帶 status_reason），且不觸碰 `code_review`/`doc_review`/`aggregate_gate`/root `iteration_history`（NFR-7 方向一）
- [x] MCP Priority 1.5 routing：`## Plan Review` + `✅ Plan Ready`/`⛔ Plan Blocked`/`[PLAN_REVIEW_DEGRADED]`/`[PLAN_REVIEW_SKIPPED]` 正確更新 plan 平面；`⚠️ Plan Needs Human`（無 token）不誤觸任何分支；`✅ Plan Ready` 不誤觸 code review `✅ Ready` 分支（collision regression）
- [x] stop-guard：transcript 含 `⛔ Plan Blocked` 不產生 code/doc BLOCKED 誤判；plan pending（executed=true, passed/degraded/skipped 皆 false）僅 stderr warn、不加入 MISSING/blocking（NFR-7 方向二 + T4）
- [x] `## Plan Review Max Rounds` 設定可覆寫 plan max_rounds（default 5, range 3-50），且與 `## Max Rounds`（code/doc, default 10）互不干擾
- [x] `/plan-review` skill 結構通過 skills-schema 驗證；references 存在；prompt 模板含獨立研究指令 + plan sentinel 約束 + 禁用 bare `✅ Ready`/`✅ Mergeable`/`## Gate:`（rules/codex-invocation.md 合規）
- [x] Pass /codex-review-fast + /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech spec §3–§6 定案；W0.1 spike（plan mode 工具可用性）via claude-code-guide agent 確認 A1 可行 |
| Development | Done | W1/W2/W3/W4 完成。Review 迭代追加：token-first + BLOCKED-first 路由、`update_plan_verdict`（MCP no-history，history 由 emit-plan-gate Bash 路徑獨佔）、`update_plan_state` history_mode 參數、migration fail-closed（非數字/>3 全 writer skip）、`status_reason=needs-human` 終態、`_update_plan_iteration` init-on-missing、stop-guard `_strip_plan_sentinels` substring strip（取代整行 grep -v） |
| Testing | Done | 4 個測試檔（emit-plan-gate 11、hook plan 區段、stop-guard plan T4/pending、skill 結構 17+）；AC trace gap closure（migration subtree 形狀、max rounds 邊界 3/50、override 流經 migration path）；stub/real divergence guard。全套 1495 pass / 0 fail |
| Acceptance | Done | Codex dual review ✅（多輪收斂）+ Secondary ×3 READY；/codex-test-review --ac-trace：✅ Adequate（gaps 清空）；/precommit-fast ✅ All Pass ×2 |

## References

- Tech Spec: [../2-tech-spec.md](../2-tech-spec.md) §3.3 T1–T4, §5 W0–W4, §6 測試映射
- Requirements: [../1-requirements.md](../1-requirements.md) FR-6/FR-9/FR-14, NFR-3/NFR-4/NFR-5/NFR-7/NFR-8
- Feasibility: [../0-feasibility-study.md](../0-feasibility-study.md) A1+B1+C2 決策
- Test evidence: [`test/scripts/emit-plan-gate.test.js`](../../../../test/scripts/emit-plan-gate.test.js)、[`test/hooks/post-tool-review-state.test.js`](../../../../test/hooks/post-tool-review-state.test.js)（plan 區段）、[`test/hooks/stop-guard.test.js`](../../../../test/hooks/stop-guard.test.js)（plan T4/pending）、[`test/skills/plan-review.test.js`](../../../../test/skills/plan-review.test.js)
