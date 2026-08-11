---
name: runbook
description: "Generate and update feature release runbooks from existing docs and codebase. Use when: creating operational runbook, release handbook, deployment checklist, pre-release preparation. Not for: incident response (v2), code review (use codex-code-review), architecture design (use architecture)."
allowed-tools: Read, Grep, Glob, Bash(git:*), Bash(node:*), Write, Edit, Agent, AskUserQuestion
---

# Runbook Generation Skill

## Trigger

- Keywords: runbook, release runbook, deployment handbook, release handbook, operational guide, pre-release checklist, rollback plan

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| Incident response runbook | v2 (not yet implemented) |
| Code review | `/codex-review-fast` |
| Architecture design | `/architecture` |
| Tech spec writing | `/tech-spec` |
| Request tracking | `/create-request` |

## Usage

```bash
/runbook                              # Auto-detect feature, create or update
/runbook <feature-keyword>            # Specify feature
/runbook --update                     # Force update mode
/runbook --check                      # Read-only staleness validation
/runbook --request <path|title>       # Specify target request (multi-request features)
```

## Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant S as /runbook
    participant FR as Feature Resolver
    participant CB as Codebase
    participant RB as runbook-release.md

    U->>S: /runbook [feature] [--update|--check] [--request path]
    S->>FR: node scripts/resolve-feature.js
    FR-->>S: {key, doc_inventory, source sets}
    S->>S: Mode dispatch + Request selection

    alt Create Mode
        S->>CB: Read current_authority + requests/*.md
        S->>CB: Scoped discovery (5-priority cascade)
        S->>RB: Write runbook-release.md from template
    else Update Mode
        S->>RB: Read existing runbook + provenance
        S->>CB: Compare current state vs provenance SHAs
        S->>RB: Edit changed sections only
    else Check Mode
        S->>RB: Read existing runbook + provenance
        S->>CB: Validate per-section SHAs
        S-->>U: Report: Fresh/Stale/Missing/Unknown
    end
```

## Phase 0: Context Resolution

Resolve feature using the 5-level cascade:

The wrapper, not the CLI directly: `resolve-feature.js` owns the failure payload, so the full
shape with `scan_error: true` arrives however the CLI fails — a nonzero exit, a signal, a partial
write, a payload that is not the agreed shape. (It cannot survive `node` itself being unavailable:
nothing running under `node` can. What it removes is the CLI's failure domain, not the
interpreter's.) Calling the CLI with `|| echo '{}'` produces a payload the gate below cannot
recognise as a failure.

**Decide the branch yourself, then run one command.** This skill grants `Bash(node:*)`, which
matches a direct `node …` invocation and nothing else — a shell `if`/`[ … ]`/`$(…)` compound is not
a `node` command and cannot run here. Parse `$ARGUMENTS` first (Step 1 below), then issue exactly
one of:

```bash
node scripts/resolve-feature.js --feature <the feature key from $ARGUMENTS>
```

```bash
node scripts/resolve-feature.js
```

Use the first when `$ARGUMENTS` carried a positional feature key, the second otherwise. Pass the key
as a separate argv token — never interpolate it into a larger shell expression.

| Source | Mapping |
|--------|---------|
| `/runbook auth` | Positional key `auth` → `--feature auth` (two separate argv tokens) |
| `/runbook` (no arg) | No `--feature`, resolver uses branch/diff/fallback |
| `/runbook --check` | No `--feature`, parse flags only |

| Step | Action |
|------|--------|
| 1 | Parse `$ARGUMENTS` for feature key or `--check`/`--update`/`--request` flags |
| 2 | Run feature resolver, get `key`, `doc_inventory`, and the four source sets (`current_authority`, `design_records`, `work_records`, `history_records`) |
| 2b | **If `scan_error !== false`, stop** — not `=== true`: a payload missing the field is a failure too. See the gate below |
| 3 | Check for `runbook-release.md` specifically in feature directory (not any `runbook-*.md`) |
| 4 | Determine mode: create (`runbook-release.md` absent) / update (`runbook-release.md` exists) / check (`--check` flag) |

> **`scan_error` gate.** Gate on **`scan_error !== false`**, not on `scan_error === true`. When it
> is not exactly `false` the four source sets are **unknown, not empty** — the corpus could not be
> enumerated (unreadable directory, broken taxonomy, no repository), *or* the resolver never ran
> and a shell fallback supplied a payload with no such field at all. `{}` is the shape that made
> the stricter test useless: it has no `scan_error`, so `=== true` is false and the gate passes a
> payload that contains nothing. Do not proceed as though the feature has no authority documents —
> report and take the ⚠️ Need Human exit. A `key` may still be present, so a non-null `key` is not
> evidence the sets are complete.

**Note**: Mode dispatch keys off the specific file `runbook-release.md`, not any runbook-typed doc in `doc_inventory`. A feature may have `runbook-deploy.md` (a different topic) without triggering update mode for the release runbook.

### Request Selection

| Condition | Behavior |
|-----------|----------|
| `--request` specified | Use specified request |
| Single active request | Auto-select |
| Multiple active requests | AskUserQuestion: list requests, let user choose |
| No active requests | Use most recent request (warn) |

## Phase 1: Content Discovery (Create/Update modes)

Use **scoped discovery cascade** — narrow to wide, with confidence degradation:

| Priority | Scope | Confidence |
|----------|-------|------------|
| 1 | Request `Related Files` paths | High |
| 2 | `current_authority` — code, `rules/`, and the docs that claim to be current | High |
| 3 | `design_records` (tech spec, architecture) | Medium — *intent only*, mark steps unverified |
| 4 | Feature-local paths (`docs/features/{feature}/`) | Medium |
| 5 | Repo-wide grep | Low (tag results) |

**A P1 path is classified before it is used.** `Related Files` is High confidence because the
request author named those paths deliberately — not because a path in that table is exempt from the
role split. Resolve each one first: a path landing in `design_records` (a tech spec, an architecture
doc) is treated as **P3** — Medium, marked unverified — even though it arrived via P1. Otherwise the
row the split removed comes straight back through the front door, since a request's Related Files
table routinely names `2-tech-spec.md`.

Priorities 2 and 3 used to be one row reading "canonical docs (tech-spec, architecture) — High",
which is the confusion this feature exists to remove: a tech spec is a design record, and a
runbook built from one describes a procedure that may never have been built.

See `references/discovery-heuristics.md` for per-section mapping.

### Security — Redaction Rules

When mining configs/workflows/logs into committed markdown:

| Prohibited | Replacement |
|-----------|-------------|
| API keys, tokens, secrets | `${ENV_VAR_NAME}` placeholder |
| Webhook URLs with credentials | `<webhook-url>` symbolic reference |
| Internal-only endpoints | `<internal-endpoint>` placeholder |
| Database connection strings | `${DATABASE_URL}` placeholder |

## Phase 2: Generate / Update

### Create Mode

1. Read `current_authority` first — a runbook describes what operators will actually run, so the
   sources are code, `rules/`, and the docs that claim to be current. Fall back to
   `design_records` (tech spec, architecture) only for the *intent* behind a step, and mark any
   step sourced that way as unverified in the provenance manifest: a design record may describe a
   procedure that was never built
2. Read active request(s) by enumerating `docs/features/{feature}/requests/*.md` — **not** by
   filtering `work_records`. That set answers "is this document a work record", and a ticket that
   resolves to some other role — authority `Yes`, or a `Doc role` naming one of the other three —
   leaves it while staying an open ticket; selecting from the set would drop exactly that ticket's
   AC, scope and related files
3. Run scoped discovery for each template section
4. Fill template from `references/template.md`
5. Embed `<!-- runbook-provenance -->` manifest with source SHAs
6. Write to `docs/features/{feature}/runbook-release.md`

### Update Mode

1. Read existing `runbook-release.md` and parse `<!-- runbook-provenance -->` block
2. Compare each `sources[].sha` against `git hash-object <file>`
3. Identify stale sections (any source SHA mismatch)
4. Re-run discovery for stale sections only
5. Edit stale sections via Edit tool (preserve fresh sections)
6. Update provenance manifest with new SHAs

## Phase 3: Check Mode (`--check`)

Read-only validation — does **not** modify the runbook file.

1. Read existing `runbook-release.md` and parse provenance manifest
2. For each section, compare `sources[].sha` against current `git hash-object`
3. Classify: Fresh / Stale / Missing / Unknown (see `references/check-output.md`)
4. Output report with per-section status and SHA diffs
5. Emit verdict: Ready / Stale / Incomplete

## Output

| Mode | Output | Location |
|------|--------|----------|
| Create | New runbook | `docs/features/{feature}/runbook-release.md` |
| Update | Updated sections | Same file, incremental edit |
| Check | Console report | stdout only (no file modification) |

## Verification

- [ ] Feature resolved via `node scripts/resolve-feature.js`, and `scan_error` was exactly `false`
- [ ] Runbook detected in `doc_inventory` (ancillary/runbook type)
- [ ] Template has all 9 sections (see `references/template.md`)
- [ ] Provenance manifest embedded with multi-source SHA tracking
- [ ] Discovery uses scoped cascade (not repo-wide grep as first option)
- [ ] Redaction rules applied (no secrets in committed markdown)
- [ ] `--check` mode is read-only (no file writes)

## Auto-Loop Integration

This skill produces `.md` output. Per `@rules/auto-loop.md`:

| Event | Action |
|-------|--------|
| Create/Update writes `.md` | `/codex-review-doc` auto-triggered |
| Check mode (no writes) | No review needed |

## References

| File | Purpose |
|------|---------|
| `references/template.md` | 9-section runbook template with provenance block |
| `references/discovery-heuristics.md` | Scoped discovery cascade and per-section mapping |
| `references/check-output.md` | `--check` mode output template and verdict logic |

## Examples

```
Input: /runbook
Action: Auto-detect feature → create runbook-release.md → /codex-review-doc

Input: /runbook auth --check
Action: Read auth/runbook-release.md → validate provenance SHAs → output report

Input: /runbook --update --request docs/features/auth/requests/2026-04-01-login-fix.md
Action: Read existing runbook → diff stale sections → update → /codex-review-doc
```
