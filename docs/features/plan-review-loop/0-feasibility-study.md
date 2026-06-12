# Feasibility Study: Plan-Review-Loop — Pre-ExitPlanMode Codex Review Gate

> **Doc class**: Lifecycle — Phase 0 feasibility study (per [`rules/docs-numbering.md`](../../../rules/docs-numbering.md)).
> **Created**: 2026-05-15
> **Canonical requirements**: [`./1-requirements.md`](./1-requirements.md)
> **Codex debate threadId**: `019e298f-3645-7801-b6ff-b60b8d1235e6`

## 1. Requirement Decomposition

Consumed from canonical [`1-requirements.md`](./1-requirements.md) §1 + §5; this study does **not** redecompose problem space. Three driver requirements anchor the feasibility evaluation:

| Anchor | Source FR/NFR | Implication for feasibility |
|--------|---------------|------------------------------|
| Plan must reach user only after review converges | FR-4 | Triggering mechanism must guarantee ordering between review and plan delivery |
| Plan-review state must not pollute existing review state | FR-6 / NFR-7 | State carrier and sentinel naming are first-class design axes |
| Reviewer failure must degrade gracefully | NFR-3 | Architecture must support a deterministic fall-through path that still delivers plan |

The 11 Open Questions in §9 of the requirements doc cluster around three strongly coupled architectural axes (A/B/C below); the remaining items (default mode, budget config, trail noise, dual-review trigger, `/codex-review-doc` boundary, plateau detection) are policy- or implementation-level and resolved derivatively. A 1:1 disposition mapping is given in §8.

## 2. Constraint Inventory

| Type | Constraint | Flexibility | Source |
|------|------------|-------------|--------|
| Hard | `ExitPlanMode` is harness-provided; not in plugin scope | None | `grep -rn ExitPlanMode` → only this feature's lifecycle docs |
| Hard | Existing `PreToolUse` matcher covers only `Edit\|Write` | Extensible, but harness behavior on `ExitPlanMode` matcher is unverified | [`hooks/hooks.json:32-41`](../../../hooks/hooks.json) |
| Hard | `rules/codex-invocation.md` mandates independent research / no feeding conclusions | None | [`rules/codex-invocation.md`](../../../rules/codex-invocation.md) |
| Assumption | Plan mode is read-only w.r.t. `Edit\|Write`; MCP and Skill calls are believed to remain available | Soft — needs smoke test before §7 recommendation is fully de-risked; tracked as OQ-Sx-2 in §8 | Inferred from harness UX; not yet confirmed by executable contract |
| Soft | `.claude_review_state.json` schema currently has `code_review`, `doc_review`, `precommit`, `aggregate_gate`, root `iteration_history` | Schema-extensible with migration | [`hooks/post-tool-review-state.sh:133`](../../../hooks/post-tool-review-state.sh) |
| Soft | MCP sentinel routing already discriminates via `## Document Review` header before `✅ Mergeable` to avoid sentinel collision | Pattern extensible | [`hooks/post-tool-review-state.sh:684`](../../../hooks/post-tool-review-state.sh) |
| Soft | `auto-loop-project.md` exposes only `Max Rounds`, `Git Memory`, `Think Harder` config points | New config point possible but non-standard | [`rules/auto-loop-project.md`](../../../rules/auto-loop-project.md) |

## 3. Code Research

Verified primitives that any implementation **must** reuse or coexist with:

| Primitive | Reuse posture | Reference |
|-----------|---------------|-----------|
| `.claude_review_state.json` (lock-protected, schema-versioned, compact-resume aware) | Extend with namespaced field | [`hooks/post-tool-review-state.sh`](../../../hooks/post-tool-review-state.sh) |
| MCP sentinel routing pattern (`## <Header> + ✅/⛔ <Verb>`) | Mirror for plan-specific header | [`hooks/post-tool-review-state.sh:684-690`](../../../hooks/post-tool-review-state.sh) |
| `emit-review-gate.sh` PENDING/READY/BLOCKED contract | Extend or mirror for plan tier | [`scripts/emit-review-gate.sh`](../../../scripts/emit-review-gate.sh) |
| `skills/doc-review/SKILL.md` Codex loop + `threadId` continuation | Adopt loop topology | [`skills/doc-review/SKILL.md:48`](../../../skills/doc-review/SKILL.md) |
| `skills/codex-brainstorm/SKILL.md` Nash equilibrium engine (independent research, attack/defense, termination) | Delegate for deep tier | [`skills/codex-brainstorm/SKILL.md:19`](../../../skills/codex-brainstorm/SKILL.md) |
| `rules/auto-loop.md` convergence decision table (max_rounds, plateau, strategic reset) | Reuse rule-level model; plateau requires fingerprint storage not yet implemented in hook | [`rules/auto-loop.md`](../../../rules/auto-loop.md) |
| `stop-guard.sh` aggregate-gate awareness | Extend to recognize plan gate | [`hooks/stop-guard.sh`](../../../hooks/stop-guard.sh) |

