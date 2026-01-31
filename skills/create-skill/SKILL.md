---
name: create-skill
description: Create or refactor Claude Code skills. Guides skill design, file structure, and best practices.
allowed-tools: Read, Grep, Glob, Write, Task
---

# Create/Refactor Skill

## Trigger

- Keywords: create skill, new skill, build skill, refactor skill, update skill, restructure skill

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│         Phase 1: Confirm Objective                              │
├─────────────────────────────────────────────────────────────────┤
│ 1. New or Refactor?                                             │
│ 2. Skill name (kebab-case)                                      │
│ 3. Purpose (one sentence)                                       │
│ 4. Trigger keywords                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 2: Choose Vehicle                                 │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────┬────────────────────────────────────────────┐    │
│ │ Vehicle     │ Applicable Scenario                        │    │
│ ├─────────────┼────────────────────────────────────────────┤    │
│ │ CLAUDE.md   │ Global, always needed, stable rules        │    │
│ │ Skill       │ On-demand, domain knowledge, workflows     │    │
│ │ Hook        │ Every time, zero exceptions (lint, blocks) │    │
│ │ Subagent    │ Heavy file reading, isolated context       │    │
│ └─────────────┴────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 3: Design Structure                               │
├─────────────────────────────────────────────────────────────────┤
│ skills/{name}/                                          │
│ ├── SKILL.md              # Workflow (loaded on trigger)        │
│ ├── references/           # Knowledge base (read on demand)     │
│ │   └── *.md                                                    │
│ └── scripts/              # Executable scripts (deterministic)  │
│     └── *.sh                                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 4: Write SKILL.md                                 │
├─────────────────────────────────────────────────────────────────┤
│ 1. Frontmatter (name, description, allowed-tools, context)      │
│ 2. When to use / NOT to use                                     │
│ 3. Workflow (step-by-step)                                      │
│ 4. Verification method                                          │
│ 5. Examples (2-5)                                               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 5: Verify                                         │
├─────────────────────────────────────────────────────────────────┤
│ 1. Trigger test: Does keyword correctly load the skill?         │
│ 2. Flow test: Execute complete workflow                         │
│ 3. Edge test: Error input handling                              │
└─────────────────────────────────────────────────────────────────┘
```

## SKILL.md Template

```markdown
---
name: { kebab-case-name }
description: { One sentence describing purpose and trigger }
allowed-tools: Read, Grep, Glob, Write
context: fork
---

# {Title} Skill

## Trigger

- Keywords: {trigger keywords}

## When NOT to Use

- {scenarios where this skill should not be used}

## Workflow

{Step-by-step flow, using ASCII or Mermaid}

## Verification

{How to verify success}

## Examples

{2-5 usage examples}
```

## Frontmatter Reference

| Field                      | Description                            | Default |
| -------------------------- | -------------------------------------- | ------- |
| `name`                     | Unique identifier (kebab-case)         | Required |
| `description`              | Trigger description (with keywords)    | Required |
| `allowed-tools`            | Restrict available tools               | All     |
| `context`                  | `fork` (isolated) / none (shared)      | Shared  |
| `agent`                    | `Explore` / `Plan` etc.               | None    |
| `disable-model-invocation` | Prevent model auto-triggering          | `false` |
| `user-invocable`           | Whether it appears in `/` menu         | `true`  |

## Design Checklist

| Item                        | Check                                               |
| --------------------------- | --------------------------------------------------- |
| Description is clear        | One sentence explaining "what it does + when to use" |
| SKILL.md is concise         | Only essential info; extras go to references         |
| Fragile flows are protected | deploy/commit -> `disable-model-invocation`          |
| Mechanical steps use scripts | With I/O contract documented in SKILL.md            |
| Hard rules use hooks        | Not relying on plain text instructions               |
| Has verification method     | Tests/lint/command output                            |

## Refactoring Pattern

When refactoring an existing skill:

1. **Read existing SKILL.md** - Understand current structure
2. **Identify issues** - Too long? Inaccurate triggers? Missing verification?
3. **Apply guidelines** - Reference `references/skill-design-guide.md`
4. **Simplify content** - Move details to references
5. **Test triggers** - Confirm keywords still work

## References

For detailed design guidelines, see: [skill-design-guide.md](./references/skill-design-guide.md)

## Related Skills

| Skill         | Purpose              |
| ------------- | -------------------- |
| `doc-review`  | Document review      |
| `tech-spec`   | Technical spec       |
| `feature-dev` | Feature dev workflow |
