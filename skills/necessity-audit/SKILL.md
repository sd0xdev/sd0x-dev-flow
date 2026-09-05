---
name: necessity-audit
description: "Necessity audit for over-designed spec elements. Use when: auditing lifecycle spec (1-requirements / 2-tech-spec / 3-architecture) for YAGNI/KISS violations, challenging necessity of FRs/NFRs/abstractions/configs via Codex adversarial debate. Not for: FP reasoning validity (use /codex-review-spec), completeness check (use /feature-completeness), detail review (use /codex-review-doc), or code-level simplification (use /simplify)."
allowed-tools: Read, Grep, Glob, Write, Bash(node:*), Bash(mktemp:*), Skill
---

# Necessity Audit

3-phase necessity audit with Codex adversarial debate. Identifies over-designed elements in lifecycle specs via 6-dimension YAGNI rubric.

## Non-Negotiable Rules

> **SKILL.md is the normative source.** Reference files elaborate but do not override.

| # | Rule | Violation = |
|---|------|-------------|
| 1 | Phase A classification output **must NOT** appear in Phase B debate topic | Audit invalid |
| 2 | Phase B **must** invoke `/codex-brainstorm` via Skill tool — a raw transport dispatch for debate is invalid | Audit invalid |
| 3 | Phase C report **must** include non-empty `debate.threadId` | Report rejected |
| 4 | Phase C report **must** include `Debate Conclusion` referencing specific rounds (not blank / placeholder) | Report rejected |
| 5 | Output **must** start with `## Necessity Audit` header and end with `✅ Audit Clear` OR `⛔ Audit Revise` sentinel | Auto-loop cannot parse |

## Trigger

- Keywords: necessity audit, over-design, YAGNI audit, spec necessity, 過度設計, over-engineered

## When NOT to Use

### Alternatives by intent

| Intent | Use | Not this skill |
|--------|-----|----------------|
| 「這段推理站得住嗎？」 | `/codex-review-spec` (planned) / `/review-spec` | — |
| 「這個 spec 完成了嗎？」 | `/feature-completeness` (planned) | — |
| 「這個 code 是否過度抽象？」 | `/simplify` / `/refactor` | — |
| 「這個實作符合產業標準嗎？」 | `/best-practices` | — |
| **「這個 spec 是否過度設計？需要砍嗎？」** | **`/necessity-audit` ← this skill** | — |

### Chain recommendation

`/codex-review-doc` (detail) → `/codex-review-spec` (reasoning, planned) → **`/necessity-audit` (necessity, this skill)** → `/feature-completeness` (completeness, planned) → `/review-spec` (synthesis)

## Arguments

| Arg | Required | Default | Purpose |
|-----|----------|---------|---------|
| `<path>` | Yes | — | Target lifecycle spec (repo-relative) |
| `--depth brief\|normal\|deep` | No | `normal` | Dimension coverage + equilibrium strictness |
| `--continue <threadId>` | No | — | Resume Phase C per `@skills/codex-code-review/references/codex-transport.md` § Resume |
| `--skip-preflight` | No | false | Skip state-read advisory; emits `[PREFLIGHT SKIPPED]` banner |
| `--include-feasibility` | No | false | Accept `0-feasibility-study.md` (emits override banner) |
| `--override <id>:<rationale>` | No (repeatable, `;`-separated) | — | Mark Cut element as kept with justification |
| `--output markdown\|json` | No | `markdown` | Output format |

## Workflow

```
Phase 0 preflight → Phase A classify → Phase B Codex debate → Phase C consolidate → Redact → Emit
```

### Phase 0: Preflight (executable)

