# `/recap-ask` — Codex Q&A Prompt + Intent Classification

This file is the LLM prompt source of truth for `/recap-ask`. It obeys `@rules/codex-invocation.md` — Codex must independently research; we never feed conclusions.

## Intent Classification (Phase 2)

Classify each incoming question into exactly one of three classes **before** any Codex call.

| Class | Decision Rule | Examples |
|-------|---------------|----------|
| `recap-scoped` | The question references files, sections, decisions, blind spots, or anticipated questions **already listed in the recap doc** (check §1 Overview, §2 Changed Files, §3 Design Decisions, §5 Blind Spots, §6 Anticipated Questions, §7 Evidence). | "Why did the migration flip the default in §3?", "Which file owns the rule in §5.2?" |
| `out-of-scope` | The question is clearly about code, features, or concepts **not** present anywhere in the recap — including files not in §2 and terms not in §1/§3. | "How does the router work?" when the recap is about the scope detector |
| `ambiguous` | The question's subject partially overlaps the recap (e.g. mentioned in §5 Blind Spots but not explained), or the scope is unclear. | "Does this affect auth?" when auth appears only as a blind-spot flag |

### Decision Algorithm (deterministic, no LLM inference)

1. Lowercase the question + strip punctuation.
2. Extract content tokens (noun phrases, file paths, function names).
3. For each token, scan the recap:
   - Token appears in §2/§7 as a file path → `recap-scoped` candidate.
   - Token appears in §1/§3/§6 as a concept → `recap-scoped` candidate.
   - Token appears only in §5 Blind Spots (flagged but not explained) → `ambiguous` candidate.
   - Token absent entirely → `out-of-scope` candidate.
4. Reduce: if **all** tokens are `out-of-scope` → class = `out-of-scope`. If **any** token is `recap-scoped` **and** the remainder are recognisable generic terms (e.g. "function", "why") → class = `recap-scoped`. Otherwise `ambiguous`.

If `ambiguous`, trigger `AskUserQuestion` with 2-3 framed options derived from the recap sections that partially matched.

## Out-of-Scope Redirect Template (verbatim)

When class = `out-of-scope`, emit **only** this block. Do not invoke Codex, do not synthesize an answer:

```markdown
此問題超出本輪 recap 範圍。建議改用 `/ask "<原始問題>"`，它會從整個專案重新收集上下文。
```

Keep the exact opening phrase `此問題超出本輪 recap 範圍` — downstream tests / wrappers grep for it.

## Codex Prompt Template (Phase 3, recap-scoped only)

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Start for the first turn. Subsequent turns in the same session use `@skills/codex-code-review/references/codex-transport.md` § Resume with the same threadId.

You are a senior engineer answering a follow-up question about a recently produced Recap document.

## Recap Context (primary)

- Recap path: ${RECAP_PATH}
- Feature key: ${FEATURE_KEY}
- Depth: ${DEPTH}
- Evidence file-index (ALLOWED lazy-fetch targets, others are forbidden):
${EVIDENCE_FILE_INDEX}

## Question

${USER_QUESTION}

## ⚠️ Important: You must independently research the project ⚠️

Per `@rules/codex-invocation.md`: the recap is your primary context, but you must still **independently** verify any claim by reading the referenced code. Do NOT rely on my framing of the question.

**Scope note**: "independent research" here is **bounded to the §7 Evidence allowlist by design**. This is not a contradiction of the codex-invocation rule — it is the rule's narrowing for recap-bounded Q&A. If the allowlist is insufficient to answer, emit the out-of-scope response (see Out-of-Scope Redirect Template above) rather than guessing or broadening scope.

### Git Exploration (Priority)

1. `git status` — see if the repo has uncommitted context that may affect the answer
2. `git diff --name-only HEAD` — identify files currently in flux
3. `git log --oneline -10 -- ${RECAP_PATH}` — recap authorship / freshness
4. `git blame` on allowed files when specific-line attribution matters

### Recap reading (required)

1. `cat ${RECAP_PATH}` — read the full recap
2. Identify which sections (§1-§7) the question touches

### Code verification (bounded)

You may only Read files listed in the Evidence file-index above. If you need information from a file NOT in the index, respond with: "此問題需要 recap 範圍外的檔案：<path>. 建議改用 /ask". Do not attempt to read outside the allowlist.

For allowed files:
- `cat <allowed-path>` (head -200 for size)
- `grep -n "<keyword>" <allowed-path>` for specific lines

## Prohibited

- Do NOT guess at file contents you have not read.
- Do NOT speculate about code paths that are not in §2 / §7.
- Do NOT answer "Yes, that's correct" or "The fix looks good" — the user asked a question, not for confirmation.

## Output Format

### Answer

<2-6 sentence answer citing specific recap sections and file:line>

### Sources

- `<path>:<line>` — <what this reference demonstrates>
- ...

### Follow-up hints

- If the user likely wants to see the diff: note the commit SHA from §7.
- If the recap already has an Anticipated Question matching this: cite that §6 entry.


## Loop / Continue Prompt (follow-up turns)

Follow-up question in the same recap-ask session.

## New Question

${USER_QUESTION}

## ⚠️ Still bounded by the same recap

- Recap path: ${RECAP_PATH}
- Evidence file-index (unchanged):
${EVIDENCE_FILE_INDEX}

## Reminder

- **Re-run intent classification on this new question**: the prior turn's class does not carry over. Apply the Decision Algorithm above and emit exactly one of `recap-scoped` / `out-of-scope` / `ambiguous` for this question before synthesis.
- The allowlist has not expanded. Reject reads outside it.
- If this new question feels out-of-scope vs the prior turn, say so explicitly at the top of your answer.

## Output format

Same as the initial turn: Answer → Sources → Follow-up hints.


## Promote Digest Template (Phase 4, end-of-session)

When the user opts in to promote the Q&A to a request ticket, render the digest for `/create-request --update` using this markdown template. Append under a new heading in the existing ticket:

```markdown
## Follow-up Q&A (<YYYY-MM-DD>)

Source recap: `<recap-path>`
Thread: `<codex-threadId>`

### Q1: <question>
<condensed 1-2 sentence answer>
See: `<path>:<line>`

### Q2: ...
```

Do not include the full Codex transcript — keep to distilled facts so the ticket remains scannable.

## Verification Hooks (used by test/skills/recap-ask.test.js)

The test file asserts these invariants against this prompt file:

- Contains the literal Chinese phrase `此問題超出本輪 recap 範圍`.
- Contains the independent-research mandate (`independently research`).
- Forbids reads outside the Evidence allowlist (`not in §2 / §7` or equivalent).
- References all three intent classes: `recap-scoped`, `out-of-scope`, `ambiguous`.
- Promote digest template contains `Follow-up Q&A`.

If you change any of those literals here, update the test assertions in lockstep.
