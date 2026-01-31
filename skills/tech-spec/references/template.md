# Tech Spec Template

```markdown
# [Feature Name] Technical Spec

## 1. Requirement Summary

- Problem:
- Goals:
- Scope:

## 2. Existing Code Analysis

- Related modules:
- Reusable components:
- Files requiring changes:

## 3. Technical Solution

### 3.1 Architecture Design (Mermaid)

### 3.2 Data Model

### 3.3 API Design

### 3.4 Core Logic

## 4. Risks and Dependencies

## 5. Work Breakdown

## 6. Testing Strategy

## 7. Open Questions
```

## Review Report Template

```markdown
# Tech Spec Review Report

## Review Summary

| Dimension | Score | Notes |
| --------- | ----- | ----- |

## Overall Assessment

Pass / Needs Revision / Needs Redesign

## Issues and Recommendations

### Blocker (Must Fix)

### Improvement (Suggested)

### Nice to Have (Optional)
```

## Architecture Layers

| Layer      | Responsibility              | Pattern            |
| ---------- | --------------------------- | ------------------ |
| Controller | API endpoints (thin layer)  | `*.controller.ts`  |
| Service    | Business logic (core)       | `*.service.ts`     |
| Provider   | External service wrappers   | `provider/**/*.ts` |
| Entity     | MongoDB models              | `entity/*.ts`      |

## Design Checklist

- [ ] Reusing existing Service/Provider?
- [ ] Following DI patterns?
- [ ] Unified error handling?
- [ ] Performance considered (cache, batching)?
- [ ] Testing strategy complete?

## Review Dimensions

| Dimension          | Check Items                                | Weight |
| ------------------ | ------------------------------------------ | ------ |
| Completeness       | Requirement coverage, edge cases, error handling | High   |
| Feasibility        | Technically feasible, timeline reasonable, dependencies clear | High   |
| Risk Assessment    | Risks identified, mitigation strategies    | Medium |
| Code Consistency   | Consistent with existing architecture      | Medium |
| Testing Strategy   | Test plan complete                         | Medium |
