---
name: codex-review-branch
description: "Fully automated review of an entire feature branch using Codex exec"
allowed-tools: Bash(git:*), Bash(bash:*), Read, Grep, Glob, Task
---

# Codex Review Branch

Thin entry-point skill — routes to the parent skill for full workflow.

## Parent Skill

This is the **Branch** variant of `codex-code-review`. Full workflow, prompt templates, and review logic are defined in the parent skill.

See `@skills/codex-code-review/SKILL.md`

## Variant

| Property | Value |
|----------|-------|
| Scope | Full branch (all commits since base) |
| Pre-checks | None |
| Prompt template | `@skills/codex-code-review/references/codex-prompt-branch.md` |
| Reviewers | Codex alone. `--dual` adds a secondary reviewer — **off unless the flag is passed** |
| Tier | `thorough` (this is the depth variant — P0/P1/P2 block, round cap 30) |

## Flags

| Flag | Default | Effect |
|------|---------|--------|
| `--dual` | off | Adds a second reviewer in parallel (see parent skill Step 3). The merge happens in conversation — no state write, no mode field, and the next invocation starts single again unless the flag is passed again. A second opinion that can block this review's gate. Use for releases, security-sensitive changes, and public API surfaces. |

`--dual` is the only code-review entry point where two reviewers run. `/codex-review-fast` and `/codex-review-doc` are single-reviewer by design and offer no such flag: the cost of the second opinion is only worth paying where the change warrants it, and this is that variant. `/plan-review --dual` is the plan-mode counterpart — same opt-in shape, same default of off, a different loop.

## Trigger

- Keywords: branch review, full branch, review branch, codex-review-branch

## When NOT to Use

- Quick diff-only review (use `/codex-review-fast`)
- Full review with lint + build (use `/codex-review`)
- Document review (use `/codex-review-doc`)
