---
name: bug-fix
description: Bug/Issue 修復流程。調查 → 定位 → 修復 → 測試 → 審查。
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git:*), Bash(yarn:*), Bash(gh:*)
---

# Bug Fix Skill

## Trigger

- Keywords: bug, issue, 修復, fix, 錯誤, 壞掉, 失敗

## When NOT to Use

- 新功能開發（用 feature-dev）
- 只是想了解代碼（用 code-explore）

## Workflow

```
調查 ──→ 定位 ──→ 修復 ──→ 測試 ──→ 審查
  │        │        │        │        │
  ▼        ▼        ▼        ▼        ▼
gh issue  Grep    Edit    寫測試   /codex-review-fast
/git-inv  Read            /verify  /precommit
```

## Phase 1: 調查

| 來源         | 動作                     |
| ------------ | ------------------------ |
| GitHub Issue | `gh issue view <number>` |
| 錯誤訊息     | `Grep("error message")`  |
| 代碼歷史     | `/git-investigate`       |

**輸出根因分析**：

- 問題位置：`src/xxx.ts:123`
- 根本原因：<具體原因>
- 影響範圍：<哪些功能受影響>

## Phase 2: 修復

| 原則         | 說明                   |
| ------------ | ---------------------- |
| 最小修改     | 只改必要的部分         |
| 不引入新問題 | 確認改動不影響其他功能 |

## Phase 3: 補充測試 ⚠️

**Bug 修復必須有對應層級的測試**

| Bug 類型     | 必須        | 建議        |
| ------------ | ----------- | ----------- |
| 邏輯錯誤     | Unit        | -           |
| Service 問題 | Unit        | Integration |
| API 問題     | Integration | E2E         |
| 用戶流程     | E2E         | -           |

詳細指引：[testing-guide.md](./references/testing-guide.md)

## Phase 4: 審查

```bash
/verify              # 跑測試
/codex-review-fast   # 代碼審查
/codex-test-review   # 測試審查
/precommit           # 提交前檢查
```

## Review Loop

**⚠️ 遵循 @rules/auto-loop.md**

```
修復 → 審查 → 有問題 → 再修 → ... → ✅ Pass
```

## Verification

- [ ] 問題已確認修復
- [ ] 對應層級測試已撰寫
- [ ] 所有測試通過
- [ ] 代碼審查通過（Gate ✅）

## Examples

```
輸入：修復 issue #123 - 計算錯誤
動作：gh issue view → 定位 → 修復 → 寫 Unit Test → /verify → /codex-review-fast
```

```
輸入：API 回傳 500 錯誤
動作：Grep 錯誤 → 讀代碼 → 修復 → 寫 Integration Test → /verify → /codex-review-fast
```
