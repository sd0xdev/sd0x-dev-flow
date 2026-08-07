# 新增 /adr skill：ADR（架構決策紀錄）撰寫

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-07
> **Status**: Pending
> **Note**: 本 feature 尚無 tech spec；實作前建議先跑 `/tech-spec` 定義 ADR 模板欄位與編號策略。
> **Priority**: P2

## Background

`rules/docs-numbering.md` 已定義 ADR 為 ancillary doc（pattern `adr-<number>-<title>.md`，`doc-classifier.js` 以 `semantic_pattern` 辨識、namespace `ancillary`），但目前沒有任何 skill 負責產生它——架構決策要嘛散落在 tech spec 裡，要嘛沒有留下可追溯的決策紀錄。

## Requirements

- 新增 `skills/adr/SKILL.md`：引導撰寫 ADR，輸出至 `docs/features/<feature>/adr-<number>-<title>.md`
- 提供 ADR 模板（`references/template.md`）：至少含 Context、Decision、Status（Proposed / Accepted / Superseded）、Consequences、替代方案；H1 標題帶 `ADR` 字樣，讓 `doc-taxonomy.json` 的 `semantic_pattern` 與 `heading_signals` 兩條辨識路徑都命中
- 編號策略：三位補零 `adr-001-<title>.md`；掃描目標 feature 目錄**根層及其 `archived/` 子目錄**（`doc-classifier.js` 於根層與遞迴皆跳過名為 `archived` 的目錄，那是 ancillary 文件的歸檔位置；`requests/archived/` 是 request 的歸檔處，ADR 不會落在該處）既有 `adr-*`，以**數值解析**（非字典序——字典序下 `adr-9` 排在 `adr-10` 後會重號）取最大號 +1
- Superseded 流程：新 ADR 取代舊 ADR 時，雙向互相連結（新指舊、舊標記被誰取代）
- feature 目錄解析沿用既有 feature-context 機制（canonical 實作：`scripts/lib/feature-resolver.js`）
- 註冊進 `docs/skill-catalog.yml`，並重產 README catalog 區塊（`node scripts/generate-readme-catalog.js`——只改 catalog 不重產 README 會讓 `/adr` 缺席對外目錄且計數失準）

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | `/adr` skill 本體、模板、編號、Superseded 連結、catalog 註冊、結構測試 |
| Out   | 既有決策的回溯補寫（另開 request）；`doc-classifier.js` 修改（pattern 已存在，無需動） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/adr/SKILL.md` | New | Skill 本體：trigger、workflow、編號與 Superseded 規則 |
| `skills/adr/references/template.md` | New | ADR 模板 |
| `test/skills/adr.test.js` | New | 結構測試：frontmatter、模板欄位、編號規則描述存在 |
| `docs/skill-catalog.yml` | Modify | 註冊 `/adr` |
| `README.md` | Modify | 執行 `node scripts/generate-readme-catalog.js` 重產 catalog 區塊（marker 由 `test/scripts/generate-readme-catalog.test.js` 驗證） |

## Acceptance Criteria

- [ ] `/adr` 可在指定 feature 下產生 `adr-<NNN>-<title>.md`（三位補零），編號以數值解析自動遞增、含歸檔位置在內不重號
- [ ] 模板含 Context / Decision / Status / Consequences / 替代方案五欄，H1 帶 `ADR` 字樣
- [ ] Superseded 時新舊 ADR 雙向連結
- [ ] 產出檔名通過 `doc-classifier.js` 的 ancillary 分類（`semantic_pattern` 命中，非 fallback）
- [ ] `docs/skill-catalog.yml` 含 `/adr` 條目，且 README catalog 區塊已重產
- [ ] 結構測試涵蓋 happy path + 錯誤處理（無 feature 目錄）+ 邊界（首個 ADR 檔名為 `adr-001-<title>.md`）
- [ ] Pass /codex-review-doc
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | - | |
| Development | - | |
| Testing | - | |
| Acceptance | - | |

**Status**: Pending / In Progress / Candidate Complete / Completed (canonical lifecycle — see create-request SKILL.md §Phase 4)

## References

- `rules/docs-numbering.md` § Ancillary docs — ADR pattern 定義
- `scripts/config/doc-taxonomy.json` — `ancillary` namespace
- `skills/create-request/references/feature-context-resolution.md` — feature 目錄解析慣例
