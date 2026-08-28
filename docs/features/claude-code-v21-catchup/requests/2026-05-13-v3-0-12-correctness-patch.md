# v3.0.12 — PostToolUse 解析 silent bug + Manifest drift 清理

> **Created**: 2026-05-13
> **Status**: Candidate Complete
> **Priority**: P0
> **Depends On**: 無（urgent correctness patch）
> **Audit Source**: `/best-practices` 對照 Claude Code v2.1.140 的 audit；codex-brainstorm threadId `019e1f30-89a1-77f3-afbd-9615f2783592`

## Background

對照 Claude Code v2.1.0 → v2.1.140 的演進，發現 sd0x-dev-flow plugin 有 1 個**隱性 correctness bug** 與 3 處 user-visible **metadata 漂移**：

1. `hooks/post-tool-review-state.sh:83` 用 `.tool_output // empty` 解析 PostToolUse 輸入，但官方 hook 規範使用 `tool_response`（v2.1.x docs）。git blame 顯示此程式碼自 commit `c56d8197`（2026-01-31）就存在，可能一直是 silent failure：當 `tool_output` 不存在時，line 83 與 103-109 取得空字串後，下游消費者（P0/P1/P2 grep 在 240-251、sentinel 解析在 515-532）全部對空字串運算，`review.passed` 旗標派生失準，auto-loop 可能提早跳到 `/precommit`，直接拆穿 plugin「hook-enforced dual review」的核心承諾。
2. `.claude-plugin/plugin.json:3` / `.claude-plugin/marketplace.json:11` 描述寫「90 skills, 15 agents, 8 lifecycle hooks」，但實際 filesystem 為 98 skills / 15 agents / 8 hooks。`package.json:4` 與 `README.md` 多處（line 12、165、166、294）也各自不一致。
3. 用戶在 `claude plugin details` 與 marketplace 列表會直接看到過時資訊，影響第一印象。

此 patch 屬於緊急 hot-fix 性質，與 v3.0.13 的 schema/validation 工作切開，避免測試遷移延後 silent bug 修復。

## Requirements

- 修復 `post-tool-review-state.sh` 解析雙路 fallback：優先讀 `tool_response`，缺則 fallback 至 `tool_output`
- 對 Bash / Skill / mcp__codex__codex / mcp__codex__codex-reply 四種 tool 輸出 shape 提供 string / object / content-array 三種解析路徑
- 當 normalized output 為空時 emit fail-loud 結構化診斷（**僅** 含 `TOOL_NAME`、`tool_response`/`tool_output` 是否存在與型別、normalized 長度、可選 hash；**禁止** 輸出原始 `tool_input` / `tool_response` 內容或完整 hook JSON，避免洩漏指令、secrets、檔案內容）
- 移除 plugin.json / marketplace.json / package.json `description` 欄位中的硬編碼 skill / agent / hook 數字（per Count 政策決定：manifest 不寫具體數字）
- README.md 與 5 個 locale README 內所有 count 出現處（hero line、INSTALL-COVERAGE 區塊、WHATS-INCLUDED-COUNT 區塊、FULL-CATALOG `<summary>`）採用「bundled · public」雙軌敘述格式（具體數字由 generator 動態推導：CI hotfix 後 bundled = 96 public = 96，不再硬編碼）
- 新增測試 fixture 覆蓋三種 tool 輸出 shape，避免回歸

## Scope

