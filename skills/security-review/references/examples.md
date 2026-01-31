# Security Review Examples

## Injection Prevention

### NoSQL Injection

```typescript
// ❌ Bad - NoSQL Injection
const result = await collection.find({ name: req.query.name });

// ✅ Good - Validate input
const name = validator.escape(req.query.name);
const result = await collection.find({ name });
```

### Command Injection

```typescript
// ❌ Bad
exec(`grep ${userInput} file.txt`);

// ✅ Good
execFile('grep', [userInput, 'file.txt']);
```

## Access Control

### IDOR Prevention

```typescript
// ❌ Bad - IDOR
@Get('/user/:id')
async getUser(@Param('id') id: string) {
  return this.userService.findById(id);
}

// ✅ Good - Validate ownership
@Get('/user/:id')
async getUser(@Param('id') id: string, @CurrentUser() user: User) {
  if (user.id !== id && !user.isAdmin) throw new ForbiddenException();
  return this.userService.findById(id);
}
```

## SSRF Prevention

```typescript
// ❌ Bad
const response = await fetch(req.query.url);

// ✅ Good - Validate URL
const url = new URL(req.query.url);
if (url.hostname === 'localhost' || url.hostname.startsWith('10.')) {
  throw new BadRequestException('Invalid URL');
}
```

## Sensitive Data

### Never Log

- Private keys, mnemonic phrases, seed phrases
- API keys, access tokens
- User passwords, PIN codes
- Full addresses (only log first/last 6 characters)

### Encryption

- Sensitive data must be encrypted
- MD5 and SHA1 are prohibited for security purposes
- Use HTTPS for transmission

## Output Report Template

```markdown
# Security Review Report

## Findings Summary

| Severity | Count | Type |
| -------- | ----- | ---- |

## Detailed Findings

### [P0] <Issue>

- **Location**: file:line
- **Type**: OWASP category
- **Impact**: Potential harm
- **Fix**: Specific recommendation
- **Test**: Verification method

## Gate

✅ No P0 issues → Can merge
⛔ Has P0 issues → Must fix
```

## Dep Audit Severity

| Level    | Description           | Action              |
| -------- | --------------------- | -------------------- |
| critical | Most severe           | Fix immediately      |
| high     | High risk             | Fix as soon as possible |
| moderate | Medium risk (default) | Assess and fix       |
| low      | Low risk              | Can be deferred      |
