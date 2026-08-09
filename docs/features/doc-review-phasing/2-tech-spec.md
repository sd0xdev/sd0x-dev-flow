# Doc Review Phasing — Tech Spec

> Status: Draft (planning approved via /codex-brainstorm Nash equilibrium, 2026-08-08)
> Scope: doc-plane review scoping, phase derivation, instrumentation, producer repair
> Origin: adversarial Claude+Codex debate — 3 rounds, 10 attacks, both initial positions revised

## 1. Problem

The doc plane burns review rounds out of proportion to what changed. A 3-line edit to a
500-line document triggers a whole-document, five-dimension review; each fix re-opens the
gate and the next round re-reads the whole file. Measured state of the corpus:

| Metric | Value |
|--------|-------|
| `docs/**/*.md` | 255 files / 46,138 lines |
| Tech specs (`2-tech-spec*.md`) | 59 files / 22,518 lines (48.8% of corpus; median 397 lines) |
| Request docs | 143 files / 12,261 lines (26.6%) |
| Closed-but-unarchived requests | 61 files / 4,845 lines (only 3 requests actually archived) |
| Feature docs added / deleted over 488 commits | 241 / 0 |
| Markdown-only commits | 235 of 488 |
| Doc-plane round counter | does not exist (`current_round` is code-only, `post-tool-review-state.sh` §_update_iteration) |

## 2. Root Causes (ranked)

| # | Cause | Evidence |
|---|-------|----------|
| 1 | **Phase-blind reviewer attention** — every doc review reads the full file and must rate 5 dimensions (Architecture / Performance / Security / Quality / Consistency), even post-implementation sync where design was already reviewed on the code plane | `skills/doc-review/references/codex-prompt-doc.md` ("Read the full document"; 5-slot output table) |
| 2 | **Undifferentiated authority space** — closed requests, review logs, and live specs share one namespace; `doc-classifier.js` already excludes `requests/`+`archived/` but `/codex-review-doc` never consults it | `scripts/lib/doc-classifier.js` (classifier exists, unused by review path) |
| 3 | **Unscoped global receipt** — `/codex-review-doc` is single-target; `feature-dev` Doc Sync runs it *per updated file*; a pass writes one boolean with no record of which files were covered | `skills/feature-dev/SKILL.md` § Doc Sync; `doc_review.passed` in state schema |
| 4 | **No write-time budget** — tech specs are routinely produced near 400 lines; completed requests stay live | corpus distribution above |

Additional defect found during research: `/review-spec` emits `✅ Approved / ⚠️ Needs
revision / ❌ Needs redesign` (`skills/review-spec/SKILL.md`), but the hook's doc-plane
parser (`_mcp_doc_review_passed`, `_skill_output_has_verdict`) recognizes only
`✅ Mergeable` / `⛔ Needs revision`. Every documented `/review-spec` outcome — pass or
fail — records **no verdict at all**. The existing test passes only because it feeds the
undocumented `✅ Mergeable` sentinel. Impact is bounded in practice: `/review-spec` is
rarely used — the dominant doc-plane producer is `/codex-review-doc` — so the repair is
folded into Step 3 (where the prompts are rewritten anyway, and aliasing `/review-spec`
onto the shared path dissolves the sentinel mismatch) rather than shipped as its own step.

### Why `/refactor` is not the lever

| Layer | Fact |
|-------|------|
| Signal | `DOC_TOO_LONG` is reachable only via the Cap Diagnostic Protocol, whose three triggers all read the code-only round counter — a doc-only loop never fires it (structurally zero, not "low probability") |
| Tool | For `.md`, `/refactor` dispatches `/doc-refactor`, which **condenses**; `rules/docs-numbering.md` prescribes **splitting** and states no skill performs it |
| Cost | Refactor edits files → gates re-open → up to 3 internal doc rounds per target; `--auto` can select 10 targets |

## 3. Design — One Gate, Two Modes

No new gate. The existing `doc_review` plane, receipt, and sentinel pair
(`✅ Mergeable` / `⛔ Needs revision`) are unchanged. A hook-derived `doc_phase` selects
review dimensions and scope:

