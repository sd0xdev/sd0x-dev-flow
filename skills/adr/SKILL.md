---
name: adr
description: "Write an Architecture Decision Record (ADR) for a feature — Context / Decision / Status / Consequences / Alternatives, filed as docs/features/<feature>/adr-<NNN>-<title>.md with a 3-digit zero-padded number. Handles the Superseded case: bidirectional linking when a new ADR replaces an old one. Use when: recording why an architectural approach was chosen, documenting a decision so it doesn't get re-litigated, marking a prior decision as superseded. Not for: feature-level technical design (use /tech-spec), task progress tracking (use /create-request), bulk backfill of historical decisions (a separate request — this skill writes one ADR at a time)."
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(node:*), AskUserQuestion
---

# ADR — Architecture Decision Record

## Trigger

- Keywords: ADR, architecture decision record, decision record, record a decision, why did we choose, 架構決策, 決策紀錄

## When NOT to Use

| Scenario | Alternative |
|----------|------------|
| Feature-wide technical design (components, data flow) | `/tech-spec` |
| Task progress / acceptance-criteria tracking | `/create-request` |
| Bulk backfill of decisions already made in the past | Separate request — this skill writes one ADR per invocation, not a batch |

## Workflow

```
Phase 1: Resolve feature  → shared feature-context resolution
Phase 2: Compute number   → scan root + archived/, numeric max + 1, zero-pad to 3 digits
Phase 3: Gather content   → Context / Decision / Status / Consequences / Alternatives
Phase 4: Write ADR        → fill references/template.md, write to docs/features/<key>/
Phase 4b: Superseded link → (only if this ADR supersedes an existing one) edit both files
Phase 5: Report           → path written, number assigned, links updated
```

### Phase 1: Resolve Feature

Reuse the shared cascade — do not re-derive it here:
`@skills/create-request/references/feature-context-resolution.md` — the single copy since
doc-review-phasing r2 merged the two that had drifted apart; `/tech-spec` now keeps its own
command-free native-cascade reference in its own bundle instead of a second copy of this one —
canonical implementation `scripts/lib/feature-resolver.js`, invoked as
`node scripts/resolve-feature.js [--feature <key>]`.

**`scan_error` gate.** `scan_error !== false` ⇒ the source sets are **unknown, not empty** —
report it and take the ⚠️ Need Human exit rather than recording a decision against a corpus you could not read — an ADR is a
time-stamped claim about what was true, and one written from an unreadable corpus is wrong forever. Gate on `!== false`, not
`=== true`: a `{}` payload from a shell fallback carries no such field at all, and a non-null `key`
is not evidence the sets are complete — `scan_error` rides alongside a resolved key.

**The wrapper, not the CLI.** `resolve-feature.js` is the single owner of the failure payload: it
exits 0 and emits the full shape with `scan_error: true` however the CLI fails — nonzero exit,
signal, partial write, or a payload that is not the agreed shape; it cannot cover `node` itself
being missing, since nothing running under node can — where the CLI invoked
directly can die mid-write and a `|| echo '{}'` fallback of your own emits a payload with no
`scan_error` field at all. This skill briefly carried an exemption on the grounds that its
`allowed-tools` could not reach `bash`. The fix was not to widen the tool list but to make the
entrypoint reachable: `resolve-feature.js` runs under the `Bash(node:*)` this skill already grants,
so there is one failure contract and no exemptions, at no cost in permissions. (`Bash(node:*)` is
not universal either — `/codex-code-review` grants bash and no node, and keeps the shell shim. The
rule is that a skill instructs the entrypoint *it* is permitted to run.) This skill reads `key`,
`confidence` and `docs_path` only and consumes none of the four source sets, so the `scan_error`
gate the research skills carry does not bind it — but a `{}` reply still means the invocation failed
and is never an empty corpus.

**The gate below checks the directory (and the confidence), not `key` alone.** For Levels 1–3
(explicit `--feature` with a valid slug, branch `feat/<x>`, or a changed path under
`docs/features/<key>/`), `resolveFeatureContext` returns a non-null `key` with
`confidence: "high"` or `"medium"` even when `docs/features/<key>/` does not exist on disk — it
only probes the directory to enrich the result, never to invalidate it
(`scripts/lib/feature-resolver.js` § `probe`). An explicit `--feature` value that fails the
case-insensitive slug pattern (`/^[a-z0-9][a-z0-9._-]*$/i`, e.g. `--feature ../evil`) is rejected
at `scripts/lib/feature-resolver.js:13` before it ever reaches `key`. Level 3b (a changed path
under `skills/<key>/`, from line 140) only returns when `probe()` finds the directory; on a miss it falls through — to
Level 4 if `docs/features/` has **exactly one** subdirectory (returns that directory's name as
`key` anyway, `source: "single_dir"`, `confidence: "low"` — a guess, not a match on the actual
change), otherwise to Level 5 (`key: null`). the resolver prints the **full result
object** in the null case, e.g. `{"key":null,"source":"none",...}` — a bare `{}` means something
else entirely (no git root, or the CLI itself threw). A typo'd `--feature` value is the likelier
failure and does **not** produce a null key (Level 1 still returns it with `confidence: "high"`),
so gating on `key` alone silently creates a bogus feature directory instead of asking:

