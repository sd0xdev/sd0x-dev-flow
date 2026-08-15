# Debug Skill — Interactive Hypothesis-Driven Debugging

> **Created**: 2026-04-01
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

sd0x-dev-flow 缺少系統化的互動式除錯能力。現有 `/issue-analyze` 專注 GitHub Issue 分析，`/bug-fix` 假設根因已知。實際除錯場景需要「執行 → 觀察 → 假設 → 探測 → 定位根因」的迴圈，目前無 skill 覆蓋此工作流。

## Requirements

- Probe Protocol：假設驅動的探測迴圈（max 6 rounds + stagnation gate）
- Failure Taxonomy：根據問題類型（script bug, API error, config, silent failure, race condition, dependency）路由 first-probe 策略
- Phase 3 整合 `/seek-verdict --intent confirm` 獨立驗證根因（必要步驟）
- Phase 2 整合 `/codex-brainstorm` 處理多假設競爭（條件觸發）
- `--export` 選項匯出 Debug Report
- Probe Safety Rules：read-first default, write-probe gate, redaction

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md + references/ + command + test + CLAUDE.md + CLAUDE.template.md 更新 |
| Out | 跨 conversation debug session 持久化（v2）、分散式 tracing（專用工具） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/debug/SKILL.md` | New | 核心 skill 定義（Phase 0-5 workflow） |
| `skills/debug/references/failure-taxonomy.md` | New | 問題分類 + first-probe 路由表 |
| `skills/debug/references/probe-protocol.md` | New | Probe Loop 規則 + 終止判據 |
| `skills/debug/references/report-template.md` | New | Debug Report 模板 |
| `commands/debug.md` | New | Command 定義 + trigger keywords |
| `test/commands/debug.test.js` | New | 測試 |
| `CLAUDE.md` | Modify | 命令表新增 `/debug` |
| `CLAUDE.template.md` | Modify | 命令表新增 `/debug` |

## Acceptance Criteria

- [x] `skills/debug/SKILL.md` 包含 Phase 0-5 完整工作流
- [x] Probe Protocol 編碼假設驅動探測（max 6 rounds + stagnation gate + brainstorm escalation）
- [x] Failure Taxonomy 覆蓋 6 種問題類型（script bug, API error, config, silent failure, race condition, dependency）
- [x] Phase 3 必要整合 `/seek-verdict --intent confirm`（含 anti-anchoring 合約）
- [x] `--export` 匯出完整 Debug Report 至檔案（含 redaction）
- [ ] `commands/debug.md` frontmatter + trigger keywords 不與現有 skill 衝突
- [x] Probe Safety Rules 實作（read-first default, write-probe gate, deny list, timeout）
- [ ] `test/commands/debug.test.js` 覆蓋 trigger、phase routing、probe 終止判據
- [ ] `CLAUDE.md` + `CLAUDE.template.md` 命令表包含 `/debug`（通過 `claude-md-coverage.test.js`）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Tech spec + best practices audit + brainstorm debate |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 6/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Design origin: Best practices audit (Agans 9 Rules + Zeller Scientific Debugging + Google SRE)
- Debate: Codex brainstorm threadId `019d48c7-417b-7062-9341-f75c5f80130b`
