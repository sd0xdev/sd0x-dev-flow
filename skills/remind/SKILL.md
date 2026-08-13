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
| **Smart detect** | `/remind` (no args) | Resolver, else fenced git → detect violations → auto-load relevant rules |
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
_remind_git() ( for v in ${!GIT_*}; do unset "$v"; done; git -C "$PWD" "$@" )

# Anchor every path at the repository root. /remind is invoked from wherever the
# session happens to be, and a cwd-relative state file or library path turns an
# answerable run in `packages/app/` into a degraded one that reports both planes
# owed and no state file — over a root that holds valid receipts.
ROOT=$(_remind_git rev-parse --show-toplevel 2>/dev/null) || ROOT=""
[ -n "$ROOT" ] || ROOT="$PWD"

# The tree is asked ONE question, ONCE, and every answer below reads this result:
# is anything in it uncommitted. Two probes can disagree — a concurrent editor, a
# build writing into the tree, a wrapper answering differently the second time — and
# a step that classifies from one probe while reporting `DIRTY` from another accepts
# mirror verdicts over a tree that moved between the two reads (reproduced with a git
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

# State file. Its EXISTENCE is detection 5's input and its PATH is what the resolver
# is handed; its contents are never read here. A mirror verdict records that a gate
# passed, never which tree passed it, and no cheap local check can supply that
# binding: a clean `git status` says only that nothing is uncommitted right now, so
# a PASS recorded on commit A survives a checkout to an equally clean commit B
# (round 18). Deriving the binding is `gate-derive.js`'s whole job — without it the
# three verdicts stay `false` and the reminder over-reminds, which costs a redundant
# review dispatch instead of hiding an owed gate.
STATE_FILE="$ROOT/.claude_review_state.json"
STATE_FILE_EXISTS=$(test -f "$STATE_FILE" && echo "true" || echo "false")

# Change flags come from the SAME advisory resolver the auto-loop hooks use
# (lib/gate-derive.js --advisory), never from the state file: since WB5c
# `session-init.sh` DELETES `has_code_change`/`has_doc_change`, so reading them
# directly reports "no change" on a dirty tree. Installed copy first — the
# installer puts the libraries under `.claude/scripts/lib/`, not beside it.
DERIVE="$ROOT/.claude/scripts/lib/gate-derive.js"; [ -f "$DERIVE" ] || DERIVE="$ROOT/scripts/lib/gate-derive.js"
ADV=""
if [ -f "$DERIVE" ] && command -v node >/dev/null 2>&1; then
  # Bounded like the advisory hooks *when a bounding tool exists*: the derivation
  # hashes dirty and untracked content, which is unbounded on a pathological tree,
  # and /remind runs interactively. A kill lands in the fallback below. With none of
  # timeout/gtimeout/perl present the last branch runs node unbounded — the ladder
  # has no pure-shell rung, and claiming otherwise is the overstatement doc review
  # round 5 caught. The `git status` probe above is unbounded for the same reason.
  T="${AUTO_LOOP_DERIVE_TIMEOUT:-10}"; case "$T" in '' | *[!0-9]*) T=10 ;; esac
  [ "$T" -gt 0 ] 2>/dev/null || T=10
  if command -v timeout >/dev/null 2>&1; then
    ADV=$(timeout "$T" node "$DERIVE" "$ROOT" --advisory "$STATE_FILE" 2>/dev/null) || ADV=""
  elif command -v gtimeout >/dev/null 2>&1; then
    ADV=$(gtimeout "$T" node "$DERIVE" "$ROOT" --advisory "$STATE_FILE" 2>/dev/null) || ADV=""
  elif command -v perl >/dev/null 2>&1; then
    ADV=$(perl -e 'alarm shift; exec @ARGV or exit 127' "$T" node "$DERIVE" "$ROOT" --advisory "$STATE_FILE" 2>/dev/null) || ADV=""
  else
    ADV=$(node "$DERIVE" "$ROOT" --advisory "$STATE_FILE" 2>/dev/null) || ADV=""
  fi
fi

