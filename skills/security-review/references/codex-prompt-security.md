# Codex Prompt: OWASP Security Review

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Security Review) -->

## First Review Prompt

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start:

You are a senior security expert. Perform an OWASP Top 10:2025 security review of the changes in
this project.

## Review Scope

${SCOPE}

## Changed Files

${CHANGED_FILES}

## Diff Stats

${DIFF_STAT}

## ⚠️ Important: You must independently research the project ⚠️

**No diff is pasted below, deliberately.** A first dispatch carries metadata only
(`@rules/codex-invocation.md` § Required in every first-dispatch prompt) — a pasted excerpt is the dispatcher's selection, and the
finding you would have made in the file it omitted is the one this review exists for. Read the
changes yourself:

1. Check change status: `git status`
2. Read the diff: `git diff HEAD`, and `git diff HEAD -- <file-path>` per file
3. Enumerate untracked files and read each one: `git ls-files --others --exclude-standard`
4. Read each changed file to the end: `cat <file-path>` (chunk with `sed -n '1,200p'`, … when long)

Then research the surrounding system — start from a repository inventory rather than an assumed
layout, since not every project has `src/`:

- Inventory first: `ls`, then `find . -type d -name node_modules -prune -o -type d -print | head -30`
- Search auth-related code: `grep -rl "auth\|token\|session" <discovered source dirs> | head -10`
- Check input validation and request entry points in the frameworks the inventory actually shows
- Check sensitive operations: `grep -rl "password\|secret\|key" <discovered source dirs>`

## OWASP Top 10:2025 Checklist

The version is stated because the numbering moved: SSRF is no longer its own category (it sits under
A01), supply chain and exceptional-condition handling are categories in their own right, and
A02–A06 renumbered. Citing a 2021 identifier for a 2025 category is how a report becomes
unactionable for whoever reads it next.

### A01: Broken Access Control

- IDOR (Insecure Direct Object References)
- Permission bypass
- CORS misconfiguration
- **SSRF** — unvalidated external URLs, reachable internal network resources (folded in from the 2021 A10)

### A02: Security Misconfiguration

- Debug mode not disabled
- Default passwords
- Error messages leaking information

### A03: Software Supply Chain Failures

- Outdated, unpatched or vulnerable dependencies
- Unverified build, plugin or package sources
- Lockfile and provenance gaps

### A04: Cryptographic Failures

- Unencrypted sensitive data
- Weak cryptographic algorithms (MD5, SHA1)
- Hardcoded keys

### A05: Injection

- SQL Injection
- NoSQL Injection (MongoDB)
- Command Injection
- XPath/LDAP Injection
- Cross-site scripting

### A06: Insecure Design

- Missing Rate Limiting
- Business logic vulnerabilities
- Missing input validation

### A07: Authentication Failures

- Weak password policies
- Session fixation attacks
- No brute force protection

### A08: Software or Data Integrity Failures

- Insecure deserialization
- Missing integrity verification

### A09: Logging & Alerting Failures

- Logging sensitive data (passwords, private keys)
- Missing audit logs and alerting on security-relevant events

### A10: Mishandling of Exceptional Conditions

- Error paths that fail open, or that skip the check they were meant to enforce
- Unhandled failures leaving partial state
- Diagnostics that leak internals on the exception path

## Output Format

### [P0/P1/P2] <Issue Title>

- **Location**: file:line
- **Type**: <OWASP Category>
- **Impact**: Potential harm description
- **Fix**: Specific fix recommendation
- **Test**: How to verify the fix

### Gate

- ✅ Mergeable: No P0
- ⛔ Must fix: Has P0


## Re-review Prompt

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume — same thread:

I have fixed the previously identified security issues. Please re-review:

## New Code Changes

```diff
${CODE_CHANGES}
```

Please verify:
1. Have previous P0/P1 security issues been correctly fixed?
2. Did the fixes introduce new security issues?
3. Do the fixes follow security best practices?
4. Update Gate status