| Mode | When | Dimensions | Scope |
|------|------|-----------|-------|
| `spec` | Pre-implementation spec landing; doc-only design work; `/review-spec` always | Full set: completeness, feasibility, architecture, risk, security, testing | Changed/new spec sections |
| `final` | Post-precommit Doc Sync | Exactly two questions: (1) does any reviewed section contradict the implementation? (2) is any affected cross-reference dead? | Changed hunks + enclosing `##` sections + preamble; never whole-file for existing docs; new/untracked files reviewed whole (all lines are new) |

### Phase derivation (producer marker + hook validation, never model-chosen)

State alone cannot discriminate the phase. `precommit.passed && has_code_change &&
review_phase == idle` misclassifies unrelated same-session design work as `final`
(`has_code_change` is session-wide, reset only by `session-init.sh`). A bare
`doc_sync_pending` state token is also insufficient on its own: it would arm on every
precommit pass even when the change maps to no feature docs, and an unrelated doc review
could consume it before the intended sync. And once `/review-spec` shares the MCP path
(Step 3), the nested `mcp__codex__codex` event carries no parent-skill identity, so the
hook cannot see "this request came from `/review-spec`" from the event alone.

The design is therefore **two-factor**: a trusted producer marker in the MCP request,
validated by the hook against a state token — `final` requires both.

| Factor | Mechanism |
|--------|-----------|
| Pre-dispatch resolver | A hook-owned script (`scripts/resolve-doc-phase.sh`) reads the token under the state lock and prints `spec` or `final`. The producer **must call it before assembling the MCP prompt** — the PreToolUse hook only records dispatches (`_record_dispatch_epoch` neither rewrites nor rejects requests), so a prompt built with the wrong depth would otherwise already be delivered by the time the hook sees it. |
| Producer marker | The producer embeds `[DOC_PHASE_REQUEST] <resolved>` in its MCP prompt — `skills/review-spec` always embeds `spec` (no resolver call needed); the `feature-dev` Doc Sync flow embeds the resolver's answer. Producer-owned template text, not a public/model-selected flag. Persisted in the dispatch pin so foreground and background outcomes resolve the same phase. |
| State token | `doc_sync_pending` — set (same locked transaction as the precommit receipt) when precommit passes with `has_code_change`; cleared (same transaction as the owning write) on a `final`-phase doc-gate pass or when a code edit invalidates precommit; reset in the same atomic SessionStart transaction as the other session-scoped fields (`session-init.sh`). |

> **Known gap — the dispatch pin needs a correlation key before Step 2 ships it (flagged 2026-08-09,
> round-22 review of the unrelated receipt-integrity fix in
> `docs/features/auto-loop-evolution/requests/2026-08-08-receipt-integrity-issues-9-10-11.md`).**
> "Persisted in the dispatch pin" above describes a shared, set-if-absent, **per-plane** scalar — the
> same shape as the fingerprint/dispatch-pin mechanism that request deleted (Half B) precisely
> because the hook payload carries no `tool_use_id`-equivalent correlation key. The same hole applies
> here: two concurrent doc dispatches on the same plane, one `spec` and one `final`, cannot be told
> apart by a single per-plane pin — the later one inherits whichever phase the earlier one set,
> which can misclassify a shallow `final` report as `spec` (or the reverse) and satisfy the wrong
> depth of gate. This is an architecture-level decision for whoever implements Step 2, out of scope
> for the receipt-integrity fix that surfaced it: either persist `doc_phase` in the **task-scoped**
> `background_reviews` marker created at handoff (that structure already exists, is keyed by
> `(task, plane)`, and is exactly what the receipt-integrity rework above now reference-counts
> correctly) instead of a shared per-plane scalar, or introduce a genuine correlation key. Resolve
> this before the "dispatch pin" persistence in Step 2's table is implemented as written.

```
marker spec  (or no marker)                              ⇒ spec
marker final && doc_sync_pending == true                 ⇒ final
marker final && doc_sync_pending != true                 ⇒ dispatch poisoned — the
    delivered prompt was too shallow for its authorization, so the verdict is NOT
    recorded (fail-closed, same mechanism as ambiguous-provenance routing) and the
    review re-runs at spec
```

