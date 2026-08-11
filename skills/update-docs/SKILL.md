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

Auto-triggered after precommit Pass, only when the change maps to a feature under `docs/features/` (see `@rules/auto-loop.md` § Doc Sync). Can also be invoked manually.

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
and `owesCodeAlignment()` is the same answer as a boolean — a doc owes code alignment exactly when
its role is the fallback (current-authority) one.

| Class | Examples | What this skill does |
|-------|----------|----------------------|
| Current authority — owes code alignment | `2-tech-spec.md`, `3-architecture.md`, `README.md` | Rewrite the sections the code changed |
| Record — states a point in time | `requests/*.md`, `review-log-*.md`, `adr-*.md` | **Do not rewrite.** Status and outcome only, appended by `/create-request --update` |

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
