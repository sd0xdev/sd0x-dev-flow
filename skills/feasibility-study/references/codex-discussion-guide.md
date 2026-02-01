# Codex In-Depth Discussion Guide

## Core Principle

**During the feasibility study, any idea, proposal, update, or change must be discussed in depth with Codex.**

## When to Discuss

| Timing                   | Action                                           |
| ------------------------ | ------------------------------------------------ |
| Before starting analysis | `/codex-brainstorm` to enumerate all possibilities |
| When new idea emerges    | `mcp__codex__codex-reply` to ask Codex's opinion |
| After proposal forms     | `/codex-architect --mode review` to evaluate     |
| Comparing proposals      | `/codex-architect --mode compare` to compare     |
| When modifying proposal  | Ask Codex again to verify changes are reasonable |
| Any uncertainty          | Ask Codex directly, do not guess                 |

## Available Tools

| Tool                      | Purpose                            | When to Use               |
| ------------------------- | ---------------------------------- | ------------------------- |
| `/codex-brainstorm`       | Enumerate all options              | **Required** — at start   |
| `/codex-architect`        | Architecture advice, evaluate design | **Required** — after proposal |
| `mcp__codex__codex-reply` | Continue conversation, ask details | **Anytime** — ask whenever |

## Discussion Flow

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

## Discussion Examples

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

## Discussion Principles

| Principle              | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| Continuous dialog      | Not one-and-done, multiple rounds of follow-up        |
| Ask on every idea      | Any new idea, change, or concern should consult Codex |
| Challenge assumptions  | Proactively ask "Is this assumption correct?"         |
| Integrate differences  | When Claude and Codex disagree, analyze and trade-off |
| Record process         | Document key suggestions and differing viewpoints     |

## Prohibited Behaviors

- Producing a report without discussing with Codex
- Only asking Codex at the end as a formality
- Ignoring Codex's differing opinions
