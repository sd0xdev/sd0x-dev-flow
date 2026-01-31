# Skill Design Guide

## 0. Choose the Right Vehicle First

| Vehicle   | Applicable Scenario                          | Load Timing        |
| --------- | -------------------------------------------- | ------------------- |
| CLAUDE.md | Global and stable rules                      | Every session       |
| Skill     | Occasionally needed domain knowledge/workflow | On-demand (trigger) |
| Hook      | Every time, zero exception actions           | Every tool execution |
| Subagent  | Heavy file reading, isolated from main context | Fork isolation     |

## 1. Core Design Principles

### 1.1 "Correct Triggering" is Top Priority

- Triggering relies on YAML frontmatter `name` + `description` (loaded at session start)
- Description must clearly state "what it does, when to use"
- Avoid highly overlapping descriptions across skills (causes misselection/omission)

### 1.2 "Short, Composable, Verifiable"

| Principle  | Description                                             |
| ---------- | ------------------------------------------------------- |
| Short      | SKILL.md contains only essential info; extras go to references |
| Composable | Break large flows into small skills, chain with `/skill` |
| Verifiable | Acceptance criteria included in flow (tests, lint, output comparison) |

### 1.3 Define "Degrees of Freedom"

| Freedom | Applicable Scenario        | Example                |
| ------- | -------------------------- | ---------------------- |
| High    | Multiple solutions OK (heuristic) | code style suggestions |
| Medium  | Template/parameterized     | API endpoint template  |
| Low     | Fixed commands/sequences   | migration, deploy      |

**Constrain fragile flows; loosen non-fragile ones.**

## 2. File Layering (Progressive Disclosure)

```
skills/{name}/
├── SKILL.md              # Level 2: Loaded on trigger
├── references/           # Level 3: Read on demand
│   ├── api.md
│   ├── style.md
│   └── examples.md
└── scripts/              # Level 3: Executable scripts
    └── validate.sh
```

| Level | Content            | Load Timing              |
| ----- | ------------------ | ------------------------ |
| 1     | metadata           | Always loaded (frontmatter) |
| 2     | SKILL.md           | Loaded on trigger        |
| 3     | references/scripts | Read/executed on demand  |

### 2.1 How to Write References

- Treat as an "index-style knowledge base", not a second SKILL.md
- Create small files that can be precisely referenced
- Include a "when to read which reference" guide in SKILL.md

### 2.2 How to Write Scripts

- Treat as "repeatable, deterministic, testable" tools
- Suitable for: extraction/validation/file generation/formatting/evaluation
- Define I/O contract:
  - input: parameters (can use `$ARGUMENTS`)
  - output: stdout + written files + error codes
- Write results to file, then let Claude read (saves context)

## 3. Frontmatter Fields

| Field                      | Description                      | Recommended Value      |
| -------------------------- | -------------------------------- | ---------------------- |
| `name`                     | Unique identifier                | kebab-case             |
| `description`              | Trigger description (with keywords) | Clear, non-overlapping |
| `allowed-tools`            | Restrict available tools         | Minimum necessary      |
| `context`                  | fork (isolated) / none (shared)  | Use fork for research  |
| `agent`                    | Explore / Plan etc.              | As needed              |
| `disable-model-invocation` | Prevent model auto-triggering    | Set true for dangerous ops |
| `user-invocable`           | Whether it appears in `/` menu   | Set false for background knowledge |

### 3.1 Safety Controls

**Dangerous operations must set `disable-model-invocation: true`**:

- deploy
- commit
- Send external messages (Slack, Email)
- Modify production data

## 4. SKILL.md Structure Recommendation

```markdown
---
name: { name }
description: { One sentence, with trigger keywords }
allowed-tools: { minimum necessary }
context: fork
---

# {Title} Skill

## Trigger

- Keywords: {trigger keywords}

## When NOT to Use

- {scenarios where not applicable}

## Workflow

{Step-by-step, with verification}

## Contracts (if scripts exist)

| Script      | Input     | Output    |
| ----------- | --------- | --------- |
| validate.sh | file path | exit code |

## Examples

{2-5, including positive and negative examples}
```

## 5. Naming Convention

| Rule              | Description            |
| ----------------- | ---------------------- |
| Format            | kebab-case             |
| Style             | Verb-ing (gerund) preferred |
| Character limits  | Avoid special characters |
| No conflicts      | Check `/` menu         |

## 6. Implementation Checklist

- [ ] Description clearly states "what it does + when to use + trigger keywords" in one sentence
- [ ] SKILL.md contains only essential info; extra background moved to references
- [ ] Fragile flows (deploy/migration) -> `disable-model-invocation: true`
- [ ] Mechanical steps -> scripts; with I/O contract documented in SKILL.md
- [ ] Hard rules -> hooks, not relying on plain text instructions
- [ ] Clear acceptance criteria (tests/lint/commands) included in steps
- [ ] Tested across multiple models (Haiku/Sonnet/Opus)

## 7. Common Issues

| Issue                       | Solution                                         |
| --------------------------- | ------------------------------------------------ |
| Inaccurate triggering       | Check if description is clear, non-overlapping   |
| SKILL.md too long           | Move details to references                       |
| Model acts on its own       | Set `disable-model-invocation: true`             |
| Flow not repeatable         | Use scripts instead of text descriptions         |
| Verification failures missed | Add hooks or scripts for automated checking      |

## 8. Examples: Good vs Bad

### Good Description

```yaml
description: Create or refactor Claude Code skills. Guides skill design, file structure, and best practices.
```

- States what it does (create/refactor skills)
- States the output (guides design, structure, practices)

### Bad Description

```yaml
description: Helps with skills
```

- Too vague
- No trigger keywords
- Unclear when to use
