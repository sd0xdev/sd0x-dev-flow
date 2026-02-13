---
name: project-audit
description: "Project health audit with deterministic scoring. Use when: evaluating project quality, onboarding to new codebase, periodic health checks. Not for: runtime performance analysis, security-specific audits (use /codex-security). Output: 5-dimension score + actionable findings."
---

# Project Audit

## When NOT to Use

- Security-specific review (use `/codex-security`)
- Runtime performance profiling
- Mid-development review (use `/codex-review-fast`)

## Procedure

1. Run `node skills/project-audit/scripts/audit.js --json` to collect deterministic scores
2. Parse the JSON output — overall_score, status, dimensions, checks, findings, next_actions
3. **If status = Blocked** (P0 findings) — highlight critical gaps, suggest immediate fixes
4. **If status = Needs Work** (P1 findings) — format improvement roadmap by dimension
5. **If status = Healthy** — summarize strengths, note any P2 improvements
6. Add qualitative interpretation beyond the scores (e.g., "test ratio is good but concentrated in unit tests")

## Script Integration

The audit script runs 12 deterministic checks across 5 dimensions:

| Dimension | Checks | What It Measures |
|-----------|--------|-----------------|
| oss | 2 | LICENSE, README quality |
| robustness | 3 | CI config, lint/typecheck, test ratio |
| scope | 2 | Declared features vs implementation, AC completion |
| runnability | 3 | Package manifest, scripts, env/Docker setup |
| stability | 2 | Lock file + audit, type configuration |

### Scoring Model

- Each check: `1` (pass) / `0.5` (partial) / `0` (fail) / `N/A` (skipped)
- Dimension score: `applicable_sum / applicable_count * 100`
- Overall score: average of dimension scores
- Confidence: `applicable_checks / total_checks` per dimension

### Status Determination

| Status | Condition | Exit Code |
|--------|-----------|-----------|
| Blocked | Any P0 finding | 2 |
| Needs Work | No P0, has P1 | 1 |
| Healthy | No P0/P1 | 0 |

### Script Failure Fallback

If the script fails, report the error and suggest running manually:

```bash
node skills/project-audit/scripts/audit.js --json
```

## Output Format

```
## Project Audit Report

| Field | Value |
|-------|-------|
| Repo | [name] |
| Score | **[N]/100** |
| Status | [icon] [status] |

### Dimensions
[table of dimension scores]

### Checks
[list of check results with suggestions]

### Next Actions
[prioritized action items]

## Gate: ✅/⛔
```

## References

- `references/check-catalog.md` — Check definitions, scoring criteria, ecosystem detection (read when investigating a specific check result)
- `references/output-template.md` — Report format examples and JSON schema (read when customizing output)

## Verification

- [ ] Script ran successfully
- [ ] All 12 checks executed (or marked N/A with reason)
- [ ] Qualitative interpretation added beyond raw scores
- [ ] Next actions are actionable (include commands where applicable)
