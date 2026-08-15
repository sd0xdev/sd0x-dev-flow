# Pre-Push Gate: Make Hook Install Opt-In Across the `/codex-setup` Lifecycle

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: Pending
> **Note**: ⚠️ 本單與 [r3](./2026-08-15-push-gate-optin-r3.md)、[r4](./2026-08-15-push-gate-optin-r4.md) **同屬一個原子發佈集**，三單必須一起合併（見 Background）。刻意不使用 `Depends On`：那表達的是先後，而此處的約束是原子性。r1 為純缺陷修復，不受此約束
> **Priority**: P1
> **Tech Spec**: Pending（方案已定；範圍擴大再補）

## Background

`/codex-setup` Phase 3 目前**無條件**安裝 `commit-msg` 與 `pre-push` 兩個 git hook（`skills/codex-setup/SKILL.md:50,61`）。使用者要求 `pre-push` 改為預設不裝、明示要求才裝。（順帶一提，`/install-scripts` 從未接上 git hook，它只把腳本複製到 `.claude/scripts/`；repo 多處宣稱由它安裝為不實敘述，該部分由 r1 與 r3 分頭修正。）

opt-in 不是只改安裝那一步：`/codex-setup` 有 `init` / `doctor` / `sync` 三個 subcommand（`:18-20`），後兩者會各自推翻 opt-in ——

| Subcommand | 現行行為 | 對 opt-in 的破壞 |
| ---------- | -------- | ---------------- |
| `doctor` | 「Hooks installed → 檔案不存在即 Fail」（`:117`） | 刻意不裝 `pre-push` 會被判成安裝損壞 |
| `sync` | 「Re-copy hook scripts (overwrite if changed)」（`:126`） | 未經新的明示要求就把 `pre-push` 裝回去 |

因此 opt-in 必須以**完整狀態機**定義，而非單點修改 Phase 3。

**原子發佈集（r2 + r3 + r4）**：分開落地，無論何種順序都留下不一致的中間態 —— 本單先落地，hook 預設消失但規則層仍宣稱它是 terminal credential，出現無授權依據的真空；r3 先落地，README 宣告 `pre-push` 為 opt-in 但安裝器仍無條件安裝（`skills/codex-setup/SKILL.md:50,61`），文件與實作矛盾。r4 的下游轉述同樣無法靠排先後解決（見該單 Background）。因此 **r2、r3、r4 三單須同批落地**，而非排先後。

## Requirements

- `pre-push` 改為 opt-in；`commit-msg` 維持預設安裝（它守護 attribution anchor，且不阻擋非互動作業）
- `init` / `sync` / `doctor` 三條路徑對「刻意未安裝」與「已安裝」皆給出一致且可預期的行為
- `install-state.json` 需能區分這兩種狀態，供 `sync` 與 `doctor` 判讀
- 升級既有專案不得靜默移除已安裝的 `pre-push` hook

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `skills/codex-setup/SKILL.md` 的 init/sync/doctor/state 四處、`test/skills/codex-setup.test.js` |
| Out | `scripts/pre-push-gate.sh` 本身（r1）；`rules/`、`skills/push-ci/`、README 的授權契約敘述（r3）；cookbook 與其他 feature 文件的轉述（r4）；`/install-scripts` 的複製行為不變 |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `skills/codex-setup/SKILL.md` | Modify | `:48-62` Phase 3 opt-in；`:76-98` Phase 5 state；`:108-121` doctor；`:123-128` sync |
| `test/skills/codex-setup.test.js` | New | 目前不存在；CLAUDE.md 規則 5 要求 SKILL.md 對應測試 |

## Acceptance Criteria

- [ ] `init` 預設只安裝 `commit-msg`；`pre-push` 需明示 opt-in，且 SKILL.md 指名該 opt-in 介面（旗標或詢問，擇一寫定）
- [ ] Phase 5 `install-state.json` 以明確狀態區分「刻意未安裝」與「已安裝」，非以欄位缺漏表示
- [ ] `sync` 在 `pre-push` 未安裝時不得安裝它；已安裝時照常更新且不移除
- [ ] `doctor` 對刻意未安裝的 `pre-push` 回報健康（不列為 Missing/Fail）；已安裝時維持現行存在性檢查（`:117` 目前只驗存在，雜湊比對僅適用 AGENTS.md `:115`，本單不新增 hook 雜湊驗證）
- [ ] `test/skills/codex-setup.test.js` 覆蓋五種狀態轉移：`init` 無 opt-in、`init` 明示 opt-in、`sync` 於未安裝時、`sync` 於已安裝時、`doctor` 於兩種狀態
- [ ] 本單與 r3、r4 於**同一批**落地（同一組 commit / 同一次合併），三者不得分開釋出 —— 分開落地即為缺陷，不是進度
- [ ] Pass `/codex-review-fast`（tier `thorough` —— push safety 屬 security 變更，Anchor Register #3）
- [ ] Pass `/precommit`
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 追出真正安裝路徑為 `/codex-setup` Phase 3；doc review 補出 sync/doctor 兩條會推翻 opt-in 的路徑 |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- 審查層級依據：`rules/auto-loop.md` § Tiers —— security 變更一律以 `thorough` 審
- 姊妹單：[r1 — `/dev/tty` 偵測與安裝指引修復](./2026-08-15-push-gate-optin-r1.md)
- 同批單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)、[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)
