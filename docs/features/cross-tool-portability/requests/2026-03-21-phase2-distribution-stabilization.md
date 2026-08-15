# Phase 2: Distribution Stabilization

> **Created**: 2026-03-21
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Depends On**: [Platform Governance Integrity](./2026-03-21-platform-governance-integrity.md)

## Background

P0 integrity 修復完成後，`npx skills add` 分發路徑即被解鎖。此 request 聚焦於完成 L1（skill distribution）的端到端驗證，以及穩定化 `codex-setup` 的 Tier C 保證（Codex CLI / Aider）。來自 gstack 競爭分析的借鑑：gstack 用 `--host auto` 一鍵安裝至所有平台，我們的對應策略是分層保證（A/B/C），先穩定 Tier C 再擴展。

## Requirements

- 驗證 `npx skills add sd0xdev/sd0x-dev-flow` 完整安裝 skills 至 `.agents/skills/`
- 穩定化 `codex-setup init`：AGENTS.md kernel 產出 + git hooks + runner scripts
- 穩定化 `codex-setup doctor`：完整性檢查（檔案存在 + hash 比對）
- 穩定化 `codex-setup sync`：`npx skills update` 後同步 AGENTS.md + hooks
- 驗證 Tier C 端到端：Codex CLI 使用 sd0x-dev-flow skills 完成 review 任務

## Scope

| Scope | Description |
|-------|-------------|
| In | npx skills add 驗證、codex-setup 三指令穩定化、Tier C 端到端測試、AGENTS.md kernel 品質 |
| Out | Windsurf adapter（Phase 3）、Cursor adapter（deferred per tech spec）、Gemini CLI adapter（deferred） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/codex-setup/SKILL.md` | Modify | 穩定化 init/doctor/sync |
| `scripts/build-codex-artifacts.js` | Modify | Kernel 產出品質改善 |
| `.claude-plugin/plugin.json` | Verify | 確認 skills 陣列正確（P0 產出） |
| `test/scripts/build-codex-artifacts.test.js` | Modify | 增加端到端驗證 |

## Acceptance Criteria

- [ ] `npx skills add sd0xdev/sd0x-dev-flow` 成功安裝所有 skills 至 `.agents/skills/`
- [x] `codex-setup init` 產出有效 AGENTS.md kernel（≤ 24 KiB）
- [ ] `codex-setup doctor` 偵測並報告所有完整性問題
- [x] `codex-setup sync` 正確同步更新後的 artifacts
- [ ] Tier C 端到端：Codex CLI 可透過 skills 完成至少一個 review 任務
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | - | Tech spec Phase 2 已設計 |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 2/7 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [cross-tool-portability/2-tech-spec.md](../2-tech-spec.md) Section 3.3-3.4
- Phase 1 Request (Done): [2026-03-09-phase1-skill-distribution-and-kernel-generator.md](./2026-03-09-phase1-skill-distribution-and-kernel-generator.md)
- P0 Dependency: [2026-03-21-platform-governance-integrity.md](./2026-03-21-platform-governance-integrity.md)
- Source: Best-practices audit — gstack multi-platform support analysis (2026-03-21)
