---
name: remind
description: "Lightweight model correction with context-aware rule loading. Use when: model forgot a rule, skipped a required step, edited code/docs without running review, needs to re-read CLAUDE.md or rules. Triggers on: 'you forgot', 'remind', 'check rules', 'what did you miss', '你忘了', 'did you skip review', 'why didn't you run precommit', or /remind. Also use PROACTIVELY after editing files if unsure whether auto-loop was followed — the detection prelude is cheap and catches drift early — the corrections it then runs cost what those reviews cost. Not for: full code review (use codex-review-fast), next step advice (use next-step), workflow progression (use feature-dev)."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(cat:*), Bash(jq:*), Bash(bash:*), Bash(node:*), Skill
---

# Remind — Lightweight Model Correction

Detect what rules or steps the model forgot, auto-load the relevant rule files, and **execute the correction immediately**. Think of this as a "conscience check" that reads the actual rules rather than relying on memory.

## ⚠️ CRITICAL: Execute, Don't Report

`/remind` is an **executor**, not a reporter. After detecting a violation:

1. Output the findings table (for traceability)
2. **Invoke the correction command via Skill tool in the same reply** — e.g., `Skill: /codex-review-doc`
3. Do NOT stop after outputting findings

| Prohibited | Correct |
|-----------|---------|
| ❌ "要執行 /codex-review-doc 嗎？" | ✅ Output findings → immediately invoke `/codex-review-doc` |
| ❌ Output table then stop | ✅ Output table → invoke correction Skill → report result |
| ❌ "建議執行..." / "Next step: run..." | ✅ Execute the correction, don't suggest it |
| ❌ Ask user for permission | ✅ Auto-loop rules mandate execution without permission |

**There are exactly three exceptions, and § Step 4 defines them.** They are not enumerated here:
this file already learned that a second copy of the lifecycle diverges from the first within a
round, so the copies were removed rather than kept in sync. What belongs here is the part § Step 4
does not carry — every executable owed correction is invoked, and "owed" is plural: two findings
means two invocations.

## Trigger

- Keywords: remind, forgot, check rules, what did I miss, you forgot to, re-read rules, drift, correction
- User suspects model skipped a required step or ignored a rule
- User explicitly says "你忘了做什麼" or similar

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| Full code review | `/codex-review-fast` |
| What to do next | `/next-step` |
| Workflow progression | `/feature-dev` |
| Adversarial debate | `/codex-brainstorm` |

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Smart detect** | `/remind` (no args) | Checker, else fenced git → detect violations → auto-load relevant rules |
| **Specific rule** | `/remind auto-loop` | Read `rules/auto-loop.md` → summarize + check violations |
| **Nuclear** | `/remind --all` | Read CLAUDE.md + ALL rules → full compliance report |

## Smart Detection Mode

When invoked without arguments, run detection heuristics then **dynamically load the relevant rules** for each finding.

### Step 1: Read State + Git

