# Codex MCP Server 啟動預設加入 model_reasoning_effort=high

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc.
> **Created**: 2026-08-07
> **Status**: Candidate Complete
> **Note**: 本 feature 尚無 tech spec；實作前建議先跑 `/tech-spec`。落點已定案為 README.md（見 Requirements）——repo 內目前沒有任何檔案記載 `codex mcp-server` 的註冊指令（全 repo grep 零命中），README L50 僅一句 `Requirements: … Codex MCP` 而無指令，`skills/codex-setup/SKILL.md` 處理的是反方向（讓 Codex CLI 讀懂本 repo），皆非現成落點。三項技術主張已實測佐證（見 References）：mcp-server 不套用 CLI runtime profile——**證實**；`--profile` 對 mcp-server 無效（含 `cli` 以外的 profile 名稱）——**證實**；`-c` 須置於子命令後——**推翻**（兩位置功能等價，README 已改記為文件化預設而非強制）。
> **Priority**: P1

## Background

Codex 是本 plugin 所有 review gate 的預設 reviewer。已實測證實（實測方式與佐證見 Note 與 References）：`codex mcp-server` 啟動時不套用 CLI runtime profile、`--profile` 對 mcp-server 無效——若不設定，MCP 途徑的 review 便以較低的 reasoning effort 執行，而這正是「review 是付得起深度的工作負載」原則（`rules/auto-loop.md` § Review Dispatch 的 Agent defaults 同理）要避免的靜默降級。

## Requirements

- **落點：`README.md`**——把現有 `Requirements: … Codex MCP` 一句擴充為含完整註冊指令的安裝區塊：`claude mcp add codex -- codex mcp-server -c 'model_reasoning_effort="high"'`（`-c` 置於 `mcp-server` 子命令之後），此為**預設值**
- 實作前先以 `codex mcp-server --help`（及 `codex --version`）實測驗證三項主張：(1) mcp-server 不套用 CLI runtime profile；(2) `--profile cli` 對 mcp-server 無效；(3) `-c` 覆寫須置於子命令之後。實測輸出（含日期與版本）記入 References，驗證不成立的主張不得寫入 README
- README 明確記載不使用 `--profile cli` 及其原因，並說明使用者覆寫方式（調整或移除 `-c` 值——這是預設，不是強制）
- 新增 README 結構測試守住指令形狀

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | README.md 的 codex MCP 註冊區塊（含 `-c` 預設與 `--profile cli` 反模式說明）、主張實測、結構測試 |
| Out   | `skills/codex-setup/SKILL.md`（方向相反：它讓 Codex CLI 讀懂本 repo，不註冊 MCP server）；Codex CLI（非 MCP）呼叫路徑的 profile 設定；agents/ frontmatter 的 effort（已由 `test/agents/frontmatter.test.js` 釘死）；`README.zh-TW/zh-CN/ja/ko/es.md` 五份 locale 鏡像的同步——明確決定不在本 ticket 內處理，理由與後續由 `/readme-i18n-sync` 承接，見 References |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `README.md` | Modify | 擴充 Codex MCP 一句為完整註冊區塊：指令、`-c` 預設、`--profile cli` 反模式、覆寫方式。新區塊須置於 `<!-- END:INSTALL-COVERAGE -->` marker 之外（`generate-readme-catalog.js` 只重寫 BEGIN/END 之間，塞進 marker 內會被下次重產靜默覆寫） |
| `test/scripts/readme-codex-mcp.test.js` | New | 結構測試：README 註冊指令含 `-c 'model_reasoning_effort=`、位置以 AC #4 實測所得為準、且不含 `--profile cli` |

## Acceptance Criteria

- [x] README.md 的 codex MCP 註冊指令含 `-c 'model_reasoning_effort="high"'`，其擺放位置與 AC #4 實測所得一致（預期在 `mcp-server` 子命令之後——若實測推翻，以實測為準）——實測顯示 `-c` 兩個位置皆可運作，README 如實記載為「文件化預設」而非「必須」
- [x] README.md 明確記載不使用 `--profile cli` 及其原因（mcp-server 不套用 CLI runtime profile）——實測結果比假設更強：`--profile` 對 `mcp-server` 直接報錯拒絕啟動，不是靜默忽略
- [x] README.md 記載使用者覆寫方式（調整或移除 `-c` 值）
- [x] 三項技術主張附實測佐證（`codex mcp-server --help` 輸出摘錄 + 版本 + 日期）記入本 ticket References
- [x] 結構測試守住指令形狀（含 `-c` 預設、位置以 AC #4 實測為準、不含 `--profile cli`），雙向：正例通過、反例失敗——`test/scripts/readme-codex-mcp.test.js`，5/5 pass
- [ ] Pass /codex-review-doc
- [ ] Pass /codex-review-fast
- [ ] Pass /precommit

