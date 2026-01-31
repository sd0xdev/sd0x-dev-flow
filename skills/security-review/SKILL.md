---
name: security-review
description: Security review knowledge base. Covers OWASP Top 10 review, dependency security audit.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Security Review Skill

## Trigger

- Keywords: security review, OWASP, vulnerability, dep-audit, npm audit, dependency security

## When NOT to Use

- General code review (use codex-review)
- Functional testing (use test-review)
- Performance issues (not security-related)

## Commands

| Command           | Purpose                | When                   |
| ----------------- | ---------------------- | ---------------------- |
| `/codex-security` | OWASP Top 10 audit     | Security-sensitive code |
| `/dep-audit`      | Dependency security audit | Periodic / PR        |

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

## Verification

- Mark severity for each issue (P0/P1/P2)
- Gate is explicit (Pass / Block)
- Fix recommendations are specific and actionable
- Includes verification test method

## Severity Levels

| Level    | Description       | Action              |
| -------- | ----------------- | -------------------- |
| critical | Most severe       | Fix immediately      |
| high     | High risk         | Fix as soon as possible |
| moderate | Medium risk       | Assess and fix       |
| low      | Low risk          | Can be deferred      |

## References

- `references/examples.md` - Security examples + report template

## Examples

```
Input: /codex-security --scope src/controller/
Action: OWASP Top 10 check → output issues + Gate
```

```
Input: /dep-audit --level high
Action: npm audit → filter high/critical → output report
```
