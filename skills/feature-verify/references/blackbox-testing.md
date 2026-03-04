# Black-box Testing Guide

- [P1: Diff-Lite Scoping](#p1-diff-lite-scoping)
- [P2: Test Charter Design](#p2-test-charter-design)
- [P4: Log Verification Flow](#p4-log-verification-flow)
- [P5: Codex Brainstorm Prompt](#p5-codex-brainstorm-prompt)
- [Blind Spot Analysis](#blind-spot-analysis)

---

## P1: Diff-Lite Scoping

**Scope only — no code quality judgment** (code quality is handled by `/codex-review-fast`).

### Get the Diff

| Situation | Command |
| --------- | ------- |
| Branch not merged (common) | `git diff main...HEAD --name-only` |
| Already merged/squashed | `gh pr view {{ PR_NUMBER }} --json files -q '.files[].path'` |
| Configurable base branch | `git diff {{ BASE_BRANCH }}...HEAD --name-only` |

```bash
BASE_BRANCH="${BASE_BRANCH:-main}"
git diff "$BASE_BRANCH"...HEAD --name-only
```

### Map Diff to Affected Endpoints

| Analysis | Method | Output |
| -------- | ------ | ------ |
| **Affected API** | Controller change → directly affected; service/provider → trace upstream route | L1 regression endpoints |
| **New behavior** | New log keywords, cache ops, metrics in diff | L2 active trigger cases |
| **Background services** | Schedule/cron changes | L3 passive observation cases |
| **Dependency changes** | Upstream service used by multiple controllers | Expand L1 regression scope |

**Endpoint mapping table** (generate per verification):

| Changed File | Affected Endpoint | Dependency Chain | Case Type |
| ------------ | ----------------- | ---------------- | --------- |
| `src/service/foo.ts` | `POST /api/v1/foo` | FooController → FooService | L1 |
| `src/service/foo.ts` | (new log keyword) | — | L2 |

### Fallback: No Git Diff

If no git diff is available (e.g., manual deploy, user-described feature):

1. Ask user for feature description and affected endpoints
2. Search codebase for related controllers/services
3. Build endpoint map from user input + code search

---

## P2: Test Charter Design

Generate test cases dynamically from P1 results.

### Test Case Types

| Type | Goal | Pass Criteria | Evidence |
| ---- | ---- | ------------- | -------- |
| **L1 Regression** | Affected API still works | HTTP 200 + expected response shape | requestId + status + response |
| **L2 Active Trigger** | New code path exercised correctly | Response contains expected data OR log shows expected signal | requestId + log keyword match |
| **L3 Passive Observe** | Background service running normally | Log shows execution without errors | Schedule tag + time window + no error |
| **M1 Metrics** | Metrics correctly emitted (if applicable) | Metric exists with correct labels | Query result + label verification |

### Charter Filtering by Degradation Level

| Level | L1 | L2 | L3 | M1 |
| ----- | -- | -- | -- | -- |
| L4 (API + Log + Metrics) | Yes | Yes | Yes | Yes |
| L3 (API + Log) | Yes | Yes | Yes | N/A |
| L2 (API only) | Yes | Yes (response-only) | N/A | N/A |
| L1 (No runtime) | N/A | N/A | N/A | N/A |

### Charter Template (per endpoint)

```markdown
| Case ID | Type | Endpoint/Target | Method | Parameters | Pass Criteria | Evidence Required |
| ------- | ---- | --------------- | ------ | ---------- | ------------- | ----------------- |
| L1-1 | Regression | /api/v1/foo | POST | {fixed test params} | HTTP 200 + expected fields | requestId + HTTP + response |
| L2-1 | Active | /api/v1/foo | POST | {trigger params} | log contains "cache hit" | requestId + log keyword |
| L3-1 | Passive | CronJob:bar | — | — | execution log, no error | schedule tag + time window |
```

### Finding Log Keywords from Diff

```bash
# Find new log statements
git diff "$BASE_BRANCH"...HEAD -- src/ | grep -E '^\+.*logger\.(info|warn|error|debug)'

# Find new metric registrations
git diff "$BASE_BRANCH"...HEAD -- src/ | grep -E '^\+.*(metric|counter|gauge|histogram)'
```

---

## P4: Log Verification Flow

### Primary Query: By Request ID

After each P3 API call, query logs using the request ID:

```
{{ LOG_QUERY_CMD }} requestId:{{ REQ_ID }}
```

### Fallback Strategy

| Attempt | Query Method | Description |
| ------- | ------------ | ----------- |
| 1. Primary | `requestId` field exact match | Standard per-request correlation |
| 2. Alt field | Try alternate field names (`request_id`, `trace_id`) | Different logging frameworks |
| 3. URL + time | Endpoint path + time window (request time +/- 2 min) | Confirm logs exist for that endpoint |

### Retry Strategy

| Attempt | Wait | Description |
| ------- | ---- | ----------- |
| Fast retry | 30s | Log ingestion delay |
| Delayed retry | 120s | Async processing or slow pipeline |
| Give up | — | Mark log as unreachable, lower confidence |

> **Key**: Log not found ≠ feature broken. Log systems have ingestion delays — always retry before concluding.

### Time-Window Scan (Post-Test)

After all cases complete, scan for anomalies during the test period:

```
{{ LOG_QUERY_CMD }} level:error after:{{ START_MINUS_2MIN }} before:{{ END_PLUS_2MIN }}
{{ LOG_QUERY_CMD }} level:warn after:{{ START_MINUS_2MIN }} before:{{ END_PLUS_2MIN }}
```

### What to Look For

| Finding | Assessment | Action |
| ------- | ---------- | ------ |
| 0 errors in test window | Clean | — |
| Errors exist but unrelated to diff modules | Needs review | Compare against pre-deploy baseline |
| Errors in diff-affected modules | Possible regression | Investigate, include in report |
| Warn spike vs baseline | Needs review | May be expected new warnings |

### L2 Behavior Signal Verification

```
{{ LOG_QUERY_CMD }} keyword:{{ LOG_KEYWORD_FROM_DIFF }} after:{{ TEST_START_MINUS_1MIN }}
```

Confirm expected log signals appear after triggering the new code path.

### L3 Background Service Verification

```
{{ LOG_QUERY_CMD }} keyword:{{ SCHEDULE_TAG }} after:{{ DEPLOY_TIME }}
```

Retry with 120s delay (background services are async).

---

## P5: Codex Brainstorm Prompt

Provide P1 scope + P3 results + P4 observations to Codex for independent review:

```
/codex-brainstorm

## Context
Runtime verification of [FEATURE/BRANCH] after deployment.

## P1: Affected Scope
[Endpoint mapping table from P1]

## P3: API Results
[Results table from P3 — HTTP status, response, latency]

## P4: Log Observations
[Per-request log correlation + time-window scan results]

## Compliance Checks (mandatory)
1. Were any write operations performed during P3? List all curl commands and verify each is read-only.
2. Was every endpoint called present on the Endpoint Allowlist (environments.md)? List each endpoint + method and confirm.
3. Were all HTTP methods GET or explicitly allowlisted POST? Flag any deviation.

## Questions for Codex
1. Do you agree with the overall verdict? What would you challenge?
2. What blind spots might this verification have missed?
3. Could the test parameters have hidden issues? (e.g., edge cases not covered)
4. Is the confidence level appropriate given the evidence?
5. Any additional checks that should be performed?
```

---

## Blind Spot Analysis

The following behaviors cannot be observed through black-box API testing — they require unit test coverage (handled by `/codex-test-review`):

| Blind Spot | Description | Detection Signal in Diff |
| ---------- | ----------- | ------------------------ |
| Error fallback paths | Infrastructure failure handling | `catch` + fallback logic |
| Race conditions | Requires precise timing | lock / dedup / mutex |
| Internal cache behavior | No externally observable difference | cache get/set without log |
| Boundary values | Requires specific numeric triggers | `if (x > threshold)` |
| Third-party API errors | Requires specific error codes from external APIs | retry / error mapping |

**Handling**: List blind spots in report. Recommend `/codex-test-review` for unit test coverage confirmation. Do NOT auto-invoke.
