# Pre-Push Gate: Downstream Restatement Consistency Sweep

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: Pending
> **Note**: ⚠️ 本單與 [r2](./2026-08-15-push-gate-optin-r2.md)、[r3](./2026-08-15-push-gate-optin-r3.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）。工作**順序**上本單在 r2/r3 的編輯之後，但那是工作區內的先後，不是發佈先後 —— 故不使用 `Depends On`。跨 feature 修改需與 `create-pr-stacked` 進行中的工作協調
> **Priority**: P2
> **Tech Spec**: Pending（掃描型工作，無獨立設計）

## Background

方案 A 改變的是契約本體（`rules/`、`skills/push-ci/`、README —— 由 r3 負責），但 repo 內另有多份文件**轉述**該契約，且皆為無條件敘述。r3 落地後這些轉述會與契約矛盾。已確認涉及者：

| 文件 | 位置 | 現行無條件敘述 |
| ---- | ---- | -------------- |
| `docs/cookbook/ship-change.md` | `:32,38` | 「`/push-ci` warns and requires terminal confirmation」、「Terminal `/dev/tty` confirmation」 |
| `docs/features/create-pr-stacked/2-tech-spec.md` | `:20,37,53` | 把 `pre-push-gate.sh` 列為每次 push 的 policy gate 與 Anchor #4 例外的組成 |
| `docs/features/create-pr-stacked/1-requirements.md` | `:38` | 「push 是其獨佔授權工作流；stacked 模式任何 push 需求都必須經過它或維持 dry-run」 |
| `docs/features/readme-catalog-sync/2-tech-spec.md` | `:145` | 「`/codex-setup init` … AGENTS.md kernel + git hooks」—— 安裝面轉述，複數 hooks |

`create-pr-stacked` 的兩張 request（`2026-07-31-stacked-pr-mode-r1/r2.md`）目前皆為 **In Progress** —— 動它的 current-authority 文件必須與該 feature 的進行中工作協調，不可逕行改寫。

**與 r2/r3 的原子性約束**：本單不能靠排先後解決。先於 r2+r3 落地，是用舊實作描述新契約；後於它們落地，則兩次發佈之間留著與新契約矛盾的 current-authority 文件。任何一種順序都留下不一致的中間態，故 **r2、r3、r4 必須一起合併**；r1 為純缺陷修復，不受此約束，可獨立落地。

## Requirements

- 掃描 `docs/` 全域，找出所有轉述推送授權契約的無條件敘述
- 只修正 **current-authority** 文件；**記錄類文件一律不動**
- 跨 feature 的修改先協調再落地

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `docs/cookbook/`、`docs/features/*/` 的生命週期檔（`0-`～`4-`）中轉述本契約之處 |
| Out | `rules/`、`skills/push-ci/`、README ×6（皆屬 r3，不重複認領）；`/codex-setup`（r2）；`scripts/pre-push-gate.sh`（r1） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `docs/cookbook/ship-change.md` | Modify | `:32,38` 條件化 |
| `docs/features/create-pr-stacked/2-tech-spec.md` | Modify | `:20,37,53`；需與該 feature 進行中工作協調 |
| `docs/features/create-pr-stacked/1-requirements.md` | Modify | `:38` 同 feature 對應敘述 |
| `docs/features/readme-catalog-sync/2-tech-spec.md` | Modify | `:145` 安裝面轉述（複數 "git hooks"） |
| `docs/features/{upgrade-doctor,hook-lightweighting,cross-tool-portability,harness-engineering-rebrand}/` | Review | 生命週期檔涉及 pre-push 敘述，逐份判定是否為 current-authority |

## Acceptance Criteria

- [ ] `docs/cookbook/ship-change.md:32,38` 條件化，不再無條件宣稱終端確認為最終閘門
- [ ] `create-pr-stacked` 的 `2-tech-spec.md:20,37,53` 與 `1-requirements.md` 對應敘述條件化，且落地前已與該 feature 兩張 In Progress request 協調（協調結果記入本單 Progress）
- [ ] `docs/features/readme-catalog-sync/2-tech-spec.md:145` 的安裝面轉述改為區分預設安裝與 opt-in
- [ ] 其餘 `docs/features/*/` 生命週期檔逐份判定並修正：已知候選為 upgrade-doctor、hook-lightweighting、cross-tool-portability、harness-engineering-rebrand
- [ ] **記錄類文件（`requests/`、`review-log-*`、`adr-*`）一律未被修改** —— 記錄與後續變更脫節是記錄正常運作，改寫會摧毀記錄（`@rules/docs-numbering.md` § Size Limit、`skills/update-docs/SKILL.md` § Step 1.5）
- [ ] 收尾 grep 證明 `docs/` 已無殘留敘述，**兩類都要掃**：無條件的終端確認宣稱，以及暗示兩個 hook 皆預設安裝的安裝面轉述；該命令寫入本單供複核
- [ ] 本單與 r2、r3 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 doc review R2 指出三張單的聯集不完整。掃描結果：cookbook 與 create-pr-stacked（含 `1-requirements.md:38`）為確認命中，R3 再補出 `readme-catalog-sync/2-tech-spec.md:145`；另有四個 feature 目錄待逐份判定是否為 current-authority |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- 記錄豁免依據：`skills/update-docs/SKILL.md` § Step 1.5 —— doc sync 不觸碰 request ticket
- 前置單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)、[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)