The third arm cannot silently record `spec` — the reviewer already ran the two-question
prompt, so accepting its verdict at any phase would bank a shallow review; poisoning is
the only fail-closed disposition. It is a producer-bug path, not a normal path: the
resolver exists so the prompt is built at the right depth in the first place.

Consequences: an unrelated `/review-spec` or plain `/codex-review-doc` during the sync
window carries no `final` marker, so it neither runs as `final` nor consumes the token; a
token armed by a code change that needs no Doc Sync expires unused (next code edit or
SessionStart reset) without ever downgrading a review; a `final` marker forged outside
the Doc Sync flow still needs the token, and without it the dispatch is poisoned. The
marker sits at the same cooperative-trust boundary as the existing `## Document Review`
header (`post-tool-review-state.sh` § residual-gap comment: trust root is `.claude/`
integrity, adversarial producers are out of scope). Regression cases pinned by test:
(a) code lifecycle done → Doc Sync passes → unrelated design doc edited same session ⇒
`spec`; (b) `/review-spec` while token armed ⇒ dispatched review, emitted `doc_phase`,
and `by_phase` all `spec`; (c) precommit pass with no doc-mapped change → next doc
review ⇒ `spec`, token untouched; (d) final-marked request with token missing/false/
corrupt ⇒ no verdict recorded, re-run required at `spec`; (e) unused token does not
survive SessionStart. Case (b) is exercised at the rule level in Step 2 (an explicitly
`spec`-marked MCP request during an armed window) and end to end against the real
converted `/review-spec` producer in Step 3.

Published as a new `doc_phase=` field in `[AUTO_LOOP_STATE]` — separate from the existing
`phase=` (`review_phase` is the code-plane state machine).

### Guardrails (Anchor-compatible)

| Guardrail | Basis |
|-----------|-------|
| Security / data-integrity change ⇒ full dimension set in either phase | Anchor Register #3 (`thorough` whatever is configured); dropping the Security dimension on such a change would operationally downgrade it |
| Scope narrows what the reviewer *reads*, never *whether* review runs; edits still re-open their plane's gate | Anchor Register #5, #6 |
| Missing/corrupt state ⇒ `spec` | Fail toward the deeper mode |
| No cap ever auto-passes an incomplete review | Existing enforcement model |

## 4. Implementation Roadmap

Each step lands in one review cycle, independently shippable, in this order.

### Step 1 — Doc-plane instrumentation

| | |
|---|---|
| Files | `hooks/post-tool-review-state.sh`, `test/hooks/post-tool-review-state.test.js`, `test/hooks/background-verdict-recovery.test.js` |
| Change | Lazily create `doc_iteration_history` `{dispatches, verdicts, passes, blocks, no_verdict, background_recovered, legacy, by_phase, completed_cycles, last_cycle_rounds, total_rounds_session}`. Count dispatches at the existing PreToolUse doc-dispatch detection (`_record_dispatch_epoch` path); count outcomes at existing routing branches. `legacy` counts direct-Bash verdicts only and is excluded from both `dispatches − verdicts` loss and the ordinary pass/block totals. No caps, no stalls, no blocking. |
| Why first | The complaint is a *rate*; today it is unmeasurable. `dispatches − verdicts` is itself a churn metric (timeouts, sentinel mismatches, lost background tasks are invisible today). Baseline must exist before the causal fix ships. Scope: instrumentation covers MCP producers; verdicts arriving via the legacy direct-Bash routes are recorded under a separate `legacy` outcome excluded from dispatch-loss calculations. |
| AC | Doc dispatch increments counter; each verdict type routes to its field; code-plane counters untouched; lazy creation does not disturb existing state schema tests. |

### Step 2 — Publish `doc_phase`