> **Scratch directory — read this before running any step.** Each Bash invocation is a **fresh
> shell**: a variable assigned in one step does not exist in the next. Do **not** write
> `TMPDIR=$(mktemp -d)` and then reference `$TMPDIR` later — on macOS `TMPDIR` is an *ambient*
> variable already pointing at the shared temp root (`/var/folders/…/T/`), so later steps silently
> read and write there, and the final `rm -rf $TMPDIR` would target that shared root.
>
> Instead: run `mktemp -d` **once**, read the path it prints, and **substitute that literal
> absolute path** into every later command. The placeholder `<AUDIT_TMP_DIR>` below marks each
> substitution site. Never name the variable `TMPDIR`.

```bash
mktemp -d
# → e.g. /var/folders/ab/cd1234/T/tmp.XyZ123 — reuse this literal path below as <AUDIT_TMP_DIR>
```

Immediately **claim** it. The claim mints a one-time capability token and stores it in a marker
inside the directory; the cleanup step requires that exact token back. This is what binds the
delete to *this* run's directory rather than to any directory that merely looks like one — or to
another concurrent audit's directory, which also carries a valid marker:

```bash
node scripts/skills/necessity-audit/cleanup.js --claim "<AUDIT_TMP_DIR>"
# → token=3f9c…  (48 hex chars) — reuse this literal token in Phase 4 as <AUDIT_TOKEN>
```

Read the `token=` line it prints and carry that literal value to the cleanup step, the same way you
carry the directory path. Like `<AUDIT_TMP_DIR>`, it cannot be held in a shell variable — each Bash
invocation is a fresh shell.

```bash
node scripts/skills/necessity-audit/preflight.js \
  --path <path> --depth <depth> \
  [--skip-preflight] [--include-feasibility] \
  --output "<AUDIT_TMP_DIR>/preflight.json"
```

Non-zero exit = hard block. Read `<AUDIT_TMP_DIR>/preflight.json` to continue.

### Phase A: Claude classify (LLM)

Read target file with Read tool. Apply `references/phase-a-classify.md` template substituting `${TARGET_PATH}`, `${DOC_KIND}`, `${ACTIVE_DIMENSIONS}`, `${GREENFIELD}` from preflight.

Extract elements (FR / NFR / Component / Abstraction / Extensibility / Config), score each against active dimensions only (depth=brief → dims 1-3; normal/deep → dims 1-6), assign initial Keep/Review/Cut.

Write result: `Write` tool → `<AUDIT_TMP_DIR>/phase-a.json` with schema `{ elements: ClassifiedElement[] }` (only `claude.*` fields populated).

### Phase B: Codex debate (Skill invocation)

```bash
node scripts/skills/necessity-audit/debate-topic.js build \
  --preflight "<AUDIT_TMP_DIR>/preflight.json" \
  --output "<AUDIT_TMP_DIR>/topic.txt"
```

Read topic, invoke:

```
Skill("codex-brainstorm", <contents of <AUDIT_TMP_DIR>/topic.txt>)
```

Write raw response: `Write` tool → `<AUDIT_TMP_DIR>/debate.txt`.

```bash
node scripts/skills/necessity-audit/debate-topic.js parse \
  --input "<AUDIT_TMP_DIR>/debate.txt" \
  --output "<AUDIT_TMP_DIR>/debate.json"
```

### Phase C: Consolidate (executable)

```bash
node scripts/skills/necessity-audit/consolidate.js \
  --phase-a "<AUDIT_TMP_DIR>/phase-a.json" \
  --debate "<AUDIT_TMP_DIR>/debate.json" \
  --preflight "<AUDIT_TMP_DIR>/preflight.json" \
  --overrides "<id>:<rationale>[;...]" \
  --depth <depth> \
  --output "<AUDIT_TMP_DIR>/report.json"
```

Applies 6 deterministic checks, under-coverage check, `--override` handling, gate selection.

### Assemble + Redact + Emit

```bash
node scripts/skills/necessity-audit/report.js \
  --input "<AUDIT_TMP_DIR>/report.json" \
  --format markdown \
  --output "<AUDIT_TMP_DIR>/report.md"

node scripts/skills/necessity-audit/redact.js \
  --input "<AUDIT_TMP_DIR>/report.md" \
  --output "<AUDIT_TMP_DIR>/report.final.md"
```