```bash
# Every git read in this step goes through one fence: the WHOLE `GIT_*` namespace
# unset in a subshell (the fence `scripts/lib/tree-digest.js` uses), and `-C "$PWD"`
# pinning the tree answered about. A named-variable list leaves
# `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG*` and friends able to redirect or blind
# the read — and a blinded read looks exactly like a clean repository.
#
# Enumeration goes through `env`, NOT through `${!GIT_*}`. That expansion is a bash
# extension: zsh answers `bad substitution` and the whole fence returns nothing, so
# every read below fails at once — `TREE` captures the error text through its `2>&1`
# and a provably clean tree reports dirty, `BRANCH` empties and detection 4 can never
# fire. Measured under zsh 5.9, the shell the session pastes this block into. `env`
# costs a fork and is read the same way by bash, zsh and sh. `sed` anchors at `^GIT_`,
# so a value carrying an embedded newline can only ever synthesize another GIT_* name
# — never `PATH` — and unsetting a surplus GIT_* name is on the safe side of a fence
# whose whole purpose is unsetting them.
#
# The loop is not decoration, and neither is its shape. `unset $vars` would be wrong
# twice over: zsh does not word-split an unquoted `$var`, so several names would arrive
# as one, and on a GIT_*-free environment `unset` would be called with no operands at
# all — which bash accepts silently and zsh rejects with `unset: not enough arguments`,
# straight into `TREE` through its `2>&1`. Iterating a command substitution (which both
# shells DO split) runs zero times on the empty case and passes one quoted name at a
# time otherwise.
_remind_git() ( for v in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$v"; done; git -C "$PWD" "$@" )

# Anchor every path at the repository root. /remind is invoked from wherever the
# session happens to be, and a cwd-relative checker path turns an answerable run
# in `packages/app/` into a degraded one that reports both planes owed — over a
# root whose checker would have answered.
ROOT=$(_remind_git rev-parse --show-toplevel 2>/dev/null) || ROOT=""
[ -n "$ROOT" ] || ROOT="$PWD"

# The tree is asked ONE question, ONCE, and every answer below reads this result:
# is anything in it uncommitted. Two probes can disagree — a concurrent editor, a
# build writing into the tree, a wrapper answering differently the second time — and
# a step that classifies from one probe while reporting `DIRTY` from another accepts
# stale verdicts over a tree that moved between the two reads (reproduced with a git
# shim, round 17). stderr is folded in and a failed probe is not an empty one: a
# warning (an omitted directory, an unreadable submodule) or a nonzero exit means the
# tree is unverifiable, and unverifiable is owed. `--ignore-submodules=none` because
# a submodule carrying `submodule.<name>.ignore=all` otherwise suppresses its own
# superproject record, and empty-with-exit-0 is exactly the answer read as clean
# (`scripts/lib/tree-digest.js` handles the same case for the same reason).
if TREE=$(_remind_git status --porcelain=v1 -uall --ignore-submodules=none 2>&1) && [ -z "$TREE" ]; then
  TREE_CLEAN=true; DIRTY=""
else
  TREE_CLEAN=false; DIRTY="${TREE:-unverifiable}"
fi
unset TREE

# The reminder-state checker (hook-lightweighting §3.2): one computation of
# {noted, dirty, digest_match, verdict, rounds, passed, owed} per gate plane,
# derived from the live tree digest — `passed` already binds the recorded
# verdict to the current content, so no separate provenance check is needed.
# Installed copy first — the installer puts scripts under `.claude/scripts/`.
CHECKER="$ROOT/.claude/scripts/review-state.js"; [ -f "$CHECKER" ] || CHECKER="$ROOT/scripts/review-state.js"
ADV=""
if [ -f "$CHECKER" ] && command -v node >/dev/null 2>&1; then
  # Bounded *when a bounding tool exists*: the digest hashes dirty and untracked
  # content, which is unbounded on a pathological tree, and /remind runs
  # interactively. A kill lands in the fallback below. With none of
  # timeout/gtimeout/perl present the last branch runs node unbounded — the
  # ladder has no pure-shell rung. The `git status` probe above is unbounded for
  # the same reason.
  T="${AUTO_LOOP_DERIVE_TIMEOUT:-10}"; case "$T" in '' | *[!0-9]*) T=10 ;; esac
  [ "$T" -gt 0 ] 2>/dev/null || T=10
  if command -v timeout >/dev/null 2>&1; then
    ADV=$(cd "$ROOT" && timeout "$T" node "$CHECKER" check --format=json 2>/dev/null) || ADV=""
  elif command -v gtimeout >/dev/null 2>&1; then
    ADV=$(cd "$ROOT" && gtimeout "$T" node "$CHECKER" check --format=json 2>/dev/null) || ADV=""
  elif command -v perl >/dev/null 2>&1; then
    ADV=$(cd "$ROOT" && perl -e 'alarm shift; exec @ARGV or exit 127' "$T" node "$CHECKER" check --format=json 2>/dev/null) || ADV=""
  else
    ADV=$(cd "$ROOT" && node "$CHECKER" check --format=json 2>/dev/null) || ADV=""
  fi
fi

ADV_OK=false
if [ -n "$ADV" ]; then
  # `|| true`: a nonempty but malformed answer makes jq exit nonzero, and a failed
  # command substitution in an assignment aborts a caller that set -e — before the
  # fallback below could run. An empty value is the rejection this step wants anyway.
  _remind_bool() { echo "$ADV" | jq -r --arg p "$1" --arg k "$2" '.[$p][$k] | if type == "boolean" then tostring else "" end' 2>/dev/null || true; }
  HAS_CODE=$(_remind_bool code_review dirty); HAS_DOC=$(_remind_bool doc_review dirty)
  CODE_REVIEW=$(_remind_bool code_review passed); DOC_REVIEW=$(_remind_bool doc_review passed)
  PRECOMMIT=$(_remind_bool precommit passed)
  CODE_NOTED=$(_remind_bool code_review noted); DOC_NOTED=$(_remind_bool doc_review noted)
  # All seven or none — a partially parsed answer must not mix two policies. A
  # checker run outside a repository, or against a malformed state slot, either
  # exits nonzero (ADV empty) or yields non-boolean fields rejected here.
  if [ -n "$HAS_CODE" ] && [ -n "$HAS_DOC" ] && [ -n "$CODE_REVIEW" ] && [ -n "$DOC_REVIEW" ] && [ -n "$PRECOMMIT" ] && [ -n "$CODE_NOTED" ] && [ -n "$DOC_NOTED" ]; then
    ADV_OK=true
  fi
fi

if [ "$ADV_OK" != "true" ]; then
  # Checker unavailable, so the ONE tree answer taken above is all there is, and it
  # opens both planes or neither. It deliberately does NOT classify: only the
  # checker does that, by full-path suffix over the whole repository.
  # Per-plane pathspec probes were tried and removed, because an ordinary pathspec is
  # relative to the CWD: run from `sub/`, `-- '*.md'` cannot see a dirty `guide.md` at
  # the root while a negative-only probe still reports it, so a doc-only change reads
  # as code-only (measured, git 2.51). Fixing that needs `:(top,glob)` magic on every
  # pattern, and even then the stderr rule stays per-probe. A degraded path that
  # guesses wrong hides a gate; one that over-reminds costs a redundant review
  # dispatch, since this skill executes its corrections rather than printing them —
  # real tokens, but never a hidden obligation.
  if [ "$TREE_CLEAN" = "true" ]; then
    HAS_CODE=false; HAS_DOC=false
  else
    HAS_CODE=true; HAS_DOC=true
  fi
  # No verdict without the checker — not even on a clean tree. The state slot lives
  # outside the repo keyed by a non-contractual hash, so this step cannot read it
  # directly, and `git status` cannot supply the digest binding: "clean" says
  # nothing is uncommitted *now*, which is equally true one checkout later, so a
  # PASS earned on commit A would read as current on an unrelated, equally clean
  # commit B. The degraded run answers the change question from git and leaves
  # every verdict `false`, and the noted flags with them.
  #
  # What that costs, stated plainly: detections 3 and 5 cannot fire on a degraded
  # run — 3 triggers on a verdict and 5 on a noted flag, and this path has neither.
  # Detections 1 and 2 still work off the tree. The trade is deliberate — a missed
  # nudge, rather than a stale PASS closing the current gate.
  CODE_REVIEW=false; DOC_REVIEW=false; PRECOMMIT=false
  CODE_NOTED=false; DOC_NOTED=false
fi

# Branch — same fence, so a redirected environment cannot report a feature branch as
# `main`. A different question from the tree probe above, hence a separate read;
# `DIRTY` is NOT re-read here, because a second tree answer is what round 17 killed.
# The `|| VAR=""` is not decoration: under a caller's `set -e` a failed command
# substitution in an assignment aborts the shell, and this step would then exit
# before its own cleanup line.
BRANCH=$(_remind_git rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""

unset -f _remind_git _remind_bool 2>/dev/null || true
```

