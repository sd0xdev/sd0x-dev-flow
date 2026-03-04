# Environment Configuration

> **Customization**: Replace `{{ }}` placeholders with your project's actual values.
> Delete unused sections (e.g., Log System if not available).

## API Endpoints

| Environment | Base URL | Description |
| ----------- | -------- | ----------- |
| test | `{{ TEST_BASE_URL }}` | Test/staging environment |
| staging | `{{ STAGING_BASE_URL }}` | Pre-production (if applicable) |
| prod | `{{ PROD_BASE_URL }}` | Production (read-only access) |

**Default**: `test` (safest for verification).

## Authentication

```bash
# Required headers for API requests
# Customize per project — common patterns: API key, JWT, internal headers

make_headers() {
  HEADERS=(
    -H "Content-Type: application/json"
    -H "X-Request-ID: $(uuidgen | tr '[:upper:]' '[:lower:]')"
    {{ ADDITIONAL_HEADERS }}
  )
}
```

> Call `make_headers` before each curl to ensure unique `X-Request-ID` per request (used for log correlation in P4).

## Health Check

```bash
HOST="{{ BASE_URL }}"
curl -s -o /dev/null -w '%{http_code}' "$HOST/{{ HEALTH_ENDPOINT }}"
```

## Log System (Optional — enables L3/L4 degradation)

> Remove this section if no log system is available. Skill degrades to L2 (API-only).

| Key | Value | Description |
| --- | ----- | ----------- |
| Type | `{{ opensearch \| cloudwatch \| datadog \| elk \| gcp-logging }}` | Log backend |
| URL | `{{ LOG_QUERY_URL }}` | Query endpoint or CLI command |
| Index / Log Group | `{{ LOG_INDEX_PATTERN }}` | Index pattern or log group name |
| Auth | `{{ LOG_AUTH_METHOD }}` | Auth method (API key, IAM, cookie) |
| Time Field | `{{ @timestamp \| timestamp \| time }}` | Timestamp field name |
| Request ID Field | `{{ requestId \| request_id \| trace_id }}` | Field for per-request correlation |

**Query template** (adapt to your log backend):

```bash
# Per-request lookup
{{ LOG_CLI }} query --index "{{ LOG_INDEX }}" --filter "requestId:{{ REQ_ID }}"

# Time-window scan
{{ LOG_CLI }} query --index "{{ LOG_INDEX }}" --filter "level:error" --after "{{ START }}" --before "{{ END }}"
```

## Metrics System (Optional — enables L4)

> Remove this section if no metrics system is available. Skill uses L3 (API + Log) at most.

| Key | Value | Description |
| --- | ----- | ----------- |
| Type | `{{ prometheus \| datadog \| cloudwatch-metrics }}` | Metrics backend |
| URL | `{{ METRICS_QUERY_URL }}` | Query endpoint |
| Auth | `{{ METRICS_AUTH_METHOD }}` | Auth method |
| Namespace Filter | `{{ namespace="my-app" }}` | Environment label filter |

## Deployment Alignment

Verify deployed version matches local code before testing:

| Method | Command / Action | Description |
| ------ | ---------------- | ----------- |
| Ask user | Direct question | Most reliable |
| Check deploy pipeline | `{{ DEPLOY_STATUS_CMD }}` | CI/CD pipeline status |
| Check git log | `git log --oneline -5 {{ DEPLOY_BRANCH }}` | If branch is up to date |

## Test Parameters

> Use fixed test parameters to avoid touching real user data.

```bash
# Fixed test parameters (zero-value / disposable)
{{ TEST_PARAM_1 }}="{{ TEST_VALUE_1 }}"
{{ TEST_PARAM_2 }}="{{ TEST_VALUE_2 }}"

# Test identifiers (if applicable)
{{ TEST_NETWORK_ID }}="{{ TEST_NETWORK_VALUE }}"
```

## Endpoint Allowlist

> **Required**: List all endpoints that may be called during verification. Unlisted endpoints must NOT be called (deny-all policy, see safety-rules.md).

| Endpoint | Method | Read-Only Rationale |
| -------- | ------ | ------------------- |
| {{ /api/health }} | GET | Health check, no side effects |
| {{ /api/v1/resource/list }} | GET | List query, read-only |
| {{ /api/v1/resource/query }} | POST | Search with body params, no mutation |

> Add all endpoints that your verification may need. If an endpoint is missing from this list, mark it as a blind spot in the report.

## Degradation Detection

The skill auto-detects degradation level from the sections present in this file.

| Required Section | Present | Level Enabled |
| ---------------- | ------- | ------------- |
| API Endpoints | Yes → L2+ | L2 (API only) |
| Log System | Yes → L3+ | L3 (API + Log) |
| Metrics System | Yes → L4 | L4 (API + Log + Metrics) |
| Endpoint Allowlist | Yes → P3 enabled | Required for L2+ |

**P0 fail-closed rule**: If API Endpoints section is missing or API is unreachable, degrade to L1. If Endpoint Allowlist section is missing, skip P3 (cannot verify without allowlist).

## Notes

- Test environment may require VPN or network access
- All queries must be read-only (see safety-rules.md)
- Never include real user credentials or PII in payloads
