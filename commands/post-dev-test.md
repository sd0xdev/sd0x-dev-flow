---
description: 開發後測試補全。分析已開發功能，檢查 integration/e2e 覆蓋，不足則撰寫補充。
argument-hint: [--type integration|e2e] [--dry-run]
allowed-tools: Read, Grep, Glob, Write, Bash
skills: post-dev-test
---

## Context

- Git status: !`git status -sb`
- Recent changes: !`git diff --name-only HEAD~5 2>/dev/null | grep -E '^src/' | head -10`
- Existing integration tests: !`ls test/integration/ 2>/dev/null | head -5`
- Existing e2e tests: !`ls test/e2e/ 2>/dev/null | head -5`

## Task

根據對話上下文，分析已開發的功能，檢查 integration/e2e 測試覆蓋，不足則撰寫補充。

### Arguments

```
$ARGUMENTS
```

| 參數                      | 說明                           |
| ------------------------- | ------------------------------ |
| `--type integration\|e2e` | 指定測試類型（預設兩者都檢查） |
| `--dry-run`               | 只分析不寫入                   |

### 執行指引

遵循 skill 中的 5 階段流程：

| Phase | 動作                               |
| ----- | ---------------------------------- |
| 1     | 分析對話上下文，識別開發的功能     |
| 2     | 搜尋現有 integration/e2e 測試覆蓋  |
| 3     | 決定測試策略（參考測試類型對照表） |
| 4     | 撰寫缺失的測試                     |
| 5     | 執行測試驗證                       |

### 參考

| 檔案                                                      | 用途         |
| --------------------------------------------------------- | ------------ |
| @skills/post-dev-test/SKILL.md                    | 完整流程     |
| @skills/post-dev-test/references/test-patterns.md | 測試模式參考 |
| @rules/testing.md                                 | 測試規則     |

## Output

```markdown
## 測試補全報告

### 分析的功能

- 功能名稱：<從上下文識別>
- 涉及模組：<Service / Provider / Controller>
- 代碼變更：✅ 有變更 / ❌ 無變更

### 現有覆蓋

| 測試類型    | 檔案 | 覆蓋狀態 |
| ----------- | ---- | -------- |
| Integration | ...  | ✅/❌    |
| E2E         | ...  | ✅/❌    |

### 新增測試

| 檔案路徑             | 類型        | 覆蓋場景 |
| -------------------- | ----------- | -------- |
| test/integration/... | Integration | ...      |
| test/e2e/...         | E2E         | ...      |

### 執行結果

✅ 所有測試通過 / ❌ 有失敗（詳見下方）

> ⚠️ 即使覆蓋完整，有代碼變更時仍須執行測試確認無 regression
```

## Examples

```bash
# 自動分析並補全測試
/post-dev-test

# 只補 e2e 測試
/post-dev-test --type e2e

# 只分析不寫入
/post-dev-test --dry-run
```

## Workflow Position

```
/feature-dev → /verify → /codex-review-fast → /post-dev-test → /precommit
                                                    ↑
                                              （你在這裡）
```
