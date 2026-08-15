# Sharingan v2: Multi-Source Input — R1 設計基建

> **Created**: 2026-04-01
> **Status**: In Progress
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md) §7

## Background

Sharingan v1 僅接受 GitHub URL。Best Practices Audit（2026-04-01）+ Claude/Codex adversarial debate 達成 Nash Equilibrium，設計出 Delegation-First Router-Dispatcher 架構。R1 負責建立 v2 的設計基建：SourceBundle 規格、Input Classification 參考文件、及 routing signature 更新。

## Requirements

- 定義 SourceBundle 中間格式（canonical IR，解耦來源擷取與 skill 合成）
- 定義 Input Classification prompt template + confidence threshold
- 定義 3 source strategies 的正規化規則
- 更新 routing signature 支援多源輸入的 MECE boundary
- 更新 allowed-tools 加入 WebSearch/WebFetch/Skill

## Scope

| Scope | Description |
|-------|-------------|
| In | SourceBundle reference、Input Classification reference、routing signature 更新、allowed-tools 更新、reference preload 註冊 |
| Out | classifier / adapter 實作（R2）、scan-repo.js 改動（R2）、新測試（R2）、security envelope 實作（R2） |

### R1/R2 檔案所有權劃分

| File | R1 Ownership | R2 Ownership |
|------|-------------|-------------|
| `skills/sharingan/SKILL.md` | frontmatter、Trigger、allowed-tools、References 區段 | Phase 0B workflow、strategy dispatch、SourceBundle normalization 區段 |
| `commands/sharingan.md` | argument-hint、allowed-tools、references preload | v2 workflow 步驟 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/sharingan/references/source-bundle.md` | New | SourceBundle 規格 + normalization 規則 |
| `skills/sharingan/references/input-classification.md` | New | LLM classifier prompt + confidence threshold |
| `skills/sharingan/SKILL.md` | Modify | 更新 routing signature + allowed-tools + Trigger |
| `commands/sharingan.md` | Modify | argument-hint 改為 `<input>`、allowed-tools 更新 |

## Acceptance Criteria

- [x] AC1: `references/source-bundle.md` 定義 SourceBundle schema（source/knowledge/repo_analysis/synthesis_hints），包含 github_repo + external_evidence + local_code_context 三種 strategy 的正規化範例
- [x] AC2: `references/input-classification.md` 定義 LLM classifier prompt template，包含 confidence threshold（建議 0.7）、low-confidence guard 流程、5+ 輸入分類範例
- [x] AC3: SKILL.md routing signature 更新為 output-based MECE："Replicate knowledge from any source as sd0x-dev-flow skill definition"，含 Use when + Not for + Output（2+ cues）
- [x] AC4: SKILL.md allowed-tools 新增 `WebSearch`, `WebFetch`, `Skill`
- [ ] AC5: SKILL.md Trigger 區段擴展接受任意輸入描述，但保留 temporary guard：Phase 0B + adapters 實作前（R2），非 GitHub 輸入時 SKILL.md Phase 0 步驟輸出包含 `v2 planned, currently GitHub URL only` 字串，可用 `grep "v2 planned" skills/sharingan/SKILL.md` 驗證
- [ ] AC6: `commands/sharingan.md` argument-hint 更新為 `<input>` + `--source` optional flag
- [ ] AC7: `commands/sharingan.md` allowed-tools 與 SKILL.md allowed-tools 同步更新（新增 WebSearch, WebFetch, Skill）
- [ ] AC8: `commands/sharingan.md` references preload 新增 `@skills/sharingan/references/source-bundle.md` 和 `@skills/sharingan/references/input-classification.md`，SKILL.md References 區段同步列出
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best Practices Audit + adversarial debate (Nash Equilibrium) |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | N/A (docs only, /codex-review-doc) |
| Acceptance | In Progress | 4/9 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

**Status**: In Progress

## References

- Tech Spec §7: [2-tech-spec.md](../2-tech-spec.md) — v2 Multi-Source Input Architecture
- Best Practices Audit: 2026-04-01, threadId `019d48fb-9dd0-7473-9aa2-439fd492b813`
- Industry sources: [clig.dev](https://clig.dev/), [Block Engineering](https://engineering.block.xyz/blog/3-principles-for-designing-agent-skills), [AWS Routing Pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/routing-dynamic-dispatch-patterns.html)
