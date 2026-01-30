---
name: repo-intake
description: 專案初始化盤點與快取生成（one-time intake）。首次接手專案或結構大改時使用。
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*)
context: fork
agent: Explore
disable-model-invocation: true
---

# Repo Intake

## When to Use

- ✅ 首次接手專案
- ✅ 專案結構大改後重建快取
- ✅ 快取過期需更新

## When NOT to Use

- ❌ 已熟悉專案結構（直接讀快取）
- ❌ 只需查找特定文件（用 Glob/Grep）
- ❌ 日常開發（快取已存在）
- ❌ 

## Workflow

```
Docs → Entrypoints → Tests Map → Next Steps
```

## Usage

```bash
node skills/repo-intake/scripts/intake_cached.js --mode auto --top 10
```

## Cache Location

快取存放於：`~/.claude/cache/repo-intake/<repoKey>/`

| 檔案          | 說明                 |
| ------------- | -------------------- |
| `latest.md`   | 最新掃描結果         |
| `latest.json` | 最新掃描結果（JSON） |
| `LATEST.json` | 快取 metadata        |

## Verification

- 輸出包含 Overview, Entrypoints, Test Map, Next Steps
- Entrypoints 正確識別 `{CONFIG_FILE}`, `{BOOTSTRAP_FILE}`
- Test Map 涵蓋 Unit/Integration/E2E 三層

## Output Format

```markdown
## Overview

<summary>

## Entrypoints

- {CONFIG_FILE}
- {BOOTSTRAP_FILE}

## Test Map

| Type        | Pattern           |
| ----------- | ----------------- |
| Unit        | test/unit/        |
| Integration | test/integration/ |
| E2E         | test/e2e/         |

## Next Steps

- <questions>
```

## Examples

```
輸入：/midway-intake
動作：執行 intake script → 輸出專案地圖
```

```
輸入：/midway-intake save
動作：執行 intake script → 輸出並寫入 docs/ai/intake/
```
