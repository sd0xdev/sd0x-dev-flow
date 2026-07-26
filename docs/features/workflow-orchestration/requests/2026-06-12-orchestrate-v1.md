# Workflow Orchestration — V1 Report-only `/orchestrate` 全量實作

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md`.
> **Created**: 2026-06-12
> **Status**: Candidate Complete
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

實作 workflow-orchestration v1（Option C 兩平面，report-only）：`/orchestrate` skill——意圖 → planner agent（Explore，admission 約束）產出隨 repo 狀態變動的計畫 → preview 人核 → read-only fanout → pre/post 無變更驗證（fail-closed）→ 主 session 寫報告走既有 doc review loop。control-plane run-state（`.claude_workflows/<run-id>.json`，gitignored）與 hook 獨佔的 safety plane 完全分離；**v1 零 orchestrate hook 變更**（scoped 證明見 AC-6）。工作分解依 tech-spec §5 W1–W5。

## Requirements

- W1 `plan-context.js` — catalog（98 筆，含 `/orchestrate` 自身；`use_when` 選填 → description fallback）+ agents frontmatter + repo 信號 + admission 標記 + budget tier fail-closed（超量/缺檔/allowlist 缺失一律 exit 1）
- W2 `validate-plan.js` — v1 admission controller：lint 規則 A1-A4 / G1-G2 / O1 / B1 / S1 / SCHEMA，全 fail-closed
- W3 `run-verify.js` — snapshot/compare：HEAD、branch、porcelain `-uall` hash、tracked/untracked content hash、refs hash、local config hash、worktree、stash；dirty-baseline「無新 drift」語意（含已 dirty 檔內容再變動的攔截）
- W4 skill — `skills/orchestrate/SKILL.md`（baseline 時序不變量 / 輸出隔離契約 / done 唯一路徑 = doc review ✅ / resume fail-closed / redaction 完整 contract）+ references（planner-prompt / plan-schema / execution-policy / admission-allowlist）+ `.gitignore` 加 `.claude_workflows/`（hard precondition）
- W5 登錄 — `docs/skill-catalog.yml`（planning）+ 3 份 CLAUDE quick-ref row

## Scope

| Scope | Description |
|-------|-------------|
| In  | 3 個 scripts + 測試；`/orchestrate` skill + 4 references；`.gitignore`；catalog/CLAUDE 登錄；對應 unit tests |
| Out | Mutation 編排（v2，護欄 (1)-(7) + Spike 2/3）；hook 變更（orchestrate 範圍零 diff，見 AC-6）；`safety_epoch`；compaction hook resume；FR-10 計畫保存重用 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/orchestrate/scripts/plan-context.js` | New | 確定性 planner 輸入組裝（fail-closed） |
| `skills/orchestrate/scripts/validate-plan.js` | New | Plan lint = v1 admission controller |
| `skills/orchestrate/scripts/run-verify.js` | New | pre/post 無變更驗證（9 檢查項，含內容 hash 面） |
| `skills/orchestrate/SKILL.md` | New | Skill 主文件 |
| `skills/orchestrate/references/planner-prompt.md` | New | Planner 獨立推導契約 |
| `skills/orchestrate/references/plan-schema.md` | New | Plan JSON schema 正典 |
| `skills/orchestrate/references/execution-policy.md` | New | 執行政策（backend/波次/fail-closed 矩陣） |
| `skills/orchestrate/references/admission-allowlist.json` | New | Fanout allowlist（Explore + performance-optimizer；排除名單記錄） |
| `.gitignore` | Modify | 加 `.claude_workflows/`（hard precondition，先於 run-state 寫入路徑） |
| `docs/skill-catalog.yml` | Modify | `/orchestrate` planning category 登錄 |
| `CLAUDE.template.md` / `CLAUDE.md` / `.claude/CLAUDE.md` | Modify | `/orchestrate` quick-ref row |
| `test/scripts/orchestrate-plan-context.test.js` | New | W1 測試 |
| `test/scripts/orchestrate-validate-plan.test.js` | New | W2 測試 |
| `test/scripts/orchestrate-run-verify.test.js` | New | W3 測試 |
| `test/skills/orchestrate.test.js` | New | Skill 結構 + allowlist-frontmatter 鎖定 + 兩平面隔離 |

