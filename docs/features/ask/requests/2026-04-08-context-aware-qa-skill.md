# Context-Aware Q&A Skill `/ask`

> **Created**: 2026-04-08
> **Status**: Pending
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

開發者在 sd0x-dev-flow 開發過程中，需要快速了解 codebase、git history、rules、docs、skills 等上下文資訊。現有 skill 要麼太重（`/deep-research`）要麼太專門（`/code-explore`、`/codex-explain`）。需要一個輕量級、通用型的 Q&A skill，能自動收集 context 並結合 conversation history 深度回答問題。

## Requirements

- 使用者透過 `/ask <question>` 觸發
- 自動偵測 session context（branch、changed files、feature、recent commits）
- LLM-inferred 問題意圖分類（code / git / docs / rules / skill / arch / multi）
- 根據意圖執行 per-intent context gathering pipeline
- 整合 conversation context，提供比直接問更深刻的回答
- 按需調用 sub-agent（max 2, complexity-based）
- 當問題更適合其他 skill 時，主動路由建議
- 嚴格 read-only，不觸發 auto-loop

## Scope

| Scope | Description |
|-------|-------------|
| In | SKILL.md + references + tests + catalog integration + CLAUDE.md / `.claude/CLAUDE.md` / `CLAUDE.template.md` 三檔更新 + README catalog 更新 |
| Out | 外部 API 整合、web research、code 修改功能 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/ask/SKILL.md` | New | Main skill definition（~120 lines） |
| `skills/ask/references/intent-patterns.md` | New | Intent classification 範例與邊界案例 |
| `skills/ask/references/routing-table.md` | New | Skill routing decision table |
| `test/skills/ask.test.js` | New | Skill lint + routing + provenance + read-only + path security tests |
| `docs/skill-catalog.yml` | Modify | Add `/ask` entry |
| `CLAUDE.md` | Modify | Add `/ask` to command table |
| `.claude/CLAUDE.md` | Modify | Add `/ask` to command table |
| `CLAUDE.template.md` | Modify | Add `/ask` to command table（3-file parity） |

## Acceptance Criteria

- [ ] SKILL.md 通過 `skill-lint.js` 所有 P0/P1/P2 checks
- [ ] Intent classification 涵蓋 7 個 intent types，每個有 per-intent context gathering pipeline
- [ ] Sub-agent dispatch 基於 complexity（simple: 0 agents、medium: 1、complex: 2 max）
- [ ] Skill routing：支援至少 8 個 route target（`/feature-dev`、`/codex-review-fast`、`/review-spec`、`/codex-review-doc`、`/bug-fix`、`/next-step`、`/deep-research`、`/code-explore`），路由建議含理由
- [ ] Source evidence 支援 3 種 type（file / commit / command），output 含 Sources table
- [ ] Read-only + path security：SKILL.md 含 prohibited git commands 清單、`allowed-tools` 無 Edit/Write；repo boundary enforcement + `.env`/`credentials.*`/`*secret*` skip patterns + output secret redaction
- [ ] Conversation context integration：reuse 先前 conversation 中的 active feature/file context 來豐富問題理解；當前 turn 有相關 prior context 時，Sources 中引用之
- [ ] Doc discovery 使用 feature-first 策略（`canonical_docs` → fallback glob）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | req-analyze + tech-spec completed |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Feature Context Resolution: [feature-context-resolution.md](../../../../skills/create-request/references/feature-context-resolution.md) — repointed 2026-08-11: the `/tech-spec` duplicate this line named was merged into this canonical copy
