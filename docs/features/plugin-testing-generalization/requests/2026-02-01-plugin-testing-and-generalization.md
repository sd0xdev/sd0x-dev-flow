# Plugin Testing & Generalization

| Field | Value |
|-------|-------|
| Status | **Nearly Complete** |
| Priority | P1 |
| Created | 2026-02-01 |
| Updated | 2026-02-01 |
| Feature | plugin-testing-generalization |

## Summary

Add automated tests to plugin scripts/hooks for stability, and generalize commands to work across all project ecosystems (not just JS/TS).

## Related Documents

| Document | Purpose |
|----------|---------|
| [Feasibility Study](../0-feasibility-study.md) | Option analysis (A/B/C), Codex discussion record |
| [Tech Spec](../2-tech-spec.md) | Implementation details with file links |

## Acceptance Criteria

### Phase 1: Testing Infrastructure

- [x] Shared utility extraction (`scripts/lib/utils.js`) — 19 functions deduplicated from 2 runners
- [x] Unit tests for shared utilities — 6 test suites in `test/scripts/lib/utils.test.js`
- [x] Integration tests for precommit-runner — 4 scenarios in `test/scripts/precommit-runner.test.js`
- [x] Integration tests for verify-runner — 3 scenarios in `test/scripts/verify-runner.test.js`
- [x] Integration tests for dep-audit — 6 scenarios in `test/scripts/dep-audit.test.js`
- [x] Command frontmatter schema + intent validation — `test/commands/schema.test.js`
- [x] `package.json` with test scripts (`test`, `test:unit`, `test:integration`, `test:hooks`, `test:schema`)
- [x] GitHub Actions CI (Node 18/20/22 matrix) — `.github/workflows/ci.yml`
- [x] Hook behavioral tests — stop-guard (8 cases) + post-tool-review-state (6 cases) in `test/hooks/`
- [x] Expanded integration tests — build failure, verify full+typecheck, dep-audit --level/no-jq

### Phase 2: Smart Fallback (Try -> Fallback)

- [x] `/precommit` — Try script -> fallback + graceful skip + intent frontmatter + ecosystem detection
- [x] `/precommit-fast` — Try script -> fallback + graceful skip + intent frontmatter + ecosystem detection
- [x] `/verify` — Try script -> fallback + fast/full mode + intent frontmatter + ecosystem detection
- [x] `/dep-audit` — Try script -> fallback to manual audit + intent frontmatter + ecosystem detection
- [x] `intent:` YAML frontmatter on all 4 runner-backed commands

### Phase 3: Non-JS Generalization

- [x] Ecosystem detection in fallback instructions (Node, Python, Rust, Go, Java)
- [x] Canonical step mapping encoded in command docs
- [ ] Manual smoke test — Python project
- [ ] Manual smoke test — Rust or Go project

## Progress

| Area | Status | Details |
|------|--------|---------|
| Feasibility Study | ✅ Complete | Option A selected (Minimal Testing + Intent-First) |
| Tech Spec | ✅ Complete | Consolidated from strategy brainstorm |
| Shared Utils | ✅ Complete | `scripts/lib/utils.js` — 19 exported functions |
| Unit Tests | ✅ Complete | 6 suites, all passing |
| Integration Tests | ✅ Complete | 13 scenarios (precommit: 4, verify: 3, dep-audit: 6) |
| Schema Tests | ✅ Complete | Frontmatter + intent validation |
| CI Pipeline | ✅ Complete | GitHub Actions, Node 18/20/22 |
| Command Fallback | ✅ Complete | 4 commands with Try->Fallback + ecosystem detection |
| Hook Tests | ✅ Complete | 14 scenarios (stop-guard: 8, review-state: 6) |
| Intent Frontmatter | ✅ Complete | YAML `intent:` on 4 runner-backed commands |
| Ecosystem Generalization | ✅ Complete | 5 ecosystems in fallback detection tables |
| Manual Smoke Tests | ⬜ Not Started | Python/Rust/Go validation pending |

## Changed Files

### New Files

| File | Purpose |
|------|---------|
| `scripts/lib/utils.js` | Shared utility functions (19 exports) |
| `test/hooks/stop-guard.test.js` | Stop-guard hook tests (8 scenarios) |
| `test/hooks/post-tool-review-state.test.js` | Review-state hook tests (6 scenarios) |
| `test/scripts/lib/utils.test.js` | Unit tests |
| `test/scripts/precommit-runner.test.js` | Precommit integration tests |
| `test/scripts/verify-runner.test.js` | Verify integration tests |
| `test/scripts/dep-audit.test.js` | Dep-audit integration tests |
| `test/commands/schema.test.js` | Frontmatter schema validation |
| `package.json` | Test scripts + project metadata |
| `.github/workflows/ci.yml` | CI pipeline |
| `CONTRIBUTING.md` | Contributor guide |
| `docs/features/plugin-testing-generalization/0-feasibility-study.md` | Feasibility analysis |
| `docs/features/plugin-testing-generalization/2-tech-spec.md` | Technical spec |

### Modified Files

| File | Changes |
|------|---------|
| `scripts/precommit-runner.js` | Imports from `./lib/utils` (removed ~260 lines of duplication) |
| `scripts/verify-runner.js` | Imports from `./lib/utils` (removed ~260 lines of duplication) + fixed `overallPass` skip handling |
| `commands/precommit.md` | Try->Fallback + intent frontmatter + ecosystem detection |
| `commands/precommit-fast.md` | Try->Fallback + intent frontmatter + ecosystem detection |
| `commands/verify.md` | Try->Fallback + intent frontmatter + ecosystem detection |
| `commands/dep-audit.md` | Try->Fallback + intent frontmatter + ecosystem detection |

### Deleted Files

| File | Reason |
|------|--------|
| `docs/0-testing-and-fallback-strategy.md` | Content consolidated into tech-spec |

## Next Actions

| Priority | Action | Prerequisite |
|----------|--------|-------------|
| ~~1~~ | ~~P3: Hook behavioral tests~~ | ✅ Done — 14 scenarios |
| ~~2~~ | ~~Expand integration test scenarios~~ | ✅ Done — 13 total |
| ~~3~~ | ~~Add `intent:` YAML frontmatter~~ | ✅ Done — 4 commands |
| ~~4~~ | ~~Ecosystem detection in fallback~~ | ✅ Done — 5 ecosystems |
| 5 | Manual smoke test for Python/Rust/Go | None |
