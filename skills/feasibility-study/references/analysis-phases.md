# Analysis Phases

## Phase 1: Requirement Decomposition (First Principles)

Use the "5 Why" method to uncover the essence of the requirement:

1. What does the user superficially want?
2. Why do they want this? (First layer)
3. Why? (Continue probing to the core problem)
4. What are the success criteria? (Quantifiable acceptance conditions)

## Phase 2: Constraint Analysis

Inventory all constraints:

| Type       | Constraint          | Source    | Flexibility |
| ---------- | ------------------- | --------- | ----------- |
| Technical  | ...                 | ...       | None/Low/Med|
| Business   | ...                 | ...       | ...         |
| Resource   | ...                 | ...       | ...         |
| Compat     | No breaking changes | Stability | Low         |

## Phase 3: Code Research

Research existing code capabilities:

```bash
# Search related modules
grep -r "related keyword" src/ -l | head -20

# Check existing implementations
ls src/service/ src/provider/
```

**Must verify**:

- Are there similar features that can be reused?
- What approaches does existing code support?
- What design patterns can be leveraged?
- What tech debt needs to be worked around?

## Phase 4: Solution Exploration (Core)

**Brainstorm at least 2-3 solutions in different directions** (no upper limit, scale with problem complexity)

Each solution needs:

1. Core idea (one sentence)
2. Implementation path (steps)
3. Quantified feasibility assessment (see evaluation dimensions)
4. Cost and trade-offs

## Evaluation Dimension Standards

| Dimension             | Green                         | Yellow                   | Red                  |
| --------------------- | ----------------------------- | ------------------------ | -------------------- |
| Technical Feasibility | Has existing patterns, direct use | Needs some adaptation | Requires major innovation |
| Effort                | < 3 person-days               | 3-10 person-days         | > 10 person-days     |
| Risk                  | Small change scope, manageable| Some uncertainty          | Many unknowns        |
| Extensibility         | Easy to extend                | Needs refactoring to extend | Hard to extend     |
| Maintenance Cost      | Clean code, easy to understand| Some complexity           | Complex, hard to maintain |

## Phase 6: Comparative Decision

- Side-by-side comparison table (all dimensions)
- Recommended solution and rationale
- Backup solution and applicable scenarios
- Open questions (items needing further confirmation)
