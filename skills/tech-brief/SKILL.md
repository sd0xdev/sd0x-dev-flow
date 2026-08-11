---
name: tech-brief
description: "Technical briefing for developer sharing. Use when: sharing implementation findings with technical colleagues, post-development knowledge transfer, documenting what was built and why. Not for: PM/CTO summary (use project-brief), first-principles reasoning (use fp-brief), design-phase specs (use tech-spec). Output: 6-section technical brief with source provenance."
allowed-tools: Read, Grep, Glob, Write, Bash(git:*), Bash(node:*)
---

# Technical Briefing Skill

## Trigger

- Keywords: tech brief, technical briefing, share with team, tech-brief, dev sharing, share findings, technical memo

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| PM/CTO executive summary (strip technical details) | `/project-brief` |
| First-principles reasoning chain (why decisions were made) | `/fp-brief` |
| Design-phase technical specification (before implementation) | `/tech-spec` |
| Code explanation at function/file level | `/codex-explain` |
| Simple document summary | Ask Claude directly |

## Command Signature

```
/tech-brief [<feature-key>|<docs-path>] [--depth brief|normal|deep] [--output <path>] [--no-save]
```

| Flag | Default | Description |
|------|---------|-------------|
| `<feature-key>` | Auto-detect | Feature key or docs path |
| `--depth` | `normal` | Output depth (brief/normal/deep) |
| `--output` | `docs/features/<key>/5-tech-brief.md` | Custom output path |
| `--no-save` | false | Print to stdout only |

## Workflow

```mermaid
sequenceDiagram
    participant U as User
    participant S as /tech-brief
    participant FR as feature-resolver.js
    participant D as Feature Docs
    participant G as Git History
    participant C as Changed Files
    participant O as Output File

    U->>S: /tech-brief [feature] [--depth] [--output]
    Note over S: Phase 1: Context Resolution
    S->>FR: Resolve feature (5-level cascade)
    FR-->>S: Feature key + doc inventory
    Note over S: Phase 2: Multi-Source Collection
    S->>D: Stage 1 — Read docs (tech-spec, architecture, requests)
    S->>G: Stage 2 — git log + diff + changed file reading
    S->>D: Stage 3 — Request selection (top 3 by date)
    Note over S: Phase 3: Synthesis
    S->>S: Build Source Provenance table
    S->>S: Extract & organize by output template
    S->>S: Apply depth filter
    Note over S: Phase 4: Output
    S->>O: Write tech-brief file
    S-->>U: Report complete
```

### Phase 1: Context Resolution

1. Parse `$ARGUMENTS` for feature-key, path, or flags
2. Resolve feature using `node scripts/resolve-feature.js [--feature <key>]` — the wrapper, not the
   CLI: it owns the failure payload. If `scan_error !== false` — including a
   payload with no such field, which is what a shell `|| echo '{}'` fallback produces — the four
   source sets are **unknown, not empty**. Stop and take the ⚠️ Need Human exit; a non-null `key`
   is not evidence the sets are complete
3. Load `doc_inventory` and the four source sets from resolver output
4. Validate paths (see Path Security)

#### Input Resolution Table

| Input Type | Example | Feature Resolution | Default Output Path |
|-----------|---------|-------------------|-------------------|
| Feature key | `/tech-brief fp-brief` | `--feature fp-brief` | `docs/features/fp-brief/5-tech-brief.md` |
| Feature dir | `/tech-brief docs/features/fp-brief/` | Extract key from path | `docs/features/fp-brief/5-tech-brief.md` |
| Feature doc | `/tech-brief docs/features/fp-brief/2-tech-spec.md` | Extract key from parent | `docs/features/fp-brief/5-tech-brief.md` |
| Non-feature | `/tech-brief /tmp/notes.md` | No feature context | Require `--output` |
| No argument | `/tech-brief` | Auto-detect (5-level cascade) | Based on resolved feature |