### Step 2: Detection → Rule Mapping

For each detected issue, **Read the mapped rule file** and extract the key section:

| # | Detection | Condition | Rule to Load | Section to Extract |
|---|-----------|-----------|-------------|-------------------|
| 1 | Code changed, no review | `HAS_CODE=true` + `CODE_REVIEW=false` | `rules/auto-loop.md` | "Terminal completion invariant" opening paragraph (incl. corollaries) |
| 2 | Doc changed, no review | `HAS_DOC=true` + `DOC_REVIEW=false` | `rules/auto-loop.md` | Terminal completion invariant paragraph — the `.md` gate is `/codex-review-doc` |
| 3 | Review passed, no precommit | `CODE_REVIEW=true` + `PRECOMMIT=false` | `rules/auto-loop.md` | "Gate sequence" paragraph in § Tiers |
| 4 | On main branch | `BRANCH` is `main` or `master` | `rules/git-workflow.md` | Branch naming + protected branches |
| 5 | Dirty plane, never noted | (`HAS_CODE=true` + `CODE_NOTED=false`) or (`HAS_DOC=true` + `DOC_NOTED=false`) | `CLAUDE.md` | "Required Checks" table — **fires once, aggregated**: name every never-noted dirty plane in one finding, not one row per plane |

Without the checker (`ADV_OK=false`) the step does not classify, so `HAS_CODE` and `HAS_DOC` move
together, and **no verdict and no noted flag are available at all** — the state slot is never read
directly on any degraded run, however clean the tree looks (see Step 1's comment: clean means
"nothing uncommitted now", which an unrelated commit satisfies just as well). What remains:

