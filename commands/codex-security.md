---
description: OWASP Top 10 security review using Codex MCP. Supports review loop with context preservation.
argument-hint: [--scope <dir>] [--continue <threadId>]
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Bash(git:*), Read, Grep, Glob
skills: security-review
---

## Context

- Git status: !`git status -sb`
- Git diff stats: !`git diff --stat HEAD 2>/dev/null | tail -5`

## Task

You will use Codex MCP to perform an OWASP Top 10 security review.

### Arguments Parsing

```
$ARGUMENTS
```

| Parameter               | Description                          |
| ----------------------- | ------------------------------------ |
| `--scope <dir>`         | Review scope (default: `src/`)       |
| `--continue <threadId>` | Continue a previous review session   |

### Step 1: Determine Review Scope

Parse `--scope` from $ARGUMENTS, default to `src/`.

### Step 2: Collect Code Changes

Prioritize reviewing recently changed code:

```bash
# Get uncommitted changes
git diff HEAD -- <scope> | head -1500

# If no changes, get recent commit changes
git diff HEAD~5..HEAD -- <scope> | head -1500

# If none, scan key security-related files
Glob("**/*{auth,login,password,token,secret,key,credential}*.ts")
```

Save the changes as the `CODE_CHANGES` variable.

### Step 3: Execute Security Review

**Case A: First review (no `--continue`)**

Use `mcp__codex__codex` to start a new review session:

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
- Search auth-related code: \`grep -r "auth\\|token\\|session" src/ --include="*.ts" -l | head -10\`
- Check input validation: \`grep -r "@Body\\|@Query\\|@Param" src/ --include="*.ts" -A 5 | head -50\`
- Check sensitive operations: \`grep -r "password\\|secret\\|key" src/ --include="*.ts" -l\`
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

**Remember the returned `threadId` for subsequent review loops.**

**Case B: Loop review (has `--continue`)**

Use `mcp__codex__codex-reply` to continue the previous session:

```typescript
mcp__codex__codex -
  reply({
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

### Step 4: Consolidate Output

Organize Codex review results into the standard format.

## Review Loop Automation

**⚠️ Follow @CLAUDE.md review loop rules ⚠️**

When review result is ⛔ Must fix:

1. Remember the `threadId`
2. Fix P0/P1 security issues
3. Re-review using `--continue <threadId>`
4. Repeat until ✅ Mergeable

## Output

```markdown
## Security Review Report

### Review Scope

- Scope: <dir>
- File count: <count>
- Changed lines: <lines>

### Findings Summary

| Level | Count | Type |
| :---: | :---: | :--- |
|  P0   |   N   | ...  |
|  P1   |   N   | ...  |
|  P2   |   N   | ...  |

### Detailed Findings

#### [P0] <Issue Title>

- **Location**: file:line
- **Type**: OWASP Category
- **Impact**: Potential harm
- **Fix**: Specific recommendation
- **Test**: Verification method

#### [P1] <Issue Title>

...

### Gate

✅ Mergeable / ⛔ Must fix (N P0 issues)

### Loop Review

To re-review after fixes, use:
`/codex-security --continue <threadId>`
```

## Examples

```bash
# Review entire src/
/codex-security

# Review specific directory
/codex-security --scope src/controller/

# Continue review after fixes (preserve context)
/codex-security --continue abc123
```

## Related Commands

| Command      | Description              |
| ------------ | ------------------------ |
| `/dep-audit` | npm dependency audit     |
| `yarn audit` | npm native vulnerability scan |