| | |
|---|---|
| Files | all six emitter hooks — `hooks/post-tool-review-state.sh`, `hooks/post-edit-format.sh`, `hooks/post-skill-auto-loop.sh`, `hooks/post-compact-auto-loop.sh`, `hooks/stop-guard.sh`, `hooks/user-prompt-review-guard.sh` — plus `hooks/session-init.sh`, new `scripts/resolve-doc-phase.sh`, and tests: `test/hooks/auto-loop-state.test.js`, `test/hooks/session-init.test.js`, `test/hooks/post-tool-review-state.test.js`, `test/hooks/post-edit-format.test.js`, `test/hooks/background-verdict-recovery.test.js` |
| Change | Add `doc_phase=spec\|final` per the §3 two-factor rule: ship the pre-dispatch resolver script; parse the `[DOC_PHASE_REQUEST]` producer marker at dispatch, persist it in the dispatch pin, validate `final` against `doc_sync_pending`, and poison the dispatch on a final-marker/token mismatch (no verdict recorded). Token lifecycle: set in the same locked transaction as the precommit receipt (when `has_code_change`); cleared in the same transaction as a `final`-phase doc-gate pass or a code edit's precommit invalidation — never by a `spec`-phase pass; reset in the same atomic SessionStart transaction as the other session-scoped fields (`session-init.sh` today knows nothing of this field — `.claude_review_state.json` persists across sessions, so omitting this leaks stale authorization into the next session). The `_alf_common` emitter block is byte-identical across the six hooks and order-pinned by tests — update all six + the fixed-order test together. Record phase into Step 1's `by_phase`. |
| AC | The five §3 regression cases pinned by test — (a) unrelated same-session design edit ⇒ `spec`; (b) an explicitly `spec`-marked MCP request during an armed window ⇒ `spec` end to end incl. `by_phase` (rule-level only — the real `/review-spec` producer does not exist until Step 3 and its end-to-end case lands there); (c) no-doc-mapped change ⇒ token expires unused; (d) final-marked request with token missing/false/corrupt ⇒ dispatch poisoned, no verdict recorded, delivered-prompt assertion shows full spec dimensions on the re-run; (e) SessionStart resets the token for both existing-state and fresh-state cases. Marker absent/malformed ⇒ `spec`. Background-recovered verdict resolves the pinned phase, not a re-derived one. Byte-identity across six hooks preserved; field order test updated; real-`jq` cases for missing/false/true token state and failed token-clear writes (fail-closed sidecar per existing pattern). |

### Step 3 — Phase-conditioned section review (the causal fix)

| | |
|---|---|
| Files | `skills/doc-review/SKILL.md`, `skills/doc-review/references/codex-prompt-doc.md`, `skills/doc-review/references/review-loop-doc.md`, `skills/review-spec/SKILL.md`, `skills/feature-dev/SKILL.md` (retire the "per updated file" Doc Sync line), `rules/auto-loop.md` (the sentence describing `/review-spec` as the built-in-agent doc producer), `test/hooks/post-tool-review-state.test.js` |
| Change | `spec`: full design dimensions on design-bearing docs. `final`: the two questions only; read changed hunks + enclosing `##` sections + preamble + link-reference definitions; do not `cat` whole existing files; new files reviewed whole. Multiple changed docs: review selected sections together in one dispatch (retire "per updated file" in `feature-dev` Doc Sync). Security/data-integrity or effective `thorough`: full dimensions in either phase, honoring `sensitivity_hint=high`. **`/review-spec` alias-and-repair** (rarely used in practice; dominant producer is `/codex-review-doc`): convert it from an Agent dispatch to the shared `mcp__codex__codex` doc-review path at `spec` depth with the `[DOC_PHASE_REQUEST] spec` marker — the built-in-agent path is invisible to dispatch accounting, and its `Approved/Needs redesign` sentinels are unparseable (§2); the alias dissolves both. Update `allowed-tools`, rewrite the `rules/auto-loop.md` producer sentence, and replace the synthetic Bash-only test with pass **and** fail tests on the real MCP producer shape. |
| AC | Final-phase dispatch reads sections not files; multi-doc change produces one dispatch; sensitive change gets full dimensions; `feature-dev` Doc Sync references the batched form; failing `/review-spec` records `doc_review.passed=false` and passing records `true` via the shared path (`dispatches == verdicts` holds; no `hooks/hooks.json` change — MCP events already observed); §3 regression case (b) end to end against the real converted producer (armed window ⇒ dispatched review, emitted `doc_phase`, and `by_phase` all `spec`); `rules/auto-loop.md` no longer claims the built-in-agent path. |

### Step 4 — Deterministic link/anchor checker

