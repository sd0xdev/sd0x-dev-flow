# Verdict Prompt Template

<!-- Research block source of truth: @skills/codex-code-review/references/codex-research-instructions.md (Standard Research Block) -->

## Phase B: Blind Independent Verdict

You are a senior code reviewer performing an independent assessment of a finding.

## Finding Under Review

```
finding_key: ${FINDING_KEY}
severity: ${SEVERITY}
intent: ${INTENT}
original_finding_text: ${ORIGINAL_FINDING_TEXT}
origin_thread_id: ${ORIGIN_THREAD_ID}
current_head_sha: ${CURRENT_HEAD_SHA}
```

## Relevant Code Context

```diff
${RELEVANT_DIFF}
```

## Your Task

Determine whether this finding is actionable (requires a code fix) or non-actionable (false positive
/ no real impact).

**When `intent` above is `clarify`, that verdict is not what the caller needs**, and answering it
alone leaves the mapping with nothing to read: a clarify dispatch asks *how far the finding reaches*.
Assess the impact as well — how broad the affected surface is, and how severe the consequence on a
path you can name — and fill in the `impact_assessment` field below. For `dismiss` and `confirm`,
report `impact_assessment: NOT_ASSESSED`; inventing an impact grade nobody asked for is noise the
policy mapping would have to ignore.

**Do not assume this finding is true or false.** You must independently verify.

## ⚠️ Important: You must independently research the project ⚠️

When reviewing, you **must** perform the following research, do not rely only on the context above:

### Git Exploration (Priority)

1. Check change status: `git status`
2. Check changed files: `git diff --name-only HEAD`
3. Check full changes for specific file: `git diff HEAD -- <file-path>`
4. Read changed files to the end: `cat <changed file>` (chunk with `sed -n '1,200p'`, `sed -n '201,400p'`, … when long — `head -200` truncates)

### Project Research

- Search called functions: `grep -rln "functionName" . | head -10` — rooted at the repository, or at a directory discovery surfaced; never an assumed `src/`
- Read related files: `cat <file-path> | head -100`
- Understand class definitions: `grep -rn -A 20 "class ClassName" .` — rooted at the repository, or at a directory discovery surfaced; never an assumed `src/`

## Output (all fields required)

- codex_verdict: ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
- impact_assessment: HIGH_IMPACT | LOW_IMPACT | UNCERTAIN | NOT_ASSESSED
- confidence: [0.0 - 1.0]
- evidence_refs: [list of files/lines/commands you used to reach this conclusion]
- reasoning: [why this verdict, not the others — cite specific evidence]

These are the **only** values this dispatch returns. `FIX_REQUIRED`, `DISMISS_CONFIRMED`,
`DISMISS_CANDIDATE` and `NEED_HUMAN` are not among them: they are Phase C's, derived from the fields
above by `policy-mapping.md`. Reporting one here would state a decision this dispatch does not make.

## Anti-Anchoring Enforcement

| Check | Required |
|-------|----------|
| Prompt does NOT contain Claude's dismiss hypothesis | Yes |
| Prompt does NOT contain "Claude thinks..." or similar | Yes |
| Prompt does NOT ask "is this a false positive?" | Yes |
| Prompt includes "Do not assume this finding is true or false" | Yes |
| Uses a fresh thread — `@skills/codex-code-review/references/codex-transport.md` § Start, never § Resume from the review | Yes |

## Candidate Packaging (Phase A)

Before calling Codex, extract the finding packet locally:

```
finding_packet:
  finding_key: <file + canonical_issue_text>
  severity: <P0 | P1 | P2 | Nit>
  intent: <dismiss | confirm | clarify>
  original_finding_text: <Codex review original text (secrets redacted)>
  origin_thread_id: <review session threadId>
  current_head_sha: <git rev-parse HEAD>
  relevant_diff: <git diff HEAD -- <file>>
```

**Critical**: Record Claude's dismiss hypothesis locally but **never include it in the Codex prompt**.

## Rebuttal Prompt (Phase B extension)

When Phase C maps Codex's answer to `FIX_REQUIRED` — that is, a raw `codex_verdict: ACTIONABLE`
at or above the mapping's confidence floor — and Claude has objective counter-evidence (1 round
max). Codex never returns `FIX_REQUIRED` itself; describe its own verdict back to it in its own
vocabulary:

Counter-evidence for your ACTIONABLE verdict:

## Objective Evidence

${COUNTER_EVIDENCE}

Based on this additional evidence, please re-evaluate:
- codex_verdict: ACTIONABLE | NON_ACTIONABLE | UNCERTAIN
- confidence: [0.0 - 1.0]
- evidence_refs: [updated list]
- reasoning: [updated reasoning]
