---
name: ui-first-principles
description: "First-principles UI/IA reasoning: turns a `<scenario>` + API field set into JTBD analysis, principle-anchored field-priority decisions, anti-pattern findings, and a bidirectional UI↔API gap report. Trigger: UI、UX、資訊架構、IA、scenario-driven UI、欄位優先級、information hierarchy. Not for: visual/CSS work (use `/frontend-design`), post-build critique (use `/critique`), or simplifying existing layouts (use `/distill`)."
allowed-tools: Read, Grep, Glob, Write, Bash(bash:*), Bash(node:*), Bash(mktemp:*), Bash(rm:*)
---

# UI First-Principles

Reasoning chain: `<scenario>` → JTBD → 5 IA/cognitive principles → field decisions → anti-patterns → gap report → validated handoff doc.

> **Output**: `handoff-ui-first-principles.md` (default `<cwd>/handoff-ui-first-principles.md`, override with `--output`). Downstream `/frontend-design` reads §5 Information Hierarchy directly.

## Non-Negotiable Rules

> SKILL.md is the normative source. Files under the `references/` directory elaborate but do not override.

| # | Rule | Violation = |
|---|------|-------------|
| 1 | Phase 1 (`redact.js`) **must** run before any LLM phase. Raw input never enters Phases 3–6. | Skill invalid (PII risk) |
| 2 | Phase 7 critical violation (`pii_leak_fingerprint` / `pii_leak_regex` / `missing_decision`) → **1 retry** with violation context → still critical → emit `⚠️ Need Human` (no warn-only fallback). | Retry policy breach |
| 3 | Principle Anchor column **must** hold one ID from `JTBD \| CognitiveLoadTheory \| HicksLaw \| MillersLaw \| ProgressiveDisclosure`. Multi-principle prose is fine in rationale. | `invalid_anchor` soft violation |
| 4 | Priority column **must** hold one of `primary \| secondary \| on_demand \| hidden`. | `invalid_priority` soft violation |
| 5 | Anti-Pattern `Pattern` column IDs **must** belong to the v1 whitelist in `references/anti-patterns.md`. Use literal `(none detected)` when no anti-patterns apply. | `invalid_anti_pattern_id` soft violation |
| 6 | Output **must** end with `✅ Ready` (clean) or `⚠️ Soft warnings` (soft only) or `⚠️ Need Human` (post-retry critical). Hook + behavior layer parses these. | Auto-loop cannot parse |

## Trigger

- Keywords: UI first principles, IA design, 資訊架構, 欄位優先級, scenario-driven UI, JTBD UI, anti-pattern audit, ui-first-principles
- Slash form: `/ui-first-principles <scenario>`

## When NOT to Use

