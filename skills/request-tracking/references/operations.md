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
grep -r "Status.*In Dev" docs/features/*/requests/
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
api-resilience.md              ❌ Missing date
```

## Directory Structure

```
docs/features/{feature}/
├── requests/
│   ├── YYYY-MM-DD-title.md      # Active request documents
│   └── archived/                 # Completed request documents
├── planning/
│   ├── progress.md              # Progress summary
│   └── YYYY-MM-DD-*-plan.md     # Tech specs
├── adr/                          # Architecture decision records
└── architecture/                 # Architecture docs
```

## Document Linking

### Link Tech Spec

```markdown
> **Tech Spec**: [Full Spec](../planning/xxx-plan.md)
```

### Link Source Code

```markdown
| File                 | Change Type |
| -------------------- | ----------- |
| `src/service/xxx.ts` | Modified    |
| `src/dto/xxx.ts`     | New         |
```

### Link ADR

```markdown
> **Decision Record**: [ADR-001](../adr/xxx.md)
```

## Acceptance Criteria Examples

### Metrics

```markdown
- [ ] API latency P95 < 200ms
- [ ] Cache hit rate > 80%
- [ ] Error rate < 0.1%
```

### Functional

```markdown
- [ ] Support all EVM chains
- [ ] Unit test coverage > 80%
- [ ] Pass /codex-review-fast
```
