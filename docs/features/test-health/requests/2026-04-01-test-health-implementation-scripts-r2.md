# /test-health Implementation Scripts

> **Created**: 2026-04-01
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Depends On**: [R1 — Skill Definition](./2026-04-01-test-health-skill-definition-r1.md)

## Background

R1 建立 skill 定義後，本 request 負責實作 parser/trend scripts 和對應的 unit tests。這些 scripts 是 `/test-health` 的核心執行邏輯，被 SKILL.md 的 quick/full mode workflow 引用。

## Requirements

- 實作 `artifact-parser.js`：偵測 + 解析 LCOV / Istanbul JSON / Jest summary JSON / Cobertura XML / Go cover profile / Tarpaulin JSON / JaCoCo XML/CSV，含 artifact scan（depth limit 3）+ candidate selection（freshness > proximity > completeness）
- 實作 `count-parser.js`：解析各生態系 test runner stdout（node:test, jest, vitest, pytest, go, cargo）+ file count fallback
- 實作 `trend.js`：snapshot read/write + delta computation + rolling window pruning + lock/atomic-write
- 為每個 script 撰寫完整 unit tests

## Scope

| Scope | Description |
|-------|-------------|
| In | 3 implementation scripts + 3 unit test files |
| Out | SKILL.md 和 reference docs（見 R1）、`/pre-pr-audit` integration（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/test-health/scripts/artifact-parser.js` | New | Coverage artifact 偵測 + 解析模組 |
| `skills/test-health/scripts/count-parser.js` | New | Test count stdout 解析模組 |
| `skills/test-health/scripts/trend.js` | New | Trend snapshot read/write + delta + lock |
| `test/scripts/test-health-artifact-parser.test.js` | New | artifact-parser 單元測試 |
| `test/scripts/test-health-count-parser.test.js` | New | count-parser 單元測試 |
| `test/scripts/test-health-trend.test.js` | New | trend 單元測試 |

## Acceptance Criteria

- [ ] `artifact-parser.js` 正確解析 7 種格式：LCOV（`LF:/LH:` + `BRF:/BRH:`）、Istanbul JSON（`.total.lines.pct`）、Jest summary JSON、Cobertura XML（`line-rate/branch-rate`）、Go cover profile（statement count）、Tarpaulin JSON（`covered/coverable`）、JaCoCo XML/CSV（`INSTRUCTION` + `BRANCH` counters）
- [x] `artifact-parser.js` 對 `.coverage`（Python SQLite DB）輸出提示訊息而非嘗試解析
- [ ] `artifact-parser.js` 實作 artifact scan（depth limit 3 層）+ candidate selection priority（freshness > proximity > completeness）
- [x] `artifact-parser.js` 實作 freshness check（mtime vs HEAD commit timestamp）+ dirty tree detection（`git status --porcelain`）
- [x] `count-parser.js` 正確解析 6 種框架 stdout（node:test, jest, vitest, pytest, go -json, cargo）
- [x] `count-parser.js` Go package-level fallback 標記 `count_level: package`
- [x] `trend.js` 使用 `mkdir`（無 `-p`）atomic lock + `stat` mtime TTL 60s + rolling window 保留 30 筆
- [x] `trend.js` 實作 `tool_id + source_type` 和 `count_level` comparability rules
- [ ] Unit tests 覆蓋 happy path + error handling + edge cases（空檔案、格式錯誤、lock 衝突）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech spec completed + reviewed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 6/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Artifact formats: tech spec §3.4
- Count parsers: tech spec §3.5
- Trend storage: tech spec §3.6
- Related Request: [R1 — Skill Definition](./2026-04-01-test-health-skill-definition-r1.md)