| Result | Action |
|--------|--------|
| `key` resolved, `confidence` is `"high"` or `"medium"`, **and** `docs/features/<key>/` exists | Continue to Phase 2 |
| `key` resolved but `docs/features/<key>/` does not exist (check with `node -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" "docs/features/<key>"` — this skill's `allowed-tools` has no general `Bash`, only `Bash(node:*)`) | **Gate: Need Human** — confirm this is really a new feature directory the user wants created; do not silently write into a typo'd path |
| `confidence` is `"low"` (`source: "single_dir"`) | **Gate: Need Human** — this is a guess ("only one feature directory exists"), not a match on the actual change; confirm it's the right one before writing into it |
| `key` is `null` (the resolver prints the full object, e.g. `{"key":null,"source":"none",...}`) | **Gate: Need Human** — ask which feature this ADR belongs to; do not guess |

### Phase 2: Compute the Number

Scan **both** the feature's root directory **and** its `archived/` subdirectory for existing
`adr-*.md` files. `rules/docs-numbering.md` § Ancillary docs defines the `adr-<number>-<title>.md`
filename pattern but says nothing about `archived/` — that convention lives in
`scripts/lib/doc-classifier.js` (`scanFeatureDocs`, which skips directories named `archived` at any
depth when building its *live* doc inventory). A number retired there is still taken, so this scan
is deliberately broader than that inventory — building the live-doc list and computing the next
free number are different purposes.

Run `skills/adr/scripts/next-adr-number.js` — do not hand-apply the max.
Numeric max, not lexical sort: string-sorting `adr-9-...` after `adr-10-...` would collide, which
is exactly the bug that shipping this as an unexecuted prose pin would miss.

```bash
node skills/adr/scripts/next-adr-number.js docs/features/<key>
```

(paths are repo-root relative, matching every other path in this skill). The function itself
(`nextAdrNumber`, exported for direct unit testing —
`test/skills/adr.test.js` exercises it against real temp directories, not just a prose pin):

```js
function nextAdrNumber(featureDir) {
  let max = 0;
  for (const dir of [featureDir, path.join(featureDir, 'archived')]) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const m = name.match(/^adr-(\d+)-/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return String(max + 1).padStart(3, '0');
}
```

The regex is case-insensitive (`/i`) — a hand-written `ADR-006-x.md` on a case-insensitive
filesystem still counts toward the max, avoiding a reissued number. The first ADR in a feature
(both directories empty or missing) produces `adr-001-<title>.md`.

### Phase 3: Gather Content

If not already supplied via `$ARGUMENTS`, ask for:

1. **Title** — short, kebab-case (becomes the filename's `<title>` segment)
2. **Context** — what forces are at play, what problem prompted the decision
3. **Decision** — what was decided, stated as a decision, not a description
4. **Status** — `Proposed` or `Accepted` (default `Proposed`; a *new* ADR is never created as
   `Superseded` — that value is only ever set on an *existing* ADR, by Phase 4b, on a later ADR
   superseding it). If the user states this ADR supersedes an existing one, ask which of the two
   the new ADR should carry — `Accepted` is the common case, but `Proposed` is valid too — then run
   Phase 4b after Phase 4
5. **Consequences** — what becomes easier or harder as a result, including negative tradeoffs
6. **Alternatives considered** — what else was on the table and why it lost

### Phase 4: Write the ADR

Fill `references/template.md` and write to
`docs/features/<key>/adr-<NNN>-<title>.md`. The **H1 must literally contain the string `ADR`**
(e.g. `# ADR-001: <Title>`) — `doc-taxonomy.json`'s `heading_signals` for the `adr` type is
`["Decision Record", "ADR", "架構決策"]`. For a well-formed `adr-<NNN>-<title>.md` filename,
`classifyByPath`'s `semantic_pattern` alone already reaches `medium` confidence, so the two signals
are not combined to jointly lift confidence — `doc-classifier.js` only consults `heading_signals`
when `scanFeatureDocs` is called with its `deep` option (not a CLI flag; the only production
caller, `scripts/lib/feature-resolver.js:29`, does not pass it, so this path is currently exercised
only by direct calls and tests), and only when `classifyByPath` already returned the fallback type.
Even then, a correct H1 is **necessary but not sufficient**: `classifyByHeading` lowercases the
first 20 lines and returns the *first* taxonomy type (in array order) whose signal appears anywhere
in them — ten types precede `adr` (index 10 in `doc-taxonomy.json`): the five lifecycle types plus
`review-log`, `fp-brief`, `tech-brief`, `checklist`, and `runbook`. The last two matter most here,
since they are two of the four the classification guard below defends against on the *filename* path
— an ADR about operational tooling plausibly has "runbook", "checklist", or "SOP" in its own
Context, misclassifying it on the *heading* path even with a perfect H1. This claim is pinned by a
test, not left as prose alone (`test/skills/adr.test.js` calls `classifyByHeading` directly), since
it depends on `doc-taxonomy.json`'s array order and would silently go stale on a reorder. The H1
requirement is worth keeping as a best-effort signal for the fallback case, not a guarantee.

Remove `references/template.md`'s two commented-out placeholder blocks (the `<!-- -->` slots
documenting where a future Supersedes/Superseded-by line goes) — unless Phase 4b runs in the same
pass, in which case replace the relevant one with the real line instead of deleting it blank.

**Classification guard — run before writing, not after.** `doc-taxonomy.json`'s type list is
checked in array order, and four types sit *before* `adr` (index 10) with patterns a free-text
`<title>` can actually hit: `checklist` and `runbook` carry **unanchored** substring patterns
(`^checklist-|確認事項|checklist`, `^runbook-|操作手冊|runbook` — the word anywhere in the filename
matches, e.g. `adr-002-runbook-automation.md`), and `fp-brief`/`tech-brief` carry **suffix**
patterns (`-fp-brief\.md$`, `-tech-brief\.md$`) that match if the title happens to end in that
phrase, e.g. `adr-003-vendor-tech-brief.md`. All four classify silently as that other type instead
of `adr`. `<title>` is free text from Phase 3, so this is reachable, not theoretical.

**Pass the bare filename only, never the full write path.** `classifyByPath` has no
`basename()` step and is path-sensitive: run it against the *full* target path
(`docs/features/<key>/adr-<NNN>-<title>.md`) and two independent things break — the leading
`docs/features/` segment defeats the `^adr-` anchor entirely (falls to the taxonomy fallback
type), and if `<key>` itself contains a colliding word (e.g. a feature directory named
`deploy-runbook`) the *directory* name — not the title — decides the result. The guard command
below strips to the basename itself with `path.basename()` so it gives the same, correct answer
whether the value passed happens to be the bare filename or the full path — verified both ways:

```bash
node -e "const {basename}=require('path'); console.log(require('./scripts/lib/doc-classifier').classifyByPath(basename(process.argv[1])).type)" \
  "adr-<NNN>-<title>.md"
```

If the printed type is not `adr`, do **not** write the file under that name. Ask the user to
rephrase the title to avoid the colliding word, recompute, and re-check — up to 3 attempts. Never
silently write a misclassified ADR; this is not the same failure as an unresolved feature, so it
does not route through the Phase 1 Gate: Need Human on the first miss — it is a title-collision
retry loop, not a missing-input one. After 3 failed rephrasings, stop retrying and escalate:
**Gate: Need Human** — a user who keeps proposing colliding titles is the case this bounds; the
`path.basename()` fix above already rules out the directory-name-collision case (the feature key
itself contains the colliding word), so this cap only needs to bound retitling attempts, not an
unfixable path.

### Phase 4b: Superseded Linking (only when this ADR replaces an existing one)

Bidirectional — both files change, in the same pass. Both edits target the `> **Status**` /
`> **Created**` blockquote at the top of `references/template.md` — never the `## Status` section
further down, which is a static legend explaining the three enum values, not a per-ADR value slot:

| File | Edit |
|------|------|
| New ADR (just written) | Add `> **Supersedes**: [adr-<OLD>](<path>)` as a new blockquote line, directly below `> **Created**` |
| Old ADR (existing file) | Change the existing `> **Status**: <value>` line to `> **Status**: Superseded`; add `> **Superseded by**: [adr-<NEW>](<path>)` as a new blockquote line below it. If the old ADR predates this skill and has no `> **Status**:` line at all, add one rather than assuming it exists |

`<path>` is relative to the file doing the linking, and the old ADR may resolve to either
directory found in Phase 2's scan — get this from wherever Phase 2 actually found the old number,
don't assume root:

| Old ADR found in | New ADR's `<path>` | Old ADR's own `<path>` (self-referencing the new one) |
|-------------------|---------------------|----------------------------------------------------------|
| feature root | `./adr-<OLD>-<old-title>.md` | `./adr-<NEW>-<new-title>.md` |
| `archived/` | `./archived/adr-<OLD>-<old-title>.md` | `../adr-<NEW>-<new-title>.md` |

If the old ADR named as superseded does not exist at either location, **Gate: Need Human** — do
not silently skip the link or guess a different file. If the old ADR is already `Superseded` by a
third ADR, **Gate: Need Human** — do not overwrite the existing link or append a second one.

### Phase 5: Report

Output the path written, the assigned number, and (if Phase 4b ran) both files touched with a
one-line diff summary of the added link.

## Numbering & Classification — Verification

- `adr-001-<title>.md` is the first-ADR filename shape (AC edge case)
- Number is a **numeric** max over `^adr-(\d+)-` (case-insensitive) across root + `archived/`,
  computed by `skills/adr/scripts/next-adr-number.js`, never hand-applied or a string sort
- `docs/features/<key>/adr-<NNN>-<title>.md` classifies via `doc-classifier.js`'s `semantic_pattern`
  (`^adr-|decision`) at step 4 — `medium` confidence, **not** the step-7 fallback type — **only when
  the title contains no word matching another type's pattern**; the Phase 4 classification guard
  exists because titles containing `runbook`, `checklist`, or ending in `-fp-brief`/`-tech-brief`
  demonstrably do not

## Output

- New ADR file at `docs/features/<feature>/adr-<NNN>-<title>.md`
- If superseding: the prior ADR file also modified (Status flip + Superseded-by link)

## Verification Checklist

- [ ] Filename matches `adr-<NNN>-<title>.md`, 3-digit zero-padded
- [ ] Number computed via `skills/adr/scripts/next-adr-number.js` (numeric max across root + `archived/`, not
      lexical sort, not hand-applied)
- [ ] Classification guard run before writing: `classifyByPath(filename).type === 'adr'`
- [ ] H1 heading contains `ADR`
- [ ] Template fields present: Context, Decision, Status, Consequences, Alternatives considered
- [ ] If Superseded: both the new and the old ADR cross-link, in the same pass, using the path
      table for whichever directory Phase 2 actually found the old ADR in
- [ ] No feature resolved → Gate: Need Human, not a guess

## After Creation

New to this feature's docs directory? Register it once via `/tech-spec` or `/create-request` so the
feature has a tech spec to link the ADR back to (`adr` is not one of `doc-classifier.js`'s
`canonical_roles`, so no tooling does this automatically) — an ADR with no owning tech spec is
still valid, just harder for a reader to trace to the feature's
broader design.

## References

- `rules/docs-numbering.md` § Ancillary docs — the `adr-<number>-<title>.md` pattern this skill implements
- `scripts/config/doc-taxonomy.json` — `adr` type entry (`ancillary` namespace, `semantic_pattern`, `heading_signals`); also where `runbook`/`checklist`'s unanchored patterns and `fp-brief`/`tech-brief`'s suffix patterns live, the reason for the Phase 4 classification guard
- `scripts/lib/doc-classifier.js` — `classifyByPath`, used by the Phase 4 classification guard
- `references/template.md` — the ADR template this skill fills
- `skills/adr/scripts/next-adr-number.js` — the numbering function Phase 2 runs, unit-tested directly by `test/skills/adr.test.js`

## Examples

```
Input: /adr --feature auth Title: Use JWT over session cookies
Action:
  1. Resolve feature → docs/features/auth/
  2. Scan root + archived/ for adr-* → none found → next number 001
  3. Gather Context/Decision/Status/Consequences/Alternatives
  4. Write docs/features/auth/adr-001-use-jwt-over-session-cookies.md
  5. Report: adr-001 written, Status: Proposed
```

```
Input: /adr --feature auth Title: Use opaque tokens (supersedes adr-001)
Action:
  1. Resolve feature → docs/features/auth/
  2. Scan root + archived/ → adr-001 exists → next number 002
  3. Gather content, Status: Accepted (this ADR), supersedes adr-001
  4. Write docs/features/auth/adr-002-use-opaque-tokens.md with "Supersedes: adr-001" line
  4b. Edit adr-001-use-jwt-over-session-cookies.md: Status → Superseded, add "Superseded by: adr-002" line
  5. Report: adr-002 written, adr-001 updated (Status + link)
```
