# StatusLine Quota Display — Feasibility Study

## 1. Problem Essence

### 1.1 Surface Requirement

> 在 Claude Code statusline 中即時顯示目前的額度使用狀態（5 小時 session % 與 7 天 weekly %）。

### 1.2 Underlying Problem

| Why | Answer |
|-----|--------|
| Why 1 | 開發者在長時間 coding session 中不知道額度剩多少 |
| Why 2 | 額度用完才發現，被迫中斷工作流程 |
| Why 3 | 現有 `/usage` 指令需要主動查詢，容易忘記 |
| Why 4 | 沒有被動提醒機制，無法「看一眼就知道」 |
| Why 5 | **核心**：需要 ambient awareness（環境感知），非主動查詢 |

### 1.3 Success Criteria

| Criteria | Target |
|----------|--------|
| 顯示延遲 | statusline 渲染不因 quota fetch 而 blocking |
| 資料新鮮度 | 60 秒內反映最新值（平衡 API rate limit 與使用者感知延遲；Claude Code 每次 tool call 觸發 statusline 刷新，60s cache TTL 限制實際 API 請求頻率） |
| 失敗容錯 | API 不可用時 graceful 隱藏，不影響其他 segments |
| Opt-in | 預設關閉，使用者明確啟用才顯示 |
| 遷移路徑 | 官方 JSON 支援後可無痛切換 |

### 1.4 Security Requirements

實作 Option A 時，**必須**遵守以下安全規則：

| # | Rule | Verification |
|---|------|-------------|
| S1 | Token **不得**出現在 process argv（`ps` 可見）| `curl -K -`（stdin config）或 `--header @/dev/stdin` |
| S2 | Token **不得**出現在 env vars 或 log 輸出 | fetcher script 開頭 `set +x`；不 export token 變數 |
| S3 | Cache file **必須** mode 600 | `umask 077` 在 fetcher 開頭設定，寫入前驗證 |
| S4 | curl **必須** 設定 timeout + fail-fast | `--connect-timeout 3 --max-time 5 --fail --silent` |
| S5 | Auth 失敗（401/403）**不得**輸出至 stdout | fetcher 失敗時 silent exit，不更新 cache |
| S6 | 非 OAuth 用戶 **必須** 自動停用 | 偵測 token 來源；無 token → skip fetch，不報錯 |

## 2. Constraints

