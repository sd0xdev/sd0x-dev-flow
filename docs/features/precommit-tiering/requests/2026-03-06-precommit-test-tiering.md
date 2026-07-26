# Precommit Test Tiering

> **Created**: 2026-03-06
> **Status**: Completed
> **Note**: routing 部分已由 `31510e6` 取代，見下方 [Superseded](#superseded)
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)

## Background

Auto-loop 每次 fix iteration 執行完整測試套件（369 tests, ~8 min），integration tests 佔 95% 時間。建立 fast/full 分層，auto-loop 迭代改用 fast tier，PR gate 維持 full tier。

## Requirements

- 新增 `test:fast`（unit + schema, <2s）和 `test:ci`（全套）npm scripts
- Runner test selection 依 mode 使用不同 preference chain（fast: `test:fast -> test:unit -> test`、full: `test:ci -> test -> test:fast -> test:unit`）
- Command docs（precommit-fast.md / precommit.md）更新 preferred list 對齊 runner
- Auto-loop routing 從 `/precommit` 改為 `/precommit-fast`
- 通用專案 fast mode graceful degradation 到現有行為；full mode intentionally 偏好 `test` 以獲得更完整覆蓋

## Scope

| Scope | Description |
|-------|-------------|
| In | package.json scripts、runner preference chain、command docs、auto-loop routing、CLAUDE.md 更新、runner 測試 |
| Out | PR-boundary full precommit enforcement（獨立 enhancement）、非 Node runner fallback（獨立 enhancement）、jq process spawning 優化 |

## Related Files

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | 新增 `test:fast`, `test:ci` scripts |
| `scripts/precommit-runner.js` | Modify | Test preference chain by mode |
| `skills/precommit-fast/SKILL.md` | Modify | 更新 intent preferred list + description + output table（v3 前為 `commands/precommit-fast.md`） |
| `skills/precommit/SKILL.md` | Modify | 更新 intent preferred list + description + output table（v3 前為 `commands/precommit.md`） |
| `rules/auto-loop.md` | Modify | Iterative route -> `/precommit-fast` |
| `CLAUDE.md` | Modify | 更新 auto-loop 表格 |
| `.claude/CLAUDE.md` | Modify | 更新 auto-loop 表格 |
| `CLAUDE.template.md` | Modify | 更新 auto-loop 表格 |
| `test/scripts/precommit-runner.test.js` | Modify | 新增 tier preference 測試 |

## Acceptance Criteria

- [x] `npm run test:fast` 執行 unit + schema tests（<2s）— 實測 ~1.3s, 39 tests
- [x] `npm run test:ci` 執行全部測試
- [x] Runner fast mode 選擇 `test:fast -> test:unit -> test`
- [x] Runner full mode 選擇 `test:ci -> test -> test:fast -> test:unit`
- [x] Full mode 覆蓋 >= fast mode — chain 包含 `test:fast` 防止 edge case
- [x] 無 `test:fast` 的專案 fast mode fallback 到 `test:unit`（現有行為）— 有測試驗證
- [x] Auto-loop iterative route 改為 `/precommit-fast` — ⚠️ `rules/auto-loop.md` 交付當時成立，已由 `31510e6` 反轉（見 Superseded）
- [x] CLAUDE.md auto-loop 表格已更新（**受版控的 `CLAUDE.md` + `CLAUDE.template.md`**）— ⚠️ 交付者是 `a4a0be5`，非 `2f830c7`/`2fb6088`；之後 `31510e6` 只改回 `CLAUDE.md`（見 Superseded）。untracked 的 `.claude/CLAUDE.md` **不在 git 史內，本 AC 無法宣稱它被更新過**
- [x] Runner 測試驗證 tier preference chain — 5 個新測試
- [x] 所有現有 precommit-runner 測試繼續通過 — 10/10 pass
- [x] Pass `/codex-review-fast` — ✅ Ready (threadId: 019cc1e6-7094-74b3-b3de-6a1d6d172ad9)
- [x] Pass `/precommit-fast` — ✅ PASS (lint 0 errors + 39 tests pass)

## Superseded

上方 AC 在交付當時為真，但**交付與反轉都不是單一 commit**，兩者分屬不同檔案面：