**Confirmed negatives** (search returned nothing — clean namespace):

- `grep -rn "plan_review\|REVIEW_PLAN_GATE\|Plan Ready"` in `hooks/` `scripts/` `skills/` → no hits
- `ExitPlanMode` not referenced anywhere outside this feature's own lifecycle docs (`0-feasibility-study.md` + `1-requirements.md`)

## 4. Solution Exploration

Three axes; each is a real fork in the architecture. Options derived from §9 of [`1-requirements.md`](./1-requirements.md).

### Axis A — Triggering mechanism

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A1 | Skill-driven: `/plan-review` self-invoked by Claude in plan mode before `ExitPlanMode` | No `ExitPlanMode` PreToolUse dependency; full orchestration control; degrades cleanly when harness shifts | Trigger relies on rule + skill enforcement, not contract |
| A2 | PreToolUse hook intercepts `ExitPlanMode` | Hard gate at tool boundary | Harness PreToolUse semantics on `ExitPlanMode` unverified; hook cannot orchestrate model-mediated review; depends on harness retry behavior |
| A3 | Hybrid: A1 primary + hook tripwire as audit | Catches Claude self-invocation drift | Tripwire produces telemetry, not enforcement — see §5 debate |

### Axis B — Review state carrier

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| B1 | Extend `.claude_review_state.json` with `plan_review` field + own `iteration_history` sub-tree | Reuses the state-file integration surface (lock / migration / compact-resume); Stop Hook support is a v1 work item, not a free-lunch property | Schema migration cost (additive) |
| B2 | Separate `.claude_plan_state.json` file | Full isolation | Duplicates lock, migration, compact-resume, stop-guard, user-prompt reminder logic |
| B3 | Reuse `doc_review` field + sentinel discriminator | No schema change | Violates NFR-7 isolation; false-positive risk (prior `/codex-review-doc` can satisfy plan gate by accident) |

### Axis C — Depth tier & relationship with `/codex-brainstorm`

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| C1 | Inline 3-tier (quick / standard / deep); deep implements own adversarial debate | All logic in one skill | Duplicates `/codex-brainstorm`; prompt / termination drift |
| C2 | Quick / standard internal; deep delegates to `/codex-brainstorm` | Reuses Nash equilibrium engine; same precedent as `necessity-audit` deep tier | Composition complexity; tier-detection heuristic must be specified |
| C3 | Single fixed tier | Simplest | No escalation path; over-reviews simple plans, under-reviews complex ones |

## 5. Codex Discussion Record (Nash Equilibrium)

**threadId**: `019e298f-3645-7801-b6ff-b60b8d1235e6`

### Round 0 — Independent positions

| Side | Position | Core argument |
|------|----------|---------------|
| Claude | **A1 + B1 + C2** | PreToolUse on `ExitPlanMode` unverified; B3 collides with `doc_review`; `/codex-brainstorm` already ships Nash engine |
| Codex | **A3 + B1 + C2** | Skill primary, hook as tripwire for audit trail; B1/C2 identical to Claude |

### Round 1 — Claude attacks A3

| # | Attack | Target |
|---|--------|--------|
| 1 | Tripwire produces telemetry only; FR-4 demands review-before-plan, telemetry-after-violation does not satisfy that | Hook value claim |
| 2 | Hook surface expansion (`Edit\|Write` → `Edit\|Write\|ExitPlanMode`) introduces self-suppression race between skill state-write and hook fire | Hook hygiene |
| 3 | "Claude forgot self-invoke" failure mode is symmetric: a Claude that forgot the skill also disregards a non-blocking warning sentinel | Tripwire effectiveness |

### Codex response — concedes A1 for v1

