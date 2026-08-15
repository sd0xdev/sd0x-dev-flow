# /test-health Skill Definition

> **Created**: 2026-04-01
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

sd0x-dev-flow 有 6 個測試相關 skill，全部是質性審查或執行工具，完全缺乏量化覆蓋率測量能力。Best-practices audit（debate threadId `019d48cb-b758-7591-9190-a3dda6fcfa5a`）達成 Nash Equilibrium：建立新的 `/test-health` orchestrator skill，consume-first 策略，多維度 dashboard。本 request 負責 skill 定義（behavior-layer .md 檔案）。

## Requirements

- 建立 `/test-health` SKILL.md，定義 quick / full 兩種 mode
- 建立 coverage artifact 格式參考文件
- 建立 trend storage schema 參考文件
- 建立 test count parser 規格參考文件
- 建立 command entry point
- 更新 CLAUDE.md command tables（3 files）

## Scope

| Scope | Description |
|-------|-------------|
| In | SKILL.md + 3 reference docs + command .md + CLAUDE.md updates |
| Out | Parser/trend 實作 scripts（見 R2）、unit tests（見 R2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/test-health/SKILL.md` | New | Skill 定義（phases + modes + output schema） |
| `skills/test-health/references/artifact-formats.md` | New | 支援的 coverage artifact 格式規格 |
| `skills/test-health/references/trend-schema.md` | New | Trend storage schema + rolling window |
| `skills/test-health/references/test-count-parsers.md` | New | 各生態系 test count 解析規格 |
| `commands/test-health.md` | New | Command entry point |
| `test/commands/test-health.test.js` | New | Command schema 測試 |
| `CLAUDE.template.md` | Modify | Command Quick Reference 加入 `/test-health` |
| `CLAUDE.md` | Modify | Command Quick Reference 加入 `/test-health` |
| `.claude/CLAUDE.md` | Modify | Command Quick Reference 加入 `/test-health` |

## Acceptance Criteria

- [x] `skills/test-health/SKILL.md` 建立，含 quick/full mode workflow + output schema
- [x] `skills/test-health/references/artifact-formats.md` 建立，涵蓋 Node.js/Python/Go/Rust/Java/Generic
- [x] `skills/test-health/references/trend-schema.md` 建立，含 snapshot schema + rolling window + lock 策略
- [x] `skills/test-health/references/test-count-parsers.md` 建立，含各生態系 regex + `count_level` 定義
- [ ] `commands/test-health.md` 建立，含 `--full` / `--collect` / `--scope` / `--no-trend` flags
- [ ] `test/commands/test-health.test.js` 建立，驗證 command schema
- [ ] CLAUDE.md command tables 更新（3 files）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech spec completed + reviewed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 4/9 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Best Practices Audit: debate threadId `019d48cb-b758-7591-9190-a3dda6fcfa5a`
- Related Request: [R2 — Implementation Scripts](./2026-04-01-test-health-implementation-scripts-r2.md)
