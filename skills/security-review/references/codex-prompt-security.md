# Codex Prompt: OWASP Security Review

## First Review Prompt

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior security expert. Perform an OWASP Top 10 security review on the following code.

## Review Scope
${SCOPE}

## Code Changes
\`\`\`diff
${CODE_CHANGES}
\`\`\`

## ⚠️ Important: You must independently research the project ⚠️

Security review requires full context understanding. Proactively research:
- Search auth-related code: \`grep -r "auth\\|token\\|session" src/ -l | head -10\`
- Check input validation: \`grep -r "@Body\\|@Query\\|@Param" src/ -A 5 | head -50\`
- Check sensitive operations: \`grep -r "password\\|secret\\|key" src/ -l\`
- Read related files: \`cat <file-path> | head -100\`

## OWASP Top 10 Checklist

### A01: Broken Access Control
- IDOR (Insecure Direct Object References)
- Permission bypass
- CORS misconfiguration

### A02: Cryptographic Failures
- Unencrypted sensitive data
- Weak cryptographic algorithms (MD5, SHA1)
- Hardcoded keys

### A03: Injection
- SQL Injection
- NoSQL Injection (MongoDB)
- Command Injection
- XPath/LDAP Injection

### A04: Insecure Design
- Missing Rate Limiting
- Business logic vulnerabilities
- Missing input validation

### A05: Security Misconfiguration
- Debug mode not disabled
- Default passwords
- Error messages leaking information

### A06: Vulnerable Components
- Outdated/vulnerable dependencies
- Unpatched packages

### A07: Authentication Failures
- Weak password policies
- Session fixation attacks
- No brute force protection

### A08: Data Integrity Failures
- Insecure deserialization
- Missing integrity verification

### A09: Logging Failures
- Logging sensitive data (passwords, private keys)
- Missing audit logs

### A10: SSRF
- Unvalidated external URLs
- Access to internal network resources

## Output Format

### [P0/P1/P2] <Issue Title>
- **Location**: file:line
- **Type**: <OWASP Category>
- **Impact**: Potential harm description
- **Fix**: Specific fix recommendation
- **Test**: How to verify the fix

### Gate
- ✅ Mergeable: No P0
- ⛔ Must fix: Has P0`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

## Re-review Prompt

Used with `mcp__codex__codex-reply`:

```typescript
mcp__codex__codex-reply({
  threadId: '<from --continue parameter>',
  prompt: `I have fixed the previously identified security issues. Please re-review:

## New Code Changes
\`\`\`diff
${CODE_CHANGES}
\`\`\`

Please verify:
1. Have previous P0/P1 security issues been correctly fixed?
2. Did the fixes introduce new security issues?
3. Do the fixes follow security best practices?
4. Update Gate status`,
});
```
