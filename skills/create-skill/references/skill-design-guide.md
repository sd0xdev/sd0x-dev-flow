# Skill 設計準則

## 0. 先選對載體

| 載體      | 適用場景                       | 載入時機         |
| --------- | ------------------------------ | ---------------- |
| CLAUDE.md | 全域且穩定的規則               | 每次 session     |
| Skill     | 偶爾才需要的領域知識或工作流   | 按需（觸發才載） |
| Hook      | 每次必做、零例外的動作         | 每次工具執行     |
| Subagent  | 大量讀檔、不想污染主對話上下文 | fork 隔離        |

## 1. 核心設計原則

### 1.1 以「可被正確觸發」為第一優先

- 觸發靠 YAML frontmatter 的 `name` + `description`（session start 載入）
- 描述要寫清楚「做什麼、什麼情況用」
- 避免多個 Skill 的 description 高度重疊（會導致選錯/漏用）

### 1.2 「短、可組合、可驗證」

| 原則   | 說明                                       |
| ------ | ------------------------------------------ |
| 短     | SKILL.md 只放必要資訊，多餘移到 references |
| 可組合 | 大流程切小技能，用 `/skill` 串起來         |
| 可驗證 | 驗收方式寫進流程（測試、lint、輸出比對）   |

### 1.3 設定「自由度」

| 自由度 | 適用場景              | 範例                   |
| ------ | --------------------- | ---------------------- |
| 高     | 多解皆可（heuristic） | code style suggestions |
| 中     | 模板/參數化           | API endpoint template  |
| 低     | 固定命令/固定序列     | migration, deploy      |

**脆弱流程收斂，不脆弱放開。**

## 2. 檔案分層（Progressive Disclosure）

```
skills/{name}/
├── SKILL.md              # Level 2：觸發才載入
├── references/           # Level 3：需要才讀取
│   ├── api.md
│   ├── style.md
│   └── examples.md
└── scripts/              # Level 3：可執行腳本
    └── validate.sh
```

| Level | 內容               | 載入時機                |
| ----- | ------------------ | ----------------------- |
| 1     | metadata           | 永遠載入（frontmatter） |
| 2     | SKILL.md           | 觸發才載入              |
| 3     | references/scripts | 需要才讀取/執行         |

### 2.1 References 怎麼寫

- 當「索引式知識庫」，不要當第二份 SKILL.md
- 做成可被精準引用的小檔
- 在 SKILL.md 放「何時讀哪份 reference」的導覽

### 2.2 Scripts 怎麼寫

- 當「可重複、可確定、可測」的工具
- 適合：抽取/驗證/產檔/格式化/跑評估
- 定義 I/O 合約：
  - input：參數（可用 `$ARGUMENTS`）
  - output：stdout + 寫入檔案 + 錯誤碼
- 結果寫檔再讓 Claude 讀（省 context）

## 3. Frontmatter 欄位

| 欄位                       | 說明                     | 建議值           |
| -------------------------- | ------------------------ | ---------------- |
| `name`                     | 唯一識別名               | kebab-case       |
| `description`              | 觸發描述（含關鍵字）     | 清晰、不重疊     |
| `allowed-tools`            | 限制可用工具             | 最小必要         |
| `context`                  | fork（隔離）/ 無（共享） | 研究型用 fork    |
| `agent`                    | Explore / Plan 等        | 按需             |
| `disable-model-invocation` | 禁止模型自動觸發         | 危險操作設 true  |
| `user-invocable`           | 是否出現在 `/` 選單      | 背景知識設 false |

### 3.1 安全控制

**危險操作必須設 `disable-model-invocation: true`**：

- deploy
- commit
- 發外部訊息（Slack、Email）
- 修改 production 資料

## 4. SKILL.md 結構建議

```markdown
---
name: { name }
description: { 一句話，含觸發關鍵字 }
allowed-tools: { 最小必要 }
context: fork
---

# {Title} Skill

## Trigger

- Keywords: {觸發關鍵字}

## When NOT to Use

- {不適用場景}

## Workflow

{步驟化，含驗證}

## Contracts（若有 scripts）

| Script      | Input     | Output    |
| ----------- | --------- | --------- |
| validate.sh | file path | exit code |

## Examples

{2-5 個，含正反例}
```

## 5. 命名規範

| 規則         | 說明                   |
| ------------ | ---------------------- |
| 格式         | kebab-case             |
| 風格         | 動詞-ing（gerund）優先 |
| 字元限制     | 避免特殊字元           |
| 不與現有衝突 | 檢查 `/` 選單          |

## 6. 實作檢查表

- [ ] Description 一句話說清楚「做什麼 + 何時用 + 觸發關鍵字」
- [ ] SKILL.md ≤ 必要資訊；多餘背景移到 references
- [ ] 脆弱流程（deploy/migration）→ `disable-model-invocation: true`
- [ ] 機械步驟 → scripts；並在 SKILL.md 寫清 I/O 合約
- [ ] 硬規則 → hook，不靠純文字要求
- [ ] 明確驗收（測試/lint/指令）寫進步驟
- [ ] 測試多模型（Haiku/Sonnet/Opus）

## 7. 常見問題

| 問題           | 解法                                    |
| -------------- | --------------------------------------- |
| 觸發不準       | 檢查 description 是否清晰、不與他者重疊 |
| SKILL.md 太長  | 移動細節到 references                   |
| 模型自作主張   | 設 `disable-model-invocation: true`     |
| 流程不可重複   | 用 scripts 取代文字描述                 |
| 驗證失敗沒發現 | 加入 hook 或 scripts 自動檢查           |

## 8. 範例：好的 vs 壞的

### 好的 Description

```yaml
description: Create or refactor Claude Code skills. Guides skill design, file structure, and best practices.
```

- 說明做什麼（create/refactor skills）
- 說明產出（guides design, structure, practices）

### 壞的 Description

```yaml
description: Helps with skills
```

- 太模糊
- 沒有觸發關鍵字
- 不知道何時用
