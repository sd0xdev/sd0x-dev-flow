---
name: create-request
description: Create or update request documents. Auto-fills templates for new requests, updates progress based on implementation for existing ones.
allowed-tools: Read, Grep, Glob, Write, Bash
---

# Create/Update Request Skill

## Trigger

- Keywords: create request, new request, write request, 建需求單, 新需求, update request, 更新需求單, 同步進度

## Modes

| Mode     | 觸發條件              | 動作                       |
| -------- | --------------------- | -------------------------- |
| `create` | 無指定檔案 / 新需求   | 收集資訊 → 填模板 → 建檔案 |
| `update` | 指定檔案 / 更新需求單 | 讀現況 → 查實作 → 更新進度 |

## When NOT to Use

- 查看需求單結構（用 request-tracking）
- 技術方案撰寫（用 /tech-spec）
- 代碼開發（用 feature-dev）

---

## Create Mode Workflow

```
Phase 1: Gather    → 收集 feature, title, priority, requirements
Phase 2: Explore   → 搜尋相關代碼 + 技術方案
Phase 3: Generate  → 填充模板 + 建立檔案
Phase 4: Confirm   → 顯示結果 + 建議下一步
```

## Create Mode: Interaction

If incomplete info, ask:

```
1. Feature area: Which feature? (e.g., auth, billing, notifications)
2. Title: Brief description
3. Priority: P0 (urgent) / P1 (high) / P2 (medium)
4. Background: Why is this needed?
5. Requirements: What needs to be done? (list)
6. Acceptance criteria: How do we know it's done?
```

---

## Update Mode Workflow

```
Phase 1: Load      → 讀取現有需求單
Phase 2: Analyze   → 分析 Related Files + git 變更
Phase 3: Map       → 比對實作與 Acceptance Criteria
Phase 4: Update    → 更新 Progress / Status / Checkboxes
Phase 5: Report    → 輸出變更摘要
```

### Phase 2: 分析實作進度

```bash
# 取得需求單中 Related Files 的變更
git log --oneline --since="<created_date>" -- <related_files>

# 檢查測試狀態
grep -r "describe\|it\(" test/ --include="*<feature>*"

# 檢查 review 狀態
git log --oneline --grep="codex-review" -- <related_files>
```

### Phase 3: 進度對應規則

| 實作狀態                      | Progress 更新    |
| ----------------------------- | ---------------- |
| Related Files 有 commit       | 開發 → 🔄 進行中 |
| 測試檔案有新增/修改           | 測試 → 🔄 進行中 |
| `/codex-review-fast` 通過     | 開發 → ✅ 完成   |
| `/precommit` 通過             | 測試 → ✅ 完成   |
| 所有 Acceptance Criteria 勾選 | 驗收 → ✅ 完成   |

### Phase 4: 自動更新項目

| 區塊                  | 更新邏輯                             |
| --------------------- | ------------------------------------ |
| `Status`              | Pending → In Development → Completed |
| `Progress` table      | 根據 git 變更更新各 phase status     |
| `Acceptance Criteria` | 根據實作/測試結果勾選 checkbox       |
| `Progress.Note`       | 加入最新 commit message 摘要         |

### Update Mode: Interaction

如需確認，詢問：

```
1. 確認目標需求單路徑
2. 是否有手動完成的項目需要勾選？
3. 是否有卡住的項目需要標記？
```

## File Naming

**Format**: `YYYY-MM-DD-kebab-case-title.md`

**Location**: `docs/features/{feature}/requests/`

## Verification

- 檔案命名符合規範
- 模板所有區塊都已填充
- 相關檔案連結正確
- 驗收標準使用 checkbox

## After Creation

Suggest next steps:

1. `/tech-spec` - Create technical specification
2. `/codex-architect` - Get architecture advice
3. Start implementation

## References

- `references/template.md` - 需求單模板 + 命名規範

## Related Skills

| Skill              | Purpose          |
| ------------------ | ---------------- |
| `request-tracking` | 需求單結構知識庫 |
| `tech-spec`        | 技術方案撰寫     |
| `feature-dev`      | 開發流程         |

## Examples

### Create Mode

```
輸入：/create-request Feature: Auth Title: Fix validation Priority: P1
動作：探索相關代碼 → 填充模板 → 建立檔案 → 建議下一步
```

```
輸入：建一張需求單
動作：詢問必要資訊 → 探索 → 建立 → 確認
```

### Update Mode

```
輸入：/create-request --update docs/features/auth/requests/2026-01-23-fix-login-validation.md
動作：讀取需求單 → 分析 git 變更 → 更新 Progress → 輸出摘要
```

```
輸入：更新需求單進度
動作：從上下文識別需求單 → 分析實作 → 自動更新 → 確認
```

```
輸入：（開發完成後）同步需求單
動作：
  1. 讀取 Related Files
  2. git log 檢查變更
  3. 更新：開發 ⬜→✅, 測試 ⬜→🔄
  4. 勾選已完成的 Acceptance Criteria
  5. Status: Pending → In Development
```
