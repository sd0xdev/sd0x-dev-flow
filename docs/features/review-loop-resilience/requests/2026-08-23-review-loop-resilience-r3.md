# Review Loop Resilience — r3 Skill 消費點接線

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-08-23
> **Status**: In Progress
> **Depends On**: [r1](./2026-08-23-review-loop-resilience-r1.md)、[r2](./2026-08-23-review-loop-resilience-r2.md)
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

中央契約（r1）與機械強制點（r2）就緒後，把各 family 的續審模板、首次分派／不可用分支與 frontmatter 接上新政策（tech spec T5＋T6）。

## Requirements

- `codex-code-review/SKILL.md` 分派改寫（priority 重排：repo 自有 `strict-reviewer` 先）
- 續審模板與活分支（plan／test／doc）改接新政策
- `doc-review`、`test-review` frontmatter 增補

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | Tech spec T5 清單表全部＋T6；coverage 別名聯集條款 |
| Out   | necessity-audit（v1 兩機制皆排除，檔案零變更）、`seek-verdict`、規則層（r1）、scripts（r2） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/codex-code-review/SKILL.md` | Modify | :202-204 改寫；priority table（strict-reviewer P2、toolkit P3＋call-site 明示）；Step 3 分支＋validator/dispatch 具名步驟 |
| `skills/doc-review/references/review-loop-doc.md` | Modify | 輪替條款指向中央契約 |
| `skills/plan-review/references/review-loop-plan.md` | Modify | 同上 |
| `skills/plan-review/SKILL.md` | Modify | :130-140 活分支改接新政策 |
| `skills/test-review/SKILL.md` | Modify | :52-58、:168-174 輪替條款；:92-104 活分支；frontmatter +`Task`+`Bash(node:*)` |
| `skills/test-review/references/codex-prompt-test-review.md`／`codex-prompt-ac-trace.md` | Modify | 續審模板輪替條款；ac-trace raw→公開映射句 |
| `skills/doc-review/SKILL.md` | Modify | 分派節接新政策；frontmatter +`Task`+`Bash(node:*)`；:69 段改寫 |

## Acceptance Criteria

- [x] `codex-code-review/SKILL.md` :202-204 原句移除，Codex-失敗分支＋validator／dispatch 具名步驟存在；priority 為 strict-reviewer（P2）→ toolkit（P3，call-site 明示 opus/high）
- [x] 續審模板 4 處（doc loop、plan loop、test SKILL 兩處）與 2 個 test prompt refs 各含指向中央契約的輪替條款
- [x] 活分支改接新政策：`plan-review/SKILL.md:130-140` 不再「nothing to degrade to」直接降級；`test-review/SKILL.md:92-104` 不再 Claude-only inconclusive；`doc-review/SKILL.md` 分派節含 fallback 分支
- [x] `doc-review`、`test-review` frontmatter 含 `Task` 與 `Bash(node:*)`；`doc-review` :69「刻意省略 node」段已按新事實改寫
- [x] coverage 別名聯集條款落地（不做破壞性正典化）；ac-trace raw→公開 sentinel 映射句存在
- [x] 各 family gate sentinels 一字不動（聯集條款除外）；`necessity-audit` 全部檔案零變更（`git diff --name-only` 驗證）
- [ ] Pass `/codex-review-doc`

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | Done   | 依 tech spec §3 對應段落實作 |
| Development | Done  | 7 檔消費點接線完成；necessity-audit 零變更（git diff --name-only 驗證） |
| Testing    | Done   | 契約測試消費點斷言綠；doc-review 17/17 綠（one-thread-per-batch 回歸） |
| Acceptance | In Progress | 待 gate（review/precommit）完成後勾銷 |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §3.2、§3.3、§5 T5/T6
- Sibling: [r1](./2026-08-23-review-loop-resilience-r1.md)、[r2](./2026-08-23-review-loop-resilience-r2.md)、[r4](./2026-08-23-review-loop-resilience-r4.md)
