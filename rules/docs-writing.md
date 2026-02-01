# Documentation Writing Rules

| Principle          | Description                                         |
| ------------------ | --------------------------------------------------- |
| Concise            | Use tables over paragraphs, diagrams over text      |
| Information-rich   | Preserve key information; don't over-simplify       |
| Research first     | Research existing implementations before pseudocode |

| Scenario           | Use                       | Avoid              |
| ------------------ | ------------------------- | ---------------    |
| Comparison/lists   | Tables                    | Long paragraphs    |
| Process flow       | Mermaid sequenceDiagram   | Plain text         |
| Architecture layers| ASCII diagram / flowchart | Nested lists       |
| Code examples      | Actual codebase snippets  | Made-up pseudocode |

Before adding pseudocode: grep for similar implementations -> read to confirm naming -> annotate reference source

## Locale-Aware Writing

When writing in a specific language, use that locale's natural conventions:

| Language | Convention |
| -------- | ---------- |
| zh-TW | 繁體中文、台灣慣用詞彙（例：「資料庫」非「数据库」、「程式」非「程序」） |
| zh-CN | 简体中文、大陆惯用词汇 |
| ja | 日本語の自然な表現、敬体（です・ます） |
| ko | 한국어 자연스러운 표현, 존댓말 |
| es | Español natural, tú/usted según contexto |
| en | American English by default |

- Do NOT mix locale conventions (e.g. 繁體中文 with 大陸用語)
- Technical terms may keep English where the locale commonly does (e.g. API, Git, CI/CD)
