# Request Document Template

```markdown
# Title

> **Created**: YYYY-MM-DD
> **Status**: Pending
> **Priority**: P1
> **Covered Services**: server-service-onchain
> **Tech Spec**: [Link](../planning/xxx.md)

## Background

Brief description of the problem and current state.

## Requirements

- Requirement 1
- Requirement 2

## Deliverables

| Item | Description | File |
| ---- | ----------- | ---- |

## Related Files

| File                 | Change Type |
| -------------------- | ----------- |
| `src/service/xxx.ts` | Modified    |
| `src/entity/xxx.ts`  | New         |

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Risks & Mitigation

| Risk | Mitigation |
| ---- | ---------- |
```

## Status Values

| Status      | Description              |
| ----------- | ------------------------ |
| `Pending`   | Not started              |
| `Queued`    | Planned, in queue        |
| `In Dev`    | In progress              |
| `Approved`  | Tech spec approved       |
| `On Hold`   | Actively paused          |

**After completion**: Move to `archived/` folder

## Priority

| Level | Description | Timeline       |
| ----- | ----------- | -------------- |
| P0    | Urgent      | Immediate      |
| P1    | High        | This week      |
| P2    | Medium      | This iteration |

## Progress Tracking

### Simple (Header)

```markdown
> **Status**: In Dev
```

### Complex (Table)

```markdown
## Progress

| Task        | Priority | Status    | Owner |
| ----------- | -------- | --------- | ----- |
| Extend TTL  | P0       | ✅ Done   | @dev  |
| Monitoring  | P1       | In Dev    | @dev  |
```

### Architecture (Phase)

```markdown
## Phase 1: Basic Optimization

- [x] Task 1
- [ ] Task 2

## Phase 2: Advanced Features

- [ ] Task 3
```
