---
name: de-ai-flavor
description: Remove AI-generated artifacts from documents, including tool names, boilerplate patterns, over-structuring.
allowed-tools: Read, Grep, Glob, Edit
---

# De-AI-Flavor Skill

## Trigger

- Keywords: 去 AI 味, 去除 AI 痕跡, 人性化文件, de-ai, humanize

## When NOT to Use

- CHANGELOG 中的 Co-Authored-By（Git 規範）
- 討論 AI 技術的文件（主題本身需要）
- 引用他人的 AI 相關內容
- 代碼中的變數/函數名

## Usage

```bash
/de-ai-flavor docs/xxx.md           # 處理指定文件
/de-ai-flavor docs/                 # 處理目錄下所有 .md
/de-ai-flavor                       # 處理 git diff 中的 .md
```

## Detection Rules

| 類型         | 模式                                        | 處理 |
| ------------ | ------------------------------------------- | ---- |
| 工具名稱     | Claude/Codex/GPT/AI 助手                    | 刪除 |
| 套論模式     | 「讓我來...」「首先...然後...」「綜上所述」 | 改寫 |
| 過度結構化   | 每段標題僅一句話、過多 #### 層級            | 簡化 |
| 客服式語氣   | 「希望這對你有幫助」「如有問題請...」       | 刪除 |
| 過度自我描述 | 「接下來我會...」「我將會...」              | 刪除 |
| 暴露迭代過程 | 「第一輪/第二輪/第 N 輪」                   | 改寫 |

## Workflow

```
掃描文件 → 標記 AI 痕跡 → 刪除/改寫/簡化 → 輸出摘要
```

## Verification

- 工具名稱全部移除
- 套論模式改為自然語氣
- 結構不過度扁平或巢狀

## Output Format

```markdown
## De-AI-Flavor 結果

**文件**: `docs/xxx.md`

| 行號 | 原文           | 修改            | 原因        |
| ---- | -------------- | --------------- | ----------- |
| 15   | 讓我來說明...  | 刪除            | AI 自我描述 |
| 32   | Claude 建議... | 改為「建議...」 | 工具名稱    |

**統計**: 移除 3 處工具名稱 | 改寫 5 處套論 | 簡化 2 處結構
```

## Examples

```
輸入：/de-ai-flavor docs/tech-spec.md
動作：掃描 → 移除「Claude 建議」→ 改寫「讓我來說明」→ 輸出摘要
```

```
輸入：這份文件感覺很 AI，幫我處理一下
動作：偵測 git diff → 標記 AI 痕跡 → 批量處理 → 輸出統計
```
