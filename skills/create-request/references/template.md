# Create Request Template

**Budget: ~100 lines, ≤ 8 substantive AC (gate receipts excluded), Background ≤ 10 lines.** Progress cells are overwritten on each update,
never appended to — a ticket that accumulates rounds is a review log. See `../SKILL.md`
§ Write-Time Budget, and § Phase 4.5 for what happens once the ticket closes.

## Request Document Template

> **`Status` must stay a bare token.** `parseRequestStatus()` returns the WHOLE trailing string and
> `CLOSED_REQUEST_STATUS` compares by exact equality, so `> **Status**: Completed（見下方 Superseded）`
> is not `Completed` — the request silently reopens for `/create-request --scan`, feature-context
> resolution, and every other consumer. Put commentary on the `> **Note**:` line, which no parser
> reads. Enforced by `test/scripts/lib/fc-extractor.test.js`.

```markdown
# {Title}

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` if present (created via `/req-analyze`).
> **Created**: {YYYY-MM-DD}
> **Status**: Pending
> **Note**: {optional — any commentary about the Status goes HERE, never on the Status line}
> **Priority**: {P0|P1|P2}
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) <- Technical detail (primary source)
> **Requirements**: [1-requirements.md](../1-requirements.md) <- Feature-level problem-space rationale (include this line ONLY IF `../1-requirements.md` exists — omit otherwise to avoid dead links)

## Background

{1-2 sentences describing the problem and context}

## Requirements

- {Requirement 1}
- {Requirement 2}

## Scope

| Scope | Description                        |
| ----- | ---------------------------------- |
| In    | {Items handled in this request}    |
| Out   | {Items not handled, separate request} |

## Related Files

| File                 | Action | Description          |
| -------------------- | ------ | -------------------- |
| `skills/xxx/SKILL.md` | Modify | {Brief change description} |
| `scripts/xxx.sh`      | New    | {Brief purpose}      |

## Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] Unit test coverage > 80%
- [ ] Pass /codex-review-fast

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | -      |      |
| Development | -     |      |
| Testing    | -      |      |
| Acceptance | -      |      |

## References

- Tech Spec: [xxx](../2-tech-spec.md)
- Related Request: [yyy](./yyy.md)
```

## Naming Convention

**Format**: `YYYY-MM-DD-kebab-case-title.md`

```
2026-01-23-api-performance-optimization.md   OK
2026-01-23-api-cache-ttl.md     OK
api-optimization.md                         Missing date
2026-01-23-API_Optimization.md              Wrong case
```

## File Location

```
docs/features/{feature}/requests/YYYY-MM-DD-title.md
```

## Priority & Status

| Priority | Description | Timeline    |
| -------- | ----------- | ----------- |
| P0       | Critical    | Immediate   |
| P1       | High        | This week   |
| P2       | Medium      | This sprint |

| Status              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| Pending             | Not started                                          |
| In Progress         | Work in progress (variants normalized: `In Development`, `In Dev` → `In Progress`) |
| Candidate Complete  | All AC checked but not closure-grade verified        |
| Completed           | All AC verified via `--verify-ac` with High confidence |

See [SKILL.md §Phase 4 Auto-Update Items](../SKILL.md) for transition rules. `Blocked` is an informal manual state for out-of-band escalation and is not part of the auto-lifecycle.

## Writing Guidelines

| Principle           | Description                                          |
| ------------------- | ---------------------------------------------------- |
| Concise             | Background 1-2 sentences, requirements as lists      |
| Reference, don't inline | Pseudocode/spec details go in Tech Spec, request only links |
| Track progress      | Progress section marks each phase status             |
| Clear scope         | Scope section defines "what to do" and "what not to do" |
| Verifiable          | Acceptance Criteria use checkboxes for verification  |
| Doc class awareness | Request is a date-prefixed non-lifecycle tracking ticket (per `@rules/docs-numbering.md`). Do NOT inline 5-Why, stakeholder analysis, or FR/NFR decomposition here — those belong in `1-requirements.md` via `/req-analyze` |

## Granularity Guide

| Metric | Target | Action if exceeded |
|--------|--------|--------------------|
| Acceptance Criteria | ≤ 8 **substantive** per request; gate receipts are excluded from the budget and remain live lifecycle ACs | Consider splitting by layer or functional area |
| Related Files layers | 1 concern layer | Split behavior-layer (.md rules/skills) from code-layer (.sh/.js hooks/scripts) |
| Estimated effort | ≤ 3 days | Split by deliverable |

Quality-gate ACs don't count toward the ≤8 target — excluded from the budget only, never from the lifecycle count that decides `Candidate Complete`. **What counts as one is decided by `../SKILL.md` § Quality-Gate AC Classifier and nowhere else**: it recognizes more than `Pass /<command>` (a trailing `pass`, `round N`, named verdict sentinels, bounded pending/superseded tails, `tracked below`), so restating a shorter grammar here would give this reference a different budget from Phase 1.5. `Pass /codex-review-fast` and `Pass /precommit` are examples, not the definition.

## Dependencies (conditional)

Add to request header metadata when splitting creates dependencies between sibling requests:

```markdown
> **Depends On**: [Request Title](./YYYY-MM-DD-xxx.md)
```

Place after `> **Tech Spec**:` line. Only include when this request requires another to complete first.
