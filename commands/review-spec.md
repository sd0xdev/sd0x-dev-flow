---
description: 審核技術方案文件，從完整性、可行性、風險、代碼一致性等維度給出審核意見。
argument-hint: <文件路徑>
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*)
skills: tech-spec
---

## Context

- Project root: !`git rev-parse --show-toplevel`
- Project structure: !`echo "Run /repo-intake first"`

## Task

你現在是 `tech-spec-reviewer` 專家。請審核以下技術方案文件：

### 待審核文件

```
$ARGUMENTS
```

### 審核流程

#### Step 1: 讀取技術方案

讀取指定的技術方案文件，理解其內容。

#### Step 2: 調研相關代碼

根據方案中提到的模組，調研實際代碼：

```bash
# 檢查方案中提到的檔案是否存在
ls -la <方案中提到的檔案路徑>

# 檢查相關模組的實際實現
grep -r "相關關鍵字" src/ --include="*.ts" | head -20

# 檢查現有的設計模式
cat src/provider/basic/provider.basic.ts | head -50
```

#### Step 3: 完整性檢查

- 需求是否被完整覆蓋？
- 邊界條件是否考慮？
- 錯誤處理是否明確？

#### Step 4: 可行性評估

- 技術選型是否合理？
- 與現有代碼相容嗎？
- 有沒有更簡單的方案？

#### Step 5: 風險審核

- 風險識別是否全面？
- 緩解方案是否可行？
- 有沒有遺漏的風險？

#### Step 6: 代碼一致性

- 是否遵循專案的 Provider/Service/Entity 模式？
- 命名是否符合慣例？
- 是否複用了現有工具？

#### Step 7: 測試策略

- 測試覆蓋是否充分？
- Unit/Integration/E2E 劃分是否合理？

## Output

```markdown
# 技術方案審核報告

**審核文件**: `$ARGUMENTS`
**審核時間**: <date>

## 審核摘要

| 維度       | 評分       | 說明 |
| ---------- | ---------- | ---- |
| 完整性     | ⭐⭐⭐⭐☆  |      |
| 可行性     | ⭐⭐⭐☆☆   |      |
| 風險評估   | ⭐⭐⭐⭐☆  |      |
| 代碼一致性 | ⭐⭐⭐⭐⭐ |      |
| 測試策略   | ⭐⭐⭐☆☆   |      |

## 總體評價

✅ 通過 / ⚠️ 需修改後通過 / ❌ 需重新設計

<1-3 句總結>

## 優點

-

## 問題與建議

### 🔴 必須修改（Blocker）

1. **[問題標題]**
   - 位置：方案第 X 節
   - 問題：具體描述
   - 建議：如何修改

### 🟡 建議修改（Improvement）

1. **[問題標題]**
   - 位置：
   - 問題：
   - 建議：

### 🟢 可選優化（Nice to have）

1. **[優化點]**
   - 建議：

## 遺漏項目

（方案中應該有但沒有的內容）

## 代碼驗證結果

（對照實際代碼後發現的問題）

## 開放討論

（需要進一步討論的問題）
```
