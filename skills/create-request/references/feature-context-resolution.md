# Feature Context Resolution

Shared algorithm for resolving "current feature" across document lifecycle skills (`/update-docs`, `/tech-spec`, `/create-request`).

**Canonical implementation**: `scripts/lib/feature-resolver.js`
**CLI module** (low-level, not the entrypoint — invoke the wrapper): `scripts/resolve-feature-cli.js`
**Wrapper**: `node scripts/resolve-feature.js [--feature <key>]` — call this one. It emits the full
shape with `scan_error: true` when the CLI cannot run; `... || echo '{}'` emits a payload with no
`scan_error` at all — which a gate spelled `scan_error === true` reads as success. The gates
below are spelled `!== false` for exactly that reason.

**Node is the default entrypoint, because it is the one the migrated skills can reach.** Neither
permission is universal: `/adr`, `/ask`, `/runbook` and `/tech-brief` grant `Bash(node:*)` and not
`Bash(bash:*)`, while `/codex-code-review` grants `Bash(bash:*)` and no node permission at all.
Node is also shell-agnostic, which matters where the interactive shell is zsh. So
`scripts/resolve-feature.sh` is not vestigial — it is the entrypoint for `!` context blocks and for
the bash-granting callers (`/test-health`, `/codex-code-review`). It holds no logic of its own,
because two copies of a fallback payload drift. The binding rule is not "always Node"; it is that a
skill names the entrypoint **it is permitted to run**.

**Whatever a skill names, it must be permitted to run.** An instruction whose command the skill's
`allowed-tools` forbids is worse than the direct CLI call it replaced: it reads correct and cannot
execute, and every text-level check passes. `test/skills/scan-error-gate.test.js` asserts the
instruction and the permission together for exactly that reason.

## Resolution Cascade

Two layers work together: the **behavior layer** (skill `SKILL.md` files handle `$ARGUMENTS`) and the **code layer** (`feature-resolver.js` handles programmatic detection).

### Behavior Layer (skill SKILL.md responsibility)

| Priority | Signal | Handling |
|----------|--------|----------|
| 0 | `$ARGUMENTS` is a docs path (e.g. `docs/features/auth/`) | Use path directly — bypass resolver |
| 0 | `$ARGUMENTS` is a feature keyword | Pass as `--feature <key>` to resolver |

### Code Layer (feature-resolver.js — 4 programmatic levels)

| Level | Signal | Detection | Confidence |
|-------|--------|-----------|------------|
| 1 | `--feature <key>` | Explicit key parameter | high |
| 2 | Branch name | `git branch --show-current` matches `feat/<key>` | high |
| 3 | Changed paths | `git diff --name-only HEAD` matches `docs/features/<key>/` or `skills/<key>/` | medium |
| 4 | Single feature dir | `ls docs/features/` has exactly 1 directory | low |
| - | Not found | None of the above | null — Gate: Need Human |

**Slug validation**: `/^[a-z0-9][a-z0-9._-]*$/i` — rejects path traversal (`../`, `/`, `.hidden`).

## Shell Equivalent (for `!` context blocks)

**Every reader of this file can run the block below**, and that is a property of where the file
lives rather than of anything it says about itself. It used to sit in `skills/tech-spec/references/`
— the bundle of the one lifecycle skill that grants `Bash(git:*)` and no node permission, so the
owner could not run the reference it owned. The fix was to move the file to an owner that can
(`/create-request`, unrestricted `Bash`) and give `/tech-spec` its own command-free
`references/native-feature-resolution.md`, not to annotate the mismatch and ask readers to honour
the annotation. A prose declaration of "this reader executes nothing" is not checkable: any later
paragraph in the same file can reverse it and every text-level check still passes.

Current readers, all granting `Bash(node:*)` or wider: `/adr`, `/architecture`, `/create-request`,
`/req-analyze`, `/runbook` (transitively, via its own `references/discovery-heuristics.md`),
`/tech-brief`, `/update-docs`.

```bash
# Get feature context as JSON — via the wrapper, which owns the failure payload
node scripts/resolve-feature.js

# With explicit key
node scripts/resolve-feature.js --feature statusline-config
```

**Output schema**:

