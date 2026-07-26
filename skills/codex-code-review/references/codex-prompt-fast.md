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

${DEFERRED_CONTEXT ? DEFERRED_CONTEXT : ''}

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

- [P0/P1/P2/Nit] <file:line> <issue description> -> <fix recommendation>

${SPEC_CHECKLIST ? `### AC Coverage

| AC | Status | Evidence |
|----|--------|----------|
| <AC text> | ✅ Implemented / ⚠️ Partial / ❌ Missing / N/A | file:line |` : ''}

### Deferred Findings

For every finding **below** ${BLOCKING}, emit one line here, starting at column 0:

\`\`\`
[NIT_DEFERRED] <file:line> | <issue> | reason: sub-threshold-<severity> | <ISO8601 UTC>
\`\`\`

That tag and field order are parsed out of this output by a hook and stored with a TTL, which is what stops the same finding being raised again next session. Field 2 is the issue text, field 3 the reason — do not reorder them, and do not use a different tag. Omit this section entirely if every finding blocks.

### Merge Gate

Blocking severities for this review: **${BLOCKING}** (tier: ${TIER}).

- ✅ Ready: no ${BLOCKING} findings — safe to merge, sub-threshold findings and all
- ⛔ Blocked: has a ${BLOCKING} finding, needs fix

### Structured Summary (optional, after text report)

If possible, append a JSON block at the end:

\\\`\\\`\\\`json
{"gate":"READY","findings_count":{"p0":0,"p1":0,"p2":0,"nit":0}}
\\\`\\\`\\\``,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```