Read `<AUDIT_TMP_DIR>/report.final.md` and emit as final user-visible message.

Cleanup. The path condition is **enforced by the script, not by this paragraph**. It refuses
(exit 1, deleting nothing) on an unsubstituted placeholder, a relative path, a symlink, a
non-directory, the filesystem root, anything that is not a direct child of this process's temp root
— in particular the shared temp root itself, the path an ambient-`TMPDIR` mistake produces — any
directory carrying no `--claim` marker, and, decisively, **any directory whose marker was minted
with a different token**. That last check is what rules out a substitution naming a *different*,
equally valid-looking scratch directory: shape is common to all of them and so is the marker, since
every concurrent audit claims its own — only the token is unique to this run. Removal is idempotent,
so re-running after a partial failure is safe:

```bash
node scripts/skills/necessity-audit/cleanup.js --dir "<AUDIT_TMP_DIR>" --token "<AUDIT_TOKEN>"
```

Before running it, **re-read the path** you are substituting and confirm it is the exact absolute
path Phase 0 printed. The guard refuses a wrong one, but a refusal is a stalled cleanup — getting
the substitution right is still your job. If the guard does refuse, do not work around it with a
manual `rm`: fix the substitution.

## Output Format + Gate Selection

Output header, sections, sentinel: see `references/output-template.md` (normative).
Gate-selection decision table + narrative rules: see `references/phase-c-consolidate.md`.

Invariant: `⚠️ Need Human` NEVER appears as the final gate — only as a narrative line above the `✅ Audit Clear` / `⛔ Audit Revise` sentinel.

## Review Loop (`--continue`)

After user revises the spec, re-run with `--continue <threadId>` to reuse the Codex debate context via `@skills/codex-code-review/references/codex-transport.md` § Resume. See `references/review-loop.md`.

## References

- `references/dimensions.md` — 6-dimension × 4-tier rubric (authoritative)
- `references/phase-a-classify.md` — Phase A prompt template
- `references/phase-b-debate-topic.md` — Phase B topic builder documentation
- `references/phase-c-consolidate.md` — Phase C logic
- `references/output-template.md` — Markdown report layout
- `references/review-loop.md` — `--continue` flow
- `references/redaction-rules.md` — Secret / PII patterns applied by `redact.js`

## Verification

- [ ] Phase B used `Skill("codex-brainstorm")`, not a raw transport dispatch
- [ ] Report contains non-empty `debate.threadId`
- [ ] Report contains non-empty Debate Conclusion
- [ ] Output starts with `## Necessity Audit` header
- [ ] Output ends with `✅ Audit Clear` OR `⛔ Audit Revise` sentinel
- [ ] Output contains NO doc-review gate sentinel (the `Mergeable` / `Needs revision` pair) anywhere — an audit must not be mistakable for a doc review
- [ ] `⚠️ Need Human` never used as gate (only as narrative)
- [ ] Redaction applied before emission

## Examples

```
Input: /necessity-audit docs/features/foo/2-tech-spec.md
Action: Phase 0 preflight → Phase A classify → Phase B debate → Phase C consolidate → report + redact → emit with sentinel

Input: /necessity-audit docs/features/foo/2-tech-spec.md --continue 019dab42-xxxx
Action: Resume per `@skills/codex-code-review/references/codex-transport.md` § Resume; re-run Phase C with updated spec; emit diff-focused report

Input: /necessity-audit docs/features/foo/1-requirements.md --depth brief --skip-preflight
Action: Only challenge dims 1-3; skip state advisory; emit [PREFLIGHT SKIPPED] banner

Input: /necessity-audit docs/features/foo/2-tech-spec.md --override FR-12:"needed for Q3 rollout"
Action: FR-12 kept with justification; final gate ✅ Audit Clear if no other Cut items remain
```
