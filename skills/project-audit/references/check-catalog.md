# Check Catalog (v1)

## 12 Checks × 5 Dimensions

| # | Check ID | Dimension | Detection | Scoring |
|---|----------|-----------|-----------|---------|
| 1 | `oss-license` | oss | LICENSE/LICENSE.md/COPYING exists | pass/fail |
| 2 | `oss-readme` | oss | README sections count + line count | pass(>=50L,>=4S) / partial(>=20L,>=2S) / fail |
| 3 | `robustness-ci` | robustness | .github/workflows/, .gitlab-ci.yml, etc. | pass/fail |
| 4 | `robustness-lint-typecheck` | robustness | package.json scripts + tsconfig / Go/Rust built-in; docs-heavy (>=60% docs, >=30 files): markdownlint config + script | pass/partial/fail |
| 5 | `robustness-test-ratio` | robustness | test files / src files ratio | pass(>=30%) / partial(>=10%) / fail |
| 6 | `scope-declared-impl` | scope | docs/features/ dirs vs code files (excluding test indicators) | pass/fail/N/A |
| 7 | `scope-ac-completion` | scope | `[x]` vs `[ ]` count in feature docs | pass(>=80%) / partial(>=50%) / fail |
| 8 | `runnability-manifest` | runnability | package.json/go.mod/Cargo.toml etc. | pass/fail (P0) |
| 9 | `runnability-scripts` | runnability | Runtime (detected by start/dev/serve): score start/dev/build/test (>=3 pass); Non-runtime: test only (pass) | pass/partial/fail/N/A |
| 10 | `runnability-env-docker` | runnability | .env.example / docker-compose.yml; Node-only zero deps + no runtime scripts → N/A | pass/fail/N/A |
| 11 | `stability-lock-audit` | stability | lock file + audit script; Node zero-deps → N/A | pass/partial/fail/N/A |
| 12 | `stability-type-config` | stability | tsconfig.json / static-typed lang; pure JS (.ts/.tsx/.mts/.cts absent) → partial | pass/partial/fail |

## Priority Mapping

| Check Result | Priority |
|-------------|----------|
| `oss-readme` fail (no README) | P0 |
| `runnability-manifest` fail | P0 |
| `runnability-env-docker` fail | P2 |
| `stability-type-config` fail | P2 |
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
| dotnet | *.csproj,*.sln |

## Static-Typed Language Shortcuts

Go, Rust, Java, .NET projects automatically pass:

- `robustness-lint-typecheck` (built-in compiler checks)
- `stability-type-config` (language provides type safety)
