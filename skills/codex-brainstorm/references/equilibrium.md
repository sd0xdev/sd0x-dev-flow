# Nash Equilibrium Determination

## Definition

```
Nash Equilibrium = Given the other party's strategy, neither party can improve their outcome by unilaterally changing strategy

Technical proposal equilibrium = Given all constraints and rebuttals, neither party can raise a new valid attack to overturn the current consensus
```

## Determination Flow

```
┌─────────────────────────────────────────┐
│ Round N Complete                         │
├─────────────────────────────────────────┤
│ Q1: Can Claude raise a new attack?       │
│     - Yes → Continue debate              │
│     - No  → Q2                           │
├─────────────────────────────────────────┤
│ Q2: Can Codex raise a new attack?        │
│     - Yes → Continue debate              │
│     - No  → Equilibrium reached          │
└─────────────────────────────────────────┘
```

## Equilibrium Types

| Type                      | Definition                                        | Report Format                                     |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| **Pure Strategy**         | Both converge to the same proposal                | "Equilibrium: Proposal X"                         |
| **Mixed Strategy**        | Both agree to use different proposals under different conditions | "Conditional equilibrium: If A then X, if B then Y" |
| **Pareto Optimal**        | Multiple equilibria exist, cannot rank             | "Pareto set: {X, Y, Z}"                          |
| **No Equilibrium**        | Max rounds reached with remaining divergence       | "Divergence points: [list], need [additional info]" |

## Per-Round Equilibrium Check

```markdown
## Equilibrium Check (Round N)

### My Position

- Current proposal: [X]
- Updated: [Yes/No]

### Attack Capability Check

- Can I raise a new, un-rebutted attack against Codex's proposal?
  - [ ] Yes → Continue (list attacks)
  - [ ] No → My side reached equilibrium

### Codex Attack Capability Check

- Can Codex raise a new, un-rebutted attack against my proposal?
  - [ ] Yes → Continue
  - [ ] No → Both sides reached equilibrium

### Equilibrium Status

- [ ] Continue debate
- [ ] Pure strategy equilibrium reached: Proposal [X]
- [ ] Conditional equilibrium reached: If [A] then [X], if [B] then [Y]
- [ ] Pareto optimal set: {X, Y}
- [ ] Max rounds reached, output divergence report
```

## Handling When Equilibrium Cannot Be Reached

```markdown
# Divergence Report: [Topic]

## Debate Summary

- Total rounds: N (limit reached)
- Divergence remains

## Divergence Points

| Issue | Claude Position | Codex Position | Reason for Divergence |
| ----- | --------------- | -------------- | --------------------- |
| [X]   | ...             | ...            | Different assumptions |

## Additional Information Needed

1. [If A is known, B can be determined]
2. [If constraint C is confirmed, convergence is possible]

## Conditional Recommendations

- If [condition 1]: Recommend Claude's proposal
- If [condition 2]: Recommend Codex's proposal
```
