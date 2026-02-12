# Check Catalog (v1)

## 12 Checks × 5 Dimensions

| # | Check ID | Dimension | Detection | Scoring |
|---|----------|-----------|-----------|---------|
| 1 | `oss-license` | oss | LICENSE/LICENSE.md/COPYING exists | pass/fail |
| 2 | `oss-readme` | oss | README sections count + line count | pass(>=50L,>=4S) / partial(>=20L,>=2S) / fail |
| 3 | `robustness-ci` | robustness | .github/workflows/, .gitlab-ci.yml, etc. | pass/fail |
| 4 | `robustness-lint-typecheck` | robustness | package.json scripts + tsconfig / Go/Rust built-in | pass/partial/fail |
| 5 | `robustness-test-ratio` | robustness | test files / src files ratio | pass(>=30%) / partial(>=10%) / fail |
| 6 | `scope-declared-impl` | scope | docs/features/ dirs vs src/lib/app existence | pass/fail/N/A |
| 7 | `scope-ac-completion` | scope | `[x]` vs `[ ]` count in feature docs | pass(>=80%) / partial(>=50%) / fail |
| 8 | `runnability-manifest` | runnability | package.json/go.mod/Cargo.toml etc. | pass/fail (P0) |
| 9 | `runnability-scripts` | runnability | start/dev/build/test in package.json | pass(>=3) / partial(>=1) / fail / N/A |
| 10 | `runnability-env-docker` | runnability | .env.example / docker-compose.yml | pass/fail |
| 11 | `stability-lock-audit` | stability | lock file + audit script | pass/partial/fail |
| 12 | `stability-type-config` | stability | tsconfig.json / static-typed lang | pass/partial/fail |

## Priority Mapping

| Check Result | Priority |
|-------------|----------|
| `oss-readme` fail (no README) | P0 |
| `runnability-manifest` fail | P0 |
| All other `fail` results | P1 |
| All `partial` results | P2 |
| `pass` / `n/a` | null |

## Ecosystem Detection

| Ecosystem | Manifest Files |
|-----------|---------------|
| node | package.json |
| go | go.mod |
| rust | Cargo.toml |
| python | pyproject.toml, setup.py, requirements.txt |
| java | pom.xml, build.gradle, build.gradle.kts |
| ruby | Gemfile |
| php | composer.json |
| dotnet | *.csproj, *.sln |

## Static-Typed Language Shortcuts

Go, Rust, Java, .NET projects automatically pass:
- `robustness-lint-typecheck` (built-in compiler checks)
- `stability-type-config` (language provides type safety)
