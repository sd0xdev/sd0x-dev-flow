---
name: request-tracking
description: Request tracking knowledge base. Covers request structure, status tracking, document references, progress management.
allowed-tools: Read, Grep, Glob
context: fork
agent: Explore
---

# Request Tracking Skill

## Trigger

- Keywords: 需求單, request, 進度追蹤, 狀態, 驗收標準, 技術方案

## When NOT to Use

- 建立新需求單（用 /create-request）
- 技術方案撰寫（用 /tech-spec）
- 代碼開發（用 feature-dev）

## Document Hierarchy

```
requests/        需求單（範疇 + 驗收）
    ↓ 引用
planning/        技術方案（實作細節）
    ↓ 引用
adr/             決策紀錄（為什麼）
    ↓ 參考
architecture/    架構文檔（系統設計）
```

## File Location

```
docs/features/{feature}/
├── requests/           # 活躍需求單
│   └── archived/       # 已完成
├── planning/           # 技術方案
├── adr/                # 決策記錄
└── architecture/       # 架構文檔
```

## Naming Convention

**Format**: `YYYY-MM-DD-kebab-case-title.md`

## Status & Priority

| Status   | Description |
| -------- | ----------- |
| 待實作   | 未開始      |
| 開發中   | 進行中      |
| 審核通過 | 方案已確認  |

| Priority | Timeline |
| -------- | -------- |
| P0       | 立即     |
| P1       | 本週     |
| P2       | 本迭代   |

## Verification

- 需求單包含：背景、需求、驗收標準
- 檔案命名符合規範
- 正確連結技術方案

## References

- `references/template.md` - 需求單模板
- `references/operations.md` - 操作指南

## Examples

```
輸入：需求單怎麼寫？
動作：說明模板結構 + 引用 template.md
```

```
輸入：這個需求的進度如何追蹤？
動作：說明進度表格 / Phase 分解方式
```
