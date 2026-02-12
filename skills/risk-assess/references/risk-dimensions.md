# Risk Dimensions Reference

## Dimension 1: Breaking Surface (weight 45%)

### Signal Catalog

| Signal | Detection | Weight | Example |
|--------|-----------|--------|---------|
| `export-removed` | `-export (function\|const\|class\|default)` without corresponding `+export` | 15 | Removing `export function processOrder()` |
| `export-renamed` | Export name changed between -/+ lines | 10 | `processOrder` -> `handleOrder` |
| `signature-changed` | Same function name, different param list | 10 | `foo(a, b)` -> `foo(a, b, c)` |
| `type-field-removed` | Field removed from interface/type | 8 | Removing `userId: string` from interface |
| `config-key-removed` | Key removed from package.json/tsconfig/.env | 5 | Removing `DATABASE_URL` from .env |
| `module-deleted` | Entire code file deleted | 20 | Deleting `src/utils/parser.ts` |

### Scoring

```
score = min(100, sum(signal_weights))
```

Cap at 100. Multiple signals accumulate.

## Dimension 2: Blast Radius (weight 35%)

### Import Pattern Detection (grep-based)

| Language | Pattern | Example |
|----------|---------|---------|
| JS/TS | `from ['"].*<module>` or `require\(['"].*<module>` | `from './utils'` |
| Python | `from <module> import` or `import <module>` | `from utils import parse` |
| Go | `"<module-path>"` in import block | `"pkg/utils"` |

### Scoring Bands

| Dependents | Score |
|------------|-------|
| 0 | 0 |
| 1-3 | 15 |
| 4-10 | 35 |
| 11-25 | 60 |
| 26-50 | 80 |
| 51+ | 95 |

### Confidence Levels

| Level | Condition |
|-------|-----------|
| high | Single repo, standard imports |
| medium | Monorepo detected (lerna.json, pnpm-workspace.yaml) |
| low | Dynamic imports detected (`import()`) |

## Dimension 3: Change Scope (weight 20%)

### Metrics and Bands

| Metric | Bands | Max Sub-Score |
|--------|-------|---------------|
| file_count | 1-3:10, 4-10:30, 11-25:60, 26+:90 | 30 |
| loc_delta | 1-50:10, 51-200:30, 201-500:60, 501+:90 | 30 |
| dir_span | 1:0, 2-3:20, 4-6:50, 7+:80 | 20 |
| rename_ratio | 0:0, <30%:10, 30-70%:30, >70%:50 | 20 |

### Scoring

```
score = (file_count_score * 30 + loc_delta_score * 30 + dir_span_score * 20 + rename_ratio_score * 20) / 100
```

## Deep Mode Extensions

Deep mode (`--mode deep`) adds:

1. **File churn** (last 90 days): `git log --since="90 days ago" --format="%H" -- <file> | wc -l`
2. **Hotspot detection**: Files with churn > 10 commits AND blast_radius > 5 dependents
3. **Transitive dependents**: 2nd-level grep (importers of importers)

Output added to `deep_analysis` object.

## Migration Safety Flag

Triggered when diff files match: `**/migration*`, `**/schema*`, `*.sql`, `**/migrate*`

Checks:
- Corresponding rollback/down file exists
- Output: `{ triggered: true, has_rollback: bool, files: string[] }`

## Regression Hint Flag

v1 stub: `{ triggered: false, message: "v2: full history analysis" }`

Future: analyze git blame + test coverage to predict regression risk.
