# Auto-Loop Rule ⚠️ CRITICAL

**修復 → 立即重審 → 未過 → 再修 → ... → ✅ Pass → 下一步**

## 禁止行為

❌ 修復後問「要我重審嗎？」「是否繼續？」
❌ 輸出摘要後停止，不執行審核
❌ 等待用戶指示
❌ **宣告當執行**：說「需要執行 X」但沒有調用工具
❌ **摘要即完成**：輸出漂亮總結後停止，未執行下一步

## 自動觸發

| 變更類型  | 事件           | 立即執行             |
| --------- | -------------- | -------------------- |
| `.ts/.js` | 修復 P0/P1/P2  | `/codex-review-fast` |
| `.ts/.js` | review Pass    | `/precommit`         |
| `.ts/.js` | precommit 失敗 | 修復 → 重跑          |
| `.md`     | 修復文檔問題   | `/codex-review-doc`  |
| `.md`     | review 失敗    | 修復 → 重跑          |

## 退出條件（僅限）

- ✅ All Pass
  - 程式碼變更：review + precommit 全過
  - 文檔變更：doc review 通過即可
- ⛔ Need Human — 架構變更、刪除功能、用戶喊停
- 🔄 3 輪同問題 — 報告卡點，請求介入

## 正確行為

```
"已修復 3 個問題，正在執行 /codex-review-fast..."
[執行]
"通過，正在執行 /precommit..."
[執行]
"全部通過 ✅"
```

## ⚠️ 行為錨定：同一回覆內執行

### 正確模式

```
[完成編輯] → 同一個回覆中調用審核工具 → 等待結果 → 報告
```

```
Claude: [Edit tool 完成]
        ↓
        "已更新，正在執行審核..."
        ↓
        [Skill tool: /codex-review-doc]  ← 同一回覆
        ↓
        "審核通過 ✅" 或 "發現問題，修復中..."
```

### 錯誤模式

```
[完成編輯] → 輸出摘要 → [停止] → 用戶追問 → 才執行審核
```

```
Claude: [Edit tool 完成]
        ↓
        "已更新需求單 ✅"
        ↓
        [輸出漂亮的表格摘要]
        ↓
        "下一步建議執行 /codex-review-doc"  ← ❌ 宣告當執行
        ↓
        [停止，等待用戶]  ← ❌ 違反規則
```

### 關鍵原則

| 原則            | 說明                                    |
| --------------- | --------------------------------------- |
| **宣告 ≠ 執行** | 說「需要執行」不等於已經執行            |
| **摘要 ≠ 完成** | 輸出總結後，審核流程仍在進行中          |
| **同回覆執行**  | Edit 完成後，同一回覆內必須調用審核工具 |
| **結果才停止**  | 只有看到審核結果（Pass/Fail）才能停止   |

## 強制執行機制

### 雙層防線

```
[Edit/Write] → [PostToolUse Hook] → [狀態檔更新]
                                          ↓
[Stop Hook] ← 讀取狀態檔 ← [審核命令執行]
```

| 層級        | 機制                    | 觸發時機       |
| ----------- | ----------------------- | -------------- |
| PostToolUse | 追蹤文件變更 + 審核結果 | Edit/Bash 執行 |
| Stop Hook   | 阻止未完成審核即停止    | 嘗試停止時     |

### 狀態檔 Schema

**檔案**：`.claude_review_state.json`（本地忽略）

```json
{
  "session_id": "abc123",
  "updated_at": "2026-01-26T10:00:00Z",
  "has_code_change": true,
  "has_doc_change": false,
  "code_review": {
    "executed": true,
    "passed": true,
    "last_run": "2026-01-26T10:00:00Z"
  },
  "doc_review": { "executed": false, "passed": false },
  "precommit": {
    "executed": true,
    "passed": true,
    "last_run": "2026-01-26T10:01:00Z"
  }
}
```

> **Note**: 上述為完整欄位示意，實際 hook 可能只更新部分欄位。

### Debug 與逃生口

| 環境變數        | 用途                | 使用場景 |
| --------------- | ------------------- | -------- |
| `HOOK_DEBUG=1`  | 輸出調試信息        | 排查問題 |
| `HOOK_BYPASS=1` | 跳過 Stop Hook 檢查 | 緊急情況 |

### 標準 Sentinel

審核命令必須輸出標準標記，供 Hook 解析：

- `## Gate: ✅` / `✅ All Pass` — 通過
- `## Gate: ⛔` / `⛔ Block` — 未通過
