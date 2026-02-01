---
description: Remove AI-generated artifacts from documents, including tool names, boilerplate patterns, over-structuring.
argument-hint: [<file-or-directory>]
allowed-tools: Read, Grep, Glob, Edit
---

⚠️ **Must read and follow the skill below before executing this command:**

@skills/de-ai-flavor/SKILL.md

## Context

- Git status: !`git status -sb`

## Arguments

| Parameter | Description |
|-----------|-------------|
| `<file>` | Specific file to process |
| `<directory>` | Process all .md files in directory |
| (none) | Process .md files in git diff |

## Workflow

1. Identify target files (argument or git diff)
2. Scan for AI-generated artifacts (tool names, boilerplate, over-structuring, service tone)
3. Remove/Rewrite/Simplify each artifact
4. Output change summary with stats

## Key Rules

- Do NOT remove Co-Authored-By in CHANGELOG (Git convention)
- Do NOT touch documents discussing AI as a topic
- Do NOT modify variable/function names in code
- Preserve document meaning and information density

## Examples

```bash
/de-ai-flavor docs/tech-spec.md       # Process specific file
/de-ai-flavor docs/                    # Process all .md in directory
/de-ai-flavor                          # Process .md in git diff
```
