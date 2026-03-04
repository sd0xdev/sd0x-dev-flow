# Pre-flight Diagnostics

> **Created**: 2026-03-04
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Source**: Best Practices Audit + Codex Brainstorm (threadId: `019cb7cb-f464-75b2-ba9b-231ecded04d8`)

## Background

`/smart-commit` 缺乏對 git identity、commit signing、AI guard hook 的 pre-flight 檢查。多 profile 環境下 identity 可能被誤用，signing 設定不一致導致混合簽名/未簽名 commit，使用者也無法得知 commit-msg hook 是否已安裝。

## Requirements

- 新增 **Step 1c Identity Diagnostics**：`git config --show-origin --show-scope --get-all user.name/email` + 環境變數檢查；缺失時 HALT、衝突時 AskUserQuestion、CI/headless 衝突 fail-closed
- 新增 **Step 1d Signing Diagnostics**：偵測 `commit.gpgsign`、`user.signingkey`、`gpg.format`，在 commit plan 中顯示簽名狀態
- 新增 **Step 1e AI Guard Readiness**：偵測 `core.hooksPath` + hook 可執行性，顯示 guard 狀態
- **Commit Plan 摘要增強**：顯示 Author、Signing、AI guard 三行 metadata
- **Context Block 更新**：`commands/smart-commit.md` 加入 identity + signing context

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md Step 1c/1d/1e 新增、commit plan 增強、command context block 更新 |
| Out | Runtime validation（R2）、signing flags（R3）、測試（R3） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/smart-commit/SKILL.md` | Modify | 新增 Step 1c Identity Diagnostics |
| `skills/smart-commit/SKILL.md` | Modify | 新增 Step 1d Signing Diagnostics |
| `skills/smart-commit/SKILL.md` | Modify | 新增 Step 1e AI Guard Readiness |
| `skills/smart-commit/SKILL.md` | Modify | Commit plan 摘要加入 Author/Signing/Guard |
| `commands/smart-commit.md` | Modify | Context block 加入 identity/signing 資訊 |

## Acceptance Criteria

- [x] Identity 正常解析（單一值）→ 靜默繼續，commit plan 顯示 identity
- [x] Identity 缺失 → HALT + `git config --local` 設定指引
- [x] Identity 衝突（不同值）→ AskUserQuestion 列出候選
- [x] CI/headless + identity 衝突 → fail-closed HALT（不靜默繼承）
- [x] `GIT_AUTHOR_NAME`/`GIT_COMMITTER_*` 環境變數存在時 → 優先採用環境變數，commit plan 顯示 `(env override)`
- [x] Signing 已啟用 + key 存在 → 顯示 `Signing: enabled`
- [x] Signing 已啟用 + key 缺失 → ⚠️ 警告
- [x] AI guard hook 已安裝 → 顯示 `AI guard: active`
- [x] AI guard hook 未安裝 → ⚠️ 建議安裝（非阻擋）
- [x] AI guard hook 存在但不可執行 → ⚠️ 警告 + `chmod +x` 修復指引
- [x] Commit plan 含 Author/Signing/AI guard metadata
- [x] `/codex-review-doc` 通過

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Tech spec + Codex review 完成 |
| Development | Done | W1 identity、W2 signing、W3 AI guard、W7 commit plan、W9 context block 完成 |
| Testing | Done | `/codex-review-doc` + `/codex-review-fast` + `/precommit` 通過 |
| Acceptance | Done | 12/12 AC 全部通過 |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) § 3.2, 3.3, 3.4, 3.7
- Debate threadId: `019cb7cb-f464-75b2-ba9b-231ecded04d8`
- Industry: [Git includeIf](https://kothar.net/blog/2025/directory-targeted-git-config), [GitHub Signing](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
- Work Items: W1, W2, W3, W7, W9
