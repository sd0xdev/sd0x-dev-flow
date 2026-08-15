# Pre-Push Gate: Fix `/dev/tty` Detection and Install Guidance

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: 2026-08-15
> **Status**: Pending
> **Note**: r2/r3/r4 構成一個原子發佈集（opt-in 生命週期 + 授權契約 + 下游轉述，三單須一起合併）。本單為純缺陷修復，不屬該集合，可獨立落地
> **Priority**: P1
> **Tech Spec**: Pending（缺陷明確，直接實作；範圍擴大再補）

## Background

`scripts/pre-push-gate.sh:107` 以 `[ ! -c /dev/tty ]` 判斷有無終端機。2026-08-15 於背景 session 實測：device node 存在但**開不起來**（`/dev/tty: Device not configured`），此判斷未攔截，控制流落到 `:117` 的 `read`，`CONFIRM` 保持空字串，最終印出 `pre-push-gate: Push aborted by user.` —— 沒有任何人中止過。行為本身 fail-closed 正確（退出碼 1，推送被擋），但**診斷訊息說謊**，會把「環境無終端機」誤導成「使用者拒絕」，操作者據此採取的復原動作會是錯的。

同檔 `:3` 宣稱「Install as git pre-push hook via `/install-scripts`」為不實敘述：`/install-scripts` 只把腳本複製到 `.claude/scripts/`，實際接上 git hook 的是 `/codex-setup` Phase 3（`skills/codex-setup/SKILL.md:50,61`）。

## Requirements

- 以實際開啟 file descriptor 取代 `[ -c ]` 字元裝置檢查，作為終端機可用性的判準
- 「無終端機」與「使用者輸入非 yes」必須印出可區分的訊息，兩者皆維持非零退出
- 修正檔頭安裝指引，指向真正安裝 hook 的來源

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | `scripts/pre-push-gate.sh` 的 tty 偵測與檔頭註解、對應 regression test |
| Out | hook 安裝生命週期（r2）；`rules/`／`skills/push-ci/`／README 的授權契約敘述（r3）；cookbook 與其他 feature 文件的轉述（r4） |

## Related Files

| File | Action | Description |
| -------------------- | ------ | -------------------- |
| `scripts/pre-push-gate.sh` | Modify | `:3` 安裝指引修正；`:107-123` tty 偵測改為開 fd，訊息分流 |
| `test/scripts/pre-push-gate.test.js` | Modify | 現有 9 條之外補雙向 regression |

## Acceptance Criteria

- [ ] tty 偵測改以實際開啟 fd 判定（`exec 3</dev/tty` 或等效），開不起來即走「無終端機」分支
- [ ] 「無終端機」訊息不再包含 `aborted by user` 字樣，且明示成因為環境無互動終端
- [ ] 「使用者輸入非 yes」仍印出中止訊息；兩條路徑退出碼皆為非零（fail-closed 不變）
- [ ] `scripts/pre-push-gate.sh:3` 指向 `/codex-setup`（及手動 `cp` 備援），不再宣稱 `/install-scripts`
- [ ] regression test 雙向覆蓋（@rules/testing.md § Conventions 的 Guards 列）：無終端機 → 走無終端機分支並印正確訊息；有終端機且輸入 `yes` → 放行且退出碼 0
- [ ] 第三條 regression：有終端機但輸入非 `yes` → 印使用者中止訊息、不含無終端機診斷、退出碼非零（現有 9 條測試無任何一條斷言此訊息）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 2026-08-15 背景 session 實測重現；缺陷定位於 `:107` 落穿至 `:117` |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

## References

- 缺陷首次觀測：2026-08-15 `/push-ci` 於背景 session 推送 `main` 被擋，訊息誤報 aborted by user
- 腳本引入 commit：`6370ad3` — feat: Adds defense-in-depth push safety with git pre-push hook
- 姊妹單：[r2 — `/codex-setup` opt-in 生命週期](./2026-08-15-push-gate-optin-r2.md)
- 姊妹單：[r3 — 推送授權契約（方案 A）](./2026-08-15-push-gate-optin-r3.md)
- 姊妹單：[r4 — 下游轉述一致性掃描](./2026-08-15-push-gate-optin-r4.md)
