# Plugin Testing & Generalization — Technical Spec

> Consolidated from strategy brainstorm + implementation. Links to actual files included.

## Executive Summary

| Item | Decision | Status |
|------|----------|--------|
| Test runner | `node --test` (zero-dep, Node 18+) | ✅ Implemented |
| Pre-test refactor | Extract shared utils to [`scripts/lib/utils.js`](../../../scripts/lib/utils.js) | ✅ Implemented |
| Unit tests | Pure function tests for shared utilities | ✅ Implemented |
| Integration tests | Temp git repo + real runner execution | ✅ Implemented |
| dep-audit tests | Stub binaries in PATH | ✅ Implemented |
| Schema validation | Command frontmatter validation | ✅ Implemented |
| Smart fallback | AI-first: Try→Fallback + intent YAML frontmatter | ✅ Implemented |
| CI | GitHub Actions, Node 18/20/22 matrix | ✅ Implemented |
| Hook tests | stop-guard (8 cases) + post-tool-review-state (6 cases) | ✅ Implemented |
| Generalization | Ecosystem detection + mapping in command fallback docs | ✅ Implemented |

## 1. Shared Utility Extraction

### Files

| File | Purpose |
|------|---------|
| [`scripts/lib/utils.js`](../../../scripts/lib/utils.js) | 19 shared utility functions |
| [`scripts/precommit-runner.js`](../../../scripts/precommit-runner.js) | Imports from `./lib/utils` |
| [`scripts/verify-runner.js`](../../../scripts/verify-runner.js) | Imports from `./lib/utils` |

### Exported Functions

| Function | Category |
|----------|----------|
| `nowISO`, `sha1`, `safeSlug` | String utilities |
| `ensureDir`, `writeText`, `writeJson`, `appendLog` | File I/O |
| `runCapture`, `runStep`, `tailLinesFromFile` | Process execution |
| `gitRepoRoot`, `gitShortHead`, `gitHead`, `gitStatusSB`, `gitRemoteOrigin` | Git helpers |
| `detectPackageManager`, `readPackageJson`, `hasScript`, `pmCommand` | Package manager |

## 2. Test Suite

### Directory Structure

```
test/
  hooks/
    stop-guard.test.js              # 8 hook behavioral scenarios
    post-tool-review-state.test.js  # 6 hook behavioral scenarios
  scripts/
    lib/
      utils.test.js                 # 6 unit test suites
    precommit-runner.test.js        # 4 integration scenarios
    verify-runner.test.js           # 3 integration scenarios
    dep-audit.test.js               # 6 integration scenarios
  commands/
    schema.test.js                  # frontmatter + intent validation
```

### Test Files

| File | Type | Scenarios |
|------|------|-----------|
| [`test/scripts/lib/utils.test.js`](../../../test/scripts/lib/utils.test.js) | Unit | safeSlug, sha1, hasScript, pmCommand, detectPackageManager, tailLinesFromFile |
| [`test/hooks/stop-guard.test.js`](../../../test/hooks/stop-guard.test.js) | Hook | bypass, no transcript, state strict/warn, transcript strict/pass (8 cases) |
| [`test/hooks/post-tool-review-state.test.js`](../../../test/hooks/post-tool-review-state.test.js) | Hook | review pass/block, doc review, precommit, non-review, re-run flip (6 cases) |
| [`test/scripts/precommit-runner.test.js`](../../../test/scripts/precommit-runner.test.js) | Integration | full pass, missing lint:fix, test fallback, build failure |
| [`test/scripts/verify-runner.test.js`](../../../test/scripts/verify-runner.test.js) | Integration | fast mode, full mode, full+typecheck |
| [`test/scripts/dep-audit.test.js`](../../../test/scripts/dep-audit.test.js) | Integration | vulns found, clean, --help, unknown arg, --level high, no jq |
| [`test/commands/schema.test.js`](../../../test/commands/schema.test.js) | Schema | frontmatter validation + intent YAML for runner-backed commands |

### Running Tests

```bash
npm test                    # all 34 tests
npm run test:unit           # shared utility unit tests only
npm run test:integration    # runner integration tests only
npm run test:hooks          # hook behavioral tests only
npm run test:schema         # command frontmatter validation only
```

See [`package.json`](../../../package.json) for script definitions.

### Integration Test Patterns

