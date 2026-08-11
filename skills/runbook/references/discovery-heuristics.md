# Content Discovery Heuristics

## Scoped Discovery Cascade

Search from narrow to wide. Each level adds a confidence penalty.

| Priority | Scope | Confidence | When to use |
|----------|-------|------------|-------------|
| 1 | Request `Related Files` paths | High | Always first |
| 2 | `current_authority` — code, `rules/`, and the docs that claim to be current | High | The resolver's source set, not `canonical_docs` |
| 3 | `design_records` (tech spec, architecture) | Medium — *intent only*, mark the step unverified | Nothing current answers the section |
| 4 | Feature-local paths (`docs/features/{feature}/`) | Medium | Neither set answers it |
| 5 | Repo-wide grep | Low | **Last resort only** |

> Repo-wide results must be tagged `(low confidence — repo-wide search)`.

**A P1 path is classified before it is used.** `Related Files` is High confidence because the
request author named those paths deliberately — not because a path in that table is exempt from the
role split. Resolve each one first: a path landing in `design_records` (a tech spec, an architecture
doc) is treated as **P3** — Medium, marked unverified — even though it arrived via P1. Otherwise the
row the split removed comes straight back through the front door, since a request's Related Files
table routinely names `2-tech-spec.md`.

**Why 2 and 3 are separate rows.** They used to be one, reading "Canonical docs (tech-spec,
architecture) — High". A tech spec is a *design record*: it says what was intended, not what runs.
A runbook is executed against production, so a procedure lifted from a design record at High
confidence is a procedure that may never have been built. `current_authority` is the set that
answers "what does the system do now"; `design_records` answers "why was it built this way", and
anything taken from it ships marked unverified. `canonical_docs` is a **deprecated alias** and is
not an authority signal — it selects the tech spec whatever role that document resolves to.
Contract: `skills/create-request/references/feature-context-resolution.md` § Source sets.

## Per-Section Discovery Map

Columns follow the cascade above. A **P3 cell is always *intent*** — cite it, mark the step
unverified, and prefer anything P2 offers for the same section.

| Section | P1: Related Files | P2: `current_authority` | P3: `design_records` (unverified) | P4: Feature-local | P5: Repo-wide | Fallback |
|---------|------------------|------------------------|-----------------------------------|-------------------|---------------|----------|
| 1. Release Summary | — | `4-implementation*` §1, or the code itself | tech-spec §1 (Requirement Summary) | — | — | "TBD — no current-authority doc and no tech-spec found" |
| 2. SRE Quick Ref | Grep in Related Files: `alert\|threshold\|metric\|rollback\|abort` | the same greps over code and `rules/` | architecture §6 (Deployment & Config) | — | — | "Not defined in repo" |
| 3. Scope / Blast Radius | Request scope table | integration points as the code wires them | architecture §4 (Integration Points) | — | — | Architecture §2 (Component Responsibilities), marked unverified |
| 4. Preconditions | Request ACs + quality-gate status | — | — | — | — | Standard checklist only |
| 5. Deployment Procedure | — | `.github/workflows/*.yml` — what actually runs | — | Feature-local config | — | Standard skill sequence |
| 6. Verification | — | the test files themselves | tech-spec §6 (Testing Strategy) | — | — | "TBD — no test strategy found" |
| 7. Monitoring | Grep in Related Files: `metrics\|prometheus\|grafana\|datadog\|log\.\(info\|warn\)\|feature.flag\|LaunchDarkly` | the same greps over code | architecture §6 | Feature-local `*.config.*` | Grep in related dirs only | "Not defined in repo — add monitoring before release" |
| 8. Rollback | — | rollback paths present in code / workflows | architecture AD-N decisions | — | — | "TBD — rollback strategy not documented" |
| 9. Open Risks | Unresolved request items (unchecked AC) | — | tech-spec §7 (Open Questions) | — | — | "No open risks identified" |

## Security — Redaction Rules

When extracting content from configs, workflows, or logs into the runbook:

| Prohibited Content | Replacement |
|-------------------|-------------|
| API keys, tokens, secrets | `${ENV_VAR_NAME}` placeholder |
| Webhook URLs with credentials | `<webhook-url>` symbolic reference |
| Internal-only endpoints (IP:port) | `<internal-endpoint>` placeholder |
| Database connection strings | `${DATABASE_URL}` placeholder |
| Private registry URLs | `<registry-url>` placeholder |

> Consistent with `rules/security.md`: Never log private keys, passwords, tokens.

## Discovery Execution Pattern

```
Resolve the feature first: `node scripts/resolve-feature.js`. If `scan_error !== false` the four
source sets are unknown, not empty — stop and Need Human rather than falling through to P4/P5,
which would silently rebuild the old repo-wide behaviour on a corpus that was never read.

For each template section:
  1. Check P1 scope (Related Files) — RESOLVE THE PATH'S ROLE FIRST.
       - in `design_records` → do not use it here; carry it to step 3 and treat it as P3
       - anything else → use with High confidence
     Skipping this classification is what re-promotes a design record: a request's Related
     Files table routinely names `2-tech-spec.md`, and P1 is the one scope that outranks
     `current_authority`.
  2. Check P2 scope (`current_authority`) — if found, use with High confidence
  3. Check P3 scope (`design_records`) — including anything demoted here by step 1 — if found,
     use with Medium confidence and mark the step unverified: it is intent, not observed
     behaviour
  4. Check P4 scope (Feature-local) — if found, use with Medium confidence
  5. Check P5 scope (Repo-wide) — if found, tag as Low confidence
  6. If nothing found → use fallback text from table above
  7. Apply redaction rules to all extracted content
  8. Record source file + SHA in provenance manifest
```
