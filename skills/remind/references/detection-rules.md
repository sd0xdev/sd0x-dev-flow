# Detection Rules

## Detection → Rule Mapping

Each detection heuristic maps to specific rule files and sections. When a violation is detected, the skill reads the mapped rule file and extracts the relevant section to quote inline.

**Where the conditions are read from.** The variables below are Step 1's reading of
`review-state.js check --format=json` (hook-lightweighting §3.2): per gate plane,
`{noted, dirty, digest_match, verdict, rounds, passed, owed}`. `HAS_CODE`/`HAS_DOC` are the
`dirty` flags, the verdicts are the `passed` flags — `passed` already binds the recorded verdict
to the current tree digest, so a stale note reads `false` by construction — and
`CODE_NOTED`/`DOC_NOTED` are the `noted` flags. SKILL.md § Smart Detection Mode Step 1 shows the
call and its git-only fallback. A malformed or partial answer (a plane missing, a field
non-boolean) is refused like no answer at all and the run degrades.

**Rows 1 and 2 stop being separable once the checker is unavailable.** The fallback asks git one
question — is anything uncommitted — and that single answer drives both change flags: classifying by
pathspec is relative to the working directory and by extension is a parser the fallback exists to
avoid. The verdicts and noted flags do not follow it at all; they have no source:

**Detection 4 sits outside this table's reasoning, and row 4 still can fire on either row below.**
That is because detection 4 reads `BRANCH`, not the checker and not the tree, so a dirty degraded run
on `main` fires it exactly as a clean one does. It names no correction Skill, so a run where it is the only detection reaches
the end with no invocation, and `skills/remind/SKILL.md` § Step 4 names the outcome that terminates it. The rows below are about **gate** rows only.

| Degraded run | Verdicts and noted flags | What can fire |
|--------------|--------------------------|---------------|
| Tree provably clean | All `false` | No **gate** row — no change flag, no verdict, no noted flag |
| Tree dirty or unverifiable | All `false` | Rows 1 and 2; **rows 3 and 5 cannot** — 3 triggers on `code_review.passed=true`, 5 on a noted flag, and the degraded path has neither |

**The state slot is never read directly, on any run.** A slot records *that* a gate was noted,
and only the checker's digest comparison says whether that note binds the *current* tree — a raw
slot read after an edit reports compliance over an owed review, and the slot's location is keyed
by a non-contractual hash this skill must not re-derive. When rows 1 and 2 both fire, report the
shared cause once rather than as two independent detections, and attribute nothing to state: no
state value was used.

| # | ID | Priority | Condition | Rule File | Section to Extract |
|---|-----|----------|-----------|-----------|-------------------|
| 1 | `code-no-review` | P0 | `HAS_CODE=true` + `CODE_REVIEW=false` | `rules/auto-loop.md` | "Terminal completion invariant" opening paragraph (incl. corollaries) |
| 2 | `doc-no-review` | P0 | `HAS_DOC=true` + `DOC_REVIEW=false` | `rules/auto-loop.md` | Terminal completion invariant paragraph — the `.md` gate is `/codex-review-doc` |
| 3 | `review-no-precommit` | P0 | `CODE_REVIEW=true` + `PRECOMMIT=false` | `rules/auto-loop.md` | "Gate sequence" paragraph in § Tiers (precommit Pass → Adequacy Gate → Doc Sync) |
| 4 | `main-branch` | P1 | `BRANCH` (Step 1's fenced `git rev-parse --abbrev-ref HEAD`) = `main` or `master` — a detached HEAD reads `HEAD` and matches neither | `rules/git-workflow.md` | Branch naming convention + protected branches |
| 5 | `dirty-never-noted` | P1 | (`HAS_CODE=true` + `CODE_NOTED=false`) or (`HAS_DOC=true` + `DOC_NOTED=false`) — **one aggregated finding** naming every such plane | `CLAUDE.md` | "Required Checks" table — the finding stays a single row however many planes it names |

**`state-drift` was retired, not renumbered around.** It read "state says changes but git clean",
and the stored flags that made "state says changes" computable were deleted. The change flags now
come from the checker's live tree digest or from git and therefore agree with the tree by
construction, so the condition has no evaluable form. `docs/features/remind/2-tech-spec.md`
§ Detection Rules records the same removal; `dirty-no-state` became `dirty-never-noted` when the
repo-local state file was replaced by the out-of-repo reminder slots (hook-lightweighting §3.1).

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
4. Cross-reference all extracted rules against Step 1's resolved variables — never the state slot
   directly, whose raw verdict is not bound to the tree that earned it
5. Output: compliance status per rule
6. Execute: invoke every owed correction Skill in the same reply — this mode terminates the way
   every other one does, under `skills/remind/SKILL.md` § Step 4, not at the report
```
