---
description: 專案初始化盤點（one-time）。首次接手或結構大改時使用。
argument-hint: [save|nosave]
allowed-tools: Bash(git:*), Bash(node:*), Read, Write, Grep, Glob
skills: repo-intake
---

## Task

專案初始化盤點（一次性執行，後續讀快取）。

### 參數

```
$ARGUMENTS
```

| 參數   | 說明                                   |
| ------ | -------------------------------------- |
| `save` | 寫入 `docs/ai/intake/<date>-intake.md` |
| 無參數 | 只輸出不儲存                           |

### 執行流程

```bash
# Step 1: 檢查快取
CACHE_DIR=~/.claude/cache/repo-intake
if [ -f "$CACHE_DIR"/*/LATEST.json ]; then
  echo "ℹ️ 已有快取，將使用 auto 模式（有變更才重掃）"
fi

# Step 2: 執行掃描
node skills/repo-intake/scripts/intake_cached.js --mode auto --top 10

# Step 3: 如果有 save 參數，寫入 docs
# 輸出到 docs/ai/intake/$(date +%F)-intake.md
```

### 執行指引

遵循 skill 中的流程：

| 階段 | 參考文件                                    |
| ---- | ------------------------------------------- |
| 流程 | @skills/repo-intake/SKILL.md |

## When to Use

- ✅ 首次接手專案
- ✅ 專案結構大改後
- ✅ 快取過期需更新

## When NOT to Use

- ❌ 日常開發（快取已存在）
- ❌ 只需查找特定文件（用 Glob/Grep）

## Examples

```bash
# 首次盤點
/repo-intake

# 盤點並寫入 docs
/repo-intake save
```
