# Routing Signature Guide

## Problem

The YAML `description` field is the **only** information Claude sees at Level 1 (always in context). If it reads like a generic summary, Claude cannot reliably decide whether to trigger the skill.

## Routing Signature Format

A compact routing signature encodes three cues in one description:

```
<What it does>. Use when: <triggers>. Not for: <exclusions>. Output: <deliverable>.
```

## Examples

### Before (generic summary)

```yaml
description: Code review using Codex MCP. Supports fast, full, and branch variants.
```

### After (routing signature)

```yaml
description: "Code review using Codex MCP. Use when: PR review, code audit, second opinion on changes. Not for: doc review (use doc-review), security audit (use security-review), test coverage (use test-review). Output: severity-grouped findings + merge gate."
```

### More Examples

| Skill | Before | After |
|-------|--------|-------|
| feature-dev | Feature development workflow. Covers implementation, verification, pre-commit checks. | Feature development workflow. Use when: implementing features, writing code, running dev loop. Not for: understanding code (use code-explore), reviewing code (use codex-code-review). Output: implemented feature with tests + review gate. |
| bug-fix | Bug/Issue fix workflow. Investigate, locate, fix, test, review. | Bug fix workflow. Use when: fixing bugs, resolving issues, regression fixes. Not for: new features (use feature-dev), understanding code (use code-explore). Output: fix + regression test + review gate. |
| tech-spec | Tech spec knowledge base. Full workflow from requirement analysis to spec output. | Tech spec generation and review. Use when: designing features, writing specs, reviewing specs. Not for: implementation (use feature-dev), architecture advice only (use codex-architect). Output: numbered tech spec document. |

## Checklist

When writing a routing signature:

- [ ] Description starts with what the skill does (1 sentence)
- [ ] "Use when" lists 2-4 concrete trigger scenarios
- [ ] "Not for" lists 2-3 common misroutes with redirects
- [ ] "Output" names the deliverable type
- [ ] Total length under 300 characters
- [ ] No overlap with sibling skills' triggers
