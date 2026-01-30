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

- 私鑰、助記詞、seed phrase
- API keys、access tokens
- 用戶密碼、PIN 碼
- 完整地址（可記錄前後 6 位）

### Encryption

- 敏感資料必須加密
- 禁止 MD5、SHA1 用於安全場景
- 使用 HTTPS 傳輸

## Output Report Template

```markdown
# 安全審查報告

## 發現摘要

| 等級 | 數量 | 類型 |
| ---- | ---- | ---- |

## 詳細發現

### [P0] <問題>

- **位置**: file:line
- **類型**: OWASP 類別
- **影響**: 潛在危害
- **修復**: 具體建議
- **測試**: 驗證方式

## Gate

✅ 無 P0 問題 → 可合併
⛔ 有 P0 問題 → 必須修復
```

## Dep Audit Severity

| Level    | Description      | Action     |
| -------- | ---------------- | ---------- |
| critical | 最嚴重           | 立即修復   |
| high     | 高風險           | 盡快修復   |
| moderate | 中等風險（預設） | 評估後修復 |
| low      | 低風險           | 可延後處理 |
