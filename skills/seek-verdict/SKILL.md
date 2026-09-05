---
name: seek-verdict
allowed-tools: Bash(node:*), Bash(git:*), Read, Grep, Glob, Write
description: "Independent second-opinion verification for any finding. Use when: Claude or user wants independent Codex verification of a review finding — dismiss (false positive check), confirm (does this issue exist?), or clarify (what's the impact?). Triggers: dismiss verification, seek verdict, verify dismiss, false positive check, second opinion, confirm finding, clarify impact. Not for: general code review (use codex-code-review), architecture debates (use codex-brainstorm). Output: [DISMISS_VERDICT] or [SEEK_VERDICT] audit trail with verdict, confidence, and evidence refs."
---

# seek-verdict: Independent Second-Opinion Verification

## When NOT to Use

- General code review (use `/codex-review-fast`)
- Architecture debates (use `/codex-brainstorm`)
- Nit findings with no dismiss intent (use `[NIT_DEFERRED]`)

## Intent x Severity

| Intent | Purpose | Eligible Severities | Output Token |
|--------|---------|-------------------|-------------|
| `dismiss` | Is this a false positive? | All (P0/P1/P2/Nit) | `[DISMISS_VERDICT]` |
| `confirm` | Does this issue actually exist? | All | `[SEEK_VERDICT]` |
| `clarify` | What's the actual impact? | All | `[SEEK_VERDICT]` |

**Default intent**: `dismiss` (backward compatible with v1).

### Dismiss Authorization

| Severity | Authorization | Gate |
|----------|-------------|------|
| P0 | `DISMISS_CANDIDATE` | Human confirmation required |
| P1 | `DISMISS_CANDIDATE` | Human confirmation required |
| P2 | `DISMISS_VERIFIED` | Automated |
| Nit | `DISMISS_VERIFIED` | Automated |

P0/P1 dismiss produces a candidate, not a final authorization. See [Policy Mapping](references/policy-mapping.md) for human gate protocol.

## 3-Phase Protocol

```mermaid
sequenceDiagram
    participant C as Claude
    participant S as seek-verdict
    participant X as Codex (fresh thread)

    C->>S: Finding + intent + severity
    Note over S: Phase A: Candidate Packaging
    S->>S: Extract finding_packet<br/>(no Claude conclusions)
    S->>X: Phase B: Blind Independent Verdict
    Note over X: Independent research<br/>git status / grep / cat
    X-->>S: verdict + confidence + evidence
    Note over S: Phase C: Policy Mapping (intent x severity)
    alt intent=dismiss + P2/Nit
        S-->>C: DISMISS_VERIFIED / FIX_REQUIRED (automated)
    else intent=dismiss + P0/P1
        S-->>C: DISMISS_CANDIDATE + Need Human (human gate)
    else intent=confirm/clarify
        S-->>C: [SEEK_VERDICT] informational result
    end
```

### Phase A: Candidate Packaging

Extract finding artifact from review output:

| Field | Source |
|-------|--------|
| `finding_key` | `file + canonical_issue_text` |
| `severity` | `<P0 \| P1 \| P2 \| Nit>` |
| `intent` | `<dismiss \| confirm \| clarify>` |
| `original_finding_text` | Codex review original (secrets redacted) |
| `origin_thread_id` | Review session threadId |
| `current_head_sha` | `git rev-parse HEAD` |
| `relevant_diff` | `git diff HEAD -- <file>` |

**Critical**: Record Claude's hypothesis locally. **Never send it to Codex.**

### Phase B: Blind Independent Verdict

Use the prompt template in [Verdict Prompt](references/verdict-prompt.md).

| Requirement | Detail |
|-------------|--------|
| Thread | **Fresh** — dispatch per `@skills/codex-code-review/references/codex-transport.md` § Start (never reuse a review thread) |
| Anti-anchoring | No Claude conclusions in prompt |

### Phase C: Policy Mapping

Apply thresholds from [Policy Mapping](references/policy-mapping.md).

**Dismiss intent**: graduated thresholds by severity (P0: 0.95/4, P1: 0.90/3, P2: 0.80/2, Nit: 0.70/1).

**Confirm intent**: ACTIONABLE->CONFIRMED, NON_ACTIONABLE->DISPUTED, low confidence->UNCERTAIN.

**Clarify intent**: HIGH_IMPACT / LOW_IMPACT / UNCERTAIN.

Output audit trail per [Policy Mapping](references/policy-mapping.md).

## Rebuttal

When Phase C maps the verdict to `FIX_REQUIRED` (raw `ACTIONABLE` at or above the confidence
floor — `FIX_REQUIRED` is the mapping's word, never Codex's) and Claude has objective
counter-evidence:

- **1 round max** via § Resume (same verdict thread)
- Only objective artifacts (tests, specs, language semantics)
- The rebuttal names Codex's own verdict, `ACTIONABLE`, not the mapped result
- After rebuttal: map the new answer again — still `FIX_REQUIRED` -> fix; ambiguous -> `NEED_HUMAN`

## Anti-Abuse Guard

See [Policy Mapping](references/policy-mapping.md) for full rules.

- **Dismiss**: 3 consecutive `DISMISS_VERIFIED` -> `[DISMISS_PATTERN_WARN]` + heightened thresholds
- **Confirm/Clarify**: per-finding cap (1 confirm + 1 clarify per finding per commit)
- Session end or branch switch resets all counters

## Output

**Dismiss intent**:

```
[DISMISS_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | verdict=<DISMISS_VERIFIED|DISMISS_CANDIDATE|FIX_REQUIRED|NEED_HUMAN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601> | intent=dismiss | authorization=<automated|human-required|human-confirmed>
```

**Confirm/Clarify intent**:

```
[SEEK_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | intent=<confirm|clarify> | verdict=<CONFIRMED|DISPUTED|HIGH_IMPACT|LOW_IMPACT|UNCERTAIN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601>
```

## Verification

- [ ] Intent is valid (`dismiss` / `confirm` / `clarify`)
- [ ] Codex prompt contains no Claude conclusions (anti-anchoring)
- [ ] Fresh Codex thread used (not review session thread)
- [ ] Correct audit trail token output (`[DISMISS_VERDICT]` or `[SEEK_VERDICT]`)
- [ ] P0/P1 dismiss produces `DISMISS_CANDIDATE` + human gate (never auto-dismiss)
- [ ] Anti-abuse streak tracked (dismiss) / per-finding cap enforced (confirm/clarify)

## References

| File | Purpose |
|------|---------|
| [Verdict Prompt](references/verdict-prompt.md) | Codex blind verification prompt template |
| [Policy Mapping](references/policy-mapping.md) | Intent x severity thresholds, audit format, anti-abuse |
