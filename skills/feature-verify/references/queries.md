# Feature Verify Query Templates

## Safety Rules

```
⚠️ CRITICAL: ALL OPERATIONS MUST BE READ-ONLY ⚠️
   - NO insert / update / delete / drop
   - NO data modification of any kind
   - Query and observe ONLY
```

## Forbidden Operations

| Database | Forbidden Commands                                                                |
| -------- | --------------------------------------------------------------------------------- |
| MongoDB  | `insert`, `update`, `delete`, `drop`, `remove`, `save`, `replaceOne`, `bulkWrite` |
| Redis    | `SET`, `DEL`, `FLUSHDB`, `EXPIRE`, `LPUSH`, `RPUSH`, `SADD`, `HSET`, `INCR`       |
| Any API  | `POST`, `PUT`, `PATCH`, `DELETE` (except for read-only query APIs)                |

## Allowed Operations

| Database | Allowed Commands                                                        |
| -------- | ----------------------------------------------------------------------- |
| MongoDB  | `find`, `findOne`, `countDocuments`, `aggregate` (read-only), `explain` |
| Redis    | `GET`, `MGET`, `SCAN`, `KEYS`, `HGET`, `HGETALL`, `LRANGE`, `TTL`       |
| Any API  | `GET` requests only                                                     |

## MongoDB Queries

```bash
# Count recent documents
mongosh "$MONGO_URI" --quiet --eval \
  'db.collection.countDocuments({createdAt:{$gte:new Date(Date.now()-86400000)}})'

# Check aggregation results
mongosh "$MONGO_URI" --quiet --eval \
  'db.collection.aggregate([...]).toArray()'
```

## Analytics Queries

```bash
# Export events
curl -u "$MP_USER:$MP_SECRET" \
  "https://{ANALYTICS_API}/api/export?project_id={PROJECT_ID}&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD"
```

## Codex Brainstorm Prompt

```
/codex-brainstorm

## Context
Verifying [SYSTEM_NAME] feature behavior.

## System Architecture
[Brief summary from Phase 1]

## Verification Results
[Table of all checks with expected/actual/status]

## Claude's Preliminary Conclusion
- Status: [Healthy/Issues/Critical]
- Anomalies found: [list]
- Root cause hypothesis: [explanation]
- Recommended actions: [list]

## Questions for Codex
1. Do you agree with this analysis? What would you challenge?
2. What blind spots might Claude have missed?
3. Are there alternative explanations for the anomalies?
4. Is the root cause hypothesis sound? Other possibilities?
5. Any additional recommendations?
```
