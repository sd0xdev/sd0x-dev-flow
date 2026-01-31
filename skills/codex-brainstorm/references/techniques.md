# Codex Brainstorm Debate Techniques

## Phase 1: Claude Independent Analysis Template

```markdown
## Claude Independent Analysis

### Problem Understanding

[Understanding of the problem]

### Constraints

[Identified constraints]

### Claude's Optimal Hypothesis

- Proposal: [specific proposal]
- Rationale: [why this is optimal]
- Potential weaknesses: [self-critique]

### Prepare to Attack Codex's Arguments

1. [Anticipated Codex proposal] → [Attack point]
2. ...
```

## Phase 2: Codex Independent Analysis Prompt

### Standard Template

```typescript
mcp__codex__codex({
  prompt: `You are a critical-thinking technical architect.

## Problem
${problem}

## Constraints
${constraints}

## ⚠️ Important: You must research independently ⚠️

Before forming any conclusions, you **must** perform the following research:

### 1. Project Structure Understanding
- Run \`ls src/\` to understand directory structure
- Run \`ls src/service/\` and \`ls src/provider/\` to understand existing modules

### 2. Related Code Search
- Search keywords related to the topic: \`grep -r "keyword" src/ --include="*.ts" -l | head -10\`
- Read relevant file contents: \`cat <file-path> | head -100\`

### 3. Existing Implementation Analysis
- Find similar feature implementations
- Confirm naming conventions, DI patterns, error handling patterns

## Output Requirements

### Research Summary
| Research Item      | Findings |
|--------------------|----------|
| Related modules    | ...      |
| Existing patterns  | ...      |
| Reusable components | ...     |

### My Position
Based on research results, I believe the optimal solution is: [Position B]

### Arguments
1. [Argument based on code research]
2. [Argument based on existing architecture]
3. [Argument based on constraints]

### Potential Risks
1. ...`,
  sandbox: 'read-only',
  'approval-policy': 'on-failure',
});
```

### Key Settings

| Setting           | Value        | Description                      |
| ----------------- | ------------ | -------------------------------- |
| `sandbox`         | `read-only`  | Allow file reads, prohibit writes |
| `approval-policy` | `on-failure` | Approval needed only on failure  |

## Phase 3: Adversarial Debate Prompts

### Claude Attacks Codex

```typescript
mcp__codex__codex_reply({
  threadId: '<threadId>',
  prompt: `I am Claude, and I disagree with your proposal.

## Your Proposal
${codexSolution}

## My Attacks
1. **Fatal flaw**: [identify the biggest issue]
2. **Ignored constraint**: [what you did not consider]
3. **Assumption challenge**: [your assumption may be wrong]

## My Proposal
${claudeSolution}

## Why Mine Is Better
[argument]

Please rebut my attacks, or concede and update your position.`,
});
```

### Subsequent Rounds

```typescript
mcp__codex__codex_reply({
  threadId: '<threadId>',
  prompt: `## Your Rebuttal
${codexRebuttal}

## My Response
- Regarding [argument 1]: [agree/rebut + reason]
- Regarding [argument 2]: [agree/rebut + reason]

## Whether I Update My Position
- [Yes/No]
- If yes, new position: [...]
- If no, new attack: [...]

## Equilibrium Check
Can I still raise new attacks? [Yes/No]
Can you still raise new attacks? Please respond.`,
});
```

## Attack Techniques

| Type               | Approach                                          | Goal              |
| ------------------ | ------------------------------------------------- | ----------------- |
| Flaw attack        | "Your proposal fails in [scenario]"               | Find edge cases   |
| Constraint attack  | "You ignored [constraint]"                        | Test completeness |
| Assumption attack  | "You assume [X], but what if [Y]?"                | Undermine foundation |
| Comparison attack  | "My proposal is superior in [dimension]"          | Direct comparison |
| Temporal attack    | "In 6 months under [scenario], what happens to yours?" | Long-term perspective |

## Defense Techniques

| Type          | Response Approach                                              |
| ------------- | -------------------------------------------------------------- |
| Acknowledge   | "You're right, but this weakness can be mitigated by [X]"      |
| Counter-attack | "Your proposal has the same issue, and it's more severe"      |
| Deflect       | "This weakness has minimal real-world impact because [Y]"      |
| Update        | "I accept your criticism and update my proposal to [Z]"        |
