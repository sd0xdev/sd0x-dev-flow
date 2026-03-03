# Best Practices Audit — Output Templates

## Phase 1: Industry Best Practices

```markdown
## Phase 1: Industry Best Practices

### Sources

| #   | Source           | Type           | Key insight |
| --- | ---------------- | -------------- | ----------- |
| 1   | [Official Doc]   | Official       | ...         |
| 2   | [Blog Post]      | Community      | ...         |
| 3   | [Standard Body]  | Industry std   | ...         |

### Best Practices Summary

1. **Principle A** — description + source citation
2. **Principle B** — description + source citation
3. ...

### Common Anti-Patterns

1. Anti-pattern A — why it's harmful
2. Anti-pattern B — why it's harmful
```

## Phase 2: Current Implementation Analysis

```markdown
## Phase 2: Current Implementation Analysis

**Effective scope**: `<scope-path>`

### Compliant Items

| #   | Best Practice | Current Implementation | Status |
| --- | ------------- | ---------------------- | ------ |
| 1   | Principle A   | src/xxx.ts:100         | OK     |

### Concerns

| #   | Best Practice | Current Implementation | Gap                          |
| --- | ------------- | ---------------------- | ---------------------------- |
| 1   | Principle B   | Not found              | Completely missing           |
| 2   | Principle C   | src/yyy.ts:50          | Partially compliant, lacks X |
```

## Phase 4: Gap Report

```markdown
## Best Practices Audit Report

**Topic**: [technology] best practices alignment
**Date**: YYYY-MM-DD
**Debate threadId**: <threadId from Phase 3>
**Verdict**: OK (largely compliant) / WARN (room for improvement) / FAIL (major deviation)

### Debate Conclusion (mandatory — references Phase 3 equilibrium)

- Equilibrium / consensus / divergence (cite specific rounds and arguments from Phase 3)
- Claude's position: ...
- Codex's position: ...
- Equilibrium state: Nash equilibrium / convergence / divergence

### Gap Analysis

| #   | Best Practice | Current State | Gap  | Priority | Recommended Action |
| --- | ------------- | ------------- | ---- | -------- | ------------------ |
| 1   | ...           | ...           | ...  | P1       | ...                |

### Recommended Roadmap

| Priority | Action Item      | Impact Scope | Estimated Effort |
| -------- | ---------------- | ------------ | ---------------- |
| P1       | Must fix         | ...          | S/M/L            |
| P2       | Should improve   | ...          | S/M/L            |
| P3       | Nice-to-have     | ...          | S/M/L            |

### References

1. [Source Name](URL)
2. ...
```

## Field Requirements

| Field | Phase | Required | Notes |
|-------|-------|----------|-------|
| Sources table | 1 | Yes | Min 3 independent sources |
| Effective scope | 2 | Yes | Print in output header |
| Code locations | 2 | Yes | `file:line` format |
| Debate Conclusion | 4 | **Mandatory** | Must reference Phase 3 debate results; cannot be blank or placeholder |
| Debate threadId | 4 | **Mandatory** | Thread ID from Phase 3 debate session; proves debate was executed |
| Verdict | 4 | Yes | OK / WARN / FAIL |
| Priority column | 4 | Yes | P1 / P2 / P3 |
