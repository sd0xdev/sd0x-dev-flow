---
name: claude-health
description: "Claude Code config health check. Use when: auditing .claude/ structure, checking naming, verifying hook setup. Not for: skill quality (use skill-health-check), code review (use codex-code-review). Output: health report + fix recommendations."
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*), Bash(wc:*), Bash(du:*)
context: fork
---

# Claude Health Check

## Trigger

- Keywords: health check, .claude check, config audit, lint .claude, claude health

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Doc review (use `/codex-review-doc`)
- Security review (use `/codex-security`)

## Workflow

```
Scan → Compare → Report → Fix suggestions
  │       │         │
  ▼       ▼         ▼
 7 checks  Rules   P0/P1/P2
           match   + fix commands
```

### Checks (7 items)

| # | Check | Method | Criteria |
|---|-------|--------|----------|
| 1 | Junk files | `find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*"` | Any exists → P1 |
| 2 | .gitignore exists | `ls .claude/.gitignore` | Missing → P1 |
| 3 | .gitignore completeness | Read `.claude/.gitignore`, compare required items | Missing required → P2 |
| 4 | Naming consistency | Scan all `skills/*/` for `reference` vs `references` | Inconsistent → P2 |
| 5 | README count sync | Count actual vs README description | Mismatch → P2 |
| 6 | Command-Skill pairing | Each core skill should have corresponding command | Missing → P1 |
| 7 | Cache size | `du -sh .claude/cache/` | > 50M → P2 |

### Check 1: Junk Files

```bash
find .claude/ -name ".DS_Store" -o -name "*.zip" -o -name ".tmp*" 2>/dev/null
```

- Has results → **P1**: List files, suggest deletion
- No results → ✅

### Check 2-3: .gitignore

```bash
ls .claude/.gitignore 2>/dev/null || echo "MISSING"
```

Missing → **P1**. If exists, read content and compare required items:

| Required Item | Reason |
|---------------|--------|
| `.DS_Store` | macOS generates continuously |
| `settings.local.json` | Personal config |
| `cache/` | Runtime cache |
| `.tmp*` | Temp files |
| `*.zip` | Backup archives |
| `.claude_review_state.json` | Review state tracking |

Missing any → **P2**

### Check 4: Naming Consistency

```bash
# Scan all skill subdirectories
for dir in .claude/skills/*/; do
  if [ -d "${dir}reference" ]; then echo "INCONSISTENT: ${dir}reference"; fi
done
```

Has `reference/` (singular) → **P2**, suggest renaming to `references/`

### Check 5: README Count Sync

```bash
# Count actual items
ls .claude/commands/ 2>/dev/null | wc -l
ls .claude/skills/ 2>/dev/null | wc -l
ls .claude/agents/ 2>/dev/null | wc -l
ls .claude/rules/ 2>/dev/null | wc -l
ls .claude/hooks/*.sh 2>/dev/null | wc -l
```

Extract counts from README.md, compare. Mismatch → **P2**

### Check 6: Command-Skill Pairing

Scan all `skills/*/SKILL.md`, exclude these types, then check for corresponding command:

| Exclude Type | Examples | Reason |
|--------------|----------|--------|
| Domain KB | `portfolio`, `aum` | Referenced by other skills, no standalone entry |
| External | `agent-browser` | Not maintained by this project |

Remaining skills without command → **P1**

### Check 7: Cache Size

```bash
du -sh .claude/cache/ 2>/dev/null
```

- \> 50M → **P2**, suggest cleanup
- ≤ 50M → ✅

## Output

```markdown
# .claude/ Health Check Report

## Summary

| Item | Status | Notes |
|------|--------|-------|
| Junk files | ✅/⛔ | ... |
| .gitignore | ✅/⛔ | ... |
| Naming consistency | ✅/⛔ | ... |
| README count | ✅/⛔ | ... |
| Command-Skill | ✅/⛔ | ... |
| Cache size | ✅/⛔ | ... |

## Statistics

| Category | Count |
|----------|-------|
| Commands | N |
| Skills | N |
| Agents | N |
| Rules | N |
| Hooks | N |

## Issues

### P1
- [Issue] → [Fix recommendation]

### P2
- [Issue] → [Fix recommendation]

## Gate
✅ All Pass / ⛔ N issues need fixing
```

## Verification

- [ ] All 7 checks executed
- [ ] Each has clear ✅/⛔ status
- [ ] P1 issues have specific fix commands
- [ ] Counts verified with actual `ls | wc -l`

## References

- `references/best-practices.md` — Best practices for .claude/ directory structure (read when fixing P1/P2 issues)

## Examples

```
Input: /claude-health
Action: Scan 7 items → Generate report

Input: Is my .claude structure ok?
Action: Trigger health check → Report + fix suggestions
```
