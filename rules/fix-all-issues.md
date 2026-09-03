# Fix All Issues Rule ⚠️ CRITICAL

**Every *owed* in-scope blocking issue gets fixed. "Unrelated", "pre-existing", "no impact", "later" are not reasons — a scope claim counts only as the proven, recorded exit @rules/scope-discipline.md defines, and "pre-existing" alone never removes the obligation: only a proven causal-independence classification followed by a recorded `[OPPORTUNISTIC_DEFERRED]` does.**

This rule bans *excuses*. It does not decide what counts as blocking — `auto-loop.md` § Tiers owns the severity axis and `scope-discipline.md` owns the scope axis. The fix obligation covers **owed in-scope** findings (including `uncertain`, which fail-closed reads as in-scope): `fix_obligation=mandatory` at or above the tier's blocking severity, **plus** every `fix_obligation=admitted` finding at any severity — admission is a commitment taken inside an open fix phase, so it outlives the severity line. An **out-of-scope critical** finding (P0 / security / data-integrity) is *not* fixed under this rule: it routes to human exit E1 — blocked, surfaced, never swept into a repo-wide fix pass and never silently dropped.

## What fixing means

Fix the root cause, not the symptom, and fix it when you find it rather than queueing it. A fix you cannot explain in these terms is not finished:

| | |
|---|---|
| **What** | The specific symptom |
| **Why** | The root cause, not the surface one |
| **How** | The change you made |
| **Prevention** | Which **existing or just-added** control catches this class next time — usually the regression test this fix ships with. An explanation, never an obligation to add another guard artifact |

## Exceptions

| Exception | Condition |
|-----------|-----------|
| User asks to skip | They said so explicitly |
| Beyond current scope | Needs architecture-level change — report and log it, do not silently drop it |
| Out-of-scope per scope-discipline | File-level out-of-scope pre-existing defect, proven by complete negative evidence (`@rules/scope-discipline.md`). Non-critical: logged `[OUT_OF_SCOPE_DEFERRED]` and deferred. Critical (P0 / security / data-integrity): human exit E1 — never silently dropped |
| Third-party library | Cannot modify; document the workaround |
| Below the tier's blocking severity | The gate already passed. Log `[NIT_DEFERRED]` and proceed — see `auto-loop.md` § Sub-Threshold Findings for the two that are still fixed on the spot. **Not available to a `fix_obligation=admitted` finding**: admission makes it owed at any severity, so the gate has not passed |
| Dismiss verified via `/seek-verdict` | Codex independently confirmed NON_ACTIONABLE by blind verification. P2/Nit automated (confidence ≥ 0.80/0.70, evidence ≥ 2/1); P0/P1 needs human confirmation (`DISMISS_CANDIDATE` + user confirm). Thresholds: `skills/seek-verdict/references/policy-mapping.md`. Logged via `[DISMISS_VERDICT]` |
| Skill is analysis-only | The skill declares read-only / analysis-only / plan mode; findings go in the report, not into edits. Logged via `[ANALYSIS_ONLY_DEFERRED]` |
| Opportunistic budget deferral | A proven pre-existing, causally independent, non-critical finding the envelope cannot take: it is closed or exhausted, the footprint does not fit, the breaker tripped, or no mandatory fix phase is open (`@rules/scope-discipline.md` § Resident Guard item 6). Logged via `[OPPORTUNISTIC_DEFERRED]` when at or above the tier's blocking severity; a sub-threshold non-admitted candidate keeps `[NIT_DEFERRED]` (one record per finding, never both). **Never applies** to `origin=in-diff`, branch-introduced, `uncertain`, `change_relation=affected`, P0, security or data-integrity findings — nor to one already `admitted`, which is owed at any severity |

Each of these leaves a record. None of them is "I decided it didn't matter."

## Precedence

Zero tolerance applies to what the tier calls **blocking** among **in-scope, owed** findings (incl. `uncertain` — @rules/scope-discipline.md) — those get fixed, and "not my code" is an excuse only until the scope rule's complete negative evidence proves it. "Owed" is `fix_obligation=mandatory` **at or above the tier's blocking severity**, or `fix_obligation=admitted` at **any** severity — the severity bound applies to `mandatory` alone, exactly as in the preamble above. An out-of-scope **critical** finding still blocks but is routed to E1, not fixed here. In-scope findings below the blocking line are deferred with a `[NIT_DEFERRED]` log — except an `admitted` one, which is owed at any severity; a proven opportunistic candidate the envelope could not take is deferred with `[OPPORTUNISTIC_DEFERRED]` **when at or above the blocking line** and with `[NIT_DEFERRED]` below it (one record per finding, never both); out-of-scope non-critical ones with `[OUT_OF_SCOPE_DEFERRED]` — recordings, not skips: `/codex-review-branch` picks them up when the change is next reviewed at depth.

This rule has never meant "every remark from a reviewer must be actioned before you may stop". Reading it that way is what turned a passing `✅ Ready` gate into another round of work.

When a blocking finding survives repeated fix → re-review cycles, take `auto-loop.md`'s `⚠️ Need Human` exit. Zero tolerance governs the fix *attempt*; the stop decision belongs to auto-loop.
