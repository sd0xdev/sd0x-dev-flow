---
name: security-review
description: "Security review via Codex exec. Use when: OWASP Top 10:2025 audit, dependency vulnerability check, security-sensitive changes. Not for: code review (use codex-code-review), test review (use test-review). Output: security findings + audit report."
allowed-tools: Bash(git:*), Read, Grep, Glob, Bash(node:*), Write
context: fork
agent: Explore
---

# Security Review Skill

## Trigger

- Keywords: security review, OWASP, vulnerability, dep-audit, npm audit, dependency security

## When NOT to Use

- General code review (use `codex-code-review`)
- Functional testing (use `test-review`)
- Performance issues (not security-related)

## Commands

| Command           | Purpose                  | When                    |
| ----------------- | ------------------------ | ----------------------- |
| `/codex-security` | OWASP Top 10 audit       | Security-sensitive code |
| `/dep-audit`      | Dependency security audit | Periodic / PR          |

## Workflow: `/codex-security`

```
Determine scope → Collect changes → Codex OWASP review → Findings + Gate → Loop if Must fix
```

### Step 1: Determine Scope

Parse `--scope` from arguments, default to `src/`.

### Step 2: Collect Change **Metadata**

Metadata, not content: the first dispatch carries the changed-file list and diff stats, and Codex
reads the diffs itself from the sandbox (`@rules/codex-invocation.md` § Required in every first-dispatch prompt). A truncated
`| head -1500` excerpt was the old shape, and it decided for the reviewer which 1500 lines of a
security review mattered.

1. `CHANGED_FILES`: `git diff --name-only HEAD -- <scope>` ∪ `git ls-files --others --exclude-standard -- <scope>`
2. `DIFF_STAT`: `git diff --stat HEAD -- <scope>`
3. `SCOPE`: the resolved scope argument, plus the security-relevant paths a
   `Glob("**/*{auth,login,password,token,secret,key,credential}*")` surfaces — named as places to
   look, never pasted

### Step 3: Codex Security Review

**First review**: dispatch per `@skills/codex-code-review/references/codex-transport.md` § Start with the OWASP prompt. See `references/codex-prompt-security.md`.

**Save the returned `threadId`.**

**Loop review**: dispatch per `@skills/codex-code-review/references/codex-transport.md` § Resume with the re-review template. See `references/codex-prompt-security.md`.

### Step 4: Consolidate Output

Organize results into findings summary table + detailed findings + gate.

## OWASP Top 10:2025

The version is part of the identifier: SSRF is no longer A10 (it sits inside A01), and A02–A06
renumbered, so a finding labelled with a 2021 code says something different to whoever reads it.

| Code | Category                | Check Focus                              |
| ---- | ----------------------- | ---------------------------------------- |
| A01  | Broken Access Ctrl      | IDOR, permission bypass, CORS, **SSRF**  |
| A02  | Misconfiguration        | Debug mode, default passwords            |
| A03  | Supply Chain Failures   | Vulnerable deps, unverified build sources |
| A04  | Crypto Failures         | Sensitive data encryption, weak crypto   |
| A05  | Injection               | SQL/NoSQL/Cmd Injection, XSS             |
| A06  | Insecure Design         | Rate Limiting, business logic            |
| A07  | Auth Failures           | Brute force, session, weak passwords     |
| A08  | Integrity Failures      | Deserialization, CI/CD                   |
| A09  | Logging & Alerting      | Sensitive data in logs, auditing, alerts |
| A10  | Exceptional Conditions  | Error paths that fail open or leak       |

## Review Loop

**⚠️ @CLAUDE.md auto-loop: fix → re-review → ... → ✅ PASS ⚠️**

⛔ Must fix → fix P0 issues → `/codex-security --continue <threadId>` → repeat until ✅ Mergeable.

Max 3 rounds. Still failing → report blocker.

## Verification

- [ ] Each issue tagged with severity (P0/P1/P2)
- [ ] Gate is explicit (✅ Mergeable / ⛔ Must fix)
- [ ] Fix recommendations are specific and actionable
- [ ] Includes verification test method
- [ ] Codex independently researched auth/input/sensitive code

## References

- OWASP prompt: `references/codex-prompt-security.md`
- Examples: `references/examples.md`
- Standards: @rules/security.md

## Examples

```
Input: /codex-security --scope src/controller/
Action: OWASP Top 10 check → output issues + Gate

Input: /dep-audit --level high
Action: npm audit → filter high/critical → output report
```
