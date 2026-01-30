---
name: security-review
description: Security review knowledge base. Covers OWASP Top 10 review, dependency security audit.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Security Review Skill

## Trigger

- Keywords: 安全審查, security review, OWASP, 漏洞, vulnerability, dep-audit, npm audit, 依賴安全

## When NOT to Use

- 一般代碼審查（用 codex-review）
- 功能測試（用 test-review）
- 效能問題（非安全相關）

## Commands

| Command           | Purpose           | When         |
| ----------------- | ----------------- | ------------ |
| `/codex-security` | OWASP Top 10 專項 | 安全敏感代碼 |
| `/dep-audit`      | 依賴安全審計      | 定期/PR      |

## OWASP Top 10

| Code | Category           | Check Focus               |
| ---- | ------------------ | ------------------------- |
| A01  | Broken Access Ctrl | IDOR、權限繞過、CORS      |
| A02  | Crypto Failures    | 敏感資料加密、弱加密      |
| A03  | Injection          | SQL/NoSQL/Cmd Injection   |
| A04  | Insecure Design    | Rate Limiting、業務邏輯   |
| A05  | Misconfiguration   | Debug 模式、預設密碼      |
| A06  | Vulnerable Comp    | 已知漏洞依賴              |
| A07  | Auth Failures      | 暴力破解、Session、弱密碼 |
| A08  | Integrity Failures | 反序列化、CI/CD           |
| A09  | Logging Failures   | 敏感資料日誌、審計        |
| A10  | SSRF               | URL 驗證、內網訪問        |

## Verification

- 每個問題標記嚴重程度（P0/P1/P2）
- Gate 明確（✅ Pass / ⛔ Block）
- 修復建議具體可行
- 包含驗證測試方式

## Severity Levels

| Level    | Description | Action     |
| -------- | ----------- | ---------- |
| critical | 最嚴重      | 立即修復   |
| high     | 高風險      | 盡快修復   |
| moderate | 中等風險    | 評估後修復 |
| low      | 低風險      | 可延後     |

## References

- `references/examples.md` - 安全範例 + 報告模板

## Examples

```
輸入：/codex-security --scope src/controller/
動作：OWASP Top 10 檢查 → 輸出問題 + Gate
```

```
輸入：/dep-audit --level high
動作：npm audit → 過濾 high/critical → 輸出報告
```