## Progress

| Phase | Status | Note |
| ---------- | ------ | ---- |
| Analysis | Done | 三項主張皆已實測（見 References） |
| Development | Done | README.md § Codex MCP registration + `test/scripts/readme-codex-mcp.test.js` |
| Testing | Done | 5/5 pass；`generate-readme-catalog.js` 重跑確認未動到新區塊 |
| Acceptance | - | 待 review + precommit |

**Status**: Candidate Complete

## References

- `rules/auto-loop.md` § Review Dispatch — Agent defaults（同一「review 付得起深度」原則的 agents/ 對應面）
- `test/agents/frontmatter.test.js` — effort 釘選的既有先例
- **實測佐證**（`codex-cli 0.146.0`，2026-08-07，`which codex` → `/opt/homebrew/bin/codex`）：
  - `codex mcp-server --help` 的選項清單只有 `-c/--config`、`--strict-config`、`--enable`、`--disable`、`-h`——**沒有 `--profile`**
  - `codex --help`（top-level）顯示 `-p, --profile <CONFIG_PROFILE_V2>` 是子命令**之前**的全域選項
  - `codex mcp-server --profile cli --help` → `error: unexpected argument '--profile' found`（子命令後不存在此旗標，結構性證實主張(2)的一半）
  - `codex --profile cli mcp-server`（放在子命令前，語法上合法的位置）→ `Error: --profile only applies to runtime commands and \`codex mcp\`: \`codex\`, \`codex exec\`, \`codex review\`, \`codex resume\`, \`codex archive\`, \`codex delete\`, \`codex unarchive\`, \`codex fork\`, \`codex mcp\`, \`codex sandbox\`, and \`codex debug prompt-input\`.`——`mcp-server` 不在白名單內，直接拒絕啟動
  - `codex --profile someothername mcp-server` → 逐字元相同錯誤——證實主張(2)：`--profile` 對 `mcp-server` 的拒絕與 profile 名稱無關，非 `cli` 特有
  - `codex mcp-server -c 'profile="test"' < /dev/null` → `Error: error loading config: legacy \`profile = "test"\` config is no longer supported; use \`--profile test\` with \`test.config.toml\` instead`——即唯一能設定 profile 的路徑就是`--profile` 旗標本身，而該旗標已被 `mcp-server` 拒絕；**證實主張(1)**：mcp-server 沒有「套用但降級」的中間狀態，只有「唯一入口被拒絕」
  - `codex mcp-server --strict-config -c bogus_test_key_xyz=1 < /dev/null` → exit 1，`unknown configuration field`；`codex --strict-config -c bogus_test_key_xyz=1 mcp-server < /dev/null` → **相同錯誤**，exit 1（`--strict-config` 排除「未知鍵被靜默忽略」的可能，是唯一能證明 `-c` 鍵位被正確解析的探測，故用它佐證位置等價）
  - `codex mcp-server -c model_reasoning_effort="high" < /dev/null` → exit 0；`codex -c model_reasoning_effort="high" mcp-server < /dev/null` → **同樣 exit 0**
  - 結論：**主張(3)「`-c` 覆寫須置於子命令後」被推翻**——兩個位置功能等價；README 依 AC 規定改寫為「子命令後是 `codex mcp-server --help` 自己文件化的形式，非強制要求」
- **Locale 鏡像決定**：`README.zh-TW/zh-CN/ja/ko/es.md` 五份鏡像目前皆未含本節（`grep -c "claude mcp add codex"` 五份皆為 0）。本 ticket 明確決定不在此處同步——範圍是 README.md 本體的落點與實測，非 i18n 排程；需要時另跑 `/readme-i18n-sync`