| Scope | Description |
|-------|-------------|
| In | `post-tool-review-state.sh` 解析邏輯、**既有測試檔修改/補 fixtures**、3 個 manifest description 清理、6 個 README（en + 5 locale）數字同步 |
| Out | `$schema` 欄位（→ v3.0.13）、`claude plugin validate` CI（→ v3.0.13）、inventory tests（→ v3.0.13）、hooks `args` exec form 遷移（→ v3.1.0）、effort frontmatter（→ v3.1.0）|

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `hooks/post-tool-review-state.sh` | Modify | 解析點在 line 83 與 103-109：改 `.tool_output` 為 `.tool_response // .tool_output` 雙路；下游消費者（240-251、515-532）接收 normalized output 後行為不變；補空輸出結構化診斷 |
| `test/hooks/post-tool-review-state.test.js` | Modify | **檔案已存在**（38994 bytes，含大量 tool_output fixtures）；新增 tool_response fixtures、更新 jq stub paths 支援雙路、補 3 種 shape（string / object / content-array）覆蓋 |
| `.claude-plugin/plugin.json` | Modify | 移除 `description:3` 尾段「90 skills, 15 agents, 8 lifecycle hooks」 |
| `.claude-plugin/marketplace.json` | Modify | 移除 `description:11` 尾段同上字串 |
| `package.json` | Modify | `description:4` 同步移除 |
| `README.md` | Modify | 各區塊依語意各自更新：hero line（12）用 `<bundledCount> bundled · <publicCount> public skills`；INSTALL-COVERAGE 表格 Plugin install 列用 `(<bundledCount> bundled skills, ...)` 與 `npx skills add` 列用 `Skills only (<publicCount> public skills)`（165, 166）；WHATS-INCLUDED-COUNT 表格 Skills 列用 `<publicCount> public (<bundledCount> bundled)`（250）；FULL-CATALOG `<summary>` 標籤用 `All <publicCount> public skills`（294）。實際數字由 `scripts/generate-readme-catalog.js` 動態推導（CI hotfix 後 bundled = public = 96）。注意 README.md 由 `BEGIN:` / `END:` HTML 註解界定多個生成區塊（HERO-COUNT、INSTALL-COVERAGE、WHATS-INCLUDED-COUNT、FULL-CATALOG）|
| `README.zh-TW.md` | Modify | 同步 README.md 所有 count 變更位置（locale README 為 README.md 鏡像生成）|
| `README.zh-CN.md` | Modify | 同上 |
| `README.ja.md` | Modify | 同上 |
| `README.ko.md` | Modify | 同上 |
| `README.es.md` | Modify | 同上 |
| `scripts/generate-readme-catalog.js` | Modify | `buildHeroCount` / `buildInstallCoverage` / `buildWhatsIncludedCount` 簽名改收 `{publicCount, bundledCount}`；`main()` 透過 `git ls-files --cached skills/` 推導 `bundledCount`（CI hotfix：原 `fs.readdirSync` 會把未追蹤的 project-internal skill 算進去，導致本地 vs CI 不一致；fs.readdirSync 仍作為 git 不可用或 sparse checkout 的 fallback）；`buildFullCatalog` summary 改「All N public skills」 |
| `test/scripts/generate-readme-catalog.test.js` | Modify | `README hero count matches summary count` 測試改抓 `(\d+) bundled · (\d+) public skills` 與 `All (\d+) public skills` |
| `test/skills/necessity-audit/preflight.test.js` | Modify | Pre-existing 失敗：`detectGreenfield` 測試 slug 字面值出現在自身 source，被 git grep 自我匹配；改用 runtime 組裝避免 self-match（與 v3.0.12 本身無關，為解除 precommit 阻塞而附帶修） |

## Acceptance Criteria

