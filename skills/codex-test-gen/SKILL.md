---
name: codex-test-gen
description: "Generate unit tests for specified functions using Codex exec"
allowed-tools: Read, Grep, Glob, Write
---

# Codex Test Gen

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This skill delegates to `test-review` for the underlying transport. As a thin entry point it dispatches nothing itself, so it holds no transport grant. The generation-specific prompt template is at `@skills/test-review/references/codex-prompt-test-gen.md`.

See `@skills/test-review/SKILL.md`

## Variant

This is the **Generation** variant — creates new unit tests for specified functions.

## Trigger

- Keywords: generate tests, write tests, create tests, codex-test-gen

## When NOT to Use

- Reviewing existing test coverage (use `/codex-test-review`)
- Code review (use `/codex-review-fast`)
- Writing integration/e2e tests (use `/post-dev-test`)