Codex updated position: **A1 for v1**, with A3 promoted only if a future harness smoke test proves all five conditions:

1. PreToolUse can match `ExitPlanMode`
2. Hook receives sufficient `tool_input` to identify outgoing plan
3. Non-zero exit reliably prevents plan delivery
4. Claude receives the denial in a form that triggers `/plan-review` + retry
5. State write ordering is deterministic before subsequent `ExitPlanMode` call

Until any one is unprovable from inside the plugin, A3 ships as dead-or-noisy code.

### Equilibrium

**A1 + B1 + C2** stands. Neither side can attack further; remaining divergence is a v2 follow-up gated by an empirical harness probe, not a v1 design conflict.

## 6. Quantitative Comparison

Scoring against [`@rules/feasibility-study/references/analysis-phases.md`](../../../skills/feasibility-study/references/analysis-phases.md) dimensions (Green / Yellow / Red).

### Axis A — Triggering mechanism

| Dimension | A1 (skill) | A2 (hook) | A3 (hybrid) |
|-----------|------------|-----------|--------------|
| Technical feasibility | 🟡 reuses doc-review loop pattern, **but** plan-mode Skill/MCP availability is unverified (OQ-Sx-2 smoke test is a v1 hard precondition; failure → ⛔ architecture revisit) | 🔴 harness contract unverified | 🟡 inherits A2 unverifiability |
| Effort | 🟢 1-2 person-days | 🟡 3-5 person-days (matcher + block semantics) | 🔴 4-6 person-days (both paths + reconciliation) |
| Risk | 🟡 depends on Claude self-invocation + plan-mode Skill/MCP availability (unverified contract) | 🔴 silent failure if harness rejects | 🟡 partial if probe inconclusive |
| Extensibility | 🟢 trivial to upgrade to A3 later | 🟡 hook-only locks out skill-driven UX | 🟢 superset of A1 |
| Maintenance cost | 🟢 single source of orchestration | 🟡 dual paths to keep in sync | 🟡 dual paths |

### Axis B — State carrier

| Dimension | B1 (extend) | B2 (separate file) | B3 (reuse doc_review) |
|-----------|-------------|---------------------|------------------------|
| Technical feasibility | 🟢 schema migration pattern exists | 🟢 trivially possible | 🔴 violates FR-6 / NFR-7 |
| Effort | 🟢 0.5 person-day | 🟡 2 person-days (duplicate infra) | 🟢 0.5 person-day |
| Risk | 🟢 additive migration | 🟡 stop-guard / compact-resume must learn new file | 🔴 false passes from prior doc reviews |
| Extensibility | 🟢 same patterns as code/doc | 🟢 isolated | 🔴 collapses on first locale collision |
| Maintenance cost | 🟢 single state file | 🟡 two carriers | 🔴 ambiguous ownership |

### Axis C — Depth tier

| Dimension | C1 (inline) | C2 (delegate deep) | C3 (fixed) |
|-----------|-------------|---------------------|-------------|
| Technical feasibility | 🟡 reimplement Nash engine | 🟢 reuses `/codex-brainstorm` | 🟢 no tier logic |
| Effort | 🔴 5+ person-days | 🟢 1-2 person-days | 🟢 1 person-day |
| Risk | 🔴 prompt/termination drift vs brainstorm | 🟢 single source of truth | 🟡 deep plans under-reviewed |
| Extensibility | 🟡 own escalation path | 🟢 inherits brainstorm upgrades | 🔴 no upgrade path |
| Maintenance cost | 🔴 two adversarial engines | 🟢 shared engine | 🟢 minimal |

## 7. Recommendation

**Architecture for v1: A1 + B1 + C2**.

### Rationale (one paragraph)

