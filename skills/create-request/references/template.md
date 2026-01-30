# Create Request Template

## Request Document Template

```markdown
# {Title}

> **Created**: {YYYY-MM-DD}
> **Status**: Pending
> **Priority**: {P0|P1|P2}
> **Tech Spec**: [Link](../planning/xxx.md) ← 方案細節見此

## Background

{1-2 句說明問題與背景}

## Requirements

- {Requirement 1}
- {Requirement 2}

## Scope

| 範圍 | 說明                     |
| ---- | ------------------------ |
| ✅   | {在此單處理的項目}       |
| ❌   | {不在此單處理，另案處理} |

## Related Files

| File                 | Action | Description |
| -------------------- | ------ | ----------- |
| `src/service/xxx.ts` | Modify | {簡述變更}  |
| `src/entity/xxx.ts`  | New    | {簡述用途}  |

## Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] Unit test coverage > 80%
- [ ] Pass /codex-review-fast

## Progress

| Phase | Status | Note |
| ----- | ------ | ---- |
| 分析  | ⬜     |      |
| 開發  | ⬜     |      |
| 測試  | ⬜     |      |
| 驗收  | ⬜     |      |

**Status**: ⬜ 未開始 / 🔄 進行中 / ✅ 完成 / ⛔ 卡住

## References

- Tech Spec: [xxx](../planning/xxx.md)
- Related Request: [yyy](./yyy.md)
```

## Naming Convention

**Format**: `YYYY-MM-DD-kebab-case-title.md`

```
2026-01-23-api-performance-optimization.md   ✅
2026-01-23-api-cache-ttl.md     ✅
api-optimization.md                         ❌ Missing date
2026-01-23-API_Optimization.md              ❌ Wrong case
```

## File Location

```
docs/features/{feature}/requests/YYYY-MM-DD-title.md
```

## Priority & Status

| Priority | Description | Timeline    |
| -------- | ----------- | ----------- |
| P0       | Critical    | Immediate   |
| P1       | High        | This week   |
| P2       | Medium      | This sprint |

| Status         | Description      |
| -------------- | ---------------- |
| Pending        | Not started      |
| In Development | Work in progress |
| Completed      | Done             |

## Writing Guidelines

| Principle  | Description                                 |
| ---------- | ------------------------------------------- |
| 簡潔扼要   | 背景 1-2 句，需求用列表                     |
| 引用不內嵌 | 偽代碼/方案細節放 Tech Spec，需求單只引用   |
| 追蹤進度   | Progress 區塊標記各階段狀態                 |
| 明確範圍   | Scope 區塊標明「做什麼」與「不做什麼」      |
| 可驗收     | Acceptance Criteria 用 checkbox，可勾選驗收 |
