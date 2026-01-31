---
description: Start from first principles, explore possible solutions and quantitatively assess feasibility. Use before /tech-spec.
argument-hint: <requirement description> [--constraints <constraints>] [--context <code path>] [--no-codex]
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(codex:*), Bash(bash:*), Write, mcp__codex__codex, mcp__codex__codex-reply
skills: codex-brainstorm
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Recent changes: !`git diff --name-only HEAD~5 2>/dev/null | grep -E '^src/' | head -10`

## Task

You are now a `feasibility-analyst` expert. Analyze the following requirement from first principles, exploring all possible solutions:

### Input

```
$ARGUMENTS
```

---

## ⚠️ Core Principle: Must Have In-Depth Discussion with Codex ⚠️

**During the feasibility study, any idea, proposal, update, or change must be discussed in depth with Codex.**

| Timing                  | Action                                          |
| ----------------------- | ----------------------------------------------- |
| Before starting analysis| `/codex-brainstorm` to enumerate all possibilities |
| When new idea emerges   | `mcp__codex__codex-reply` to ask Codex's opinion|
| After proposal forms    | `/codex-architect --mode review` to evaluate    |
| Comparing proposals     | `/codex-architect --mode compare` to compare    |
| When modifying proposal | Ask Codex again to verify changes are reasonable|
| Any uncertainty         | Ask Codex directly, do not guess                |

**❌ Forbidden behavior**:

- Producing a report without discussing with Codex
- Only asking Codex at the end as a formality
- Ignoring Codex's differing opinions

**✅ Correct behavior**:

- Continuous dialogue with Codex throughout the process
- Consult Codex at every key decision point
- Seriously integrate differing viewpoints from Claude and Codex

---

### Analysis Flow

#### Phase 1: Requirement Decomposition (First Principles)

Use the "5 Why" method to uncover the essence of the requirement:

1. What does the user superficially want?
2. Why do they want this? (First layer)
3. Why? (Continue probing to the core problem)
4. What are the success criteria? (Quantifiable acceptance conditions)

#### Phase 2: Constraint Analysis

Inventory all constraints:

| Type       | Constraint          | Source    | Flexibility |
| ---------- | ------------------- | --------- | ----------- |
| Technical  | ...                 | ...       | None/Low/Med|
| Business   | ...                 | ...       | ...         |
| Resource   | ...                 | ...       | ...         |
| Compat     | No breaking changes | Stability | Low         |

#### Phase 3: Code Research

Research existing code capabilities:

```bash
# Search related modules
grep -r "related keyword" src/ --include="*.ts" | head -20

# Check existing implementations
ls src/service/ src/provider/
```

**Must verify**:

- Are there similar features that can be reused?
- What approaches does existing code support?
- What design patterns can be leveraged?
- What tech debt needs to be worked around?

#### Phase 4: Solution Exploration (Core)

**Brainstorm at least 2-3 solutions in different directions** (no upper limit, scale with problem complexity)

Each solution needs:

1. Core idea (one sentence)
2. Implementation path (steps)
3. Quantified feasibility assessment (see evaluation dimensions)
4. Cost and trade-offs

#### Phase 5: In-Depth Codex Discussion (Core step, no round limit)

**⚠️ This is a core step of the feasibility study, not optional ⚠️**

**Unless `$ARGUMENTS` explicitly contains `--no-codex`, in-depth discussion is required**

```mermaid
flowchart LR
    A[Start Analysis] --> B[/codex-brainstorm]
    B --> C{New idea?}
    C -->|Yes| D[Ask Codex]
    D --> C
    C -->|Converge| E[/codex-architect]
    E --> F{Proposal confirmed?}
    F -->|Modify| D
    F -->|Yes| G[Consolidate Output]
```

**Available tools**:

| Tool                      | Purpose                           | When to Use              |
| ------------------------- | --------------------------------- | ------------------------ |
| `/codex-brainstorm`       | Deep discussion, enumerate all options | **Required** — at start |
| `/codex-architect`        | Architecture advice, evaluate design   | **Required** — after proposal forms |
| `mcp__codex__codex-reply` | Continue conversation, ask details     | **Anytime** — ask whenever ideas arise |

**In-depth discussion examples**:

```bash
# 1. At start: enumerate all possible solutions
/codex-brainstorm "requirement summary + constraints"

# 2. New idea: ask Codex
mcp__codex__codex-reply({
  threadId: "<threadId>",
  prompt: "I thought of Option C, using Redis distributed locks. What do you think? Any potential issues?"
});

# 3. Proposal update: verify again
mcp__codex__codex-reply({
  threadId: "<threadId>",
  prompt: "Based on your suggestion, I changed Option A to xxx. Is this modification reasonable?"
});

# 4. Proposal formed: evaluate architecture
/codex-architect "Evaluate Option A architecture" --mode review

# 5. Decision comparison: compare options
/codex-architect "Option A vs Option B vs Option C" --mode compare

# 6. Still have questions: keep asking
mcp__codex__codex-reply({
  threadId: "<threadId>",
  prompt: "If we need to support xxx in the future, which option is easier to extend?"
});
```

**Discussion principles**:

