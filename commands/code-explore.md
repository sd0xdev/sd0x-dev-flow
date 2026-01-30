---
description: 純 Claude 代碼調查。快速深入調研代碼庫，追蹤執行路徑、理解架構、診斷問題。
argument-hint: '<調查目標或問題>'
allowed-tools: Read, Grep, Glob, Bash(ls:*), Bash(find:*)
skills: code-explore
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Services: !`ls src/service/ 2>/dev/null | head -10`
- Providers: !`ls src/provider/ 2>/dev/null | head -10`

## Task

使用純 Claude 調查代碼，不使用 Codex。

### 調查目標

```
$ARGUMENTS
```

### 執行指引

遵循 skill 中的 4 階段流程：

| Phase | 名稱     | 動作                           |
| ----- | -------- | ------------------------------ |
| 1     | 定位入口 | Grep/Glob 找相關檔案           |
| 2     | 追蹤路徑 | Read 入口點 → 追蹤依賴         |
| 3     | 理解邏輯 | 分析核心邏輯、資料流、錯誤處理 |
| 4     | 輸出報告 | 架構圖 + 關鍵檔案 + 執行流程   |

### 參考

| 檔案                                                       | 用途         |
| ---------------------------------------------------------- | ------------ |
| @skills/code-explore/SKILL.md                      | 完整工作流程 |
| @skills/code-explore/references/search-patterns.md | 搜尋模式參考 |

## Examples

```bash
# 功能理解
/code-explore "token balance 怎麼查詢的"

# 問題診斷
/code-explore "為什麼 NFT metadata 有時候是空的"

# 架構理解
/code-explore "用戶模組的整體架構"
```

## 與 /code-investigate 的差異

| 維度   | /code-explore      | /code-investigate  |
| ------ | ------------------ | ------------------ |
| 速度   | 快（單視角）       | 慢（雙視角）       |
| 確認度 | 單一視角           | 交叉驗證           |
| 工具   | 純 Claude          | Claude + Codex     |
| 適用   | 快速調查、日常理解 | 重要決策、需要確認 |
