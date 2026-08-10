---
name: review-spec
description: "Review technical spec documents from completeness, feasibility, risk, and code consistency perspectives."
allowed-tools: mcp__codex__codex, mcp__codex__codex-reply, Read, Grep, Glob, Bash(git:*), Bash(node:*)
---

# Review Spec

## Trigger

- Keywords: review spec, spec review, tech spec review, review-spec

## When NOT to Use

- Code review (use `/codex-review-fast`)
- General document review (use `/codex-review-doc`)
- Writing a new spec (use `/tech-spec`)

## Relationship to `/codex-review-doc`

Both are **doc-plane producers of the same gate**, dispatched over the same
`mcp__codex__codex` route and emitting the same sentinel pair. They differ only in review
depth and dimensions: `/review-spec` is the design-landing depth (completeness, feasibility,
risk, code consistency, test strategy), `/codex-review-doc` is the general document depth.
Loop mechanics, severity calibration and `[NIT_DEFERRED]` handling are shared — see
`@skills/doc-review/SKILL.md`.

**Why not an Agent dispatch.** A built-in agent's output closes no gate: the receipt hook
recognizes a doc-plane producer either by command name on the legacy Bash/Skill route, or —
on the MCP route this skill takes — by all three of: a request asking for a `Document Review`,
an output whose own header claims that namespace (`_mcp_output_is_doc_review`), and a parsed
verdict sentinel in it. An Agent dispatch is neither route, so it recorded no verdict at all,
pass or fail. Dispatching Codex over the shared route is what makes the verdict recordable.
See `@rules/auto-loop.md` § Review Dispatch.

## Codex Dispatch

```typescript
mcp__codex__codex({
  prompt: `You are a senior technical spec reviewer. Perform a **Document Review** of the
technical specification below, at design-landing depth.

## Document Info
- Path: ${FILE_PATH}
- Type: technical specification
- Project root: ${PROJECT_ROOT}

## ⚠️ Important: You must independently read and research the project ⚠️

Do NOT expect pre-provided file content. Read the spec and research the project yourself
using your sandbox access. The spec makes concrete claims about this repository — verify
them against the actual files rather than taking them on trust.

### Document Reading (Priority)
1. Read the full document: \`cat ${FILE_PATH}\`
2. If long: \`cat ${FILE_PATH} | head -300\` then \`cat ${FILE_PATH} | tail -200\`

### Code-Documentation Consistency Research
1. Project structure: \`ls src/\`, \`ls scripts/\`, \`ls skills/\`
2. Search for every file, function, flag and command the spec names:
   \`grep -rn "keyword" . -l --include="*.ts" --include="*.js" --include="*.sh" | head -10\`
3. Read related files: \`cat <file-path> | head -100\`
4. Verify: do referenced files exist? Are names correct? Do described behaviours match code?

## Review Dimensions

| # | Dimension | Checks |
|---|-----------|--------|
| 1 | Completeness | Are requirements, scope, risks and work breakdown all present and specific |
| 2 | Feasibility | Can this be built as described, with the dependencies it names |
| 3 | Risk Assessment | Are the real failure modes identified, and does each have a bound |
| 4 | Code Consistency | Do referenced files/functions exist and behave as described (**verify with grep/cat**) |
| 5 | Test Strategy | Is every acceptance criterion mapped to evidence; are guards two-directional |

## Severity Calibration ⚠️

A 🔴 blocks the document and costs a full review round. Reserve it for defects that would
**mislead a reader into building the wrong thing**:

| Mark 🔴 | Do NOT mark 🔴 |
|---------|----------------|
| A described file, function, flag or command that does not exist | Wording that could be clearer |
| A described behaviour that contradicts what the code actually does | A section you would have structured differently |
| A security or data-handling design that is wrong or unsafe | A missing section that no rule requires |
| An internal contradiction — two passages that cannot both be true | Prose where a table would be tidier |
| A broken cross-reference, or a step whose stated dependency is not met by its own ordering | Hypothetical future concerns not present in the change |

Do not manufacture findings to fill a section. An empty 🔴 section is a normal outcome.

## Output Format

Your report **must** begin with the literal line \`## Document Review\`. The state hook uses
that header to tell a document review apart from a code or security review; a report without
it is recorded as no verdict at all, and the review has to be run again.

## Document Review

### Review Summary

| Dimension | Rating (1-5⭐) | Notes |
|-----------|----------------|-------|
| Completeness | ... | ... |
| Feasibility | ... | ... |
| Risk Assessment | ... | ... |
| Code Consistency | ... | ... |
| Test Strategy | ... | ... |

### 🔴 Must Fix (blocking — see Severity Calibration)

- [Section/Line] Issue description -> Fix recommendation

(Write \`None\` if there are none.)

### 🟡 Suggested Changes (non-blocking)

- [Section/Line] Issue description -> Fix recommendation

### ⚪ Optional Improvements

- Suggestion

### Deferred Findings

For every 🟡 and ⚪ above, emit one line here, starting at column 0:

\`\`\`
[NIT_DEFERRED] <file:line> | <issue> | reason: sub-threshold-doc | <ISO8601 UTC>
\`\`\`

Do not reorder the fields and do not use a different tag. Omit this section entirely if
there are no 🟡 or ⚪ items.

### Gate

- ✅ Mergeable: No 🔴 items
- ⛔ Needs revision: Has 🔴 items`,
  sandbox: 'read-only',
  'approval-policy': 'never',
});
```

**Save the returned `threadId`.** Loop re-review continues the same thread via
`mcp__codex__codex-reply` — see `@skills/doc-review/references/review-loop-doc.md`.

## Task

### Document to Review

```
$ARGUMENTS
```

If no path is given, auto-detect: git-modified `2-*.md` under `docs/features/` → staged
`.md` → newest tech spec. Multiple candidates: list them and ask which to review.

## Gate

| Sentinel | Meaning |
|----------|---------|
| `✅ Mergeable` | No 🔴 items — the spec may proceed to implementation |
| `⛔ Needs revision` | 🔴 items present — fix, then re-review on the same thread |

These are the doc-plane sentinels the receipt hook parses (`@rules/auto-loop.md` § Gate
Sentinels). Emit them verbatim; no other verdict vocabulary is recorded.

**🔴 only.** 🟡 and ⚪ are non-blocking: log them via `[NIT_DEFERRED]` and proceed
(`@rules/auto-loop.md` § Sub-Threshold Findings). Max 3 rounds at `fast` tier; still failing
→ report the blocker rather than spending another round.

## Verification

- [ ] Dispatched via `mcp__codex__codex`, not an Agent
- [ ] The prompt asks for a `Document Review` (the hook's request-side discriminator)
- [ ] Codex verified code-documentation consistency independently
- [ ] Gate is one of `✅ Mergeable` / `⛔ Needs revision`

## References

- Shared loop mechanics and severity model: `@skills/doc-review/SKILL.md`
- Re-review template: `@skills/doc-review/references/review-loop-doc.md`
- Dispatch contract: `@rules/codex-invocation.md`
