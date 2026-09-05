---
name: codex-review
description: "Full second-opinion using Codex exec (with lint:fix + build). Supports review loop with context preservation."
allowed-tools: Bash(git:*), Bash(yarn:*), Bash(npm:*), Bash(bash:*), Read, Grep, Glob, Task, Monitor
---

# Codex Review

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This is the **Full** variant of `codex-code-review`. Full workflow, prompt templates, and review logic are defined in the parent skill.

See `@skills/codex-code-review/SKILL.md`

## Variant

| Property | Value |
|----------|-------|
| Scope | Diff + local checks |
| Pre-checks | lint:fix + build |
| Prompt template | `@skills/codex-code-review/references/codex-prompt-full.md` |
| Reviewers | Codex alone — no `--dual`, no secondary. For two reviewers use `/codex-review-branch --dual` |
| Tier | Inherits the session tier (`standard` by default) |

## Trigger

- Keywords: full review, codex review, second opinion, codex-review

## When NOT to Use

- Quick diff-only review (use `/codex-review-fast`)
- Branch-level review (use `/codex-review-branch`)
- Document review (use `/codex-review-doc`)
