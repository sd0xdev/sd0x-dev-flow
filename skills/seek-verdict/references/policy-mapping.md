# Policy Mapping (v2)

## Dismiss Intent — Graduated Thresholds

| Severity | Confidence | Evidence | Result | Authorization |
|----------|-----------|----------|--------|---------------|
| P0 | >= 0.95 | >= 4 refs | `DISMISS_CANDIDATE` | **Human confirmation required** |
| P1 | >= 0.90 | >= 3 refs | `DISMISS_CANDIDATE` | **Human confirmation required** |
| P2 | >= 0.80 | >= 2 refs | `DISMISS_VERIFIED` | Automated |
| Nit | >= 0.70 | >= 1 ref | `DISMISS_VERIFIED` | Automated |
| Any | ACTIONABLE >= 0.70 | any | `FIX_REQUIRED` | Return to fix loop |
| Any | UNCERTAIN / low | any | `NEED_HUMAN` | Stop, escalate |

**Asymmetric threshold**: dismiss threshold increases with severity because false negative (missing a real issue) cost scales with severity.

### P0/P1 Human Gate Protocol

`DISMISS_CANDIDATE` is never auto-authorized. Conversion flow:

1. seek-verdict outputs `DISMISS_CANDIDATE` + structured evidence
2. Model emits `⚠️ Need Human` (auto-loop exit condition, stops automated flow)
3. User confirms "confirm dismiss" or "fix it" in next prompt
4. If confirm -> model logs `[DISMISS_VERDICT]` with `verdict=DISMISS_VERIFIED` + `authorization=human-confirmed`
5. If reject -> return to fix loop

**Constraints**:
- `DISMISS_CANDIDATE` can **never** auto-convert to `DISMISS_VERIFIED` (even at confidence=1.0)
- Human confirmation must occur in the **same session's subsequent prompt** (not cross-session)
- Confirmation record must include `confirmed_by=human` + `confirmation_prompt_hash=<SHA256 of user message>`

## Confirm Intent — Mapping

| Codex Verdict | Confidence | Result |
|---------------|-----------|--------|
| ACTIONABLE | >= 0.70 | `CONFIRMED` |
| NON_ACTIONABLE | >= 0.70 | `DISPUTED` |
| UNCERTAIN / low confidence | any | `UNCERTAIN` |

## Clarify Intent — Mapping

Read from the dispatch's `impact_assessment` field — the one `verdict-prompt.md` § Output requires a
`clarify` dispatch to fill in. `codex_verdict` does not answer this question and never did: it says
whether the finding is actionable, which is the other axis.

| `impact_assessment` | Confidence | Result |
|---------------------|-----------|--------|
| `HIGH_IMPACT` — broad or critical reach | >= 0.70 | `HIGH_IMPACT` |
| `LOW_IMPACT` — narrow or negligible reach | >= 0.70 | `LOW_IMPACT` |
| `UNCERTAIN`, or below the confidence floor | any | `UNCERTAIN` |
| `NOT_ASSESSED` — the dispatch was not a clarify | any | `UNCERTAIN`, and say the intent was mismatched |

Confirm/clarify intents are **informational only** — they produce no dismiss authorization and do not create exceptions in `fix-all-issues.md`.

## Audit Trail Format

**Dismiss intent** (backward compatible — new fields additive at line end):

```
[DISMISS_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | verdict=<DISMISS_VERIFIED|DISMISS_CANDIDATE|FIX_REQUIRED|NEED_HUMAN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601> | intent=dismiss | authorization=<automated|human-required|human-confirmed>
```

**Confirm/Clarify intent** (new token):

```
[SEEK_VERDICT] key=<file|canonical_issue> | severity=<P0-Nit> | intent=<confirm|clarify> | verdict=<CONFIRMED|DISPUTED|HIGH_IMPACT|LOW_IMPACT|UNCERTAIN> | confidence=<0..1> | codex_thread=<id> | evidence=<brief> | timestamp=<ISO8601>
```

**Backward compat**: `intent=` and `authorization=` are appended at line end. v1 parsers using `|` split + key lookup ignore unknown keys. No version header needed.

### Redaction Rules

| Field | Policy |
|-------|--------|
| `key` | Keep file path + issue summary (<= 120 chars); remove code snippets |
| `evidence` | File:line references only; no source code content |
| `finding_packet.relevant_diff` | Send to Codex unredacted; **never record in audit log** |
| All fields | No secrets/tokens/passwords/API keys (per `rules/logging.md`) |

**Retention**: `[DISMISS_VERDICT]` and `[SEEK_VERDICT]` are session output only, not persisted to filesystem. If persistence needed, follow `.gitignore` policy.

## Anti-Abuse Guard

**Session scope**: "session" = single Claude Code conversation. Branch switch or new conversation resets counters.

### Dismiss Streak (dismiss intent only)

| Condition | Action |
|-----------|--------|
| 3 consecutive `DISMISS_VERIFIED` in same session | Emit `[DISMISS_PATTERN_WARN]` |
| Warning state: subsequent dismiss attempts | Heightened thresholds: +0.05 confidence, +1 evidence |
| Session end or branch switch | Reset streak counter |

```
[DISMISS_PATTERN_WARN] streak=<N> | scope=all-severity | reason=systematic-over-dismiss-risk | action=heightened-scrutiny | timestamp=<ISO8601>
```

### Heightened Threshold Table

| State | P0 | P1 | P2 | Nit |
|-------|----|----|----|----|
| Normal | 0.95 / 4 refs | 0.90 / 3 refs | 0.80 / 2 refs | 0.70 / 1 ref |
| After warning | 1.00 / 5 refs | 0.95 / 4 refs | 0.85 / 3 refs | 0.75 / 2 refs |

### Per-Finding Cap (confirm/clarify intents)

| Condition | Action |
|-----------|--------|
| Same finding + same commit + same intent already executed once | Reject (max 1 per intent per finding per commit) |

**Counter key**: `finding_key + current_head_sha + intent` — same finding on same commit, same intent = max 1. This means each finding can have at most 1 confirm + 1 clarify per commit.

**Reset rules**:

| Event | Effect |
|-------|--------|
| New commit (`head_sha` change) | Reset all per-finding counters |
| Branch switch | Reset all counters |
| Session end | Reset all counters |

## Rebuttal Mechanism

When this table maps Codex's raw `ACTIONABLE` to `FIX_REQUIRED` and Claude has counter-evidence.
The trigger is the **mapped** result: `verdict-prompt.md` § Output lets Codex return only
`ACTIONABLE`, `NON_ACTIONABLE` or `UNCERTAIN`, so a rebuttal waiting for Codex to say
`FIX_REQUIRED` would wait forever:

| Rule | Detail |
|------|--------|
| Max rounds | **1 round only** |
| Channel | `@skills/codex-code-review/references/codex-transport.md` § Resume (same verdict thread) |
| Allowed content | Objective artifacts: tests, specs, language semantics |
| Prohibited content | "Please confirm me", opinion-based arguments |
| After rebuttal | Map the new raw answer again: still `FIX_REQUIRED` -> fix; still ambiguous -> `NEED_HUMAN` |
