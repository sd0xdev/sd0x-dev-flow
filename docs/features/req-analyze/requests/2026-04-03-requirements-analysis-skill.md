# Requirements Analysis Skill

> **Created**: 2026-04-03
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [Requirements Analysis Tech Spec](../2-tech-spec.md)

## Background

Phase 1 (Requirements) 在 `docs-numbering.md` 定義但無 skill 產出 `1-requirements.md`。開發流程在「原始想法/需求」到「可行性分析」之間存在結構性缺口 -- 現有 request doc 跳過問題驗證直接列出實作檔案，tech spec 的 §1 是 solution-oriented 而非 user-outcome-oriented。

**Boundary contract**: `/req-analyze` 是 **problem-space only** -- 定義問題、分析 stakeholder、分解需求、排優先。不得排序解決方案、評估實作路徑、或產出可行性建議（solution-space 屬於 `/feasibility-study`）。

```mermaid
flowchart LR
    A[Raw idea] --> B[/req-analyze]
    B --> C{Need solution comparison?}
    C -->|Yes| D[/feasibility-study]
    C -->|No| E[/tech-spec]
    D --> E
    B -.->|problem contract| F[1-requirements.md]
    D -.->|solution contract| G[0-feasibility-study.md]
    E -.->|design contract| H[2-tech-spec.md]
```

## Requirements

| Need | Explanation |
|------|-------------|
| 專屬 `/req-analyze` skill | 擁有 `1-requirements.md` artifact（同 `/architecture` 擁有 `3-architecture.md` 的先例） |
| 3-tier budget system | `--quick` / `--standard` / `--deep` 覆蓋小功能到大型跨團隊需求 |
| First-principles decomposition | 復用 `/fp-brief` 的第一性原理分解 pattern（5 Why + 假設挖掘），非直接 invoke |
| Mandatory stakeholder scan | 各 tier 皆強制執行輕量 stakeholder 掃描 |
| Selective pattern reuse | Standard tier 使用 shared research-cascade pattern；deep tier 直接 invoke `/deep-research` |
| Completeness challenge | Deep tier 透過 Codex debate 驗證需求完整性 |
| Adjacent skill integration | `/create-request`、`/feasibility-study`、`/tech-spec`、`/next-step` 整合更新 |
| `1-requirements.md` output template | Problem statement, goals, stakeholders, use cases, FR, NFR, constraints, acceptance signals, open questions |

## Scope

| Scope | Description |
|-------|-------------|
| In | Core `/req-analyze` skill (SKILL.md + references)、`1-requirements.md` output template、`docs-numbering.md` Phase 1 update、adjacent skill integration（SKILL.md + script + template/reference 層）、shared feature-context schema 擴充（`has_requirements`） |
| Out | `/deep-research` 本身的修改、test scripts for existing skills（新 skill 的 test 在 scope 內） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/req-analyze/SKILL.md` | New | 主 skill 定義：trigger、workflow phases、budget tiers、verification |
| `skills/req-analyze/references/output-template.md` | New | `1-requirements.md` 標準模板 |
| `skills/req-analyze/references/research-cascade.md` | New | Shared research-cascade pattern 文件（避免 copy-paste drift） |
| `rules/docs-numbering.md` | Modify | Phase 1 output command 從 `-` 更新為 `/req-analyze` |
| `skills/next-step/SKILL.md` | Modify | 加入 conditional Phase 1 completeness check |
| `skills/feasibility-study/SKILL.md` | Modify | 偵測 `1-requirements.md` 時降級 Phase 1 為 validation |
| `skills/tech-spec/SKILL.md` | Modify | §1 以 `1-requirements.md` 為 source-of-truth |
| `skills/create-request/SKILL.md` | Modify | 新增 optional link to `1-requirements.md` |
| `skills/create-request/references/template.md` | Modify | 加入 `> **Requirements**: [Link](../1-requirements.md)` optional header |
| `skills/next-step/scripts/analyze.js` | Modify | 加入 `has_requirements` detection + Phase 1 completeness suggestion |
| `scripts/lib/feature-resolver.js` | Modify | 擴充 output schema 加入 `has_requirements` field |
| `skills/create-request/references/feature-context-resolution.md` | Modify | 更新 shared schema 文件含 `has_requirements` |
| `skills/tech-spec/references/template.md` | Modify | §1 加入 cross-reference to `1-requirements.md` when present |
| `skills/tech-spec/references/feature-context-resolution.md` | Modify | 同步 `has_requirements` schema（與 create-request 版本一致，或宣告 canonical 來源） |

## Acceptance Criteria

- [x] `skills/req-analyze/SKILL.md` 定義 3-tier budget (`--quick`/`--standard`/`--deep`)，含 trigger keywords、workflow phases
- [x] Quick tier: first-principles decomposition + mandatory stakeholder scan + requirement structuring + MoSCoW prioritization → 產出 `1-requirements.md`
- [x] Standard tier (default): quick + targeted code/context research + lightweight web validation（使用 shared research-cascade pattern）
- [x] Deep tier: standard + 直接 invoke `/deep-research` + completeness challenge pass（Codex debate）
- [x] `references/output-template.md` 含完整 `1-requirements.md` 模板（Problem, Goals, Stakeholders, Use Cases, FR, NFR, Constraints, Acceptance Signals, Open Questions）
- [x] `rules/docs-numbering.md` Phase 1 output command 更新為 `/req-analyze`
- [x] Adjacent skill integration：`/feasibility-study` consumes、`/tech-spec` references、`/next-step` checks、`/create-request` links
- [x] `references/research-cascade.md` 提取 shared research pattern（非 inline copy-paste from `/deep-research`）
- [x] Shared feature-context schema: `feature-resolver.js` output 加入 `has_requirements` field，`feature-context-resolution.md` 更新文件
- [x] Security guardrails: SKILL.md 含 path validation（reject `..` traversal, absolute paths）、untrusted web content handling、secret redaction rules
- [x] Budget tier 含 deterministic escalation triggers 和 early-exit criteria（避免 cost drift）
- [ ] Existing tests updated: `test/scripts/feature-resolver.test.js` 加入 `has_requirements` coverage、`test/scripts/next-step-analyze.test.js` 加入 Phase 1 check coverage
- [x] Cross-link invariant docs 更新：`feature-context-resolution.md`（both copies）含 `1-requirements.md` ↔ request/tech-spec link rules
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit-fast

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best-practices audit + Nash Equilibrium debate completed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 12/15 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Best Practices Audit: `/best-practices` 2026-04-03 session (Phase 1-4 complete)
- Codex Brainstorm: threadId `019d519f-5bcf-73a3-87e1-fe781a342f2c` (Nash Equilibrium reached, 3 rounds)
- Precedent: `/architecture` skill — `skills/architecture/SKILL.md` owning `3-architecture.md`（see `docs/features/architecture-skill/2-tech-spec.md`）
- Industry: [Requirements Analysis Guide](https://aqua-cloud.io/requirements-analysis-software-development-ultimate-guide/), [GenAI for RE (2026)](https://onlinelibrary.wiley.com/doi/full/10.1002/spe.70029)
