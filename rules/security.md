# Security Rules

OWASP Checklist: IDOR | Injection (SQL/NoSQL/Cmd) | Encryption | Rate Limit | Configuration Security | Dependency Vulnerabilities | Authentication | Deserialization | Logging | SSRF

| Prohibited                | Guidance                         |
| ------------------------- | -------------------------------- |
| MD5/SHA1 for security     | Use bcrypt/argon2                |
| Direct execution of user input | Use parameterized queries, validator |
| Logging private keys/passwords/tokens | Sanitize sensitive data |
| fetch(req.query.url)      | Validate URL, block internal network |
| Unverified resource ownership | Must check user.id matches    |

Verification commands: `/codex-security` | `/dep-audit` | ecosystem audit

| Ecosystem | Audit Command |
|-----------|--------------|
| Node.js | `npm audit` / `yarn audit` / `pnpm audit` |
| Python | `pip-audit` / `safety check` |
| Rust | `cargo audit` |
| Go | `govulncheck ./...` |
| Java | `./gradlew dependencyCheckAnalyze` / `mvn dependency-check:check` |
| Ruby | `bundle audit` |
