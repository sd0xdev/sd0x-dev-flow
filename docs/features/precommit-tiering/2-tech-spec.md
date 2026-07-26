# Precommit Test Tiering Technical Spec

> **本文件是 2026-03-06 原始提案 + 後續決策修訂的混合體。閱讀時請先分清兩者：**
>
> | 區段 | 狀態 |
> |------|------|
> | §1 Goals、§2.1 Test Distribution、§3.1 架構圖、§4 Risks | **2026-03-06 提案快照**（歷史）——其中 auto-loop 路由 `/precommit-fast` 的部分已被推翻 |
> | §2.2 Execution Paths、§2.4 Auto-Loop Routing、§3.2 Test Tier Hierarchy、§3.3 Runner Test Selection、§3.4 Fallback Behavior、§3.5 Package.json Scripts、§5 Work Items、§6 Testing Strategy、§7 Q4 | **現況**（as-built） |
>
> 上表原本把 Risks 標為 §6、把 preference chain 標為 §3.2，並漏掉 §3.3-3.5。實際上 Risks 是 **§4**，preference chain 在 **§3.3**（§3.2 是 Test Tier Hierarchy），而 §6 是 **Testing Strategy**——它收錄 `CLAUDE.md` 所連結的 as-built `precommit.mode` 語意邊界，把它歸進「提案快照」欄剛好顛倒。
>
> **最新定論**：auto-loop 迭代路由是 **`/precommit`（full）**。`31510e6` 以 shift-left 為由反轉了
> 原提案的 fast route。分層本身（`test:fast` / `test:ci`）仍然成立並已實作，被推翻的只有「auto-loop
> 走哪一個 variant」這一項。

## 1. Requirement Summary

- **Problem**: Auto-loop 每次 fix iteration 都執行完整測試套件（369 tests, ~8 min），嚴重拖慢開發速度。Integration tests 佔 95% 時間但在迭代修復迴圈中提供的邊際價值低。
- **Goals**:
  - ~~將 auto-loop 迭代路由從 `/precommit` 改為 `/precommit-fast`，使用 fast test tier~~ —— **已於 `31510e6` 反轉回 full**，理由見 §2.4；本行保留為提案原文
  - 建立 `test:fast`（unit + schema）和 `test:ci`（全套）分層
  - 確保 runner 和 command docs 同步更新，tiering 在兩條執行路徑都生效
  - 通用專案（無 `test:fast` script）fast mode graceful degradation 到現有行為；full mode intentionally 改為偏好 `test` 以獲得更完整覆蓋
- **Scope**:

| Scope | Description |
|-------|-------------|
| In | auto-loop routing、package.json scripts、runner preference chain、command docs、CLAUDE.md 更新 |
| Out | PR-boundary full precommit enforcement（追蹤為獨立 enhancement）、非 Node 專案 runner fallback（追蹤為獨立 enhancement）、jq process spawning 優化 |

## 2. Existing Code Analysis

### 2.1 Test Distribution（2026-03-06 快照，已過時）

下表是提案當時的分佈，保留以說明分層的動機（integration 佔絕大多數時間）。**檔案數與 glob 皆已不符現況**：
`test/commands/` 已隨 v3 的 commands/ 移除而不存在，`test:schema` 現在指向 `test/skills/`，
`test` / `test:ci` 也已改用 `find`（`/bin/sh` 不展開 `**`，`test/**/*.test.js` 會漏掉巢狀目錄）。

| Script | Glob（2026-03-06） | Files | Approx Time |
|--------|------|-------|-------------|
| `test:unit` | `test/scripts/lib/*.test.js` | 1 | <1s |
| `test:schema` | `test/commands/*.test.js` | 3 | <1s |
| `test:integration` | `test/scripts/*.test.js` | 13 | ~7.5 min |
| `test:hooks` | `test/hooks/*.test.js` | 4 | ~20s |
| `test` (all) | `test/**/*.test.js` | ~21 | ~8 min |

現況（2026-07-26）：全樹 119 個 test 檔——`test/skills/` 55、`test/scripts/` 38（另 `test/scripts/lib/` 11）、
`test/hooks/` 15。以 `package.json` 為準，勿引用上表數字。

### 2.2 Execution Paths