| Intent | Use instead |
|--------|-------------|
| Visual layout / colour / Tailwind work | `/frontend-design` |
| Post-build evaluation of existing UI | `/critique` |
| Simplifying an already-shipped flow | `/distill` |
| Pure feasibility on a design idea | `/feasibility-study` |
| Tech-spec for an IA decision | `/tech-spec` (use this skill's output as input) |

## Arguments

| Arg | Required | Default | Purpose |
|-----|----------|---------|---------|
| `<scenario>` | Yes | — | Free-text scenario name (e.g. `transaction confirmation`, `NFT detail page`). Drives JTBD. |
| `--api <path>` | No | — | JSON sample file (single object literal). Phase 2 uses top-level keys as field set. |
| `--manual <path>` | **Deferred to v2** | — | Manual field-list file (`fieldName: type (description)` per line). **Not supported in v1.** Reason: `redact.js` masks via the KV-pair fallback parser, which treats `field: type` as `field=type` and masks the type literal — `address: string` becomes `address: <redacted:address>`. The masked line then fails `normalize-input.js`'s `MANUAL_LINE_RE` (the type token must start with a letter or quote, not `<`), so the field is silently dropped from `bundle.fields` and Phase 7 Rule 2 cannot require a decision for it. Always use `--api` in v1. Manual-list support requires a redactor change tracked in the v2 backlog. |
| `--domain crypto` | No | none | Phase 1 + 7 desensitization for `0x...` addresses/hashes. |
| `--output <path>` | No | `<cwd>/handoff-ui-first-principles.md` | Override report path. |

> v1 invocation contract: `--api` is required in v1 (`--manual` is deferred to v2 — see Arguments table for why). Phase 0 rejects missing input or any combination that supplies `--manual`. The tech-spec §3.3 LLM-fallback path (running Phases 3–6 with no real input) is also **deferred to v2** — `redact.js` cannot mask what does not exist, so a no-input run would publish an empty bundle and skip Rule 1 fingerprint coverage and Rule 2 field coverage. Rule 1b (regex rescan over the report) would still execute, but it cannot compensate for missing input — it only catches new PII the LLM hallucinates, not values that should have been redacted upstream.

## Workflow

```
Phase 0 preflight → Phase 1 redact → Phase 2 normalize → Phase 3 JTBD → Phase 4 principles → Phase 5 field table → Phase 5b anti-patterns → Phase 6 gap → Phase 7 validate → Emit
                                                                           ↑__________________________ retry-on-critical (×1) ____________________________|
```

### Phase 0 — Preflight (Bash)

1. Verify `--api <path>` was provided. v1 only accepts `--api`; reject `--manual` (deferred to v2 — see Arguments table). Reject and exit non-zero with the canonical usage banner:

   ```
   ⚠️ Need Human: ui-first-principles preflight error
   Reason: <missing_input | unsupported_input_v1 | input_unreadable>
   Usage: /ui-first-principles "<scenario>" --api <path> [--domain crypto] [--output <path>]
   Detail: <one-line context — e.g. "--manual is deferred to v2; only --api is supported">
   ```

2. Verify the file at `--api` exists and is readable; on failure use `Reason: input_unreadable` with the offending path in `Detail:`.
3. `TMPDIR=$(mktemp -d /tmp/ui-fp.XXXXXX)`. Pass to all later phases. Install the cleanup trap **before** any later phase runs:

   ```bash
   set -Eeuo pipefail
   cleanup() { rm -rf "${TMPDIR:-}" 2>/dev/null || true; }
   trap cleanup EXIT
   trap 'cleanup; trap - INT;  kill -INT  $$' INT
   trap 'cleanup; trap - TERM; kill -TERM $$' TERM
   ```

   This purges `$TMPDIR` (masked text + fingerprints) on normal exit, on a `set -e` failure, and on Ctrl-C / SIGTERM (the INT/TERM traps re-raise the signal so the caller observes the correct exit status). **Caveats**: a `kill -9` (SIGKILL) cannot be trapped — `$TMPDIR` survives a hard kill, so do not rely on `trap` for security guarantees beyond a polite shutdown. `set -Eeuo pipefail` propagates `ERR` into functions (else `trap ... ERR` is silently dropped). Because Phase 0 uses Bash builtins (`set`, `trap`, function definitions), execute it through `bash -c` and keep `Bash(bash:*)` in `allowed-tools`; the `Bash(node:*) | Bash(mktemp:*) | Bash(rm:*)` prefixes alone do not authorize the preflight wrapper.

### Phase 1 — Redact (Bash → JSON file)

```bash
node scripts/skills/ui-first-principles/redact.js \
  --input "${API_PATH:-$MANUAL_PATH}" \
  --inputFormat "$INPUT_FORMAT" \
  --domain "${DOMAIN:-}" \
  --output "$TMPDIR/phase1.json"
```

> `INPUT_FORMAT` must be `json_sample` in v1 (the only supported value, since `--api` is the only supported input mode — see Arguments table). Omitting `--inputFormat` lets `redact.js` default to `json_sample`, which is correct for `--api`; on `JSON.parse` failure the redactor still falls back to `fallbackStringMode` (KV-pair masking) rather than producing an empty result, but the orchestrator should always pass `--inputFormat` explicitly so Phase 2 can cross-check the format with `--inputFormat` (Phase 2 normalization branches on it). Once `--manual` ships in v2 the contract becomes "pass exactly what Phase 0 selected."

Output schema (consumed by Phase 2 — exactly what `redact.js --output` writes):

```json
{
  "maskedText": "<input with PII replaced by <redacted:type> placeholders>",
  "forbiddenFingerprints": ["sha256:abc...", ...],
  "fieldDecisions": [{
    "path": "<dot.path>",
    "fieldName": "<key>",
    "action": "keep" | "mask" | "crypto_allow",
    "piiClass": "<present only when action=mask> — email | phone | address | account_id | national_id | credential",
    "fingerprint": "<present only when action=mask> — sha256:..."
  }],
  "redactionSummary": {
    "totalMasks": N,
    "maskedClasses": ["email", "address", ...],
    "cryptoAllowlistHits": M,
    "baseRedactHits": K
  }
}
```

The `forbiddenFingerprints` array is the Phase 7 input that catches LLM-fabricated leaks of original sensitive values. CLI exit codes: 0 on success; 2 on `cli_args` / `unreadable_input` / `high_confidence_secret` / `redact_failed` / `write_failed` (each emits a structured `{ ok: false, error, detail }` JSON line on stdout).

#### PII Class Reference

Phase 1 and Phase 7 use *different* detection sets — keep them straight or you will misread Phase 7 violations. The validator file (`scripts/skills/ui-first-principles/validate-report.js`) is the source of truth for Phase 7; this table is a quick reference.

**Phase 1 (`redact.js`) — masking authority.** Combines regex content scan + field-name heuristics. Classes emitted as `<redacted:{class}>` placeholders + added to `forbiddenFingerprints` are exactly: `email`, `phone`, `address`, `account_id`, `national_id`, `credential`. Independent of these classes, `scripts/security-redact.js` runs as a base layer: high-confidence matches (PEM private keys, AWS `AKIA…`, OpenAI `sk-…`, GitHub `ghp_…` / `github_pat_…`, Slack `xox*`, Google `AIza…`) abort with `high_confidence_secret`; medium-confidence matches (`password=`, `token:`/`api_key=`/`secret=` assignments, JWT-like `eyJ…`, ≥32-char hex non-SHA1) are masked as `[REDACTED]` and counted as `baseRedactHits`. Base matches are not PII classes — they do not appear in `<redacted:{class}>` form, whichever entry
path (JSON or the manual key=value / `"key":"value"` text mode) catches them. This is deliberate,
cooperative layering, not an oversight: `security-redact.js` widened on 2026-09-04 to catch quoted
JSON keys and prefixed environment names it previously missed (`{"password":"…"}`, `API_TOKEN=…`),
so a field named for one of the six PII classes may now be masked to `[REDACTED]` by the base layer
before `redact.js` ever sees it — and when that happens, `redact.js` leaves it alone rather than
re-wrapping it as `<redacted:{class}>`. A structural PII class is only ever assigned to a field the
base layer did **not** already catch (an earlier revision briefly relabeled base matches to close
this gap and was reverted 2026-09-05 — it broke the symmetry between the two entry paths, which this
sentence exists to keep true).

**Phase 7 (`validate-report.js`) — leak rescan.** Two complementary checks:

| Check | Purpose | Source of truth |
|-------|---------|-----------------|
| `pii_leak_fingerprint` (Rule 1) | Catches tokenized re-leak of values whose SHA-256 prefix Phase 1 emitted into `forbiddenFingerprints`. The validator splits the report on whitespace + markdown/JSON delimiters and hashes each token, the punctuation-stripped variant, and the assignment RHS — so `pwd:supersecret`, `supersecret.`, `=supersecret` all hit the same fingerprint as `supersecret`. It is **not** substring/window scanning: multi-token values (e.g. `123 Main St` postal addresses) only match if the original full token appears intact. | `forbiddenFingerprints` Set carried via bundle.json |
| `pii_leak_regex` (Rule 1b) | Catches LLM hallucination of *plausible-looking* PII that Phase 1 never saw. **Smaller class set than Phase 1.** | The 6 regex constants in `validate-report.js` (5 distinct labels — SSN and Taiwan ID share `national_id`) |

The actual Rule 1b regex set:

| Phase 7 regex label | Pattern source (validate-report.js) | `--domain crypto` behaviour |
|---------------------|-------------------------------------|------------------------------|
| `email` | `EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g` | always flagged |
| `national_id` (US SSN) | `SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g` | always flagged |
| `national_id` (Taiwan ID) | `TAIWAN_ID_PATTERN = /\b[A-Z][12]\d{8}\b/g` | always flagged |
| `phone` (E.164) | `E164_PATTERN = /(?<![+\dA-Za-z_])\+\d{8,15}(?![\dA-Za-z_])/g` | always flagged |
| `eth_address` | `ETH_ADDR_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g` | flagged only when `--domain` is NOT `crypto` |
| `eth_hash` | `ETH_HASH_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g` | flagged only when `--domain` is NOT `crypto` |

**Classes Rule 1b does NOT regex-detect** (rely on Rule 1 fingerprint instead): domestic non-E.164 phones, postal addresses, generic account IDs. These are caught **only** when Phase 1 actually masks or fingerprints them through value patterns, field-name heuristics (`address_*`, `account_id`, etc.), or the `security-redact.js` base layer. **Coverage v1 does NOT regex-detect, AND `redact.js` has no value pattern for**: IBAN, SWIFT, BIC, mnemonic / seed / recovery phrases, generic `sk_…` style API keys (note: only `sk-…` with hyphen is high-confidence). Such values must be removed from the input before invocation, or `redact.js` must be extended before claiming coverage.

**Crypto domain semantics** (current v1 implementation): `--domain crypto` simply suppresses Rule 1b's `eth_address` / `eth_hash` checks. It does **not** verify that a `0x...` token in LLM prose originated from the input — fabricated hex strings under crypto domain are not regex-flagged but will still trip Rule 1 if their fingerprint matches an input value, or pass silently if they do not. Origin-aware crypto enforcement is on the v2 backlog.

### Phase 2 — Normalize (Bash → JSON file)

```bash
node scripts/skills/ui-first-principles/normalize-input.js \
  --phase1 "$TMPDIR/phase1.json" \
  --scenario "$SCENARIO" \
  --inputFormat "$INPUT_FORMAT" \
  --output "$TMPDIR/bundle.json"
```

Output: `ScenarioBundle` JSON file with this schema. The LLM (Phases 3–6) consumes `scenario`, `fields`, `inputFormat`, and `redactionSummary`. The validator (Phase 7) consumes `fields[].name` (Rule 2 `missing_decision`), `forbiddenFingerprints` (Rule 1), and the three allowlists (Rules 3 / 3b / 5):

```json
{
  "scenario": "<free text>",
  "fields": [{ "name": "...", "type": "...", "sampleValue": "...", "description": "...", "source": "json_sample" | "manual" }],
  "inputFormat": "json_sample" | "manual_list",
  "redactionSummary": { "totalMasks": N, "maskedClasses": [...], "cryptoAllowlistHits": M },
  "forbiddenFingerprints": ["sha256:...", ...],
  "allowedPrinciples": ["JTBD", "CognitiveLoadTheory", "HicksLaw", "MillersLaw", "ProgressiveDisclosure"],
  "allowedPriorities": ["primary", "secondary", "on_demand", "hidden"],
  "allowedAntiPatterns": ["too_many_primary", "scenario_field_mismatch", "pure_aesthetic_over_utility", "hidden_critical_info", "redundant_fields"]
}
```

Phases 3–6 read **only** this file plus the four reference docs — they never see raw input. Phase 7 reads the same file and uses `fields[].name` for Rule 2 (`missing_decision`), `forbiddenFingerprints` for Rule 1, and the three allowlists for Rules 3 / 3b / 5. CLI exit codes: 0 on success; 2 on `cli_args` / `unreadable_phase1` / `normalize_failed` / `write_failed`.

### Phase 3 — JTBD Analysis (LLM)

1. Read `references/jtbd-framework.md` (functional / emotional / social elicitation rules; Web3 specialization).
2. Read `$TMPDIR/bundle.json`.
3. Produce `## 1. JTBD Analysis` (3 subsections; empty dimensions explicitly say `none in this scenario`).

### Phase 4 — Principles Briefing (LLM)

1. Read `references/principle-anchors.md` (5 principles + reasoning-chain order + mask semantics).
2. Internalize the closed enum `JTBD | CognitiveLoadTheory | HicksLaw | MillersLaw | ProgressiveDisclosure` — every Phase 5 row cites exactly one.

### Phase 5 — Field Decision Table (LLM)

For each field in `bundle.fields`, decide:

| Column | Source |
|--------|--------|
| `Field` | Exact name from `bundle.fields[].name` (no rename) |
| `Priority` | One of `primary \| secondary \| on_demand \| hidden` |
| `Principle Anchor` | One ID from the principles whitelist |
| `Rationale` | 1–2 sentences traced back to a Phase 3 job or quantitative threshold; **never** echoes the raw redacted value |

> The validator's Rule 2 (`missing_decision`, critical) checks every field appears as a row.

### Phase 5b — Anti-Pattern Findings (LLM)

1. Read `references/anti-patterns.md` (5 IDs + triggers + severity rubric).
2. Emit `## 3. Anti-Pattern Findings` as a markdown **table** (preferred — matches `references/output-template.md` schema).
   Acceptable fallback: a bullet list whose every line matches the validator's strict grammar (`parseAntiPatterns` regex ``/^\s*[-*]\s+`([a-z][a-z0-9_]+)`/gm``):

   ```
   - `too_many_primary`: rationale text…
   - `redundant_fields`: rationale text…
   ```

   Forms the validator REJECTS as `anti_pattern_unstructured`: bullets without a leading backticked ID (e.g. `- Pattern: too_many_primary — rationale`), nested or indented sub-bullets without an ID at the top, and prose paragraphs that mention IDs inline.
3. If no anti-patterns apply → emit a single-row table: `(none detected) | — | info | All fields pass anti-pattern checks.` (parens + space — see references/anti-patterns.md § Detection Discipline).

### Phase 6 — Gap Report (LLM)

Bidirectional gap analysis (validator Rule 4 requires both directions):

```markdown
## 4. Gap Report

**UI needs but API missing**: <field1, field2 — or `none`>
**API provides but UI ignores**: <field3, field4 — or `none`>
```

### Phase 7 — Validate (Bash → JSON, then act)

```bash
node scripts/skills/ui-first-principles/validate-report.js \
  --report "$DRAFT_PATH" \
  --bundle "$TMPDIR/bundle.json" \
  --domain "${DOMAIN:-}" \
  > "$TMPDIR/validation.json"
```

Decision table:

| Result | Action |
|--------|--------|
| `ok=true`, no soft violations | Write `$OUTPUT`, emit `✅ Ready`, end |
| `ok=true`, soft only | Prepend `> ⚠️ Warnings: <list>` block, write `$OUTPUT`, emit `⚠️ Soft warnings`, end |
| `ok=false`, critical, retry not yet attempted | Re-enter Phases 3–6 with violation context appended; retry counter = 1 |
| `ok=false`, critical, retry already attempted | Discard draft, emit `⚠️ Need Human` with violation summary; **do not write report** |

> Rule 1 / 1b leak details are surfaced as `<redacted len=N>` previews — never the raw value (re-leaking would defeat the discipline).

### Emit

The report file (`$OUTPUT`) **must** follow `references/output-template.md` exactly — first line is `# UI First-Principles Analysis: <scenario>`, followed by the metadata blockquote and §1–§5. The block below is the **operator-facing wrapper** the skill prints to the conversation (path + run metadata + sentinel) — it is not what gets written to disk.

```markdown
## UI First-Principles Analysis (run summary)

> Path: <output>
> Scenario: <scenario>  Domain: <crypto|none>  Input: <json_sample|manual_list>

<final markdown report rendered from $OUTPUT — header must be `# UI First-Principles Analysis: <scenario>` per references/output-template.md>

<gate sentinel>
```

## Performance Budget

Tech-spec §4 → NFR-5 Time Budget Breakdown sets the run target at p95 ≤ 120s (≈ 92s sum + 28s margin). When a phase exceeds its share:

| Trigger | First action | Escalation |
|---------|--------------|------------|
| Single phase exceeds its share by < 20% | Continue — margin absorbs | Log only |
| Single phase exceeds its share by 20–50% | Compress LLM prompt for that phase (drop optional examples; keep contracts) | Re-run; if still over, log to validation summary |
| Aggregate run exceeds 120s | Skip optional reference re-loads on retry; reuse cached `bundle.json` | If still over after one retry → emit `⚠️ Need Human: performance budget exceeded` with per-phase timings |

> Never relax validator strictness to recover budget — soft warnings still emit, critical violations still retry. Compress prompts, not gates.

## Reference Loading Order

Reference files are progressive context — loaded only when needed:

| Phase | Reference | Why |
|-------|-----------|-----|
| 3 | `references/jtbd-framework.md` | Three-dimension elicitation guide; FR-3 contract |
| 4–5 | `references/principle-anchors.md` | 5 principle definitions, anchor whitelist, mask semantics |
| 5b | `references/anti-patterns.md` | 5 anti-pattern IDs + detection triggers |
| Final pre-emit | `references/output-template.md` | Markdown schema the validator expects |

A skilled reader can cite all four in a single read; on retry, only the file relevant to the violation needs reloading.

## Output Schema (authoritative)

See `references/output-template.md` for the full markdown contract: header metadata → `## 1. JTBD Analysis` → `## 2. Field Decision Table` → `## 3. Anti-Pattern Findings` → `## 4. Gap Report` → `## 5. Information Hierarchy` (Primary / Secondary / On-Demand / Hidden zones).

## Examples

```
/ui-first-principles "transaction confirmation" --api fixtures/tx-confirm.json --domain crypto
```

```
/ui-first-principles "NFT 詳情" --api fixtures/nft.json --domain crypto --output docs/handoffs/nft-fp.md
```

<!-- A `--manual` example is intentionally omitted in v1; see Arguments table for the deferral rationale. -->

## Output

| Artifact | Default location |
|----------|------------------|
| Handoff report | `<cwd>/handoff-ui-first-principles.md` (override with `--output`) |
| Validation log | `$TMPDIR/validation.json` (cleaned on exit) |
| Phase 1 / 2 intermediate files | `$TMPDIR/*.json` (cleaned on exit) |

## Verification Checklist

- [ ] Phase 0 rejects missing `--api` and rejects `--manual` (deferred to v2)
- [ ] Phase 1 produces non-empty `forbiddenFingerprints` for any redacted-value input
- [ ] Phases 3–6 reference only `bundle.json` + the four reference docs (never raw input)
- [ ] Phase 7 critical → exactly 1 retry, then `⚠️ Need Human`
- [ ] Output ends with one sentinel: `✅ Ready` / `⚠️ Soft warnings` / `⚠️ Need Human`
- [ ] No raw redacted values appear anywhere in the report (validator's Rule 1 / 1b would catch, but verify too)

## Cross-References

- Tech spec: `docs/features/ui-first-principles/2-tech-spec.md` §3 (orchestration), §3.4 (per-phase contracts)
- Requirements: `docs/features/ui-first-principles/1-requirements.md` §FR-1 / §FR-3 / §NFR-7 / §NFR-8
- Validator: `scripts/skills/ui-first-principles/validate-report.js` (rules 1–5)
- Redactor: `scripts/skills/ui-first-principles/redact.js`
- Normalizer: `scripts/skills/ui-first-principles/normalize-input.js`
