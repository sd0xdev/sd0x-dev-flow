---
name: code-explore
description: Pure Claude code investigation. Fast codebase exploration, trace execution paths, understand architecture, diagnose issues. No Codex dependency.
allowed-tools: Read, Grep, Glob, Bash
context: fork
---

# Code Explore Skill

## Trigger

- Keywords: code explore, 代碼調查, 調研代碼, trace code, 追蹤代碼, 功能理解, 快速調查, 代碼探索

## When to Use

- 快速理解某功能如何運作
- 追蹤執行路徑 / 資料流
- 診斷問題根因
- 不需要雙重確認（不需 Codex 交叉驗證）

## When NOT to Use

| 場景         | 替代方案                              |
| ------------ | ------------------------------------- |
| 需要雙重確認 | `/code-investigate`（Claude + Codex） |
| Git 歷史追蹤 | `/git-investigate`                    |
| 系統驗證     | `/feature-verify`                     |
| 代碼審查     | `/codex-review-fast`                  |

## Workflow

```
┌──────────────────────────────────────────────────────────┐
│ Phase 1: 定位入口                                         │
├──────────────────────────────────────────────────────────┤
│ 1. Grep 關鍵字 → 找相關檔案                               │
│ 2. 識別入口點（Controller / Service / Provider）          │
│ 3. 建立檔案清單                                           │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│ Phase 2: 追蹤路徑                                         │
├──────────────────────────────────────────────────────────┤
│ 1. 從入口點開始 Read                                      │
│ 2. 識別依賴 → 繼續追蹤                                    │
│ 3. 畫出調用鏈（A → B → C）                                │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│ Phase 3: 理解邏輯                                         │
├──────────────────────────────────────────────────────────┤
│ 1. 核心邏輯是什麼？                                       │
│ 2. 資料流向如何？                                         │
│ 3. 錯誤處理機制？                                         │
│ 4. 關鍵決策點？                                           │
└──────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────┐
│ Phase 4: 輸出報告                                         │
├──────────────────────────────────────────────────────────┤
│ 1. 架構概覽（圖 / 表）                                    │
│ 2. 關鍵檔案清單                                           │
│ 3. 執行流程                                               │
│ 4. 發現 / 注意事項                                        │
└──────────────────────────────────────────────────────────┘
```

## 搜尋策略

| 目標        | 策略                                                     |
| ----------- | -------------------------------------------------------- |
| 功能入口    | `Grep "export class.*Controller"` / `Grep "@Get\|@Post"` |
| Service 層  | `Grep "export class.*Service"`                           |
| Provider 層 | `Glob "src/provider/**/*.ts"`                            |
| 配置        | `Read {CONFIG_FILE}`                              |
| 資料模型    | `Glob "src/model/**/*.ts"`                               |

## 輸出格式

```markdown
## 調查報告：{主題}

### 架構概覽

{ASCII 或 Mermaid 圖}

### 關鍵檔案

| 檔案              | 職責 |
| ----------------- | ---- |
| `path/to/file.ts` | 說明 |

### 執行流程

1. {步驟 1}
2. {步驟 2}
3. ...

### 資料流

{描述資料如何流動}

### 發現

- {重要發現 1}
- {重要發現 2}

### 注意事項

- {潛在問題 / edge case}
```

## Examples

### 功能理解

```
輸入：調查 用戶資料怎麼查詢的
Phase 1: Grep "balance" → 找到 UserService, UserController
Phase 2: Controller → Service → Provider 調用鏈
Phase 3: 理解 查詢 + cache 機制
Phase 4: 輸出報告 + 流程圖
```

### 問題診斷

```
輸入：為什麼 某個 API 回傳有時候是空的？
Phase 1: Grep "getData" + "cache" → 相關檔案
Phase 2: 追蹤 資料獲取路徑
Phase 3: 識別 fallback 邏輯 + timeout 處理
Phase 4: 列出可能原因 + 建議
```

### 架構理解

```
輸入：用戶模組的整體架構是什麼？
Phase 1: Glob "src/**/*user*" → 列出所有相關檔案
Phase 2: 識別層級關係（Controller → Service → Provider）
Phase 3: 理解各層職責
Phase 4: 輸出架構圖 + 模組說明
```

## 與 code-investigate 的差異

| 維度   | code-explore       | code-investigate   |
| ------ | ------------------ | ------------------ |
| 速度   | 快（單視角）       | 慢（雙視角）       |
| 確認度 | 單一視角           | 交叉驗證           |
| 工具   | 純 Claude          | Claude + Codex     |
| 適用   | 快速調查、日常理解 | 重要決策、需要確認 |
