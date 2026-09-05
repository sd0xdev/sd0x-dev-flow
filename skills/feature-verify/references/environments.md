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

**There is one health-check execution path, and it is § Deterministic Health-Check Algorithm
below** — not this section. What used to stand here was a second, copyable `curl` with no allowlist
prerequisite in front of it, which is exactly the unapproved request the deny-all policy forbids
(`../SKILL.md` § P0): a reader who reached this section first made the request the policy could
never have approved, before anything had loaded the allowlist. Two copies of a command where only
one carries its gate is the shape that defect takes, so the copy is gone rather than gated twice.

The host and endpoint this environment entry defines:

| Key | Value |
|-----|-------|
| Host | `{{ BASE_URL }}` |
| Health endpoint | `{{ HEALTH_ENDPOINT }}` (method `GET`) |

**`{{ HEALTH_ENDPOINT }}` with method `GET` must appear in the Endpoint Allowlist below** before any
request is made — that entry, and nothing else. The allowlist has three columns (`Endpoint`,
`Method`, `Read-Only Rationale`) and its examples are paths, so it has no host field to satisfy: the
host comes from this entry, and requiring one here would make every health check withhold for a
missing row that cannot exist. This sentence and the prerequisite in § Deterministic Health-Check
Algorithm state the same condition, deliberately in the same words.

## Log System (Optional — enables L3/L4 degradation)

> Remove this section if no log system is available. Skill degrades to L2-API (API-only). If API is also unreachable, degrades to L1.

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

The skill auto-detects degradation level from the sections present in this file and API reachability.

### Deterministic Health-Check Algorithm

P0 uses the following algorithm to determine API reachability (fail-closed):

| Attempt | Timeout | All failures required for unreachable |
|---------|---------|---------------------------------------|
| 1 | 2s | — |
| 2 | 2s | — |
| 3 | 2s | 3/3 fails → unreachable |

**The allowlist check comes first, and it gates this loop.** The health check is a request like any
other, so the deny-all policy applies to it: resolve the Endpoint Allowlist section, and confirm it
lists `{{ HEALTH_ENDPOINT }}` **with the method used below**, before the first `curl` runs. Missing
section, missing entry, or a method mismatch ⇒ **make no request** and treat the API as unreachable
on that basis, recording why. Calling the endpoint to find out whether calling it was allowed is the
one order this policy can never permit (`../SKILL.md` § P0).

**Prerequisite, checked before the fence below is entered — not a command inside it.** Read the
Endpoint Allowlist section of this file's environment entry and confirm it lists
`{{ HEALTH_ENDPOINT }}` with method `GET`. If the section is absent, the endpoint is not on it, or
it is listed with a different method: **do not run the loop**, set `REACHABLE=false`, and record
that the health check was withheld rather than failed. There is no `allowlisted` command to call —
the check is the model reading the allowlist, and writing it as a shell word would be an invocation
of something that does not exist.

Only once that prerequisite holds:

```bash
REACHABLE=false
for i in 1 2 3; do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 2 "$HOST/{{ HEALTH_ENDPOINT }}")
  if [[ "$HTTP_CODE" =~ ^[23] ]]; then
    REACHABLE=true
    break
  fi
done
```

### Detection Matrix

| API Status | Log System | Metrics | Level |
|------------|------------|---------|-------|
| Reachable | Yes | Yes | L4 |
| Reachable | Yes | No | L3 |
| Reachable | No | — | L2-API |
| **Unreachable** | **Yes** | — | **L2-OBS** |
| Unreachable | No | — | L1 |

**P0 fail-closed rule**: If API Endpoints section is missing, degrade to L1. If the Endpoint Allowlist section is missing — or does not list the health endpoint with the method above — **P0 makes no request**: the API is treated as unreachable and P3 is skipped, both for the same reason (nothing may call an unverified endpoint, and the health check is one). If API is unreachable, whether measured or withheld: check Log System section — present → L2-OBS, absent → L1.

## Notes

- Test environment may require VPN or network access
- All queries must be read-only (see safety-rules.md)
- Never include real user credentials or PII in payloads
