# Test Patterns Reference

## Integration Test Patterns

### Controller + Service Integration

```typescript
// test/integration/feature/feature-api.integration.test.ts
import { Application, Framework } from '{FRAMEWORK_WEB}';
import { close, createApp } from '{FRAMEWORK_MOCK_LIB}';
import { ITestRequester, createRequester } from '../../createRequester';
import { TestEnvironment, onlyIf } from '../../helper/test-env';

const describeIntegration = onlyIf([
  TestEnvironment.INTEGRATION,
  TestEnvironment.E2E,
]);

describeIntegration('Feature API Integration', () => {
  let app: Application;
  let request: ITestRequester;

  beforeAll(async () => {
    app = await createApp<Framework>();
    request = await createRequester(app);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('POST /api/feature', () => {
    it('should return success for valid input', async () => {
      const response = await request
        .post('/api/feature')
        .send({ data: 'test' });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return error for invalid input', async () => {
      const response = await request.post('/api/feature').send({});
      expect(response.status).toBe(400);
    });
  });
});
```

### Service Layer Integration

```typescript
// test/integration/service/feature.service.integration.test.ts
describeIntegration('FeatureService Integration', () => {
  let app: Application;
  let featureService: FeatureService;

  beforeAll(async () => {
    app = await createApp<Framework>();
    featureService = await app.getApplicationContext().getAsync(FeatureService);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('processData', () => {
    it('should process data correctly with real dependencies', async () => {
      const result = await featureService.processData({ input: 'test' });
      expect(result).toBeDefined();
    });
  });
});
```

## E2E Test Patterns

### Complete Flow E2E

```typescript
// test/e2e/feature/feature-complete-flow.e2e.test.ts
import { Application, Framework } from '{FRAMEWORK_WEB}';
import { close, createApp } from '{FRAMEWORK_MOCK_LIB}';
import { ITestRequester, createRequester } from '../../createRequester';
import { TestEnvironment, onlyIf } from '../../helper/test-env';

const describeE2E = onlyIf([TestEnvironment.E2E]);

describeE2E('Feature Complete Flow E2E', () => {
  let app: Application;
  let request: ITestRequester;

  beforeAll(async () => {
    app = await createApp<Framework>();
    request = await createRequester(app);
  }, 60000); // E2E 可能需要更長 timeout

  afterAll(async () => {
    await close(app);
  });

  describe('Complete user journey', () => {
    it('should complete full workflow', async () => {
      // Step 1: Create
      const createRes = await request
        .post('/api/feature')
        .send({ name: 'test' });
      expect(createRes.status).toBe(200);
      const id = createRes.body.data.id;

      // Step 2: Query
      const queryRes = await request.get(`/api/feature/${id}`);
      expect(queryRes.status).toBe(200);
      expect(queryRes.body.data.name).toBe('test');

      // Step 3: Update
      const updateRes = await request
        .put(`/api/feature/${id}`)
        .send({ name: 'updated' });
      expect(updateRes.status).toBe(200);

      // Step 4: Verify
      const verifyRes = await request.get(`/api/feature/${id}`);
      expect(verifyRes.body.data.name).toBe('updated');
    });
  });
});
```

### Scheduled Job E2E

```typescript
// test/e2e/jobs/feature-job.e2e.test.ts
describeE2E('Feature Job E2E', () => {
  let app: Application;
  let jobService: FeatureJobService;

  beforeAll(async () => {
    app = await createApp<Framework>();
    jobService = await app.getApplicationContext().getAsync(FeatureJobService);
  });

  afterAll(async () => {
    await close(app);
  });

  describe('Job execution', () => {
    it('should execute job and persist results', async () => {
      // Execute job
      await jobService.execute();

      // Verify results persisted
      const results = await queryDatabase();
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
```

## Mock Patterns

### Mock External Services (Integration only)

```typescript
// Integration test 可以 mock 外部服務
jest.mock('../../../src/service/external.service', () => ({
  ExternalService: jest.fn().mockImplementation(() => ({
    fetchData: jest.fn().mockResolvedValue({ data: 'mocked' }),
  })),
}));
```

### E2E - No Mocks

```typescript
// E2E test 禁止 mock，使用真實服務
// 如果外部服務不可用，使用 skip
const skipIfNoExternalService = process.env.EXTERNAL_SERVICE_URL
  ? describe
  : describe.skip;

skipIfNoExternalService('External integration', () => {
  // ...
});
```

## Test Data Patterns

### Test Fixtures

```typescript
const testFixtures = {
  validAccount: '0x76f3f64cb3cD19debEE51436dF630a342B736C24'.toLowerCase(),
  validId: 'example-id-1',
  validToken: '0x4d224452801ACEd8B2F0aebE155379bb5D594381'.toLowerCase(),
};
```

### Cleanup

```typescript
afterEach(async () => {
  // Clean up test data
  await cleanupTestData();
});
```

## Timeout Recommendations

| 測試類型    | 建議 Timeout     |
| ----------- | ---------------- |
| Unit        | 5000ms (default) |
| Integration | 30000ms          |
| E2E         | 60000ms          |

```typescript
// 設定 timeout
beforeAll(async () => {
  // ...
}, 30000);

it('slow test', async () => {
  // ...
}, 60000);
```
