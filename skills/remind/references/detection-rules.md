# Detection Rules

## Detection → Rule Mapping

Each detection heuristic maps to specific rule files and sections. When a violation is detected, the skill reads the mapped rule file and extracts the relevant section to quote inline.

| # | ID | Priority | Condition | Rule File | Section to Extract |
|---|-----|----------|-----------|-----------|-------------------|
| 1 | `code-no-review` | P0 | `has_code_change=true` + `code_review.passed=false` | `rules/auto-loop.md` | "Terminal completion invariant" opening paragraph (incl. corollaries) |
| 2 | `doc-no-review` | P0 | `has_doc_change=true` + `doc_review.passed=false` | `rules/auto-loop.md` | Terminal completion invariant paragraph — the `.md` gate is `/codex-review-doc` |
| 3 | `review-no-precommit` | P0 | `code_review.passed=true` + `precommit.passed=false` | `rules/auto-loop.md` | "Gate sequence" paragraph in § Tiers (precommit Pass → Adequacy Gate → Doc Sync) |
| 4 | `state-drift` | P0 | State says changes but `git status --porcelain` is empty | — | Suggest: reset `.claude_review_state.json` |
| 5 | `main-branch` | P1 | `git branch --show-current` = `main` or `master` | `rules/git-workflow.md` | Branch naming convention + protected branches |
| 6 | `dirty-no-state` | P1 | `git status --porcelain` has output + no state file | `CLAUDE.md` | "Required Checks" table |

## Extraction Patterns

When reading a rule file, extract specific sections using these grep patterns:

| Section | Pattern | Example |
|---------|---------|---------|
| Terminal completion invariant | Opening paragraph between the `#` title and the first `##` | auto-loop.md |
| Gate sequence | Lines starting `Gate sequence:` inside `## Tiers` | auto-loop.md |
| Required Checks | Lines between `## Required Checks` and next `##` | CLAUDE.md |
| Core Principles | Lines between `## Core Principle` and next `##` | Various rules |
| Branch naming | Lines containing `Branches:` or `feat/*` | git-workflow.md:3 |

## Rule File Discovery

For `/remind <rule>` mode, resolve rule name to file:

```
1. Try: rules/<input>.md
2. Try: rules/<input>-project.md
3. Fallback: Glob("rules/*.md") → list available rules
```

All `rules/*.md` files are valid targets — dynamic filesystem lookup, not hardcoded allowlist.

## `--all` Mode Rule Loading

```
1. Glob("rules/*.md") → get all rule files
2. For each file: Read → extract first ## section after frontmatter
3. Read CLAUDE.md → extract "Required Checks" + "Auto-Loop" sections
4. Cross-reference all extracted rules against state + git
5. Output: compliance status per rule
```
