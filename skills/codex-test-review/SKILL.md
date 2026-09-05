---
name: codex-test-review
description: "Review test case sufficiency using Codex exec, suggest additional edge cases. Supports review loop with context preservation."
allowed-tools: Bash(git:*), Read, Grep, Glob
---

# Codex Test Review

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This skill delegates to `test-review` for the full test coverage review workflow, prompt templates, and sufficiency assessment.

See `@skills/test-review/SKILL.md`

## Variant

This is the **Review** variant — evaluates existing test coverage and suggests gaps.

## Trigger

- Keywords: test review, review tests, test coverage, test sufficiency, codex-test-review

## When NOT to Use

- Generating new tests (use `/codex-test-gen`)
- Code review (use `/codex-review-fast`)
- Security audit (use `/codex-security`)
