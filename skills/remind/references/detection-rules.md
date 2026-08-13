# Detection Rules

## Detection → Rule Mapping

Each detection heuristic maps to specific rule files and sections. When a violation is detected, the skill reads the mapped rule file and extracts the relevant section to quote inline.

**Where the conditions are read from.** The `has_*_change` / `*_passed` names below are the fields of
`scripts/lib/gate-derive.js --advisory`, **not** keys of `.claude_review_state.json`. The stored
`has_code_change` / `has_doc_change` fields were retired in WB5c and `session-init.sh` deletes them,
so reading the state file for a change flag reports "no change" on a dirty tree. The verdicts
(`code_review_passed` and friends) are the resolver's merge of the content-addressed log with the
advisory mirror — SKILL.md § Smart Detection Mode Step 1 shows the call and its git-only fallback.
That merge is the resolver's raw output, not what this consumer accepts: Step 1 takes the verdicts
only when the answer is a derived read (`treeState` is `ok` **and** `mirror_planes` is an empty
array). Any mirror-backed answer is refused like no answer at all and the run degrades.

**Rows 1 and 2 stop being separable once the resolver is unavailable.** The fallback asks git one
question — is anything uncommitted — and that single answer drives both change flags: classifying by
pathspec is relative to the working directory and by extension is a parser the fallback exists to
avoid. The verdicts do not follow it at all; they have no source:

**Detection 4 sits outside this table's reasoning, and row 4 still can fire on either row below.**
That is because detection 4 reads `BRANCH`, not the resolver and not the tree, so a dirty degraded run
on `main` fires it exactly as a clean one does. It names no correction Skill, so a run where it is the only detection reaches
the end with no invocation, and `skills/remind/SKILL.md` § Step 4 names the outcome that terminates it. The rows below are about **gate** rows only.

| Degraded run | The three verdicts | What can fire |
|--------------|--------------------|---------------|
| Tree provably clean | All `false` | No **gate** row — no change flag, no verdict, no `DIRTY` |
| Tree dirty or unverifiable | All `false` | Rows 1 and 2 (plus row 5 with no state file); **row 3 cannot**, its trigger being `code_review_passed=true` |

**The mirror is never read on a degraded run, clean tree included.** A mirror records *that* a gate
passed, never *which tree* passed it, and a clean `git status` does not supply the binding: it says
nothing is uncommitted right now, which an unrelated commit satisfies equally well, so a PASS earned
on commit A reads as current on a clean commit B. Deriving that binding is `gate-derive.js`'s job.
When rows 1 and 2 both fire, report the shared cause once rather than as two independent detections,
and attribute nothing to the mirror: no mirror value was used.

| # | ID | Priority | Condition | Rule File | Section to Extract |
|---|-----|----------|-----------|-----------|-------------------|
| 1 | `code-no-review` | P0 | `has_code_change=true` + `code_review_passed=false` | `rules/auto-loop.md` | "Terminal completion invariant" opening paragraph (incl. corollaries) |
| 2 | `doc-no-review` | P0 | `has_doc_change=true` + `doc_review_passed=false` | `rules/auto-loop.md` | Terminal completion invariant paragraph — the `.md` gate is `/codex-review-doc` |
| 3 | `review-no-precommit` | P0 | `code_review_passed=true` + `precommit_passed=false` | `rules/auto-loop.md` | "Gate sequence" paragraph in § Tiers (precommit Pass → Adequacy Gate → Doc Sync) |
| 4 | `main-branch` | P1 | `BRANCH` (Step 1's fenced `git rev-parse --abbrev-ref HEAD`) = `main` or `master` — a detached HEAD reads `HEAD` and matches neither | `rules/git-workflow.md` | Branch naming convention + protected branches |
| 5 | `dirty-no-state` | P1 | `DIRTY` non-empty + `STATE_FILE_EXISTS=false` | `CLAUDE.md` | "Required Checks" table |

**`state-drift` was retired, not renumbered around.** It read "state says changes but git clean",
and the stored flags that made "state says changes" computable were deleted in WB5c. The change
flags now come from the resolver or from git and therefore agree with the tree by construction, so
the condition has no evaluable form — and an unevaluable P0 row invites a reset of a valid state
file. `docs/features/remind/2-tech-spec.md` § Detection Rules records the same removal.

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
4. Cross-reference all extracted rules against Step 1's resolved variables — never the state file
   directly, whose verdicts are not bound to the tree that earned them
5. Output: compliance status per rule
6. Execute: invoke every owed correction Skill in the same reply — this mode terminates the way
   every other one does, under `skills/remind/SKILL.md` § Step 4, not at the report
```
