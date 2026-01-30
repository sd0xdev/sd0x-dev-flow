# Request Document Operations

## Quick Operations

### Create New Request

```bash
# Create file
touch docs/features/{feature}/requests/$(date +%Y-%m-%d)-title.md
```

### Find Requests

```bash
# All active requests
find docs -path "*/requests/*.md" -not -path "*/archived/*"

# By status
grep -r "狀態.*開發中" docs/features/*/requests/
```

### Archive Completed

```bash
mv docs/features/{feature}/requests/xxx.md \
   docs/features/{feature}/requests/archived/
```

## File Naming

**Format**: `YYYY-MM-DD-kebab-case-title.md`

```
2026-01-20-api-resilience.md   ✅
2025-12-12-p0-breaker-sanitization.md     ✅
api-resilience.md              ❌ 缺少日期
```

## Directory Structure

```
docs/features/{feature}/
├── requests/
│   ├── YYYY-MM-DD-title.md      # 活躍需求單
│   └── archived/                 # 已完成需求單
├── planning/
│   ├── progress.md              # 進度彙總
│   └── YYYY-MM-DD-*-plan.md     # 技術方案
├── adr/                          # 架構決策記錄
└── architecture/                 # 架構文檔
```

## Document Linking

### Link Tech Spec

```markdown
> **技術方案**: [完整方案](../planning/xxx-plan.md)
```

### Link Source Code

```markdown
| 檔案                 | 變更類型 |
| -------------------- | -------- |
| `src/service/xxx.ts` | 修改     |
| `src/dto/xxx.ts`     | 新增     |
```

### Link ADR

```markdown
> **決策記錄**: [ADR-001](../adr/xxx.md)
```

## Acceptance Criteria Examples

### Metrics

```markdown
- [ ] API 延遲 P95 < 200ms
- [ ] 緩存命中率 > 80%
- [ ] 錯誤率 < 0.1%
```

### Functional

```markdown
- [ ] 支援 EVM 全鏈
- [ ] 單元測試覆蓋率 > 80%
- [ ] 通過 /codex-review-fast
```
