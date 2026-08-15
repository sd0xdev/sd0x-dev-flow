# Universal Refactor v1 — Code + Doc Orchestrator

> **Created**: 2026-04-03
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

sd0x-dev-flow 現有 3 個重構 skill（`/simplify`、`/doc-refactor`、`/de-ai-flavor`），各自只處理單一目標類型。使用者不知道該用哪個、無法端對端重構、且無自動 smell 偵測。v1 建立 orchestrator skill 統一 code + doc 重構，最大化復用現有 skill（71% 直接復用）。

## Requirements

- 建立 `/refactor` skill（orchestrator 模式，非重新實作重構邏輯）
- 自動偵測目標類型（code vs doc-structure vs doc-ai）→ dispatch 到對應 skill
- Code targets: `/simplify` + behavioral equivalence gate（`/verify fast` exit code 比較）+ `/codex-review-fast`
- Doc targets: `/doc-refactor` 或 `/de-ai-flavor`（AI artifact 3+ matches heuristic）+ `/codex-review-doc`
- `--target <path>` 明確指定模式 + `--auto` 簡化 target selection（inline metrics + git history）
- Incremental loop 逐步處理多目標，budget tracking + skip-and-report
- Path validation: 拒絕 absolute paths、`..` traversal、symlink escape
- 4 reference files: catalog (R01-R09)、target-detection、behavioral-gate、output-template

## Scope

| Scope | Description |
|-------|-------------|
| In | Code refactoring dispatch（`/simplify`）、Doc refactoring dispatch（`/doc-refactor` + `/de-ai-flavor`）、Behavioral gate、Incremental loop、`--target` mode、`--auto` mode（simplified target selection）、Path validation、Contract tests |
| Out | Config/Shell/Test refactoring（v2）、Phase 1 parallel exploration（v2）、`/pre-pr-audit` final gate（v2）、Git stash-based rollback（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/refactor/SKILL.md` | New | Orchestrator 主流程（Phase 0 + 2 + 3） |
| `commands/refactor.md` | New | Command dispatcher |
| `skills/refactor/references/refactor-catalog.md` | New | v1 重構類型分類 (R01-R09) |
| `skills/refactor/references/target-detection.md` | New | 檔案類型偵測 + path validation |
| `skills/refactor/references/behavioral-gate.md` | New | /verify exit code 比較 protocol |
| `skills/refactor/references/output-template.md` | New | 報告格式 |
| `test/commands/refactor.test.js` | New | Contract tests |
| `commands/simplify.md` | Reference | Code dispatch target |
| `commands/doc-refactor.md` | Reference | Doc-structure dispatch target |
| `commands/de-ai-flavor.md` | Reference | Doc-AI dispatch target (command surface) |
| `skills/de-ai-flavor/SKILL.md` | Reference | Doc-AI detection rules (3+ matches heuristic) |
| `commands/verify.md` | Reference | Behavioral gate dependency |
| `commands/codex-review-fast.md` | Reference | Code review auto-loop dependency |
| `commands/codex-review-doc.md` | Reference | Doc review auto-loop dependency |
| `commands/project-audit.md` | Reference | `--auto` mode Phase 0/3 delta dependency |

## Acceptance Criteria

- [x] `skills/refactor/SKILL.md` 建立，包含 Phase 0（target detection）→ Phase 2（incremental loop）→ Phase 3（delta report）workflow
- [ ] `commands/refactor.md` 正確 dispatch 到 SKILL.md
- [x] 4 reference files 建立（refactor-catalog、target-detection、behavioral-gate、output-template）
- [x] `--target <path>` code target 正確 dispatch 到 `/simplify` + `/verify fast` behavioral gate + `/codex-review-fast`；path validation 拒絕 absolute paths、`..` traversal、symlink escape
- [x] `--target <path>` doc target 正確 dispatch 到 `/doc-refactor` 或 `/de-ai-flavor`（AI artifact 3+ matches heuristic）+ `/codex-review-doc`（不經 `/verify`）
- [x] Behavioral gate：`/verify fast` exit code 比較（PRESERVED / BEHAVIOR_CHANGED / BASELINE_FAILING / NO_TESTS sentinels）；code baseline failing → skip
- [x] `--auto` mode：inline target selection（complexity + change frequency + isolation signals）→ priority queue → Phase 0 `/project-audit` baseline + Phase 3 delta report
- [x] Incremental loop 處理多目標：budget tracking（max-targets）+ skip-and-report on gate failure
- [x] `test/commands/refactor.test.js` contract tests 通過（target detection、gate definitions、dispatch mapping、path validation）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | 2 rounds /deep-research + /tech-spec + /codex-review-doc (4 rounds, ✅ Mergeable) |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 8/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) — Codex reviewed (threadId: `019d51a8-3e08-7992-91fc-4ed862fa1f3c`)
- Deep Research Round 1: 通用重構模式、現有能力盤點、業界實踐
- Deep Research Round 2: Skill 疊加策略、composition matrix
- Design Principle: Compose, don't replace — 71% 復用現有 skill
