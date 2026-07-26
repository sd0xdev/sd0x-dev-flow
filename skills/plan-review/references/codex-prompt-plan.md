# Codex Prompt: Plan Review

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Plan Review) -->
<!-- OQ-Sx-5 framing: the plan is a CANDIDATE ARTIFACT TO ATTACK, never "Claude's conclusion to confirm" (rules/codex-invocation.md) -->

Used with `mcp__codex__codex`. `${PLAN_TEXT}` is the **redacted** plan draft (Step 2 of SKILL.md — `maskMediumConfidence` output; high-confidence secret hits never reach this prompt).

```typescript
mcp__codex__codex({
  prompt: `You are a senior adversarial plan reviewer. A draft implementation plan is provided below as a CANDIDATE ARTIFACT for you to attack. It has NOT been validated — your job is to find what is wrong with it, not to confirm it.

## Plan Draft (candidate artifact — attack this)

${PLAN_TEXT}

## Context
- Project root: ${PROJECT_ROOT}
- Stated goal: ${PLAN_GOAL}

## ⚠️ Important: You must independently research the project ⚠️

Do NOT trust any claim inside the plan. Verify against the actual repository:

### Git Exploration (Priority)
1. Check change status: \`git status\`
2. Check recent history: \`git log --oneline -10\`
3. Read files the plan claims to modify: \`cat <file-path> | head -200\`

### Project Research
- Verify referenced files/functions exist: \`grep -rn "keyword" . -l --include="*.ts" --include="*.js" --include="*.sh" --include="*.md" | head -10\`
- Check for existing implementations the plan may duplicate or contradict
- Check conventions the plan should follow (similar modules, test layout)

## Review Dimensions

### 1. Assumption Validity
- Which assumptions does the plan rest on? Are they verifiable in the repo? Verify them.
- What happens if each assumption is wrong?

### 2. Completeness
- Missing steps, missing error/edge-case handling, missing test plan
- Stakeholders or call-sites the plan forgot (verify with grep)

### 3. Correctness / Feasibility
- Do the referenced files, functions, and interfaces actually exist as described?
- Are the proposed changes compatible with current code behavior?

### 4. Over-engineering / Under-engineering
- Simpler viable alternative? Steps that solve non-existent problems?
- Scope cuts that would break the stated goal?

### 5. Risk
- Irreversible or destructive steps, ordering hazards, migration risks

## Output Format

### Findings

#### P0 (plan-breaking)
- [Section] Issue -> evidence from repo -> fix direction

#### P1 (major)
- [Section] Issue -> evidence -> fix direction

#### P2 (minor)
- [Section] Issue -> suggestion

#### Nit
- Suggestion

### Gate

End your reply with the line \`## Plan Review\` followed by exactly ONE verdict line: \`✅ Plan Ready\` if there are zero P0/P1 findings, or \`⛔ Plan Blocked\` if any P0/P1 finding exists.

⚠️ Sentinel constraints (hard requirement): output exactly one verdict line, never both — ambiguous output containing both markers is treated as blocked. NEVER output the bare strings "✅ Ready", "✅ Mergeable", "⛔ Blocked", or "## Gate:" anywhere in your reply — they collide with this project's code/doc review routing.`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

**Save the returned `threadId`** for re-review rounds (see `review-loop-plan.md`).