| Degraded run | Verdicts | What fires |
|--------------|----------|-----------|
| Tree provably clean | All three `false` — no source for them | No **gate** row: rows 1 and 2 need a change flag, row 3 needs `CODE_REVIEW=true`, row 5 needs a noted flag this path does not have. Row 4 is unaffected — it reads `BRANCH`, not the checker, so a degraded clean run on `main` still reports it, and the run still terminates under § Step 4 |
| Tree dirty or unverifiable | All three `false` — no source for them | Rows 1 and 2 both fire. Rows 3 and 5 cannot: 3 triggers on `CODE_REVIEW=true`, 5 on a noted flag, and the degraded path has neither |

So on a degraded dirty tree rows 1 and 2 are never separable — one shared cause, stated once
("checker unavailable, so both planes are reported as changed and no verdict is trusted"), not two
independent detections. Never disclose `source=state` on a degraded run, and never dispatch
`/precommit` from row 3 there: no state was read, and row 3 cannot have fired.

### Step 3: Output with Rule Context

For each finding, quote the relevant rule text inline so the model re-ingests the rule:

```markdown
## Reminder

### Findings

| # | Priority | Rule | Issue | Correction |
|---|----------|------|-------|------------|
| 1 | P0 | auto-loop | Code changed but review not passed | `/codex-review-fast` |

### Rule Context (auto-loaded)

> **auto-loop.md — Terminal completion invariant**: work on a change may be declared complete
> only when every gate its change class requires has passed after the last edit in that
> gate's change class.
> - ❌ Declaring ≠ Executing: naming a gate is not running it
> - ❌ Summary ≠ Completion: a report does not close an open gate
>
> **Required action**: Execute `/codex-review-fast` in this reply, do not stop.

### Corrections (copy-pasteable)
1. `/codex-review-fast`
```

### Step 4: Execute the correction — in the same reply

The output above is the traceability record, not the deliverable. Immediately after printing it,
invoke the correction through the Skill tool (`Skill: /codex-review-fast`) and report what it
returned. A findings table followed by a stop is the exact failure this skill exists to correct —
see § Execution Contract, which this step is the operational half of.

