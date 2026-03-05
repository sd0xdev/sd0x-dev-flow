# Load PR Review Skill

> **Created**: 2026-03-04
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Source**: Best Practices Audit + Codex Brainstorm Nash Equilibrium (2026-03-04)

## Background

開發者收到 PR review feedback 後，必須在 GitHub 網頁和 terminal 之間反覆切換。現有 sd0x-dev-flow 無任何「載入 PR review comments 到 AI session」的能力，而業界工具（Copilot、Cursor）僅在各自平台內運作，無法跨工具整合。

## Requirements

- 建立新 skill `/load-pr-review`，將 GitHub PR review 建議載入 Claude Code session
- 使用 GraphQL `reviewThreads` 取得完整 thread 結構（含 `isResolved`、`isOutdated`）
- 三層互動模式：`summary`（預設）→ `plan`（分類策略）→ `fix`（guided 修復）
- Smart defaults：無參數自動偵測當前分支 PR、支援 PR# / URL 輸入
- Token budget 機制：預設載入 30 條 unresolved comments，防止 context 爆量
- 回寫功能（gated）：reply comment + resolve thread，dry-run first + AskUserQuestion 確認
- REST fallback：GraphQL 失敗時降級，顯示 degraded banner
- fix 模式整合 auto-loop（依變更類型：code → `/codex-review-fast` → `/precommit`；doc → `/codex-review-doc`）

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md + 1 JS script + 3 reference docs + command + tests |
| Out | Cross-repo fork PR、GitHub Actions 整合、自動 commit |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/load-pr-review/SKILL.md` | New | Orchestration workflow |
| `skills/load-pr-review/scripts/load-pr-review.js` | New | Data plane（fetch/normalize/digest/writeback） |
| `skills/load-pr-review/references/api-contract.md` | New | GraphQL query + REST fallback |
| `skills/load-pr-review/references/token-budget.md` | New | 截斷策略 |
| `skills/load-pr-review/references/writeback-guardrails.md` | New | 回寫安全規則 |
| `commands/load-pr-review.md` | New | Command + context block |
| `test/scripts/load-pr-review.test.js` | New | Unit tests |
| `CLAUDE.md` | Modify | Command Quick Reference 新增 |

## Acceptance Criteria

- [ ] PR auto-detect：無參數偵測當前分支 PR，支援 PR# / URL
- [ ] GraphQL fetch：正確取得 `reviewThreads` 含 `isResolved`、`isOutdated`
- [ ] REST fallback：GraphQL 失敗時降級 + degraded banner
- [ ] Token budget：預設 30 條，超出截斷 + metadata 顯示
- [ ] summary mode：顯示 unresolved threads table
- [ ] plan mode：依類型分類（code_change/doc_update/question/disagree/nit）
- [ ] fix mode：逐條修復 + auto-loop handoff
- [ ] writeback dry-run：輸出 reply + resolve 計劃
- [ ] writeback execute：AskUserQuestion gate + 逐條執行
- [ ] `/skill-health-check` 全維度通過
- [ ] `/codex-review-doc` 通過
- [ ] Unit test coverage: happy path + error + edge cases
- [ ] Context check: `!` PR context renders without permission prompt

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Best Practices Audit completed |
| Development | In Progress | Context check hotfix (jq→Go template) |
| Testing | In Progress | 18 new tests for error paths + edge cases |
| Acceptance | - | |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Best Practices threadId: `019cb6f0-0012-7b43-be4f-55073ad3c4aa`
- 均衡結論：GraphQL-centered + Tiered Interaction + Gated Writeback
- Industry sources: [gh-pr-review](https://github.com/agynio/gh-pr-review), [Anthropic /code-review](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md), [corylanou skill](https://gist.github.com/corylanou/a381082d38b693792eed659bcdab09d0)