Precommit 有兩條執行路徑：

```
Step 1: Glob check .claude/scripts/precommit-runner.js
        ├─ Found → Runner (precommit-runner.js)    ← 本專案走這條
        └─ Not found → Command markdown fallback   ← 通用專案走這條
```

- **Runner** (`scripts/precommit-runner.js`, `main()` 內組 steps 時的 `testPreference` 常數): **已實作** by-mode preference chain（W2 完成）——`fast` = `test:fast → test:unit → test`，`full` = `test:ci → test → test:fast → test:unit`，與 §3 設計逐字相符。選中非 `test:unit` 時印出 `> test: using "<script>" (<mode> mode)`；step 名稱固定為 `test_unit`（canonical phase name），不隨選中的 script 改變。
- **Skill docs** (`skills/precommit-fast/SKILL.md:55`, `skills/precommit/SKILL.md:51,65`): 定義 preferred/alternatives。**路徑已於 v3 變更**——原 `commands/precommit*.md` 已隨 commands/ 目錄一併移除，本專案為 skills-only。

兩者必須同時更新。

### 2.3 Hook State

`hooks/post-tool-review-state.sh`（precommit 路由分支，`update_state "precommit"`）: `/precommit` 和 `/precommit-fast` 設定同一個 `precommit` bit — 這是正確的，hook 只需驗證「某種 precommit 檢查已通過」。

### 2.4 Auto-Loop Routing

`rules/auto-loop.md`（Auto-Trigger 表）：review pass 後路由到 `/precommit`（full）。

> **W5/W6 曾經套用，之後被刻意反轉——但交付與反轉分屬不同 commit、不同檔案面。** 以下標的都是
> **routing 相關**的改動面，不是各 commit 的完整範圍（括號為 `git show --stat` 的實際檔案數）。
> W5 由 `2f830c7` → `2fb6088` 交付，routing 部分只動 `rules/auto-loop.md`（`2f830c7` 全域 8 檔、
> `2fb6088` 2 檔）；W6 由 **`a4a0be5`** 交付，動 `CLAUDE.md` 與 `CLAUDE.template.md`（此 commit
> 恰好全域也只有這 2 檔）。`31510e6`（*refactor: Change auto-loop default from /precommit-fast to
> /precommit*）再以 **shift-left** 為由改回 full——讓 lint/build 失敗在本地浮現，而非留到 CI——
> 全域 12 檔，含 `rules/auto-loop.md`、`CLAUDE.md`、兩個 hook 與多個 skill，是這題最新的定論；
> 本節描述的 `/precommit` 即是該決策的結果。
>
> 唯一殘留的分歧是 **untracked 的本機安裝檔 `.claude/CLAUDE.md`** 仍寫 `/precommit-fast`，且兩份
> `CLAUDE.md` 會同時載入、無明文優先序。該檔未進版控，git 史無法證明這是刻意覆寫還是 `a4a0be5`
> 當年裝上去後就沒再跟進的殘留；受版控政策由 §7 Q4 定為 full，本機那份不在本 repo 測試可及範圍內。
>
> `31510e6` 沒有回頭處理 `a4a0be5` 寫進 `CLAUDE.template.md`（`/project-setup` 發給新專案的樣板）的
> fast route，使新專案拿到 fast gate 而 plugin 自身規範是 full。已於 2026-07-25 補上，並以
> `test/skills/claude-md-coverage.test.js` 的一致性測試把 `rules/auto-loop.md`、兩份受版控 `CLAUDE.md`
> 以及真正輸出 route 的兩個 hook（`post-compact-auto-loop.sh` / `post-skill-auto-loop.sh`）釘在同一個答案。

### 2.5 Related Files

| File | Current Role |
|------|-------------|
| `rules/auto-loop.md` | 定義 iterative fix loop 路由 |
| `scripts/precommit-runner.js` | Runner — by-mode test preference chain（已實作） |
| `skills/precommit-fast/SKILL.md` | Fast precommit skill（fallback 路徑；v3 前為 `commands/precommit-fast.md`） |
| `skills/precommit/SKILL.md` | Full precommit skill（fallback 路徑；v3 前為 `commands/precommit.md`） |
| `package.json` | npm scripts 定義 |
| `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.template.md` | Auto-loop 表格 |
| `test/scripts/precommit-runner.test.js` | Runner 測試 |

