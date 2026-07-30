# Documentation Writing Rules

| Principle          | Description                                         |
| ------------------ | --------------------------------------------------- |
| Concise            | Use tables over paragraphs, diagrams over text      |
| Information-rich   | Preserve key information; don't over-simplify       |
| Research first     | Research existing implementations before pseudocode |
| Bounded            | Over 500 lines → split into a numbered subfolder. See @rules/docs-numbering.md § Size Limit |

| Scenario           | Use                       | Avoid              |
| ------------------ | ------------------------- | ---------------    |
| Comparison/lists   | Tables                    | Long paragraphs    |
| Process flow       | Mermaid sequenceDiagram   | Plain text         |
| Architecture layers| ASCII diagram / flowchart | Nested lists       |
| Code examples      | Actual codebase snippets  | Made-up pseudocode |

Before adding pseudocode: grep for similar implementations -> read to confirm naming -> annotate reference source

## Code Comments

A comment answers the **local what/why**. Extended argumentation, historical archaeology, and cross-file protocol descriptions belong in docs, referenced by a pointer — that content loads on every read of the file but is needed only for the rare change, and it drifts from the doc version it duplicates.

| Contiguous comment lines | Action |
|--------------------------|--------|
| ≥ 30 | **Migrate now** — move unique content to the owning feature doc (or delete if the doc already has it), leave a pointer |
| 25–29 | Warning — migrate at the next substantive edit |
| < 25 | Fine |

Pointer format — one or two lines, naming the doc **section**, not just the file:

```bash
# Sidecar ownership, set semantics, and serialization: see
# docs/features/auto-loop-evolution/4-implementation.md §3.1, §3.6, §3.7.
```

Migration is **move or de-duplicate, never plain deletion** — no net information loss.

Exempt — exactly what the checker recognizes, no more: a block whose **first line** matches `SPDX-License-Identifier`, `Copyright (c)/©/<year>`, `eslint-disable`, or `shellcheck disable`; and any file under a directory named `node_modules`/`.claude`/`dist`/`vendor` (any depth). Other directive forms (`@ts-nocheck`, `prettier-ignore`, …) and generated files outside those directory names are **not** auto-exempt — extend `EXEMPT_FIRST_LINE`/`EXEMPT_DIR_NAMES` in the checker (with a test) before relying on a new form.

Mechanical check: `node scripts/check-comment-blocks.js` (threshold 30 blocking / 25 warning, recursive over `hooks/ scripts/ skills/`). Not wired into precommit yet — run standalone.

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
