---
name: codex-review-fast
description: "Quick second-opinion using Codex exec (diff only, no tests). Supports review loop with context preservation."
allowed-tools: Bash(git:*), Bash(bash:*), Read, Grep, Glob, Task
---

# Codex Review Fast

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This is the **Fast** variant of `codex-code-review`. Full workflow, prompt templates, and review logic are defined in the parent skill.

See `@skills/codex-code-review/SKILL.md`

## Variant

| Property | Value |
|----------|-------|
| Scope | Diff only |
| Pre-checks | None (no lint/build) |
| Prompt template | `@skills/codex-code-review/references/codex-prompt-fast.md` |
| Reviewers | Codex alone — no `--dual`, no secondary. For two reviewers use `/codex-review-branch --dual` |
| Tier | Inherits the session tier (`standard` by default). Findings below the tier's blocking severity are logged `[NIT_DEFERRED]`, not fixed |

## Trigger

- Keywords: quick review, fast review, diff review, codex-review-fast

## When NOT to Use

- Full review with lint + build (use `/codex-review`)
- Branch-level review (use `/codex-review-branch`)
- Document review (use `/codex-review-doc`)
- Security audit (use `/codex-security`)
