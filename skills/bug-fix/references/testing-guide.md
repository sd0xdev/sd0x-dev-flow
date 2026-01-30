# Bug Fix 測試指引

## 測試層級要求

| Bug 類型               | 必須補充         | 建議補充         | 說明                         |
| ---------------------- | ---------------- | ---------------- | ---------------------------- |
| 邏輯錯誤（計算、條件） | Unit Test        | -                | 直接測試函數輸入輸出         |
| Service 互動問題       | Unit Test        | Integration Test | Mock 依賴，測試 Service 行為 |
| API 端點問題           | Integration Test | E2E Test         | 測試完整 HTTP 請求響應       |
| 跨服務/資料流問題      | Integration Test | E2E Test         | 測試多個 Service 協作        |
| 用戶流程問題           | E2E Test         | -                | 模擬完整用戶操作             |

## 測試檔案對應

```
src/service/xxx.ts       → test/unit/service/xxx.test.ts
src/provider/xxx.ts      → test/unit/provider/xxx.test.ts
src/controller/xxx.ts    → test/integration/controller/xxx.test.ts
用戶流程                  → test/e2e/xxx.test.ts
```

## 測試範例

### Unit Test

```typescript
// test/unit/service/fee.test.ts
describe('issue #123 regression - calculateFee', () => {
  it('should return 0 when token is null', () => {
    const result = calculateFee(null);
    expect(result).toBe(0);
  });

  it('should handle empty string', () => {
    const result = calculateFee('');
    expect(result).toBe(0);
  });
});
```

### Integration Test

```typescript
// test/integration/controller/transfer.test.ts
describe('POST /api/transfer (issue #123)', () => {
  it('should return 400 when token is missing', async () => {
    const res = await request(app).post('/api/transfer').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('token');
  });

  it('should return 400 when token is empty', async () => {
    const res = await request(app).post('/api/transfer').send({ token: '' });

    expect(res.status).toBe(400);
  });
});
```

### E2E Test

```typescript
// test/e2e/transfer-flow.test.ts
describe('Transfer flow (issue #123)', () => {
  it('should show error message for invalid input', async () => {
    // 1. 設置測試環境
    // 2. 模擬用戶操作
    // 3. 驗證錯誤訊息顯示
  });
});
```

## 檢查清單

### 必要檢查

- [ ] **Unit Test**：修復的函數/方法有測試
- [ ] **邊界條件**：null、undefined、空字串、空陣列
- [ ] **極值**：0、負數、最大值、最小值
- [ ] **錯誤路徑**：異常情況的處理

### 視情況補充

- [ ] **Integration Test**：受影響的 API 有測試
- [ ] **E2E Test**：受影響的用戶流程有測試
- [ ] **效能測試**：如果 Bug 與效能相關

## 命名規範

測試描述應包含 Issue 編號，方便追溯：

```typescript
describe('issue #123 regression - <功能描述>', () => {
  // ...
});
```

## 執行測試

```bash
# 單元測試
yarn test:unit

# 整合測試（單檔）
TEST_ENV=integration yarn jest test/integration/xxx.test.ts

# E2E 測試（單檔）
TEST_ENV=e2e yarn jest test/e2e/xxx.test.ts
```
