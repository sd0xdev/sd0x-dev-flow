---
name: skill-health-check
description: "Validate skill quality against routing, progressive loading, and verification criteria. Use when: auditing skills, checking skill health, reviewing skill design. Not for: code review (use codex-code-review) or doc review (use doc-review). Output: health report with per-skill ratings + Gate."
allowed-tools: Read, Grep, Glob, Bash(node:*)
context: fork
---

# Skill Health Check

## Trigger

- Keywords: skill health, skill audit, skill lint, check skills, skill quality, validate skills

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Document review (use `/codex-review-doc`)
- Creating new skills (use `/create-skill`)
- .claude directory structure check (use `/claude-health`)

## Core Principle

Skills are **on-demand context packages**. Their value comes from routing precision (right skill triggers at right time) and context efficiency (minimum tokens for maximum capability). A poorly routed skill wastes context on every mismatch; a well-routed skill transforms a generalist into a specialist at exactly the right moment.

## Workflow

```
Run automated lint → Review manual dimensions → Produce integrated report → Gate
```

### Step 1: Automated Lint

```bash
node skills/skill-health-check/scripts/skill-lint.js --fix-hint
```

**Script I/O contract:**

| Parameter | Description |
|-----------|-------------|
| `--skills-dir <path>` | Skills directory (default: `./skills`) |
| `--commands-dir <path>` | Commands directory (default: `./commands`) |
| `--json` | Output JSON instead of markdown |
| `--fix-hint` | Include fix suggestions |
| Exit 0 | All pass |
| Exit 1 | Warnings only (P2) |
| Exit 2 | Errors found (P0/P1) |

**Automated checks (8 items):**

| # | Check | Severity | Criteria |
|---|-------|----------|----------|
| 1 | Frontmatter exists | P0 | `name` + `description` required |
| 2 | Routing signature | P1 | Description has at least 2 of 3 routing cues (Use/Avoid/Output); 0 cues = P1, 1 cue = P2 |
| 3 | When NOT section | P1 | Body has "When NOT to Use" heading |
| 4 | Output section | P2 | Body defines expected deliverable |
| 5 | Verification section | P2 | Body has verification checklist |
| 6 | References routing | P2 | Each reference file mentioned in body |
| 7 | Scripts contract | P2 | Each script filename referenced in SKILL.md body |
| 8 | Line count | P2 | Warning >150, flag >250 |

**Cross-skill checks (2 items):**

| # | Check | Severity | Criteria |
|---|-------|----------|----------|
| 9 | Orphan detection | P2 | Commands ↔ Skills pairing |
| 10 | Description overlap | P2 | Jaccard similarity >60% flagged |

### Step 2: Manual Review (when comprehensive audit requested)

Read flagged skills and evaluate:

| Dimension | Question | Rating |
|-----------|----------|--------|
| **Why > What** | Does skill explain underlying principles, not just steps? | ⭐1-5 |
| **Scope fitness** | Is the skill focused? Could it be split? | ⭐1-5 |
| **Progressive loading** | Is heavy content in references/, not inline? | ⭐1-5 |
| **Routing precision** | Would a user's request unambiguously trigger this skill? | ⭐1-5 |

Only run Step 2 when user explicitly requests deep audit. Default: Step 1 only.

## Output

```markdown
# Skill Health Check Report

## Summary

| Metric | Value |
|--------|-------|
| Skills scanned | N |
| Commands scanned | N |
| P0 (Must Fix) | N |
| P1 (Should Fix) | N |
| P2 (Suggestion) | N |

## Per-Skill Results

| Skill | Routing | When-NOT | Output | Verification | Refs | Lines | Status |
|-------|---------|----------|--------|--------------|------|-------|--------|
| name  | ✅/🟡/⚪ | ...    | ...    | ...          | ...  | N     | ✅/🟡  |

## P1 (Should Fix)
- **skill-name**: Issue → Fix recommendation

## P2 (Suggestion)
- **skill-name**: Issue → Fix recommendation

## Gate: ✅ All Pass / ⛔ N issues need fixing
```

## Verification

- [ ] Automated lint executed (exit code checked)
- [ ] All P0/P1 findings have fix recommendations
- [ ] Per-skill table includes all scanned skills
- [ ] Gate sentinel present for hook parsing

## References

- `references/routing-signature-guide.md` — How to write effective routing signatures (read when fixing P1 routing issues)

## Examples

```
Input: /skill-health-check
Action: Run skill-lint.js → Output markdown report + Gate

Input: /skill-health-check --deep
Action: Run skill-lint.js → Manual review of flagged skills → Integrated report

Input: Are my skills well-designed?
Action: Trigger health check → Report + improvement suggestions
```
