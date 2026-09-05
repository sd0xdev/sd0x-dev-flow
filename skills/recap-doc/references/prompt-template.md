# Recap Synthesis Prompt Template

LLM synthesis prompt for `/recap-doc` Phase 4b. Governs composition of §1 Overview through §7 Evidence, including Blind Spots (FR-9 Must) and Anticipated Questions (FR-11).

**Compliance**: This template obeys `@rules/codex-invocation.md`. Any Codex invocation derived from it **must** include the "You must independently research the project" block and **must not** embed Claude's conclusions.

## When This Prompt Runs

Phase 4b composes the full markdown body *after* Phase 4a already produced per-file explanations via `/codex-explain` (Skill call). The synthesis model is **Claude** — Phase 4b runs in the model already executing `/recap-doc`, and there is no second-opinion mode any more (see the removal record below).

## Template Variables

| Variable | Source | Example |
|----------|--------|---------|
| `{{SCOPE_REPORT_JSON}}` | Phase 1 load | `{"version":1,"source":"uncommitted",...}` |
| `{{DEPTH}}` | `--depth` flag | `brief` / `normal` / `deep` |
| `{{FOCUS}}` | `--focus` flag | `auth middleware` |
| `{{TOP_N}}` | Depth matrix | `5` / `10` / `15` |
| `{{FILE_EVIDENCE}}` | Stage 2 step 3 (hunks) + step 4 (read excerpts) | `file:line` blocks per top-N file |
| `{{CODEX_EXPLAIN_OUTPUTS}}` | Phase 4a outputs | per-file intent summaries |
| `{{TECH_SPEC_WBS}}` | Stage 3 extraction (if `has_tech_spec`) | list of work-breakdown items |
| `{{GIT_LOG}}` | Stage 2 step 1 | dedup commit list across scope |

## Core Prompt (Claude, first-pass synthesis)

> **Codex not invoked here.** The first-pass synthesis runs inside Claude (the
> model already executing `/recap-doc`), so no transport dispatch is
> issued, and `@rules/codex-invocation.md`'s "independently research" mandate therefore does not
> apply to this template as it stands — that rule governs dispatches to Codex, and this template
> makes none. **If this prompt is ever adapted to drive Codex, the research block becomes
> mandatory**, and the adaptation needs its own dispatch contract; the removal record below says why
> retrofitting one onto an existing prompt was the wrong move.

```
You are composing a post-development recap document. The target reader is the
user who requested the recap — often the same person who triggered
/feature-dev and now needs to understand what changed and why.

## Scope
{{SCOPE_REPORT_JSON}}

Depth: {{DEPTH}} (top-N = {{TOP_N}})
Focus (optional user keyword): "{{FOCUS}}"

## Evidence (collected by Phase 2)
### Per-file intents from /codex-explain
{{CODEX_EXPLAIN_OUTPUTS}}

### Changed hunks and file excerpts
{{FILE_EVIDENCE}}

### Git log (base_ref..HEAD across scope files)
{{GIT_LOG}}

### Tech-spec work breakdown (only if has_tech_spec)
{{TECH_SPEC_WBS}}

## Your task

Emit the recap markdown following `references/output-template.md` exactly:

1. Metadata header — fill every field from ScopeReport.
2. §1 Overview — 2-4 sentences (see Depth Matrix). Use {{FOCUS}} to bias framing if present; otherwise infer from top-file intents.
3. §2 Changed Files — one row per file, up to {{TOP_N}}. Every row MUST carry at least one `file:line` reference drawn from evidence; never invent line numbers. Sort by lines_changed.total desc, tiebreak by change_type.
4. §3 Design Decisions — extract decisions from the per-file intents, not from speculation. Each bullet: one-line decision, rationale, `file:line` reference.
5. §4 Spec vs Implementation Drift — ONLY if has_tech_spec === true. For each tech-spec WBS item, match against scope files. Mark ✅ / ⚠️ / ❌ with a note.
6. §5 Blind Spots — ALWAYS present (FR-9 Must, any depth). Apply the heuristics table in `output-template.md`. If zero heuristics trigger, emit the fallback block verbatim (starts with `本輪未偵測到明顯盲點`). At {{DEPTH}} === brief, cap at top-3 heuristic bullets.
7. §6 Anticipated Questions — OMIT if {{DEPTH}} === brief. Otherwise provide ≥ 3 questions framed from the user's perspective, with short hint answers that redirect to /recap-ask for full context.
8. §7 Evidence — commit SHAs and file:line index. Add diff stats only at deep.

## Hard constraints

- Never emit a section heading without content (use missing-source markers if empty).
- Never invent file paths or line numbers. Only cite what appears in evidence.
- Never include secrets, tokens, or redacted-looking strings. The output will be
  scanned by scripts/security-redact.js; high-confidence matches abort the write.
- At brief depth: omit §6 entirely (heading + body).
- At all depths: §5 heading is mandatory.
- If {{FOCUS}} contradicts the scope (e.g. focus="auth" but no auth file in scope),
  note this in §5 as a blind spot rather than dropping the focus silently.

Return only the markdown body. Do not wrap in code fences. Do not add preamble.
```

## Codex Second-Opinion Prompt — removed 2026-09-04

This template used to carry a second-opinion prompt for a `--strict` mode that `recap-doc` never
defined: no flag, no dispatch step, no binding. A doc reviewer offered two resolutions — wire it, or
remove the orphan — and wiring it was tried first. That produced three findings in three rounds, two
of them security-relevant: the prompt pasted the Claude-authored draft verbatim, which
`@rules/codex-invocation.md` forbids for a judgement dispatch and whose exception is closed to
`feature-verify` and `necessity-audit`; and the path-based replacement composed a shell command
around a user-selectable `--output` path, where double quotes are not a defence because `$(…)` runs
inside them.

Removing it is the other resolution, and the better one here: the mode was never reachable, so
nothing regresses, and a reviewed second-opinion pass can be specified deliberately if it is wanted —
with its own dispatch contract rather than a prompt retrofitted to one.

## Prompt-Time Safeguards

Before invoking the synthesis model, the skill performs these checks:

| Check | Action on failure |
|-------|-------------------|
| `{{FILE_EVIDENCE}}` is non-empty | Abort Phase 4b; emit `[Source unavailable]` recap with §5 blind spot explaining empty scope |
| `{{TOP_N}}` matches depth matrix | Treat as internal bug; abort with exit code 5 (unexpected) |
| `{{CODEX_EXPLAIN_OUTPUTS}}` covers top-N files | Missing files annotated in §2 as `[codex-explain skipped]`; add blind spot |
| Any template variable contains a secret-shaped string | `scripts/security-redact.js` pre-scan rejects before sending to LLM |

## Prohibited Patterns (cross-reference to codex-invocation.md)

| Pattern | Why it violates | Corrected form |
|---------|-----------------|----------------|
| `"Claude analysed the diff and found X, confirm?"` | Feeds conclusion | Provide raw evidence; let reviewer derive X |
| `"Only look at <path>"` | Scope restriction | Provide full ScopeReport; reviewer decides what to widen |
| `"These blind spots look right, yes?"` | Confirmation prompt | Ask reviewer to list blind spots independently |
| Embedding 2000-line diff in prompt | Wastes tokens, truncates context | Reference paths; reviewer runs `git diff` themselves |

## Output Contract

The synthesized markdown MUST:

1. Start with `# Recap:` (metadata header) — no preamble before it.
2. Contain every section heading listed in `output-template.md` (§5 always; §6 omitted only at brief).
3. Satisfy every invariant in `output-template.md ## Invariants`.
4. End with a trailing newline (enforced by Phase 5b write).
