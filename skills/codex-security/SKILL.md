---
name: codex-security
description: "OWASP Top 10 security review using Codex exec. Supports review loop with context preservation."
allowed-tools: Bash(git:*), Read, Grep, Glob
---

# Codex Security

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This skill delegates to `security-review` for the full OWASP security review workflow, prompt templates, and audit logic.

See `@skills/security-review/SKILL.md`

## Trigger

- Keywords: security review, OWASP, security audit, codex-security

## When NOT to Use

- Code review (use `/codex-review-fast`)
- Dependency audit (use `/dep-audit`)
- Test review (use `/codex-test-review`)
