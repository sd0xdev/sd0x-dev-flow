# Merge Prep v2 — Conflict Resolution Safety Enhancement

> **Created**: 2026-03-03
> **Status**: Pending
> **Priority**: P2
> **Tech Spec**: Pending
> **Source**: Codex Brainstorm Nash Equilibrium (2026-03-03)

## Background

現有 `merge-prep` skill 已有 4-pattern conflict classification（Iterative / Parallel / Hotfix / Doc add-add）和 pre-merge analysis 腳本（mid-to-high 成熟度）。onekey `deploy-to-test` skill 的實戰經驗揭示了一個常見 pitfall：整檔替換（`git checkout <branch> -- <file>`）會靜默覆蓋 target branch 上其他分支 merge 進來的功能。此增強將 block-level Edit 約束和 whole-file checkout safety check 加入現有流程。

## Requirements

- 增強現有 `skills/merge-prep/SKILL.md`，不建新 skill
- 現有 4-pattern classification 保持不變，新增以下 resolution guidance：
  - **Block-level Edit 優先策略**：衝突區塊用 Edit tool 逐塊解決，禁止整檔替換作為預設策略
  - **Whole-file checkout safety check**：`git log $(git merge-base <target> <source>)..<target> -- <file>` 確認 target 上無其他分支改動後，才允許整檔替換
  - **Safety rationale**：文檔化「為何禁止整檔替換」（整檔替換會覆蓋 target 上其他 merge 的功能）
- 新增 conflict resolution playbook（定位衝突 → 讀取上下文 → 解決策略建議 → 驗證無殘留 markers），以文檔指引呈現，不自動執行
- 維持 analysis-only 姿態（不做 auto merge/push）

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md Step 3 增強：resolution guidance + safety check + 執行流程 |
| Out | Auto merge/commit/push 功能、deploy pipeline 整合、新增 classification patterns |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/merge-prep/SKILL.md` | Modify | Step 3 增強 resolution safety guidance |

## Acceptance Criteria

- [ ] Block-level Edit 優先策略文檔化（含 "為何禁止整檔替換" 的安全說明）
- [ ] Whole-file checkout safety check 流程（git log 驗證 target 無其他分支改動才允許整檔替換）
- [ ] Conflict resolution playbook 文檔化（grep markers → read context → strategy suggestion → verify clean），不含自動執行
- [ ] 現有 4-pattern classification 未被修改或破壞
- [ ] 維持 analysis-only（不加入 auto merge/push 能力）
- [ ] `/skill-health-check` 全維度通過
- [ ] `/codex-review-doc` 通過

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | - | |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- Source: onekey `deploy-to-test` skill Step 4（衝突解決 safety patterns）
- Current: `skills/merge-prep/SKILL.md` Step 3（已有 4-pattern classification）
- Brainstorm threadId: `019cb1d4-8534-7932-bd24-6b3054091171`
- 均衡結論：Rank #3，S effort，scope 限定為 resolution safety
