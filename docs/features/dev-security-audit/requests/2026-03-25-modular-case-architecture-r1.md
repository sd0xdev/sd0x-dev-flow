# Modular Case Architecture for dev-security-audit

> **Created**: 2026-03-25
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: N/A (design decisions captured in Design Decisions section below)

## Background

`dev-security-audit` skill 目前將 Apifox 供應鏈攻擊案例硬編碼在 SKILL.md 中（佔 19%），無法疊代新增其他案例。經 best-practices 審計（NIST SP 800-61r3 + STIX/TAXII + codex-brainstorm 辯論），需重構為模組化案例架構。

## Requirements

- 將 SKILL.md 重構為 case-agnostic 通用框架
- 建立 `references/cases/` 目錄結構 + 案例 template
- 將 Apifox 內容抽出為獨立案例檔，整合白帽醬完整技術分析報告 IoC
- Phase 0 改為通用 Supply Chain IoC Dispatcher（selection key: platform + product presence；無匹配案例 → skip Phase 0；多匹配 → 逐一執行；回報欄位: case_id / status / confidence）
- 加入 Phase 2 parallel scan output contract：(1) Tracks A/B/C 可透過 subagent 並行 (2) 統一輸出 schema `Category | Path | Severity | Redacted Sample | Action` (3) 以 `(Path + Indicator Type)` 去重合併 (4) Critical/Critical+ 發現立即浮出，不等完整報告
- Report template 泛化（移除硬編碼 Apifox 欄位）

## Scope

| Scope | Description |
| ----- | ---------------------------------- |
| In | SKILL.md 重構、cases/ 目錄建立、Apifox 案例完整建立、parallel scan 規則 |
| Out | 其他案例建立（未來按需新增）、CLAUDE.md command table 更新（後續 PR） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/dev-security-audit/SKILL.md` | Modify | 重構為 case-agnostic 框架，Phase 0 通用化 |
| `skills/dev-security-audit/references/cases/README.md` | New | 案例目錄 + frontmatter schema template |
| `skills/dev-security-audit/references/cases/apifox-2026-03.md` | New | 完整 Apifox 案例（IoC + detection + cleanup + attack chain appendix） |
| `skills/dev-security-audit/references/apifox-cleanup.md` | Delete | 內容遷移至案例檔 |

## Acceptance Criteria

- [x] SKILL.md 不包含任何 Apifox-specific 內容（grep 驗證）
- [x] `references/cases/README.md` 包含案例 template（frontmatter: case_id, status, last_updated, review_by, platforms, attack_window, confidence）
- [x] `references/cases/apifox-2026-03.md` 包含完整 IoC 表格（網路指標、主機指標、加密指標 — 來源白帽醬文章）
- [x] Apifox 案例檔包含完整攻擊鏈（Stage-1/2 loader + 信息竊取 + 持久化 + FRP sys-gateway 後門）
- [ ] Phase 0 為通用 dispatcher（selection key: platform + product presence；無匹配 → skip；多匹配 → iterate；回報: case_id / status / confidence）
- [ ] Phase 2 包含 4 條 parallel scan merge 規則（subagent 並行、統一 schema、去重、Critical 立即浮出）
- [x] Report template 使用 `Supply Chain Status` 取代 `Apifox IoC`
- [x] `rg "apifox-cleanup.md" skills/dev-security-audit/` 回傳 0 結果（無殘留引用）
- [ ] 刪除的 `apifox-cleanup.md` 內容已完整遷移至案例檔 Cleanup 章節
- [ ] Pass `/codex-review-doc`

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | best-practices 審計完成（3 輪 codex-brainstorm 辯論） |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 6/10 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## Design Decisions (from best-practices audit)

| Decision | Rationale | Debate Round |
|----------|-----------|--------------|
| 每個案例一個檔案（非子目錄） | Progressive loading 效率、專案無嵌套 references 先例 | R1: Codex concedes |
| Frontmatter schema + 固定章節順序 | 平衡結構化與靈活性，不需完整 STIX | R2: Converge |
| `review_by` 軟過期（非硬 TTL） | 避免隱藏仍有用的 IoC | R2: Converge |
| 單檔 + 選讀 Appendix（非雙檔） | 減少認知負擔、避免主觀分拆決策 | R3: Nash Equilibrium |
| 500 行分割觸發器 | 超過才拆分 -analysis.md | R3: Agreed |

## References

- best-practices 審計 threadId: `019d2534-d122-77e2-8d2a-78c072a396c1`
- [白帽醬技術分析：Apifox 供应链投毒攻击完整技术分析](https://rce.moe/2026/03/25/apifox-supply-chain-attack-analysis/) (2026-03-25)
- [NIST SP 800-61r3](https://csrc.nist.gov/pubs/sp/800/61/r3/final)
- [OASIS STIX Introduction](https://oasis-open.github.io/cti-documentation/stix/intro.html)
- [counteractive IR playbook template](https://github.com/counteractive/incident-response-plan-template/blob/master/playbooks/playbook-supply-chain.md)