## 3. Technical Solution

### 3.1 Architecture Design（2026-03-06 提案，左半已被推翻）

> 左欄「auto-loop → `/precommit-fast`」是提案原貌，**不是現況**。現行 auto-loop 走
> `/precommit` → Runner `--mode full`，即右欄那條路徑；`--mode fast` 仍然存在且可用，只是不再是
> auto-loop 的預設出口。右欄與 §3.2/§3.3 的分層設計未受影響。

```
Auto-loop (iterative fix cycle)          PR lifecycle (final gate)
─────────────────────────────            ────────────────────────
review pass                              /precommit → /pr-review
    │                                        │
    ▼                                        ▼
/precommit-fast                          Runner --mode full
    │                                        │
    ▼                                        ▼
Runner --mode fast                       test:ci → test → test:fast → test:unit
    │                                    (all 369 tests, ~8min)
    ▼
test:fast → test:unit → test
(unit + schema, <2s)
```

### 3.2 Test Tier Hierarchy

```
test:ci  ⊇  test  ⊇  test:fast  ⊇  test:unit
 (all)      (all)    (unit+schema)   (unit only)
```

上面的 ⊇ 階梯是**本專案 `package.json` 的實際情形**，不是 runner 保證的性質。

runner 只按**名稱**挑 script（§3.3），從不比較兩個 script 實際跑到的測試集合，所以「full mode >= fast mode」成立的前提是專案遵守這套命名慣例。本專案遵守，因此為嚴格包含；通用專案若兩者 fallback 到同一 script（例如都只有 `test:unit`）則覆蓋相等——但若專案把 `test:fast` 定義成比 `test:ci` / `test` 更廣的集合（例如 `test:fast` 跑全部 e2e、`test:ci` 只跑 unit），則 fast ⊋ full，此保證不成立且 runner 不會察覺。§3.4 表格的 `full >= fast?` 欄位應以此為前提閱讀。

### 3.3 Runner Test Selection Logic — **已實作（current behavior）**

以下為 `scripts/precommit-runner.js` 現行程式碼，不是提案：

```javascript
const testPreference = args.mode === 'fast'
  ? ['test:fast', 'test:unit', 'test']
  : ['test:ci', 'test', 'test:fast', 'test:unit'];

const selectedTest = testPreference.find(s => hasScript(pkg, s));
```

被取代的舊行為（單一 `test:unit` → `test` 階梯，不分 mode）已不存在於程式碼中。

### 3.4 Fallback Behavior (Generic Projects)

| Project Has | Fast Mode Runs | Full Mode Runs | full >= fast? |
|-------------|---------------|----------------|---------------|
| `test:fast` + `test:ci` | `test:fast` | `test:ci` | Yes |
| `test:fast` + `test` | `test:fast` | `test` | Yes |
| `test:fast` + `test:unit` (no `test`) | `test:fast` | `test:fast` | Equal |
| `test:unit` + `test` | `test:unit` | `test` | Yes |
| `test:unit` only | `test:unit` | `test:unit` | Equal |
| `test` only | `test` | `test` | Equal |
| None | skip | skip | N/A |

**Fast mode**: 通用專案不需要定義 `test:fast` — fallback chain 保留現有行為（偏好 `test:unit`）。

**Full mode**: Intentional behavior change — **已生效**。舊 runner 偏好 `test:unit`，現行實作偏好 `test`（更完整）。對於同時有 `test:unit` 和 `test` 的專案，full mode 已從跑 unit-only 改為跑全套。這是預期的改進，非迴歸。

### 3.5 Package.json Scripts

```json
{
  "test:fast": "npm run test:unit && npm run test:schema",
  "test:ci": "npm test"
}
```

- `test:fast`: unit + schema（<2s）— 用於 auto-loop 迭代
- `test:ci`: 等同 `test`（all）— 語意別名，便於 runner 辨識

## 4. Risks and Dependencies