| Type | Constraint | Source | Flexibility |
|------|-----------|--------|-------------|
| Technical | Claude Code statusline JSON 不含 quota 欄位 | [json-schema.md](../../../skills/statusline-config/references/json-schema.md) | 低 — 等上游 [#20636](https://github.com/anthropics/claude-code/issues/20636) |
| Technical | API endpoint `/api/oauth/usage` 未文件化 | 社群逆向工程 | 低 — 可能隨時變更 |
| Technical | statusline script 必須 POSIX-compliant + 非 blocking | [SKILL.md](../../../skills/statusline-config/SKILL.md) | 不可妥協 |
| Security | OAuth token 存取需安全處理（見 §1.4 Security Requirements） | macOS Keychain / Linux 明文 | 中 — 可硬化 |
| Compatibility | 僅 OAuth 用戶（Pro/Max）有額度概念 | Anthropic 計費模式 | 不可妥協 |
| Business | 社群需求強烈（Issue #20636, 截至 2026-03-04 約 46 reactions） | GitHub | 正面驅動力 |

## 3. Existing Capability Inventory

### 3.1 Related Modules

| Module | Reusable | Notes |
|--------|----------|-------|
| `skills/statusline-config/SKILL.md` | 完整的 segment 生成框架 | 直接擴展 |
| `skills/statusline-config/references/themes.md` | 12 個語意色彩 token | `C_CTX_OK/WARN/BAD` 可直接復用 |
| `skills/statusline-config/references/json-schema.md` | JSON 欄位文件 | 需補充 quota cache schema |
| `~/.claude/statusline-command.sh` | 使用者現有 script | 需擴展，不可破壞 |

### 3.2 Design Patterns

- **Segment toggle pattern**: 現有 segments（directory, git, model, context, cost, >200k）各自獨立，可選開關
- **Color threshold pattern**: context % 已實作 green/yellow/red 三段色彩
- **Cache pattern**: git branch 已用 5 秒 cache 避免重複呼叫

### 3.3 Tech Debt

- 無直接 tech debt
- json-schema.md 可能未記錄 Claude Code 近期新增的欄位（如 `current_usage`、`added_dirs`，待實際 runtime 驗證）

## 4. Possible Solutions

### Option A: Lazy Background Fetch（推薦）

**Core idea**: statusline script 內分離 renderer（同步讀 cache）與 fetcher（非同步背景更新），全部自包含。

**Implementation path**:

1. `/statusline-config` 生成時新增 quota segment（opt-in）
2. 生成兩個檔案：
   - `~/.claude/statusline-command.sh` — renderer（讀 cache，不碰網路）
   - `~/.claude/statusline-quota-fetch.sh` — fetcher（背景 curl + 寫 cache）
3. Renderer 在 cache 過期時 spawn background fetcher
4. Cache 寫入 `~/.claude/cache/quota-status.json`
5. Feature flag: `CLAUDE_STATUSLINE_EXPERIMENTAL_QUOTA=1`

**Architecture**:

```
statusline-command.sh (foreground, fast)
  ├── read stdin JSON (Claude Code data)
  ├── read cache file (quota data, local I/O only)
  ├── if cache stale → spawn background:
  │     └── statusline-quota-fetch.sh &
  └── render all segments → stdout

statusline-quota-fetch.sh (background, async)
  ├── mkdir lock (prevent thundering herd)
  ├── read OAuth token (Keychain / credentials file)
  ├── curl --connect-timeout 3 --max-time 5 --fail --silent
  ├── validate JSON response (0..100 bounds)
  ├── atomic write (tmp → mv)
  └── release lock
```

**Feasibility assessment**:

| Dimension | Rating | Notes |
|-----------|:------:|-------|
| Technical Feasibility | 🟢 | 社群已有多個可運作實作 |
| Effort | 🟢 | < 3 person-days（skill 擴展 + helper script + tests） |
| Risk | 🟡 | 依賴未文件化 API，需 experimental flag |
| Extensibility | 🟢 | 官方 JSON 支援後可無縫切換 data source |
| Maintenance Cost | 🟡 | API 變更時需更新 fetch logic |

**Cost**: ~2 person-days（含測試）

---

### Option B: Wait for Official Support

**Core idea**: 等 Claude Code 團隊將 quota 資料加入 statusline JSON（Issue [#20636](https://github.com/anthropics/claude-code/issues/20636)）。

**Implementation path**:

1. 監控 Issue #20636 進度
2. 官方支援後，在 json-schema.md 新增欄位文件
3. 在 SKILL.md 新增 quota segment 定義
4. 生成 script 時直接從 stdin JSON 讀取

**Feasibility assessment**:

| Dimension | Rating | Notes |
|-----------|:------:|-------|
| Technical Feasibility | 🟢 | 最乾淨的方案 |
| Effort | 🟢 | < 1 person-day（純 segment 新增） |
| Risk | 🟢 | 官方支援，無 API 穩定性問題 |
| Extensibility | 🟢 | 原生整合 |
| Maintenance Cost | 🟢 | 零額外維護 |

**Cost**: < 1 person-day（但前置等待時間不確定）

---

### Option C: External Monitor Daemon

**Core idea**: 獨立背景程序定期 fetch quota → 寫 cache → statusline 讀 cache。

**Implementation path**:

1. 建立 `claude-quota-monitor` daemon（launchd / systemd）
2. 每 2-5 分鐘 fetch quota API
3. 寫入 cache file
4. statusline script 只讀 cache

**Feasibility assessment**:

| Dimension | Rating | Notes |
|-----------|:------:|-------|
| Technical Feasibility | 🟢 | 技術上可行 |
| Effort | 🟡 | 3-5 person-days（daemon + install + cross-platform） |
| Risk | 🟡 | 同樣依賴未文件化 API |
| Extensibility | 🟢 | 其他工具也能讀 cache |
| Maintenance Cost | 🔴 | daemon 生命週期管理複雜 |

**Cost**: ~4 person-days

## 5. Codex In-Depth Discussion Record

### 5.1 Discussion Process Summary

| Round | Topic | Codex Key Viewpoint |
|-------|-------|---------------------|
| R1 | 架構選擇 | 反對 statusline 內直接 curl；Claude 反駁成功，Codex 讓步接受 lazy background fetch |
| R2 | 實作細節（4 點） | 收斂：`curl -K -` fallback、`mkdir` lock、helper script 分離、experimental opt-in |
| R3 | Equilibrium check | 最終攻擊：命名語意（`sess` → `5h`）+ 2 guardrails（非 OAuth 停用、JSON 驗證） |

**Debate threadId**: `019cb7b2-8341-7273-b8f4-00f4d4ceb689`

### 5.2 Solution Directions Suggested by Codex

- Renderer + Fetcher 分離（強調 statusline 主路徑不碰網路）
- `mkdir` 原子鎖防止 thundering herd
- `umask 077` + `curl -K -`（避免 token 出現在 process args）
- Feature flag 命名 `CLAUDE_STATUSLINE_EXPERIMENTAL_QUOTA`

### 5.3 Risks/Issues Identified by Codex

- Token 在 `curl -H` 中可能被 `ps` 洩漏（同用戶風險較低，但 debug/trace 可能洩漏）
- `session` 命名易誤解為 "此次聊天"，建議用 `5h`
- 非 OAuth 用戶（API key / Bedrock / Vertex）無此 API，需自動停用
- json-schema.md 落後於 Claude Code 實際 runtime 欄位

### 5.4 Differences from Claude's Analysis

| Viewpoint | Claude | Codex | Adopted |
|-----------|--------|-------|---------|
| 架構 | statusline 內 lazy fetch 即可 | 需獨立 daemon | Claude（Codex R1 讓步） |
| Token 安全 | 同用戶風險低，`-H` 可接受 | 建議 `curl -K -` | 折衷：推薦 `-K -` + fallback |
| 命名 | `sess` / `wk` | `5h` / `wk` | Codex（避免語意混淆） |
| 鎖機制 | cache age check 足矣 | 需 `mkdir` lock | Codex（防 burst refresh） |

### 5.5 Integrated Conclusion

> Lazy background fetch + file cache 是最佳架構平衡點。需要 `mkdir` lock、atomic write、experimental flag、非 OAuth 偵測。顯示標籤用 `5h` / `wk` 避免語意歧義。

## 6. Solution Comparison

| Dimension | Option A: Lazy Fetch | Option B: Wait Official | Option C: Daemon |
|-----------|:-------------------:|:----------------------:|:----------------:|
| Technical Feasibility | 🟢 | 🟢 | 🟢 |
| Effort | 🟢 (~2d) | 🟢 (<1d) | 🟡 (~4d) |
| Risk | 🟡 | 🟢 | 🟡 |
| Extensibility | 🟢 | 🟢 | 🟢 |
| Maintenance Cost | 🟡 | 🟢 | 🔴 |
| **Time to Value** | **🟢 立即** | **🔴 未知** | **🟢 立即** |

## 7. Recommendation

**Recommended**: Option A（Lazy Background Fetch）

**Rationale**:

- 立即可交付，不需等待上游
- 社群已驗證可行性（多個獨立實作）
- Experimental flag 限制爆炸半徑
- 官方支援後可無痛遷移（precedence logic: official JSON > cache > hide）
- Codex 同意此架構（Nash Equilibrium）

**Backup**: Option B（Wait for Official）

**Applicable scenario**: 如果 Issue #20636 被合併且 statusline JSON 包含 quota 欄位，可直接跳過 Option A。觸發條件：官方 release notes 明確列出 quota 欄位。

## 8. Open Questions

- [ ] Claude Code 是否計畫在 statusline JSON 加入 quota 欄位？（Issue #20636 無官方回應）
- [ ] OAuth token refresh 是否需要在 fetch helper 中處理？（token 過期 → 401 → 需 refresh）
- [ ] Linux credential 路徑是否穩定？（`~/.claude/.credentials.json` 是 implementation detail）
- [ ] Max plan 的 `seven_day_opus` / `seven_day_sonnet` 分模型額度是否需要顯示？

## 9. Next Steps

| Step | Command | When |
|------|---------|------|
| Tech spec（如決定實作） | `/tech-spec` | 決策後 |
| Architecture deep-dive | `/deep-analyze` | Tech spec 完成後 |
| 監控上游 | Issue [#20636](https://github.com/anthropics/claude-code/issues/20636) | 持續 |
| Request doc | `/create-request` | 如需追蹤 |

## References

- [How to Show Claude Code Usage Limits in Your Statusline](https://codelynx.dev/posts/claude-code-usage-limits-statusline)
- [Issue #20636: Expose rate limit usage to statusLine](https://github.com/anthropics/claude-code/issues/20636)
- [Issue #27829: Expose subscription quota in statusLine JSON](https://github.com/anthropics/claude-code/issues/27829)
- [Claude Code Status Line: Complete Guide](https://gist.github.com/jtbr/4f99671d1cee06b44106456958caba8b)
- Debate threadId: `019cb7b2-8341-7273-b8f4-00f4d4ceb689`
