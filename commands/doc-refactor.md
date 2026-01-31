---
description: Refactor documents — simplify without losing information, visualize flows with sequenceDiagram.
argument-hint: <file path>
allowed-tools: Read, Grep, Glob, Edit
---

## Task

For the file specified by `$ARGUMENTS`:

1. **Analyze original content**

   - Count lines
   - Identify core information vs redundancy

2. **Refactor**

   - Long paragraphs -> tables
   - Steps -> sequenceDiagram
   - Duplicates -> single source

3. **Validate**
   - Key information preserved
   - Line count reduced

## Simplification Standards

| File Type      | Target Lines |
| -------------- | ------------ |
| CLAUDE.md      | < 50         |
| rules/\*.md    | < 30         |
| agents/\*.md   | < 50         |
| commands/\*.md | < 40         |

## Output

```markdown
## Refactoring Result

- Original: X lines
- Simplified: Y lines (-Z%)

## Changes

- <summary>
```
