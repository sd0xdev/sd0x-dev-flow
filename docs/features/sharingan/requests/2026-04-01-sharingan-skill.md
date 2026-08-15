# Sharingan (寫輪眼) Skill — 外部 Skill 複製工具

> **Created**: 2026-04-01
> **Status**: In Progress
> **Priority**: P2
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

目前沒有工具能自動分析外部 GitHub repo/plugin/skill 並產出等效的 sd0x-dev-flow 格式 skill。手動複製和適配耗時且容易遺漏依賴關係。Sharingan skill 透過 GitHub API 讀取 → 語意分析 → 格式轉換 → 多層驗證的管線，自動產出可用的 skill 定義。

## Requirements

- 透過 `gh api` 讀取外部 repo（不 clone），分類為 plugin/collection/single/unknown
- 建立 dependency graph（DAG），topological sort 決定生成順序（leaf-first）
- 語意提取：intent, triggers, workflow, io_spec, exclusions, tool_deps
- Template 骨架（確定性）+ LLM 內容（靈活性）混合生成
- 3-layer validation（L1 frontmatter, L2 skill-lint.js, L3 LLM semantic check）
- 支援 `--mode analyze`（僅報告）和 `--mode generate`（報告+寫入）
- 漸進式批次生成（每批 ≤5 skills，需使用者確認）
- 安全：URL 驗證、repo-root containment、untrusted content rule

## Scope

| Scope | Description |
|-------|-------------|
| In | `/sharingan` skill（SKILL.md + 4 references + scanner script）、command registration、tests、CLAUDE.md 更新 |
| Out | Hook/Rule 自動生成（安全風險）、私有 repo 認證管理、非 GitHub 來源（v2）、local cache（v2） |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `skills/sharingan/SKILL.md` | New | 主 skill 定義（Phase 0-4 workflow） |
| `skills/sharingan/scripts/scan-repo.js` | New | Repo scanner（URL validation, classifier, dep graph） |
| `skills/sharingan/references/format-mapping.md` | New | 源格式→目標格式對映表 |
| `skills/sharingan/references/dependency-graph-algorithm.md` | New | 依賴圖建構演算法 |
| `skills/sharingan/references/output-template.md` | New | 報告輸出模板 |
| `skills/sharingan/references/quality-checklist.md` | New | 品質檢查清單 |
| `commands/sharingan.md` | New | Command registration |
| `test/scripts/sharingan-scan-repo.test.js` | New | Scanner 單元測試 |
| `test/commands/sharingan.test.js` | New | Command wiring 測試 |
| `CLAUDE.md` + `.claude/CLAUDE.md` + `CLAUDE.template.md` | Modify | Command table entry |

## Acceptance Criteria

### Core Skill (AC1-AC3)

- [x] AC1: `skills/sharingan/SKILL.md` 存在，包含 Phase 0-4 workflow（Validate → Scan → Analyze → Generate → Validate），frontmatter 含 name + routing signature（2+ cues）+ allowed-tools
- [x] AC2: `skills/sharingan/scripts/scan-repo.js` 實作 URL validation、repo classifier（plugin/collection/single/unknown）、dependency graph builder
- [x] AC3: Dependency graph 正確實作 DAG（edge: dependency→dependent, leaf=in-degree 0, cycle detection via SCC, >3 skill cycle → hard gate）

### References (AC4-AC5)

- [x] AC4: 4 reference files 存在且內容完整：
  - `format-mapping.md` — source→sd0x-dev-flow 對映表（frontmatter, routing signature, tools, rules, MCP）
  - `dependency-graph-algorithm.md` — DAG 建構演算法 + cycle handling
  - `output-template.md` — analyze/generate 報告模板（含必要 sections）
  - `quality-checklist.md` — L1/L2/L3 validation checklist
- [ ] AC5: `commands/sharingan.md` 存在，frontmatter 含 argument-hint，preloads 所有 references

### Output Contract (AC6-AC7)

- [x] AC6: `--mode analyze` 產出 analysis report，包含：repo type, per-skill summary table, dependency graph (mermaid), untranslatable elements table, generation plan
- [x] AC7: `--mode generate` 產出 SKILL.md + commands/*.md + generation report，其中：
  - 每個 skill 通過 L1（frontmatter schema）+ L2（skill-lint.js 0 P0/P1）+ L3（LLM semantic — no hallucinated tools/skills）
  - Generation report 包含 3 必要 section：Generated Skills table、Per-Skill Detail（files + confidence + routing signature）、Integration Checklist

### Security (AC8)

- [x] AC8: Security controls 完整實作：
  - URL regex validation（`^https://github\.com/...`）
  - `gh auth status` 前置檢查
  - `--skill` / `--target-dir` path traversal 拒絕（`..`、absolute、symlink）
  - `--target-dir` repo-root containment（`fs.realpathSync` + `path.relative` prefix check）
  - Untrusted content rule（忽略 fetched 指令、不執行 fetched code、sanitize before prompt）

### Integration (AC9-AC10)

- [ ] AC9: `CLAUDE.md` + `.claude/CLAUDE.md` + `CLAUDE.template.md` 三檔 command table 加入 `/sharingan` entry
- [x] AC10: Tests 完整：
  - `test/scripts/sharingan-scan-repo.test.js` — URL validation, classification, DAG, cycle detection, format mapping
  - `test/commands/sharingan.test.js` — frontmatter, skill reference, argument-hint, reference preloading

### Quality Gates

- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Deep research (3 agents, score 92/100) + tech spec (3 review rounds) |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 8/12 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Deep Research: 3-agent study (Agent Skills spec, skill anatomy, community patterns)
- Agent Skills Open Standard: [agentskills.io/specification](https://agentskills.io/specification)
