---
name: update-docs
description: "Research current code state then update corresponding docs, ensuring docs stay in sync with code."
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(ls:*), Bash(git:*), Bash(find:*), Bash(node:*)
---

# Update Docs

## Trigger

- Keywords: update docs, sync docs, docs out of date, update-docs

## When NOT to Use

- Document review (use `/codex-review-doc`)
- Creating new docs (use `/tech-spec` or `/create-request`)
- Document refactoring (use `/doc-refactor`)

## Auto-Trigger

Auto-triggered after precommit Pass, only when the change maps to a feature under `docs/features/` (see `@rules/auto-loop.md` § Tiers, gate sequence). Can also be invoked manually.

## Task

### Step 1: Locate Docs and Related Code (5-Level Cascade)

**Key principle: can't find target → `## Gate: ⚠️ Need Human` — don't guess or create new docs.**

Use the shared feature context resolution algorithm (see `@skills/create-request/references/feature-context-resolution.md`):

**`scan_error` gate.** `scan_error !== false` ⇒ the source sets are **unknown, not empty** —
report it and take the ⚠️ Need Human exit rather than syncing against a corpus you could not enumerate — an unreadable
corpus and a feature with no documents both return empty, and the first one silently becomes
"nothing to sync". Gate on `!== false`, not
`=== true`: a `{}` payload from a shell fallback carries no such field at all, and a non-null `key`
is not evidence the sets are complete — `scan_error` rides alongside a resolved key.

| Confidence | Action |
|------------|--------|
| high/medium | Proceed with detected feature |
| low | Proceed with warning |
| null (not found) | Output `## Gate: ⚠️ Need Human` — do not guess |

### Step 1.5: Classify Each Target — Sync Authority, Freeze Records

**This skill rewrites current-authority docs. It does not rewrite records.**

`resolveDocRole(path, source, taxonomy)` in `scripts/lib/doc-metadata.js` answers which a file is,
and `owesCodeAlignment(path, source, taxonomy)` is the same answer as a boolean — a doc owes code
alignment exactly when its role is the fallback (current-authority) one.

**Both take a repository `path` as the first argument — never a role label.** Spelling it
`owesCodeAlignment()` invites the call that has already been made here once: passing the string
`"Design record"` where the path goes. That string matches no rule, so it falls through to
`FALLBACK_ROLE` and the function returns `true` — a **fail-closed default reads exactly like an
affirmative answer**, and the wrong reading was an instruction to rewrite a frozen record
(`docs/features/push-gate-optin/review-log-push-gate-optin.md`, round 43).

The four roles below are `BUILTIN_ROLE_CONFIG.closed_set` in that file, and the Examples column
states what its `path_defaults` patterns actually match — **read it there, not from the phase number**.
`docs-numbering.md` numbers documents by lifecycle *phase*; `doc-metadata.js` assigns *authority
role*. They are different axes, and reading the first as the second is what put `2-tech-spec.md` in
the Current-authority row of this table until 2026-08-21 — an instruction to rewrite a frozen design
record, and the exact failure the paragraph below this table warns about.

| Role | Matches (`path_defaults`) | What this skill does |
|------|---------------------------|----------------------|
| Current authority — owes code alignment | `4-implementation*`; anything whose first segment is `skills`/`rules`/`agents`/`commands`; and the **fallback**, which is what `README.md` resolves through | Rewrite the sections the code changed |
| Design record — states a decision | Conventionally `0-feasibility-study*`, `1-requirements*`, `2-tech-spec*`, `3-architecture*` — but the pattern is `^[0-3]-(feasibility\|requirements\|tech-spec\|architecture)`, a **cross-product**: any of those four prefixes with any of those four stems, sixteen names, not four (see below) | **Do not rewrite.** Append a dated `> **Update(…)**` note recording what later changed |
| Work record — states what was asked | anything under a `requests/` segment | **Do not rewrite** — this skill does not touch it at all. `/create-request --update` may **overwrite** exactly four fields (Status, the Progress table, AC checkboxes, Progress.Note); everything else in the ticket is frozen, and a closed ticket is frozen entirely. That is the whole mutable set for an ordinary update. The single exception is a **reported factual correction** — a non-lifecycle recorded fact such as a path or a date, or an unfilled template placeholder that was never a statement about the ticket — which may also apply to a closed ticket, authorizes only that correction, and never unrelated trimming or cleanup; it must be stated in `Progress.Note`. It must **never** change `Status`, a Progress phase status, or AC checkbox state: those lifecycle fields stay governed by the freeze and the ordinary transition rules, or "the erroneous fact" becomes a label an agent can put on a lifecycle edit to walk past them. Both halves are defined once in `skills/create-request/SKILL.md` § Phase 4.5 |
| History record | `review-log-*`, `adr-*` | **Do not rewrite.** Append only |

`owesCodeAlignment(path, source, taxonomy)` is `resolveDocRole(path, source, taxonomy) ===
FALLBACK_ROLE` — the **`Current authority` role and nothing else**, so the three record rows are one
decision, not three. Named by role, not by position: "the first row" was true only until somebody
reordered or inserted one, and a reordered table would then have silently redirected this
instruction at a record.

**The four canonical pairings — `0-feasibility-study`, `1-requirements`, `2-tech-spec`,
`3-architecture` — are a naming convention (`@rules/docs-numbering.md`), not what the classifier
tests.** Measured 2026-08-21: `1-tech-spec.md`, `3-requirements.md`, `0-architecture.md` and
`2-feasibility-study.md` all resolve to **Design record**, because the prefix and the stem are
matched independently. Listing only the four pairings invites the opposite reading — that an
off-convention name is a gap the classifier cannot see — and it is the reverse: the classifier is
wider than the convention, deliberately, so a mis-numbered spec is still protected from rewriting.
Where it does stop is the prefix: `4-tech-spec.md` falls past `[0-3]` into the fallback and
resolves to **Current authority**, i.e. rewritable. A spec numbered outside the range loses the
protection its name suggests, so fix the number rather than relying on the stem.

A record that disagrees with today's code is not stale — that disagreement *is* the record. Editing
it to agree destroys the only copy of what was decided, and buys nothing: the reviewer reads records
under the `record-diff` profile, which carries no code-alignment obligation
(`skills/doc-review/SKILL.md` § Review Profiles).

Report a record you were pointed at rather than silently skipping it — "not in scope for rewriting"
is a fact the caller needs, and silence reads as "synced".

### Step 2: Research Current Code State

Key research items:
- Any new scripts / skills / commands added?
- Any modified logic in existing files?
- Any new configuration or rules added?
- Any API or interface changes?

### Step 3: Compare Docs vs Code Differences

| Item | Doc Description | Current Code | Status |
|------|----------------|-------------|--------|

### Step 4: Update Docs

Update document content based on differences:
1. Architecture diagrams (Mermaid sequenceDiagram / flowchart)
2. Core service table
3. API description
4. Data model

### Step 5: Verification

After update:
1. Re-read updated document sections
2. Verify all new modules are documented
3. Verify all removed modules are cleaned up

## Safety Valve

After doc sync, compare code diff against pre-sync baseline. If new code changes exist (e.g., lint:fix modified code), return to review loop.

## Output

```markdown
## Doc Update Report

| Document | Sections Updated | Status |
|----------|-----------------|--------|

## Changes Made
- <summary of each update>

## Verification
- [ ] New modules documented
- [ ] Removed modules cleaned
- [ ] Diagrams updated
```
