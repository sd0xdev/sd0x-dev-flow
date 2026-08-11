---
name: ask
description: "Context-aware Q&A with auto context gathering. Use when: user has a quick question about codebase, git history, rules, docs, or skills during development. Not for: code changes (use feature-dev), code review (use codex-review-fast), deep research (use deep-research), full code trace (use code-explore). Output: structured answer with source attribution."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*), Agent
---

# Ask — Context-Aware Q&A

## Trigger

- Keywords: ask, quick question, context question, project question, 問一下, 想了解, 想知道

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| Code modification or implementation | `/feature-dev` |
| Code review or PR review | `/codex-review-fast` |
| Tech spec review | `/review-spec` |
| Document review | `/codex-review-doc` |
| Bug fixing | `/bug-fix` |
| Next step decision | `/next-step` |
| Deep multi-source research | `/deep-research` |
| Systematic code tracing | `/code-explore` |

## Procedure

### Phase 0: Session Context Capture

Run these 4 commands in parallel to build session context:

| # | Action | Tool |
|---|--------|------|
| 1 | Current branch | `Bash("git branch --show-current")` |
| 2 | Feature detection | `Bash("node scripts/resolve-feature.js")` — the wrapper, not the CLI: it owns the failure payload, so a resolver that runs and fails — nonzero exit, signal, truncated write, off-contract payload — still yields the full shape with `scan_error: true` rather than `{}` or a truncated document. A missing `node` yields no JSON at all; treat that like any other unusable payload |
| 2b | `scan_error` gate | `scan_error !== false` ⇒ the source sets are **unknown, not empty** — report and take the ⚠️ Need Human exit rather than answering from an empty set. Gate on `!== false`, not `=== true`: a `{}` payload from a shell fallback has no such field, so a non-null `key` is not evidence the sets are complete |
| 3 | Changed files | `Bash("git status --porcelain")` |
| 4 | Recent commits | `Bash("git log --oneline -5")` |

**Untracked file fallback**: If feature resolver returns `key: null`, derive feature from changed/untracked paths:
1. Parse `git status --porcelain` output for `docs/features/<key>/` or `skills/<key>/` patterns
2. Extract `<key>` as candidate feature
3. Use this for `docs` intent feature-first lookup when resolver fails

### Phase 1: Intent Classification + Routing

#### 1a. Conversation Context Integration

Before classifying intent, review prior conversation turns for:

- **Active feature**: feature being developed, files recently discussed or edited
- **Ongoing task**: what skill was last invoked, what phase we are in
- **Implicit scope**: if the user asks "why?" after a code change, the scope is that change

Use this context to disambiguate the question and select the right intent. See `references/intent-patterns.md` for edge cases.

#### 1b. Intent Classification

Classify the question (LLM-inferred) into one or more intents:

| Intent | Signal Examples | Context Actions |
|--------|----------------|-----------------|
| `code` | "function X 做什麼", file paths, module names | Grep → Read → trace 1 level |
| `git` | "最近改了什麼", "誰改的", "when" | git log / diff / blame |
| `docs` | "需求是什麼", "spec 寫了什麼" | Feature resolve → source set by question kind → fallback Glob |
| `rules` | "規則是什麼", "convention", "allowed" | Read rules/ files |
| `skill` | "有沒有 skill", "怎麼用 /X" | Glob skills/ → Read SKILL.md |
| `arch` | "系統架構", "整體設計" | CLAUDE.md + Explore agent |
| `multi` | Multiple intents mixed | Combine actions from each intent |

#### 1c. Skill Routing Check

Before gathering context, check if the question is action-oriented. See `references/routing-table.md`.

If a better skill is identified, suggest it: "這個問題更適合 `/X`，要改用嗎？" — do not auto-redirect.

### Phase 2: Context Gathering

Execute per-intent tool call sequences. Hard limits apply.

**`code`**: Grep keywords (top 10 files) → Read most relevant (max 5) → trace imports (1 level)

**`git`**: `git log --oneline -20` → `git diff` (if recent changes) → `git blame` (if specific lines)

**`docs`**: Resolve feature → pick the source set the question actually asks for → fallback `Glob "docs/**/*.md"` (top 5) → Read (max 3)