FR-4 requires that the user does not see the plan before review converges. A1 is the **best-effort enforceable** option without depending on an unverified harness contract: Claude orchestrates the loop via a `/plan-review` skill before calling `ExitPlanMode`, with `auto-loop.md`-style rules + Stop Hook reinforcement raising self-invocation compliance toward — but not provably equal to — 100 %. **FR-4 honesty note**: under A1, FR-4 is satisfied at the *review-conclusion* layer (plan with unresolved P0/P1 is never delivered, because Claude only calls `ExitPlanMode` after `✅ Plan Ready`) but not at the *tool-boundary* layer (a Claude that forgets the skill could bypass review). The plugin's `auto-loop` + Stop Hook stack is the practical mitigation; the OQ-Sx-1 harness probe (deferred to v2) is the only way to upgrade to tool-boundary enforcement. Hard enforcement (A2 / A3) is therefore explicitly deferred to v2 pending that probe. Extending the existing review state file (B1) reuses lock, migration, and compact-resume infrastructure with a namespaced `plan_review.*` field that cannot collide with `code_review` / `doc_review` / `aggregate_gate`; `stop-guard.sh` does **not** recognize plan sentinels today and must be extended (tracked as a v1 work item, not a free-lunch property). Delegating the deep tier to `/codex-brainstorm` (C2) avoids duplicating an adversarial debate engine that the plugin already ships and trusts.

### V1 hard preconditions

Before any v1 implementation begins, the following must clear:

| Precondition | Outcome required | Source |
|--------------|-------------------|--------|
| OQ-Sx-2 plan-mode MCP/Skill smoke test | Codex MCP + Skill invocations confirmed available inside plan mode | Required for A1 to be implementable at all |
| Stop Hook extension design | `stop-guard.sh` recognizes plan-review sentinels and aggregate state | Required for FR-6 / NFR-7 isolation guarantees |

OQ-Sx-1 (PreToolUse on ExitPlanMode) remains v2-only; it is not a v1 precondition.

### Backup option

If the harness probe (see §8) shows PreToolUse can block `ExitPlanMode`, promote architecture to **A3 + B1 + C2** in v2. State carrier and tier choices are unchanged — only the trigger surface gains a hook tripwire.

### Concrete v1 design contract

| Element | Decision |
|---------|----------|
| Trigger | `/plan-review` skill, self-invoked by Claude in plan mode |
| State field | `.claude_review_state.json.plan_review` (namespaced, with own `iteration_history`) |
| Sentinels (plan-only namespace) | `## Plan Review`, `✅ Plan Ready`, `⛔ Plan Blocked`, `⚠️ Plan Needs Human`, `[PLAN_REVIEW_DEGRADED]` |
| Gate emission | New `scripts/emit-plan-gate.sh` (or extend `emit-review-gate.sh` with namespace flag) |
| Tier ladder | quick (1-pass) → standard (loop) → deep (`/codex-brainstorm` delegate) |
| Convergence | Reuse rule-level convergence decision table from `rules/auto-loop.md`, but plan-review owns its own `iteration_history` and does **not** consume code/doc `total_rounds_session` |
| Bypass | Skill flag `--skip-review` + user explicit "skip review" detection |
| Degrade | Reviewer unavailable → mark `plan_review.degraded=true`, emit `[PLAN_REVIEW_DEGRADED]`, proceed to ExitPlanMode |
| Forbidden | Plan-review must never emit bare `✅ Ready` / `✅ Mergeable` / `## Gate: ✅` (collides with code/doc/aggregate routing) |

## 8. Remaining Open Questions — 1:1 Disposition

