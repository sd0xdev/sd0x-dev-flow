# Review Loop Resilience — r1 行為層：中央契約與規則

> **Doc class**: Request ticket (date-prefixed non-lifecycle — per `@rules/docs-numbering.md`). Per-task work breakdown unit for progress tracking. **Not** a feature-level requirements doc — for that see `../1-requirements.md` (created via `/req-analyze`).
> **Created**: 2026-08-23
> **Status**: In Progress
> **Priority**: P1
> **Tech Spec**: [2-tech-spec.md](../2-tech-spec.md)
> **Requirements**: [1-requirements.md](../1-requirements.md)

## Background

Review loop 缺輪替條件、Codex 不可用即死路。本票落地行為層政策：中央契約（`review-common.md`）、規則（`auto-loop.md`、`codex-invocation.md`）與兩份 `CLAUDE.md` 的同步改寫（tech spec T1＋T3＋T4）。

## Requirements

- `review-common.md` 寫入輪替中央契約與 fallback 承載的 Degradation Matrix
- `rules/auto-loop.md` § Review Dispatch 政策反轉＋新 setting；`codex-invocation.md` 同 thread 限縮
- root 與 `.claude/` 的 `CLAUDE.md` 一行同步

## Scope

| Scope | Description |
| ----- | ----------- |
| In    | Tech spec §3.3 表中 rules 與 CLAUDE.md 各列（T1、T3、T4） |
| Out   | scripts／agent（r2）、skill 消費點（r3）、測試同步與 E2E（r4）、necessity-audit（v1 全排除） |

## Related Files

| File | Action | Description |
| ---- | ------ | ----------- |
| `skills/codex-code-review/references/review-common.md` | Modify | § Review Loop 輪替條款；§ Degradation Matrix 兩列改寫＋`gate_source=fallback:*`；§ Source Attribution 加 `fallback` |
| `rules/auto-loop.md` | Modify | § Review Dispatch 改寫；§ Override Contract 加 `## Review Thread Rotation` |
| `rules/auto-loop-project.md` | Modify | Scaffold 加同名 setting heading |
| `rules/codex-invocation.md` | Modify | Loop exception 限縮同 thread＋輪替首輪完整契約段 |
| `CLAUDE.md`／`.claude/CLAUDE.md` | Modify | 「One reviewer — Codex」句補 fallback 敘述（兩檔同步） |

## Acceptance Criteria

- [x] `review-common.md` § Review Loop 含 R-a/R-b 輪替條件、per-thread 計數（明文排除 `review-state.rounds`）、輪替程序與 `[THREAD_ROTATED]` 格式；one-thread-per-batch 字句保留
- [x] `review-common.md` Degradation Matrix「Codex ❌」兩列改為 fallback 承載（`--dual` 聚合語意保留），`gate_source=fallback:*` 與 Source Attribution `fallback` 列存在
- [x] `rules/auto-loop.md` 不含「never a gate verdict」原句；含 contract-aware fallback、per-change 黏著、fail-closed 驗證、per-contract Priority 4（不偽造 sentinel）、necessity-audit v1 排除
- [x] `rules/auto-loop.md` § Override Contract 表與 `auto-loop-project.md` scaffold 各含 `## Review Thread Rotation`（2–6，預設 3）
- [x] `rules/codex-invocation.md` loop exception 明文限縮**同 thread** reply；輪替後新 thread 首輪回完整契約句存在
- [x] 兩份 `CLAUDE.md` § Auto-Loop 的 reviewer 句已補 fallback 敘述且內容一致
- [x] `grep -rn "never a gate verdict\|not a fallback" rules/ skills/codex-code-review/` 無殘留矛盾句（requirements Signal 6）
- [ ] Pass `/codex-review-doc`

## Progress

| Phase      | Status | Note |
| ---------- | ------ | ---- |
| Analysis   | Done   | 依 tech spec §3 對應段落實作 |
| Development | Done  | 中央契約＋auto-loop/codex-invocation/scaffold＋CLAUDE.md ×2 全數落地；Signal 6 grep 無殘留 |
| Testing    | Done   | test/rules/review-loop-resilience.test.js 契約斷言 18/18 綠；override-contract 75 綠 |
| Acceptance | In Progress | 待 gate（review/precommit）完成後勾銷 |

## References

- Tech Spec: [2-tech-spec.md](../2-tech-spec.md) §3.1、§3.2、§3.3、§3.5
- Sibling: [r2](./2026-08-23-review-loop-resilience-r2.md)、[r3](./2026-08-23-review-loop-resilience-r3.md)、[r4](./2026-08-23-review-loop-resilience-r4.md)
