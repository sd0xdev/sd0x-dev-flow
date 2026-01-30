---
description: 調研代碼現況後更新對應文件，確保文件與代碼同步。
argument-hint: <docs-path | feature-keyword>
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(ls:*), Bash(git:*), Bash(find:*)
---

## Context

- 目標：根據代碼現況更新文件，確保文件與實作同步。
- 輸入：文件路徑（如 `docs/features/auth`）或功能關鍵字（如 `auth`）

## Task

### Step 1: 定位文件與相關代碼

```bash
# 如果是文件路徑
ls $ARGUMENTS 2>/dev/null

# 如果是關鍵字，搜尋相關文件
find docs -name "*.md" | xargs grep -l "<keyword>" 2>/dev/null
```

從文件中提取：

- 文件描述的功能範圍
- 涉及的 Service / Provider / Entity

### Step 2: 調研代碼現況

```bash
# 查看相關源碼
ls src/service/ | grep -i "<keyword>"
ls src/provider/ | grep -i "<keyword>"
ls src/entity/ | grep -i "<keyword>"

# 查看最近變更
git log --oneline -20 --all -- "src/**/*<keyword>*"
git diff HEAD~10 --stat -- "src/**/*<keyword>*"
```

重點調研：

- [ ] 有哪些新增的 Service / Method？
- [ ] 有哪些修改的邏輯？
- [ ] 有哪些新增的 Entity / Field？
- [ ] API 有變更嗎？

### Step 3: 比對文件與代碼差異

| 項目     | 文件描述 | 代碼現況 | 狀態       |
| -------- | -------- | -------- | ---------- |
| Service  | ...      | ...      | ✅/⚠️ 過時 |
| API      | ...      | ...      | ✅/⚠️ 過時 |
| 資料模型 | ...      | ...      | ✅/⚠️ 過時 |
| 流程圖   | ...      | ...      | ✅/⚠️ 過時 |
| 測試位置 | ...      | ...      | ✅/⚠️ 過時 |

### Step 4: 更新文件

根據差異更新文件內容：

1. **架構圖**：如有變更，更新 Mermaid sequenceDiagram / flowchart
2. **核心服務表**：新增/移除/更名的 Service
3. **API 說明**：新增/修改的 API endpoint
4. **資料模型**：新增/修改的 Entity / Field
5. **測試位置**：更新測試檔案路徑

### Step 5: 產出變更摘要

## Output

```markdown
# 文件更新報告

## 更新範圍

- 文件路徑：$ARGUMENTS
- 調研時間：<timestamp>

## 調研發現

### 代碼變更

| 變更類型 | 檔案           | 說明     |
| -------- | -------------- | -------- |
| 新增     | src/service/.. | ...      |
| 修改     | src/entity/... | 新增欄位 |

### 文件差異

| 項目     | 原本     | 更新後   |
| -------- | -------- | -------- |
| Service  | A, B     | A, B, C  |
| API      | /v1/...  | /v2/...  |
| 測試位置 | test/... | test/... |

## 更新內容

<具體的文件變更 diff>

## 建議後續

- [ ] <如有需要進一步更新的項目>
```

## 使用範例

```bash
# 更新 相關文件
/update-docs docs/features/auth

# 根據關鍵字找到並更新相關文件
/update-docs auth

# 更新特定文件
/update-docs docs/features/auth/auth-implementation-architecture.md
```