| The question is… | Read | Not |
|------------------|------|-----|
| "現在的行為是什麼" | code, `rules/`, `current_authority` | A tech spec — it records the design, not what shipped |
| "當初為什麼這樣設計" | `design_records` | — |
| "當初要求什麼 / 這張單結了嗎" | `work_records` | — |
| "這個決定是什麼時候做的" | `history_records` | — |

Answering a current-behaviour question from a design record is the specific failure this split
exists to prevent: the spec is the older artifact, so it reads as authoritative and is wrong.
When a design record is the only source available, say which document the answer came from and
that it may predate the code.

**`rules`**: Glob `rules/*.md` + `.claude/rules/*.md` → Grep keywords → Read + quote (max 3)

**`skill`**: Glob `skills/*/SKILL.md` → Grep keywords (top 5) → Read (max 3)

**`arch`**: Read CLAUDE.md + key entrypoints → dispatch Explore agent

**`multi`**: Combine steps from each intent. Parallel execution. Hard limit: max 8 file reads total.

### Phase 3: Sub-Agent Dispatch (Optional)

| Complexity | Criteria | Strategy |
|------------|----------|----------|
| Simple | Single intent, clear target, < 5 files | Direct tools only (0 agents) |
| Medium | Multi-file, cross-module | 1 Explore agent |
| Complex | Multi-intent, cross-cutting | 2 agents parallel (hard max) |

Dispatch when: Grep returns > 10 files across modules, or question involves architecture / cross-cutting concerns. Default: direct tool calls.

### Phase 4: Answer Synthesis

Combine all gathered context into a structured answer. Follow the output format below.

## Read-Only Enforcement

This skill is strictly read-only. The following git commands are **prohibited**:

```
git add | git commit | git push | git pull | git reset | git stash
git rebase | git merge | git checkout -- | git restore | git clean
```

`allowed-tools` does not include Edit, Write, or NotebookEdit.

## Path Security

| Control | Rule |
|---------|------|
| Repo boundary | All Read/Glob within repo root (`git rev-parse --show-toplevel`) |
| Traversal rejection | Reject `..` path segments, absolute paths outside repo, symlinks out of repo |
| Secret skip | Do not read `.env`, `credentials.*`, `*secret*` files |
| Output redaction | High-confidence secret patterns → `[REDACTED]`; medium-confidence → mask with 4 chars visible |

## Output Format

```markdown
## Answer

{Direct, concise answer}

### Sources

| Type | Reference | Relevance |
|------|-----------|-----------|
| file | `path/file.js:42` | {why relevant} |
| commit | `abc1234 — message` | {why relevant} |
| command | `git log --oneline -5` | {result summary} |

### See Also

- `/code-explore` — for full trace
- {other relevant skill or doc}
```

Every claim must have at least one source evidence. Answer < 500 words unless user requests detail.

## Verification

- [ ] Session context captured (branch, feature, changed files)
- [ ] Intent classified and context gathered per pipeline
- [ ] Source attribution present for all claims
- [ ] No Edit/Write/mutating git commands executed
- [ ] No secrets in output

## References

- `references/intent-patterns.md` — Detailed intent examples and edge cases (read when classifying ambiguous questions)
- `references/routing-table.md` — Full skill routing decision table (read when checking if another skill is better)

## Examples

### Code Question

```
Input: /ask resolve-feature-cli.js 怎麼偵測 feature？
Phase 0: branch=feat/ask, feature=ask
Phase 1: Intent=code (file path mentioned)
Phase 2: Grep "resolve-feature" → Read scripts/lib/feature-resolver.js → trace exports
Phase 4: Answer with Sources (file evidence)
```

### Git Question

```
Input: /ask 最近有什麼 commit？
Phase 0: branch=feat/ask
Phase 1: Intent=git ("最近", "commit")
Phase 2: git log --oneline -20
Phase 4: Answer with Sources (commit + command evidence)
```

### Multi-Intent Question

```
Input: /ask auto-loop 的規則是什麼？有哪些 skill 會用到？
Phase 0: branch=feat/ask
Phase 1: Intent=multi (rules + skill)
Phase 2: Read rules/auto-loop.md + Grep "auto-loop" in skills/*/SKILL.md
Phase 4: Answer with Sources (file evidence from both rules and skills)
```
