---
name: feasibility-study
description: "Feasibility analysis from first principles. Use when: evaluating solutions before tech-spec, comparing approaches, risk assessment. Not for: implementation (use feature-dev), architecture advice (use codex-architect). Output: quantitative comparison + recommendation."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(codex:*), Bash(bash:*), Write, mcp__codex__codex, mcp__codex__codex-reply
---

# Feasibility Study Skill

## Trigger

- Keywords: feasibility, is this possible, can we, should we, explore options, before tech spec

## When NOT to Use

- Already have a tech spec (use `/deep-analyze`)
- Need implementation, not analysis (use `/codex-implement`)
- Quick question (use `/codex-explain` or `/codex-architect`)

## Workflow

```
Decompose → Constraints → Code research → Solutions → Codex discussion → Decision → Report
```

### Phase 1: Requirement Decomposition

Use "5 Why" to uncover essence:
1. Surface requirement (what user asks for)
2. Underlying problem (why they need it)
3. Success criteria (quantifiable acceptance)

### Phase 2: Constraint Analysis

Inventory constraints by type (Technical, Business, Resource, Compatibility) with flexibility rating.

### Phase 3: Code Research

Research existing codebase:
- Related modules and reusable logic
- Existing design patterns
- Tech debt to work around

### Phase 4: Solution Exploration

Brainstorm 2-3+ solutions, each with:
1. Core idea (one sentence)
2. Implementation path
3. Quantified feasibility (see @references/analysis-phases.md)
4. Cost and trade-offs

### Phase 5: In-Depth Codex Discussion

**⚠️ Core step — not optional (unless `--no-codex`) ⚠️**

See @references/codex-discussion-guide.md for full rules and examples.

| Tool | Purpose | When |
|------|---------|------|
| `/codex-brainstorm` | Enumerate all options | At start |
| `/codex-architect` | Evaluate design | After proposal forms |
| `mcp__codex__codex-reply` | Ask details | Anytime |

### Phase 6: Comparative Decision

Side-by-side comparison → recommendation + backup + open questions.

## Evaluation Dimensions

| Dimension             | Green | Yellow | Red |
| --------------------- | ----- | ------ | --- |
| Technical Feasibility | Has existing patterns | Needs adaptation | Major innovation |
| Effort                | < 3 person-days | 3-10 person-days | > 10 person-days |
| Risk                  | Small scope | Some uncertainty | Many unknowns |
| Extensibility         | Easy to extend | Needs refactoring | Hard to extend |
| Maintenance Cost      | Clean, easy | Some complexity | Complex |

## Output

```markdown
## Feasibility Study: <title>
### Quantitative Comparison
| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|

### Recommendation
<selected option with rationale>
```

## Verification

- [ ] 5 Why decomposition completed
- [ ] Constraints inventoried with flexibility
- [ ] Existing code researched (grep/read)
- [ ] 2-3+ solutions explored with quantified assessment
- [ ] Codex discussion documented (unless `--no-codex`)
- [ ] Comparison table + recommendation + open questions

## References

- Analysis phases: `references/analysis-phases.md`
- Codex discussion: `references/codex-discussion-guide.md`
- Output template: `references/output-template.md`

## Relationship with Other Commands

```
/feasibility-study → /tech-spec → /deep-analyze → /codex-implement
```

## Examples

```
Input: /feasibility-study "Add user quota management"
Action: 5 Why → constraints → code research → 3 solutions → Codex discussion → recommendation

Input: /feasibility-study "Optimize cache" --context src/service/cache.ts
Action: Read cache code → constraints → solutions → Codex brainstorm → comparison → report
```