| Risk | Impact | Mitigation |
|------|--------|------------|
| `precommit.passed` 語意從 full 變 fast | Doc sync 可能在部分測試通過後觸發 | Doc sync 不依賴 full test coverage；安全閥（diff 比較）捕捉迴歸 |
| Fast tier 遺漏 integration regression | Bug 只在 full suite 發現 | PR gate 仍跑 full suite；CI 強制 full |
| Runner 和 command docs 不同步 | 行為不一致 | 同一 PR 更新兩者；新增 runner 測試驗證 preference chain |
| 多個 skill 硬編碼 `/precommit` | 路由不一致 | `auto-loop.md` 標記為最高優先級規則，衝突時 auto-loop 勝出 |

## 5. Work Breakdown

| # | Task | File(s) | Effort | Status |
|---|------|---------|--------|--------|
| W1 | 新增 `test:fast`, `test:ci` scripts | `package.json` | S | ✅ 完成（兩個 script 均在） |
| W2 | Runner: test preference chain by mode | `scripts/precommit-runner.js` | M | ✅ 完成（`main()` 的 `testPreference` / `selectedTest`） |
| W3 | Skill fast: 更新 preferred list + description + output table | `skills/precommit-fast/SKILL.md`（原 `commands/precommit-fast.md`） | S | ✅ 完成（`:55`） |
| W4 | Skill full: 更新 preferred list + description + output table | `skills/precommit/SKILL.md`（原 `commands/precommit.md`） | S | ✅ 完成（`:51,65`） |
| W5 | Auto-loop: iterative route 改 `/precommit-fast` | `rules/auto-loop.md` | S | ↩️ **曾套用後反轉** — `2f830c7`/`2fb6088` 改為 fast，`31510e6` 以 shift-left 為由改回 `/precommit`（見 §2.4） |
| W6a | CLAUDE.md 更新 auto-loop 表格（**受版控**） | `CLAUDE.md`, `CLAUDE.template.md` | S | ↩️ 同 W5 反轉。兩份現為 `/precommit`（`CLAUDE.template.md` 為 `31510e6` 漏改、2026-07-25 補正） |
| W6b | 本機安裝檔（**未版控，狀態無法證明**） | `.claude/CLAUDE.md` | S | ⚠️ 本機該檔現為 `/precommit-fast`。git 史不含此檔，**無法判定**這是刻意的本地覆寫還是 `a4a0be5` 裝上後未跟進的殘留（§2.4 已如此陳述）；亦不在本 repo 測試可及範圍。受版控政策以 W6a 為準（§7 Q4） |
| W7 | Runner 測試: 驗證 tier preference | `test/scripts/precommit-runner.test.js` | M | ✅ 完成 |

### Execution Order

```
W1 (package.json) → W2 (runner) → W3+W4 (skills, parallel) → W5+W6a (docs, parallel) → W7 (tests)
(W6b 不是可交付項——它是未版控的本機狀態，只記錄不執行)
```

## 6. Testing Strategy

### 6.1 Runner Tests (W7)

新增至 `test/scripts/precommit-runner.test.js`:

| Test Case | Description |
|-----------|-------------|
| fast mode prefers test:fast | 有 `test:fast` + `test:unit` 時，fast mode 選 `test:fast` |
| fast mode falls back to test:unit | 無 `test:fast` 時，fallback 到 `test:unit` |
| full mode prefers test:ci | 有 `test:ci` + `test` 時，full mode 選 `test:ci` |
| full mode falls back to test | 無 `test:ci` 時，fallback 到 `test` |
| full mode coverage >= fast mode | 驗證 hierarchy 正確性 |

### 6.2 Existing Tests

所有現有 precommit-runner 測試必須繼續通過（backward compatibility）。

### 6.3 Manual Verification

- `/precommit-fast` 在本專案跑 `test:fast`（unit + schema），<2s
- `/precommit` 在本專案跑 `test:ci`（全套），~8 min
- 在無 `test:fast` 的專案中：fast mode fallback 到 `test:unit`；full mode fallback 到 `test`（或 `test:unit` if no `test`）

### `precommit.mode` 的語意邊界

`mode` 記錄的是**執行了哪個指令變體**，不是**實際跑了哪些 stage**。兩者會分歧：

