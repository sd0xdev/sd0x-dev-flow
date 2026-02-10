---
name: security-review
description: "Security review via Codex MCP. Use when: OWASP Top 10 audit, dependency vulnerability check, security-sensitive changes. Not for: code review (use codex-code-review), test review (use test-review). Output: security findings + audit report."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
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

### Step 2: Collect Code Changes

Priority order:
1. Uncommitted changes: `git diff HEAD -- <scope> | head -1500`
2. Recent commits: `git diff HEAD~5..HEAD -- <scope> | head -1500`
3. Key security files: `Glob("**/*{auth,login,password,token,secret,key,credential}*")`

### Step 3: Codex Security Review

**First review**: `mcp__codex__codex` with OWASP prompt. See @references/codex-prompt-security.md.

Config: `sandbox: 'read-only'`, `approval-policy: 'never'`

**Save the returned `threadId`.**

**Loop review**: `mcp__codex__codex-reply` with re-review template. See @references/codex-prompt-security.md.

### Step 4: Consolidate Output

Organize results into findings summary table + detailed findings + gate.

## OWASP Top 10

| Code | Category           | Check Focus                          |
| ---- | ------------------ | ------------------------------------ |
| A01  | Broken Access Ctrl | IDOR, permission bypass, CORS        |
| A02  | Crypto Failures    | Sensitive data encryption, weak crypto |
| A03  | Injection          | SQL/NoSQL/Cmd Injection              |
| A04  | Insecure Design    | Rate Limiting, business logic        |
| A05  | Misconfiguration   | Debug mode, default passwords        |
| A06  | Vulnerable Comp    | Known vulnerable dependencies        |
| A07  | Auth Failures      | Brute force, session, weak passwords |
| A08  | Integrity Failures | Deserialization, CI/CD               |
| A09  | Logging Failures   | Sensitive data in logs, auditing     |
| A10  | SSRF               | URL validation, internal network access |

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
