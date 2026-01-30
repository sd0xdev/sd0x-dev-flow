# 文檔編號規則

## 功能文檔結構

每個功能的文檔按開發階段編號，存放於 `docs/features/<feature>/`。

```
docs/features/<feature>/
├── 0-feasibility-study/         # 可行性研究（可為資料夾或單檔）
│   ├── 0-feasibility-study.md   #   主文件
│   └── N-<sub-topic>.md         #   子研究
├── 1-requirements.md            # 需求規格（如有）
├── 2-tech-spec.md               # 技術方案
├── 3-architecture.md            # 架構設計
├── 4-implementation.md          # 實作紀錄（如有）
└── requests/                    # 需求單（不編號）
    └── YYYY-MM-DD-<title>.md
```

## 編號規則

| 規則 | 說明 |
|------|------|
| 格式 | `<N>-<kebab-case-name>.md` |
| 起始 | `0` = 可行性研究（最早階段） |
| 順序 | 反映開發階段順序，不是優先級 |
| 跳號 | 允許（如 0, 2, 3 跳過 1），代表該階段不適用 |
| 子文件 | 同一階段多份文件時，建子資料夾（如 `0-feasibility-study/`） |
| 子編號 | 資料夾內同樣用數字前綴（`0-main.md`, `1-sub.md`） |

## 標準階段

| 編號 | 階段 | 產出命令 | 必要性 |
|------|------|---------|--------|
| 0 | 可行性研究 | `/feasibility-study` | 建議 |
| 1 | 需求規格 | - | 視情況 |
| 2 | 技術方案 | `/tech-spec` | 必要 |
| 3 | 架構設計 | `/deep-analyze` | 建議 |
| 4+ | 實作/附錄 | - | 視情況 |

## 交叉引用

文件間引用使用**相對路徑**：

```markdown
<!-- 同層引用 -->
見 [技術方案](./2-tech-spec.md)

<!-- 子資料夾 → 上層 -->
見 [技術方案](../2-tech-spec.md)

<!-- 上層 → 子資料夾 -->
見 [可行性研究](./0-feasibility-study/0-feasibility-study.md)
```

## 禁止

- ❌ 無編號的功能文檔（`tech-spec.md`）— 必須帶數字前綴
- ❌ 用日期前綴（`2026-01-30-tech-spec.md`）— 日期前綴僅用於 `requests/`
- ❌ 用大寫或底線（`2_Tech_Spec.md`）— 統一 kebab-case