**Every owed correction, not the first one.** Two rows can fire at once — a degraded dirty tree owes
both `/codex-review-fast` and `/codex-review-doc` — and stopping after one leaves the other plane
open, which is the same defect in a smaller shape. Run them one at a time and **re-read Step 1 after
each**: a review that edits files moves the tree, so the remaining plan computed before it may no
longer be the right one.

**Detection 4 is advisory and has no correction Skill.** Being on `main` is corrected by creating a
branch, and `@rules/git-workflow.md` does not authorize this skill to run `git checkout`/`switch` —
nor is there a branch name to choose. State the finding and the command the human can run; that is
the whole of it. If detection 4 is the *only* finding, this step ends without an invocation.

**A degraded run terminates too, and not by claiming All Clear.** Without the checker there is no
verdict, so re-reading Step 1 after a correction returns the *same* rows it returned before —
`/codex-review-fast` cannot make `CODE_REVIEW` true when nothing can read a verdict. **Degradation
dominates the terminal status**: whenever `ADV_OK` is false the reply ends at `### Degraded ⚠️`,
whether or not detection 4 also fired and whether or not a correction ran. Two rules keep that from
becoming a loop or a false clearance:

| Degraded run | What terminates it |
|--------------|--------------------|
| An executable correction fired | Invoke **each distinct correction at most once**. When the re-read returns rows already corrected in this reply and the checker is still unavailable, stop and report `### Degraded ⚠️` — the corrections ran, closure is unverifiable until the checker answers |
| No executable correction fired | Report `### Degraded ⚠️` as well, naming the checker as the missing input. **Not `### All Clear ✅`**, and **not the lone-detection-4 exception either**: detection 4 fires on a degraded clean run on `main` and names no Skill, so that run reaches the end with no invocation and must still not claim a clearance nothing verified |

So the complete list of outcomes that end this step without an invocation is **three**:
`### All Clear ✅` (the checker answered and nothing is owed), a lone detection 4 on a run the
checker answered, and `### Degraded ⚠️` where no executable correction fired. A degraded run that
*did* invoke corrections ends at `### Degraded ⚠️` too — that one is a termination, not an
exception.

## Specific Rule Mode (`/remind <rule>`)

When user provides a rule name:

1. **Resolve**: `rules/<rule>.md` → if not found, try `rules/<rule>-project.md` → if not found, list available via `Glob("rules/*.md")`
2. **Read**: Read the full rule file
3. **Summarize**: Extract core principles, prohibited behaviors, required actions
4. **Check**: run Step 1 and use the variables it resolved. **Not the state slot directly** — the
   checker's `passed` is what binds the stored verdict to the current tree digest; a raw slot read
   after a subsequent edit reports compliance over an owed review. Where the checker cannot answer,
   Step 1 says so
5. **Output**: rule summary + current violation status + correction commands, then Step 4 —
   the execution contract applies to this mode too

## Nuclear Mode (`/remind --all`)

When the model keeps drifting despite specific reminders:

1. **Read `CLAUDE.md`**: Extract `## Required Checks` table + `## Auto-Loop` section
2. **Read all rules**: `Glob("rules/*.md")` → Read each file
3. **For each rule**: Extract prohibited behaviors / core principles
4. **Cross-reference**: Step 1's resolved variables against all rules — same reason as above, the
   state slot is not a second source of truth
5. **Output**: full compliance report with every rule's status, then Step 4

This is the "nuclear option" — high token cost but guarantees the model re-ingests all project rules. Use when repeated `/remind` calls haven't fixed the drift.

## Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `<rule>` | — | Specific rule name (e.g., `auto-loop`, `git-workflow`) |
| `--all` | false | Load ALL rules + CLAUDE.md (nuclear mode) |
| (no args) | — | Smart detection with context-aware rule loading |

