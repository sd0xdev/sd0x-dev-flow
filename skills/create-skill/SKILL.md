---
name: create-skill
description: Create or refactor Claude Code skills. Guides skill design, file structure, and best practices.
allowed-tools: Read, Grep, Glob, Write, Task
---

# Create/Refactor Skill

## Trigger

- Keywords: create skill, new skill, 建 skill, refactor skill, update skill, 重構 skill

## Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│         Phase 1: 確認目標                                        │
├─────────────────────────────────────────────────────────────────┤
│ 1. 新建 or 重構？                                                │
│ 2. Skill 名稱（kebab-case）                                      │
│ 3. 用途（一句話）                                                │
│ 4. 觸發關鍵字                                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 2: 選擇載體                                        │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────┬────────────────────────────────────────────┐    │
│ │ 載體        │ 適用場景                                   │    │
│ ├─────────────┼────────────────────────────────────────────┤    │
│ │ CLAUDE.md   │ 全域、每次都需要、穩定規則                 │    │
│ │ Skill       │ 按需載入、領域知識、工作流                 │    │
│ │ Hook        │ 每次必做、零例外（lint、禁止操作）         │    │
│ │ Subagent    │ 大量讀檔、隔離上下文                       │    │
│ └─────────────┴────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 3: 設計結構                                        │
├─────────────────────────────────────────────────────────────────┤
│ skills/{name}/                                          │
│ ├── SKILL.md              # 工作流（觸發載入）                   │
│ ├── references/           # 知識庫（需要才讀）                   │
│ │   └── *.md                                                    │
│ └── scripts/              # 可執行腳本（確定性操作）             │
│     └── *.sh                                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 4: 撰寫 SKILL.md                                   │
├─────────────────────────────────────────────────────────────────┤
│ 1. Frontmatter（name, description, allowed-tools, context）      │
│ 2. When to use / NOT to use                                     │
│ 3. Workflow（步驟化）                                            │
│ 4. 驗證方式                                                      │
│ 5. Examples（2-5 個）                                            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         Phase 5: 驗證                                            │
├─────────────────────────────────────────────────────────────────┤
│ 1. 觸發測試：用關鍵字能正確載入？                                │
│ 2. 流程測試：執行完整工作流                                      │
│ 3. 邊界測試：錯誤輸入處理                                        │
└─────────────────────────────────────────────────────────────────┘
```

## SKILL.md Template

```markdown
---
name: { kebab-case-name }
description: { 一句話說明用途與觸發時機 }
allowed-tools: Read, Grep, Glob, Write
context: fork
---

# {Title} Skill

## Trigger

- Keywords: {觸發關鍵字}

## When NOT to Use

- {不適用場景}

## Workflow

{步驟化流程，用 ASCII 或 Mermaid}

## Verification

{如何驗證成功}

## Examples

{2-5 個使用範例}
```

## Frontmatter 參考

| 欄位                       | 說明                       | 預設值  |
| -------------------------- | -------------------------- | ------- |
| `name`                     | 唯一識別名（kebab-case）   | 必填    |
| `description`              | 觸發描述（含關鍵字）       | 必填    |
| `allowed-tools`            | 限制可用工具               | 全部    |
| `context`                  | `fork`（隔離）/ 無（共享） | 共享    |
| `agent`                    | `Explore` / `Plan` 等      | 無      |
| `disable-model-invocation` | 禁止模型自動觸發           | `false` |
| `user-invocable`           | 是否出現在 `/` 選單        | `true`  |

## 設計檢查表

| 項目               | 檢查                                       |
| ------------------ | ------------------------------------------ |
| Description 清晰   | 一句話說清「做什麼 + 何時用」              |
| SKILL.md 精簡      | ≤ 必要資訊，多餘移到 references            |
| 脆弱流程有保護     | deploy/commit → `disable-model-invocation` |
| 機械步驟用 scripts | 並在 SKILL.md 寫清 I/O 合約                |
| 硬規則用 hook      | 不靠純文字要求                             |
| 有驗證方式         | 測試/lint/指令輸出                         |

## 重構模式

重構現有 skill 時：

1. **讀取現有 SKILL.md** - 理解當前結構
2. **識別問題** - 太長？觸發不準？缺驗證？
3. **套用準則** - 參考 `references/skill-design-guide.md`
4. **精簡內容** - 移動細節到 references
5. **測試觸發** - 確認關鍵字仍有效

## References

詳細設計準則見：[skill-design-guide.md](./references/skill-design-guide.md)

## Related Skills

| Skill         | Purpose        |
| ------------- | -------------- |
| `doc-review`  | 審核文件       |
| `tech-spec`   | 技術方案       |
| `feature-dev` | 功能開發工作流 |
