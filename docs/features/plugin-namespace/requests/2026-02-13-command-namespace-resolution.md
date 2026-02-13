# Command Namespace Resolution for Plugin Installation

> **Created**: 2026-02-13
> **Status**: Completed
> **Priority**: P1
> **Tech Spec**: (pending — run `/tech-spec` to generate)

## Background

插件安裝到外部專案後，所有指令被命名空間化為 `/sd0x-dev-flow:command-name`，但插件內部文件（rules、skills、commands）全部使用短格式 `/command-name`。模型讀到「run `/codex-review-fast`」時會嘗試呼叫不存在的短格式指令，導致執行失敗。插件的 CLAUDE.md 不會被外部專案自動載入，無法靠它傳達命名空間規則。

## Requirements

### 1. SessionStart Hook（核心機制）

- 新增 `scripts/namespace-hint.sh` 腳本，輸出命名空間指導
- 在 `hooks/hooks.json` 新增 `SessionStart` hook entry
- 模型在 session 開始時接收指導：「所有 `/command` 引用應以 `/sd0x-dev-flow:command` 呼叫」
- Hook stdout 被注入為 Claude context

### 2. Hook Dual-Pattern Parsing

- `hooks/post-tool-review-state.sh`：regex 接受可選 `sd0x-dev-flow:` 前綴
- `hooks/stop-guard.sh`：同上
- 確保不論模型用短格式或合格格式呼叫指令，狀態追蹤都能正確運作

### 3. Script Command Output Qualification

- `skills/next-step/scripts/analyze.js`：`next_actions[].command` 輸出合格格式
- `skills/project-audit/scripts/audit.js`：`next_actions[].command` 輸出合格格式
- `skills/risk-assess/scripts/risk-analyze.js`：`next_actions[].command` 輸出合格格式
- 機器消費路徑需使用合格名稱，確保模型直接使用正確格式

### 4. install-rules Documentation Clarification

- 更新 `commands/install-rules.md`：明確說明 rules 為行為指導
- 指令執行需要插件載入（或未來的 `/install-commands`）
- 不改寫 ~600 個文件內引用

### 5. install-rules Prefix Rewrite（可選強化）

- 安裝規則到目標專案時，將已知指令引用替換為合格格式
- 建立指令名稱白名單（從 `commands/*.md` basename 取得）
- 提升「插件已載入」情境下規則的直接可用性

## Scope

| Scope | Description |
|-------|-------------|
| In | SessionStart hook、hook dual-pattern、script command 合格化、install-rules 文件 |
| Out | 全面改寫 ~600 引用、token 語法、build/prepack 步驟、hidden routing skill |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/namespace-hint.sh` | New | SessionStart hook 腳本，輸出命名空間指導 |
| `scripts/lib/utils.js` | Modify | 新增 `getPluginName()` + `qualifyCommand()` utility |
| `hooks/hooks.json` | Modify | 新增 SessionStart hook entry |
| `hooks/post-tool-review-state.sh` | Modify | regex 接受合格格式前綴 + word boundary |
| `hooks/stop-guard.sh` | Modify | regex 接受合格格式前綴 + word boundary |
| `skills/next-step/scripts/analyze.js` | Modify | next_actions command 加前綴 |
| `skills/project-audit/scripts/audit.js` | Modify | next_actions command 加前綴 |
| `skills/risk-assess/scripts/risk-analyze.js` | Modify | next_actions command 加前綴 |
| `commands/install-rules.md` | Modify | 釐清 rules vs command 執行語義 |
| `test/scripts/namespace-hint.test.js` | New | 4 tests: 腳本存在、可執行、輸出驗證 |
| `test/scripts/lib/utils.test.js` | Modify | +4 tests: getPluginName、qualifyCommand |
| `test/hooks/post-tool-review-state.test.js` | Modify | +4 tests: 合格格式指令解析 |
| `test/hooks/stop-guard.test.js` | Modify | +4 tests: transcript 掃描 + regression |
| `test/scripts/next-step-analyze.test.js` | Modify | +1 test: next_actions 合格驗證 |
| `test/scripts/project-audit.test.js` | Modify | +1 test: next_actions 合格驗證 |
| `test/scripts/risk-assess.test.js` | Modify | +1 test: next_actions 合格驗證 |

## Acceptance Criteria

- [x] `scripts/namespace-hint.sh` 存在且可執行
- [x] `hooks/hooks.json` 包含 SessionStart hook 使用 `${CLAUDE_PLUGIN_ROOT}/scripts/namespace-hint.sh`
- [x] namespace-hint.sh 輸出簡潔的命名空間指導（<100 字元）
- [x] `post-tool-review-state.sh` 可解析 `/sd0x-dev-flow:codex-review-fast` 格式
- [x] `stop-guard.sh` 可解析 `/sd0x-dev-flow:precommit` 格式
- [x] `analyze.js` 的 `next_actions[].command` 輸出 `/sd0x-dev-flow:command` 格式
- [x] `audit.js` 的 `next_actions[].command` 輸出合格格式
- [x] `risk-analyze.js` 的 `next_actions[].command` 輸出合格格式
- [x] `install-rules.md` 明確說明 rules 為行為指導、指令執行需插件載入
- [x] 現有 tests 全部通過（251 tests, 0 fail）
- [x] Pass `/codex-review-fast`（3 輪 review loop，修正 regex boundary 問題）
- [x] Pass `/precommit`（lint:fix 0 errors, test:unit 27/27 pass）

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Codex Brainstorm 3 輪辯論 + 修正，Nash Equilibrium 達成 |
| Development | Done | 10 項計畫全部實作，含 `qualifyCommand()` utility、hook dual-pattern、SessionStart hook |
| Testing | Done | 251 tests pass（原 246 + 新增 5），含 namespace-hint、qualified command、regression tests |
| Acceptance | Done | `/codex-review-fast` ✅（3 輪 loop 修正 regex boundary）、`/precommit` ✅ |

## References

- Brainstorm: 2026-02-13 Codex Brainstorm session（修正版 Nash Equilibrium）
- [Claude Code Plugins Reference](https://code.claude.com/docs/en/plugins-reference)：確認 CLAUDE.md 非插件組件
- [Claude Code Hooks](https://docs.claude.com/en/docs/claude-code/hooks)：SessionStart hook stdout 注入
- Pattern: `hooks/hooks.json`（現有 hook 配置）
- Pattern: `hooks/post-tool-review-state.sh`（review state 解析）