## Graceful Degradation

| Failure | Behavior |
|---------|----------|
| jq unavailable | The checker's answer cannot be parsed, so the run degrades to the rows below — fail-closed, never silently clean |
| Checker unavailable, tree provably clean | Change flags read `false`, verdicts and noted flags read `false` (the state slot is never read directly — a clean tree does not bind a stored verdict to itself), so no gate row fires; detection 4 still can, reading `BRANCH`. The run terminates under § Step 4, which refuses a clearance for a run that verified nothing |
| Checker answered with a malformed or partial object (a plane missing, a field non-boolean) | Rejected exactly like no answer at all — all seven fields or none. The rows below apply |
| Checker unavailable, tree dirty or unverifiable | **Both** planes open; verdicts and noted flags all read `false`. Rows 1 and 2 fire; **rows 3 and 5 cannot** — 3 triggers on `CODE_REVIEW=true` and 5 on a noted flag, and the degraded path has neither. Disclose the shared cause once |
| State slot missing | Not a degradation: the checker answers `noted:false` for that plane, which is exactly detection 5's input — a dirty plane that was never noted |
| Rule file not found | List available rules via `Glob("rules/*.md")` |

## Execution Contract (reinforces top-level CRITICAL section)

The reminder output isn't just informational — it's a **correction directive with mandatory execution**:

1. **Invoke the correction Skill for every executable owed finding, immediately** in the same reply — do not ask for permission, do not output a summary and stop. Two findings means two invocations, Step 1 re-read between them. Which runs end without an invocation, and how a degraded run terminates, are § Step 4's to state — there are three exceptions and this list is not a fourth copy of them
2. **Re-read the quoted rule text** — it was loaded from the actual rule file specifically because the model drifted from it
3. **Do not dismiss findings** with "I already did that" unless you can point to the specific tool invocation in this conversation
4. If findings say "run `/codex-review-fast`" — invoke `Skill: /codex-review-fast` now, not later

The whole point of `/remind` is that the model's memory of rules has drifted. The quoted rule text is the source of truth, not the model's recollection of what the rules say.

**Correct flow**:

```
/remind → detect doc-no-review → output findings table → invoke Skill(/codex-review-doc) → report result
/remind → detect code-no-review → output findings table → invoke Skill(/codex-review-fast) → report result
/remind → nothing to invoke → the outcome that terminates the run is § Step 4's to name
```

## Examples

```
Input: /remind
Output: Smart detection finds code changed without review → loads auto-loop.md → quotes the terminal completion invariant → prints the findings table → **invokes `Skill: /codex-review-fast`** and reports its verdict

Input: /remind auto-loop
Output: Reads rules/auto-loop.md → summarizes the terminal completion invariant + gate sequence → checks Step 1's resolved state → reports compliance → **invokes the correction Skill** if anything is owed

Input: /remind --all
Output: Reads CLAUDE.md + all rules/*.md → produces full compliance matrix → **invokes every owed correction Skill in turn**, re-reading Step 1 between them

Input: /remind git-workflow
Output: Reads rules/git-workflow.md → summarizes branch naming + forbidden operations → checks current branch → warns if on main and prints the `git checkout -b` the human can run (detection 4 is the advisory exception in Step 4 — this skill does not create branches)
```

## Verification Checklist

- [ ] Detection heuristics ran (Step 1's checker, or its disclosed git fallback)
- [ ] Relevant rules dynamically loaded (Read tool)
- [ ] Rule text quoted inline for model re-ingestion
- [ ] Correction commands are copy-pasteable
- [ ] **Every owed correction Skill invoked in this reply**, Step 1 re-read between them — the three exceptions and the degraded run's termination are defined in § Step 4 and are not restated here, because a checklist that re-enumerates a contract is a second copy to drift from
- [ ] No `git add` / `git commit` / `git push` executed

## References

- `references/detection-rules.md` — Detection → rule mapping table + extraction patterns