**Runner tests**: Create temp git repo with dummy `package.json` + scripts that `exit 0` or `exit 1`. Cache isolated via `CLAUDE_PRECOMMIT_CACHE_DIR` / `CLAUDE_VERIFY_CACHE_DIR` env vars.

**dep-audit tests**: Stub binaries prepended to `PATH` to simulate `npm audit` output without real package managers.

## 3. Smart Fallback (Try → Fallback Pattern)

### Updated Commands

| Command | File | Changes |
|---------|------|---------|
| `/precommit` | [`commands/precommit.md`](../../../commands/precommit.md) | Step 1 try script → Step 2 fallback + graceful skip rules |
| `/precommit-fast` | [`commands/precommit-fast.md`](../../../commands/precommit-fast.md) | Same pattern |
| `/verify` | [`commands/verify.md`](../../../commands/verify.md) | Same pattern + fast/full mode docs |
| `/dep-audit` | [`commands/dep-audit.md`](../../../commands/dep-audit.md) | Try script → fallback to manual audit per PM |

### Fallback Trigger Rules

| Runner Result | Action |
|---------------|--------|
| `ENOENT` / `MODULE_NOT_FOUND` (runner missing) | Trigger intent-based fallback |
| Runner exits 0 | Use runner output |
| Runner exits non-zero | Surface the failure — do NOT trigger fallback |

### Graceful Skip Rules

Each command documents per-step skip behavior when scripts are missing. Example from `/precommit`:

| Scenario | Behavior |
|----------|----------|
| No `lint:fix` script | Skip, log note |
| No `build` script | Skip, log note |
| No `test:unit` or `test` script | Skip, log note |
| No `package.json` | Report error |

## 4. CI Pipeline

| File | Description |
|------|-------------|
| [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) | GitHub Actions — Node 18/20/22 matrix |

Triggers: push to `main`, pull requests.

## 5. Intent Metadata

> Implemented in YAML frontmatter on all 4 runner-backed commands. Schema validated by `test/commands/schema.test.js`.

### Intent Schema

```yaml
intent:
  goal: Run pre-commit quality checks
  steps:
    - name: lint-fix        # canonical step name
      goal: Auto-fix code style issues
      preferred: ["lint:fix"]
      alternatives: ["lint"]
      skip-if-missing: true
      safety: read-write
    - name: build
      preferred: ["build"]
      alternatives: ["typecheck"]
      skip-if-missing: true
      safety: read-only
    - name: test-unit
      preferred: ["test:unit"]
      alternatives: ["test"]
      skip-if-missing: true
      safety: read-only
  failure-behavior: stop-on-first-failure
```

### Safety Enforcement

| Safety Level | Behavior |
|--------------|----------|
| `read-only` | Execute immediately |
| `read-write` | Only in explicit user invocation; skip in automated contexts |

## 6. Generalization: Non-JS Ecosystems

> Implemented via ecosystem detection tables in all 4 runner-backed commands' fallback sections.

### Ecosystem Detection

| Manifest File | Ecosystem |
|---------------|-----------|
| `package.json` | Node.js |
| `pyproject.toml` / `requirements.txt` | Python |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `build.gradle` / `pom.xml` | Java |
| `Gemfile` | Ruby |
| `*.csproj` / `*.sln` | .NET |

### Canonical Step Mapping

| Canonical Step | Node.js | Python | Rust | Go |
|----------------|---------|--------|------|----|
| `lint-fix` | `{pm} lint:fix` | `ruff check --fix .` | `cargo clippy --fix` | `golangci-lint run --fix` |
| `lint` | `{pm} lint` | `ruff check .` | `cargo clippy` | `golangci-lint run` |
| `typecheck` | `{pm} typecheck` | `mypy .` | _(implicit)_ | `go vet ./...` |
| `build` | `{pm} build` | — | `cargo build` | `go build ./...` |
| `test-unit` | `{pm} test:unit` | `pytest tests/unit/` | `cargo test` | `go test ./...` |
| `audit` | `npm audit` | `pip-audit` | `cargo audit` | `govulncheck ./...` |

## 7. Open Items

- [x] ~~Add `intent:` YAML frontmatter to commands~~ — Done on 4 runner-backed commands
- [x] ~~Hook tests (stop-guard, post-tool-review-state)~~ — 14 scenarios implemented
- [x] ~~Ecosystem detection in fallback instructions~~ — Added to all 4 commands
- [ ] Manual smoke test for Python/Rust/Go projects (P8)
- [ ] Expand dep-audit.sh to natively support non-JS ecosystems (optional)
