# Watch-CI Configurable Poll Interval

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — parent feature folder has no `1-requirements.md` (direct execution-phase fix).
> **Created**: 2026-04-17
> **Status**: Candidate Complete
> **Note**: all AC covered by evidence; commit 5abc462 landed --interval wiring, subsequent session extended regression suite to 11 tests
> **Priority**: P2
> **Tech Spec**: Pending (no separate spec required — small UX fix; implement directly from research findings)
> **Parent request**: [`2026-04-13-fix-watch-ci-fork-monitor-incompatibility.md`](./2026-04-13-fix-watch-ci-fork-monitor-incompatibility.md) (same feature thread — Monitor streaming UX follow-up)

## Background

`gh run watch` 預設 `--interval 3`，每 3 秒輸出一行狀態。Monitor tool 忠實把每行 stdout surface 成 notification，導致 `/watch-ci` 在 CI 執行期間不斷跳出通知（例如 "CI run 24495619643 (Spec 21 push)"）。

### Trade-off Quantification

| Metric | Current (`-i 3`) | Proposed default (`-i 30`) |
|--------|------------------|----------------------------|
| Polls per minute | ~20 | ~2 |
| Notification rate reduction | — | ~90% fewer poll ticks |
| Max completion-detection lag | ≤ 3s | ≤ 30s (+27s worst case) |
| Typical CI runtime impact | n/a | negligible (CI 通常跑數分鐘) |

使用者可透過 `--interval <sec>` 覆寫 default，場景需要即時性時可降回 3–10 秒。

## Requirements

- 讓 `/watch-ci` 能調整 `gh run watch` 的輪詢頻率，降低通知頻率。
- Default interval 設定為 **30 秒**，較符合 Monitor streaming 場景。
- 新增 `--interval <sec>` 參數（與 `gh` 的 flag 對齊），使用者可覆寫。
- 保留其他模式（`--blocking`、`--background`）行為不變。

## Scope

| Scope | Description                                                   |
| ----- | ------------------------------------------------------------- |
| In    | `skills/watch-ci/SKILL.md` 文件更新：Step 3b 指令、Arguments 表、Monitor mode 描述 |
| Out   | Monitor tool 本身的節流機制、`--compact` 切換、其他 skill 的輪詢頻率調整 |

## Related Files

| File                          | Action | Description                                                         |
| ----------------------------- | ------ | ------------------------------------------------------------------- |
| `skills/watch-ci/SKILL.md`    | Modify | Step 3b 的 `gh run watch` 指令加 `-i $INTERVAL`；Arguments 表新增 `--interval` 列；Monitor/Foreground mode 描述同步 |

## Acceptance Criteria

- [x] Step 3b 實作 argument-driven interval resolution：在 resolve-target 或 Step 3b 區塊顯式定義 `INTERVAL=${ARG_INTERVAL:-30}`，且 `gh run watch <run-id> --exit-status -i "$INTERVAL"` 必須傳入該變數（不接受 hard-coded 30）_— guard: `test/skills/watch-ci.test.js` → `watch-ci declares INTERVAL=${ARG_INTERVAL:-30} so --interval can override the default` + `watch-ci Step 3b threads $INTERVAL into the gh run watch command`_
- [x] Arguments 表新增 `--interval <sec>` 列，`Default` 欄明確標示 `30`，對齊 `gh --interval` flag 命名 _— guard: `watch-ci body documents --interval argument with default 30 seconds in Arguments section`_
- [x] Monitor mode / Foreground mode / Background mode 三段文字敘述皆引用同一 `$INTERVAL` 變數或明確指出 interval 套用方式（不互相矛盾）_— guard: `watch-ci Monitor/Foreground/Background mode sections each invoke -i "$INTERVAL" (AC #3)` + `watch-ci mode sections must not hard-code a numeric -i (AC #3 anti-regression)`_
- [x] 文件 trade-off 區塊呈現量化比較（3s vs 30s 的 polls/min、最大完成偵測 lag、90% 通知削減估計）_— guard: `watch-ci documents the 3s-vs-30s poll-interval trade-off (rationale guard)`_
- [x] 現有 frontmatter `allowed-tools: Bash(gh:*)` 驗證確實涵蓋 `gh run watch -i`（毋需修改 hook 權限）_— guard: `watch-ci frontmatter allowed-tools includes Bash(gh:*) to cover gh run watch -i`_
- [x] Pass `/codex-review-doc` _— 2026-04-17 session: Codex thread `019d9934…` reached ✅ Mergeable in 3 loop rounds (session-scoped transcript, not persisted)_

## Progress

| Phase       | Status | Note |
| ----------- | ------ | ---- |
| Analysis    | Done   | Root cause: `gh run watch` default `-i 3` + Monitor per-line notification (2026-04-17) |
| Development | Done   | Commit `5abc462` landed `-i "$INTERVAL"` wiring + default 30s + Arguments row — reproducible via `git show 5abc462` |
| Testing     | Done   | 11 regression tests guard all 5 testable AC — reproducible via `node --test test/skills/watch-ci.test.js` (expect `11/11`). Full `/precommit` suite also exercised this session; no persisted CI artifact (pre-push) |
| Acceptance  | Done   | Dual-reviewer (Codex thread `019d9964…`, `pr-review-toolkit:code-reviewer` agent) both ✅ Ready this session. Doc review Codex thread `019d9934…` reached ✅ Mergeable in 3 rounds. Adequacy gate ✅ Adequate (advisory mode, all 5 testable AC mapped to regression tests). Thread IDs are session-scoped — not retrievable cross-session |

**Status**: Pending / In Progress / Candidate Complete / Completed (canonical lifecycle — see SKILL.md §Phase 4 Auto-Update Items for transition rules)

## References

- Parent feature: [watch-ci-monitor-migration feature folder](../)
- Related request: [Watch-CI Monitor tool migration](./2026-04-10-watch-ci-monitor-tool-migration.md)
- Related request: [Fix watch-ci fork monitor incompatibility](./2026-04-13-fix-watch-ci-fork-monitor-incompatibility.md)
- Skill under modification: [`skills/watch-ci/SKILL.md`](../../../../skills/watch-ci/SKILL.md)
- User feedback origin: 2026-04-17 session — Monitor event 跳出頻率過高
- Implementation hint: `gh run watch <id> --exit-status -i "$INTERVAL"` (official `gh` flag, default 3s — confirmed via `gh run watch --help`)
