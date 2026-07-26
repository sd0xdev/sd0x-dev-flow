---
name: remind
description: "Lightweight model correction with context-aware rule loading. Use when: model forgot a rule, skipped a required step, edited code/docs without running review, needs to re-read CLAUDE.md or rules. Triggers on: 'you forgot', 'remind', 'check rules', 'what did you miss', '你忘了', 'did you skip review', 'why didn't you run precommit', or /remind. Also use PROACTIVELY after editing files if unsure whether auto-loop was followed — running /remind costs nothing and catches drift early. Not for: full code review (use codex-review-fast), next step advice (use next-step), workflow progression (use feature-dev)."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(cat:*), Bash(jq:*), Bash(bash:*), Skill
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

**Exception**: Only stop without executing when findings are `### All Clear ✅` (nothing to fix).

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
| **Smart detect** | `/remind` (no args) | Read state + git → detect violations → auto-load relevant rules |
| **Specific rule** | `/remind auto-loop` | Read `rules/auto-loop.md` → summarize + check violations |
| **Nuclear** | `/remind --all` | Read CLAUDE.md + ALL rules → full compliance report |

## Smart Detection Mode

When invoked without arguments, run detection heuristics then **dynamically load the relevant rules** for each finding.

### Step 1: Read State + Git

```bash
# State file
STATE_FILE_EXISTS=$(test -f .claude_review_state.json && echo "true" || echo "false")
STATE=$(cat .claude_review_state.json 2>/dev/null || echo "{}")
HAS_CODE=$(echo "$STATE" | jq -r '.has_code_change // false')
HAS_DOC=$(echo "$STATE" | jq -r '.has_doc_change // false')
CODE_REVIEW=$(echo "$STATE" | jq -r '.code_review.passed // false')
DOC_REVIEW=$(echo "$STATE" | jq -r '.doc_review.passed // false')
PRECOMMIT=$(echo "$STATE" | jq -r '.precommit.passed // false')

# Git
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
DIRTY=$(git status --porcelain 2>/dev/null)
```

### Step 2: Detection → Rule Mapping

For each detected issue, **Read the mapped rule file** and extract the key section:

| # | Detection | Condition | Rule to Load | Section to Extract |
|---|-----------|-----------|-------------|-------------------|
| 1 | Code changed, no review | `HAS_CODE=true` + `CODE_REVIEW=false` | `rules/auto-loop.md` | "The Four Anchors" + "Auto-Trigger" table |
| 2 | Doc changed, no review | `HAS_DOC=true` + `DOC_REVIEW=false` | `rules/auto-loop.md` | ".md" row in Auto-Trigger table |
| 3 | Review passed, no precommit | `CODE_REVIEW=true` + `PRECOMMIT=false` | `rules/auto-loop.md` | "precommit Pass" row |
| 4 | State drift | State says changes but git clean | — | Suggest reset state file |
| 5 | On main branch | `BRANCH=main\|master` | `rules/git-workflow.md` | Branch naming + protected branches |
| 6 | Dirty worktree, no state | Git dirty + no state file | `CLAUDE.md` | "Required Checks" table |

### Step 3: Output with Rule Context

For each finding, quote the relevant rule text inline so the model re-ingests the rule:

```markdown
## Reminder

### Findings

| # | Priority | Rule | Issue | Correction |
|---|----------|------|-------|------------|
| 1 | P0 | auto-loop | Code changed but review not passed | `/codex-review-fast` |

### Rule Context (auto-loaded)

> **auto-loop.md — The Four Anchors**:
> - ❌ Declaring ≠ Executing: Saying "need to run X" without actually invoking the tool
> - ❌ Summary ≠ Completion: Outputting a summary then stopping
>
> **Required action**: Execute `/codex-review-fast` in this reply, do not stop.

### Corrections (copy-pasteable)
1. `/codex-review-fast`
```

When no findings: output `### All Clear ✅` with a brief status summary.

## Specific Rule Mode (`/remind <rule>`)

When user provides a rule name:

1. **Resolve**: `rules/<rule>.md` → if not found, try `rules/<rule>-project.md` → if not found, list available via `Glob("rules/*.md")`
2. **Read**: Read the full rule file
3. **Summarize**: Extract core principles, prohibited behaviors, required actions
4. **Check**: Cross-reference with current state (state file + git)
5. **Output**: Rule summary + current violation status + correction commands

## Nuclear Mode (`/remind --all`)

When the model keeps drifting despite specific reminders:

1. **Read `CLAUDE.md`**: Extract `## Required Checks` table + `## Workflow` section + `## Auto-Loop Rule` section
2. **Read all rules**: `Glob("rules/*.md")` → Read each file
3. **For each rule**: Extract prohibited behaviors / core principles
4. **Cross-reference**: State file + git status against all rules
5. **Output**: Full compliance report with every rule's status

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
| jq unavailable | Skip state file parsing, git-only checks |
| State file missing | Git-only checks + suggest starting review loop |
| Rule file not found | List available rules via `Glob("rules/*.md")` |

## Execution Contract (reinforces top-level CRITICAL section)

The reminder output isn't just informational — it's a **correction directive with mandatory execution**:

1. **Invoke the correction Skill immediately** in the same reply — do not ask for permission, do not output a summary and stop
2. **Re-read the quoted rule text** — it was loaded from the actual rule file specifically because the model drifted from it
3. **Do not dismiss findings** with "I already did that" unless you can point to the specific tool invocation in this conversation
4. If findings say "run `/codex-review-fast`" — invoke `Skill: /codex-review-fast` now, not later

The whole point of `/remind` is that the model's memory of rules has drifted. The quoted rule text is the source of truth, not the model's recollection of what the rules say.

**Correct flow**:

```
/remind → detect doc-no-review → output findings table → invoke Skill(/codex-review-doc) → report result
/remind → detect code-no-review → output findings table → invoke Skill(/codex-review-fast) → report result
/remind → no findings → output "### All Clear ✅" → stop (no correction needed)
```

## Examples

```
Input: /remind
Output: Smart detection finds code changed without review → loads auto-loop.md → quotes The Four Anchors → outputs `/codex-review-fast`

Input: /remind auto-loop
Output: Reads rules/auto-loop.md → summarizes the four anchors + auto-trigger table → checks state file → reports current compliance

Input: /remind --all
Output: Reads CLAUDE.md + all rules/*.md → produces full compliance matrix → flags all violations with correction commands

Input: /remind git-workflow
Output: Reads rules/git-workflow.md → summarizes branch naming + forbidden operations → checks current branch → warns if on main
```

## Verification Checklist

- [ ] Detection heuristics ran (state + git)
- [ ] Relevant rules dynamically loaded (Read tool)
- [ ] Rule text quoted inline for model re-ingestion
- [ ] Correction commands are copy-pasteable
- [ ] No `git add` / `git commit` / `git push` executed

## References

- `references/detection-rules.md` — Detection → rule mapping table + extraction patterns