| 情境 | 記錄的 mode | 實際是否 typecheck |
|------|------------|-------------------|
| Node 專案有 `build` script + `/precommit` | `full` | ✅ 有 |
| Node 專案**無** `build` script + `/precommit` | `full` | ❌ 無（runner 輸出 `⏭️ build (skipped: script missing)`） |
| 非 Node 生態（Python / Ruby …） | `full` | ❌ 無（根本不經過 runner，`skills/precommit` Step 1 改走 ecosystem detection） |

`PRECOMMIT_REQUIRE_FULL=1` 的保證有三層限制，缺一都會讓「強制 full」名不副實：

| 限制 | 內容 |
|------|------|
| 需搭配 `STOP_GUARD_MODE=strict` | flag 只決定**什麼算滿足 gate**；要不要因為未滿足而擋下來，是 `STOP_GUARD_MODE` 決定的。預設 `warn` 會把缺漏印到 stderr 然後 **exit 0** |
| 兩種模式都已生效（**隨本次變更落地，非既有行為**） | 有 state file 時看 `precommit.mode`；沒有時 transcript fallback 從指令名（`/precommit` vs `/precommit-fast`）判定。在此之前 fallback 完全不檢查 flag，等於在最該保守的降級路徑上放行 fast。此處刻意不寫具體日期：`PRECOMMIT_REQUIRE_FULL` 這個 token 在 git 歷史中從未出現過（`git log -S PRECOMMIT_REQUIRE_FULL --all` 為空），整個 flag 連同 fallback 分支都是同一批尚未 commit 的變更；標上日期會讓讀者以為 git 佐證得了，實際上佐證不了 |
| 只管變體，不管 stage | 見上表——`full` 不等於「typecheck 確實跑過」 |

因此它的保證是「**縮減版變體不算數**」，而**不是**「typecheck 確實跑過」。刻意不把後兩列降級為失敗：無 build script 是正常設定，failing closed 會讓這類專案卡死且無事可修。分歧只有**其中一列**會被察覺：`post-tool-review-state.sh` 在 tool output 含 runner 的 `⏭️ build (skipped:` 字樣時於 stderr 警告，也就是「Node 專案但沒有 build script」那一列；非 Node 生態根本不經過 runner，不會產生該字樣，因此**無任何警告**。要真正關上這個缺口，需要在 state file 記錄 stage 級證據（runner 已逐步輸出 `## Steps`）。

## 7. Open Questions

| # | Question | Proposed Resolution |
|---|----------|-------------------|
| Q1 | PR-boundary 是否需要可執行的 full precommit enforcement？ | **已實作（opt-in）** — `stop-guard.sh` 的 `PRECOMMIT_REQUIRE_FULL=1` 會讓 `mode != full` 的 precommit 無法滿足 gate。預設關閉的理由**不是**本機 `.claude/CLAUDE.md`（那份 untracked，只對本機開發者成立），而是這個 flag 隨 plugin 發到任意 host project：fast gate 是 `precommit-fast` skill 明文支援的正當選擇，預設強制 full 會讓那些專案在毫無設定的情況下被擋。對本 repo 而言受版控政策是 full（Q4），所以本機若要讓兩者一致，做法是設 `PRECOMMIT_REQUIRE_FULL=1`，而非改動預設值 |
| Q2 | `next-step` skill 的 `post_precommit` 語意是否需要區分 fast/full？ | **已實作** — state file 已有 `precommit.mode`（`full` / `fast` / `unknown`），由 `_precommit_mode_of()` 從指令形式推導 |
| Q3 | 是否需要更新其他 skill 中硬編碼的 `/precommit` 參考？ | 不需要 — auto-loop 是最高優先級規則，衝突時 auto-loop 勝出 |
| Q4 | 受版控政策要 full 還是 fast？ | **已決：full** — `31510e6` 以 shift-left 為由把 `rules/auto-loop.md` + `CLAUDE.md` + hooks + skills 一併定為 `/precommit`，是最新定論。等同「受版控政策為 full、`.claude/CLAUDE.md` 的 fast 視為本機分歧」這個結論；`CLAUDE.template.md` 的漏改已補正並加測試（§2.4）。剩下唯一可選項是「是否連本機那份也改成 full，以便 Q1 改預設開啟」，屬環境偏好，不影響受版控政策 |
