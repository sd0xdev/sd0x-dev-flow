# Doc Classification Foundation

> **Created**: 2026-04-03
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [Doc Classification Tech Spec](../2-tech-spec.md)

## Background

`/update-docs` 只能辨識 `2-tech-spec.md`，`probe()` 只回傳 `has_tech_spec` boolean。真實使用已出現跨服務確認清單、ADR 等文件類型無法被自動分類。Best practices audit 評分 1/5 FAIL。本 request 建立分類基礎設施（taxonomy registry + classifier + probe 擴展）。

## Requirements

- 建立 `doc-taxonomy.json` 定義 known types（lifecycle 0-4 + ancillary semantic）
- 實作 `doc-classifier.js` 支援 7-step 分類 precedence（override → exclude → canonical → variant → lifecycle-prefix → heading → fallback）
- 處理 derived artifacts（`2-tech-spec-fp-brief.md` 不被誤判為 tech-spec）
- 處理 folder-backed lifecycle phases（`0-feasibility-study/` 遞迴掃描）
- 處理 numbered variants（`3-auto-loop-integration.md` → phase 3 variant）
- 擴展 `probe()` 回傳 `doc_inventory[]` + `canonical_docs` + 所有 legacy booleans（`has_tech_spec`, `has_requirements`, `has_requests`）
- CLI tool 輸出 machine-readable JSON inventory
- 遞迴掃描限制：只處理 `.md` 檔案、忽略 symlinks、skip `requests/` 和 `archived/` 子目錄、deep mode 僅讀取前 20 行

## Scope

| Scope | Description |
|-------|-------------|
| In | `doc-taxonomy.json`, `doc-classifier.js`, `classify-docs-cli.js`, `probe()` 擴展（含所有 legacy fields: `has_tech_spec`, `has_requirements`, `has_requests`）, `feature-context-resolution.md` 更新（含 `create-request` duplicate sync）, 完整測試 |
| Out | `/update-docs` handler dispatch (r2), `docs-numbering.md` dual namespace 規則更新 (r2), override file support (r2), downstream consumer migration — `analyze.js`, `/tech-spec`, `/architecture` (r2). **Note**: r2 出貨前 `docs-numbering.md` 仍禁止 unnumbered feature docs，taxonomy registry 先就緒但 ancillary naming 規則由 r2 啟用。 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/config/doc-taxonomy.json` | New | Type registry with lifecycle + ancillary types |
| `scripts/lib/doc-classifier.js` | New | Classification engine (classifyByPath, scanFeatureDocs, pickCanonicalDocs) |
| `scripts/classify-docs-cli.js` | New | CLI wrapper for JSON inventory output |
| `scripts/lib/feature-resolver.js` | Modify | Expand `probe()` to return doc_inventory + canonical_docs |
| `skills/tech-spec/references/feature-context-resolution.md` | Modify | Update schema to document new probe output (canonical copy) |
| `skills/create-request/references/feature-context-resolution.md` | Modify | Sync with canonical copy |
| `test/scripts/doc-classifier.test.js` | New | Unit tests for classifier |
| `test/scripts/classify-docs-cli.test.js` | New | CLI output schema validation |
| `test/scripts/feature-resolver.test.js` | Modify | Extend for expanded probe schema |

## Acceptance Criteria

- [x] `doc-taxonomy.json` 包含 5 個 lifecycle types + 至少 5 個 ancillary types，每個有 `canonical_filename` 或 `semantic_pattern`
- [x] `classifyByPath("2-tech-spec.md")` → `{ type: "tech-spec", is_canonical: true, confidence: "high" }`
- [x] `classifyByPath("2-tech-spec-fp-brief.md")` → `{ type: "fp-brief" }` (not tech-spec)
- [x] `classifyByPath("3-auto-loop-integration.md")` → `{ type: "architecture", is_canonical: false }` (lifecycle prefix fallback)
- [x] `scanFeatureDocs()` 遞迴掃描 folder-backed phases（`0-feasibility-study/` 下的子文件被分類為 feasibility variant）
- [x] `probe()` 回傳 `doc_inventory[]` + `canonical_docs` + `has_tech_spec` + `has_requirements` + `has_requests`（所有 legacy fields（`has_tech_spec`, `has_requirements`, `has_requests`）保留，向後相容）
- [x] `scanFeatureDocs()` 只處理 `.md` 檔案、忽略 symlinks、skip `requests/` 和 `archived/`、deep mode 限讀前 20 行
- [x] `node scripts/classify-docs-cli.js --feature <key>` 輸出合法 JSON（`test/scripts/classify-docs-cli.test.js` 驗證）
- [ ] Unit test coverage ≥ 80%（classifier + expanded probe）
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best practices audit + tech-spec completed |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 8/11 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [doc-classification](../2-tech-spec.md)
- Best Practices Debate: threadId `019d51c0-f186-7623-a0a4-9eaf856a8c12`
- Doc Review: threadId `019d51cf-a672-7d80-924c-7e9612e6fcbe`
- Sibling: r2 (v1 integration — `/update-docs` handler dispatch + downstream migration)
