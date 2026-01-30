---
name: feature-dev
description: Feature development workflow. Covers implementation, verification, pre-commit checks, refactoring. Guides through design → implement → verify → review → commit flow.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Feature Development Skill

## Trigger

- Keywords: 開發功能, 實作, 寫代碼, verify, precommit, 提交, 重構, simplify

## When NOT to Use

- 只是想了解代碼（用 Explore）
- 審核代碼（用 codex-code-review）
- 審核文件（用 doc-review）
- 測試相關（用 test-review）

## Workflow

```
需求 → 設計 → 實作 → 測試 → 審查 → 提交
        │        │        │        │        │
        ▼        ▼        ▼        ▼        ▼
   /codex-     /codex-  /verify  /codex-  /precommit
   architect   implement         review-fast
```

## Commands

| 階段 | 命令                 | 說明                    |
| ---- | -------------------- | ----------------------- |
| 設計 | `/codex-architect`   | 獲取架構建議            |
| 實作 | `/codex-implement`   | Codex 寫代碼            |
| 驗證 | `/verify`            | 跑測試驗證              |
| 審查 | `/codex-review-fast` | 代碼審查                |
| 提交 | `/precommit`         | lint + typecheck + test |
| 重構 | `/simplify`          | 收尾重構                |

## Verification

- 所有測試通過
- lint + typecheck 無錯誤
- 代碼審查通過（Gate ✅）

## Testing Requirements

| 變更類型              | 測試要求                        |
| --------------------- | ------------------------------- |
| 新增 Service/Provider | 必須有對應 unit test            |
| 修改現有邏輯          | 確保現有測試通過 + 新邏輯有測試 |
| 修復 Bug              | 必須加 regression test          |

## Test File Mapping

```
src/service/xxx.service.ts       → test/unit/service/xxx.service.test.ts
src/provider/evm/parser.ts       → test/unit/provider/evm/parser.test.ts
src/controller/xxx.controller.ts → test/integration/controller/xxx.test.ts
```

## Review Loop

**⚠️ MUST re-review after fix until ✅ PASS**

```
Review → 有問題 → Fix → Re-review → ... → ✅ Pass → Done
```

## Examples

```
輸入：幫我實作一個計算手續費的方法
動作：/codex-architect → /codex-implement → /verify → /codex-review-fast → /precommit
```

```
輸入：這段代碼需要重構
動作：/simplify → 精簡代碼、消除重複 → /codex-review-fast
```
