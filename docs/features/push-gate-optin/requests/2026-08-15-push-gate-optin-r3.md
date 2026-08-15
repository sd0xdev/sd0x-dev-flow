# Pre-Push Gate: Push Authorization Contract When the Hook Is Absent (方案 A)

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: Pending
> **Note**: ⚠️ 契約變更已由使用者於 2026-08-15 明示核可（方案 A）。本單與 [r2](./2026-08-15-push-gate-optin-r2.md)、[r4](./2026-08-15-push-gate-optin-r4.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）
> **Priority**: P1
> **Tech Spec**: Pending（方案已定；範圍擴大再補）

## Background

`rules/git-workflow.md:14` 與 `rules/discretion.md` § Proposal Channel 現行敘述「`pre-push-gate.sh` 是 terminal credential，AskUserQuestion 僅為諮詢」。r2 把 hook 改成預設不裝之後，該 credential 預設不存在，因此必須明訂 hook 不在時由什麼授權推送。使用者已在三個方案中選定 **方案 A：hook 不在時 AskUserQuestion 即足夠**（B = 需明示旗標、C = 拒推受保護分支，均未採用）。

**原子發佈集（r2 + r3 + r4）**：分開落地，無論何種順序都留下不一致的中間態 —— r2 先落地，hook 預設消失但規則層仍宣稱它是 terminal credential，出現無授權依據的真空；本單先落地，README 宣告 `pre-push` 為 opt-in 但安裝器仍無條件安裝（`skills/codex-setup/SKILL.md:50,61`），文件與實作矛盾。r4 的下游轉述同樣無法靠排先後解決（見該單 Background）。約束是原子性而非先後，故 **r2、r3、r4 三單皆不使用 `Depends On`**，須一起合併；r1 為純缺陷修復，不受此約束。

README 的安裝面敘述**一半是生成的**：`README.md:50` 那列由 `scripts/generate-readme-catalog.js:244` 硬編產出（`:39` 的散文則為手寫），locale 鏡像再由 `/readme-i18n-sync` 自英文版傳播。只手改 README 會被下一次 `/update-readme` 蓋回去，故必須改產生器與其 fixtures。

`test/rules/discretion-tiers.test.js:144,253,258` 以斷言釘死現行措辭 —— 依 `rules/discretion.md`「the test fails on the removal by design」，更新該測試就是這道契約變更的人為煞車。

## Requirements

- 依方案 A 改述授權契約：hook 已安裝 → 它是 terminal credential；hook 未安裝 → AskUserQuestion 即為授權
- 敘述一律條件化，不得留下「`pre-push-gate.sh` 必然存在／必然是最終閘門」的無條件斷言
- 修正「install via `/install-scripts`」不實敘述（真正安裝 git hook 的是 `/codex-setup`）
- 六份 README 同步，且區分「預設安裝」與「opt-in」

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `rules/git-workflow.md`、`rules/discretion.md`（各含 `.claude/` 鏡像）、`skills/push-ci/SKILL.md` 全部無條件敘述、README ×6 全部相關敘述**及其產生器**、對應測試 |
| Out | `/codex-setup` 安裝行為（r2）；`scripts/pre-push-gate.sh` 本身（r1）；cookbook 與其他 feature 文件的轉述（r4） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `rules/git-workflow.md` + `.claude/rules/git-workflow.md` | Modify | `:14` Push safety 改述 + 安裝來源修正 + 方案 A |
| `rules/discretion.md` + `.claude/rules/discretion.md` | Modify | § Proposal Channel efficacy boundary：stronger mechanism 條件化 |
| `skills/push-ci/SKILL.md` | Modify | 五處無條件敘述：`:26`（Authorization 表）、`:32`（L1 列）、`:36`（Primary gate）、`:96`（pre-approval flow 標題）、`:104`（Phase 0 註記） |
| `test/skills/push-ci.test.js` | New | 目前不存在；CLAUDE.md 規則 5 要求 SKILL.md 對應測試 |
| `README.md` + 5 份 locale 鏡像 | Modify | 安裝段落、Harness 列、Defense-in-depth 列、Human-in-the-loop 列、enforcement 段、rules 總覽段 —— **以語意定位**，英文版行號僅為錨點（locale 行號不同） |
| `scripts/generate-readme-catalog.js` | Modify | `:244` 硬編「AGENTS.md kernel + git hooks」，是 `README.md:50` 的產生來源 |
| `test/scripts/generate-readme-catalog.test.js` | Modify | `:1741,2113` 兩處 fixture 釘住舊字串 |
| `test/rules/discretion-tiers.test.js` | Modify | `:144,253,258` 三條斷言隨契約更新 |

## Acceptance Criteria

- [ ] `rules/git-workflow.md` 與 `.claude/` 鏡像載明：hook 已安裝時為 terminal credential，未安裝時 AskUserQuestion 即為授權（方案 A），且安裝來源為 `/codex-setup`
- [ ] `rules/discretion.md` 與 `.claude/` 鏡像的 efficacy boundary 條件化改述，未留下「pre-push-gate 必然存在」的敘述
- [ ] `skills/push-ci/SKILL.md` **五處**（`:26,32,36,96,104`）全部條件化，skill 內部無自相矛盾，且不再宣稱 `/install-scripts` 安裝 hook
- [ ] 新增 `test/skills/push-ci.test.js`，同時釘住「hook 已安裝」與「hook 未安裝」兩個分支的授權敘述
- [ ] 六份 README 全部相關敘述同步且語意一致：安裝段落區分 `commit-msg` 預設安裝與 `pre-push` opt-in（不再以複數 "git hooks" 暗示兩者皆裝），其餘契約敘述（含 enforcement 段與 rules 總覽段的「git 層級護欄維持硬性」）一併條件化；**生成段落改在產生器**（`scripts/generate-readme-catalog.js:244` 與 fixtures `test/scripts/generate-readme-catalog.test.js:1741,2113`），改後 `node scripts/generate-readme-catalog.js --check` 退出 0，locale 再經 `/readme-i18n-sync` 傳播
- [ ] 本單與 r2、r4 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度
- [ ] `test/rules/discretion-tiers.test.js` 三條斷言更新，且仍以斷言釘住新契約（非刪除了事）
- [ ] 全 repo grep 確認 `rules/`、`skills/`、README 三處已無殘留的無條件終端確認敘述
- [ ] Pass `/codex-review-fast`（tier `thorough` —— push safety 屬 security 變更，Anchor Register #3）
- [ ] Pass `/precommit`
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 三方案提呈，使用者選定 A；doc review R2 補出 push-ci 漏兩處、README 漏三段；R3/R4 進一步釐清 r2/r3/r4 之間的約束是原子性而非先後 |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- 契約煞車：`rules/discretion.md` §「No register item may be re-labelled…That is a spec change requiring human approval **and** updating `test/rules/discretion-tiers.test.js`」
- 審查層級依據：`rules/auto-loop.md` § Tiers —— security 變更一律以 `thorough` 審
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)
- 同批單：[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)、[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)
