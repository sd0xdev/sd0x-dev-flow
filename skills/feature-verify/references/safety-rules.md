# Safety Rules & Endpoint Allowlist

## Core Rule

```
⚠️ READ-ONLY — No write operations of any kind ⚠️
```

## Forbidden Operations

| Category | Forbidden | Examples |
| -------- | --------- | ------- |
| HTTP Write | `POST` (write), `PUT`, `PATCH`, `DELETE` | Create, update, delete resources |
| DB Write | `INSERT`, `UPDATE`, `DELETE`, `DROP` | Any data mutation |
| State Mutation | Cache invalidation, queue publish, event emit | Side-effect operations |
| Auth Mutation | Token revoke, password change, session destroy | Security-affecting operations |

> **POST ≠ always write**: Many APIs use POST for read-only queries (complex body parameters). POST endpoints on the allowlist are explicitly verified as read-only.

## Allowed Operations

| Category | Allowed | Description |
| -------- | ------- | ----------- |
| HTTP GET | All read endpoints | Standard read operations |
| Read-only POST | Query-type POST endpoints | POST with read-only semantics (must be on allowlist) |
| GraphQL Query | `query { ... }` | Read-only GraphQL (no mutations) |
| DB Read | `SELECT`, `find`, `aggregate` | Read-only database queries |
| Log Query | Log system search / filter | Observability queries |
| Metrics Query | Prometheus / Datadog / CloudWatch read | Dashboard and metric queries |

## Endpoint Allowlist Pattern

**Policy: deny-all, allow-listed only.**

Users must define their project's allowlist in `environments.md` or below. Only endpoints on the allowlist may be called during verification.

```markdown
<!-- Example allowlist (customize per project) -->
| Endpoint | Method | Description |
| -------- | ------ | ----------- |
| /api/health | GET | Health check |
| /api/v1/{{ resource }}/list | GET | List resources |
| /api/v1/{{ resource }}/query | POST | Query (read-only POST) |
```

**If an endpoint is NOT on the allowlist** → do not call it. Mark as blind spot in report.

**If diff involves write-only endpoints** → mark as blind spot only, do NOT make black-box calls.

## Production Guardrails

| Rule | Description |
| ---- | ----------- |
| Single request | Execute one request at a time (no concurrent/load testing) |
| Fixed parameters | Use test parameters from environments.md (no real user data) |
| Read-only endpoints | Only call allowlisted read-only endpoints |
| No PII | Never include real user credentials, private keys, or sensitive data in payloads |
| Rate awareness | Respect API rate limits; pause between requests if needed |

## Codex Verification Requirement

At P5 (Verdict), Codex independently verifies that **no write operations were performed** during the session. Codex must:

1. Review all curl commands executed in P3
2. Confirm each endpoint is on the allowlist
3. Confirm all HTTP methods are read-only (GET or allowlisted POST)
4. Flag any deviation
