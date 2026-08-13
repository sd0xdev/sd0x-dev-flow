# Trend Storage Schema

## Location

`.claude/cache/test-health/<repoKey>/`

### repoKey

`${safeSlug(repoBase)}--${sha1(remote).slice(0, 8)}`

- `safeSlug`, `sha1` from `scripts/lib/utils.js`
- `repoBase = path.basename(repoRoot)`
- `remote = git remote get-url origin || repoRoot`

Consistent with `scripts/verify-runner.js:85`.

## Directory Structure

```
.claude/cache/test-health/<repoKey>/
├── latest.json          # Copy of most recent snapshot (not symlink)
├── history/
│   ├── 20260401-a1b2c3d.json
│   ├── 20260331-f4e5d6c.json
│   └── ...
└── trend.json           # Pre-computed trend summary (last 5 deltas)
```

## Snapshot Schema

```json
{
  "version": 1,
  "sha": "a1b2c3d",
  "timestamp": "2026-04-01T10:00:00Z",
  "code_coverage": {
    "lines": { "covered": 1234, "total": 1500, "pct": 82.3 },
    "branches": { "covered": 456, "total": 600, "pct": 76.0 },
    "source_type": "instrumented_artifact",
    "tool_id": "c8",
    "freshness": "current"
  },
  "test_inventory": {
    "unit": { "files": 25, "tests": 47, "count_source": "stdout_parse", "count_level": "test_case" },
    "integration": { "files": 1, "tests": 12, "count_source": "stdout_parse", "count_level": "test_case" },
    "e2e": { "files": 0, "tests": 0, "count_source": "file_count", "count_level": "test_file" }
  },
  "feature_coverage": {
    "covered": 12,
    "total": 15,
    "pct": 80.0
  },
  "quality": {
    "p0": 0, "p1": 0, "p2": 1, "nit": 2,
    "dimensions": {
      "happy_path": 4,
      "error_handling": 3,
      "edge_cases": 3,
      "mock_quality": 4
    }
  }
}
```

## Rolling Window

- Keep last **30** snapshots
- On write: prune oldest beyond 30
- Configurable via `testing-project.md` override

## Concurrency Safety (Lock Pattern)

Standard mkdir-based lock (atomic on POSIX — `mkdir` fails if the directory exists; the
enforcement hook this pattern was originally copied from retired with hook-lightweighting).

1. **Acquire lock**: `mkdir <cacheDir>/.lock` (no `-p`, atomic — fails if exists)
   - On failure: read `.lock` directory mtime via `stat` (macOS: `stat -f %m .lock`, Linux: `stat -c %Y .lock`)
   - If mtime age > 60s (TTL): stale lock → `rm -rf .lock` + retry
   - Max 3 retries, 1s interval
2. **Write temp file**: `<cacheDir>/history/<timestamp>-<sha>.json.tmp`
3. **Atomic rename**: `mv .tmp → .json`
4. **Update latest.json**: copy newest snapshot (not symlink)
5. **Release lock**: `rm -rf <cacheDir>/.lock`

**Note**: `/test-health` uses lock directory mtime only — no PID tracking needed since write operations are fast and non-concurrent.

## Trend Comparison Rules

### Coverage Trend

Compare only data points with matching `tool_id + source_type`:

| Previous | Current | Action |
|----------|---------|--------|
| Same tool_id | Same tool_id | Normal comparison |
| Different tool_id | — | Reset trend: `"⚠️ Tool changed from {old} to {new} — trend reset"` |

### Test Count Trend

Compare only data points with matching `count_level`:

| Level | Comparable With |
|-------|----------------|
| `test_case` | `test_case` only |
| `test_file` | `test_file` only |
| `package` | `package` only |

Mixed `count_level` → separate trend lines, no cross-comparison.

### Stale Data

- `freshness: stale` data points participate in trend but with confidence downgrade annotation
- Trend output marks stale points: `(stale)` suffix

## Delta Computation

```
delta = current.value - previous.value
direction = delta > 0 ? "↑" : delta < 0 ? "↓" : "→"
pct_change = ((current.value - previous.value) / previous.value * 100).toFixed(1)
```

Output per metric: `direction pct_change` (e.g., `↑ +2.1%`, `↓ -0.5%`, `→ 0%`)
