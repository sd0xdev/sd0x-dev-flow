---
name: codex-code-review
description: "Code review using Codex MCP. Use when: PR review, code audit, second opinion on changes. Not for: doc review (use doc-review), security audit (use security-review). Output: severity-grouped findings + merge gate."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Bash(yarn:*), Bash(npm:*), Read, Grep, Glob
---

# Codex Code Review

## Trigger

- Keywords: review, PR, code review, second opinion, audit, check

## When NOT to Use

- Document review (use `doc-review`)
- Security-specific review (use `security-review`)
- Test coverage review (use `test-review`)
- Just want to understand code (use `code-explore`)

## Variants

| Variant | Command | Scope | Pre-checks |
|---------|---------|-------|------------|
| Fast    | `/codex-review-fast` | Diff only | None |
| Full    | `/codex-review` | Diff + local checks | lint:fix + build |
| Branch  | `/codex-review-branch` | Full branch | None |

## Shared Workflow

```
Collect changes → [Pre-checks if Full] → Codex review → Findings + Gate → Loop if Blocked
```

### Step 1: Collect Changes

| Variant | Collection Method |
|---------|-------------------|
| Fast    | `git diff HEAD --no-color \| head -2000` |
| Full    | Same as Fast |
| Branch  | `git diff ${BASE_BRANCH}..HEAD --no-color \| head -3000` + commit history + changed files |

### Step 2: Pre-checks (Full variant only)

```bash
{LINT_FIX_COMMAND}
{BUILD_COMMAND}
```

Record results as `LOCAL_CHECKS`.

### Step 3: Codex Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` with variant-specific prompt:

| Variant | Prompt Template |
|---------|-----------------|
| Fast    | @references/codex-prompt-fast.md |
| Full    | @references/codex-prompt-full.md |
| Branch  | @references/codex-prompt-branch.md |

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

**Save the returned `threadId`.**

**Case B: Loop review (has `--continue`)**

Use `mcp__codex__codex-reply` with re-review template from @references/review-common.md.

### Step 4: Consolidate Output

Organize Codex results into standard format with severity-grouped findings and gate.

## Shared Definitions

See @references/review-common.md for:
- Severity levels (P0/P1/P2/Nit)
- Review dimensions
- Merge gate definitions
- Re-review prompt template
- Gate sentinels for hook parsing

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

Blocked → fix P0/P1 → `/codex-review-fast --continue <threadId>` → repeat until Ready.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2/Nit)
- [ ] Gate is clear (✅ Ready / ⛔ Blocked)
- [ ] Issues include: file:line, description, fix suggestion
- [ ] Codex performed independent project research

## References

- Shared definitions: `references/review-common.md`
- Fast prompt: `references/codex-prompt-fast.md`
- Full prompt: `references/codex-prompt-full.md`
- Branch prompt: `references/codex-prompt-branch.md`
- Rubric: `review_rubric.md`
- Output template: `templates/review_output.md`

## Examples

```
Input: /codex-review-fast
Action: git diff → Codex fast prompt → P0/P1/P2/Nit + Gate

Input: /codex-review --focus "auth"
Action: lint:fix → build → git diff → Codex full prompt (focus: auth) → Findings + Gate

Input: /codex-review-branch origin/develop
Action: branch diff + history → Codex branch prompt → Rating table + Findings + Gate
```