下表列的是**與本 routing 決策相關的檔案**，不是 commit 的完整改動範圍——各 commit 都另外動了其他東西，
括號內為 `git show --stat` 的實際檔案數：

| 時序 | Commit | routing 相關的改動面 |
|------|--------|----------|
| 交付 W5 | `2f830c7` → `2fb6088` | `rules/auto-loop.md` 改為 `/precommit-fast`（W5 範圍內僅此一檔；`2f830c7` 全域 8 檔、`2fb6088` 2 檔） |
| 交付 W6 | `a4a0be5` | `CLAUDE.md` + `CLAUDE.template.md` 改為 `/precommit-fast`（全域也正好只有這 2 檔） |
| 反轉 | `31510e6` | `rules/auto-loop.md` + `CLAUDE.md` 改回 `/precommit`（**漏了 `CLAUDE.template.md`**；全域 12 檔，另含 hooks 與多個 skill） |
| 補正 | 2026-07-25 | `CLAUDE.template.md` 改回 `/precommit` + 一致性測試 |

`31510e6`（*refactor: Change auto-loop default from /precommit-fast to /precommit*）的理由是 **shift-left**：讓 lint/build 失敗在本地就浮現，而非留到 CI。真正造成漂移的是 `a4a0be5` 把 fast 寫進樣板、而 `31510e6` 反轉時沒回頭處理樣板——樣板從此比規範寬鬆了整整一輪，且無測試把關。

本請求的 **tiering 機制本身仍然有效且在用**（`test:fast` / `test:ci` scripts、runner 的 fast/full preference chain、`/precommit-fast` skill 都沒有被移除）；被取代的只有「auto-loop 預設走哪一層」這個 routing 決策。

| 檔案 | 現況 | 追蹤 |
|------|------|------|
| `rules/auto-loop.md` | `/precommit`（規範來源） | ✅ |
| `CLAUDE.md` | `/precommit` | ✅ |
| `CLAUDE.template.md` | `/precommit` — **`31510e6` 漏改，2026-07-25 補上** | ✅ |
| `.claude/CLAUDE.md` | `/precommit-fast` | ❌ untracked；意圖無法由 git 史判定，不在測試可及範圍 |
| `hooks/post-compact-auto-loop.sh` | `NEXT="/precommit"` | ✅ |
| `hooks/post-skill-auto-loop.sh` | `NEXT="/precommit"` | ✅ |
| `hooks/user-prompt-review-guard.sh` | `NEXT="/precommit"` | ✅ |

`31510e6` 漏改 `CLAUDE.template.md`，導致 `/project-setup` 發給新專案的樣板停在 fast gate，與 plugin 自身的規範不一致且無測試把關。已補 `test/skills/claude-md-coverage.test.js` 的 routing 一致性測試（突變驗證：把樣板改回 fast → 紅），**六個**受追蹤的面現在只能有一個答案：三份 policy 文件，加上真正把 route 送進模型脈絡的三個 hook。hook 清單由 `hooks/*.sh` 掃描推導而非手列——第三個 emitter（`user-prompt-review-guard.sh`，三者中觸發最頻繁者）當初就是這樣被漏掉的。`rules/auto-loop.md` 檔案內部的每一處 `/precommit` 參照也一併釘住，避免規範來源自相矛盾。

## Progress

| Phase | Status | Note |
|-------|--------|------|
| Analysis | Done | Best practices audit + codex-brainstorm 5-round debate 完成 |
| Development | Done | 7-item fix set 全部實作：runner tiering + CI=1 env + PM-agnostic scripts + command docs + auto-loop routing + CLAUDE.md |
| Testing | Done | 10/10 precommit-runner tests pass（含 5 個 tier preference chain 測試）|
| Acceptance | Done | 12/12 AC 全部通過 |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md)
- Implementation commit: `2f830c7` feat: Adds precommit test tiering with fast/full preference chains
- Best Practices Debate threadId: `019cc1c7-ff0a-74e3-af38-a9e1e3160018`
- Codex Review threadId: `019cc1e6-7094-74b3-b3de-6a1d6d172ad9`
- Nash Equilibrium: 7-item fix set（auto-loop + runner + commands + package.json + CLAUDE.md + tests）
