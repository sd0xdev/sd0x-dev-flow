# Testing Rules

## Test Pyramid

| Type | Directory | Mock Policy | When |
|------|-----------|-------------|------|
| Unit | `test/unit/` (or project convention) | ✅ Any | Isolated logic |
| Integration | `test/integration/` (or project convention) | ⚠️ External only | Cross-module |
| E2E | `test/e2e/` (or project convention) | ❌ Forbidden | Full system |

Execution: Integration/E2E defaults to running a single file only; use `/verify` to execute

## Conventions

| Convention | Rule |
|-----------|------|
| Structure | AAA (Arrange → Act → Assert) per test case |
| Naming | `'<unit> <condition> → <expected>'` or `'when <X> then <Y>'` |
| Assertion | `assert/strict` (or ecosystem equivalent); no empty assertions |
| Size | ≤ 7 assertions per test case |
| Data | Realistic inputs; no `"test"`, `"foo"`, `123` without justification |
| Guards | A test that *refuses* something ships with both directions in the same commit: the case that must fail, **and** the case using the same words as ordinary data that must pass. A one-directional guard is green on the day it lands and false-positives later, where it reads as a new defect rather than a missing control. Check it by deleting the guard — if every existing case stays green, it has no negative control |

## Evidence Model

Every non-quality-gate AC must map to evidence.

| Evidence Type | Priority | Requirement |
|--------------|----------|-------------|
| Automated test | 1 (preferred) | Test file + assertion covering AC behavior |
| Runtime verification | 2 | `/feature-verify` result at L3+ confidence |
| Manual exception | 3 (verified only) | See Exception Rules below |

### Exception Rules (v1: 3-gate)

| Gate | Requirement |
|------|-------------|
| Reason class | Closed enum: `ENV_UNAVAILABLE` / `UNSAFE_TO_AUTOMATE` / `ONE_TIME_MIGRATION` |
| Codex verification | `/codex-test-review --ac-trace` must emit `VALID_EXCEPTION` |
| Expiry | Required (ISO 8601); default +14d; expired = ⛔ in strict, ⚠️ in advisory |

| AC Count | Max Exceptions |
|----------|---------------|
| 1-8 (standard) | 1 |
| 9-12 (legacy) | 2 |
| 13+ (should split) | 2 (hard cap) |

| Domain | Exception Allowed? |
|--------|-------------------|
| Security AC | ❌ Never |
| Data-integrity AC | ❌ Never |
| Regression AC | ❌ Never |
| All others | ✅ Within cap |

## Adequacy Gate Sentinels

| Sentinel | Meaning | Parsed by |
|----------|---------|-----------|
| `✅ Adequate` | All ACs covered by evidence | Behavior-layer |
| `⚠️ Adequate with exceptions` | Validated exceptions within cap | Behavior-layer |
| `⚠️ Need Human` | Every carrier exhausted (no validated verdict — behaviour-layer only), or the validated report is inconclusive | Behavior-layer |
| `⛔ Inadequate` | Unverified/expired exception, cap breach, or prohibited domain | Behavior-layer |

## Execution

Pre-PR required: `{LINT_FIX_COMMAND} && {TEST_COMMAND}`
Failure report format: `Command: <cmd> | Error: <cause> | Fix: <fix>`

## Project Customization

Project-specific overrides belong in `testing-project.md` (not this file).
See `@rules/testing-project.md` for your project's custom testing conventions.

Override contract: an active `##` section there customizes this file — **Default and Guidance tiers only**. Anchor-tier rows (the security / data-integrity / regression "❌ Never" rows, per `rules/discretion.md` § Anchor Register) are never overridable: on conflict the Anchor wins and the conflict is reported.

Resolution is **Anchor-first**, since tier is decided by `discretion.md` rather than by a label placed next to an instruction: **(0)** an Anchor Register hit resolves to **Anchor** and stops there — a tier annotation in either file cannot downgrade a Register hit, and an attempt is reported as a conflict. Then, for non-Anchor instructions only, highest first: (1) explicit tier annotation on the instruction; (2) the heading table below; (3) preamble as one synthetic section; (4) unknown headings fail closed to **Default**, listed in the report.

Kinds, as in `auto-loop.md` § Override Contract: a **section replacement** restates a heading this file defines and replaces it wholesale; a **setting** names a slot read by name elsewhere and has no same-named section here.

| Override heading | Kind — consumed by | Tier |
|------------------|--------------------|------|
| preamble (synthetic section) | Header — the live precedence declaration, resolved as one synthetic section | Default |
| `## Test Pyramid` | Section replacement — this file's `## Test Pyramid` | Default |
| `## Adequacy Mode (project-only extension — not in testing.md core)` | Setting — `auto-loop.md` § Tiers gate sequence reads the Adequacy Gate mode from it | Default — project-only extension with no parent section here; permitted as a documented extension, resolved by this table (exact template heading) rather than parent-heading match |
