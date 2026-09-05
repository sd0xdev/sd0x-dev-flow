---
name: codex-review-doc
description: "Review documents using Codex exec. Supports review loop with context preservation."
allowed-tools: Bash(git:*), Read, Glob
---

# Codex Review Doc

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This skill delegates to `doc-review` for the full document review workflow, prompt templates, and rating logic.

See `@skills/doc-review/SKILL.md`

## Trigger

- Keywords: doc review, review docs, review document, codex-review-doc

## When NOT to Use

- Code review (use `/codex-review-fast` or `/codex-review`)
- Security audit (use `/codex-security`)
- Test review (use `/codex-test-review`)
