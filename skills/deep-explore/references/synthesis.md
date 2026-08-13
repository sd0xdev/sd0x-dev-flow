# Synthesis Algorithm & Report Template

## Claim Registry Algorithm

After each wave, the orchestrator builds/updates the claim registry:

### Step 1: Normalize

Each agent finding → structured entry:

```
{
  claim: "Review reminder state is one JSON slot per plane under ~/.cache",
  evidence: "scripts/review-state.js:41",
  shard: "hooks",
  wave: 1,
  confidence: "High"
}
```

### Step 2: Dedup

Key = `canonical_file_path + canonical_claim_text`
- Line tolerance: ±5 lines (same file, similar claim = duplicate)
- Conflict resolution: keep highest confidence
- Source merge: same key from 2+ agents → `source = "consensus"`

### Step 3: Consensus Detection

Claims appearing from 2+ independent shards are marked `[consensus]` — higher reliability.

### Step 4: Conflict Resolution

When agents produce contradicting claims about the same area:

| Evidence Weight | Description |
|----------------|-------------|
| High | Direct file:line reference + code quote |
| Medium | Indirect inference from related code |
| Low | Assumption without direct evidence |

Higher evidence weight wins. If tied → mark as `[divergence]`.

### Step 5: Divergence Section

Unresolvable contradictions go to explicit divergence section with both claims, evidence, and suggested resolution approach.

## Completeness Score Display

```markdown
### Completeness: <score>/100

| Signal | Value | Weight |
|--------|-------|--------|
| Novelty rate | <N>% (Wave <W>) | 70% |
| Critical open Qs | <N> remaining | 30% |

Confidence cap: <1.0 | 0.9 | 0.75> (<reason>)
```

### Confidence Cap Table

| Condition | Cap | Reason |
|-----------|-----|--------|
| All waves + agents successful | 1.0 | Full evidence |
| 1 agent failed/timed out | 0.9 | Partial coverage gap |
| 2+ agents failed or major evidence gap | 0.75 | Significant degradation |

## Report Template

```markdown
## Deep Exploration Report: <query>

### Completeness
- Score: <N>/100
- Waves executed: <N>/max <M>
- Agents dispatched: <N>
- Confidence cap: <value> (<reason>)

### Executive Summary
<2-3 sentence answer to user's question, synthesized from all waves>

### Per-Wave Findings
| Wave | Focus | Agents | Key Findings | New Qs | Novelty |
|------|-------|--------|-------------|--------|---------|
| 1 | Breadth | 3 | <N> | <N> | <N>% |
| 2 | Depth | 2 | <N> | <N> | <N>% |

### Claim Registry (top findings)
| # | Claim | Evidence | Source | Confidence | Consensus |
|---|-------|----------|--------|------------|-----------|
| 1 | ... | file:line | Shard A (W1) | High | [consensus] |

### Coverage Matrix
| Shard | Wave | Files Explored | Ownership |
|-------|------|---------------|-----------|

### Proactive Discoveries (from 20% peripheral)
| # | Finding | Tag | Evidence |
|---|---------|-----|----------|

### Divergence (if any)
| # | Claim A | Claim B | Source Agents | Resolution |
|---|---------|---------|--------------|------------|

### Residual Risks & Next Steps
- <remaining unknowns>
- Suggested: `/code-explore <specific area>` or `/code-investigate <topic>`
```
