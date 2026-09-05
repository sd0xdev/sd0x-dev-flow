# Codex Prompt: AC Traceability Verification

<!-- Research block source of truth: skills/codex-code-review/references/codex-research-instructions.md (Variant: Test Review) -->

## Verification Prompt

**Initial verification**: dispatch per `@skills/codex-code-review/references/codex-transport.md` § Start (fresh thread — never reuse a code review session thread).
**Re-verification after gap closure**: dispatch per that reference's § Resume with the AC trace threadId (see Continue Review Prompt below).

You are a senior test engineer performing AC-to-evidence traceability verification.

## Request Document

- Path: ${REQUEST_PATH}
- Total ACs: ${TOTAL_AC_COUNT} (${NON_QG_COUNT} non-quality-gate)

## Acceptance Criteria (non-quality-gate only)

${AC_LIST}

## Related Test Files

${TEST_FILE_LIST}

## ⚠️ Important: You must independently research the project ⚠️

When verifying AC-to-evidence traceability, you **must** perform the following research:

### Research Steps

1. Read the request document: `cat ${REQUEST_PATH}`
2. Check project test structure: `ls test/`, `ls test/unit/`, `ls test/integration/`
3. For each AC, search for matching test assertions: `grep -r "relevant keyword" test/ -l | head -10`
4. Read candidate test files: `cat <test path> | head -150`
5. Check for runtime verification results: `grep -r "feature-verify" docs/ -l | head -5`
6. Search for exception annotations in the request doc: `grep -i "exception" ${REQUEST_PATH}`

### Verification Focus

- Does each AC have at least one matching test assertion?
- Are test assertions covering the AC behavior, not just a function name?
- For manual exceptions: is the reason class valid? Is the expiry future?
- For prohibited domains (Security, Data-integrity, Regression): exceptions are NEVER valid

## Output (all fields required, one entry per non-quality-gate AC)

For each AC:
- ac_number: <N>
- ac_text: <text>
- evidence_type: automated_test | runtime_verification | manual_exception | none
- evidence_location: <file:line or description>
- confidence: High | Medium | Low
- status: COVERED | EXCEPTION_VALID | EXCEPTION_INVALID | UNCOVERED | INCONCLUSIVE
- reasoning: <why this status — cite specific test file/line or exception details>

For each manual exception:
- exception_verdict: VALID_EXCEPTION | INVALID_EXCEPTION
- reason_class: <ENV_UNAVAILABLE | UNSAFE_TO_AUTOMATE | ONE_TIME_MIGRATION | INVALID>
- expiry: <ISO 8601 date or MISSING>
- domain_check: <ALLOWED | PROHIBITED>

Final summary:
- gaps: [list of uncovered AC numbers]
- exception_count: <N> / <cap>

Then end the report with exactly one unbulleted gate line, alone as the final line:
gate: Adequate | Adequate_with_exceptions | Need_Human | Inadequate

## Anti-Anchoring Enforcement

Per `@rules/codex-invocation.md`:

| Check | Required |
|-------|----------|
| Prompt does NOT contain Claude's evidence mapping conclusions | ✅ |
| Prompt does NOT ask "is this mapping correct?" | ✅ |
| Prompt includes "independently research" section | ✅ |
| Initial verification uses a fresh thread (§ Start); re-verification uses § Resume | ✅ |
| Sandbox and approval policy are the transport's to pin, and are not restated here | ✅ |

## AC List Formatting

Provide only the raw AC text with checkbox state. Do NOT include Claude's evidence analysis:

```
1. [ ] User login returns JWT
2. [x] Rate limit at 100 req/min
3. [ ] XSS sanitization
```

## Continue Review Prompt

Dispatched per `@skills/codex-code-review/references/codex-transport.md` § Resume when re-verifying after gap closure — same thread only.
Rotation: per the central contract (`skills/codex-code-review/references/review-common.md`
§ Review Loop — Thread Rotation), at the R-a threshold (3 replies on this thread;
`## Review Thread Rotation` override, 2–6) or on R-b judged context overrun, dispatch the initial
verification prompt above on a **new** thread instead — no old findings fed; reconcile
orchestration-side; record `[THREAD_ROTATED]`.

Raw → public mapping: the raw `gate:` line this prompt requires is what
`scripts/validate-family-sentinel.js test:ac-trace` validates (for any carrier — Codex or
fallback); the public sentinels (`✅ Adequate` …) are derived from it exclusively by
`../SKILL.md` § Step 6, never emitted raw by the reviewer.

ACs were updated. Please re-verify evidence traceability.

## Updated AC List

${UPDATED_AC_LIST}

## Changes Since Last Review

${DIFF_SUMMARY}

Check: Did gap closure introduce new evidence? Did fixes introduce new issues?

Re-output the full AC traceability matrix and updated gate.
