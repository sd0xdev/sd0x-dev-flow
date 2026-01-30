# Security Rules

OWASP 檢查項: IDOR | 注入(SQL/NoSQL/Cmd) | 加密 | Rate Limit | 配置安全 | 依賴漏洞 | 認證 | 反序列化 | 日誌 | SSRF

| 禁止                 | 說明                  |
| -------------------- | --------------------- |
| MD5/SHA1 用於安全    | 使用 bcrypt/argon2    |
| 直接執行用戶輸入     | 參數化查詢、validator |
| 記錄私鑰/密碼/token  | 脫敏處理              |
| fetch(req.query.url) | 驗證 URL，阻止內網    |
| 未驗證資源所有權     | 必須檢查 user.id 匹配 |

驗證命令: `/codex-security` | `/dep-audit` | `npm/yarn/pnpm audit`