All 11 Open Questions from [`1-requirements.md` §9](./1-requirements.md#9-open-questions) are addressed below. Disposition values:

- **Resolved** — answered by §7 recommendation
- **Tech-spec** — must be resolved before implementation (gates v1)
- **V2** — explicitly deferred; not blocking v1
- **Post-merge** — documentation / UX polish iterable after v1 ships

| # | Requirements OQ (source) | Disposition | How addressed |
|---|--------------------------|-------------|---------------|
| OQ-1 | 觸發機制（skill / hook / hybrid） | **Resolved** | §7 → A1 (skill-driven); A3 v2-gated on OQ-Sx-1 |
| OQ-2 | Plan artifact 可見性 | **Resolved** | §7 → skill mediates plan text (Claude has plan in context); Codex prompt framing detail in OQ-Sx-5 |
| OQ-3 | Default 啟用 vs opt-in | **Tech-spec** | Default proposal: opt-in initially; promote to opt-out after 2-week pilot |
| OQ-4 | Review trail 訊噪比 (UC-3 vs NFR-4) | **Tech-spec** | Default proposal: summary block (rounds / findings count / modified-sections); `--verbose` = round-by-round |
| OQ-5 | Auto-loop 預算共享 / 隔離 | **Resolved** | §7 → independent `plan_review.iteration_history`; does not consume `total_rounds_session` |
| OQ-6 | State scope: per-session vs per-plan | **Tech-spec** | Default proposal: per-plan reset; `plan_review.history[]` keeps last-5 trails |
| OQ-7 | Dual-review trigger (FR-8 always vs deep tier) | **Tech-spec** | Default proposal: deep tier only (dual-review's marginal benefit is low on short plans); revisit if pilot shows false-negative rate elevated |
| OQ-8 | 與 `/codex-brainstorm` 的關係 / 深度光譜 | **Resolved** | §7 → C2 delegated; quick / standard inline, deep delegates |
| OQ-9 | Plateau / fingerprint 偵測可行性 | **V2** | Requires hook-level fingerprint storage (not yet implemented); v1 honors only `max_rounds` + plateau row 3 of rule-level decision table is unreachable until storage lands |
| OQ-10 | Plan-review 預算配置點 | **Tech-spec** | Default proposal: new `## Plan Review Max Rounds` block in `auto-loop-project.md`, default 5 |
| OQ-11 | 與 `/codex-review-doc` 的邊界 | **Resolved** | Boundary axiom: `/plan-review` reviews in-context plan drafts produced inside plan mode; `/codex-review-doc` reviews `.md` files on disk. Different trigger (pre-ExitPlanMode vs ad-hoc), different artifact (in-context text vs filesystem path), different repair model (Claude auto-revise vs human-revise). No reuse of `doc_review` state field |

**Additional spike items (not in requirements §9, surfaced by feasibility):**

| # | Question | Disposition | Notes |
|---|----------|-------------|-------|
| OQ-Sx-1 | Harness `PreToolUse` smoke test on `ExitPlanMode` | **V2** | Required to promote A1 → A3; spike ticket; not blocking v1 |
| OQ-Sx-2 | Plan-mode availability of MCP / Skill invocations (Codex MCP, `/plan-review`, `/codex-brainstorm`) | **Tech-spec — hard precondition** | If unavailable, A1 is not implementable; escalate to ⛔ architecture revisit |
| OQ-Sx-3 | `stop-guard.sh` extension to recognize plan-review sentinels and aggregate state | **Tech-spec — hard precondition** | Required for FR-6 / NFR-7 isolation guarantees |
| OQ-Sx-4 | Tier auto-detection heuristic | **Tech-spec** | Default proposal: `standard` always; explicit upgrade for deep |
| OQ-Sx-5 | Codex prompt framing for plan artifact handover | **Tech-spec** | Plan text passed as "candidate artifact to attack" per `rules/codex-invocation.md`; never "Claude's conclusion to confirm" |

## 9. Verification

- [x] 5-Why decomposition consumed from canonical `1-requirements.md`
- [x] Constraints inventoried with flexibility ratings
- [x] Existing code researched (grep / Read confirmed primitives + clean namespace)
- [x] Three solution options explored per axis with quantitative scoring
- [x] Codex discussion executed with independent research and adversarial rounds; equilibrium reached at R1 via convergence
- [x] Comparison table + recommendation + backup + open questions

## 10. References

- Canonical requirements: [`./1-requirements.md`](./1-requirements.md)
- Sibling lifecycle docs: [`docs/features/dual-reviewer/2-tech-spec.md`](../dual-reviewer/2-tech-spec.md), [`docs/features/codex-review-spec/1-requirements.md`](../codex-review-spec/1-requirements.md)
- Reused skills: [`skills/codex-brainstorm/SKILL.md`](../../../skills/codex-brainstorm/SKILL.md), [`skills/doc-review/SKILL.md`](../../../skills/doc-review/SKILL.md), [`skills/codex-code-review/SKILL.md`](../../../skills/codex-code-review/SKILL.md)
- Loop primitives: [`hooks/post-tool-review-state.sh`](../../../hooks/post-tool-review-state.sh), [`hooks/stop-guard.sh`](../../../hooks/stop-guard.sh), [`scripts/emit-review-gate.sh`](../../../scripts/emit-review-gate.sh)
- Rules: [`rules/auto-loop.md`](../../../rules/auto-loop.md), [`rules/codex-invocation.md`](../../../rules/codex-invocation.md), [`rules/auto-loop-project.md`](../../../rules/auto-loop-project.md), [`rules/docs-numbering.md`](../../../rules/docs-numbering.md)
- Codex debate threadId: `019e298f-3645-7801-b6ff-b60b8d1235e6`
