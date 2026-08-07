# Codex MCP Server 啟動預設加入 model_reasoning_effort=high

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-07
> **Status**: Pending
> **Note**: 本 feature 尚無 tech spec；實作前建議先跑 `/tech-spec`。落點已定案為 README.md（見 Requirements）——repo 內目前沒有任何檔案記載 `codex mcp-server` 的註冊指令（全 repo grep 零命中），README L50 僅一句 `Requirements: … Codex MCP` 而無指令，`skills/codex-setup/SKILL.md` 處理的是反方向（讓 Codex CLI 讀懂本 repo），皆非現成落點。三項技術主張（mcp-server 不套用 CLI runtime profile、`--profile cli` 無效、`-c` 須置於子命令後）目前為**待驗證假設**，AC 要求實測佐證後才寫入文件。
> **Priority**: P1

## Background

Codex 是本 plugin 所有 review gate 的預設 reviewer。依目前的理解（**待驗證假設**，實測方式與佐證落點見 Note 與 AC #4）：`codex mcp-server` 啟動時不套用 CLI runtime profile、`--profile cli` 對 mcp-server 無效——若屬實，MCP 途徑的 review 便以較低的 reasoning effort 執行，而這正是「review 是付得起深度的工作負載」原則（`rules/auto-loop.md` § Review Dispatch 的 Agent defaults 同理）要避免的靜默降級。

## Requirements

- **落點：`README.md`**——把現有 `Requirements: … Codex MCP` 一句擴充為含完整註冊指令的安裝區塊：`claude mcp add codex -- codex mcp-server -c 'model_reasoning_effort="high"'`（`-c` 置於 `mcp-server` 子命令之後），此為**預設值**
- 實作前先以 `codex mcp-server --help`（及 `codex --version`）實測驗證三項主張：(1) mcp-server 不套用 CLI runtime profile；(2) `--profile cli` 對 mcp-server 無效；(3) `-c` 覆寫須置於子命令之後。實測輸出（含日期與版本）記入 References，驗證不成立的主張不得寫入 README
- README 明確記載不使用 `--profile cli` 及其原因，並說明使用者覆寫方式（調整或移除 `-c` 值——這是預設，不是強制）
- 新增 README 結構測試守住指令形狀

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | README.md 的 codex MCP 註冊區塊（含 `-c` 預設與 `--profile cli` 反模式說明）、主張實測、結構測試 |
| Out   | `skills/codex-setup/SKILL.md`（方向相反：它讓 Codex CLI 讀懂本 repo，不註冊 MCP server）；Codex CLI（非 MCP）呼叫路徑的 profile 設定；agents/ frontmatter 的 effort（已由 `test/agents/frontmatter.test.js` 釘死） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `README.md` | Modify | 擴充 Codex MCP 一句為完整註冊區塊：指令、`-c` 預設、`--profile cli` 反模式、覆寫方式。新區塊須置於 `<!-- END:INSTALL-COVERAGE -->` marker 之外（`generate-readme-catalog.js` 只重寫 BEGIN/END 之間，塞進 marker 內會被下次重產靜默覆寫） |
| `test/scripts/readme-codex-mcp.test.js` | New | 結構測試：README 註冊指令含 `-c 'model_reasoning_effort=`、位置以 AC #4 實測所得為準、且不含 `--profile cli` |

## Acceptance Criteria

- [ ] README.md 的 codex MCP 註冊指令含 `-c 'model_reasoning_effort="high"'`，其擺放位置與 AC #4 實測所得一致（預期在 `mcp-server` 子命令之後——若實測推翻，以實測為準）
- [ ] README.md 明確記載不使用 `--profile cli` 及其原因（mcp-server 不套用 CLI runtime profile）
- [ ] README.md 記載使用者覆寫方式（調整或移除 `-c` 值）
- [ ] 三項技術主張附實測佐證（`codex mcp-server --help` 輸出摘錄 + 版本 + 日期）記入本 ticket References——打勾時 References 的「（待補）」列須同步填入
- [ ] 結構測試守住指令形狀（含 `-c` 預設、位置以 AC #4 實測為準、不含 `--profile cli`），雙向：正例通過、反例失敗
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

- `rules/auto-loop.md` § Review Dispatch — Agent defaults（同一「review 付得起深度」原則的 agents/ 對應面）
- `test/agents/frontmatter.test.js` — effort 釘選的既有先例
- （待補）`codex mcp-server --help` 實測輸出 + 版本 + 日期——AC #4 的佐證落點
