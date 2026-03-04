# Token Budget — Load PR Review

## Budget Defaults

| Parameter | Default | `--all` | Hard Cap |
|-----------|---------|---------|----------|
| Max loaded comments | 30 | 200 | 200 |
| Per-comment body | 2000 chars | 2000 chars | 2000 chars |

## Truncation Priority

When total comments exceed budget, select in this order:

1. **Unresolved** before resolved
2. **Not outdated** before outdated
3. **Newest** (`createdAt` DESC) before oldest

## Per-Comment Body Truncation

If a single comment body exceeds 2000 characters:

```
{first 2000 chars}... [truncated]
```

## Summary Metadata

The `summary` object in output tracks truncation state:

```json
{
  "total": 15,
  "unresolved": 8,
  "outdated": 3,
  "loaded": 8,
  "truncated": 7,
  "degraded": false
}
```

| Field | Description |
|-------|-------------|
| `total` | All threads found |
| `unresolved` | Threads with `isResolved === false` |
| `outdated` | Threads with `isOutdated === true` |
| `loaded` | Threads included in output (after budget) |
| `truncated` | `total - loaded` |
| `degraded` | `true` when using REST fallback |