### Phase 2: Multi-Source Collection

Three-stage collection. See `references/source-guide.md` for detailed strategy.

**Stage 1 — Document Collection**: Read `design_records` (tech-spec, architecture, feasibility) for the *why* and `current_authority` for the *what it does now*. All optional — and a brief that presents a design record's claim as shipped behaviour is the failure mode to avoid; Stage 2's code evidence is what settles the difference.

**Stage 2 — Code & Git Evidence**: `git log -20`, `git diff --stat`, read top 5 changed source files (100 lines each) for `file:line` references.

**Stage 3 — Request Selection**: Glob all request docs (no status filter — completed features are the primary use case), max 3 by date desc. Extract `## References` for threadIds and PR links.

### Phase 3: Synthesis

1. Build Source Provenance table (Section | Source Files | Confidence)
2. For each output section, extract content from mapped sources (see `references/output-template.md`)
3. Apply depth filter (section inclusion and detail level per depth matrix)
4. Apply Evidence Insufficient Rule: `[Source unavailable — no <type> found for this feature]`

### Phase 4: Output

See Save Behavior for output path resolution.

## Path Security

1. **Path normalization**: Resolve `..` and symlinks, verify repo boundary
2. **Traversal rejection**: Input containing `..` is rejected
3. **Output path**: `--output` allows repo-external paths (e.g. `/tmp/`), emit warning "writing outside repo"
4. **Secret redaction**: Before reading source docs, scan for high-confidence secret patterns (API keys, private keys) — high confidence: abort; medium confidence: mask `[REDACTED]`

## Depth Levels

| Level | Max Length | Description |
|-------|-----------|-------------|
| brief | ~500 words | Key points only — suitable for Slack sharing |
| normal | ~1500 words | Full coverage with source citations |
| deep | ~3000 words | Full coverage + code snippets + alternative comparison |

These are upper bounds, not targets. Source-thin features will produce shorter output.

## Output

See `references/output-template.md` for full template and depth matrix.

```markdown
# Tech Brief: <Feature Title>

> Feature: <key> | Depth: <level> | Generated: <timestamp>
> Sources: <list of docs read>

## Source Provenance
| Section | Source Files | Confidence |

## 1. Background & Problem
## 2. Design Decisions & Trade-offs
## 3. Implementation Highlights
## 4. Limitations & Known Issues
## 5. Discussion & References
## 6. Next Steps
```

### Save Behavior

| Condition | Output Path |
|-----------|------------|
| Default (feature resolved) | `docs/features/<key>/5-tech-brief.md` |
| `--output <path>` | Specified path (warn if outside repo) |
| `--no-save` | stdout only, no file written |
| No feature + no `--output` | Gate: Need Human |

Preferred canonical name: `5-tech-brief.md`. If `5-` prefix is occupied, use next available number.

## Verification

- [ ] Feature context resolved (5-level cascade or explicit)
- [ ] Path validation executed (no traversal, repo boundary)
- [ ] Secret redaction scan completed
- [ ] Source Provenance table present in output
- [ ] Each section cites source (or shows Missing Source marker)
- [ ] Output length within depth-level upper bound
- [ ] Evidence Insufficient markers used where source is thin

## References

- Output template: `references/output-template.md`
- Source collection guide: `references/source-guide.md`
- Feature context resolution: `@skills/create-request/references/feature-context-resolution.md`

## Examples

```
Input: /tech-brief seek-verdict
Action: Resolve feature → read tech-spec + request → git log → write 5-tech-brief.md

Input: /tech-brief --depth brief --output /tmp/sharing.md
Action: Auto-detect feature → collect sources → brief output → write /tmp/sharing.md

Input: /tech-brief docs/features/auto-loop-evolution/ --depth deep
Action: Extract key → read all docs + requests (top 3) → deep output with code snippets

Input: /tech-brief --no-save
Action: Auto-detect → collect → print to stdout (no file)
```
