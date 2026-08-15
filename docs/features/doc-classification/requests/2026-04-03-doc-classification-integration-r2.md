# Doc Classification Integration

> **Created**: 2026-04-03
> **Status**: In Progress
> **Priority**: P2
> **Tech Spec**: [Doc Classification Tech Spec](../2-tech-spec.md)
> **Depends On**: [Doc Classification Foundation](./2026-04-03-doc-classification-foundation-r1.md)

## Background

r1 建立了分類基礎設施（taxonomy registry + classifier + expanded probe）。本 request 將分類結果整合到 `/update-docs` handler dispatch、更新 `docs-numbering.md` 啟用 dual namespace、並遷移 downstream consumers 從硬編碼 `2-tech-spec.md` 改為 `canonical_docs`。

## Requirements

- `/update-docs` 加入 dual mode（target=file / target=feature）+ type-aware handler dispatch
- `/update-docs` target=feature 使用 shared research pass（一次 git diff + doc inventory，結果傳入各 handler）
  - Shared context: `{ gitDiff, docInventory, canonicalDocs, featureKey, docsPath }`
  - 每個 handler 接收同一份 context，不重複 git/filesystem 操作
- `docs-numbering.md` 正式引入 dual namespace（lifecycle `<N>-` + ancillary `<type>-`）
- Downstream consumers 遷移：`analyze.js`、`skills/tech-spec/SKILL.md`、`skills/architecture/SKILL.md` + references 改用 `canonical_docs`（路徑組合：`${docs_path}/${canonical_docs.<role>.file}`）
- 同步所有 duplicated resolver docs（`create-request/references/`、`resolve-feature.sh`、`next-step/SKILL.md`、`feature-dev/SKILL.md`）
- Optional: `.sd0x/doc-taxonomy.overrides.json` 支援 + 加入 `.gitignore`（僅忽略 override 檔案，不影響已追蹤的 `.sd0x/install-state.json`）
  - Override 驗證規則：僅接受 taxonomy 中已註冊的 type ID、路徑限制 feature-relative、無效項目忽略並 warn

## Scope

| Scope | Description |
|-------|-------------|
| In | `/update-docs` handler dispatch, `docs-numbering.md` dual namespace, downstream consumer migration (`analyze.js`, `skills/tech-spec/SKILL.md`, `skills/architecture/SKILL.md` + references), duplicated resolver sync, override file support |
| Out | New sync handlers beyond `tech-spec` and `generic`（未來按需加入）; auto-detection of completely unknown doc types (covered by fallback in r1) |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `commands/update-docs.md` | Modify | Add dual mode + handler dispatch logic |
| `rules/docs-numbering.md` | Modify | Add dual namespace section (lifecycle + ancillary) |
| `skills/next-step/scripts/analyze.js` | Modify | Replace hardcoded `2-tech-spec.md` with `docs_path + canonical_docs.tech_spec.file` |
| `skills/next-step/SKILL.md` | Modify | Update schema reference for expanded probe output |
| `skills/tech-spec/SKILL.md` | Modify | Replace hardcoded `2-tech-spec.md` with `canonical_docs.tech_spec.file` for upsert detection |
| `skills/architecture/SKILL.md` | Modify | Replace hardcoded `2-tech-spec.md`/`3-architecture.md` with `canonical_docs` lookup |
| `skills/architecture/references/codex-prompt.md` | Modify | Replace hardcoded tech-spec path in Codex research commands |
| `skills/architecture/references/template.md` | Modify | Replace hardcoded `2-tech-spec.md` cross-reference with `canonical_docs` |
| `skills/create-request/references/feature-context-resolution.md` | Modify | Sync with canonical copy (updated in r1) |
| `scripts/resolve-feature.sh` | Modify | Update output docs comment for new schema |
| `skills/feature-dev/SKILL.md` | Modify | Align "3-level fallback" to shared spec |
| `.gitignore` | Modify | Add `.sd0x/doc-taxonomy.overrides.json` entry |

## Acceptance Criteria

- [ ] `/update-docs docs/features/<key>/2-tech-spec.md` 仍然只更新該檔案（target=file backward compat）
- [ ] `/update-docs <keyword>` inventory all docs + dispatch to handler-supported types
- [ ] handler dispatch 使用 shared research pass（`{ gitDiff, docInventory, canonicalDocs }` 只計算一次）
- [x] `docs-numbering.md` 允許 `<type>-<name>.md` ancillary docs（不再違反 "must have numeric prefix"）
- [ ] `analyze.js` 使用 `${featureCtx.docs_path}/${featureCtx.canonical_docs.tech_spec.file}` 而非硬編碼 `2-tech-spec.md`
- [ ] `skills/tech-spec/SKILL.md` upsert detection 使用 `canonical_docs.tech_spec.file` 而非硬編碼路徑
- [ ] `skills/architecture/SKILL.md` + references 使用 `canonical_docs` 而非硬編碼 `2-tech-spec.md` / `3-architecture.md`
- [x] `scripts/resolve-feature.sh` output docs 反映新 schema
- [ ] `skills/feature-dev/SKILL.md` fallback 描述與 shared spec 一致
- [ ] `create-request/references/feature-context-resolution.md` 與 canonical copy 一致
- [ ] `.sd0x/doc-taxonomy.overrides.json` 在 `.gitignore` 中（不影響 `.sd0x/install-state.json`）
- [ ] Override 驗證：僅接受已註冊 type ID、feature-relative 路徑、無效項目 warn + ignore
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Tech-spec + r1 foundation landed |
| Development | - | r1 foundation available; integration pending |
| Testing | - | |
| Acceptance | In Progress | 2/14 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

## References

- Tech Spec: [doc-classification](../2-tech-spec.md)
- Foundation: [r1](./2026-04-03-doc-classification-foundation-r1.md)
- Best Practices Debate: threadId `019d51c0-f186-7623-a0a4-9eaf856a8c12`
