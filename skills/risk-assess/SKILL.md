---
name: risk-assess
description: "Uncommitted code risk assessment with breaking change detection, blast radius analysis, and scope metrics. Use when: evaluating PR risk, pre-commit risk check, large refactoring review. Not for: security vulnerabilities (use /codex-security), code correctness (use /codex-review-fast). Output: 3-dimension weighted score + risk level + gate."
---

# Risk Assessment

## When NOT to Use

- Security vulnerability detection (use `/codex-security`)
- Code correctness / lint / test review (use `/codex-review-fast`)
- Project-level health audit (use `/project-audit`)

## Procedure

1. Run `node skills/risk-assess/scripts/risk-analyze.js --json` to collect deterministic scores
2. Parse the JSON output — overall_score, risk_level, dimensions, flags, gate, next_actions
3. **If risk_level = Critical** (score 75-100) — highlight all breaking signals, recommend splitting PRs
4. **If risk_level = High** (score 50-74) — auto-escalate to `--mode deep`, detail blast radius
5. **If risk_level = Medium** (score 30-49) — summarize dimensions, note areas of concern
6. **If risk_level = Low** (score 0-29) — brief summary, confirm safe to proceed
7. Add qualitative interpretation beyond the scores (e.g., "high blast radius but all dependents are test files")

## Script Integration

The script analyzes 3 dimensions + 2 conditional flags:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| breaking_surface | 45% | Removed exports, renamed APIs, changed signatures, deleted modules |
| blast_radius | 35% | Number of files importing changed modules (grep-based) |
| change_scope | 20% | File count, LOC delta, directory span, rename ratio |

| Flag | Trigger | What It Checks |
|------|---------|---------------|
| migration_safety | Migration/schema files in diff | Rollback/down file exists |
| regression_hint | (v2 stub) | Future: git history analysis |

### Scoring Model

- Overall: `breaking_surface * 0.45 + blast_radius * 0.35 + change_scope * 0.20`
- Each dimension: 0-100 scale
- Overall: 0-100 scale

### Risk Levels

| Score | Level | Gate | Exit Code |
|-------|-------|------|-----------|
| 0-29 | Low | PASS | 0 |
| 30-49 | Medium | PASS | 0 |
| 50-74 | High | REVIEW | 1 |
| 75-100 | Critical | BLOCK | 2 |

### Script Failure Fallback

If the script fails, report the error and suggest running manually:

```bash
node skills/risk-assess/scripts/risk-analyze.js --json
```

## Output Format

```
## Risk Assessment Report

| Field | Value |
|-------|-------|
| Score | **[N]/100** |
| Risk Level | [icon] [level] |
| Gate | [PASS/REVIEW/BLOCK] |

### Dimensions
[table of dimension scores + weights]

### Breaking Change Signals
[list of detected signals — only if any]

### Next Actions
[prioritized action items]

## Gate: [sentinel]
```

## References

- `references/risk-dimensions.md` — Signal catalog, import patterns, scoring bands (read when investigating a specific dimension)
- `references/output-template.md` — JSON schema, report templates per risk level (read when customizing output)

## Verification

- [ ] Script ran successfully
- [ ] All 3 dimensions scored
- [ ] Qualitative interpretation added beyond raw scores
- [ ] Next actions are actionable (include commands where applicable)
- [ ] Gate sentinel present in output
