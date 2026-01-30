---
name: test-review
description: Test review knowledge base. Covers test coverage review, test generation, coverage analysis.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Test Review Skill

## Trigger

- Keywords: 測試覆蓋, test review, 測試夠不夠, 生成測試, test gen, coverage, 覆蓋率

## When NOT to Use

- 代碼審查（用 codex-code-review）
- 文件審查（用 doc-review）
- 只是想跑測試（用 `/verify`）

## Commands

| 命令                 | 說明             | 適用場景     |
| -------------------- | ---------------- | ------------ |
| `/codex-test-review` | 審查測試是否足夠 | **必做**     |
| `/codex-test-gen`    | 生成單元測試     | 補測試       |
| `/check-coverage`    | 測試覆蓋率分析   | 功能開發完成 |

## Workflow

```
讀取測試 → 對照源碼 → 評估覆蓋 → 輸出缺口 + Gate
```

## Review Dimensions

| 維度        | 評分標準                     | 權重 |
| ----------- | ---------------------------- | ---- |
| 正向路徑    | 所有 public 方法、主要流程   | 高   |
| 錯誤處理    | try/catch、error callback    | 高   |
| 邊界條件    | null/undefined、極值、空集合 | 中   |
| Mock 合理性 | 不過度、不不足               | 中   |

## Verification

- 覆蓋評估包含所有維度
- Gate 明確（✅ 測試充足 / ⛔ 需補充）
- 缺失測試有具體建議

## Three-Layer Tests

| Type        | Directory           | Mock      | Focus        |
| ----------- | ------------------- | --------- | ------------ |
| Unit        | `test/unit/`        | ✅ 充分   | 單一函數邏輯 |
| Integration | `test/integration/` | ⚠️ 僅外部 | 模組間互動   |
| E2E         | `test/e2e/`         | ❌ 禁止   | 完整流程     |

## Common Boundaries

| Type   | Cases                                            |
| ------ | ------------------------------------------------ |
| String | `""`, `" "`, `null`, `undefined`, 超長字串       |
| Number | `0`, `-1`, `NaN`, `Infinity`, `MAX_SAFE_INTEGER` |
| Array  | `[]`, `[null]`, 超大陣列, 嵌套陣列               |
| Object | `{}`, `null`, 循環引用                           |

## Examples

```
輸入：這個 service 的測試夠嗎？
動作：/codex-test-review → 評估覆蓋 → 輸出缺口 + Gate
```

```
輸入：幫這個函數補測試
動作：/codex-test-gen → 生成 AAA 模式測試 → /codex-test-review
```