| Principle            | Description                                           |
| -------------------- | ----------------------------------------------------- |
| 🔄 Continuous dialog | Not one-and-done, multiple rounds of follow-up        |
| 💡 Ask on every idea | Any new idea, change, or concern should consult Codex |
| 🔍 Challenge assumptions | Proactively ask "Is this assumption correct? What's being overlooked?" |
| ⚖️ Integrate differences | When Claude and Codex disagree, analyze reasons and make trade-offs |
| 📝 Record process    | Document Codex's key suggestions and differing viewpoints in the report |

#### Phase 6: Comparative Decision

- Side-by-side comparison table
- Recommended solution and rationale
- Backup solution and applicable scenarios
- Open questions (items needing further confirmation)

## Evaluation Dimension Standards

| Dimension         | 🟢 High                      | 🟡 Medium                | 🔴 Low              |
| ----------------- | ----------------------------- | ------------------------ | -------------------- |
| Technical Feasibility | Has existing patterns, direct use | Needs some adaptation | Requires major innovation |
| Effort            | < 3 person-days               | 3-10 person-days         | > 10 person-days     |
| Risk              | Small change scope, manageable| Some uncertainty          | Many unknowns        |
| Extensibility     | Easy to extend                | Needs refactoring to extend | Hard to extend     |
| Maintenance Cost  | Clean code, easy to understand| Some complexity           | Complex, hard to maintain |

## Output

```markdown
# [Requirement Name] Feasibility Study Report

## 1. Problem Essence

### 1.1 Surface Requirement

> What the user is asking for

### 1.2 Underlying Problem

> What is the core problem to actually solve?
> (5 Why probing result)

### 1.3 Success Criteria

> How do we know the problem is solved?
> (Quantifiable acceptance conditions)

## 2. Constraints

| Type | Constraint | Source | Flexibility |
| ---- | ---------- | ------ | ----------- |
| ...  | ...        | ...    | ...         |

## 3. Existing Capability Inventory

### 3.1 Related Modules

- `src/xxx.ts` - Reusable XX logic

### 3.2 Design Patterns

- Implementation approach of similar features

### 3.3 Tech Debt

- Known issues to work around

## 4. Possible Solutions

### Option A: [Description]

**Core idea**: One sentence

**Implementation path**:

1. ...
2. ...

**Feasibility assessment**:
| Dimension | Rating | Notes |
|-----------|:------:|-------|
| Technical Feasibility | 🟢/🟡/🔴 | ... |
| Effort | ... | ... |
| Risk | ... | ... |
| Extensibility | ... | ... |

**Cost**:

- ...

---

### Option B: [Description]

(Same structure)

---

### Option C: [Description]

(Same structure, quantity is flexible)

## 5. Codex In-Depth Discussion Record

### 5.1 Discussion Process Summary

> Record discussion rounds and key exchanges with Codex

| Round | Discussion Topic        | Codex Key Viewpoint |
| ----- | ----------------------- | ------------------- |
| 1     | Initial solution enumeration | ...            |
| 2     | Follow-up on Option A details | ...           |
| 3     | Verify after modification | ...              |
| ...   | ...                     | ...                 |

### 5.2 Solution Directions Suggested by Codex

- ...
- ...

### 5.3 Risks/Issues Identified by Codex

- ...
- ...

### 5.4 Differences from Claude's Analysis

| Viewpoint          | Claude | Codex | Adopted |
| ------------------ | ------ | ----- | ------- |
| Core problem understanding | ... | ... | ...  |
| Recommended direction | ...  | ...   | ...     |
| Risk assessment    | ...    | ...   | ...     |

### 5.5 Integrated Conclusion

> Combined recommendation from both perspectives, with trade-off rationale

## 6. Solution Comparison

| Dimension           | Option A | Option B | ... |
| ------------------- | :------: | :------: | :-: |
| Technical Feasibility |   🟢   |   🟡     | ... |
| Effort              |   5d     |  10d     | ... |
| Risk                |   🟢   |   🟡     | ... |
| Extensibility       |   🟡   |   🟢     | ... |
| Maintenance Cost    |   🟢   |   🟢     | ... |

## 7. Recommendation

**Recommended**: Option X
**Rationale**:

- Meets constraints: [list]
- Balance point: [trade-off explanation]
- Codex viewpoint: [agreement/additions]

**Backup**: Option Y
**Applicable scenario**: If [condition], choose Y

## 8. Open Questions

> Items needing further confirmation before final decision

- [ ] Question 1
- [ ] Question 2

## 9. Next Steps

After completion, run:

- `/tech-spec` - Detailed design for the selected solution
- `/deep-analyze` - Deepen the roadmap for the selected solution
```

## Examples

```bash
# Basic usage
/feasibility-study "Add user quota management feature"

# With constraints
/feasibility-study "Add user quota management feature" --constraints "cannot change existing API"

# With context
/feasibility-study "Optimize asset cache" --context src/service/asset.service.ts

# Skip Codex (fast mode)
/feasibility-study "Add logging feature" --no-codex
```

## Relationship with Other Commands

```
Requirements Phase              Design Phase                    Implementation Phase
    │                              │                              │
    ▼                              ▼                              ▼
/feasibility-study   ->    /tech-spec           ->    /deep-analyze
  (Feasibility Study)       (Detailed Spec)          (Implementation Roadmap)
       │
       ├── /codex-brainstorm  (Deep discussion, enumerate possibilities)
       ├── /codex-architect   (Architecture advice, evaluate design)
       └── No round limit, call whenever needed
```
