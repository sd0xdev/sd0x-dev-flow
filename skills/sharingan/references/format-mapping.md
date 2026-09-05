# Format Mapping: Source → sd0x-dev-flow

## Frontmatter Fields

| Source Field | sd0x-dev-flow Target | Mapping Rule |
|-------------|---------------------|--------------|
| `name` | `name:` (kebab-case) | Preserve if valid kebab-case; otherwise slugify (`/[^a-z0-9-]/g` → `-`) |
| `description` | Routing signature format | Rewrite: `{What}. Use when: {triggers}. Not for: {exclusions}. Output: {deliverable}.` |
| `allowed-tools` | Validate each tool exists | Map or flag `[MISSING_TOOL]` |
| `context: fork` | Preserve | Direct copy |
| `agent: Explore` | Preserve | Direct copy |
| `disable-model-invocation: true` | Preserve | Direct copy |

## Routing Signature Rewrite

Source description → sd0x-dev-flow routing signature (must have 2+ cues):

| Cue | Pattern | Required |
|-----|---------|----------|
| Use when | `Use when: {keyword1}, {keyword2}, ...` | 1 of 3 |
| Not for | `Not for: {scenario} (use {alternative}), ...` | 1 of 3 |
| Output | `Output: {deliverable description}` | 1 of 3 |

Minimum 2 cues required for skill-lint P1 pass.

## Body Section Mapping

| Source Section | sd0x-dev-flow Required | Mapping |
|---------------|----------------------|---------|
| Any trigger/keywords section | `## Trigger` | Extract keywords, reformat as bullet list |
| Any exclusion/limitation section | `## When NOT to Use` | Format as table with `Alternative` column |
| Any workflow/process section | `## Workflow` | Preserve or convert to Phase N format |
| Any output/deliverable section | `## Output` | Describe expected format |
| Any checklist/validation section | `## Verification` | Convert to `- [ ]` checklist |
| Any example/usage section | `## Examples` | Preserve with sd0x-dev-flow invocation syntax |

## Dependency Mapping

| Source Pattern | Detection Regex | Flag |
|---------------|----------------|------|
| `/skill-name` in body | see scan-repo.js:270 | Check `skills/` dir → `[MISSING_SKILL]` if absent |
| `@rules/*.md` in body | `@rules/[a-z0-9_.-]+\.md` | Check `rules/` dir → `[MISSING_RULE]` if absent |
| `mcp__*__*` in body | `mcp__[a-zA-Z0-9_]+__[a-zA-Z0-9_-]+` | Always flag `[MISSING_MCP]` (verify manually) |
| Tool in `allowed-tools` | Comma-separated list | Check against known tools → `[MISSING_TOOL]` if unknown |

## Known Tools (sd0x-dev-flow)

```
Read, Grep, Glob, Edit, Write, Bash, Bash(git:*), Bash(node:*), Bash(gh:*),
Agent, WebSearch, WebFetch, AskUserQuestion, Skill
```

## Untranslatable Element Flags

| Flag | Meaning | Action |
|------|---------|--------|
| `[MISSING_TOOL]` | Tool not in known list | Remove from allowed-tools or add TODO |
| `[MISSING_SKILL]` | Referenced skill not in target | Remove reference or note dependency |
| `[MISSING_RULE]` | Referenced rule not in target | Remove reference or install rule |
| `[MISSING_MCP]` | MCP server dependency | Verify MCP server configured in target |
