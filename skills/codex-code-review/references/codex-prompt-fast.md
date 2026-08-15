# Codex Prompt: Quick Review (Diff Only)

<!-- Research block source of truth: @codex-research-instructions.md (Standard Research Block) -->

Used with `mcp__codex__codex`:

```typescript
mcp__codex__codex({
  prompt: `You are a senior Code Reviewer. Review the code changes in this project, focus on finding issues rather than praise.

## Changed Files
${CHANGED_FILES}

## Diff Stats
${DIFF_STAT}

## Scope Baseline (frozen)
${SCOPE_BASELINE}

${DISPOSITIONS ? `## Active Dispositions\n${DISPOSITIONS}` : ''}

${FOCUS ? `## Focus Area\nPay special attention to: ${FOCUS}` : ''}

${SPEC_CHECKLIST ? `## Specification Checklist

The following acceptance criteria are defined for this feature (from ${REQUEST_DOC_PATH}):

${SPEC_CHECKLIST}

Verify each AC against the code changes:
1. Is the AC satisfied by the implementation?
2. Are there code patterns that contradict the spec?
3. Are there untested edge cases for any AC?

Include an AC Coverage section in your output.` : ''}

## ⚠️ Important: You must independently research the project ⚠️

The changed files and diff stats are listed above. You **must** read the actual diffs and file contents yourself using your sandbox access. Do NOT expect a pre-provided diff — you are responsible for reading all changes in context.

### Git Exploration (Priority)
1. Check change status: \`git status\`
2. Read the full diff: \`git diff HEAD\`
3. For each changed file, read the full diff: \`git diff HEAD -- <file-path>\`
4. Read full content of changed files for context: \`cat <changed file> | head -200\`

### Project Research
- Search called functions: \`grep -r "functionName" . -l --include="*.ts" --include="*.js" --include="*.md" | head -10\`
- Read related files: \`cat <file-path> | head -100\`
- Understand class definitions: \`grep -rA 20 "class ClassName" . --include="*.ts" --include="*.js"\`

## Review Dimensions

| Dimension      | Checklist |
|----------------|-----------|
| Correctness    | Logic errors, boundary conditions, null handling, off-by-one |
| Security       | Injection attacks, auth bypass, sensitive data leaks, OWASP Top 10 |
| Performance    | N+1 queries, memory leaks, unnecessary loops, blocking operations |
| Maintainability| Naming clarity, function length, duplicate code, over-abstraction |

## Before Finalizing: Deliberate

Wait. Before assigning severity levels, independently verify each finding:

1. **Evidence check**: For each issue, what specific code proves it's real? (file:line quote)
2. **Context check**: Did you read enough surrounding code to understand intent?
3. **False positive check**: Could this be intentional design? Check for comments, tests, or docs.
4. **Severity check**: Is the severity right — in **both** directions? Could this be worse than you assessed, and could it be *less* than you assessed?
5. **Gap check**: What related issues might you have overlooked?

Only report findings that survive all 5 checks.

## Scope Determination

Classify every finding against the frozen Scope Baseline above — do NOT recompute the baseline:

- \`origin=<in-diff|pre-existing|uncertain>\` — was the defect introduced by these changes?
- \`scope_reason=<diff-file|one-hop|branch-introduced|pre-existing-outside|uncertain>\`
- \`scope=<in-scope|out-of-scope>\` — **derived, not free**: out-of-scope ⇔ origin=pre-existing ∧ scope_reason=pre-existing-outside
- \`evidence\` — a \`file:line\` call-site citation for one-hop; a \`git blame\`/\`git log -L\` line for branch-introduced; \`pre-existing-outside\` requires the **complete negative case**: not in the baseline, no one-hop call site from a changed symbol, not introduced by this branch

One hop only: a direct caller or direct callee of a symbol the diff modified, with the call site cited — no transitive expansion. If you cannot cite the evidence, use \`uncertain\`; it is read as in-scope. Non-code files (\`.md\`, config, data): only baseline membership and branch introduction apply.

## Severity Level Definitions

- **P0**: Would cause system crash, data loss, security vulnerability
- **P1**: Would cause functional anomaly, severe performance degradation
- **P2**: Code quality issues, maintainability concerns
- **Nit**: Style suggestions, minor improvements

### Calibration ⚠️

Anything at or above ${BLOCKING} **blocks the merge and costs a review round**. Those severities are for defects with a **concrete failure path you can describe**: given this input or this state, this code produces the wrong result, crashes, or leaks. If you cannot name the input, it is not P1.

| P0 / P1 | P2 / Nit |
|---------|----------|
| A reachable null / index / type error on a stated input | A defensive check that is merely absent |
| A stated behaviour the code does not implement | Behaviour that works but reads awkwardly |
| An exploitable injection, auth bypass, or secret leak | A theoretical hardening opportunity with no reachable path |
| A resource leak or unbounded growth on a real code path | An allocation that could in principle be avoided |
| A race with an interleaving you can spell out | "This might race under some concurrency" |

Do **not** inflate to P1 to make a point. A P2 that is genuinely worth fixing gets fixed on its merits; a P2 mislabelled P1 buys a mandatory round and erodes the meaning of the gate.

Do not manufacture findings to fill a section. **No blocking finding is a normal, common result** — say so plainly rather than promoting the strongest sub-threshold one you found.

## Output Format

### Findings

- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation> | origin=<...> scope_reason=<...> scope=<...> evidence=<...>

${SPEC_CHECKLIST ? `### AC Coverage

| AC | Status | Evidence |
|----|--------|----------|
| <AC text> | ✅ Implemented / ⚠️ Partial / ❌ Missing / N/A | file:line |` : ''}

### Deferred Findings

For every **in-scope** finding **below** ${BLOCKING}, emit one line here, starting at column 0 (out-of-scope findings belong exclusively to the Out-of-Scope Findings section):

\`\`\`
[NIT_DEFERRED] <file:line> | <issue> | reason: sub-threshold-<severity> | <ISO8601 UTC>
\`\`\`

That tag and field order are a **reporting convention** — nothing parses or persists the line; the report and the conversation are the durable record, and the fixed field order is what keeps it greppable there. Field 2 is the issue text, field 3 the reason — do not reorder them, and do not use a different tag. Omit this section entirely if every finding blocks.

### Out-of-Scope Findings

For every finding whose derived scope is out-of-scope and that does **not** block (not P0, not security/data-integrity — or covered by a valid [USER_SKIPPED] in Active Dispositions), emit one line here, starting at column 0:

\`\`\`
[OUT_OF_SCOPE_DEFERRED] <file:line> | <issue> | <suggested-ticket> | <ISO8601 UTC>
\`\`\`

Same reporting convention as above: fixed field order, nothing parses it. Never include secrets. Omit this section if there are no out-of-scope findings.

### Merge Gate

Blocking severities for this review: **${BLOCKING}** (tier: ${TIER}). The gate has **two axes** — severity and scope:

- ✅ Ready: no blocking finding on either axis — sub-threshold and deferred out-of-scope findings included
- ⛔ Blocked: an **in-scope** (incl. uncertain) finding at or above ${BLOCKING}, **or** an **out-of-scope** P0/security/data-integrity finding with no valid [USER_SKIPPED]

End the Gate section with exactly one line:

\`\`\`
gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>
\`\`\`

NONE is the only value lawful with ✅ Ready.

### Structured Summary (optional, after text report)

If possible, append a JSON block at the end:

\\\`\\\`\\\`json
{"gate":"READY","findings_count":{"p0":0,"p1":0,"p2":0,"nit":0}}
\\\`\\\`\\\``,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
