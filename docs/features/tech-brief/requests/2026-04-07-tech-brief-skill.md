# Create tech-brief Skill

> **Created**: 2026-04-07
> **Status**: In Progress
> **Priority**: P2
> **Tech Spec**: [tech-brief Tech Spec](../2-tech-spec.md)

## Background

開發完成後，工程師需要對技術同事分享成果（原理、源碼位置、設計決策、限制、討論連結）。現有 `/project-brief`（PM/CTO）和 `/fp-brief`（推理鏈）都無法滿足此需求。新增 `/tech-brief` skill 填補面向技術同事的事後分享文件缺口。

## Requirements

- 建立 `/tech-brief` skill，從 feature docs + git history + review metadata 整合產出技術分享文件
- 支援 3-stage multi-source collection（docs → git/code → request selection）
- 支援 depth 分級（brief/normal/deep）
- 整合 feature-resolver 5-level cascade 自動偵測 feature
- 輸出包含 Source Provenance table 確保可審計
- 路徑驗證 + secret redaction 安全機制
- 更新 doc-taxonomy 避免分類衝突

## Scope

| Scope | Description |
| ----- | ----------- |
| In | SKILL.md + references + taxonomy update + CLAUDE.md sync + tests |
| Out | 新 agent 定義（v1 inline）、自動觸發偵測、外部發佈 |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/tech-brief/SKILL.md` | New | Skill 定義（trigger, workflow, allowed-tools） |
| `skills/tech-brief/references/output-template.md` | New | 6 sections + Source Provenance + depth matrix |
| `skills/tech-brief/references/source-guide.md` | New | 3-stage collection strategy |
| `scripts/config/doc-taxonomy.json` | Modify | 新增 tech-brief ancillary type + tech-spec exclude pattern |
| `CLAUDE.md` | Modify | Command Quick Reference 新增 `/tech-brief` |
| `.claude/CLAUDE.md` | Modify | 同步 Command Quick Reference |
| `test/skills/tech-brief.test.js` | New | Skill 結構驗證測試 |
| `test/scripts/doc-classifier.test.js` | Modify | tech-brief classification test cases |

## Acceptance Criteria

- [x] `skills/tech-brief/SKILL.md` 存在，含正確 frontmatter（name, description, allowed-tools）、trigger、workflow、command signature
- [x] `references/output-template.md` 定義 6 sections + Source Provenance table + depth matrix（brief/normal/deep）
- [x] `references/source-guide.md` 定義 3-stage collection（docs → git/code reading → request selection with max 3 cap）
- [x] Feature resolver 整合：無參數時透過 5-level cascade 自動偵測 feature；支援 feature-key、dir path、doc path 三種輸入
- [x] Path security + save behavior：`..` traversal rejection + secret redaction；`--output <path>` 寫入指定路徑（含 `/tmp/`，repo 外 warning）；`--no-save` 僅 stdout；default 寫入 `docs/features/<key>/5-tech-brief.md`
- [x] `doc-taxonomy.json` 新增 `tech-brief` ancillary type；`tech-spec` type 的 `exclude_pattern` 包含 `-tech-brief\\.md$`
- [ ] `CLAUDE.md` 和 `.claude/CLAUDE.md` Command Quick Reference 都包含 `/tech-brief` 條目
- [x] `test/skills/tech-brief.test.js` 通過；`test/scripts/doc-classifier.test.js` 含 tech-brief classification cases
- [ ] Pass `/codex-review-fast`
- [ ] Pass `/precommit-fast`

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| Analysis | Done | Tech spec 完成（3 rounds review, ✅ Mergeable） |
| Development | In Progress | Implementation identified heuristically by batch `--update-all` (2026-08-15). This ticket records no per-AC `file:line` evidence — producing that is what `--verify-ac` is for |
| Testing | - | |
| Acceptance | In Progress | 7/10 AC verified against the repo by batch `--update-all` (2026-08-15); closure-grade sign-off still needs `--verify-ac` |

**Status**: In Progress

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Codex doc review threadId: `019d668b-ce30-7f10-8401-a06710cc45b3`
- Related skill pattern: `skills/fp-brief/SKILL.md`（depth + inline execution pattern）
- Related skill pattern: `skills/project-brief/SKILL.md`（brief naming convention）