- [x] `post-tool-review-state.sh` 解析 `tool_response` 為主、`tool_output` 為 fallback，行為對齊 Claude Code 官方 hooks 規範
- [x] 三種 tool 輸出 shape（string / object / content-array）都能正確抽出 review content（含 Bash `{stdout, stderr, ...}` 結構化物件 normalize 到 `stdout`）
- [x] normalized output 為空時 emit 結構化 stderr 診斷（含 `TOOL_NAME`、欄位存在/型別；**不含** 原始 `tool_input`/`tool_response` 內容或完整 hook JSON）
- [x] `test/hooks/post-tool-review-state.test.js` v3.0.12 新增 **10 個** 測試（tool_response Bash/Skill、MCP `.content` string/array、missing-fields diagnostic、precedence、Bash 結構化 stdout、`/precommit` 路由、`emit-review-gate` 路由、empty-string `//` semantics），檔案總計 54/54 在開發機通過（`node --test test/hooks/post-tool-review-state.test.js`）
- [x] `plugin.json` / `marketplace.json` / `package.json` `description` 欄位不含具體 skill / agent / hook 數字
- [x] 6 份 README（en + 5 locale）內所有 count 出現處同步：hero 用 `<bundled> bundled · <public> public`、INSTALL-COVERAGE 拆兩列分別放 bundled 與 public、WHATS-INCLUDED-COUNT 用 `<public> public (<bundled> bundled)`、FULL-CATALOG summary 用 `All <public> public skills`（各區塊措辭最適語意而非統一字串；CI hotfix 後實際數字 bundled = public = 96）
- [x] 既有測試（`test/hooks/hooks-json-registry.test.js`、`test/skills/plugin-manifest.test.js`）仍全部通過（開發機 full suite 1923/1923 pass，2 skipped）
- [x] Pass `/codex-review-fast`（threadId `019e2069-70b2-7a12-9ba9-4e235108292d`；最終 ✅ Ready, 0 findings）
- [x] Pass `/precommit`（`/precommit-fast` ✅ All Pass：lint + 669 tests via `.claude/scripts/precommit-runner.js --mode fast`）

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | `/best-practices` audit 完成；Nash equilibrium R3 達成 |
| Development | Done | 2026-05-13 — hook 解析統一改成 normalize Bash `{stdout}` / MCP `{content}` / string；manifest description 移除硬編碼數字；generator 加入 `bundledCount` 並更新 6 份 README；版號 `3.0.11 → 3.0.12` |
| Testing | Done | 開發機本地執行結果：`test/hooks/post-tool-review-state.test.js` 54/54 pass；full suite 1923/1923 pass + 2 skipped；regression test 涵蓋三種 tool_response shape + 空欄位診斷 + precedence + Bash 結構化 stdout。**CI hotfix（push 後）**：`scripts/generate-readme-catalog.js` 原以 `fs.readdirSync(SKILLS_DIR)` 計算 `bundledCount`，包含本地未追蹤的 `readme-i18n-sync` / `update-readme` 兩個 project-internal skill，導致 CI clone（96 tracked）與本地（98 fs）`--check` 不一致；改用 `git ls-files --cached skills/` 後 bundled = public = 96，6 份 README 同步從 `98 bundled` 改為 `96 bundled` |
| Acceptance | Done | 2026-08-27 `--verify-ac`，**未達 closure-grade**：本次驗證涵蓋 7 條實質 AC，本票共 **9** 條（另兩條為 `Pass /codex-review-fast`、`Pass /precommit` 兩張 gate receipt，未經獨立驗證）。決策表要求每一條 AC 各有一筆結果，故報告為 unaccounted；全部 checkbox 已勾，依規則 2 得 `Candidate Complete`。已驗證的 7 條為 7/7 High：AC1–AC4 `Complete (later removed)`：實作 `002a069`，存續至 2026-08-13 hook-lightweighting（`0b3b8f5` 刪 hook、`91b5fc9` 刪測試）。AC5–AC7 對**現行工作樹**重跑通過：generator 140/140、`hooks-json-registry` 9/9、`plugin-manifest` 18/18。兩項留存差異記錄而不追改：「54/54 pass」為 commit 紀錄（hook 與測試皆已刪除，無法重跑）；`hooks-json-registry.test.js:92` 已被反轉為斷言 `hooks.json` **不得**引用 `post-tool-review-state`，今日通過的理由與 2026-05 相反。README 計數由 generator 推導，96 → 99 為設計內漂移 |

## References

- Audit Conversation: codex-brainstorm threadId `019e1f30-89a1-77f3-afbd-9615f2783592`
- Sibling tickets: [v3.0.13 schema/validation](./2026-05-13-v3-0-13-schema-validation.md)、[v3.1.0 modernization](./2026-05-13-v3-1-0-modernization.md)
- Claude Code v2.1 Hooks Reference: <https://code.claude.com/docs/en/hooks>
- v2.1.140 release: <https://github.com/anthropics/claude-code/releases/tag/v2.1.140>