```json
{
  "key": "statusline-config",
  "source": "branch",
  "confidence": "high",
  "docs_path": "docs/features/statusline-config",
  "doc_inventory": [
    { "file": "2-tech-spec.md", "type": "tech-spec", "namespace": "lifecycle", "confidence": "high", "is_canonical": true, "role": "Design record" }
  ],
  "canonical_docs": {
    "tech_spec": { "file": "2-tech-spec.md", "path": "2-tech-spec.md" },
    "architecture": null,
    "feasibility": null,
    "requirements": null
  },
  "current_authority": [],
  "design_records": [
    { "file": "2-tech-spec.md", "type": "tech-spec", "namespace": "lifecycle", "confidence": "high", "is_canonical": true, "role": "Design record" }
  ],
  "work_records": [
    { "file": "requests/2026-08-09-quota-display.md", "type": "appendix", "namespace": "unknown", "confidence": "low", "is_canonical": false, "role": "Work record" }
  ],
  "history_records": [],
  "scan_error": false,
  "has_tech_spec": true,
  "has_requirements": false,
  "has_requests": true
}
```

**New fields** (added by doc-classification r1):
- `doc_inventory`: Array of classified documents in the feature directory. Each entry has `file`, `type`, `namespace`, `confidence`, `is_canonical`, `role`.
- `canonical_docs`: Map of stable roles (`tech_spec`, `architecture`, `feasibility`, `requirements`) to their canonical file path, or `null` if not present.
- Legacy booleans (`has_tech_spec`, `has_requirements`, `has_requests`) are now derived from `canonical_docs` and directory scan.

### Source sets (doc-review-phasing r2)

`canonical_docs` answers "which file is the tech spec", and consumers read that as "which file
describes the system" — so a frozen design record gets handed to research as current behaviour.
The four sets separate the two questions. **`canonical_docs` is now a deprecated alias**, retained
while consumers migrate — and *unchanged*: it is still selected from `doc_inventory`, exactly as
before the split. Selecting it from `current_authority` + `design_records` looked equivalent and is
not: a tech spec declaring `Doc role: History record` leaves both sets, and the alias — plus the
legacy `has_tech_spec` derived from it — would go null/false on a document still in the inventory.

**`scan_error` is what makes an empty set readable.** Gate on **`scan_error !== false`**, never on
`scan_error === true`. Empty means "no document has that role" *only* when the field is exactly
`false`; anything else means the sets are **unknown, not empty** — the corpus could not be
enumerated (unreadable feature or `requests/` directory, broken taxonomy, no git repository), *or*
the resolver never ran and a shell fallback supplied a payload with no such field at all. `{}` is
the shape that makes the stricter test useless: `=== true` is false for it, so the gate opens on a
payload containing nothing. Reading that as "nothing here owes alignment" is the fail-open
direction. Call `node scripts/resolve-feature.js`, which emits the full shape with
`scan_error: true` for every failure it can observe — a nonzero CLI exit, a signal, a truncated
write, a payload that is not the agreed shape. The one it cannot report is `node` itself being
unavailable, which produces no JSON at all rather than a misleading payload. The field is present on
every resolver branch and every CLI exit, and a non-null `key` is not evidence the sets are complete.

Each field holds the same classified entry objects `doc_inventory` holds — `{ file, type,
namespace, confidence, is_canonical, role }`, `file` relative to the feature directory — not bare
paths. The sets are a partition by resolved `role`, so **"Typically" below is the path default, not
the contents**: any document can move by declaring metadata.

| Field | Typically | Answers |
|-------|-----------|---------|
| `current_authority` | `4-implementation*`, docs explicitly marked authoritative, and **everything unrecognised** (fail-closed) | "what does the system do now" — together with code and `rules/` |
| `design_records` | tech specs, architecture, feasibility, requirements | "why was it built this way" |
| `work_records` | `requests/**`, including `requests/archived/**` | "what was asked for, and is it still open" |
| `history_records` | review logs, ADRs | "what was decided, when" |

Two things to know when reading them:

- **`doc_inventory` and the sets disagree on `requests/` by design.** The inventory keeps its
  original meaning and excludes it; `work_records` covers it. The document count is the union of
  the **four source sets**, and nothing else: `doc_inventory` plus `work_records` equals it only
  while every request is a work record and no other document declares itself one. A request
  declaring `> **Current behavior authority**: Yes` leaves `work_records` and stays out of
  `doc_inventory`, so that sum under-counts; a non-request declaring `Doc role: Work record`
  makes it double-count.
- **Roles resolve with no migration**, in this order — and steps 1 and 4 are why "metadata beats
  path" is the wrong summary: (1) authority `Yes` ⇒ `Current authority`, beating everything;
  (2) `> **Doc role**: …`, exact match, in the top-of-document metadata preamble — not anywhere in
  the file; (3) the path default; (4) authority `No`, applied last, demoting **only** a
  `Current authority` result to `History record` — so `No` on a tech spec leaves it a
  `Design record`. Anything unrecognised resolves to `Current authority`, which owes the fullest
  review. An unusable configured key name fails the whole document to `Current authority` too.
  Path defaults are configuration, in `scripts/config/doc-taxonomy.json` § `doc_roles`.

