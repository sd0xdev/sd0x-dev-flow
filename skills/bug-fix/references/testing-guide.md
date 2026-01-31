# Bug Fix Testing Guide

## Test Level Requirements

| Bug Type                      | Must Add         | Recommended      | Description                          |
| ----------------------------- | ---------------- | ---------------- | ------------------------------------ |
| Logic error (calculation, condition) | Unit Test | -                | Directly test function input/output  |
| Service interaction issue     | Unit Test        | Integration Test | Mock dependencies, test Service behavior |
| API endpoint issue            | Integration Test | E2E Test         | Test complete HTTP request/response  |
| Cross-service/data flow issue | Integration Test | E2E Test         | Test multiple Service collaboration  |
| User flow issue               | E2E Test         | -                | Simulate complete user operations    |

## Test File Mapping

```
src/service/xxx.ts       → test/unit/service/xxx.test.ts
src/provider/xxx.ts      → test/unit/provider/xxx.test.ts
src/controller/xxx.ts    → test/integration/controller/xxx.test.ts
User flow                → test/e2e/xxx.test.ts
```

## Test Examples

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
    // 1. Set up test environment
    // 2. Simulate user operations
    // 3. Verify error message display
  });
});
```

## Checklist

### Required Checks

- [ ] **Unit Test**: Function/method being fixed has tests
- [ ] **Boundary conditions**: null, undefined, empty string, empty array
- [ ] **Extreme values**: 0, negative numbers, max value, min value
- [ ] **Error paths**: Exception handling

### Add As Needed

- [ ] **Integration Test**: Affected APIs have tests
- [ ] **E2E Test**: Affected user flows have tests
- [ ] **Performance test**: If the bug is performance-related

## Naming Convention

Test descriptions should include the issue number for traceability:

```typescript
describe('issue #123 regression - <feature description>', () => {
  // ...
});
```

## Running Tests

```bash
# Unit tests
yarn test:unit

# Integration test (single file)
TEST_ENV=integration yarn jest test/integration/xxx.test.ts

# E2E test (single file)
TEST_ENV=e2e yarn jest test/e2e/xxx.test.ts
```