## Acceptance Criteria

- [x] `plan-context.js`：dummy catalog entry 自動入候選（SC-5/FR-11）；budget 超量、catalog/agents/allowlist 缺檔或解析失敗（含 malformed 行、未知 category、agent 缺 frontmatter）→ 一律 exit 1；`use_when` 缺漏 → SKILL.md description fallback（T1）
- [x] `validate-plan.js`：A1 非名單 fanout 拒、A3 mutating 非 proposed-manual 拒、A4 幻覺 main-skill target 拒、G1/G2 gate 完備性（Signal 2）、O1 缺 why 拒（Signal 6）、B1 budget 上限（非數值亦拒）、S1 sentinel 禁字、SCHEMA id 唯一/depends_on 存在——各規則違規 exit 1 + 規則代碼（T2）
- [x] `run-verify.js`：commit / 切 branch / 新增 untracked / 再改已 dirty tracked 或 untracked 檔內容 / 打 tag / 改 local config / stash / 開 worktree 各類 drift → compare exit 1 列 drift 欄位；乾淨、dirty-baseline 無新 drift、gitignored run-state 合法寫入 → exit 0（SC-2/T3）
- [x] allowlist：僅 `Explore` + `performance-optimizer`；repo-agent entry 與 frontmatter `tools` 一致（鎖定測試）；`coverage-analyst`/`git-investigator` 斷言不在名單
- [x] SKILL.md 結構：禁 hook sentinel（`## Gate:`、bare `✅ Ready`/`✅ Mergeable`/`⛔ Blocked`/`✅ All Pass`）；含 baseline 時序不變量與「done 唯一路徑 = doc review ✅ Mergeable」字句；references 存在
- [x] 兩平面隔離：`git check-ignore .claude_workflows/foo.json` 通過；run-state schema 無 safety 欄位；零 orchestrate hook 變更（`grep -ri orchestrate hooks/` 為空；本 worktree 現存 hooks diff 屬 plan-review-loop ticket 範圍，非本 ticket 變更）
- [x] 登錄完成：catalog + 3 份 CLAUDE quick-ref（claude-md-coverage 既有測試通過）
- [x] Pass /codex-review-fast + /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech spec 定案（doc review 3 輪 → ✅ Mergeable：baseline 時序不變量、allowlist 收窄至 2 entries、resume fail-closed、refs/config hash 驗證面擴充） |
| Development | Done | 3 scripts + skill + 4 references + 登錄完成；code review 收斂（Codex 4 輪 → Ready 0 findings；secondary 雙輪 READY）；P1 修復含 tracked/untracked content hash（9 檢查項）與 strict catalog parse |
| Testing | Done | 59 項 orchestrate 測試全綠（plan-context 14 / validate-plan 16 / run-verify 15 / skill 結構 14，另既有 fast suite 全綠）；precommit-fast PASS；adequacy gate ✅ Adequate（AC trace 7/7 COVERED，0 exceptions）。驗證指令：`node --test test/scripts/orchestrate-*.test.js test/skills/orchestrate.test.js`（2026-06-12 本機 59 pass / 0 fail；測試需可寫 temp dir，唯讀 sandbox 僅能靜態計數） |
| Acceptance | Done | 全部 AC 勾選有測試證據（heuristic + Codex AC-trace 驗證）；未跑 `--verify-ac` 故 Status 取 Candidate Complete |

## References

- Tech Spec: [../2-tech-spec.md](../2-tech-spec.md) §3.3 T1–T4, §5 W1–W5, §6 測試映射
- Requirements: [../1-requirements.md](../1-requirements.md) FR-1/2/3/4/5/6/8/11, NFR-1/2/3/4/6
- Feasibility: [../0-feasibility-study.md](../0-feasibility-study.md) Option C 決策 + §7 v1 範圍