## Upsert Decision Table

When a skill resolves a feature context, use filesystem state to decide create vs update:

**"Exists?" means canonical discovery found it, not that one literal path is on disk.** A spec split
into `2-tech-spec/2-tech-spec.md`, or carrying a variant name, exists — testing
`docs/features/<key>/2-tech-spec.md` alone answers "no" and creates a second spec beside the real
one. Run the glob cascade first — it is three globs, stated here rather than by pointing at another
skill's instructions:

| # | Glob | Meaning |
|---|------|---------|
| 1 | `docs/features/<key>/2-tech-spec.md` | Unsplit canonical spec |
| 2 | `docs/features/<key>/2-tech-spec/2-tech-spec.md` | Split spec — folder keeps the lifecycle prefix, main file keeps the canonical filename |
| 3 | `docs/features/<key>/2-tech-spec*.md`, minus `-fp-brief.md` / `-tech-brief.md` | A variant. Those two suffixes are excluded because `scripts/config/doc-taxonomy.json` excludes them from the `tech-spec` type, and `docs/features/seek-verdict/` holds a live one |

Two or more remaining hits at step 3 is ambiguity, not a match: name the candidates and take the
Need Human exit. Then read this table with the cascade's answer.

| Target | Exists? | Action | Confirmation |
|--------|---------|--------|-------------|
| tech spec, per the cascade | Yes (exactly one) | Update (incremental) **at the discovered path** | None |
| tech spec, per the cascade | No (all globs empty) | Create from template at `docs/features/<key>/2-tech-spec.md` | None |
| tech spec, per the cascade | Ambiguous (2+ variants) | Stop — name the candidates | Gate: Need Human |
| `docs/features/<key>/requests/*.md` (1 active) | Yes | Update that request | None |
| `docs/features/<key>/requests/*.md` (N active) | Yes | AskUserQuestion: which? | Required |
| `docs/features/<key>/requests/*.md` (0 active) | No | Create new request | None |
| `docs/features/<key>/` directory | No | Create directory + target file | Gate confirmation |

**Active request**: Status not in `[Completed, Done, Superseded, Archived]` (the closed set is exhaustive — anything else, including a missing Status, is active). Canonical source: `scripts/lib/request-status.js`.

## Cross-Link Invariants

When creating or updating documents, enforce bidirectional links:

| When creating... | Must link to... | Link format |
|-----------------|----------------|-------------|
| Requirements doc | Tech spec (if exists) | `> **Tech Spec**: [<canonical_docs.tech_spec.file>](./<canonical_docs.tech_spec.file>)` |
| Requirements doc | Active request(s) | `> **Requests**: [Title](./requests/YYYY-MM-DD-*.md)` |
| Request doc | Requirements (if exists) | `> **Requirements**: [<canonical_docs.requirements.file>](../<canonical_docs.requirements.file>)` |
| Request doc | Tech spec (if exists) | `> **Tech Spec**: [<canonical_docs.tech_spec.file>](../<canonical_docs.tech_spec.file>)` |
| Tech spec | Requirements (if exists) | `> **Requirements**: [<canonical_docs.requirements.file>](./<canonical_docs.requirements.file>)` |
| Tech spec | Active request(s) | `> **Requests**: [Title](./requests/YYYY-MM-DD-*.md)` |
| Update-docs report | All applicable | In report summary section |

**Filename resolution**: Use `canonical_docs.<role>.file` from `feature-resolver.js` output instead of hardcoded filenames. Variant filenames (e.g. `1-requirements-v2.md`) are supported. Fallback to default names (`1-requirements.md`, `2-tech-spec.md`) only when `canonical_docs` is unavailable.

**Lazy repair**: On any skill invocation, check existing links are valid. Fix broken relative paths silently.

## Ambiguity Handling

| Condition | Action |
|-----------|--------|
| confidence = `high` | Proceed automatically |
| confidence = `medium` | Proceed, note source in output |
| confidence = `low` | Proceed with warning |
| confidence = `null` (not found) | Gate: Need Human — do not guess |
| Multiple active requests for `--update` | AskUserQuestion with numbered list |

## Integration with Existing Workflows

| Workflow | How it uses context |
|----------|-------------------|
| `/feature-dev` doc sync | After precommit pass, auto-detect feature for `/update-docs` + `/create-request --update` |
| `/next-step` | `analyze.js` uses same resolver for doc-sync and request-stale suggestions |
| Auto-loop | Doc sync target detection uses this cascade (replaces ad-hoc 3-level fallback) |
