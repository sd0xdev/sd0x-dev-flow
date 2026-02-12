# Output Template Reference

## JSON Schema

```json
{
  "version": 1,
  "repo": "string",
  "branch": "string",
  "head": "string",
  "mode": "fast|deep",
  "base": "HEAD|<ref>",
  "overall_score": "0-100",
  "risk_level": "Low|Medium|High|Critical",
  "dimensions": {
    "breaking_surface": {
      "score": "0-100",
      "weight": 45,
      "signals": [{ "type": "string", "file": "string", "detail": "string" }]
    },
    "blast_radius": {
      "score": "0-100",
      "weight": 35,
      "dependents_total": "N",
      "confidence": "high|medium|low",
      "top_affected": [{ "file": "string", "dependent_count": "N" }]
    },
    "change_scope": {
      "score": "0-100",
      "weight": 20,
      "metrics": {
        "file_count": "N",
        "loc_delta": "N",
        "dir_span": "N",
        "rename_ratio": "0-1"
      }
    }
  },
  "flags": {
    "migration_safety": { "triggered": "bool", "has_rollback": "bool", "files": [] },
    "regression_hint": { "triggered": "bool", "message": "string" }
  },
  "deep_analysis": "null | { hotspots: [], transitive_count: N, churn_summary: {} }",
  "gate": "PASS|REVIEW|BLOCK",
  "next_actions": [{ "action": "string", "command": "string|null", "reason": "string" }]
}
```

## Gate Sentinels

| Sentinel | Meaning |
|----------|---------|
| `## Gate: ✅` | PASS (Low/Medium risk) |
| `## Gate: ⚠️` | REVIEW (High risk) |
| `## Gate: ⛔` | BLOCK (Critical risk) |

## Report Template by Risk Level

### Low (0-29)

Brief summary only. Confirm safe to proceed.

### Medium (30-49)

Summarize each dimension. Note areas approaching thresholds.

### High (50-74)

Detail all breaking signals. List top affected files. Recommend deep mode if not already run.

### Critical (75-100)

Full breakdown of all dimensions. Recommend splitting into smaller PRs. List all next actions.
