# Output Template

## Markdown Report Format

```markdown
## Project Audit Report

| Field | Value |
|-------|-------|
| Repo | my-project |
| Score | **75/100** |
| Status | ⚠️ Needs Work |
| Findings | P0: 0, P1: 2, P2: 3 |

### Dimensions

| Dimension | Score | Confidence | Checks |
|-----------|-------|------------|--------|
| oss | 50/100 | 100% | 2/2 |
| robustness | 83/100 | 100% | 3/3 |
| scope | 100/100 | 50% | 1/2 |
| runnability | 67/100 | 100% | 3/3 |
| stability | 75/100 | 100% | 2/2 |

### Checks

- ✅ **oss-license** — LICENSE file found
- ❌ **oss-readme** [P1] — README minimal: 10 lines, 1 sections
  → Expand README significantly
- ✅ **robustness-ci** — CI configuration found
...

### Next Actions

- `/update-docs` — Expand README with more sections
- `/codex-test-gen` — Add tests — current coverage is very low

## Gate: ⛔
```

## JSON Schema (abbreviated)

```json
{
  "version": 1,
  "repo": "string",
  "overall_score": 75,
  "status": "Needs Work",
  "dimensions": {
    "oss": { "score": 50, "confidence": 100, "total_checks": 2, "applicable_checks": 2 }
  },
  "checks": [
    { "id": "oss-license", "dimension": "oss", "result": "pass", "score": 1, "message": "...", "suggestion": null, "priority": null }
  ],
  "findings": { "p0": 0, "p1": 2, "p2": 3 },
  "next_actions": [
    { "id": "oss-readme", "command": "/update-docs", "reason": "...", "confidence": 0.8 }
  ]
}
```

## Exit Codes

| Code | Status | Meaning |
|------|--------|---------|
| 0 | Healthy | No P0/P1 findings |
| 1 | Needs Work | Has P1, no P0 |
| 2 | Blocked | Has P0 finding |