ADV_OK=false
if [ -n "$ADV" ]; then
  # `|| true`: a nonempty but malformed answer makes jq exit nonzero, and a failed
  # command substitution in an assignment aborts a caller that set -e — before the
  # fallback below could run. An empty value is the rejection this step wants anyway.
  _remind_bool() { echo "$ADV" | jq -r --arg k "$1" '.[$k] | if type == "boolean" then tostring else "" end' 2>/dev/null || true; }
  HAS_CODE=$(_remind_bool has_code_change); HAS_DOC=$(_remind_bool has_doc_change)
  CODE_REVIEW=$(_remind_bool code_review_passed); DOC_REVIEW=$(_remind_bool doc_review_passed)
  PRECOMMIT=$(_remind_bool precommit_passed)
  # Provenance is part of the contract, not metadata. The resolver serves several
  # callers and keeps the mirror authoritative in the one state where a digest
  # receipt has nothing to bind to — outside a repository (`treeState=not-a-repo`,
  # the planes it fell back on named in `mirror_planes`). Those are exactly the
  # values this step refuses to read directly, so accepting them here would take
  # the same stale-or-forged verdict by a longer route: a forged state file beside
  # a non-repository directory would answer every gate PASS. Anything but a derived
  # answer over a real tree is rejected, and the git fallback runs instead. The
  # type is checked, not just the length: jq gives `""` and `{}` a length of zero
  # too, so a length test alone accepts a malformed answer as derived — a missing
  # or null `mirror_planes` fails closed on the same clause (round 20).
  ADV_PROV=$(echo "$ADV" | jq -r 'if (.treeState == "ok") and ((.mirror_planes | type) == "array") and ((.mirror_planes | length) == 0) then "derived" else "mirrored" end' 2>/dev/null || true)
  # All five or none — a partially parsed answer must not mix two policies.
  if [ "$ADV_PROV" = "derived" ] && [ -n "$HAS_CODE" ] && [ -n "$HAS_DOC" ] && [ -n "$CODE_REVIEW" ] && [ -n "$DOC_REVIEW" ] && [ -n "$PRECOMMIT" ]; then
    ADV_OK=true
  fi
  unset ADV_PROV
fi

if [ "$ADV_OK" != "true" ]; then
  # Resolver unavailable, so the ONE tree answer taken above is all there is, and it
  # opens both planes or neither. It deliberately does NOT classify: only
  # `gate-derive.js` does that, by full-path suffix over the whole repository.
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
  # No verdict without the resolver — not even on a clean tree. The mirror records
  # that a gate passed, never which tree passed it, and `git status` cannot supply the
  # missing half: "clean" says nothing is uncommitted *now*, which is equally true one
  # checkout later, so a PASS earned on commit A reads as current on an unrelated,
  # equally clean commit B (round 18). A forged mirror is indistinguishable from a
  # stale one by the same argument. So the degraded run answers the change question
  # from git and leaves every verdict `false`.
  #
  # What that costs, stated plainly: detection 3 (review passed, no precommit) cannot
  # fire on a degraded run, because its trigger is a verdict this path does not have.
  # Detections 1, 2 and 5 still work off the tree. The trade is deliberate — a missed
  # nudge about the next gate, rather than a stale PASS closing the current one.
  CODE_REVIEW=false; DOC_REVIEW=false; PRECOMMIT=false
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
| 5 | Dirty worktree, no state | `DIRTY` non-empty + `STATE_FILE_EXISTS=false` | `CLAUDE.md` | "Required Checks" table |

Without the resolver (`ADV_OK=false`) the step does not classify, so `HAS_CODE` and `HAS_DOC` move
together, and **no verdict is available at all** — the mirror is not read on any degraded run,
however clean the tree looks (see Step 1's comment: clean means "nothing uncommitted now", which an
unrelated commit satisfies just as well). What remains:

| Degraded run | Verdicts | What fires |
|--------------|----------|-----------|
| Tree provably clean | All three `false` — no source for them | No **gate** row: rows 1 and 2 need a change flag, row 3 needs `CODE_REVIEW=true`, row 5 needs `DIRTY`. Row 4 is unaffected — it reads `BRANCH`, not the resolver, so a degraded clean run on `main` still reports it, and the run still terminates under § Step 4 |
| Tree dirty or unverifiable | All three `false` — no source for them | Rows 1 and 2 both fire; row 5 too when no state file exists. Row 3 cannot, because `CODE_REVIEW` is `false` |

So on a degraded dirty tree rows 1 and 2 are never separable — one shared cause, stated once
("resolver unavailable, so both planes are reported as changed and no verdict is trusted"), not two
independent detections. Never disclose `source=mirror` on a degraded run, and never dispatch
`/precommit` from row 3 there: no mirror value was read, and row 3 cannot have fired.

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

