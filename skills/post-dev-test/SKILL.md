---
name: post-dev-test
description: Post-development test completion. Analyzes developed features from context, checks integration/e2e test coverage, writes missing tests. Use after feature-dev, before /precommit.
allowed-tools: Read, Grep, Glob, Write, Bash
---

# Post-Dev Test Skill

## Trigger

- Keywords: 補測試, 整合測試, e2e 測試, integration test, 測試覆蓋, 開發後測試, post dev test

## When to Use

- 完成功能開發後，/precommit 之前
- 想確保新功能有足夠的 integration/e2e 覆蓋
- Unit test 已有，但缺少更高層級測試

## ⚠️ 關鍵規則：變更必執行

**即使測試覆蓋看起來完整，只要有代碼變更就必須執行測試。**

| 情境             | 動作                         |
| ---------------- | ---------------------------- |
| 有代碼變更       | 必須執行相關 integration/e2e |
| 測試已存在且完整 | 仍然執行，確認無 regression  |
| 測試不存在或不足 | 撰寫後執行                   |
| 純文檔/註解變更  | 可跳過                       |

**原因**：測試覆蓋 ≠ 測試通過。現有測試可能因代碼變更而失敗。

## When NOT to Use

- 只需要 unit test（用 `/codex-test-gen`）
- 審查現有測試（用 `/codex-test-review`）
- 還在開發中（先完成 `/feature-dev` 流程）

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: 分析上下文                                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. 從對話歷史識別：開發了什麼功能？                               │
│ 2. 識別涉及的 Service / Provider / Controller                    │
│ 3. 列出核心流程和 API 端點                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: 檢查現有測試覆蓋                                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. 搜尋 test/integration/ 相關測試                               │
│ 2. 搜尋 test/e2e/ 相關測試                                       │
│ 3. 評估覆蓋缺口                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: 決定測試策略                                            │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────┬────────────────────────────────────────────┐   │
│ │ 變更類型     │ 測試需求                                   │   │
│ ├──────────────┼────────────────────────────────────────────┤   │
│ │ 新 API 端點  │ Integration test (Controller + Service)    │   │
│ │ 新 Service   │ Integration test (Service 層)              │   │
│ │ 跨服務流程   │ E2E test (完整流程)                        │   │
│ │ 資料庫操作   │ Integration test (實際 DB)                 │   │
│ │ 外部 API     │ Integration test (Mock 外部)               │   │
│ └──────────────┴────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: 撰寫測試                                                │
├─────────────────────────────────────────────────────────────────┤
│ 1. 參考現有測試模式                                              │
│ 2. 使用 {FRAMEWORK_MOCK_LIB} 的 createApp / createRequester           │
│ 3. 遵循 TEST_ENV 環境變數規範                                    │
│ 4. 寫入對應目錄                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 5: 執行驗證                                                │
├─────────────────────────────────────────────────────────────────┤
│ 1. 執行新增的測試                                                │
│ 2. 確認通過                                                      │
│ 3. 報告結果                                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Test File Conventions

| 類型        | 目錄                | 命名                                   | 環境變數               |
| ----------- | ------------------- | -------------------------------------- | ---------------------- |
| Integration | `test/integration/` | `*.integration.test.ts` 或 `*.test.ts` | `TEST_ENV=integration` |
| E2E         | `test/e2e/`         | `*.e2e.test.ts` 或 `*.test.ts`         | `TEST_ENV=e2e`         |

## Test Template

```typescript
import { Application, Framework } from '{FRAMEWORK_WEB}';
import { close, createApp } from '{FRAMEWORK_MOCK_LIB}';
import { ITestRequester, createRequester } from '../../createRequester';
import { TestEnvironment, onlyIf } from '../../helper/test-env';

const describeIntegration = onlyIf([
  TestEnvironment.INTEGRATION,
  TestEnvironment.E2E,
]);

describeIntegration('Feature Integration Tests', () => {
  let app: Application;
  let request: ITestRequester;

  beforeAll(async () => {
    app = await createApp<Framework>();
    request = await createRequester(app);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('Scenario: ...', () => {
    it('should ...', async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

## Verification

- [ ] 測試檔案在正確目錄
- [ ] 使用正確的 TEST_ENV 條件
- [ ] 測試可獨立執行
- [ ] 覆蓋主要流程 + 錯誤情境

## Execute Tests

```bash
# 執行單一 integration test
TEST_ENV=integration yarn jest test/integration/path/to/test.ts

# 執行單一 e2e test
TEST_ENV=e2e yarn jest test/e2e/path/to/test.ts
```

## Examples

```
輸入：（對話中已開發 User Authentication 功能）
Phase 1: 識別涉及 ActiveAssetsWeeklyService, ActiveAssetsCacheService
Phase 2: 搜尋 test/e2e/auth/ → 發現缺少 login 測試
Phase 3: 決定寫 E2E test（跨服務流程）
Phase 4: 撰寫 active-assets-weekly.e2e.test.ts
Phase 5: 執行測試並驗證通過
```

```
輸入：（對話中已開發新 API 端點）
Phase 1: 識別 Controller + Service
Phase 2: 搜尋 test/integration/controller/ → 無對應測試
Phase 3: 決定寫 Integration test
Phase 4: 撰寫 new-feature.integration.test.ts
Phase 5: 執行測試並驗證通過
```

## References

- `references/test-patterns.md` - 現有測試模式參考
