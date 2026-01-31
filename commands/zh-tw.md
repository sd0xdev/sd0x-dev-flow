---
description: Rewrite the previous reply in Traditional Chinese
argument-hint: [specify content, e.g. "the report above" or "Codex review results"]
---

## Task

Rewrite English or Simplified Chinese content from the conversation into **Traditional Chinese**.

### Arguments

```
$ARGUMENTS
```

### Target Selection

| Parameter                                   | Translation Target                          |
| ------------------------------------------- | ------------------------------------------- |
| No parameter                                | Previous reply                              |
| Has description (e.g. "the report above")   | Content in conversation matching description|

### Requirements

| Item     | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| Language | Traditional Chinese (Taiwan usage)                                  |
| Terms    | Keep technical terms, code, and filenames in original language      |
| Format   | Preserve original markdown format (tables, code blocks, lists, etc) |
| Content  | Full rewrite, do not omit any part                                  |

### Conversion Rules

- Simplified Chinese -> Traditional Chinese (vocabulary conversion, not just font)
- English descriptions -> Traditional Chinese
- Maintain technical term consistency

### Execution

Output the fully rewritten content directly, no additional explanation needed.