**A degraded run terminates too, and not by claiming All Clear.** Without the resolver there is no
verdict, so re-reading Step 1 after a correction returns the *same* rows it returned before —
`/codex-review-fast` cannot make `CODE_REVIEW` true when nothing can read a verdict. **Degradation
dominates the terminal status**: whenever `ADV_OK` is false the reply ends at `### Degraded ⚠️`,
whether or not detection 4 also fired and whether or not a correction ran. Two rules keep that from
becoming a loop or a false clearance:

| Degraded run | What terminates it |
|--------------|--------------------|
| An executable correction fired | Invoke **each distinct correction at most once**. When the re-read returns rows already corrected in this reply and the resolver is still unavailable, stop and report `### Degraded ⚠️` — the corrections ran, closure is unverifiable until the resolver answers |
| No executable correction fired | Report `### Degraded ⚠️` as well, naming the resolver as the missing input. **Not `### All Clear ✅`**, and **not the lone-detection-4 exception either**: detection 4 fires on a degraded clean run on `main` and names no Skill, so that run reaches the end with no invocation and must still not claim a clearance nothing verified |

So the complete list of outcomes that end this step without an invocation is **three**:
`### All Clear ✅` (the resolver answered and nothing is owed), a lone detection 4 on a run the
resolver answered, and `### Degraded ⚠️` where no executable correction fired. A degraded run that
*did* invoke corrections ends at `### Degraded ⚠️` too — that one is a termination, not an
exception.

## Specific Rule Mode (`/remind <rule>`)

When user provides a rule name:

1. **Resolve**: `rules/<rule>.md` → if not found, try `rules/<rule>-project.md` → if not found, list available via `Glob("rules/*.md")`
2. **Read**: Read the full rule file
3. **Summarize**: Extract core principles, prohibited behaviors, required actions
4. **Check**: run Step 1 and use the variables it resolved. **Not the state file directly** — a
   stored verdict is not bound to the tree that earned it, so a mirror `code_review.passed=true`
   read after a subsequent edit reports compliance over an owed review. Step 1's resolver binds the
   verdict to the current content; where it cannot, it says so
5. **Output**: rule summary + current violation status + correction commands, then Step 4 —
   the execution contract applies to this mode too

## Nuclear Mode (`/remind --all`)

When the model keeps drifting despite specific reminders:

1. **Read `CLAUDE.md`**: Extract `## Required Checks` table + `## Auto-Loop` section
2. **Read all rules**: `Glob("rules/*.md")` → Read each file
3. **For each rule**: Extract prohibited behaviors / core principles
4. **Cross-reference**: Step 1's resolved variables against all rules — same reason as above, the
   state file is not a second source of truth
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
| jq unavailable | The resolver's answer cannot be parsed, so the run degrades to the two rows below — fail-closed, never silently clean |
| Resolver unavailable, tree provably clean | Change flags read `false`, verdicts read `false` (the mirror is never read — a clean tree does not bind a stored verdict to itself), so no gate row fires; detection 4 still can, reading `BRANCH`. The run terminates under § Step 4, which refuses a clearance for a run that verified nothing |
| Resolver answered from anything but a derived read (`treeState` other than `ok`, or a `mirror_planes` that is not an **empty array** — a non-empty array, a missing field, `null`, `""` and `{}` are all rejected, since jq gives the last two length zero) | Rejected exactly like no answer at all — it carries the stored verdicts this step refuses to read directly. The rows below apply |
| Resolver unavailable, tree dirty or unverifiable | **Both** planes open and all three verdicts read `false`. Rows 1 and 2 fire, row 5 when no state file exists; **row 3 cannot fire** — its trigger is `CODE_REVIEW=true`. Disclose the shared cause once |
| State file missing | Not a degradation: the resolver derives from tree content and content-addressed receipts, so gates can still close. It only sets `STATE_FILE_EXISTS=false`, which is detection 5's input |
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

- [ ] Detection heuristics ran (Step 1's resolver, or its disclosed git fallback)
- [ ] Relevant rules dynamically loaded (Read tool)
- [ ] Rule text quoted inline for model re-ingestion
- [ ] Correction commands are copy-pasteable
- [ ] **Every owed correction Skill invoked in this reply**, Step 1 re-read between them — the three exceptions and the degraded run's termination are defined in § Step 4 and are not restated here, because a checklist that re-enumerates a contract is a second copy to drift from
- [ ] No `git add` / `git commit` / `git push` executed

## References

- `references/detection-rules.md` — Detection → rule mapping table + extraction patterns
