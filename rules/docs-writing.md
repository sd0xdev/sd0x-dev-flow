# Documentation Writing Rules

| Principle          | Description                                         |
| ------------------ | --------------------------------------------------- |
| Concise            | Use tables over paragraphs, diagrams over text      |
| Information-rich   | Preserve key information; don't over-simplify       |
| Research first     | Research existing implementations before pseudocode |
| Bounded            | **Feature docs under `docs/features/` only**: past ~500 lines act — the model judges each file (a coherent long doc may stand, with the reason stated). The target is bloat in tech specs / requirements docs, and the remedies are ordered: **prune what is dead, merge what is duplicated, split what remains**. Splitting alone can only grow the corpus. Live information is moved, never deleted; records are exempt. **Functional documents are exempt** — `skills/**`, `agents/`, `commands/`, `rules/`, templates and fixtures are instruction surfaces, not prose, and have no line budget. See @rules/docs-numbering.md § Size Limit |

| Scenario           | Use                       | Avoid              |
| ------------------ | ------------------------- | ---------------    |
| Comparison/lists   | Tables                    | Long paragraphs    |
| Process flow       | Mermaid sequenceDiagram   | Plain text         |
| Architecture layers| ASCII diagram / flowchart | Nested lists       |
| Code examples      | Actual codebase snippets  | Made-up pseudocode |

Before adding pseudocode: grep for similar implementations -> read to confirm naming -> annotate reference source

## Code Comments

A comment answers the **local what/why**. Extended argumentation, historical archaeology, and cross-file protocol descriptions belong in docs, referenced by a pointer — that content loads on every read of the file but is needed only for the rare change, and it drifts from the doc version it duplicates.

The unit counted is the **logical block, not the contiguous run**: a blank line
between two comment lines *bridges* them into one block. Otherwise the cheapest
way under the threshold is a blank line every 29 lines, which changes the block's
shape and nothing about what the reader loads. Only a non-comment, non-blank line
closes a block.

| Comment lines in one logical block | Action |
|------------------------------------|--------|
| ≥ 30 | **Migrate now** — move unique content to the owning feature doc (or delete if the doc already has it), leave a pointer |
| 25–29 | Warning — migrate at the next substantive edit |
| < 25 | Fine |

Pointer format — one or two lines, naming the doc **section**, not just the file:

```bash
# Sidecar ownership, set semantics, and serialization: see
# docs/features/auto-loop-evolution/4-implementation.md §3.1, §3.6, §3.7.
```

Migration is **move or de-duplicate, never plain deletion** — no net information loss.

Exempt — exactly what the checker recognizes, no more: a block whose **first line** matches `SPDX-License-Identifier`, `Copyright (c)/©/<year>`, `eslint-disable`, or `shellcheck disable`; and any file under a directory named `node_modules`/`.claude`/`dist`/`vendor` (any depth).

The exemption covers the **contiguous run the directive heads**, not everything a blank line bridges into it. Otherwise the two rules cancel: one `# SPDX-License-Identifier` line, one blank, then 60 lines of rationale would be a single exempt block, and the header would launder arbitrary explanation at the cost of a blank line. The remainder below the bridge is measured on its own and reported at its own first line — so an exempt header followed directly by its licence text stays exempt, which is the case the exemption was written for. Other directive forms (`@ts-nocheck`, `prettier-ignore`, …) and generated files outside those directory names are **not** auto-exempt — extend `EXEMPT_FIRST_LINE`/`EXEMPT_DIR_NAMES` in the checker (with a test) before relying on a new form.

Mechanical check: `node scripts/check-comment-blocks.js` (threshold 30 blocking / 25 warning, recursive over `hooks/ scripts/ skills/`). Comment syntax is resolved per language — `.sh` counts only `#`, so a shell `case "$1" in /*)` is not read as a C block-comment opener. Wired into `/precommit` as the `comment_blocks` step, which runs first (static and cheap) and **skips rather than fails** unless the repo checked the checker into its own `scripts/` — which also settles the scan dirs, since finding it there proves `scripts/` exists. The installed copy at `.claude/scripts/` deliberately does **not** count: `/install-scripts` puts it there in consuming projects, and the checker scans the *repo's* top-level `hooks/ scripts/ skills/`, so honouring it would judge someone else's code by this plugin's 30-line convention and could fail their precommit. Vendoring the checker into your own `scripts/` is how a project opts in.

## Durable References

Maintained docs and comments identify material by **semantic anchors**, not exact line numbers:
a repository-relative path plus a heading (`rules/docs-writing.md` § Code Comments), a symbol
or function name, a named test case, or a flag/config key. Exact line numbers drift with every edit above
them, and each stale pointer becomes a review finding, a fix, and another round.

| Form | Verdict |
|------|---------|
| `scripts/lib/utils.js:142` as the sole locator in a maintained doc | ❌ Rewrite as path + anchor |
| `scripts/lib/utils.js` — the `stripAnsi` function (around line 141) | ✅ Anchor first, number as approximate hint |
| `scripts/lib/utils.js:142` inside a review finding, request ticket, ADR or review log | ✅ Exempt — point-in-time evidence in a record |

Exact `file:line` remains correct in **records and evidence**: review findings, diagnostics,
generated reports, scope proofs, and point-in-time records (requests, ADRs, review logs) —
rewriting those to match today's code would destroy the record. A numeric hint in a maintained
doc is explicitly approximate ("around line N") and always paired with a semantic anchor —
never the sole locator. Existing references convert on substantive edit or via a declared
`/refactor --mode reference-stability` pass — never a mass rewrite.

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