| | |
|---|---|
| Files | new `scripts/check-doc-links.js`, new `test/scripts/check-doc-links.test.js`, `skills/doc-review/SKILL.md`, optionally `package.json` |
| Change | Validate repo-relative Markdown targets + local fragments against GitHub-style heading slugs and explicit HTML anchors; skip external URLs/`mailto:`/templated placeholders. Run *before* the LLM review; feed only failures to the reviewer. (`markdownlint` does not check link resolution.) |
| AC | Dead relative link detected; valid fragment passes; duplicate-heading slugs handled; external URLs skipped; checker is advisory input to review, not a new gate. |

### Step 5 — Measure, then decide on impact machinery

After ~20 completed doc cycles: compare final-phase dispatches/cycle vs Step 1 baseline,
dispatch-to-verdict loss, sections/bytes per dispatch, and blocking findings *outside*
selected sections later found by humans or `/codex-review-branch`. Build the deferred
recall machinery (§5) only if untouched-but-invalidated sections are actually being missed.

### Step 6 — Write-time budgets + lifecycle (separate small patches)

| | |
|---|---|
| Files | `skills/tech-spec/SKILL.md` + template, `skills/create-request/SKILL.md` + template; then request-archive automation |
| Change | `/tech-spec`: target ≤ ~300 active lines; at 400 require a stated cohesion exception or extract reference material; never append review chronology to the canonical design. `/create-request`: target ~100 lines, AC ≤ 8, overwrite progress cells instead of appending rounds, reference the tech spec instead of inlining. On completion, archive the request (link-safe move) or state why it stays live. Migrate the 61 closed-but-unarchived requests as a deliberate, tested migration — not a blind bulk move. |
| AC | New docs conform to budgets; completed request produces archive action or stated reason; migration rewrites inbound links (`grep -rn` sweep per `rules/docs-numbering.md`). |

### Step 7 — Rule text alignment

| | |
|---|---|
| Files | `rules/auto-loop.md` (Cap Diagnostic table), `rules/docs-numbering.md` |
| Change | Stop implying `/refactor --target` performs document *splitting* for `DOC_TOO_LONG` — it condenses. Point the row at condensation (`/doc-refactor`) and manual splitting per `docs-numbering.md`, or defer to Step 5 evidence before building a splitter. |
| AC | No rule names a remedy no tool performs. |

## 5. Deferred (re-entry criteria: Step 5 shows recall failure)

Identifier/symbol extraction, repo-wide authority search, one-hop semantic link traversal,
`covers:` ownership metadata, file/section manifest hashes, scope hashes echoed by
reviewers, receipt consumption by covered section, `DOC_IMPACT_UNRESOLVED`, automatic
chunking. Rationale: this machinery's own delivery cost (a feature folder, a spec, hook
schema surgery, dozens of review rounds) is drawn from exactly the budget it claims to
save; it must be justified by measured recall failure, not anticipated.

## 6. Risks Accepted

| Risk | Bound |
|------|-------|
| Untouched section invalidated by a code change is missed in `final` | Step 5 measures it; deferred machinery is the answer if observed |
| Cross-section contradiction escapes section scope | Same |
| A `final` marker pasted into an ad-hoc review prompt while the token happens to be armed would run as `final` | Cooperative-trust boundary, identical to the existing `## Document Review` header (hook's stated threat model; adversarial producers out of scope); full fix (per-run nonce) is the same deferred item the hook already documents for review provenance generally |
| New 400-line doc is still a 400-line review | Its content is all new; write-time budgets (Step 6) shrink the population |
| Anchor-slug edge cases (Unicode, duplicate headings) | Checker tests pin behavior; advisory-only, so a miss costs one LLM finding, not a gate |
| Semantic security escalation remains partly model-enforced | Effective tier is not persisted today; prompt preserves the escalation obligation and reacts to `sensitivity_hint=high` |

## 7. Non-Goals / Invariants Preserved

- No change to *whether* review runs, gate re-opening, receipt semantics, or sentinel pairs.
- No second gate; `/review-spec` is the spec-depth producer of the existing doc gate.
- No new human exit ("spec not landed" is just an open doc gate).
- `/refactor` trigger probability is deliberately **not** raised.
- Code-plane counters, stall detection, and cap protocol untouched.
