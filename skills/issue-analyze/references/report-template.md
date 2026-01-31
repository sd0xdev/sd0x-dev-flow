# Issue Analysis Report Template

## Standard Report

```markdown
# Issue #<number> Analysis Report

## Issue Summary

| Field       | Content      |
| ----------- | ------------ |
| Title       | <title>      |
| Labels      | <labels>     |
| Reporter    | <reporter>   |
| Reported At | <created_at> |
| Symptoms    | <symptom description> |

## Problem Classification

| Dimension   | Result                                    |
| ----------- | ----------------------------------------- |
| Temporality | Regression / Always existed / Uncertain   |
| Certainty   | Reproducible / Intermittent               |
| Complexity  | Low / Medium / High                       |
| Type        | Logic error / Performance / Data / Other  |

**Selected Strategy**: `/code-explore` | `/git-investigate` | `/code-investigate` | `/codex-brainstorm`

## Investigation Process

### Phase 1: <Strategy Name>

<Investigation summary>

### Phase 2: <If second phase exists>

<Investigation summary>

## Root Cause Analysis

### Direct Cause

<The direct cause of the problem>

### Root Cause

<Why the direct cause occurred>

### Related Code

| File      | Line | Description      |
| --------- | ---- | ---------------- |
| `src/...` | L123 | <problematic code> |

## Fix Recommendations

### Recommended Approach

<Fix approach description>

### Estimated Impact

- Scope: <scope>
- Risk Level: Low / Medium / High
- Tests Needed: Unit / Integration / E2E

## Follow-up Actions

- [ ] Fix code
- [ ] Add tests
- [ ] Update documentation (if needed)
```

## Quick Report (Simplified)

```markdown
# Issue #<number> Quick Analysis

**Symptoms**: <one-line description>

**Classification**: <type> -> Strategy: <strategy>

**Root Cause**: <one-line root cause description>

**Fix**: <fix recommendation>

**Related Files**: `src/xxx.ts:123`
```

## Divergence Report (For /codex-brainstorm results)

```markdown
# Issue #<number> Analysis Report (Multi-perspective)

## Claude Perspective

- Root cause hypothesis: <Claude's conclusion>
- Evidence: <arguments>

## Codex Perspective

- Root cause hypothesis: <Codex's conclusion>
- Evidence: <arguments>

## Points of Agreement

- <conclusions both sides agree on>

## Points of Divergence

| Topic      | Claude     | Codex      |
| ---------- | ---------- | ---------- |
| <topic 1>  | <position> | <position> |

## Final Conclusion

<Conclusion after comprehensive analysis>
```
