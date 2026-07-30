# Output Templates

## Analysis Report (`--mode analyze`)

```markdown
## Sharingan Analysis Report

**Source**: {url}
**Type**: {plugin|collection|single|unknown}
**Skills Found**: {N}
**Analysis Date**: {YYYY-MM-DD}

### Dependency Graph

(Mermaid graph TD with skill→skill edges)

### Per-Skill Summary

| # | Skill | Sections | Deps | References | Scripts |
|---|-------|----------|------|------------|---------|

### Untranslatable Elements

| Skill | Element | Reason | Suggestion |
|-------|---------|--------|------------|

### Generation Plan

| Batch | Skills | Count |
|-------|--------|-------|

### Next Steps
1. Review analysis and confirm batch order
2. Run `/sharingan <url> --mode generate` to proceed
```

## Generation Report (`--mode generate`)

```markdown
## Sharingan Generation Report

### Generated Skills

| # | Skill | Files Created | L1 | L2 | L3 | Status |
|---|-------|---------------|----|----|----|----|

### Per-Skill Detail

#### {skill-name}
- `skills/{name}/SKILL.md` — {confidence}
- `skills/{name}/references/` — {N files}

**Routing Signature**: {generated}
**Untranslatable**: {list or "None"}

### Integration Checklist
- [ ] Review each SKILL.md for accuracy
- [ ] Register each skill in `docs/skill-catalog.yml` (the sole registration surface — no CLAUDE.md table)
- [ ] Run `/skill-health-check` for full validation
- [ ] Write tests in `test/skills/{skill}.test.js`
- [ ] Test invocation: `/{skill-name} <test-input>`
```

## Validation Status Icons

| Icon | Meaning |
|------|---------|
| `Pass` | Check passed |
| `Fail` | Check failed |
| `Skip` | Check not applicable |
